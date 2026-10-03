package api_test

import (
	"context"
	"crypto/ecdsa"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

type offerDTO struct {
	ID        string `json:"id"`
	Financier string `json:"financier"`
	FeeBps    int    `json:"feeBps"`
	CreatedAt string `json:"createdAt"`
	Accepted  bool   `json:"accepted"`
}

type requestDTO struct {
	ID             string     `json:"id"`
	ShipmentID     string     `json:"shipmentId"`
	ExternalRef    string     `json:"externalRef"`
	Exporter       string     `json:"exporter"`
	Buyer          string     `json:"buyer"`
	InvoiceValue   string     `json:"invoiceValue"`
	Amount         string     `json:"amount"`
	MaxFeeBps      int        `json:"maxFeeBps"`
	MilestoneCount int        `json:"milestoneCount"`
	Note           string     `json:"note"`
	Route          []any      `json:"route"`
	Policy         *struct{}  `json:"policy"`
	Status         string     `json:"status"`
	Offers         []offerDTO `json:"offers"`
	CreatedAt      string     `json:"createdAt"`
}

func addr(k *ecdsa.PrivateKey) string {
	return strings.ToLower(crypto.PubkeyToAddress(k.PublicKey).Hex())
}

func requestBody(t *testing.T, k *ecdsa.PrivateKey, shipment, amount string, maxFee, milestones int, issued int64) map[string]any {
	return map[string]any{"shipmentId": shipment, "amount": amount, "maxFeeBps": maxFee, "milestoneCount": milestones, "note": "Reefer, Mumbai to Singapore",
		"issuedAt": issued, "signature": walletSign(t, k, auth.RequestAuthorization(shipment, amount, maxFee, milestones, issued))}
}

func offerBody(t *testing.T, k *ecdsa.PrivateKey, rid string, fee int, issued int64) map[string]any {
	return map[string]any{"feeBps": fee, "issuedAt": issued, "signature": walletSign(t, k, auth.OfferAuthorization(rid, fee, issued))}
}

// mirror tracks an on-chain shipment through the public mirror, as the exporter's browser does.
func (e *env) mirror(t *testing.T, id [32]byte, ref string) {
	t.Helper()
	if resp := e.do(t, "POST", "/v1/shipments/mirror", map[string]any{"shipmentId": idHex(id), "externalRef": ref, "route": testRoute}, nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("mirror = %d", resp.StatusCode)
	}
}

// indexOnce runs one indexer pass so chain events reach the service, as the running indexer would.
func (e *env) indexOnce(t *testing.T) {
	t.Helper()
	ix := &chain.Indexer{C: e.chain, Store: e.store, Name: "test", Sink: e.svc.OnChainEvents}
	if _, err := ix.Sync(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTheFinancingMarketplaceFromRequestToFunded(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-market-1", false)
	e.mirror(t, id, "api-market-1")
	sh := idHex(id)
	now := time.Now().Unix()
	exp, fin, buyer := e.keys["exporter"], e.keys["financier"], e.keys["buyer"]

	var req requestDTO
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, exp, sh, "40000000000", 200, 5, now), nil, &req); resp.StatusCode != http.StatusCreated {
		t.Fatalf("request = %d", resp.StatusCode)
	}
	if req.ID == "" || req.ShipmentID != sh || req.ExternalRef != "api-market-1" || req.Exporter != addr(exp) || req.Buyer != addr(buyer) ||
		req.InvoiceValue != "100000000000" || req.Amount != "40000000000" || req.MaxFeeBps != 200 || req.MilestoneCount != 5 ||
		req.Note == "" || len(req.Route) != 2 || req.Policy == nil || req.Status != "open" || req.Offers == nil {
		t.Fatalf("request = %+v", req)
	}
	var apiErr errResp
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, exp, sh, "30000000000", 200, 5, now+1), nil, &apiErr); resp.StatusCode != http.StatusConflict {
		t.Fatalf("a second live request = %d, want 409", resp.StatusCode)
	}
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, buyer, sh, "30000000000", 200, 5, now), nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a request signed by the buyer = %d, want 401", resp.StatusCode)
	}
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, exp, sh, "200000000000", 200, 5, now+2), nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("more than the invoice = %d, want 400", resp.StatusCode)
	}

	offers := "/v1/requests/" + req.ID + "/offers"
	if resp := e.do(t, "POST", offers, offerBody(t, buyer, req.ID, 100, now), nil, nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("the buyer offering = %d, want 403", resp.StatusCode)
	}
	if resp := e.do(t, "POST", offers, offerBody(t, fin, req.ID, 250, now), nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a fee above the maximum = %d, want 400", resp.StatusCode)
	}
	var offer offerDTO
	if resp := e.do(t, "POST", offers, offerBody(t, fin, req.ID, 150, now+1), nil, &offer); resp.StatusCode != http.StatusCreated || offer.FeeBps != 150 || offer.Financier != addr(fin) {
		t.Fatalf("an offer = %d %+v", resp.StatusCode, offer)
	}
	var better offerDTO
	if resp := e.do(t, "POST", offers, offerBody(t, fin, req.ID, 120, now+2), nil, &better); resp.StatusCode != http.StatusOK || better.ID != offer.ID || better.FeeBps != 120 {
		t.Fatalf("a revised offer = %d %+v", resp.StatusCode, better)
	}
	if resp := e.do(t, "POST", offers, offerBody(t, e.keys["arbiter"], req.ID, 180, now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("a second financier = %d", resp.StatusCode)
	}
	var open struct {
		Requests []requestDTO `json:"requests"`
	}
	if resp := e.do(t, "GET", "/v1/requests?status=open&exporter="+addr(exp), nil, nil, &open); resp.StatusCode != http.StatusOK || len(open.Requests) != 1 || len(open.Requests[0].Offers) != 2 || open.Requests[0].Offers[0].FeeBps != 120 {
		t.Fatalf("open requests = %d %+v", resp.StatusCode, open)
	}
	if resp := e.do(t, "GET", "/v1/requests?status=bogus", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a bad status filter = %d", resp.StatusCode)
	}

	accept := func(k *ecdsa.PrivateKey, offerID string, issued int64) map[string]any {
		return map[string]any{"offerId": offerID, "issuedAt": issued, "signature": walletSign(t, k, auth.AcceptAuthorization(req.ID, offerID, issued))}
	}
	if resp := e.do(t, "POST", "/v1/requests/"+req.ID+"/accept", accept(fin, offer.ID, now), nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("a financier accepting = %d, want 401", resp.StatusCode)
	}
	var accepted requestDTO
	if resp := e.do(t, "POST", "/v1/requests/"+req.ID+"/accept", accept(exp, offer.ID, now), nil, &accepted); resp.StatusCode != http.StatusOK || accepted.Status != "accepted" {
		t.Fatalf("accept = %d %+v", resp.StatusCode, accepted)
	}
	for _, o := range accepted.Offers {
		if o.Accepted != (o.ID == offer.ID) {
			t.Fatalf("offers after accepting = %+v", accepted.Offers)
		}
	}
	if resp := e.do(t, "POST", offers, offerBody(t, fin, req.ID, 100, now+3), nil, nil); resp.StatusCode != http.StatusConflict {
		t.Fatalf("an offer on an accepted request = %d, want 409", resp.StatusCode)
	}

	// the exporter creates the facility naming the financier, who funds it: the indexer marks the request funded
	ctx := context.Background()
	ms := make([]chain.MilestoneSpec, 5)
	for i := range ms {
		ms[i] = chain.MilestoneSpec{Allocation: usdg(8_000), EvidenceThreshold: 75, CheckpointCommitment: [32]byte{byte(i + 1)}}
	}
	for _, step := range []func() (chain.TxResult, error){
		func() (chain.TxResult, error) {
			return e.chain.Transact(ctx, e.exporter, "controller", "createFacility", id, e.financier.Address(), uint16(120), ms)
		},
		func() (chain.TxResult, error) {
			return e.chain.Transact(ctx, e.financier, "usdg", "mint", e.financier.Address(), usdg(40_000))
		},
		func() (chain.TxResult, error) {
			return e.chain.Transact(ctx, e.financier, "usdg", "approve", e.chain.M.Vault, usdg(40_000))
		},
		func() (chain.TxResult, error) {
			return e.chain.Transact(ctx, e.financier, "controller", "depositCapital", id)
		},
	} {
		if _, err := step(); err != nil {
			t.Fatal(err)
		}
	}
	e.indexOnce(t)
	var funded struct {
		Requests []requestDTO `json:"requests"`
	}
	if e.do(t, "GET", "/v1/requests?status=funded", nil, nil, &funded); len(funded.Requests) != 1 || funded.Requests[0].ID != req.ID {
		t.Fatalf("funded requests = %+v", funded)
	}
	closeBody := func(rid string, issued int64) map[string]any {
		return map[string]any{"issuedAt": issued, "signature": walletSign(t, exp, auth.CloseRequestAuthorization(rid, issued))}
	}
	if resp := e.do(t, "POST", "/v1/requests/"+req.ID+"/close", closeBody(req.ID, now), nil, nil); resp.StatusCode != http.StatusConflict {
		t.Fatalf("closing a funded request = %d, want 409", resp.StatusCode)
	}
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, exp, sh, "30000000000", 200, 5, now+5), nil, nil); resp.StatusCode != http.StatusConflict {
		t.Fatalf("a request for a shipment that has a facility = %d, want 409", resp.StatusCode)
	}

	// a second shipment: its exporter withdraws the request
	other := e.onChain(t, "api-market-2", false)
	e.registerShipment(t, other, "api-market-2")
	var second requestDTO
	e.do(t, "POST", "/v1/requests", requestBody(t, exp, idHex(other), "10000000000", 300, 2, now), nil, &second)
	var closed requestDTO
	if resp := e.do(t, "POST", "/v1/requests/"+second.ID+"/close", closeBody(second.ID, now), nil, &closed); resp.StatusCode != http.StatusOK || closed.Status != "closed" {
		t.Fatalf("close = %d %+v", resp.StatusCode, closed)
	}
	if resp := e.do(t, "POST", "/v1/requests/00000000-0000-0000-0000-000000000000/offers", offerBody(t, fin, "00000000-0000-0000-0000-000000000000", 100, now), nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("an unknown request = %d, want 404", resp.StatusCode)
	}
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, exp, "0x"+strings.Repeat("d", 64), "1", 100, 1, now), nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a request for an unmirrored shipment = %d, want 404", resp.StatusCode)
	}
}
