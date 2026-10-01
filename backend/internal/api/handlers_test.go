package api_test

import (
	"context"
	"time"

	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

type errResp struct {
	Error struct{ Code, Message string }
}

func TestHealthAndPublicConfig(t *testing.T) {
	e := newEnv(t, nil)
	var h struct {
		Status    string
		ChainID   uint64 `json:"chainId"`
		HeadBlock uint64 `json:"headBlock"`
		Database  string
	}
	if resp := e.do(t, "GET", "/v1/health", nil, nil, &h); resp.StatusCode != 200 || h.Status != "ok" || h.ChainID != 31337 || h.Database != "ok" || h.HeadBlock == 0 {
		t.Fatalf("health = %d %+v", resp.StatusCode, h)
	}
	var c struct {
		ChainID      uint64            `json:"chainId"`
		USDGDecimals int               `json:"usdgDecimals"`
		Contracts    map[string]string `json:"contracts"`
	}
	if resp := e.do(t, "GET", "/v1/config", nil, nil, &c); resp.StatusCode != 200 || c.ChainID != 31337 || c.USDGDecimals != 6 {
		t.Fatalf("config = %d %+v", resp.StatusCode, c)
	}
	for _, k := range []string{"financingController", "receivableVault", "evidenceRegistry", "shipmentRegistry", "policyEngine", "usdg"} {
		if !strings.HasPrefix(c.Contracts[k], "0x") {
			t.Errorf("config is missing the %s address: %v", k, c.Contracts)
		}
	}
	for _, secret := range []string{adminKey, "operator secret"} {
		resp := e.do(t, "GET", "/v1/config", nil, nil, nil)
		b, _ := io.ReadAll(resp.Body)
		if strings.Contains(string(b), secret) {
			t.Fatalf("the public config leaks %q", secret)
		}
	}
}

func TestAdminEndpointsRequireTheAdminKey(t *testing.T) {
	e := newEnv(t, nil)
	for _, tc := range []struct{ method, path string }{
		{"POST", "/v1/sources"}, {"POST", "/v1/shipments"}, {"POST", "/v1/admin/reconcile"}, {"POST", "/v1/shipments/0x" + strings.Repeat("a", 64) + "/proof"},
	} {
		for name, h := range map[string]map[string]string{"no key": nil, "wrong key": {"X-API-Key": "definitely-not-the-key-0123"}} {
			resp := e.do(t, tc.method, tc.path, map[string]any{}, h, nil)
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s %s with %s = %d, want 401", tc.method, tc.path, name, resp.StatusCode)
			}
		}
	}
}

func TestRegisteringEvidenceSources(t *testing.T) {
	e := newEnv(t, nil)
	pub := base64.RawURLEncoding.EncodeToString(e.sourcePub)

	var created struct {
		ID             string   `json:"id"`
		SensorIDs      []string `json:"sensorIds"`
		ReliabilityBps int      `json:"reliabilityBps"`
	}
	resp := e.do(t, "POST", "/v1/sources", map[string]any{"id": "carrier-1", "publicKey": pub, "sensorIds": []string{"sensor-1", "sensor-2"}}, admin(), &created)
	if resp.StatusCode != 201 || created.ID != "carrier-1" || len(created.SensorIDs) != 2 || created.ReliabilityBps != 9500 {
		t.Fatalf("created = %d %+v", resp.StatusCode, created)
	}

	bad := []map[string]any{
		{"id": "Bad Id!", "publicKey": pub, "sensorIds": []string{"s"}},
		{"id": "x", "publicKey": "AAAA", "sensorIds": []string{"s"}},
		{"id": "x", "publicKey": pub, "sensorIds": []string{}},
		{"id": "x", "publicKey": pub, "sensorIds": []string{"bad sensor!"}},
		{"id": "x", "publicKey": pub, "sensorIds": []string{"s"}, "reliabilityBps": 10_001},
		{"id": "x", "publicKey": pub, "sensorIds": []string{"s"}, "surprise": true}, // unknown field
	}
	for i, body := range bad {
		var er errResp
		resp := e.do(t, "POST", "/v1/sources", body, admin(), &er)
		if resp.StatusCode != 400 || er.Error.Code != "invalid_request" {
			t.Errorf("bad body %d = %d %+v", i, resp.StatusCode, er)
		}
	}
}

