package api

import (
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Bounds on document attestations.
const (
	maxDocumentsPerShipment = 100
	maxDocumentName         = 200
	maxDocumentBytes        = 1 << 40
)

var (
	documentKinds = []string{"invoice", "bill_of_lading", "packing_list", "certificate", "other"}
	hash32Pattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)
)

type documentRequest struct {
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
	MatchesBill        *string   `json:"matchesBill" doc:"for a bill_of_lading: the token id of the issued v3 eBL whose documentHash equals this keccak256, else null"`
}

func toDocumentDTO(d store.Document, sh store.Shipment) documentDTO {
	return documentDTO{ID: d.ID, Kind: d.Kind, Name: d.Name, SizeBytes: d.SizeBytes, SHA256: d.SHA256, Keccak256: d.Keccak256,
		Signer: d.Signer, Role: d.Role, CreatedAt: d.CreatedAt, MatchesInvoiceHash: strings.EqualFold(d.Keccak256, sh.InvoiceHash)}
}

// parties returns a shipment's exporter, financier (once a facility names one) and buyer, lowercase.
func parties(sh store.Shipment) []string {
	out := []string{strings.ToLower(sh.Exporter)}
	if sh.Financier != "" {
		out = append(out, strings.ToLower(sh.Financier))
	}
	return append(out, strings.ToLower(sh.Buyer))
}

// roleOf names the role addr holds on a shipment, exporter first when one wallet holds several, or "".
func roleOf(sh store.Shipment, addr string) string {
	switch addr = strings.ToLower(addr); addr {
	case strings.ToLower(sh.Exporter):
		return "exporter"
	case strings.ToLower(sh.Financier):
		return "financier"
	case strings.ToLower(sh.Buyer):
		return "buyer"
	}
	return ""
}

// printable reports whether s has no control characters.
func printable(s string) bool {
	return !strings.ContainsFunc(s, unicode.IsControl)
}

// attestDocument records that a shipment party vouches for a file, identified by its hashes. The file never leaves
// the party's machine.
func (s *Server) attestDocument(w http.ResponseWriter, r *http.Request) error {
	var req documentRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	req.SHA256, req.Keccak256, req.Name = strings.ToLower(req.SHA256), strings.ToLower(req.Keccak256), strings.TrimSpace(req.Name)
	switch {
	case !slices.Contains(documentKinds, req.Kind):
		return ErrBadRequest("kind is one of " + strings.Join(documentKinds, ", "))
	case req.Name == "" || utf8.RuneCountInString(req.Name) > maxDocumentName || !printable(req.Name):
		return ErrBadRequest(fmt.Sprintf("name is 1 to %d printable characters", maxDocumentName))
	case req.SizeBytes < 0 || req.SizeBytes > maxDocumentBytes:
		return ErrBadRequest("sizeBytes is the file's size in bytes")
	case !hash32Pattern.MatchString(req.SHA256) || !hash32Pattern.MatchString(req.Keccak256):
		return ErrBadRequest("sha256 and keccak256 are 0x followed by 64 hex characters")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	signer, err := s.walletSigner(r.Context(), auth.DocumentAuthorization(sh.ID, req.Kind, req.SHA256, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the shipment's exporter, financier or buyer can attest a document", parties(sh)...)
	if err != nil {
		return err
	}
	existing, err := s.c.Store.Documents(r.Context(), sh.ID)
	if err != nil {
		return err
	}
	if len(existing) >= maxDocumentsPerShipment {
		return ErrConflictMsg(fmt.Sprintf("a shipment can have at most %d attested documents", maxDocumentsPerShipment))
	}
	doc, created, err := s.c.Store.AttestDocument(r.Context(), store.Document{
		ShipmentID: sh.ID, Kind: req.Kind, Name: req.Name, SizeBytes: req.SizeBytes, SHA256: req.SHA256, Keccak256: req.Keccak256,
		Signer: signer, Role: roleOf(sh, signer),
	})
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, s.withBill(r, toDocumentDTO(doc, sh)))
	return nil
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) error {
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	docs, err := s.c.Store.Documents(r.Context(), sh.ID)
	if err != nil {
		return err
	}
	out := make([]documentDTO, len(docs))
	for i, d := range docs {
		out[i] = s.withBill(r, toDocumentDTO(d, sh))
	}
	writeJSON(w, http.StatusOK, documentList{Documents: out})
	return nil
}

// withBill fills matchesBill for a bill of lading whose keccak256 is an issued eBL's document hash.
func (s *Server) withBill(r *http.Request, d documentDTO) documentDTO {
	if d.Kind != "bill_of_lading" || s.c.Chain == nil || !s.c.Chain.HasEBL() {
		return d
	}
	if id, ok, err := s.c.Store.BillByDocument(r.Context(), d.Keccak256); err == nil && ok {
		d.MatchesBill = &id
	}
	return d
}
