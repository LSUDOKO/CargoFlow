package api

import "net/http"

// Public, unauthenticated endpoints that the web frontend needs. None of them reveals raw telemetry.

func (s *Server) stats(w http.ResponseWriter, r *http.Request) error {
	st, err := s.c.Store.Stats(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, st)
	return nil
}
