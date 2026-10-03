// The live lifecycle on a fresh shipment, recorded shot by shot (R1 D2-D9) with real testnet transactions:
//   node shots-flow.mjs D2 D3 D4 D5 D6 D7 D7b D8 D9      (any contiguous subset; state in tmp/state.json)
// Each shot is one take in takes/<shotId>.take.mp4 with marks; final clips are cut by edit.mjs.
import fs from "node:fs";
import path from "node:path";
import { viem } from "./lib/deps.mjs";
import { address, deployments, publicClient } from "./lib/chain.mjs";
import { SITE, TMP, closeBrowser, newSession, preconnect } from "./lib/session.mjs";
import { sleep } from "./lib/cursor.mjs";
import { take, state, saveState } from "./lib/take.mjs";
import { makePdf } from "./lib/docs.mjs";
import { makeLeg } from "./lib/csv.mjs";

const EXPORTER = address("exporter"), FINANCIER = address("financier"), BUYER = address("buyer");
const sessions = {};
async function session(role, { connect = true } = {}) {
  if (sessions[role]) return sessions[role];
  const s = await newSession({ roles: [role] });
  if (connect) await preconnect(s.context, role);
  s.page.on("download", async (d) => {
    const f = path.join(TMP, `dl-${role}-${d.suggestedFilename()}`);
    await d.saveAs(f).catch(() => {});
    s.lastDownload = f;
    console.log(`  download ${path.basename(f)}`);
  });
  sessions[role] = s;
  return s;
}
async function load(s, url) {
  await s.page.goto(url, { waitUntil: "load" });
  await s.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
}
const text = (page, t, opts) => page.getByText(t, opts).first();
async function waitText(page, t, timeout = 180_000) {
  await page.getByText(t).first().waitFor({ state: "visible", timeout });
}
async function chooseFile(page, cursor, trigger, file) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15000 }), cursor.click(trigger, { after: 100 })]);
  await chooser.setFiles(file);
  await sleep(600);
}
const trackUrl = () => `${SITE}/track/${state.shipmentId}`;

async function freshRef() {
  const abi = viem.parseAbi(["function shipmentIdFor(address,bytes32) view returns (bytes32)"]);
  for (let n = 201; n < 400; n++) {
    const ref = `CF-SG-VAX-0${n}`;
    const id = await publicClient.readContract({ address: deployments.contracts.shipmentRegistry, abi, functionName: "shipmentIdFor", args: [EXPORTER, viem.keccak256(viem.toBytes(ref))] });
    const r = await fetch(`https://cargoflow-api-75ul.onrender.com/v1/shipments/${id}`);
    if (r.status === 404) {
      // double-check on chain: getShipment(id).exists
      const g = viem.parseAbi(["function getShipment(bytes32) view returns ((bytes32 id, address exporter, address buyer, bytes32 invoiceHash, bytes32 routeCommitment, bytes32 policyCommitment, uint256 invoiceValue, uint64 createdAt, bool exists))"]);
      const sh = await publicClient.readContract({ address: deployments.contracts.shipmentRegistry, abi: g, functionName: "getShipment", args: [id] }).catch(() => null);
      if (!sh?.exists) return ref;
    }
  }
  throw new Error("no free reference");
}

