package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

func TestEveryResponseCarriesARequestId(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }), api.Options{Log: quietLogger()})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/x", nil))
	id := rr.Header().Get("X-Request-Id")
	if len(id) < 16 {
		t.Fatalf("generated request id = %q", id)
	}

	rr = httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("X-Request-Id", "trace-abc-123")
	h.ServeHTTP(rr, req)
	if rr.Header().Get("X-Request-Id") != "trace-abc-123" {
		t.Fatal("a sane caller-supplied request id must be preserved for tracing")
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("X-Request-Id", strings.Repeat("x", 500)+"\nInjected: header")
	h.ServeHTTP(rr, req)
	if got := rr.Header().Get("X-Request-Id"); len(got) > 64 || strings.ContainsAny(got, "\r\n") {
		t.Fatalf("an unsafe request id was echoed: %q", got)
	}
}

func TestPanicsBecomeAJSON500WithoutLeakingDetails(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { panic("secret internal detail: db password") }), api.Options{Log: quietLogger()})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/boom", nil))
	if rr.Code != 500 {
		t.Fatalf("status = %d", rr.Code)
	}
	if strings.Contains(rr.Body.String(), "secret internal detail") {
		t.Fatalf("a panic message leaked to the client: %s", rr.Body)
	}
	var body struct {
		Error struct{ Code, Message string }
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Error.Code != "internal" {
		t.Fatalf("error body = %s (%v)", rr.Body, err)
	}
	if rr.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("content type = %q", rr.Header().Get("Content-Type"))
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }), api.Options{Log: quietLogger()})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("GET", "/x", nil))
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" || rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("headers = %v", rr.Header())
	}
}

func TestOversizedBodiesAreRejected(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			api.WriteError(w, err)
			return
		}
		w.WriteHeader(200)
	}), api.Options{Log: quietLogger(), MaxBody: 100})
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(make([]byte, 101))))
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rr.Code)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, httptest.NewRequest("POST", "/x", bytes.NewReader(make([]byte, 100))))
	if rr.Code != 200 {
		t.Fatalf("a body at the limit must pass, got %d", rr.Code)
	}
}

func TestCORSAllowsOnlyConfiguredOrigins(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }),
		api.Options{Log: quietLogger(), CORSOrigins: []string{"https://app.example.com"}})

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Origin", "https://app.example.com")
	h.ServeHTTP(rr, req)
	if rr.Header().Get("Access-Control-Allow-Origin") != "https://app.example.com" || rr.Header().Get("Vary") == "" {
		t.Fatalf("allowed origin headers = %v", rr.Header())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Origin", "https://evil.example")
	h.ServeHTTP(rr, req)
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("a foreign origin was granted CORS access")
	}

	// preflight
	rr = httptest.NewRecorder()
	req = httptest.NewRequest("OPTIONS", "/v1/shipments", nil)
	req.Header.Set("Origin", "https://app.example.com")
	req.Header.Set("Access-Control-Request-Method", "POST")
	h.ServeHTTP(rr, req)
	if rr.Code != 204 || !strings.Contains(rr.Header().Get("Access-Control-Allow-Headers"), "X-Signature") {
		t.Fatalf("preflight = %d %v", rr.Code, rr.Header())
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest("OPTIONS", "/v1/shipments", nil)
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Access-Control-Request-Method", "POST")
	h.ServeHTTP(rr, req)
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("a foreign preflight was granted")
	}
}

func TestNoCORSHeadersWhenNoOriginsAreConfigured(t *testing.T) {
	h := api.Chain(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }), api.Options{Log: quietLogger()})
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	req.Header.Set("Origin", "https://anything.example")
	h.ServeHTTP(rr, req)
	if rr.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("with no configured origins the API must not grant cross-origin access")
	}
}

func TestErrorsMapToStatusCodesAndStableCodes(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{api.ErrBadRequest("bad"), 400, "invalid_request"},
		{api.ErrUnauthorized("no"), 401, "unauthorized"},
		{api.ErrForbidden("no"), 403, "forbidden"},
		{api.ErrNotFoundMsg("gone"), 404, "not_found"},
		{api.ErrConflictMsg("dup"), 409, "conflict"},
	}
	for _, tc := range cases {
		rr := httptest.NewRecorder()
		api.WriteError(rr, tc.err)
		var body struct {
			Error struct{ Code, Message string }
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		if rr.Code != tc.status || body.Error.Code != tc.code || body.Error.Message == "" {
			t.Errorf("%v -> %d %s", tc.err, rr.Code, rr.Body)
		}
	}
	rr := httptest.NewRecorder()
	api.WriteError(rr, io.ErrUnexpectedEOF) // an unclassified error
	if rr.Code != 500 || strings.Contains(rr.Body.String(), "unexpected EOF") {
		t.Fatalf("unclassified errors must be 500 and not leak their text: %d %s", rr.Code, rr.Body)
	}
}
