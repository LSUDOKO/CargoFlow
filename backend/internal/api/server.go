package api

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
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

	AdminKey    string   // required for administrative endpoints
	CORSOrigins []string // exact browser origins allowed cross-origin
	MaxBody     int64
	Log         *slog.Logger

	TelemetryPerMinute int // per authenticated source; default 600
	AdminPerMinute     int // default 120
	MirrorPerMinute    int // public shipment mirroring, per client address; default 30
	GatewayPerMinute   int // gateway registrations, per client address; default 20
	RecoveryPerMinute  int // exporter recovery preparations, per shipment; default 3
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
	if c.ShipmentReadingsPerHour == 0 {
		c.ShipmentReadingsPerHour = 20_000
	}
	return &Server{c: c, limiter: newLimiter(c.Now)}
}

// Handler returns the routed, middleware-wrapped API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", s.handle(s.health))
	mux.HandleFunc("GET /v1/config", s.handle(s.config))
	mux.HandleFunc("GET /v1/stats", s.handle(s.stats))
	mux.HandleFunc("POST /v1/sources", s.handle(s.admin(s.createSource)))
	mux.HandleFunc("POST /v1/shipments", s.handle(s.admin(s.createShipment)))
	mux.HandleFunc("POST /v1/shipments/mirror", s.handle(s.mirror))
	mux.HandleFunc("POST /v1/admin/reconcile", s.handle(s.admin(s.reconcile)))
	mux.HandleFunc("GET /v1/shipments", s.handle(s.listShipments))
	mux.HandleFunc("GET /v1/shipments/{id}", s.handle(s.getShipment))
	mux.HandleFunc("POST /v1/shipments/{id}/telemetry", s.handle(s.telemetry))
	mux.HandleFunc("GET /v1/shipments/{id}/telemetry", s.handle(s.telemetrySummary))
	mux.HandleFunc("POST /v1/shipments/{id}/sources", s.handle(s.registerGateway))
	mux.HandleFunc("GET /v1/shipments/{id}/sources", s.handle(s.listGateways))
	mux.HandleFunc("POST /v1/shipments/{id}/recovery", s.handle(s.prepareRecovery))
	mux.HandleFunc("POST /v1/shipments/{id}/proof", s.handle(s.admin(s.proof)))
	mux.HandleFunc("GET /v1/shipments/{id}/epochs", s.handle(s.epochs))
	mux.HandleFunc("GET /v1/shipments/{id}/audit", s.handle(s.audit))
	if s.c.Hub != nil {
		mux.Handle("GET /v1/ws", s.c.Hub.Handler(originHosts(s.c.CORSOrigins)))
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
	out := map[string]any{"status": "ok", "database": "ok", "chainId": s.c.Chain.M.ChainID}
	status := http.StatusOK
	if err := s.c.Store.Ping(ctx); err != nil {
		out["database"], out["status"], status = "unavailable", "degraded", http.StatusServiceUnavailable
	}
	if head, err := s.c.Chain.Eth.BlockNumber(ctx); err != nil {
		out["chain"], out["status"], status = "unavailable", "degraded", http.StatusServiceUnavailable
	} else {
		out["headBlock"] = head
	}
	writeJSON(w, status, out)
	return nil
}

func (s *Server) config(w http.ResponseWriter, _ *http.Request) error {
	m := s.c.Chain.M
	writeJSON(w, http.StatusOK, map[string]any{
		"chainId":      m.ChainID,
		"usdgDecimals": 6,
		"contracts": map[string]string{
			"usdg": hexAddr(m.USDG), "access": hexAddr(m.Access), "shipmentRegistry": hexAddr(m.Registry),
			"policyEngine": hexAddr(m.Policies), "evidenceRegistry": hexAddr(m.Evidence),
			"receivableVault": hexAddr(m.Vault), "financingController": hexAddr(m.Controller), "groth16Verifier": hexAddr(m.Verifier),
		},
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
