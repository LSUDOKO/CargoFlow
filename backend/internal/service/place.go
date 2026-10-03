package service

import (
	"context"
	"fmt"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// release asks the controller to release the epoch's milestone through the idempotent outbox.
func (s *Service) release(ctx context.Context, canon string, id [32]byte, e store.EpochRecord) (chain.TxResult, error) {
	return s.runAction(ctx, canon, "RELEASE", fmt.Sprintf("release:%s:%d:%d", canon, e.MilestoneIndex, e.Sequence), func() (chain.TxResult, error) {
		return s.o.Chain.ReleaseMilestone(ctx, s.o.Manager, id, uint8(e.MilestoneIndex), uint32(e.Sequence))
	}, "MilestoneAlreadyReleased")
}

// placeHold reports whether a committed, passing epoch must wait because its centroid lies outside its milestone's
// place, and how far away it is. The first time an epoch is found held it is recorded: the epoch's decision becomes
// HELD_NOT_AT_PLACE, a monitoring event joins the audit trail and a MILESTONE_HELD event goes to dashboards. A held
// epoch is neither a failure nor a pause; a later epoch from inside the place releases the milestone. If the
// controller cannot be asked (for example a v1 deployment without placeCheck) it reports no hold and leaves the
// decision to the controller, which re-checks the place on release anyway.
func (s *Service) placeHold(ctx context.Context, canon string, id [32]byte, e store.EpochRecord) (uint64, bool) {
	pc, err := s.o.Chain.PlaceCheck(ctx, id, uint8(e.MilestoneIndex), uint32(e.Sequence))
	if err != nil {
		s.o.Log.Warn("place check failed; leaving the place to the controller", "shipment", canon, "epoch", e.EpochID, "err", err)
		return 0, false
	}
	if !pc.Required || pc.Inside {
		return 0, false
	}
	if e.HeldDistanceM == nil {
		s.recordHold(ctx, canon, e, pc.DistanceM)
	}
	return pc.DistanceM, true
}

func (s *Service) recordHold(ctx context.Context, canon string, e store.EpochRecord, distanceM uint64) {
	if err := s.o.Store.SetEpochHeld(ctx, e.EpochID, int64(distanceM)); err != nil {
		s.o.Log.Error("record held epoch", "epoch", e.EpochID, "err", err)
	}
	data := map[string]any{"milestoneIndex": e.MilestoneIndex, "sequence": e.Sequence, "epochId": e.EpochID, "distanceM": distanceM,
		"latE6": e.LatE6, "lonE6": e.LonE6}
	if ms, err := s.o.Store.Milestones(ctx, canon); err == nil {
		for _, m := range ms {
			if m.Index == e.MilestoneIndex {
				data["radiusM"], data["placeLabel"], data["placeLatE6"], data["placeLonE6"] = m.RadiusM, m.PlaceLabel, m.LatE6, m.LonE6
				data["message"] = holdMessage(m, distanceM)
			}
		}
	}
	if _, err := s.o.Store.InsertAIEvent(ctx, store.AIEvent{
		ShipmentID: canon, EpochID: e.EpochID, Severity: "INFO", ActionType: string(decision.HeldNotAtPlace),
		ReasonCode: "OUTSIDE_MILESTONE_PLACE", Data: data,
	}); err != nil {
		s.o.Log.Error("record held epoch event", "epoch", e.EpochID, "err", err)
	}
	s.publish(ws.Event{Type: ws.MilestoneHeld, ShipmentID: canon, Data: data})
	if sh, err := s.o.Store.GetShipment(ctx, canon); err == nil {
		msg, _ := data["message"].(string)
		s.Notify(ctx, Note{ShipmentID: canon, Kind: NoteHeld, Title: fmt.Sprintf("Milestone %d of %s is held until the cargo reaches its place", e.MilestoneIndex+1, shipmentName(sh)),
			Body: msg, Link: s.TrackLink(canon), Data: data, DedupeKey: "held:" + e.EpochID, To: []string{sh.Exporter, sh.Financier}})
	}
}

// holdMessage says in words why a milestone waits, for example "Milestone 3 waits until the cargo is within 50 km of
// Colombo; it is 412 km away".
func holdMessage(m store.Milestone, distanceM uint64) string {
	place := m.PlaceLabel
	if place == "" {
		place = fmt.Sprintf("its place (%s, %s)", degrees(m.LatE6), degrees(m.LonE6))
	}
	return fmt.Sprintf("Milestone %d waits until the cargo is within %s of %s; it is %s away", m.Index+1, km(uint64(m.RadiusM)), place, km(distanceM))
}

// km renders metres as whole kilometres, or metres below one kilometre.
func km(m uint64) string {
	if m < 1000 {
		return fmt.Sprintf("%d m", m)
	}
	return fmt.Sprintf("%d km", (m+500)/1000)
}

func degrees(e6 int32) string { return fmt.Sprintf("%.4f", float64(e6)/1e6) }

// recoveryPlaceCheck refuses recovery evidence from outside the milestone's place, using the exact port of the
// controller's distance function (the epoch is not committed yet, so placeCheck cannot be asked).
func (s *Service) recoveryPlaceCheck(ctx context.Context, id [32]byte, milestone uint8, agg telemetry.Aggregates) error {
	m, err := s.o.Chain.Milestone(ctx, id, milestone)
	if err != nil || m.RadiusM == 0 {
		return nil // no place, or no answer: the controller decides
	}
	if d := geo.PlaceDistanceM(agg.LatE6, agg.LonE6, m.LatE6, m.LonE6); d > uint64(m.RadiusM) {
		return fmt.Errorf("%w: the recovery readings are %s from milestone %d's place (radius %s); the arbiter can resume the facility instead",
			ErrNotRecoverable, km(d), milestone+1, km(uint64(m.RadiusM)))
	}
	return nil
}
