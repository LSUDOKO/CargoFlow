package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// OnChainEvents is the indexer's sink. It mirrors on-chain facts into the store and broadcasts them to
// WebSocket clients. Delivery is at-least-once, so every branch is idempotent: replays never overwrite the
// first recorded release or commit, and events for shipments this backend does not track are ignored.
// Broadcast events carry the transaction hash and log index so clients can drop a redelivered duplicate.
func (s *Service) OnChainEvents(ctx context.Context, events []store.ChainEvent) error {
	for _, ev := range events {
		if err := s.onChainEvent(ctx, ev); err != nil {
			return fmt.Errorf("%s %s#%d: %w", ev.Name, ev.TxHash, ev.LogIndex, err)
		}
	}
	return nil
}

func (s *Service) onChainEvent(ctx context.Context, ev store.ChainEvent) error {
	shipment := ev.ShipmentID
	// EvidenceProofVerified names only the epoch: find its shipment from our own records.
	if ev.Name == "EvidenceProofVerified" {
		epochID, _ := ev.Args["epochId"].(string)
		rec, err := s.o.Store.EpochByEpochID(ctx, epochID)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				return nil
			}
			return err
		}
		shipment = rec.ShipmentID
		if err := s.o.Store.SetEpochProofVerified(ctx, epochID); err != nil {
			return err
		}
		s.publish(ws.Event{Type: ws.ProofVerified, ShipmentID: shipment, Data: withTx(ev, map[string]any{"epochId": epochID})})
		return nil
	}
	if shipment == "" {
		return nil
	}
	sh, err := s.o.Store.GetShipment(ctx, shipment)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil // a shipment this backend does not track
		}
		return err
	}
	defer s.alert(ev, sh)

	switch ev.Name {
	case "FacilityCreated":
		if err := s.SyncMilestones(ctx, shipment); err != nil && !errors.Is(err, ErrNoFacility) {
			return err
		}
		s.publish(ws.Event{Type: ws.ShipmentUpdated, ShipmentID: shipment, Data: withTx(ev, map[string]any{"change": "FACILITY_CREATED"})})

	case "StatusChanged":
		status := chain.StatusName(uint8(num(ev.Args["to"])))
		if err := s.o.Store.SetShipmentStatus(ctx, shipment, status); err != nil {
			return err
		}
		s.publish(ws.Event{Type: ws.ShipmentUpdated, ShipmentID: shipment, Data: withTx(ev, map[string]any{"status": status})})
		// a marketplace request is funded once its facility holds the financier's capital
		if to := uint8(num(ev.Args["to"])); to >= chain.StatusFinanced && to <= chain.StatusDefaulted {
			if _, err := s.o.Store.MarkRequestsFunded(ctx, shipment); err != nil {
				return err
			}
		}

	case "MilestoneAdvanceReleased":
		idx := int(num(ev.Args["milestoneIndex"]))
		if err := s.o.Store.MarkMilestoneReleased(ctx, shipment, idx, ev.TxHash); err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		s.publish(ws.Event{Type: ws.MilestoneReleased, ShipmentID: shipment, Data: withTx(ev, map[string]any{
			"milestoneIndex": idx, "amount": ev.Args["amount"], "totalDrawn": ev.Args["totalDrawn"], "epochId": ev.Args["epochId"]})})

	case "EvidenceEpochCommitted":
		if epochID, _ := ev.Args["epochId"].(string); epochID != "" {
			if err := s.o.Store.SetEpochCommitted(ctx, epochID, ev.TxHash); err != nil && !errors.Is(err, store.ErrNotFound) {
				return err
			}
		}

	case "FinancingPaused":
		s.publish(ws.Event{Type: ws.FinancingPaused, ShipmentID: shipment, Data: withTx(ev, map[string]any{
			"reasonCode": ev.Args["reasonCode"], "pausedBy": ev.Args["pausedBy"]})})

	case "FinancingResumed":
		s.publish(ws.Event{Type: ws.FinancingResumed, ShipmentID: shipment, Data: withTx(ev, map[string]any{
			"resumedBy": ev.Args["resumedBy"], "basis": ev.Args["basis"]})})

	case "DeliveryConfirmed":
		s.publish(ws.Event{Type: ws.DeliveryConfirmed, ShipmentID: shipment, Data: withTx(ev, map[string]any{"confirmedBy": ev.Args["confirmedBy"]})})

	case "FacilitySettled":
		s.publish(ws.Event{Type: ws.FacilitySettled, ShipmentID: shipment, Data: withTx(ev, map[string]any{
			"principal": ev.Args["principal"], "fee": ev.Args["fee"], "residual": ev.Args["residual"], "undrawnRefund": ev.Args["undrawnRefund"]})})

	case "EvidenceTelemetryCommitted":
		// the aggregates were computed and stored when the epoch was built; the event only confirms them on chain

	case "CoverOffered", "OfferWithdrawn", "CoverAccepted", "CoverReleased", "CoverClaimed":
		if err := s.o.Store.RebuildCover(ctx, shipment); err != nil {
			return err
		}
		data := map[string]any{"change": ev.Name}
		for _, k := range []string{"insurer", "financier", "amount", "premiumBps", "premium", "loss", "payout", "remainder"} {
			if v, ok := ev.Args[k]; ok {
				data[k] = v
			}
		}
		s.publish(ws.Event{Type: ws.CoverUpdated, ShipmentID: shipment, Data: withTx(ev, data)})

	case "DisputeOpened", "DisputeResolved", "DefaultDeclared":
		s.publish(ws.Event{Type: ws.ShipmentUpdated, ShipmentID: shipment, Data: withTx(ev, map[string]any{"change": ev.Name})})
	}
	return nil
}

