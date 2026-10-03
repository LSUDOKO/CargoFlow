package service

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// EpochSummary is an epoch as shown to clients. It deliberately has no field for the readings: raw
// telemetry stays off-chain and private, so it cannot leak through any API built on this type.
type EpochSummary struct {
	Sequence       int            `json:"sequence"`
	MilestoneIndex int            `json:"milestoneIndex"` // 255 means observed but not evaluated against a milestone
	EpochID        string         `json:"epochId"`
	Root           string         `json:"root"`
	ReadingCount   int            `json:"readingCount"`
	StartTime      int64          `json:"startTime"`
	EndTime        int64          `json:"endTime"`
	Score          int            `json:"score"`
	ConflictBps    int            `json:"conflictBps"`
	RiskBps        int            `json:"riskBps"`
	Compliant      bool           `json:"compliant"`
	Penalties      map[string]int `json:"penalties"`
	DecisionPass   bool           `json:"decisionPass"`
	DecisionAction string         `json:"decisionAction"`
	Reasons        []string       `json:"reasons"`
	CommitTx       string         `json:"commitTx,omitempty"`
	ProofVerified  bool           `json:"proofVerified"`
	CreatedAt      time.Time      `json:"createdAt"`
	// v2 aggregates committed with the epoch (0 for epochs from before v2)
	LatE6           int32  `json:"latE6"`
	LonE6           int32  `json:"lonE6"`
	MaxHumidityX100 int    `json:"maxHumidityX100"`
	MaxShockX100    int    `json:"maxShockX100"`
	HeldDistanceM   *int64 `json:"heldDistanceM"` // metres from the milestone's place when the decision is HELD_NOT_AT_PLACE, else null
	// v3: the devices whose readings fed the epoch, and the recordEpochSources transaction ("" until recorded)
	Sources   []EpochSource `json:"sources"`
	SourcesTx string        `json:"sourcesTx,omitempty"`
}

// EpochSource is one device behind an epoch.
type EpochSource struct {
	KeyHash     string `json:"keyHash"`
	DeviceClass string `json:"deviceClass" enum:"software,passkey,secure_element"`
	OnChain     bool   `json:"onChain" doc:"the device is registered (and not revoked) in the v3 DeviceRegistry"`
}

func summarize(e store.EpochRecord) EpochSummary {
	return EpochSummary{
		Sequence: e.Sequence, MilestoneIndex: e.MilestoneIndex, EpochID: e.EpochID, Root: e.MerkleRoot,
		ReadingCount: e.ReadingCount, StartTime: e.StartTime, EndTime: e.EndTime, Score: e.Score,
		ConflictBps: e.ConflictBps, RiskBps: e.RiskBps, Compliant: e.Compliant, Penalties: e.Penalties,
		DecisionPass: e.DecisionPass, DecisionAction: e.DecisionAction, Reasons: e.DecisionReasons,
		CommitTx: e.CommitTxHash, ProofVerified: e.ProofVerified, CreatedAt: e.CreatedAt,
		LatE6: e.LatE6, LonE6: e.LonE6, MaxHumidityX100: e.MaxHumidityX100, MaxShockX100: e.MaxShockX100, HeldDistanceM: e.HeldDistanceM,
		Sources: []EpochSource{}, SourcesTx: e.SourcesTxHash,
	}
}

// FacilityView is the on-chain state of a facility. Amounts are USDG base units (6 decimals) as decimal strings.
type FacilityView struct {
	Status         string `json:"status"`
	Exporter       string `json:"exporter"`
	Financier      string `json:"financier"`
	Buyer          string `json:"buyer"`
	Committed      string `json:"committed"`
	Drawn          string `json:"drawn"`
	Remaining      string `json:"remaining"`
	FeeBps         int    `json:"feeBps"`
	NextMilestone  int    `json:"nextMilestone"`
	MilestoneCount int    `json:"milestoneCount"`
	PausedAt       uint64 `json:"pausedAt"`
	PauseReason    string `json:"pauseReason,omitempty"`
	PauseCount     uint32 `json:"pauseCount"`
	Funded         bool   `json:"funded"`
	VaultPaused    bool   `json:"vaultPaused"`
	Closed         bool   `json:"closed"`
}

