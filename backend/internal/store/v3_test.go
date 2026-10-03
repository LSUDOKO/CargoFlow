package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func TestParametricCoversCarryTheirTriggerAndTriggeredStatus(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	ins, fin := hex40('a'), hex40('c')
	ev := func(tx byte, log int, name string, args map[string]any) store.ChainEvent {
		return store.ChainEvent{TxHash: hex64(tx), LogIndex: log, BlockNumber: uint64(log + 10), BlockHash: hex64('0'), Contract: "CoverPool",
			Name: name, ShipmentID: id, Args: args}
	}
	save := func(evs ...store.ChainEvent) {
		t.Helper()
		if _, err := s.SaveChainEvents(ctx, evs); err != nil {
			t.Fatal(err)
		}
		if err := s.RebuildCover(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	// offerParametricCover logs CoverOffered, then the terms, in one transaction
	save(ev('1', 0, "CoverOffered", map[string]any{"insurer": ins, "amount": "5000000000", "premiumBps": float64(400)}),
		ev('1', 1, "ParametricTermsOffered", map[string]any{"insurer": ins, "consecutiveFailedEpochs": float64(3), "salvageToExporter": "1000000000"}))
	c, err := s.CoverOf(ctx, id)
	if err != nil || len(c.Offers) != 1 || c.Offers[0].Parametric == nil || c.Offers[0].Parametric.ConsecutiveFailedEpochs != 3 || c.Offers[0].Parametric.SalvageToExporter != "1000000000" {
		t.Fatalf("offer = %+v %v", c.Offers, err)
	}
	save(ev('2', 2, "CoverAccepted", map[string]any{"insurer": ins, "financier": fin, "amount": "5000000000", "premium": "200000000"}))
	if err := s.SetCoverEpochFloor(ctx, id, 4); err != nil {
		t.Fatal(err)
	}
	save(ev('3', 3, "ParametricTriggered", map[string]any{"triggeredBy": fin, "financierPayout": "3500000000", "exporterSalvage": "1000000000", "insurerReturn": "500000000"}))
	c, _ = s.CoverOf(ctx, id)
	p := c.Cover.Parametric
	if c.Cover.Status != "TRIGGERED" || c.Cover.FinancierPayout != "3500000000" || c.Cover.InsurerReturn != "500000000" || p == nil ||
		p.ExporterSalvage != "1000000000" || p.EpochFloor == nil || *p.EpochFloor != 4 {
		t.Fatalf("triggered cover = %+v %+v", c.Cover, p)
	}
}

func TestBillsDevicesAndEpochSourcesFoldFromIndexedEvents(t *testing.T) {
	s, id := withShipment(t)
	ctx := context.Background()
	carrier, shipper, buyer := hex40('a'), hex40('b'), hex40('d')
	at := time.Unix(1_800_000_000, 0)
	evs := []store.ChainEvent{
		{TxHash: hex64('1'), LogIndex: 0, BlockNumber: 1, BlockHash: hex64('0'), Contract: "EBLRegistry", Name: "Transfer",
			Args: map[string]any{"from": "0x0000000000000000000000000000000000000000", "to": shipper, "tokenId": "1"}, CreatedAt: at},
		{TxHash: hex64('1'), LogIndex: 1, BlockNumber: 1, BlockHash: hex64('0'), Contract: "EBLRegistry", Name: "BillIssued",
			Args: map[string]any{"tokenId": "1", "issuer": carrier, "shipper": shipper, "consignee": buyer, "documentHash": hex64('e')}, CreatedAt: at},
		{TxHash: hex64('2'), LogIndex: 0, BlockNumber: 2, BlockHash: hex64('0'), Contract: "FinancingController", Name: "TitleBound", ShipmentID: id,
			Args: map[string]any{"shipmentId": id, "tokenId": "1", "exporter": shipper}, CreatedAt: at},
		{TxHash: hex64('3'), LogIndex: 0, BlockNumber: 3, BlockHash: hex64('0'), Contract: "EBLRegistry", Name: "Transfer",
			Args: map[string]any{"from": shipper, "to": buyer, "tokenId": "1"}, CreatedAt: at},
		{TxHash: hex64('4'), LogIndex: 0, BlockNumber: 4, BlockHash: hex64('0'), Contract: "DeviceRegistry", Name: "DeviceRegistered",
			Args: map[string]any{"deviceKeyHash": hex64('f'), "owner": shipper, "deviceClass": float64(2), "attestationHash": hex64('9'), "registeredBy": carrier}, CreatedAt: at},
		{TxHash: hex64('5'), LogIndex: 0, BlockNumber: 5, BlockHash: hex64('0'), Contract: "DeviceRegistry", Name: "DeviceRevoked",
			Args: map[string]any{"deviceKeyHash": hex64('f'), "revokedBy": shipper, "reason": hex64('0')}, CreatedAt: at},
	}
	if _, err := s.SaveChainEvents(ctx, evs); err != nil {
		t.Fatal(err)
	}
	bills, err := s.Bills(ctx, "")
	if err != nil || len(bills) != 1 {
		t.Fatalf("bills = %+v %v", bills, err)
	}
	b := bills[0]
	if b.Holder != buyer || b.Status != "ISSUED" || b.Transfers != 1 || len(b.History) != 2 || b.BoundShipmentID == nil || *b.BoundShipmentID != id {
		t.Fatalf("bill = %+v", b)
	}
	if tok, ok, err := s.BillByDocument(ctx, hex64('e')); err != nil || !ok || tok != "1" {
		t.Fatalf("bill by document = %s %v %v", tok, ok, err)
	}
	devs, err := s.DevicesOnChain(ctx, hex64('f'))
	if err != nil || !devs[hex64('f')].Registered || !devs[hex64('f')].Revoked || devs[hex64('f')].DeviceClass != store.ClassSecureElement {
		t.Fatalf("devices = %+v %v", devs, err)
	}

	// epoch sources: the devices behind an epoch's readings
	pub := make([]byte, 32)
	pub[0] = 7
	if err := s.UpsertSource(ctx, store.Source{ID: "gw", PublicKey: pub, SensorIDs: []string{"s1"}}); err != nil {
		t.Fatal(err)
	}
	p := telemetry.Point{Timestamp: 1_800_000_000, SensorID: "s1", TemperatureX100: 500, LatitudeE6: 1, LongitudeE6: 1}
	if _, err := s.InsertPoint(ctx, id, p, "gw"); err != nil {
		t.Fatal(err)
	}
	refs, err := s.ReadingSources(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	got := store.EpochSourceRefs(store.EpochRecord{Points: []telemetry.Point{p, p}}, refs)
	if len(got) != 1 || got[0].KeyHash != store.KeyHash(pub) || got[0].DeviceClass != store.ClassSoftware {
		t.Fatalf("epoch sources = %+v", got)
	}
}
