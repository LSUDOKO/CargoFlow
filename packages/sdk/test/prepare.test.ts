import { decodeFunctionData, erc20Abi, getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { coverPoolAbi, eblRegistryAbi, financingControllerAbi, policyEngineAbi, shipmentRegistryAbi } from "../src/contracts/abis";
import { addresses } from "../src/contracts/addresses";
import * as p from "../src/contracts/prepare";

const config = {
  chainId: 46630,
  contracts: {
    usdg: "0x7e955252e15c84f5768b83c41a71f9eba181802f",
    access: "0x5ed4f105e3c3c0a67f916c0fc339b261e3de81d7",
    evidenceRegistry: "0x4ad47799586b4793b7952ba849013f5d0ec2e66a",
    financingController: "0xa2e708376cddf0eb8fa746c43089611b4d49e210",
    groth16Verifier: "0x1baa24a99a9fe8cd53feb30e5df098d1334e0a8d",
    policyEngine: "0x93f2cd67f404f62ff34f729aad1118ea9e1582d0",
    receivableVault: "0x5298dcdbdf6ec799475b09c2ecd0f089bd4d6902",
    shipmentRegistry: "0x2f7cac603654ec106da242cd0b16044b31f7608d",
  },
};
const v1 = addresses(config);
const v2 = addresses({ ...config, contracts: { ...config.contracts, coverPool: "0x00000000000000000000000000000000000000c0" } });
const ID = ("0x" + "ab".repeat(32)) as Hex;
const ctrl = (data: Hex) => decodeFunctionData({ abi: financingControllerAbi, data });

describe("addresses", () => {
  it("checksums the API config and knows when there is no cover pool", () => {
    expect(v1.financingController).toBe(getAddress(config.contracts.financingController));
    expect(v1.financingController).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(v1.financingController).not.toBe(config.contracts.financingController); // checksummed, not lower case
    expect(v1.coverPool).toBeUndefined();
    expect(v2.coverPool).toBe("0x00000000000000000000000000000000000000C0");
  });
  it("refuses a config without a required contract", () => {
    expect(() => addresses({ chainId: 1, contracts: { usdg: "0x01" } })).toThrow(/no address for access/);
  });
});

describe("prepare helpers return plain unsigned requests", () => {
  it("deposit: approve the vault for the committed amount, then depositCapital", () => {
    const [approve, deposit] = p.prepareDepositWithApproval(v1, { shipmentId: ID, committed: 20_000_000n });
    expect(approve).toMatchObject({ to: v1.usdg, value: 0n, chainId: 46630 });
    expect(decodeFunctionData({ abi: erc20Abi, data: approve!.data })).toEqual({ functionName: "approve", args: [v1.receivableVault, 20_000_000n] });
    expect(deposit!.to).toBe(v1.financingController);
    expect(ctrl(deposit!.data)).toEqual({ functionName: "depositCapital", args: [ID] });
  });

  it("controller actions encode their arguments", () => {
    expect(ctrl(p.prepareStartTransit(v1, { shipmentId: ID }).data)).toEqual({ functionName: "startTransit", args: [ID] });
    expect(ctrl(p.prepareEvaluateAndReleaseMilestone(v1, { shipmentId: ID, milestoneIndex: 2, seq: 3 }).data)).toEqual({ functionName: "evaluateAndReleaseMilestone", args: [ID, 2, 3] });
    expect(ctrl(p.prepareMarkDelivered(v1, { shipmentId: ID }).data).functionName).toBe("markDelivered");
    const reason = ("0x" + "11".repeat(32)) as Hex;
    expect(ctrl(p.prepareOpenDispute(v1, { shipmentId: ID, reason }).data)).toEqual({ functionName: "openDispute", args: [ID, reason] });
    const [ap, settle] = p.prepareSettleWithApproval(v1, { shipmentId: ID, invoiceValue: 30_000_000n });
    expect(decodeFunctionData({ abi: erc20Abi, data: ap!.data }).args).toEqual([v1.receivableVault, 30_000_000n]);
    expect(ctrl(settle!.data).functionName).toBe("settle");
  });

  it("resumeWithProof takes the API's decimal-string proof words", () => {
    const tx = p.prepareResumeWithProof(v1, { shipmentId: ID, milestoneIndex: 2, seq: 2, a: ["1", "2"], b: [["3", "4"], ["5", "6"]], c: ["7", "8"] });
    expect(ctrl(tx.data)).toEqual({ functionName: "resumeWithProof", args: [ID, 2, 2, [1n, 2n], [[3n, 4n], [5n, 6n]], [7n, 8n]] });
  });

  it("createFacility carries v2 milestone places (0 = no place)", () => {
    const c = ("0x" + "cc".repeat(32)) as Hex;
    const tx = p.prepareCreateFacility(v1, {
      shipmentId: ID, financier: "0x0000000000000000000000000000000000000001", feeBps: 300,
      milestones: [{ allocation: 1n, evidenceThreshold: 75, checkpointCommitment: c }, { allocation: 2n, evidenceThreshold: 80, checkpointCommitment: c, latE6: 6_927_100, lonE6: 79_861_200, radiusM: 50_000 }],
    });
    const d = ctrl(tx.data);
    expect(d.functionName).toBe("createFacility");
    expect(d.args?.[3]).toEqual([
      { allocation: 1n, evidenceThreshold: 75, checkpointCommitment: c, latE6: 0, lonE6: 0, radiusM: 0 },
      { allocation: 2n, evidenceThreshold: 80, checkpointCommitment: c, latE6: 6_927_100, lonE6: 79_861_200, radiusM: 50_000 },
    ]);
  });

  it("registry and policy engine", () => {
    const h = ("0x" + "01".repeat(32)) as Hex;
    const reg = p.prepareRegisterShipment(v1, { externalRef: h, buyer: "0x0000000000000000000000000000000000000002", invoiceHash: h, routeCommitment: h, policyCommitment: h, invoiceValue: 5n });
    expect(reg.to).toBe(v1.shipmentRegistry);
    expect(decodeFunctionData({ abi: shipmentRegistryAbi, data: reg.data }).functionName).toBe("registerShipment");
    const policy = { minTempX100: 200, maxTempX100: 800, maxEvidenceAgeSec: 1800, maxRouteDeviationM: 25000, minEvidenceScore: 75, maxConflictBps: 3000, maxRiskBps: 3500, requiresZK: false, maxHumidityX100: 9000, maxShockX100: 0 };
    const sp = p.prepareSetPolicy(v1, { shipmentId: ID, policy });
    expect(decodeFunctionData({ abi: policyEngineAbi, data: sp.data }).args).toEqual([ID, policy]);
  });

  it("cover: approvals to the pool, premium rounded down, and a plain error without a pool", () => {
    expect(() => p.prepareOfferCover(v1, { shipmentId: ID, coverAmount: 1n, premiumBps: 100 })).toThrow(/no CoverPool/);
    const [ap, offer] = p.prepareOfferCoverWithApproval(v2, { shipmentId: ID, coverAmount: 10_000_000n, premiumBps: 150 });
    expect(decodeFunctionData({ abi: erc20Abi, data: ap!.data }).args).toEqual([v2.coverPool, 10_000_000n]);
    expect(decodeFunctionData({ abi: coverPoolAbi, data: offer!.data })).toEqual({ functionName: "offerCover", args: [ID, 10_000_000n, 150] });
    expect(p.coverPremium(10_000_001n, 150)).toBe(150_000n);
    const insurer = "0x0000000000000000000000000000000000000003";
    const acc = p.prepareAcceptCoverWithApproval(v2, { shipmentId: ID, insurer, premium: 150_000n });
    expect(acc).toHaveLength(2);
    expect(decodeFunctionData({ abi: coverPoolAbi, data: acc[1]!.data })).toEqual({ functionName: "acceptCover", args: [ID, insurer] });
    expect(p.prepareAcceptCoverWithApproval(v2, { shipmentId: ID, insurer, premium: 0n })).toHaveLength(1);
    for (const [fn, t] of [["release", p.prepareReleaseCover(v2, { shipmentId: ID })], ["claim", p.prepareClaimCover(v2, { shipmentId: ID })], ["withdrawOffer", p.prepareWithdrawOffer(v2, { shipmentId: ID })], ["withdraw", p.prepareWithdrawCover(v2)]] as const) {
      expect(t.to).toBe(v2.coverPool);
      expect(decodeFunctionData({ abi: coverPoolAbi, data: t.data }).functionName).toBe(fn);
    }
  });

  it("toJsonTx gives eth_sendTransaction-ready values", () => {
    expect(p.toJsonTx({ to: v1.usdg, data: "0x", value: 255n, chainId: 46630 })).toEqual({ to: v1.usdg, data: "0x", value: "0xff", chainId: 46630 });
  });
});

describe("contracts v3 helpers", () => {
  const v3 = addresses({
    ...config,
    contracts: { ...config.contracts, coverPool: "0x00000000000000000000000000000000000000c0", eblRegistry: "0x00000000000000000000000000000000000000e0", deviceRegistry: "0x00000000000000000000000000000000000000d0" },
  });
  const pool = (data: Hex) => decodeFunctionData({ abi: coverPoolAbi, data });
  const bill = (data: Hex) => decodeFunctionData({ abi: eblRegistryAbi, data });
  const A = getAddress("0x" + "1".repeat(40));
  const B = getAddress("0x" + "2".repeat(40));

  it("reads the v3 registries from the config", () => {
    expect(v3.eblRegistry).toBe(getAddress("0x00000000000000000000000000000000000000e0"));
    expect(v3.deviceRegistry).toBe(getAddress("0x00000000000000000000000000000000000000d0"));
    expect(v2.eblRegistry).toBeUndefined();
  });

  it("cancelFacility and bindTitle (with the ERC-721 approval of the controller first)", () => {
    expect(ctrl(p.prepareCancelFacility(v3, { shipmentId: ID }).data)).toEqual({ functionName: "cancelFacility", args: [ID] });
    const [approve, bind] = p.prepareBindTitleWithApproval(v3, { shipmentId: ID, tokenId: 7n });
    expect(approve!.to).toBe(v3.eblRegistry);
    expect(bill(approve!.data)).toEqual({ functionName: "approve", args: [v3.financingController, 7n] });
    expect(bind!.to).toBe(v3.financingController);
    expect(ctrl(bind!.data)).toEqual({ functionName: "bindTitle", args: [ID, 7n] });
  });

  it("parametric cover: offer (approve first) and trigger", () => {
    const [ap, offer] = p.prepareOfferParametricCoverWithApproval(v3, { shipmentId: ID, coverAmount: 5_000_000n, premiumBps: 300, consecutiveFailedEpochs: 3, salvageToExporter: 1_000_000n });
    expect(decodeFunctionData({ abi: erc20Abi, data: ap!.data }).args).toEqual([v3.coverPool, 5_000_000n]);
    expect(pool(offer!.data)).toEqual({ functionName: "offerParametricCover", args: [ID, 5_000_000n, 300, 3, 1_000_000n] });
    const e1 = ("0x" + "01".repeat(32)) as Hex;
    const e2 = ("0x" + "02".repeat(32)) as Hex;
    const trig = p.prepareTriggerParametric(v3, { shipmentId: ID, epochIds: [e1, e2] });
    expect(trig.to).toBe(v3.coverPool);
    expect(pool(trig.data)).toEqual({ functionName: "triggerParametric", args: [ID, [e1, e2]] });
  });

  it("bills of lading: issue, transfer, surrender and void", () => {
    const doc = ("0x" + "cd".repeat(32)) as Hex;
    expect(bill(p.prepareIssueBill(v3, { documentHash: doc, shipper: A }).data)).toEqual({ functionName: "issue", args: [doc, A, "0x0000000000000000000000000000000000000000"] });
    expect(bill(p.prepareIssueBill(v3, { documentHash: doc, shipper: A, consignee: B }).data).args).toEqual([doc, A, B]);
    expect(bill(p.prepareTransferBill(v3, { from: A, to: B, tokenId: 1n }).data)).toEqual({ functionName: "safeTransferFrom", args: [A, B, 1n] });
    expect(bill(p.prepareTransferBill(v3, { from: A, to: B, tokenId: 1n, safe: false }).data)).toEqual({ functionName: "transferFrom", args: [A, B, 1n] });
    expect(bill(p.prepareSurrenderBill(v3, { tokenId: 1n }).data)).toEqual({ functionName: "surrender", args: [1n] });
    expect(bill(p.prepareVoidBill(v3, { tokenId: 1n, reason: doc }).data)).toEqual({ functionName: "voidBill", args: [1n, doc] });
  });

  it("explains a missing EBLRegistry or CoverPool", () => {
    expect(() => p.prepareSurrenderBill(v2, { tokenId: 1n })).toThrow(/no EBLRegistry/);
    expect(() => p.prepareTriggerParametric(v1, { shipmentId: ID, epochIds: [] })).toThrow(/no CoverPool/);
  });
});
