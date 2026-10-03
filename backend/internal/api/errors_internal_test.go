package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

func TestContractRevertsBecomeClearConflictMessages(t *testing.T) {
	for name, want := range map[string]string{
		"OutsideMilestonePlace": "milestone's place",
		"EvidenceBelowPolicy":   "humidity or shock",
		"InvalidMilestonePlace": "1 km and 1,000 km",
		"CoverAlreadyAccepted":  "already been accepted",
		"OfferNotFound":         "no open offer",
	} {
		err := fmt.Errorf("controller.x: %w", &chain.RevertError{Name: name})
		var ae *Error
		if !errors.As(fromService(err), &ae) || ae.Status != http.StatusConflict || ae.Code != "chain_rejected" ||
			!strings.Contains(ae.Message, name) || !strings.Contains(ae.Message, want) {
			t.Errorf("%s -> %+v", name, ae)
		}
	}
}
