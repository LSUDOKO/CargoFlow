package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func runCLI(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	err := run(args, &out)
	return out.String(), err
}

func TestNormalScenarioPrintsFiveHealthyEpochs(t *testing.T) {
	out, err := runCLI(t, "-scenario", "normal", "-steps", "40")
	if err != nil {
		t.Fatal(err)
	}
	if n := strings.Count(out, " PASS "); n != 5 {
		t.Fatalf("want 5 PASS epochs, got %d:\n%s", n, out)
	}
	if strings.Contains(out, " FAIL ") {
		t.Fatalf("healthy run shows a failure:\n%s", out)
	}
}

func TestConflictingScenarioEndsInAFailingEpoch(t *testing.T) {
	out, err := runCLI(t, "-scenario", "conflicting_sensors", "-steps", "40")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	var epochLines []string
	for _, l := range lines {
		if strings.HasPrefix(strings.TrimSpace(l), "epoch") {
			epochLines = append(epochLines, l)
		}
	}
	if len(epochLines) != 5 {
		t.Fatalf("want 5 epoch lines, got %d:\n%s", len(epochLines), out)
	}
	if !strings.Contains(epochLines[4], " FAIL ") || !strings.Contains(epochLines[4], "PAUSE") {
		t.Fatalf("last epoch should fail and recommend a pause: %s", epochLines[4])
	}
	if !strings.Contains(epochLines[0], " PASS ") {
		t.Fatalf("first epoch should pass: %s", epochLines[0])
	}
}

func TestReplayScenarioReportsQuarantine(t *testing.T) {
	out, err := runCLI(t, "-scenario", "malicious_replay", "-steps", "40")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "quarantined 10") || !strings.Contains(out, "REPLAYED_PACKET") {
		t.Fatalf("replays not reported:\n%s", out)
	}
}

func TestJSONOutputIsMachineReadable(t *testing.T) {
	out, err := runCLI(t, "-scenario", "conflicting_sensors", "-steps", "40", "-json")
	if err != nil {
		t.Fatal(err)
	}
	var rep struct {
		Scenario string `json:"scenario"`
		Epochs   []struct {
			Sequence    uint32 `json:"sequence"`
			Score       int    `json:"score"`
			ConflictBps int    `json:"conflictBps"`
			Compliant   bool   `json:"compliant"`
			RiskBps     int    `json:"riskBps"`
			Root        string `json:"root"`
			Action      string `json:"action"`
		} `json:"epochs"`
	}
	if err := json.Unmarshal([]byte(out), &rep); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, out)
	}
	if rep.Scenario != "conflicting_sensors" || len(rep.Epochs) != 5 {
		t.Fatalf("unexpected report: %+v", rep)
	}
	last := rep.Epochs[4]
	if last.Score >= 60 || last.Compliant || last.Action != "PAUSE_FACILITY" || !strings.HasPrefix(last.Root, "0x") || len(last.Root) != 66 {
		t.Fatalf("last epoch: %+v", last)
	}
}

func TestRunsAreReproducible(t *testing.T) {
	a, _ := runCLI(t, "-scenario", "thermal_excursion", "-steps", "40", "-seed", "7")
	b, _ := runCLI(t, "-scenario", "thermal_excursion", "-steps", "40", "-seed", "7")
	if a != b {
		t.Fatal("same flags gave different output")
	}
}

func TestBadInputIsAnError(t *testing.T) {
	if _, err := runCLI(t, "-scenario", "nope"); err == nil {
		t.Fatal("unknown scenario accepted")
	}
	if _, err := runCLI(t, "-steps", "0"); err == nil {
		t.Fatal("zero steps accepted")
	}
	if _, err := runCLI(t, "-bogus"); err == nil {
		t.Fatal("unknown flag accepted")
	}
}
