package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
)

const key1 = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const key2 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
const key3 = "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func valid() map[string]string {
	return map[string]string{
		"DATABASE_URL":    "postgres://u:p@localhost/db",
		"ADMIN_API_KEY":   "0123456789abcdef0123",
		"SALT_SECRET":     "operator-secret-at-least-16-bytes",
		"RPC_URL":         "http://127.0.0.1:8545",
		"CHAIN_ID":        "31337",
		"DEPLOYMENT_FILE": "../contracts/deployments/local.json",
		"WORKER_KEY":      key1,
		"MONITOR_KEY":     key2,
		"MANAGER_KEY":     key3,
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	c, err := config.Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.HTTPAddr != ":8080" || c.Confirmations != 1 || c.IndexerPoll != 2*time.Second || c.LogLevel != "info" {
		t.Fatalf("defaults wrong: %+v", c)
	}
	if c.CircuitsDir != "../circuits" || c.ChainID != 31337 || c.StartBlock != 0 {
		t.Fatalf("defaults wrong: %+v", c)
	}
}

func TestLoadParsesKeysWithOrWithoutPrefix(t *testing.T) {
	c, err := config.Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	for name, k := range map[string][]byte{"worker": c.WorkerKey, "monitor": c.MonitorKey, "manager": c.ManagerKey} {
		if len(k) != 32 {
			t.Fatalf("%s key has %d bytes", name, len(k))
		}
	}
}

func TestLoadReportsEveryMissingRequiredSettingAtOnce(t *testing.T) {
	_, err := config.Load(env(map[string]string{}))
	if err == nil {
		t.Fatal("empty environment accepted")
	}
	for _, want := range []string{"DATABASE_URL", "ADMIN_API_KEY", "SALT_SECRET", "RPC_URL", "CHAIN_ID", "DEPLOYMENT_FILE", "WORKER_KEY", "MONITOR_KEY", "MANAGER_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error does not mention %s: %v", want, err)
		}
	}
}

func TestWeakSecretsAreRejected(t *testing.T) {
	e := valid()
	e["ADMIN_API_KEY"] = "short"
	if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "ADMIN_API_KEY") {
		t.Fatalf("short admin key accepted: %v", err)
	}
	e = valid()
	e["SALT_SECRET"] = "tooshort"
	if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "SALT_SECRET") {
		t.Fatalf("short salt secret accepted: %v", err)
	}
}

func TestMalformedValuesAreRejected(t *testing.T) {
	cases := map[string]string{
		"WORKER_KEY":    "not-hex",
		"MONITOR_KEY":   key1[:60], // too short
		"CHAIN_ID":      "abc",
		"CONFIRMATIONS": "-1",
		"INDEXER_POLL":  "soon",
		"START_BLOCK":   "x",
	}
	for k, v := range cases {
		e := valid()
		e[k] = v
		if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), k) {
			t.Errorf("%s=%q accepted: %v", k, v, err)
		}
	}
}

func TestOverridesAreHonoured(t *testing.T) {
	e := valid()
	e["HTTP_ADDR"] = ":9999"
	e["CONFIRMATIONS"] = "3"
	e["INDEXER_POLL"] = "500ms"
	e["START_BLOCK"] = "1200"
	e["CORS_ORIGINS"] = "http://localhost:3000, https://app.example"
	e["LOG_LEVEL"] = "debug"
	c, err := config.Load(env(e))
	if err != nil {
		t.Fatal(err)
	}
	if c.HTTPAddr != ":9999" || c.Confirmations != 3 || c.IndexerPoll != 500*time.Millisecond || c.StartBlock != 1200 || c.LogLevel != "debug" {
		t.Fatalf("overrides ignored: %+v", c)
	}
	if len(c.CORSOrigins) != 2 || c.CORSOrigins[1] != "https://app.example" {
		t.Fatalf("cors origins = %v", c.CORSOrigins)
	}
}

func TestStringNeverRevealsSecrets(t *testing.T) {
	c, _ := config.Load(env(valid()))
	for _, rendered := range []string{c.String(), strings.TrimSpace(fmtSprint(c))} {
		for _, secret := range []string{key1, key3, "operator-secret-at-least-16-bytes", "0123456789abcdef0123", "postgres://u:p@"} {
			if strings.Contains(rendered, secret) {
				t.Fatalf("config rendering leaks %q: %s", secret, rendered)
			}
		}
	}
}

func TestTheAIMonitorIsOffByDefault(t *testing.T) {
	c, err := config.Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.AIEnabled() || c.AITimeout != 10*time.Second || c.AIMinConfidence != 0.9 || c.GroqModel != "" {
		t.Fatalf("%+v", c)
	}
}

