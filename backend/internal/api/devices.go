package api

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

type deviceDTO struct {
	KeyHash        string               `json:"keyHash"`
	KeyType        string               `json:"keyType" enum:"ed25519,p256,webauthn"`
	DeviceClass    string               `json:"deviceClass" enum:"software,passkey,secure_element"`
	ReliabilityBps int                  `json:"reliabilityBps"`
	SourceID       string               `json:"sourceId"`
	ShipmentID     string               `json:"shipmentId" doc:"empty for an operator-registered source"`
	Label          string               `json:"label"`
	SensorIDs      []string             `json:"sensorIds"`
	Disabled       bool                 `json:"disabled"`
	Attested       bool                 `json:"attested"`
	Attestation    map[string]any       `json:"attestation" doc:"what registration verified: format, certificate subjects, aaguid, origin"`
	RegisteredAt   time.Time            `json:"registeredAt"`
	OnChain        *store.OnChainDevice `json:"onChain" doc:"the v3 DeviceRegistry record; null on a deployment without it"`
}

var keyHashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// device shows one device key: its class, what its attestation proved, and the source it feeds.
func (s *Server) device(w http.ResponseWriter, r *http.Request) error {
	kh := strings.ToLower(strings.TrimSpace(r.PathValue("keyHash")))
	if !keyHashPattern.MatchString(kh) {
		return ErrBadRequest("keyHash is 0x followed by 64 hex characters (keccak256 of the device's public key)")
	}
	src, err := s.c.Store.SourceByKeyHash(r.Context(), kh)
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotFoundMsg("no device with this key hash")
	}
	if err != nil {
		return err
	}
	attested, _ := src.Attestation["attested"].(bool)
	out := deviceDTO{KeyHash: src.KeyHash, KeyType: src.KeyType, DeviceClass: src.DeviceClass, ReliabilityBps: src.ReliabilityBps, SourceID: src.ID,
		ShipmentID: src.ShipmentID, Label: src.Label, SensorIDs: src.SensorIDs, Disabled: src.Disabled, Attested: attested,
		Attestation: src.Attestation, RegisteredAt: src.CreatedAt}
	if s.c.Chain != nil && s.c.Chain.HasDeviceRegistry() {
		oc, err := s.onChainDevice(r.Context(), kh)
		if err != nil {
			return err
		}
		out.OnChain = &oc
	}
	writeJSON(w, http.StatusOK, out)
	return nil
}

// onChainDevice reads a device's DeviceRegistry record live, with the registering transaction from the index (or the
// backend's own outbox when the event is not indexed yet).
func (s *Server) onChainDevice(ctx context.Context, kh string) (store.OnChainDevice, error) {
	var h [32]byte
	b, _ := hex.DecodeString(kh[2:])
	copy(h[:], b)
	rec, ok, err := s.c.Chain.Device(ctx, h)
	if err != nil {
		return store.OnChainDevice{}, err
	}
	out := store.OnChainDevice{Registered: ok}
	if !ok {
		return out, nil
	}
	out.DeviceClass, out.Revoked = []string{store.ClassSoftware, store.ClassPasskey, store.ClassSecureElement}[min(int(rec.DeviceClass), 2)], rec.Revoked
	if idx, err := s.c.Store.DevicesOnChain(ctx, kh); err == nil && idx[kh].TxHash != "" {
		out.TxHash = idx[kh].TxHash
	} else if a, err := s.c.Store.ActionByKey(ctx, "device:"+kh); err == nil {
		out.TxHash = a.TxHash
	}
	return out, nil
}

// classReliability is the reliability an operator-registered source gets when none is given.
func classReliability(class string) int { return devicetrust.ReliabilityBps(class) }
