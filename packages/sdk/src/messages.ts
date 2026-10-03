// Every message a party's wallet signs (EIP-191 personal_sign) for the CargoFlow API, byte-identical to
// backend/internal/auth/wallet.go: lines joined by "\n", no trailing newline, the ids and addresses Go lower-cases
// lower-cased here too (and nothing else: values are not trimmed), ending with `issued: <unix seconds>`, which the
// backend accepts within 10 minutes of its clock. Each signed request is single-use (a reuse is 409 `replayed`).
// test/messages.test.ts pins every builder against the strings the Go tests pin.

/** The kinds of document a party can attest. */
export const DOCUMENT_KINDS = ["invoice", "bill_of_lading", "packing_list", "certificate", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The alert events a subscription can name (cover events exist on contracts v2, CANCELLED and COVER_TRIGGERED on v3). */
export const ALERT_EVENTS = [
  "PAUSED", "RELEASED", "RESUMED", "DISPUTED", "DELIVERED", "SETTLED", "DEFAULTED",
  "COVER_OFFERED", "COVER_ACCEPTED", "COVER_CLAIMED", "CANCELLED", "COVER_TRIGGERED",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];
export type AlertChannel = "webhook" | "telegram" | "email" | "slack";

const lower = (s: string) => s.toLowerCase();

/** The exporter authorizes an evidence gateway (Ed25519 public key, base64url) for a shipment. */
export const sourceMessage = (shipmentId: string, publicKey: string, sensorIds: readonly string[], issued: number): string =>
  `CargoFlow evidence source\nshipment: ${lower(shipmentId)}\npublic key: ${publicKey}\nsensors: ${sensorIds.join(",")}\nissued: ${issued}`;

/**
 * The exporter authorizes an evidence gateway of any key type (backend auth.DeviceAuthorization). For "ed25519" (or
 * no type) it is sourceMessage unchanged; other types add a `key type:` line before `issued`, so a signature for one
 * key type can never register the key as another.
 */
export const deviceMessage = (shipmentId: string, publicKey: string, keyType: string, sensorIds: readonly string[], issued: number): string => {
  const keyLine = keyType && keyType !== "ed25519" ? `key type: ${keyType}\n` : "";
  return `CargoFlow evidence source\nshipment: ${lower(shipmentId)}\npublic key: ${publicKey}\nsensors: ${sensorIds.join(",")}\n${keyLine}issued: ${issued}`;
};

/** A wallet marks its notifications read: `ids` are the notification ids (lower-cased, comma-joined) or empty for "all". */
export const notificationsReadMessage = (address: string, ids: readonly string[] | "all", issued: number): string => {
  const list = ids === "all" || ids.length === 0 ? "all" : ids.map((i) => lower(i.trim())).join(",");
  return `CargoFlow notifications read\naddress: ${lower(address)}\nids: ${lower(list)}\nissued: ${issued}`;
};

/** The exporter asks for a ZK recovery proof bound to `submitter` (the wallet that will send resumeWithProof). */
export const recoveryMessage = (shipmentId: string, sensorId: string, submitter: string, issued: number): string =>
  `CargoFlow recovery\nshipment: ${lower(shipmentId)}\nsensor: ${sensorId}\nsubmitter: ${lower(submitter)}\nissued: ${issued}`;

/** A party attests a file by its SHA-256 (0x-prefixed hex). */
export const documentMessage = (shipmentId: string, kind: string, sha256: string, issued: number): string =>
  `CargoFlow document\nshipment: ${lower(shipmentId)}\nkind: ${kind}\nsha256: ${lower(sha256)}\nissued: ${issued}`;

/** A party subscribes to alerts. The target is signed exactly as sent ("" for Telegram, which links afterwards). */
export const alertsMessage = (shipmentId: string, channel: string, target: string, issued: number): string =>
  `CargoFlow alerts\nshipment: ${lower(shipmentId)}\nchannel: ${channel}\ntarget: ${target}\nissued: ${issued}`;

/** A subscriber removes a subscription. */
export const alertsOffMessage = (subscriptionId: string, issued: number): string =>
  `CargoFlow alerts off\nsubscription: ${subscriptionId}\nissued: ${issued}`;

/** The exporter names the vessel by its 9-digit MMSI. */
export const vesselMessage = (shipmentId: string, mmsi: string, issued: number): string =>
  `CargoFlow vessel\nshipment: ${lower(shipmentId)}\nmmsi: ${mmsi}\nissued: ${issued}`;

/** The exporter posts a financing request; `amount` in USDG base units. */
export const requestMessage = (shipmentId: string, amount: bigint | string, maxFeeBps: number, milestones: number, issued: number): string =>
  `CargoFlow financing request\nshipment: ${lower(shipmentId)}\namount: ${String(amount)}\nmax fee bps: ${maxFeeBps}\nmilestones: ${milestones}\nissued: ${issued}`;

/** A financier offers financing at a fee. */
export const offerMessage = (requestId: string, feeBps: number, issued: number): string =>
  `CargoFlow offer\nrequest: ${lower(requestId)}\nfee bps: ${feeBps}\nissued: ${issued}`;

/** The exporter accepts an offer. */
export const acceptMessage = (requestId: string, offerId: string, issued: number): string =>
  `CargoFlow accept\nrequest: ${lower(requestId)}\noffer: ${lower(offerId)}\nissued: ${issued}`;

/** The exporter withdraws a financing request. */
export const closeRequestMessage = (requestId: string, issued: number): string =>
  `CargoFlow close request\nrequest: ${lower(requestId)}\nissued: ${issued}`;

/** A wallet asks the gas drip for a little native currency. */
export const gasMessage = (address: string, issued: number): string => `CargoFlow gas\naddress: ${lower(address)}\nissued: ${issued}`;
