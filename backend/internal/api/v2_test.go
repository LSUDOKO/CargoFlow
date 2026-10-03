package api_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestCoverEndpointMirrorLabelsAndConfigForV2(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-v2-1", true)

	// mirror with place labels; a repeat mirror never replaces them
	body := map[string]any{"shipmentId": idHex(id), "externalRef": "api-v2-1", "route": testRoute, "placeLabels": []string{"", "Colombo"}}
	var sh struct {
		PlaceLabels []string `json:"placeLabels"`
		Policy      struct {
			MaxHumidityX100 *int `json:"maxHumidityX100"`
			MaxShockX100    *int `json:"maxShockX100"`
		} `json:"policy"`
	}
	if resp := e.do(t, "POST", "/v1/shipments/mirror", body, nil, &sh); resp.StatusCode != http.StatusCreated ||
		len(sh.PlaceLabels) != 2 || sh.PlaceLabels[1] != "Colombo" || sh.Policy.MaxHumidityX100 == nil || sh.Policy.MaxShockX100 == nil {
		t.Fatalf("mirror = %d %+v", resp.StatusCode, sh)
	}
	body["placeLabels"] = []string{"Elsewhere"}
	if resp := e.do(t, "POST", "/v1/shipments/mirror", body, nil, &sh); resp.StatusCode != http.StatusOK || sh.PlaceLabels[1] != "Colombo" {
		t.Fatalf("repeat mirror = %d %+v", resp.StatusCode, sh)
	}

	var view struct {
		Milestones []map[string]any `json:"milestones"`
		Cover      any              `json:"cover"`
		OpenOffers *int             `json:"openCoverOffers"`
	}
	if resp := e.do(t, "GET", "/v1/shipments/"+idHex(id), nil, nil, &view); resp.StatusCode != 200 || len(view.Milestones) != 5 ||
		view.Cover != nil || view.OpenOffers == nil || *view.OpenOffers != 0 {
		t.Fatalf("view = %d %+v", resp.StatusCode, view)
	}
	for _, k := range []string{"latE6", "lonE6", "radiusM", "placeLabel"} {
		if _, ok := view.Milestones[1][k]; !ok {
			t.Fatalf("milestone JSON lacks %s: %+v", k, view.Milestones[1])
		}
	}
	if view.Milestones[1]["placeLabel"] != "Colombo" {
		t.Fatalf("label = %v", view.Milestones[1]["placeLabel"])
	}

	var cover struct {
		Offers []any `json:"offers"`
		Cover  any   `json:"cover"`
	}
	if resp := e.do(t, "GET", "/v1/shipments/"+idHex(id)+"/cover", nil, nil, &cover); resp.StatusCode != 200 || cover.Offers == nil || cover.Cover != nil {
		t.Fatalf("cover = %d %+v", resp.StatusCode, cover)
	}
	if resp := e.do(t, "GET", "/v1/shipments/0x"+strings.Repeat("d", 64)+"/cover", nil, nil, nil); resp.StatusCode != 404 {
		t.Fatalf("unknown shipment cover = %d", resp.StatusCode)
	}

	var cfg struct {
		Contracts map[string]string `json:"contracts"`
	}
	if resp := e.do(t, "GET", "/v1/config", nil, nil, &cfg); resp.StatusCode != 200 || cfg.Contracts["coverPool"] != strings.ToLower(e.chain.M.CoverPool.Hex()) {
		t.Fatalf("config = %+v", cfg)
	}

	var party struct {
		Insurer map[string]any `json:"insurer"`
	}
	if resp := e.do(t, "GET", "/v1/parties/"+e.financier.Address().Hex(), nil, nil, &party); resp.StatusCode != 200 || party.Insurer == nil {
		t.Fatalf("party = %+v", party)
	}
}