// ShipmentView is the combined operational view of a shipment.
type ShipmentView struct {
	Shipment       store.Shipment    `json:"shipment"`
	Milestones     []store.Milestone `json:"milestones"`
	Facility       *FacilityView     `json:"facility"`
	LatestEvidence *EpochSummary     `json:"latestEvidence"`
	Quarantined    int               `json:"quarantinedReadings"`
	USDGDecimals   int               `json:"usdgDecimals"`
	Cover          *store.Cover      `json:"cover"`           // the accepted default cover, null when there is none
	OpenOffers     int               `json:"openCoverOffers"` // cover offers waiting for the financier
	// Title is the v3 electronic bill of lading bound to the facility, null when none is.
	Title *TitleView `json:"title"`
}

// TitleView summarises the bill of lading bound to a shipment.
type TitleView struct {
	TokenID string `json:"tokenId"`
	Status  string `json:"status" enum:"ISSUED,SURRENDERED,VOID"`
	Holder  string `json:"holder"`
}

// View assembles a shipment's store record and its live chain state. The chain decides milestone state:
// the database's release flags can lag the indexer, the facility cursor cannot.
func (s *Service) View(ctx context.Context, shipmentID string) (ShipmentView, error) {
	id, canon, err := parseID(shipmentID)
	if err != nil {
		return ShipmentView{}, err
	}
	sh, err := s.o.Store.GetShipment(ctx, canon)
	if err != nil {
		return ShipmentView{}, mapStoreErr(err)
	}
	ms, err := s.o.Store.Milestones(ctx, canon)
	if err != nil {
		return ShipmentView{}, err
	}
	v := ShipmentView{Shipment: sh, Milestones: ms, USDGDecimals: 6}
	if v.Milestones == nil {
		v.Milestones = []store.Milestone{}
	}

	f, err := s.o.Chain.Facility(ctx, id)
	switch {
	case chain.IsRevert(err, "FacilityNotFound"):
		// no facility yet
	case err != nil:
		return ShipmentView{}, err
	default:
		vault, err := s.o.Chain.VaultFacility(ctx, id)
		if err != nil {
			return ShipmentView{}, err
		}
		fv := &FacilityView{
			Status: chain.StatusName(f.Status), Exporter: addrHex(f.Exporter), Financier: addrHex(f.Financier), Buyer: addrHex(f.Buyer),
			Committed: vault.Committed.String(), Drawn: vault.Drawn.String(),
			Remaining: new(big.Int).Sub(vault.Committed, vault.Drawn).String(),
			FeeBps:    int(f.FeeBps), NextMilestone: int(f.NextMilestone), MilestoneCount: int(f.MilestoneCount),
			PausedAt: f.PausedAt, PauseCount: f.PauseCount, Funded: vault.Funded, VaultPaused: vault.Paused, Closed: vault.Closed,
		}
		if f.PauseReason != ([32]byte{}) {
			fv.PauseReason = hex32(f.PauseReason)
		}
		v.Facility = fv
		for i := range v.Milestones {
			v.Milestones[i].IsReleased = v.Milestones[i].Index < int(f.NextMilestone)
		}
	}

	if latest, err := s.o.Store.LatestEpoch(ctx, canon); err == nil {
		sum := summarize(latest)
		v.LatestEvidence = &sum
	} else if !errors.Is(err, store.ErrNotFound) {
		return ShipmentView{}, err
	}
	if q, err := s.o.Store.Quarantined(ctx, canon, 1000); err == nil {
		v.Quarantined = len(q)
	}
	cv, err := s.o.Store.CoverOf(ctx, canon)
	if err != nil {
		return ShipmentView{}, err
	}
	v.Cover, v.OpenOffers = cv.Cover, len(cv.Offers)
	if s.o.Chain.HasEBL() {
		bills, err := s.o.Store.Bills(ctx, "")
		if err != nil {
			return ShipmentView{}, err
		}
		for _, b := range bills {
			if b.BoundShipmentID != nil && *b.BoundShipmentID == canon {
				v.Title = &TitleView{TokenID: b.TokenID, Status: b.Status, Holder: b.Holder}
			}
		}
	}
	return v, nil
}

