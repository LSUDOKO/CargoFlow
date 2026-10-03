import React from "react";
import { DemoShell, ShotSpec, CastCue } from "./DemoShell";
import { SHOTS } from "./footage";
import { beats } from "./timing";

/**
 * S06 · Live website demo (recording R1, 10 shots). Shot windows are the script's frame ranges;
 * punch-ins sit on the spoken numbers and UI events (12 f in, hold, 12 f out). Punch regions are
 * first guesses in normalised recording coordinates: tune `cx/cy` once the recording exists.
 * Characters change pose on the UI event, never cover a number being read.
 */

const HOST = "cargoflow.adoranto737.workers.dev";

export const S06_SHOTS = (at: ReturnType<typeof beats>): ShotSpec[] => {
  const s = (id: keyof typeof SHOTS, from: number, to: number, url: string, punches: ShotSpec["punches"] = []): ShotSpec => ({ shot: id, from, frames: to - from, url: `${HOST}${url}`, punches });
  return [
    s("R1-01", 0, 120, "/"),
    s("R1-02", 120, 390, "/exporter", [
      { from: at("c066", "pharma") - 120 - 6, to: at("c067", "and") - 120 - 4, scale: 1.6, cx: 0.5, cy: 0.42, label: "Pharma template · 2–8 °C" },
      { from: at("c067", "twenty") - 120 - 6, to: 390 - 120 - 14, scale: 1.6, cx: 0.5, cy: 0.5, label: "Financing · 20 USDG · 5 milestones" },
    ]),
    s("R1-03", 390, 540, "/financier", [{ from: at("c068", "twenty") - 390 - 6, to: 540 - 390 - 14, scale: 1.5, cx: 0.55, cy: 0.5, label: "settlement preview · Facility funded" }]),
    s("R1-04", 540, 750, "/ebl", [
      { from: at("c069", "bill") - 540 - 6, to: at("c070", "and") - 540 - 8, scale: 1.5, cx: 0.45, cy: 0.45, label: "document fingerprint · Issue bill of lading" },
      { from: at("c070", "binds") - 540, to: 750 - 540 - 14, scale: 1.6, cx: 0.7, cy: 0.4, label: "title card · In escrow" },
    ]),
    s("R1-05", 750, 960, "/track/0x…", [{ from: at("c072", "two") - 750 - 4, to: 960 - 750 - 14, scale: 1.5, cx: 0.5, cy: 0.62, label: "M1 · M2 released" }]),
    s("R1-06", 960, 1170, "/track/0x…", [
      { from: at("c073", "Paused") - 960 - 4, to: at("c073", "reasons") - 960 - 6, scale: 1.6, cx: 0.3, cy: 0.2, label: "Paused pill · Failed: facility paused" },
      { from: at("c073", "plain") - 960 - 4, to: 1170 - 960 - 14, scale: 1.5, cx: 0.6, cy: 0.68, label: "Where it stands · What each party does now" },
    ]),
    s("R1-07", 1170, 1380, "/track/0x…", [
      { from: at("c075", "proof") - 1170 - 4, to: at("c075", "review") - 1170 + 6, scale: 1.7, cx: 0.85, cy: 0.12, label: "bell · Proof ready" },
      { from: at("c076", "active") - 1170 - 6, to: 1380 - 1170 - 14, scale: 1.5, cx: 0.4, cy: 0.3, label: "Groth16 proof verified · Active" },
    ]),
    s("R1-08", 1380, 1599, "/track/0x…", [
      { from: at("c077", "passkey") - 1380 - 4, to: at("c077", "gas") - 1380, scale: 1.5, cx: 0.5, cy: 0.5, label: "OS passkey sheet" },
      { from: at("c078", "Settled") - 1380 - 6, to: 1599 - 1380 - 14, scale: 1.5, cx: 0.3, cy: 0.22, label: "Settled · With the buyer" },
    ]),
    s("R1-09", 1599, 1704, "/track/0x…"),
    s("R1-10", 1704, 1860, "/market", [{ from: at("c081", "suggested") - 1704 - 6, to: 1860 - 1704 - 2, scale: 1.7, cx: 0.5, cy: 0.56, label: "Suggested fee · low / mid / high" }]),
  ];
};

export const S06Demo: React.FC = () => {
  const at = beats("S06");
  const shots = S06_SHOTS(at);
  const cast: CastCue[] = [
    { who: "meera", side: "left", from: 0, to: 118, gesture: "wave", gestureAt: 12, gestureEnd: 70, expression: "happy" },
    { who: "meera", side: "left", from: 120, to: 388, prop: "tablet", pose: "hold", gesture: "point", gestureAt: at("c066", "pharma") - 4, gestureEnd: at("c067", "and") + 10, expression: "focused" },
    { who: "daniel", side: "right", from: 390, to: 538, pose: "hold", prop: "phone", gesture: "thumbsUp", gestureAt: at("c068", "escrow") + 4, expression: "confident" },
    { who: "carrier", side: "left", from: 540, to: at("c070", "and") - 4, gesture: "present", gestureAt: 552, prop: "bol", expression: "confident" },
    { who: "meera", side: "left", from: at("c070", "and"), to: 748, prop: "tablet", pose: "hold", gesture: "point", gestureAt: at("c070", "binds"), expression: "focused" },
    { who: "meera", side: "left", from: 750, to: 958, prop: "tablet", pose: "hold", expression: "happy", prevExpression: "focused", expressionAt: at("c072", "paid") },
    { who: "meera", side: "left", from: 960, to: 1168, prop: "tablet", pose: "hold", expression: "worried" },
    { who: "daniel", side: "right", from: 990, to: 1168, prop: "phone", pose: "hold", expression: "focused", h: 360 },
    { who: "meera", side: "left", from: 1170, to: 1378, prop: "phone", pose: "hold", expression: "relieved", prevExpression: "determined", expressionAt: at("c076", "again") },
    { who: "weilin", side: "right", from: 1380, to: 1597, prop: "phone", pose: "hold", gesture: "present", gestureAt: at("c078", "pays"), expression: "happy", prevExpression: "neutral", expressionAt: at("c078", "Settled") },
    { who: "daniel", side: "right", from: 1704, to: 1860, pose: "thinking", gesture: "point", gestureAt: at("c081", "fee"), expression: "focused" },
  ];
  const overlays = [
    { text: "Real testnet transactions", from: 126, to: 386 },
    { text: "20 USDG escrowed", from: at("c068", "deposits"), to: 536 },
    { text: "ERC-721 title · CFEBL", from: 560, to: 746 },
    { text: "Readings never go on chain. Only roots.", from: 770, to: 956 },
    { text: "Readings stay private · Groth16", from: 1190, to: 1376 },
    { text: "30 USDG in → 20.6 Daniel · 9.4 Meera (residual)", from: at("c078", "confirms"), to: 1596 },
    { text: "Financiers choose the fee", from: 1724, to: 1860 },
  ];
  return <DemoShell shots={shots} cast={cast} overlays={overlays} live="LIVE · Robinhood Chain Testnet" />;
};
