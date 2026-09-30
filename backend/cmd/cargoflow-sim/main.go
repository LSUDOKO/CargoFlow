// Command cargoflow-sim replays a reproducible telemetry scenario through the full evidence pipeline
// (ingestion, fusion, scoring, risk, Poseidon commitment, policy decision) and prints each epoch, so
// you can watch a shipment's evidence score react to physical events.
//
//	cargoflow-sim -scenario conflicting_sensors -steps 40
//	cargoflow-sim -scenario malicious_replay -json
package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/risk"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// demoSaltSecret is for the simulator only. Real deployments load the operator secret from the environment.
const demoSaltSecret = "cargoflow-sim-demo-secret-not-for-production"

var limits = decision.Limits{MinScore: 75, MaxConflictBps: 3000, MaxRiskBps: 3500}

type epochReport struct {
	Sequence    uint32   `json:"sequence"`
	StartTime   int64    `json:"startTime"`
	EndTime     int64    `json:"endTime"`
	Readings    int      `json:"readings"`
	Score       int      `json:"score"`
	ConflictBps int      `json:"conflictBps"`
	RiskBps     int      `json:"riskBps"`
	Compliant   bool     `json:"compliant"`
	Pass        bool     `json:"pass"`
	Action      string   `json:"action"`
	Reasons     []string `json:"reasons"`
	Root        string   `json:"root"`
}

type rejectionReport struct {
	Timestamp int64  `json:"timestamp"`
	Sensor    string `json:"sensor"`
	Reason    string `json:"reason"`
}

type report struct {
	Scenario    string            `json:"scenario"`
	Seed        uint64            `json:"seed"`
	Steps       int               `json:"steps"`
	Epochs      []epochReport     `json:"epochs"`
	Quarantined []rejectionReport `json:"quarantined"`
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "cargoflow-sim:", err)
		os.Exit(1)
	}
}

func run(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("cargoflow-sim", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	scenario := fs.String("scenario", string(simulator.Normal), "normal | thermal_excursion | conflicting_sensors | sensor_detached | gps_jump | stale_packets | malicious_replay")
	steps := fs.Int("steps", 40, "readings per sensor (8 per epoch)")
	seed := fs.Uint64("seed", 42, "PRNG seed; the same seed always yields the same run")
	interval := fs.Int64("interval", 60, "seconds between readings")
	speed := fs.Int("speed", 0, "cargo speed in km/h (0 = default)")
	asJSON := fs.Bool("json", false, "emit a machine-readable report")
	if err := fs.Parse(args); err != nil {
		return err
	}

	pts, err := simulator.Generate(simulator.Config{
		Seed: *seed, Scenario: simulator.Scenario(*scenario), StartUnix: 1_800_000_000,
		IntervalSec: *interval, Steps: *steps, SpeedKmh: *speed,
	})
	if err != nil {
		return err
	}

	var ship [32]byte
	copy(ship[:], "CF-2026-SG01")
	proc, err := epoch.NewProcessor(epoch.Config{
		ShipmentID: ship,
		Policy: evidence.Policy{
			Band:      evidence.Band{MinTempX100: 200, MaxTempX100: 800},
			MaxGapSec: 1800, MaxRouteDeviationM: 25_000, MinSensors: 2,
		},
		Route:       []geo.Point{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}},
		SaltSecret:  []byte(demoSaltSecret),
		RiskContext: risk.Context{CounterpartyBps: 1000, CorridorBps: 1000, MinReliabilityBps: evidence.DefaultReliabilityBps},
	})
	if err != nil {
		return err
	}

	rep := report{Scenario: *scenario, Seed: *seed, Steps: *steps}
	collect := func(e *epoch.Epoch) {
		d := decision.Decide(e.Result, e.RiskBps, limits)
		reasons := make([]string, len(d.Reasons))
		for i, r := range d.Reasons {
			reasons[i] = string(r)
		}
		rep.Epochs = append(rep.Epochs, epochReport{
			Sequence: e.Sequence, StartTime: e.StartTime, EndTime: e.EndTime, Readings: len(e.Points),
			Score: e.Result.Score, ConflictBps: e.Result.ConflictBps, RiskBps: e.RiskBps,
			Compliant: e.Result.Compliant, Pass: d.Pass, Action: string(d.Action), Reasons: reasons,
			Root: "0x" + hex.EncodeToString(e.RootBytes32()),
		})
	}
	for _, p := range pts {
		e, err := proc.Ingest(p)
		var rej *telemetry.Rejection
		switch {
		case errors.As(err, &rej):
			// quarantined; recorded in proc.Rejections()
		case err != nil:
			return err
		case e != nil:
			collect(e)
		}
	}
	if e, err := proc.Flush(); err != nil {
		return err
	} else if e != nil {
		collect(e)
	}
	for _, r := range proc.Rejections() {
		rep.Quarantined = append(rep.Quarantined, rejectionReport{r.Point.Timestamp, r.Point.SensorID, string(r.Reason)})
	}

	if *asJSON {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		return enc.Encode(rep)
	}
	printReport(out, rep)
	return nil
}

func printReport(out io.Writer, rep report) {
	fmt.Fprintf(out, "scenario %s  seed %d  steps %d\n", rep.Scenario, rep.Seed, rep.Steps)
	for _, e := range rep.Epochs {
		verdict := "PASS"
		if !e.Pass {
			verdict = "FAIL"
		}
		compliant := "yes"
		if !e.Compliant {
			compliant = "NO"
		}
		fmt.Fprintf(out, "epoch %d  readings=%2d  score=%3d  conflict=%s  risk=%s  compliant=%-3s  %s  %-23s root=%s\n",
			e.Sequence, e.Readings, e.Score, pct(e.ConflictBps), pct(e.RiskBps), compliant, verdict, e.Action, shortRoot(e.Root))
		if len(e.Reasons) > 0 {
			fmt.Fprintf(out, "         reasons: %s\n", strings.Join(e.Reasons, ", "))
		}
	}
	fmt.Fprintf(out, "quarantined %d readings\n", len(rep.Quarantined))
	for _, q := range rep.Quarantined {
		fmt.Fprintf(out, "  rejected ts=%d sensor=%s %s\n", q.Timestamp, q.Sensor, q.Reason)
	}
}

// pct renders basis points as a percentage without floating point, e.g. 7475 -> "74.75%".
func pct(bps int) string { return fmt.Sprintf("%d.%02d%%", bps/100, bps%100) }

func shortRoot(r string) string {
	if len(r) > 14 {
		return r[:10] + "…" + r[len(r)-4:]
	}
	return r
}
