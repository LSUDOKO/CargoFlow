import React from "react";
import { AbsoluteFill } from "remotion";
import { P } from "../assets/palette";
import { ReeferContainer } from "../assets/Reefer";
import { CHARACTERS, CharacterName } from "../characters";
import { Logo } from "../components/Logo";
import { Actor, At, StatusPill } from "../scenes-v2/kit";
import { F } from "../theme";

/**
 * README stills: banner, cast sheet, sponsors board and the measured-numbers panel. All drawn
 * from the film's library (characters, reefer, type, pills); nothing generated.
 */

const DotGrid: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => (
  <AbsoluteFill
    style={{
      backgroundImage: `radial-gradient(circle, rgba(11,27,43,${opacity}) 1.3px, transparent 1.5px)`,
      backgroundSize: "22px 22px",
      backgroundPosition: "11px 11px",
    }}
  />
);

const Marker: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ background: `linear-gradient(transparent 52%, ${P.signal} 52%, ${P.signal} 92%, transparent 92%)`, padding: "0 4px", margin: "0 -4px" }}>{children}</span>
);

/* ------------------------------------------------------------------------------------------
 * Banner 1600 x 560
 * ---------------------------------------------------------------------------------------- */

export const BANNER = { w: 1600, h: 560 };

export const Banner: React.FC = () => (
  <AbsoluteFill style={{ background: P.paper, overflow: "hidden" }}>
    <DotGrid />
    {/* quay on the right */}
    <div style={{ position: "absolute", left: 760, top: 470, width: 840, height: 90, background: P.paperShade }} />
    <At x={1190} y={472} anchor="bc">
      <ReeferContainer view="side" width={720} temp={4.6} status="ok" bare />
    </At>
    <Actor who="carrier" x={850} y={548} h={330} prop="bol" expression="confident" look={0.6} blink={false} />
    <Actor who="meera" x={985} y={548} h={330} prop="tablet" gesture="present" expression="happy" look={0.4} blink={false} />
    <Actor who="daniel" x={1120} y={548} h={330} pose="crossed" expression="confident" look={0.2} blink={false} />
    <Actor who="weilin" x={1255} y={548} h={330} prop="invoice" expression="relieved" look={-0.3} blink={false} />
    <Actor who="insurer" x={1390} y={548} h={330} prop="umbrella" expression="confident" look={-0.5} blink={false} />
    <Actor who="arbiter" x={1520} y={548} h={330} pose="hips" expression="focused" look={-0.6} blink={false} />

    {/* left: wordmark, line, facts */}
    <At x={72} y={70}>
      <Logo width={330} variant="light" />
    </At>
    <At x={72} y={190} w={660}>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 46, lineHeight: 1.12, letterSpacing: -1.2, color: P.ink }}>
        Working capital that releases only when the cargo&apos;s own <Marker>evidence</Marker> says it should.
      </div>
    </At>
    <At x={72} y={404} w={700}>
      <div style={{ display: "flex", gap: 8 }}>
        {["Robinhood Chain Testnet", "USDG escrow", "Groth16 recovery", "MCP for Claude"].map((t) => (
          <span key={t} style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 14, color: P.ink, background: P.white, border: `1.5px solid ${P.line}`, borderRadius: 999, padding: "6px 12px", whiteSpace: "nowrap" }}>
            {t}
          </span>
        ))}
      </div>
    </At>
    {/* the through-line */}
    <svg width={1600} height={560} style={{ position: "absolute", inset: 0 }}>
      <line x1={72} y1={492} x2={700} y2={492} stroke={P.ink} strokeWidth={4} strokeLinecap="round" />
      {[0, 1, 2, 3, 4].map((i) => {
        const x = 110 + i * 140;
        const done = i < 2;
        return (
          <g key={i}>
            <circle cx={x} cy={492} r={13} fill={done ? P.verified : i === 2 ? P.signal : P.white} stroke={P.ink} strokeWidth={3} />
            <text x={x} y={530} textAnchor="middle" fontFamily={F.mono} fontWeight={700} fontSize={15} fill={P.slate}>
              M{i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------------------------------
 * Cast sheet 1600 x 760
 * ---------------------------------------------------------------------------------------- */

export const CAST = { w: 1600, h: 760 };

const CAST_ROWS: { who: CharacterName; name: string; role: string; does: string; p: React.ComponentProps<(typeof CHARACTERS)["meera"]> }[] = [
  { who: "meera", name: "Meera", role: "Exporter", does: "Registers the shipment and policy, opens the facility, resumes with a proof", p: { prop: "tablet", gesture: "present", expression: "happy", look: 0.3 } },
  { who: "daniel", name: "Daniel", role: "Financier", does: "Escrows USDG, watches the evidence, gets principal plus fee", p: { pose: "crossed", expression: "confident", look: 0.1 } },
  { who: "weilin", name: "Wei Lin", role: "Buyer", does: "Confirms delivery, pays the invoice, receives the bill of lading", p: { prop: "invoice", expression: "relieved", look: -0.1 } },
  { who: "carrier", name: "Carrier", role: "Ship's officer", does: "Issues the electronic bill of lading (ERC-721)", p: { prop: "bol", expression: "confident", look: 0 } },
  { who: "insurer", name: "Insurer", role: "Cover provider", does: "Offers default cover and parametric cover", p: { prop: "umbrella", expression: "confident", look: -0.2 } },
  { who: "arbiter", name: "Arbiter", role: "Dispute role", does: "Resolves disputes; can never release a tranche", p: { pose: "hips", expression: "focused", look: -0.3 } },
];

export const CastSheet: React.FC = () => (
  <AbsoluteFill style={{ background: P.white, padding: "48px 56px", boxSizing: "border-box" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 44, letterSpacing: -1, color: P.ink }}>
        Meet the <Marker>cast</Marker>
      </div>
      <div style={{ fontFamily: F.body, fontSize: 18, color: P.slate }}>Illustrative characters · every action they take is a real contract call</div>
    </div>
    <div style={{ display: "flex", gap: 16, marginTop: 30 }}>
      {CAST_ROWS.map((r) => {
        const Comp = CHARACTERS[r.who];
        return (
          <div key={r.who} style={{ flex: 1, background: P.paper, borderRadius: 20, border: `1.5px solid ${P.line}`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ height: 400, display: "flex", alignItems: "flex-end", justifyContent: "center", background: P.mist, overflow: "hidden" }}>
              <div style={{ marginBottom: -26 }}>
                <Comp scale={0.62} blink={false} {...r.p} />
              </div>
            </div>
            <div style={{ padding: "18px 18px 22px" }}>
              <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 30, color: P.ink }}>{r.name}</div>
              <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 15, color: P.teal, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>{r.role}</div>
              <div style={{ fontFamily: F.body, fontSize: 17, lineHeight: 1.4, color: P.ink, marginTop: 12 }}>{r.does}</div>
            </div>
          </div>
        );
      })}
    </div>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------------------------------
 * Sponsors board 1600 x 900 (statuses copied from docs/sponsors/README.md, 3-4 Oct 2026)
 * ---------------------------------------------------------------------------------------- */

export const SPONSORS = { w: 1600, h: 900 };

type Tone = React.ComponentProps<typeof StatusPill>["tone"];
const SPONSOR_ROWS: { name: string; line: string; status: string; tone: Tone }[] = [
  { name: "Robinhood Chain", line: "Settlement layer for every facility · 10 contracts source-verified · chain 46630", status: "live", tone: "verified" },
  { name: "Paxos USDG", line: "The only money: escrow, tranche releases, invoice payment, cover", status: "live", tone: "verified" },
  { name: "ZeroDev", line: "Passkey smart accounts (Kernel v3.1) · user operations paid a live invoice", status: "accounts live · paymaster pending", tone: "outline-amber" },
  { name: "QuickNode", line: "Primary RPC for the backend, with failover", status: "live", tone: "verified" },
  { name: "Alchemy", line: "Fallback RPC tier · signed webhook that wakes the indexer", status: "RPC live · webhook awaits token", tone: "outline-amber" },
  { name: "OpenZeppelin", line: "v5.4 access control, SafeERC20, ReentrancyGuard, Pausable, ERC-721", status: "live", tone: "verified" },
  { name: "Dune", line: "Volume, escrow, pause and recovery rates, lender yield · 15-minute uploader", status: "built · plan blocks uploads", tone: "outline-amber" },
  { name: "Fhenix", line: "Encrypted invoice margin and penalty terms, computed under FHE", status: "deployed · Arbitrum Sepolia", tone: "outline-ink" },
  { name: "GMX", line: "A financier's own-collateral hedge on GMX v2; escrow is never leveraged", status: "deployed · Arbitrum Sepolia", tone: "outline-ink" },
];

export const SponsorsBoard: React.FC = () => (
  <AbsoluteFill style={{ background: P.white, padding: "44px 56px", boxSizing: "border-box" }}>
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: 110 }}>
      <div>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 44, letterSpacing: -1, color: P.ink }}>
          Sponsors, <Marker>honestly</Marker>
        </div>
        <div style={{ fontFamily: F.body, fontSize: 19, color: P.slate, marginTop: 6 }}>What each partner does in CargoFlow and how far along it is · checked 4 October 2026</div>
      </div>
      <div style={{ position: "relative", width: 240, height: 110 }}>
        <Actor who="daniel" crop="bust" x={70} y={112} h={128} expression="focused" look={-0.4} blink={false} />
        <Actor who="meera" crop="bust" x={180} y={112} h={128} expression="happy" look={-0.2} blink={false} />
      </div>
    </div>
    <div style={{ marginTop: 18, borderTop: `3px solid ${P.ink}` }}>
      {SPONSOR_ROWS.map((r) => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", height: 76, borderBottom: `1.5px solid ${P.line}`, gap: 24 }}>
          <div style={{ width: 250, fontFamily: F.display, fontWeight: 700, fontSize: 28, color: P.ink }}>{r.name}</div>
          <div style={{ flex: 1, fontFamily: F.body, fontSize: 20, color: P.ink }}>{r.line}</div>
          <div style={{ width: 380, display: "flex", justifyContent: "flex-end" }}>
            <StatusPill text={r.status} tone={r.tone} size={16} />
          </div>
        </div>
      ))}
    </div>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------------------------------
 * Measured panel 1600 x 620 (counts as recorded in README / SCRIPT-v2; vitest counts re-run 4 Oct 2026)
 * ---------------------------------------------------------------------------------------- */

