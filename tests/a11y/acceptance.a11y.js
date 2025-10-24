// Accessibility acceptance suite
//
// Covers keyboard reachability, axe-core violations, zoom (200%), and narrow
// (360px) layouts across primary screens in fixtures mode.
//
// Run (devDependency install required):
//   npx playwright install chromium
//   npm run test:a11y
//
// File naming is `*.a11y.js` so `node --test` (which also matches `*.spec.js`)
// never collects these Playwright suites. Playwright's webServer starts the
// backend; open http://127.0.0.1:7341/ (or set NEXUS_IQ_A11Y_URL).

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.NEXUS_IQ_A11Y_URL || "http://127.0.0.1:7341/";

async function openApp(page, hash = "#/?fixtures=1") {
  await page.goto(`${BASE}${hash}`);
  await page.waitForSelector("#workspace", { timeout: 30_000 });
}

async function axeScan(page, name) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact));
  expect(serious, `${name}: ${serious.map((v) => v.id).join(", ")}`).toEqual([]);
}

test.describe("Nexus IQ a11y", () => {
  test("home: axe + skip link + rail toggle keyboard", async ({ page }) => {
    await openApp(page);
    await axeScan(page, "home");
    await page.keyboard.press("Tab");
    const skip = page.locator(".skip-link");
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#workspace")).toBeFocused();
  });

  test("settings: catalog table cards at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openApp(page, "#/settings?fixtures=1");
    await page.waitForSelector(".provgrid, .empty-state", { timeout: 30_000 });
    await axeScan(page, "settings-narrow");
    // Rail toggle must be reachable on narrow viewports.
    const toggle = page.locator("#rail-toggle");
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await page.keyboard.press("Enter");
  });

  test("zoom 200%: home still usable", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "200%";
    });
    await expect(page.locator(".wordmark")).toBeVisible();
    await expect(page.locator("#workspace")).toBeVisible();
    await axeScan(page, "home-zoom");
  });

  test("ops center and inspector toggles are keyboard reachable", async ({ page }) => {
    await openApp(page);
    await page.locator("#ops-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#opscenter")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#inspector-toggle").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#app")).toHaveAttribute("data-inspector", "open");
  });
});
