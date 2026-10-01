package api

import (
	"errors"
	"net/http"

	"github.com/LSUDOKO/CargoFlow/backend/internal/demo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/hero"
)

// Judge-mode endpoints. They exist only when demo mode is on (Config.Demo != nil): the routes are not even
// registered otherwise.

func (s *Server) demoCreate(w http.ResponseWriter, r *http.Request) error {
	id, res, err := s.c.Demo.Create(r.Context())
	if err != nil {
		return s.demoErr(w, err, "")
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"shipmentId": id, "scene": res.Scene, "txHashes": res.TxHashes, "status": res.Status, "drawn": res.Drawn,
		"divisor": s.c.Demo.Divisor(),
	})
	return nil
}

func (s *Server) demoScene(w http.ResponseWriter, r *http.Request) error {
	id := r.PathValue("id")
	res, err := s.c.Demo.Scene(r.Context(), id, r.PathValue("scene"))
	if err != nil {
		return s.demoErr(w, err, id)
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func (s *Server) demoStatus(w http.ResponseWriter, r *http.Request) error {
	done, next, ok := s.c.Demo.Status(r.PathValue("id"))
	if !ok {
		return ErrNotFoundMsg("no demo run with that id (runs live in memory and end when the backend restarts)")
	}
	writeJSON(w, http.StatusOK, map[string]any{"done": done, "next": next, "divisor": s.c.Demo.Divisor()})
	return nil
}

// demoErr maps demo errors to responses. An out-of-order scene answers 409 with the scene that may run now,
// so the client can resynchronise.
func (s *Server) demoErr(w http.ResponseWriter, err error, id string) error {
	switch {
	case errors.Is(err, demo.ErrNotFound):
		return ErrNotFoundMsg("no demo run with that id")
	case errors.Is(err, demo.ErrBusy):
		return &Error{http.StatusTooManyRequests, "rate_limited", err.Error()}
	case errors.Is(err, hero.ErrUnknownScene):
		return ErrBadRequest("unknown scene; scenes are setup, healthy, excursion, recover, finish, settle")
	case errors.Is(err, hero.ErrOutOfOrder):
		_, next, _ := s.c.Demo.Status(id)
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]string{"code": "out_of_order", "message": err.Error()}, "next": next,
		})
		return nil
	}
	return err
}
