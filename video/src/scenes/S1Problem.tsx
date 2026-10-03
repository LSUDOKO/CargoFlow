import React from "react";
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  useCurrentFrame,
} from "remotion";
import { KenBurns, PaperBg } from "../components/Backgrounds";
import { Beat } from "../components/Beat";
import { Check, Reefer } from "../components/Icons";
import { Card, Eyebrow, Mark, Pill, Reveal, useRise } from "../components/ui";
import { C, F } from "../theme";
import { EASE_IN_OUT, fmt, lerp, prog } from "../lib/anim";
import {
  INVOICE_USDG,
  PAYMENT_TERMS_DAYS,
  PAYMENT_TERMS_LABEL,
  PAYMENT_TERMS_SOURCE,
  PROTAGONIST,
  SME_REJECTION,
  SME_REJECTION_LABEL,
  SPOILAGE_LABEL,
  SPOILAGE_SOURCE,
  SPOILAGE_STAT,
  TRADE_FINANCE_GAP,
  TRADE_FINANCE_GAP_LABEL,
  TRADE_FINANCE_GAP_SOURCE,
} from "../data/facts";

// 0:08–0:40 · 960 frames
// Beats follow the voice-over in captions.json:
// A 0–185 Meera ships · B 185–440 credit terms + costs paid today · C 440–630 the bank is blind
// D 630–815 the gap + the losses · E 815–960 paperwork vs physics

const Headline: React.FC<{
  eyebrow: string;
  children: React.ReactNode;
  sub?: React.ReactNode;
  tag?: string;
  source?: React.ReactNode;
  sourceDelay?: number;
}> = ({ eyebrow, children, sub, tag, source, sourceDelay = 40 }) => (
  <div style={{ position: "absolute", left: 120, top: 330, width: 780 }}>
    <Reveal delay={4} duration={18}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {tag && (
          <span
            style={{
              fontFamily: F.body,
              fontSize: 17,
              fontWeight: 600,
              color: C.slate,
              padding: "4px 10px",
              borderRadius: 8,
              boxShadow: `inset 0 0 0 1.5px ${C.line}`,
            }}
          >
            {tag}
          </span>
        )}
      </div>
    </Reveal>
    <div
      style={{
        fontFamily: F.display,
        fontWeight: 700,
        fontSize: 96,
        lineHeight: 1.02,
        letterSpacing: "-0.045em",
        color: C.ink,
        marginTop: 22,
      }}
    >
      {children}
    </div>
    {sub && (
      <Reveal delay={30} duration={22} style={{ marginTop: 30 }}>
        <div
          style={{
            fontFamily: F.body,
            fontSize: 34,
            lineHeight: 1.4,
            color: C.slate,
            maxWidth: 700,
          }}
        >
          {sub}
        </div>
      </Reveal>
    )}
    {source && (
      <Reveal delay={sourceDelay} duration={18} style={{ marginTop: 26 }}>
        <div
          style={{
            fontFamily: F.body,
            fontSize: 19,
            color: "rgba(91,107,123,0.85)",
            maxWidth: 700,
          }}
        >
          {source}
        </div>
      </Reveal>
    )}
  </div>
);

