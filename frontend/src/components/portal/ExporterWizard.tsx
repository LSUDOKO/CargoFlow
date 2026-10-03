"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { isAddress, keccak256, parseUnits, toBytes, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { readContract } from "wagmi/actions";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Banner";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyField } from "@/components/ui/CopyField";
import { cx } from "@/components/ui/cx";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { CastEmptyState } from "@/components/cast/CastEmptyState";
import { Field } from "@/components/ui/Field";
import { KeyValue } from "@/components/ui/KeyValue";
import { StatusPill } from "@/components/ui/Pill";
import { RoutePlanner } from "@/components/map/RoutePlanner";
import { Stepper } from "@/components/ui/Stepper";
import { Timeline, type TimelineItem } from "@/components/ui/Timeline";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiPost } from "@/lib/api/client";
import { MirrorResult } from "@/lib/api/schemas";
import { controllerAbi, policiesAbi, registryAbi } from "@/lib/chain/abis";
import { wagmiConfig, type SupportedChainId } from "@/lib/chain/config";
import { useContracts } from "@/lib/chain/contracts";
import { useTx } from "@/lib/chain/useTx";
import { usePaused } from "@/lib/chain/v3";
import { PausedBanner } from "@/components/shipment/PausedBanner";
import { buildMilestones, buildPolicy, defaultPolicyForm, fileKeccak, NO_LIMIT, routeCommitment, textInvoiceHash, validatePolicy, type PolicyForm } from "@/lib/exporter";
import { formatUSDG } from "@/lib/format";
import { LANES, routeFromLane, type PlannedRoute } from "@/lib/geo/lanes";
import { findPort } from "@/lib/geo/ports";
import { formatKm } from "@/lib/geo/route";
import { placeErrors, placeLabelsFor, placePhrase, toPlaceSpec, type PlaceDraft } from "@/lib/places";
import { limitsText, matchTemplate, TEMPLATES } from "@/lib/templates";
import { MilestonePlaces } from "./MilestonePlaces";

const steps = [
  { id: "details", label: "Shipment", description: "Reference, buyer and invoice" },
  { id: "policy", label: "Cold-chain policy", description: "Temperature band and probes" },
  { id: "facility", label: "Financing", description: "Financier and milestones" },
  { id: "sign", label: "Sign", description: "Review and submit on chain" },
];

