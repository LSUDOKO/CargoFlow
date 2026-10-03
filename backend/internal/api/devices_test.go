package api_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust/devicetest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

const testRP = "app.cargoflow.test"

var b64 = base64.RawURLEncoding.EncodeToString

type deviceView struct {
	ID             string         `json:"id"`
	KeyType        string         `json:"keyType"`
	DeviceClass    string         `json:"deviceClass"`
	KeyHash        string         `json:"keyHash"`
	Attested       bool           `json:"attested"`
	ReliabilityBps int            `json:"reliabilityBps"`
	SourceID       string         `json:"sourceId"`
	Attestation    map[string]any `json:"attestation"`
	DeviceTx       string         `json:"deviceTx"`
	OnChain        *struct {
		Registered  bool   `json:"registered"`
		DeviceClass string `json:"deviceClass"`
		Revoked     bool   `json:"revoked"`
		TxHash      string `json:"txHash"`
	} `json:"onChain"`
}

// postSigned sends a telemetry body with caller-made signature headers.
func (e *env) postSigned(t *testing.T, sourceID, path string, body []byte, sign func(msg []byte) map[string]string) *http.Response {
	t.Helper()
	ts := time.Now().Unix()
	req, _ := http.NewRequest("POST", e.srv.URL+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Source-Id", sourceID)
	req.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
	for k, v := range sign(auth.SigningString("POST", path, ts, body)) {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	return resp
}

func TestHardwareRootedDevicesRegisterAndSign(t *testing.T) {
	ca := devicetest.NewCA("Acme Silicon", time.Now())
	roots, _ := devicetrust.LoadRoots("")
	if err := roots.AddPEM(ca.RootPEM); err != nil {
		t.Fatal(err)
	}
	e := newEnvWith(t, nil, func(_ *env, c *api.Config) {
		c.DeviceRoots = roots
		c.WebAuthnOrigins = devicetrust.Origins{devicetest.Origin(testRP)}
		c.Verifier.Origins = c.WebAuthnOrigins
		c.Verifier.SignCount = c.Store.AdvanceSignCount
	})
	id := e.onChain(t, "api-devices", true)
	e.registerShipment(t, id, "api-devices")
	shipment := idHex(id)
	path := "/v1/shipments/" + shipment + "/sources"
	register := func(body map[string]any, keyType string) (*http.Response, deviceView) {
		t.Helper()
		issued := time.Now().Unix()
		sensors := body["sensorIds"].([]string)
		body["issuedAt"] = issued
		body["signature"] = walletSign(t, e.keys["exporter"], auth.DeviceAuthorization(shipment, body["publicKey"].(string), keyType, sensors, issued))
		var out deviceView
		resp := e.do(t, "POST", path, body, nil, &out)
		return resp, out
	}

	// 1. a secure element: a P-256 key with a manufacturer chain
	se, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	sePub, _ := se.PublicKey.Bytes()
	chain := []string{devicetest.PEM(ca.DeviceCert(&se.PublicKey, "ATECC608A-77", time.Now())), ca.InterPEM}
	resp, seView := register(map[string]any{"label": "SE logger", "publicKey": b64(sePub), "keyType": "p256", "sensorIds": []string{simulator.PrimarySensor},
		"attestation": map[string]any{"format": "x509", "chain": chain}}, "p256")
	if resp.StatusCode != http.StatusCreated || seView.DeviceClass != store.ClassSecureElement || !seView.Attested || seView.ReliabilityBps != 9900 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("secure element = %d %+v %s", resp.StatusCode, seView, b)
	}
	if seView.KeyHash != store.KeyHash(sePub) {
		t.Fatalf("keyHash = %s", seView.KeyHash)
	}

	// a signature for an ed25519 registration cannot register the key as p256 (the key type is signed)
	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	otherPub, _ := other.PublicKey.Bytes()
	issued := time.Now().Unix()
	if resp := e.do(t, "POST", path, map[string]any{"publicKey": b64(otherPub), "keyType": "p256", "sensorIds": []string{"x"}, "issuedAt": issued,
		"signature": walletSign(t, e.keys["exporter"], auth.SourceAuthorization(shipment, b64(otherPub), []string{"x"}, issued))}, nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a signature without the key type = %d, want 401", resp.StatusCode)
	}
	// an untrusted chain is refused
	stranger := devicetest.NewCA("Unknown", time.Now())
	if resp, _ := register(map[string]any{"publicKey": b64(otherPub), "keyType": "p256", "sensorIds": []string{"x"},
		"attestation": map[string]any{"format": "x509", "chain": []string{devicetest.PEM(stranger.DeviceCert(&other.PublicKey, "x", time.Now())), stranger.InterPEM}}}, "p256"); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an untrusted chain = %d, want 400", resp.StatusCode)
	}
	// a P-256 key without attestation is software
	if resp, v := register(map[string]any{"publicKey": b64(otherPub), "keyType": "p256", "sensorIds": []string{"x"}}, "p256"); resp.StatusCode != http.StatusCreated || v.DeviceClass != store.ClassSoftware {
		t.Fatalf("plain p256 = %d %+v", resp.StatusCode, v)
	}

	// 2. a passkey
	pk := devicetest.NewPasskey(testRP)
	obj, cd := pk.Register(devicetrust.RegistrationChallenge(shipment), devicetest.Origin(testRP), devicetest.Attestation{Format: "none"})
	resp, pkView := register(map[string]any{"label": "Inspector phone", "publicKey": b64(pk.PublicKey()), "keyType": "webauthn", "sensorIds": []string{simulator.SecondarySensor},
		"attestation": map[string]any{"format": "webauthn", "attestationObject": b64(obj), "clientDataJSON": b64(cd)}}, "webauthn")
	if resp.StatusCode != http.StatusCreated || pkView.DeviceClass != store.ClassPasskey || pkView.ReliabilityBps != 9700 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("passkey = %d %+v %s", resp.StatusCode, pkView, b)
	}

	// the sources list shows the class
	var list struct {
		Sources []deviceView `json:"sources"`
	}
	e.do(t, "GET", path, nil, nil, &list)
	classes := map[string]int{}
	for _, s := range list.Sources {
		classes[s.KeyType+"/"+s.DeviceClass]++
	}
	if len(list.Sources) != 3 || classes["p256/secure_element"] != 1 || classes["p256/software"] != 1 || classes["webauthn/passkey"] != 1 {
		t.Fatalf("sources = %+v", list.Sources)
	}

	// both devices sign telemetry, each in its own way
	t0 := time.Now().Unix() - 3600
	pts := segment(t, e, simulator.Normal, t0, 0, 2, simulator.PrimarySensor)
	body, _ := json.Marshal(map[string]any{"points": dtoPoints(pts)})
	telemetryPath := "/v1/shipments/" + shipment + "/telemetry"
	ecdsaSign := func(k *ecdsa.PrivateKey) func([]byte) map[string]string {
		return func(msg []byte) map[string]string {
			d := sha256.Sum256(msg)
			sig, _ := ecdsa.SignASN1(rand.Reader, k, d[:])
			return map[string]string{"X-Signature": b64(sig)}
		}
	}
	if resp := e.postSigned(t, seView.ID, telemetryPath, body, ecdsaSign(se)); resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("secure element telemetry = %d %s", resp.StatusCode, b)
	}
	if resp := e.postSigned(t, seView.ID, telemetryPath, body, ecdsaSign(other)); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("telemetry signed by another key = %d, want 401", resp.StatusCode)
	}
	pkPts := segment(t, e, simulator.Normal, t0, 0, 2, simulator.SecondarySensor)
	pkBody, _ := json.Marshal(map[string]any{"points": dtoPoints(pkPts)})
	passkeySign := func(msg []byte) map[string]string {
		a := pk.Assert(msg, devicetest.Origin(testRP))
		return map[string]string{"X-Signature": b64(a.Signature), "X-WebAuthn-Authenticator-Data": b64(a.AuthenticatorData), "X-WebAuthn-Client-Data": b64(a.ClientDataJSON)}
	}
	if resp := e.postSigned(t, pkView.ID, telemetryPath, pkBody, passkeySign); resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("passkey telemetry = %d %s", resp.StatusCode, b)
	}
	pk.SignCount = 0 // a clone replaying an old counter
	if resp := e.postSigned(t, pkView.ID, telemetryPath, pkBody, passkeySign); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a passkey whose counter went back = %d, want 401", resp.StatusCode)
	}

	// the device view
	var dv deviceView
	if resp := e.do(t, "GET", "/v1/devices/"+seView.KeyHash, nil, nil, &dv); resp.StatusCode != http.StatusOK {
		t.Fatalf("device view = %d", resp.StatusCode)
	}
	if dv.DeviceClass != store.ClassSecureElement || dv.SourceID != seView.ID || dv.Attestation["leaf"] == nil || dv.Attestation["attestationHash"] == nil {
		t.Fatalf("device view = %+v", dv)
	}
	// contracts v3: the backend recorded the device in the DeviceRegistry with its class and attestation hash
	if e.chain.HasDeviceRegistry() {
		if seView.DeviceTx == "" || dv.OnChain == nil || !dv.OnChain.Registered || dv.OnChain.DeviceClass != store.ClassSecureElement || dv.OnChain.TxHash == "" || dv.OnChain.Revoked {
			t.Fatalf("on-chain device = %+v (registration tx %q)", dv.OnChain, seView.DeviceTx)
		}
		var kh [32]byte
		copy(kh[:], common.FromHex(seView.KeyHash))
		rec, ok, err := e.chain.Device(context.Background(), kh)
		if err != nil || !ok || rec.DeviceClass != 2 || common.Hash(rec.AttestationHash).Hex() != dv.Attestation["attestationHash"] {
			t.Fatalf("DeviceRegistry record = %+v %v %v", rec, ok, err)
		}
	}
	if resp := e.do(t, "GET", "/v1/devices/0x"+string(bytes.Repeat([]byte("0"), 64)), nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown device = %d", resp.StatusCode)
	}
	if resp := e.do(t, "GET", "/v1/devices/nope", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed key hash = %d", resp.StatusCode)
	}
}
