// Package auth authenticates evidence sources. A source signs each submission with an Ed25519 key;
// the store keeps only the public key, so a database leak exposes no credential that could forge data.
//
// A request carries X-Source-Id, X-Timestamp (unix seconds) and X-Signature (base64url, unpadded)
// over: "CARGOFLOW-V1\n" METHOD "\n" PATH "\n" TIMESTAMP "\n" hex(sha256(body)).
//
// The timestamp window stops stale captures being replayed indefinitely. Inside the window a replay is
// harmless rather than prevented: readings are idempotent on (shipment, sensor, timestamp), so a
// replayed body is recorded as a duplicate and quarantined.
package auth

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Errors returned by Verify and CheckSensors.
var (
	ErrMissingCredentials = errors.New("auth: missing credentials")
	ErrExpired            = errors.New("auth: timestamp outside the allowed window")
	ErrUnknownSource      = errors.New("auth: unknown source")
	ErrSourceDisabled     = errors.New("auth: source disabled")
	ErrBadSignature       = errors.New("auth: invalid signature")
	ErrSensorNotAllowed   = errors.New("auth: sensor not allowed for this source")
)

const signingPrefix = "CARGOFLOW-V1"

// SigningString is the exact byte string a source signs.
func SigningString(method, path string, timestamp int64, body []byte) []byte {
	sum := sha256.Sum256(body)
	return []byte(signingPrefix + "\n" + method + "\n" + path + "\n" + strconv.FormatInt(timestamp, 10) + "\n" + hex.EncodeToString(sum[:]))
}

// Sign produces the X-Signature value for a request.
func Sign(priv ed25519.PrivateKey, method, path string, timestamp int64, body []byte) string {
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, SigningString(method, path, timestamp, body)))
}

// Verifier authenticates requests against registered sources.
type Verifier struct {
	Lookup  func(ctx context.Context, sourceID string) (store.Source, error)
	Now     func() time.Time
	MaxSkew time.Duration
}

// Verify authenticates r, whose body bytes are supplied separately so the caller can read them once.
func (v *Verifier) Verify(ctx context.Context, r *http.Request, body []byte) (store.Source, error) {
	id := r.Header.Get("X-Source-Id")
	tsRaw := r.Header.Get("X-Timestamp")
	sigRaw := r.Header.Get("X-Signature")
	if id == "" || tsRaw == "" || sigRaw == "" {
		return store.Source{}, ErrMissingCredentials
	}
	ts, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return store.Source{}, fmt.Errorf("%w: malformed timestamp", ErrBadSignature)
	}
	skew := v.Now().Unix() - ts
	if skew < 0 {
		skew = -skew
	}
	if time.Duration(skew)*time.Second > v.MaxSkew {
		return store.Source{}, ErrExpired
	}

	src, err := v.Lookup(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return store.Source{}, ErrUnknownSource
	}
	if err != nil {
		return store.Source{}, err
	}

	sig, err := base64.RawURLEncoding.DecodeString(sigRaw)
	if err != nil || len(sig) != ed25519.SignatureSize || len(src.PublicKey) != ed25519.PublicKeySize {
		return store.Source{}, ErrBadSignature
	}
	if !ed25519.Verify(ed25519.PublicKey(src.PublicKey), SigningString(r.Method, r.URL.Path, ts, body), sig) {
		return store.Source{}, ErrBadSignature
	}
	// Checked only after the signature: a disabled source is reported solely to its own key holder,
	// so the API cannot be used to learn which source ids exist or are disabled.
	if src.Disabled {
		return store.Source{}, ErrSourceDisabled
	}
	return src, nil
}

// CheckSensors enforces that a source only reports sensors it is registered for.
func CheckSensors(src store.Source, points []telemetry.Point) error {
	allowed := make(map[string]bool, len(src.SensorIDs))
	for _, s := range src.SensorIDs {
		allowed[s] = true
	}
	for _, p := range points {
		if !allowed[p.SensorID] {
			return fmt.Errorf("%w: %q", ErrSensorNotAllowed, p.SensorID)
		}
	}
	return nil
}

// PublicError is the message safe to return to a caller. Unknown sources and bad signatures share one
// message so source ids cannot be enumerated.
func PublicError(err error) string {
	switch {
	case errors.Is(err, ErrMissingCredentials):
		return "missing credentials"
	case errors.Is(err, ErrExpired):
		return "request timestamp outside the allowed window; check your clock"
	case errors.Is(err, ErrSourceDisabled):
		return "source disabled"
	case errors.Is(err, ErrSensorNotAllowed):
		return err.Error()
	default: // unknown source, bad signature, malformed credentials
		return "invalid credentials"
	}
}
