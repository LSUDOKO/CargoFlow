import { chainName } from "@/lib/explorer";

// Plain-language messages for the contracts' custom errors (contracts/src). Unknown errors fall back to the name.
const messages: Record<string, string> = {
  AlreadyFunded: "This facility is already funded.",
  ERC20InsufficientAllowance: "Approve the vault to move this much USDG first.",
  ERC20InsufficientBalance: "This wallet does not hold enough USDG.",
  EpochAlreadyCommitted: "That evidence epoch is already on-chain.",
  EpochNotFound: "No committed evidence exists for that milestone yet.",
  EvidenceBelowThreshold: "The evidence score is below this milestone's threshold.",
  EvidenceConflictTooHigh: "The sensors disagree too much to release capital.",
  EvidenceNotCompliant: "The evidence shows readings outside the agreed temperature band.",
  EvidenceRiskTooHigh: "The shipment's risk is above the policy limit.",
  EvidenceStale: "The latest evidence is too old. Fresh readings are needed.",
  ExceedsCommittedFacility: "That would exceed the committed facility.",
  FacilityAlreadyCreated: "A facility already exists for this shipment.",
  FacilityAlreadyExists: "A facility already exists for this shipment.",
  FacilityClosed: "This facility is closed.",
  FacilityNotFound: "No facility exists for this shipment.",
  FacilityPaused: "The facility is paused. Releases resume after verified recovery evidence.",
  InvalidCounterparty: "The financier must be a different wallet from the exporter and the buyer.",
  InvalidInvoiceValue: "The invoice must cover the facility plus its fee.",
  InvalidMilestones: "The milestone plan is invalid. Check the allocations and thresholds.",
  InvalidPolicy: "The policy values are out of range.",
  InvalidProof: "The zero-knowledge proof did not verify.",
  InvalidState: "The facility is not in the right state for this action.",
  MilestoneAlreadyReleased: "That milestone has already been released.",
  MilestoneOutOfOrder: "Milestones release in order. An earlier one is still pending.",
  MilestonesIncomplete: "Every milestone must be released before delivery.",
  NotAuthorizedForShipment: "This wallet is not a party to the shipment.",
  NotAuthorizedToPause: "Only the monitor or dispute role can pause a facility.",
  NotBuyer: "Only the buyer can do this.",
  NotExporter: "Only the exporter can do this.",
  NotFinancier: "Only the financier can do this.",
  NotFunded: "The facility has not been funded yet.",
  PolicyAlreadySet: "The policy for this shipment is already set.",
  PolicyCommitmentMismatch: "The policy does not match the commitment made at registration.",
  PolicyNotSet: "Set the shipment's policy first.",
  ProofRequired: "This policy needs a verified proof before release.",
  ShipmentAlreadyRegistered: "A shipment with this reference already exists for this exporter.",
  ShipmentNotFound: "That shipment is not registered on-chain.",
  StaleRecoveryEvidence: "Recovery evidence must be committed after the pause.",
  ZeroAddress: "An address is missing.",
  ZeroAmount: "The amount must be greater than zero.",
};

type Errorish = { shortMessage?: string; message?: string; data?: { errorName?: string }; cause?: unknown };

function errorName(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== "object" || depth > 6) return undefined;
  const e = err as Errorish;
  if (e.data?.errorName) return e.data.errorName;
  const text = `${e.shortMessage ?? ""}\n${e.message ?? ""}`;
  const m = text.match(/\b([A-Z][A-Za-z0-9]+)\(\)/);
  if (m && messages[m[1]!]) return m[1];
  return errorName(e.cause, depth + 1);
}

/** Human message for a failed wallet transaction. */
export function decodeRevert(err: unknown): string {
  const name = errorName(err);
  if (name) return messages[name] ?? `The contract refused the transaction (${name}).`;
  if (err && typeof err === "object") {
    const e = err as Errorish;
    const text = e.shortMessage ?? e.message ?? "";
    if (/user (rejected|denied)/i.test(text)) return "Transaction cancelled in your wallet.";
    if (/insufficient funds/i.test(text)) return "This wallet needs a little ETH for gas.";
    if (text) return `Transaction failed: ${text.split("\n")[0]}`;
  }
  return "Transaction failed.";
}

/** Why a transaction must not be sent now, or null when it may. */
export function txGuard(s: { pending: boolean; walletChain: number | undefined; appChain: number }): string | null {
  if (s.pending) return "A transaction is already in progress.";
  if (s.walletChain === undefined) return "Connect a wallet first.";
  if (s.walletChain !== s.appChain) return `Switch your wallet to ${chainName(s.appChain)}.`;
  return null;
}

/** A wallet signature request's failure, in words. */
export function signatureError(err: unknown): string {
  const text = err instanceof Error ? `${(err as { shortMessage?: string }).shortMessage ?? ""} ${err.message}` : String(err);
  if (/user (rejected|denied)|rejected the request/i.test(text)) return "You declined the signature in your wallet.";
  return (err as { shortMessage?: string })?.shortMessage ?? (err instanceof Error ? err.message : "The wallet could not sign.");
}