type InvoiceFile = { name: string; size: number; hash: Hex };
type Details = { ref: string; buyer: string; invoice: string; route: PlannedRoute; file: InvoiceFile | null };
type FacilityForm = { mode: "facility" | "market"; financier: string; total: string; count: string; feePct: string };
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
  const paused = usePaused();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Details>({ ref: "", buyer: "", invoice: "", route: routeFromLane(LANES[0]!), file: null });
  const [p, setP] = useState<PolicyForm>(defaultPolicyForm);
  const [f, setF] = useState<FacilityForm>({ mode: "facility", financier: "", total: "", count: "5", feePct: "3" });
  // milestone places by index (contracts v2); none by default, so every milestone may release anywhere
  const [places, setPlaces] = useState<(PlaceDraft | null)[]>([]);
  const [fileState, setFileState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const fileInput = useId();
  const [prog, setProg] = useState<Progress>({});
  const [running, setRunning] = useState(false);
  const [touched, setTouched] = useState(false);
  // fields the person has left: their errors show inline before Continue is pressed
  const [blurred, setBlurred] = useState<Set<string>>(() => new Set());
  const leave = (k: string) => () => setBlurred((b) => (b.has(k) ? b : new Set(b).add(k)));

  // --- validation
  const invoice = usdg(d.invoice);
  const total = usdg(f.total);
  const feeBps = Math.round(Number(f.feePct) * 100);
  const count = Number(f.count);
  const detailErr = {
    ref: !d.ref.trim() ? "Give the shipment a reference, for example CF-2026-SG02." : d.ref.length > 64 ? "Keep it under 64 characters." : null,
    buyer: !isAddress(d.buyer) ? "Enter the buyer's wallet address (0x…)." : address && d.buyer.toLowerCase() === address.toLowerCase() ? "The buyer must be a different wallet from yours." : null,
    invoice: !invoice || invoice <= 0n ? "Enter the invoice value in USDG." : null,
    route:
      d.route.status === "ready" && d.route.points.length > 1
        ? null
        : d.route.status === "planning"
          ? "Wait for the sea route to finish generating."
          : d.route.status === "error"
            ? (d.route.error ?? "The sea route could not be generated; pick other ports.")
            : "Choose an origin and a destination port.",
    file: fileState.busy ? "Wait for the invoice document to finish hashing." : null,
  };
  const policyErr = validatePolicy(p);
  const activePlaces = Number.isInteger(count) && count > 0 ? Array.from({ length: Math.min(count, 8) }, (_, i) => places[i] ?? null) : [];
  const fee = total !== undefined ? (total * BigInt(Math.max(feeBps, 0))) / 10_000n : 0n;
  const market = f.mode === "market";
  const facilityErr = market ? {} : {
    financier: !isAddress(f.financier)
      ? "Enter the financier's wallet address (0x…)."
      : [address, d.buyer].some((a) => a && a.toLowerCase() === f.financier.toLowerCase())
        ? "The financier must differ from you and from the buyer."
        : null,
    total: !total || total <= 0n ? "Enter how much capital to raise." : invoice !== undefined && total + fee > invoice ? `The invoice (${formatUSDG(invoice)} USDG) must cover the facility plus its fee.` : null,
    count: !Number.isInteger(count) || count < 1 || count > 8 ? "Use 1 to 8 milestones." : null,
    feePct: f.feePct.trim() === "" || !Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000 ? "Use a fee from 0% to 10%." : null,
    places: activePlaces.some((pl) => pl && Object.keys(placeErrors(pl)).length) ? "Check the milestone places: each needs a radius from 1 to 1,000 km and a plain name." : null,
  };
  const fe = facilityErr as Partial<Record<"financier" | "total" | "count" | "feePct" | "places", string | null>>;
  const valid = [Object.values(detailErr).every((e) => !e), Object.keys(policyErr).length === 0, Object.values(fe).every((e) => !e)];
  const next = () => {
    setTouched(true);
    if (valid[step]) {
      setTouched(false);
      setBlurred(new Set());
      setStep((s) => s + 1);
    }
  };

  // --- signing: each step reads the chain first, so a half-finished run resumes instead of reverting
  const submit = async () => {
    if (!contracts || !address) {
      toast({ tone: "alert", title: "The network configuration has not loaded", body: "Check that the CargoFlow backend is reachable, then try again." });
      return;
    }
    if (!invoice || (!market && !total)) return;
    setRunning(true);
    const cid = chainId as SupportedChainId;
    const route = d.route.points;
    const ref = d.ref.trim();
    const refHash = keccak256(toBytes(ref));
    const policy = buildPolicy(p);
    // an attached invoice document is fingerprinted in the browser; without one the hash derives from ref and amount
    const invoiceHash = d.file?.hash ?? textInvoiceHash(ref, invoice);
    try {
      const id = (await readContract(wagmiConfig, { address: contracts.registry, abi: registryAbi, functionName: "shipmentIdFor", args: [address, refHash], chainId: cid })) as Hex;
      setProg((x) => ({ ...x, id }));
      const commitment = (await readContract(wagmiConfig, { address: contracts.policies, abi: policiesAbi, functionName: "hashPolicy", args: [policy], chainId: cid })) as Hex;

      const sh = (await readContract(wagmiConfig, { address: contracts.registry, abi: registryAbi, functionName: "getShipment", args: [id], chainId: cid }).catch(() => null)) as
        | { exists: boolean; buyer: Address; invoiceHash: Hex; invoiceValue: bigint; routeCommitment: Hex; policyCommitment: Hex }
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
        if (sh.invoiceHash.toLowerCase() !== invoiceHash.toLowerCase()) {
          toast({
            tone: "danger",
            title: "This reference is registered with a different invoice",
            body: d.file ? "The attached document does not match the invoice hash on chain. Attach the original file, or pick a new reference." : "It was registered with an invoice document. Attach the same file to continue, or pick a new reference.",
          });
          return;
        }
        setProg((x) => ({ ...x, registered: "done" }));
      }
      else {
        const h = await send({
          address: contracts.registry, abi: registryAbi, functionName: "registerShipment",
          args: [refHash, d.buyer as Address, invoiceHash, routeCommitment(route), commitment, invoice],
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
      else if (market) {
        // no facility yet: financiers make offers on the market, and the facility is opened with the chosen one
      } else if (total && paused.controller) {
        // the guardian has paused new facilities: register and set the policy now, open the facility later
        toast({ tone: "alert", title: "Shipment registered; the facility waits", body: "New facilities are paused by the protocol guardian. Open the facility once the pause is lifted." });
      } else if (total) {
        const h = await send({
          address: contracts.controller, abi: controllerAbi, functionName: "createFacility",
          args: [id, f.financier as Address, feeBps, buildMilestones(total, count, Number(p.minScore), ref, activePlaces)],
          label: "Open facility", successTitle: "Financing facility opened",
        });
        if (!h) return;
        setProg((x) => ({ ...x, facility: h }));
      }

      try {
        // place names are display-only and posted with the mirror (the places themselves are read from the chain)
        const placeLabels = market ? [] : placeLabelsFor(activePlaces, count);
        await apiPost("/v1/shipments/mirror", { shipmentId: id, externalRef: ref, route, maxGapSec: 1800, minSensors: 2, ...(placeLabels.length ? { placeLabels } : {}) }, MirrorResult);
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

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setFileState({ busy: true, error: null });
    try {
      const hash = await fileKeccak(file);
      setD((x) => ({ ...x, file: { name: file.name, size: file.size, hash } }));
      setFileState({ busy: false, error: null });
    } catch (e) {
      setFileState({ busy: false, error: e instanceof Error ? e.message : "The file could not be read." });
    }
  };

  const done = prog.mirrored && prog.id;
  const err = (e: string | null | undefined, k?: string) => (touched || (k && blurred.has(k)) ? e : null);
  const template = matchTemplate(p);
  const routeNames = d.route.ports.map((c) => findPort(c)?.name ?? c).join(" → ");
  const legend = "mb-4 font-display text-h4";
  const choice = (on: boolean) =>
    cx(
      "rounded-tile border p-4 text-left transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
      on ? "border-ink bg-ink text-paper shadow-1" : "border-border-strong bg-surface hover:border-neutral-400 hover:shadow-1",
    );
  const steps4: [string, Progress["registered"]][] = [
    ["Register the shipment", prog.registered],
    ["Set the cold-chain policy", prog.policy],
    ...(market ? [] : ([["Open the financing facility", prog.facility]] as [string, Progress["registered"]][])),
  ];
  const firstOpen = steps4.findIndex(([, st]) => !st);
  const signItems: TimelineItem[] = [
    ...steps4.map(([label, st], i): TimelineItem => ({
      id: label,
      title: label,
      state: st ? "done" : running && i === firstOpen ? "active" : "pending",
      description: st === "done" ? "Already on chain" : undefined,
      meta: st && st !== "done" ? <CopyField value={st} kind="tx" chainId={chainId} size="sm" label="Transaction" /> : undefined,
    })),
    { id: "track", title: "Start tracking evidence for it", state: prog.mirrored ? "done" : running && firstOpen === -1 ? "active" : "pending" },
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-12">
      <Card padded="lg" className="lg:col-span-8">
        <Stepper steps={steps} current={done ? steps.length : step} label="Registration steps" />
        <div className="mt-8 border-t border-border pt-8">
          {step === 0 && (
            <div className="flex flex-col gap-10">
              <fieldset>
                <legend className={legend}>Shipment and buyer</legend>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Shipment reference" value={d.ref} onChange={(e) => setD({ ...d, ref: e.target.value })} onBlur={leave("ref")} placeholder="CF-2026-SG02" hint="Your own reference. With your wallet it fixes the shipment's on-chain id." error={err(detailErr.ref, "ref")} autoComplete="off" />
                  <Field label="Invoice value (USDG)" value={d.invoice} onChange={(e) => setD({ ...d, invoice: e.target.value })} onBlur={leave("invoice")} inputMode="decimal" placeholder="100000" suffix="USDG" hint="What the buyer pays at delivery." error={err(detailErr.invoice, "invoice")} />
                  <Field label="Buyer address" value={d.buyer} onChange={(e) => setD({ ...d, buyer: e.target.value })} onBlur={leave("buyer")} placeholder="0x…" hint="The buyer confirms delivery and pays the invoice." error={err(detailErr.buyer, "buyer")} className="md:col-span-2" inputClassName="font-mono" spellCheck={false} autoComplete="off" />
                </div>
              </fieldset>
              <fieldset>
                <legend className={legend}>Invoice document <span className="font-sans text-xs font-normal text-text-muted">Optional</span></legend>
                {d.file ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-tile border border-border bg-surface-sunken px-4 py-3 text-sm">
                    <span className="min-w-0 truncate font-semibold">{d.file.name}</span>
                    <span className="num text-text-muted">{(d.file.size / 1024).toLocaleString("en-US", { maximumFractionDigits: 0 })} KB</span>
                    <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setD({ ...d, file: null })}>Remove file</Button>
                  </div>
                ) : (
                  <label htmlFor={fileInput} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-tile border border-dashed border-border-strong bg-neutral-25 px-4 py-3 text-sm transition-colors hover:border-ink/40">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-mist text-ink-500" aria-hidden="true">
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 11v2.5h11V11" /></svg>
                    </span>
                    <span>
                      <span className="block font-semibold">{fileState.busy ? "Fingerprinting…" : "Choose the invoice file"}</span>
                      <span className="block text-small text-text-muted">Hashed in your browser; the file is never uploaded.</span>
                    </span>
                  </label>
                )}
                <input id={fileInput} type="file" className="sr-only" aria-label="Invoice document" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
                {fileState.error ? (
                  <p className="mt-1.5 text-small font-medium text-danger-fg">{fileState.error}</p>
                ) : d.file ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-small text-text-muted">On-chain invoice hash <CopyField value={d.file.hash} kind="hash" size="sm" /></div>
                ) : (
                  <p className="mt-1.5 text-small text-text-muted">Without a file, the invoice hash derives from the reference and amount.</p>
                )}
              </fieldset>
              <fieldset>
                <legend className={legend}>Route</legend>
                <p className="-mt-2 mb-4 text-small text-text-muted">Committed on chain as waypoints; logger positions outside the corridor lower the evidence score.</p>
                <RoutePlanner value={d.route} onChange={(route) => setD((x) => ({ ...x, route }))} deviationKm={Number(p.maxDeviationKm) || 0} error={err(detailErr.route)} />
              </fieldset>
            </div>
          )}
          {step === 1 && (
            <div className="flex flex-col gap-10">
              <fieldset>
                <legend className={legend}>Cargo type {!template && <span className="font-sans text-xs font-normal text-text-muted">Custom limits</span>}</legend>
                <p className="-mt-2 mb-4 max-w-reading text-small text-text-muted">These limits are hashed at registration and frozen once set. The contract checks every release against them.</p>
                <div role="radiogroup" aria-label="Cargo type" className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  {TEMPLATES.map((t) => {
                    const on = template?.id === t.id;
                    return (
                      <button key={t.id} type="button" role="radio" aria-checked={on} title={t.note} onClick={() => setP(t.form)} className={choice(on)}>
                        <span className="block leading-snug font-semibold">{t.label}</span>
                        <span className={cx("num block text-sm font-semibold", on ? "text-signal" : "text-ink")}>{t.band}</span>
                        <span className={cx("mt-0.5 block text-caption", on ? "text-paper/75" : "text-text-muted")}>{limitsText(t.form)}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-small text-text-muted">{template ? template.note : "You have edited the limits; pick a cargo type to start again from its defaults."}</p>
              </fieldset>
              <fieldset>
                <legend className={legend}>Temperature and evidence</legend>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field label="Minimum temperature" value={p.minTemp} onChange={(e) => setP({ ...p, minTemp: e.target.value })} onBlur={leave("minTemp")} inputMode="decimal" suffix="°C" error={err(policyErr.minTemp, "minTemp")} />
                  <Field label="Maximum temperature" value={p.maxTemp} onChange={(e) => setP({ ...p, maxTemp: e.target.value })} onBlur={leave("maxTemp")} inputMode="decimal" suffix="°C" error={err(policyErr.maxTemp, "maxTemp")} />
                  <Field label="Evidence freshness" value={p.maxAgeMin} onChange={(e) => setP({ ...p, maxAgeMin: e.target.value })} onBlur={leave("maxAgeMin")} inputMode="numeric" suffix="min" hint="Older evidence cannot release capital." error={err(policyErr.maxAgeMin, "maxAgeMin")} />
                  <Field label="Minimum evidence score" value={p.minScore} onChange={(e) => setP({ ...p, minScore: e.target.value })} onBlur={leave("minScore")} inputMode="numeric" suffix="/ 100" error={err(policyErr.minScore, "minScore")} />
                  <Field label="Maximum sensor conflict" value={p.maxConflictPct} onChange={(e) => setP({ ...p, maxConflictPct: e.target.value })} onBlur={leave("maxConflictPct")} inputMode="decimal" suffix="%" hint="How much the probes may disagree." error={err(policyErr.maxConflictPct, "maxConflictPct")} />
                  <Field label="Maximum risk" value={p.maxRiskPct} onChange={(e) => setP({ ...p, maxRiskPct: e.target.value })} onBlur={leave("maxRiskPct")} inputMode="decimal" suffix="%" error={err(policyErr.maxRiskPct, "maxRiskPct")} />
                </div>
              </fieldset>
              <fieldset>
                <legend className={legend}>Route, humidity and shock</legend>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field label="Allowed route deviation" value={p.maxDeviationKm} onChange={(e) => setP({ ...p, maxDeviationKm: e.target.value })} onBlur={leave("maxDeviationKm")} inputMode="decimal" suffix="km" hint="The corridor either side of the route." error={err(policyErr.maxDeviationKm, "maxDeviationKm")} />
                  <LimitField label="Maximum humidity" unit="%" value={p.maxHumidityPct} onChange={(v) => setP({ ...p, maxHumidityPct: v })} fallback={template?.form.maxHumidityPct || defaultPolicyForm.maxHumidityPct} hint="Highest relative humidity in any batch." error={err(policyErr.maxHumidityPct)} />
                  <LimitField label="Maximum shock" unit="g" value={p.maxShockG} onChange={(v) => setP({ ...p, maxShockG: v })} fallback={template?.form.maxShockG || defaultPolicyForm.maxShockG} hint="Hardest knock any logger may record." error={err(policyErr.maxShockG)} />
                </div>
                <p className="mt-4 max-w-reading text-small text-text-muted">A batch above the humidity or shock limit fails the policy and pauses releases, like a temperature excursion. Only the arbiter, or fresh evidence, lifts such a pause: the temperature proof cannot.</p>
              </fieldset>
            </div>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-8">
              <fieldset>
                <legend className={legend}>How to finance it</legend>
                <div role="radiogroup" aria-label="How to finance this shipment" className="grid gap-3 md:grid-cols-2">
                  {([
                    ["facility", "I have a financier", "Name the financier and the facility now; they deposit into escrow from their portal."],
                    ["market", "Post to the market instead", "Register the shipment and its policy only, then ask financiers on the market for offers."],
                  ] as const).map(([mode, title, body]) => {
                    const on = f.mode === mode;
                    return (
                      <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => setF({ ...f, mode })} className={cx("rounded-tile border p-4 text-left transition-colors duration-(--duration-fast)", on ? "border-ink bg-surface shadow-1 ring-1 ring-ink" : "border-border-strong bg-surface hover:border-neutral-400")}>
                        <span className="flex items-center gap-2 font-semibold">
                          <span aria-hidden="true" className={cx("grid h-4 w-4 place-items-center rounded-full border-2", on ? "border-ink" : "border-border-strong")}>{on && <span className="h-2 w-2 rounded-full bg-ink" />}</span>
                          {title}
                        </span>
                        <span className="mt-1 block pl-6 text-small text-text-muted">{body}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {market ? (
                <Callout variant="info">After signing you can post a financing request for this shipment. Financiers see the route, the policy and your track record, and offer a fee; you pick one and open the facility with them.</Callout>
              ) : (
                <fieldset>
                  <legend className={legend}>Facility</legend>
                  <div className="grid gap-5 md:grid-cols-2">
                    <Field label="Financier address" value={f.financier} onChange={(e) => setF({ ...f, financier: e.target.value })} onBlur={leave("financier")} placeholder="0x…" hint="The financier deposits the capital into escrow." error={err(fe.financier, "financier")} className="md:col-span-2" inputClassName="font-mono" spellCheck={false} autoComplete="off" />
                    <Field label="Total facility (USDG)" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} onBlur={leave("total")} inputMode="decimal" placeholder="40000" suffix="USDG" error={err(fe.total, "total")} hint={invoice ? `Up to the invoice (${formatUSDG(invoice)} USDG) less the fee.` : undefined} />
                    <Field label="Financing fee" value={f.feePct} onChange={(e) => setF({ ...f, feePct: e.target.value })} onBlur={leave("feePct")} inputMode="decimal" suffix="%" hint={total ? `${formatUSDG(fee)} USDG if fully drawn` : "0% to 10%"} error={err(fe.feePct, "feePct")} />
                    <Field label="Milestones" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} onBlur={leave("count")} inputMode="numeric" hint={total && Number.isInteger(count) && count > 0 ? `${count} tranches of about ${formatUSDG(total / BigInt(count))} USDG` : "1 to 8 evidence-gated tranches"} error={err(fe.count, "count")} />
                  </div>
                  {Number.isInteger(count) && count >= 1 && count <= 8 && <MilestonePlaces count={count} route={d.route} places={places} onChange={setPlaces} showErrors={touched} />}
                  {err(fe.places) && <p className="mt-2 text-small font-medium text-danger-fg">{err(fe.places)}</p>}
                </fieldset>
              )}
            </div>
          )}
          {step === 3 && (
            <div className="flex flex-col gap-8">
              <section aria-labelledby="sign-review">
                <h3 id="sign-review" className={legend}>Review</h3>
                <KeyValue
                  layout="grid"
                  columns={2}
                  items={[
                    { label: "Reference", value: <span className="break-all">{d.ref}</span> },
                    { label: "Invoice", value: `${invoice ? formatUSDG(invoice) : "–"} USDG`, numeric: true },
                    { label: "Facility", value: market ? "From the market" : `${total ? formatUSDG(total) : "–"} USDG in ${count} tranches`, numeric: true },
                    { label: "Temperature band", value: `${p.minTemp} to ${p.maxTemp} °C${template ? ` (${template.label.toLowerCase()})` : ""}` },
                    { label: "Route", value: routeNames, hint: `About ${formatKm(d.route.distanceKm)}, ${d.route.points.length} waypoints, ±${p.maxDeviationKm} km` },
                    { label: "Humidity and shock", value: limitsText(p) },
                    { label: "Invoice hash", value: d.file ? "From the attached file" : "From reference and amount" },
                    ...(!market
                      ? [{
                          label: "Milestone places",
                          value: activePlaces.some(Boolean)
                            ? activePlaces.map((pl, i) => (pl ? `M${i + 1} ${placePhrase({ ...toPlaceSpec(pl), placeLabel: pl.label })}` : null)).filter(Boolean).join("; ")
                            : "None: each milestone releases wherever its evidence passes",
                        }]
                      : []),
                  ]}
                />
              </section>
              <section aria-labelledby="sign-steps">
                <h3 id="sign-steps" className={legend}>On chain</h3>
                <Timeline label="Signing progress" items={signItems} />
              </section>
              {done ? (
                <Callout
                  variant="success"
                  live="polite"
                  title={market && prog.facility !== "done" ? "Your shipment is registered: now find a financier" : "Your shipment is ready for funding"}
                >
                  <p>{market && prog.facility !== "done" ? "Post a financing request with the amount and the most you will pay; financiers answer with offers." : "Share the dashboard with your financier. Once they deposit, start transit from the dashboard."}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {market && prog.facility !== "done" && <LinkButton href={`/market/new?shipment=${prog.id}`} size="sm">Post a financing request</LinkButton>}
                    <LinkButton href={`/track/${prog.id}`} size="sm" variant={market && prog.facility !== "done" ? "secondary" : "primary"}>View dashboard</LinkButton>
                    <Button size="sm" variant="secondary" onClick={() => { setStep(0); setProg({}); setD({ ...d, ref: "", file: null }); }}>Register another</Button>
                  </div>
                </Callout>
              ) : (
                <p className="text-small text-text-muted">You will sign up to {market ? "two" : "three"} transactions. Each step checks the chain first, so you can safely retry if one fails.</p>
              )}
            </div>
          )}
        </div>
        {!done && step === 3 && !market && paused.controller && <PausedBanner className="mt-6" />}
        {!done && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || running}>Back</Button>
            <span className="num hidden text-small text-text-muted sm:inline">Step {step + 1} of {steps.length}</span>
            {step < 3 ? <Button onClick={next}>Continue</Button> : <Button onClick={submit} loading={running || pending}>Sign and submit</Button>}
          </div>
        )}
      </Card>
      <aside className="lg:sticky lg:top-24 lg:col-span-4" aria-label="Shipment summary">
        <Card>
          <CardHeader title="Summary" description="Updates as you fill in each step." as="h3" />
          <KeyValue
            dense
            items={[
              { label: "Reference", value: d.ref.trim() || "–" },
              { label: "Invoice", value: invoice ? `${formatUSDG(invoice)} USDG` : "–", numeric: true },
              { label: "Route", value: d.route.ports.length > 1 ? routeNames : "–" },
              { label: "Band", value: `${p.minTemp} to ${p.maxTemp} °C`, numeric: true },
              { label: "Min score", value: `${p.minScore} / 100`, numeric: true },
              { label: "Financing", value: market ? "Market" : total ? `${formatUSDG(total)} USDG` : "–", numeric: true },
              ...(!market && total ? [{ label: "Fee at full draw", value: `${formatUSDG(fee)} USDG`, numeric: true }] : []),
              ...(!market && total && invoice ? [{ label: "Exporter keeps", value: invoice >= total + fee ? `${formatUSDG(invoice - total - fee)} USDG` : "–", hint: "after repaying principal and fee", numeric: true }] : []),
            ]}
          />
        </Card>
      </aside>
    </div>
  );
}

/** An optional limit: a number, or "No limit" (an empty value, 0 on chain). Turning the limit back on restores `fallback`. */
function LimitField({ label, unit, value, onChange, fallback, hint, error }: { label: string; unit: string; value: string; onChange: (v: string) => void; fallback: string; hint: string; error?: string | null }) {
  const off = value.trim() === NO_LIMIT;
  const boxId = useId();
  return (
    <div>
      {off ? (
        <>
          <p className="mb-1.5 text-sm font-semibold">{label}</p>
          <div className="flex h-11 items-center rounded-control border border-dashed border-border-strong bg-neutral-25 px-3.5 text-sm text-text-muted">No limit</div>
        </>
      ) : (
        <Field label={label} value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" suffix={unit} error={error} />
      )}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-small">
        {!error || off ? <span className="text-text-muted">{hint}</span> : <span />}
        <label htmlFor={boxId} className="inline-flex cursor-pointer items-center gap-1.5 font-semibold">
          <input id={boxId} type="checkbox" className="h-4 w-4 accent-ink" checked={off} onChange={(e) => onChange(e.target.checked ? NO_LIMIT : fallback)} />
          No limit
        </label>
      </div>
    </div>
  );
}

type Mine = { id: string; externalRef: string; status: string; invoiceValue?: string; createdAt?: string };

/** The exporter's registered shipments as a table that links to each dashboard. */
export function MyShipments({ list, loading }: { list: Mine[]; loading?: boolean }) {
  if (!loading && list.length === 0) return <CastEmptyState who="meera" prop="tablet" size="sm" title="No shipments yet" description="Shipments you register appear here with their status and a link to the dashboard." />;
  const columns: Column<Mine>[] = [
    { key: "ref", header: "Shipment", primary: true, cell: (s) => s.externalRef },
    { key: "status", header: "Status", cell: (s) => <StatusPill status={s.status} /> },
    { key: "invoice", header: "Invoice", numeric: true, cell: (s) => (s.invoiceValue ? <>{formatUSDG(s.invoiceValue)} <span className="text-text-muted">USDG</span></> : "–") },
    { key: "created", header: "Registered", hideOnCard: true, cell: (s) => <span className="num text-text-muted">{s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–"}</span> },
  ];
  return (
    <Card padded={false} className="overflow-hidden max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none">
      <DataTable caption="Your shipments" columns={columns} rows={list} rowKey={(s) => s.id} rowHref={(s) => `/track/${s.id}`} loading={loading} loadingRows={3} />
    </Card>
  );
}
