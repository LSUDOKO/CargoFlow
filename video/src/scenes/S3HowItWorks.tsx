import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  interpolateColors,
  useCurrentFrame,
} from "remotion";
import { PaperBg } from "../components/Backgrounds";
import { Coin, Lock, PartyGlyph, ProofSeal, Reefer } from "../components/Icons";
import { Card, Eyebrow, Pill, Reveal, Tone } from "../components/ui";
import { C, F } from "../theme";
import { EASE_IN_OUT, fmt, lerp, prog, travel } from "../lib/anim";
import {
  FACILITY_USDG,
  FEE_USDG,
  INVOICE_USDG,
  RESIDUAL_USDG,
  TRANCHE_USDG,
} from "../data/facts";

// 0:58–1:30 · 960 frames. Five beats on one living diagram.
const BEATS = [
  { from: 0, n: "01", title: "40,000 USDG into escrow" },
  { from: 190, n: "02", title: "Signed readings → Merkle root → tranche" },
  { from: 390, n: "03", title: "11.7 °C → paused" },
  { from: 580, n: "04", title: "Zero-knowledge proof → active again" },
  { from: 770, n: "05", title: "Financier 41,200 · Meera 58,800" },
];

// ---- anchors (absolute px) ----
const FIN = { x: 550, y: 716 };
const BUY = { x: 550, y: 886 };
const VAULT_L = { x: 770, y: 770 };
const VAULT_R = { x: 1150, y: 770 };
const EXP_L = { x: 1390, y: 770 };
const EXP_TOP = { x: 1580, y: 714 };
const CHAIN_BOTTOM = { x: 1620, y: 520 };
const LOGGER = { x: 425, y: 372 };
const CELL_X = 560;
const CELL_W = 64;
const CELL_GAP = 10;
const ROOT = { x: 1215, y: 372 };

// ---- timeline helpers ----
const step = (frame: number, events: [number, number][], base = 0) =>
  events.reduce(
    (acc, [at, delta]) => acc + delta * prog(frame, at, at + 22, EASE_IN_OUT),
    base,
  );

const GOOD = [4.6, 4.7, 4.6, 4.8, 4.7, 4.9, 4.8, 5.0];
const BAD = [5.2, 5.9, 6.8, 7.6, 8.9, 9.6, 10.4, 11.7];

type LogEntry = { at: number; text: string; tone: Tone };
const LOG: LogEntry[] = [
  { at: 40, text: "createFacility · 5 × 8,000", tone: "verified" },
  { at: 128, text: "deposit · 40,000 USDG", tone: "verified" },
  { at: 300, text: "commitEpoch · 0x9f3a…c21e", tone: "verified" },
  { at: 345, text: "release · milestones 1–2", tone: "verified" },
  { at: 462, text: "policy gate · FAIL 11.7 °C", tone: "danger" },
  { at: 498, text: "AI monitor · stricter only", tone: "alert" },
  { at: 682, text: "resumeWithProof · ✓", tone: "verified" },
  { at: 712, text: "release · milestones 3–5", tone: "verified" },
  { at: 852, text: "settle · 100,000 USDG", tone: "verified" },
  { at: 912, text: "waterfall · paid out", tone: "ink" },
];

/** A burst of coins travelling from a to b. */
const Flow: React.FC<{
  a: { x: number; y: number };
  b: { x: number; y: number };
  start: number;
  count?: number;
  color?: string;
  arc?: number;
}> = ({ a, b, start, count = 6, color = C.signal, arc = -40 }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const s = start + i * 5;
        const t = travel(frame, s, s + 30);
        if (t <= 0 || t >= 1) return null;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t + arc * Math.sin(Math.PI * t);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - 18,
              top: y - 18,
              opacity: interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
            }}
          >
            <Coin size={36} color={color} />
          </div>
        );
      })}
    </>
  );
};

