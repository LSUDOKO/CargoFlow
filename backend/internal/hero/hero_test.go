package hero

import "testing"

func TestDivisorMustKeepEveryAmountAndTheFeeExact(t *testing.T) {
	for _, ok := range []int64{1, 2, 10, 1000, 2000} {
		if err := validDivisor(ok); err != nil {
			t.Errorf("divisor %d should be valid: %v", ok, err)
		}
	}
	for _, bad := range []int64{0, -1, 3, 7, 3000, 1_000_000_000} {
		if err := validDivisor(bad); err == nil {
			t.Errorf("divisor %d should be rejected", bad)
		}
	}
}

func TestScaledAmountsKeepTheHeroProportions(t *testing.T) {
	r := &runner{div: 2000}
	if got := r.label(CommittedUSDG); got != "20" {
		t.Errorf("committed = %s", got)
	}
	if got := r.label(InvoiceUSDG); got != "50" {
		t.Errorf("invoice = %s", got)
	}
	if got := r.label(ExporterReceivedUSDG); got != "49.4" {
		t.Errorf("exporter = %s", got)
	}
	if got := r.label(FinancierReceivedUSDG); got != "20.6" {
		t.Errorf("financier = %s", got)
	}
}
