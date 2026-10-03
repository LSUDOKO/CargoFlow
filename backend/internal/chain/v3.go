package chain

import (
	"context"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
)

// Contracts v3 (optional): DeviceRegistry, EBLRegistry, epoch sources, facility cancellation and title binding,
// parametric cover. Every call fails with ErrNoDeviceRegistry / ErrNoEBL on a deployment without the contract, and
// callers treat that as "feature off".

// Errors for v3 calls against an older deployment.
var (
	ErrNoDeviceRegistry = errors.New("chain: this deployment has no DeviceRegistry")
	ErrNoEBL            = errors.New("chain: this deployment has no EBLRegistry")
)

// Device classes as DeviceRegistry stores them.
const (
	DeviceSoftware      uint8 = 0
	DevicePasskey       uint8 = 1
	DeviceSecureElement uint8 = 2
)

// DeviceRecord mirrors IDeviceRegistry.Device.
type DeviceRecord struct {
	Owner           common.Address
	DeviceClass     uint8
	Revoked         bool
	RegisteredAt    uint64
	RevokedAt       uint64
	RegisteredBy    common.Address
	AttestationHash [32]byte
}

// RegisterDevice records a device key hash, its class and attestation hash (ATTESTOR_ROLE).
func (c *Client) RegisterDevice(ctx context.Context, attestor *Signer, keyHash [32]byte, class uint8, attestationHash [32]byte, owner common.Address) (TxResult, error) {
	return c.Transact(ctx, attestor, "devices", "registerDevice", keyHash, class, attestationHash, owner)
}

// Device reads a device record; registered is false for an unknown key hash.
func (c *Client) Device(ctx context.Context, keyHash [32]byte) (DeviceRecord, bool, error) {
	var d DeviceRecord
	err := c.callInto(ctx, &d, "devices", "getDevice", keyHash)
	if IsRevert(err, "DeviceNotFound") {
		return DeviceRecord{}, false, nil
	}
	if err != nil {
		return DeviceRecord{}, false, err
	}
	return d, d.RegisteredAt != 0, nil
}

// RecordEpochSources records which device keys fed a committed epoch (EVIDENCE_VERIFIER_ROLE).
func (c *Client) RecordEpochSources(ctx context.Context, worker *Signer, epochID [32]byte, keyHashes [][32]byte) (TxResult, error) {
	return c.Transact(ctx, worker, "evidence", "recordEpochSources", epochID, keyHashes)
}

// EpochSources reads the device key hashes recorded for an epoch (empty before v3 or when none were recorded).
func (c *Client) EpochSources(ctx context.Context, epochID [32]byte) ([][32]byte, error) {
	out, err := c.call(ctx, "evidence", "getEpochSources", epochID)
	if err != nil {
		return nil, err
	}
	hs, _ := out[0].([][32]byte)
	return hs, nil
}

// Bill mirrors IEBLRegistry.BillOfLading.
type Bill struct {
	DocumentHash [32]byte
	Issuer       common.Address
	Shipper      common.Address
	Consignee    common.Address
	Status       uint8
	IssuedAt     uint64
	ClosedAt     uint64
	Transfers    uint32
}

// BillStatusName names IEBLRegistry.TitleStatus values.
func BillStatusName(s uint8) string {
	switch s {
	case 1:
		return "ISSUED"
	case 2:
		return "SURRENDERED"
	case 3:
		return "VOID"
	}
	return "NONE"
}

// Bill reads a bill of lading.
func (c *Client) Bill(ctx context.Context, tokenID *big.Int) (Bill, error) {
	var b Bill
	err := c.callInto(ctx, &b, "ebl", "getBill", tokenID)
	return b, err
}

// BillHolder reads a bill's current holder (ERC-721 ownerOf).
func (c *Client) BillHolder(ctx context.Context, tokenID *big.Int) (common.Address, error) {
	out, err := c.call(ctx, "ebl", "ownerOf", tokenID)
	if err != nil {
		return common.Address{}, err
	}
	a, _ := out[0].(common.Address)
	return a, nil
}

// IssueBill issues a bill (CARRIER_ROLE); used by tests and tools.
func (c *Client) IssueBill(ctx context.Context, carrier *Signer, documentHash [32]byte, shipper, consignee common.Address) (TxResult, error) {
	return c.Transact(ctx, carrier, "ebl", "issue", documentHash, shipper, consignee)
}

// Paused reads an OpenZeppelin Pausable contract's paused() flag ("controller" or "cover").
func (c *Client) Paused(ctx context.Context, contract string) (bool, error) {
	out, err := c.call(ctx, contract, "paused")
	if err != nil {
		return false, err
	}
	b, _ := out[0].(bool)
	return b, nil
}

// ParametricCover mirrors ICoverPoolV3.ParametricCover.
type ParametricCover struct {
	ConsecutiveFailedEpochs uint8
	SalvageToExporter       *big.Int
	EpochFloor              uint32
	Exporter                common.Address
	ExporterSalvage         *big.Int
}

// ParametricCoverOf reads a shipment's parametric cover terms (zero for a plain cover).
func (c *Client) ParametricCoverOf(ctx context.Context, shipmentID [32]byte) (ParametricCover, error) {
	var p ParametricCover
	err := c.callInto(ctx, &p, "cover", "getParametricCover", shipmentID)
	return p, err
}
