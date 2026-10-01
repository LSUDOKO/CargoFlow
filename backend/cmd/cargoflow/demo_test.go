package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
)

func TestDemoReportsEveryMissingSetting(t *testing.T) {
	err := run(context.Background(), []string{"demo"}, func(string) string { return "" }, &bytes.Buffer{})
	if err == nil {
		t.Fatal("an empty environment was accepted")
	}
	for _, want := range []string{"RPC_URL", "CHAIN_ID", "DEPLOYMENT_FILE", "ADMIN_API_KEY", "EXPORTER_KEY", "FINANCIER_KEY", "BUYER_KEY"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not mention %s: %v", want, err)
		}
	}
}

func TestDemoRefusesToStartWhenTheFinancierHasNoUSDG(t *testing.T) {
	ce := chaintest.Start(t)
	key := func(n string) string { return hex.EncodeToString(crypto.FromECDSA(ce.Keys[n])) }
	env := map[string]string{
		"RPC_URL": ce.RPCURL, "CHAIN_ID": "31337", "DEPLOYMENT_FILE": ce.ManifestPath, "ADMIN_API_KEY": "demo-admin-key-0123456789",
		"EXPORTER_KEY": key("exporter"), "FINANCIER_KEY": key("financier"), "BUYER_KEY": key("buyer"),
		"API_URL": "http://127.0.0.1:1", // unreachable on purpose: the preflight must fail before any call
	}
	var out bytes.Buffer
	err := run(context.Background(), []string{"demo"}, func(k string) string { return env[k] }, &out)
	if err == nil || !strings.Contains(err.Error(), "financier") || !strings.Contains(err.Error(), "faucet") {
		t.Fatalf("want an actionable funding error, got %v", err)
	}
	if strings.Contains(err.Error()+out.String(), key("financier")) {
		t.Fatal("a private key was printed")
	}
}
