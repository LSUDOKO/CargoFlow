import { HashBadge } from "@/components/ui/HashBadge";
import { Pill } from "@/components/ui/Pill";
import type { EpochSummary } from "@/lib/api/schemas";
import { formatBps } from "@/lib/format";

const tone = (a: string) => (a === "APPROVE_ADVANCE" ? "verified" : a === "PAUSE_FACILITY" ? "alert" : a.startsWith("SKIPPED") ? "slate" : "alert");
const words: Record<string, string> = { APPROVE_ADVANCE: "Approve", PAUSE_FACILITY: "Pause", REQUEST_SECONDARY_PROOF: "More proof" };

export function EpochList({ epochs, chainId }: { epochs: EpochSummary[]; chainId?: number }) {
  if (epochs.length === 0) return <p className="text-slate">No evidence epochs yet.</p>;
  const rows = [...epochs].reverse().slice(0, 10);
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left text-sm">
        <thead>
          <tr className="text-slate">
            <th className="px-2 py-2 font-semibold">Milestone</th>
            <th className="px-2 font-semibold">Score</th>
            <th className="px-2 font-semibold">Conflict</th>
            <th className="px-2 font-semibold">Decision</th>
            <th className="px-2 font-semibold">Commit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.epochId} className="border-t border-line">
              <td className="px-2 py-2.5">{e.milestoneIndex === 255 ? <span className="text-slate">Observed</span> : <>M{e.milestoneIndex + 1}<span className="text-slate"> #{e.sequence}</span></>}{e.proofVerified && <Pill tone="verified" className="ml-2">ZK proven</Pill>}</td>
              <td className="px-2 font-mono font-semibold tabular">{e.score}</td>
              <td className="px-2 font-mono tabular">{formatBps(e.conflictBps)}</td>
              <td className="px-2"><Pill tone={tone(e.decisionAction)}>{words[e.decisionAction] ?? e.decisionAction.replace("SKIPPED_", "Skipped: ").toLowerCase()}</Pill></td>
              <td className="px-2">{e.commitTx ? <HashBadge value={e.commitTx} kind="tx" chainId={chainId} compact /> : <span className="text-slate">Not committed</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