func TestShipmentRegistrationLookupAndErrors(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-ship-1", true)
	hex := idHex(id)
	body := map[string]any{"shipmentId": hex, "externalRef": "api-ship-1", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}

	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Policy struct {
			MaxTempX100 int `json:"maxTempX100"`
		} `json:"policy"`
	}
	if resp := e.do(t, "POST", "/v1/shipments", body, admin(), &created); resp.StatusCode != 201 || created.ID != hex || created.Policy.MaxTempX100 != 800 || created.Status != "ACTIVE" {
		t.Fatalf("create = %d %+v", resp.StatusCode, created)
	}
	if resp := e.do(t, "POST", "/v1/shipments", body, admin(), nil); resp.StatusCode != 409 {
		t.Fatalf("duplicate = %d", resp.StatusCode)
	}

	var er errResp
	ghost := map[string]any{"shipmentId": "0x" + strings.Repeat("ab", 32), "externalRef": "ghost", "minSensors": 2}
	if resp := e.do(t, "POST", "/v1/shipments", ghost, admin(), &er); resp.StatusCode != 422 || er.Error.Code != "not_on_chain" {
		t.Fatalf("not on chain = %d %+v", resp.StatusCode, er)
	}
	if resp := e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": "nope", "externalRef": "x", "minSensors": 2}, admin(), &er); resp.StatusCode != 400 {
		t.Fatalf("malformed id = %d", resp.StatusCode)
	}

	var view struct {
		Shipment struct {
			ID string `json:"id"`
		} `json:"shipment"`
		Facility struct {
			Status    string `json:"status"`
			Committed string `json:"committed"`
		} `json:"facility"`
		Milestones []struct {
			Index int `json:"index"`
		} `json:"milestones"`
		USDGDecimals int `json:"usdgDecimals"`
	}
	if resp := e.do(t, "GET", "/v1/shipments/"+hex, nil, nil, &view); resp.StatusCode != 200 || view.Facility.Status != "ACTIVE" || view.Facility.Committed != "40000000000" || len(view.Milestones) != 5 || view.USDGDecimals != 6 {
		t.Fatalf("view = %d %+v", resp.StatusCode, view)
	}
	if resp := e.do(t, "GET", "/v1/shipments/0x"+strings.Repeat("cd", 32), nil, nil, nil); resp.StatusCode != 404 {
		t.Fatalf("unknown shipment = %d", resp.StatusCode)
	}
	if resp := e.do(t, "GET", "/v1/shipments/not-an-id", nil, nil, nil); resp.StatusCode != 400 {
		t.Fatalf("malformed id = %d", resp.StatusCode)
	}

	var list struct {
		Shipments []struct {
			ID string `json:"id"`
		} `json:"shipments"`
	}
	if resp := e.do(t, "GET", "/v1/shipments?limit=10", nil, nil, &list); resp.StatusCode != 200 || len(list.Shipments) != 1 || list.Shipments[0].ID != hex {
		t.Fatalf("list = %d %+v", resp.StatusCode, list)
	}
	if resp := e.do(t, "GET", "/v1/shipments?limit=abc", nil, nil, nil); resp.StatusCode != 400 {
		t.Fatalf("bad limit = %d", resp.StatusCode)
	}
}

