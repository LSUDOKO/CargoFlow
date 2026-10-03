package store

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5"
)

// KeyHash is a device key's public identifier: 0x + keccak256 of its public key bytes.
func KeyHash(pub []byte) string { return "0x" + hex.EncodeToString(crypto.Keccak256(pub)) }

func normalizeSource(src *Source) {
	if src.KeyType == "" {
		src.KeyType = KeyEd25519
	}
	if src.DeviceClass == "" {
		src.DeviceClass = ClassSoftware
	}
	if src.Attestation == nil {
		src.Attestation = map[string]any{}
	}
	src.KeyHash = KeyHash(src.PublicKey)
}

// UpsertSource creates or updates an evidence source.
func (s *Store) UpsertSource(ctx context.Context, src Source) error {
	if len(src.SensorIDs) == 0 {
		return errors.New("store: a source needs at least one sensor id")
	}
	if src.ReliabilityBps == 0 && !src.Disabled {
		src.ReliabilityBps = 9500
	}
	normalizeSource(&src)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO evidence_sources (source_id, public_key, sensor_ids, reliability_bps, disabled, key_type, device_class, key_hash, attestation)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (source_id) DO UPDATE
		SET public_key = EXCLUDED.public_key, sensor_ids = EXCLUDED.sensor_ids,
		    reliability_bps = EXCLUDED.reliability_bps, disabled = EXCLUDED.disabled, key_type = EXCLUDED.key_type,
		    device_class = EXCLUDED.device_class, key_hash = EXCLUDED.key_hash, attestation = EXCLUDED.attestation`,
		src.ID, src.PublicKey, src.SensorIDs, src.ReliabilityBps, src.Disabled, src.KeyType, src.DeviceClass, src.KeyHash, src.Attestation)
	return mapErr(err)
}

const sourceColumns = `source_id, public_key, sensor_ids, reliability_bps, disabled, coalesce(shipment_id, ''), label, created_at,
	key_type, device_class, coalesce(key_hash, ''), attestation, webauthn_credential_id, webauthn_rp_id_hash, webauthn_sign_count`

func scanSource(row pgx.Row) (Source, error) {
	var src Source
	var count int64
	err := row.Scan(&src.ID, &src.PublicKey, &src.SensorIDs, &src.ReliabilityBps, &src.Disabled, &src.ShipmentID, &src.Label, &src.CreatedAt,
		&src.KeyType, &src.DeviceClass, &src.KeyHash, &src.Attestation, &src.CredentialID, &src.RPIDHash, &count)
	if err != nil {
		return Source{}, mapErr(err)
	}
	src.SignCount = uint32(count)
	if src.KeyHash == "" {
		src.KeyHash = KeyHash(src.PublicKey)
	}
	return src, nil
}

// GetSource returns ErrNotFound for an unknown source.
func (s *Store) GetSource(ctx context.Context, id string) (Source, error) {
	return scanSource(s.pool.QueryRow(ctx, `SELECT `+sourceColumns+` FROM evidence_sources WHERE source_id = $1`, id))
}

// SourceByKeyHash returns the source holding the device key with this hash, or ErrNotFound. Sources stored before key
// hashes were recorded are found too (their hash is filled in on the way).
func (s *Store) SourceByKeyHash(ctx context.Context, keyHash string) (Source, error) {
	keyHash = strings.ToLower(keyHash)
	src, err := scanSource(s.pool.QueryRow(ctx, `SELECT `+sourceColumns+` FROM evidence_sources WHERE key_hash = $1 LIMIT 1`, keyHash))
	if !errors.Is(err, ErrNotFound) {
		return src, err
	}
	rows, err := s.pool.Query(ctx, `SELECT source_id, public_key FROM evidence_sources WHERE key_hash IS NULL`)
	if err != nil {
		return Source{}, mapErr(err)
	}
	type legacy struct {
		id  string
		pub []byte
	}
	var todo []legacy
	for rows.Next() {
		var l legacy
		if err := rows.Scan(&l.id, &l.pub); err != nil {
			rows.Close()
			return Source{}, err
		}
		todo = append(todo, l)
	}
	rows.Close()
	found := ""
	for _, l := range todo {
		h := KeyHash(l.pub)
		if _, err := s.pool.Exec(ctx, `UPDATE evidence_sources SET key_hash = $2 WHERE source_id = $1`, l.id, h); err != nil {
			return Source{}, mapErr(err)
		}
		if h == keyHash {
			found = l.id
		}
	}
	if found == "" {
		return Source{}, ErrNotFound
	}
	return s.GetSource(ctx, found)
}

// RegisterBoundSource stores an exporter-registered source bound to src.ShipmentID. It never overwrites: a repeat
// for the same shipment returns the existing source with created=false, and a key already bound elsewhere (or
// registered by an operator) is an ErrConflict, so nobody can move someone else's source. Its reliability is
// src.ReliabilityBps (9500 when zero).
func (s *Store) RegisterBoundSource(ctx context.Context, src Source) (Source, bool, error) {
	if src.ShipmentID == "" || len(src.SensorIDs) == 0 {
		return Source{}, false, errors.New("store: a bound source needs a shipment and at least one sensor")
	}
	if src.ReliabilityBps == 0 {
		src.ReliabilityBps = 9500
	}
	normalizeSource(&src)
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO evidence_sources (source_id, public_key, sensor_ids, reliability_bps, shipment_id, label, key_type, device_class, key_hash,
			attestation, webauthn_credential_id, webauthn_rp_id_hash, webauthn_sign_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (source_id) DO NOTHING`,
		src.ID, src.PublicKey, src.SensorIDs, src.ReliabilityBps, src.ShipmentID, src.Label, src.KeyType, src.DeviceClass, src.KeyHash,
		src.Attestation, src.CredentialID, src.RPIDHash, int64(src.SignCount))
	if err != nil {
		return Source{}, false, mapErr(err)
	}
	got, err := s.GetSource(ctx, src.ID)
	if err != nil {
		return Source{}, false, err
	}
	if got.ShipmentID != src.ShipmentID {
		return Source{}, false, fmt.Errorf("%w: this key is already registered for another shipment", ErrConflict)
	}
	return got, tag.RowsAffected() == 1, nil
}

// AdvanceSignCount records a WebAuthn authenticator's signature counter. It reports false when count does not move
// past the stored one, which WebAuthn treats as a sign of a cloned authenticator. Authenticators that keep the
// counter at zero (most passkeys) always pass.
func (s *Store) AdvanceSignCount(ctx context.Context, sourceID string, count uint32) (bool, error) {
	if count == 0 {
		var stored int64
		if err := s.pool.QueryRow(ctx, `SELECT webauthn_sign_count FROM evidence_sources WHERE source_id = $1`, sourceID).Scan(&stored); err != nil {
			return false, mapErr(err)
		}
		return stored == 0, nil
	}
	tag, err := s.pool.Exec(ctx, `UPDATE evidence_sources SET webauthn_sign_count = $2 WHERE source_id = $1 AND webauthn_sign_count < $2`,
		sourceID, int64(count))
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

// SourcesForShipment lists the sources bound to a shipment, oldest first.
func (s *Store) SourcesForShipment(ctx context.Context, shipmentID string) ([]Source, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+sourceColumns+" FROM evidence_sources WHERE shipment_id = $1 ORDER BY created_at, source_id", shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Source{}
	for rows.Next() {
		src, err := scanSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, src)
	}
	return out, rows.Err()
}
