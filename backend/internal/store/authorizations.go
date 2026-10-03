package store

import (
	"context"
	"time"
)

// UseAuthorization records that a signed authorization identified by digest has been used, until expires. It
// reports false when the digest is already recorded and has not expired: the authorization is being replayed.
// The record survives restarts and is shared by every replica, unlike an in-memory set.
func (s *Store) UseAuthorization(ctx context.Context, digest string, now, expires time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO used_authorizations (digest, expires_at) VALUES ($1, $3)
		ON CONFLICT (digest) DO UPDATE SET expires_at = EXCLUDED.expires_at WHERE used_authorizations.expires_at <= $2`,
		digest, now, expires)
	if err != nil {
		return false, mapErr(err)
	}
	return tag.RowsAffected() == 1, nil
}

// PruneAuthorizations forgets authorizations that have expired; an expired one is refused by its time window anyway.
func (s *Store) PruneAuthorizations(ctx context.Context, now time.Time) error {
	_, err := s.pool.Exec(ctx, "DELETE FROM used_authorizations WHERE expires_at <= $1", now)
	return err
}
