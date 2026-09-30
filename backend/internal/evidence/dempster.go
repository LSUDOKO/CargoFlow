package evidence

// Combine fuses two independent assignments with Dempster's rule over {Compliant, Defective}.
//
//	K      = m1(C)m2(D) + m1(D)m2(C)            the mass the sources assign to contradictory outcomes
//	m12(X) = sum over A∩B=X of m1(A)m2(B) / (1-K)
//
// It returns the fused mass and K in basis points. K is the conflict factor: when it is high the
// caller must not simply trust the normalised result (Dempster normalisation can make two
// contradicting sources look jointly confident); it must lower confidence, pause, or ask for
// secondary proof. Total contradiction (K = 1) would divide by zero, so it yields Vacuous with
// K = Scale. All arithmetic is int64 so results are exact and reproducible.
func Combine(a, b Mass) (Mass, int) {
	const s2 = int64(Scale) * int64(Scale)

	ac, ad, au := int64(a.Compliant), int64(a.Defective), int64(a.Uncertain)
	bc, bd, bu := int64(b.Compliant), int64(b.Defective), int64(b.Uncertain)

	k := ac*bd + ad*bc
	if k >= s2 {
		return Vacuous, Scale
	}
	conflictBps := int((k + Scale/2) / Scale)

	denom := s2 - k
	rawC := ac*bc + ac*bu + au*bc
	rawD := ad*bd + ad*bu + au*bd

	c := (rawC*Scale + denom/2) / denom
	d := (rawD*Scale + denom/2) / denom
	if over := c + d - Scale; over > 0 {
		c -= over // rounding overshoot: trim compliance, never defect
	}
	return Mass{Compliant: int(c), Defective: int(d), Uncertain: Scale - int(c) - int(d)}, conflictBps
}
