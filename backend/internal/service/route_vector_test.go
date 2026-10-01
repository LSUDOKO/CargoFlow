package service_test

import (
	"encoding/hex"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// TestRouteCommitmentVector pins the route commitment the web frontend recomputes
// (frontend/src/lib/exporter.test.ts). If this changes, the frontend must change with it.
func TestRouteCommitmentVector(t *testing.T) {
	route := []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}
	got := service.RouteCommitment(route)
	const want = "0x7e7948f31a11efa39def5bb6f6e9cada49841a6f95441eb69fb36ab12a3d40c6"
	if h := "0x" + hex.EncodeToString(got[:]); h != want {
		t.Fatalf("route commitment = %s", h)
	}
}
