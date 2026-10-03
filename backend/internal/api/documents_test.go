package api_test

import (
	"crypto/ecdsa"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

type documentBody struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	SHA256    string `json:"sha256"`
	Keccak256 string `json:"keccak256"`
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

type documentDTO struct {
	ID                 string    `json:"id"`
	Kind               string    `json:"kind"`
	Name               string    `json:"name"`
	SizeBytes          int64     `json:"sizeBytes"`
	SHA256             string    `json:"sha256"`
	Keccak256          string    `json:"keccak256"`
	Signer             string    `json:"signer"`
	Role               string    `json:"role"`
	CreatedAt          time.Time `json:"createdAt"`
	MatchesInvoiceHash bool      `json:"matchesInvoiceHash"`
}

func documentFor(t *testing.T, key *ecdsa.PrivateKey, shipment, kind, sha, keccak string, issued int64) documentBody {
	return documentBody{Kind: kind, Name: kind + ".pdf", SizeBytes: 12_345, SHA256: sha, Keccak256: keccak, IssuedAt: issued,
		Signature: walletSign(t, key, auth.DocumentAuthorization(shipment, kind, sha, issued))}
}

func TestShipmentPartiesAttestDocumentsByHash(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-docs-1", true)
	e.registerShipment(t, id, "api-docs-1")
	sh := idHex(id)
	path := "/v1/shipments/" + sh + "/documents"
	now := time.Now().Unix()
	invoiceKeccak := crypto.Keccak256Hash([]byte("invoice")).Hex() // the on-chain invoiceHash in these tests
	shaA, shaB := "0x"+strings.Repeat("aa", 32), "0x"+strings.Repeat("BB", 32)

	var doc documentDTO
	if resp := e.do(t, "POST", path, documentFor(t, e.keys["exporter"], sh, "invoice", shaA, invoiceKeccak, now), nil, &doc); resp.StatusCode != http.StatusCreated {
		t.Fatalf("exporter attests = %d", resp.StatusCode)
	}
	exporter := strings.ToLower(crypto.PubkeyToAddress(e.keys["exporter"].PublicKey).Hex())
	if doc.ID == "" || doc.Kind != "invoice" || doc.Name != "invoice.pdf" || doc.SizeBytes != 12_345 || doc.SHA256 != shaA ||
		doc.Signer != exporter || doc.Role != "exporter" || !doc.MatchesInvoiceHash || doc.CreatedAt.IsZero() {
		t.Fatalf("attested = %+v", doc)
	}
	var buyerDoc documentDTO
	if resp := e.do(t, "POST", path, documentFor(t, e.keys["buyer"], sh, "packing_list", shaB, "0x"+strings.Repeat("cc", 32), now), nil, &buyerDoc); resp.StatusCode != http.StatusCreated {
		t.Fatalf("buyer attests = %d", resp.StatusCode)
	}
	if buyerDoc.Role != "buyer" || buyerDoc.MatchesInvoiceHash || buyerDoc.SHA256 != strings.ToLower(shaB) {
		t.Fatalf("buyer's document = %+v", buyerDoc)
	}
	if resp := e.do(t, "POST", path, documentFor(t, e.keys["financier"], sh, "certificate", shaB, "0x"+strings.Repeat("cc", 32), now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("financier attests = %d", resp.StatusCode)
	}

	stranger, _ := crypto.GenerateKey()
	bad := documentFor(t, e.keys["exporter"], sh, "receipt", shaA, invoiceKeccak, now+1)
	shortHash := documentFor(t, e.keys["exporter"], sh, "other", "0x1234", invoiceKeccak, now+2)
	for name, tc := range map[string]struct {
		body documentBody
		want int
		code string
	}{
		"a stranger":         {documentFor(t, stranger, sh, "invoice", shaA, invoiceKeccak, now), http.StatusUnauthorized, "unauthorized"},
		"the same signature": {documentFor(t, e.keys["exporter"], sh, "invoice", shaA, invoiceKeccak, now), http.StatusConflict, "replayed"},
		"an unknown kind":    {bad, http.StatusBadRequest, "invalid_request"},
		"a short hash":       {shortHash, http.StatusBadRequest, "invalid_request"},
	} {
		var apiErr errResp
		if resp := e.do(t, "POST", path, tc.body, nil, &apiErr); resp.StatusCode != tc.want || apiErr.Error.Code != tc.code {
			t.Errorf("%s = %d %q, want %d %q", name, resp.StatusCode, apiErr.Error.Code, tc.want, tc.code)
		}
	}
	// attesting the same file again with a fresh signature returns the original record
	var again documentDTO
	if resp := e.do(t, "POST", path, documentFor(t, e.keys["exporter"], sh, "invoice", shaA, invoiceKeccak, now+5), nil, &again); resp.StatusCode != http.StatusOK || again.ID != doc.ID {
		t.Fatalf("re-attesting = %d %+v", resp.StatusCode, again)
	}

	var list struct {
		Documents []documentDTO `json:"documents"`
	}
	if resp := e.do(t, "GET", path, nil, nil, &list); resp.StatusCode != http.StatusOK || len(list.Documents) != 3 || list.Documents[0].ID != doc.ID || !list.Documents[0].MatchesInvoiceHash {
		t.Fatalf("documents = %d %+v", resp.StatusCode, list)
	}
	if resp := e.do(t, "GET", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/documents", nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown shipment = %d", resp.StatusCode)
	}
}
