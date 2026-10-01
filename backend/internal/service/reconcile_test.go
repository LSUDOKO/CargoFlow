package service_test

import (
	"context"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

// serviceWith builds a second service over the same store and chain, as if the operator had restarted
// the backend with different keys or settings.
func (e *env) serviceWith(worker, monitor *chain.Signer, tune func(*service.Options)) *service.Service {
	o := service.Options{
		Store: e.store, Chain: e.chain, Hub: e.hub, Worker: worker, Monitor: monitor, Manager: e.mgr,
		SaltSecret: []byte("service test operator secret"),
	}
	if tune != nil {
		tune(&o)
	}
	return service.New(o)
}

// repaired is the same backend restarted with working keys and no waiting between retries.
func (e *env) repaired() *service.Service {
	return e.serviceWith(e.worker, e.monitor, func(o *service.Options) { o.ReconcileBackoff = time.Nanosecond })
}

func hasKey(keys []string, prefix string) bool {
	for _, k := range keys {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

func TestReconcilerCompletesAnEpochWhoseCommitFailedAndReleasesItsTranche(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-rec-1")
	tl := newTimeline(t, e)
	fixed := e.repaired()
	broken := e.serviceWith(e.exporter, e.monitor, nil) // the exporter key holds no EVIDENCE_VERIFIER role
	before, _ := e.chain.USDGBalance(ctx, e.exporter.Address())

	res, err := broken.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8))
	if err != nil {
		t.Fatal(err)
	}
	o := res.Epochs[0]
	if o.CommitTx != "" || o.ReleaseTx != "" || !strings.Contains(o.Error, "commit") {
		t.Fatalf("setup: the commit should have failed: %+v", o)
	}

	rep, err := fixed.Reconcile(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !hasKey(rep.Retried, "commit:") || !hasKey(rep.Retried, "release:") || len(rep.Errors) != 0 {
		t.Fatalf("report = %+v", rep)
	}
	if f, _ := e.chain.Facility(ctx, id); f.NextMilestone != 1 {
		t.Fatalf("facility = %+v", f)
	}
	after, _ := e.chain.USDGBalance(ctx, e.exporter.Address())
	if new(big.Int).Sub(after, before).Cmp(usdg(8_000)) != 0 {
		t.Fatalf("exporter gained %s", new(big.Int).Sub(after, before))
	}
	epochs, _ := e.store.Epochs(ctx, hex)
	if epochs[0].CommitTxHash == "" {
		t.Fatal("the stored epoch must record its commit transaction")
	}
	actions, _ := e.store.Actions(ctx, hex)
	for _, a := range actions {
		if a.Status != "CONFIRMED" {
			t.Fatalf("action %+v", a)
		}
	}

	again, _ := fixed.Reconcile(ctx)
	if len(again.Retried) != 0 || len(again.GaveUp) != 0 {
		t.Fatalf("a settled system needs no further work: %+v", again)
	}
}

func TestReconcilerRetriesAPauseThatNeverLanded(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-rec-2")
	tl := newTimeline(t, e)
	fixed := e.repaired()
	broken := e.serviceWith(e.worker, e.exporter, nil) // the exporter key holds no MONITOR role

	res, err := broken.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.ConflictingSensors, 0, 24))
	if err != nil {
		t.Fatal(err)
	}
	if bad := res.Epochs[2]; bad.PauseTx != "" || !strings.Contains(bad.Error, "pause") {
		t.Fatalf("setup: the pause should have failed: %+v", bad)
	}
	if f, _ := e.chain.Facility(ctx, id); f.Status != chain.StatusActive {
		t.Fatalf("setup: facility = %+v", f)
	}

	rep, _ := fixed.Reconcile(ctx)
	if !hasKey(rep.Retried, "pause:") {
		t.Fatalf("report = %+v", rep)
	}
	if f, _ := e.chain.Facility(ctx, id); f.Status != chain.StatusPaused || f.PauseCount != 1 {
		t.Fatalf("the late pause must land: %+v", f)
	}
	if again, _ := fixed.Reconcile(ctx); len(again.Retried) != 0 {
		t.Fatalf("%+v", again)
	}
}

func TestReconcilerLeavesAHealthyShipmentAlone(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-rec-3")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 16)); err != nil {
		t.Fatal(err)
	}
	before, _ := e.store.Actions(ctx, hex)
	rep, err := e.svc.Reconcile(ctx)
	if err != nil || rep.Shipments != 1 || len(rep.Retried) != 0 || len(rep.GaveUp) != 0 || len(rep.Deferred) != 0 {
		t.Fatalf("%+v %v", rep, err)
	}
	if after, _ := e.store.Actions(ctx, hex); len(after) != len(before) {
		t.Fatalf("the reconciler created actions for a healthy shipment: %d -> %d", len(before), len(after))
	}
}

