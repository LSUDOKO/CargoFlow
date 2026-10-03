import React from "react";
import { AbsoluteFill } from "remotion";
import { DataLogger } from "../assets/Devices";
import { P } from "../assets/palette";
import { CharacterName } from "../characters";
import { Actor } from "../scenes-v2/kit";
import { F } from "../theme";

/**
 * The system diagram in the film's theme: paper, navy ink, lime only for the money path, emerald
 * for what the chain verifies. The cast stand at their entry points. 1600 x 1040.
 * Facts follow docs/architecture.md (components, who may do what, trust boundaries).
 */

export const ARCH = { w: 1600, h: 1040 };

type Box = { x: number; y: number; w: number; h: number };

const A_X = 40;
const A_W = 270;
const B_X = 370;
const B_W = 310;
const C_X = 760;
const C_W = 370;
const D_X = 1210;
const D_W = 360;

const PEOPLE: { who: CharacterName[]; name: string; role: string; y: number }[] = [
  { who: ["meera"], name: "Meera", role: "exporter · wallet", y: 150 },
  { who: ["daniel"], name: "Daniel", role: "financier · wallet", y: 262 },
  { who: ["weilin"], name: "Wei Lin", role: "buyer · passkey", y: 374 },
  { who: ["carrier", "arbiter"], name: "Carrier, Arbiter", role: "role wallets", y: 486 },
];
const CARD_H = 96;

const WEB: Box = { x: B_X, y: 150, w: B_W, h: 470 };
const GATE: Box = { x: B_X, y: 650, w: B_W, h: 120 };
const MCP: Box = { x: B_X, y: 800, w: B_W, h: 150 };
const SVC: Box = { x: C_X, y: 150, w: C_W, h: 650 };
const PG: Box = { x: C_X, y: 840, w: C_W, h: 110 };
const CHAIN: Box = { x: D_X, y: 150, w: D_W, h: 590 };
const ARB: Box = { x: D_X, y: 790, w: D_W, h: 160 };

const boxStyle = (b: Box, extra: React.CSSProperties = {}): React.CSSProperties => ({
  position: "absolute",
  left: b.x,
  top: b.y,
  width: b.w,
  height: b.h,
  boxSizing: "border-box",
  borderRadius: 18,
  background: P.white,
  border: `2px solid ${P.ink}`,
  ...extra,
});

const Kicker: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = P.teal }) => (
  <div style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 13, letterSpacing: 1.2, textTransform: "uppercase", color }}>{children}</div>
);
const Title: React.FC<{ children: React.ReactNode; size?: number; color?: string }> = ({ children, size = 24, color = P.ink }) => (
  <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: size, color, letterSpacing: -0.4, marginTop: 4 }}>{children}</div>
);
const Line: React.FC<{ children: React.ReactNode; mono?: boolean; color?: string; size?: number }> = ({ children, mono, color = P.ink, size = 16 }) => (
  <div style={{ fontFamily: mono ? F.mono : F.body, fontSize: size, lineHeight: 1.4, color }}>{children}</div>
);

const SvcRow: React.FC<{ name: string; detail: string; tone?: "ink" | "lime" | "muted" }> = ({ name, detail, tone = "ink" }) => (
  <div
    style={{
      borderRadius: 12,
      background: tone === "lime" ? P.limeSoft : tone === "muted" ? P.mist : P.paper,
      border: `1.5px solid ${tone === "lime" ? P.signal2 : P.line}`,
      padding: "9px 14px",
    }}
  >
    <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 18, color: P.ink }}>{name}</div>
    <div style={{ fontFamily: F.body, fontSize: 14, color: P.slate, marginTop: 1 }}>{detail}</div>
  </div>
);

const CONTRACTS: [string, string][] = [
  ["FinancingController", "facility states"],
  ["ReceivableVault", "USDG escrow, waterfall"],
  ["EvidenceRegistry", "roots + scores"],
  ["PolicyEngine", "cold-chain policy"],
  ["ShipmentRegistry", "parties, invoice"],
  ["Groth16Verifier", "recovery proofs"],
  ["CoverPool", "default, parametric"],
  ["DeviceRegistry", "device keys"],
  ["EBLRegistry", "ERC-721 titles"],
  ["CargoFlowAccess", "roles"],
  ["USDG (Paxos)", "the money"],
];

const Arrow: React.FC<{ d: string; color?: string; dash?: boolean; width?: number; head?: boolean }> = ({ d, color = P.ink, dash = false, width = 2.5, head = true }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash ? "6 7" : undefined} markerEnd={head ? `url(#ah-${color.replace("#", "")})` : undefined} />
);