export const MEASURED = { w: 1600, h: 540 };

const BIG: { n: string; label: string; how: string }[] = [
  { n: "366", label: "contract tests", how: "forge test · unit, fuzz, invariants, real proofs" },
  { n: "25", label: "circuit tests", how: "circom · tamper and wrong-context cases" },
  { n: "296", label: "frontend unit", how: "vitest · 31 files" },
  { n: "18", label: "end-to-end", how: "Playwright + axe on the real stack" },
];
const SMALL: { n: string; label: string }[] = [
  { n: "92", label: "SDK" },
  { n: "27", label: "MCP" },
  { n: "36", label: "gateway" },
  { n: "25", label: "Python" },
  { n: "19", label: "Fhenix" },
  { n: "20", label: "GMX" },
];
const PERF: { n: string; label: string }[] = [
  { n: "13,494", label: "circuit constraints" },
  { n: "~1 s", label: "to prove" },
  { n: "~0.25 M", label: "gas · resumeWithProof" },
];

export const MeasuredPanel: React.FC = () => (
  <AbsoluteFill style={{ background: P.white, padding: "44px 56px", boxSizing: "border-box" }}>
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 44, letterSpacing: -1, color: P.ink }}>
        Measured, <Marker>not claimed</Marker>
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 16, color: P.slate }}>make check · make bench · make slither</div>
    </div>
    <div style={{ display: "flex", gap: 16, marginTop: 30 }}>
      {BIG.map((b) => (
        <div key={b.label} style={{ flex: 1, background: P.paper, border: `1.5px solid ${P.line}`, borderRadius: 20, padding: "22px 24px" }}>
          <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 76, color: P.ink, lineHeight: 1 }}>{b.n}</div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 26, color: P.ink, marginTop: 10 }}>{b.label}</div>
          <div style={{ fontFamily: F.body, fontSize: 16, color: P.slate, marginTop: 6 }}>{b.how}</div>
          <div style={{ marginTop: 14 }}>
            <StatusPill text="passing" tone="verified" size={13} />
          </div>
        </div>
      ))}
    </div>
    <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "stretch" }}>
      <div style={{ flex: 1.25, display: "flex", gap: 10, background: P.paper, border: `1.5px solid ${P.line}`, borderRadius: 20, padding: "18px 22px", alignItems: "center" }}>
        <div style={{ fontFamily: F.body, fontWeight: 600, fontSize: 17, color: P.slate, width: 90 }}>Packages and extensions</div>
        {SMALL.map((s) => (
          <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 36, color: P.ink }}>{s.n}</div>
            <div style={{ fontFamily: F.body, fontSize: 15, color: P.slate }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", gap: 10, background: P.limeSoft, borderRadius: 20, padding: "18px 22px", alignItems: "center" }}>
        {PERF.map((s) => (
          <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 34, color: P.ink }}>{s.n}</div>
            <div style={{ fontFamily: F.body, fontSize: 15, color: P.ink }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  </AbsoluteFill>
);

/* ------------------------------------------------------------------------------------------
 * Guide headers 1200 x 300: one per role guide, told by that character
 * ---------------------------------------------------------------------------------------- */

export const GUIDE = { w: 1200, h: 300 };

const GUIDE_LINES: Partial<Record<CharacterName, { kicker: string; line: string }>> = {
  meera: { kicker: "Exporter guide", line: "I ship vaccines. CargoFlow pays me as my cargo proves itself." },
  daniel: { kicker: "Financier guide", line: "I lend against a shipment I can finally see." },
  weilin: { kicker: "Buyer guide", line: "I pay once, and the title arrives in the same transaction." },
  carrier: { kicker: "Carrier guide", line: "I issue the bill of lading. The contract decides who holds it." },
  arbiter: { kicker: "Arbiter guide", line: "I resolve disputes. I can never release the money." },
};

export const GuideHeader: React.FC<{ who: CharacterName }> = ({ who }) => {
  const row = CAST_ROWS.find((r) => r.who === who)!;
  const g = GUIDE_LINES[who]!;
  return (
    <AbsoluteFill style={{ background: P.paper, overflow: "hidden" }}>
      <DotGrid />
      <div style={{ position: "absolute", left: 0, top: 0, width: 330, height: 300, background: P.mist }} />
      <Actor who={who} x={165} y={306} h={286} crop="waist" blink={false} {...row.p} />
      <div style={{ position: "absolute", left: 380, top: 58, width: 760 }}>
        <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 18, letterSpacing: 1.5, textTransform: "uppercase", color: P.teal }}>
          {g.kicker} · told by {who === "carrier" || who === "arbiter" ? `the ${row.name.toLowerCase()}` : row.name}
        </div>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 44, lineHeight: 1.15, letterSpacing: -1, color: P.ink, marginTop: 14 }}>&ldquo;{g.line}&rdquo;</div>
        <div style={{ fontFamily: F.body, fontSize: 18, color: P.slate, marginTop: 16 }}>CargoFlow · Robinhood Chain Testnet · illustrative character, real contract calls</div>
      </div>
    </AbsoluteFill>
  );
};
