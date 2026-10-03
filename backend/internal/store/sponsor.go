package store

import (
	"context"
	"strings"
)

// SponsorVerdict is the outcome of ReserveSponsorship.
type SponsorVerdict int

// Verdicts.
const (
	SponsorOK SponsorVerdict = iota
	SponsorSenderLimit
	SponsorGlobalLimit
)

// ReserveSponsorship records a sponsored user operation if the sender has had fewer than perSender and everyone fewer
// than global in the last 24 hours. The check and the insert run under one transaction-scoped advisory lock, so
// concurrent requests cannot both take the last slot.
func (s *Store) ReserveSponsorship(ctx context.Context, sender, nonce, maxCost string, perSender, global int) (SponsorVerdict, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('cargoflow_sponsorships'))`); err != nil {
		return 0, err
	}
	sender = strings.ToLower(sender)
	var mine, all int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE sender = $1), count(*) FROM sponsorships WHERE created_at > now() - interval '24 hours'`,
		sender).Scan(&mine, &all); err != nil {
		return 0, err
	}
	if mine >= perSender {
		return SponsorSenderLimit, nil
	}
	if all >= global {
		return SponsorGlobalLimit, nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO sponsorships (sender, nonce, max_cost) VALUES ($1, $2, $3::numeric)`, sender, nonce, maxCost); err != nil {
		return 0, err
	}
	return SponsorOK, tx.Commit(ctx)
}