func TestGroqSettingsAreParsedAndTheKeyNeverPrints(t *testing.T) {
	e := valid()
	e["GROQ_API_KEY"] = "gsk_super_secret_value_123"
	e["GROQ_MODEL"] = "openai/gpt-oss-120b"
	e["AI_TIMEOUT"] = "3s"
	e["AI_MIN_CONFIDENCE"] = "0.75"
	c, err := config.Load(env(e))
	if err != nil {
		t.Fatal(err)
	}
	if !c.AIEnabled() || c.GroqAPIKey.Reveal() != "gsk_super_secret_value_123" || c.GroqModel != "openai/gpt-oss-120b" ||
		c.AITimeout != 3*time.Second || c.AIMinConfidence != 0.75 {
		t.Fatalf("%+v", c)
	}
	if out := fmtSprint(c) + c.String(); strings.Contains(out, "super_secret") {
		t.Fatalf("the Groq key was printed: %s", out)
	}
}

func TestInvalidAISettingsAreRejected(t *testing.T) {
	for name, kv := range map[string][2]string{
		"timeout not a duration":  {"AI_TIMEOUT", "soon"},
		"timeout not positive":    {"AI_TIMEOUT", "0s"},
		"confidence not a number": {"AI_MIN_CONFIDENCE", "high"},
		"confidence zero":         {"AI_MIN_CONFIDENCE", "0"},
		"confidence above one":    {"AI_MIN_CONFIDENCE", "1.5"},
		"confidence NaN":          {"AI_MIN_CONFIDENCE", "NaN"},
	} {
		t.Run(name, func(t *testing.T) {
			e := valid()
			e[kv[0]] = kv[1]
			if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), kv[0]) {
				t.Fatalf("accepted %s=%s: %v", kv[0], kv[1], err)
			}
		})
	}
}

func TestReconcileIntervalDefaultsParsesAndCanBeDisabled(t *testing.T) {
	c, err := config.Load(env(valid()))
	if err != nil || c.ReconcileInterval != 30*time.Second {
		t.Fatalf("default: %+v %v", c.ReconcileInterval, err)
	}
	e := valid()
	e["RECONCILE_INTERVAL"] = "5s"
	if c, err = config.Load(env(e)); err != nil || c.ReconcileInterval != 5*time.Second {
		t.Fatalf("%v %v", c.ReconcileInterval, err)
	}
	e["RECONCILE_INTERVAL"] = "0s"
	if c, err = config.Load(env(e)); err != nil || c.ReconcileInterval != 0 {
		t.Fatalf("0s must disable the loop: %v %v", c.ReconcileInterval, err)
	}
	for _, bad := range []string{"soon", "-5s"} {
		e["RECONCILE_INTERVAL"] = bad
		if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "RECONCILE_INTERVAL") {
			t.Fatalf("accepted %q: %v", bad, err)
		}
	}
}

func TestDemoModeIsOffByDefaultAndNeedsKeysWhenOn(t *testing.T) {
	c, err := config.Load(env(valid()))
	if err != nil || c.DemoMode {
		t.Fatalf("%v %v", c.DemoMode, err)
	}
	e := valid()
	e["DEMO_MODE"] = "true"
	if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "DEMO_EXPORTER_KEY") {
		t.Fatalf("keys must be required in demo mode: %v", err)
	}
	e["DEMO_EXPORTER_KEY"], e["DEMO_FINANCIER_KEY"], e["DEMO_BUYER_KEY"] = key1, key2, key3
	c, err = config.Load(env(e))
	if err != nil || !c.DemoMode || len(c.DemoExporterKey) != 32 {
		t.Fatalf("%v", err)
	}
	if c.DemoDivisor != 1 { // chain 31337 in valid(): full size, mintable mock token
		t.Fatalf("divisor on a local chain = %d", c.DemoDivisor)
	}
	e["CHAIN_ID"] = "46630"
	if c, _ = config.Load(env(e)); c.DemoDivisor != 2000 {
		t.Fatalf("divisor on testnet = %d, want 2000 so a faucet drip is enough", c.DemoDivisor)
	}
	e["DEMO_DIVISOR"] = "7"
	if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "DEMO_DIVISOR") {
		t.Fatalf("an inexact divisor was accepted: %v", err)
	}
	e["DEMO_MODE"] = "maybe"
	if _, err := config.Load(env(e)); err == nil || !strings.Contains(err.Error(), "DEMO_MODE") {
		t.Fatalf("a non-boolean DEMO_MODE was accepted: %v", err)
	}
}
