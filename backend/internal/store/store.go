package store

import (
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors returned by every repository method.
var (
	ErrNotFound = errors.New("store: not found")
	ErrConflict = errors.New("store: conflict")
)

// Store is the typed repository over a pgx pool.
type Store struct {
	pool *pgxpool.Pool
}

// New wraps pool. Run Migrate first.
func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const uniqueViolation = "23505"

// mapErr translates driver errors into the package's sentinel errors, keeping the original for logs.
func mapErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: %v", ErrNotFound, err)
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == uniqueViolation {
		return fmt.Errorf("%w: %s", ErrConflict, pg.ConstraintName)
	}
	return err
}
