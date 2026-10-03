import fs from "node:fs";
import path from "node:path";
import { RECORDER, playwright } from "./deps.mjs";
import { Cursor, cursorInitScript } from "./cursor.mjs";
import { installWallet } from "./wallet.mjs";

export const SITE = "https://cargoflow.adoranto737.workers.dev";
export const TMP = path.join(RECORDER, "tmp");
fs.mkdirSync(TMP, { recursive: true });

let browser;
export async function getBrowser() {
  browser ??= await playwright.chromium.launch({
    channel: "chromium", // full Chromium in new headless mode (PDF viewer, WebAuthn)
    headless: true,
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-features=Translate", "--font-render-hinting=none"],
  });
  return browser;
}

/** A fresh 1920x1080 context with the demo wallet (given roles) and the cursor overlay. */
export async function newSession({ roles = ["exporter"], storageState, permissions = ["clipboard-read", "clipboard-write"] } = {}) {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Asia/Singapore",
    acceptDownloads: true,
    storageState,
    permissions,
  });
  await context.grantPermissions(permissions, { origin: SITE }).catch(() => {});
  await installWallet(context, roles);
  await context.addInitScript(cursorInitScript);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (e) => console.log(`  [pageerror] ${String(e.message).slice(0, 200)}`));
  const cursor = new Cursor(page);
  return { context, page, cursor };
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

/** Mark a demo role as already connected (before the page loads), so wagmi reconnects to it on load. */
export async function preconnect(context, role) {
  await context.addInitScript((role) => {
    try {
      if (sessionStorage.getItem("__cf_pre")) return;
      sessionStorage.setItem("__cf_pre", "1");
      localStorage.setItem(`__cfdemo_auth_${role}`, "1");
      localStorage.setItem("wagmi.recentConnectorId", JSON.stringify(`dev.cargoflow.demo.${role}`));
      localStorage.setItem(`wagmi.dev.cargoflow.demo.${role}.connected`, "true");
    } catch {}
  }, role);
}
