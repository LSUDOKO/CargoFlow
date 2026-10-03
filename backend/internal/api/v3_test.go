package api_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/simulator"
)

func requireV3(t *testing.T, e *env) {
	t.Helper()
	if !e.chain.HasDeviceRegistry() || !e.chain.HasEBL() {
		t.Skip("the deployment is not contracts v3")
	}
}

func TestV3ConfigListsTheNewContractsAndThePauseFlags(t *testing.T) {
	e := newEnv(t, nil)
	requireV3(t, e)
	var cfg struct {
		Contracts map[string]string `json:"contracts"`
		Paused    struct {
			Controller bool `json:"controller"`
			CoverPool  bool `json:"coverPool"`
		} `json:"paused"`
	}
	e.do(t, "GET", "/v1/config", nil, nil, &cfg)
	if !common.IsHexAddress(cfg.Contracts["deviceRegistry"]) || !common.IsHexAddress(cfg.Contracts["eblRegistry"]) || cfg.Paused.Controller || cfg.Paused.CoverPool {
		t.Fatalf("config = %+v", cfg)
	}
}

func TestV3EpochsRecordTheirSourcesOnChain(t *testing.T) {
	e := newEnv(t, nil)
	requireV3(t, e)
	id := e.onChain(t, "api-v3-sources", true)
	e.registerShipment(t, id, "api-v3-sources")
	shipment := idHex(id)
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now().Unix()
	pubB64 := base64.RawURLEncoding.EncodeToString(pub)
	sensors := []string{simulator.PrimarySensor, simulator.SecondarySensor}
	var src struct {
		ID       string `json:"id"`
		KeyHash  string `json:"keyHash"`
		DeviceTx string `json:"deviceTx"`
	}
	if resp := e.do(t, "POST", "/v1/shipments/"+shipment+"/sources", map[string]any{"publicKey": pubB64, "sensorIds": sensors, "issuedAt": now,
		"signature": walletSign(t, e.keys["exporter"], auth.SourceAuthorization(shipment, pubB64, sensors, now))}, nil, &src); resp.StatusCode != http.StatusCreated || src.DeviceTx == "" {
		t.Fatalf("gateway = %d %+v", resp.StatusCode, src)
	}
	e.sourcePriv = priv
	t0 := time.Now().Unix() - 600
	if resp := e.signedTelemetry(t, src.ID, shipment, segment(t, e, simulator.Normal, t0, 0, 8), nil); resp.StatusCode != 200 {
		t.Fatalf("telemetry = %d", resp.StatusCode)
	}
	e.indexOnce(t)
	var eps struct {
		Epochs []struct {
			EpochID   string `json:"epochId"`
			CommitTx  string `json:"commitTx"`
			SourcesTx string `json:"sourcesTx"`
			Sources   []struct {
				KeyHash     string `json:"keyHash"`
				DeviceClass string `json:"deviceClass"`
				OnChain     bool   `json:"onChain"`
			} `json:"sources"`
		} `json:"epochs"`
	}
	e.do(t, "GET", "/v1/shipments/"+shipment+"/epochs", nil, nil, &eps)
	if len(eps.Epochs) == 0 {
		t.Fatal("no epoch closed")
	}
	ep := eps.Epochs[0]
	if ep.CommitTx == "" || ep.SourcesTx == "" || len(ep.Sources) != 1 || ep.Sources[0].KeyHash != src.KeyHash || ep.Sources[0].DeviceClass != "software" || !ep.Sources[0].OnChain {
		t.Fatalf("epoch = %+v", ep)
	}
	var epochID [32]byte
	copy(epochID[:], common.FromHex(ep.EpochID))
	recorded, err := e.chain.EpochSources(context.Background(), epochID)
	if err != nil || len(recorded) != 1 || common.Hash(recorded[0]).Hex() != src.KeyHash {
		t.Fatalf("on chain sources = %x %v", recorded, err)
	}
}

func TestV3BillsOfLadingAreIndexedAndMatchedToDocuments(t *testing.T) {
	e := newEnv(t, nil)
	requireV3(t, e)
	id := e.onChain(t, "api-v3-ebl", false)
	e.registerShipment(t, id, "api-v3-ebl")
	shipment := idHex(id)
	file := []byte("BILL OF LADING No. CF-0001\nShipper: Mumbai Reefers\n")
	keccak := crypto.Keccak256Hash(file)
	carrier := chain.NewSigner(e.keys["carrier"])
	if _, err := e.chain.IssueBill(context.Background(), carrier, keccak, e.exporter.Address(), e.buyer.Address()); err != nil {
		t.Fatalf("issue: %v", err)
	}
	e.indexOnce(t)

	var list struct {
		Bills []struct {
			TokenID      string `json:"tokenId"`
			DocumentHash string `json:"documentHash"`
			Holder       string `json:"holder"`
			Status       string `json:"status"`
			Shipper      string `json:"shipper"`
			History      []struct {
				From, To string
			} `json:"history"`
		} `json:"bills"`
	}
	if resp := e.do(t, "GET", "/v1/ebl?holder="+strings.ToLower(e.exporter.Address().Hex()), nil, nil, &list); resp.StatusCode != 200 || len(list.Bills) != 1 {
		t.Fatalf("bills = %d %+v", resp.StatusCode, list)
	}
	b := list.Bills[0]
	if b.DocumentHash != strings.ToLower(keccak.Hex()) || b.Status != "ISSUED" || b.Holder != strings.ToLower(e.exporter.Address().Hex()) || len(b.History) != 1 {
		t.Fatalf("bill = %+v", b)
	}
	var one map[string]any
	if resp := e.do(t, "GET", "/v1/ebl/"+b.TokenID, nil, nil, &one); resp.StatusCode != 200 || one["boundShipmentId"] != nil || one["issuer"] != strings.ToLower(carrier.Address().Hex()) {
		t.Fatalf("bill view = %d %v", resp.StatusCode, one)
	}
	if resp := e.do(t, "GET", "/v1/ebl/999999", nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown bill = %d", resp.StatusCode)
	}

	sha := sha256Hex(file)
	issued := time.Now().Unix()
	var doc struct {
		MatchesBill *string `json:"matchesBill"`
	}
	if resp := e.do(t, "POST", "/v1/shipments/"+shipment+"/documents", documentFor(t, e.keys["exporter"], shipment, "bill_of_lading", sha, keccak.Hex(), issued), nil, &doc); resp.StatusCode != http.StatusCreated {
		t.Fatalf("attest = %d", resp.StatusCode)
	}
	if doc.MatchesBill == nil || *doc.MatchesBill != b.TokenID {
		t.Fatalf("the attested bill of lading must match the issued eBL: %+v", doc.MatchesBill)
	}
	var view struct {
		Title any `json:"title"`
	}
	e.do(t, "GET", "/v1/shipments/"+shipment, nil, nil, &view)
	if view.Title != nil {
		t.Fatalf("no title is bound yet: %v", view.Title)
	}
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return "0x" + hex.EncodeToString(sum[:])
}