/** Beat A: the shipment leaves. */
const Ships: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = lerp(frame, [14, 80], [0, 1], EASE_IN_OUT);
  const ship = lerp(frame, [24, 185], [0, 0.6], EASE_IN_OUT);
  // quadratic arc from (40,90) to (680,90) with control (360,10)
  const P = (t: number) => {
    const x = (1 - t) ** 2 * 40 + 2 * (1 - t) * t * 360 + t ** 2 * 680;
    const y = (1 - t) ** 2 * 90 + 2 * (1 - t) * t * 10 + t ** 2 * 90;
    return { x, y };
  };
  const s = P(ship);
  const card = useRise(10, 50);
  return (
    <AbsoluteFill>
      <Headline
        eyebrow={`Meet ${PROTAGONIST} · vaccine exporter, Pune`}
        tag="Illustrative"
        sub={
          <>
            Pune to Singapore via Nhava Sheva. Invoice{" "}
            <span style={{ fontFamily: F.mono, color: C.ink }}>
              ${fmt(INVOICE_USDG)}
            </span>
            .
          </>
        }
      >
        <Reveal delay={8}>The goods ship</Reveal>
        <Reveal delay={14}>
          <Mark delay={40}>today.</Mark>
        </Reveal>
      </Headline>
      <Card
        style={{
          position: "absolute",
          left: 980,
          top: 190,
          width: 820,
          height: 690,
          overflow: "hidden",
          ...card,
        }}
      >
        <div style={{ position: "relative", height: 390, overflow: "hidden" }}>
          <KenBurns
            src="assets/vials-a.webp"
            from={[1.05, 0, 0]}
            to={[1.18, -2, 1]}
            dim={0.1}
          />
          <div
            style={{
              position: "absolute",
              left: 28,
              bottom: 24,
              display: "flex",
              gap: 12,
            }}
          >
            <Pill tone="ink" size={22}>
              Cargo · vaccines
            </Pill>
            <Pill
              tone="slate"
              onDark
              size={22}
              dot={false}
              style={{ background: "rgba(11,27,43,0.6)" }}
            >
              <span style={{ fontFamily: F.mono }}>2–8 °C, door to door</span>
            </Pill>
          </div>
        </div>
        <div style={{ padding: "26px 50px 0" }}>
          <svg
            width={720}
            height={170}
            viewBox="0 0 720 170"
            style={{ display: "block", overflow: "visible" }}
          >
            <path
              d="M40 90 Q360 10 680 90"
              fill="none"
              stroke={C.line}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray="2 16"
            />
            <path
              d="M40 90 Q360 10 680 90"
              fill="none"
              stroke={C.ink}
              strokeWidth={6}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
            {[
              { x: 40, label: "Nhava Sheva", anchor: "start" as const },
              { x: 680, label: "Singapore", anchor: "end" as const },
            ].map((p) => (
              <g key={p.label}>
                <circle
                  cx={p.x}
                  cy={90}
                  r={14}
                  fill={C.paper}
                  stroke={C.ink}
                  strokeWidth={5}
                />
                <text
                  x={p.x}
                  y={142}
                  textAnchor={p.anchor}
                  fontFamily={F.display}
                  fontWeight={600}
                  fontSize={28}
                  fill={C.ink}
                >
                  {p.label}
                </text>
              </g>
            ))}
            <g transform={`translate(${s.x} ${s.y})`}>
              <rect
                x={-30}
                y={-17}
                width={60}
                height={34}
                rx={6}
                fill={C.signal}
                stroke={C.ink}
                strokeWidth={4}
              />
              <path
                d="M-14 -9v18M-2 -9v18M10 -9v18"
                stroke={C.ink}
                strokeWidth={3}
                strokeOpacity={0.5}
              />
            </g>
          </svg>
          <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
            <Pill tone="verified" size={22}>
              Shipped · day 0
            </Pill>
            <Pill tone="slate" size={22} dot={false}>
              <span style={{ fontFamily: F.mono }}>REEFER 2041</span>
            </Pill>
          </div>
        </div>
      </Card>
    </AbsoluteFill>
  );
};

