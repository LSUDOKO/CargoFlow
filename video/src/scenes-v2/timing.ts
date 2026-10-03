import words from "../../public/audio/voiceover-v2.words.json";

/**
 * Scene table from SCRIPT-v2.md (frames at 30 fps) and word timings from the placed
 * voice-over (public/audio/voiceover-v2.words.json). Every beat in the film is anchored to a
 * spoken word, so re-timing the VO re-times the picture.
 */

export const FPS = 30;

export type SceneId =
  | "S00"
  | "S01"
  | "S02"
  | "S03"
  | "S04"
  | "S05a"
  | "S05b"
  | "S05c"
  | "S05d"
  | "S05e"
  | "S05f"
  | "S05g"
  | "S06"
  | "S07"
  | "S08"
  | "S09"
  | "S10"
  | "S11";

export const SCENES: { id: SceneId; from: number; frames: number; title: string }[] = [
  { id: "S00", from: 0, frames: 315, title: "Cold open" },
  { id: "S01", from: 315, frames: 690, title: "Meera and the 52-day wait" },
  { id: "S02", from: 1005, frames: 810, title: "Daniel lends blind" },
  { id: "S03", from: 1815, frames: 405, title: "The cargo is fragile" },
  { id: "S04", from: 2220, frames: 360, title: "The line" },
  { id: "S05a", from: 2580, frames: 450, title: "Facility, escrow, place milestones" },
  { id: "S05b", from: 3030, frames: 570, title: "Signed readings, epochs, fusion, score" },
  { id: "S05c", from: 3600, frames: 360, title: "Release, place hold, humidity and shock" },
  { id: "S05d", from: 3960, frames: 570, title: "Excursion, conflict, pause, AI ratchet" },
  { id: "S05e", from: 4530, frames: 510, title: "Automatic ZK recovery" },
  { id: "S05f", from: 5040, frames: 570, title: "Delivery, waterfall, eBL under DvP" },
  { id: "S05g", from: 5610, frames: 510, title: "Default cover, parametric cover, arbiter" },
  { id: "S06", from: 6120, frames: 1860, title: "Live website demo" },
  { id: "S07", from: 7980, frames: 600, title: "CargoFlow in claude.ai" },
  { id: "S08", from: 8580, frames: 330, title: "Developer platform" },
  { id: "S09", from: 8910, frames: 390, title: "Sponsors, honestly" },
  { id: "S10", from: 9300, frames: 300, title: "Proof" },
  { id: "S11", from: 9600, frames: 290, title: "Outro" },
];

// 9,890 f = 329.67 s, the length of public/audio/mix-v2.wav (the outro card holds through the music fade)
export const TOTAL_FRAMES = 9890;

export const scene = (id: SceneId) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
};

export type Word = { word: string; startMs: number; endMs: number; cue: string };
export const WORDS: Word[] = words;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9'-]/g, "");
const toF = (ms: number) => Math.round((ms / 1000) * FPS);

const cueWords = (cue: string) => {
  const ws = WORDS.filter((w) => w.cue === cue);
  if (!ws.length) throw new Error(`no words for cue ${cue}`);
  return ws;
};

const findWord = (cue: string, word?: string | number) => {
  const ws = cueWords(cue);
  if (word === undefined) return ws[0];
  if (typeof word === "number") return ws[Math.max(0, Math.min(ws.length - 1, word))];
  const w = ws.find((x) => norm(x.word) === norm(word)) ?? ws.find((x) => norm(x.word).startsWith(norm(word)));
  if (!w) throw new Error(`word "${word}" not in ${cue}`);
  return w;
};

/** Absolute film frame at which `word` (text or index; default first word) of `cue` starts. */
export const wf = (cue: string, word?: string | number) => toF(findWord(cue, word).startMs);
/** Absolute film frame at which `word` of `cue` ends (default: the cue's last word). */
export const wfEnd = (cue: string, word?: string | number) => {
  const ws = cueWords(cue);
  return toF((word === undefined ? ws[ws.length - 1] : findWord(cue, word)).endMs);
};

/** Scene-relative word timing: `const at = beats("S02"); at("c015","blind")`. */
export const beats = (id: SceneId) => {
  const from = scene(id).from;
  const at = (cue: string, word?: string | number) => wf(cue, word) - from;
  const end = (cue: string, word?: string | number) => wfEnd(cue, word) - from;
  return Object.assign(at, { end, from, frames: scene(id).frames });
};
