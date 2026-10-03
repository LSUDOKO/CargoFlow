"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { WalletButton } from "@/components/wallet/WalletButton";
import { ApiError, apiPost } from "@/lib/api/client";
import { useGateways, useTelemetry } from "@/lib/api/hooks";
import { nowSec } from "@/lib/api/extras";
import { recoveryReady, useNotifications } from "@/lib/api/notifications";
import { RecoveryProof, type ShipmentView } from "@/lib/api/schemas";
import { controllerAbi } from "@/lib/chain/abis";
import { wagmiConfig } from "@/lib/chain/config";
import { useContracts } from "@/lib/chain/contracts";
import { signatureError } from "@/lib/chain/errors";
import { useTx } from "@/lib/chain/useTx";
import { recoveryAuthorizationMessage } from "@/lib/gateway";
import { useHydrated } from "@/lib/useHydrated";

const words = (p: RecoveryProof) => ({
  a: p.a.map(BigInt) as [bigint, bigint],
  b: p.b.map((r) => r.map(BigInt)) as [[bigint, bigint], [bigint, bigint]],
  c: p.c.map(BigInt) as [bigint, bigint],
});

/**
 * The exporter lifts a pause with zero-knowledge evidence: their wallet authorizes the proof, the backend commits the
 * probe's fresh readings and proves they sit inside the band (bound to the exporter's wallet), and the exporter's
 * wallet submits the proof on chain. The readings themselves are never revealed.
 */
