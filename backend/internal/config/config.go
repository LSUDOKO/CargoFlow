// Package config loads and validates service settings from the environment. It reports every
// problem at once, rejects weak secrets, and makes secrets unprintable by construction.
package config

import (
	"encoding/hex"
	"errors"
	"fmt"
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

	RPCURL         string
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
}

// AIEnabled reports whether a model provider is configured.
func (c Config) AIEnabled() bool { return c.GroqAPIKey != "" }

// String renders the configuration without any secret material.
func (c Config) String() string {
	return fmt.Sprintf("config{http=%s chain=%d rpc=%s deployment=%s confirmations=%d poll=%s circuits=%s}",
		c.HTTPAddr, c.ChainID, c.RPCURL, c.DeploymentFile, c.Confirmations, c.IndexerPoll, c.CircuitsDir)
}

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

	c.WorkerKey = key("WORKER_KEY")
	c.MonitorKey = key("MONITOR_KEY")
	c.ManagerKey = key("MANAGER_KEY")

	if len(errs) > 0 {
		return Config{}, errors.Join(errs...)
	}
	return c, nil
}
