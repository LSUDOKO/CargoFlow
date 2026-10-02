package api

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

func asAPIError(err error, target **Error) bool { return errors.As(err, target) }

func hexAddr(a common.Address) string { return "0x" + hex.EncodeToString(a[:]) }

// decodeJSON strictly decodes a JSON request body: the right content type, no unknown fields, one value.
func decodeJSON(r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" {
		mt, _, err := mime.ParseMediaType(ct)
		if err != nil || mt != "application/json" {
			return &Error{http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json"}
		}
	} else {
		return &Error{http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json"}
	}
	return decodeBytes(r.Body, dst)
}

func decodeBytes(body io.Reader, dst any) error {
	dec := json.NewDecoder(body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		var ute *json.UnmarshalTypeError
		switch {
		case errors.As(err, &mbe):
			return err
		case errors.As(err, &ute):
			return ErrBadRequest(fmt.Sprintf("field %q has the wrong type", ute.Field))
		}
		return ErrBadRequest("the request body is not valid JSON for this endpoint: " + oneLine(err.Error()))
	}
	if dec.More() {
		return ErrBadRequest("the request body must contain a single JSON value")
	}
	return nil
}

func oneLine(s string) string { return strings.NewReplacer("\n", " ", "\r", " ").Replace(s) }

var (
	sourceIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)
	sensorPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	statusPattern   = regexp.MustCompile(`^[A-Z_]{1,32}$`)
)

type sourceRequest struct {
	ID             string   `json:"id"`
	PublicKey      string   `json:"publicKey"` // Ed25519, base64url or hex
	SensorIDs      []string `json:"sensorIds"`
	ReliabilityBps *int     `json:"reliabilityBps"`
}

func decodePublicKey(s string) ([]byte, error) {
	if b, err := hex.DecodeString(strings.TrimPrefix(s, "0x")); err == nil && len(b) == ed25519.PublicKeySize {
		return b, nil
	}
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.StdEncoding, base64.RawStdEncoding} {
		if b, err := enc.DecodeString(s); err == nil && len(b) == ed25519.PublicKeySize {
			return b, nil
		}
	}
	return nil, errors.New("publicKey must be a 32-byte Ed25519 key in base64url or hex")
}

func (s *Server) createSource(w http.ResponseWriter, r *http.Request) error {
	var req sourceRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	if !sourceIDPattern.MatchString(req.ID) {
		return ErrBadRequest("id must be 1-64 characters of a-z, 0-9, '.', '_' or '-'")
	}
	key, err := decodePublicKey(req.PublicKey)
	if err != nil {
		return ErrBadRequest(err.Error())
	}
	if len(req.SensorIDs) == 0 || len(req.SensorIDs) > 64 {
		return ErrBadRequest("sensorIds must list between 1 and 64 sensors")
	}
	for _, sensor := range req.SensorIDs {
		if !sensorPattern.MatchString(sensor) {
			return ErrBadRequest("sensor ids must be 1-64 characters of letters, digits, '.', '_' or '-'")
		}
	}
	reliability := 9500
	if req.ReliabilityBps != nil {
		reliability = *req.ReliabilityBps
	}
	if reliability < 0 || reliability > 10_000 {
		return ErrBadRequest("reliabilityBps must be between 0 and 10000")
	}
	if err := s.c.Store.UpsertSource(r.Context(), store.Source{ID: req.ID, PublicKey: key, SensorIDs: req.SensorIDs, ReliabilityBps: reliability}); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": req.ID, "sensorIds": req.SensorIDs, "reliabilityBps": reliability})
	return nil
}

type shipmentRequest struct {
	ShipmentID  string             `json:"shipmentId"`
	ExternalRef string             `json:"externalRef"`
	Route       []store.RoutePoint `json:"route"`
	MaxGapSec   int                `json:"maxGapSec"`
	MinSensors  int                `json:"minSensors"`
}

// input validates the request shape and converts it for the service.
func (req shipmentRequest) input() (service.ShipmentInput, error) {
	if len(req.Route) > 256 {
		return service.ShipmentInput{}, ErrBadRequest("a route may have at most 256 waypoints")
	}
	return service.ShipmentInput{
		ShipmentID: req.ShipmentID, ExternalRef: req.ExternalRef, Route: req.Route, MaxGapSec: req.MaxGapSec, MinSensors: req.MinSensors,
	}, nil
}

func (s *Server) createShipment(w http.ResponseWriter, r *http.Request) error {
	var req shipmentRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	in, err := req.input()
	if err != nil {
		return err
	}
	sh, err := s.c.Service.RegisterShipment(r.Context(), in)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, sh)
	return nil
}

var addressPattern = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

