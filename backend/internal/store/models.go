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
	IsReleased           bool      `json:"released"`
	ReleaseTxHash        string    `json:"releaseTxHash,omitempty"`
	ReleasedAt           time.Time `json:"releasedAt,omitzero"` // zero until released
}

// Source is an authenticated evidence provider. Only its Ed25519 public key is stored.
type Source struct {
	ID             string
	PublicKey      []byte
	SensorIDs      []string
	ReliabilityBps int
	Disabled       bool
	CreatedAt      time.Time
}
