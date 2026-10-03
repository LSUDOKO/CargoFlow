package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CoverOffer is an insurer's open (unaccepted, not withdrawn) offer. Amounts are USDG base units.
type CoverOffer struct {
	Insurer    string    `json:"insurer"`
	Amount     string    `json:"amount"`
	PremiumBps int       `json:"premiumBps"`
	CreatedAt  time.Time `json:"createdAt"` // when the offer was indexed
}

// Cover is a facility's accepted default cover. Status is ACTIVE, RELEASED (settled: returned to the insurer)
// or CLAIMED (defaulted: the financier was paid up to its loss, the remainder returned to the insurer).
type Cover struct {
	Insurer         string `json:"insurer"`
	Financier       string `json:"financier"`
	Amount          string `json:"amount"`
	Premium         string `json:"premium"`
	Status          string `json:"status"`
	FinancierPayout string `json:"financierPayout"`
	InsurerReturn   string `json:"insurerReturn"`
}

// ShipmentCover is everything known about a shipment's default cover.
type ShipmentCover struct {
	Offers []CoverOffer `json:"offers"`
	Cover  *Cover       `json:"cover"`
}

// RebuildCover recomputes a shipment's offers and cover from its indexed CoverPool events, in chain order. It is
// idempotent and order-proof: redelivered or replayed events change nothing, and after a reorganisation the
// rewound events simply drop out of the next rebuild.
func (s *Store) RebuildCover(ctx context.Context, shipmentID string) error {
	rows, err := s.pool.Query(ctx, `
		SELECT event_name, args, tx_hash, created_at FROM chain_events
		WHERE shipment_id = $1 AND contract = 'CoverPool' ORDER BY block_number, log_index`, shipmentID)
	if err != nil {
		return err
	}
	type offer struct {
		amount     string
		premiumBps int
		status, tx string
		at         time.Time
	}
	offers := map[string]*offer{}
	var order []string
	var cover *Cover
	var loss, acceptedTx string
	var acceptedAt time.Time
	for rows.Next() {
		var name, tx string
		var args map[string]any
		var at time.Time
		if err := rows.Scan(&name, &args, &tx, &at); err != nil {
			rows.Close()
			return err
		}
		str := func(k string) string { v, _ := args[k].(string); return strings.ToLower(v) }
		switch name {
		case "CoverOffered":
			ins := str("insurer")
			if _, ok := offers[ins]; !ok {
				order = append(order, ins)
			}
			bps, _ := args["premiumBps"].(float64)
			offers[ins] = &offer{amount: str("amount"), premiumBps: int(bps), status: "OPEN", tx: tx, at: at}
		case "OfferWithdrawn":
			if o := offers[str("insurer")]; o != nil {
				o.status = "WITHDRAWN"
			}
		case "CoverAccepted":
			if o := offers[str("insurer")]; o != nil {
				o.status = "ACCEPTED"
			}
			cover = &Cover{Insurer: str("insurer"), Financier: str("financier"), Amount: str("amount"), Premium: str("premium"),
				Status: "ACTIVE", FinancierPayout: "0", InsurerReturn: "0"}
			loss, acceptedTx, acceptedAt = "0", tx, at
		case "CoverReleased":
			if cover != nil {
				cover.Status, cover.InsurerReturn = "RELEASED", str("amount")
			}
		case "CoverClaimed":
			if cover != nil {
				cover.Status, cover.FinancierPayout, cover.InsurerReturn = "CLAIMED", str("payout"), str("remainder")
				loss = str("loss")
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "DELETE FROM cover_offers WHERE shipment_id = $1", shipmentID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "DELETE FROM covers WHERE shipment_id = $1", shipmentID); err != nil {
		return err
	}
	for _, ins := range order {
		o := offers[ins]
		if _, err := tx.Exec(ctx, `INSERT INTO cover_offers (shipment_id, insurer, amount, premium_bps, status, tx_hash, created_at)
			VALUES ($1,$2,$3::numeric,$4,$5,$6,$7)`, shipmentID, ins, numOrZero(o.amount), o.premiumBps, o.status, o.tx, o.at); err != nil {
			return fmt.Errorf("store: cover offer: %w", mapErr(err))
		}
	}
	if cover != nil {
		if _, err := tx.Exec(ctx, `INSERT INTO covers (shipment_id, insurer, financier, amount, premium, status,
				financier_payout, insurer_return, loss, accepted_tx, accepted_at)
			VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6,$7::numeric,$8::numeric,$9::numeric,$10,$11)`,
			shipmentID, cover.Insurer, cover.Financier, numOrZero(cover.Amount), numOrZero(cover.Premium), cover.Status,
			numOrZero(cover.FinancierPayout), numOrZero(cover.InsurerReturn), numOrZero(loss), acceptedTx, acceptedAt); err != nil {
			return fmt.Errorf("store: cover: %w", mapErr(err))
		}
	}
	return mapErr(tx.Commit(ctx))
}

func numOrZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

// CoverOf returns a shipment's open offers (oldest first) and its accepted cover, nil when there is none.
func (s *Store) CoverOf(ctx context.Context, shipmentID string) (ShipmentCover, error) {
	out := ShipmentCover{Offers: []CoverOffer{}}
	rows, err := s.pool.Query(ctx, `SELECT insurer, amount::text, premium_bps, created_at FROM cover_offers
		WHERE shipment_id = $1 AND status = 'OPEN' ORDER BY created_at, insurer`, shipmentID)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var o CoverOffer
		if err := rows.Scan(&o.Insurer, &o.Amount, &o.PremiumBps, &o.CreatedAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Offers = append(out.Offers, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	var c Cover
	err = s.pool.QueryRow(ctx, `SELECT insurer, financier, amount::text, premium::text, status, financier_payout::text,
		insurer_return::text FROM covers WHERE shipment_id = $1`, shipmentID).
		Scan(&c.Insurer, &c.Financier, &c.Amount, &c.Premium, &c.Status, &c.FinancierPayout, &c.InsurerReturn)
	switch err = mapErr(err); {
	case err == nil:
		out.Cover = &c
	case !errors.Is(err, ErrNotFound):
		return out, err
	}
	return out, nil
}
