package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Notification kinds (in-app).
const (
	NotePaused        = "PAUSED"
	NoteReleased      = "RELEASED"
	NoteResumed       = "RESUMED"
	NoteHeld          = "HELD"
	NoteRecoveryReady = "RECOVERY_READY"
	NoteDisputed      = "DISPUTED"
	NoteDelivered     = "DELIVERED"
	NoteSettled       = "SETTLED"
	NoteDefaulted     = "DEFAULTED"
	NoteCoverOffered  = "COVER_OFFERED"
	NoteCoverAccepted = "COVER_ACCEPTED"
	NoteCoverReleased = "COVER_RELEASED"
	NoteCoverClaimed  = "COVER_CLAIMED"
	NoteOfferReceived = "OFFER_RECEIVED"
	NoteOfferAccepted = "OFFER_ACCEPTED"
	// contracts v3
	NoteCancelled      = "CANCELLED"
	NoteCoverTriggered = "COVER_TRIGGERED"
	NoteTitleBound     = "TITLE_BOUND"
)

// Note is an in-app notification to some wallets.
type Note struct {
	ShipmentID string
	Kind       string
	Title      string
	Body       string
	Link       string // absolute when APP_URL is set, else a path such as /track/<id>
	Data       map[string]any
	DedupeKey  string // unique per event: a redelivered event with the same key notifies nobody twice
	To         []string
}

// Notify stores an in-app notification for each recipient. It never fails the caller: errors are logged.
func (s *Service) Notify(ctx context.Context, n Note) {
	if s.o.Store == nil || len(n.To) == 0 {
		return
	}
	if _, err := s.o.Store.AddNotification(ctx, store.Notification{ShipmentID: n.ShipmentID, Kind: n.Kind, Title: n.Title, Body: n.Body,
		Link: n.Link, Data: n.Data, DedupeKey: n.DedupeKey}, n.To...); err != nil {
		s.o.Log.Error("store notification", "kind", n.Kind, "shipment", n.ShipmentID, "err", err)
	}
}

// AppLink is a link into the web app: APP_URL + path, or the path alone when APP_URL is unset.
func (s *Service) AppLink(path string) string { return s.o.AppURL + path }

// TrackLink is the shipment's page in the web app.
func (s *Service) TrackLink(shipmentID string) string { return s.AppLink("/track/" + shipmentID) }

func shipmentName(sh store.Shipment) string {
	if ref := strings.TrimSpace(sh.ExternalRef); ref != "" {
		if r := []rune(ref); len(r) > 60 {
			ref = string(r[:60]) + "…"
		}
		return ref
	}
	if len(sh.ID) > 10 {
		return sh.ID[:10] + "…"
	}
	return sh.ID
}

// chainNotes describes the chain events that notify parties: kind, title (with %s for the shipment) and who hears.
var chainNotes = map[string]struct {
	kind, title string
	insurers    bool
}{
	"FinancingPaused":          {NotePaused, "Financing paused on %s", false},
	"MilestoneAdvanceReleased": {NoteReleased, "A milestone advance was released on %s", false},
	"FinancingResumed":         {NoteResumed, "Financing resumed on %s", false},
	"DisputeOpened":            {NoteDisputed, "A dispute was opened on %s", true},
	"DeliveryConfirmed":        {NoteDelivered, "Delivery confirmed for %s", false},
	"FacilitySettled":          {NoteSettled, "%s was settled", true},
	"DefaultDeclared":          {NoteDefaulted, "%s defaulted", true},
	"CoverOffered":             {NoteCoverOffered, "Default cover offered on %s", true},
	"CoverAccepted":            {NoteCoverAccepted, "Default cover accepted on %s", true},
	"CoverReleased":            {NoteCoverReleased, "Default cover released on %s", true},
	"CoverClaimed":             {NoteCoverClaimed, "Default cover paid out on %s", true},
	"FacilityCancelled":        {NoteCancelled, "%s was cancelled before transit; the deposit was returned", false},
	"ParametricTriggered":      {NoteCoverTriggered, "Parametric cover triggered on %s", true},
	"TitleBound":               {NoteTitleBound, "A bill of lading was bound to %s", false},
}

// notifyChainEvent turns a chain event into in-app notifications for the shipment's parties (and, for cover and
// default events, its insurers).
func (s *Service) notifyChainEvent(ctx context.Context, ev store.ChainEvent, sh store.Shipment) {
	m, ok := chainNotes[ev.Name]
	if !ok {
		return
	}
	to := []string{sh.Exporter, sh.Buyer, sh.Financier}
	if f, _ := ev.Args["financier"].(string); f != "" {
		to = append(to, f)
	}
	if m.insurers {
		if cv, err := s.o.Store.CoverOf(ctx, sh.ID); err == nil {
			for _, o := range cv.Offers {
				to = append(to, o.Insurer)
			}
			if cv.Cover != nil {
				to = append(to, cv.Cover.Insurer)
			}
		}
		if ins, _ := ev.Args["insurer"].(string); ins != "" {
			to = append(to, ins)
		}
	}
	data := map[string]any{"txHash": ev.TxHash, "event": ev.Name}
	body := ""
	switch ev.Name {
	case "MilestoneAdvanceReleased":
		idx := int(num(ev.Args["milestoneIndex"]))
		data["milestoneIndex"] = idx
		body = fmt.Sprintf("Milestone %d was released.", idx+1)
	case "FinancingPaused":
		data["reasonCode"] = ev.Args["reasonCode"]
		body = "Releases stop until the cargo's evidence recovers (a zero-knowledge recovery from fresh readings) or an arbiter resolves it."
	}
	s.Notify(ctx, Note{ShipmentID: sh.ID, Kind: m.kind, Title: fmt.Sprintf(m.title, shipmentName(sh)), Body: body,
		Link: s.TrackLink(sh.ID), Data: data, DedupeKey: fmt.Sprintf("chain:%s#%d", ev.TxHash, ev.LogIndex), To: to})
}
