// Unsigned transaction requests for every CargoFlow action a party takes. Each returns `{ to, data, value, chainId }`
// for any wallet to send (viem `sendTransaction`, wagmi, ethers, a Safe, a hardware wallet); nothing here signs or
// sends. Token-moving actions need a USDG approval first; the `*WithApproval` helpers return both, approval first.
import {
  encodeFunctionData, erc20Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type Hex, type Abi,
} from "viem";
import { coverPoolAbi, eblRegistryAbi, financingControllerAbi, policyEngineAbi, shipmentRegistryAbi } from "./abis/index.js";
import type { CargoFlowAddresses } from "./addresses.js";
import type { OnChainPolicy } from "./commitments.js";

export interface TxRequest {
  to: Address;
  data: Hex;
  value: bigint;
  chainId: number;
}

/** A TxRequest as JSON-safe values (value as a 0x quantity), the shape eth_sendTransaction takes. */
export interface TxRequestJson {
  to: Address;
  data: Hex;
  value: Hex;
  chainId: number;
}

export const toJsonTx = (tx: TxRequest): TxRequestJson => ({ to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}` as Hex, chainId: tx.chainId });

/** v2 milestone spec. radiusM 0 = no place condition, else 1,000..1,000,000 m around (latE6, lonE6). */
export interface MilestoneSpec {
  allocation: bigint;
  evidenceThreshold: number;
  checkpointCommitment: Hex;
  latE6?: number;
  lonE6?: number;
  radiusM?: number;
}

type Ctx = Pick<CargoFlowAddresses, "chainId" | "financingController" | "shipmentRegistry" | "policyEngine" | "receivableVault" | "usdg"> & {
  coverPool?: Address;
  eblRegistry?: Address;
};

const tx = (ctx: Ctx, to: Address, data: Hex): TxRequest => ({ to, data, value: 0n, chainId: ctx.chainId });
type ControllerFn = ContractFunctionName<typeof financingControllerAbi, "nonpayable">;
const controller = <F extends ControllerFn>(ctx: Ctx, functionName: F, args: ContractFunctionArgs<typeof financingControllerAbi, "nonpayable", F>): TxRequest =>
  // the signature above checks names and arguments against the ABI; the encoder call itself is untyped
  tx(ctx, ctx.financingController, (encodeFunctionData as (p: { abi: Abi; functionName: string; args: readonly unknown[] }) => Hex)({ abi: financingControllerAbi, functionName, args: args as readonly unknown[] }));

function pool(ctx: Ctx): Address {
  if (!ctx.coverPool) throw new Error("This deployment has no CoverPool (contracts v1); default cover needs a contracts v2 deployment.");
  return ctx.coverPool;
}

function ebl(ctx: Ctx): Address {
  if (!ctx.eblRegistry) throw new Error("This deployment has no EBLRegistry; electronic bills of lading need a contracts v3 deployment with one.");
  return ctx.eblRegistry;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** ERC-20 approve on USDG. */
export const prepareApprove = (ctx: Ctx, a: { spender: Address; amount: bigint }): TxRequest =>
  tx(ctx, ctx.usdg, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.spender, a.amount] }));

/** Exporter: register a shipment. externalRef is keccak256(ref) (commitments.externalRefHash). */
export const prepareRegisterShipment = (
  ctx: Ctx,
  a: { externalRef: Hex; buyer: Address; invoiceHash: Hex; routeCommitment: Hex; policyCommitment: Hex; invoiceValue: bigint },
): TxRequest =>
  tx(
    ctx,
    ctx.shipmentRegistry,
    encodeFunctionData({
      abi: shipmentRegistryAbi,
      functionName: "registerShipment",
      args: [a.externalRef, a.buyer, a.invoiceHash, a.routeCommitment, a.policyCommitment, a.invoiceValue],
    }),
  );

/** Exporter: reveal the policy committed at registration (must hash to the commitment). */
export const prepareSetPolicy = (ctx: Ctx, a: { shipmentId: Hex; policy: OnChainPolicy }): TxRequest =>
  tx(ctx, ctx.policyEngine, encodeFunctionData({ abi: policyEngineAbi, functionName: "setPolicy", args: [a.shipmentId, a.policy] }));

/** Exporter: open the facility naming the financier, its fee and the v2 milestones (with optional places). */
export const prepareCreateFacility = (ctx: Ctx, a: { shipmentId: Hex; financier: Address; feeBps: number; milestones: MilestoneSpec[] }): TxRequest =>
  controller(ctx, "createFacility", [
    a.shipmentId,
    a.financier,
    a.feeBps,
    a.milestones.map((m) => ({
      allocation: m.allocation,
      evidenceThreshold: m.evidenceThreshold,
      checkpointCommitment: m.checkpointCommitment,
      latE6: m.latE6 ?? 0,
      lonE6: m.lonE6 ?? 0,
      radiusM: m.radiusM ?? 0,
    })),
  ]);

/** Financier: fund the facility. The vault pulls `committed` USDG, so approve the vault first. */
export const prepareDepositCapital = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest => controller(ctx, "depositCapital", [a.shipmentId]);

/** Financier: approve the vault for `committed`, then deposit. */
export const prepareDepositWithApproval = (ctx: Ctx, a: { shipmentId: Hex; committed: bigint }): TxRequest[] => [
  prepareApprove(ctx, { spender: ctx.receivableVault, amount: a.committed }),
  prepareDepositCapital(ctx, a),
];

/** Exporter (or a facility manager): start transit once financed. */
export const prepareStartTransit = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest => controller(ctx, "startTransit", [a.shipmentId]);

/** Exporter or financier: release milestone `milestoneIndex` on the committed epoch `seq` (it must pass the policy). */
export const prepareEvaluateAndReleaseMilestone = (ctx: Ctx, a: { shipmentId: Hex; milestoneIndex: number; seq: number }): TxRequest =>
  controller(ctx, "evaluateAndReleaseMilestone", [a.shipmentId, a.milestoneIndex, a.seq]);

type Word = string | bigint;
/** Exporter: resume a paused facility with a Groth16 recovery proof (from client.shipments.prepareRecovery). */
export const prepareResumeWithProof = (
  ctx: Ctx,
  a: { shipmentId: Hex; milestoneIndex: number; seq: number; a: readonly [Word, Word]; b: readonly [readonly [Word, Word], readonly [Word, Word]]; c: readonly [Word, Word] },
): TxRequest => {
  const n = (w: Word) => BigInt(w);
  return controller(ctx, "resumeWithProof", [
    a.shipmentId,
    a.milestoneIndex,
    a.seq,
    [n(a.a[0]), n(a.a[1])],
    [
      [n(a.b[0][0]), n(a.b[0][1])],
      [n(a.b[1][0]), n(a.b[1][1])],
    ],
    [n(a.c[0]), n(a.c[1])],
  ]);
};

/** Buyer: confirm delivery once every milestone is released. */
export const prepareMarkDelivered = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest => controller(ctx, "markDelivered", [a.shipmentId]);

/** Buyer: settle a delivered facility. The vault pulls the full invoice value, so approve the vault first. */
export const prepareSettle = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest => controller(ctx, "settle", [a.shipmentId]);

/** Buyer: approve the vault for `invoiceValue`, then settle. */
export const prepareSettleWithApproval = (ctx: Ctx, a: { shipmentId: Hex; invoiceValue: bigint }): TxRequest[] => [
  prepareApprove(ctx, { spender: ctx.receivableVault, amount: a.invoiceValue }),
  prepareSettle(ctx, a),
];

/** Exporter or financier: open a dispute on an active or paused facility. `reason` is a bytes32 (commitments.textHash). */
export const prepareOpenDispute = (ctx: Ctx, a: { shipmentId: Hex; reason: Hex }): TxRequest => controller(ctx, "openDispute", [a.shipmentId, a.reason]);

/** Insurer: offer default cover (escrows `coverAmount` USDG in the pool, so approve the pool first). */
export const prepareOfferCover = (ctx: Ctx, a: { shipmentId: Hex; coverAmount: bigint; premiumBps: number }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "offerCover", args: [a.shipmentId, a.coverAmount, a.premiumBps] }));

export const prepareOfferCoverWithApproval = (ctx: Ctx, a: { shipmentId: Hex; coverAmount: bigint; premiumBps: number }): TxRequest[] => [
  prepareApprove(ctx, { spender: pool(ctx), amount: a.coverAmount }),
  prepareOfferCover(ctx, a),
];

/** Insurer: withdraw an offer that was not accepted. */
export const prepareWithdrawOffer = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "withdrawOffer", args: [a.shipmentId] }));

/** The premium a financier pays to accept an offer: amount x premiumBps / 10,000 (rounded down, as the pool does). */
export const coverPremium = (amount: bigint, premiumBps: number): bigint => (amount * BigInt(premiumBps)) / 10_000n;

/** Financier: accept an insurer's offer (the pool pulls the premium, so approve the pool first). */
export const prepareAcceptCover = (ctx: Ctx, a: { shipmentId: Hex; insurer: Address }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "acceptCover", args: [a.shipmentId, a.insurer] }));

export const prepareAcceptCoverWithApproval = (ctx: Ctx, a: { shipmentId: Hex; insurer: Address; premium: bigint }): TxRequest[] =>
  a.premium > 0n ? [prepareApprove(ctx, { spender: pool(ctx), amount: a.premium }), prepareAcceptCover(ctx, a)] : [prepareAcceptCover(ctx, a)];

/** Anyone: return an active cover to the insurer once the facility settled. */
export const prepareReleaseCover = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "release", args: [a.shipmentId] }));

/** Anyone: pay out an active cover after the facility defaulted. */
export const prepareClaimCover = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "claim", args: [a.shipmentId] }));

/** Insurer or financier: withdraw everything the pool credited to the sender. */
export const prepareWithdrawCover = (ctx: Ctx): TxRequest => tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "withdraw", args: [] }));

// ------------------------------------------------------------------------------------------------- contracts v3

/**
 * Exporter or financier: cancel a facility before transit. CREATED cancels at once; FINANCED only after the
 * controller's cancel timeout, and the financier's deposit is returned.
 */
export const prepareCancelFacility = (ctx: Ctx, a: { shipmentId: Hex }): TxRequest => controller(ctx, "cancelFacility", [a.shipmentId]);

/** Exporter: let the FinancingController take the bill of lading into escrow (ERC-721 approve of one token). */
export const prepareApproveTitle = (ctx: Ctx, a: { tokenId: bigint }): TxRequest =>
  tx(ctx, ebl(ctx), encodeFunctionData({ abi: eblRegistryAbi, functionName: "approve", args: [ctx.financingController, a.tokenId] }));

/**
 * Exporter: bind an issued bill of lading (held by the exporter, consigned to order or to the buyer) to a CREATED or
 * FINANCED facility. The controller escrows it and releases it to the buyer on settlement (the financier on
 * default, the exporter on cancellation). Approve the controller for the token first.
 */
export const prepareBindTitle = (ctx: Ctx, a: { shipmentId: Hex; tokenId: bigint }): TxRequest => controller(ctx, "bindTitle", [a.shipmentId, a.tokenId]);

export const prepareBindTitleWithApproval = (ctx: Ctx, a: { shipmentId: Hex; tokenId: bigint }): TxRequest[] => [
  prepareApproveTitle(ctx, a),
  prepareBindTitle(ctx, a),
];

/**
 * Insurer: offer parametric cover: it pays out without a default once `consecutiveFailedEpochs` (1..the pool's
 * maximum) committed epochs in a row failed, with `salvageToExporter` (at most `coverAmount`) going to the exporter.
 * Escrows `coverAmount` USDG, so approve the pool first.
 */
export const prepareOfferParametricCover = (
  ctx: Ctx,
  a: { shipmentId: Hex; coverAmount: bigint; premiumBps: number; consecutiveFailedEpochs: number; salvageToExporter: bigint },
): TxRequest =>
  tx(
    ctx,
    pool(ctx),
    encodeFunctionData({
      abi: coverPoolAbi,
      functionName: "offerParametricCover",
      args: [a.shipmentId, a.coverAmount, a.premiumBps, a.consecutiveFailedEpochs, a.salvageToExporter],
    }),
  );

export const prepareOfferParametricCoverWithApproval = (
  ctx: Ctx,
  a: { shipmentId: Hex; coverAmount: bigint; premiumBps: number; consecutiveFailedEpochs: number; salvageToExporter: bigint },
): TxRequest[] => [prepareApprove(ctx, { spender: pool(ctx), amount: a.coverAmount }), prepareOfferParametricCover(ctx, a)];

/**
 * Anyone: trigger an accepted parametric cover with the ids of the consecutive failed epochs (oldest first, as
 * committed in the EvidenceRegistry; `epochId` in client.shipments.epochs).
 */
export const prepareTriggerParametric = (ctx: Ctx, a: { shipmentId: Hex; epochIds: readonly Hex[] }): TxRequest =>
  tx(ctx, pool(ctx), encodeFunctionData({ abi: coverPoolAbi, functionName: "triggerParametric", args: [a.shipmentId, [...a.epochIds]] }));

/**
 * Carrier (CARRIER_ROLE): issue an electronic bill of lading for a document (`documentHash` = keccak256 of the
 * file, documents.hashDocument) to the shipper; `consignee` omitted or zero makes it out to order.
 */
export const prepareIssueBill = (ctx: Ctx, a: { documentHash: Hex; shipper: Address; consignee?: Address }): TxRequest =>
  tx(ctx, ebl(ctx), encodeFunctionData({ abi: eblRegistryAbi, functionName: "issue", args: [a.documentHash, a.shipper, a.consignee ?? ZERO_ADDRESS] }));

/**
 * Holder: endorse (transfer) a bill to `to`. Uses safeTransferFrom by default, so a contract recipient must accept
 * ERC-721 tokens; `safe: false` uses transferFrom.
 */
export const prepareTransferBill = (ctx: Ctx, a: { from: Address; to: Address; tokenId: bigint; safe?: boolean }): TxRequest =>
  tx(
    ctx,
    ebl(ctx),
    a.safe === false
      ? encodeFunctionData({ abi: eblRegistryAbi, functionName: "transferFrom", args: [a.from, a.to, a.tokenId] })
      : encodeFunctionData({ abi: eblRegistryAbi, functionName: "safeTransferFrom", args: [a.from, a.to, a.tokenId] }),
  );

/** Holder: surrender the bill to its issuer to take delivery (the title then freezes). */
export const prepareSurrenderBill = (ctx: Ctx, a: { tokenId: bigint }): TxRequest =>
  tx(ctx, ebl(ctx), encodeFunctionData({ abi: eblRegistryAbi, functionName: "surrender", args: [a.tokenId] }));

/** Issuer, while holding the bill: void it. `reason` is a bytes32 (commitments.textHash). */
export const prepareVoidBill = (ctx: Ctx, a: { tokenId: bigint; reason: Hex }): TxRequest =>
  tx(ctx, ebl(ctx), encodeFunctionData({ abi: eblRegistryAbi, functionName: "voidBill", args: [a.tokenId, a.reason] }));
