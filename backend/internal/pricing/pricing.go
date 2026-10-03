// Package pricing suggests a financing fee band for a shipment from the store's history. It is guidance, not a
// price: financiers still choose their fee. The model is deliberately simple, deterministic and integer-only, so the
// same inputs always give the same band and every basis point is explained by a reason.
//
//	mid    = clamp(300 + grade + excursion + conflict + cargo + cover + tenor, 50, 2000)
//	spread = 50 (+100 when the corridor has fewer than 20 evaluated epochs) (+50 for a new exporter)
//	low    = clamp(mid - spread, 0, 2000)        high = clamp(mid + spread, 0, 2000)
//
//	grade      A -75, B 0, C +150, new +50                           (the exporter's track record)
//	excursion  +routeExcursionRate / 5, at most +400                  (bps of the corridor's evaluated epochs that were
//	                                                                    out of the temperature band; 10% -> +200)
//	conflict   +routeConflictRate / 10, at most +200                  (bps of epochs whose sensor conflict exceeded the
//	                                                                    shipment's policy; 10% -> +100)
//	cargo      frozen +75, chilled +50, controlled_ambient +25, ambient 0, custom +50   (from the policy band)
//	cover      active -100, offered -25, none 0                       (default cover on this shipment)
//	tenor      +5 per day beyond 14, at most +150                     (estimated from the planned route)
//
// 2000 bps is the vault's fee ceiling. The corridor is every other mirrored shipment whose first and last waypoints
// fall in the same 1-degree cells as this one's.
package pricing

