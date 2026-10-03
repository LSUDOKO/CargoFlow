// D8 with a real passkey: Wei Lin signs in with her passkey (Chromium virtual authenticator holding the credential
// created by passkey-probe.mjs), confirms delivery and pays the invoice from her ZeroDev Kernel smart account. Every
// action is a user operation through ZeroDev's bundler; the paymaster (CargoFlow's gas policy) pays the gas.
//   node passkey-probe.mjs create                                   (once: creates the passkey + smart account)
//   node --experimental-strip-types passkey-shipment.ts <account>   (a shipment with that account as buyer)
//   node passkey-d8.mjs                                             (this take; uses tmp/passkey-shipment.json)
import fs from "node:fs";
import path from "node:path";
import { RECORDER } from "./lib/deps.mjs";
process.env.CF_PASSKEY_DIR ||= path.join(RECORDER, "tmp", "passkey");
const { addAuthenticator } = await import("./lib/passkey.mjs");
const { SITE, TMP, closeBrowser, newSession } = await import("./lib/session.mjs");
const { sleep } = await import("./lib/cursor.mjs");
const { take } = await import("./lib/take.mjs");
const { watchZeroDev } = await import("./lib/zerodev.mjs");

const ship = JSON.parse(fs.readFileSync(path.join(TMP, "passkey-shipment.json"), "utf8"));
const ID = "D8-buyer-passkey-settled";
const TXLOG = path.join(RECORDER, "txlog.jsonl");

const { page, cursor } = await newSession({ roles: [] });
await addAuthenticator(page);
const zd = [];
watchZeroDev(page, zd);
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error" && !/Content Security Policy/.test(m.text())) consoleErrors.push(m.text().slice(0, 300)); });

const text = (t, opts) => page.getByText(t, opts).first();
const waitText = (t, timeout = 180_000) => page.getByText(t).first().waitFor({ state: "visible", timeout });

await page.goto(`${SITE}/track/${ship.shipmentId}`, { waitUntil: "load" });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await sleep(2500);
cursor.x = 1300; cursor.y = 300;

let meta, failure;
try {
  meta = await take(ID, page, async (cap, notes) => {
    notes.push(`shipment ${ship.ref} ${ship.shipmentId}; buyer is the passkey smart account ${ship.buyer}`);
    await cursor.sync();
    await sleep(700);
    await cursor.click(page.getByRole("button", { name: /Connect wallet/ }).first(), { after: 900 });
    cap.mark("modal");
    await cursor.click(text("Continue with passkey"), { after: 900 });
    cap.mark("passkey");
    await cursor.click(page.getByRole("button", { name: "Sign in with an existing passkey" }), { after: 300 });
    cap.mark("signin");
    const badge = page.locator("header").getByText("Passkey account", { exact: true }).first();
    await badge.waitFor({ timeout: 60000 });
    cap.mark("account");
    await sleep(600);
    await cursor.hover(badge, { settle: 900 });
    await cursor.click(page.locator("header button[aria-haspopup=menu]").first(), { after: 600 });
    cap.mark("menu");
    const gas = page.getByRole("menu").getByText(/Gas paid by CargoFlow|Gas sponsorship/).first();
    await gas.waitFor({ timeout: 30000 }).catch(() => {});
    const menuText = (await page.getByRole("menu").innerText().catch(() => "")).replace(/\s+/g, " ");
    notes.push(`wallet menu: ${menuText.slice(0, 200)}`);
    await cursor.hover(gas, { settle: 1400 }).catch(() => {});
    cap.mark("gas");
    await cursor.click(page.locator("header button[aria-haspopup=menu]").first(), { after: 500 });
    const confirm = page.getByRole("button", { name: "Confirm delivery" }).first();
    await confirm.waitFor({ timeout: 60000 });
    await cursor.scrollTo(confirm, { at: 0.5 }).catch(() => {});
    await cursor.click(confirm, { after: 300 });
    cap.mark("confirm");
    await waitText("Delivery confirmed", 180000);
    cap.mark("delivered");
    await sleep(1200);
    const approve = page.getByRole("button", { name: /Approve 30 USDG/ }).first();
    await approve.waitFor({ timeout: 60000 });
    await cursor.click(approve, { after: 300 });
    cap.mark("approve");
    await waitText("Vault approved", 180000);
    cap.mark("approved");
    const pay = page.getByRole("button", { name: /Pay the 30 USDG invoice/ }).first();
    await page.waitForFunction((el) => !el.disabled, await pay.elementHandle(), { timeout: 60000 }).catch(() => {});
    await sleep(400);
    await cursor.click(pay, { after: 300 });
    cap.mark("pay");
    await waitText("Invoice paid and settled", 180000);
    cap.mark("settled");
    await sleep(2000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1800);
    await cursor.hover(text("Settled", { exact: true }), { settle: 1500 }).catch(() => {});
    cap.mark("pill");
    await sleep(600);
  });
} catch (e) {
  failure = e;
} finally {
  // user operations: hashes from the bundler, and the transactions that carried them
  const ops = zd.filter((z) => z.method === "eth_sendUserOperation").map((z) => z.body.match(/"result":"(0x[0-9a-f]{64})"/)?.[1]).filter(Boolean);
  const receipts = zd.filter((z) => z.method === "eth_getUserOperationReceipt" && /"transactionHash"/.test(z.body));
  const sponsor = zd.filter((z) => /sponsor/i.test(z.method)).map((z) => `${z.status} ${/"error"/.test(z.body) ? z.body.slice(0, 200) : /"paymaster"/.test(z.body) ? "sponsored (paymaster set)" : z.body.slice(0, 120)}`);
  fs.writeFileSync(path.join(TMP, "passkey-d8-zerodev.json"), JSON.stringify(zd, null, 2));
  console.log("userOps:", ops);
  console.log("sponsor responses:", sponsor);
  console.log("receipts seen:", receipts.length);
  console.log("console errors:", consoleErrors);
  const metaFile = path.join(RECORDER, "takes", `${ID}.json`);
  if (fs.existsSync(metaFile)) {
    const m = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    m.userOps = ops;
    m.sponsor = sponsor;
    m.consoleErrors = consoleErrors;
    fs.writeFileSync(metaFile, JSON.stringify(m, null, 2));
  }
  for (const h of ops) fs.appendFileSync(TXLOG, JSON.stringify({ at: new Date().toISOString(), shot: ID, role: "buyer (passkey)", from: ship.buyer, userOpHash: h }) + "\n");
  if (failure) await page.screenshot({ path: path.join(TMP, "passkey-d8-fail.png") }).catch(() => {});
  await closeBrowser();
}
if (failure) throw failure;
console.log("take", meta?.durationSec, "s");
