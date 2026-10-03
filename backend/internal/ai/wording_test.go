package ai_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
)

var facts = ai.Wording{
	Headline: "Financing is paused: the latest evidence scored 41, below the policy minimum of 75.",
	Causes:   []string{"The latest evidence scored 41, below the policy minimum of 75.", "Readings left the agreed 2 to 8 °C band."},
}

func TestRewordingKeepsTheFactsAndSendsOnlyTheRuleText(t *testing.T) {
	var sent map[string]any
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&sent)
		out, _ := json.Marshal(map[string]any{
			"headline": "Funding is on hold because the evidence scored 41 against a required 75.",
			"causes":   []string{"Evidence came in at 41, short of the 75 the policy asks for.", "The cargo went outside its 2 to 8 °C range."},
		})
		_, _ = io.WriteString(w, completion(string(out)))
	})
	got, err := g.Reword(context.Background(), "PAUSED", facts)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.Headline, "Funding is on hold") || len(got.Causes) != 2 {
		t.Fatalf("reworded = %+v", got)
	}
	msgs := sent["messages"].([]any)
	user := msgs[1].(map[string]any)["content"].(string)
	var in map[string]any
	if err := json.Unmarshal([]byte(user), &in); err != nil || in["status"] != "PAUSED" || len(in) != 3 {
		t.Fatalf("the model was sent %s", user)
	}
}

func TestRewordingThatDropsAFactOrACauseIsRefused(t *testing.T) {
	for name, reply := range map[string]map[string]any{
		"a lost number":    {"headline": "Funding is on hold.", "causes": []string{"Evidence was 41 against 75.", "Outside 2 to 8 °C."}},
		"a missing cause":  {"headline": "On hold: 41 against 75.", "causes": []string{"Evidence was 41 against 75."}},
		"an overlong text": {"headline": "On hold: 41 against 75. " + strings.Repeat("x", 400), "causes": []string{"41 against 75.", "2 to 8 °C."}},
	} {
		g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
			out, _ := json.Marshal(reply)
			_, _ = io.WriteString(w, completion(string(out)))
		})
		if _, err := g.Reword(context.Background(), "PAUSED", facts); !errors.Is(err, ai.ErrInvalidWording) {
			t.Errorf("%s: err = %v, want ErrInvalidWording", name, err)
		}
	}
}
