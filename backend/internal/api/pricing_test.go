package api_test

import (
	"net/http"
	"testing"
	"time"
)

func TestFeeGuidanceIsServedAndAttachedToMarketRequests(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-pricing", false)
	e.mirror(t, id, "api-pricing")
	type suggestion struct {
		ShipmentID string `json:"shipmentId"`
		LowBps     int    `json:"lowBps"`
		MidBps     int    `json:"midBps"`
		HighBps    int    `json:"highBps"`
		Reasons    []struct {
			Factor string `json:"factor"`
			Bps    int    `json:"bps"`
		} `json:"reasons"`
		Inputs struct {
			ExporterGrade string `json:"exporterGrade"`
			CargoTemplate string `json:"cargoTemplate"`
			CoverStatus   string `json:"coverStatus"`
			TenorDays     int    `json:"tenorDays"`
		} `json:"inputs"`
	}
	var s suggestion
	if resp := e.do(t, "GET", "/v1/pricing/suggest?shipment="+idHex(id), nil, nil, &s); resp.StatusCode != http.StatusOK {
		t.Fatalf("suggest = %d", resp.StatusCode)
	}
	// a new exporter, chilled cargo (2-8 C), no cover, Mumbai to Singapore, no corridor history:
	// mid 300 + 50 + 0 + 0 + 50 + 0 + 0 = 400, spread 50 + 100 + 50
	if s.ShipmentID != idHex(id) || s.MidBps != 400 || s.LowBps != 200 || s.HighBps != 600 || s.Inputs.ExporterGrade != "new" ||
		s.Inputs.CargoTemplate != "chilled" || s.Inputs.CoverStatus != "none" || s.Inputs.TenorDays < 7 || len(s.Reasons) < 7 {
		t.Fatalf("suggestion = %+v", s)
	}
	if resp := e.do(t, "GET", "/v1/pricing/suggest", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing shipment = %d", resp.StatusCode)
	}
	if resp := e.do(t, "GET", "/v1/pricing/suggest?shipment=0xab", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed shipment = %d", resp.StatusCode)
	}

	now := time.Now().Unix()
	if resp := e.do(t, "POST", "/v1/requests", requestBody(t, e.keys["exporter"], idHex(id), "50000000000", 800, 5, now), nil, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("request = %d", resp.StatusCode)
	}
	var list struct {
		Requests []struct {
			Pricing *suggestion `json:"pricing"`
		} `json:"requests"`
	}
	e.do(t, "GET", "/v1/requests", nil, nil, &list)
	if len(list.Requests) != 1 || list.Requests[0].Pricing == nil || list.Requests[0].Pricing.MidBps != 400 {
		t.Fatalf("requests carry the guidance: %+v", list.Requests)
	}
}