// alertEvents maps the chain events parties can subscribe to onto alert names and the status they leave the
// facility in ("" keeps the mirrored status).
var alertEvents = map[string][2]string{
	"FinancingPaused":          {alerts.Paused, "PAUSED"},
	"MilestoneAdvanceReleased": {alerts.Released, ""},
	"FinancingResumed":         {alerts.Resumed, "ACTIVE"},
	"DisputeOpened":            {alerts.Disputed, "DISPUTED"},
	"DeliveryConfirmed":        {alerts.Delivered, "DELIVERED"},
	"FacilitySettled":          {alerts.Settled, "SETTLED"},
	"DefaultDeclared":          {alerts.Defaulted, "DEFAULTED"},
	"CoverOffered":             {alerts.CoverOffered, ""},
	"CoverAccepted":            {alerts.CoverAccepted, ""},
	"CoverClaimed":             {alerts.CoverClaimed, ""},
}

// alert queues an alert for an alertable event. It never blocks or fails event handling.
func (s *Service) alert(ev store.ChainEvent, sh store.Shipment) {
	m, ok := alertEvents[ev.Name]
	if !ok || s.o.Alerts == nil {
		return
	}
	status := m[1]
	if status == "" {
		status = sh.Status
	}
	at := ev.CreatedAt
	if at.IsZero() {
		at = time.Now().UTC()
	}
	s.o.Alerts.Notify(alerts.Alert{Event: m[0], ShipmentID: sh.ID, ExternalRef: sh.ExternalRef, Status: status, TxHash: ev.TxHash,
		At: at.UTC().Truncate(time.Second), Key: fmt.Sprintf("%s#%d", ev.TxHash, ev.LogIndex)})
}

func withTx(ev store.ChainEvent, data map[string]any) map[string]any {
	data["txHash"], data["logIndex"], data["blockNumber"] = ev.TxHash, ev.LogIndex, ev.BlockNumber
	return data
}

// num reads a JSON-decoded or ABI-decoded number regardless of its Go type.
func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case uint8:
		return float64(x)
	case uint16:
		return float64(x)
	case uint32:
		return float64(x)
	case uint64:
		return float64(x)
	case int:
		return float64(x)
	}
	return 0
}
