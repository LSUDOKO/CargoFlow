import { expect, test } from "@playwright/test";
import { connectAs, fund, registerShipment } from "./helpers";

test("a party opens a dispute and the arbiter resolves it from the arbiter console", async ({ page }) => {
  test.setTimeout(300_000);
  const ref = `CF-DISPUTE-${Date.now()}`;
  const dashboard = await registerShipment(page, ref);
  await fund(page, ref);
  await page.goto(dashboard);
  await connectAs(page, "exporter");
  await page.getByRole("button", { name: "Start transit" }).click();
  await expect(page.getByText("Transit started")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Open a dispute" }).click();
  await page.getByLabel("What went wrong").fill("Seal broken on arrival at transhipment; survey report SR-118.");
  await expect(page.getByText(/Recorded on chain as|On chain this is recorded as/)).toBeVisible();
  await page.getByRole("button", { name: "Freeze releases and open the dispute" }).click();
  await expect(page.getByText("Dispute opened: the arbiter decides next")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("status-pill").first()).toHaveText("Disputed");

  // a wallet without the dispute role sees the queue but cannot act
  await page.goto("/arbiter");
  await connectAs(page, "financier");
  await expect(page.getByRole("heading", { name: "This wallet is not an arbiter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Declare default" })).toHaveCount(0);

  // the arbiter resumes the facility
  await connectAs(page, "arbiter");
  const card = page.getByRole("listitem").filter({ hasText: ref });
  await card.getByRole("button", { name: "Resume" }).click();
  await page.getByLabel("Resolution reference").fill("Case 2026-07: survey SR-118 shows the cargo intact.");
  await page.getByRole("button", { name: "Resolve and resume" }).click();
  await expect(page.getByText("Dispute resolved: facility resumed")).toBeVisible({ timeout: 60_000 });

  await page.goto(dashboard);
  await expect(page.getByTestId("status-pill").first()).toHaveText("Active");
});
