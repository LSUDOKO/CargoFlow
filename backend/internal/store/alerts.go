package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Subscription is a party's request to be alerted about a shipment's chain events.
type Subscription struct {
	ID         string
	ShipmentID string
	Address    string   // the subscriber's wallet
	Channel    string   // webhook, telegram or email
	Target     string   // URL, email address, or Telegram chat id (empty until linked)
	Secret     string   // webhook HMAC key
	Events     []string // PAUSED, RELEASED, ...
	Active     bool
	LinkCode   string // Telegram start code while unlinked
	CreatedAt  time.Time
}

const subscriptionColumns = `id::text, shipment_id, address, channel, target, secret, events, active, COALESCE(link_code, ''), created_at`

func scanSubscription(row pgx.Row) (Subscription, error) {
	var s Subscription
	err := row.Scan(&s.ID, &s.ShipmentID, &s.Address, &s.Channel, &s.Target, &s.Secret, &s.Events, &s.Active, &s.LinkCode, &s.CreatedAt)
	return s, mapErr(err)
}

func collectSubscriptions(rows pgx.Rows, err error) ([]Subscription, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CreateSubscription stores a subscription.
func (s *Store) CreateSubscription(ctx context.Context, sub Subscription) (Subscription, error) {
	return scanSubscription(s.pool.QueryRow(ctx, `
		INSERT INTO alert_subscriptions (shipment_id, address, channel, target, secret, events, active, link_code)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')) RETURNING `+subscriptionColumns,
		sub.ShipmentID, sub.Address, sub.Channel, sub.Target, sub.Secret, sub.Events, sub.Active, sub.LinkCode))
}

// GetSubscription returns a subscription or ErrNotFound.
func (s *Store) GetSubscription(ctx context.Context, id string) (Subscription, error) {
	return scanSubscription(s.pool.QueryRow(ctx, "SELECT "+subscriptionColumns+" FROM alert_subscriptions WHERE id = $1::uuid", id))
}

// SubscriptionsOf lists one address's subscriptions on a shipment, oldest first.
func (s *Store) SubscriptionsOf(ctx context.Context, shipmentID, address string) ([]Subscription, error) {
	return collectSubscriptions(s.pool.Query(ctx, "SELECT "+subscriptionColumns+
		" FROM alert_subscriptions WHERE shipment_id = $1 AND address = lower($2) ORDER BY created_at, id", shipmentID, address))
}

// SubscribersFor lists the active subscriptions on a shipment that want event.
func (s *Store) SubscribersFor(ctx context.Context, shipmentID, event string) ([]Subscription, error) {
	return collectSubscriptions(s.pool.Query(ctx, "SELECT "+subscriptionColumns+
		" FROM alert_subscriptions WHERE shipment_id = $1 AND active AND $2 = ANY(events) ORDER BY created_at, id", shipmentID, event))
}

// DeleteSubscription removes a subscription and its delivery records.
func (s *Store) DeleteSubscription(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, "DELETE FROM alert_subscriptions WHERE id = $1::uuid", id)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LinkTelegram activates the pending Telegram subscription holding code for chatID. The code is single-use.
func (s *Store) LinkTelegram(ctx context.Context, code, chatID string) (Subscription, error) {
	return scanSubscription(s.pool.QueryRow(ctx, `
		UPDATE alert_subscriptions SET target = $2, active = true, link_code = NULL
		WHERE link_code = $1 AND channel = 'telegram' RETURNING `+subscriptionColumns, code, chatID))
}

// BeginDelivery claims the delivery of one event to one subscription. It reports false when that delivery was
// already claimed, which is how a redelivered chain event avoids alerting twice.
func (s *Store) BeginDelivery(ctx context.Context, subscriptionID, eventKey string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `INSERT INTO alert_deliveries (subscription_id, event_key) VALUES ($1::uuid, $2)
		ON CONFLICT DO NOTHING`, subscriptionID, eventKey)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

// FinishDelivery records how a delivery ended: sent or failed, after how many attempts.
func (s *Store) FinishDelivery(ctx context.Context, subscriptionID, eventKey, status string, attempts int, errMsg string) error {
	_, err := s.pool.Exec(ctx, `UPDATE alert_deliveries SET status = $3, attempts = $4, error = NULLIF($5, ''), updated_at = now()
		WHERE subscription_id = $1::uuid AND event_key = $2`, subscriptionID, eventKey, status, attempts, errMsg)
	return mapErr(err)
}

// Delivery is the outcome of one alert to one subscription.
type Delivery struct {
	Status   string
	Attempts int
	Error    string
}

// DeliveryOf returns the delivery record of an event to a subscription.
func (s *Store) DeliveryOf(ctx context.Context, subscriptionID, eventKey string) (Delivery, error) {
	var d Delivery
	err := s.pool.QueryRow(ctx, `SELECT status, attempts, COALESCE(error, '') FROM alert_deliveries
		WHERE subscription_id = $1::uuid AND event_key = $2`, subscriptionID, eventKey).Scan(&d.Status, &d.Attempts, &d.Error)
	return d, mapErr(err)
}
