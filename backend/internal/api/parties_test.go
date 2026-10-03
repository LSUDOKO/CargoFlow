package api_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ais"
	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

func TestPartyTrackRecordsArePublic(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-party-1", true)
	e.registerShipment(t, id, "api-party-1")
	exporter := strings.ToLower(crypto.PubkeyToAddress(e.keys["exporter"].PublicKey).Hex())
	var p struct {
		Address  string `json:"address"`
		Exporter struct {
			Shipments        int      `json:"shipments"`
			Active           int      `json:"active"`
			AvgEvidenceScore *float64 `json:"avgEvidenceScore"`
			Volume           string   `json:"volume"`
		} `json:"exporter"`
		Financier struct {
			Committed string `json:"committed"`
		} `json:"financier"`
		Buyer struct {
			PaidVolume string `json:"paidVolume"`
		} `json:"buyer"`
		Grade string  `json:"grade"`
		Since *string `json:"since"`
	}
	if resp := e.do(t, "GET", "/v1/parties/0x"+strings.ToUpper(exporter[2:]), nil, nil, &p); resp.StatusCode != http.StatusOK {
		t.Fatalf("party = %d", resp.StatusCode)
	}
	if p.Address != exporter || p.Exporter.Shipments != 1 || p.Exporter.Active != 1 || p.Exporter.Volume != "100000000000" ||
		p.Exporter.AvgEvidenceScore != nil || p.Financier.Committed != "0" || p.Buyer.PaidVolume != "0" || p.Grade != "new" || p.Since == nil {
		t.Fatalf("party = %+v", p)
	}
	if resp := e.do(t, "GET", "/v1/parties/not-an-address", nil, nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a bad address = %d, want 400", resp.StatusCode)
	}
}

func TestPublicConfigAdvertisesTheOptionalIntegrations(t *testing.T) {
	type extras struct {
		Alerts struct {
			Webhook     bool   `json:"webhook"`
			Telegram    bool   `json:"telegram"`
			Email       bool   `json:"email"`
			TelegramBot string `json:"telegramBot"`
		} `json:"alerts"`
		GasDrip bool `json:"gasDrip"`
		AIS     bool `json:"ais"`
	}
	e := newEnv(t, nil)
	var c extras
	if e.do(t, "GET", "/v1/config", nil, nil, &c); !c.Alerts.Webhook || c.Alerts.Telegram || c.Alerts.Email || c.Alerts.TelegramBot != "" || c.GasDrip || c.AIS {
		t.Fatalf("bare config = %+v", c)
	}
	on := newEnvWith(t, nil, func(e *env, cfg *api.Config) {
		cfg.Alerts = api.AlertChannels{TelegramBot: "CargoFlowAlertsBot", Email: true}
		cfg.Gas = &api.GasDrip{Chain: e.chain, Signer: chain.NewSigner(e.keys["arbiter"]), AmountWei: dripWei, Daily: 1}
		cfg.AIS = &ais.Tracker{Store: e.store, Stream: &fakeStream{}}
	})
	if on.do(t, "GET", "/v1/config", nil, nil, &c); !c.Alerts.Telegram || !c.Alerts.Email || c.Alerts.TelegramBot != "CargoFlowAlertsBot" || !c.GasDrip || !c.AIS {
		t.Fatalf("configured = %+v", c)
	}
}
