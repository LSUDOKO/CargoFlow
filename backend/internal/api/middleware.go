package api

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"runtime/debug"
	"time"
)

// Options configures the middleware chain.
type Options struct {
	Log         *slog.Logger
	CORSOrigins []string // exact origins allowed cross-origin; none means no CORS headers at all
	MaxBody     int64    // request body limit in bytes; defaults to 1 MiB
}

var safeRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// Chain wraps next with request ids, panic recovery, security headers, CORS, a body limit and access logs.
func Chain(next http.Handler, o Options) http.Handler {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	if o.MaxBody <= 0 {
		o.MaxBody = 1 << 20
	}
	allowed := map[string]bool{}
	for _, origin := range o.CORSOrigins {
		allowed[origin] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get("X-Request-Id")
		if !safeRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set("X-Request-Id", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if p := recover(); p != nil {
				o.Log.Error("panic in handler", "request_id", id, "path", r.URL.Path, "panic", p, "stack", string(debug.Stack()))
				if !rec.wrote {
					WriteError(rec, &Error{http.StatusInternalServerError, "internal", "internal error"})
				}
			}
			o.Log.Info("request", "request_id", id, "method", r.Method, "path", r.URL.Path,
				"status", rec.status, "duration_ms", time.Since(start).Milliseconds())
		}()

		if len(allowed) > 0 {
			w.Header().Add("Vary", "Origin")
			if origin := r.Header.Get("Origin"); origin != "" && allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Source-Id, X-Timestamp, X-Signature, X-WebAuthn-Authenticator-Data, X-WebAuthn-Client-Data, X-Request-Id")
					w.Header().Set("Access-Control-Max-Age", "600")
					rec.WriteHeader(http.StatusNoContent)
					return
				}
			} else if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				rec.WriteHeader(http.StatusNoContent) // a foreign preflight gets no grants
				return
			}
		}

		r.Body = http.MaxBytesReader(rec, r.Body, o.MaxBody)
		next.ServeHTTP(rec, r)
	})
}

func newRequestID() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// statusRecorder captures the status for access logs and lets the recover path know if a response began.
type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (s *statusRecorder) WriteHeader(code int) {
	if !s.wrote {
		s.status, s.wrote = code, true
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	s.wrote = true
	return s.ResponseWriter.Write(b)
}

// Unwrap, Hijack and Flush pass through so WebSocket upgrades and streaming work behind the recorder.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("api: the underlying response writer cannot be hijacked")
	}
	s.wrote = true
	return h.Hijack()
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
