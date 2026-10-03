// Dry-run helper: open a path with the demo wallet and save a screenshot (no recording).
//   node explore.mjs /path [role] [--connect]
import path from "node:path";
import { SITE, TMP, closeBrowser, newSession } from "./lib/session.mjs";

const [p = "/", role = "exporter"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const { page } = await newSession({ roles: [role] });
await page.goto(SITE + p, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2500);
const shot = path.join(TMP, `explore-${p.replace(/[^a-z0-9]+/gi, "_")}.png`);
await page.screenshot({ path: shot, fullPage: process.argv.includes("--full") });
console.log(shot);
await closeBrowser();
