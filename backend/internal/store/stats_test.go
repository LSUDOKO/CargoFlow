package store_test

import (
	"context"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestStatsCountsShipmentsEpochsAndProofs(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	if _, err := s.InsertEpoch(ctx, store.EpochRecord{ShipmentID: id, MilestoneIndex: 0, Sequence: 1,
		EpochID: hex64('a'), MerkleRoot: hex64('b'), Penalties: map[string]int{}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEpochCommitted(ctx, hex64('a'), hex64('c')); err != nil {
		t.Fatal(err)
	}
	if err := s.SetEpochProofVerified(ctx, hex64('a')); err != nil {
		t.Fatal(err)
	}
	st, err := s.Stats(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if st.Total != 1 || st.Shipments["REGISTERED"] != 1 || st.EpochsCommitted != 1 || st.ProofsVerified != 1 {
		t.Fatalf("%+v", st)
	}
}
