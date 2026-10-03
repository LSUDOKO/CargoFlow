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

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
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
	var replay errResp
	if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], shipment, pub, now), nil, &replay); resp.StatusCode != http.StatusConflict || replay.Error.Code != "replayed" {
		t.Fatalf("the same signed registration again = %d %q, want 409 replayed", resp.StatusCode, replay.Error.Code)
	}
	if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], shipment, pub, now+1), nil, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("a freshly signed repeat registration = %d, want 200", resp.StatusCode)
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
		} {
			b := gatewayBody(t, e.keys["exporter"], shipment, other, now)
			b.SensorIDs = []string{"sensor-9"}
			return struct {
				body sourceBody
				code int
			}{b, http.StatusUnauthorized}
		}(),
		"bad key": func() struct {
			body sourceBody
			code int
		} {
			b := gatewayBody(t, e.keys["exporter"], shipment, other, now)
			b.PublicKey = "not-a-key"
			return struct {
				body sourceBody
				code int
			}{b, http.StatusBadRequest}
		}(),
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

// boundGateway registers a fresh gateway for shipment and returns its id and private key.
func boundGateway(t *testing.T, e *env, shipment string) (string, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	var created struct {
		ID string `json:"id"`
	}
	if resp := e.do(t, "POST", "/v1/shipments/"+shipment+"/sources", gatewayBody(t, e.keys["exporter"], shipment, pub, time.Now().Unix()), nil, &created); resp.StatusCode != http.StatusCreated {
		t.Fatalf("register gateway = %d", resp.StatusCode)
	}
	return created.ID, priv
}

func readingsBody(ts ...int64) []byte {
	pts := make([]map[string]any, len(ts))
	for i, t := range ts {
		pts[i] = map[string]any{"timestamp": t, "sensorId": "sensor-1", "temperatureX100": 500, "humidityX100": 6500,
			"latitudeE6": 18_950_000, "longitudeE6": 72_950_000, "shockX100": 10}
	}
	b, _ := json.Marshal(map[string]any{"points": pts})
	return b
}

func TestAShipmentHasAtMostEightGateways(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-gw-cap", true)
	e.registerShipment(t, id, "api-gw-cap")
	for range 8 {
		boundGateway(t, e, idHex(id))
	}
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	var apiErr struct {
		Error struct{ Code string } `json:"error"`
	}
	if resp := e.do(t, "POST", "/v1/shipments/"+idHex(id)+"/sources", gatewayBody(t, e.keys["exporter"], idHex(id), pub, time.Now().Unix()), nil, &apiErr); resp.StatusCode != http.StatusConflict {
		t.Fatalf("a ninth gateway = %d %q, want 409", resp.StatusCode, apiErr.Error.Code)
	}
}

func TestReadingsArePacedPerShipmentAndNeverFromTheFuture(t *testing.T) {
	e := newEnvWith(t, nil, func(_ *env, c *api.Config) { c.ShipmentReadingsPerHour = 3 })
	id := e.onChain(t, "api-gw-budget", true)
	e.registerShipment(t, id, "api-gw-budget")
	a, privA := boundGateway(t, e, idHex(id))
	b, privB := boundGateway(t, e, idHex(id))
	path := "/v1/shipments/" + idHex(id) + "/telemetry"
	now := time.Now().Unix()

	if resp := e.signedRaw(t, a, path, readingsBody(now+3600), privA, nowFunc().Unix(), nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a reading an hour in the future = %d, want 400", resp.StatusCode)
	}
	if resp := e.signedRaw(t, a, path, readingsBody(now-90, now-80), privA, nowFunc().Unix(), nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("within the budget = %d", resp.StatusCode)
	}
	// the budget is the shipment's, not the gateway's: another gateway cannot widen it
	if resp := e.signedRaw(t, b, path, readingsBody(now-70, now-60), privB, nowFunc().Unix(), nil); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("over the shipment's hourly budget = %d, want 429", resp.StatusCode)
	}
}

func TestGatewayRegistrationIsRateLimitedPerShipmentAfterAuthorization(t *testing.T) {
	e := newEnvWith(t, nil, func(_ *env, c *api.Config) { c.GatewayPerMinute = 2 })
	id := e.onChain(t, "api-gw-rate", true)
	other := e.onChain(t, "api-gw-rate-2", true)
	e.registerShipment(t, id, "api-gw-rate")
	e.registerShipment(t, other, "api-gw-rate-2")
	path := "/v1/shipments/" + idHex(id) + "/sources"
	now := time.Now().Unix()
	// strangers signing for the shipment cannot use up the exporter's allowance
	for i := range 4 {
		pub, _, _ := ed25519.GenerateKey(rand.Reader)
		if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["financier"], idHex(id), pub, now+int64(i)), nil, nil); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("a stranger's registration = %d, want 401", resp.StatusCode)
		}
	}
	var codes []int
	for i := range 3 {
		pub, _, _ := ed25519.GenerateKey(rand.Reader)
		codes = append(codes, e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], idHex(id), pub, now+int64(i)), nil, nil).StatusCode)
	}
	if codes[0] != http.StatusCreated || codes[1] != http.StatusCreated || codes[2] != http.StatusTooManyRequests {
		t.Fatalf("exporter registrations = %v, want 201 201 429", codes)
	}
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	if resp := e.do(t, "POST", "/v1/shipments/"+idHex(other)+"/sources", gatewayBody(t, e.keys["exporter"], idHex(other), pub, now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("another shipment's allowance = %d, want 201", resp.StatusCode)
	}
}

func TestReRegisteringAKeyWithDifferentSensorsIsAConflict(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-gw-sensors", true)
	e.registerShipment(t, id, "api-gw-sensors")
	shipment := idHex(id)
	path := "/v1/shipments/" + shipment + "/sources"
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().Unix()
	if resp := e.do(t, "POST", path, gatewayBody(t, e.keys["exporter"], shipment, pub, now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("first registration = %d", resp.StatusCode)
	}
	pubB64 := base64.RawURLEncoding.EncodeToString(pub)
	sensors := []string{"sensor-1", "sensor-9"}
	body := sourceBody{Label: "Reefer logger", PublicKey: pubB64, SensorIDs: sensors, IssuedAt: now + 1,
		Signature: walletSign(t, e.keys["exporter"], auth.SourceAuthorization(shipment, pubB64, sensors, now+1))}
	var apiErr errResp
	if resp := e.do(t, "POST", path, body, nil, &apiErr); resp.StatusCode != http.StatusConflict || apiErr.Error.Code != "conflict" {
		t.Fatalf("the same key with other sensors = %d %q, want 409 conflict", resp.StatusCode, apiErr.Error.Code)
	}
	var list struct {
		Sources []struct {
			SensorIDs []string `json:"sensorIds"`
		} `json:"sources"`
	}
	e.do(t, "GET", path, nil, nil, &list)
	if len(list.Sources) != 1 || list.Sources[0].SensorIDs[1] != "sensor-2" {
		t.Fatalf("the stored sensors changed: %+v", list)
	}
}
