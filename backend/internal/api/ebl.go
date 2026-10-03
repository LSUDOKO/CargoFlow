package api

import (
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

var tokenIDPattern = regexp.MustCompile(`^[0-9]{1,78}$`)

var errNoEBL = &Error{http.StatusNotFound, "not_found", "this deployment has no EBLRegistry"}

type billList struct {
	Bills []store.Bill `json:"bills"`
}

// bill returns one electronic bill of lading with its history and the shipment it is bound to.
func (s *Server) bill(w http.ResponseWriter, r *http.Request) error {
	if !s.c.Chain.HasEBL() {
		return errNoEBL
	}
	id := strings.TrimSpace(r.PathValue("tokenId"))
	if !tokenIDPattern.MatchString(id) {
		return ErrBadRequest("tokenId is a decimal token id")
	}
	id = strings.TrimLeft(id, "0")
	if id == "" {
		id = "0"
	}
	bills, err := s.c.Store.Bills(r.Context(), id)
	if err != nil {
		return err
	}
	if len(bills) == 0 {
		return ErrNotFoundMsg("no bill of lading with this token id")
	}
	writeJSON(w, http.StatusOK, bills[0])
	return nil
}

// bills lists bills of lading, optionally only those an address holds.
func (s *Server) bills(w http.ResponseWriter, r *http.Request) error {
	if !s.c.Chain.HasEBL() {
		return errNoEBL
	}
	holder := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("holder")))
	if holder != "" && !addressPattern.MatchString(holder) {
		return ErrBadRequest("holder must be a 0x address")
	}
	all, err := s.c.Store.Bills(r.Context(), "")
	if err != nil {
		return err
	}
	out := []store.Bill{}
	for _, b := range all {
		if holder == "" || b.Holder == holder {
			out = append(out, b)
		}
	}
	writeJSON(w, http.StatusOK, billList{Bills: out})
	return nil
}

// pausedCache remembers the contracts' paused() flags for 30 seconds.
type pausedCache struct {
	mu  sync.Mutex
	at  time.Time
	val pausedDTO
}

type pausedDTO struct {
	Controller bool `json:"controller"`
	CoverPool  bool `json:"coverPool"`
}

func (s *Server) pausedFlags(r *http.Request) pausedDTO {
	s.paused.mu.Lock()
	defer s.paused.mu.Unlock()
	if time.Since(s.paused.at) < 30*time.Second {
		return s.paused.val
	}
	var v pausedDTO
	if p, err := s.c.Chain.Paused(r.Context(), "controller"); err == nil {
		v.Controller = p
	}
	if s.c.Chain.HasCoverPool() {
		if p, err := s.c.Chain.Paused(r.Context(), "cover"); err == nil {
			v.CoverPool = p
		}
	}
	s.paused.val, s.paused.at = v, time.Now()
	return v
}
