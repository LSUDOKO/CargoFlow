"use client";

import { HashBadge } from "@/components/ui/HashBadge";
import { useDevicesOnChain } from "@/lib/chain/v3";
import { DeviceBadge } from "./DeviceBadge";
import { Pill } from "@/components/ui/Pill";
import type { EpochSummary } from "@/lib/api/schemas";
import { formatBps } from "@/lib/format";
import { distanceText, HELD } from "@/lib/places";

// a held epoch passed the policy but came from outside the milestone's place: it waits, it did not fail
const tone = (a: string) => (a === "APPROVE_ADVANCE" ? "verified" : a === HELD ? "ink" : a === "PAUSE_FACILITY" ? "alert" : a.startsWith("SKIPPED") ? "slate" : "alert");
const words: Record<string, string> = { APPROVE_ADVANCE: "Approve", PAUSE_FACILITY: "Pause", REQUEST_SECONDARY_PROOF: "More proof", [HELD]: "Held: not at the place yet" };
const maxima = (e: EpochSummary) => (e.maxHumidityX100 || e.maxShockX100 ? `${Number((e.maxHumidityX100 / 100).toFixed(1))}% · ${Number((e.maxShockX100 / 100).toFixed(2))} g` : "–");

export function EpochList({ epochs, chainId }: { epochs: EpochSummary[]; chainId?: number }) {
  const rows = [...epochs].reverse().slice(0, 10);
  // contracts v3: the device keys whose readings fed each batch, checked against the on-chain registry
  const withSources = rows.some((e) => e.sources.length > 0);
  const onChain = useDevicesOnChain([...new Set(rows.flatMap((e) => e.sources.map((s) => s.keyHash.toLowerCase())))]);
  if (epochs.length === 0) return <p className="text-slate">No evidence epochs yet.</p>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className={`w-full text-left text-sm ${withSources ? "min-w-[50rem]" : "min-w-[36rem]"}`}>
        <thead>
          <tr className="text-slate">
            <th className="px-2 py-2 font-semibold">Milestone</th>
            <th className="px-2 font-semibold">Score</th>
            <th className="px-2 font-semibold">Conflict</th>
            <th className="px-2 font-semibold"><abbr title="Highest relative humidity and shock in the batch" className="no-underline">Hum. · shock</abbr></th>
            <th className="px-2 font-semibold">Decision</th>
            {withSources && <th className="px-2 font-semibold">Source devices</th>}
            <th className="px-2 font-semibold">Commit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.epochId} className="border-t border-line">
              <td className="px-2 py-2.5">{e.milestoneIndex === 255 ? <span className="text-slate">Observed</span> : <>M{e.milestoneIndex + 1}<span className="text-slate"> #{e.sequence}</span></>}{e.proofVerified && <Pill tone="verified" className="ml-2">ZK proven</Pill>}</td>
              <td className="px-2 font-mono font-semibold tabular">{e.score}</td>
              <td className="px-2 font-mono tabular">{formatBps(e.conflictBps)}</td>
              <td className="px-2 font-mono text-xs whitespace-nowrap tabular">{maxima(e)}</td>
              <td className="px-2">
                <Pill tone={tone(e.decisionAction)}>{words[e.decisionAction] ?? e.decisionAction.replace("SKIPPED_", "Skipped: ").toLowerCase()}</Pill>
                {e.decisionAction === HELD && e.heldDistanceM !== null && <span className="mt-0.5 block text-xs text-slate">{distanceText(e.heldDistanceM)} from the place</span>}
              </td>
              {withSources && (
                <td className="px-2 py-2">
                  {e.sources.length === 0 ? (
                    <span className="text-slate">–</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {e.sources.map((s) => {
                        const rec = onChain.devices.get(s.keyHash.toLowerCase());
                        return (
                          <li key={s.keyHash} className="flex flex-wrap items-center gap-1.5" title={s.keyHash}>
                            <DeviceBadge deviceClass={s.deviceClass} onChain={s.onChain || rec?.registered} revoked={rec?.revoked} compact />
                            <span className="font-mono text-xs text-slate">{s.keyHash.slice(0, 8)}…</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
              )}
              <td className="px-2">{e.commitTx ? <HashBadge value={e.commitTx} kind="tx" chainId={chainId} compact /> : <span className="text-slate">Not committed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
