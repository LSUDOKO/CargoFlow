package chain_test

import (
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

func TestV2RevertsHaveClearMessages(t *testing.T) {
	for name, want := range map[string]string{
		"OutsideMilestonePlace": "place",
		"EvidenceBelowPolicy":   "humidity or shock",
		"InvalidMilestonePlace": "radius",
		"InvalidCover":          "cover",
		"OfferExists":           "offer",
		"OfferNotFound":         "offer",
		"CoverAlreadyAccepted":  "already",
		"CoverNotActive":        "active",
		"NothingToWithdraw":     "nothing",
		"UnsupportedToken":      "token",
		"InvalidCounterparty":   "",
		"NotFinancier":          "financier",
		"FacilityPaused":        "paused",
	} {
		msg := chain.RevertMessage(name)
		if msg == "" || !strings.Contains(strings.ToLower(msg), want) {
			t.Errorf("%s: message %q should mention %q", name, msg, want)
		}
	}
	if chain.RevertMessage("SomethingNew") != "" {
		t.Error("an unknown revert has no message")
	}
}
