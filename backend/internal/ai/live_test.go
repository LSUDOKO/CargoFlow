//go:build live

package ai_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
)

// Run with: GROQ_API_KEY=... go test -tags live -run Live -v ./internal/ai
// It calls the real Groq API with synthetic data, so it is excluded from normal and CI runs.
func TestLiveGroqAgreesWithObviousCases(t *testing.T) {
	key := os.Getenv("GROQ_API_KEY")
	if key == "" {
		t.Skip("GROQ_API_KEY is not set")
	}
	g := ai.NewGroq(ai.GroqConfig{APIKey: config.Secret(key), Model: os.Getenv("GROQ_MODEL")})
	m := ai.NewMonitor(g, ai.MonitorOptions{Timeout: 45 * time.Second})

	bad := result() // score 48, conflict 7800 bps, outside the band
	healthy := evidence.Result{Score: 98, Compliant: true, ConflictBps: 166, ReadingCount: 16, SensorCount: 2}
	for name, tc := range map[string]struct {
		r    evidence.Result
		risk int
		want decision.Action
	}{
		"thermal excursion with contradicting probes": {bad, 4000, decision.PauseFacility},
		"healthy epoch": {healthy, 800, decision.ApproveAdvance},
	} {
		t.Run(name, func(t *testing.T) {
			det := decision.Decide(tc.r, tc.risk, limits)
			b := ai.NewBrief(shipment, tc.r, tc.risk, limits, det)
			a, err := g.Assess(context.Background(), b)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("%s -> %s (%.2f) %s: %s", g.Name(), a.Action, a.Confidence, a.ReasonCode, a.Explanation)
			if a.Action != tc.want {
				t.Errorf("model chose %s, expected %s", a.Action, tc.want)
			}
			if v := m.Review(context.Background(), b, det); v.Decision.Action != tc.want {
				t.Errorf("reconciled outcome %s, want %s (note %q err %q)", v.Decision.Action, tc.want, v.Note, v.Err)
			}
		})
	}
}
