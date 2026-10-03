package api

import (
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Response bodies. Handlers write these named types (never ad-hoc maps) so the OpenAPI document generated from them is
// exactly what clients receive.

type healthResponse struct {
	Status    string `json:"status" enum:"ok,degraded"`
	Database  string `json:"database" enum:"ok,unavailable"`
	Chain     string `json:"chain,omitempty" doc:"\"unavailable\" when the RPC cannot be reached"`
	ChainID   uint64 `json:"chainId"`
	HeadBlock uint64 `json:"headBlock,omitempty"`
	RPC       string `json:"rpc,omitempty" doc:"which RPC endpoint serves requests: primary or fallback" enum:"primary,fallback"`
}

type alertChannelsDTO struct {
	Webhook     bool   `json:"webhook"`
	Telegram    bool   `json:"telegram"`
	Email       bool   `json:"email"`
	Slack       bool   `json:"slack"`
	TelegramBot string `json:"telegramBot"`
}

type configResponse struct {
	ChainID      uint64            `json:"chainId"`
	USDGDecimals int               `json:"usdgDecimals"`
	Contracts    map[string]string `json:"contracts" doc:"usdg, access, shipmentRegistry, policyEngine, evidenceRegistry, receivableVault, financingController, groth16Verifier, (v2) coverPool, (v3) deviceRegistry and eblRegistry"`
	Alerts       alertChannelsDTO  `json:"alerts"`
	GasDrip      bool              `json:"gasDrip"`
	AIS          bool              `json:"ais"`
	Paused       pausedDTO         `json:"paused" doc:"the controller's and the CoverPool's emergency pause (v3 circuit breaker), read from the chain and cached for 30 s"`
}

type sourceCreated struct {
	ID             string   `json:"id"`
	SensorIDs      []string `json:"sensorIds"`
	ReliabilityBps int      `json:"reliabilityBps"`
	KeyType        string   `json:"keyType"`
	DeviceClass    string   `json:"deviceClass"`
	KeyHash        string   `json:"keyHash"`
}

type shipmentList struct {
	Shipments []store.Shipment `json:"shipments"`
	Limit     int              `json:"limit"`
	Offset    int              `json:"offset"`
}

type epochList struct {
	Epochs []service.EpochSummary `json:"epochs"`
}

type auditList struct {
	Entries []service.AuditEntry `json:"entries"`
}

type trackResponse struct {
	Points []service.TrackPoint `json:"points"`
}

type documentList struct {
	Documents []documentDTO `json:"documents"`
}

type subscriptionCreated struct {
	ID           string   `json:"id"`
	Channel      string   `json:"channel"`
	TargetMasked string   `json:"targetMasked"`
	Events       []string `json:"events"`
	CreatedAt    string   `json:"createdAt" doc:"RFC 3339"`
	Secret       string   `json:"secret,omitempty" doc:"webhook only: the HMAC key for X-CargoFlow-Signature, shown once"`
	LinkURL      string   `json:"linkUrl,omitempty" doc:"telegram only: open it and press Start to link the chat"`
}

type subscriptionList struct {
	Subscriptions []subscriptionDTO `json:"subscriptions"`
}

type deletedResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

type sourceList struct {
	Sources []sourceDTO `json:"sources"`
}

type requestList struct {
	Requests []requestDTO `json:"requests"`
}

type gasResponse struct {
	TxHash    string `json:"txHash"`
	AmountWei string `json:"amountWei"`
	Address   string `json:"address"`
}

type partyResponse struct {
	store.PartyStats
	Grade string `json:"grade" enum:"A,B,C,new"`
}

type proofRequest struct {
	SensorID string `json:"sensorId"`
}

// Component names for types whose Go names would be ambiguous in the document.
func (offerDTO) SchemaName() string          { return "FinancingOffer" }
func (requestDTO) SchemaName() string        { return "FinancingRequest" }
func (marketRequestBody) SchemaName() string { return "FinancingRequestInput" }
func (offerBody) SchemaName() string         { return "OfferInput" }
func (acceptBody) SchemaName() string        { return "AcceptOfferInput" }
func (signedBody) SchemaName() string        { return "SignedAuthorization" }
func (pointDTO) SchemaName() string          { return "Reading" }
