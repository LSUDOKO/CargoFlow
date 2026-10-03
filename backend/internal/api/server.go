package api

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ais"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// Limits on what one request may carry.
const (
	maxPointsPerBatch = 500
	maxFutureSkewSec  = 300 // how far ahead of the server clock a reading may be dated
	maxListLimit      = 200
)

// Config wires the API to the service and its dependencies.
type Config struct {
	Service  *service.Service
	Store    *store.Store
	Chain    *chain.Client
	Hub      *ws.Hub
	Verifier *auth.Verifier // authenticates telemetry sources

	Alerts AlertChannels // which alert channels can deliver; webhooks always can
	AIS    *ais.Tracker  // follows vessels through AIS; nil or without a stream when AISSTREAM_API_KEY is unset
	Gas    *GasDrip      // nil when GAS_DRIP_KEY is unset

	// Alchemy webhooks (POST /v1/webhooks/alchemy): the signing keys (any one may sign; empty answers 503) and the
	// indexer to wake.
	AlchemySigningKeys []string
	Indexer            IndexerWaker
	// ZeroDev gas policy webhook (POST /v1/webhooks/zerodev/{secret}); nil answers 404.
	ZeroDev *ZeroDevSponsor

	DeviceRoots     *devicetrust.Roots  // manufacturer roots device attestations must chain to; nil or empty refuses attestation chains
	WebAuthnOrigins devicetrust.Origins // origins passkey registrations may come from (empty: any https origin or localhost)

	AdminKey    string   // required for administrative endpoints
	CORSOrigins []string // exact browser origins allowed cross-origin
	MaxBody     int64
	Log         *slog.Logger

	TelemetryPerMinute int // per authenticated source; default 600
	AdminPerMinute     int // default 120
	MirrorPerMinute    int // public shipment mirroring, per client address; default 30
	GatewayPerMinute   int // gateway registrations, per client address; default 20
	RecoveryPerMinute  int // exporter recovery preparations, per shipment; default 3
	GasPerMinute       int // gas drip requests, per client address; default 10
	// ShipmentReadingsPerHour caps the readings one shipment may receive per hour from all of its sources, which
	// bounds the evidence commits the worker pays for. Default 20,000: a 30-day, two-probe logger export at
	// 10-minute intervals fits in one go.
	ShipmentReadingsPerHour int

	Now func() time.Time
}

// Server is the HTTP API.
type Server struct {
	c       Config
	limiter *limiter
	codes   codeCache
	paused  pausedCache
}

// NewServer builds the API server.
func NewServer(c Config) *Server {
	if c.Log == nil {
		c.Log = slog.Default()
	}
	if c.TelemetryPerMinute == 0 {
		c.TelemetryPerMinute = 600
	}
	if c.AdminPerMinute == 0 {
		c.AdminPerMinute = 120
	}
	if c.MirrorPerMinute == 0 {
		c.MirrorPerMinute = 30
	}
	if c.GatewayPerMinute == 0 {
		c.GatewayPerMinute = 20
	}
	if c.RecoveryPerMinute == 0 {
		c.RecoveryPerMinute = 3
	}
	if c.GasPerMinute == 0 {
		c.GasPerMinute = 10
	}
	if c.ShipmentReadingsPerHour == 0 {
		c.ShipmentReadingsPerHour = 20_000
	}
	return &Server{c: c, limiter: newLimiter(c.Now)}
}

// Handler returns the routed, middleware-wrapped API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	for _, rt := range s.routes() {
		pattern := rt.Method + " " + rt.Path
		if rt.raw != nil {
			mux.Handle(pattern, rt.raw(s))
			continue
		}
		mux.HandleFunc(pattern, s.handle(rt.h))
	}
	return Chain(mux, Options{Log: s.c.Log, CORSOrigins: s.c.CORSOrigins, MaxBody: s.c.MaxBody})
}

type handlerFunc func(w http.ResponseWriter, r *http.Request) error

// handle turns a handler's returned error into a JSON response, and logs unclassified failures.
func (s *Server) handle(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := h(w, r); err != nil {
			err = fromService(err)
			var ae *Error
			if !asAPIError(err, &ae) {
				s.c.Log.Error("request failed", "path", r.URL.Path, "err", err)
			}
			WriteError(w, err)
		}
	}
}

// admin requires the administrative API key (constant-time comparison) and applies the admin rate limit.
func (s *Server) admin(h handlerFunc) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		got := r.Header.Get("X-API-Key")
		if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(s.c.AdminKey)) != 1 {
			return ErrUnauthorized("a valid X-API-Key is required")
		}
		if err := s.rateLimit(w, "admin", s.c.AdminPerMinute); err != nil {
			return err
		}
		return h(w, r)
	}
}

func (s *Server) rateLimit(w http.ResponseWriter, key string, perMinute int) error {
	if ok, wait := s.limiter.allow(key, perMinute); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		return &Error{http.StatusTooManyRequests, "rate_limited", "too many requests; retry later"}
	}
	return nil
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) error {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	out := healthResponse{Status: "ok", Database: "ok", ChainID: s.c.Chain.M.ChainID, RPC: s.c.Chain.ActiveRPC()}
	status := http.StatusOK
	if err := s.c.Store.Ping(ctx); err != nil {
		out.Database, out.Status, status = "unavailable", "degraded", http.StatusServiceUnavailable
	}
	if head, err := s.c.Chain.Eth.BlockNumber(ctx); err != nil {
		out.Chain, out.Status, status = "unavailable", "degraded", http.StatusServiceUnavailable
	} else {
		out.HeadBlock = head
	}
	writeJSON(w, status, out)
	return nil
}

func (s *Server) config(w http.ResponseWriter, r *http.Request) error {
	m := s.c.Chain.M
	contracts := map[string]string{
		"usdg": hexAddr(m.USDG), "access": hexAddr(m.Access), "shipmentRegistry": hexAddr(m.Registry),
		"policyEngine": hexAddr(m.Policies), "evidenceRegistry": hexAddr(m.Evidence),
		"receivableVault": hexAddr(m.Vault), "financingController": hexAddr(m.Controller), "groth16Verifier": hexAddr(m.Verifier),
	}
	if s.c.Chain.HasCoverPool() {
		contracts["coverPool"] = hexAddr(m.CoverPool)
	}
	if s.c.Chain.HasDeviceRegistry() {
		contracts["deviceRegistry"] = hexAddr(m.DeviceRegistry)
	}
	if s.c.Chain.HasEBL() {
		contracts["eblRegistry"] = hexAddr(m.EBLRegistry)
	}
	writeJSON(w, http.StatusOK, configResponse{
		ChainID: m.ChainID, USDGDecimals: 6, Contracts: contracts,
		Alerts:  alertChannelsDTO{Webhook: true, Telegram: s.c.Alerts.TelegramBot != "", Email: s.c.Alerts.Email, Slack: true, TelegramBot: s.c.Alerts.TelegramBot},
		GasDrip: s.c.Gas != nil, AIS: s.c.AIS.Enabled(), Paused: s.pausedFlags(r),
	})
	return nil
}

// originHosts converts full origins ("https://app.example.com") to the host patterns WebSocket origin
// checks expect.
func originHosts(origins []string) []string {
	var hosts []string
	for _, o := range origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			hosts = append(hosts, u.Host)
		}
	}
	return hosts
}
