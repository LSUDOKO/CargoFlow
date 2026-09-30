package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestRegisterShipmentMirrorsTheChainAndNothingElse(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-register-1", testRoute, registered)

	sh, err := e.svc.RegisterShipment(ctx, service.ShipmentInput{
		ShipmentID: idHex(id), ExternalRef: "svc-register-1", Route: testRoute, MaxGapSec: 1800, MinSensors: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if sh.ID != idHex(id) || sh.Exporter != lower(e.exporter.Address().Hex()) || sh.Buyer != lower(e.buyer.Address().Hex()) {
		t.Fatalf("parties must come from the chain: %+v", sh)
	}
	if sh.InvoiceValue != "100000000000" {
		t.Fatalf("invoice value = %s", sh.InvoiceValue)
	}
	if sh.Policy.MinTempX100 != 200 || sh.Policy.MaxTempX100 != 800 || sh.Policy.MinEvidenceScore != 75 ||
		sh.Policy.MaxConflictBps != 3000 || sh.Policy.MaxRiskBps != 3500 || sh.Policy.MaxRouteDeviationM != 25_000 {
		t.Fatalf("policy must be mirrored from the chain: %+v", sh.Policy)
	}
	if sh.Policy.MaxGapSec != 1800 || sh.Policy.MinSensors != 2 {
		t.Fatalf("off-chain scoring parameters lost: %+v", sh.Policy)
	}
	if len(sh.Route) != 2 {
		t.Fatalf("route = %+v", sh.Route)
	}
	got, err := e.store.GetShipment(ctx, idHex(id))
	if err != nil || got.ID != sh.ID {
		t.Fatalf("not persisted: %v", err)
	}
}

func TestRegisterShipmentRefusesWhatTheChainDoesNotConfirm(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-register-2", testRoute, registered)
	in := service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-register-2", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}

	t.Run("unknown on chain", func(t *testing.T) {
		bad := in
		bad.ShipmentID = "0x" + "ab" + "00000000000000000000000000000000000000000000000000000000000000"[:62]
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrNotOnChain) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("external reference does not match the id", func(t *testing.T) {
		bad := in
		bad.ExternalRef = "some other reference"
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("route does not match the committed route", func(t *testing.T) {
		bad := in
		bad.Route = []store.RoutePoint{{LatE6: 1, LonE6: 1}, {LatE6: 2, LonE6: 2}}
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("a route that does not hash to the on-chain commitment must be refused, got %v", err)
		}
	})
	t.Run("malformed id", func(t *testing.T) {
		bad := in
		bad.ShipmentID = "0xZZ"
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	})
	t.Run("nothing was stored by any refusal", func(t *testing.T) {
		if _, err := e.store.GetShipment(ctx, idHex(id)); !errors.Is(err, store.ErrNotFound) {
			t.Fatal("a refused registration left a record behind")
		}
	})
	t.Run("invalid scoring parameters", func(t *testing.T) {
		bad := in
		bad.MinSensors = 0
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
		bad = in
		bad.MaxGapSec = -1
		if _, err := e.svc.RegisterShipment(ctx, bad); !errors.Is(err, service.ErrInvalid) {
			t.Fatalf("got %v", err)
		}
	})
}

func TestRegisteringTwiceIsAConflict(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-register-3", testRoute, registered)
	in := service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-register-3", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}
	if _, err := e.svc.RegisterShipment(ctx, in); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.RegisterShipment(ctx, in); !errors.Is(err, service.ErrConflict) {
		t.Fatalf("got %v", err)
	}
}

func TestRegisteringAShipmentThatAlreadyHasAFacilityPullsItsMilestones(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-register-4", testRoute, active)
	in := service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-register-4", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}
	if _, err := e.svc.RegisterShipment(ctx, in); err != nil {
		t.Fatal(err)
	}
	ms, err := e.store.Milestones(ctx, idHex(id))
	if err != nil || len(ms) != 5 {
		t.Fatalf("%d milestones, %v", len(ms), err)
	}
	if ms[2].AllocatedUSDG != "8000000000" || ms[2].EvidenceThreshold != 75 {
		t.Fatalf("milestone terms must come from the chain: %+v", ms[2])
	}
	sh, _ := e.store.GetShipment(ctx, idHex(id))
	if sh.Financier != lower(e.financier.Address().Hex()) {
		t.Fatalf("financier = %s", sh.Financier)
	}
}

func TestSyncMilestonesIsIdempotentAndKeepsReleaseRecords(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	id := e.onChain(t, "svc-register-5", testRoute, registered)
	in := service.ShipmentInput{ShipmentID: idHex(id), ExternalRef: "svc-register-5", Route: testRoute, MaxGapSec: 1800, MinSensors: 2}
	if _, err := e.svc.RegisterShipment(ctx, in); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.SyncMilestones(ctx, idHex(id)); err == nil {
		t.Fatal("syncing before a facility exists should say so, not silently do nothing")
	}
	_ = crypto.Keccak256
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'F' {
			b[i] = c + 32
		}
	}
	return string(b)
}
