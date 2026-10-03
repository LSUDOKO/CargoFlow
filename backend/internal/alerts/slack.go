package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// SlackHost is the only host a Slack incoming webhook may point at.
const SlackHost = "hooks.slack.com"

// CheckSlackURL validates a Slack incoming-webhook URL: https://hooks.slack.com/services/..., nothing else, so the
// channel cannot be used to reach any other host.
func CheckSlackURL(raw string) error {
	if len(raw) > 500 {
		return errors.New("the Slack webhook URL is longer than 500 characters")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != SlackHost || u.User != nil || !strings.HasPrefix(u.Path, "/services/") || len(u.Path) <= len("/services/") {
		return errors.New("a Slack target is an incoming webhook URL: https://hooks.slack.com/services/...")
	}
	return nil
}

// Slack posts alerts to Slack incoming webhooks as {"text": ...}. It shares the webhook client's guards: a timeout,
// no proxy, no redirects, and (outside a development chain) no internal addresses.
type Slack struct {
	Client *http.Client
	// Base, when set, replaces https://hooks.slack.com in target URLs (tests only).
	Base string
}

// NewSlack builds the sender on a hardened webhook client.
func NewSlack(allowPrivate bool) *Slack { return &Slack{Client: NewWebhook(allowPrivate).Client} }

// Send posts one alert.
func (s *Slack) Send(ctx context.Context, sub store.Subscription, a Alert) error {
	if err := CheckSlackURL(sub.Target); err != nil {
		return err
	}
	target := sub.Target
	if s.Base != "" {
		target = strings.TrimRight(s.Base, "/") + strings.TrimPrefix(target, "https://"+SlackHost)
	}
	text := Text(a)
	if a.Link != "" {
		text = strings.Replace(text, "\nOpen: "+a.Link, "\n<"+a.Link+"|Open in CargoFlow>", 1)
	}
	body, err := json.Marshal(map[string]any{"text": text, "unfurl_links": false})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CargoFlow-Alerts/1")
	resp, err := s.Client.Do(req)
	if err != nil {
		if errors.Is(err, ErrBlockedTarget) {
			return ErrBlockedTarget
		}
		return fmt.Errorf("slack: %s", redactSlack(err.Error()))
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("slack answered %d", resp.StatusCode)
	}
	return nil
}

// redactSlack removes webhook secrets (the path) from an error message.
func redactSlack(msg string) string {
	if i := strings.Index(msg, "/services/"); i >= 0 {
		end := strings.IndexAny(msg[i:], " \"")
		if end < 0 {
			return msg[:i] + "/services/…"
		}
		return msg[:i] + "/services/…" + msg[i+end:]
	}
	return msg
}
