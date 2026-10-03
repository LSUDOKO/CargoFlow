package api_test

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// storeEpoch writes an evaluated epoch straight into the store, as the pipeline would after committing it.
func (e *env) storeEpoch(t *testing.T, shipment string, seq int, pass bool, points ...telemetry.Point) store.EpochRecord {
	t.Helper()
	rec := store.EpochRecord{
		ShipmentID: shipment, MilestoneIndex: 0, Sequence: seq, EpochID: "0x" + strings.Repeat(string("0123456789abcdef"[seq%16]), 63) + shipment[2:3],
		MerkleRoot: "0x" + strings.Repeat("1", 64), ReadingCount: len(points), StartTime: points[0].Timestamp,
		EndTime: points[len(points)-1].Timestamp, Score: 90, Compliant: pass, DecisionPass: pass, DecisionAction: "APPROVE_ADVANCE",
		Points: points,
	}
	if !pass {
		rec.Score, rec.DecisionAction, rec.DecisionReasons = 40, "PAUSE_FACILITY", []string{"NOT_COMPLIANT"}
	}
	out, err := e.store.InsertEpoch(ctxBG(), rec)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func reading(ts int64, sensor string, tempX100, lat, lon int32) telemetry.Point {
	return telemetry.Point{Timestamp: ts, SensorID: sensor, TemperatureX100: tempX100, HumidityX100: 6000, LatitudeE6: lat, LongitudeE6: lon}
}

func TestTrackIsOneCentroidPerEpochOldestFirst(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-track-1", true)
	e.registerShipment(t, id, "api-track-1")
	sh := idHex(id)
	first := e.storeEpoch(t, sh, 1, true, reading(1000, "s1", 300, 10_000_000, 20_000_000), reading(1010, "s2", 500, 12_000_000, 22_000_000))
	if err := e.store.SetEpochCommitted(ctxBG(), first.EpochID, "0xabc"); err != nil {
		t.Fatal(err)
	}
	e.storeEpoch(t, sh, 2, false, reading(2000, "s1", 900, 1_000_000, 179_000_000), reading(2010, "s2", 950, 1_000_000, -179_000_000))

	var out struct {
		Points []struct {
			EpochID        string `json:"epochId"`
			MilestoneIndex int    `json:"milestoneIndex"`
			Sequence       int    `json:"sequence"`
			StartTime      int64  `json:"startTime"`
			EndTime        int64  `json:"endTime"`
			LatE6          int32  `json:"latE6"`
			LonE6          int32  `json:"lonE6"`
			MinTempX100    int32  `json:"minTempX100"`
			MaxTempX100    int32  `json:"maxTempX100"`
			Pass           bool   `json:"pass"`
			Committed      bool   `json:"committed"`
		} `json:"points"`
	}
	resp := e.do(t, "GET", "/v1/shipments/"+sh+"/track", nil, nil, &out)
	if resp.StatusCode != http.StatusOK || len(out.Points) != 2 {
		t.Fatalf("track = %d %+v", resp.StatusCode, out)
	}
	p := out.Points[0]
	if p.EpochID != first.EpochID || p.Sequence != 1 || p.StartTime != 1000 || p.EndTime != 1010 || p.LatE6 != 11_000_000 || p.LonE6 != 21_000_000 ||
		p.MinTempX100 != 300 || p.MaxTempX100 != 500 || !p.Pass || !p.Committed {
		t.Fatalf("first point = %+v", p)
	}
	q := out.Points[1]
	if q.Pass || q.Committed || q.MinTempX100 != 900 || q.MaxTempX100 != 950 || (q.LonE6 != 180_000_000 && q.LonE6 != -180_000_000) {
		t.Fatalf("second point (across the antimeridian) = %+v", q)
	}
	b, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(b), "temperatureX100") || strings.Contains(string(b), "sensor") {
		t.Fatalf("the track leaks readings: %s", b)
	}
	if resp := e.do(t, "GET", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/track", nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown shipment = %d", resp.StatusCode)
	}
}

// A financing request is a registered, policy-set shipment that has no facility yet, so the public mirror must accept
// one; the facility's terms arrive later through the indexer.
func TestMirrorAcceptsAShipmentWithoutAFacility(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-mirror-nofac", false)
	var sh struct {
		ID        string `json:"id"`
		Status    string `json:"status"`
		Financier string `json:"financier"`
	}
	body := map[string]any{"shipmentId": idHex(id), "externalRef": "api-mirror-nofac", "route": testRoute}
	if resp := e.do(t, "POST", "/v1/shipments/mirror", body, nil, &sh); resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("mirror without a facility = %d %s", resp.StatusCode, b)
	}
	if sh.ID != idHex(id) || sh.Status != "REGISTERED" || sh.Financier != "" {
		t.Fatalf("mirrored = %+v", sh)
	}
	var view struct {
		Facility   any   `json:"facility"`
		Milestones []any `json:"milestones"`
	}
	if resp := e.do(t, "GET", "/v1/shipments/"+idHex(id), nil, nil, &view); resp.StatusCode != http.StatusOK || view.Facility != nil || len(view.Milestones) != 0 {
		t.Fatalf("view = %d %+v", resp.StatusCode, view)
	}
}
