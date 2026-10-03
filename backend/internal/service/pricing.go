package service

import (
	"context"

	"github.com/LSUDOKO/CargoFlow/backend/internal/pricing"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// corridorSample bounds how many shipments' histories feed the corridor statistics.
const corridorSample = 2000

// PricingContext holds what several suggestions share (the corridor history, exporters' grades), so a list of market
// requests costs one history query.
type PricingContext struct {
	history []store.CorridorRow
	grades  map[string]string
}

// NewPricingContext loads the corridor history.
func (s *Service) NewPricingContext(ctx context.Context) (*PricingContext, error) {
	h, err := s.o.Store.CorridorHistory(ctx, corridorSample)
	if err != nil {
		return nil, err
	}
	return &PricingContext{history: h, grades: map[string]string{}}, nil
}

// SuggestFee is the fee guidance for one shipment (see package pricing for the formula).
func (s *Service) SuggestFee(ctx context.Context, shipmentID string) (pricing.Suggestion, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return pricing.Suggestion{}, err
	}
	sh, err := s.o.Store.GetShipment(ctx, canon)
	if err != nil {
		return pricing.Suggestion{}, mapStoreErr(err)
	}
	pc, err := s.NewPricingContext(ctx)
	if err != nil {
		return pricing.Suggestion{}, err
	}
	return s.SuggestFeeFor(ctx, pc, sh)
}

// SuggestFeeFor computes a shipment's suggestion within a shared pricing context.
func (s *Service) SuggestFeeFor(ctx context.Context, pc *PricingContext, sh store.Shipment) (pricing.Suggestion, error) {
	grade, ok := pc.grades[sh.Exporter]
	if !ok {
		p, err := s.o.Store.PartyStats(ctx, sh.Exporter)
		if err != nil {
			return pricing.Suggestion{}, err
		}
		grade = p.Grade()
		pc.grades[sh.Exporter] = grade
	}
	in := pricing.Inputs{ExporterGrade: grade, CargoTemplate: pricing.CargoTemplate(sh.Policy), TenorDays: pricing.TenorDays(sh.Route), CoverStatus: "none"}
	var epochs, excursions, conflicts int
	for _, r := range pc.history {
		if r.ShipmentID == sh.ID || !pricing.SameCorridor(r.Route, sh.Route) {
			continue
		}
		in.CorridorShipments++
		epochs, excursions, conflicts = epochs+r.Epochs, excursions+r.Excursions, conflicts+r.Conflicts
	}
	in.CorridorEpochs = epochs
	in.RouteExcursionRate, in.RouteConflictRate = pricing.Rates(epochs, excursions, conflicts)
	if cv, err := s.o.Store.CoverOf(ctx, sh.ID); err == nil {
		switch {
		case cv.Cover != nil && cv.Cover.Status == "ACTIVE":
			in.CoverStatus = "active"
		case len(cv.Offers) > 0:
			in.CoverStatus = "offered"
		}
	}
	out := pricing.Suggest(in)
	out.ShipmentID = sh.ID
	return out, nil
}
