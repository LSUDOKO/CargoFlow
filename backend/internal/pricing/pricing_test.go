package pricing_test

import (
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/pricing"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func TestSuggestFollowsTheDocumentedFormula(t *testing.T) {
	in := pricing.Inputs{ExporterGrade: "A", RouteExcursionRate: 1000, RouteConflictRate: 500, CargoTemplate: "chilled", CoverStatus: "active",
		TenorDays: 20, CorridorEpochs: 40, CorridorShipments: 4}
	s := pricing.Suggest(in)
	// 300 - 75 + 200 + 50 + 50 - 100 + 30 = 455; spread 50
	if s.MidBps != 455 || s.LowBps != 405 || s.HighBps != 505 {
		t.Fatalf("band = %d/%d/%d", s.LowBps, s.MidBps, s.HighBps)
	}
	sum := 0
	for _, r := range s.Reasons {
		sum += r.Bps
	}
	if sum != s.MidBps {
		t.Fatalf("the reasons must add up to the mid: %d vs %d (%+v)", sum, s.MidBps, s.Reasons)
	}
	if again := pricing.Suggest(in); again.MidBps != s.MidBps || len(again.Reasons) != len(s.Reasons) {
		t.Fatal("deterministic")
	}
}

func TestSuggestWidensForThinHistoryAndNewExporters(t *testing.T) {
	s := pricing.Suggest(pricing.Inputs{ExporterGrade: "new", CargoTemplate: "frozen", CoverStatus: "none", TenorDays: 10})
	// 300 + 50 + 0 + 0 + 75 + 0 + 0 = 425; spread 50 + 100 + 50
	if s.MidBps != 425 || s.LowBps != 225 || s.HighBps != 625 {
		t.Fatalf("band = %d/%d/%d", s.LowBps, s.MidBps, s.HighBps)
	}
	worst := pricing.Suggest(pricing.Inputs{ExporterGrade: "C", RouteExcursionRate: 10_000, RouteConflictRate: 10_000, CargoTemplate: "custom", TenorDays: 400, CorridorEpochs: 100})
	if worst.MidBps > pricing.MaxFeeBps || worst.HighBps != pricing.MaxFeeBps && worst.HighBps > pricing.MaxFeeBps {
		t.Fatalf("never above the vault ceiling: %+v", worst)
	}
}

func TestCargoTemplateTenorAndCorridor(t *testing.T) {
	for want, p := range map[string]store.Policy{
		"frozen": {MinTempX100: -3000, MaxTempX100: -1800}, "chilled": {MinTempX100: 200, MaxTempX100: 800},
		"controlled_ambient": {MinTempX100: 1500, MaxTempX100: 2500}, "ambient": {MinTempX100: 0, MaxTempX100: 4000}, "custom": {MinTempX100: -500, MaxTempX100: 500},
	} {
		if got := pricing.CargoTemplate(p); got != want {
			t.Errorf("%+v = %s, want %s", p, got, want)
		}
	}
	mumbaiSingapore := []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 1_264_000, LonE6: 103_820_000}}
	if d := pricing.TenorDays(mumbaiSingapore); d < 7 || d > 9 {
		t.Fatalf("Mumbai to Singapore (~3,900 km) = %d days", d)
	}
	near := []store.RoutePoint{{LatE6: 18_100_000, LonE6: 72_200_000}, {LatE6: 1_900_000, LonE6: 103_100_000}}
	if !pricing.SameCorridor(mumbaiSingapore, near) {
		t.Fatal("same cells = same corridor")
	}
	if pricing.SameCorridor(mumbaiSingapore, []store.RoutePoint{{LatE6: 18_950_000, LonE6: 72_950_000}, {LatE6: 51_000_000, LonE6: 4_000_000}}) {
		t.Fatal("another destination is another corridor")
	}
	if pricing.Cell(store.RoutePoint{LatE6: -500_000, LonE6: -1}) != [2]int32{-1, -1} {
		t.Fatal("cells floor toward negative infinity")
	}
}
