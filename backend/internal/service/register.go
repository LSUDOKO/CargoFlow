package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// RouteCommitment is the value a shipment commits on-chain for its planned route: the keccak256 of the
// waypoints as compact JSON. Publishing the same waypoints lets anyone check the backend uses the route
// the exporter committed to.
func RouteCommitment(route []store.RoutePoint) [32]byte {
	b, _ := json.Marshal(route)
	return [32]byte(crypto.Keccak256Hash(b))
}

// ShipmentInput is what a caller supplies when registering a shipment. Everything that exists on-chain
// (parties, value, commitments, policy) is read from the chain, never taken from the caller.
type ShipmentInput struct {
	ShipmentID  string
	ExternalRef string             // must hash to the reference the id was derived from
	Route       []store.RoutePoint // optional; if given it must match the on-chain route commitment
	MaxGapSec   int                // off-chain scoring: longest tolerated silence between readings
	MinSensors  int                // off-chain scoring: independent sensors the policy requires

	// DeriveScoring ignores MaxGapSec and MinSensors and derives them from the on-chain policy instead, and
	// requires the route. Public (unauthenticated) callers must use it: the off-chain scoring parameters gate
	// releases, so no caller may choose them.
	DeriveScoring bool
}

// derived scoring defaults for publicly mirrored shipments
const publicMinSensors = 2

// RegisterShipment records the off-chain mirror of a shipment that already exists on-chain. It refuses
// anything the chain does not confirm, and stores nothing on refusal.
func (s *Service) RegisterShipment(ctx context.Context, in ShipmentInput) (store.Shipment, error) {
	id, canon, err := parseID(in.ShipmentID)
	if err != nil {
		return store.Shipment{}, err
	}
	if in.DeriveScoring && len(in.Route) == 0 {
		return store.Shipment{}, fmt.Errorf("%w: route is required and must match the route committed on chain", ErrInvalid)
	}
	if !in.DeriveScoring && in.MinSensors < 1 {
		return store.Shipment{}, fmt.Errorf("%w: minSensors must be at least 1", ErrInvalid)
	}
	if !in.DeriveScoring && in.MaxGapSec < 0 {
		return store.Shipment{}, fmt.Errorf("%w: maxGapSec must not be negative", ErrInvalid)
	}
	if in.ExternalRef == "" {
		return store.Shipment{}, fmt.Errorf("%w: externalRef is required", ErrInvalid)
	}

	onchain, err := s.o.Chain.Shipment(ctx, id)
	switch {
	case chain.IsRevert(err, "ShipmentNotFound"):
		return store.Shipment{}, ErrNotOnChain
	case err != nil:
		return store.Shipment{}, err
	}

	derived, err := s.o.Chain.ShipmentID(ctx, onchain.Exporter, [32]byte(crypto.Keccak256Hash([]byte(in.ExternalRef))))
	if err != nil {
		return store.Shipment{}, err
	}
	if derived != id {
		return store.Shipment{}, fmt.Errorf("%w: externalRef does not match this shipment id", ErrInvalid)
	}
	if len(in.Route) > 0 && RouteCommitment(in.Route) != onchain.RouteCommitment {
		return store.Shipment{}, fmt.Errorf("%w: route does not match the route commitment on chain", ErrInvalid)
	}

	pol, err := s.o.Chain.PolicyOf(ctx, id)
	switch {
	case chain.IsRevert(err, "PolicyNotSet"):
		return store.Shipment{}, ErrPolicyNotRevealed
	case err != nil:
		return store.Shipment{}, err
	}

	if in.DeriveScoring {
		in.MaxGapSec, in.MinSensors = int(pol.MaxEvidenceAgeSec), publicMinSensors
		if in.MaxGapSec == 0 {
			in.MaxGapSec = 1800
		}
	}
	sh := store.Shipment{
		ID: canon, ExternalRef: in.ExternalRef,
		Exporter: addrHex(onchain.Exporter), Buyer: addrHex(onchain.Buyer),
		InvoiceHash: hex32(onchain.InvoiceHash), RouteCommitment: hex32(onchain.RouteCommitment),
		PolicyCommitment: hex32(onchain.PolicyCommitment), InvoiceValue: onchain.InvoiceValue.String(),
		Policy: store.Policy{
			MinTempX100: int(pol.MinTempX100), MaxTempX100: int(pol.MaxTempX100),
			MaxGapSec: in.MaxGapSec, MaxRouteDeviationM: int(pol.MaxRouteDeviationM),
			MinEvidenceScore: int(pol.MinEvidenceScore), MaxConflictBps: int(pol.MaxConflictBps),
			MaxRiskBps: int(pol.MaxRiskBps), RequiresZK: pol.RequiresZK, MinSensors: in.MinSensors,
		},
		Route: in.Route,
	}
	if err := s.o.Store.CreateShipment(ctx, sh, nil); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return store.Shipment{}, ErrConflict
		}
		return store.Shipment{}, err
	}

	// If the exporter already created the facility, pull its milestones now; otherwise the chain-event
	// sink does it when FacilityCreated is indexed.
	if err := s.SyncMilestones(ctx, canon); err != nil && !errors.Is(err, ErrNoFacility) {
		return store.Shipment{}, err
	}
	return s.o.Store.GetShipment(ctx, canon)
}

// SyncMilestones copies a facility's terms from the chain into the store. It is idempotent and never
// erases a recorded release. It returns ErrNoFacility if the facility has not been created yet.
func (s *Service) SyncMilestones(ctx context.Context, shipmentID string) error {
	id, canon, err := parseID(shipmentID)
	if err != nil {
		return err
	}
	f, err := s.o.Chain.Facility(ctx, id)
	if chain.IsRevert(err, "FacilityNotFound") {
		return ErrNoFacility
	}
	if err != nil {
		return err
	}
	ms := make([]store.Milestone, 0, f.MilestoneCount)
	for i := uint8(0); i < f.MilestoneCount; i++ {
		m, err := s.o.Chain.Milestone(ctx, id, i)
		if err != nil {
			return err
		}
		ms = append(ms, store.Milestone{
			Index: int(i), AllocatedUSDG: new(big.Int).Set(m.Allocation).String(),
			EvidenceThreshold: int(m.EvidenceThreshold), CheckpointCommitment: hex32(m.CheckpointCommitment),
		})
	}
	if err := s.o.Store.UpsertMilestones(ctx, canon, ms); err != nil {
		return mapStoreErr(err)
	}
	if err := s.o.Store.SetShipmentFinancier(ctx, canon, addrHex(f.Financier)); err != nil {
		return mapStoreErr(err)
	}
	return mapStoreErr(s.o.Store.SetShipmentStatus(ctx, canon, chain.StatusName(f.Status)))
}

func mapStoreErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, store.ErrConflict):
		return ErrConflict
	}
	return err
}
