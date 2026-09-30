// Package api is CargoFlow's REST and WebSocket surface. Handlers are thin: they authenticate, decode
// strictly, call the service, and map its errors onto stable status codes and machine-readable codes.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
)

// Error is an API error with a stable, machine-readable code. Messages are written for API clients and
// must never contain secrets or internal detail.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// Constructors for the common cases.
func ErrBadRequest(msg string) error   { return &Error{http.StatusBadRequest, "invalid_request", msg} }
func ErrUnauthorized(msg string) error { return &Error{http.StatusUnauthorized, "unauthorized", msg} }
func ErrForbidden(msg string) error    { return &Error{http.StatusForbidden, "forbidden", msg} }
func ErrNotFoundMsg(msg string) error  { return &Error{http.StatusNotFound, "not_found", msg} }
func ErrConflictMsg(msg string) error  { return &Error{http.StatusConflict, "conflict", msg} }

type errorBody struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError renders err as a JSON error response. Unclassified errors become a generic 500: their text
// is logged by the caller, never sent to the client.
func WriteError(w http.ResponseWriter, err error) {
	var ae *Error
	var mbe *http.MaxBytesError
	switch {
	case errors.As(err, &ae):
	case errors.As(err, &mbe):
		ae = &Error{http.StatusRequestEntityTooLarge, "payload_too_large", "request body is too large"}
	default:
		ae = &Error{http.StatusInternalServerError, "internal", "internal error"}
	}
	var body errorBody
	body.Error.Code, body.Error.Message = ae.Code, ae.Message
	writeJSON(w, ae.Status, body)
}

// fromService maps service and chain errors onto API errors.
func fromService(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, service.ErrInvalid):
		return ErrBadRequest(trimPrefix(err))
	case errors.Is(err, service.ErrNotFound):
		return ErrNotFoundMsg("not found")
	case errors.Is(err, service.ErrConflict):
		return ErrConflictMsg("already exists")
	case errors.Is(err, service.ErrNotOnChain):
		return &Error{http.StatusUnprocessableEntity, "not_on_chain", "the shipment is not registered on chain"}
	case errors.Is(err, service.ErrPolicyNotRevealed):
		return &Error{http.StatusUnprocessableEntity, "policy_not_revealed", "the shipment's policy has not been revealed on chain"}
	case errors.Is(err, service.ErrNoFacility):
		return &Error{http.StatusConflict, "no_facility", "no facility exists on chain for this shipment"}
	case errors.Is(err, service.ErrNotPaused):
		return &Error{http.StatusConflict, "not_paused", "the facility is not paused"}
	case errors.Is(err, service.ErrNotRecoverable):
		return &Error{http.StatusUnprocessableEntity, "not_recoverable", trimPrefix(err)}
	case errors.Is(err, service.ErrNoProver):
		return &Error{http.StatusServiceUnavailable, "prover_unavailable", "no ZK prover is configured"}
	case errors.Is(err, auth.ErrSensorNotAllowed):
		return ErrForbidden(auth.PublicError(err))
	}
	if rev, ok := chain.AsRevert(err); ok {
		return &Error{http.StatusConflict, "chain_rejected", "the contract rejected the action: " + rev.Name}
	}
	return err // unclassified: WriteError turns it into a generic 500
}

func trimPrefix(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, ": "); i >= 0 && strings.HasPrefix(msg, "service:") {
		msg = msg[i+2:]
		if j := strings.Index(msg, ": "); j >= 0 && strings.HasPrefix(msg, "invalid input") {
			return msg[j+2:]
		}
	}
	return msg
}
