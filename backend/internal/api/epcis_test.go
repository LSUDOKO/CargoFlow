package api_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

func TestEPCISExportAndSignedCapture(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-epcis", true)
	e.registerShipment(t, id, "api-epcis")
	shipment := idHex(id)
	e.registerSource(t, "epcis-gw", simulator.PrimarySensor, simulator.SecondarySensor)
	t0 := time.Now().Unix() - 3600
	if resp := e.signedTelemetry(t, "epcis-gw", shipment, segment(t, e, simulator.Normal, t0, 0, 8), nil); resp.StatusCode != 200 {
		t.Fatalf("telemetry = %d", resp.StatusCode)
	}

	// capture: two readings per sensor as EPCIS sensor ObjectEvents
	var events []map[string]any
	for i := 0; i < 4; i++ {
		at := time.Unix(t0+int64(80+i*10), 0).UTC().Format(time.RFC3339)
		var elements []map[string]any
		for _, s := range []string{simulator.PrimarySensor, simulator.SecondarySensor} {
			elements = append(elements, map[string]any{
				"sensorMetadata": map[string]any{"time": at, "deviceID": "urn:cargoflow:sensor:" + shipment + ":" + s},
				"sensorReport":   []map[string]any{{"type": "Temperature", "value": 4.6, "uom": "CEL"}, {"type": "RelativeHumidity", "value": 70.0, "uom": "P1"}},
			})
		}
		events = append(events, map[string]any{"type": "ObjectEvent", "action": "OBSERVE", "bizStep": "sensor_reporting", "eventTime": at,
			"eventTimeZoneOffset": "+00:00", "readPoint": map[string]any{"id": "geo:18.9,72.9"}, "sensorElementList": elements})
	}
	doc, _ := json.Marshal(map[string]any{"@context": []string{"https://ref.gs1.org/standards/epcis/epcis-context.jsonld"}, "type": "EPCISDocument",
		"schemaVersion": "2.0", "creationDate": time.Now().UTC().Format(time.RFC3339), "epcisBody": map[string]any{"eventList": events}})
	var res struct {
		Accepted int `json:"accepted"`
	}
	path := "/v1/shipments/" + shipment + "/epcis"
	if resp := e.signedRaw(t, "epcis-gw", path, doc, e.sourcePriv, time.Now().Unix(), &res); resp.StatusCode != 200 || res.Accepted != 8 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("capture = %d %+v %s", resp.StatusCode, res, b)
	}
	if resp := e.signedRaw(t, "epcis-gw", path, []byte(`{"type":"EPCISDocument","epcisBody":{"eventList":[]}}`), e.sourcePriv, time.Now().Unix(), nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a document without sensor events = %d", resp.StatusCode)
	}
	if resp := e.signedRaw(t, "epcis-gw", path, doc, e.sourcePriv, time.Now().Unix()-3600, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("an unsigned (stale) capture = %d", resp.StatusCode)
	}

	resp, err := http.Get(e.srv.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Type      string `json:"type"`
		EPCISBody struct {
			EventList []map[string]any `json:"eventList"`
		} `json:"epcisBody"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "application/ld+json" || out.Type != "EPCISDocument" {
		t.Fatalf("export = %d %s %s", resp.StatusCode, resp.Header.Get("Content-Type"), out.Type)
	}
	steps := map[string]int{}
	for _, ev := range out.EPCISBody.EventList {
		steps[fmt.Sprint(ev["bizStep"])]++
	}
	if steps["sensor_reporting"] < 1 || steps["commissioning"] != 1 || steps["shipping"] != 1 {
		t.Fatalf("events = %v", out.EPCISBody.EventList)
	}
}
