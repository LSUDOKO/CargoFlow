import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { P } from "../assets/palette";
import { F } from "../theme";
import { FPS, WORDS, Word } from "./timing";

/**
 * Lower-third captions driven by the placed voice-over's word timings: one cue at a time
 * (paged so it never exceeds two lines), the word being spoken gets a lime marker, words already
 * spoken are ink, words still to come are ink at 38 %. Inter 600 on a white pill, bottom centre.
 * `offset` = the absolute film frame of this composition's frame 0 (for per-scene previews).
 */

const MAX_CHARS_PER_PAGE = 96;

type Page = { cue: string; words: Word[]; start: number; end: number };

const toF = (ms: number) => (ms / 1000) * FPS;

const PAGES: Page[] = (() => {
  const byCue = new Map<string, Word[]>();
  WORDS.forEach((w) => {
    const list = byCue.get(w.cue) ?? [];
    list.push(w);
    byCue.set(w.cue, list);
  });
  const pages: Page[] = [];
  byCue.forEach((ws, cue) => {
    let cur: Word[] = [];
    let len = 0;
    const flush = () => {
      if (cur.length) pages.push({ cue, words: cur, start: toF(cur[0].startMs), end: toF(cur[cur.length - 1].endMs) });
      cur = [];
      len = 0;
    };
    ws.forEach((w) => {
      if (len + w.word.length + 1 > MAX_CHARS_PER_PAGE) flush();
      cur.push(w);
      len += w.word.length + 1;
    });
    flush();
  });
  return pages.sort((a, b) => a.start - b.start);
})();

export const CaptionsV2: React.FC<{ offset?: number; size?: number }> = ({ offset = 0, size = 34 }) => {
  const frame = useCurrentFrame() + offset;
  const idx = PAGES.findIndex((p, i) => {
    const next = PAGES[i + 1];
    const showFrom = p.start - 5;
    const showTo = Math.min(p.end + 14, next ? next.start - 6 : Infinity);
    return frame >= showFrom && frame < showTo;
  });
  if (idx < 0) return null;
  const page = PAGES[idx];
  const next = PAGES[idx + 1];
  const showTo = Math.min(page.end + 14, next ? next.start - 6 : Infinity);
  const k = Math.min(
    interpolate(frame, [page.start - 5, page.start + 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(frame, [showTo - 6, showTo], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 38, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1180,
          padding: "12px 26px 13px",
          borderRadius: 22,
          background: "rgba(255,255,255,0.94)",
          boxShadow: "0 1px 0 rgba(11,27,43,0.06), 0 14px 32px -18px rgba(11,27,43,0.35)",
          border: `1px solid ${P.line}`,
          opacity: k,
          transform: `translateY(${(1 - k) * 10}px)`,
          fontFamily: F.body,
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.32,
          letterSpacing: -0.2,
          textAlign: "center",
          color: P.ink,
        }}
      >
        {page.words.map((w, i) => {
          const s = toF(w.startMs);
          const e = toF(w.endMs);
          const active = frame >= s && frame < Math.max(e, s + 4);
          const said = frame >= s;
          return (
            <React.Fragment key={i}>
              <span
                style={{
                  color: said ? P.ink : "rgba(11,27,43,0.38)",
                  backgroundColor: active ? P.signal : "transparent",
                  borderRadius: 6,
                  padding: "0 4px",
                  margin: "0 -4px",
                  boxDecorationBreak: "clone",
                }}
              >
                {w.word}
              </span>
              {i < page.words.length - 1 ? " " : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