import (
	"fmt"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// Model constants (see the package documentation).
const (
	BaseBps        = 300
	MinMidBps      = 50
	MaxFeeBps      = 2000
	BaseSpreadBps  = 50
	ThinHistoryBps = 100
	NewGradeSpread = 50
	ThinEpochs     = 20
	FreeTenorDays  = 14
)

// Inputs are the facts the suggestion is computed from.
type Inputs struct {
	ExporterGrade      string `json:"exporterGrade" enum:"A,B,C,new"`
	RouteExcursionRate int    `json:"routeExcursionRate" doc:"bps of the corridor's evaluated epochs that were out of the temperature band"`
	RouteConflictRate  int    `json:"routeConflictRate" doc:"bps of the corridor's evaluated epochs whose sensor conflict exceeded the policy"`
	CargoTemplate      string `json:"cargoTemplate" enum:"frozen,chilled,controlled_ambient,ambient,custom"`
	CoverStatus        string `json:"coverStatus" enum:"none,offered,active"`
	TenorDays          int    `json:"tenorDays" doc:"estimated from the planned route at 16 knots plus 2 days in port"`
	CorridorShipments  int    `json:"corridorShipments" doc:"other shipments on the same corridor"`
	CorridorEpochs     int    `json:"corridorEpochs" doc:"their evaluated epochs, the sample behind both rates"`
}

// Reason explains one adjustment.
type Reason struct {
	Factor string `json:"factor" enum:"base,grade,excursion,conflict,cargo,cover,tenor,history"`
	Bps    int    `json:"bps" doc:"what this factor added to the mid (negative lowers it); for history, the extra half-width"`
	Detail string `json:"detail"`
}

// Suggestion is a fee band with its reasons.
type Suggestion struct {
	ShipmentID string   `json:"shipmentId"`
	LowBps     int      `json:"lowBps"`
	MidBps     int      `json:"midBps"`
	HighBps    int      `json:"highBps"`
	Reasons    []Reason `json:"reasons"`
	Inputs     Inputs   `json:"inputs"`
	Model      string   `json:"model" doc:"model identifier; the formula is documented in the API reference and README"`
}

// ModelVersion names the formula above.
const ModelVersion = "cargoflow-fee-v1"

func clamp(v, lo, hi int) int { return max(lo, min(hi, v)) }

// Suggest computes the band.
func Suggest(in Inputs) Suggestion {
	out := Suggestion{Inputs: in, Model: ModelVersion}
	add := func(factor string, bps int, detail string) int {
		out.Reasons = append(out.Reasons, Reason{Factor: factor, Bps: bps, Detail: detail})
		return bps
	}
	mid := add("base", BaseBps, "base fee for a monitored, milestone-gated receivable")
	switch in.ExporterGrade {
	case "A":
		mid += add("grade", -75, "exporter grade A: a clean record")
	case "B":
		mid += add("grade", 0, "exporter grade B")
	case "C":
		mid += add("grade", 150, "exporter grade C: defaults on record")
	default:
		mid += add("grade", 50, "new exporter: no settled shipment yet")
	}
	mid += add("excursion", min(400, in.RouteExcursionRate/5),
		fmt.Sprintf("corridor excursion rate %s of %d evaluated epochs", pct(in.RouteExcursionRate), in.CorridorEpochs))
	mid += add("conflict", min(200, in.RouteConflictRate/10),
		fmt.Sprintf("corridor sensor-conflict rate %s", pct(in.RouteConflictRate)))
	cargo := map[string]int{"frozen": 75, "chilled": 50, "controlled_ambient": 25, "ambient": 0}
	c, ok := cargo[in.CargoTemplate]
	if !ok {
		c = 50
	}
	mid += add("cargo", c, "cargo template "+in.CargoTemplate)
	switch in.CoverStatus {
	case "active":
		mid += add("cover", -100, "default cover accepted: an insurer stands behind the principal")
	case "offered":
		mid += add("cover", -25, "default cover offered, not yet accepted")
	default:
		mid += add("cover", 0, "no default cover")
	}
	tenor := 0
	if in.TenorDays > FreeTenorDays {
		tenor = min(150, (in.TenorDays-FreeTenorDays)*5)
	}
	mid += add("tenor", tenor, fmt.Sprintf("estimated tenor %d days", in.TenorDays))

	out.MidBps = clamp(mid, MinMidBps, MaxFeeBps)
	spread := BaseSpreadBps
	if in.CorridorEpochs < ThinEpochs {
		spread += add("history", ThinHistoryBps, fmt.Sprintf("thin corridor history (%d evaluated epochs): a wider band", in.CorridorEpochs))
	}
	if in.ExporterGrade == "new" || in.ExporterGrade == "" {
		spread += NewGradeSpread
	}
	out.LowBps = clamp(out.MidBps-spread, 0, MaxFeeBps)
	out.HighBps = clamp(out.MidBps+spread, 0, MaxFeeBps)
	return out
}

func pct(bps int) string { return fmt.Sprintf("%d.%02d%%", bps/100, bps%100) }

// CargoTemplate classifies a policy's temperature band.
func CargoTemplate(p store.Policy) string {
	switch {
	case p.MaxTempX100 <= -1500:
		return "frozen"
	case p.MinTempX100 >= 0 && p.MaxTempX100 <= 1000:
		return "chilled"
	case p.MinTempX100 >= 1000 && p.MaxTempX100 <= 2700:
		return "controlled_ambient"
	case p.MinTempX100 <= 500 && p.MaxTempX100 >= 3000:
		return "ambient"
	}
	return "custom"
}

// TenorDays estimates the voyage from the planned route: its length at 16 knots (about 711 km a day) plus 2 days in
// port, rounded up; 2 days for a route without legs.
func TenorDays(route []store.RoutePoint) int {
	var m int64
	for i := 1; i < len(route); i++ {
		m += geo.DistanceMeters(route[i-1].LatE6, route[i-1].LonE6, route[i].LatE6, route[i].LonE6)
	}
	const perDay = 711_000
	return int((m+perDay-1)/perDay) + 2
}

// Cell is a route endpoint's 1-degree grid cell.
func Cell(p store.RoutePoint) [2]int32 {
	return [2]int32{floorDiv(p.LatE6, 1_000_000), floorDiv(p.LonE6, 1_000_000)}
}

func floorDiv(a, b int32) int32 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// SameCorridor reports whether two routes start and end in the same cells.
func SameCorridor(a, b []store.RoutePoint) bool {
	if len(a) < 2 || len(b) < 2 {
		return false
	}
	return Cell(a[0]) == Cell(b[0]) && Cell(a[len(a)-1]) == Cell(b[len(b)-1])
}

// Rates turns corridor epoch counts into bps.
func Rates(epochs, excursions, conflicts int) (excursionBps, conflictBps int) {
	if epochs == 0 {
		return 0, 0
	}
	return excursions * 10_000 / epochs, conflicts * 10_000 / epochs
}
