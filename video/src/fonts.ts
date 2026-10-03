import { continueRender, delayRender, staticFile } from "remotion";
import fonts from "../public/fonts/fonts.json";

/**
 * The film's fonts, bundled in public/fonts/ (latin subset, variable woff2; fetched once by scripts/fetch-fonts.mjs),
 * so a render never depends on fonts.googleapis.com. Each family is registered for its whole weight range.
 */
type Entry = { family: string; unicodeRange: string; files: Record<string, string> };
const ENTRIES = fonts as Record<string, Entry>;

const loaded = new Set<string>();
const load = (e: Entry) => {
  if (typeof document === "undefined" || loaded.has(e.family)) return;
  loaded.add(e.family);
  const byFile = new Map<string, number[]>();
  for (const [w, f] of Object.entries(e.files)) byFile.set(f, [...(byFile.get(f) ?? []), Number(w)]);
  for (const [file, weights] of byFile) {
    const handle = delayRender(`font ${e.family}`);
    const face = new FontFace(e.family, `url(${staticFile(`fonts/${file}`)}) format("woff2")`, {
      weight: `${Math.min(...weights)} ${Math.max(...weights)}`,
      style: "normal",
      unicodeRange: e.unicodeRange,
    });
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(`font ${e.family} failed`, err);
        continueRender(handle);
      });
  }
};

Object.values(ENTRIES).forEach(load);

export const FONT = {
  display: `"${ENTRIES.SpaceGrotesk.family}", sans-serif`,
  body: `"${ENTRIES.Inter.family}", sans-serif`,
  mono: `"${ENTRIES.JetBrainsMono.family}", monospace`,
};
