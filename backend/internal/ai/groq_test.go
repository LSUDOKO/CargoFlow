package ai_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

const apiKey = "gsk_unit_test_key_do_not_leak"

func completion(content string) string {
	b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
	return string(b)
}

func groqAgainst(t *testing.T, h http.HandlerFunc) *ai.Groq {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return ai.NewGroq(ai.GroqConfig{APIKey: config.Secret(apiKey), Model: "test-model", BaseURL: srv.URL})
}

func TestGroqSendsAnAuthenticatedJSONModeRequestWithOnlyTheBrief(t *testing.T) {
	var gotAuth, gotPath, gotMethod string
	var body map[string]any
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath, gotMethod = r.Header.Get("Authorization"), r.URL.Path, r.Method
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = io.WriteString(w, completion(reply("PAUSE_FACILITY", "")))
	})
	b := brief()
	a, err := g.Assess(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if a.Action != decision.PauseFacility {
		t.Fatalf("%+v", a)
	}
	if gotMethod != http.MethodPost || gotPath != "/chat/completions" || gotAuth != "Bearer "+apiKey {
		t.Fatalf("method=%s path=%s auth set=%v", gotMethod, gotPath, gotAuth == "Bearer "+apiKey)
	}
	if body["model"] != "test-model" || body["temperature"] != float64(0) {
		t.Fatalf("model/temperature: %v", body)
	}
	if rf, _ := body["response_format"].(map[string]any); rf["type"] != "json_object" {
		t.Fatalf("response_format: %v", body["response_format"])
	}
	msgs, _ := body["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("want exactly a system and a user message, got %d", len(msgs))
	}
	user, _ := msgs[1].(map[string]any)
	want, _ := json.Marshal(b)
	if user["role"] != "user" || !strings.Contains(user["content"].(string), string(want)) {
		t.Fatalf("user message must carry the brief verbatim: %v", user)
	}
	if strings.Contains(mustJSON(body), apiKey) {
		t.Fatal("the API key leaked into the request body")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestGroqSystemPromptDeclaresTheDataUntrustedAndFixesTheAllowedActions(t *testing.T) {
	var sys string
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct{ Role, Content string }
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		sys = body.Messages[0].Content
		_, _ = io.WriteString(w, completion(reply("PAUSE_FACILITY", "")))
	})
	if _, err := g.Assess(context.Background(), brief()); err != nil {
		t.Fatal(err)
	}
	for _, must := range []string{"untrusted", "APPROVE_ADVANCE", "REQUEST_SECONDARY_PROOF", "PAUSE_FACILITY", "JSON", "advisory"} {
		if !strings.Contains(sys, must) {
			t.Fatalf("system prompt lacks %q:\n%s", must, sys)
		}
	}
	if strings.Contains(sys, "TRIGGER_DISPUTE") {
		t.Fatal("the model must not be offered the dispute action")
	}
}

func TestGroqFailuresAreErrorsNotDecisions(t *testing.T) {
	cases := map[string]http.HandlerFunc{
		"rate limited": func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(429)
			_, _ = io.WriteString(w, `{"error":{"message":"slow down `+apiKey+`"}}`)
		},
		"server error": func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) },
		"not json":     func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "<html>oops</html>") },
		"no choices":   func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, `{"choices":[]}`) },
		"prose answer": func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, completion("I would pause it."))
		},
		"overreaching": func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, completion(reply("TRANSFER_FUNDS", "")))
		},
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := groqAgainst(t, h).Assess(context.Background(), brief())
			if err == nil {
				t.Fatal("a failed call produced an assessment")
			}
			if strings.Contains(err.Error(), apiKey) {
				t.Fatalf("error leaks the API key: %v", err)
			}
		})
	}
}

func TestGroqOverreachIsReportedAsInvalidAssessment(t *testing.T) {
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, completion(reply("TRIGGER_DISPUTE", "")))
	})
	if _, err := g.Assess(context.Background(), brief()); !errors.Is(err, ai.ErrInvalidAssessment) {
		t.Fatalf("got %v", err)
	}
}

func TestGroqHonoursTheContextDeadline(t *testing.T) {
	release := make(chan struct{})
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) { <-release })
	defer close(release)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := g.Assess(ctx, brief()); err == nil {
		t.Fatal("expected a deadline error")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("the call ignored the deadline")
	}
}

func TestGroqCapsTheResponseSize(t *testing.T) {
	g := groqAgainst(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, completion(strings.Repeat("a", 2<<20)))
	})
	_, err := g.Assess(context.Background(), brief())
	if err == nil || !strings.Contains(err.Error(), "size limit") {
		t.Fatalf("an oversized reply must be cut off at the transport, got %v", err)
	}
}
