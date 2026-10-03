import fs from "node:fs";
import path from "node:path";
import { RECORDER } from "./deps.mjs";
import { Capture } from "./capture.mjs";
import { setShot, txHashes } from "./wallet.mjs";

export const TAKES = path.join(RECORDER, "takes");
fs.mkdirSync(TAKES, { recursive: true });
export const STATE_FILE = path.join(RECORDER, "tmp", "state.json");
export const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
export const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

/** Record one take: capture the page while fn runs; save marks, tx hashes and notes next to the take. */
export async function take(id, page, fn, { suffix = "" } = {}) {
  setShot(id);
  const file = path.join(TAKES, `${id}${suffix}.take.mp4`);
  const cap = new Capture(file);
  const before = txHashes.length;
  const notes = [];
  console.log(`== take ${id}${suffix}`);
  await cap.start(page);
  cap.mark("start");
  let error;
  try {
    await fn(cap, notes);
  } catch (e) {
    error = e;
    console.log(`  !! ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(RECORDER, "tmp", `fail-${id}.png`) }).catch(() => {});
  }
  cap.mark("end");
  const res = await cap.stop();
  const meta = { id, take: path.basename(file), recordedAt: new Date().toISOString(), durationSec: Number(res.durationSec.toFixed(2)), marks: res.marks, txs: txHashes.slice(before), notes, error: error?.message?.split("\n")[0] };
  fs.writeFileSync(path.join(TAKES, `${id}${suffix}.json`), JSON.stringify(meta, null, 2));
  if (error) throw error;
  return meta;
}
