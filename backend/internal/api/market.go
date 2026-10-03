package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Marketplace bounds. The vault refuses fees above 20% and the controller more than 16 milestones.
const (
	maxMarketFeeBps     = 2000
	maxMarketMilestones = 16
	maxRequestNote      = 500
)

var (
	uuidPattern   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	amountPattern = regexp.MustCompile(`^[1-9][0-9]{0,37}$`)
)

// baseUnits is a USDG amount in base units. Clients send it as a decimal string; a bare JSON integer is accepted
// too, keeping its exact digits.
type baseUnits string

func (b *baseUnits) UnmarshalJSON(raw []byte) error {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		*b = baseUnits(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return err
	}
	*b = baseUnits(n.String())
	return nil
}

type marketRequestBody struct {
	ShipmentID     string    `json:"shipmentId"`
	Amount         baseUnits `json:"amount"`
	MaxFeeBps      int       `json:"maxFeeBps"`
	MilestoneCount int       `json:"milestoneCount"`
	Note           string    `json:"note"`
	IssuedAt       int64     `json:"issuedAt"`
	Signature      string    `json:"signature"`
}

type offerBody struct {
	FeeBps    int    `json:"feeBps"`
	Address   string `json:"address"` // optional: names a contract wallet whose signature verifies through EIP-1271
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

type acceptBody struct {
	OfferID   string `json:"offerId"`
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

type signedBody struct {
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

type offerDTO struct {
	ID        string    `json:"id"`
	Financier string    `json:"financier"`
	FeeBps    int       `json:"feeBps"`
	CreatedAt time.Time `json:"createdAt"`
	Accepted  bool      `json:"accepted"`
}

type requestDTO struct {
	ID             string             `json:"id"`
	ShipmentID     string             `json:"shipmentId"`
	ExternalRef    string             `json:"externalRef"`
	Exporter       string             `json:"exporter"`
	Buyer          string             `json:"buyer"`
	InvoiceValue   string             `json:"invoiceValue"`
	Amount         string             `json:"amount"`
	MaxFeeBps      int                `json:"maxFeeBps"`
	MilestoneCount int                `json:"milestoneCount"`
	Note           string             `json:"note"`
	Route          []store.RoutePoint `json:"route"`
	Policy         store.Policy       `json:"policy"`
	Status         string             `json:"status"`
	Offers         []offerDTO         `json:"offers"`
	CreatedAt      time.Time          `json:"createdAt"`
}

func toOfferDTO(o store.Offer) offerDTO {
	return offerDTO{ID: o.ID, Financier: o.Financier, FeeBps: o.FeeBps, CreatedAt: o.CreatedAt, Accepted: o.Accepted}
}

func toRequestDTO(r store.FinancingRequest, sh store.Shipment) requestDTO {
	out := requestDTO{
		ID: r.ID, ShipmentID: r.ShipmentID, ExternalRef: sh.ExternalRef, Exporter: r.Exporter, Buyer: sh.Buyer, InvoiceValue: sh.InvoiceValue,
		Amount: r.Amount, MaxFeeBps: r.MaxFeeBps, MilestoneCount: r.MilestoneCount, Note: r.Note, Route: sh.Route, Policy: sh.Policy,
		Status: r.Status, Offers: make([]offerDTO, len(r.Offers)), CreatedAt: r.CreatedAt,
	}
	if out.Route == nil {
		out.Route = []store.RoutePoint{}
	}
	for i, o := range r.Offers {
		out.Offers[i] = toOfferDTO(o)
	}
	return out
}

// requestFor loads the request named by the path, with its shipment. A malformed or unknown id is a 404.
func (s *Server) requestFor(r *http.Request) (store.FinancingRequest, store.Shipment, error) {
	rid := strings.ToLower(strings.TrimSpace(r.PathValue("rid")))
	if !uuidPattern.MatchString(rid) {
		return store.FinancingRequest{}, store.Shipment{}, ErrNotFoundMsg("no financing request with this id")
	}
	req, err := s.c.Store.GetRequest(r.Context(), rid)
	if errors.Is(err, store.ErrNotFound) {
		return req, store.Shipment{}, ErrNotFoundMsg("no financing request with this id")
	}
	if err != nil {
		return req, store.Shipment{}, err
	}
	sh, err := s.c.Store.GetShipment(r.Context(), req.ShipmentID)
	return req, sh, err
}

// writeRequest reloads a request and writes it with its shipment's details.
func (s *Server) writeRequest(w http.ResponseWriter, r *http.Request, status int, id string, sh store.Shipment) error {
	req, err := s.c.Store.GetRequest(r.Context(), id)
	if err != nil {
		return err
	}
	writeJSON(w, status, toRequestDTO(req, sh))
	return nil
}

// marketConflict maps a store conflict to a 409 with msg, passing other errors through.
func marketConflict(err error, msg string) error {
	if errors.Is(err, store.ErrConflict) {
		return ErrConflictMsg(msg)
	}
	if errors.Is(err, store.ErrNotFound) {
		return ErrNotFoundMsg("not found")
	}
	return err
}

// createRequest posts an exporter's request for financing against a mirrored shipment that has no facility yet.
func (s *Server) createRequest(w http.ResponseWriter, r *http.Request) error {
	var body marketRequestBody
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	amount := string(body.Amount)
	body.Note = strings.TrimSpace(body.Note)
	switch {
	case !amountPattern.MatchString(amount):
		return ErrBadRequest("amount is a positive whole number of USDG base units, as a string")
	case body.MaxFeeBps < 0 || body.MaxFeeBps > maxMarketFeeBps:
		return ErrBadRequest(fmt.Sprintf("maxFeeBps is between 0 and %d", maxMarketFeeBps))
	case body.MilestoneCount < 1 || body.MilestoneCount > maxMarketMilestones:
		return ErrBadRequest(fmt.Sprintf("milestoneCount is between 1 and %d", maxMarketMilestones))
	case utf8.RuneCountInString(body.Note) > maxRequestNote || strings.ContainsFunc(body.Note, func(c rune) bool { return c != '\n' && !printable(string(c)) }):
		return ErrBadRequest(fmt.Sprintf("note is at most %d printable characters", maxRequestNote))
	}
	r.SetPathValue("id", body.ShipmentID)
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	if _, err := s.walletSigner(r.Context(), auth.RequestAuthorization(sh.ID, amount, body.MaxFeeBps, body.MilestoneCount, body.IssuedAt), body.Signature, body.IssuedAt,
		"only the shipment's exporter can request financing for it", strings.ToLower(sh.Exporter)); err != nil {
		return err
	}
	want, _ := new(big.Int).SetString(amount, 10)
	invoice, ok := new(big.Int).SetString(sh.InvoiceValue, 10)
	if ok && want.Cmp(invoice) > 0 {
		return ErrBadRequest("amount cannot exceed the invoice value")
	}
	if want.Cmp(big.NewInt(int64(body.MilestoneCount))) < 0 {
		return ErrBadRequest("amount is too small to split into that many milestones")
	}
	var id [32]byte
	copy(id[:], common.FromHex(sh.ID))
	if _, err := s.c.Chain.Facility(r.Context(), id); err == nil {
		return ErrConflictMsg("this shipment already has a facility on chain")
	} else if !chain.IsRevert(err, "FacilityNotFound") {
		return err
	}
	req, err := s.c.Store.CreateRequest(r.Context(), store.FinancingRequest{
		ShipmentID: sh.ID, Exporter: strings.ToLower(sh.Exporter), Amount: amount, MaxFeeBps: body.MaxFeeBps, MilestoneCount: body.MilestoneCount, Note: body.Note,
	})
	if err != nil {
		return marketConflict(err, "this shipment already has an open financing request; close it first")
	}
	writeJSON(w, http.StatusCreated, toRequestDTO(req, sh))
	return nil
}

var requestStatuses = []string{store.RequestOpen, store.RequestAccepted, store.RequestFunded, store.RequestClosed}

func (s *Server) listRequests(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	status, exporter := strings.ToLower(strings.TrimSpace(q.Get("status"))), strings.TrimSpace(q.Get("exporter"))
	if status != "" && !slices.Contains(requestStatuses, status) {
		return ErrBadRequest("status is one of " + strings.Join(requestStatuses, ", "))
	}
	if exporter != "" && !addressPattern.MatchString(exporter) {
		return ErrBadRequest("exporter must be a 0x address")
	}
	list, err := s.c.Store.ListRequests(r.Context(), status, exporter, maxListLimit)
	if err != nil {
		return err
	}
	shipments := map[string]store.Shipment{}
	out := make([]requestDTO, 0, len(list))
	for _, req := range list {
		sh, ok := shipments[req.ShipmentID]
		if !ok {
			if sh, err = s.c.Store.GetShipment(r.Context(), req.ShipmentID); err != nil {
				return err
			}
			shipments[req.ShipmentID] = sh
		}
		out = append(out, toRequestDTO(req, sh))
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": out})
	return nil
}

// placeOffer records a financier's fee on an open request. Anyone but the shipment's exporter and buyer may offer.
func (s *Server) placeOffer(w http.ResponseWriter, r *http.Request) error {
	var body offerBody
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	if body.Address != "" && !addressPattern.MatchString(body.Address) {
		return ErrBadRequest("address must be a 0x address")
	}
	req, sh, err := s.requestFor(r)
	if err != nil {
		return err
	}
	var allowed []string
	if body.Address != "" {
		allowed = []string{strings.ToLower(body.Address)}
	}
	signer, err := s.walletSigner(r.Context(), auth.OfferAuthorization(req.ID, body.FeeBps, body.IssuedAt), body.Signature, body.IssuedAt,
		"the signature is not from the address named in the offer", allowed...)
	if err != nil {
		return err
	}
	if signer == strings.ToLower(sh.Exporter) || signer == strings.ToLower(sh.Buyer) {
		return ErrForbidden("the shipment's exporter and buyer cannot finance it")
	}
	if body.FeeBps < 0 || body.FeeBps > req.MaxFeeBps {
		return ErrBadRequest(fmt.Sprintf("feeBps is between 0 and the request's maximum of %d", req.MaxFeeBps))
	}
	offer, created, err := s.c.Store.PlaceOffer(r.Context(), req.ID, signer, body.FeeBps)
	if err != nil {
		return marketConflict(err, "this request is no longer open for offers")
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, toOfferDTO(offer))
	return nil
}

// acceptOffer lets the exporter pick an offer. The exporter then creates the facility on chain naming that financier.
func (s *Server) acceptOffer(w http.ResponseWriter, r *http.Request) error {
	var body acceptBody
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	body.OfferID = strings.ToLower(strings.TrimSpace(body.OfferID))
	if !uuidPattern.MatchString(body.OfferID) {
		return ErrBadRequest("offerId names one of the request's offers")
	}
	req, sh, err := s.requestFor(r)
	if err != nil {
		return err
	}
	if _, err := s.walletSigner(r.Context(), auth.AcceptAuthorization(req.ID, body.OfferID, body.IssuedAt), body.Signature, body.IssuedAt,
		"only the shipment's exporter can accept an offer", req.Exporter); err != nil {
		return err
	}
	if err := s.c.Store.AcceptOffer(r.Context(), req.ID, body.OfferID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return ErrNotFoundMsg("no such offer on this request")
		}
		return marketConflict(err, "this request is no longer open")
	}
	return s.writeRequest(w, r, http.StatusOK, req.ID, sh)
}

// closeRequest lets the exporter withdraw an open or accepted request.
func (s *Server) closeRequest(w http.ResponseWriter, r *http.Request) error {
	var body signedBody
	if err := decodeJSON(r, &body); err != nil {
		return err
	}
	req, sh, err := s.requestFor(r)
	if err != nil {
		return err
	}
	if _, err := s.walletSigner(r.Context(), auth.CloseRequestAuthorization(req.ID, body.IssuedAt), body.Signature, body.IssuedAt,
		"only the shipment's exporter can close its request", req.Exporter); err != nil {
		return err
	}
	if err := s.c.Store.CloseRequest(r.Context(), req.ID); err != nil {
		return marketConflict(err, "this request is already funded or closed")
	}
	return s.writeRequest(w, r, http.StatusOK, req.ID, sh)
}
