package chain_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

func TestEmbeddedABIsExposeEverythingTheBackendUses(t *testing.T) {
	a := chain.ABIs()
	want := map[string]struct {
		funcs, events, errs []string
	}{
		"FinancingController": {
			funcs: []string{"createFacility", "depositCapital", "startTransit", "evaluateAndReleaseMilestone",
				"pauseFinancing", "resumeWithProof", "resumeByVerifier", "openDispute", "markDelivered", "settle",
				"getFacility", "getMilestone", "proofContext"},
			events: []string{"FacilityCreated", "StatusChanged", "MilestoneAdvanceReleased", "FinancingPaused",
				"FinancingResumed", "DisputeOpened", "DisputeResolved", "DeliveryConfirmed", "DefaultDeclared"},
			errs: []string{"InvalidProof", "InvalidProofContext", "StaleRecoveryEvidence", "FacilityPaused",
				"EvidenceBelowThreshold", "EvidenceConflictTooHigh", "MilestoneOutOfOrder", "InvalidState"},
		},
		"EvidenceRegistry": {
			funcs:  []string{"commitEpoch", "getEpoch", "epochIdFor", "markProofVerified"},
			events: []string{"EvidenceEpochCommitted", "EvidenceProofVerified"},
			errs:   []string{"EpochAlreadyCommitted", "EpochNotFound", "InvalidEpoch"},
		},
		"ShipmentRegistry": {
			funcs:  []string{"registerShipment", "getShipment", "shipmentIdFor"},
			events: []string{"ShipmentRegistered"},
			errs:   []string{"ShipmentAlreadyRegistered"},
		},
		"PolicyEngine": {
			funcs:  []string{"setPolicy", "getPolicy", "hashPolicy"},
			events: []string{"PolicySet"},
			errs:   []string{"PolicyCommitmentMismatch"},
		},
		"ReceivableVault": {
			funcs:  []string{"getFacility"},
			events: []string{"FacilityOpened", "CapitalDeposited", "AdvanceReleased", "FacilitySettled", "FacilityDefaulted", "FacilityPauseSet"},
			errs:   []string{"ExceedsCommittedFacility"},
		},
		"ERC20": {
			funcs:  []string{"balanceOf", "approve", "allowance", "decimals", "symbol", "transfer"},
			events: []string{"Transfer", "Approval"},
		},
	}
	for name, w := range want {
		abi, ok := a[name]
		if !ok {
			t.Errorf("missing ABI %s", name)
			continue
		}
		for _, f := range w.funcs {
			if _, ok := abi.Methods[f]; !ok {
				t.Errorf("%s: missing function %s", name, f)
			}
		}
		for _, e := range w.events {
			if _, ok := abi.Events[e]; !ok {
				t.Errorf("%s: missing event %s", name, e)
			}
		}
		for _, e := range w.errs {
			if _, ok := abi.Errors[e]; !ok {
				t.Errorf("%s: missing error %s", name, e)
			}
		}
	}
}

// When the contracts have been built locally, the embedded ABIs must equal the compiler's output, so a
// contract change that forgets `make abi` fails here instead of breaking the backend at runtime.
func TestEmbeddedABIsMatchTheBuiltArtifactsWhenPresent(t *testing.T) {
	for _, name := range []string{"FinancingController", "EvidenceRegistry", "ShipmentRegistry", "PolicyEngine", "ReceivableVault"} {
		artifact := filepath.Join("..", "..", "..", "contracts", "out", name+".sol", name+".json")
		raw, err := os.ReadFile(artifact)
		if err != nil {
			t.Skipf("contracts not built (%v); run `make contracts-build`", err)
		}
		var built struct {
			ABI json.RawMessage `json:"abi"`
		}
		if err := json.Unmarshal(raw, &built); err != nil {
			t.Fatal(err)
		}
		embedded, err := os.ReadFile(filepath.Join("abi", name+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var a, b any
		_ = json.Unmarshal(built.ABI, &a)
		_ = json.Unmarshal(embedded, &b)
		if !reflect.DeepEqual(a, b) {
			t.Errorf("%s: embedded ABI is stale; run `make abi`", name)
		}
	}
}
