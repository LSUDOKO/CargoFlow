package store

import (
	"context"
	"time"
)

// RecordGasDrip records native currency sent by the gas drip.
func (s *Store) RecordGasDrip(ctx context.Context, address, txHash, amountWei string) error {
	_, err := s.pool.Exec(ctx, "INSERT INTO gas_drips (address, tx_hash, amount_wei) VALUES (lower($1), $2, $3::numeric)", address, txHash, amountWei)
	return mapErr(err)
}

// GasDripsSince counts drips since a time, overall and to one address.
func (s *Store) GasDripsSince(ctx context.Context, address string, since time.Time) (total, toAddress int, err error) {
	err = s.pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE address = lower($1)) FROM gas_drips WHERE created_at >= $2`,
		address, since).Scan(&total, &toAddress)
	return total, toAddress, mapErr(err)
}
