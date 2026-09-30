package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
)

// Facility status values, matching IFinancingController.Status.
const (
	StatusNone      uint8 = 0
	StatusCreated   uint8 = 1
	StatusFinanced  uint8 = 2
	StatusActive    uint8 = 3
	StatusPaused    uint8 = 4
	StatusDisputed  uint8 = 5
	StatusDelivered uint8 = 6
	StatusSettled   uint8 = 7
	StatusDefaulted uint8 = 8
)

// StatusName returns the contract's name for a status value.
func StatusName(s uint8) string {
	names := []string{"NONE", "CREATED", "FINANCED", "ACTIVE", "PAUSED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED"}
	if int(s) < len(names) {
		return names[s]
	}
	return fmt.Sprintf("UNKNOWN(%d)", s)
}

// Facility mirrors IFinancingController.FacilityState. Field names must match the ABI components.
type Facility struct {
	Status         uint8
	Exporter       common.Address
	Financier      common.Address
	Buyer          common.Address
	Committed      *big.Int
	FeeBps         uint16
	MilestoneCount uint8
	NextMilestone  uint8
	PauseReason    [32]byte
	PausedAt       uint64
	PauseCount     uint32
}

// EvidenceEpoch mirrors IEvidenceRegistry.EvidenceEpoch.
type EvidenceEpoch struct {
	ShipmentId     [32]byte
	MerkleRoot     [32]byte
	StartTime      uint64
	EndTime        uint64
	CommittedAt    uint64
	Score          uint32
	ConflictBps    uint32
	RiskBps        uint32
	MilestoneIndex uint8
	Compliant      bool
	ProofVerified  bool
}

// Shipment mirrors IShipmentRegistry.Shipment.
type Shipment struct {
	Exporter         common.Address
	Buyer            common.Address
	InvoiceHash      [32]byte
	RouteCommitment  [32]byte
	PolicyCommitment [32]byte
	InvoiceValue     *big.Int
	CreatedAt        uint64
	Exists           bool
}

// Policy mirrors IPolicyEngine.Policy (temperatures are degrees C x 100, signed).
type Policy struct {
	MinTempX100        int32
	MaxTempX100        int32
	MaxEvidenceAgeSec  uint32
	MaxRouteDeviationM uint32
	MinEvidenceScore   uint16
	MaxConflictBps     uint16
	MaxRiskBps         uint16
	RequiresZK         bool
}

// MilestoneSpec mirrors IFinancingController.MilestoneSpec.
type MilestoneSpec struct {
	Allocation           *big.Int
	EvidenceThreshold    uint16
	CheckpointCommitment [32]byte
}

// call runs a view function and returns the raw decoded outputs.
func (c *Client) call(ctx context.Context, contract, method string, args ...any) ([]any, error) {
	bc, err := c.bound(contract)
	if err != nil {
		return nil, err
	}
	var out []any
	if err := bc.Call(&bind.CallOpts{Context: ctx}, &out, method, args...); err != nil {
		return nil, fmt.Errorf("%s.%s: %w", contract, method, wrapRevert(err))
	}
	return out, nil
}

// callInto runs a view function returning one tuple and converts it into dst.
func (c *Client) callInto(ctx context.Context, dst any, contract, method string, args ...any) error {
	out, err := c.call(ctx, contract, method, args...)
	if err != nil {
		return err
	}
	abi.ConvertType(out[0], dst)
	return nil
}

// Facility reads a facility's state. It returns a FacilityNotFound revert for an unknown shipment.
func (c *Client) Facility(ctx context.Context, id [32]byte) (Facility, error) {
	var f Facility
	err := c.callInto(ctx, &f, "controller", "getFacility", id)
	return f, err
}

// Epoch reads a committed evidence epoch.
func (c *Client) Epoch(ctx context.Context, epochID [32]byte) (EvidenceEpoch, error) {
	var e EvidenceEpoch
	err := c.callInto(ctx, &e, "evidence", "getEpoch", epochID)
	return e, err
}

// Shipment reads a registered shipment.
func (c *Client) Shipment(ctx context.Context, id [32]byte) (Shipment, error) {
	var s Shipment
	err := c.callInto(ctx, &s, "registry", "getShipment", id)
	return s, err
}

// PolicyOf reads the revealed policy of a shipment.
func (c *Client) PolicyOf(ctx context.Context, id [32]byte) (Policy, error) {
	var p Policy
	err := c.callInto(ctx, &p, "policies", "getPolicy", id)
	return p, err
}

// HashPolicy returns the commitment a policy must be registered under.
func (c *Client) HashPolicy(ctx context.Context, p Policy) ([32]byte, error) {
	out, err := c.call(ctx, "policies", "hashPolicy", p)
	if err != nil {
		return [32]byte{}, err
	}
	return out[0].([32]byte), nil
}

// ShipmentID returns the id the registry derives for (exporter, external reference hash).
func (c *Client) ShipmentID(ctx context.Context, exporter common.Address, ref [32]byte) ([32]byte, error) {
	out, err := c.call(ctx, "registry", "shipmentIdFor", exporter, ref)
	if err != nil {
		return [32]byte{}, err
	}
	return out[0].([32]byte), nil
}

// EpochID returns the id of the evidence epoch for (shipment, milestone, seq).
func (c *Client) EpochID(ctx context.Context, shipmentID [32]byte, milestone uint8, seq uint32) ([32]byte, error) {
	out, err := c.call(ctx, "evidence", "epochIdFor", shipmentID, milestone, seq)
	if err != nil {
		return [32]byte{}, err
	}
	return out[0].([32]byte), nil
}

// ProofContext returns the context hash a recovery proof must be made against for this submitter.
func (c *Client) ProofContext(ctx context.Context, shipmentID, epochID [32]byte, submitter common.Address) (*big.Int, error) {
	out, err := c.call(ctx, "controller", "proofContext", shipmentID, epochID, submitter)
	if err != nil {
		return nil, err
	}
	return out[0].(*big.Int), nil
}

// USDGBalance returns an account's USDG balance in base units.
func (c *Client) USDGBalance(ctx context.Context, who common.Address) (*big.Int, error) {
	out, err := c.call(ctx, "usdg", "balanceOf", who)
	if err != nil {
		return nil, err
	}
	return out[0].(*big.Int), nil
}

// BlockTime returns the timestamp of the latest block, the clock the contracts use.
func (c *Client) BlockTime(ctx context.Context) (uint64, error) {
	h, err := c.Eth.HeaderByNumber(ctx, nil)
	if err != nil {
		return 0, err
	}
	return h.Time, nil
}
