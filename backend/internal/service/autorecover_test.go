package service_test

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/alerts"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

type countingProver struct {
	proof.Prover
	n atomic.Int32
}

func (p *countingProver) Prove(ctx context.Context, req proof.Request) (*proof.Result, error) {
	p.n.Add(1)
	return p.Prover.Prove(ctx, req)
}

type recordingNotifier struct {
	mu  sync.Mutex
	got []alerts.Alert
}

func (r *recordingNotifier) Notify(a alerts.Alert) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.got = append(r.got, a)
}

func TestTheRecoveryWorkerProvesAheadAndTheExporterOnlyCommits(t *testing.T) {
	prover := &countingProver{Prover: realProver(t)}
	e := newEnv(t, prover)
	notes := &recordingNotifier{}
	// the same service, now with alerts and an app URL
	e.svc = service.New(service.Options{
		Store: e.store, Chain: e.chain, Hub: e.hub, Prover: prover, Worker: e.worker, Monitor: e.monitor, Manager: e.mgr,
		SaltSecret: []byte("service test operator secret"), Alerts: notes, AppURL: "https://app.cargoflow.test",
	})
	ctx := context.Background()
	hex, id, tl := pausedByAnomaly(t, e, "svc-autorecover")
	if err := e.store.SetShipmentStatus(ctx, hex, "PAUSED"); err != nil { // the indexer mirrors this in production
		t.Fatal(err)
	}
	commits := func() int {
		actions, _ := e.store.Actions(ctx, hex)
		n := 0
		for _, a := range actions {
			if a.Kind == "COMMIT_EPOCH" {
				n++
			}
		}
		return n
	}

	// nothing to prove yet: the probe has no fresh readings since the pause
	rep, err := e.svc.ScanRecoveries(ctx)
	if err != nil || len(rep.Prepared) != 0 || rep.Examined != 1 || prover.n.Load() != 0 {
		t.Fatalf("scan before fresh readings = %+v %v (proofs %d)", rep, err, prover.n.Load())
	}

	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 24, 8, simulator.SecondarySensor)); err != nil {
		t.Fatal(err)
	}
	before := commits()
	rep, err = e.svc.ScanRecoveries(ctx)
	if err != nil || len(rep.Prepared) != 1 || rep.Prepared[0] != hex || len(rep.Errors) != 0 {
		t.Fatalf("scan = %+v %v", rep, err)
	}
	if commits() != before || prover.n.Load() != 1 {
		t.Fatalf("the worker proves (%d proofs) but commits nothing (%d new commits)", prover.n.Load(), commits()-before)
	}
	if f, _ := e.chain.Facility(ctx, id); f.Status != chain.StatusPaused {
		t.Fatal("the worker must not resume anything")
	}

	// the exporter hears about it in-app and through their alert channels, with the recovery link
	list, unread, err := e.store.Notifications(ctx, e.exporter.Address().Hex(), 10, false)
	if err != nil {
		t.Fatal(err)
	}
	var ready bool
	for _, n := range list {
		if n.Kind == service.NoteRecoveryReady && n.Link == "https://app.cargoflow.test/track/"+hex+"?recover=1" && n.Data["sensorId"] == simulator.SecondarySensor {
			ready = true
		}
	}
	if !ready || unread == 0 {
		t.Fatalf("exporter notifications = %+v", list)
	}
	if buyerList, _, _ := e.store.Notifications(ctx, e.buyer.Address().Hex(), 10, false); len(buyerList) != 0 {
		t.Fatalf("only the exporter can sign a recovery: buyer got %+v", buyerList)
	}
	notes.mu.Lock()
	if len(notes.got) != 1 || notes.got[0].Event != alerts.RecoveryReady || !strings.EqualFold(notes.got[0].Recipient, e.exporter.Address().Hex()) || !strings.HasSuffix(notes.got[0].Link, "?recover=1") {
		t.Fatalf("alerts = %+v", notes.got)
	}
	notes.mu.Unlock()

	// scanning again finds the proof current: no second proof, no second notification
	rep, _ = e.svc.ScanRecoveries(ctx)
	if len(rep.Ready) != 1 || prover.n.Load() != 1 || len(notes.got) != 1 {
		t.Fatalf("rescan = %+v, proofs %d, alerts %d", rep, prover.n.Load(), len(notes.got))
	}

	// the exporter signs: the cached proof is used, only the commit runs
	p, err := e.svc.PrepareRecovery(ctx, hex, simulator.SecondarySensor, e.exporter.Address())
	if err != nil {
		t.Fatal(err)
	}
	if !p.Cached || prover.n.Load() != 1 || p.CommitTx == "" || commits() != before+1 {
		t.Fatalf("prepared = %+v, proofs %d, commits %d", p, prover.n.Load(), commits()-before)
	}
	a, b, c, err := p.Calldata()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.chain.ResumeWithProof(ctx, e.exporter, id, uint8(p.Milestone), uint32(p.Sequence), a, b, c); err != nil {
		t.Fatalf("the cached proof must verify on chain: %v", err)
	}
	if f, _ := e.chain.Facility(ctx, id); f.Status != chain.StatusActive {
		t.Fatalf("after the exporter's proof the facility is %s", chain.StatusName(f.Status))
	}
}

func TestTheRecoveryWorkerNeedsAProver(t *testing.T) {
	e := newEnv(t, nil)
	rep, err := e.svc.ScanRecoveries(context.Background())
	if err != nil || rep.Examined != 0 {
		t.Fatalf("%+v %v", rep, err)
	}
}
