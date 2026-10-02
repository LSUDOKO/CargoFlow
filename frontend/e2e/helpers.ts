import { expect, type Page } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8887";

/** Connects one of the E2E test wallets (anvil dev accounts) and switches it to the local chain. */
export async function connectAs(page: Page, who: "exporter" | "financier" | "buyer" | "arbiter") {
  const header = page.getByRole("banner");
  if (await header.getByRole("button", { name: /0x/ }).isVisible().catch(() => false)) {
    await header.getByRole("button", { name: /0x/ }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
  }
  const option = page.getByRole("dialog").getByRole("button", { name: new RegExp(`Test ${who}`, "i") });
  // disconnecting re-renders the page, and the wallet dialog may already be open: only open it when it is not
  if (!(await option.isVisible().catch(() => false))) {
    await page.getByRole("main").getByRole("button", { name: "Connect wallet" }).first().click();
  }
  await option.click();
  const sw = page.getByRole("button", { name: "Switch network" });
  if (await sw.isVisible({ timeout: 4000 }).catch(() => false)) await sw.click();
  await expect(sw).toBeHidden();
}

/** The newest shipment the backend knows, or undefined. */
export async function latestShipmentId(page: Page): Promise<string | undefined> {
  const r = await page.request.get(`${API}/v1/shipments?limit=1`);
  const body = (await r.json()) as { shipments: { id: string }[] };
  return body.shipments[0]?.id;
}

export const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const FINANCIER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** The exporter registers a shipment in the wizard; returns its dashboard path. */
export async function registerShipment(page: Page, ref: string, invoice = "100000", facility = "40000") {
  await page.goto("/exporter");
  await connectAs(page, "exporter");
  await page.getByLabel("Shipment reference").fill(ref);
  await page.getByLabel("Buyer address").fill(BUYER);
  await page.getByLabel("Invoice value (USDG)").fill(invoice);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // the cold-chain defaults
  await page.getByLabel("Financier address").fill(FINANCIER);
  await page.getByLabel("Total facility (USDG)").fill(facility);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Sign and submit" }).click();
  const dashboard = page.getByRole("link", { name: "View dashboard" });
  await expect(dashboard).toBeVisible({ timeout: 120_000 });
  return (await dashboard.getAttribute("href"))!;
}

/** The financier funds the shipment's facility from the financier portal. */
export async function fund(page: Page, ref: string, amount = "40,000") {
  await page.goto("/financier");
  await connectAs(page, "financier");
  const card = page.getByRole("listitem").filter({ hasText: ref });
  const mint = card.getByRole("button", { name: /Mint .* test USDG/ });
  const approve = card.getByRole("button", { name: new RegExp(`Approve ${amount} USDG`) });
  await expect(mint.or(approve)).toBeVisible({ timeout: 30_000 });
  if (await mint.isVisible()) await mint.click();
  await approve.click();
  await card.getByRole("button", { name: new RegExp(`Deposit ${amount} USDG`) }).click();
  await expect(page.getByText("Facility funded")).toBeVisible({ timeout: 60_000 });
}

/**
 * A data logger's CSV export: two probes near the port of loading, one reading each per `interval` seconds.
 * `hot` overrides probe-1's temperature (°C) for the last readings, the way a failing reefer drifts upward.
 */
export function loggerCsv(start: number, steps: number, interval = 5, hot: number[] = []) {
  const rows = ["timestamp,sensor_id,temperature_c,humidity_pct,latitude,longitude,shock_g"];
  for (let i = 0; i < steps; i++) {
    const t = start + i * interval;
    const lat = (18.95 - i * 0.0004).toFixed(6);
    const lon = (72.95 + i * 0.0004).toFixed(6);
    const hotIdx = i - (steps - hot.length);
    const p1 = hotIdx >= 0 ? hot[hotIdx]! : 5.0 + ((i * 7) % 5) / 100;
    const p2 = hot.length && hotIdx >= 0 ? 4.6 : 5.1 + ((i * 3) % 5) / 100;
    rows.push(`${t},probe-1,${p1.toFixed(2)},65.0,${lat},${lon},0.10`);
    rows.push(`${t},probe-2,${p2.toFixed(2)},65.2,${lat},${lon},0.10`);
  }
  return rows.join("\n") + "\n";
}
