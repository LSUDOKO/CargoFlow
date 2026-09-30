package store_test

import (
	"context"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

func TestMigrateAppliesEveryEmbeddedMigrationOnce(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	var applied int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied < 1 {
		t.Fatal("no migrations recorded")
	}
	// idempotent: a second run applies nothing and changes nothing
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	var again int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&again)
	if again != applied {
		t.Fatalf("rerun changed the migration count: %d -> %d", applied, again)
	}
}

func TestSchemaHasTheExpectedTables(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"evidence_sources", "shipments", "financing_milestones", "telemetry_points",
		"telemetry_epochs", "ai_monitoring_events", "chain_events", "sync_state",
		"quarantined_readings", "chain_actions",
	} {
		var exists bool
		err := pool.QueryRow(ctx,
			"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1)",
			table).Scan(&exists)
		if err != nil || !exists {
			t.Errorf("table %s missing (%v)", table, err)
		}
	}
}

func TestChainEventsAreIdempotentByTxHashAndLogIndex(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	ins := `INSERT INTO chain_events (tx_hash, log_index, block_number, block_hash, contract, event_name, args)
	        VALUES ('0xaa', 0, 1, '0xbb', 'c', 'e', '{}')`
	if _, err := pool.Exec(ctx, ins); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, ins); err == nil {
		t.Fatal("the same (tx_hash, log_index) was inserted twice")
	}
}

func TestFailingMigrationRollsBackAndIsNotRecorded(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	fsys := fstest.MapFS{
		"migrations/0001_ok.sql":  {Data: []byte("CREATE TABLE good (id int);")},
		"migrations/0002_bad.sql": {Data: []byte("CREATE TABLE half (id int); SELECT * FROM does_not_exist;")},
	}
	err := store.Migrate(ctx, pool, fsys)
	if err == nil {
		t.Fatal("broken migration reported success")
	}
	var goodApplied, halfExists int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE version = '0001_ok'").Scan(&goodApplied)
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'half'").Scan(&halfExists)
	if goodApplied != 1 {
		t.Fatal("the successful migration before the failure was not kept")
	}
	if halfExists != 0 {
		t.Fatal("the failing migration left partial changes behind")
	}
	var bad int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE version = '0002_bad'").Scan(&bad)
	if bad != 0 {
		t.Fatal("the failing migration was recorded as applied")
	}
}

func TestConcurrentMigratorsApplyEachMigrationExactlyOnce(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.Migrate(ctx, pool, store.Migrations())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent migrate failed: %v", err)
		}
	}
	var dupes int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM (SELECT version FROM schema_migrations GROUP BY version HAVING count(*) > 1) d").Scan(&dupes)
	if dupes != 0 {
		t.Fatal("a migration was recorded more than once")
	}
}

func TestMigrationsAreAppliedInVersionOrder(t *testing.T) {
	pool := storetest.Pool(t)
	ctx := context.Background()
	fsys := fstest.MapFS{
		"migrations/0002_second.sql": {Data: []byte("ALTER TABLE t ADD COLUMN b int;")},
		"migrations/0001_first.sql":  {Data: []byte("CREATE TABLE t (a int);")},
	}
	if err := store.Migrate(ctx, pool, fsys); err != nil {
		t.Fatalf("out-of-order listing must still apply in version order: %v", err)
	}
}
