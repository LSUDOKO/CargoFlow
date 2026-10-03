package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
)

type explanation struct {
	Status    string   `json:"status"`
	Headline  string   `json:"headline"`
	Causes    []string `json:"causes"`
	NextSteps []struct {
		Role   string `json:"role"`
		Action string `json:"action"`
	} `json:"nextSteps"`
	Forecast *struct {
		SensorID       string `json:"sensorId"`
		Trend          string `json:"trend"`
		MinutesToLimit *int   `json:"minutesToLimit"`
	} `json:"forecast"`
	Source string `json:"source"`
}

// politeRewriter rewords by prefixing, keeping every number, and counts its calls.
type politeRewriter struct{ calls int }

func (p *politeRewriter) Reword(_ context.Context, _ string, w ai.Wording) (ai.Wording, error) {
	p.calls++
	out := ai.Wording{Headline: "In short: " + w.Headline}
	for _, c := range w.Causes {
		out.Causes = append(out.Causes, "Note: "+c)
	}
	return out, nil
}

func TestExplanationIsRuleDerivedWithATemperatureForecast(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-explain-1", true)
	e.registerShipment(t, id, "api-explain-1")
	sh := idHex(id)
	var x explanation
	if resp := e.do(t, "GET", "/v1/shipments/"+sh+"/explanation", nil, nil, &x); resp.StatusCode != http.StatusOK {
		t.Fatalf("explanation = %d", resp.StatusCode)
	}
	if x.Status != "ACTIVE" || !strings.Contains(x.Headline, "first evidence") || x.Source != "rules" || x.Forecast != nil ||
		len(x.NextSteps) != 1 || x.NextSteps[0].Role != "exporter" || x.Causes == nil {
		t.Fatalf("explanation = %+v", x)
	}
	// a probe warming 0.6 C every 10 minutes towards the 8 C limit
	for i, temp := range []int32{500, 560, 620, 680} {
		if _, err := e.store.InsertPoint(ctxBG(), sh, reading(1_000_000+int64(i)*600, "probe-a", temp, 1_000_000, 103_000_000), ""); err != nil {
			t.Fatal(err)
		}
	}
	e.do(t, "GET", "/v1/shipments/"+sh+"/explanation", nil, nil, &x)
	if x.Forecast == nil || x.Forecast.SensorID != "probe-a" || x.Forecast.Trend != "rising" || x.Forecast.MinutesToLimit == nil || *x.Forecast.MinutesToLimit != 20 {
		t.Fatalf("forecast = %+v", x.Forecast)
	}
	if resp := e.do(t, "GET", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/explanation", nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown shipment = %d", resp.StatusCode)
	}
}

func TestAModelMayRewordTheExplanationButNotItsFacts(t *testing.T) {
	rw := &politeRewriter{}
	e := newEnvWith(t, nil, func(e *env, c *api.Config) {
		c.Service = service.New(service.Options{Store: e.store, Chain: e.chain, Hub: e.hub, Worker: e.mgr, Monitor: e.mgr, Manager: e.mgr,
			SaltSecret: []byte("api test operator secret"), Wording: rw})
	})
	id := e.onChain(t, "api-explain-2", false)
	e.registerShipment(t, id, "api-explain-2")
	var x explanation
	for range 2 {
		e.do(t, "GET", "/v1/shipments/"+idHex(id)+"/explanation", nil, nil, &x)
	}
	if x.Source != "ai" || !strings.HasPrefix(x.Headline, "In short: Registered") || len(x.NextSteps) != 1 || strings.HasPrefix(x.NextSteps[0].Action, "Note") {
		t.Fatalf("reworded = %+v", x)
	}
	if rw.calls != 1 {
		t.Fatalf("the model was called %d times for the same facts, want 1 (cached)", rw.calls)
	}
}
