"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { isAddress, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { readContract } from "wagmi/actions";
import { Button, LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { HashBadge } from "@/components/ui/HashBadge";
import { Stepper } from "@/components/ui/Stepper";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiPost } from "@/lib/api/client";
import { MirrorResult } from "@/lib/api/schemas";
import { controllerAbi, policiesAbi, registryAbi } from "@/lib/chain/abis";
import { wagmiConfig, type SupportedChainId } from "@/lib/chain/config";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { buildMilestones, buildPolicy, defaultPolicyForm, ROUTES, routeCommitment, validatePolicy, type PolicyForm } from "@/lib/exporter";
import { formatUSDG } from "@/lib/format";

const steps = [
  { id: "details", label: "Shipment" },
  { id: "policy", label: "Cold-chain policy" },
  { id: "facility", label: "Financing" },
  { id: "sign", label: "Sign" },
];

type Details = { ref: string; buyer: string; invoice: string; route: string };
type FacilityForm = { financier: string; total: string; count: string; feePct: string };
type Progress = { id?: Hex; registered?: Hex | "done"; policy?: Hex | "done"; facility?: Hex | "done"; mirrored?: boolean };

const usdg = (v: string) => {
  try {
    return v.trim() ? parseUnits(v.trim().replace(/,/g, ""), 6) : undefined;
  } catch {
    return undefined;
  }
};

