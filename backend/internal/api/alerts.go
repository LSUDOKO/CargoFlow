package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// AlertChannels says which alert channels can deliver.
type AlertChannels struct {
	TelegramBot          string // the bot's username, from getMe; empty when Telegram is not configured
	Email                bool   // Resend is configured
	AllowPrivateWebhooks bool   // a local development chain: webhooks may be plain http and target local addresses
}

// maxSubscriptionsPerParty bounds one address's subscriptions on one shipment.
const maxSubscriptionsPerParty = 10

var emailPattern = regexp.MustCompile(`^[^@\s"<>,;]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$`)

var errChannelUnavailable = &Error{http.StatusServiceUnavailable, "channel_unavailable", "this alert channel is not configured on this backend"}

type subscriptionRequest struct {
	Channel   string   `json:"channel"`
	Target    string   `json:"target"`
	Events    []string `json:"events"`
	IssuedAt  int64    `json:"issuedAt"`
	Signature string   `json:"signature"`
}

type subscriptionDTO struct {
	ID           string   `json:"id"`
	Channel      string   `json:"channel"`
	TargetMasked string   `json:"targetMasked"`
	Events       []string `json:"events"`
	Active       bool     `json:"active"`
}

// maskTarget shows enough of a target to recognise it without revealing it: a webhook's origin, an email's first
// letter and domain, a Telegram chat's last digits.
func maskTarget(sub store.Subscription) string {
	switch sub.Channel {
	case "webhook":
		u, err := url.Parse(sub.Target)
		if err != nil {
			return "webhook"
		}
		out := u.Scheme + "://" + u.Host
		if (u.Path != "" && u.Path != "/") || u.RawQuery != "" {
			out += "/…"
		}
		return out
	case "email":
		local, domain, _ := strings.Cut(sub.Target, "@")
		if local == "" {
			return "***@" + domain
		}
		return local[:1] + "***@" + domain
	case "telegram":
		if sub.Target == "" {
			return "Telegram: press Start in the bot to link"
		}
		return "Telegram chat ••" + sub.Target[max(0, len(sub.Target)-4):]
	}
	return ""
}

// canonicalEvents validates the requested events and returns them once each, in the canonical order.
func canonicalEvents(in []string) ([]string, error) {
	if len(in) == 0 {
		return nil, ErrBadRequest("events lists at least one of " + strings.Join(alerts.Events, ", "))
	}
	for _, e := range in {
		if !slices.Contains(alerts.Events, e) {
			return nil, ErrBadRequest(fmt.Sprintf("unknown event %q; use %s", e, strings.Join(alerts.Events, ", ")))
		}
	}
	var out []string
	for _, e := range alerts.Events {
		if slices.Contains(in, e) {
			out = append(out, e)
		}
	}
	return out, nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// subscribe lets a shipment party ask for alerts on a channel. A webhook gets a signing secret, shown only now; a
// Telegram subscription gets a bot link and activates when the subscriber presses Start.
func (s *Server) subscribe(w http.ResponseWriter, r *http.Request) error {
	var req subscriptionRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	events, err := canonicalEvents(req.Events)
	if err != nil {
		return err
	}
	switch req.Channel {
	case "webhook":
		if err := alerts.CheckWebhookURL(req.Target, s.c.Alerts.AllowPrivateWebhooks); err != nil {
			return ErrBadRequest(strings.TrimPrefix(err.Error(), "alerts: "))
		}
	case "email":
		if !s.c.Alerts.Email {
			return errChannelUnavailable
		}
		if len(req.Target) > 254 || !emailPattern.MatchString(req.Target) {
			return ErrBadRequest("target must be an email address")
		}
	case "telegram":
		if s.c.Alerts.TelegramBot == "" {
			return errChannelUnavailable
		}
		if req.Target != "" {
			return ErrBadRequest("a Telegram target is empty: the chat is linked when you press Start in the bot")
		}
	default:
		return ErrBadRequest("channel is webhook, telegram or email")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	allowed := parties(sh)
	// an insurer with an open offer or the accepted cover follows the shipment too
	if cv, err := s.c.Store.CoverOf(r.Context(), sh.ID); err == nil {
		for _, o := range cv.Offers {
			allowed = append(allowed, o.Insurer)
		}
		if cv.Cover != nil {
			allowed = append(allowed, cv.Cover.Insurer)
		}
	}
	signer, err := s.walletSigner(r.Context(), auth.AlertsAuthorization(sh.ID, req.Channel, req.Target, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the shipment's exporter, financier, buyer or insurer can subscribe to its alerts", allowed...)
	if err != nil {
		return err
	}
	existing, err := s.c.Store.SubscriptionsOf(r.Context(), sh.ID, signer)
	if err != nil {
		return err
	}
	if len(existing) >= maxSubscriptionsPerParty {
		return ErrConflictMsg(fmt.Sprintf("an address can have at most %d alert subscriptions per shipment", maxSubscriptionsPerParty))
	}
	sub := store.Subscription{ShipmentID: sh.ID, Address: signer, Channel: req.Channel, Target: req.Target, Events: events, Active: true}
	switch req.Channel {
	case "webhook":
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		sub.Secret = hex.EncodeToString(b)
	case "telegram":
		sub.Active, sub.LinkCode = false, randomToken(18)
	}
	created, err := s.c.Store.CreateSubscription(r.Context(), sub)
	if err != nil {
		return err
	}
	out := map[string]any{"id": created.ID, "channel": created.Channel, "targetMasked": maskTarget(created), "events": created.Events,
		"createdAt": created.CreatedAt.UTC().Format(time.RFC3339)}
	switch created.Channel {
	case "webhook":
		out["secret"] = created.Secret
	case "telegram":
		out["linkUrl"] = "https://t.me/" + s.c.Alerts.TelegramBot + "?start=" + created.LinkCode
	}
	writeJSON(w, http.StatusCreated, out)
	return nil
}

// listSubscriptions returns one address's subscriptions on a shipment, with masked targets.
func (s *Server) listSubscriptions(w http.ResponseWriter, r *http.Request) error {
	address := strings.TrimSpace(r.URL.Query().Get("address"))
	if !addressPattern.MatchString(address) {
		return ErrBadRequest("address must be a 0x address")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	subs, err := s.c.Store.SubscriptionsOf(r.Context(), sh.ID, address)
	if err != nil {
		return err
	}
	out := make([]subscriptionDTO, len(subs))
	for i, sub := range subs {
		out[i] = subscriptionDTO{ID: sub.ID, Channel: sub.Channel, TargetMasked: maskTarget(sub), Events: sub.Events, Active: sub.Active}
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": out})
	return nil
}

// unsubscribe deletes a subscription; only its subscriber can.
func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	var req signedBody
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	sid := strings.ToLower(strings.TrimSpace(r.PathValue("sid")))
	if !uuidPattern.MatchString(sid) {
		return ErrNotFoundMsg("no such subscription")
	}
	sub, err := s.c.Store.GetSubscription(r.Context(), sid)
	if errors.Is(err, store.ErrNotFound) || (err == nil && sub.ShipmentID != sh.ID) {
		return ErrNotFoundMsg("no such subscription")
	}
	if err != nil {
		return err
	}
	if _, err := s.walletSigner(r.Context(), auth.AlertsOffAuthorization(sub.ID, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the subscriber can remove this subscription", sub.Address); err != nil {
		return err
	}
	if err := s.c.Store.DeleteSubscription(r.Context(), sub.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return ErrNotFoundMsg("no such subscription")
		}
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": sub.ID, "deleted": true})
	return nil
}
