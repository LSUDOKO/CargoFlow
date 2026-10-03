package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// maxGatewaysPerShipment bounds how many evidence sources an exporter can bind to one shipment.
const maxGatewaysPerShipment = 8

type gatewayRequest struct {
	Label       string            `json:"label" optional:"true" doc:"display name, at most 80 characters"`
	PublicKey   string            `json:"publicKey" doc:"base64url: a 32-byte Ed25519 key; for p256 and webauthn a SEC1 P-256 point (33 or 65 bytes) or a DER SubjectPublicKeyInfo"`
	KeyType     string            `json:"keyType,omitempty" enum:"ed25519,p256,webauthn" doc:"default ed25519"`
	SensorIDs   []string          `json:"sensorIds"`
	Attestation *attestationInput `json:"attestation,omitempty" doc:"x509 for a secure element's P-256 key; webauthn (required) for a passkey"`
	IssuedAt    int64             `json:"issuedAt"`
	Signature   string            `json:"signature"`
}

// attestationInput is the evidence that a device key lives in hardware.
type attestationInput struct {
	Format            string   `json:"format" enum:"x509,webauthn"`
	Chain             []string `json:"chain,omitempty" doc:"x509: PEM certificates, the device's own first; must verify to a root in DEVICE_ROOTS_DIR"`
	AttestationObject string   `json:"attestationObject,omitempty" doc:"webauthn: base64url attestationObject from navigator.credentials.create (fmt packed or none)"`
	ClientDataJSON    string   `json:"clientDataJSON,omitempty" doc:"webauthn: base64url clientDataJSON; type webauthn.create, challenge sha256(\"CARGOFLOW-V1-REGISTER\\n\" + shipment id)"`
}

type sourceDTO struct {
	ID             string         `json:"id"`
	ShipmentID     string         `json:"shipmentId"`
	Label          string         `json:"label"`
	PublicKey      string         `json:"publicKey" doc:"base64url of the stored key: 32-byte Ed25519 or 65-byte uncompressed P-256 point"`
	KeyType        string         `json:"keyType" enum:"ed25519,p256,webauthn"`
	DeviceClass    string         `json:"deviceClass" enum:"software,passkey,secure_element"`
	KeyHash        string         `json:"keyHash" doc:"0x + keccak256(public key bytes); see GET /v1/devices/{keyHash}"`
	Attested       bool           `json:"attested" doc:"an attestation chain verified to a trusted root"`
	ReliabilityBps int            `json:"reliabilityBps" doc:"the weight the evidence engine gives this source's sensors"`
	SensorIDs      []string       `json:"sensorIds"`
	CreatedAt      time.Time      `json:"createdAt"`
	Attestation    map[string]any `json:"attestation,omitempty" doc:"what registration verified"`
	DeviceTx       string         `json:"deviceTx,omitempty" doc:"v3: the DeviceRegistry.registerDevice transaction (registration responses only)"`
}

func toSourceDTO(s store.Source) sourceDTO {
	attested, _ := s.Attestation["attested"].(bool)
	return sourceDTO{ID: s.ID, ShipmentID: s.ShipmentID, Label: s.Label, PublicKey: base64.RawURLEncoding.EncodeToString(s.PublicKey), SensorIDs: s.SensorIDs,
		CreatedAt: s.CreatedAt, KeyType: s.KeyType, DeviceClass: s.DeviceClass, KeyHash: s.KeyHash, Attested: attested, ReliabilityBps: s.ReliabilityBps,
		Attestation: s.Attestation}
}

// device is a verified device key ready to be stored.
type device struct {
	pub         []byte
	keyType     string
	class       string
	attestation map[string]any
	credID      []byte
	rpIDHash    []byte
	signCount   uint32
	attHash     [32]byte // keccak256 of the attestation bytes (DER chain, or the WebAuthn attestationObject); zero without one
}