export function ExporterWizard() {
  const { address } = useAccount();
  const { contracts, chainId } = useContracts();
  const { send, pending } = useTx();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Details>({ ref: "", buyer: "", invoice: "", route: ROUTES[0]!.id });
  const [p, setP] = useState<PolicyForm>(defaultPolicyForm);
  const [f, setF] = useState<FacilityForm>({ financier: "", total: "", count: "5", feePct: "3" });
  const [prog, setProg] = useState<Progress>({});
  const [running, setRunning] = useState(false);
  const [touched, setTouched] = useState(false);

  // --- validation
  const invoice = usdg(d.invoice);
  const total = usdg(f.total);
  const feeBps = Math.round(Number(f.feePct) * 100);
  const count = Number(f.count);
  const detailErr = {
    ref: !d.ref.trim() ? "Give the shipment a reference, for example CF-2026-SG02." : d.ref.length > 64 ? "Keep it under 64 characters." : null,
    buyer: !isAddress(d.buyer) ? "Enter the buyer's wallet address (0x…)." : address && d.buyer.toLowerCase() === address.toLowerCase() ? "The buyer must be a different wallet from yours." : null,
    invoice: !invoice || invoice <= 0n ? "Enter the invoice value in USDG." : null,
  };
  const policyErr = validatePolicy(p);
  const fee = total !== undefined ? (total * BigInt(Math.max(feeBps, 0))) / 10_000n : 0n;
  const facilityErr = {
    financier: !isAddress(f.financier)
      ? "Enter the financier's wallet address (0x…)."
      : [address, d.buyer].some((a) => a && a.toLowerCase() === f.financier.toLowerCase())
        ? "The financier must differ from you and from the buyer."
        : null,
    total: !total || total <= 0n ? "Enter how much capital to raise." : invoice !== undefined && total + fee > invoice ? `The invoice (${formatUSDG(invoice)} USDG) must cover the facility plus its fee.` : null,
    count: !Number.isInteger(count) || count < 1 || count > 8 ? "Use 1 to 8 milestones." : null,
    feePct: f.feePct.trim() === "" || !Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000 ? "Use a fee from 0% to 10%." : null,
  };
  const valid = [Object.values(detailErr).every((e) => !e), Object.keys(policyErr).length === 0, Object.values(facilityErr).every((e) => !e)];
  const next = () => {
    setTouched(true);
    if (valid[step]) {
      setTouched(false);
      setStep((s) => s + 1);
    }
  };

  // --- signing: each step reads the chain first, so a half-finished run resumes instead of reverting
  const submit = async () => {
    if (!contracts || !address) {
      toast({ tone: "alert", title: "The network configuration has not loaded", body: "Check that the CargoFlow backend is reachable, then try again." });
      return;
    }
    if (!invoice || !total) return;
    setRunning(true);
    const cid = chainId as SupportedChainId;
    const route = ROUTES.find((r) => r.id === d.route)!.points;
    const ref = d.ref.trim();
    const refHash = keccak256(toBytes(ref));
    const policy = buildPolicy(p);
    try {
      const id = (await readContract(wagmiConfig, { address: contracts.registry, abi: registryAbi, functionName: "shipmentIdFor", args: [address, refHash], chainId: cid })) as Hex;
      setProg((x) => ({ ...x, id }));
      const commitment = (await readContract(wagmiConfig, { address: contracts.policies, abi: policiesAbi, functionName: "hashPolicy", args: [policy], chainId: cid })) as Hex;

      const sh = (await readContract(wagmiConfig, { address: contracts.registry, abi: registryAbi, functionName: "getShipment", args: [id], chainId: cid }).catch(() => null)) as
        | { exists: boolean; buyer: Address; invoiceValue: bigint; routeCommitment: Hex; policyCommitment: Hex }
        | null;
      if (sh?.exists) {
        // this reference is already registered by this wallet: continue only if it is the same shipment
        const same =
          sh.buyer.toLowerCase() === d.buyer.toLowerCase() && sh.invoiceValue === invoice &&
          sh.routeCommitment.toLowerCase() === routeCommitment(route).toLowerCase() && sh.policyCommitment.toLowerCase() === commitment.toLowerCase();
        if (!same) {
          toast({ tone: "danger", title: "This reference is already used for a different shipment", body: "Pick a new reference. On-chain shipments cannot be changed once registered." });
          return;
        }
        setProg((x) => ({ ...x, registered: "done" }));
      }
      else {
        const h = await send({
          address: contracts.registry, abi: registryAbi, functionName: "registerShipment",
          args: [refHash, d.buyer as Address, keccak256(toBytes(`invoice:${ref}:${invoice}`)), routeCommitment(route), commitment, invoice],
          label: "Register shipment", successTitle: "Shipment registered on-chain",
        });
        if (!h) return;
        setProg((x) => ({ ...x, registered: h }));
      }

      const isSet = (await readContract(wagmiConfig, { address: contracts.policies, abi: policiesAbi, functionName: "isSet", args: [id], chainId: cid })) as boolean;
      if (isSet) setProg((x) => ({ ...x, policy: "done" }));
      else {
        const h = await send({ address: contracts.policies, abi: policiesAbi, functionName: "setPolicy", args: [id, policy], label: "Set policy", successTitle: "Cold-chain policy set" });
        if (!h) return;
        setProg((x) => ({ ...x, policy: h }));
      }

      const exists = await readContract(wagmiConfig, { address: contracts.controller, abi: controllerAbi, functionName: "getFacility", args: [id], chainId: cid }).then(() => true, () => false);
      if (exists) setProg((x) => ({ ...x, facility: "done" }));
      else {
        const h = await send({
          address: contracts.controller, abi: controllerAbi, functionName: "createFacility",
          args: [id, f.financier as Address, feeBps, buildMilestones(total, count, Number(p.minScore), ref)],
          label: "Open facility", successTitle: "Financing facility opened",
        });
        if (!h) return;
        setProg((x) => ({ ...x, facility: h }));
      }

      try {
        await apiPost("/v1/shipments/mirror", { shipmentId: id, externalRef: ref, route, maxGapSec: 1800, minSensors: 2 }, MirrorResult);
        setProg((x) => ({ ...x, mirrored: true }));
        await qc.invalidateQueries({ queryKey: ["shipments"] });
      } catch (e) {
        toast({ tone: "alert", title: "On-chain steps are done, but the backend has not picked the shipment up yet", body: e instanceof ApiError ? e.message : undefined });
      }
    } catch (e) {
      toast({ tone: "danger", title: "Could not read the chain", body: e instanceof Error ? e.message.split("\n")[0] : undefined });
    } finally {
      setRunning(false);
    }
  };

  const done = prog.mirrored && prog.id;
  const err = (e: string | null | undefined) => (touched ? e : null);
  return (
    <Card padded className="md:p-8">
      <Stepper steps={steps} current={done ? steps.length : step} />
      <div className="mt-8">
        {step === 0 && (
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Shipment reference" value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} placeholder="CF-2026-SG02" hint="Your own reference. With your wallet it fixes the shipment's on-chain id." error={err(detailErr.ref)} />
            <Field label="Buyer address" value={d.buyer} onChange={(e) => setD({ ...d, buyer: e.target.value })} placeholder="0x…" hint="The buyer confirms delivery and pays the invoice." error={err(detailErr.buyer)} className="font-mono" />
            <Field label="Invoice value (USDG)" value={d.invoice} onChange={(e) => setD({ ...d, invoice: e.target.value })} inputMode="decimal" placeholder="100000" suffix="USDG" error={err(detailErr.invoice)} />
            <div>
              <label htmlFor="route" className="mb-1.5 block text-sm font-semibold">Route</label>
              <select id="route" value={d.route} onChange={(e) => setD({ ...d, route: e.target.value })} className="h-[3.25rem] w-full rounded-2xl border-2 border-line bg-white px-4 outline-none focus:border-ink">
                {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <p className="mt-1.5 text-sm text-slate">Committed on-chain; deviating from it lowers the evidence score.</p>
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <p className="mb-5 max-w-2xl text-slate">These limits are hashed at registration and frozen once set. The contract checks every release against them.</p>
            <div className="grid gap-5 md:grid-cols-3">
              <Field label="Minimum temperature" value={p.minTemp} onChange={(e) => setP({ ...p, minTemp: e.target.value })} inputMode="decimal" suffix="°C" error={err(policyErr.minTemp)} />
              <Field label="Maximum temperature" value={p.maxTemp} onChange={(e) => setP({ ...p, maxTemp: e.target.value })} inputMode="decimal" suffix="°C" error={err(policyErr.maxTemp)} />
              <Field label="Evidence freshness" value={p.maxAgeMin} onChange={(e) => setP({ ...p, maxAgeMin: e.target.value })} inputMode="numeric" suffix="min" hint="Older evidence cannot release capital." error={err(policyErr.maxAgeMin)} />
              <Field label="Minimum evidence score" value={p.minScore} onChange={(e) => setP({ ...p, minScore: e.target.value })} inputMode="numeric" suffix="/ 100" error={err(policyErr.minScore)} />
              <Field label="Maximum sensor conflict" value={p.maxConflictPct} onChange={(e) => setP({ ...p, maxConflictPct: e.target.value })} inputMode="decimal" suffix="%" hint="How much the probes may disagree." error={err(policyErr.maxConflictPct)} />
              <Field label="Maximum risk" value={p.maxRiskPct} onChange={(e) => setP({ ...p, maxRiskPct: e.target.value })} inputMode="decimal" suffix="%" error={err(policyErr.maxRiskPct)} />
              <Field label="Allowed route deviation" value={p.maxDeviationKm} onChange={(e) => setP({ ...p, maxDeviationKm: e.target.value })} inputMode="decimal" suffix="km" error={err(policyErr.maxDeviationKm)} />
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Financier address" value={f.financier} onChange={(e) => setF({ ...f, financier: e.target.value })} placeholder="0x…" hint="The financier deposits the capital into escrow." error={err(facilityErr.financier)} className="font-mono" />
            <Field label="Total facility (USDG)" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} inputMode="decimal" placeholder="40000" suffix="USDG" error={err(facilityErr.total)} />
            <Field label="Milestones" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} inputMode="numeric" hint={total && Number.isInteger(count) && count > 0 ? `${count} tranches of about ${formatUSDG(total / BigInt(count))} USDG` : undefined} error={err(facilityErr.count)} />
            <Field label="Financing fee" value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} inputMode="decimal" suffix="%" hint={total ? `${formatUSDG(fee)} USDG if fully drawn` : undefined} error={err(facilityErr.feePct)} />
          </div>
        )}
        {step === 3 && (
          <div>
            <dl className="grid gap-4 rounded-2xl bg-ink/4 p-5 text-sm md:grid-cols-4">
              <div><dt className="text-slate">Reference</dt><dd className="font-semibold break-all">{d.ref}</dd></div>
              <div><dt className="text-slate">Invoice</dt><dd className="font-mono font-semibold">{invoice ? formatUSDG(invoice) : "–"} USDG</dd></div>
              <div><dt className="text-slate">Facility</dt><dd className="font-mono font-semibold">{total ? formatUSDG(total) : "–"} USDG in {count}</dd></div>
              <div><dt className="text-slate">Band</dt><dd className="font-semibold">{p.minTemp} to {p.maxTemp} °C</dd></div>
            </dl>
            <ol className="mt-6 flex flex-col gap-3">
              {[
                ["Register the shipment", prog.registered],
                ["Set the cold-chain policy", prog.policy],
                ["Open the financing facility", prog.facility],
              ].map(([label, s]) => (
                <li key={label as string} className="flex flex-wrap items-center gap-3">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${s ? "bg-verified text-white" : "bg-ink/8 text-slate"}`}>{s ? "✓" : "·"}</span>
                  <span className="font-semibold">{label}</span>
                  {s && s !== "done" && <HashBadge value={s as string} kind="tx" chainId={chainId} />}
                  {s === "done" && <span className="text-sm text-slate">already on-chain</span>}
                </li>
              ))}
              <li className="flex items-center gap-3">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${prog.mirrored ? "bg-verified text-white" : "bg-ink/8 text-slate"}`}>{prog.mirrored ? "✓" : "·"}</span>
                <span className="font-semibold">Start tracking evidence for it</span>
              </li>
            </ol>
            {done ? (
              <div className="mt-6 rounded-2xl bg-verified/12 p-5">
                <p className="font-display text-xl font-semibold">Your shipment is ready for funding</p>
                <p className="mt-1 text-ink/75">Share the dashboard with your financier. Once they deposit, start transit from the dashboard.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <LinkButton href={`/track/${prog.id}`}>View dashboard</LinkButton>
                  <Button variant="secondary" onClick={() => { setStep(0); setProg({}); setD({ ...d, ref: "" }); }}>Register another</Button>
                </div>
              </div>
            ) : (
              <p className="mt-6 text-sm text-slate">You will sign up to three transactions. Each step checks the chain first, so you can safely retry if one fails.</p>
            )}
          </div>
        )}
      </div>
      {!done && (
        <div className="mt-8 flex flex-wrap justify-between gap-3 border-t border-line pt-6">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || running}>Back</Button>
          {step < 3 ? <Button onClick={next}>Continue</Button> : <Button onClick={submit} loading={running || pending}>Sign and submit</Button>}
        </div>
      )}
    </Card>
  );
}

export function MyShipments({ list }: { list: { id: string; externalRef: string; status: string }[] }) {
  if (list.length === 0) return <p className="text-slate">Shipments you register appear here.</p>;
  return (
    <ul className="divide-y divide-line">
      {list.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-3">
          <Link href={`/track/${s.id}`} className="font-semibold hover:underline">{s.externalRef}</Link>
          <span className="text-sm text-slate">{s.status.charAt(0) + s.status.slice(1).toLowerCase()}</span>
        </li>
      ))}
    </ul>
  );
}
