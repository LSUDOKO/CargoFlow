package epoch_test

import (
	"errors"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func TestSetReliabilityAffectsSubsequentEpochs(t *testing.T) {
	pts := stream(t, simulator.Normal, 16)

	def, _ := epoch.NewProcessor(cfg())
	defEpochs, _ := run(t, def, pts)

	low, _ := epoch.NewProcessor(cfg())
	low.SetReliability(map[string]int{simulator.PrimarySensor: 4000, simulator.SecondarySensor: 4000})
	lowEpochs, _ := run(t, low, pts)

	if lowEpochs[0].Result.Penalties.Source <= defEpochs[0].Result.Penalties.Source {
		t.Fatalf("lower reliability must raise the source penalty: %d vs %d",
			lowEpochs[0].Result.Penalties.Source, defEpochs[0].Result.Penalties.Source)
	}
	if lowEpochs[0].Root.Cmp(defEpochs[0].Root) != 0 {
		t.Fatal("reliability is a scoring input and must not change the committed readings' root")
	}
}

// A process that stops mid-stream and restores from durable storage must produce exactly the epochs an
// uninterrupted process would have: same roots, same scores.
func TestRestoreAfterACrashReproducesTheUninterruptedRun(t *testing.T) {
	all := stream(t, simulator.ConflictingSensors, 40)
	whole, _ := epoch.NewProcessor(cfg())
	want, _ := run(t, whole, all)

	for _, cut := range []int{0, 7, 16, 23, 31, 47, 60, 79} { // crash after this many points
		first, _ := epoch.NewProcessor(cfg())
		got, _ := run(t, first, all[:cut])

		// durable state: every accepted point; closed epochs persisted their own readings
		var seen, pending []telemetry.Point
		closed := map[[2]string]bool{}
		for _, e := range got {
			for _, p := range e.Points {
				closed[[2]string{p.SensorID, itoa(p.Timestamp)}] = true
				seen = append(seen, p)
			}
		}
		for _, p := range all[:cut] {
			if !closed[[2]string{p.SensorID, itoa(p.Timestamp)}] {
				pending = append(pending, p)
			}
		}

		second, _ := epoch.NewProcessor(cfg())
		restored, err := second.Restore(seen, pending)
		if err != nil {
			t.Fatalf("cut %d: restore: %v", cut, err)
		}
		if len(restored) != 0 {
			t.Fatalf("cut %d: pending readings below an epoch must not close one, got %d", cut, len(restored))
		}
		rest, _ := run(t, second, all[cut:])

		combined := append(append([]*epoch.Epoch{}, got...), rest...)
		if len(combined) != len(want) {
			t.Fatalf("cut %d: %d epochs after restart, want %d", cut, len(combined), len(want))
		}
		for i := range want {
			if combined[i].Root.Cmp(want[i].Root) != 0 || combined[i].Result.Score != want[i].Result.Score {
				t.Fatalf("cut %d: epoch %d differs from the uninterrupted run", cut, i)
			}
		}
	}
}

func itoa(n int64) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{digits[n%10]}, b...)
		n /= 10
	}
	return string(b)
}

func TestRestoredProcessorRejectsReplaysOfHistory(t *testing.T) {
	all := stream(t, simulator.Normal, 10)
	first, _ := epoch.NewProcessor(cfg())
	got, _ := run(t, first, all)
	var seen []telemetry.Point
	for _, e := range got {
		seen = append(seen, e.Points...)
	}
	second, _ := epoch.NewProcessor(cfg())
	if _, err := second.Restore(seen, nil); err != nil {
		t.Fatal(err)
	}
	_, err := second.Ingest(seen[3]) // an attacker replays a point from a closed epoch after a restart
	var rej *telemetry.Rejection
	if !errors.As(err, &rej) || rej.Reason != telemetry.ReasonReplay {
		t.Fatalf("replay after restore must be rejected, got %v", err)
	}
}

func TestRestoreThatCompletesAnEpochReturnsIt(t *testing.T) {
	all := stream(t, simulator.Normal, 8) // exactly one epoch of pending points: a crash before it was persisted
	p, _ := epoch.NewProcessor(cfg())
	closed, err := p.Restore(nil, all)
	if err != nil {
		t.Fatal(err)
	}
	if len(closed) != 1 || len(closed[0].Points) != 16 {
		t.Fatalf("restore should hand back the epoch that was never persisted, got %d", len(closed))
	}
}

func TestRestoreRejectsInconsistentHistory(t *testing.T) {
	all := stream(t, simulator.Normal, 4)
	p, _ := epoch.NewProcessor(cfg())
	if _, err := p.Restore(append(all, all[0]), nil); err == nil {
		t.Fatal("history containing a duplicate reading was accepted")
	}
}

func TestFromPointsMatchesTheProcessor(t *testing.T) {
	c := cfg()
	p, _ := epoch.NewProcessor(c)
	es, _ := run(t, p, stream(t, simulator.ConflictingSensors, 8))
	rebuilt, err := epoch.FromPoints(c, es[0].Sequence, es[0].Points)
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt.Root.Cmp(es[0].Root) != 0 || rebuilt.Result.Score != es[0].Result.Score || rebuilt.RiskBps != es[0].RiskBps {
		t.Fatal("rebuilding an epoch from its stored readings changed it")
	}
	if rebuilt.Salt(3).Cmp(es[0].Salt(3)) != 0 {
		t.Fatal("rebuilt salts differ, so a proof could not be generated")
	}
	if _, err := epoch.FromPoints(c, 0, nil); err == nil {
		t.Fatal("an empty epoch was built")
	}
}