const Node: React.FC<{
  left: number;
  top: number;
  width?: number;
  kind: "exporter" | "financier" | "buyer";
  name: string;
  line: React.ReactNode;
  appear: number;
  glow?: number;
  flash?: number;
}> = ({
  left,
  top,
  width = 330,
  kind,
  name,
  line,
  appear,
  glow = 0,
  flash = 0,
}) => {
  const frame = useCurrentFrame();
  const p = prog(frame, appear, appear + 20);
  return (
    <Card
      style={{
        position: "absolute",
        left,
        top,
        width,
        padding: "24px 26px",
        opacity: p,
        translate: `0 ${(1 - p) * 24}px`,
        boxShadow: `inset 0 0 0 ${1.5 + glow * 2.5}px ${interpolateColors(glow, [0, 1], [C.line, C.signal2])}, 0 18px 40px -16px rgba(11,27,43,0.22)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            background: C.mist,
            display: "grid",
            placeItems: "center",
          }}
        >
          <PartyGlyph kind={kind} size={44} />
        </div>
        <div>
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 700,
              fontSize: 32,
              letterSpacing: "-0.02em",
              color: C.ink,
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 21,
              color: flash > 0 ? C.ink : C.slate,
              marginTop: 4,
              whiteSpace: "nowrap",
              display: "inline-block",
              padding: flash > 0 ? "2px 6px" : 0,
              marginLeft: flash > 0 ? -6 : 0,
              borderRadius: 6,
              background:
                flash > 0 ? `rgba(198,244,50,${flash})` : "transparent",
            }}
          >
            {line}
          </div>
        </div>
      </div>
    </Card>
  );
};

const Connector: React.FC<{
  a: { x: number; y: number };
  b: { x: number; y: number };
  draw: number;
  color?: string;
}> = ({ a, b, draw, color = C.line }) => (
  <svg
    style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
    width={1}
    height={1}
  >
    <path
      d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
      stroke={color}
      strokeWidth={4}
      strokeDasharray="2 12"
      strokeLinecap="round"
      opacity={draw}
    />
  </svg>
);

export const S3HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();

  // ---- money state ----
  const vault = step(frame, [
    [70, FACILITY_USDG],
    [345, -TRANCHE_USDG],
    [372, -TRANCHE_USDG],
    [712, -TRANCHE_USDG],
    [732, -TRANCHE_USDG],
    [752, -TRANCHE_USDG],
    [812, INVOICE_USDG],
    [890, -(FACILITY_USDG + FEE_USDG)],
    [905, -RESIDUAL_USDG],
  ]);
  const exporterGot = step(frame, [
    [355, TRANCHE_USDG],
    [382, TRANCHE_USDG],
    [722, TRANCHE_USDG],
    [742, TRANCHE_USDG],
    [762, TRANCHE_USDG],
    [915, RESIDUAL_USDG],
  ]);
  const financierBack = step(frame, [[900, FACILITY_USDG + FEE_USDG]]);

  // ---- status ----
  const status: { tone: Tone; label: string } | null =
    frame < 128
      ? null
      : frame < 472
        ? { tone: "verified", label: "Active" }
        : frame < 690
          ? { tone: "alert", label: "Paused" }
          : frame < 930
            ? { tone: "verified", label: "Active · resumed" }
            : { tone: "ink", label: "Settled" };
  const statusKey = status?.label ?? "";
  const statusChangeAt =
    [128, 472, 690, 930].filter((f) => f <= frame).pop() ?? 0;
  const statusPop = prog(frame, statusChangeAt, statusChangeAt + 16);

  const paused = frame >= 472 && frame < 690;
  const pausedAmt = prog(frame, 472, 486) * (1 - prog(frame, 690, 704));

  // ---- milestones ----
  const msState = (i: number): "todo" | "done" | "paused" => {
    const doneAt = [355, 382, 722, 742, 762][i];
    if (frame >= doneAt) return "done";
    if (i === 2 && frame >= 472) return "paused";
    return "todo";
  };

  // ---- readings ----
  const phase = frame < 395 ? "good" : frame < 590 ? "bad" : "private";
  const values = phase === "bad" ? BAD : GOOD;
  const fillStart = phase === "good" ? 200 : 398;
  const fillStep = phase === "good" ? 10 : 7;
  const epochLabel =
    phase === "good"
      ? "Epoch 2 · probe 1 · 8 signed readings"
      : phase === "bad"
        ? "Epoch 3 · probe 1 · 8 signed readings"
        : "Recovery · probe 2 stayed cold · readings hidden";
  const rootShow =
    phase === "good"
      ? prog(frame, 285, 300)
      : phase === "bad"
        ? prog(frame, 452, 464)
        : 0;
  const privacy = prog(frame, 596, 620);

  // ---- log (last three entries) ----
  const visible = LOG.filter((e) => frame >= e.at).slice(-3);

  const lanes = prog(frame, 0, 24);
  const conn = prog(frame, 20, 50);

  return (
    <AbsoluteFill>
      <PaperBg />

      {/* header */}
      {BEATS.map((b, i) => {
        const next = BEATS[i + 1]?.from ?? 1200;
        return (
          <Sequence
            key={b.n}
            from={b.from}
            durationInFrames={next - b.from}
            name={`Title ${b.n}`}
            layout="none"
          >
            <BeatTitle
              n={b.n}
              title={b.title}
              duration={next - b.from}
              last={i === BEATS.length - 1}
            />
          </Sequence>
        );
      })}
      <div
        style={{
          position: "absolute",
          right: 120,
          top: 86,
          height: 60,
          display: "flex",
          alignItems: "center",
        }}
      >
        {status && (
          <div
            key={statusKey}
            style={{
              scale: String(0.85 + 0.15 * statusPop),
              opacity: statusPop,
            }}
          >
            <Pill tone={status.tone} size={28}>
              {status.label}
            </Pill>
          </div>
        )}
      </div>

      {/* evidence lane */}
      <Card
        style={{
          position: "absolute",
          left: 120,
          top: 220,
          width: 1680,
          height: 320,
          opacity: lanes,
        }}
      >
        <Eyebrow style={{ position: "absolute", left: 40, top: 28 }}>
          Evidence
        </Eyebrow>
      </Card>
      <div
        style={{ position: "absolute", left: 160, top: 290, opacity: lanes }}
      >
        <Reefer width={320} ledColor={paused ? C.alert : C.verified} />
      </div>
      <div
        style={{
          position: "absolute",
          left: CELL_X,
          top: 262,
          fontFamily: F.mono,
          fontSize: 20,
          color: C.slate,
          opacity: lanes,
        }}
      >
        {epochLabel}
      </div>
      {values.map((v, i) => {
        const at = fillStart + i * fillStep;
        const filled = frame >= 200 && prog(frame, at, at + 10);
        const bad = phase === "bad" && v > 8;
        const left = CELL_X + i * (CELL_W + CELL_GAP);
        // reading packet from the logger to its cell
        const t = travel(frame, at - 14, at);
        return (
          <React.Fragment key={i}>
            {t > 0 && t < 1 && phase !== "private" && (
              <div
                style={{
                  position: "absolute",
                  left: LOGGER.x + (left + CELL_W / 2 - LOGGER.x) * t - 7,
                  top:
                    LOGGER.y +
                    (330 - LOGGER.y) * t -
                    7 -
                    50 * Math.sin(Math.PI * t),
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  background: C.signal,
                  boxShadow: `0 0 0 2px ${C.ink}`,
                }}
              />
            )}
            <div
              style={{
                position: "absolute",
                left,
                top: 300,
                width: CELL_W,
                height: 120,
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                background: !filled
                  ? C.mist
                  : bad
                    ? "rgba(229,72,77,0.14)"
                    : "rgba(0,196,106,0.12)",
                boxShadow: `inset 0 0 0 2px ${!filled ? C.line : bad ? "rgba(229,72,77,0.55)" : "rgba(0,196,106,0.45)"}`,
                fontFamily: F.mono,
                fontWeight: 500,
                fontSize: 22,
                color: bad ? "#a1191e" : C.ink,
                opacity: lanes,
              }}
            >
              {/* bar */}
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  right: 12,
                  bottom: 12,
                  height: (filled ? 1 : 0) * Math.min(1, (v - 2) / 10) * 60,
                  borderRadius: 6,
                  background: bad ? C.danger : C.verified,
                  opacity: 0.85 * (1 - privacy),
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 16,
                  opacity: (filled ? 1 : 0) * (1 - privacy),
                }}
              >
                {v.toFixed(1)}
              </span>
              {privacy > 0 && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    opacity: privacy,
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      background: C.ink,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: C.signal,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
      {/* 8 °C limit line over the cells */}
      <div
        style={{
          position: "absolute",
          left: CELL_X - 10,
          width: 8 * CELL_W + 7 * CELL_GAP + 20,
          top: 300 + 120 - 12 - ((8 - 2) / 10) * 60,
          borderTop: `2px dashed ${C.alert}`,
          opacity: lerp(frame, [395, 410], [0, 1]) * (1 - privacy),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: CELL_X,
          top: 440,
          fontFamily: F.body,
          fontSize: 22,
          color: C.slate,
          opacity: privacy,
          width: 600,
        }}
      >
        Readings stay private. Only the proof goes on-chain.
      </div>

      {/* Merkle root */}
      <div
        style={{
          position: "absolute",
          left: 1170,
          top: 318,
          opacity: rootShow,
          translate: `${(1 - rootShow) * -20}px 0`,
        }}
      >
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 18,
            color: C.slate,
            letterSpacing: "0.1em",
          }}
        >
          MERKLE ROOT
        </div>
        <div
          style={{
            marginTop: 8,
            padding: "12px 16px",
            borderRadius: 12,
            background: C.ink,
            color: C.signal,
            fontFamily: F.mono,
            fontSize: 22,
          }}
        >
          {phase === "bad" ? "0x41c7…08ae" : "0x9f3a…c21e"}
        </div>
      </div>
      {/* root packet -> chain */}
      {[
        [300, 318],
        [464, 480],
      ].map(([s, e]) => {
        const t = travel(frame, s - 12, e - 12);
        if (t <= 0 || t >= 1) return null;
        return (
          <div
            key={s}
            style={{
              position: "absolute",
              left: ROOT.x + 180 + (1500 - ROOT.x - 180) * t - 8,
              top: ROOT.y - 8 - 30 * Math.sin(Math.PI * t),
              width: 16,
              height: 16,
              borderRadius: 4,
              background: C.signal,
              boxShadow: `0 0 0 2px ${C.ink}`,
            }}
          />
        );
      })}

      {/* chain log */}
      <div
        style={{
          position: "absolute",
          left: 1390,
          top: 244,
          width: 390,
          height: 272,
          borderRadius: 20,
          background: C.ink,
          padding: "20px 22px",
          opacity: lanes,
          boxShadow: paused ? `0 0 0 ${3 * pausedAmt}px ${C.alert}` : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 700,
              fontSize: 22,
              color: C.paper,
            }}
          >
            Robinhood Chain
          </div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 16,
              color: "rgba(247,249,244,0.5)",
            }}
          >
            46630
          </div>
        </div>
        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {visible.map((e) => {
            const p = prog(frame, e.at, e.at + 14);
            const dot = {
              verified: C.verified,
              alert: C.alert,
              danger: C.danger,
              ink: C.signal,
              slate: C.slate,
            }[e.tone];
            return (
              <div
                key={e.at}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(247,249,244,0.06)",
                  opacity: p,
                  translate: `0 ${(1 - p) * 14}px`,
                  fontFamily: F.mono,
                  fontSize: 17,
                  color: C.paper,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: dot,
                    flexShrink: 0,
                  }}
                />
                {e.text}
              </div>
            );
          })}
        </div>
      </div>

      {/* money lane */}
      <Card
        style={{
          position: "absolute",
          left: 120,
          top: 575,
          width: 1680,
          height: 385,
          opacity: lanes,
        }}
      >
        <Eyebrow style={{ position: "absolute", left: 40, top: 28 }}>
          Money · USDG
        </Eyebrow>
      </Card>
      <Connector a={FIN} b={VAULT_L} draw={conn} />
      <Connector a={VAULT_R} b={EXP_L} draw={conn} />
      <Connector a={BUY} b={VAULT_L} draw={prog(frame, 790, 810)} />

      <Node
        left={170}
        top={660}
        width={380}
        kind="financier"
        name="Financier"
        appear={10}
        glow={
          prog(frame, 60, 70) * (1 - prog(frame, 120, 140)) +
          prog(frame, 895, 905) * (1 - prog(frame, 940, 960))
        }
        line={
          financierBack > 0
            ? `+${fmt(FACILITY_USDG)} + ${fmt(FEE_USDG)} fee`
            : `deposits ${fmt(FACILITY_USDG)}`
        }
        flash={prog(frame, 900, 912)}
      />
      <Node
        left={170}
        top={830}
        width={380}
        kind="buyer"
        name="Buyer"
        appear={786}
        glow={prog(frame, 805, 815) * (1 - prog(frame, 860, 880))}
        line={`pays ${fmt(INVOICE_USDG)}`}
      />
      <Node
        left={1390}
        top={714}
        width={370}
        kind="exporter"
        name="Meera"
        appear={16}
        glow={
          prog(frame, 20, 30) * (1 - prog(frame, 60, 80)) +
          prog(frame, 590, 600) * (1 - prog(frame, 660, 680))
        }
        line={
          frame >= 915
            ? `+${fmt(RESIDUAL_USDG)} residual`
            : exporterGot > 0
              ? `received ${fmt(exporterGot)}`
              : "exporter · 5 × 8,000"
        }
        flash={prog(frame, 915, 927)}
      />

      {/* vault */}
      <div
        style={{
          position: "absolute",
          left: 770,
          top: 615,
          width: 380,
          height: 310,
          borderRadius: 24,
          background: C.ink,
          padding: "26px 30px",
          opacity: lanes,
          boxShadow: `0 0 0 ${4 * pausedAmt}px ${C.alert}, 0 30px 60px -30px rgba(11,27,43,0.6)`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 18,
              letterSpacing: "0.12em",
              color: "rgba(247,249,244,0.6)",
            }}
          >
            ESCROW VAULT
          </div>
          <div
            style={{ opacity: pausedAmt, scale: String(0.6 + 0.4 * pausedAmt) }}
          >
            <Lock size={34} />
          </div>
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontWeight: 500,
            fontSize: 64,
            letterSpacing: "-0.04em",
            color: C.paper,
            marginTop: 14,
          }}
        >
          {fmt(Math.max(0, vault))}
        </div>
        <div
          style={{
            fontFamily: F.body,
            fontSize: 22,
            color: "rgba(247,249,244,0.6)",
            marginTop: 2,
          }}
        >
          {frame >= 905 ? "USDG · paid out" : "USDG held"}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 34 }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const s = msState(i);
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: F.mono,
                  fontSize: 18,
                  fontWeight: 700,
                  background:
                    s === "done"
                      ? C.verified
                      : s === "paused"
                        ? C.alert
                        : "rgba(247,249,244,0.08)",
                  color: s === "todo" ? "rgba(247,249,244,0.55)" : C.ink,
                }}
              >
                {s === "done" ? "✓" : `M${i + 1}`}
              </div>
            );
          })}
        </div>
      </div>

      {/* coin flows */}
      <Flow a={FIN} b={VAULT_L} start={66} count={7} />
      <Flow a={VAULT_R} b={EXP_L} start={340} count={4} />
      <Flow a={VAULT_R} b={EXP_L} start={367} count={4} />
      <Flow a={VAULT_R} b={EXP_L} start={706} count={9} />
      <Flow a={BUY} b={VAULT_L} start={808} count={8} />
      <Flow a={VAULT_L} b={FIN} start={884} count={5} arc={40} />
      <Flow a={VAULT_R} b={EXP_L} start={898} count={6} />

      {/* the zero-knowledge proof travels from the exporter's wallet to the chain */}
      {(() => {
        const t = travel(frame, 626, 676);
        const show = prog(frame, 604, 620) * (1 - prog(frame, 690, 706));
        if (show <= 0) return null;
        const x = EXP_TOP.x + (CHAIN_BOTTOM.x - EXP_TOP.x) * t;
        const y = EXP_TOP.y + (CHAIN_BOTTOM.y - EXP_TOP.y) * t;
        return (
          <div
            style={{
              position: "absolute",
              left: x - 140,
              top: y - 70,
              opacity: show,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 18,
                color: C.ink,
                background: C.signal,
                borderRadius: 8,
                padding: "6px 10px",
                whiteSpace: "nowrap",
              }}
            >
              ZK proof
            </div>
            <ProofSeal size={110} seal={prog(frame, 610, 640)} />
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};

const BeatTitle: React.FC<{
  n: string;
  title: string;
  duration: number;
  last: boolean;
}> = ({ n, title, duration, last }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 84,
        display: "flex",
        alignItems: "center",
        gap: 26,
        width: 1400,
      }}
    >
      <div
        style={{
          fontFamily: F.mono,
          fontWeight: 700,
          fontSize: 30,
          color: C.ink,
          background: C.signal,
          borderRadius: 14,
          padding: "12px 16px",
          opacity: prog(frame, 0, 10),
        }}
      >
        {n}
      </div>
      <div
        style={{
          fontFamily: F.display,
          fontWeight: 700,
          fontSize: 50,
          letterSpacing: "-0.035em",
          color: C.ink,
          whiteSpace: "nowrap",
        }}
      >
        <Reveal delay={2} duration={20} out={last ? undefined : duration - 14}>
          {title}
        </Reveal>
      </div>
    </div>
  );
};
