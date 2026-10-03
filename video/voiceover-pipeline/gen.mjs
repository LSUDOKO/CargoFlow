#!/usr/bin/env node
// Generate one HeyGen Starfish TTS take per caption cue (raw mp3 + HeyGen word
// timestamps) into ./raw/<scene>-<index>.{mp3,words.json}.
//
// Uses the media-use skill's shared HeyGen code (.agents/skills/media-use), so
// auth is the same as `npx hyperframes auth status` (~/.heygen/credentials or
// $HEYGEN_API_KEY). Existing takes are skipped, so a re-run only fills gaps.
//
//   node gen.mjs                 # all missing cues, default speed 1.0
//   node gen.mjs S1-03 S4-11     # only these cues (regenerates even if present)
//   node gen.mjs --force         # regenerate everything
//
// Per-cue speed overrides live in speeds.json ({"S1-07": 1.08}); build.py
// reports which cues overrun their caption window and need one.
// Stops at the first HTTP 402 (out of HeyGen voice credit) instead of burning
// retries on every remaining cue.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const { synthesizeHeygen } = await import(
  join(REPO, ".agents/skills/media-use/audio/scripts/lib/tts.mjs")
);

const VOICE_ID = "f43e55ae9fb540c6b62e23081c951748"; // Vincent - Thoughtful & Clear (see public/audio/VOICE.md)
const CONCURRENCY = 4;

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((a) => !a.startsWith("--")));

const captions = JSON.parse(readFileSync(join(HERE, "../captions.json"), "utf8"));
const speeds = existsSync(join(HERE, "speeds.json"))
  ? JSON.parse(readFileSync(join(HERE, "speeds.json"), "utf8"))
  : {};
const texts = existsSync(join(HERE, "text-overrides.json"))
  ? JSON.parse(readFileSync(join(HERE, "text-overrides.json"), "utf8"))
  : {};

const counts = {};
const cues = captions.map((c) => {
  counts[c.scene] = (counts[c.scene] ?? 0) + 1;
  const id = `${c.scene}-${String(counts[c.scene]).padStart(2, "0")}`;
  return { id, text: texts[id] ?? c.text, speed: speeds[id] ?? 1.0 };
});

const todo = cues.filter((c) => {
  if (only.size) return only.has(c.id);
  return force || !existsSync(join(HERE, "raw", `${c.id}.mp3`));
});
console.log(`${todo.length} cue(s) to generate with voice ${VOICE_ID}`);
mkdirSync(join(HERE, "raw"), { recursive: true });

let outOfCredit = false;
let failed = 0;
async function one(c) {
  if (outOfCredit) return;
  const base = join(HERE, "raw", c.id);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await synthesizeHeygen({
      text: c.text,
      voiceId: VOICE_ID,
      lang: "en",
      speed: c.speed,
      wavAbs: `${base}.mp3`,
    });
    if (r.ok) {
      writeFileSync(
        `${base}.words.json`,
        JSON.stringify({ text: c.text, voiceId: VOICE_ID, speed: c.speed, words: r.words }, null, 1),
      );
      console.log(`✓ ${c.id} (speed ${c.speed}, ${r.words.length} words)`);
      return;
    }
    if (/HTTP 402|insufficient_credit/.test(r.error ?? "")) {
      outOfCredit = true;
      console.error(`✗ ${c.id}: HeyGen voice credit exhausted (HTTP 402). Stopping.`);
      return;
    }
    console.error(`… ${c.id} attempt ${attempt}: ${r.error}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
  failed++;
}

const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length && !outOfCredit) await one(queue.shift());
  }),
);
if (outOfCredit || failed) process.exit(1);
