import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE } from "../lib/anim";
import { F } from "../theme";
import { P } from "./palette";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const FRAME_SHADOW = "0 1px 0 rgba(11,27,43,0.05), 0 24px 48px -24px rgba(11,27,43,0.28)";

/* ------------------------------------------------------------------------------------------
 * Browser frame for screen recordings
 * ---------------------------------------------------------------------------------------- */

/**
 * Chrome-like window: tab strip, URL bar with lock + `url`, content area for children
 * (e.g. an <OffthreadVideo> of a screen recording). Content area size = width × (height − 92).
 */
export const BrowserFrame: React.FC<{
  url: string;
  title?: string;
  width?: number;
  height?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ url, title = "CargoFlow", width = 1440, height = 900, children, style }) => {
  const [host, ...rest] = url.replace(/^https?:\/\//, "").split("/");
  const path = rest.length ? `/${rest.join("/")}` : "";
  return (
    <div style={{ width, height, borderRadius: 16, overflow: "hidden", background: P.white, boxShadow: FRAME_SHADOW, border: `1px solid ${P.line}`, display: "flex", flexDirection: "column", ...style }}>
      <div style={{ height: 44, background: P.mist, display: "flex", alignItems: "flex-end", padding: "0 14px", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, alignSelf: "center" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: 6, background: P.line }} />
          ))}
        </div>
        <div style={{ height: 34, minWidth: 240, background: P.white, borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", fontFamily: F.body, fontSize: 14, color: P.ink }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, background: P.signal, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 6, height: 6, borderRadius: 2, background: P.ink }} />
          </div>
          {title}
          <span style={{ marginLeft: "auto", color: P.slate, fontSize: 13 }}>×</span>
        </div>
      </div>
      <div style={{ height: 48, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderBottom: `1px solid ${P.line}` }}>
        <div style={{ display: "flex", gap: 14, color: P.slate, fontFamily: F.body, fontSize: 18 }}>
          <span>←</span>
          <span style={{ opacity: 0.4 }}>→</span>
          <span>↻</span>
        </div>
        <div style={{ flex: 1, height: 32, borderRadius: 16, background: P.mist, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", fontFamily: F.body, fontSize: 15 }}>
          <svg width={12} height={14} viewBox="0 0 12 14">
            <rect x={1} y={6} width={10} height={8} rx={2} fill={P.slate} />
            <path d="M3 6 V4 a3 3 0 0 1 6 0 v2" stroke={P.slate} strokeWidth={1.8} fill="none" />
          </svg>
          <span style={{ color: P.ink }}>{host}</span>
          <span style={{ color: P.slate, marginLeft: -10 }}>{path}</span>
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: P.paper }}>{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Chat window (MCP segment)
 * ---------------------------------------------------------------------------------------- */

export type ChatMessage =
  | { role: "user"; text: string; at: number }
  | { role: "assistant"; text: string; at: number; cps?: number }
  | { role: "tool"; name: string; detail?: string; at: number; doneAt?: number };

/**
 * Neutral chat UI with the assistant named "Claude" in plain text (no logo). Messages appear at
 * their `at` frame; assistant text types on at `cps` chars/s; tool calls show a running state
 * and resolve with a check at `doneAt`.
 */
export const ChatWindow: React.FC<{
  messages: ChatMessage[];
  width?: number;
  height?: number;
  assistantName?: string;
  connector?: string;
  style?: React.CSSProperties;
}> = ({ messages, width = 1100, height = 760, assistantName = "Claude", connector = "cargoflow MCP", style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const visible = messages.filter((m) => frame >= m.at);
  return (
    <div style={{ width, height, borderRadius: 20, overflow: "hidden", background: P.white, border: `1px solid ${P.line}`, boxShadow: FRAME_SHADOW, display: "flex", flexDirection: "column", fontFamily: F.body, ...style }}>
      <div style={{ height: 64, borderBottom: `1px solid ${P.line}`, display: "flex", alignItems: "center", padding: "0 24px", gap: 12 }}>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 22, color: P.ink }}>{assistantName}</div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, background: P.mist, fontFamily: F.mono, fontSize: 13, color: P.ink }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: P.verified }} />
          {connector}
        </div>
      </div>
      <div style={{ flex: 1, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16, justifyContent: "flex-end", overflow: "hidden" }}>
        {visible.map((m, i) => {
          const k = spring({ frame: frame - m.at, fps, config: { damping: 16, stiffness: 180 } });
          const enter: React.CSSProperties = { opacity: k, transform: `translateY(${(1 - k) * 14}px)` };
          if (m.role === "user") {
            return (
              <div key={i} style={{ ...enter, alignSelf: "flex-end", maxWidth: "72%", background: P.ink, color: P.white, padding: "14px 18px", borderRadius: "18px 18px 4px 18px", fontSize: 19, lineHeight: 1.45 }}>
                {m.text}
              </div>
            );
          }
          if (m.role === "tool") {
            const done = m.doneAt !== undefined && frame >= m.doneAt;
            const spin = ((frame - m.at) * 12) % 360;
            return (
              <div key={i} style={{ ...enter, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, border: `1px solid ${P.line}`, background: P.paper, fontFamily: F.mono, fontSize: 15, color: P.ink }}>
                {done ? (
                  <svg width={18} height={18} viewBox="0 0 18 18">
                    <circle cx={9} cy={9} r={9} fill={P.verified} />
                    <path d="M5 9.5 l2.6 2.6 L13 6.5" stroke={P.white} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width={18} height={18} viewBox="0 0 18 18" style={{ transform: `rotate(${spin}deg)` }}>
                    <circle cx={9} cy={9} r={7} stroke={P.line} strokeWidth={2.5} fill="none" />
                    <path d="M9 2 a7 7 0 0 1 7 7" stroke={P.ink} strokeWidth={2.5} fill="none" strokeLinecap="round" />
                  </svg>
                )}
                <span style={{ fontWeight: 700 }}>{m.name}</span>
                {m.detail ? <span style={{ color: P.slate }}>{m.detail}</span> : null}
              </div>
            );
          }
          const cps = m.cps ?? 45;
          const n = Math.floor(((frame - m.at) / fps) * cps);
          const text = m.text.slice(0, n);
          return (
            <div key={i} style={{ ...enter, alignSelf: "flex-start", maxWidth: "82%", color: P.ink, fontSize: 19, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              <div style={{ fontFamily: F.mono, fontSize: 12, color: P.slate, letterSpacing: 1, marginBottom: 4 }}>{assistantName.toUpperCase()}</div>
              {text}
              {n < m.text.length ? <span style={{ display: "inline-block", width: 9, height: 20, background: P.ink, marginLeft: 2, verticalAlign: "-3px", opacity: Math.floor(frame / 8) % 2 ? 1 : 0.3 }} /> : null}
            </div>
          );
        })}
      </div>
      <div style={{ margin: "0 24px 24px", height: 56, borderRadius: 14, border: `1px solid ${P.line}`, display: "flex", alignItems: "center", padding: "0 18px", color: P.slate, fontSize: 17 }}>
        Reply to {assistantName}…
        <div style={{ marginLeft: "auto", width: 34, height: 34, borderRadius: 10, background: P.ink, display: "flex", alignItems: "center", justifyContent: "center", color: P.white, fontSize: 18 }}>↑</div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Notification toast
 * ---------------------------------------------------------------------------------------- */

export type ToastTone = "danger" | "alert" | "verified" | "ink";
const TONE: Record<ToastTone, string> = { danger: P.danger, alert: P.alert, verified: P.verified, ink: P.ink };

const ToneIcon: React.FC<{ tone: ToastTone }> = ({ tone }) => (
  <svg width={22} height={22} viewBox="0 0 22 22">
    {tone === "verified" ? (
      <path d="M6 11.5 l3.2 3.2 L16 8" stroke={P.white} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ) : tone === "ink" ? (
      <circle cx={11} cy={11} r={4} fill={P.signal} />
    ) : (
      <g stroke={P.white} strokeWidth={2.6} strokeLinecap="round">
        <path d="M11 6 v6" />
        <path d="M11 16 v0.1" />
      </g>
    )}
  </svg>
);

/** Push-notification card that slides in from the right at `at` (and out at `outAt`). */
export const Toast: React.FC<{
  tone?: ToastTone;
  title: string;
  body?: string;
  app?: string;
  time?: string;
  at?: number;
  outAt?: number;
  width?: number;
  style?: React.CSSProperties;
}> = ({ tone = "danger", title, body, app = "CargoFlow", time = "now", at = 0, outAt, width = 520, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 170 } });
  const o = outAt === undefined ? 0 : interpolate(frame, [outAt, outAt + 12], [0, 1], { ...clamp, easing: EASE });
  const c = TONE[tone];
  return (
    <div
      style={{
        width,
        display: "flex",
        gap: 16,
        padding: "18px 20px",
        borderRadius: 18,
        background: P.white,
        border: `1px solid ${P.line}`,
        boxShadow: FRAME_SHADOW,
        fontFamily: F.body,
        transform: `translateX(${(1 - k) * 60 + o * 60}px)`,
        opacity: Math.min(1, k * 1.4) * (1 - o),
        ...style,
      }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 12, background: c, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <ToneIcon tone={tone} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", fontFamily: F.mono, fontSize: 12, color: P.slate, letterSpacing: 1 }}>
          {app.toUpperCase()}
          <span style={{ marginLeft: "auto" }}>{time}</span>
        </div>
        <div style={{ fontWeight: 600, fontSize: 19, color: P.ink, marginTop: 4 }}>{title}</div>
        {body ? <div style={{ fontSize: 16, color: P.slate, marginTop: 2, lineHeight: 1.4 }}>{body}</div> : null}
      </div>
      <div style={{ width: 4, borderRadius: 2, background: c, flex: "none" }} />
    </div>
  );
};

/* ------------------------------------------------------------------------------------------
 * Sponsor wordmarks (plain type, never recreated logos)
 * ---------------------------------------------------------------------------------------- */

/** A sponsor / integration name set as a clean wordmark in brand type, in a neutral slot. */
export const SponsorWordmark: React.FC<{ name: string; caption?: string; status?: string; at?: number; width?: number; style?: React.CSSProperties }> = ({ name, caption, status, at, width = 260, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = at === undefined ? 1 : spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 170 } });
  return (
    <div
      style={{
        width,
        minHeight: 96,
        padding: "12px 0",
        boxSizing: "border-box",
        borderRadius: 16,
        background: P.white,
        border: `1px solid ${P.line}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity: k,
        transform: `translateY(${(1 - k) * 16}px)`,
        ...style,
      }}
    >
      <div style={{ fontFamily: F.display, fontWeight: 600, fontSize: 28, color: P.ink, letterSpacing: -0.4 }}>{name}</div>
      {caption ? <div style={{ fontFamily: F.mono, fontSize: 12, color: P.slate, letterSpacing: 1 }}>{caption.toUpperCase()}</div> : null}
      {status ? (
        <div style={{ marginTop: 4, fontFamily: F.mono, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: status.startsWith("live") ? P.emeraldSoft : P.mist, color: status.startsWith("live") ? P.verifiedShade : P.slate }}>{status}</div>
      ) : null}
    </div>
  );
};

/** A wrapped row of wordmark slots with staggered entrance from `at`. */
export const SponsorRow: React.FC<{ items: { name: string; caption?: string; status?: string }[]; at?: number; stagger?: number; slotWidth?: number; gap?: number }> = ({
  items,
  at,
  stagger = 4,
  slotWidth = 260,
  gap = 16,
}) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap }}>
    {items.map((it, i) => (
      <SponsorWordmark key={it.name} name={it.name} caption={it.caption} status={it.status} at={at === undefined ? undefined : at + i * stagger} width={slotWidth} />
    ))}
  </div>
);
