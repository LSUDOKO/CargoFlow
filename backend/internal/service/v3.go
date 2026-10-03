package service

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Contracts v3 integration: epoch sources and device registration on chain. Both are no-ops on a deployment
// without the DeviceRegistry.

const maxEpochSources = 32 // EvidenceRegistry.MAX_SOURCES

func keyHashBytes(h string) ([32]byte, bool) {
	var out [32]byte
	b, err := hex.DecodeString(strings.TrimPrefix(h, "0x"))
	if err != nil || len(b) != 32 {
		return out, false
	}
	copy(out[:], b)
	return out, true
}

// recordSources records on chain which devices fed a committed epoch (recordEpochSources), through the outbox.
// Epochs fed only by trusted local ingestion have no device and record nothing. Failures are logged: the evidence
// stands without it, and the reconciler of a later epoch does not depend on it.
func (s *Service) recordSources(ctx context.Context, canon string, rec store.EpochRecord) {
	if !s.o.Chain.HasDeviceRegistry() || rec.SourcesTxHash != "" {
		return
	}
	refs, err := s.o.Store.ReadingSources(ctx, canon)
	if err != nil {
		s.o.Log.Warn("load epoch sources", "epoch", rec.EpochID, "err", err)
		return
	}
	var hashes [][32]byte
	for _, r := range store.EpochSourceRefs(rec, refs) {
		if h, ok := keyHashBytes(r.KeyHash); ok && len(hashes) < maxEpochSources {
			hashes = append(hashes, h)
		}
	}
	if len(hashes) == 0 {
		return
	}
	epochID, ok := keyHashBytes(rec.EpochID)
	if !ok {
		return
	}
	res, err := s.runAction(ctx, canon, "RECORD_SOURCES", "sources:"+rec.EpochID, func() (chain.TxResult, error) {
		return s.o.Chain.RecordEpochSources(ctx, s.o.Worker, epochID, hashes)
	}, "SourcesAlreadyRecorded")
	if err != nil {
		s.o.Log.Warn("record epoch sources", "epoch", rec.EpochID, "err", err)
		return
	}
	_ = s.o.Store.SetEpochSourcesRecorded(ctx, rec.EpochID, res.Hash.Hex())
}

// recordSourcesByID loads an epoch and records its sources.
func (s *Service) recordSourcesByID(ctx context.Context, canon, epochID string) {
	if !s.o.Chain.HasDeviceRegistry() {
		return
	}
	rec, err := s.o.Store.EpochByEpochID(ctx, epochID)
	if err != nil {
		return
	}
	s.recordSources(ctx, canon, rec)
}

// DeviceClassCode is DeviceRegistry's class number.
func DeviceClassCode(class string) uint8 {
	switch class {
	case store.ClassPasskey:
		return chain.DevicePasskey
	case store.ClassSecureElement:
		return chain.DeviceSecureElement
	}
	return chain.DeviceSoftware
}

// RegisterDeviceOnChain records a gateway's key hash, class and attestation hash in the DeviceRegistry, with owner as
// the device's operator, through the outbox (the worker holds ATTESTOR_ROLE by default). It reports the transaction
// hash, or "" when the deployment has no DeviceRegistry.
func (s *Service) RegisterDeviceOnChain(ctx context.Context, shipmentID, keyHash, class string, attestationHash [32]byte, owner common.Address) (string, error) {
	if !s.o.Chain.HasDeviceRegistry() {
		return "", nil
	}
	kh, ok := keyHashBytes(keyHash)
	if !ok {
		return "", fmt.Errorf("%w: bad key hash", ErrInvalid)
	}
	res, err := s.runAction(ctx, shipmentID, "REGISTER_DEVICE", "device:"+strings.ToLower(keyHash), func() (chain.TxResult, error) {
		return s.o.Chain.RegisterDevice(ctx, s.o.Worker, kh, DeviceClassCode(class), attestationHash, owner)
	}, "DeviceAlreadyRegistered")
	if err != nil {
		return "", err
	}
	return res.Hash.Hex(), nil
}
