// Package storetest gives each test its own isolated Postgres schema on the database named by
// TEST_DATABASE_URL, so packages can run in parallel without touching each other's data.
// Tests are skipped, not failed, when no test database is configured.
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// URL returns a connection string whose search_path is a fresh, empty schema, dropped when the test ends.
// Use it when code under test opens its own connection pool (for example the real `serve` command).
func URL(t testing.TB) string {
	t.Helper()
	_, url := isolated(t)
	return url
}

// Pool returns a pool whose search_path is a fresh, empty schema that is dropped when the test ends.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	pool, _ := isolated(t)
	return pool
}

func isolated(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set (e.g. postgres:///cargoflow_test?host=/run/postgresql)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		t.Fatal(err)
	}
	schema := "t_" + hex.EncodeToString(b[:])

	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatalf("create schema: %v", err)
	}

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	t.Cleanup(func() {
		pool.Close()
		c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, _ = admin.Exec(c, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	return pool, url + sep + "search_path=" + schema
}