func TestReconcilerBacksOffAndEventuallyGivesUp(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-rec-4")
	tl := newTimeline(t, e)
	broken := e.serviceWith(e.exporter, e.monitor, func(o *service.Options) {
		o.ReconcileMaxAttempts, o.ReconcileBackoff = 2, time.Nanosecond
	})
	if _, err := broken.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}

	for i := 1; i <= 2; i++ { // two retries, both failing for the same permanent reason
		time.Sleep(5 * time.Millisecond)
		rep, _ := broken.Reconcile(ctx)
		if !hasKey(rep.Retried, "commit:") || len(rep.Errors) == 0 {
			t.Fatalf("attempt %d: %+v", i, rep)
		}
	}
	time.Sleep(5 * time.Millisecond)
	rep, _ := broken.Reconcile(ctx)
	if len(rep.Retried) != 0 || !hasKey(rep.GaveUp, "commit:") {
		t.Fatalf("after the cap the reconciler must stop and say so: %+v", rep)
	}
	actions, _ := e.store.Actions(ctx, hex)
	for _, a := range actions {
		if a.Kind == "COMMIT_EPOCH" && (a.Attempts != 2 || a.Status != "FAILED" || a.Error == "") {
			t.Fatalf("action = %+v", a)
		}
	}

}

func TestReconcilerHonoursTheBackoffBetweenAttempts(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-rec-5")
	tl := newTimeline(t, e)
	slow := e.serviceWith(e.exporter, e.monitor, func(o *service.Options) { o.ReconcileBackoff = time.Hour })
	if _, err := slow.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}
	rep, _ := slow.Reconcile(ctx)
	if len(rep.Retried) != 0 || !hasKey(rep.Deferred, "commit:") {
		t.Fatalf("a freshly failed action must wait out its backoff: %+v", rep)
	}
}

func TestReconcilerDoesNotReleaseIntoAPausedFacility(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-rec-6")
	tl := newTimeline(t, e)
	noManager := service.New(service.Options{Store: e.store, Chain: e.chain, Hub: e.hub, Worker: e.worker, Monitor: e.monitor,
		Manager: e.buyer, SaltSecret: []byte("service test operator secret")})
	if _, err := noManager.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.chain.Pause(ctx, e.monitor, id, [32]byte{1}); err != nil {
		t.Fatal(err)
	}

	rep, _ := e.repaired().Reconcile(ctx)
	if hasKey(rep.Retried, "release:") || len(rep.Errors) != 0 {
		t.Fatalf("a paused facility must not be sent a release: %+v", rep)
	}
	if f, _ := e.chain.Facility(ctx, id); f.NextMilestone != 0 {
		t.Fatalf("facility = %+v", f)
	}
}

func TestReconcilerSkipsAReleaseSomeoneElseAlreadyMade(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, id := activeShipment(t, e, "svc-rec-7")
	tl := newTimeline(t, e)
	noManager := service.New(service.Options{Store: e.store, Chain: e.chain, Hub: e.hub, Worker: e.worker, Monitor: e.monitor,
		Manager: e.buyer, SaltSecret: []byte("service test operator secret")})
	if _, err := noManager.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}
	// the exporter may trigger the release itself (the contract allows it); the epoch's own seq is 1
	if _, err := e.chain.ReleaseMilestone(ctx, e.exporter, id, 0, 1); err != nil {
		t.Fatal(err)
	}

	rep, _ := e.repaired().Reconcile(ctx)
	if hasKey(rep.Retried, "release:") {
		t.Fatalf("the chain already shows the milestone released: %+v", rep)
	}
}

func TestReconcilerRestoresACommitHashLostAfterTheTransactionConfirmed(t *testing.T) {
	e := newEnv(t, nil)
	ctx := context.Background()
	hex, _ := activeShipment(t, e, "svc-rec-8")
	tl := newTimeline(t, e)
	if _, err := e.svc.IngestTelemetry(ctx, hex, "", tl.segment(t, simulator.Normal, 0, 8)); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, "UPDATE telemetry_epochs SET commit_tx_hash = NULL WHERE shipment_id = $1", hex); err != nil {
		t.Fatal(err)
	}

	rep, _ := e.repaired().Reconcile(ctx)
	if len(rep.Retried) != 0 {
		t.Fatalf("a confirmed action must not be reported as resent: %+v", rep)
	}
	if epochs, _ := e.store.Epochs(ctx, hex); epochs[0].CommitTxHash == "" {
		t.Fatal("the commit hash must be restored from the confirmed action")
	}
}
