package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
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
