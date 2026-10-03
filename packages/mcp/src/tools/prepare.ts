// Prepare tools: each checks the shipment's current state, then returns unsigned transaction requests
// ({to, data, value, chainId}) with a plain summary and a CargoFlow link where the same action can be signed.
// Nothing here holds a key, signs or sends: the person signs with their own wallet.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { contracts, evidence, messages, toJsonTx, type CargoFlowAddresses, type ShipmentView, type TxRequest } from "@cargoflow/sdk";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { json, km, pct, parseUsdg, Refusal, safe, text, usdg } from "../format.js";
import { address, shipmentId } from "./read.js";

const PREPARE = { readOnlyHint: true, openWorldHint: true } as const;
type Hex = `0x${string}`;
type Role = "exporter" | "financier" | "buyer" | "insurer";

interface Step {
  label: string;
  tx: TxRequest;
}

function render(ctx: Ctx, o: { action: string; shipment: ShipmentView["shipment"]; signer: { role: Role; address?: string }; steps: Step[]; notes?: string[]; portal: "exporter" | "financier" | "buyer" | "market" }) {
  const chainId = o.steps[0]!.tx.chainId;
  const lines = [
    `${o.action} for ${o.shipment.externalRef} (${o.shipment.id})`,
    `Sign with the ${o.signer.role}'s wallet${o.signer.address ? ` (${o.signer.address})` : ""} on chain ${chainId}${chainId === 46630 ? " (Robinhood Chain Testnet)" : ""}.`,
    `Send ${o.steps.length === 1 ? "this transaction" : `these ${o.steps.length} transactions in order`}:`,
    ...o.steps.map((s, i) => `${i + 1}. ${s.label} → ${s.tx.to}`),
    ...(o.notes ?? []),
    `Or open CargoFlow and sign there: ${ctx.shipmentUrl(o.shipment.id)} (shipment page) · ${ctx.portalUrl(o.portal)} (${o.portal} portal).`,
    "These are unsigned requests: nothing has been sent. Review them in your wallet before signing.",
  ];
  return text(lines.join("\n"), json({ chainId, signer: o.signer, transactions: o.steps.map((s) => ({ description: s.label, ...toJsonTx(s.tx) })), signUrl: ctx.shipmentUrl(o.shipment.id) }));
}

async function load(ctx: Ctx, id: string): Promise<{ v: ShipmentView; addrs: CargoFlowAddresses; sid: Hex }> {
  const [v, addrs] = await Promise.all([ctx.client.shipments.get(id), ctx.addresses()]);
  return { v, addrs, sid: id.toLowerCase() as Hex };
}

function facilityIn(v: ShipmentView, allowed: string[], what: string) {
  const f = v.facility;
  if (!f) throw new Refusal(`${v.shipment.externalRef} has no facility yet, so it cannot ${what}. The exporter first opens one (createFacility) naming a financier.`);
  if (!allowed.includes(f.status)) throw new Refusal(`${v.shipment.externalRef} is ${f.status}; it can ${what} only when ${allowed.join(" or ")}.`);
  return f;
}

