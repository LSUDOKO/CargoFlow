// Package epcis renders a shipment as a GS1 EPCIS 2.0 JSON-LD document and reads sensor ObjectEvents back as readings.
//
// The export holds:
//   - a commissioning ObjectEvent (ADD) when the shipment was registered,
//   - a shipping ObjectEvent when the first evidence epoch begins (readPoint: the route's origin),
//   - one sensor_reporting ObjectEvent per evidence epoch with the EPCIS 2.0 sensorElementList: per sensor, the minimum,
//     maximum and mean temperature (CEL), the maximum and mean relative humidity (P1) and the peak shock as acceleration
//     (MSK); the readPoint is the epoch's centroid as a geo: URI, and the event carries the evidence score, decision,
//     Merkle root and commit transaction in the CargoFlow namespace,
//   - a receiving ObjectEvent when delivery is confirmed on chain,
//   - financing events (milestone released, paused, resumed, disputed, settled, defaulted, cover) as ObjectEvents
//     whose bizStep and fields are in the CargoFlow namespace.
//
// Identifiers: the shipment is urn:cargoflow:shipment:<id> (an EPCIS instance-level identifier outside GS1 keys; map it
// to an SSCC in your ERP if you hold one), the invoice is a bizTransaction of type inv, and event ids are urn:uuid
// values derived deterministically from the shipment and the event, so an export is stable across calls.
package epcis

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Namespaces.
const (
	GS1Context = "https://ref.gs1.org/standards/epcis/epcis-context.jsonld"
	Namespace  = "https://cargoflow.app/epcis/"
	Prefix     = "cargoflow"
)

// Export is everything a shipment's document is built from.
type Export struct {
	Shipment   store.Shipment
	Milestones []store.Milestone
	Epochs     []store.EpochRecord
	Events     []store.ChainEvent
	Created    time.Time
}

// ShipmentURI is the shipment's identifier in EPCIS documents.
func ShipmentURI(id string) string { return "urn:cargoflow:shipment:" + strings.ToLower(id) }

// SensorURI is a sensor's device identifier.
func SensorURI(shipmentID, sensor string) string {
	return "urn:cargoflow:sensor:" + strings.ToLower(shipmentID) + ":" + sensor
}

