import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { latestShipmentId } from "./helpers";

const routes = ["/", "/shipments", "/exporter", "/financier", "/buyer", "/arbiter"];

for (const route of routes) {
  test(`${route} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const severe = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(severe.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
  });
}

test("a shipment dashboard has no serious or critical accessibility violations", async ({ page }) => {
  const id = await latestShipmentId(page);
  test.skip(!id, "no shipment on this chain yet");
  await page.goto(`/track/${id}`);
  await expect(page.getByTestId("status-pill").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const severe = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(severe.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
});
