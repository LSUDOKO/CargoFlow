// Package evidence turns raw sensor readings into a deterministic, explainable confidence signal:
// basic probability assignments per reading, Dempster-Shafer fusion across sensors, fraud signals
// and a 0-100 evidence score. Everything is integer arithmetic in basis points; there is no
// floating point anywhere in the decision path.
package evidence

// Scale is the fixed-point denominator: masses are expressed in basis points (10000 = 1.0).
const Scale = 10_000

// Mass is a basic probability assignment over the frame {Compliant, Defective}. The mass on the
// whole frame (Uncertain) absorbs degraded, stale or borderline observations instead of forcing a
// binary verdict. A valid Mass is non-negative and sums to exactly Scale.
type Mass struct {
	Compliant int
	Defective int
	Uncertain int
}

// Valid reports whether m is a proper assignment.
func (m Mass) Valid() bool {
	return m.Compliant >= 0 && m.Defective >= 0 && m.Uncertain >= 0 &&
		m.Compliant+m.Defective+m.Uncertain == Scale
}

// Vacuous is the state of total ignorance and the identity element of Dempster's rule.
var Vacuous = Mass{Uncertain: Scale}

// Band is the compliant temperature range from the shipment policy (degrees C x 100).
type Band struct {
	MinTempX100 int32
	MaxTempX100 int32
}

// Shape of the membership function, in degrees C x 100.
const (
	// MarginX100: a reading at least this far inside the band is fully trusted as compliant.
	MarginX100 = 100
	// FullDefectX100: a reading this far outside the band (or more) is treated as clearly defective.
	FullDefectX100 = 300
)

// ReadingMass maps one temperature reading to a mass assignment. Membership degrades linearly
// across the band edge so a borderline reading is uncertain rather than a cliff between pass and fail.
//
//	distance inside the band  d >= 1.0 C     -> {9200, 100, 700}
//	0 <= d < 1.0 C                           -> linear to {5000, 1500, 3500} at the edge
//	outside by a in (0, 3.0 C]               -> linear to {200, 9000, 800}
//	outside by more than 3.0 C               -> {200, 9000, 800}
func ReadingMass(tempX100 int32, band Band) Mass {
	d := int(tempX100 - band.MinTempX100)
	if above := int(band.MaxTempX100 - tempX100); above < d {
		d = above
	}

	var c, def int
	switch {
	case d >= MarginX100:
		c, def = 9200, 100
	case d >= 0:
		c = 5000 + 4200*d/MarginX100
		def = 1500 - 1400*d/MarginX100
	default:
		a := -d
		if a > FullDefectX100 {
			a = FullDefectX100
		}
		c = 5000 - 4800*a/FullDefectX100
		def = 1500 + 7500*a/FullDefectX100
	}
	return Mass{Compliant: c, Defective: def, Uncertain: Scale - c - def}
}

// Discount applies Shafer discounting for a source whose reliability is reliabilityBps/Scale: the
// committed masses shrink proportionally and the loss moves into Uncertain. Reliability 0 yields
// the vacuous assignment; Scale leaves the mass unchanged.
func Discount(m Mass, reliabilityBps int) Mass {
	if reliabilityBps >= Scale {
		return m
	}
	if reliabilityBps < 0 {
		reliabilityBps = 0
	}
	c := m.Compliant * reliabilityBps / Scale
	d := m.Defective * reliabilityBps / Scale
	return Mass{Compliant: c, Defective: d, Uncertain: Scale - c - d}
}

// Mean averages assignments (rounding half up) and repairs any rounding overshoot so the result is
// always a valid Mass. With no input it returns Vacuous: absence of evidence is not evidence of compliance.
func Mean(ms []Mass) Mass {
	n := len(ms)
	if n == 0 {
		return Vacuous
	}
	var sc, sd int
	for _, m := range ms {
		sc += m.Compliant
		sd += m.Defective
	}
	c := (sc + n/2) / n
	d := (sd + n/2) / n
	if over := c + d - Scale; over > 0 {
		c -= over // conservative: trim compliance, never defect
	}
	return Mass{Compliant: c, Defective: d, Uncertain: Scale - c - d}
}
