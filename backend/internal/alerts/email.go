package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// DefaultResendBaseURL is Resend's HTTP API.
const DefaultResendBaseURL = "https://api.resend.com"

// Email sends alerts through Resend.
type Email struct {
	key  config.Secret
	from string
	base string
	http *http.Client
}

// NewEmail builds the sender. An empty baseURL selects Resend's public API.
func NewEmail(key config.Secret, from, baseURL string) *Email {
	if baseURL == "" {
		baseURL = DefaultResendBaseURL
	}
	return &Email{key: key, from: from, base: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 10 * time.Second}}
}

// Send emails one alert to the subscription's address.
func (e *Email) Send(ctx context.Context, sub store.Subscription, a Alert) error {
	body, err := json.Marshal(map[string]any{"from": e.from, "to": []string{sub.Target}, "subject": Subject(a), "text": Text(a)})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.base+"/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+e.key.Reveal())
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.http.Do(req)
	if err != nil {
		msg := err.Error()
		if k := e.key.Reveal(); k != "" {
			msg = strings.ReplaceAll(msg, k, "[redacted]")
		}
		return fmt.Errorf("resend: %s", msg)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("resend answered %d: %s", resp.StatusCode, oneLine(string(raw), 200))
	}
	return nil
}