const SHOTS = {
  async D2() {
    const s = await session("exporter");
    const { page, cursor } = s;
    const ref = state.pendingRef || (await freshRef());
    state.pendingRef = ref;
    saveState();
    const invoicePdf = await makePdf("invoice", ref, ["Seller: Meera Exports, Nhava Sheva, IN", "Buyer: Wei Lin Pharma Distribution, Singapore", "Goods: Vaccines, 2-8 °C, 1 x 40' reefer", "Amount: 30.00 USDG (testnet)"]);
    await load(s, `${SITE}/exporter`);
    cursor.x = 1300; cursor.y = 420;
    await take("D2-exporter-wizard", page, async (cap, notes) => {
      notes.push(`reference ${ref}`);
      await cursor.sync();
      await sleep(800);
      cap.mark("shipment");
      await cursor.type(page.getByLabel("Shipment reference"), ref);
      await cursor.type(page.getByLabel("Invoice value (USDG)"), "30");
      await cursor.paste(page.getByLabel("Buyer address"), BUYER);
      await chooseFile(page, cursor, text(page, "Choose the invoice file"), invoicePdf);
      await waitText(page, "On-chain invoice hash", 20000);
      await sleep(600);
      cap.mark("filled1");
      await cursor.click(page.getByRole("button", { name: "Continue" }), { after: 900 });
      cap.mark("policy");
      await cursor.click(page.getByRole("radio", { name: /Pharma/ }), { after: 1300 });
      cap.mark("pharma");
      await cursor.hover(page.getByLabel("Maximum temperature"), { settle: 500 });
      await cursor.click(page.getByRole("button", { name: "Continue" }), { after: 900 });
      cap.mark("financing");
      await cursor.paste(page.getByLabel("Financier address"), FINANCIER);
      await cursor.type(page.getByLabel("Total facility (USDG)"), "20");
      await cursor.hover(page.getByLabel("Milestones"), { settle: 900 });
      cap.mark("tranches");
      await cursor.hover(text(page, "Where milestones release"), { settle: 600 });
      cap.mark("places");
      await cursor.click(page.getByRole("button", { name: "Continue" }), { after: 500 });
      await cursor.scrollTo(page.getByRole("heading", { name: "Review" }), { at: 0.12, ms: 900 });
      await sleep(900);
      cap.mark("review");
      await cursor.click(page.getByRole("button", { name: "Sign and submit" }), { after: 200 });
      cap.mark("signing");
      await cursor.moveTo(1350, 560, { ms: 600 });
      await waitText(page, "Shipment registered on-chain", 120000);
      cap.mark("tick1");
      await waitText(page, "Cold-chain policy set", 120000);
      cap.mark("tick2");
      await waitText(page, "Financing facility opened", 120000);
      cap.mark("tick3");
      await waitText(page, "Your shipment is ready for funding", 120000);
      cap.mark("ready");
      await cursor.hover(page.getByRole("link", { name: "View dashboard" }), { settle: 1500 });
      const href = await page.getByRole("link", { name: "View dashboard" }).getAttribute("href");
      state.shipmentId = href.split("/").pop();
      state.ref = ref;
      delete state.pendingRef;
      saveState();
      notes.push(`shipment ${state.shipmentId}`);
      await sleep(500);
    });
  },

  async D3() {
    const s = await session("financier");
    const { page, cursor } = s;
    await load(s, `${SITE}/financier`);
    const row = page.locator("li, article, div").filter({ hasText: state.ref }).filter({ has: page.getByRole("button", { name: /Approve 20 USDG|Deposit 20 USDG/ }) }).last();
    for (let i = 0; ; i++) {
      try { await row.waitFor({ timeout: 25000 }); break; } catch (e) { if (i > 8) throw e; await load(s, `${SITE}/financier`); }
    }
    await row.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    await sleep(1200);
    cursor.x = 1400; cursor.y = 380;
    await take("D3-financier-funds", page, async (cap) => {
      await cursor.sync();
      await sleep(900);
      cap.mark("card");
      await cursor.hover(row.getByText(/If the invoice is paid today|financier receives/).first(), { settle: 1200 });
      cap.mark("preview");
      await cursor.click(row.getByRole("button", { name: /Approve 20 USDG/ }), { after: 300 });
      cap.mark("approve");
      await waitText(page, "Vault approved", 120000);
      cap.mark("approved");
      const dep = row.getByRole("button", { name: /Deposit 20 USDG/ });
      await dep.waitFor({ state: "visible" });
      await page.waitForFunction((el) => !el.disabled, await dep.elementHandle(), { timeout: 60000 }).catch(() => {});
      await sleep(500);
      await cursor.click(dep, { after: 300 });
      cap.mark("deposit");
      await waitText(page, "Facility funded", 120000);
      cap.mark("funded");
      await sleep(2500);
    });
  },

  async D4() {
    const c = await session("carrier");
    const { page, cursor } = c;
    const blPdf = await makePdf("bl", `${state.ref}-BL`, [`Shipment ${state.ref}`, "Port of loading: Nhava Sheva (INNSA)", "Port of discharge: Singapore (SGSIN)", "Container MSKU 123456-7, 40' reefer, set point 5 °C", "Vessel MSC Aurora"]);
    await load(c, `${SITE}/ebl`);
    await text(page, "Issue a bill of lading").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -40));
    await sleep(800);
    const m = await session("exporter");
    cursor.x = 1300; cursor.y = 500;
    await take("D4-carrier-ebl", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(700);
      cap.mark("ebl");
      await chooseFile(page, cursor, text(page, "Drop the document here, or choose a file"), blPdf);
      await waitText(page, "Fingerprint", 20000);
      cap.mark("fingerprint");
      await sleep(700);
      await cursor.paste(page.getByLabel("Shipper address"), EXPORTER);
      await cursor.paste(page.getByLabel("Consignee address"), BUYER);
      cap.mark("filled");
      await cursor.click(page.getByRole("button", { name: "Issue bill of lading" }), { after: 300 });
      cap.mark("issue");
      await waitText(page, /issued to the shipper/, 120000);
      cap.mark("issued");
      const title = await text(page, /Bill #\d+ issued to the shipper/).textContent();
      state.billId = title.match(/#(\d+)/)[1];
      saveState();
      notes.push(`bill #${state.billId}`);
      await sleep(600);
      await cursor.click(page.getByRole("link", { name: "Open its public page" }), { after: 400 });
      await page.waitForLoadState("load");
      await sleep(3500);
      cap.mark("billpage");
      await sleep(1500);
      // switch to Meera's browser
      await m.page.goto(trackUrl(), { waitUntil: "load" });
      await m.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await sleep(1500);
      const bind = m.page.getByText("Bind a bill of lading").first();
      await bind.scrollIntoViewIfNeeded();
      await m.page.evaluate(() => window.scrollBy(0, 160));
      await sleep(800);
      await cap.attach(m.page);
      m.cursor.x = 1500; m.cursor.y = 400;
      await m.cursor.sync();
      cap.mark("meera");
      await sleep(900);
      await m.cursor.click(m.page.getByText(`Bill #${state.billId}`, { exact: true }).first(), { after: 500 });
      const approve = m.page.getByRole("button", { name: new RegExp(`Approve bill #${state.billId}`) });
      if (await approve.isVisible().catch(() => false)) {
        await m.cursor.click(approve, { after: 300 });
        cap.mark("approve");
        await waitText(m.page, /may now escrow bill/, 120000);
        cap.mark("approved");
        await sleep(800);
      }
      const bindBtn = m.page.getByRole("button", { name: /Bind bill of lading/ });
      await m.page.waitForFunction((el) => !el.disabled, await bindBtn.elementHandle(), { timeout: 60000 }).catch(() => {});
      await m.cursor.click(bindBtn, { after: 300 });
      cap.mark("bind");
      await waitText(m.page, /it is now in escrow/, 120000);
      cap.mark("bound");
      await sleep(1500);
      await waitText(m.page, "In escrow", 30000).catch(() => {});
      await m.cursor.hover(text(m.page, "In escrow"), { settle: 1500 }).catch(() => {});
      cap.mark("inescrow");
      await sleep(800);
    });
    c.page.setDefaultTimeout(60000);
  },

  async D5() {
    const s = await session("exporter");
    const { page, cursor } = s;
    if (!page.url().includes(state.shipmentId)) await load(s, trackUrl());
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await sleep(1500);
    cursor.x = 1200; cursor.y = 500;
    await take("D5-transit-releases", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(700);
      cap.mark("dashboard");
      await cursor.click(page.getByRole("button", { name: "Start transit" }), { after: 300 });
      cap.mark("transit");
      await waitText(page, "Transit started", 120000);
      cap.mark("intransit");
      await sleep(1200);
      const add = page.getByRole("button", { name: "Add sensor gateway" });
      await cursor.scrollTo(add, { at: 0.55 });
      await cursor.click(add, { after: 700 });
      cap.mark("gateway");
      await cursor.type(page.getByLabel("Name"), "Reefer logger MSKU 123456-7");
      await cursor.hover(page.getByLabel("Sensor ids"), { settle: 500 });
      await cursor.click(page.getByRole("button", { name: "Sign and add gateway" }), { after: 300 });
      await waitText(page, "Gateway added", 60000);
      cap.mark("added");
      await sleep(1500);
      state.keyFile = s.lastDownload;
      saveState();
      await cursor.click(page.getByRole("button", { name: "Submit readings with this gateway" }), { after: 700 });
      cap.mark("upload");
      const leg = await makeLeg(state.shipmentId, 1);
      notes.push(`leg 1 ${leg.count} readings ${new Date(leg.from * 1000).toISOString()}..${new Date(leg.to * 1000).toISOString()}`);
      await chooseFile(page, cursor, page.locator("label", { hasText: "Choose CSV" }), leg.file);
      cap.mark("csv");
      const send = page.getByRole("button", { name: /Send 32 readings/ });
      await send.waitFor();
      await cursor.hover(text(page, "Time span"), { settle: 700 });
      await cursor.click(send, { after: 300 });
      cap.mark("send");
      await waitText(page, /32 readings accepted/, 180000);
      await page.getByRole("button", { name: "Sent" }).waitFor({ timeout: 180000 });
      cap.mark("result");
      const res = page.locator("section", { hasText: "Result" }).last();
      await cursor.scrollTo(res, { at: 0.35 }).catch(() => {});
      await cursor.hover(res.locator("tbody tr").last(), { settle: 2500 }).catch(() => {});
      cap.mark("rows");
      notes.push((await res.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
      await cursor.click(page.getByRole("dialog").getByRole("button", { name: "Close" }).first(), { after: 900 });
      cap.mark("closed");
      await cursor.scrollTo(text(page, "Where it stands"), { at: 0.1, ms: 1200 });
      cap.mark("journey");
      await cursor.hover(text(page, "Checkpoint 2", { exact: true }), { settle: 2200 }).catch(() => {});
      await cursor.scrollTo(text(page, "Route and position", { exact: true }), { at: 0.1, ms: 1200 });
      cap.mark("map");
      await sleep(3000);
    });
  },

  async D6() {
    const s = await session("exporter");
    const { page, cursor } = s;
    if (!page.url().includes(state.shipmentId)) await load(s, trackUrl());
    const submit = page.getByRole("button", { name: "Submit readings" });
    await submit.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await sleep(1000);
    cursor.x = 1100; cursor.y = 600;
    await take("D6-excursion-pause", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(600);
      await cursor.click(submit, { after: 700 });
      cap.mark("upload");
      if (await text(page, "Choose key file").isVisible().catch(() => false)) await chooseFile(page, cursor, page.locator("label", { hasText: "Choose key file" }), state.keyFile);
      const leg = await makeLeg(state.shipmentId, 2);
      notes.push(`leg 2 ${leg.count} readings ${new Date(leg.from * 1000).toISOString()}..${new Date(leg.to * 1000).toISOString()}`);
      await chooseFile(page, cursor, page.locator("label", { hasText: /Choose CSV/ }), leg.file);
      cap.mark("csv");
      const warn = text(page, /outside the shipment/);
      await warn.waitFor({ timeout: 10000 });
      await cursor.hover(warn, { settle: 1500 });
      cap.mark("warning");
      await cursor.click(page.getByRole("button", { name: /Send 16 readings/ }), { after: 300 });
      cap.mark("send");
      await page.getByRole("button", { name: "Sent" }).waitFor({ timeout: 180000 });
      cap.mark("result");
      const res = page.locator("section", { hasText: "Result" }).last();
      await cursor.scrollTo(res, { at: 0.35 }).catch(() => {});
      await cursor.hover(res.locator("tbody tr").last(), { settle: 2500 }).catch(() => {});
      cap.mark("paused");
      notes.push((await res.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
      await cursor.click(page.getByRole("dialog").getByRole("button", { name: "Close" }).first(), { after: 800 });
      cap.mark("closed");
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await sleep(1500);
      cap.mark("top");
      await cursor.hover(text(page, "Paused", { exact: true }), { settle: 1500 }).catch(() => {});
      cap.mark("pill");
      const chart = page.locator("text=Temperature").first();
      await cursor.scrollTo(text(page, "Where it stands"), { at: 0.15, ms: 1300 }).catch(() => {});
      cap.mark("explain");
      await sleep(2500);
      await cursor.hover(text(page, "What each party does now"), { settle: 2000 }).catch(() => {});
      cap.mark("parties");
      void chart;
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await sleep(900);
      await cursor.click(page.getByRole("tab", { name: /Evidence/ }).first(), { after: 1000 });
      cap.mark("evidence");
      const temp = text(page, "Temperature per batch");
      await cursor.scrollTo(temp, { at: 0.12, ms: 1200 });
      await cursor.hover(text(page, "Excursion", { exact: true }), { settle: 2500 }).catch(() => {});
      cap.mark("chart");
      await sleep(800);
    });
  },

  async D7() {
    const s = await session("exporter");
    const { page, cursor } = s;
    if (!page.url().includes(state.shipmentId)) await load(s, trackUrl());
    await page.getByRole("tab", { name: /Overview/ }).first().click().catch(() => {});
    await sleep(800);
    const submit = page.getByRole("button", { name: "Submit readings" });
    await submit.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await sleep(800);
    cursor.x = 1100; cursor.y = 600;
    await take("D7-recovery", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(500);
      await cursor.click(submit, { after: 600 });
      cap.mark("upload");
      if (await text(page, "Choose key file").isVisible().catch(() => false)) await chooseFile(page, cursor, page.locator("label", { hasText: "Choose key file" }), state.keyFile);
      const leg = await makeLeg(state.shipmentId, 3);
      notes.push(`leg 3 ${leg.count} readings ${new Date(leg.from * 1000).toISOString()}..${new Date(leg.to * 1000).toISOString()}`);
      await chooseFile(page, cursor, page.locator("label", { hasText: /Choose CSV/ }), leg.file);
      await cursor.click(page.getByRole("button", { name: /Send 16 readings/ }), { after: 300 });
      await page.getByRole("button", { name: "Sent" }).waitFor({ timeout: 180000 });
      cap.mark("sent");
      await sleep(1200);
      await cursor.click(page.getByRole("dialog").getByRole("button", { name: "Close" }).first(), { after: 600 });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await cursor.moveTo(1250, 300, { ms: 700 });
      cap.mark("waiting");
      // the automatic recovery worker scans every minute and proves in seconds; the bell updates live
      const t0 = Date.now();
      let found = false;
      while (Date.now() - t0 < 6 * 60_000) {
        await page.locator("header").getByRole("button", { name: /Notifications/ }).first().waitFor();
        const r = await fetch(`https://cargoflow-api-75ul.onrender.com/v1/notifications?address=${EXPORTER.toLowerCase()}&limit=50`).then((x) => x.json()).catch(() => null);
        if (r?.notifications?.some((n) => n.kind === "RECOVERY_READY" && n.shipmentId?.toLowerCase() === state.shipmentId.toLowerCase())) { found = true; break; }
        await sleep(5000);
      }
      notes.push(found ? `RECOVERY_READY after ${Math.round((Date.now() - t0) / 1000)} s` : "no RECOVERY_READY within 6 min");
      await sleep(found ? 2500 : 0);
      cap.mark("ready");
      if (found) {
        await cursor.click(page.locator("header").getByRole("button", { name: /Notifications/ }).first(), { after: 900 });
        cap.mark("bell");
        const item = page.getByRole("dialog").getByText("Review and sign").first();
        await cursor.hover(item, { settle: 900 });
        await cursor.click(item, { after: 400 });
        cap.mark("review");
        await waitText(page, /Proof ready/, 30000);
        await sleep(1800);
        cap.mark("panel");
        const btn = page.getByRole("button", { name: "Sign and resume" });
        await cursor.click(btn, { after: 300 });
      } else {
        const btn = page.getByRole("button", { name: "Sign and prepare proof" });
        await cursor.scrollTo(btn, { at: 0.5 });
        await page.locator("#recovery-probe").selectOption("probe-2").catch(() => {});
        await cursor.click(btn, { after: 300 });
        await page.getByRole("button", { name: "Submit proof and resume" }).waitFor({ timeout: 180000 });
        await cursor.click(page.getByRole("button", { name: "Submit proof and resume" }), { after: 300 });
      }
      cap.mark("signed");
      await waitText(page, "Facility resumed by zero-knowledge proof", 240000);
      cap.mark("resumed");
      await sleep(2500);
      const rel = page.getByRole("button", { name: /Release milestone 3/ });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await sleep(2500);
      if (await rel.isVisible().catch(() => false)) {
        await cursor.click(rel, { after: 300 });
        cap.mark("release3");
        await waitText(page, "Milestone 3 released", 120000).catch(() => {});
        cap.mark("released3");
        await sleep(1500);
      }
      await cursor.hover(text(page, "Active", { exact: true }), { settle: 1200 }).catch(() => {});
      cap.mark("active");
      await cursor.click(page.getByRole("tab", { name: /Evidence/ }).first(), { after: 1200 });
      const proofCard = text(page, /Groth16 proof verified/);
      await proofCard.waitFor({ timeout: 30000 }).catch(() => {});
      await cursor.hover(proofCard, { settle: 2500 }).catch(() => {});
      cap.mark("proofcard");
      await sleep(800);
    });
  },

  async D7b() {
    const s = await session("exporter");
    const { page, cursor } = s;
    if (!page.url().includes(state.shipmentId)) await load(s, trackUrl());
    await page.getByRole("tab", { name: /Overview/ }).first().click().catch(() => {});
    await sleep(800);
    const submit = page.getByRole("button", { name: "Submit readings" });
    await submit.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await sleep(800);
    await take("D7b-leg4-releases", page, async (cap, notes) => {
      await cursor.sync();
      await cursor.click(submit, { after: 600 });
      if (await text(page, "Choose key file").isVisible().catch(() => false)) await chooseFile(page, cursor, page.locator("label", { hasText: "Choose key file" }), state.keyFile);
      const leg = await makeLeg(state.shipmentId, 4);
      notes.push(`leg 4 ${leg.count} readings`);
      await chooseFile(page, cursor, page.locator("label", { hasText: /Choose CSV/ }), leg.file);
      await cursor.click(page.getByRole("button", { name: /Send 32 readings/ }), { after: 300 });
      await page.getByRole("button", { name: "Sent" }).waitFor({ timeout: 180000 });
      cap.mark("result");
      const res = page.locator("section", { hasText: "Result" }).last();
      await cursor.scrollTo(res, { at: 0.35 }).catch(() => {});
      await sleep(2500);
      notes.push((await res.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400));
      await cursor.click(page.getByRole("dialog").getByRole("button", { name: "Close" }).first(), { after: 800 });
      await cursor.scrollTo(text(page, "Where it stands"), { at: 0.1, ms: 1200 });
      cap.mark("journey");
      await cursor.hover(text(page, "Checkpoint 5", { exact: true }), { settle: 2500 }).catch(() => {});
    });
  },

  async D8() {
    const s = await session("buyer", { connect: false });
    const { page, cursor } = s;
    await load(s, trackUrl());
    cursor.x = 1300; cursor.y = 300;
    await take("D8-buyer-passkey-settled", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(700);
      await cursor.click(page.getByRole("button", { name: /Connect wallet/ }).first(), { after: 900 });
      cap.mark("modal");
      await cursor.hover(text(page, "Continue with passkey"), { settle: 700 });
      await cursor.click(text(page, "CargoFlow Demo Wallet · Wei Lin"), { after: 1500 });
      cap.mark("connected");
      notes.push("Buyer connected with the injected demo wallet: ZeroDev passkey registration on the live origin fails (rpId 'localhost').");
      const confirm = page.getByRole("button", { name: "Confirm delivery" }).first();
      await confirm.waitFor({ timeout: 60000 });
      await cursor.scrollTo(confirm, { at: 0.5 }).catch(() => {});
      await cursor.click(confirm, { after: 300 });
      cap.mark("confirm");
      await waitText(page, "Delivery confirmed", 120000);
      cap.mark("delivered");
      await sleep(1200);
      const approve = page.getByRole("button", { name: /Approve 30 USDG/ }).first();
      await approve.waitFor({ timeout: 60000 });
      await cursor.click(approve, { after: 300 });
      cap.mark("approve");
      await waitText(page, "Vault approved", 120000);
      cap.mark("approved");
      const pay = page.getByRole("button", { name: /Pay the 30 USDG invoice/ }).first();
      await page.waitForFunction((el) => !el.disabled, await pay.elementHandle(), { timeout: 60000 }).catch(() => {});
      await sleep(400);
      await cursor.click(pay, { after: 300 });
      cap.mark("pay");
      await waitText(page, "Invoice paid and settled", 120000);
      cap.mark("settled");
      await sleep(2000);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await sleep(1800);
      await cursor.hover(text(page, "Settled", { exact: true }), { settle: 1500 }).catch(() => {});
      cap.mark("pill");
      await cursor.scrollTo(text(page, "Title (bill of lading)"), { at: 0.2, ms: 1300 }).catch(() => {});
      await cursor.hover(text(page, "With the buyer"), { settle: 2000 }).catch(() => {});
      cap.mark("title");
      await sleep(800);
    });
  },

  async D9() {
    const s = await session("buyer", { connect: false });
    const { page, cursor } = s;
    if (!page.url().includes(state.shipmentId)) await load(s, trackUrl());
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await sleep(1200);
    cursor.x = 1200; cursor.y = 400;
    await take("D9-certificate", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(600);
      s.lastDownload = null;
      await cursor.click(page.getByRole("button", { name: /Download certificate/ }), { after: 300 });
      cap.mark("download");
      const t0 = Date.now();
      while (!s.lastDownload && Date.now() - t0 < 30000) await sleep(200);
      if (!s.lastDownload) throw new Error("no certificate download");
      cap.mark("downloaded");
      state.certificate = s.lastDownload;
      saveState();
      notes.push(`certificate ${path.basename(s.lastDownload)}`);
      await sleep(600);
      // open the downloaded PDF in a new tab, as a person would from the download bar
      const pdfPage = await page.context().newPage();
      await pdfPage.goto("file://" + s.lastDownload).catch(() => {});
      await sleep(2500);
      await cap.attach(pdfPage);
      cap.mark("pdf");
      await sleep(2500);
      await pdfPage.mouse.move(960, 600);
      for (let i = 0; i < 60; i++) { await pdfPage.mouse.wheel(0, 28); await sleep(25); }
      await sleep(2500);
      cap.mark("scrolled");
    });
  },
};

const want = process.argv.slice(2);
try {
  for (const id of want) {
    await SHOTS[id]();
    saveState();
  }
} finally {
  await closeBrowser();
}
