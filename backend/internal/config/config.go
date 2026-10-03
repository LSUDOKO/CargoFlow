// Package config loads and validates service settings from the environment. It reports every
// problem at once, rejects weak secrets, and makes secrets unprintable by construction.
package config

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Secret is a string that prints as "[redacted]" under every fmt verb. Use Reveal to read it.
type Secret string

func (Secret) String() string   { return "[redacted]" }
func (Secret) GoString() string { return `"[redacted]"` }

// Reveal returns the underlying value. Call it only where the secret is actually used.
func (s Secret) Reveal() string { return string(s) }

// Key is a private key that prints as "[redacted]" under every fmt verb.
type Key []byte

func (Key) String() string   { return "[redacted]" }
func (Key) GoString() string { return `"[redacted]"` }

// Config is the validated service configuration.
type Config struct {
	HTTPAddr    string
	LogLevel    string
	CORSOrigins []string

	DatabaseURL Secret
	AdminAPIKey Secret
	SaltSecret  Secret

	RPCURL string // may carry a credential (a QuickNode token in the path): print it only through RedactURL
	// RPCFallbackURLs are optional further endpoints (RPC_FALLBACK_URL, comma-separated), tried in order while the
	// ones before them are unhealthy. Like RPCURL they may carry credentials: print them only through RedactURL.
	RPCFallbackURLs []string
	// AlchemyRPCURL is an optional last tier after the fallbacks: ALCHEMY_RPC_URL, or built from ALCHEMY_API_KEY as
	// https://robinhood-testnet.g.alchemy.com/v2/<key>. It carries the key in its path.
	AlchemyRPCURL  string
	ChainID        uint64
	DeploymentFile string
	StartBlock     uint64
	Confirmations  uint64
	IndexerPoll    time.Duration

	// ReconcileInterval is how often failed chain actions are retried; zero disables the loop.
	ReconcileInterval time.Duration

	WorkerKey  Key // commits evidence epochs (EVIDENCE_VERIFIER_ROLE)
	MonitorKey Key // requests pauses (MONITOR_ROLE); no other authority
	ManagerKey Key // releases milestones, starts transit, submits recovery proofs (FACILITY_MANAGER_ROLE)

	CircuitsDir string

	// AI monitor (optional). Without a Groq key the deterministic policy gate decides alone.
	GroqAPIKey      Secret
	GroqModel       string // empty selects the provider default
	AITimeout       time.Duration
	AIMinConfidence float64 // confidence a stricter model opinion needs to be honoured

	// Alerts (optional channels; webhooks need no credentials).
	TelegramBotToken Secret // enables Telegram alerts
	ResendAPIKey     Secret // enables email alerts through Resend
	AlertEmailFrom   string // the From of alert emails, e.g. "CargoFlow <alerts@example.com>"

	// AIS (optional): follows registered vessels through aisstream.io.
	AISStreamAPIKey Secret

	// Gas drip (optional): sends GasDripWei to wallets holding less, once per address a day, GasDripDaily in all.
	GasDripKey   Key
	GasDripWei   uint64
	GasDripDaily int

	// AppURL is the web app's origin, used to build links in notifications (e.g. https://app.example.com); empty
	// gives relative links.
	AppURL string
	// RecoveryScanInterval is how often the automatic ZK recovery worker looks for provable recoveries; 0 disables.
	RecoveryScanInterval time.Duration
	// DeviceRootsDir holds manufacturer root certificates (PEM) that device attestation chains must verify against.
	DeviceRootsDir string
	// WebAuthnOrigins are the origins a passkey assertion may come from; empty accepts CORS_ORIGINS.
	WebAuthnOrigins []string

	// AlchemyWebhookSigningKeys verify X-Alchemy-Signature on POST /v1/webhooks/alchemy (several, so a key can be
	// rotated without downtime); empty turns the route off (503).
	AlchemyWebhookSigningKeys []Secret

	// ZeroDev gas policy webhook (optional): POST /v1/webhooks/zerodev/{secret} decides which user operations
	// CargoFlow sponsors. Off (404) without both the secret and the project id.
	ZeroDevWebhookSecret Secret
	ZeroDevProjectID     string
	SponsorPerDay        int    // per sender, rolling 24 hours
	SponsorGlobalDay     int    // everyone, rolling 24 hours
	SponsorMaxWei        uint64 // cap on a user operation's maximum gas cost

	// Dune upload (optional): pushes indexed data to Dune's uploads API every DuneUploadInterval.
	DuneAPIKey         Secret
	DuneNamespace      string
	DuneUploadInterval time.Duration
}

