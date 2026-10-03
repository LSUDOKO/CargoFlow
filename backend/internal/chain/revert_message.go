package chain

// revertMessages explains contract errors in words an API client (and the UI behind it) can show as is.
var revertMessages = map[string]string{
	// FinancingController
	"FacilityNotFound":         "no facility exists for this shipment",
	"FacilityAlreadyCreated":   "a facility already exists for this shipment",
	"NotExporter":              "only the shipment's exporter may do this",
	"NotFinancier":             "only the facility's financier may do this",
	"NotBuyer":                 "only the shipment's buyer may do this",
	"NotAuthorizedForShipment": "this account is not a party to the shipment",
	"InvalidCounterparty":      "the counterparty is not allowed for this facility (a party cannot take both sides)",
	"InvalidMilestones":        "the milestone schedule is invalid",
	"InvalidState":             "the facility is not in a state that allows this",
	"FacilityPaused":           "the facility is paused; releases wait for a recovery",
	"NotAuthorizedToPause":     "this account may not pause the facility",
	"InvalidReason":            "a reason code is required",
	"MilestonesIncomplete":     "every milestone must be released first",
	"MilestoneAlreadyReleased": "this milestone has already been released",
	"MilestoneOutOfOrder":      "milestones release strictly in order",
	"EvidenceBelowThreshold":   "the evidence score is below the milestone's threshold",
	"EvidenceNotCompliant":     "the evidence left the agreed temperature band",
	"EvidenceConflictTooHigh":  "the sensors disagree more than the policy allows",
	"EvidenceRiskTooHigh":      "the composite risk is above the policy limit",
	"EvidenceStale":            "the evidence is older than the policy allows",
	"EvidenceBelowPolicy":      "the evidence breaks the policy's humidity or shock limit",
	"ProofRequired":            "the policy requires a zero-knowledge proof for this evidence",
	"InvalidProof":             "the zero-knowledge proof did not verify",
	"InvalidProofContext":      "the proof was made for a different facility, epoch or pause",
	"StaleRecoveryEvidence":    "the recovery evidence predates the pause",
	"InvalidMilestonePlace":    "a milestone place needs valid coordinates and a radius between 1 km and 1,000 km",
	"OutsideMilestonePlace":    "the cargo is not yet within the milestone's place; the milestone waits for evidence from there",
	// EvidenceRegistry
	"EpochAlreadyCommitted": "this evidence epoch is already committed",
	"EpochNotFound":         "no evidence has been committed for this milestone yet",
	"InvalidEpoch":          "the evidence epoch is malformed (times, scores, coordinates or humidity out of range)",
	"ProofAlreadyVerified":  "a proof has already been verified for this epoch",
	// ShipmentRegistry and PolicyEngine
	"ShipmentNotFound":          "the shipment is not registered on chain",
	"ShipmentAlreadyRegistered": "the shipment is already registered",
	"PolicyNotSet":              "the shipment's policy has not been revealed",
	"PolicyAlreadySet":          "the shipment's policy is already revealed",
	"PolicyCommitmentMismatch":  "the policy does not match the shipment's policy commitment",
	"InvalidPolicy":             "the policy is invalid (an empty band, or a limit out of range)",
	// ReceivableVault
	"ExceedsCommittedFacility": "the amount exceeds the facility's commitment",
	// CoverPool
	"InvalidCover":         "the cover is invalid: the amount must be above zero and within the commitment, the premium at most 20%",
	"OfferExists":          "this insurer already has an open offer on the facility",
	"OfferNotFound":        "there is no open offer from this insurer",
	"CoverAlreadyAccepted": "a cover has already been accepted for this facility",
	"CoverNotActive":       "the facility has no active cover (it was never accepted, or has already paid out)",
	"NothingToWithdraw":    "there is nothing to withdraw",
	"UnsupportedToken":     "the token transfer did not arrive in full; only a plain ERC-20 is supported",
	// access control
	"Unauthorized": "this account does not hold the role this action needs",
}

// RevertMessage returns a plain-language explanation of a contract error by name, or "" for an unknown one.
func RevertMessage(name string) string { return revertMessages[name] }
