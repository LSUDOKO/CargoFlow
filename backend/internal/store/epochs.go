package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// EpochRecord is a closed evidence epoch with its decision and chain status.
type EpochRecord struct {
	ID              string // server-assigned UUID
	ShipmentID      string
	MilestoneIndex  int
	Sequence        int // on-chain epoch sequence for this milestone, starting at 1
	EpochID         string
	MerkleRoot      string
	ReadingCount    int
	StartTime       int64
	EndTime         int64
	Score           int
	ConflictBps     int
	RiskBps         int
	Compliant       bool
	Penalties       map[string]int
	DecisionPass    bool
	DecisionAction  string
	DecisionReasons []string
	Points          []telemetry.Point // the committed readings in leaf order; private witness source
	CommitTxHash    string
	ProofVerified   bool
	CreatedAt       time.Time
}

// InsertEpoch stores an epoch. A second epoch for the same (shipment, milestone, sequence), or the same
// epoch id, is an ErrConflict, which is what makes processing the same epoch twice safe.
func (s *Store) InsertEpoch(ctx context.Context, e EpochRecord) (EpochRecord, error) {
	penalties, err := json.Marshal(e.Penalties)
	if err != nil {
		return EpochRecord{}, err
	}
	if e.Penalties == nil {
		penalties = []byte("{}")
	}
	points, err := json.Marshal(e.Points)
	if err != nil {
		return EpochRecord{}, err
	}
	reasons := e.DecisionReasons
	if reasons == nil {
		reasons = []string{}
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO telemetry_epochs (shipment_id, milestone_index, sequence, epoch_id, merkle_root, reading_count,
			start_time, end_time, score, conflict_bps, risk_bps, compliant, penalties,
			decision_pass, decision_action, decision_reasons, points)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17::jsonb)
		RETURNING id::text, created_at`,
		e.ShipmentID, e.MilestoneIndex, e.Sequence, e.EpochID, e.MerkleRoot, e.ReadingCount,
		e.StartTime, e.EndTime, e.Score, e.ConflictBps, e.RiskBps, e.Compliant, string(penalties),
		e.DecisionPass, e.DecisionAction, reasons, string(points)).Scan(&e.ID, &e.CreatedAt)
	if err != nil {
		return EpochRecord{}, mapErr(err)
	}
	return e, nil
}

const epochColumns = `id::text, shipment_id, milestone_index, sequence, epoch_id, merkle_root, reading_count,
	start_time, end_time, score, conflict_bps, risk_bps, compliant, penalties, decision_pass, decision_action,
	decision_reasons, points, COALESCE(commit_tx_hash,''), proof_verified, created_at`

func scanEpoch(row pgx.Row) (EpochRecord, error) {
	var e EpochRecord
	var penalties, points []byte
	err := row.Scan(&e.ID, &e.ShipmentID, &e.MilestoneIndex, &e.Sequence, &e.EpochID, &e.MerkleRoot, &e.ReadingCount,
		&e.StartTime, &e.EndTime, &e.Score, &e.ConflictBps, &e.RiskBps, &e.Compliant, &penalties, &e.DecisionPass,
		&e.DecisionAction, &e.DecisionReasons, &points, &e.CommitTxHash, &e.ProofVerified, &e.CreatedAt)
	if err != nil {
		return EpochRecord{}, mapErr(err)
	}
	if err := json.Unmarshal(penalties, &e.Penalties); err != nil {
		return EpochRecord{}, err
	}
	if err := json.Unmarshal(points, &e.Points); err != nil {
		return EpochRecord{}, err
	}
	return e, nil
}

// EpochByEpochID looks an epoch up by its on-chain id.
func (s *Store) EpochByEpochID(ctx context.Context, epochID string) (EpochRecord, error) {
	return scanEpoch(s.pool.QueryRow(ctx, "SELECT "+epochColumns+" FROM telemetry_epochs WHERE epoch_id = $1", epochID))
}

// Epochs returns a shipment's epochs in creation order.
func (s *Store) Epochs(ctx context.Context, shipmentID string) ([]EpochRecord, error) {
	rows, err := s.pool.Query(ctx,
		"SELECT "+epochColumns+" FROM telemetry_epochs WHERE shipment_id = $1 ORDER BY created_at, milestone_index, sequence",
		shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpochRecord
	for rows.Next() {
		e, err := scanEpoch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LatestEpoch returns the most recently created epoch, or ErrNotFound if there is none.
func (s *Store) LatestEpoch(ctx context.Context, shipmentID string) (EpochRecord, error) {
	return scanEpoch(s.pool.QueryRow(ctx,
		"SELECT "+epochColumns+" FROM telemetry_epochs WHERE shipment_id = $1 ORDER BY created_at DESC, milestone_index DESC, sequence DESC LIMIT 1",
		shipmentID))
}

// NextSequence returns the next on-chain epoch sequence for a milestone. Sequences start at 1.
func (s *Store) NextSequence(ctx context.Context, shipmentID string, milestone int) (int, error) {
	var next int
	err := s.pool.QueryRow(ctx,
		"SELECT COALESCE(max(sequence), 0) + 1 FROM telemetry_epochs WHERE shipment_id = $1 AND milestone_index = $2",
		shipmentID, milestone).Scan(&next)
	return next, err
}

// SetEpochCommitted records the commit transaction. The first recorded transaction stands.
func (s *Store) SetEpochCommitted(ctx context.Context, epochID, txHash string) error {
	return s.epochUpdate(ctx, epochID, "commit_tx_hash = COALESCE(commit_tx_hash, $2)", txHash)
}

// SetEpochProofVerified marks that a ZK proof over this epoch verified on chain.
func (s *Store) SetEpochProofVerified(ctx context.Context, epochID string) error {
	return s.epochUpdate(ctx, epochID, "proof_verified = true")
}

func (s *Store) epochUpdate(ctx context.Context, epochID, set string, args ...any) error {
	tag, err := s.pool.Exec(ctx, "UPDATE telemetry_epochs SET "+set+" WHERE epoch_id = $1", append([]any{epochID}, args...)...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
