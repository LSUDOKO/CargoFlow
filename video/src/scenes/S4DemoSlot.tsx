import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { z } from "zod";
import { InkBg } from "../components/Backgrounds";
import { LowerThird } from "../components/LowerThird";
import { Eyebrow, Pill } from "../components/ui";
import { C, F } from "../theme";
import { prog } from "../lib/anim";
import { APP_URL } from "../data/facts";

// 1:30–2:45 · 2250 frames. public/demo/demo-75s.mp4 (scripts/fit-demo.mjs) is picked up automatically.

export const labelSchema = z.object({
  fromSec: z.number(),
  toSec: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
});

export const demoSchema = z.object({
  /** Path inside public/ (e.g. "demo/recording.mp4") or a full URL. Empty = placeholder. */
  demoSrc: z.string().optional(),
  /** Length of the demo slot in frames at 30 fps. Set it to the recording's length. */
  demoDurationInFrames: z.number().int().min(30),
  /** Skip this many frames at the start of the recording. */
  demoTrimBeforeFrames: z.number().int().min(0).optional(),
  /** Silence the clip's own audio (set automatically when audio/mix.wav already carries it). */
  demoMuted: z.boolean().optional(),
  /** Pick up public/demo/demo-75s.mp4 and public/audio/mix.wav automatically when the props are empty. Default true. */
  autoMedia: z.boolean().optional(),
  /** Lift the lower thirds clear of the caption bar (Full sets this when captions are on). */
  raiseLabels: z.boolean().optional(),
  /** Lower-third labels, timed in seconds from the start of the demo slot. */
  labels: z.array(labelSchema),
});

export type DemoProps = z.infer<typeof demoSchema>;

const FRAME = { left: 160, top: 60, width: 1600, bar: 52 };
const CONTENT_H = (FRAME.width * 9) / 16; // 900

const resolveSrc = (src: string) =>
  /^https?:\/\//.test(src) ? src : staticFile(src);

/** Lower-third baseline: 40 px above the browser frame's bottom edge; with captions, clear of the raised caption bar. */
const LABEL_BOTTOM = 1080 - FRAME.top - FRAME.bar - CONTENT_H + 40; // 108
export const LABEL_BOTTOM_WITH_CAPTIONS = 178;

export const S4DemoSlot: React.FC<DemoProps> = ({
  demoSrc,
  demoTrimBeforeFrames,
  demoMuted,
  labels,
  raiseLabels,
}) => {
  const frame = useCurrentFrame();
  const enter = prog(frame, 0, 26);
  return (
    <AbsoluteFill>
      <InkBg grid bloom="rgba(10,90,115,0.35)" />
      <div
        style={{
          position: "absolute",
          left: FRAME.left,
          top: FRAME.top,
          width: FRAME.width,
          height: FRAME.bar + CONTENT_H,
          borderRadius: 22,
          overflow: "hidden",
          background: C.ink2,
          boxShadow:
            "inset 0 0 0 1.5px rgba(247,249,244,0.1), 0 60px 120px -40px rgba(0,0,0,0.75)",
          opacity: enter,
          scale: String(0.94 + 0.06 * enter),
        }}
      >
        {/* browser chrome */}
        <div
          style={{
            height: FRAME.bar,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 20px",
            background: "#0F2236",
            borderBottom: "1px solid rgba(247,249,244,0.08)",
          }}
        >
          {["#E5484D", "#FFB020", "#00C46A"].map((c) => (
            <span
              key={c}
              style={{
                width: 14,
                height: 14,
                borderRadius: 99,
                background: c,
                opacity: 0.85,
              }}
            />
          ))}
          <div
            style={{
              marginLeft: 24,
              flex: 1,
              maxWidth: 820,
              height: 32,
              borderRadius: 10,
              background: "rgba(247,249,244,0.07)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "0 14px",
              fontFamily: F.mono,
              fontSize: 18,
              color: "rgba(247,249,244,0.75)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24">
              <path
                d="M7 11V8a5 5 0 0110 0v3"
                fill="none"
                stroke="rgba(247,249,244,0.6)"
                strokeWidth="2.5"
              />
              <rect
                x="5"
                y="11"
                width="14"
                height="10"
                rx="2"
                fill="rgba(247,249,244,0.6)"
              />
            </svg>
            {APP_URL}
          </div>
          <div style={{ marginLeft: "auto" }}>
            <Pill tone="verified" onDark size={17}>
              Robinhood Chain Testnet
            </Pill>
          </div>
        </div>
        {/* content */}
        <div
          style={{
            position: "relative",
            width: FRAME.width,
            height: CONTENT_H,
            background: C.paper,
          }}
        >
          {demoSrc ? (
            <OffthreadVideo
              src={resolveSrc(demoSrc)}
              trimBefore={demoTrimBeforeFrames || undefined}
              muted={demoMuted}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                background: C.paper,
              }}
            />
          ) : (
            <Placeholder labels={labels} />
          )}
        </div>
      </div>
      {labels.map((l, i) => (
        <LowerThird
          key={i}
          label={l}
          left={FRAME.left + 40}
          bottom={raiseLabels ? LABEL_BOTTOM_WITH_CAPTIONS : LABEL_BOTTOM}
        />
      ))}
    </AbsoluteFill>
  );
};

const Placeholder: React.FC<{ labels: DemoProps["labels"] }> = ({ labels }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(11,27,43,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(11,27,43,0.05) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div style={{ position: "absolute", left: 90, top: 90, width: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 99,
              background: C.danger,
              opacity: 0.4 + 0.6 * Math.abs(Math.sin(frame / 14)),
            }}
          />
          <Eyebrow>Live demo · screen recording slot</Eyebrow>
        </div>
        <div
          style={{
            fontFamily: F.display,
            fontWeight: 700,
            fontSize: 88,
            lineHeight: 1.02,
            letterSpacing: "-0.045em",
            color: C.ink,
            marginTop: 26,
          }}
        >
          One shipment, from facility to settlement.
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 26,
            color: C.teal,
            marginTop: 34,
          }}
        >
          https://{APP_URL}
        </div>
        <div
          style={{
            fontFamily: F.body,
            fontSize: 22,
            color: C.slate,
            marginTop: 40,
            lineHeight: 1.5,
          }}
        >
          Save the take as{" "}
          <span style={{ fontFamily: F.mono, color: C.ink }}>
            public/demo/recording.mp4
          </span>
          , fill{" "}
          <span style={{ fontFamily: F.mono, color: C.ink }}>cuts.json</span>{" "}
          and run{" "}
          <span style={{ fontFamily: F.mono, color: C.ink }}>
            bash scripts/finalize.sh
          </span>
          .
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 90,
          top: 90,
          width: 600,
          display: "grid",
          gap: 10,
        }}
      >
        {labels.map((l, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              padding: "13px 20px",
              borderRadius: 16,
              background: "#fff",
              boxShadow: `inset 0 0 0 1.5px ${C.line}`,
            }}
          >
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 20,
                color: C.slate,
                width: 70,
              }}
            >
              {`${Math.floor(l.fromSec / 60)}:${String(Math.floor(l.fromSec % 60)).padStart(2, "0")}`}
            </span>
            <span
              style={{
                fontFamily: F.display,
                fontWeight: 600,
                fontSize: 25,
                color: C.ink,
                letterSpacing: "-0.01em",
              }}
            >
              {l.title}
            </span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
