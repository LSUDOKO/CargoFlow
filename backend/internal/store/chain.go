package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ChainEvent is one decoded on-chain log. (TxHash, LogIndex) is its identity.
type ChainEvent struct {
	TxHash      string
	LogIndex    int
	BlockNumber uint64
	BlockHash   string
	Contract    string
	Name        string
	ShipmentID  string // empty for events that are not tied to a shipment
	Args        map[string]any
	CreatedAt   time.Time
}

// SaveChainEvents stores logs atomically and idempotently and returns how many were new. Re-reading a
// block range (after a restart, or overlapping polls) therefore never duplicates history.
func (s *Store) SaveChainEvents(ctx context.Context, events []ChainEvent) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	inserted := 0
	for _, e := range events {
		args, err := json.Marshal(e.Args)
		if err != nil {
			return 0, err
		}
		if e.Args == nil {
			args = []byte("{}")
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO chain_events (tx_hash, log_index, block_number, block_hash, contract, event_name, shipment_id, args)
			VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8::jsonb)
			ON CONFLICT (tx_hash, log_index) DO NOTHING`,
			e.TxHash, e.LogIndex, int64(e.BlockNumber), e.BlockHash, e.Contract, e.Name, e.ShipmentID, string(args))
		if err != nil {
			return 0, mapErr(err)
		}
		inserted += int(tag.RowsAffected())
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return inserted, nil
}

// ChainEvents returns a shipment's events ordered by block, then log index.
func (s *Store) ChainEvents(ctx context.Context, shipmentID string, limit int) ([]ChainEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT tx_hash, log_index, block_number, block_hash, contract, event_name, COALESCE(shipment_id,''), args, created_at
		FROM chain_events WHERE shipment_id = $1 ORDER BY block_number, log_index LIMIT $2`, shipmentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ChainEvent
	for rows.Next() {
		var e ChainEvent
		var block int64
		var args []byte
		if err := rows.Scan(&e.TxHash, &e.LogIndex, &block, &e.BlockHash, &e.Contract, &e.Name, &e.ShipmentID, &args, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.BlockNumber = uint64(block)
		if err := json.Unmarshal(args, &e.Args); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LastBlock returns the indexer cursor. ok is false when the cursor has never been set.
func (s *Store) LastBlock(ctx context.Context, name string) (block uint64, ok bool, err error) {
	var n int64
	err = s.pool.QueryRow(ctx, "SELECT last_block FROM sync_state WHERE name = $1", name).Scan(&n)
	if err != nil {
		if errors.Is(mapErr(err), ErrNotFound) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return uint64(n), true, nil
}

// SetLastBlock advances (or sets) the indexer cursor.
func (s *Store) SetLastBlock(ctx context.Context, name string, block uint64, blockHash string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sync_state (name, last_block, block_hash) VALUES ($1, $2, NULLIF($3,''))
		ON CONFLICT (name) DO UPDATE SET last_block = EXCLUDED.last_block, block_hash = EXCLUDED.block_hash, updated_at = now()`,
		name, int64(block), blockHash)
	return err
}

// RewindTo handles a chain reorganisation: it discards every stored event above block and moves the
// cursor back, so the orphaned range can be indexed again from the canonical chain.
func (s *Store) RewindTo(ctx context.Context, name string, block uint64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "DELETE FROM chain_events WHERE block_number > $1", int64(block)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO sync_state (name, last_block) VALUES ($1, $2)
		ON CONFLICT (name) DO UPDATE SET last_block = $2, block_hash = NULL, updated_at = now()`, name, int64(block)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AIEvent is an audit record of a monitoring decision and whether it triggered an on-chain action.
type AIEvent struct {
	ID                     string
	ShipmentID             string
	EpochID                string
	Severity               string
	ActionType             string
	ReasonCode             string
	Data                   map[string]any
	OnchainActionTriggered bool
	TxHash                 string
	CreatedAt              time.Time
}

// InsertAIEvent appends a monitoring event.
func (s *Store) InsertAIEvent(ctx context.Context, e AIEvent) (AIEvent, error) {
	data, err := json.Marshal(e.Data)
	if err != nil {
		return AIEvent{}, err
	}
	if e.Data == nil {
		data = []byte("{}")
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO ai_monitoring_events (shipment_id, epoch_id, severity, action_type, reason_code,
			model_inference_data, onchain_action_triggered, tx_hash)
		VALUES ($1, NULLIF($2,''), $3, $4, $5, $6::jsonb, $7, NULLIF($8,''))
		RETURNING id::text, created_at`,
		e.ShipmentID, e.EpochID, e.Severity, e.ActionType, e.ReasonCode, string(data), e.OnchainActionTriggered, e.TxHash).
		Scan(&e.ID, &e.CreatedAt)
	return e, mapErr(err)
}

// AIEvents returns a shipment's monitoring events in creation order.
func (s *Store) AIEvents(ctx context.Context, shipmentID string, limit int) ([]AIEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, shipment_id, COALESCE(epoch_id,''), severity, action_type, reason_code, model_inference_data,
		       onchain_action_triggered, COALESCE(tx_hash,''), created_at
		FROM ai_monitoring_events WHERE shipment_id = $1 ORDER BY created_at, id LIMIT $2`, shipmentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AIEvent
	for rows.Next() {
		var e AIEvent
		var data []byte
		if err := rows.Scan(&e.ID, &e.ShipmentID, &e.EpochID, &e.Severity, &e.ActionType, &e.ReasonCode, &data,
			&e.OnchainActionTriggered, &e.TxHash, &e.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &e.Data); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Action is an outbox row for one transaction we intend to send or have sent.
type Action struct {
	ID         string
	ShipmentID string
	Kind       string
	Key        string
	Status     string // PENDING, SENT, CONFIRMED, FAILED
	TxHash     string
	Error      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

const actionColumns = `id::text, shipment_id, kind, key, status, COALESCE(tx_hash,''), COALESCE(error,''), created_at, updated_at`

// BeginAction registers intent to perform a chain action. The key makes it idempotent: a repeated key
// returns the existing action with created=false, so a retry or restart never sends the transaction twice.
func (s *Store) BeginAction(ctx context.Context, shipmentID, kind, key string) (Action, bool, error) {
	var a Action
	err := s.pool.QueryRow(ctx, `
		INSERT INTO chain_actions (shipment_id, kind, key) VALUES ($1,$2,$3)
		ON CONFLICT (key) DO NOTHING
		RETURNING `+actionColumns, shipmentID, kind, key).
		Scan(&a.ID, &a.ShipmentID, &a.Kind, &a.Key, &a.Status, &a.TxHash, &a.Error, &a.CreatedAt, &a.UpdatedAt)
	if err == nil {
		return a, true, nil
	}
	if !errors.Is(mapErr(err), ErrNotFound) {
		return Action{}, false, mapErr(err)
	}
	existing, err := s.ActionByKey(ctx, key)
	return existing, false, err
}

// ActionByKey returns the action for an idempotency key.
func (s *Store) ActionByKey(ctx context.Context, key string) (Action, error) {
	var a Action
	err := s.pool.QueryRow(ctx, "SELECT "+actionColumns+" FROM chain_actions WHERE key = $1", key).
		Scan(&a.ID, &a.ShipmentID, &a.Kind, &a.Key, &a.Status, &a.TxHash, &a.Error, &a.CreatedAt, &a.UpdatedAt)
	return a, mapErr(err)
}

// FinishAction moves an action to SENT, CONFIRMED or FAILED, recording the transaction hash or error.
func (s *Store) FinishAction(ctx context.Context, id, status, txHash, errMsg string) error {
	switch status {
	case "PENDING", "SENT", "CONFIRMED", "FAILED":
	default:
		return fmt.Errorf("store: invalid action status %q", status)
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE chain_actions SET status = $2, tx_hash = COALESCE(NULLIF($3,''), tx_hash), error = NULLIF($4,''), updated_at = now()
		WHERE id = $1::uuid`, id, status, txHash, errMsg)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RequeueAction puts a FAILED action back to PENDING. Any other status is an ErrConflict: a confirmed or
// in-flight transaction must never be sent again.
func (s *Store) RequeueAction(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx,
		"UPDATE chain_actions SET status = 'PENDING', error = NULL, updated_at = now() WHERE id = $1::uuid AND status = 'FAILED'", id)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%w: only FAILED actions can be requeued", ErrConflict)
	}
	return nil
}

// Actions returns a shipment's outbox in creation order.
func (s *Store) Actions(ctx context.Context, shipmentID string) ([]Action, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+actionColumns+" FROM chain_actions WHERE shipment_id = $1 ORDER BY created_at, id", shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Action
	for rows.Next() {
		var a Action
		if err := rows.Scan(&a.ID, &a.ShipmentID, &a.Kind, &a.Key, &a.Status, &a.TxHash, &a.Error, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
