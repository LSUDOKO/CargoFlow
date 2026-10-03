package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
)

func TestKeygenProducesAUsableEd25519KeyPair(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), []string{"keygen"}, func(string) string { return "" }, &out); err != nil {
		t.Fatal(err)
	}
	var kp struct {
		PublicKey  string `json:"publicKey"`
		PrivateKey string `json:"privateKey"`
	}
	if err := json.Unmarshal(out.Bytes(), &kp); err != nil {
		t.Fatalf("keygen output is not JSON: %v\n%s", err, out.String())
	}
	pub, err1 := base64.RawURLEncoding.DecodeString(kp.PublicKey)
	priv, err2 := base64.RawURLEncoding.DecodeString(kp.PrivateKey)
	if err1 != nil || err2 != nil || len(pub) != ed25519.PublicKeySize || len(priv) != ed25519.PrivateKeySize {
		t.Fatalf("bad key sizes: %v %v %d %d", err1, err2, len(pub), len(priv))
	}
	// the pair must actually sign requests the verifier accepts
	sig := auth.Sign(ed25519.PrivateKey(priv), "POST", "/p", 1, []byte("x"))
	raw, _ := base64.RawURLEncoding.DecodeString(sig)
	if !ed25519.Verify(ed25519.PublicKey(pub), auth.SigningString("POST", "/p", 1, []byte("x")), raw) {
		t.Fatal("the generated key pair does not verify its own signatures")
	}
	var again bytes.Buffer
	_ = run(context.Background(), []string{"keygen"}, func(string) string { return "" }, &again)
	if again.String() == out.String() {
		t.Fatal("keygen returned the same key twice")
	}
}

func TestServeRefusesToStartWithoutConfigAndNeverPrintsSecrets(t *testing.T) {
	env := map[string]string{"ADMIN_API_KEY": "short", "SALT_SECRET": "s3cr3t-but-too-short"}
	err := run(context.Background(), []string{"serve"}, func(k string) string { return env[k] }, &bytes.Buffer{})
	if err == nil {
		t.Fatal("serve started with an empty configuration")
	}
	for _, want := range []string{"DATABASE_URL", "RPC_URL", "WORKER_KEY", "ADMIN_API_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not mention %s: %v", want, err)
		}
	}
	if strings.Contains(err.Error(), "s3cr3t-but-too-short") {
		t.Fatal("a secret value appeared in an error message")
	}
}

func TestUnknownCommandPrintsUsage(t *testing.T) {
	var out bytes.Buffer
	err := run(context.Background(), []string{"nonsense"}, func(string) string { return "" }, &out)
	if err == nil {
		t.Fatal("an unknown command succeeded")
	}
	if !strings.Contains(out.String(), "serve") || !strings.Contains(out.String(), "migrate") || !strings.Contains(out.String(), "keygen") {
		t.Fatalf("usage should list the commands: %q", out.String())
	}
	if err := run(context.Background(), nil, func(string) string { return "" }, &bytes.Buffer{}); err == nil {
		t.Fatal("no command succeeded")
	}
	_ = time.Second
}

func TestTheAIMonitorExistsOnlyWhenAModelKeyIsConfigured(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if m := aiMonitor(config.Config{}, log); m != nil {
		t.Fatal("a monitor was built without a key")
	}
	m := aiMonitor(config.Config{GroqAPIKey: "gsk_x", AITimeout: time.Second, AIMinConfidence: 0.9}, log)
	if !m.Enabled() {
		t.Fatal("no monitor although a key is configured")
	}
}

func TestOptionalIntegrationsAreWiredOnlyWhenConfigured(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	bare := config.Config{ChainID: 1, GasDripWei: 1000, GasDripDaily: 5}
	d, ch := alerting(context.Background(), bare, nil, log)
	if len(d.Senders) != 1 || d.Senders["webhook"] == nil || ch.TelegramBot != "" || ch.Email || ch.AllowPrivateWebhooks {
		t.Fatalf("bare alerting = %+v %+v", d.Senders, ch)
	}
	if aisTracker(bare, nil, log).Enabled() {
		t.Fatal("AIS is live without a key")
	}
	if drip, err := gasDrip(bare, nil, log); drip != nil || err != nil {
		t.Fatalf("a gas drip without a key: %v %v", drip, err)
	}
	if wording(bare) != nil {
		t.Fatal("a rewording model without a Groq key")
	}

	dev := bare
	dev.ChainID = 31337
	dev.ResendAPIKey, dev.AlertEmailFrom = "re_x", "alerts@example.com"
	dev.AISStreamAPIKey = "ais"
	dev.GasDripKey = mustHex(t, "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6")
	dev.GroqAPIKey = "gsk_x"
	d, ch = alerting(context.Background(), dev, nil, log)
	if d.Senders["email"] == nil || !ch.Email || !ch.AllowPrivateWebhooks {
		t.Fatalf("dev alerting = %+v %+v", d.Senders, ch)
	}
	if !aisTracker(dev, nil, log).Enabled() || wording(dev) == nil {
		t.Fatal("AIS or rewording is off although configured")
	}
	drip, err := gasDrip(dev, nil, log)
	if err != nil || drip == nil || drip.AmountWei.Int64() != 1000 || drip.Daily != 5 {
		t.Fatalf("gas drip = %+v %v", drip, err)
	}
	dev.ManagerKey = dev.GasDripKey
	if _, err := gasDrip(dev, nil, log); err == nil {
		t.Fatal("the gas drip shared a role key")
	}
}

func mustHex(t *testing.T, s string) config.Key {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return config.Key(b)
}
