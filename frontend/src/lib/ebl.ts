// Electronic bills of lading (contracts v3, EBLRegistry: one ERC-721 token per bill). Holding the token is holding the
// title; transfers are endorsements; surrender returns it to the issuing carrier and freezes it; the issuer can void
// a live bill it holds. Pure helpers: status words, what a wallet may do with a bill, form validation.

import { isAddress, keccak256, zeroAddress } from "viem";

export const EBL_STATUSES = ["NONE", "ISSUED", "SURRENDERED", "VOID"] as const;
export type EblStatus = (typeof EBL_STATUSES)[number];

/** IEBLRegistry.TitleStatus as a word; accepts the enum number (chain) or the name (backend). */
export function eblStatus(v: number | bigint | string | undefined | null): EblStatus {
  if (v === undefined || v === null) return "NONE";
  if (typeof v === "string" && !/^\d+$/.test(v)) {
    const up = v.toUpperCase();
    return (EBL_STATUSES as readonly string[]).includes(up) ? (up as EblStatus) : up === "VOIDED" ? "VOID" : "NONE";
  }
  return EBL_STATUSES[Number(v)] ?? "NONE";
}

export const EBL_STATUS_LABEL: Record<EblStatus, string> = { NONE: "Unknown", ISSUED: "Live", SURRENDERED: "Surrendered", VOID: "Void" };
export const eblStatusTone = (s: EblStatus) => (s === "ISSUED" ? "verified" : s === "VOID" ? "danger" : "slate") as "verified" | "danger" | "slate";

/** What a bill's status means for its holder, in one line. */
export function eblStatusText(s: EblStatus): string {
  switch (s) {
    case "ISSUED":
      return "Live title: its holder controls the goods and can endorse it to someone else.";
    case "SURRENDERED":
      return "Surrendered to the carrier at delivery. The title is frozen and can never move again.";
    case "VOID":
      return "Voided by the carrier. The title is frozen and can never move again.";
    default:
      return "No bill exists with this number.";
  }
}

export const MLETR_NOTE =
  "Designed around MLETR concepts (exclusive control, singularity, integrity) — not a legal compliance claim. Legal recognition depends on the jurisdiction.";

export const DAP_RULE = "Documents against payment: the bill goes to the buyer when they pay, to the financier on default, back to the exporter on cancel.";

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** "To order" for the zero address, otherwise the address. */
export const isToOrder = (consignee: string | undefined | null) => !consignee || same(consignee, zeroAddress);

export type Bill = {
  tokenId: bigint;
  documentHash: string;
  issuer: string;
  shipper: string;
  consignee: string;
  status: EblStatus;
  issuedAt: number;
  closedAt: number;
  transfers: number;
  holder: string;
};

export type BillActions = {
  /** the wallet holds a live bill and may endorse it to another address */
  transfer: boolean;
  /** the wallet holds a live bill and may surrender it to the carrier */
  surrender: boolean;
  /** the wallet is the issuer and holds the live bill, so it may void it */
  void: boolean;
  /** the bill is escrowed by the financing controller: nobody can move it */
  escrowed: boolean;
};

/** What `address` may do with `bill`. `controller` is the financing controller (an escrowed bill cannot move). */
export function billActions(bill: Pick<Bill, "status" | "holder" | "issuer">, address: string | undefined, controller?: string): BillActions {
  const live = bill.status === "ISSUED";
  const escrowed = live && same(bill.holder, controller);
  const holds = live && same(bill.holder, address);
  return { transfer: holds, surrender: holds && !same(bill.issuer, address), void: holds && same(bill.issuer, address), escrowed };
}

/** Whether the exporter may bind this bill to its facility (mirrors FinancingController.bindTitle's checks). */
export function bindableReason(bill: Pick<Bill, "status" | "holder" | "consignee">, exporter: string, buyer: string): string | null {
  if (bill.status !== "ISSUED") return "Only a live bill can be bound.";
  if (!same(bill.holder, exporter)) return "The exporter must hold the bill to bind it.";
  if (!isToOrder(bill.consignee) && !same(bill.consignee, buyer)) return "The bill's consignee must be the buyer or \"to order\".";
  return null;
}

export type IssueForm = { shipper: string; consignee: string; toOrder: boolean; documentHash: string };

/** Validates the carrier's issue form; returns the arguments for EBLRegistry.issue when valid. */
export function validateIssue(f: IssueForm): { errors: Partial<Record<keyof IssueForm, string>>; args?: [`0x${string}`, `0x${string}`, `0x${string}`] } {
  const errors: Partial<Record<keyof IssueForm, string>> = {};
  if (!/^0x[0-9a-fA-F]{64}$/.test(f.documentHash) || /^0x0{64}$/.test(f.documentHash)) errors.documentHash = "Choose the bill's document so its fingerprint can be computed.";
  const shipper = f.shipper.trim();
  if (!isAddress(shipper)) errors.shipper = "Enter the shipper's wallet address (0x…).";
  else if (same(shipper, zeroAddress)) errors.shipper = "The shipper cannot be the zero address.";
  const consignee = f.consignee.trim();
  if (!f.toOrder && !isAddress(consignee)) errors.consignee = "Enter the consignee's address, or choose \"to order\".";
  if (Object.keys(errors).length) return { errors };
  return { errors, args: [f.documentHash as `0x${string}`, shipper as `0x${string}`, (f.toOrder ? zeroAddress : consignee) as `0x${string}`] };
}

/** keccak256 of a file's bytes: the bill's document hash. */
export async function hashFile(file: Blob): Promise<`0x${string}`> {
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}

/** Whether a dropped file matches the bill's document hash. */
export const documentMatches = (computed: string, onChain: string) => computed.toLowerCase() === onChain.toLowerCase();

/** Parses a bill number from the URL ("12", "#12"); null when it is not a positive integer. */
export function parseTokenId(raw: string): bigint | null {
  const t = raw.trim().replace(/^#/, "");
  if (!/^\d{1,30}$/.test(t)) return null;
  const n = BigInt(t);
  return n > 0n ? n : null;
}
