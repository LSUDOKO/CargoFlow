"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { Button } from "@/components/ui/Button";
import { ApiError, apiPost } from "@/lib/api/client";
import { useGateways, useTelemetry } from "@/lib/api/hooks";
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
export function RecoveryPanel({ view }: { view: ShipmentView }) {
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
  const [proof, setProof] = useState<RecoveryProof | null>(null);

  const isExporter = hydrated && !!address && address.toLowerCase() === view.shipment.exporter.toLowerCase();
  if (!isExporter || view.facility?.status !== "PAUSED" || !contracts) return null;

  const sensors = [...new Set([...(gateways.data?.sources ?? []).flatMap((g) => g.sensorIds), ...(telemetry.data?.epochs ?? []).flatMap((e) => e.sensors.map((s) => s.sensorId))])].sort();
  const chosen = sensor || sensors[0] || "";
  const id = view.shipment.id as `0x${string}`;

  async function prepare() {
    if (!address || !chosen) return;
    setError(null);
    const issuedAt = Math.floor(Date.now() / 1000);
    let signature: string;
    try {
      setStage("sign");
      signature = await signMessage(wagmiConfig, { account: address, message: recoveryAuthorizationMessage(view.shipment.id, chosen, address, issuedAt) });
    } catch (err) {
      setError(signatureError(err));
      setStage(null);
      return;
    }
    try {
      setStage("prove");
      setProof(await apiPost(`/v1/shipments/${view.shipment.id}/recovery`, { sensorId: chosen, submitter: address, issuedAt, signature }, RecoveryProof));
      void qc.invalidateQueries(); // the recovery epoch is now committed
    } catch (err) {
      if (err instanceof ApiError && err.code === "not_recoverable") {
        setError(`${err.message.replace(/^.*?: /, "")}. Upload at least 8 in-range readings from ${chosen} taken after the pause, then try again.`);
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
    if (hash) setProof(null);
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="font-semibold">Resume with a proof</h3>
      {proof ? (
        <>
          <p className="mt-1 text-sm text-slate">
            The proof is ready: eight readings from {chosen}, committed on chain and proven inside the band. Submit it from your wallet to resume the facility; then release milestone {proof.milestoneIndex + 1} above.
          </p>
          <Button className="mt-3" loading={pending} onClick={() => void submit(proof)}>Submit proof and resume</Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate">
            Choose a probe that kept the goods in range. Its 8 most recent readings since the pause are proven inside the band without revealing them.
          </p>
          {sensors.length === 0 ? (
            <p className="mt-2 text-sm font-medium">No probe has reported yet. Submit readings from a gateway first.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="recovery-probe" className="text-sm font-semibold">Probe</label>
                <select id="recovery-probe" className="mt-1 block h-11 rounded-2xl border-2 border-line bg-white px-3 font-mono" value={chosen} onChange={(e) => setSensor(e.target.value)}>
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
      {error && <p role="alert" className="mt-2 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}
