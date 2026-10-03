package api

import (
	"net/http"
	"strings"
)

// suggestFee returns the fee guidance for a shipment: a band, the reasons, and the inputs behind them.
func (s *Server) suggestFee(w http.ResponseWriter, r *http.Request) error {
	id := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("shipment")))
	if id == "" {
		return ErrBadRequest("shipment is a shipment id")
	}
	sug, err := s.c.Service.SuggestFee(r.Context(), id)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, sug)
	return nil
}
