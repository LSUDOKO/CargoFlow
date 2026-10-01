import { expect, test } from "@playwright/test";

const scenes = ["Healthy milestones", "Thermal excursion", "Recovery proof", "Remaining milestones", "Delivery and settlement"];

test("judge mode plays the whole story and the dashboard ends settled", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start a new run" }).click();
  await expect(page).toHaveURL(/\/demo\?id=0x[0-9a-f]{64}/, { timeout: 90_000 });

  for (const scene of scenes) {
    const step = page.getByRole("list", { name: "Story scenes" }).getByRole("listitem").filter({ hasText: scene });
    await page.getByRole("button", { name: `Run: ${scene}` }).click();
    await expect(step.getByLabel("done")).toBeVisible({ timeout: 120_000 });
    if (scene === "Thermal excursion") {
      // the excursion pauses the facility and blocks milestone 3
      await expect(page.getByTestId("status-pill").first()).toHaveText("Paused");
      await expect(page.getByText("Blocked: facility paused")).toBeVisible();
    }
    if (scene === "Recovery proof") {
      await expect(page.getByText("Groth16 proof verified on-chain")).toBeVisible();
    }
  }
  await expect(page.getByTestId("status-pill").first()).toHaveText("Settled");
  await expect(page.getByText("The story is complete")).toBeVisible();
  // every tranche was released with a transaction
  await expect(page.getByText("Released", { exact: true })).toHaveCount(5);
});
