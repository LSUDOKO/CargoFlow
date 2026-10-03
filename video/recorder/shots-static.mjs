// Shots without transactions: D1 landing, M1 developers copy URL, R3 docs reference, R4a settled dashboard,
// R4a explorer, R4b deployments.   node shots-static.mjs [shotId...]
import { SITE, closeBrowser, newSession, preconnect } from "./lib/session.mjs";
import { sleep } from "./lib/cursor.mjs";
import { take } from "./lib/take.mjs";

const SETTLED = "0xc57490f8b1f0190b00197db978963899f55314865c0059eddaf8cfecdc8ff9e5";
const SETTLE_TX = "0x37571b49186b43f2f02df4d2034cd495ac7095766d113c20060cdecf4e365a35";
const EXPLORER = "https://explorer.testnet.chain.robinhood.com";

async function open(role, url, { connect = true } = {}) {
  const s = await newSession({ roles: [role] });
  if (connect) await preconnect(s.context, role);
  await s.page.goto(url, { waitUntil: "load" });
  await s.page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  return s;
}

const SHOTS = {
  async "D1-landing"() {
    const { page, cursor, context } = await open("exporter", SITE + "/");
    cursor.x = 1180; cursor.y = 760;
    await take("D1-landing", page, async (cap) => {
      await cursor.sync();
      await sleep(1000);
      cap.mark("hero");
      await sleep(1200);
      await cursor.hover(page.locator("header").getByText("Testnet").first(), { settle: 900 });
      cap.mark("pill");
      await cursor.moveTo(1000, 640, { ms: 600 });
      cap.mark("scroll");
      await cursor.scroll(420, 1000);
      await sleep(2500);
      cap.mark("trackbar");
      await sleep(800);
    });
    await context.close();
  },

  async "M1-developers-copy-url"() {
    const { page, cursor, context } = await open("exporter", SITE + "/developers");
    const panel = page.getByText("Add CargoFlow to Claude").first();
    await panel.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await sleep(800);
    cursor.x = 1200; cursor.y = 500;
    await take("M1-developers-copy-url", page, async (cap) => {
      await cursor.sync();
      await sleep(900);
      cap.mark("panel");
      const field = page.locator("text=MCP URL").first().locator("xpath=..");
      await cursor.hover(page.getByText("cargoflow-mcp.adoranto737.workers.dev/mcp").first(), { settle: 500 });
      const copy = field.getByRole("button").first();
      await cursor.click(copy, { after: 30 });
      cap.mark("copied");
      await cursor.moveTo(cursor.x + 70, cursor.y + 55, { ms: 260 });
      await sleep(2200);
    });
    await context.close();
  },

  async "R3-docs-reference"() {
    const { page, cursor, context } = await open("exporter", SITE + "/docs");
    // the Scalar reference renders client-side; wait for the sidebar
    await page.getByText("Marketplace").first().waitFor({ timeout: 60000 });
    await page.getByText("Endpoints").first().scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await sleep(1500);
    cursor.x = 900; cursor.y = 500;
    await take("R3-docs-reference", page, async (cap) => {
      await cursor.sync();
      await sleep(800);
      cap.mark("reference");
      await cursor.click(page.getByText("Marketplace", { exact: true }).first(), { after: 900 });
      cap.mark("group");
      const op = page.getByText(/Post a financing request|Request financing|Create a financing request/i).first();
      await cursor.click(op, { after: 1500 });
      cap.mark("operation");
      const signed = page.getByText("CargoFlow financing request", { exact: false }).filter({ visible: true }).last();
      await cursor.hover(signed, { settle: 1800 });
      cap.mark("signed");
      await sleep(1500);
    });
    await context.close();
  },

  async "D10-market"() {
    const { page, cursor, context } = await open("financier", SITE + "/market");
    cursor.x = 1300; cursor.y = 300;
    await take("D10-market", page, async (cap, notes) => {
      await cursor.sync();
      await sleep(800);
      cap.mark("market");
      const card = page.locator("article, li, div").filter({ hasText: "Suggested fee" }).filter({ has: page.getByRole("button", { name: "Make an offer" }) }).last();
      await cursor.hover(card.getByText("Suggested fee").first(), { settle: 1200 });
      cap.mark("band");
      await cursor.click(card.getByRole("button", { name: "Make an offer" }), { after: 1000 });
      cap.mark("modal");
      const dialog = page.getByRole("dialog");
      await cursor.hover(dialog.getByText("Suggested fee").first(), { settle: 1200 });
      cap.mark("fee");
      await cursor.click(dialog.getByText(/Why this band/).first(), { after: 1600 });
      cap.mark("reasons");
      await cursor.type(dialog.getByRole("textbox", { name: "Your fee" }).first(), "3.8", { cps: 8 });
      cap.mark("typed");
      await cursor.hover(dialog.getByRole("button", { name: /Sign and send offer/ }), { settle: 1500 });
      notes.push("Offer typed (3.8%), not sent. The request's maximum fee is 4%, below the suggested band, so a fee inside the band would be refused by the form.");
      await sleep(600);
    });
    await context.close();
  },

  async "R4a-track-settled"() {
    const { page, cursor, context } = await open("exporter", SITE + `/track/${SETTLED}`, { connect: false });
    cursor.x = 1300; cursor.y = 300;
    await take("R4a-track-settled", page, async (cap) => {
      await cursor.sync();
      await sleep(1200);
      cap.mark("header");
      await cursor.hover(page.getByText("Settled", { exact: true }).first(), { settle: 1200 });
      cap.mark("pill");
      await cursor.moveTo(1500, 700, { ms: 700 });
      await cursor.scrollTo(page.getByText("Journey", { exact: true }).first(), { at: 0.12, ms: 1200 });
      cap.mark("journey");
      await sleep(2500);
    });
    await context.close();
  },

  async "R4a-explorer-tx"() {
    const { page, cursor, context } = await open("exporter", `${EXPLORER}/tx/${SETTLE_TX}`, { connect: false });
    await page.getByText(/Success/i).first().waitFor({ timeout: 60000 }).catch(() => {});
    await sleep(1500);
    cursor.x = 1100; cursor.y = 600;
    await take("R4a-explorer-tx", page, async (cap) => {
      await cursor.sync();
      await sleep(600);
      cap.mark("status");
      await cursor.hover(page.getByText(/Success/i).first(), { settle: 1500 });
      await sleep(800);
    });
    await context.close();
  },

  async "R4b-deployments"() {
    const { page, cursor, context } = await open("exporter", SITE + "/deployments", { connect: false });
    cursor.x = 1200; cursor.y = 600;
    await take("R4b-deployments", page, async (cap) => {
      await cursor.sync();
      await sleep(700);
      cap.mark("top");
      await cursor.scroll(700, 2600);
      cap.mark("scrolled");
      await sleep(1200);
    });
    await context.close();
  },
};

const want = process.argv.slice(2);
for (const id of want.length ? want : Object.keys(SHOTS)) {
  try {
    await SHOTS[id]();
  } catch (e) {
    console.log(`shot ${id} failed: ${e.message.split("\n")[0]}`);
  }
}
await closeBrowser();
