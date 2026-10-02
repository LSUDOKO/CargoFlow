package api_test

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

func walletSign(t *testing.T, key *ecdsa.PrivateKey, msg string) string {
	t.Helper()
	sig, err := crypto.Sign(accounts.TextHash([]byte(msg)), key)
	if err != nil {
		t.Fatal(err)
	}
	sig[64] += 27
	return "0x" + hex.EncodeToString(sig)
}

type sourceBody struct {
	Label     string   `json:"label"`
	PublicKey string   `json:"publicKey"`
	SensorIDs []string `json:"sensorIds"`
	IssuedAt  int64    `json:"issuedAt"`
	Signature string   `json:"signature"`
}

func gatewayBody(t *testing.T, signer *ecdsa.PrivateKey, shipment string, pub ed25519.PublicKey, issued int64) sourceBody {
	pubB64 := base64.RawURLEncoding.EncodeToString(pub)
	sensors := []string{"sensor-1", "sensor-2"}
	return sourceBody{
		Label: "Reefer logger", PublicKey: pubB64, SensorIDs: sensors, IssuedAt: issued,
		Signature: walletSign(t, signer, auth.SourceAuthorization(shipment, pubB64, sensors, issued)),
	}
}

func TestExportersRegisterShipmentBoundGatewaysWithTheirWallet(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-gw-1", true)
	e.registerShipment(t, id, "api-gw-1")
	shipment := idHex(id)
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().Unix()
	path := "/v1/shipments/" + shipment + "/sources"

	var created struct {
		ID         string `json:"id"`
		ShipmentID string `json:"shipmentId"`
	}
	if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], shipment, pub, now), nil, &created); resp.StatusCode != http.StatusCreated {
		t.Fatalf("exporter registration = %d", resp.StatusCode)
	}
	if !strings.HasPrefix(created.ID, "src-") || created.ShipmentID != shipment {
		t.Fatalf("%+v", created)
	}
	if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], shipment, pub, now), nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("repeat registration = %d, want 200", resp.StatusCode)
	}

	other, _, _ := ed25519.GenerateKey(rand.Reader)
	cases := map[string]struct {
		body sourceBody
		code int
	}{
		"financier signs": {gatewayBody(t, e.keys["financier"], shipment, other, now), http.StatusUnauthorized},
		"stale":           {gatewayBody(t, e.keys["exporter"], shipment, other, now-3600), http.StatusUnauthorized},
		"in the future":   {gatewayBody(t, e.keys["exporter"], shipment, other, now+3600), http.StatusUnauthorized},
		"tampered sensors": func() struct {
			body sourceBody
			code int
		} { b := gatewayBody(t, e.keys["exporter"], shipment, other, now); b.SensorIDs = []string{"sensor-9"}; return struct {
			body sourceBody
			code int
		}{b, http.StatusUnauthorized} }(),
		"bad key": func() struct {
			body sourceBody
			code int
		} { b := gatewayBody(t, e.keys["exporter"], shipment, other, now); b.PublicKey = "not-a-key"; return struct {
			body sourceBody
			code int
		}{b, http.StatusBadRequest} }(),
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if resp := e.do(t, "POST", path, tc.body, nil, nil); resp.StatusCode != tc.code {
				t.Fatalf("%s = %d, want %d", name, resp.StatusCode, tc.code)
			}
		})
	}
	if resp := e.do(t, "POST", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/sources", gatewayBody(t, e.keys["exporter"], "0x"+strings.Repeat("d", 64), other, now), nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown shipment = %d", resp.StatusCode)
	}

	var list struct {
		Sources []struct {
			ID        string   `json:"id"`
			Label     string   `json:"label"`
			SensorIDs []string `json:"sensorIds"`
		} `json:"sources"`
	}
	e.do(t, "GET", path, nil, nil, &list)
	if len(list.Sources) != 1 || list.Sources[0].Label != "Reefer logger" || len(list.Sources[0].SensorIDs) != 2 {
		t.Fatalf("list = %+v", list)
	}
}

func TestABoundGatewayCannotReportForAnotherShipment(t *testing.T) {
	e := newEnv(t, nil)
	mine := e.onChain(t, "api-gw-2", true)
	theirs := e.onChain(t, "api-gw-3", true)
	e.registerShipment(t, mine, "api-gw-2")
	e.registerShipment(t, theirs, "api-gw-3")
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	var created struct {
		ID string `json:"id"`
	}
	e.do(t, "POST", "/v1/shipments/"+idHex(mine)+"/sources", gatewayBody(t, e.keys["exporter"], idHex(mine), pub, time.Now().Unix()), nil, &created)

	body, _ := json.Marshal(map[string]any{"points": []map[string]any{{"timestamp": time.Now().Unix() - 60, "sensorId": "sensor-1",
		"temperatureX100": 500, "humidityX100": 6500, "latitudeE6": 18_950_000, "longitudeE6": 72_950_000, "shockX100": 10}}})
	path := "/v1/shipments/" + idHex(theirs) + "/telemetry"
	if resp := e.signedRaw(t, created.ID, path, body, priv, nowFunc().Unix(), nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("telemetry to another shipment = %d, want 403", resp.StatusCode)
	}
	own := "/v1/shipments/" + idHex(mine) + "/telemetry"
	if resp := e.signedRaw(t, created.ID, own, body, priv, nowFunc().Unix(), nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("telemetry to its own shipment = %d", resp.StatusCode)
	}
}
