package chain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

// DefaultFailoverCooldown is how long an endpoint that failed is skipped before it is tried again.
const DefaultFailoverCooldown = 30 * time.Second

// Failover is an HTTP transport for JSON-RPC that sends each request to the primary endpoint and, when the primary
// cannot be reached or answers with a server error (5xx) or a rate limit (429), to each fallback in turn. A failed endpoint is
// marked unhealthy for Cooldown and skipped meanwhile; after the cooldown the primary is tried first again, so traffic
// returns to it on its own once it recovers. JSON-RPC errors (reverts, bad params) arrive as HTTP 200 and are never a
// reason to fail over.
//
// Retrying a request on the fallback can send a signed transaction twice; that is harmless (the second copy has the
// same hash and is refused as already known, and the sender waits for the receipt by hash).
type Failover struct {
	endpoints []*url.URL // primary first
	base      http.RoundTripper
	Cooldown  time.Duration
	Now       func() time.Time
	Log       *slog.Logger

	mu        sync.Mutex
	downUntil []time.Time
	last      int // the endpoint that served the latest request
}

// NewFailover builds the transport: the primary first, then each fallback in order (empty ones are skipped).
func NewFailover(primary string, fallbacks ...string) (*Failover, error) {
	if primary == "" {
		return nil, errors.New("chain: an RPC URL is required")
	}
	var eps []*url.URL
	for _, raw := range append([]string{primary}, fallbacks...) {
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("chain: RPC failover needs http(s) URLs, got %q", Redact(raw))
		}
		eps = append(eps, u)
	}
	return &Failover{
		endpoints: eps, base: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConnsPerHost: 16, IdleConnTimeout: 90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 30 * time.Second},
		Cooldown: DefaultFailoverCooldown, Now: time.Now, Log: slog.Default(), downUntil: make([]time.Time, len(eps)),
	}, nil
}

// Active names the endpoint that served the latest request: "primary", "fallback", or "fallback-<n>" for the n-th
// fallback beyond the first.
func (f *Failover) Active() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return endpointName(f.last)
}

// order lists the endpoints to try: healthy ones first, in configured order, then the unhealthy ones (so a request is
// still attempted when every endpoint is marked down).
func (f *Failover) order() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.Now()
	var healthy, down []int
	for i := range f.endpoints {
		if now.Before(f.downUntil[i]) {
			down = append(down, i)
		} else {
			healthy = append(healthy, i)
		}
	}
	return append(healthy, down...)
}

func (f *Failover) mark(i int, ok bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ok {
		f.downUntil[i] = time.Time{}
		if f.last != i && f.Log != nil {
			f.Log.Info("RPC endpoint now serving", "endpoint", endpointName(i))
		}
		f.last = i
		return
	}
	if f.Log != nil && !f.Now().Before(f.downUntil[i]) {
		f.Log.Warn("RPC endpoint unhealthy; failing over", "endpoint", endpointName(i), "cooldown", f.Cooldown.String())
	}
	f.downUntil[i] = f.Now().Add(f.Cooldown)
}

func endpointName(i int) string {
	switch i {
	case 0:
		return "primary"
	case 1:
		return "fallback"
	default:
		return fmt.Sprintf("fallback-%d", i)
	}
}

