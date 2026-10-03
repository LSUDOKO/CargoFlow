package store

import (
	"context"
	"math"
	"strings"
	"time"
)

// ExporterStats is an address's record as an exporter. Volume is the summed invoice value in USDG base units.
type ExporterStats struct {
	Shipments        int      `json:"shipments"`
	Settled          int      `json:"settled"`
	Active           int      `json:"active"`
	Paused           int      `json:"paused"`
	Disputed         int      `json:"disputed"`
	Defaulted        int      `json:"defaulted"`
	Recoveries       int      `json:"recoveries"`       // facilities resumed after a pause
	AvgEvidenceScore *float64 `json:"avgEvidenceScore"` // nil before any evidence epoch
	Volume           string   `json:"volume"`
}

// FinancierStats is an address's record as a financier, in USDG base units.
type FinancierStats struct {
	Facilities int    `json:"facilities"`
	Committed  string `json:"committed"`  // summed milestone allocations
	Drawn      string `json:"drawn"`      // summed releases seen on chain
	InEscrow   string `json:"inEscrow"`   // committed but undrawn on facilities that are still open
	FeesEarned string `json:"feesEarned"` // fees paid at settlement
	Settled    int    `json:"settled"`
	Defaulted  int    `json:"defaulted"`
}

// BuyerStats is an address's record as a buyer.
type BuyerStats struct {
	Shipments  int    `json:"shipments"`
	Settled    int    `json:"settled"`
	PaidVolume string `json:"paidVolume"` // invoice value of settled shipments, USDG base units
	defaulted  int
}

// InsurerStats is an address's record as a default-cover insurer, in USDG base units.
type InsurerStats struct {
	Offered        int    `json:"offered"`        // facilities it offered cover on
	Active         int    `json:"active"`         // accepted covers still backing a facility
	Released       int    `json:"released"`       // covers returned after the facility settled
	Claimed        int    `json:"claimed"`        // covers that paid a financier after a default
	CoverWritten   string `json:"coverWritten"`   // summed amount of accepted covers
	PremiumsEarned string `json:"premiumsEarned"` // premiums received on accepted covers
	PaidOut        string `json:"paidOut"`        // paid to financiers on claimed covers
}

// PartyStats is an address's track record across the roles it has held, computed from the mirrored shipments and
// the indexed chain events.
type PartyStats struct {
	Address   string         `json:"address"`
	Exporter  ExporterStats  `json:"exporter"`
	Financier FinancierStats `json:"financier"`
	Buyer     BuyerStats     `json:"buyer"`
	Insurer   InsurerStats   `json:"insurer"`
	Since     *time.Time     `json:"since"` // first shipment involving the address, nil when there is none
}

// Grade summarises a track record: "new" before any settled or defaulted shipment, "A" for a clean record (no
// default as exporter or buyer, no open dispute, evidence averaging at least 80), "B" when at most a fifth of the
// outcomes it was answerable for were defaults, and "C" otherwise. A financier is not marked down for a borrower's
// default.
func (p PartyStats) Grade() string {
	good := p.Exporter.Settled + p.Buyer.Settled + p.Financier.Settled
	bad := p.Exporter.Defaulted + p.Buyer.defaulted
	switch {
	case good+bad == 0:
		return "new"
	case bad == 0 && p.Exporter.Disputed == 0 && (p.Exporter.AvgEvidenceScore == nil || *p.Exporter.AvgEvidenceScore >= 80):
		return "A"
	case bad*5 <= good+bad:
		return "B"
	}
	return "C"
}

// openFacility lists the statuses in which committed capital still sits in escrow.
const openFacility = `('FINANCED', 'ACTIVE', 'PAUSED', 'DISPUTED', 'DELIVERED')`