func (s *Server) listShipments(w http.ResponseWriter, r *http.Request) error {
	limit, offset := 50, 0
	q := r.URL.Query()
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxListLimit {
			return ErrBadRequest(fmt.Sprintf("limit must be between 1 and %d", maxListLimit))
		}
		limit = n
	}
	if v := q.Get("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return ErrBadRequest("offset must be a non-negative integer")
		}
		offset = n
	}
	filter := store.ShipmentFilter{Ref: strings.TrimSpace(q.Get("ref")), Party: strings.TrimSpace(q.Get("party"))}
	if filter.Party != "" && !addressPattern.MatchString(filter.Party) {
		return ErrBadRequest("party must be a 0x address")
	}
	if len(filter.Ref) > 128 {
		return ErrBadRequest("ref is too long")
	}
	if raw := strings.TrimSpace(q.Get("status")); raw != "" {
		for _, st := range strings.Split(raw, ",") {
			st = strings.ToUpper(strings.TrimSpace(st))
			if !statusPattern.MatchString(st) {
				return ErrBadRequest("status is a comma-separated list such as PAUSED,DISPUTED")
			}
			filter.Status = append(filter.Status, st)
		}
	}
	list, err := s.c.Store.ListShipmentsWhere(r.Context(), filter, limit, offset)
	if err != nil {
		return err
	}
	if list == nil {
		list = []store.Shipment{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"shipments": list, "limit": limit, "offset": offset})
	return nil
}

func (s *Server) getShipment(w http.ResponseWriter, r *http.Request) error {
	v, err := s.c.Service.View(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, v)
	return nil
}

type pointDTO struct {
	Timestamp       int64  `json:"timestamp"`
	SensorID        string `json:"sensorId"`
	TemperatureX100 int32  `json:"temperatureX100"`
	HumidityX100    int32  `json:"humidityX100"`
	LatitudeE6      int32  `json:"latitudeE6"`
	LongitudeE6     int32  `json:"longitudeE6"`
	ShockX100       int32  `json:"shockX100"`
}

type telemetryRequest struct {
	Points []pointDTO `json:"points"`
}

func (s *Server) telemetry(w http.ResponseWriter, r *http.Request) error {
	// The body is read once, verified against the source's signature, and only then decoded: unauthenticated
	// callers never reach the parser beyond the size cap.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	src, err := s.c.Verifier.Verify(r.Context(), r, body)
	if err != nil {
		if isAuthFailure(err) {
			return ErrUnauthorized(auth.PublicError(err))
		}
		return err
	}
	if err := s.rateLimit(w, "source:"+src.ID, s.c.TelemetryPerMinute); err != nil {
		return err
	}
	if mt, _, perr := mime.ParseMediaType(r.Header.Get("Content-Type")); perr != nil || mt != "application/json" {
		return &Error{http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json"}
	}
	var req telemetryRequest
	if err := decodeBytes(strings.NewReader(string(body)), &req); err != nil {
		return err
	}
	if len(req.Points) == 0 {
		return ErrBadRequest("points must contain at least one reading")
	}
	if len(req.Points) > maxPointsPerBatch {
		return &Error{http.StatusRequestEntityTooLarge, "payload_too_large", fmt.Sprintf("at most %d readings per request", maxPointsPerBatch)}
	}
	now := time.Now()
	if s.c.Now != nil {
		now = s.c.Now()
	}
	for i, p := range req.Points {
		if p.Timestamp > now.Unix()+maxFutureSkewSec {
			return ErrBadRequest(fmt.Sprintf("reading %d is dated in the future; check the device clock", i))
		}
	}
	budgetKey := "readings:" + strings.ToLower(strings.TrimSpace(r.PathValue("id")))
	if ok, wait := s.limiter.allowN(budgetKey, len(req.Points), s.c.ShipmentReadingsPerHour, time.Hour); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		return &Error{http.StatusTooManyRequests, "rate_limited", "this shipment has received its hourly allowance of readings; retry later"}
	}
	points := make([]telemetry.Point, len(req.Points))
	for i, p := range req.Points {
		points[i] = telemetry.Point{
			Timestamp: p.Timestamp, SensorID: p.SensorID, TemperatureX100: p.TemperatureX100, HumidityX100: p.HumidityX100,
			LatitudeE6: p.LatitudeE6, LongitudeE6: p.LongitudeE6, ShockX100: p.ShockX100,
		}
	}
	if err := auth.CheckSensors(src, points); err != nil {
		return err
	}
	if src.ShipmentID != "" && !strings.EqualFold(src.ShipmentID, strings.TrimSpace(r.PathValue("id"))) {
		return ErrForbidden("this evidence source is registered for a different shipment")
	}
	res, err := s.c.Service.IngestTelemetry(r.Context(), r.PathValue("id"), src.ID, points)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func isAuthFailure(err error) bool {
	for _, target := range []error{auth.ErrMissingCredentials, auth.ErrExpired, auth.ErrUnknownSource, auth.ErrSourceDisabled, auth.ErrBadSignature} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

func (s *Server) proof(w http.ResponseWriter, r *http.Request) error {
	var req struct {
		SensorID string `json:"sensorId"`
	}
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	res, err := s.c.Service.Recover(r.Context(), r.PathValue("id"), req.SensorID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

// reconcile runs one reconciliation pass on demand and returns what it did.
func (s *Server) reconcile(w http.ResponseWriter, r *http.Request) error {
	rep, err := s.c.Service.Reconcile(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, rep)
	return nil
}

func (s *Server) epochs(w http.ResponseWriter, r *http.Request) error {
	eps, err := s.c.Service.Epochs(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"epochs": eps})
	return nil
}

func (s *Server) audit(w http.ResponseWriter, r *http.Request) error {
	limit := 500
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 2000 {
			return ErrBadRequest("limit must be between 1 and 2000")
		}
		limit = n
	}
	entries, err := s.c.Service.Audit(r.Context(), r.PathValue("id"), limit)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	return nil
}
