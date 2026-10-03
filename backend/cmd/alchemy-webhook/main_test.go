package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const manifest = `{"chainId":46630,"usdg":"0x7E955252E15c84f5768B83c41a71F9eba181802F","contracts":{
 "access":"0x0000000000000000000000000000000000000001","shipmentRegistry":"0x0000000000000000000000000000000000000002",
 "policyEngine":"0x0000000000000000000000000000000000000003","evidenceRegistry":"0x0000000000000000000000000000000000000004",
 "receivableVault":"0x0000000000000000000000000000000000000005","groth16Verifier":"0x0000000000000000000000000000000000000006",
 "financingController":"0x0000000000000000000000000000000000000007","coverPool":"0x0000000000000000000000000000000000000008",
 "eblRegistry":"0x00000000000000000000000000000000000000Ab"}}`

func writeManifest(t *testing.T) string {
	p := filepath.Join(t.TempDir(), "m.json")
	if err := os.WriteFile(p, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDryRunPrintsTheRequest(t *testing.T) {
	var out, errOut bytes.Buffer
	err := run(context.Background(), []string{"-deployment", writeManifest(t), "-api", "https://api.example.com/", "-dry-run"}, env(nil), &out, &errOut, nil)
	if err != nil {
		t.Fatal(err)
	}
	s := out.String()
	for _, want := range []string{"ROBINHOOD_TESTNET", `"GRAPHQL"`, "https://api.example.com/v1/webhooks/alchemy", "0x0000000000000000000000000000000000000007",
		"0x00000000000000000000000000000000000000ab", "logs(filter: {addresses:"} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q in\n%s", want, s)
		}
	}
	if strings.Contains(s, "0x0000000000000000000000000000000000000006") || strings.Contains(s, "0x0000000000000000000000000000000000000001\\") {
		t.Fatal("only indexed contracts are filtered (not the verifier or access)")
	}
}

func TestCreatesThenReplacesThePreviousWebhook(t *testing.T) {
	var calls []string
	var created map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Alchemy-Token") != "tok" {
			http.Error(w, "unauthorized", 401)
			return
		}
		calls = append(calls, r.Method+" "+r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/team-webhooks":
			_, _ = w.Write([]byte(`{"data":[{"id":"wh_old","network":"ROBINHOOD_TESTNET","webhook_type":"GRAPHQL","webhook_url":"https://api.example.com/v1/webhooks/alchemy"},
				{"id":"wh_keep","network":"ETH_MAINNET","webhook_type":"GRAPHQL","webhook_url":"https://api.example.com/v1/webhooks/alchemy"}]}`))
		case "/api/create-webhook":
			_ = json.NewDecoder(r.Body).Decode(&created)
			_, _ = w.Write([]byte(`{"data":{"id":"wh_new","signing_key":"whsec_new"}}`))
		case "/api/delete-webhook":
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer srv.Close()
	var out, errOut bytes.Buffer
	err := run(context.Background(), []string{"-deployment", writeManifest(t), "-api", "https://api.example.com", "-notify-url", srv.URL + "/api"},
		env(map[string]string{"ALCHEMY_AUTH_TOKEN": "tok"}), &out, &errOut, srv.Client())
	if err != nil {
		t.Fatal(err, errOut.String())
	}
	if strings.TrimSpace(out.String()) != "whsec_new" {
		t.Fatalf("stdout carries only the signing key: %q", out.String())
	}
	want := []string{"GET /api/team-webhooks", "POST /api/create-webhook", "DELETE /api/delete-webhook?webhook_id=wh_old"}
	if strings.Join(calls, "|") != strings.Join(want, "|") {
		t.Fatalf("calls %v", calls)
	}
	if created["network"] != "ROBINHOOD_TESTNET" || created["webhook_type"] != "GRAPHQL" {
		t.Fatalf("body %v", created)
	}
	if err := run(context.Background(), []string{"-deployment", writeManifest(t), "-api", "https://api.example.com"}, env(nil), &out, &errOut, nil); err == nil ||
		!strings.Contains(err.Error(), "ALCHEMY_AUTH_TOKEN") {
		t.Fatalf("the token is required: %v", err)
	}
}
