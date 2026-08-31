// T62-3 throwaway: screenshot loading/empty states as the QA athlete.
// Usage: node --env-file=.env.qa scripts/t62-shoot-states.mjs [dark]
import { chromium } from "playwright";

const NAME = process.env.QA_ATHLETE_NAME;
const PIN = process.env.QA_ATHLETE_PIN;
const DARK = process.argv.includes("dark");
const OUT = `docs/mockups/t62-states-${DARK ? "dark" : "light"}`;
const BASE = process.env.T62_BASE || "http://localhost:5175";

if (!NAME || !PIN) { console.error("need .env.qa"); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(([theme]) => {
  try { localStorage.setItem("wilco_theme", theme); } catch {}
}, [DARK ? "dark" : "light"]);
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Athlete Login/i }).click();
await page.getByPlaceholder(/name/i).first().fill(NAME);
await page.locator('input[type="password"], input[inputmode="numeric"]').first().fill(PIN);
await page.getByRole("button", { name: /Let's Get to Work/i }).click();
await page.waitForTimeout(6000);
for (const label of [/Not now/i, /No thanks/i, /^Later$/i]) {
  const b = page.getByRole("button", { name: label }).first();
  if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
}

// ── 1. PROGRESS empty states (the radar) ────────────────────────────────────
await page.getByRole("button", { name: "PROGRESS", exact: true }).first().click();
await page.waitForTimeout(1500);
for (const [label, file] of [[/^running$/i, "04-running"], [/^PRs$/i, "05-pr"]]) {
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}-${file}.png` });
}
await page.getByRole("button", { name: /✕ Close/ }).click();
await page.waitForTimeout(600);

// ── 2. Memory tab loading skeletons (stall the data reads) ──────────────────
await ctx.route("**/api/data*", async (route) => {
  await new Promise((r) => setTimeout(r, 12000));
  await route.continue().catch(() => {});
});
await page.getByRole("button", { name: /program$/i }).first().click();
await page.waitForTimeout(800);
const mem = page.getByRole("button", { name: /memory/i }).first();
if (await mem.isVisible().catch(() => false)) {
  await mem.click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}-06-memory-loading.png` });
  const past = page.getByRole("button", { name: /past blocks/i }).first();
  if (await past.isVisible().catch(() => false)) {
    await past.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}-07-memory-past-loading.png` });
  }
} else {
  console.log("memory tab not found — noting");
  await page.screenshot({ path: `${OUT}-06-memory-MISSING.png` });
}
await ctx.unroute("**/api/data*");
// close the program pane if open
const closeBtn = page.getByRole("button", { name: /✕ Close/ }).first();
if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
await page.waitForTimeout(600);

// ── 3. Session sheet first-fill skeleton (stall the AI call) ────────────────
// the quicklog deep link routes to openLogSurface(): the sheet opens.
await page.goto(`${BASE}/?n=quicklog`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const sheet = page.getByRole("textbox", { name: "Today's workout log" });
if (await sheet.isVisible().catch(() => false)) {
  // stall Joe forever so the busy states hold still for the camera
  await ctx.route("**/api/claude*", () => new Promise(() => {}));
  // draft + busy: instruction with the draft kept → dotted caption under the sheet
  const composer = page.getByPlaceholder(/Tell Joe what to change/i);
  await composer.fill("make bench 5x5 instead");
  await page.getByRole("button", { name: "→" }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-09-sheet-editing.png` });
  // empty + busy: reload fresh, wait for the park restore to land, THEN clear
  // the sheet and ask Joe to rewrite → the sheet skeleton
  await page.goto(`${BASE}/?n=quicklog`, { waitUntil: "domcontentloaded" });
  await sheet.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(
    () => (document.querySelector('textarea[aria-label="Today\'s workout log"]')?.value || "").length > 0,
    null, { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
  await sheet.fill("");
  await composer.fill("rewrite today's session");
  await page.getByRole("button", { name: "→" }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-08-sheet-busy.png` });
} else {
  console.log("sheet did not open — skipping sheet shots");
}

await browser.close();
console.log("done →", OUT);
