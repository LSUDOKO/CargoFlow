package store

import (
	"context"
	"strings"
	"time"
)

// Notification is one in-app notice for one wallet.
type Notification struct {
	ID         string         `json:"id"`
	Address    string         `json:"address"`
	ShipmentID string         `json:"shipmentId"`
	Kind       string         `json:"kind" doc:"PAUSED, RELEASED, RESUMED, HELD, RECOVERY_READY, DISPUTED, DELIVERED, SETTLED, DEFAULTED, COVER_OFFERED, COVER_ACCEPTED, COVER_RELEASED, COVER_CLAIMED, OFFER_RECEIVED, OFFER_ACCEPTED"`
	Title      string         `json:"title"`
	Body       string         `json:"body"`
	Link       string         `json:"link" doc:"where to act, e.g. https://app/track/<id>?recover=1"`
	Data       map[string]any `json:"data"`
	DedupeKey  string         `json:"-"`
	ReadAt     *time.Time     `json:"readAt"`
	CreatedAt  time.Time      `json:"createdAt"`
}

// AddNotification stores n once for each address (lowercased, duplicates and empties skipped). A notification with
// the same dedupe key already stored for an address is left alone, so redelivered events never notify twice. It
// returns how many were created.
func (s *Store) AddNotification(ctx context.Context, n Notification, addresses ...string) (int, error) {
	if n.Data == nil {
		n.Data = map[string]any{}
	}
	seen := map[string]bool{}
	created := 0
	for _, a := range addresses {
		a = strings.ToLower(strings.TrimSpace(a))
		if a == "" || seen[a] || a == "0x0000000000000000000000000000000000000000" {
			continue
		}
		seen[a] = true
		tag, err := s.pool.Exec(ctx, `
			INSERT INTO notifications (address, shipment_id, kind, title, body, link, data, dedupe_key)
			VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8) ON CONFLICT (address, dedupe_key) DO NOTHING`,
			a, n.ShipmentID, n.Kind, truncate(n.Title, 200), truncate(n.Body, 1000), truncate(n.Link, 500), n.Data, n.DedupeKey)
		if err != nil {
			return created, mapErr(err)
		}
		created += int(tag.RowsAffected())
	}
	return created, nil
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}

// Notifications lists an address's notifications, newest first, and counts its unread ones.
func (s *Store) Notifications(ctx context.Context, address string, limit int, unreadOnly bool) ([]Notification, int, error) {
	address = strings.ToLower(address)
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, address, coalesce(shipment_id, ''), kind, title, body, link, data, read_at, created_at
		FROM notifications WHERE address = $1 AND (NOT $3 OR read_at IS NULL)
		ORDER BY created_at DESC, id LIMIT $2`, address, limit, unreadOnly)
	if err != nil {
		return nil, 0, mapErr(err)
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.Address, &n.ShipmentID, &n.Kind, &n.Title, &n.Body, &n.Link, &n.Data, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var unread int
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE address = $1 AND read_at IS NULL`, address).Scan(&unread)
	return out, unread, mapErr(err)
}

// MarkNotificationsRead marks an address's notifications read: those in ids, or all of them when ids is empty. It
// returns how many changed.
func (s *Store) MarkNotificationsRead(ctx context.Context, address string, ids []string, at time.Time) (int, error) {
	address = strings.ToLower(address)
	var n int64
	if len(ids) == 0 {
		tag, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at = $2 WHERE address = $1 AND read_at IS NULL`, address, at)
		if err != nil {
			return 0, mapErr(err)
		}
		n = tag.RowsAffected()
	} else {
		tag, err := s.pool.Exec(ctx, `UPDATE notifications SET read_at = $2 WHERE address = $1 AND read_at IS NULL AND id::text = ANY($3)`, address, at, ids)
		if err != nil {
			return 0, mapErr(err)
		}
		n = tag.RowsAffected()
	}
	return int(n), nil
}

// SubscribersForAny lists the active subscriptions on a shipment that want any of events, optionally only address's.
func (s *Store) SubscribersForAny(ctx context.Context, shipmentID string, events []string, address string) ([]Subscription, error) {
	return collectSubscriptions(s.pool.Query(ctx, "SELECT "+subscriptionColumns+
		" FROM alert_subscriptions WHERE shipment_id = $1 AND active AND events && $2 AND ($3 = '' OR address = lower($3)) ORDER BY created_at, id",
		shipmentID, events, address))
}
