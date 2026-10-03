package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"unicode/utf8"

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
	// PlaceLabels are display names for the milestone places, by milestone index ("" for none). They are
	// cosmetic: the place itself (coordinates and radius) is always read from the chain.
	PlaceLabels []string

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
	// The policy engine only accepts a policy that hashes to the registry's commitment; check it anyway, so a
	// mirror never stores limits the shipment did not commit to (for example after an ABI mismatch).
	if h, err := s.o.Chain.HashPolicy(ctx, pol); err != nil {
		return store.Shipment{}, err
	} else if h != onchain.PolicyCommitment {
		return store.Shipment{}, fmt.Errorf("%w: the revealed policy does not match the shipment's policy commitment", ErrInvalid)
	}
	labels, err := cleanPlaceLabels(in.PlaceLabels)
	if err != nil {
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
			MaxHumidityX100: int(pol.MaxHumidityX100), MaxShockX100: int(pol.MaxShockX100),
		},
		Route:       in.Route,
		PlaceLabels: labels,
	}
	if err := s.o.Store.CreateShipment(ctx, sh, nil); err != nil {
		if errors.Is(err, store.ErrConflict) {
			return store.Shipment{}, ErrConflict
		}
		return store.Shipment{}, err
	}

	// Cover offered or accepted before the mirror existed was indexed but not applied: apply it now. Events
	// indexed later reach the sink, which rebuilds the cover again.
	if err := s.o.Store.RebuildCover(ctx, canon); err != nil {
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
			LatE6: m.LatE6, LonE6: m.LonE6, RadiusM: m.RadiusM,
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

// Place label limits: a label is a short display name, shown in explanations (which a model may reword), so it is
// restricted to plain characters that cannot carry markup or instructions of any length.
const (
	maxPlaceLabels   = 32
	maxPlaceLabelLen = 64
)

var placeLabelPattern = regexp.MustCompile(`^[\p{L}\p{N} .,'()/-]*$`)

// cleanPlaceLabels validates milestone place labels, trimming spaces. Trailing empty labels are dropped.
func cleanPlaceLabels(in []string) ([]string, error) {
	if len(in) > maxPlaceLabels {
		return nil, fmt.Errorf("%w: at most %d place labels", ErrInvalid, maxPlaceLabels)
	}
	out := make([]string, len(in))
	for i, l := range in {
		l = strings.TrimSpace(l)
		if utf8.RuneCountInString(l) > maxPlaceLabelLen || !placeLabelPattern.MatchString(l) {
			return nil, fmt.Errorf("%w: place label %d must be up to %d letters, digits, spaces or .,'()/-", ErrInvalid, i, maxPlaceLabelLen)
		}
		out[i] = l
	}
	for len(out) > 0 && out[len(out)-1] == "" {
		out = out[:len(out)-1]
	}
	return out, nil
}

// SetPlaceLabels stores milestone place labels for a mirrored shipment that has none yet; labels already stored
// stand. It reports whether they were stored.
func (s *Service) SetPlaceLabels(ctx context.Context, shipmentID string, labels []string) (bool, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return false, err
	}
	clean, err := cleanPlaceLabels(labels)
	if err != nil || len(clean) == 0 {
		return false, err
	}
	ok, err := s.o.Store.SetPlaceLabels(ctx, canon, clean)
	return ok, mapStoreErr(err)
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
