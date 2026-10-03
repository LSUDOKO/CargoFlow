// Live passkey check (no recording): create or sign in to a passkey account on the live site with the virtual
// authenticator, open the wallet menu and log every ZeroDev call (method, HTTP status, short response). The passkey
// credential and the site storage are kept in tmp/passkey so later runs reuse the same smart account.
//   node passkey-probe.mjs create|signin [/path]
import fs from "node:fs";
import path from "node:path";
import { RECORDER } from "./lib/deps.mjs";
process.env.CF_PASSKEY_DIR ||= path.join(RECORDER, "tmp", "passkey");
const { addAuthenticator, PASSKEY_STATE } = await import("./lib/passkey.mjs");
const { SITE, TMP, closeBrowser, newSession } = await import("./lib/session.mjs");
const { sleep } = await import("./lib/cursor.mjs");
const { watchZeroDev } = await import("./lib/zerodev.mjs");

const [mode = "create", p = "/"] = process.argv.slice(2);
const storageState = mode !== "create" && fs.existsSync(PASSKEY_STATE) ? PASSKEY_STATE : undefined;
const { context, page } = await newSession({ roles: [], storageState });
const auth = await addAuthenticator(page);
const zdLog = [];
watchZeroDev(page, zdLog);
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log(`  [console.${m.type()}] ${m.text().slice(0, 300)}`); });

await page.goto(SITE + p, { waitUntil: "load" });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await sleep(2000);
await page.getByRole("button", { name: /Connect wallet/ }).first().click();
await sleep(800);
await page.getByText("Continue with passkey").first().click();
await sleep(800);
const shot = (n) => page.screenshot({ path: path.join(TMP, `probe-${n}.png`) });
if (mode === "create") {
  await page.getByRole("button", { name: "Create a passkey account" }).click();
} else if (await page.getByRole("button", { name: "Sign in with an existing passkey" }).isVisible().catch(() => false)) {
  await page.getByRole("button", { name: "Sign in with an existing passkey" }).click();
}
const badge = page.getByText("Passkey account", { exact: true }).first();
try {
  await badge.waitFor({ timeout: 60000 });
} catch (e) {
  await shot("fail");
  console.log("no passkey account badge:", (await page.locator("[role=alert]").allInnerTexts().catch(() => [])).join(" | "));
  throw e;
}
console.log("credentials saved:", await auth.save());
await context.storageState({ path: PASSKEY_STATE });
await sleep(1500);
const btn = page.locator("header button[aria-haspopup=menu]").first();
await btn.click();
await sleep(6000);
const menu = page.getByRole("menu");
const menuText = (await menu.innerText().catch(() => "")).replace(/\s+/g, " ");
console.log("menu:", menuText.slice(0, 400));
const addr = menuText.match(/0x[0-9a-fA-F]{40}/)?.[0];
console.log("smart account:", addr);
await shot("menu");
fs.writeFileSync(path.join(TMP, "passkey-account.json"), JSON.stringify({ address: addr, at: new Date().toISOString() }, null, 2));
await context.storageState({ path: PASSKEY_STATE });
console.log("zerodev calls:");
for (const z of zdLog) console.log("  ", JSON.stringify(z));
await closeBrowser();
