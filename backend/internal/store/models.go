package store

import "time"

// Policy mirrors the on-chain shipment policy (the chain holds the authoritative copy).
type Policy struct {
	MinTempX100        int
	MaxTempX100        int
	MaxGapSec          int
	MaxRouteDeviationM int
	MinEvidenceScore   int
	MaxConflictBps     int
	MaxRiskBps         int
	RequiresZK         bool
	MinSensors         int
}

// RoutePoint is a planned-route waypoint in degrees x 1e6.
type RoutePoint struct {
	LatE6 int32 `json:"latE6"`
	LonE6 int32 `json:"lonE6"`
}

// Shipment is the off-chain record of a shipment. Amounts are USDG base units as decimal strings.
type Shipment struct {
	ID               string
	ExternalRef      string
	Exporter         string
	Buyer            string
	Financier        string // empty until a facility names one
	InvoiceHash      string
	RouteCommitment  string
	PolicyCommitment string
	InvoiceValue     string
	Policy           Policy
	Route            []RoutePoint
	Status           string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// Milestone is one financing tranche.
type Milestone struct {
	Index                int
	Description          string
	AllocatedUSDG        string
	EvidenceThreshold    int
	CheckpointCommitment string
	IsReleased           bool
	ReleaseTxHash        string
	ReleasedAt           time.Time // zero until released
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
