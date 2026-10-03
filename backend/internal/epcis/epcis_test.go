package epcis_test

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epcis"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// The official GS1 EPCIS 2.0.1 JSON schema (https://ref.gs1.org/standards/epcis/epcis-json-schema.json), vendored.
const schemaPath = "testdata/epcis-json-schema.json"

// negLookahead is an RE2-compatible stand-in for the schema's two "^(?!(...))" patterns: Go's regexp has no
// lookahead, so "starts with none of these" is matched as "does not match ^(...)".
type negLookahead struct {
	src   string
	inner *regexp.Regexp
}

func (n negLookahead) MatchString(s string) bool { return !n.inner.MatchString(s) }
func (n negLookahead) String() string            { return n.src }

func regexpEngine(p string) (jsonschema.Regexp, error) {
	if inner, ok := strings.CutPrefix(p, "^(?!"); ok && strings.HasSuffix(inner, ")") {
		re, err := regexp.Compile("^" + strings.TrimSuffix(inner, ")"))
		if err != nil {
			return nil, err
		}
		return negLookahead{p, re}, nil
	}
	return regexp.Compile(p)
}

func compileSchema(t *testing.T) *jsonschema.Schema {
	t.Helper()
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := jsonschema.UnmarshalJSON(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	c := jsonschema.NewCompiler()
	c.UseRegexpEngine(regexpEngine)
	c.AssertFormat()
	if err := c.AddResource("epcis.json", doc); err != nil {
		t.Fatal(err)
	}
	s, err := c.Compile("epcis.json")
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func validate(t *testing.T, s *jsonschema.Schema, v any) error {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	inst, err := jsonschema.UnmarshalJSON(strings.NewReader(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	return s.Validate(inst)
}

func sampleExport() epcis.Export {
	id := "0x" + strings.Repeat("ab", 32)
	created := time.Unix(1_800_000_000, 0)
	pts := func(t0 int64, temps ...int32) []telemetry.Point {
		var out []telemetry.Point
		for i, temp := range temps {
			for _, s := range []string{"probe-a", "probe-b"} {
				out = append(out, telemetry.Point{Timestamp: t0 + int64(i)*60, SensorID: s, TemperatureX100: temp, HumidityX100: 6500 + int32(i)*10,
					LatitudeE6: 10_000_000, LongitudeE6: 80_000_000, ShockX100: 120})
			}
		}
		return out
	}
	return epcis.Export{
		Shipment: store.Shipment{ID: id, ExternalRef: "CF-EPCIS-1", Exporter: "0x" + strings.Repeat("1", 40), Buyer: "0x" + strings.Repeat("2", 40),
			InvoiceHash: "0x" + strings.Repeat("c", 64), InvoiceValue: "100000000000", CreatedAt: created,
			Policy: store.Policy{MinTempX100: 200, MaxTempX100: 800, MinEvidenceScore: 75},
			Route:  []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}},
		Epochs: []store.EpochRecord{
			{EpochID: "0x" + strings.Repeat("1", 64), MerkleRoot: "0x" + strings.Repeat("2", 64), StartTime: 1_800_000_100, EndTime: 1_800_000_400,
				Score: 98, Compliant: true, DecisionAction: "APPROVE_ADVANCE", CommitTxHash: "0x" + strings.Repeat("3", 64), LatE6: 15_000_000, LonE6: 80_500_000,
				Points: pts(1_800_000_100, 450, 470, 500)},
			{EpochID: "0x" + strings.Repeat("4", 64), MerkleRoot: "0x" + strings.Repeat("5", 64), StartTime: 1_800_000_500, EndTime: 1_800_000_800,
				Score: 48, Compliant: false, DecisionAction: "PAUSE_FACILITY", LatE6: -5_000_000, LonE6: 95_000_000, Points: pts(1_800_000_500, 900, 1100)},
		},
		Events: []store.ChainEvent{
			{TxHash: "0x" + strings.Repeat("6", 64), LogIndex: 1, BlockNumber: 10, Name: "MilestoneAdvanceReleased",
				Args: map[string]any{"milestoneIndex": float64(0), "amount": "8000000000"}, CreatedAt: created.Add(500 * time.Second)},
			{TxHash: "0x" + strings.Repeat("7", 64), LogIndex: 0, BlockNumber: 11, Name: "FinancingPaused", Args: map[string]any{"reasonCode": "0x01"}, CreatedAt: created.Add(900 * time.Second)},
			{TxHash: "0x" + strings.Repeat("8", 64), LogIndex: 0, BlockNumber: 12, Name: "DeliveryConfirmed", CreatedAt: created.Add(2000 * time.Second)},
			{TxHash: "0x" + strings.Repeat("9", 64), LogIndex: 0, BlockNumber: 13, Name: "EvidenceEpochCommitted", CreatedAt: created.Add(3000 * time.Second)},
		},
		Created: created.Add(4000 * time.Second),
	}
}

func TestTheExportIsAValidEPCIS2Document(t *testing.T) {
	s := compileSchema(t)
	doc := epcis.Document(sampleExport())
	if err := validate(t, s, doc); err != nil {
		t.Fatalf("the export must validate against the official EPCIS 2.0 schema: %v", err)
	}
	events := doc["epcisBody"].(map[string]any)["eventList"].([]map[string]any)
	steps := []string{}
	for _, e := range events {
		steps = append(steps, e["bizStep"].(string))
	}
	want := "commissioning,shipping,sensor_reporting,https://cargoflow.app/epcis/bizstep/milestone_released,sensor_reporting,https://cargoflow.app/epcis/bizstep/financing_paused,receiving"
	if got := strings.Join(steps, ","); got != want {
		t.Fatalf("events = %s", got)
	}
	first := events[2]["sensorElementList"].([]map[string]any)
	if len(first) != 2 {
		t.Fatalf("one sensor element per probe, got %d", len(first))
	}
	temp := first[0]["sensorReport"].([]map[string]any)[0]
	if temp["type"] != "Temperature" || temp["minValue"] != 4.5 || temp["maxValue"] != 5.0 || temp["meanValue"] != 4.73 || temp["uom"] != "CEL" {
		t.Fatalf("temperature report = %v", temp)
	}
	if events[2]["readPoint"].(map[string]string)["id"] != "geo:15,80.5" || events[4]["disposition"] != "non_conformant" {
		t.Fatalf("epoch events = %v / %v", events[2]["readPoint"], events[4]["disposition"])
	}
	// stable: the same export twice gives the same event ids
	again := epcis.Document(sampleExport())["epcisBody"].(map[string]any)["eventList"].([]map[string]any)
	if again[2]["eventID"] != events[2]["eventID"] {
		t.Fatal("event ids are deterministic")
	}

	// the validator really validates: a broken document fails
	delete(events[0], "eventTimeZoneOffset")
	if err := validate(t, s, doc); err == nil {
		t.Fatal("an event without eventTimeZoneOffset must fail the schema")
	}
}

func TestReadingsImportFromSensorObjectEvents(t *testing.T) {
	raw := `{
	  "@context": ["https://ref.gs1.org/standards/epcis/epcis-context.jsonld"],
	  "type": "EPCISDocument", "schemaVersion": "2.0", "creationDate": "2027-01-15T08:00:00Z",
	  "epcisBody": {"eventList": [
	    {"type": "ObjectEvent", "action": "OBSERVE", "bizStep": "sensor_reporting", "eventTime": "2027-01-15T08:00:00Z", "eventTimeZoneOffset": "+00:00",
	     "readPoint": {"id": "geo:1.264,103.82"},
	     "sensorElementList": [
	       {"sensorMetadata": {"time": "2027-01-15T07:59:00Z", "deviceID": "urn:cargoflow:sensor:0xab:probe-a"},
	        "sensorReport": [{"type": "Temperature", "value": 4.56, "uom": "CEL"}, {"type": "RelativeHumidity", "value": 65.5, "uom": "P1"},
	                         {"type": "Acceleration", "value": 9.80665, "uom": "MSK"}]},
	       {"sensorReport": [{"type": "Temperature", "value": 41, "uom": "FAH", "deviceID": "https://example.com/devices/probe-b"}]}
	     ]},
	    {"type": "ObjectEvent", "action": "OBSERVE", "eventTime": "2027-01-15T08:00:00Z", "eventTimeZoneOffset": "+00:00", "epcList": ["urn:x"]}
	  ]}
	}`
	var doc map[string]any
	_ = json.Unmarshal([]byte(raw), &doc)
	if err := validate(t, compileSchema(t), doc); err != nil {
		t.Fatalf("the sample is valid EPCIS: %v", err)
	}
	pts, err := epcis.Readings(doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(pts) != 2 {
		t.Fatalf("points = %+v", pts)
	}
	a, b := pts[0], pts[1]
	if a.SensorID != "probe-a" || a.TemperatureX100 != 456 || a.HumidityX100 != 6550 || a.ShockX100 != 100 || a.LatitudeE6 != 1_264_000 || a.LongitudeE6 != 103_820_000 ||
		a.Timestamp != time.Date(2027, 1, 15, 7, 59, 0, 0, time.UTC).Unix() {
		t.Fatalf("a = %+v", a)
	}
	if b.SensorID != "probe-b" || b.TemperatureX100 != 500 || b.Timestamp != time.Date(2027, 1, 15, 8, 0, 0, 0, time.UTC).Unix() {
		t.Fatalf("b = %+v", b)
	}

	for name, mutate := range map[string]func(ev map[string]any){
		"no geo readPoint": func(ev map[string]any) { ev["readPoint"] = map[string]any{"id": "urn:epc:id:sgln:1.2.3"} },
		"no temperature": func(ev map[string]any) {
			ev["sensorElementList"] = []any{map[string]any{"sensorMetadata": map[string]any{"deviceID": "urn:s:x"}, "sensorReport": []any{map[string]any{"type": "RelativeHumidity", "value": 50.0}}}}
		},
		"no device": func(ev map[string]any) {
			ev["sensorElementList"] = []any{map[string]any{"sensorReport": []any{map[string]any{"type": "Temperature", "value": 5.0}}}}
		},
		"bad uom": func(ev map[string]any) {
			ev["sensorElementList"] = []any{map[string]any{"sensorMetadata": map[string]any{"deviceID": "urn:s:x"}, "sensorReport": []any{map[string]any{"type": "Temperature", "value": 5.0, "uom": "XYZ"}}}}
		},
	} {
		var d map[string]any
		_ = json.Unmarshal([]byte(raw), &d)
		mutate(d["epcisBody"].(map[string]any)["eventList"].([]any)[0].(map[string]any))
		if _, err := epcis.Readings(d); err == nil {
			t.Errorf("%s: must be refused", name)
		}
	}
	if _, err := epcis.Readings(map[string]any{"type": "AggregationEvent"}); err == nil {
		t.Error("only documents and ObjectEvents are read")
	}
}
