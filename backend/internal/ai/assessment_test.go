package ai_test

import (
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

func brief() ai.Brief {
	r := result()
	return ai.NewBrief(shipment, r, 4000, limits, decision.Decide(r, 4000, limits))
}

func reply(action, extra string) string {
	return `{"shipmentId":"` + shipment + `","severity":"CRITICAL","action":"` + action + `","reasonCode":"CONFLICT_TOO_HIGH",` +
		`"confidence":0.97,"evidence":{"score":48,"conflictBps":7800,"riskBps":4000},"requestedNextStep":"REQUEST_SECONDARY_PROOF",` +
		`"explanation":"The probes disagree by 7800 bps."` + extra + `}`
}

func TestParseAcceptsAWellFormedAssessment(t *testing.T) {
	a, err := ai.ParseAssessment([]byte(reply("PAUSE_FACILITY", "")), brief())
	if err != nil {
		t.Fatal(err)
	}
	if a.Action != decision.PauseFacility || a.Confidence != 0.97 || a.ReasonCode != "CONFLICT_TOO_HIGH" {
		t.Fatalf("%+v", a)
	}
}

func TestParseRejectsEveryMalformedOrOverreachingAssessment(t *testing.T) {
	good := reply("PAUSE_FACILITY", "")
	cases := map[string]string{
		"not json":                 "I recommend pausing.",
		"trailing second document": good + good,
		"unknown field":            reply("PAUSE_FACILITY", `,"transferTo":"0x0000000000000000000000000000000000000bad"`),
		"dispute is not wired":     reply("TRIGGER_DISPUTE", ""),
		"arbitrary action":         reply("TRANSFER_FUNDS", ""),
		"lowercase action":         reply("pause_facility", ""),
		"wrong shipment":           strings.Replace(good, shipment, "0x"+strings.Repeat("11", 32), 1),
		"bad severity":             strings.Replace(good, `"CRITICAL"`, `"APOCALYPTIC"`, 1),
		"bad reason code":          strings.Replace(good, `"CONFLICT_TOO_HIGH"`, `"BECAUSE_I_SAID_SO"`, 1),
		"confidence above one":     strings.Replace(good, `0.97`, `1.5`, 1),
		"negative confidence":      strings.Replace(good, `0.97`, `-0.1`, 1),
		"hallucinated score":       strings.Replace(good, `"score":48`, `"score":98`, 1),
		"hallucinated conflict":    strings.Replace(good, `"conflictBps":7800`, `"conflictBps":100`, 1),
		"bad next step":            strings.Replace(good, `"requestedNextStep":"REQUEST_SECONDARY_PROOF"`, `"requestedNextStep":"WIRE_MONEY"`, 1),
		"explanation too long":     strings.Replace(good, `"The probes disagree by 7800 bps."`, `"`+strings.Repeat("x", 600)+`"`, 1),
		"empty":                    "",
		"oversized":                `{"x":"` + strings.Repeat("a", 70_000) + `"}`,
		"missing evidence":         strings.Replace(good, `"evidence":{"score":48,"conflictBps":7800,"riskBps":4000},`, "", 1),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if a, err := ai.ParseAssessment([]byte(raw), brief()); err == nil {
				t.Fatalf("accepted %+v", a)
			}
		})
	}
}

func TestExplanationIsStrippedOfControlCharacters(t *testing.T) {
	raw := strings.Replace(reply("PAUSE_FACILITY", ""), `The probes disagree by 7800 bps.`, `line one\n\u001b[31mred\u0000end`, 1)
	a, err := ai.ParseAssessment([]byte(raw), brief())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range a.Explanation {
		if r < 0x20 && r != ' ' || r == 0x7f {
			t.Fatalf("control character %q survived in %q", r, a.Explanation)
		}
	}
}