export function RecoveryPanel({ view, focus }: { view: ShipmentView; focus?: boolean }) {
  const hydrated = useHydrated();
  const { address } = useAccount();
  const { contracts } = useContracts();
  const { send, pending } = useTx();
  const qc = useQueryClient();
  const gateways = useGateways(view.shipment.id);
  const telemetry = useTelemetry(view.shipment.id);
  const [sensor, setSensor] = useState("");
  const [stage, setStage] = useState<"sign" | "prove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // a proof is bound to the pause it was prepared for: once that pause ends (or a new one starts) it is stale
  const [held, setHeld] = useState<{ proof: RecoveryProof; sensor: string; pausedAt: number; pauseCount: number } | null>(null);
  const f = view.facility;
  const proof = held && f && held.pausedAt === f.pausedAt && held.pauseCount === f.pauseCount ? held.proof : null;

  const isExporter = hydrated && !!address && address.toLowerCase() === view.shipment.exporter.toLowerCase();
  // the recovery worker proved this pause already (RECOVERY_READY): one signature and one transaction resume it
  const notes = useNotifications(isExporter ? address : undefined);
  const ready = f?.status === "PAUSED" ? recoveryReady(notes.data?.notifications, view.shipment.id, f.pausedAt) : null;
  const readySensor = typeof ready?.data.sensorId === "string" ? ready.data.sensorId : "";
  // ?recover=1 (the notification's link): bring the panel into view and move focus to it
  const headingRef = useRef<HTMLHeadingElement>(null);
  const paused = f?.status === "PAUSED";
  useEffect(() => {
    if (!focus || !paused || !hydrated) return;
    const t = setTimeout(() => {
      headingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      headingRef.current?.focus({ preventScroll: true });
    }, 150);
    return () => clearTimeout(t);
  }, [focus, paused, hydrated, isExporter]);

  if (focus && paused && hydrated && !isExporter) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <h3 ref={headingRef} tabIndex={-1} className="font-semibold outline-none">Resume with a proof</h3>
        <p className="mt-1 text-sm text-text-muted">Connect the exporter&apos;s wallet ({view.shipment.exporter.slice(0, 8)}…) to review the recovery proof and sign.</p>
        <div className="mt-3"><WalletButton compact /></div>
      </div>
    );
  }
  if (!isExporter || !paused || !contracts || !f) return null;
  const pause = { pausedAt: f.pausedAt, pauseCount: f.pauseCount };

  const sensors = [...new Set([...(gateways.data?.sources ?? []).flatMap((g) => g.sensorIds), ...(telemetry.data?.epochs ?? []).flatMap((e) => e.sensors.map((s) => s.sensorId))])].sort();
  const chosen = sensor || sensors[0] || "";
  const id = view.shipment.id as `0x${string}`;

  async function prepare(then?: "submit") {
    const sensorId = then === "submit" && readySensor ? readySensor : chosen;
    if (!address || !sensorId || !f) return;
    setError(null);
    const issuedAt = nowSec();
    let signature: string;
    try {
      setStage("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: recoveryAuthorizationMessage(view.shipment.id, sensorId, address, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setStage(null);
      return;
    }
    try {
      setStage("prove");
      const p = await apiPost(`/v1/shipments/${view.shipment.id}/recovery`, { sensorId, submitter: address, issuedAt, signature }, RecoveryProof);
      setHeld({ proof: p, sensor: sensorId, ...pause });
      void qc.invalidateQueries(); // the recovery epoch is now committed
      setStage(null);
      if (then === "submit") await submit(p);
    } catch (err) {
      if (err instanceof ApiError && err.code === "not_recoverable") {
        setError(`${err.message.replace(/^.*?: /, "")}. Upload at least 8 in-range readings from ${sensorId} taken after the pause, then try again.`);
      } else setError(err instanceof ApiError ? err.message : "The proof could not be prepared.");
    } finally {
      setStage(null);
    }
  }

  async function submit(p: RecoveryProof) {
    if (!contracts) return;
    const { a, b, c } = words(p);
    const hash = await send({
      address: contracts.controller,
      abi: controllerAbi,
      functionName: "resumeWithProof",
      args: [id, p.milestoneIndex, p.sequence, a, b, c],
      label: "Submit recovery proof",
      successTitle: "Facility resumed by zero-knowledge proof",
    });
    if (hash) setHeld(null);
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold outline-none">Resume with a proof</h3>
      {/HUMIDITY_LIMIT|SHOCK_LIMIT/.test(f.pauseReason ?? "") && (
        <p className="mt-1 rounded-tile bg-alert/12 px-3 py-2 text-sm">
          This pause is for a humidity or shock breach. The proof covers only the temperature band, so it cannot lift this pause on its own: ask the arbiter to review it.
        </p>
      )}
      {ready && !proof && (
        <div className="mt-2 rounded-tile bg-verified/10 p-4 ring-1 ring-verified/30 ring-inset" role="status">
          <p className="flex items-center gap-2 font-display text-base font-semibold text-success-fg">
            <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-verified text-xs text-white">✓</span>
            Proof ready — sign to resume
          </p>
          <p className="mt-1 text-sm text-ink/80">
            CargoFlow&apos;s recovery worker already proved that {readySensor || "a probe"} has 8 fresh readings back inside the band. Sign once to commit it, then confirm one transaction to resume the facility.
          </p>
          <Button className="mt-3" loading={stage !== null || pending} onClick={() => void prepare("submit")}>
            {stage === "sign" ? "Waiting for your signature…" : stage === "prove" ? "Committing the proof…" : pending ? "Confirm in your wallet…" : "Sign and resume"}
          </Button>
        </div>
      )}
      {proof ? (
        <>
          <p className="mt-1 text-sm text-text-muted">
            The proof is ready: eight readings from {held?.sensor ?? chosen}, committed on chain and proven inside the band. Submit it from your wallet to resume the facility; then release milestone {proof.milestoneIndex + 1} above.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={pending} onClick={() => void submit(proof)}>Submit proof and resume</Button>
            <Button variant="ghost" disabled={pending} onClick={() => setHeld(null)}>Discard proof</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-text-muted">
            Choose a probe that kept the goods in range. Its 8 most recent readings since the pause are proven inside the band without revealing them.
          </p>
          {sensors.length === 0 ? (
            <p className="mt-2 text-sm font-medium">No probe has reported yet. Submit readings from a gateway first.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="recovery-probe" className="text-sm font-semibold">Probe</label>
                <select id="recovery-probe" className="mt-1 block h-11 rounded-tile border-2 border-line bg-white px-3 font-mono" value={chosen} onChange={(e) => setSensor(e.target.value)}>
                  {sensors.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <Button loading={stage !== null} onClick={() => void prepare()}>
                {stage === "sign" ? "Waiting for your signature…" : stage === "prove" ? "Proving, up to a minute…" : "Sign and prepare proof"}
              </Button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger-fg">{error}</p>}
    </div>
  );
}
