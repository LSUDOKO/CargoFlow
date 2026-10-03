package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epcis"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// epcisExport serves the shipment as an EPCIS 2.0 JSON-LD document.
func (s *Server) epcisExport(w http.ResponseWriter, r *http.Request) error {
	doc, err := s.c.Service.EPCISDocument(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "application/ld+json")
	w.Header().Set("Content-Disposition", `inline; filename="epcis.jsonld"`)
	w.WriteHeader(http.StatusOK)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	return enc.Encode(doc)
}

// epcisCapture imports sensor ObjectEvents as readings, signed by a registered source exactly like telemetry.
func (s *Server) epcisCapture(w http.ResponseWriter, r *http.Request) error {
	return s.signedIngest(w, r, func(body []byte) ([]telemetry.Point, error) {
		var doc map[string]any
		if err := json.Unmarshal(body, &doc); err != nil {
			return nil, ErrBadRequest("the body is not JSON")
		}
		pts, err := epcis.Readings(doc)
		var ie *epcis.ImportError
		if errors.As(err, &ie) {
			return nil, ErrBadRequest(ie.Error())
		}
		return pts, err
	})
}

// epcisDocDoc documents the EPCIS document shape for the OpenAPI reference (the body is EPCIS 2.0 JSON-LD).
type epcisDocDoc struct {
	Context       []any          `json:"@context"`
	Type          string         `json:"type" enum:"EPCISDocument"`
	SchemaVersion string         `json:"schemaVersion"`
	CreationDate  string         `json:"creationDate"`
	EPCISBody     map[string]any `json:"epcisBody" doc:"{eventList: [ObjectEvent...]}; see the GS1 EPCIS 2.0 JSON schema"`
}

func (epcisDocDoc) SchemaName() string { return "EPCISDocument" }
