package store

import "context"

// Stats are platform-wide counts for the public landing page. Amounts are not summed here: the chain holds
// them, and the API exposes them per shipment.
type Stats struct {
	Shipments       map[string]int `json:"shipments"` // count by status
	Total           int            `json:"total"`
	EpochsCommitted int            `json:"epochsCommitted"`
	ProofsVerified  int            `json:"proofsVerified"`
}

// Stats counts shipments by status, committed epochs and proof-verified epochs.
func (s *Store) Stats(ctx context.Context) (Stats, error) {
	st := Stats{Shipments: map[string]int{}}
	rows, err := s.pool.Query(ctx, "SELECT status, count(*) FROM shipments GROUP BY status")
	if err != nil {
		return st, err
	}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			rows.Close()
			return st, err
		}
		st.Shipments[status] = n
		st.Total += n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return st, err
	}
	err = s.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE commit_tx_hash IS NOT NULL),
		count(*) FILTER (WHERE proof_verified) FROM telemetry_epochs`).Scan(&st.EpochsCommitted, &st.ProofsVerified)
	return st, err
}