// RPCFallbacks lists the failover tiers after the primary: the RPC_FALLBACK_URL entries, then the Alchemy endpoint.
func (c Config) RPCFallbacks() []string {
	out := append([]string(nil), c.RPCFallbackURLs...)
	if c.AlchemyRPCURL != "" && !slices.Contains(out, c.AlchemyRPCURL) && c.AlchemyRPCURL != c.RPCURL {
		out = append(out, c.AlchemyRPCURL)
	}
	return out
}

// AlchemyWebhookEnabled reports whether webhook deliveries can be verified.
func (c Config) AlchemyWebhookEnabled() bool { return len(c.AlchemyWebhookSigningKeys) > 0 }

// ZeroDevWebhookEnabled reports whether the gas policy webhook answers.
func (c Config) ZeroDevWebhookEnabled() bool {
	return c.ZeroDevWebhookSecret != "" && c.ZeroDevProjectID != ""
}

// DuneEnabled reports whether the Dune uploader runs.
func (c Config) DuneEnabled() bool { return c.DuneAPIKey != "" && c.DuneNamespace != "" }

// TelegramEnabled reports whether Telegram alerts are configured.
func (c Config) TelegramEnabled() bool { return c.TelegramBotToken != "" }

// EmailEnabled reports whether email alerts are configured.
func (c Config) EmailEnabled() bool { return c.ResendAPIKey != "" && c.AlertEmailFrom != "" }

// AISEnabled reports whether the AIS feed is configured.
func (c Config) AISEnabled() bool { return c.AISStreamAPIKey != "" }

// GasDripEnabled reports whether the gas drip has a funded key.
func (c Config) GasDripEnabled() bool { return len(c.GasDripKey) == 32 }

// AIEnabled reports whether a model provider is configured.
func (c Config) AIEnabled() bool { return c.GroqAPIKey != "" }

// String renders the configuration without any secret material.
func (c Config) String() string {
	fallback := "none"
	if fbs := c.RPCFallbacks(); len(fbs) > 0 {
		red := make([]string, len(fbs))
		for i, f := range fbs {
			red[i] = RedactURL(f)
		}
		fallback = strings.Join(red, ",")
	}
	return fmt.Sprintf("config{http=%s chain=%d rpc=%s rpcFallback=%s deployment=%s confirmations=%d poll=%s circuits=%s}",
		c.HTTPAddr, c.ChainID, RedactURL(c.RPCURL), fallback, c.DeploymentFile, c.Confirmations, c.IndexerPoll, c.CircuitsDir)
}

// RedactURL keeps a URL's scheme and host and hides what may be a credential (user info, path, query).
func RedactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "[redacted]"
	}
	out := u.Scheme + "://" + u.Host
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		out += "/…"
	}
	return out
}

var duneName = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Minimum secret sizes.
const (
	minAdminKeyLen   = 16
	minSaltSecretLen = 16
)

