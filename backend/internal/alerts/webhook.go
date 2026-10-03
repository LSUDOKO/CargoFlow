package alerts

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// WebhookTimeout bounds one webhook attempt, connection included.
const WebhookTimeout = 5 * time.Second

// ErrBlockedTarget means a webhook resolved to an address the backend refuses to call.
var ErrBlockedTarget = errors.New("alerts: the webhook target is a private, loopback or otherwise internal address")

// Webhook posts alerts as JSON signed with the subscription's secret: X-CargoFlow-Signature is
// hex(hmac_sha256(secret, body)).
type Webhook struct {
	Client *http.Client
}

// NewWebhook builds a webhook sender. Unless allowPrivate (a local development chain) it refuses, at connection
// time, every private, loopback, link-local and other internal address, whatever the URL's host name resolves to,
// so a webhook cannot be used to probe the backend's own network. It uses no proxy and follows no redirect.
func NewWebhook(allowPrivate bool) *Webhook {
	dialer := &net.Dialer{Timeout: WebhookTimeout}
	if !allowPrivate {
		dialer.Control = func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return ErrBlockedTarget
			}
			ip, err := netip.ParseAddr(host)
			if err != nil || internal(ip) {
				return ErrBlockedTarget
			}
			return nil
		}
	}
	return &Webhook{Client: &http.Client{
		Timeout:       WebhookTimeout,
		Transport:     &http.Transport{DialContext: dialer.DialContext, Proxy: nil, MaxIdleConns: 16, IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: WebhookTimeout},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Sign returns the X-CargoFlow-Signature value for body.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// Send posts one alert. Any status other than 2xx is a failure.
func (w *Webhook) Send(ctx context.Context, sub store.Subscription, a Alert) error {
	body, err := json.Marshal(a)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CargoFlow-Alerts/1")
	req.Header.Set("X-CargoFlow-Event", a.Event)
	req.Header.Set("X-CargoFlow-Signature", Sign(sub.Secret, body))
	resp, err := w.Client.Do(req)
	if err != nil {
		if errors.Is(err, ErrBlockedTarget) {
			return ErrBlockedTarget
		}
		return fmt.Errorf("webhook: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("webhook answered %d", resp.StatusCode)
	}
	return nil
}

// Address ranges that are not private by net/netip's definition but are still internal or special purpose.
var specialRanges = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), // carrier-grade NAT
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), // benchmarking
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"), // NAT64 can reach IPv4 internals
	netip.MustParsePrefix("2001:db8::/32"),
}

// internal reports whether ip must never be the target of an outbound webhook.
func internal(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
		return true
	}
	for _, p := range specialRanges {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// CheckWebhookURL validates a webhook target when it is registered: an absolute https URL with a host and no
// credentials, at most 500 characters, and not an internal IP literal. On a development chain (allowPrivate) plain
// http and local addresses are allowed. Host names are checked again at every connection.
func CheckWebhookURL(raw string, allowPrivate bool) error {
	if len(raw) > 500 {
		return errors.New("the webhook URL is longer than 500 characters")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Hostname() == "" {
		return errors.New("the webhook must be an absolute URL")
	}
	if u.Scheme != "https" && !(allowPrivate && u.Scheme == "http") {
		return errors.New("the webhook must use https")
	}
	if u.User != nil {
		return errors.New("the webhook URL must not carry credentials")
	}
	if allowPrivate {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".local") {
		return ErrBlockedTarget
	}
	if ip, err := netip.ParseAddr(host); err == nil && internal(ip) {
		return ErrBlockedTarget
	}
	return nil
}
