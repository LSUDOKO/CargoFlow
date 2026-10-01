import { expect, test } from "@playwright/test";
import { connectAs } from "./helpers";

test("an exporter registers a shipment and a financier funds it, both from their wallets", async ({ page }) => {
  test.setTimeout(240_000);
  const ref = `CF-E2E-${Date.now()}`;

  await page.goto("/exporter");
  await connectAs(page, "exporter");
  await page.getByLabel("Shipment reference").fill(ref);
  await page.getByLabel("Buyer address").fill("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  await page.getByLabel("Invoice value (USDG)").fill("100000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click(); // the cold-chain defaults
  await page.getByLabel("Financier address").fill("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
  await page.getByLabel("Total facility (USDG)").fill("40000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Sign and submit" }).click();
  const dashboard = page.getByRole("link", { name: "View dashboard" });
  await expect(dashboard).toBeVisible({ timeout: 120_000 });
  const href = await dashboard.getAttribute("href");

  await page.goto("/financier");
  await connectAs(page, "financier");
  const card = page.getByRole("listitem").filter({ hasText: ref });
  const mint = card.getByRole("button", { name: /Mint .* test USDG/ });
  if (await mint.isVisible().catch(() => false)) await mint.click();
  await card.getByRole("button", { name: /Approve 40,000 USDG/ }).click();
  await card.getByRole("button", { name: /Deposit 40,000 USDG/ }).click();
  await expect(page.getByText("Facility funded")).toBeVisible({ timeout: 60_000 });

  await page.goto(href!);
  await expect(page.getByTestId("status-pill").first()).toHaveText("Financed");
});

test("the wizard refuses an invoice that cannot cover the facility and its fee", async ({ page }) => {
  await page.goto("/exporter");
  await connectAs(page, "exporter");
  await page.getByLabel("Shipment reference").fill("CF-E2E-BAD");
  await page.getByLabel("Buyer address").fill("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  await page.getByLabel("Invoice value (USDG)").fill("1000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Financier address").fill("0x90F79bf6EB2c4f870365E785982E1f101E93b906");
  await page.getByLabel("Total facility (USDG)").fill("40000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/must cover the facility plus its fee/)).toBeVisible();
  await expect(page.getByText(/financier must differ/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and submit" })).toHaveCount(0);
});
