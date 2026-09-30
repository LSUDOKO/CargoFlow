package service_test

import (
	"context"
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// env is a service wired to a real anvil chain and a real Postgres schema, exactly as in production.
type env struct {
	svc                                              *service.Service
	store                                            *store.Store
	chain                                            *chain.Client
	hub                                              *ws.Hub
	exporter, financier, buyer, worker, monitor, mgr *chain.Signer
}

var testRoute = []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}

func usdg(n int64) *big.Int { return new(big.Int).Mul(big.NewInt(n), big.NewInt(1_000_000)) }

func idHex(id [32]byte) string { return "0x" + hex.EncodeToString(id[:]) }

func newEnv(t *testing.T, prover proof.Prover) *env {
	t.Helper()
	ce := chaintest.Start(t)
	m, err := chain.LoadManifest(ce.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	c, err := chain.Dial(context.Background(), ce.RPCURL, m)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)

	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	st := store.New(pool)
	hub := ws.NewHub(256)
	sg := func(n string) *chain.Signer { return chain.NewSigner(ce.Keys[n]) }
	e := &env{
		store: st, chain: c, hub: hub,
		exporter: sg("exporter"), financier: sg("financier"), buyer: sg("buyer"),
		worker: sg("worker"), monitor: sg("monitor"), mgr: sg("deployer"),
	}
	e.svc = service.New(service.Options{
		Store: st, Chain: c, Hub: hub, Prover: prover,
		Worker: e.worker, Monitor: e.monitor, Manager: e.mgr,
		SaltSecret: []byte("service test operator secret"),
	})
	return e
}

var testPolicy = chain.Policy{
	MinTempX100: 200, MaxTempX100: 800, MaxEvidenceAgeSec: 1800, MaxRouteDeviationM: 25_000,
	MinEvidenceScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500, RequiresZK: false,
}

// onChain registers a shipment and reveals its policy, optionally creating, funding and starting a facility.
type stage int

const (
	registered stage = iota
	withFacility
	funded
	active
)

func (e *env) onChain(t *testing.T, ref string, route []store.RoutePoint, upTo stage) [32]byte {
	t.Helper()
	ctx := context.Background()
	commitment, err := e.chain.HashPolicy(ctx, testPolicy)
	if err != nil {
		t.Fatal(err)
	}
	refHash := crypto.Keccak256Hash([]byte(ref))
	id, err := e.chain.ShipmentID(ctx, e.exporter.Address(), refHash)
	if err != nil {
		t.Fatal(err)
	}
	must := func(_ chain.TxResult, err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	rc := service.RouteCommitment(route)
	must(e.chain.Transact(ctx, e.exporter, "registry", "registerShipment", [32]byte(refHash), e.buyer.Address(),
		[32]byte(crypto.Keccak256Hash([]byte("invoice"))), rc, commitment, usdg(100_000)))
	must(e.chain.Transact(ctx, e.exporter, "policies", "setPolicy", id, testPolicy))
	if upTo == registered {
		return id
	}
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	must(e.chain.Transact(ctx, e.exporter, "controller", "createFacility", id, e.financier.Address(), uint16(300), ms))
	if upTo == withFacility {
		return id
	}
	must(e.chain.Transact(ctx, e.financier, "usdg", "mint", e.financier.Address(), usdg(40_000)))
	must(e.chain.Transact(ctx, e.financier, "usdg", "approve", e.chain.M.Vault, usdg(40_000)))
	must(e.chain.Transact(ctx, e.financier, "controller", "depositCapital", id))
	if upTo == funded {
		return id
	}
	must(e.chain.Transact(ctx, e.exporter, "controller", "startTransit", id))
	return id
}
