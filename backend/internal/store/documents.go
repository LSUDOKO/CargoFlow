package store

import (
	"context"
	"time"
)

// Document is a file a shipment party attested by its hashes. The file itself is never stored.
type Document struct {
	ID         string
	ShipmentID string
	Kind       string
	Name       string
	SizeBytes  int64
	SHA256     string
	Keccak256  string
	Signer     string
	Role       string
	CreatedAt  time.Time
}

const documentColumns = `id::text, shipment_id, kind, name, size_bytes, sha256, keccak256, signer, role, created_at`

// AttestDocument records an attestation. The same file attested again by the same signer returns the first record
// with created=false.
func (s *Store) AttestDocument(ctx context.Context, d Document) (Document, bool, error) {
	var out Document
	err := s.pool.QueryRow(ctx, `
		INSERT INTO shipment_documents (shipment_id, kind, name, size_bytes, sha256, keccak256, signer, role)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (shipment_id, sha256, signer) DO NOTHING
		RETURNING `+documentColumns,
		d.ShipmentID, d.Kind, d.Name, d.SizeBytes, d.SHA256, d.Keccak256, d.Signer, d.Role).
		Scan(&out.ID, &out.ShipmentID, &out.Kind, &out.Name, &out.SizeBytes, &out.SHA256, &out.Keccak256, &out.Signer, &out.Role, &out.CreatedAt)
	if err == nil {
		return out, true, nil
	}
	if err = mapErr(err); !isNotFound(err) {
		return Document{}, false, err
	}
	err = s.pool.QueryRow(ctx, "SELECT "+documentColumns+" FROM shipment_documents WHERE shipment_id = $1 AND sha256 = $2 AND signer = $3",
		d.ShipmentID, d.SHA256, d.Signer).
		Scan(&out.ID, &out.ShipmentID, &out.Kind, &out.Name, &out.SizeBytes, &out.SHA256, &out.Keccak256, &out.Signer, &out.Role, &out.CreatedAt)
	return out, false, mapErr(err)
}

// Documents lists a shipment's attestations, oldest first.
func (s *Store) Documents(ctx context.Context, shipmentID string) ([]Document, error) {
	rows, err := s.pool.Query(ctx, "SELECT "+documentColumns+" FROM shipment_documents WHERE shipment_id = $1 ORDER BY created_at, id", shipmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Document{}
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.ShipmentID, &d.Kind, &d.Name, &d.SizeBytes, &d.SHA256, &d.Keccak256, &d.Signer, &d.Role, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
