package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// maxGatewaysPerShipment bounds how many evidence sources an exporter can bind to one shipment.
const maxGatewaysPerShipment = 8

type gatewayRequest struct {
	Label     string   `json:"label"`
	PublicKey string   `json:"publicKey"`
	SensorIDs []string `json:"sensorIds"`
	IssuedAt  int64    `json:"issuedAt"`
	Signature string   `json:"signature"`
}

type sourceDTO struct {
	ID         string    `json:"id"`
	ShipmentID string    `json:"shipmentId"`
	Label      string    `json:"label"`
	PublicKey  string    `json:"publicKey"`
	SensorIDs  []string  `json:"sensorIds"`
	CreatedAt  time.Time `json:"createdAt"`
}

func toSourceDTO(s store.Source) sourceDTO {
	return sourceDTO{ID: s.ID, ShipmentID: s.ShipmentID, Label: s.Label, PublicKey: base64.RawURLEncoding.EncodeToString(s.PublicKey), SensorIDs: s.SensorIDs, CreatedAt: s.CreatedAt}
}

// SourceIDFor derives a gateway's id from its public key, so the same device always has the same id.
func SourceIDFor(pub []byte) string {
	sum := sha256.Sum256(pub)
	return "src-" + hex.EncodeToString(sum[:])[:16]
}

// shipmentFor loads a shipment by its path id; an unknown id is a 404.
func (s *Server) shipmentFor(r *http.Request) (store.Shipment, error) {
	sh, err := s.c.Store.GetShipment(r.Context(), strings.ToLower(strings.TrimSpace(r.PathValue("id"))))
	if errors.Is(err, store.ErrNotFound) {
		return sh, ErrNotFoundMsg("no shipment with this id")
	}
	return sh, err
}

// registerGateway lets a shipment's exporter authorize an evidence source with a wallet signature. The source is
// bound to that shipment: it can never report for another one.
func (s *Server) registerGateway(w http.ResponseWriter, r *http.Request) error {
	var req gatewayRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	pub, err := base64.RawURLEncoding.DecodeString(req.PublicKey)
	if err != nil || len(pub) != 32 {
		return ErrBadRequest("publicKey must be a base64url Ed25519 public key (32 bytes)")
	}
	if len(req.SensorIDs) == 0 || len(req.SensorIDs) > 16 {
		return ErrBadRequest("name 1 to 16 sensors")
	}
	for _, sid := range req.SensorIDs {
		if !sensorPattern.MatchString(sid) {
			return ErrBadRequest("sensor ids use letters, digits, dot, dash or underscore (at most 64)")
		}
	}
	if len(req.Label) > 80 {
		return ErrBadRequest("the label is at most 80 characters")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	if _, err := s.walletSigner(r.Context(), auth.SourceAuthorization(sh.ID, req.PublicKey, req.SensorIDs, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the shipment's exporter can add an evidence source", strings.ToLower(sh.Exporter)); err != nil {
		return err
	}
	// after authorization, so nobody else can use up the exporter's allowance
	if err := s.rateLimit(w, "gateway:"+sh.ID, s.c.GatewayPerMinute); err != nil {
		return err
	}
	existing, err := s.c.Store.SourcesForShipment(r.Context(), sh.ID)
	if err != nil {
		return err
	}
	if len(existing) >= maxGatewaysPerShipment && !slices.ContainsFunc(existing, func(x store.Source) bool { return x.ID == SourceIDFor(pub) }) {
		return ErrConflictMsg(fmt.Sprintf("a shipment can have at most %d gateways", maxGatewaysPerShipment))
	}
	src, created, err := s.c.Store.RegisterBoundSource(r.Context(), store.Source{
		ID: SourceIDFor(pub), PublicKey: pub, SensorIDs: req.SensorIDs, ShipmentID: sh.ID, Label: strings.TrimSpace(req.Label),
	})
	if errors.Is(err, store.ErrConflict) {
		return ErrConflictMsg("this device key is already registered for another shipment; generate a new key")
	}
	if err != nil {
		return err
	}
	if !created && !sameSensors(src.SensorIDs, req.SensorIDs) {
		return ErrConflictMsg("this device key is already registered with other sensors; generate a new key for a different sensor set")
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, toSourceDTO(src))
	return nil
}

// sameSensors reports whether two sensor lists name the same sensors, in any order.
func sameSensors(a, b []string) bool {
	x, y := slices.Clone(a), slices.Clone(b)
	slices.Sort(x)
	slices.Sort(y)
	return slices.Equal(slices.Compact(x), slices.Compact(y))
}

func (s *Server) listGateways(w http.ResponseWriter, r *http.Request) error {
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	list, err := s.c.Store.SourcesForShipment(r.Context(), sh.ID)
	if err != nil {
		return err
	}
	out := make([]sourceDTO, len(list))
	for i, src := range list {
		out[i] = toSourceDTO(src)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": out})
	return nil
}