func TestTelemetryRequiresAValidSourceSignature(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-tele-1", true)
	hex := idHex(id)
	e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": hex, "externalRef": "api-tele-1", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}, admin(), nil)
	e.registerSource(t, "carrier-1", "sensor-1", "sensor-2")

	now, _ := e.chain.BlockTime(ctxBG())
	pts := segment(t, e, simulator.Normal, int64(now)-300, 0, 8)
	path := "/v1/shipments/" + hex + "/telemetry"
	body, _ := json.Marshal(map[string]any{"points": dtoPoints(pts)})

	t.Run("unsigned", func(t *testing.T) {
		resp := e.do(t, "POST", path, map[string]any{"points": dtoPoints(pts)}, nil, nil)
		if resp.StatusCode != 401 {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("signed by a key that is not the source's", func(t *testing.T) {
		_, other, _ := ed25519.GenerateKey(rand.Reader)
		if resp := e.signedRaw(t, "carrier-1", path, body, other, nowFunc().Unix(), nil); resp.StatusCode != 401 {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("unknown source looks the same as a bad signature", func(t *testing.T) {
		var a, b errResp
		e.signedRaw(t, "no-such-source", path, body, e.sourcePriv, nowFunc().Unix(), &a)
		_, other, _ := ed25519.GenerateKey(rand.Reader)
		e.signedRaw(t, "carrier-1", path, body, other, nowFunc().Unix(), &b)
		if a.Error.Message != b.Error.Message || a.Error.Message == "" {
			t.Fatalf("source ids can be enumerated: %q vs %q", a.Error.Message, b.Error.Message)
		}
	})
	t.Run("stale timestamp", func(t *testing.T) {
		if resp := e.signedRaw(t, "carrier-1", path, body, e.sourcePriv, nowFunc().Unix()-3600, nil); resp.StatusCode != 401 {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("body tampered after signing", func(t *testing.T) {
		ts := nowFunc().Unix()
		req, _ := http.NewRequest("POST", e.srv.URL+path, strings.NewReader(strings.Replace(string(body), "sensor-1", "sensor-2", 1)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Source-Id", "carrier-1")
		req.Header.Set("X-Timestamp", itoa(ts))
		req.Header.Set("X-Signature", signWith(e, path, body, ts))
		resp, _ := http.DefaultClient.Do(req)
		if resp.StatusCode != 401 {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("a source may not report a sensor it does not own", func(t *testing.T) {
		e.registerSource(t, "narrow", "sensor-1")
		var er errResp
		resp := e.signedRaw(t, "narrow", path, body, e.sourcePriv, nowFunc().Unix(), &er)
		if resp.StatusCode != 403 {
			t.Fatalf("got %d %+v", resp.StatusCode, er)
		}
	})
	t.Run("nothing was stored by any refused request", func(t *testing.T) {
		if n, _ := e.store.CountPoints(ctxBG(), hex); n != 0 {
			t.Fatalf("%d readings were stored by refused requests", n)
		}
	})
}

func TestTelemetryInputValidation(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-tele-2", true)
	hex := idHex(id)
	e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": hex, "externalRef": "api-tele-2", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}, admin(), nil)
	e.registerSource(t, "carrier-1", "sensor-1", "sensor-2")
	path := "/v1/shipments/" + hex + "/telemetry"
	post := func(body string, contentType string) int {
		ts := nowFunc().Unix()
		req, _ := http.NewRequest("POST", e.srv.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("X-Source-Id", "carrier-1")
		req.Header.Set("X-Timestamp", itoa(ts))
		req.Header.Set("X-Signature", signWith(e, path, []byte(body), ts))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp.StatusCode
	}
	if c := post(`{"points":[]}`, "text/plain"); c != http.StatusUnsupportedMediaType {
		t.Errorf("wrong content type = %d", c)
	}
	if c := post(`not json`, "application/json"); c != 400 {
		t.Errorf("malformed json = %d", c)
	}
	if c := post(`{"points":[],"extra":1}`, "application/json"); c != 400 {
		t.Errorf("unknown field = %d", c)
	}
	if c := post(`{"points":[]}`, "application/json"); c != 400 {
		t.Errorf("empty batch = %d", c)
	}
	many := make([]map[string]any, 501)
	for i := range many {
		many[i] = map[string]any{"timestamp": 1, "sensorId": "sensor-1"}
	}
	b, _ := json.Marshal(map[string]any{"points": many})
	if c := post(string(b), "application/json"); c != http.StatusRequestEntityTooLarge && c != 400 {
		t.Errorf("oversized batch = %d", c)
	}
	if code := post(`{"points":[{"timestamp":1,"sensorId":"sensor-1","temperatureX100":"hot"}]}`, "application/json"); code != 400 {
		t.Errorf("wrong field type = %d", code)
	}
}

func TestTelemetryDrivesTheFacilityAndNeverExposesRawReadings(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-tele-3", true)
	hex := idHex(id)
	e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": hex, "externalRef": "api-tele-3", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}, admin(), nil)
	e.registerSource(t, "carrier-1", "sensor-1", "sensor-2")
	now, _ := e.chain.BlockTime(ctxBG())
	t0 := int64(now) - 700

	var res struct {
		Accepted int `json:"accepted"`
		Epochs   []struct {
			Pass      bool   `json:"pass"`
			Action    string `json:"action"`
			ReleaseTx string `json:"releaseTx"`
			PauseTx   string `json:"pauseTx"`
		} `json:"epochs"`
	}
	resp := e.signedTelemetry(t, "carrier-1", hex, segment(t, e, simulator.ConflictingSensors, t0, 0, 24), &res)
	if resp.StatusCode != 200 || res.Accepted != 48 || len(res.Epochs) != 3 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("ingest = %d %s", resp.StatusCode, b)
	}
	if !res.Epochs[0].Pass || res.Epochs[0].ReleaseTx == "" || res.Epochs[2].Pass || res.Epochs[2].Action != "PAUSE_FACILITY" || res.Epochs[2].PauseTx == "" {
		t.Fatalf("epochs = %+v", res.Epochs)
	}

	var view struct {
		Facility struct {
			Status string `json:"status"`
			Drawn  string `json:"drawn"`
		} `json:"facility"`
	}
	e.do(t, "GET", "/v1/shipments/"+hex, nil, nil, &view)
	if view.Facility.Status != "PAUSED" || view.Facility.Drawn != "16000000000" {
		t.Fatalf("facility after the anomaly = %+v", view.Facility)
	}

	// epochs and audit are public: they must never include the readings
	for _, path := range []string{"/v1/shipments/" + hex + "/epochs", "/v1/shipments/" + hex + "/audit", "/v1/shipments/" + hex} {
		r := e.do(t, "GET", path, nil, nil, nil)
		b, _ := io.ReadAll(r.Body)
		for _, leak := range []string{"temperatureX100", "humidityX100", "latitudeE6", "salt", "\"points\""} {
			if strings.Contains(string(b), leak) {
				t.Fatalf("%s leaks raw telemetry (%q)", path, leak)
			}
		}
	}
	var eps struct {
		Epochs []struct {
			Score int `json:"score"`
		} `json:"epochs"`
	}
	if r := e.do(t, "GET", "/v1/shipments/"+hex+"/epochs", nil, nil, &eps); r.StatusCode != 200 || len(eps.Epochs) != 3 {
		t.Fatalf("epochs = %d %+v", r.StatusCode, eps)
	}
	var audit struct {
		Entries []struct{ Kind, Title string } `json:"entries"`
	}
	if r := e.do(t, "GET", "/v1/shipments/"+hex+"/audit?limit=100", nil, nil, &audit); r.StatusCode != 200 || len(audit.Entries) == 0 {
		t.Fatalf("audit = %d %+v", r.StatusCode, audit)
	}

	// replaying the exact signed batch is quarantined, not double counted
	var again struct {
		Accepted int                   `json:"accepted"`
		Rejected []telemetry.Rejection `json:"rejected"`
	}
	e.signedTelemetry(t, "carrier-1", hex, segment(t, e, simulator.ConflictingSensors, t0, 0, 24), &again)
	if again.Accepted != 0 {
		t.Fatalf("a replayed batch was accepted: %+v", again)
	}
}

func TestZKRecoveryThroughTheAPI(t *testing.T) {
	e := newEnv(t, realProver(t))
	id := e.onChain(t, "api-recover-1", true)
	hex := idHex(id)
	e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": hex, "externalRef": "api-recover-1", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}, admin(), nil)
	e.registerSource(t, "carrier-1", "sensor-1", "sensor-2")
	now, _ := e.chain.BlockTime(ctxBG())
	t0 := int64(now) - 700

	e.signedTelemetry(t, "carrier-1", hex, segment(t, e, simulator.ConflictingSensors, t0, 0, 24), nil)
	e.signedTelemetry(t, "carrier-1", hex, segment(t, e, simulator.Normal, t0, 24, 8, simulator.SecondarySensor), nil)

	var er errResp
	if r := e.do(t, "POST", "/v1/shipments/"+hex+"/proof", map[string]any{"sensorId": "sensor-2"}, nil, &er); r.StatusCode != 401 {
		t.Fatalf("proof without the admin key = %d", r.StatusCode)
	}
	var rec struct {
		ResumeTx  string `json:"resumeTx"`
		ReleaseTx string `json:"releaseTx"`
		Milestone int    `json:"milestoneIndex"`
	}
	if r := e.do(t, "POST", "/v1/shipments/"+hex+"/proof", map[string]any{"sensorId": "sensor-2"}, admin(), &rec); r.StatusCode != 200 || rec.ResumeTx == "" || rec.ReleaseTx == "" || rec.Milestone != 2 {
		b, _ := io.ReadAll(r.Body)
		t.Fatalf("recovery = %d %s", r.StatusCode, b)
	}
	var view struct {
		Facility struct {
			Status        string `json:"status"`
			NextMilestone int    `json:"nextMilestone"`
		} `json:"facility"`
	}
	e.do(t, "GET", "/v1/shipments/"+hex, nil, nil, &view)
	if view.Facility.Status != "ACTIVE" || view.Facility.NextMilestone != 3 {
		t.Fatalf("after recovery: %+v", view.Facility)
	}
	// recovering again is refused: the facility is no longer paused
	if r := e.do(t, "POST", "/v1/shipments/"+hex+"/proof", map[string]any{"sensorId": "sensor-2"}, admin(), &er); r.StatusCode != 409 || er.Error.Code != "not_paused" {
		t.Fatalf("second recovery = %d %+v", r.StatusCode, er)
	}
}

func TestWebSocketStreamsLiveEvidenceEventsThroughTheFullMiddlewareChain(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-ws-1", true)
	hex := idHex(id)
	e.do(t, "POST", "/v1/shipments", map[string]any{"shipmentId": hex, "externalRef": "api-ws-1", "route": testRoute, "maxGapSec": 1800, "minSensors": 2}, admin(), nil)
	e.registerSource(t, "carrier-1", "sensor-1", "sensor-2")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(e.srv.URL, "http")+"/v1/ws?shipment="+hex, nil)
	if err != nil {
		t.Fatalf("the websocket upgrade failed behind the middleware chain: %v", err)
	}
	defer conn.CloseNow()
	deadline := time.Now().Add(3 * time.Second)
	for e.hub.Subscribers() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}

	now, _ := e.chain.BlockTime(ctxBG())
	e.signedTelemetry(t, "carrier-1", hex, segment(t, e, simulator.Normal, int64(now)-300, 0, 8), nil)

	seen := map[string]bool{}
	for len(seen) < 3 {
		var ev struct {
			Type       string `json:"type"`
			ShipmentID string `json:"shipmentId"`
			Seq        uint64 `json:"seq"`
		}
		if err := wsjson.Read(ctx, conn, &ev); err != nil {
			t.Fatalf("read (saw %v): %v", seen, err)
		}
		if ev.ShipmentID != hex || ev.Seq == 0 {
			t.Fatalf("event = %+v", ev)
		}
		seen[ev.Type] = true
	}
	for _, want := range []string{"TELEMETRY_EPOCH_ADDED", "EVIDENCE_UPDATED", "RISK_UPDATED"} {
		if !seen[want] {
			t.Errorf("never received %s (got %v)", want, seen)
		}
	}
}

func TestAdminCanTriggerAReconciliationPass(t *testing.T) {
	e := newEnv(t, nil)
	e.onChain(t, "api-reconcile-1", true)
	var rep struct {
		Shipments int      `json:"shipments"`
		Retried   []string `json:"retried"`
		GaveUp    []string `json:"gaveUp"`
	}
	resp := e.do(t, "POST", "/v1/admin/reconcile", map[string]any{}, map[string]string{"X-API-Key": adminKey}, &rep)
	if resp.StatusCode != 200 || rep.Retried == nil || rep.GaveUp == nil {
		t.Fatalf("%d %+v", resp.StatusCode, rep)
	}
}

func TestStatsArePublic(t *testing.T) {
	e := newEnv(t, nil)
	e.onChain(t, "api-stats-1", false)
	var st struct {
		Total     int            `json:"total"`
		Shipments map[string]int `json:"shipments"`
	}
	if resp := e.do(t, "GET", "/v1/stats", nil, nil, &st); resp.StatusCode != 200 || st.Shipments == nil {
		t.Fatalf("%d %+v", resp.StatusCode, st)
	}
}
