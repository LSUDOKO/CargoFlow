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
  InvalidCounterparty: "The wallets must be different: the financier cannot also be the exporter or the buyer, nor insure its own facility.",
  InvalidInvoiceValue: "The invoice must cover the facility plus its fee.",
  InvalidMilestones: "The milestone plan is invalid. Check the allocations and thresholds.",
  InvalidMilestonePlace: "A milestone place is out of range: the radius must be 1 to 1,000 km and the coordinates valid.",
  OutsideMilestonePlace: "The cargo is not yet within this milestone's place. The milestone waits for evidence from there; nothing failed.",
  EvidenceBelowPolicy: "The evidence breaks the agreed humidity or shock limit, so it cannot release capital.",
  InvalidEpoch: "The evidence epoch's values are out of range.",
  InvalidCover: "The cover must be more than zero, no more than the facility's commitment, with a premium of at most 20%.",
  OfferExists: "This wallet already has an open cover offer on this shipment. Withdraw it first to make a new one.",
  OfferNotFound: "There is no open cover offer from that insurer.",
  CoverAlreadyAccepted: "The financier has already accepted a cover for this shipment.",
  CoverNotActive: "There is no active cover to release or claim: it was already settled or paid out.",
  NothingToWithdraw: "There is nothing for this wallet to collect from the cover pool.",
  UnsupportedToken: "The cover pool only accepts plain USDG transfers.",
  SafeERC20FailedOperation: "The USDG transfer failed. Check the balance and the approval.",
  ReentrancyGuardReentrantCall: "The contract refused a nested call.",
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
  Unauthorized: "This wallet does not hold the role this action needs.",
  ZeroAddress: "An address is missing.",
  ZeroAmount: "The amount must be greater than zero.",
  // contracts v3
  EnforcedPause: "The protocol guardian has paused new facilities, deposits, cover and title binding. Settlement, delivery and payouts still work.",
  ExpectedPause: "The contract is not paused.",
  CancelNotAllowed: "A funded facility can only be cancelled 14 days after the deposit, and only before transit starts.",
  TitleBindingDisabled: "Bills of lading are not enabled on this deployment.",
  TitleAlreadyBound: "A bill of lading is already bound to this facility.",
  InvalidTitle: "This bill cannot be bound: it must be live, held by the exporter, and consigned to the buyer or \"to order\".",
  TitleNotTransferable: "This bill is surrendered or void, so it can never move again.",
  NotHolder: "Only the current holder of the bill can do this.",
  NotIssuer: "Only the carrier that issued the bill can void it.",
  DocumentAlreadyIssued: "A bill of lading has already been issued for this exact document.",
  InvalidBill: "The bill needs a document and a shipper address, and a title can never be burnt.",
  BillNotFound: "No bill of lading exists with that number.",
  InvalidTrigger: "Parametric terms need 1 to 32 consecutive failed batches and a salvage no larger than the cover.",
  NotParametric: "This cover has no parametric trigger.",
  TriggerNotMet: "The trigger is not met: the batches must be consecutive, all failing and committed after the cover was accepted.",
  NothingToRescue: "There is nothing to rescue.",
  AttestationRequired: "A passkey or secure-element device needs a verified attestation.",
  InvalidDevice: "The device key or class is invalid.",
  DeviceAlreadyRegistered: "This device key is already registered.",
  DeviceNotFound: "This device is not in the on-chain registry.",
  DeviceAlreadyRevoked: "This device has already been revoked.",
  NotDeviceOwnerOrAttestor: "Only the device's owner or an attestor can do this.",
  SourcesAlreadyRecorded: "The sources of this evidence batch are already recorded.",
  InvalidSources: "The evidence sources are invalid.",
  CannotCancel: "The facility cannot be cancelled once capital has been released.",
  ERC721InsufficientApproval: "Approve the financing controller for this bill first.",
  ERC721IncorrectOwner: "This wallet does not hold that bill.",
  ERC721InvalidReceiver: "That address cannot receive the bill.",
  ERC721NonexistentToken: "No bill of lading exists with that number.",
  ERC721InvalidApprover: "This wallet cannot approve that bill.",
  ERC721InvalidOperator: "That address cannot be approved for bills.",
  ERC721InvalidOwner: "That address cannot hold a bill.",
  ERC721InvalidSender: "This wallet cannot send that bill.",
  InvalidProofContext: "The proof was made for a different shipment, epoch or submitter.",
  InvalidReason: "A reason is required.",
};

type Errorish = { shortMessage?: string; message?: string; data?: { errorName?: string }; cause?: unknown };

function errorName(err: unknown, depth = 0): string | undefined {
  if (!err || typeof err !== "object" || depth > 6) return undefined;
  const e = err as Errorish;
  if (e.data?.errorName) return e.data.errorName;
  const text = `${e.shortMessage ?? ""}\n${e.message ?? ""}`;
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9]+)\(/g)) if (messages[m[1]!]) return m[1];
  return errorName(e.cause, depth + 1);
}

/**
 * The backend's 409 chain_rejected message ("the contract rejected the action: OutsideMilestonePlace: the cargo is
 * not yet within the milestone's place; ...") in the app's own words when the error is known, otherwise the
 * backend's plain explanation, capitalised. Other messages are returned unchanged.
 */
export function chainRejectedText(message: string): string {
  const m = message.match(/^the contract rejected the action:\s*([A-Z][A-Za-z0-9]*)(?:\([^)]*\))?(?::\s*(.*))?$/s);
  if (!m) return message;
  const [, name, plain] = m;
  if (messages[name!]) return messages[name!]!;
  const text = (plain ?? "").trim();
  if (!text) return `The contract refused the action (${name}).`;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** Human message for a failed wallet transaction. */
/** The passkey account's own explanation (PasskeyGasError), found anywhere in the error's cause chain. */
function passkeyGasText(err: unknown): string | null {
  let e = err as { name?: string; shortMessage?: string; cause?: unknown } | null;
  for (let i = 0; e && i < 8; i++) {
    if (e.name === "PasskeyGasError") return e.shortMessage ?? "Gas sponsorship isn't on; this account needs a little testnet ETH.";
    e = e.cause as typeof e;
  }
  return null;
}

export function decodeRevert(err: unknown): string {
  const gas = passkeyGasText(err);
  if (gas) return gas;
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
  const gas = passkeyGasText(err);
  if (gas) return `${gas} A new passkey account is set up on chain before its first signature.`;
  const text = err instanceof Error ? `${(err as { shortMessage?: string }).shortMessage ?? ""} ${err.message}` : String(err);
  if (/user (rejected|denied)|rejected the request/i.test(text)) return "You declined the signature in your wallet.";
  return (err as { shortMessage?: string })?.shortMessage ?? (err instanceof Error ? err.message : "The wallet could not sign.");
}
