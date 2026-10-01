import { expect, test } from "@playwright/test";
import { API, latestShipmentId } from "./helpers";

test("the landing track bar explains an unknown shipment and opens a known one", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Shipment id or reference").fill("CF-DOES-NOT-EXIST");
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await expect(page.getByText("We couldn't find that shipment.")).toBeVisible();

  const id = await latestShipmentId(page);
  test.skip(!id, "no shipment on this chain yet");
  await page.getByLabel("Shipment id or reference").fill(id!);
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/track/${id}`));
});

test("an unknown or malformed shipment id gets a not-found page, not a crash", async ({ page }) => {
  await page.goto(`/track/0x${"d".repeat(64)}`);
  await expect(page.getByRole("heading", { name: "We couldn't find that shipment" })).toBeVisible();
  await page.goto("/track/not-an-id");
  await expect(page.getByRole("heading", { name: "We couldn't find that shipment" })).toBeVisible();
});

test("the fleet filters by tab and search and opens a container drawer that closes on Escape", async ({ page }) => {
  await page.goto("/shipments");
  await expect(page.getByRole("tab", { name: /All/ })).toBeVisible();
  await page.getByRole("tab", { name: /Settled/ }).click();
  await expect(page.getByRole("tab", { name: /Settled/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /All/ }).click();
  await page.getByLabel("Search shipments").fill("no-such-shipment");
  await expect(page.getByText("Nothing matches these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  const first = page.locator("tbody tr").first();
  await first.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Probes")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("the mobile menu opens and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Fleet" }).click();
  await expect(page).toHaveURL(/\/shipments$/);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});

test("when the backend is unreachable the site says so and recovers on retry", async ({ page }) => {
  await page.route(`${API}/**`, (r) => r.abort("connectionrefused"));
  await page.goto("/");
  const banner = page.getByRole("alert").filter({ hasText: "backend is not reachable" });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await page.unroute(`${API}/**`);
  await banner.getByRole("button", { name: "Retry" }).click();
  await expect(banner).toBeHidden({ timeout: 15_000 });
});

test("global search opens with Ctrl+K", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Find a shipment" })).toBeVisible();
});