export function registerPrepareTools(server: McpServer, ctx: Ctx) {
  server.registerTool(
    "prepare_deposit",
    {
      title: "Prepare: fund a facility",
      description:
        "Prepare the financier's deposit into a newly created facility: a USDG approval of the committed amount to the ReceivableVault, then FinancingController.depositCapital. Only valid while the facility is CREATED. Returns unsigned transactions and a link to sign in CargoFlow.",
      inputSchema: { shipmentId },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["CREATED"], "be funded");
      const committed = BigInt(f.committed);
      const [approve, deposit] = contracts.prepareDepositWithApproval(addrs, { shipmentId: sid, committed });
      return render(ctx, {
        action: `Fund the facility with ${usdg(committed)}`,
        shipment: v.shipment,
        signer: { role: "financier", address: f.financier },
        steps: [
          { label: `Approve the ReceivableVault to pull ${usdg(committed)} (USDG.approve)`, tx: approve! },
          { label: "Deposit the committed capital (FinancingController.depositCapital)", tx: deposit! },
        ],
        notes: [`The financier's wallet must hold at least ${usdg(committed)}. After this the exporter starts transit.`],
        portal: "financier",
      });
    }),
  );

  server.registerTool(
    "prepare_release",
    {
      title: "Prepare: release the next milestone",
      description:
        "Prepare FinancingController.evaluateAndReleaseMilestone for the next milestone, using the newest committed epoch that passed the policy (or a given epoch sequence). Refuses when the facility is not ACTIVE, no passing committed epoch exists, or the epoch is outside the milestone's place. The exporter or financier signs. The backend normally sends releases itself; use this if one is missing.",
      inputSchema: {
        shipmentId,
        milestoneIndex: z.number().int().min(0).max(15).optional().describe("0-based milestone index; default the facility's next milestone."),
        seq: z.number().int().min(1).optional().describe("Epoch sequence for that milestone; default the newest passing committed one."),
      },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, milestoneIndex, seq }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["ACTIVE"], "release a milestone");
      const idx = milestoneIndex ?? f.nextMilestone;
      if (idx >= f.milestoneCount) throw new Refusal("Every milestone is already released; the buyer can now confirm delivery (prepare_mark_delivered).");
      if (idx !== f.nextMilestone) throw new Refusal(`Milestones release strictly in order; the next one is milestone ${f.nextMilestone + 1} (index ${f.nextMilestone}).`);
      const epochs = (await ctx.client.shipments.epochs(id)).epochs.filter((e) => e.milestoneIndex === idx);
      const candidates = epochs.filter((e) => (seq === undefined ? e.decisionPass && !!e.commitTx : e.sequence === seq));
      const e = candidates.sort((a, b) => b.sequence - a.sequence)[0];
      if (!e) {
        throw new Refusal(
          seq === undefined
            ? `No committed epoch for milestone ${idx + 1} has passed the policy yet (${epochs.length} epoch(s) seen). The release waits for passing evidence; explain_shipment says what is missing.`
            : `There is no epoch ${seq} for milestone ${idx + 1}.`,
        );
      }
      if (!e.commitTx) throw new Refusal(`Epoch ${e.sequence} of milestone ${idx + 1} is not committed on chain yet.`);
      const notes: string[] = [`Evidence: epoch ${e.sequence}, score ${e.score} (threshold ${v.milestones[idx]?.evidenceThreshold ?? "?"}), ${e.compliant ? "compliant" : "NOT compliant"}, decision ${e.decisionAction}.`];
      const m = v.milestones[idx];
      if (m?.radiusM && e.latE6 !== undefined && e.lonE6 !== undefined) {
        const pc = evidence.placeCheck({ latE6: e.latE6, lonE6: e.lonE6 }, m);
        if (!pc.inside) throw new Refusal(`Milestone ${idx + 1} requires evidence from within ${km(m.radiusM)} of ${m.placeLabel || "its place"}; this epoch's centroid is ${km(pc.distanceM)} away, so the contract would revert (OutsideMilestonePlace).`);
        notes.push(`Place check: ${km(pc.distanceM)} from ${m.placeLabel || "the milestone place"} (limit ${km(m.radiusM)}).`);
      }
      if (!e.decisionPass) notes.push("Warning: the backend's decision for this epoch did not pass; the contract may revert (EvidenceBelowPolicy).");
      const tx = contracts.prepareEvaluateAndReleaseMilestone(addrs, { shipmentId: sid, milestoneIndex: idx, seq: e.sequence });
      return render(ctx, {
        action: `Release milestone ${idx + 1} (${usdg(m?.allocatedUsdg)})`,
        shipment: v.shipment,
        signer: { role: "exporter", address: `${f.exporter} (or the financier ${f.financier})` },
        steps: [{ label: `Release milestone ${idx + 1} on epoch ${e.sequence} (FinancingController.evaluateAndReleaseMilestone)`, tx }],
        notes,
        portal: "exporter",
      });
    }),
  );

  server.registerTool(
    "prepare_resume_with_proof",
    {
      title: "Prepare: resume a paused facility with a ZK proof",
      description:
        "Resume a PAUSED facility with a zero-knowledge recovery proof of fresh in-band readings. This needs the exporter's own wallet signature over a recovery message: call first without `signature` to get the exact message, have the exporter sign it (personal_sign) in their wallet, then call again with `signature` and the same `issuedAt`. The backend then commits the recovery evidence and returns the proof, and this tool returns the unsigned resumeWithProof transaction. This server never signs anything itself.",
      inputSchema: {
        shipmentId,
        sensorId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/).describe("The probe whose fresh in-band readings prove the recovery, e.g. probe-2."),
        submitter: address.optional().describe("The exporter's wallet, which signs the message and sends the transaction; default the facility's exporter."),
        issuedAt: z.number().int().optional().describe("Unix seconds that were signed (from the first call). Required with signature."),
        signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional().describe("The exporter's personal_sign signature over the recovery message."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    safe(async ({ shipmentId: id, sensorId, submitter, issuedAt, signature }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["PAUSED"], "be resumed with a proof");
      const who = (submitter ?? f.exporter).toLowerCase();
      if (who !== f.exporter.toLowerCase()) throw new Refusal(`Only the exporter (${f.exporter}) can request and submit a recovery proof.`);
      if (!signature) {
        const t = ctx.now();
        const msg = messages.recoveryMessage(sid, sensorId, who, t);
        return text(
          [
            `A recovery proof needs the exporter's signature. Nothing has been sent.`,
            `1. In the exporter's wallet (${who}), sign this exact message with personal_sign (the lines are separated by \\n, no trailing newline):`,
            "",
            msg,
            "",
            `2. Call prepare_resume_with_proof again with sensorId "${sensorId}", issuedAt ${t} and the signature, within 10 minutes.`,
            `The backend will then commit the recovery evidence from ${sensorId}'s readings after the pause and return the proof. ${sensorId} needs fresh in-band readings since the pause (explain_shipment shows the cause; a humidity or shock pause cannot be cleared by a temperature proof).`,
            `Or do it in CargoFlow: ${ctx.shipmentUrl(sid)} (the exporter's recovery panel).`,
          ].join("\n"),
        );
      }
      if (issuedAt === undefined) throw new Refusal("Pass the issuedAt that was signed together with the signature.");
      const proof = await ctx.client.shipments.prepareRecoveryWithSignature(sid, { sensorId, submitter: who, issuedAt, signature });
      const tx = contracts.prepareResumeWithProof(addrs, { shipmentId: sid, milestoneIndex: proof.milestoneIndex, seq: proof.sequence, a: proof.a, b: proof.b, c: proof.c });
      return render(ctx, {
        action: `Resume with a ZK recovery proof (score ${proof.score})`,
        shipment: v.shipment,
        signer: { role: "exporter", address: who },
        steps: [{ label: `Resume milestone ${proof.milestoneIndex + 1} with the proof for epoch ${proof.sequence} (FinancingController.resumeWithProof)`, tx }],
        notes: [`Recovery evidence committed in ${proof.commitTx}. The proof is bound to ${proof.submitter}; send it from that wallet.`],
        portal: "exporter",
      });
    }),
  );

  server.registerTool(
    "prepare_mark_delivered",
    {
      title: "Prepare: confirm delivery",
      description: "Prepare the buyer's delivery confirmation (FinancingController.markDelivered). Valid when the facility is ACTIVE and every milestone is released.",
      inputSchema: { shipmentId },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["ACTIVE"], "be marked delivered");
      if (f.nextMilestone < f.milestoneCount) throw new Refusal(`Only ${f.nextMilestone} of ${f.milestoneCount} milestones are released; delivery can be confirmed after the last one (MilestonesIncomplete).`);
      return render(ctx, {
        action: "Confirm delivery",
        shipment: v.shipment,
        signer: { role: "buyer", address: f.buyer },
        steps: [{ label: "Confirm delivery (FinancingController.markDelivered)", tx: contracts.prepareMarkDelivered(addrs, { shipmentId: sid }) }],
        notes: [`Next the buyer settles: ${usdg(v.shipment.invoiceValue)} (prepare_settle).`],
        portal: "buyer",
      });
    }),
  );

  server.registerTool(
    "prepare_settle",
    {
      title: "Prepare: settle the invoice",
      description: "Prepare the buyer's settlement of a DELIVERED facility: a USDG approval of the full invoice value to the ReceivableVault, then FinancingController.settle. The vault repays the financier (principal + fee + undrawn) and pays the exporter the rest.",
      inputSchema: { shipmentId },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["DELIVERED"], "be settled");
      const invoice = BigInt(v.shipment.invoiceValue);
      const drawn = BigInt(f.drawn);
      const fee = (drawn * BigInt(f.feeBps)) / 10_000n;
      const [approve, settle] = contracts.prepareSettleWithApproval(addrs, { shipmentId: sid, invoiceValue: invoice });
      return render(ctx, {
        action: `Settle the ${usdg(invoice)} invoice`,
        shipment: v.shipment,
        signer: { role: "buyer", address: f.buyer },
        steps: [
          { label: `Approve the ReceivableVault to pull ${usdg(invoice)} (USDG.approve)`, tx: approve! },
          { label: "Settle (FinancingController.settle)", tx: settle! },
        ],
        notes: [`Expected split: about ${usdg(drawn + fee + BigInt(f.remaining))} to the financier (drawn ${usdg(drawn)} + fee ${usdg(fee)} + undrawn ${usdg(f.remaining)}), the rest to the exporter.`],
        portal: "buyer",
      });
    }),
  );

  server.registerTool(
    "prepare_open_dispute",
    {
      title: "Prepare: open a dispute",
      description: "Prepare FinancingController.openDispute for an ACTIVE or PAUSED facility. The exporter or financier signs; the reason text is hashed (keccak256) into the bytes32 the contract records, so keep the text to share with the arbiter.",
      inputSchema: { shipmentId, reason: z.string().min(3).max(1000).describe("Why the dispute is opened, in plain words.") },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, reason }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["ACTIVE", "PAUSED"], "be disputed");
      const hash = contracts.textHash(reason);
      return render(ctx, {
        action: "Open a dispute",
        shipment: v.shipment,
        signer: { role: "exporter", address: `${f.exporter} (or the financier ${f.financier})` },
        steps: [{ label: `Open a dispute with reason hash ${hash} (FinancingController.openDispute)`, tx: contracts.prepareOpenDispute(addrs, { shipmentId: sid, reason: hash }) }],
        notes: [`The reason hash is keccak256 of: "${reason}". Releases stop until an arbiter resolves the dispute.`],
        portal: "exporter",
      });
    }),
  );

  server.registerTool(
    "prepare_offer_cover",
    {
      title: "Prepare: offer default cover",
      description: "Prepare an insurer's default-cover offer on a shipment (contracts v2 CoverPool): a USDG approval of the cover amount to the pool, then CoverPool.offerCover. The amount is escrowed until the offer is withdrawn, accepted and later released or claimed.",
      inputSchema: {
        shipmentId,
        amountUsdg: z.string().regex(/^\d[\d,]*(\.\d{1,6})?$/).describe("Cover amount in USDG, e.g. \"10000\" or \"2500.50\"."),
        premiumBps: z.number().int().min(0).max(10_000).describe("Premium the financier pays on acceptance, in basis points of the amount (150 = 1.5%)."),
        insurer: address.optional().describe("The insurer's wallet, for the summary."),
      },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, amountUsdg, premiumBps, insurer }) => {
      const { v, addrs, sid } = await load(ctx, id);
      if (!addrs.coverPool) throw new Refusal("This CargoFlow deployment runs contracts v1, which has no CoverPool; default cover is available after the v2 deployment.");
      const amount = parseUsdg(amountUsdg);
      if (!amount || amount <= 0n) throw new Refusal("Enter a positive USDG amount with at most 6 decimals.");
      const f = v.facility;
      if (f && ["SETTLED", "DEFAULTED"].includes(f.status)) throw new Refusal(`${v.shipment.externalRef} is ${f.status}; there is nothing left to cover.`);
      const [approve, offer] = contracts.prepareOfferCoverWithApproval(addrs, { shipmentId: sid, coverAmount: amount, premiumBps });
      return render(ctx, {
        action: `Offer ${usdg(amount)} of default cover at ${pct(premiumBps)}`,
        shipment: v.shipment,
        signer: { role: "insurer", address: insurer },
        steps: [
          { label: `Approve the CoverPool to escrow ${usdg(amount)} (USDG.approve)`, tx: approve! },
          { label: "Offer cover (CoverPool.offerCover)", tx: offer! },
        ],
        notes: [`If accepted, the financier pays a premium of ${usdg(contracts.coverPremium(amount, premiumBps))}.`],
        portal: "financier",
      });
    }),
  );

  server.registerTool(
    "prepare_accept_cover",
    {
      title: "Prepare: accept a cover offer",
      description: "Prepare the financier's acceptance of an insurer's open cover offer (contracts v2): a USDG approval of the premium to the CoverPool (when the premium is not zero), then CoverPool.acceptCover.",
      inputSchema: { shipmentId, insurer: address.describe("The insurer whose open offer to accept (from get_cover).") },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, insurer }) => {
      const { v, addrs, sid } = await load(ctx, id);
      if (!addrs.coverPool) throw new Refusal("This CargoFlow deployment runs contracts v1, which has no CoverPool; default cover is available after the v2 deployment.");
      const f = facilityIn(v, ["CREATED", "FINANCED", "ACTIVE", "PAUSED"], "take cover");
      const cover = await ctx.client.shipments.cover(id);
      if (cover.cover) throw new Refusal(`This shipment already has an accepted cover (${cover.cover.status}) from ${cover.cover.insurer}.`);
      const offer = cover.offers.find((o) => o.insurer.toLowerCase() === insurer.toLowerCase());
      if (!offer) throw new Refusal(`No open cover offer from ${insurer}. Open offers: ${cover.offers.map((o) => o.insurer).join(", ") || "none"}.`);
      const premium = contracts.coverPremium(BigInt(offer.amount), offer.premiumBps);
      const txs = contracts.prepareAcceptCoverWithApproval(addrs, { shipmentId: sid, insurer: insurer as Hex, premium });
      const steps: Step[] =
        txs.length === 2
          ? [
              { label: `Approve the CoverPool to pull the ${usdg(premium)} premium (USDG.approve)`, tx: txs[0]! },
              { label: `Accept ${usdg(offer.amount)} of cover from ${insurer} (CoverPool.acceptCover)`, tx: txs[1]! },
            ]
          : [{ label: `Accept ${usdg(offer.amount)} of cover from ${insurer} (CoverPool.acceptCover)`, tx: txs[0]! }];
      return render(ctx, {
        action: `Accept ${usdg(offer.amount)} of default cover at ${pct(offer.premiumBps)}`,
        shipment: v.shipment,
        signer: { role: "financier", address: f.financier },
        steps,
        notes: ["If the facility defaults, the pool pays the financier up to the cover amount; if it settles, the cover returns to the insurer."],
        portal: "financier",
      });
    }),
  );

  server.registerTool(
    "prepare_cancel",
    {
      title: "Prepare: cancel a facility before transit",
      description:
        "Prepare FinancingController.cancelFacility (contracts v3): the exporter or financier cancels a facility that has not started transit. A CREATED facility cancels at once; a FINANCED one only 14 days after funding (then the financier's deposit is returned, and a bound bill of lading goes back to the exporter).",
      inputSchema: { shipmentId, signer: z.enum(["exporter", "financier"]).optional().describe("Who signs; default the exporter.") },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, signer }) => {
      const { v, addrs, sid } = await load(ctx, id);
      const f = facilityIn(v, ["CREATED", "FINANCED"], "be cancelled");
      const role = signer ?? "exporter";
      const notes =
        f.status === "FINANCED"
          ? [
              `The facility is FINANCED: the contract allows cancellation only 14 days after funding (CancelNotAllowed before that). The financier's ${usdg(f.committed)} deposit is then returned.`,
            ]
          : ["The facility is CREATED (not funded yet), so it cancels at once."];
      notes.push("After cancellation the shipment is CANCELLED and cannot be financed again under this facility. Contracts v2 and earlier have no cancelFacility (the call would revert).");
      return render(ctx, {
        action: "Cancel the facility before transit",
        shipment: v.shipment,
        signer: { role, address: role === "exporter" ? f.exporter : f.financier },
        steps: [{ label: "Cancel the facility (FinancingController.cancelFacility)", tx: contracts.prepareCancelFacility(addrs, { shipmentId: sid }) }],
        notes,
        portal: role === "exporter" ? "exporter" : "financier",
      });
    }),
  );

  server.registerTool(
    "prepare_trigger_parametric",
    {
      title: "Prepare: trigger parametric cover",
      description:
        "Prepare CoverPool.triggerParametric (contracts v3): when an accepted parametric cover's condition is met (N consecutive committed, non-compliant evidence epochs after acceptance), anyone can trigger the payout without waiting for a default. Picks the newest run of N consecutive failed committed epochs (or uses the epoch ids given) and checks their commit order on chain when the RPC is reachable.",
      inputSchema: {
        shipmentId,
        epochIds: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).max(32).optional().describe("The consecutive failed epoch ids, oldest first; default chosen from get_evidence."),
      },
      annotations: PREPARE,
    },
    safe(async ({ shipmentId: id, epochIds }) => {
      const { v, addrs, sid } = await load(ctx, id);
      if (!addrs.coverPool) throw new Refusal("This CargoFlow deployment has no CoverPool, so there is no parametric cover to trigger.");
      facilityIn(v, ["ACTIVE", "PAUSED", "DISPUTED"], "have its parametric cover triggered");
      const cover = await ctx.client.shipments.cover(id);
      const cv = cover.cover;
      if (!cv) throw new Refusal("This shipment has no accepted cover.");
      if (cv.status !== "ACTIVE") throw new Refusal(`The cover is ${cv.status}; only an ACTIVE cover can be triggered.`);
      const terms = cv.parametric;
      if (!terms || !terms.consecutiveFailedEpochs) throw new Refusal("The accepted cover is plain default cover, not parametric; it pays out only on a default (claim).");
      const n = terms.consecutiveFailedEpochs;
      let ids: Hex[];
      let picked = "";
      if (epochIds?.length) {
        if (epochIds.length !== n) throw new Refusal(`This cover triggers on exactly ${n} consecutive failed epochs; ${epochIds.length} were given (TriggerNotMet).`);
        ids = epochIds.map((e) => e.toLowerCase() as Hex);
      } else {
        const committed = (await ctx.client.shipments.epochs(id)).epochs
          .filter((e) => !!e.commitTx)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence);
        let run: typeof committed = [];
        let best: typeof committed = [];
        for (const e of committed) {
          run = e.compliant ? [] : [...run, e];
          if (run.length >= n) best = run.slice(-n);
        }
        if (best.length < n) {
          const failing = committed.filter((e) => !e.compliant).length;
          throw new Refusal(`The trigger needs ${n} consecutive committed non-compliant epochs; none such run exists yet (${committed.length} committed, ${failing} non-compliant). The cover stays active.`);
        }
        ids = best.map((e) => e.epochId as Hex);
        picked = `Epochs ${best.map((e) => `seq ${e.sequence} (score ${e.score}, ${e.decisionAction})`).join(", ")}.`;
      }
      const notes = [
        `Terms: ${n} consecutive failed epochs; up to ${usdg(cv.amount)} pays the financier's outstanding principal, ${usdg(terms.salvageToExporter)} salvage to the exporter from what is left, the rest back to the insurer.`,
      ];
      if (picked) notes.push(picked);
      try {
        const ords = await Promise.all(
          ids.map((e) => ctx.client.publicClient().readContract({ address: addrs.evidenceRegistry, abi: contracts.evidenceRegistryAbi, functionName: "epochOrdinal", args: [e] })),
        );
        const nums = ords.map((o) => Number(o));
        const consecutive = nums.every((x, i) => i === 0 || x === nums[0]! + i);
        const floor = terms.epochFloor ?? 0;
        if (!consecutive) throw new Refusal(`Those epochs are not consecutive in the shipment's commit order (ordinals ${nums.join(", ")}), so the contract would revert (TriggerNotMet).`);
        if (nums[0]! <= floor) throw new Refusal(`The first epoch (ordinal ${nums[0]}) was committed before the cover was accepted (floor ${floor}); the contract would revert (TriggerNotMet).`);
        notes.push(`Checked on chain: ordinals ${nums.join(", ")} are consecutive and after the acceptance floor ${floor}.`);
      } catch (e) {
        if (e instanceof Refusal) throw e;
        notes.push("Could not read the epochs' commit order on chain (RPC unavailable); the contract checks it and reverts with TriggerNotMet if the run is not consecutive.");
      }
      return render(ctx, {
        action: `Trigger parametric cover (${usdg(cv.amount)})`,
        shipment: v.shipment,
        signer: { role: "financier", address: `${cv.financier} (anyone may send it)` },
        steps: [{ label: `Trigger the parametric cover with ${n} failed epoch(s) (CoverPool.triggerParametric)`, tx: contracts.prepareTriggerParametric(addrs, { shipmentId: sid, epochIds: ids }) }],
        notes,
        portal: "financier",
      });
    }),
  );
}

