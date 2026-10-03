package service

import (
	"context"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epcis"
)

// EPCISDocument renders the shipment as a GS1 EPCIS 2.0 JSON-LD document (see package epcis).
func (s *Service) EPCISDocument(ctx context.Context, shipmentID string) (map[string]any, error) {
	_, canon, err := parseID(shipmentID)
	if err != nil {
		return nil, err
	}
	sh, err := s.o.Store.GetShipment(ctx, canon)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	ms, err := s.o.Store.Milestones(ctx, canon)
	if err != nil {
		return nil, err
	}
	eps, err := s.o.Store.Epochs(ctx, canon)
	if err != nil {
		return nil, err
	}
	evs, err := s.o.Store.ChainEvents(ctx, canon, 5000)
	if err != nil {
		return nil, err
	}
	return epcis.Document(epcis.Export{Shipment: sh, Milestones: ms, Epochs: eps, Events: evs, Created: time.Now()}), nil
}