const EdgeLabel: React.FC<{ x: number; y: number; children: React.ReactNode; anchor?: "start" | "middle" | "end"; color?: string; bg?: string }> = ({ x, y, children, anchor = "middle", color = P.ink, bg = P.paper }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `translate(${anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0"}, -50%)`,
      fontFamily: F.mono,
      fontWeight: 700,
      fontSize: 13,
      color,
      background: bg,
      padding: "3px 8px",
      borderRadius: 999,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </div>
);

export const Architecture: React.FC = () => {
  const colors = [P.ink, P.signal2, P.verified, P.slate];
  return (
    <AbsoluteFill style={{ background: P.paper }}>
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(circle, rgba(11,27,43,0.06) 1.3px, transparent 1.5px)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* heading */}
      <div style={{ position: "absolute", left: 40, top: 26 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 36, color: P.ink, letterSpacing: -0.8 }}>How CargoFlow is built</div>
        <div style={{ fontFamily: F.body, fontSize: 17, color: P.slate, marginTop: 4 }}>
          Every money move is a transaction its party signs. The service scores evidence; the contracts decide.
        </div>
      </div>

      {/* column A: the people and devices at their entry points */}
      {PEOPLE.map((p) => (
        <div key={p.name} style={boxStyle({ x: A_X, y: p.y, w: A_W, h: CARD_H }, { background: P.white, border: `1.5px solid ${P.line}`, overflow: "hidden" })}>
          {p.who.map((w, i) => (
            <Actor key={w} who={w} crop="bust" x={52 + i * 58} y={CARD_H + 2} h={92} expression="neutral" look={0.5} blink={false} />
          ))}
          <div style={{ position: "absolute", left: p.who.length > 1 ? 150 : 104, top: 22 }}>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, color: P.ink }}>{p.name}</div>
            <div style={{ fontFamily: F.mono, fontSize: 13, color: P.slate, marginTop: 4 }}>{p.role}</div>
          </div>
        </div>
      ))}
      <div style={boxStyle({ x: A_X, y: 650, w: A_W, h: 120 }, { border: `1.5px solid ${P.line}`, overflow: "hidden" })}>
        <div style={{ position: "absolute", left: 14, top: 10 }}>
          <DataLogger width={74} value={4.6} />
        </div>
        <div style={{ position: "absolute", left: 104, top: 26 }}>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, color: P.ink }}>Reefer logger</div>
          <div style={{ fontFamily: F.mono, fontSize: 13, color: P.slate, marginTop: 4 }}>signs its readings</div>
        </div>
      </div>
      <div style={boxStyle({ x: A_X, y: 800, w: A_W, h: 150 }, { border: `1.5px solid ${P.line}`, overflow: "hidden" })}>
        <Actor who="daniel" crop="bust" x={56} y={152} h={100} expression="focused" look={0.5} blink={false} />
        <svg width={64} height={50} style={{ position: "absolute", left: 104, top: 20 }}>
          <path d="M6 6 H58 a4 4 0 0 1 4 4 V32 a4 4 0 0 1 -4 4 H24 L12 46 V36 H6 a4 4 0 0 1 -4 -4 V10 a4 4 0 0 1 4 -4 Z" fill={P.white} stroke={P.ink} strokeWidth={2.5} />
          <circle cx={20} cy={21} r={3} fill={P.ink} />
          <circle cx={32} cy={21} r={3} fill={P.ink} />
          <circle cx={44} cy={21} r={3} fill={P.ink} />
        </svg>
        <div style={{ position: "absolute", left: 104, top: 80 }}>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 20, color: P.ink }}>Claude</div>
          <div style={{ fontFamily: F.mono, fontSize: 13, color: P.slate, marginTop: 4 }}>claude.ai · Claude Code</div>
        </div>
      </div>

      {/* column B: edge apps */}
      <div style={boxStyle(WEB, { padding: "18px 20px" })}>
        <Kicker>Cloudflare Workers</Kicker>
        <Title>Web app</Title>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          <Line>Next.js 16 · OpenNext · wagmi + viem</Line>
          <Line>Browser wallets and WalletConnect</Line>
          <Line>ZeroDev passkey smart accounts (Kernel v3.1, WebAuthn, RIP-7212)</Line>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["exporter", "financier", "buyer", "carrier", "arbiter", "live dashboard", "fleet", "market", "eBL", "API docs"].map((t) => (
            <span key={t} style={{ fontFamily: F.mono, fontSize: 12.5, fontWeight: 700, color: P.ink, background: P.mist, borderRadius: 999, padding: "4px 10px" }}>
              {t}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 16, padding: "10px 12px", borderRadius: 12, background: P.limeSoft, border: `1.5px solid ${P.signal2}` }}>
          <Line size={15}>Each party signs from their own wallet or passkey. The app never holds a key.</Line>
        </div>
      </div>
      <div style={boxStyle(GATE, { padding: "14px 20px" })}>
        <Kicker>@cargoflow/gateway · SDK</Kicker>
        <Title size={20}>Sensor gateway agent</Title>
        <Line size={14} color={P.slate}>Watches logger exports, signs every request, keeps an offline queue</Line>
      </div>
      <div style={boxStyle(MCP, { padding: "14px 20px" })}>
        <Kicker>Cloudflare Workers</Kicker>
        <Title size={20}>Remote MCP server</Title>
        <Line size={14} color={P.slate}>25 tools: fleet risk, explanations, evidence, market, cover. prepare_* tools return unsigned transactions and a sign link. Holds no keys.</Line>
      </div>

      {/* column C: the Go service */}
      <div style={boxStyle(SVC, { padding: "16px 18px" })}>
        <Kicker>Render · Docker · one Go binary</Kicker>
        <Title>Evidence service</Title>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
          <SvcRow name="Ingestion" detail="signature check, replay, equivocation and fraud gates" />
          <SvcRow name="Evidence engine" detail="Dempster-Shafer fusion, worst-step conflict, 0-100 score" />
          <SvcRow name="Poseidon epochs" detail="8 readings per sensor, salted Merkle root" />
          <div style={{ display: "flex", gap: 7 }}>
            <div style={{ flex: 1 }}>
              <SvcRow name="Policy gate" detail="deterministic decision" />
            </div>
            <div style={{ flex: 1 }}>
              <SvcRow name="AI monitor" detail="Groq · stricter only" tone="muted" />
            </div>
          </div>
          <SvcRow name="Prover worker" detail="Circom + snarkjs Groth16, auto recovery" />
          <SvcRow name="Outbox + reconciler" detail="role keys: worker commits · monitor pauses · manager releases" tone="lime" />
          <SvcRow name="Indexer · REST + WebSocket API" detail="OpenAPI 3.1 · facility view read from the chain" />
        </div>
      </div>
      <div style={boxStyle(PG, { padding: "10px 18px", background: P.mist, border: `1.5px solid ${P.line}` })}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 18, color: P.ink }}>Postgres (Neon)</div>
        <div style={{ fontFamily: F.body, fontSize: 14, color: P.slate }}>readings, epochs, outbox, audit trail; reconciled from chain events, never the source of money</div>
      </div>

      {/* column D: the chain, final authority */}
      <div style={boxStyle({ x: CHAIN.x - 12, y: CHAIN.y - 12, w: CHAIN.w + 24, h: CHAIN.h + 24 }, { background: "transparent", border: `2px dashed ${P.verified}`, borderRadius: 24 })} />
      <div style={boxStyle(CHAIN, { padding: "16px 18px", background: P.ink, border: "none" })}>
        <Kicker color={P.signal}>Robinhood Chain Testnet · 46630</Kicker>
        <Title color={P.white}>Contracts v3</Title>
        <div style={{ marginTop: 10 }}>
          {CONTRACTS.map(([n, d], i) => (
            <div key={n} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.12)" }}>
              <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 14.5, color: n.startsWith("USDG") ? P.signal : P.white, width: 190 }}>{n}</span>
              <span style={{ fontFamily: F.body, fontSize: 13.5, color: "rgba(255,255,255,0.72)", whiteSpace: "nowrap" }}>{d}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", left: 18, right: 18, bottom: 18, padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)" }}>
          <div style={{ fontFamily: F.body, fontSize: 13.5, lineHeight: 1.45, color: "rgba(255,255,255,0.85)" }}>
            Immutable core (no proxy) · release needs a committed epoch that passes the on-chain policy · pause can never withdraw funds · 8 invariants fuzzed
          </div>
        </div>
      </div>
      <EdgeLabel x={CHAIN.x + CHAIN.w / 2} y={CHAIN.y + CHAIN.h + 12} color={P.white} bg={P.verified}>
        contracts hold final authority
      </EdgeLabel>
      <div style={boxStyle(ARB, { padding: "14px 18px" })}>
        <Kicker>Arbitrum Sepolia · 421614</Kicker>
        <Title size={20}>Sponsor extensions</Title>
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
          <Line size={14}>
            <b>Fhenix</b> ConfidentialInvoiceTerms · encrypted margin
          </Line>
          <Line size={14}>
            <b>GMX</b> GMXHedgeVault · financier&apos;s own hedge
          </Line>
          <Line size={14}>
            <b>Stylus</b> EvidenceEngine · optional, benchmarked
          </Line>
        </div>
      </div>

      {/* infrastructure strip */}
      <div
        style={{
          position: "absolute",
          left: 40,
          top: 978,
          width: 1520,
          height: 40,
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontFamily: F.mono,
          fontSize: 14,
          color: P.slate,
        }}
      >
        <span style={{ fontWeight: 700, color: P.ink }}>INFRA</span>
        <span>RPC failover: QuickNode → Alchemy → public</span>
        <span>·</span>
        <span>Alchemy webhook wakes the indexer</span>
        <span>·</span>
        <span>Dune uploader</span>
        <span>·</span>
        <span>Groq model API (advisory)</span>
        <span>·</span>
        <span>Telegram, email, Slack, webhook alerts</span>
      </div>

      {/* edges */}
      <svg width={1600} height={1040} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          {colors.map((c) => (
            <marker key={c} id={`ah-${c.replace("#", "")}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {/* people -> web app */}
        {PEOPLE.map((p) => (
          <Arrow key={p.name} d={`M${A_X + A_W + 4} ${p.y + CARD_H / 2} H${B_X - 6}`} />
        ))}
        {/* web app -> chain: signed transactions, the money path */}
        <Arrow d={`M${WEB.x + WEB.w * 0.6} ${WEB.y - 4} V122 H${CHAIN.x + CHAIN.w / 2} V${CHAIN.y - 16}`} color={P.signal2} width={4} />
        {/* web app <-> service */}
        <Arrow d={`M${WEB.x + WEB.w + 4} 330 H${SVC.x - 6}`} />
        <Arrow d={`M${SVC.x - 4} 370 H${WEB.x + WEB.w + 8}`} color={P.slate} />
        {/* logger -> gateway -> ingestion */}
        <Arrow d={`M${A_X + A_W + 4} 710 H${GATE.x - 6}`} />
        <Arrow d={`M${GATE.x + GATE.w + 4} 710 H730 V265 H${SVC.x - 6}`} />
        {/* claude -> mcp -> service api */}
        <Arrow d={`M${A_X + A_W + 4} 875 H${MCP.x - 6}`} />
        <Arrow d={`M${MCP.x + MCP.w + 4} 875 H745 V760 H${SVC.x - 6}`} />
        {/* service <-> postgres */}
        <Arrow d={`M${SVC.x + SVC.w / 2} ${SVC.y + SVC.h + 4} V${PG.y - 6}`} color={P.slate} />
        {/* service -> chain (role keys) and chain -> indexer (events) */}
        <Arrow d={`M${SVC.x + SVC.w + 4} 655 H${CHAIN.x - 18}`} color={P.ink} width={3} />
        <Arrow d={`M${CHAIN.x - 18} 735 H${SVC.x + SVC.w + 6}`} color={P.slate} dash />
      </svg>
      <EdgeLabel x={(WEB.x + CHAIN.x + CHAIN.w) / 2 + 60} y={122} bg={P.limeSoft}>
        signed transactions go straight to the chain (wallet tx or ERC-4337 user operation)
      </EdgeLabel>
      <EdgeLabel x={(WEB.x + WEB.w + SVC.x) / 2} y={312}>
        REST
      </EdgeLabel>
      <EdgeLabel x={(WEB.x + WEB.w + SVC.x) / 2} y={390} color={P.slate}>
        WS
      </EdgeLabel>
      <EdgeLabel x={(A_X + A_W + GATE.x) / 2} y={690}>
        CSV
      </EdgeLabel>
      <EdgeLabel x={(GATE.x + GATE.w + 730) / 2 + 6} y={730}>
        signed
      </EdgeLabel>
      <EdgeLabel x={(A_X + A_W + MCP.x) / 2} y={855}>
        ask
      </EdgeLabel>
      <EdgeLabel x={(SVC.x + SVC.w + CHAIN.x) / 2 - 6} y={630}>
        role keys
      </EdgeLabel>
      <EdgeLabel x={(SVC.x + SVC.w + CHAIN.x) / 2 - 6} y={760} color={P.slate}>
        events
      </EdgeLabel>
    </AbsoluteFill>
  );
};
