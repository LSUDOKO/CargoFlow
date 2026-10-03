package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Financing request states.
const (
	RequestOpen     = "open"
	RequestAccepted = "accepted"
	RequestFunded   = "funded"
	RequestClosed   = "closed"
)

// FinancingRequest is an exporter's request for capital against a shipment. Amount is USDG base units.
type FinancingRequest struct {
	ID             string
	ShipmentID     string
	Exporter       string
	Amount         string
	MaxFeeBps      int
	MilestoneCount int
	Note           string
	Status         string
	Offers         []Offer
	CreatedAt      time.Time
}

// Offer is a financier's fee for a request.
type Offer struct {
	ID        string
	RequestID string
	Financier string
	FeeBps    int
	Accepted  bool
	CreatedAt time.Time
}

const requestColumns = `id::text, shipment_id, exporter, amount::text, max_fee_bps, milestone_count, note, status, created_at`

func scanRequest(row pgx.Row) (FinancingRequest, error) {
	var r FinancingRequest
	err := row.Scan(&r.ID, &r.ShipmentID, &r.Exporter, &r.Amount, &r.MaxFeeBps, &r.MilestoneCount, &r.Note, &r.Status, &r.CreatedAt)
	return r, mapErr(err)
}

// CreateRequest stores an open request. A shipment with a live (open or accepted) request is an ErrConflict.
func (s *Store) CreateRequest(ctx context.Context, r FinancingRequest) (FinancingRequest, error) {
	out, err := scanRequest(s.pool.QueryRow(ctx, `
		INSERT INTO financing_requests (shipment_id, exporter, amount, max_fee_bps, milestone_count, note)
		VALUES ($1, $2, $3::numeric, $4, $5, $6) RETURNING `+requestColumns,
		r.ShipmentID, r.Exporter, r.Amount, r.MaxFeeBps, r.MilestoneCount, r.Note))
	if err != nil {
		return FinancingRequest{}, err
	}
	out.Offers = []Offer{}
	return out, nil
}

// GetRequest returns a request with its offers, or ErrNotFound.
func (s *Store) GetRequest(ctx context.Context, id string) (FinancingRequest, error) {
	r, err := scanRequest(s.pool.QueryRow(ctx, "SELECT "+requestColumns+" FROM financing_requests WHERE id = $1::uuid", id))
	if err != nil {
		return r, err
	}
	list := []FinancingRequest{r}
	if err := s.attachOffers(ctx, list); err != nil {
		return r, err
	}
	return list[0], nil
}

// ListRequests returns requests newest first, filtered by status and exporter when those are not empty.
func (s *Store) ListRequests(ctx context.Context, status, exporter string, limit int) ([]FinancingRequest, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+requestColumns+` FROM financing_requests
		WHERE ($1 = '' OR status = $1) AND ($2 = '' OR exporter = lower($2))
		ORDER BY created_at DESC, id DESC LIMIT $3`, status, exporter, limit)
	if err != nil {
		return nil, err
	}
	var out []FinancingRequest
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, s.attachOffers(ctx, out)
}

// attachOffers loads the offers of every request in list, cheapest first.
func (s *Store) attachOffers(ctx context.Context, list []FinancingRequest) error {
	ids := make([]string, len(list))
	index := map[string]int{}
	for i := range list {
		ids[i], index[list[i].ID] = list[i].ID, i
		list[i].Offers = []Offer{}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id::text, request_id::text, financier, fee_bps, accepted, created_at FROM financing_offers
		WHERE request_id = ANY($1::uuid[]) ORDER BY fee_bps, created_at, id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var o Offer
		if err := rows.Scan(&o.ID, &o.RequestID, &o.Financier, &o.FeeBps, &o.Accepted, &o.CreatedAt); err != nil {
			return err
		}
		if i, ok := index[o.RequestID]; ok {
			list[i].Offers = append(list[i].Offers, o)
		}
	}
	return rows.Err()
}

// lockRequest reads a request's status inside tx and holds it until the transaction ends.
func lockRequest(ctx context.Context, tx pgx.Tx, id string) (string, error) {
	var status string
	err := tx.QueryRow(ctx, "SELECT status FROM financing_requests WHERE id = $1::uuid FOR UPDATE", id).Scan(&status)
	return status, mapErr(err)
}

// PlaceOffer records a financier's fee on an open request. A financier has one offer per request: offering again
// replaces the fee and reports created=false. A request that is no longer open is an ErrConflict.
func (s *Store) PlaceOffer(ctx context.Context, requestID, financier string, feeBps int) (Offer, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Offer{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	status, err := lockRequest(ctx, tx, requestID)
	if err != nil {
		return Offer{}, false, err
	}
	if status != RequestOpen {
		return Offer{}, false, fmt.Errorf("%w: the request is %s", ErrConflict, status)
	}
	var o Offer
	var inserted bool
	err = tx.QueryRow(ctx, `
		INSERT INTO financing_offers (request_id, financier, fee_bps) VALUES ($1::uuid, $2, $3)
		ON CONFLICT (request_id, financier) DO UPDATE SET fee_bps = EXCLUDED.fee_bps
		RETURNING id::text, request_id::text, financier, fee_bps, accepted, created_at, (xmax = 0)`,
		requestID, financier, feeBps).Scan(&o.ID, &o.RequestID, &o.Financier, &o.FeeBps, &o.Accepted, &o.CreatedAt, &inserted)
	if err != nil {
		return Offer{}, false, mapErr(err)
	}
	return o, inserted, mapErr(tx.Commit(ctx))
}

// AcceptOffer marks one offer of an open request accepted and the request accepted. An offer of another request is
// ErrNotFound; a request that is no longer open is ErrConflict.
func (s *Store) AcceptOffer(ctx context.Context, requestID, offerID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	status, err := lockRequest(ctx, tx, requestID)
	if err != nil {
		return err
	}
	if status != RequestOpen {
		return fmt.Errorf("%w: the request is %s", ErrConflict, status)
	}
	tag, err := tx.Exec(ctx, "UPDATE financing_offers SET accepted = true WHERE id = $1::uuid AND request_id = $2::uuid", offerID, requestID)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, "UPDATE financing_requests SET status = 'accepted', updated_at = now() WHERE id = $1::uuid", requestID); err != nil {
		return mapErr(err)
	}
	return mapErr(tx.Commit(ctx))
}

// CloseRequest withdraws an open or accepted request. A funded or closed one is ErrConflict.
func (s *Store) CloseRequest(ctx context.Context, requestID string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE financing_requests SET status = 'closed', updated_at = now()
		WHERE id = $1::uuid AND status IN ('open', 'accepted')`, requestID)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	if _, err := s.GetRequest(ctx, requestID); err != nil {
		return err
	}
	return fmt.Errorf("%w: the request is already funded or closed", ErrConflict)
}

// MarkRequestsFunded moves a shipment's live request to funded once its facility is funded on chain. It is
// idempotent and returns how many requests changed.
func (s *Store) MarkRequestsFunded(ctx context.Context, shipmentID string) (int, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE financing_requests SET status = 'funded', updated_at = now()
		WHERE shipment_id = $1 AND status IN ('open', 'accepted')`, shipmentID)
	if err != nil {
		return 0, mapErr(err)
	}
	return int(tag.RowsAffected()), nil
}
