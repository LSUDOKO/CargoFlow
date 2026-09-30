package epoch_test

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/merkle"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

var update = flag.Bool("update", false, "rewrite circuits/test/fixtures/epoch_fixture.json from the current code")

const fixtureRel = "../../../circuits/test/fixtures/epoch_fixture.json"

type fixtureReading struct {
	Timestamp       int64  `json:"timestamp"`
	SensorID        string `json:"sensorId"`
	TemperatureX100 int32  `json:"temperatureX100"`
	HumidityX100    int32  `json:"humidityX100"`
	LatitudeE6      int32  `json:"latitudeE6"`
	LongitudeE6     int32  `json:"longitudeE6"`
	ShockX100       int32  `json:"shockX100"`
	Salt            string `json:"salt"`
	Leaf            string `json:"leaf"`
}

type fixture struct {
	Description string           `json:"description"`
	Readings    []fixtureReading `json:"readings"`
	Root        string           `json:"root"`
	RootHex     string           `json:"rootHex"`
}

// TestCircuitParityFixture pins the exact commitment the Go backend produces for a real 8-reading
// recovery epoch (the secondary core probe). The circuit's JS tests load the same file, so any change
// to leaf encoding, salt derivation or hashing on either side fails a test instead of silently
// producing roots the circuit cannot prove.
func TestCircuitParityFixture(t *testing.T) {
	c := cfg()
	c.Policy.MinSensors = 1 // a recovery epoch carries one probe
	p, err := epoch.NewProcessor(c)
	if err != nil {
		t.Fatal(err)
	}
	pts, err := simulator.Generate(simulator.Config{
		Seed: 42, Scenario: simulator.Normal, StartUnix: 1_800_002_400, IntervalSec: 60, Steps: 8,
		Sensors: []string{simulator.SecondarySensor},
	})
	if err != nil {
		t.Fatal(err)
	}
	es, _ := run(t, p, pts)
	if len(es) != 1 || len(es[0].Points) != 8 {
		t.Fatalf("want exactly one 8-reading epoch, got %d epochs", len(es))
	}
	e := es[0]

	f := fixture{
		Description: "8-reading recovery epoch produced by backend/internal/epoch; regenerate with: " +
			"cd backend && go test ./internal/epoch -run TestCircuitParityFixture -update",
		Root:    e.Root.String(),
		RootHex: "0x" + hex.EncodeToString(e.RootBytes32()),
	}
	for i, pt := range e.Points {
		f.Readings = append(f.Readings, fixtureReading{
			Timestamp: pt.Timestamp, SensorID: pt.SensorID, TemperatureX100: pt.TemperatureX100,
			HumidityX100: pt.HumidityX100, LatitudeE6: pt.LatitudeE6, LongitudeE6: pt.LongitudeE6,
			ShockX100: pt.ShockX100,
			Salt:      merkle.DeriveSalt(c.SaltSecret, c.ShipmentID, pt.SensorID, pt.Timestamp).String(),
			Leaf:      e.Leaf(i).String(),
		})
	}
	want, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')

	path := filepath.FromSlash(fixtureRel)
	if *update {
		if err := os.WriteFile(path, want, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", path)
		return
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("fixture missing (%v); run: go test ./internal/epoch -run TestCircuitParityFixture -update", err)
	}
	if string(got) != string(want) {
		t.Fatalf("circuits/test/fixtures/epoch_fixture.json is stale; the Go commitment changed.\n" +
			"If the change is intended, regenerate with -update and re-check the circuit tests.")
	}
}
