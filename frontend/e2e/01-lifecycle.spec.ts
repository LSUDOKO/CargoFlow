import { expect, test, type Page } from "@playwright/test";
import { connectAs, fund, loggerCsv, registerShipment } from "./helpers";

// One shipment from registration to settlement, driven only through the UI with each party's own wallet and the
// data logger's CSV exports. Nothing here uses an admin key or a server-held wallet.

async function upload(page: Page, keyFile: string, csv: string, name: string) {
  await page.getByRole("button", { name: "Submit readings" }).click();
  const dialog = page.getByRole("dialog");
  if (await dialog.getByText("Choose the key file").isVisible().catch(() => false)) {
    await dialog.getByLabel("Gateway key file").setInputFiles(keyFile);
  }
  await dialog.getByLabel("Readings CSV").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: /^Send \d+ readings$/ }).click();
  await expect(dialog.getByRole("button", { name: "Sent" })).toBeVisible({ timeout: 120_000 });
  const result = await dialog.locator("section").innerText();
  await dialog.getByRole("button", { name: "Close" }).click();
  return result;
}

test("a shipment runs from registration to settlement through real wallets and logger CSVs", async ({ page }) => {
  test.setTimeout(600_000);
  const ref = `CF-LIFE-${Date.now()}`;
  const dashboard = await registerShipment(page, ref);
  await fund(page, ref);

  // the exporter starts transit and adds the data logger as an evidence gateway
  await page.goto(dashboard);
  await connectAs(page, "exporter");
  await page.getByRole("button", { name: "Start transit" }).click();
  await expect(page.getByText("Transit started")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Add sensor gateway" }).click();
  await page.getByLabel("Name").fill("Reefer logger");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sign and add gateway" }).click();
  const keyFile = test.info().outputPath("gateway-key.json");
  await (await download).saveAs(keyFile);
  await expect(page.getByRole("heading", { name: "Gateway added" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("Reefer logger")).toBeVisible();

  let t = Math.floor(Date.now() / 1000) - 400;
  const next = (steps: number) => {
    const start = t;
    t += steps * 5;
    return start;
  };

  // two healthy epochs release milestones 1 and 2
  const healthy = await upload(page, keyFile, loggerCsv(next(16), 16), "leg-1.csv");
  expect(healthy).toContain("32 readings accepted");
  expect(healthy.match(/Passed: milestone released/g)).toHaveLength(2);

  // the reefer fails: probe-1 drifts to 11.7 °C, the epoch fails and the facility pauses
  const failing = await upload(page, keyFile, loggerCsv(next(8), 8, 5, [5.2, 6.8, 8.9, 10.4, 11.7]), "leg-2.csv");
  expect(failing).toContain("Failed: facility paused");
  await expect(page.getByTestId("status-pill").first()).toHaveText("Paused");

  // probe-2 kept the cargo in range; its fresh readings recover the facility with a proof from the exporter's wallet
  await upload(page, keyFile, loggerCsv(next(8), 8), "leg-3.csv");
  await page.getByRole("combobox", { name: "Probe", exact: true }).selectOption("probe-2");
  await page.getByRole("button", { name: "Sign and prepare proof" }).click();
  await page.getByRole("button", { name: "Submit proof and resume" }).click({ timeout: 120_000 });
  await expect(page.getByText("Facility resumed by zero-knowledge proof")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Groth16 proof verified on-chain")).toBeVisible({ timeout: 30_000 });
  const release = page.getByRole("button", { name: "Release milestone 3" });
  if (await release.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await release.click();
    await expect(page.getByText("Milestone 3 released")).toBeVisible({ timeout: 60_000 });
  }

  // the rest of the voyage releases milestones 4 and 5
  const rest = await upload(page, keyFile, loggerCsv(next(16), 16), "leg-4.csv");
  expect(rest.match(/Passed: milestone released/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Released", { exact: true })).toHaveCount(5, { timeout: 60_000 });

  // the buyer confirms delivery and pays the invoice
  await connectAs(page, "buyer");
  await page.getByRole("button", { name: "Confirm delivery" }).click();
  await expect(page.getByText("Delivery confirmed")).toBeVisible({ timeout: 60_000 });
  const mint = page.getByRole("button", { name: /Mint .* test USDG/ });
  const approve = page.getByRole("button", { name: /Approve 100,000 USDG/ });
  await expect(mint.or(approve)).toBeVisible({ timeout: 30_000 }); // the payment panel renders after the status updates
  if (await mint.isVisible()) await mint.click();
  await approve.click();
  await page.getByRole("button", { name: /Pay the 100,000 USDG invoice/ }).click();
  await expect(page.getByText("Invoice paid and settled")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("status-pill").first()).toHaveText("Settled");
});

test("a key file for one shipment is refused on another", async ({ page }) => {
  test.setTimeout(300_000);
  const a = await registerShipment(page, `CF-KEY-A-${Date.now()}`);
  const b = await registerShipment(page, `CF-KEY-B-${Date.now()}`);
  await page.goto(a);
  await connectAs(page, "exporter");
  await page.getByRole("button", { name: "Add sensor gateway" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sign and add gateway" }).click();
  const keyFile = test.info().outputPath("key-a.json");
  await (await download).saveAs(keyFile);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  // B has no gateway of its own yet, so add one, then try A's key on B
  await page.goto(b);
  await connectAs(page, "exporter");
  await page.getByRole("button", { name: "Add sensor gateway" }).click();
  await page.getByRole("button", { name: "Sign and add gateway" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.reload();
  await connectAs(page, "exporter");
  await page.getByRole("button", { name: "Submit readings" }).click();
  await page.getByRole("dialog").getByLabel("Gateway key file").setInputFiles(keyFile);
  await expect(page.getByRole("dialog").getByText(/This key belongs to shipment/)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Open that shipment" })).toBeVisible();
});
