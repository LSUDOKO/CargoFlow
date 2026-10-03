// Command alchemy-webhook creates (or replaces) the Alchemy Custom Webhook that wakes CargoFlow's indexer.
//
// It reads the contract addresses from the deployment manifest, builds a GraphQL log filter over all of them and calls
// Alchemy's Notify API (https://www.alchemy.com/docs/data/webhooks/webhooks-api-endpoints/notify-api-endpoints/create-webhook):
//
//	POST https://dashboard.alchemy.com/api/create-webhook   X-Alchemy-Token: $ALCHEMY_AUTH_TOKEN
//	{"network":"ROBINHOOD_TESTNET","webhook_type":"GRAPHQL","webhook_url":"<api>/v1/webhooks/alchemy","name":"...",
//	 "graphql_query":{"query":"{ block { number hash logs(filter: {addresses: [...], topics: []}) { ... } } }","skip_empty_messages":true}}
//
// Custom Webhooks cannot change their query, so when a webhook for the same URL and network exists the command creates
// the new one first and then deletes the old one (GET /api/team-webhooks, DELETE /api/delete-webhook?webhook_id=).
// The new signing key is printed once on stdout; add it to ALCHEMY_WEBHOOK_SIGNING_KEYS (comma-separated, so the old
// and new keys can overlap during the switch).
//
//	ALCHEMY_AUTH_TOKEN=... go run ./cmd/alchemy-webhook -deployment ../contracts/deployments/46630.json -api https://api.example.com
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

// DefaultNotifyURL is the Notify API root.
const DefaultNotifyURL = "https://dashboard.alchemy.com/api"

// networks maps chain ids to Alchemy's network enum (from the create-webhook reference).
var networks = map[uint64]string{46630: "ROBINHOOD_TESTNET", 421614: "ARB_SEPOLIA", 11155111: "ETH_SEPOLIA"}

func main() {
	if err := run(context.Background(), os.Args[1:], os.Getenv, os.Stdout, os.Stderr, http.DefaultClient); err != nil {
		fmt.Fprintln(os.Stderr, "alchemy-webhook:", err)
		os.Exit(1)
	}
}

type options struct {
	deployment, api, network, name, notifyURL string
	dryRun                                    bool
}

func run(ctx context.Context, args []string, getenv func(string) string, out, errOut io.Writer, hc *http.Client) error {
	fs := flag.NewFlagSet("alchemy-webhook", flag.ContinueOnError)
	fs.SetOutput(errOut)
	var o options
	fs.StringVar(&o.deployment, "deployment", getenv("DEPLOYMENT_FILE"), "deployment manifest (default $DEPLOYMENT_FILE)")
	fs.StringVar(&o.api, "api", getenv("API_URL"), "public base URL of the CargoFlow API (default $API_URL), e.g. https://api.example.com")
	fs.StringVar(&o.network, "network", "", "Alchemy network enum (default: from the manifest's chain id; 46630 is ROBINHOOD_TESTNET)")
	fs.StringVar(&o.name, "name", "CargoFlow indexer wake-up", "webhook name")
	fs.StringVar(&o.notifyURL, "notify-url", DefaultNotifyURL, "Notify API root")
	fs.BoolVar(&o.dryRun, "dry-run", false, "print the request instead of sending it")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if o.deployment == "" || o.api == "" {
		return errors.New("-deployment and -api are required")
	}
	m, err := chain.LoadManifest(o.deployment)
	if err != nil {
		return err
	}
	if o.network == "" {
		var ok bool
		if o.network, ok = networks[m.ChainID]; !ok {
			return fmt.Errorf("no Alchemy network known for chain %d; pass -network", m.ChainID)
		}
	}
	hookURL := strings.TrimRight(o.api, "/") + "/v1/webhooks/alchemy"
	if !strings.HasPrefix(hookURL, "https://") && !o.dryRun {
		return fmt.Errorf("the webhook URL must be https, got %s", hookURL)
	}
	body := map[string]any{
		"network": o.network, "webhook_type": "GRAPHQL", "webhook_url": hookURL, "name": o.name,
		"graphql_query": map[string]any{"query": Query(m), "skip_empty_messages": true},
	}
	raw, _ := json.MarshalIndent(body, "", "  ")
	if o.dryRun {
		fmt.Fprintf(out, "POST %s/create-webhook\nX-Alchemy-Token: <ALCHEMY_AUTH_TOKEN>\nContent-Type: application/json\n\n%s\n", o.notifyURL, raw)
		return nil
	}
	token := strings.TrimSpace(getenv("ALCHEMY_AUTH_TOKEN"))
	if token == "" {
		return errors.New("ALCHEMY_AUTH_TOKEN is required (Alchemy dashboard, Webhooks, Auth Token)")
	}
	n := notify{base: strings.TrimRight(o.notifyURL, "/"), token: token, hc: hc}
	existing, err := n.list(ctx)
	if err != nil {
		return err
	}
	var created struct {
		Data struct {
			ID         string `json:"id"`
			SigningKey string `json:"signing_key"`
		} `json:"data"`
	}
	if err := n.call(ctx, http.MethodPost, "/create-webhook", raw, &created); err != nil {
		return err
	}
	if created.Data.ID == "" || created.Data.SigningKey == "" {
		return errors.New("Alchemy answered without a webhook id or signing key")
	}
	fmt.Fprintf(errOut, "created webhook %s -> %s (%s)\n", created.Data.ID, hookURL, o.network)
	for _, w := range existing {
		if w.ID != created.Data.ID && w.WebhookURL == hookURL && w.Network == o.network && w.WebhookType == "GRAPHQL" {
			if err := n.call(ctx, http.MethodDelete, "/delete-webhook?webhook_id="+w.ID, nil, nil); err != nil {
				fmt.Fprintf(errOut, "warning: could not delete the old webhook %s: %v\n", w.ID, err)
				continue
			}
			fmt.Fprintf(errOut, "deleted the previous webhook %s\n", w.ID)
		}
	}
	fmt.Fprintln(errOut, "signing key (store it in ALCHEMY_WEBHOOK_SIGNING_KEYS; it is not shown again):")
	fmt.Fprintln(out, created.Data.SigningKey)
	return nil
}

// Query is the GraphQL log filter over every contract the indexer follows. The indexer re-reads logs over RPC, so the
// payload only needs the block number, the emitting address and the transaction.
func Query(m chain.Manifest) string {
	var addrs []string
	for a := range m.Indexed() {
		addrs = append(addrs, fmt.Sprintf("%q", strings.ToLower(a.Hex())))
	}
	sort.Strings(addrs)
	return "{ block { number hash logs(filter: {addresses: [" + strings.Join(addrs, ", ") +
		"], topics: []}) { account { address } topics index transaction { hash } } } }"
}

type notify struct {
	base, token string
	hc          *http.Client
}

type webhook struct {
	ID          string `json:"id"`
	Network     string `json:"network"`
	WebhookType string `json:"webhook_type"`
	WebhookURL  string `json:"webhook_url"`
}

func (n notify) list(ctx context.Context) ([]webhook, error) {
	var out struct {
		Data []webhook `json:"data"`
	}
	if err := n.call(ctx, http.MethodGet, "/team-webhooks", nil, &out); err != nil {
		return nil, err
	}
	return out.Data, nil
}

func (n notify) call(ctx context.Context, method, path string, body []byte, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, n.base+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("X-Alchemy-Token", n.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := n.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s %s: status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}