/** Beat B: credit terms. The calendar fills to day 52 while the costs are paid today. */
const Waits: React.FC = () => {
  const frame = useCurrentFrame();
  const day = Math.floor(
    lerp(frame, [16, 150], [0, PAYMENT_TERMS_DAYS], (t) => t),
  );
  const cash = lerp(frame, [130, 230], [100, 9], EASE_IN_OUT);
  const card = useRise(6, 50);
  const costs = ["Vaccines", "Reefer", "Freight"];
  return (
    <AbsoluteFill>
      <Headline
        eyebrow="She sells on credit"
        sub={
          <>But the vaccines, the reefer and the freight are paid for today.</>
        }
        source={<>India average B2B payment terms · {PAYMENT_TERMS_SOURCE}</>}
        sourceDelay={24}
      >
        <Reveal delay={8}>Cash arrives in</Reveal>
        <Reveal delay={14}>
          <Mark delay={36}>{PAYMENT_TERMS_LABEL}.</Mark>
        </Reveal>
      </Headline>
      <Card
        style={{
          position: "absolute",
          left: 980,
          top: 215,
          width: 820,
          height: 640,
          padding: "56px 56px",
          ...card,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <Eyebrow>Days until she is paid</Eyebrow>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 64,
              fontWeight: 500,
              color: C.ink,
              letterSpacing: "-0.03em",
            }}
          >
            {String(day).padStart(2, "0")}
            <span style={{ fontSize: 30, color: C.slate }}>
              {" "}
              / {PAYMENT_TERMS_DAYS}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(13, 1fr)",
            gap: 10,
            marginTop: 22,
          }}
        >
          {Array.from({ length: PAYMENT_TERMS_DAYS }).map((_, i) => {
            const filled = i < day;
            return (
              <div
                key={i}
                style={{
                  height: 38,
                  borderRadius: 9,
                  background: filled ? C.ink : C.mist,
                  boxShadow: filled ? "none" : `inset 0 0 0 1.5px ${C.line}`,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 40 }}>
          {costs.map((c, i) => {
            const at = 130 + i * 14;
            const p = prog(frame, at, at + 12);
            return (
              <div
                key={c}
                style={{
                  flex: 1,
                  position: "relative",
                  padding: "16px 18px",
                  borderRadius: 14,
                  background: C.mist,
                  boxShadow: `inset 0 0 0 1.5px ${C.line}`,
                  fontFamily: F.body,
                  fontWeight: 600,
                  fontSize: 25,
                  color: C.ink,
                  opacity: prog(frame, 110 + i * 6, 126 + i * 6),
                }}
              >
                {c}
                <span
                  style={{
                    position: "absolute",
                    right: 12,
                    top: 13,
                    padding: "3px 10px",
                    borderRadius: 7,
                    boxShadow: `inset 0 0 0 2.5px ${C.danger}`,
                    color: C.danger,
                    fontFamily: F.mono,
                    fontWeight: 700,
                    fontSize: 19,
                    rotate: "-8deg",
                    opacity: p,
                    scale: String(1.6 - 0.6 * p),
                  }}
                >
                  PAID
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 38 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: F.body,
              fontSize: 26,
              color: C.slate,
            }}
          >
            <span>Cash on hand</span>
            <span
              style={{
                fontFamily: F.mono,
                color: cash < 30 ? C.danger : C.ink,
              }}
            >
              {Math.round(cash)}%
            </span>
          </div>
          <div
            style={{
              height: 22,
              borderRadius: 99,
              background: C.mist,
              marginTop: 14,
              boxShadow: `inset 0 0 0 1.5px ${C.line}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${cash}%`,
                height: "100%",
                background: interpolateColors(
                  cash,
                  [10, 40, 100],
                  [C.danger, C.alert, C.verified],
                ),
                borderRadius: 99,
              }}
            />
          </div>
        </div>
      </Card>
    </AbsoluteFill>
  );
};

/** Beat C: the financier is blind to the cargo. */
const Blind: React.FC = () => {
  const frame = useCurrentFrame();
  const q = lerp(frame, [60, 90], [0, 1]);
  const docs = ["Invoice PDF", "Bill of lading", "Packing list"];
  const card = useRise(6, 50);
  return (
    <AbsoluteFill>
      <Headline
        eyebrow="Her bank"
        sub={<>So it lends late, expensive, or not at all.</>}
        sourceDelay={70}
        source={
          <>
            <span
              style={{
                fontFamily: F.mono,
                fontWeight: 700,
                color: C.ink,
                fontSize: 24,
              }}
            >
              {SME_REJECTION}
            </span>{" "}
            {SME_REJECTION_LABEL} · {TRADE_FINANCE_GAP_SOURCE}
          </>
        }
      >
        <Reveal delay={8}>Can&apos;t see</Reveal>
        <Reveal delay={14}>
          <Mark delay={40}>the container.</Mark>
        </Reveal>
      </Headline>
      <Card
        style={{
          position: "absolute",
          left: 980,
          top: 190,
          width: 820,
          height: 690,
          padding: "60px 56px",
          ...card,
        }}
      >
        <Eyebrow>What the financier gets</Eyebrow>
        <div style={{ display: "flex", gap: 14, marginTop: 22 }}>
          {docs.map((d, i) => {
            const p = prog(frame, 20 + i * 8, 40 + i * 8);
            return (
              <div
                key={d}
                style={{
                  opacity: p,
                  translate: `0 ${(1 - p) * 16}px`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 18px",
                  borderRadius: 14,
                  background: C.mist,
                  boxShadow: `inset 0 0 0 1.5px ${C.line}`,
                  fontFamily: F.body,
                  fontWeight: 600,
                  fontSize: 24,
                  color: C.ink,
                }}
              >
                <Check size={26} draw={prog(frame, 34 + i * 8, 50 + i * 8)} />
                {d}
              </div>
            );
          })}
        </div>
        <div
          style={{ marginTop: 90, display: "flex", justifyContent: "center" }}
        >
          <Reefer width={600} question={q} />
        </div>
        <div
          style={{
            textAlign: "center",
            marginTop: 40,
            fontFamily: F.mono,
            fontSize: 24,
            color: C.slate,
            opacity: q,
          }}
        >
          temperature · location · condition: unknown
        </div>
        {["LATER", "COSTLIER", "DECLINED"].map((w, i) => {
          const at = 84 + i * 16;
          const p = prog(frame, at, at + 10);
          return (
            <div
              key={w}
              style={{
                position: "absolute",
                right: 40 + i * 6,
                top: 250 + i * 92,
                padding: "8px 18px",
                borderRadius: 10,
                boxShadow: `inset 0 0 0 4px ${i === 2 ? C.danger : C.alert}`,
                background: "rgba(255,255,255,0.92)",
                color: i === 2 ? C.danger : "#8a5300",
                fontFamily: F.mono,
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "0.06em",
                rotate: `${-10 + i * 6}deg`,
                opacity: p,
                scale: String(1.8 - 0.8 * p),
              }}
            >
              {w}
            </div>
          );
        })}
      </Card>
    </AbsoluteFill>
  );
};

const StatCard: React.FC<{
  delay: number;
  value: string;
  label: string;
  source: string;
  accent: string;
}> = ({ delay, value, label, source, accent }) => {
  const frame = useCurrentFrame();
  const rise = useRise(delay, 60, 26);
  const bar = prog(frame, delay + 10, delay + 40);
  return (
    <Card
      style={{
        width: 820,
        height: 470,
        padding: 60,
        position: "relative",
        overflow: "hidden",
        ...rise,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 12,
          background: accent,
          scale: `1 ${bar}`,
          transformOrigin: "top",
        }}
      />
      <div
        style={{
          fontFamily: F.display,
          fontWeight: 700,
          fontSize: 132,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: C.ink,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: F.body,
          fontSize: 36,
          lineHeight: 1.35,
          color: C.ink,
          marginTop: 26,
          maxWidth: 640,
        }}
      >
        {label}
      </div>
      <div
        style={{
          position: "absolute",
          left: 56,
          bottom: 44,
          fontFamily: F.mono,
          fontSize: 18,
          color: C.slate,
          letterSpacing: "0.04em",
        }}
      >
        SOURCE · {source}
      </div>
    </Card>
  );
};

/** Beat D: the size of the problem. */
const Stats: React.FC = () => (
  <AbsoluteFill>
    <div style={{ position: "absolute", left: 120, top: 170 }}>
      <Reveal delay={2}>
        <Eyebrow>The cost of not seeing</Eyebrow>
      </Reveal>
      <div
        style={{
          fontFamily: F.display,
          fontWeight: 700,
          fontSize: 80,
          letterSpacing: "-0.045em",
          color: C.ink,
          marginTop: 16,
        }}
      >
        <Reveal delay={6}>Capital stays away. Cargo goes bad.</Reveal>
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        left: 120,
        top: 400,
        display: "flex",
        gap: 40,
      }}
    >
      <StatCard
        delay={18}
        value={TRADE_FINANCE_GAP}
        label={TRADE_FINANCE_GAP_LABEL}
        source={TRADE_FINANCE_GAP_SOURCE}
        accent={C.signal}
      />
      <StatCard
        delay={66}
        value={SPOILAGE_STAT}
        label={SPOILAGE_LABEL}
        source={SPOILAGE_SOURCE}
        accent={C.alert}
      />
    </div>
  </AbsoluteFill>
);

/** Beat E: paperwork vs physics. */
const Punchline: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = lerp(frame, [40, 100], [0, 1], EASE_IN_OUT);
  const pts = [4.6, 4.8, 4.7, 5.0, 5.4, 6.3, 7.4, 8.6, 9.5, 10.1];
  const x = (i: number) => (i / (pts.length - 1)) * 640;
  const y = (v: number) => 220 - ((v - 3) / 8) * 200;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ");
  const breach = prog(frame, 90, 104);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 190,
          display: "flex",
          gap: 40,
        }}
      >
        <Card
          style={{ width: 820, height: 690, padding: 60, ...useRise(0, 40) }}
        >
          <Eyebrow>Paperwork</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              marginTop: 30,
            }}
          >
            <Check size={72} draw={prog(frame, 14, 34)} />
            <div
              style={{
                fontFamily: F.display,
                fontWeight: 700,
                fontSize: 84,
                letterSpacing: "-0.045em",
                color: C.ink,
              }}
            >
              says fine.
            </div>
          </div>
          <div style={{ marginTop: 70, display: "grid", gap: 26 }}>
            {[90, 72, 84, 60, 78, 50].map((w, i) => (
              <div
                key={i}
                style={{
                  height: 22,
                  width: `${w}%`,
                  borderRadius: 9,
                  background: C.mist,
                  boxShadow: `inset 0 0 0 1.5px ${C.line}`,
                }}
              />
            ))}
          </div>
        </Card>
        <Card
          style={{ width: 820, height: 690, padding: 60, ...useRise(30, 40) }}
        >
          <Eyebrow>Physics</Eyebrow>
          <div
            style={{
              fontFamily: F.display,
              fontWeight: 700,
              fontSize: 84,
              letterSpacing: "-0.045em",
              marginTop: 24,
              color: interpolateColors(breach, [0, 1], [C.ink, C.danger]),
            }}
          >
            disagrees.
          </div>
          <svg
            width={700}
            height={330}
            viewBox="-14 -40 668 300"
            style={{ marginTop: 50, overflow: "visible" }}
          >
            <rect
              x={0}
              y={y(8)}
              width={640}
              height={y(2) - y(8)}
              fill={C.verified}
              opacity={0.08}
            />
            <path
              d={`M0 ${y(8)} H640`}
              stroke={C.alert}
              strokeWidth={3}
              strokeDasharray="8 8"
            />
            <text
              x={0}
              y={y(8) - 12}
              textAnchor="start"
              fontFamily={F.mono}
              fontSize={20}
              fill="#8a5300"
            >
              8 °C limit
            </text>
            <path
              d={d}
              fill="none"
              stroke={interpolateColors(breach, [0, 1], [C.ink, C.danger])}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
            <circle cx={x(9)} cy={y(10.1)} r={12 * breach} fill={C.danger} />
            <text
              x={x(9) - 4}
              y={y(10.1) - 26}
              textAnchor="end"
              fontFamily={F.mono}
              fontWeight={700}
              fontSize={30}
              fill={C.danger}
              opacity={breach}
            >
              10.1 °C
            </text>
          </svg>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

export const S1Problem: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <PaperBg />
      {/* thin progress rule across the top: the story's clock */}
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          top: 72,
          height: 3,
          background: C.line,
        }}
      >
        <div
          style={{
            width: `${interpolate(frame, [0, 960], [0, 100], { extrapolateRight: "clamp" })}%`,
            height: "100%",
            background: C.ink,
          }}
        />
      </div>
      <Beat from={0} duration={185} fadeIn={0} name="Ships">
        <Ships />
      </Beat>
      <Beat from={185} duration={255} name="Waits">
        <Waits />
      </Beat>
      <Beat from={440} duration={190} name="Blind">
        <Blind />
      </Beat>
      <Beat from={630} duration={185} name="Stats">
        <Stats />
      </Beat>
      <Beat from={815} duration={175} fadeOut={0} name="Punchline">
        <Punchline />
      </Beat>
    </AbsoluteFill>
  );
};