// PartyStats computes addr's track record. An address the store has never seen gets zeros and a nil Since.
func (s *Store) PartyStats(ctx context.Context, addr string) (PartyStats, error) {
	addr = strings.ToLower(addr)
	p := PartyStats{Address: addr}
	ex, fi, bu := &p.Exporter, &p.Financier, &p.Buyer

	err := s.pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status = 'SETTLED'), count(*) FILTER (WHERE status = 'ACTIVE'),
		       count(*) FILTER (WHERE status = 'PAUSED'), count(*) FILTER (WHERE status = 'DISPUTED'),
		       count(*) FILTER (WHERE status = 'DEFAULTED'), COALESCE(sum(invoice_value), 0)::text,
		       (SELECT count(*) FROM chain_events ce JOIN shipments s2 ON s2.shipment_id = ce.shipment_id
		         WHERE s2.exporter = $1 AND ce.event_name = 'FinancingResumed'),
		       (SELECT avg(e.score)::float8 FROM telemetry_epochs e JOIN shipments s3 ON s3.shipment_id = e.shipment_id WHERE s3.exporter = $1)
		FROM shipments WHERE exporter = $1`, addr).
		Scan(&ex.Shipments, &ex.Settled, &ex.Active, &ex.Paused, &ex.Disputed, &ex.Defaulted, &ex.Volume, &ex.Recoveries, &ex.AvgEvidenceScore)
	if err != nil {
		return p, mapErr(err)
	}
	if ex.AvgEvidenceScore != nil {
		v := math.Round(*ex.AvgEvidenceScore*10) / 10
		ex.AvgEvidenceScore = &v
	}

	err = s.pool.QueryRow(ctx, `
		WITH mine AS (SELECT shipment_id, status FROM shipments WHERE financier = $1),
		committed AS (SELECT m.shipment_id, sum(m.allocated_usdg) AS amount FROM financing_milestones m JOIN mine USING (shipment_id) GROUP BY m.shipment_id),
		drawn AS (SELECT ce.shipment_id, sum((ce.args->>'amount')::numeric) AS amount FROM chain_events ce JOIN mine USING (shipment_id)
		          WHERE ce.event_name = 'MilestoneAdvanceReleased' GROUP BY ce.shipment_id)
		SELECT (SELECT count(*) FROM mine),
		       (SELECT COALESCE(sum(amount), 0) FROM committed)::text,
		       (SELECT COALESCE(sum(amount), 0) FROM drawn)::text,
		       (SELECT COALESCE(sum(GREATEST(c.amount - COALESCE(d.amount, 0), 0)), 0) FROM mine
		          JOIN committed c USING (shipment_id) LEFT JOIN drawn d USING (shipment_id) WHERE mine.status IN `+openFacility+`)::text,
		       (SELECT COALESCE(sum((ce.args->>'fee')::numeric), 0) FROM chain_events ce JOIN mine USING (shipment_id)
		          WHERE ce.event_name = 'FacilitySettled')::text,
		       (SELECT count(*) FROM mine WHERE status = 'SETTLED'), (SELECT count(*) FROM mine WHERE status = 'DEFAULTED')`, addr).
		Scan(&fi.Facilities, &fi.Committed, &fi.Drawn, &fi.InEscrow, &fi.FeesEarned, &fi.Settled, &fi.Defaulted)
	if err != nil {
		return p, mapErr(err)
	}

	err = s.pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE status = 'SETTLED'), count(*) FILTER (WHERE status = 'DEFAULTED'),
		       COALESCE(sum(invoice_value) FILTER (WHERE status = 'SETTLED'), 0)::text
		FROM shipments WHERE buyer = $1`, addr).Scan(&bu.Shipments, &bu.Settled, &bu.defaulted, &bu.PaidVolume)
	if err != nil {
		return p, mapErr(err)
	}

	in := &p.Insurer
	err = s.pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM cover_offers WHERE insurer = $1),
		       count(*) FILTER (WHERE status = 'ACTIVE'), count(*) FILTER (WHERE status = 'RELEASED'),
		       count(*) FILTER (WHERE status = 'CLAIMED'), COALESCE(sum(amount), 0)::text, COALESCE(sum(premium), 0)::text,
		       COALESCE(sum(financier_payout), 0)::text
		FROM covers WHERE insurer = $1`, addr).
		Scan(&in.Offered, &in.Active, &in.Released, &in.Claimed, &in.CoverWritten, &in.PremiumsEarned, &in.PaidOut)
	if err != nil {
		return p, mapErr(err)
	}

	err = s.pool.QueryRow(ctx, "SELECT min(created_at) FROM shipments WHERE exporter = $1 OR buyer = $1 OR financier = $1", addr).Scan(&p.Since)
	return p, mapErr(err)
}
