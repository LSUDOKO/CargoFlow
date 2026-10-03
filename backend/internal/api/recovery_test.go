package api_test

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
)

// countingProver fails every proof but records that it was asked: authorization must be refused before it runs.
type countingProver struct{ calls int }

func (p *countingProver) Prove(context.Context, proof.Request) (*proof.Result, error) {
	p.calls++
	return nil, errors.New("not used")
}

type recoveryBody struct {
	SensorID  string `json:"sensorId"`
	Submitter string `json:"submitter"`
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

func recoveryRequest(t *testing.T, signer *ecdsa.PrivateKey, shipment, submitter string, issued int64) recoveryBody {
	return recoveryBody{SensorID: "sensor-2", Submitter: submitter, IssuedAt: issued,
		Signature: walletSign(t, signer, auth.RecoveryAuthorization(shipment, "sensor-2", submitter, issued))}
}

func TestOnlyTheExporterCanPrepareARecoveryForTheirOwnWallet(t *testing.T) {
	p := &countingProver{}
	e := newEnv(t, p)
	id := e.onChain(t, "api-rec-1", true)
	e.registerShipment(t, id, "api-rec-1")
	shipment := idHex(id)
	path := "/v1/shipments/" + shipment + "/recovery"
	now := time.Now().Unix()
	exporter := strings.ToLower(crypto.PubkeyToAddress(e.keys["exporter"].PublicKey).Hex())
	financier := strings.ToLower(crypto.PubkeyToAddress(e.keys["financier"].PublicKey).Hex())

	for name, tc := range map[string]struct {
		body recoveryBody
		want int
	}{
		"financier signs for themselves":  {recoveryRequest(t, e.keys["financier"], shipment, financier, now), http.StatusUnauthorized},
		"exporter signs for someone else": {recoveryRequest(t, e.keys["exporter"], shipment, financier, now), http.StatusUnauthorized},
		"stale authorization":             {recoveryRequest(t, e.keys["exporter"], shipment, exporter, now-3600), http.StatusUnauthorized},
		"tampered sensor": func() struct {
			body recoveryBody
			want int
		} {
			b := recoveryRequest(t, e.keys["exporter"], shipment, exporter, now)
			b.SensorID = "sensor-1"
			return struct {
				body recoveryBody
				want int
			}{b, http.StatusUnauthorized}
		}(),
	} {
		if resp := e.do(t, "POST", path, tc.body, nil, nil); resp.StatusCode != tc.want {
			t.Errorf("%s = %d, want %d", name, resp.StatusCode, tc.want)
		}
	}
	if p.calls != 0 {
		t.Fatalf("the prover ran %d times for unauthorized requests", p.calls)
	}

	var apiErr struct {
		Error struct{ Code string } `json:"error"`
	}
	if resp := e.do(t, "POST", path, recoveryRequest(t, e.keys["exporter"], shipment, exporter, now), nil, &apiErr); resp.StatusCode != http.StatusConflict || apiErr.Error.Code != "not_paused" {
		t.Fatalf("an active facility = %d %q, want 409 not_paused", resp.StatusCode, apiErr.Error.Code)
	}
	if resp := e.do(t, "POST", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/recovery", recoveryRequest(t, e.keys["exporter"], "0x"+strings.Repeat("d", 64), exporter, now), nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown shipment = %d, want 404", resp.StatusCode)
	}
}

func TestRecoveryPreparationIsRateLimitedPerShipment(t *testing.T) {
	e := newEnv(t, &countingProver{})
	id := e.onChain(t, "api-rec-2", true)
	e.registerShipment(t, id, "api-rec-2")
	shipment := idHex(id)
	exporter := strings.ToLower(crypto.PubkeyToAddress(e.keys["exporter"].PublicKey).Hex())
	var last int
	now := time.Now().Unix()
	for i := range 4 {
		last = e.do(t, "POST", "/v1/shipments/"+shipment+"/recovery", recoveryRequest(t, e.keys["exporter"], shipment, exporter, now+int64(i)), nil, nil).StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("the fourth preparation in a minute = %d, want 429", last)
	}
}
