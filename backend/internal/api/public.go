package api

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Public, unauthenticated endpoints that the web frontend needs. None of them reveals raw telemetry.

func (s *Server) stats(w http.ResponseWriter, r *http.Request) error {
	st, err := s.c.Store.Stats(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, st)
	return nil
}

// clientIP is the connecting address. Forwarding headers are deliberately ignored: a client could set them
// to dodge the limit. Behind a reverse proxy, the proxy should enforce its own per-client limit.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// mirror lets anyone ask the backend to start tracking a shipment that already exists on-chain. It is safe to
// expose: RegisterShipment refuses anything the chain does not confirm and stores nothing on refusal. A repeat
// call returns the existing record.
func (s *Server) mirror(w http.ResponseWriter, r *http.Request) error {
	if err := s.rateLimit(w, "mirror:"+clientIP(r), s.c.MirrorPerMinute); err != nil {
		return err
	}
	var req shipmentRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	in, err := req.input()
	if err != nil {
		return err
	}
	in.DeriveScoring = true // a public caller never chooses the scoring parameters that gate releases
	existing, err := s.c.Store.GetShipment(r.Context(), strings.ToLower(strings.TrimSpace(req.ShipmentID)))
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, existing)
		return nil
	case !errors.Is(err, store.ErrNotFound):
		return err
	}
	sh, err := s.c.Service.RegisterShipment(r.Context(), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, sh)
	return nil
}

// telemetrySummary returns per-epoch, per-sensor temperature aggregates and the latest position, never
// individual readings.
func (s *Server) telemetrySummary(w http.ResponseWriter, r *http.Request) error {
	sum, err := s.c.Service.TelemetrySummary(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, sum)
	return nil
}

// track returns one position-and-temperature centroid per evidence epoch, oldest first: aggregates only.
func (s *Server) track(w http.ResponseWriter, r *http.Request) error {
	points, err := s.c.Service.Track(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"points": points})
	return nil
}

// party returns an address's track record as exporter, financier and buyer, with a summary grade.
func (s *Server) party(w http.ResponseWriter, r *http.Request) error {
	addr := strings.TrimSpace(r.PathValue("address"))
	if !addressPattern.MatchString(addr) {
		return ErrBadRequest("address must be a 0x address")
	}
	p, err := s.c.Store.PartyStats(r.Context(), addr)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, struct {
		store.PartyStats
		Grade string `json:"grade"`
	}{p, p.Grade()})
	return nil
}

// explanation says why a shipment is where it is, who can move it on, and where its temperature is heading.
func (s *Server) explanation(w http.ResponseWriter, r *http.Request) error {
	x, err := s.c.Service.Explain(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, x)
	return nil
}