func eventID(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	h := hex.EncodeToString(sum[:16])
	// an RFC 4122 version-5-shaped UUID (the hash is SHA-256, truncated)
	b := []byte(h)
	b[12] = '5'
	b[16] = "89ab"[sum[8]&3]
	h = string(b)
	return "urn:uuid:" + h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

func ts(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func unixTS(sec int64) string { return ts(time.Unix(sec, 0)) }

// GeoURI is an RFC 5870 geo URI for a fixed-point position.
func GeoURI(latE6, lonE6 int32) string { return "geo:" + deg(latE6) + "," + deg(lonE6) }

func deg(e6 int32) string {
	s := strconv.FormatFloat(float64(e6)/1e6, 'f', 6, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// Document builds the EPCIS 2.0 document.
func Document(x Export) map[string]any {
	sh := x.Shipment
	ship := ShipmentURI(sh.ID)
	base := func(kind, key string, at time.Time) map[string]any {
		return map[string]any{
			"type": "ObjectEvent", "eventID": eventID(sh.ID, kind, key), "eventTime": ts(at), "eventTimeZoneOffset": "+00:00",
			"epcList": []string{ship}, "action": "OBSERVE",
		}
	}
	var events []map[string]any

	// commissioning
	c := base("commissioning", "", sh.CreatedAt)
	c["action"], c["bizStep"], c["disposition"] = "ADD", "commissioning", "active"
	c["bizTransactionList"] = []map[string]string{{"type": "inv", "bizTransaction": "urn:cargoflow:invoice:" + sh.InvoiceHash}}
	if len(sh.Route) > 0 {
		c["readPoint"] = map[string]string{"id": GeoURI(sh.Route[0].LatE6, sh.Route[0].LonE6)}
	}
	c[Prefix+":externalRef"] = sh.ExternalRef
	c[Prefix+":exporter"] = sh.Exporter
	c[Prefix+":buyer"] = sh.Buyer
	c[Prefix+":invoiceValue"] = sh.InvoiceValue
	c[Prefix+":policy"] = map[string]any{"minTempX100": sh.Policy.MinTempX100, "maxTempX100": sh.Policy.MaxTempX100,
		"maxHumidityX100": sh.Policy.MaxHumidityX100, "maxShockX100": sh.Policy.MaxShockX100, "minEvidenceScore": sh.Policy.MinEvidenceScore}
	events = append(events, c)

	epochs := append([]store.EpochRecord(nil), x.Epochs...)
	sort.SliceStable(epochs, func(i, j int) bool { return epochs[i].StartTime < epochs[j].StartTime })

	// shipping: the first evidence from the road
	if len(epochs) > 0 {
		s := base("shipping", "", time.Unix(epochs[0].StartTime, 0))
		s["bizStep"], s["disposition"] = "shipping", "in_transit"
		if len(sh.Route) > 0 {
			s["readPoint"] = map[string]string{"id": GeoURI(sh.Route[0].LatE6, sh.Route[0].LonE6)}
		}
		if len(sh.Route) > 1 {
			last := sh.Route[len(sh.Route)-1]
			s["destinationList"] = []map[string]string{{"type": "location", "destination": GeoURI(last.LatE6, last.LonE6)}}
		}
		events = append(events, s)
	}

	for _, e := range epochs {
		events = append(events, sensorEvent(sh, e, base))
	}

	for _, ev := range x.Events {
		if f := financingEvent(sh, ev, base); f != nil {
			events = append(events, f)
		}
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i]["eventTime"].(string) < events[j]["eventTime"].(string) })

	created := x.Created
	if created.IsZero() {
		created = time.Now()
	}
	return map[string]any{
		"@context":      []any{GS1Context, map[string]any{Prefix: Namespace}},
		"type":          "EPCISDocument",
		"schemaVersion": "2.0",
		"creationDate":  ts(created),
		"epcisBody":     map[string]any{"eventList": events},
	}
}

type sensorAgg struct {
	n                    int
	minT, maxT, sumT     int64
	maxH, sumH, maxShock int64
}

func sensorEvent(sh store.Shipment, e store.EpochRecord, base func(kind, key string, at time.Time) map[string]any) map[string]any {
	ev := base("sensor_reporting", e.EpochID, time.Unix(e.EndTime, 0))
	ev["bizStep"], ev["disposition"] = "sensor_reporting", "in_transit"
	ev["readPoint"] = map[string]string{"id": GeoURI(e.LatE6, e.LonE6)}
	aggs := map[string]*sensorAgg{}
	var names []string
	for _, p := range e.Points {
		a := aggs[p.SensorID]
		if a == nil {
			a = &sensorAgg{minT: math.MaxInt64, maxT: math.MinInt64}
			aggs[p.SensorID] = a
			names = append(names, p.SensorID)
		}
		t := int64(p.TemperatureX100)
		a.n++
		a.minT, a.maxT, a.sumT = min(a.minT, t), max(a.maxT, t), a.sumT+t
		a.maxH, a.sumH = max(a.maxH, int64(p.HumidityX100)), a.sumH+int64(p.HumidityX100)
		a.maxShock = max(a.maxShock, int64(p.ShockX100))
	}
	sort.Strings(names)
	var elements []map[string]any
	for _, name := range names {
		a := aggs[name]
		n := float64(a.n)
		elements = append(elements, map[string]any{
			"sensorMetadata": map[string]any{"deviceID": SensorURI(sh.ID, name), "startTime": unixTS(e.StartTime), "endTime": unixTS(e.EndTime),
				"dataProcessingMethod": Namespace + "methods/epoch-aggregate-v1"},
			"sensorReport": []map[string]any{
				{"type": "Temperature", "minValue": float64(a.minT) / 100, "maxValue": float64(a.maxT) / 100,
					"meanValue": round2(float64(a.sumT) / 100 / n), "uom": "CEL"},
				{"type": "RelativeHumidity", "maxValue": float64(a.maxH) / 100, "meanValue": round2(float64(a.sumH) / 100 / n), "uom": "P1"},
				{"type": "Acceleration", "maxValue": round2(float64(a.maxShock) / 100 * 9.80665), "uom": "MSK"},
			},
		})
	}
	if len(elements) == 0 { // an epoch without stored readings still reports its committed aggregates
		elements = append(elements, map[string]any{
			"sensorMetadata": map[string]any{"startTime": unixTS(e.StartTime), "endTime": unixTS(e.EndTime)},
			"sensorReport": []map[string]any{
				{"type": "RelativeHumidity", "maxValue": float64(e.MaxHumidityX100) / 100, "uom": "P1"},
				{"type": "Acceleration", "maxValue": round2(float64(e.MaxShockX100) / 100 * 9.80665), "uom": "MSK"},
			},
		})
	}
	ev["sensorElementList"] = elements
	ev[Prefix+":epochId"] = e.EpochID
	ev[Prefix+":milestoneIndex"] = e.MilestoneIndex
	ev[Prefix+":sequence"] = e.Sequence
	ev[Prefix+":merkleRoot"] = e.MerkleRoot
	ev[Prefix+":evidenceScore"] = e.Score
	ev[Prefix+":conflictBps"] = e.ConflictBps
	ev[Prefix+":riskBps"] = e.RiskBps
	ev[Prefix+":compliant"] = e.Compliant
	ev[Prefix+":decision"] = e.DecisionAction
	if e.CommitTxHash != "" {
		ev[Prefix+":commitTx"] = e.CommitTxHash
	}
	if e.ProofVerified {
		ev[Prefix+":proofVerified"] = true
	}
	if !e.Compliant {
		ev["disposition"] = "non_conformant"
	}
	return ev
}

// financingSteps maps chain events onto CargoFlow business steps.
var financingSteps = map[string]string{
	"FacilityCreated":          "facility_created",
	"MilestoneAdvanceReleased": "milestone_released",
	"FinancingPaused":          "financing_paused",
	"FinancingResumed":         "financing_resumed",
	"DisputeOpened":            "dispute_opened",
	"DisputeResolved":          "dispute_resolved",
	"FacilitySettled":          "facility_settled",
	"DefaultDeclared":          "default_declared",
	"CoverAccepted":            "cover_accepted",
	"CoverReleased":            "cover_released",
	"CoverClaimed":             "cover_claimed",
}

func financingEvent(sh store.Shipment, ev store.ChainEvent, base func(kind, key string, at time.Time) map[string]any) map[string]any {
	key := fmt.Sprintf("%s#%d", ev.TxHash, ev.LogIndex)
	at := ev.CreatedAt
	if ev.Name == "DeliveryConfirmed" {
		r := base("receiving", key, at)
		r["bizStep"], r["disposition"] = "receiving", "in_progress"
		if len(sh.Route) > 0 {
			last := sh.Route[len(sh.Route)-1]
			r["readPoint"] = map[string]string{"id": GeoURI(last.LatE6, last.LonE6)}
		}
		r[Prefix+":txHash"] = ev.TxHash
		return r
	}
	step, ok := financingSteps[ev.Name]
	if !ok {
		return nil
	}
	f := base("financing", key, at)
	f["bizStep"] = Namespace + "bizstep/" + step
	f[Prefix+":txHash"] = ev.TxHash
	f[Prefix+":blockNumber"] = ev.BlockNumber
	f[Prefix+":event"] = ev.Name
	for _, k := range []string{"milestoneIndex", "amount", "totalDrawn", "reasonCode", "principal", "fee", "residual", "insurer", "financier", "premium", "payout"} {
		if v, ok := ev.Args[k]; ok {
			f[Prefix+":"+k] = v
		}
	}
	return f
}

// --- import ---

// ImportError explains why a submitted document cannot be read.
type ImportError struct{ Msg string }

func (e *ImportError) Error() string { return "epcis: " + e.Msg }

func bad(format string, a ...any) error { return &ImportError{fmt.Sprintf(format, a...)} }

// Readings extracts readings from an EPCIS 2.0 document (or a single ObjectEvent): every ObjectEvent with a
// sensorElementList contributes one reading per sensor element. The element's time is its report's time, else its
// metadata's, else the event's eventTime; the sensor is the last segment of its deviceID (report or metadata); the
// position is the event's readPoint, which must be a geo: URI. Temperature (CEL, FAH or KEL, value or meanValue) is
// required; RelativeHumidity (P1) and Acceleration (MSK, or K40 for g) are optional.
func Readings(doc map[string]any) ([]telemetry.Point, error) {
	var events []any
	switch doc["type"] {
	case "EPCISDocument":
		body, _ := doc["epcisBody"].(map[string]any)
		list, ok := body["eventList"].([]any)
		if !ok {
			return nil, bad("epcisBody.eventList is missing")
		}
		events = list
	case "ObjectEvent":
		events = []any{doc}
	default:
		return nil, bad("send an EPCISDocument or an ObjectEvent")
	}
	var out []telemetry.Point
	for i, raw := range events {
		ev, ok := raw.(map[string]any)
		if !ok || ev["type"] != "ObjectEvent" {
			continue
		}
		elements, _ := ev["sensorElementList"].([]any)
		if len(elements) == 0 {
			continue
		}
		rp, _ := ev["readPoint"].(map[string]any)
		rpID, _ := rp["id"].(string)
		lat, lon, err := parseGeo(rpID)
		if err != nil {
			return nil, bad("event %d: readPoint.id must be a geo: URI (geo:<lat>,<lon>) to place its readings", i)
		}
		evTime, _ := ev["eventTime"].(string)
		for j, rawEl := range elements {
			el, _ := rawEl.(map[string]any)
			p, err := reading(el, evTime, lat, lon)
			if err != nil {
				return nil, bad("event %d, sensor element %d: %s", i, j, err.Error())
			}
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil, bad("no ObjectEvent with a sensorElementList was found")
	}
	return out, nil
}

func reading(el map[string]any, evTime string, lat, lon int32) (telemetry.Point, error) {
	meta, _ := el["sensorMetadata"].(map[string]any)
	reports, _ := el["sensorReport"].([]any)
	if len(reports) == 0 {
		return telemetry.Point{}, fmt.Errorf("sensorReport is empty")
	}
	str := func(m map[string]any, k string) string { v, _ := m[k].(string); return v }
	when, device := str(meta, "time"), str(meta, "deviceID")
	p := telemetry.Point{LatitudeE6: lat, LongitudeE6: lon}
	haveTemp := false
	for _, rr := range reports {
		r, _ := rr.(map[string]any)
		if t := str(r, "time"); t != "" && when == "" {
			when = t
		}
		if d := str(r, "deviceID"); d != "" && device == "" {
			device = d
		}
		v, ok := num(r["value"])
		if !ok {
			v, ok = num(r["meanValue"])
		}
		if !ok {
			continue
		}
		uom := str(r, "uom")
		switch str(r, "type") {
		case "Temperature":
			switch uom {
			case "", "CEL":
			case "FAH":
				v = (v - 32) * 5 / 9
			case "KEL":
				v -= 273.15
			default:
				return telemetry.Point{}, fmt.Errorf("temperature uom %q is not CEL, FAH or KEL", uom)
			}
			p.TemperatureX100, haveTemp = int32(math.Round(v*100)), true
		case "RelativeHumidity":
			if uom != "" && uom != "P1" {
				return telemetry.Point{}, fmt.Errorf("humidity uom %q is not P1 (percent)", uom)
			}
			p.HumidityX100 = int32(math.Round(v * 100))
		case "Acceleration":
			switch uom {
			case "", "MSK":
				v /= 9.80665
			case "K40":
			default:
				return telemetry.Point{}, fmt.Errorf("acceleration uom %q is not MSK or K40", uom)
			}
			p.ShockX100 = int32(math.Round(v * 100))
		}
	}
	if !haveTemp {
		return telemetry.Point{}, fmt.Errorf("a Temperature report with a value is required")
	}
	if when == "" {
		when = evTime
	}
	t, err := time.Parse(time.RFC3339Nano, when)
	if err != nil {
		return telemetry.Point{}, fmt.Errorf("time %q is not RFC 3339", when)
	}
	p.Timestamp = t.Unix()
	if device == "" {
		return telemetry.Point{}, fmt.Errorf("a deviceID names the sensor")
	}
	p.SensorID = device[strings.LastIndexAny(device, ":/")+1:]
	return p, nil
}

func num(v any) (float64, bool) {
	f, ok := v.(float64)
	return f, ok && !math.IsNaN(f) && !math.IsInf(f, 0)
}

// parseGeo reads "geo:<lat>,<lon>[,<alt>][;params]".
func parseGeo(s string) (int32, int32, error) {
	rest, ok := strings.CutPrefix(strings.ToLower(s), "geo:")
	if !ok {
		return 0, 0, fmt.Errorf("not a geo URI")
	}
	if i := strings.IndexByte(rest, ';'); i >= 0 {
		rest = rest[:i]
	}
	parts := strings.Split(rest, ",")
	if len(parts) < 2 {
		return 0, 0, fmt.Errorf("not a geo URI")
	}
	lat, err1 := strconv.ParseFloat(parts[0], 64)
	lon, err2 := strconv.ParseFloat(parts[1], 64)
	if err1 != nil || err2 != nil || lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, fmt.Errorf("not a geo URI")
	}
	return int32(math.Round(lat * 1e6)), int32(math.Round(lon * 1e6)), nil
}
