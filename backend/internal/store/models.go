package store

import "time"

// Policy mirrors the on-chain shipment policy (the chain holds the authoritative copy).
type Policy struct {
	MinTempX100        int  `json:"minTempX100"`
	MaxTempX100        int  `json:"maxTempX100"`
	MaxGapSec          int  `json:"maxGapSec"`
	MaxRouteDeviationM int  `json:"maxRouteDeviationM"`
	MinEvidenceScore   int  `json:"minEvidenceScore"`
	MaxConflictBps     int  `json:"maxConflictBps"`
	MaxRiskBps         int  `json:"maxRiskBps"`
	RequiresZK         bool `json:"requiresZk"`
	MinSensors         int  `json:"minSensors"`
	MaxHumidityX100    int  `json:"maxHumidityX100"` // % x 100; 0 = no limit
	MaxShockX100       int  `json:"maxShockX100"`    // g x 100; 0 = no limit
}

// RoutePoint is a planned-route waypoint in degrees x 1e6.
type RoutePoint struct {
	LatE6 int32 `json:"latE6"`
	LonE6 int32 `json:"lonE6"`
}

// Shipment is the off-chain record of a shipment. Amounts are USDG base units as decimal strings.
type Shipment struct {
	ID               string       `json:"id"`
	ExternalRef      string       `json:"externalRef"`
	Exporter         string       `json:"exporter"`
	Buyer            string       `json:"buyer"`
	Financier        string       `json:"financier,omitempty"` // empty until a facility names one
	InvoiceHash      string       `json:"invoiceHash"`
	RouteCommitment  string       `json:"routeCommitment"`
	PolicyCommitment string       `json:"policyCommitment"`
	InvoiceValue     string       `json:"invoiceValue"`
	Policy           Policy       `json:"policy"`
	Route            []RoutePoint `json:"route"`
	PlaceLabels      []string     `json:"placeLabels"` // milestone place names by index, as posted by the frontend
	Status           string       `json:"status"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
}

// Milestone is one financing tranche.
type Milestone struct {
	Index                int       `json:"index"`
	Description          string    `json:"description"`
	AllocatedUSDG        string    `json:"allocatedUsdg"`
	EvidenceThreshold    int       `json:"evidenceThreshold"`
	CheckpointCommitment string    `json:"checkpointCommitment"`
	LatE6                int32     `json:"latE6"`      // centre of the milestone's place, degrees x 1e6
	LonE6                int32     `json:"lonE6"`      //
	RadiusM              uint32    `json:"radiusM"`    // 0 = no place condition
	PlaceLabel           string    `json:"placeLabel"` // display name of the place ("" when unnamed)
	IsReleased           bool      `json:"released"`
	ReleaseTxHash        string    `json:"releaseTxHash,omitempty"`
	ReleasedAt           time.Time `json:"releasedAt,omitzero"` // zero until released
}

// Key types and device classes of evidence sources.
const (
	KeyEd25519  = "ed25519"
	KeyP256     = "p256"
	KeyWebAuthn = "webauthn"

	ClassSoftware      = "software"       // a key in ordinary storage
	ClassPasskey       = "passkey"        // a WebAuthn authenticator's key, which never leaves the device
	ClassSecureElement = "secure_element" // a P-256 key vouched for by a manufacturer's X.509 chain
)

// Source is an authenticated evidence provider. Only its public key is stored: a raw 32-byte Ed25519 key, or for p256
// and webauthn the 65-byte uncompressed P-256 point.
type Source struct {
	ID             string
	PublicKey      []byte
	SensorIDs      []string
	ReliabilityBps int
	Disabled       bool
	ShipmentID     string // set for exporter-registered sources: they may only report for this shipment
	Label          string
	CreatedAt      time.Time

	KeyType     string         // ed25519 (default), p256 or webauthn
	DeviceClass string         // software (default), passkey or secure_element
	KeyHash     string         // 0x + keccak256(PublicKey)
	Attestation map[string]any // what registration verified (format, chain subjects, aaguid, ...); empty when none

	CredentialID []byte // webauthn: the credential id
	RPIDHash     []byte // webauthn: sha256 of the relying party id the credential is scoped to
	SignCount    uint32 // webauthn: the authenticator's signature counter as last seen
}