// Cover returns a shipment's open default-cover offers and its accepted cover, as indexed from the CoverPool.
func (s *Service) Cover(ctx context.Context, shipmentID string) (store.ShipmentCover, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return store.ShipmentCover{}, err
	}
	if _, err := s.o.Store.GetShipment(ctx, canon); err != nil {
		return store.ShipmentCover{}, mapStoreErr(err)
	}
	return s.o.Store.CoverOf(ctx, canon)
}

// Epochs lists a shipment's epochs without their readings.
func (s *Service) Epochs(ctx context.Context, shipmentID string) ([]EpochSummary, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return nil, err
	}
	if _, err := s.o.Store.GetShipment(ctx, canon); err != nil {
		return nil, mapStoreErr(err)
	}
	recs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return nil, err
	}
	refs, err := s.o.Store.ReadingSources(ctx, canon)
	if err != nil {
		return nil, err
	}
	devices, err := s.o.Store.DevicesOnChain(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]EpochSummary, len(recs))
	for i, r := range recs {
		out[i] = summarize(r)
		for _, ref := range store.EpochSourceRefs(r, refs) {
			d := devices[ref.KeyHash]
			out[i].Sources = append(out[i].Sources, EpochSource{KeyHash: ref.KeyHash, DeviceClass: ref.DeviceClass, OnChain: d.Registered && !d.Revoked})
		}
	}
	return out, nil
}

// AuditEntry is one line of the merged audit trail.
type AuditEntry struct {
	Time   time.Time      `json:"time"`
	Kind   string         `json:"kind"` // chain_event, monitoring, epoch or action
	Title  string         `json:"title"`
	TxHash string         `json:"txHash,omitempty"`
	Detail map[string]any `json:"detail,omitempty"`
}

// Audit merges chain events, monitoring decisions, evidence epochs and sent transactions into one
// time-ordered trail, each traceable to a transaction hash where one exists.
func (s *Service) Audit(ctx context.Context, shipmentID string, limit int) ([]AuditEntry, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return nil, err
	}
	if _, err := s.o.Store.GetShipment(ctx, canon); err != nil {
		return nil, mapStoreErr(err)
	}
	if limit < 1 || limit > 2000 {
		limit = 500
	}
	var out []AuditEntry

	evs, err := s.o.Store.ChainEvents(ctx, canon, 2000)
	if err != nil {
		return nil, err
	}
	for _, e := range evs {
		out = append(out, AuditEntry{Time: e.CreatedAt, Kind: "chain_event", Title: e.Contract + "." + e.Name, TxHash: e.TxHash,
			Detail: map[string]any{"block": e.BlockNumber, "logIndex": e.LogIndex, "args": e.Args}})
	}
	ai, err := s.o.Store.AIEvents(ctx, canon, 2000)
	if err != nil {
		return nil, err
	}
	for _, a := range ai {
		title := a.ActionType + " " + a.ReasonCode
		if msg, ok := a.Data["message"].(string); ok && msg != "" {
			title = a.ActionType + ": " + msg // a held milestone says where it waits and how far away the cargo is
		}
		out = append(out, AuditEntry{Time: a.CreatedAt, Kind: "monitoring", Title: title, TxHash: a.TxHash,
			Detail: map[string]any{"severity": a.Severity, "epochId": a.EpochID, "onchainActionTriggered": a.OnchainActionTriggered, "data": a.Data}})
	}
	epochs, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return nil, err
	}
	for _, e := range epochs {
		out = append(out, AuditEntry{Time: e.CreatedAt, Kind: "epoch", TxHash: e.CommitTxHash,
			Title:  fmt.Sprintf("Epoch M%d#%d score %d %s", e.MilestoneIndex, e.Sequence, e.Score, e.DecisionAction),
			Detail: map[string]any{"epochId": e.EpochID, "root": e.MerkleRoot, "conflictBps": e.ConflictBps, "riskBps": e.RiskBps, "compliant": e.Compliant}})
	}
	actions, err := s.o.Store.Actions(ctx, canon)
	if err != nil {
		return nil, err
	}
	for _, a := range actions {
		out = append(out, AuditEntry{Time: a.UpdatedAt, Kind: "action", Title: a.Kind + " " + a.Status, TxHash: a.TxHash,
			Detail: map[string]any{"key": a.Key, "error": a.Error}})
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Time.Before(out[j].Time) })
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}
