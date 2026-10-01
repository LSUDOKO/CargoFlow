import { expect, type Page } from "@playwright/test";

export const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8887";

/** Connects one of the E2E test wallets (anvil dev accounts) and switches it to the local chain. */
export async function connectAs(page: Page, who: "exporter" | "financier" | "buyer") {
  const header = page.getByRole("banner");
  if (await header.getByRole("button", { name: /0x/ }).isVisible().catch(() => false)) {
    await header.getByRole("button", { name: /0x/ }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
  }
  await page.getByRole("main").getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`Test ${who}`, "i") }).click();
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
