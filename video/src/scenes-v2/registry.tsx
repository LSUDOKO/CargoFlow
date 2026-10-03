import React from "react";
import { S00ColdOpen } from "./S00ColdOpen";
import { S01Meera } from "./S01Meera";
import { S02Daniel } from "./S02Daniel";
import { S03Fragile } from "./S03Fragile";
import { S04Line } from "./S04Line";
import { S05aFacility } from "./S05aFacility";
import { S05bEvidence } from "./S05bEvidence";
import { S05cRelease } from "./S05cRelease";
import { S05dExcursion } from "./S05dExcursion";
import { S05eRecovery } from "./S05eRecovery";
import { S05fSettlement } from "./S05fSettlement";
import { S05gCover } from "./S05gCover";
import { S06Demo } from "./S06Demo";
import { S07Claude } from "./S07Claude";
import { S08Developers } from "./S08Developers";
import { S09Sponsors } from "./S09Sponsors";
import { S10Proof } from "./S10Proof";
import { S11Outro } from "./S11Outro";
import { SceneId } from "./timing";

/** Scene id -> component, and the transition INTO each scene (from SCRIPT-v2 "Transitions"). */
export const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  S00: S00ColdOpen,
  S01: S01Meera,
  S02: S02Daniel,
  S03: S03Fragile,
  S04: S04Line,
  S05a: S05aFacility,
  S05b: S05bEvidence,
  S05c: S05cRelease,
  S05d: S05dExcursion,
  S05e: S05eRecovery,
  S05f: S05fSettlement,
  S05g: S05gCover,
  S06: S06Demo,
  S07: S07Claude,
  S08: S08Developers,
  S09: S09Sponsors,
  S10: S10Proof,
  S11: S11Outro,
};

export type TransitionKind = "cut" | "fade" | "wipe";

export const TRANSITION_IN: Partial<Record<SceneId, { kind: TransitionKind; frames: number }>> = {
  // S00 -> S01 match cut (PDF tile -> desk map): a 6 f dissolve keeps the shape match soft
  S01: { kind: "fade", frames: 6 },
  // S01 -> S02 "Cut to Daniel", S02 -> S03 cut on "And", S03 -> S04 match cut on the line
  S02: { kind: "cut", frames: 0 },
  S03: { kind: "cut", frames: 0 },
  S04: { kind: "cut", frames: 0 },
  // S04 -> S05a route wipe: navy gives way to the paper map
  S05a: { kind: "wipe", frames: 20 },
  // S05 beats share one set: short dissolves
  S05b: { kind: "fade", frames: 10 },
  S05c: { kind: "fade", frames: 10 },
  S05d: { kind: "fade", frames: 10 },
  S05e: { kind: "fade", frames: 10 },
  S05f: { kind: "fade", frames: 10 },
  S05g: { kind: "fade", frames: 10 },
  // S05g -> S06 quick route wipe into the browser
  S06: { kind: "wipe", frames: 16 },
  S07: { kind: "cut", frames: 0 },
  S08: { kind: "fade", frames: 8 },
  S09: { kind: "wipe", frames: 16 },
  S10: { kind: "cut", frames: 0 },
  // S11 runs its own navy wipe along the through-line after its 30 f quay shot
  S11: { kind: "fade", frames: 8 },
};