// Load reads settings through getenv (os.Getenv in production).
func Load(getenv func(string) string) (Config, error) {
	var errs []error
	fail := func(name, msg string) { errs = append(errs, fmt.Errorf("%s: %s", name, msg)) }

	str := func(name, def string) string {
		if v := strings.TrimSpace(getenv(name)); v != "" {
			return v
		}
		return def
	}
	required := func(name string) string {
		v := strings.TrimSpace(getenv(name))
		if v == "" {
			fail(name, "is required")
		}
		return v
	}
	uintVal := func(name string, def uint64, requiredVal bool) uint64 {
		raw := strings.TrimSpace(getenv(name))
		if raw == "" {
			if requiredVal {
				fail(name, "is required")
			}
			return def
		}
		n, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			fail(name, "must be a non-negative integer")
			return def
		}
		return n
	}
	key := func(name string) Key {
		raw := strings.TrimSpace(getenv(name))
		if raw == "" {
			fail(name, "is required")
			return nil
		}
		b, err := hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(raw, "0x"), "0X"))
		if err != nil || len(b) != 32 {
			fail(name, "must be a 32-byte hex private key (with or without 0x)")
			return nil
		}
		return Key(b)
	}

	c := Config{
		HTTPAddr:       str("HTTP_ADDR", ":8080"),
		LogLevel:       str("LOG_LEVEL", "info"),
		DatabaseURL:    Secret(required("DATABASE_URL")),
		RPCURL:         required("RPC_URL"),
		DeploymentFile: required("DEPLOYMENT_FILE"),
		CircuitsDir:    str("CIRCUITS_DIR", "../circuits"),
	}
	for _, raw := range strings.Split(getenv("RPC_FALLBACK_URL"), ",") {
		if raw = strings.TrimSpace(raw); raw != "" {
			c.RPCFallbackURLs = append(c.RPCFallbackURLs, raw)
		}
	}
	c.AlchemyRPCURL = str("ALCHEMY_RPC_URL", "")
	if c.AlchemyRPCURL == "" {
		if k := strings.TrimSpace(getenv("ALCHEMY_API_KEY")); k != "" {
			if strings.ContainsAny(k, "/?#@ ") {
				fail("ALCHEMY_API_KEY", "must be the bare Alchemy API key")
			} else {
				c.AlchemyRPCURL = "https://robinhood-testnet.g.alchemy.com/v2/" + k
			}
		}
	}
	check := func(name, raw string) {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || !slices.Contains([]string{"http", "https", "ws", "wss"}, u.Scheme) {
			fail(name, "must be an http(s) or ws(s) URL")
		}
	}
	if c.RPCURL != "" {
		check("RPC_URL", c.RPCURL)
	}
	for _, f := range c.RPCFallbackURLs {
		check("RPC_FALLBACK_URL", f)
	}
	if c.AlchemyRPCURL != "" {
		check("ALCHEMY_RPC_URL", c.AlchemyRPCURL)
	}
	if fbs := c.RPCFallbacks(); len(fbs) > 0 {
		for _, f := range append([]string{c.RPCURL}, fbs...) {
			if !strings.HasPrefix(f, "http") {
				fail("RPC_FALLBACK_URL", "failover works over HTTP(S): use http(s) URLs for RPC_URL, RPC_FALLBACK_URL and ALCHEMY_RPC_URL")
				break
			}
		}
	}
	c.ChainID = uintVal("CHAIN_ID", 0, true)
	c.StartBlock = uintVal("START_BLOCK", 0, false)
	c.Confirmations = uintVal("CONFIRMATIONS", 1, false)

	c.IndexerPoll = 2 * time.Second
	if raw := strings.TrimSpace(getenv("INDEXER_POLL")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			fail("INDEXER_POLL", "must be a positive duration such as 2s or 500ms")
		} else {
			c.IndexerPoll = d
		}
	}

	c.ReconcileInterval = 30 * time.Second
	if raw := strings.TrimSpace(getenv("RECONCILE_INTERVAL")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d < 0 {
			fail("RECONCILE_INTERVAL", "must be a non-negative duration such as 30s (0s disables)")
		} else {
			c.ReconcileInterval = d
		}
	}

	c.GroqAPIKey = Secret(strings.TrimSpace(getenv("GROQ_API_KEY")))
	c.GroqModel = str("GROQ_MODEL", "")
	c.AITimeout = 10 * time.Second
	if raw := strings.TrimSpace(getenv("AI_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			fail("AI_TIMEOUT", "must be a positive duration such as 10s")
		} else {
			c.AITimeout = d
		}
	}
	c.AIMinConfidence = 0.9
	if raw := strings.TrimSpace(getenv("AI_MIN_CONFIDENCE")); raw != "" {
		f, err := strconv.ParseFloat(raw, 64)
		if err != nil || !(f > 0 && f <= 1) {
			fail("AI_MIN_CONFIDENCE", "must be a number above 0 and at most 1")
		} else {
			c.AIMinConfidence = f
		}
	}

	if origins := strings.TrimSpace(getenv("CORS_ORIGINS")); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if o = strings.TrimSpace(o); o != "" {
				c.CORSOrigins = append(c.CORSOrigins, o)
			}
		}
	}

	admin := required("ADMIN_API_KEY")
	if admin != "" && len(admin) < minAdminKeyLen {
		fail("ADMIN_API_KEY", fmt.Sprintf("must be at least %d characters", minAdminKeyLen))
	}
	c.AdminAPIKey = Secret(admin)

	salt := required("SALT_SECRET")
	if salt != "" && len(salt) < minSaltSecretLen {
		fail("SALT_SECRET", fmt.Sprintf("must be at least %d characters", minSaltSecretLen))
	}
	c.SaltSecret = Secret(salt)

	c.TelegramBotToken = Secret(strings.TrimSpace(getenv("TELEGRAM_BOT_TOKEN")))
	c.ResendAPIKey = Secret(strings.TrimSpace(getenv("RESEND_API_KEY")))
	c.AlertEmailFrom = str("ALERT_EMAIL_FROM", "")
	if c.ResendAPIKey != "" && !strings.Contains(c.AlertEmailFrom, "@") {
		fail("ALERT_EMAIL_FROM", "must be a sender address such as \"CargoFlow <alerts@example.com>\" when RESEND_API_KEY is set")
	}
	c.AISStreamAPIKey = Secret(strings.TrimSpace(getenv("AISSTREAM_API_KEY")))
	if strings.TrimSpace(getenv("GAS_DRIP_KEY")) != "" {
		c.GasDripKey = key("GAS_DRIP_KEY")
	}
	c.GasDripWei = uintVal("GAS_DRIP_WEI", 50_000_000_000_000, false) // 0.00005 ETH
	if c.GasDripWei == 0 {
		fail("GAS_DRIP_WEI", "must be a positive amount of wei")
	}
	c.GasDripDaily = int(uintVal("GAS_DRIP_DAILY", 200, false))
	if c.GasDripDaily <= 0 {
		fail("GAS_DRIP_DAILY", "must be a positive number of drips")
	}

	c.AppURL = strings.TrimRight(str("APP_URL", ""), "/")
	if c.AppURL != "" {
		if u, err := url.Parse(c.AppURL); err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
			fail("APP_URL", "must be the web app's origin, such as https://app.example.com")
		}
	}
	c.RecoveryScanInterval = time.Minute
	if raw := strings.TrimSpace(getenv("RECOVERY_SCAN_INTERVAL")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil || d < 0 {
			fail("RECOVERY_SCAN_INTERVAL", "must be a non-negative duration such as 1m (0s disables)")
		} else {
			c.RecoveryScanInterval = d
		}
	}
	c.DeviceRootsDir = str("DEVICE_ROOTS_DIR", "")
	if origins := strings.TrimSpace(getenv("WEBAUTHN_ORIGINS")); origins != "" {
		for _, o := range strings.Split(origins, ",") {
			if o = strings.TrimSpace(o); o != "" {
				c.WebAuthnOrigins = append(c.WebAuthnOrigins, o)
			}
		}
	}

	for _, k := range strings.Split(getenv("ALCHEMY_WEBHOOK_SIGNING_KEYS"), ",") {
		if k = strings.TrimSpace(k); k != "" {
			if len(k) < 16 {
				fail("ALCHEMY_WEBHOOK_SIGNING_KEYS", "each signing key must be at least 16 characters (the whsec_ key Alchemy issues)")
				continue
			}
			c.AlchemyWebhookSigningKeys = append(c.AlchemyWebhookSigningKeys, Secret(k))
		}
	}

	c.ZeroDevWebhookSecret = Secret(strings.TrimSpace(getenv("ZERODEV_WEBHOOK_SECRET")))
	if c.ZeroDevWebhookSecret != "" && len(c.ZeroDevWebhookSecret) < 24 {
		fail("ZERODEV_WEBHOOK_SECRET", "must be at least 24 characters (it is the only credential on the webhook URL)")
	}
	c.ZeroDevProjectID = str("ZERODEV_PROJECT_ID", "")
	c.SponsorPerDay = int(uintVal("ZERODEV_SPONSOR_PER_DAY", 25, false))
	c.SponsorGlobalDay = int(uintVal("ZERODEV_SPONSOR_GLOBAL_DAY", 500, false))
	c.SponsorMaxWei = uintVal("ZERODEV_SPONSOR_MAX_WEI", 200_000_000_000_000, false) // 0.0002 ETH

	c.DuneAPIKey = Secret(strings.TrimSpace(getenv("DUNE_API_KEY")))
	c.DuneNamespace = str("DUNE_NAMESPACE", "")
	if c.DuneNamespace != "" && !duneName.MatchString(c.DuneNamespace) {
		fail("DUNE_NAMESPACE", "must be a Dune user or team handle (letters, digits, _ and -)")
	}
	c.DuneUploadInterval = 15 * time.Minute
	for _, name := range []string{"DUNE_PUSH_INTERVAL", "DUNE_UPLOAD_INTERVAL"} { // the latter wins
		if raw := strings.TrimSpace(getenv(name)); raw != "" {
			d, err := time.ParseDuration(raw)
			if err != nil || d < time.Minute {
				fail(name, "must be a duration of at least 1m, such as 15m")
			} else {
				c.DuneUploadInterval = d
			}
		}
	}

	c.WorkerKey = key("WORKER_KEY")
	c.MonitorKey = key("MONITOR_KEY")
	c.ManagerKey = key("MANAGER_KEY")

	if len(errs) > 0 {
		return Config{}, errors.Join(errs...)
	}
	return c, nil
}