// verifyDevice decodes a device key of keyType and checks its attestation, deciding the device class.
func (s *Server) verifyDevice(shipmentID, keyType, publicKey string, att *attestationInput) (device, error) {
	if keyType == "" {
		keyType = devicetrust.KeyEd25519
	}
	raw, err := devicetrust.DecodeB64(publicKey)
	if err != nil {
		return device{}, ErrBadRequest("publicKey must be base64url")
	}
	d := device{keyType: keyType, class: devicetrust.ClassSoftware, attestation: map[string]any{}}
	switch keyType {
	case devicetrust.KeyEd25519:
		if len(raw) != 32 {
			return device{}, ErrBadRequest("publicKey must be a base64url Ed25519 public key (32 bytes)")
		}
		if att != nil {
			return device{}, ErrBadRequest("an Ed25519 key carries no attestation; secure elements use keyType p256")
		}
		d.pub = raw
	case devicetrust.KeyP256:
		if d.pub, err = devicetrust.ParseP256(raw); err != nil {
			return device{}, ErrBadRequest(strings.TrimPrefix(err.Error(), "devicetrust: "))
		}
		if att != nil {
			if att.Format != "x509" || len(att.Chain) == 0 {
				return device{}, ErrBadRequest("a p256 attestation is {format: \"x509\", chain: [PEM certificates, the device's first]}")
			}
			res, err := devicetrust.VerifyChain(att.Chain, s.c.DeviceRoots, d.pub, s.now())
			if err != nil {
				return device{}, ErrBadRequest(strings.TrimPrefix(err.Error(), "devicetrust: "))
			}
			d.class = devicetrust.ClassSecureElement
			der, _ := devicetrust.ChainDER(att.Chain)
			d.attHash = crypto.Keccak256Hash(der)
			d.attestation = map[string]any{"format": "x509", "attested": true, "leaf": res.Leaf, "chain": res.Chain, "serial": res.Serial, "expires": res.Expires,
				"attestationHash": common.Hash(d.attHash).Hex()}
		}
	case devicetrust.KeyWebAuthn:
		if att == nil || att.Format != "webauthn" || att.AttestationObject == "" || att.ClientDataJSON == "" {
			return device{}, ErrBadRequest("a passkey registers with attestation {format: \"webauthn\", attestationObject, clientDataJSON}")
		}
		obj, err1 := devicetrust.DecodeB64(att.AttestationObject)
		cd, err2 := devicetrust.DecodeB64(att.ClientDataJSON)
		if err1 != nil || err2 != nil || len(obj) > 16<<10 || len(cd) > 4096 {
			return device{}, ErrBadRequest("attestationObject and clientDataJSON are base64url")
		}
		cred, err := devicetrust.VerifyRegistration(obj, cd, devicetrust.RegistrationChallenge(shipmentID), s.c.WebAuthnOrigins, s.c.DeviceRoots, s.now())
		if err != nil {
			return device{}, ErrBadRequest(strings.TrimPrefix(err.Error(), "devicetrust: "))
		}
		claimed, err := devicetrust.ParseP256(raw)
		if err != nil || !bytes.Equal(claimed, cred.PublicKey) {
			return device{}, ErrBadRequest("publicKey must be the passkey credential's public key")
		}
		d.pub, d.class, d.credID, d.rpIDHash, d.signCount = cred.PublicKey, devicetrust.ClassPasskey, cred.ID, cred.RPIDHash, cred.SignCount
		d.attHash = crypto.Keccak256Hash(obj)
		d.attestation = map[string]any{"format": "webauthn", "fmt": cred.Format, "attested": cred.Attested, "aaguid": cred.AAGUID,
			"userVerified": cred.UV, "origin": cred.OriginSeen, "credentialId": base64.RawURLEncoding.EncodeToString(cred.ID), "attestationHash": common.Hash(d.attHash).Hex()}
		if len(cred.Chain) > 0 {
			d.attestation["chain"] = cred.Chain
		}
	default:
		return device{}, ErrBadRequest("keyType is ed25519, p256 or webauthn")
	}
	return d, nil
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
	dev, err := s.verifyDevice(sh.ID, req.KeyType, req.PublicKey, req.Attestation)
	if err != nil {
		return err
	}
	pub := dev.pub
	if _, err := s.walletSigner(r.Context(), auth.DeviceAuthorization(sh.ID, req.PublicKey, dev.keyType, req.SensorIDs, req.IssuedAt), req.Signature, req.IssuedAt,
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
		KeyType: dev.keyType, DeviceClass: dev.class, Attestation: dev.attestation, ReliabilityBps: devicetrust.ReliabilityBps(dev.class),
		CredentialID: dev.credID, RPIDHash: dev.rpIDHash, SignCount: dev.signCount,
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
	out := toSourceDTO(src)
	// v3: record the device in the DeviceRegistry (the backend is the attestor); a failure leaves the device
	// registered here and is retried on the next registration of the same key.
	if s.c.Service != nil {
		if tx, err := s.c.Service.RegisterDeviceOnChain(r.Context(), sh.ID, src.KeyHash, src.DeviceClass, dev.attHash, common.HexToAddress(sh.Exporter)); err != nil {
			s.c.Log.Warn("register device on chain", "keyHash", src.KeyHash, "err", err)
		} else {
			out.DeviceTx = tx
		}
	}
	writeJSON(w, status, out)
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
	writeJSON(w, http.StatusOK, sourceList{Sources: out})
	return nil
}
