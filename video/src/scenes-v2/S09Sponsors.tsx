import React from "react";
import { useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { Cam, Stage, StatusPill, env, keys } from "./kit";
import { beats } from "./timing";

/**
 * S09 · Sponsors, honestly: one row per partner (name, what CargoFlow uses it for, status pill
 * copied from docs/sponsors/README.md). Rows enter on their spoken name. Lean-in on the two rows
 * that carry the money, then pull back to the full board.
 */

type Row = { name: string; line: string; status: string; tone: "verified" | "outline-amber" | "outline-ink"; cue: string; word: string };

const ROWS: Row[] = [
  { name: "Robinhood Chain", line: "settlement layer for every facility · testnet 46630", status: "live", tone: "verified", cue: "c090", word: "Robinhood" },
  { name: "Paxos USDG", line: "escrow, advances, settlement, cover", status: "live", tone: "verified", cue: "c090", word: "Paxos" },
  { name: "ZeroDev", line: "passkey smart accounts, sponsored gas via CargoFlow's policy webhook", status: "live", tone: "verified", cue: "c091", word: "ZeroDev" },
  { name: "Alchemy", line: "fallback RPC tier; signed webhook wakes the indexer", status: "RPC live · webhook awaiting token", tone: "outline-amber", cue: "c091", word: "Alchemy" },
  { name: "QuickNode", line: "primary RPC with failover", status: "live", tone: "verified", cue: "c091", word: "QuickNode" },
  { name: "OpenZeppelin", line: "access control, SafeERC20, reentrancy guards, Pausable, ERC-721", status: "live", tone: "verified", cue: "c091", word: "OpenZeppelin" },
  { name: "Dune", line: "volume, escrow, pause and recovery rates, lender yield", status: "built · upload plan pending", tone: "outline-amber", cue: "c092", word: "Dune" },
  { name: "Fhenix", line: "encrypted invoice margin and penalty terms", status: "deployed · Arbitrum Sepolia", tone: "outline-ink", cue: "c092", word: "Fhenix" },
  { name: "GMX", line: "optional financier hedge with the financier's own collateral", status: "deployed · Arbitrum Sepolia", tone: "outline-ink", cue: "c092", word: "GMX" },
];

const ROW_H = 74;
const TOP = 170;

export const S09Sponsors: React.FC = () => {
  const frame = useCurrentFrame();
  const at = beats("S09");
  let prev = -100;
  const enters = ROWS.map((r) => {
    const f = Math.max(at(r.cue, r.word) - 6, prev + 8);
    prev = f;
    return f;
  });
  const zeroDev = at("c091", "ZeroDev");
  const scale = keys(frame, [
    [0, 1.16],
    [zeroDev - 24, 1.16],
    [zeroDev + 6, 1],
  ]);

  return (
    <Stage tone="paper">
      <Cam scale={scale} ox={960} oy={TOP + 40}>
        <div style={{ position: "absolute", left: 200, top: TOP - 74, width: 1520, display: "flex", fontFamily: F.mono, fontSize: 14, letterSpacing: 1.4, color: P.slate, opacity: env(frame, 0, undefined, 12) }}>
          <span style={{ width: 340 }}>PARTNER</span>
          <span>WHAT CARGOFLOW USES IT FOR</span>
          <span style={{ marginLeft: "auto" }}>STATUS</span>
        </div>
        {ROWS.map((r, i) => {
          const k = env(frame, enters[i], undefined, 12);
          return (
            <div
              key={r.name}
              style={{
                position: "absolute",
                left: 200,
                top: TOP - 40 + i * ROW_H,
                width: 1520,
                height: ROW_H - 10,
                display: "flex",
                alignItems: "center",
                borderTop: `1.5px solid ${P.line}`,
                opacity: k,
                transform: `translateY(${(1 - k) * 14}px)`,
              }}
            >
              <span style={{ width: 340, fontFamily: F.display, fontWeight: 700, fontSize: 32, color: P.ink }}>{r.name}</span>
              <span style={{ fontFamily: F.body, fontWeight: 500, fontSize: 22, color: P.slate }}>{r.line}</span>
              <span style={{ marginLeft: "auto" }}>
                <StatusPill text={r.status} tone={r.tone} size={16} />
              </span>
            </div>
          );
        })}
      </Cam>
    </Stage>
  );
};