// RoundTrip implements http.RoundTripper. The request URL's scheme, host, path and query are replaced by the chosen
// endpoint's, so the endpoint's credentials (a token in the path, as QuickNode uses) never need to be in the client.
func (f *Failover) RoundTrip(req *http.Request) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		b, err := io.ReadAll(req.Body)
		_ = req.Body.Close()
		if err != nil {
			return nil, err
		}
		body = b
	}
	var lastErr error
	var lastResp *http.Response
	for n, i := range f.order() {
		if err := req.Context().Err(); err != nil {
			return nil, err
		}
		out := req.Clone(req.Context())
		ep := f.endpoints[i]
		out.URL = &url.URL{Scheme: ep.Scheme, Host: ep.Host, Path: ep.Path, RawPath: ep.RawPath, RawQuery: ep.RawQuery, User: ep.User}
		out.Host = ep.Host
		out.Body = io.NopCloser(bytes.NewReader(body))
		out.ContentLength = int64(len(body))
		out.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
		resp, err := f.base.RoundTrip(out)
		retryable := err != nil || resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests
		if !retryable {
			f.mark(i, true)
			return resp, nil
		}
		f.mark(i, false)
		if lastResp != nil {
			_ = lastResp.Body.Close()
		}
		lastErr, lastResp = err, resp
		if err != nil {
			lastErr = errors.New(Redact(err.Error()))
		}
		if n == len(f.endpoints)-1 {
			break
		}
		if resp != nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		}
	}
	if lastResp != nil {
		return lastResp, nil
	}
	return nil, lastErr
}

// Redact hides what an RPC URL may carry as a credential (user info, path, query), keeping the scheme and host.
func Redact(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		if i := strings.Index(raw, "://"); i >= 0 {
			rest := raw[i+3:]
			if j := strings.IndexAny(rest, "/?"); j >= 0 {
				return raw[:i+3] + rest[:j] + "/…"
			}
			return raw
		}
		return "[redacted]"
	}
	out := u.Scheme + "://" + u.Host
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		out += "/…"
	}
	return out
}

// chainIDAt asks one endpoint for its chain id over plain HTTP.
func chainIDAt(ctx context.Context, base http.RoundTripper, raw string) (uint64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, raw, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Transport: base, Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return 0, errors.New(Redact(err.Error()))
	}
	defer resp.Body.Close()
	var out struct {
		Result hexutil.Big `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return 0, fmt.Errorf("status %d, not a JSON-RPC answer", resp.StatusCode)
	}
	if out.Error != nil {
		return 0, errors.New(out.Error.Message)
	}
	return (*big.Int)(&out.Result).Uint64(), nil
}

// DialFailover connects through a primary and optional fallback endpoints, tried in order. Each configured endpoint
// must report the manifest's chain; a fallback may be unreachable at startup (it is only needed when the endpoints
// before it fail), but it may never be a different chain.
func DialFailover(ctx context.Context, primary string, fallbacks []string, m Manifest) (*Client, error) {
	var fbs []string
	for _, f := range fallbacks {
		if f != "" {
			fbs = append(fbs, f)
		}
	}
	if len(fbs) == 0 {
		return Dial(ctx, primary, m)
	}
	fo, err := NewFailover(primary, fbs...)
	if err != nil {
		return nil, err
	}
	for i, raw := range append([]string{primary}, fbs...) {
		id, err := chainIDAt(ctx, fo.base, raw)
		if err != nil {
			if i == 0 {
				return nil, fmt.Errorf("chain: read chain id from the primary RPC %s: %w", Redact(raw), err)
			}
			if fo.Log != nil {
				fo.Log.Warn("fallback RPC is unreachable at startup", "rpc", Redact(raw), "err", err)
			}
			continue
		}
		if id != m.ChainID {
			return nil, fmt.Errorf("chain: the %s RPC %s is chain %d but the manifest is for chain %d", endpointName(i), Redact(raw), id, m.ChainID)
		}
	}
	rc, err := rpc.DialOptions(ctx, primary, rpc.WithHTTPClient(&http.Client{Transport: fo}))
	if err != nil {
		return nil, fmt.Errorf("chain: dial %s: %w", Redact(primary), err)
	}
	return &Client{Eth: ethclient.NewClient(rc), M: m, failover: fo}, nil
}

// ActiveRPC names the endpoint serving requests: "primary", or "fallback" / "fallback-<n>" while failed over.
func (c *Client) ActiveRPC() string {
	if c == nil || c.failover == nil {
		return "primary"
	}
	return c.failover.Active()
}
