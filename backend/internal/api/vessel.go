package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ais"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Vessel display bounds.
const (
	maxVesselName  = 120
	vesselTrackLen = 500
	liveWithinSec  = 30 * 60 // an AIS fix older than this is not live
)

var mmsiPattern = regexp.MustCompile(`^[0-9]{9}$`)

type vesselRequest struct {
	MMSI      baseUnits `json:"mmsi"` // a string; a bare JSON number keeps its digits
	Name      string    `json:"name" optional:"true"`
	IssuedAt  int64     `json:"issuedAt"`
	Signature string    `json:"signature"`
}

type vesselFix struct {
	LatE6     int32 `json:"latE6"`
	LonE6     int32 `json:"lonE6"`
	Timestamp int64 `json:"timestamp"`
}

type vesselLast struct {
	vesselFix
	SogKnotsX10 int32 `json:"sogKnotsX10"`
	CogDegX10   int32 `json:"cogDegX10"`
}

type vesselDTO struct {
	MMSI       string      `json:"mmsi"`
	Name       string      `json:"name"`
	Live       bool        `json:"live"`
	Last       *vesselLast `json:"last"`
	Track      []vesselFix `json:"track"`
	CrossCheck *ais.Check  `json:"crossCheck"`
}

// vesselView assembles what is known about a shipment's vessel. Without a live AIS feed only the name is shown.
func (s *Server) vesselView(r *http.Request, v store.Vessel) (vesselDTO, error) {
	out := vesselDTO{MMSI: v.MMSI, Name: v.Name, Track: []vesselFix{}}
	if !s.c.AIS.Enabled() {
		return out, nil
	}
	track, err := s.c.Store.VesselTrack(r.Context(), v.MMSI, v.CreatedAt.Add(-24*time.Hour).Unix(), vesselTrackLen)
	if err != nil {
		return out, err
	}
	for _, p := range track {
		out.Track = append(out.Track, vesselFix{p.LatE6, p.LonE6, p.Timestamp})
	}
	if len(track) == 0 {
		return out, nil
	}
	last := track[len(track)-1]
	out.Last = &vesselLast{vesselFix{last.LatE6, last.LonE6, last.Timestamp}, last.SogKnotsX10, last.CogDegX10}
	out.Live = s.now().Unix()-last.Timestamp <= liveWithinSec
	logger, err := s.c.Store.LatestReading(r.Context(), v.ShipmentID)
	switch {
	case err == nil:
		c := ais.CrossCheck(logger, last)
		out.CrossCheck = &c
	case !errors.Is(err, store.ErrNotFound):
		return out, err
	}
	return out, nil
}

// setVessel lets the exporter name the vessel carrying the shipment, by MMSI. Naming it again replaces it.
func (s *Server) setVessel(w http.ResponseWriter, r *http.Request) error {
	var req vesselRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	mmsi, name := strings.TrimSpace(string(req.MMSI)), strings.TrimSpace(req.Name)
	if !mmsiPattern.MatchString(mmsi) {
		return ErrBadRequest("mmsi is the vessel's 9-digit Maritime Mobile Service Identity")
	}
	if utf8.RuneCountInString(name) > maxVesselName || !printable(name) {
		return ErrBadRequest("name is at most 120 printable characters")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	signer, err := s.walletSigner(r.Context(), auth.VesselAuthorization(sh.ID, mmsi, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the shipment's exporter can name its vessel", strings.ToLower(sh.Exporter))
	if err != nil {
		return err
	}
	v, created, err := s.c.Store.SetVessel(r.Context(), store.Vessel{ShipmentID: sh.ID, MMSI: mmsi, Name: name, RegisteredBy: signer})
	if err != nil {
		return err
	}
	if err := s.c.AIS.Refresh(r.Context()); err != nil {
		s.c.Log.Warn("refresh AIS subscription", "err", err)
	}
	out, err := s.vesselView(r, v)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, out)
	return nil
}

func (s *Server) getVessel(w http.ResponseWriter, r *http.Request) error {
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	v, err := s.c.Store.VesselFor(r.Context(), sh.ID)
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotFoundMsg("no vessel is registered for this shipment")
	}
	if err != nil {
		return err
	}
	out, err := s.vesselView(r, v)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}
