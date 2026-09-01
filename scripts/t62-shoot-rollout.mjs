// T62-3 throwaway: screenshot the ROLLOUT loading surfaces (coach dashboard,
// chat cold start, coach saved-programs) using the smoke-suite mocks, so the
// states hold still. Usage: node scripts/t62-shoot-rollout.mjs [dark]
import { chromium } from "playwright";
import { mockApi, makeAthlete, makeCoach, loginAsAthlete, loginAsCoach } from "../tests/smoke/mocks.js";

const DARK = process.argv.includes("dark");
const OUT = `docs/mockups/t62-rollout-${DARK ? "dark" : "light"}`;
const BASE = process.env.T62_BASE || "http://localhost:5175";

const browser = await chromium.launch();

// ── coach dashboard: hold the roster batch open ──────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, baseURL: BASE });
  await ctx.addInitScript((t) => { try { localStorage.setItem("wilco_theme", t); } catch (_) {} }, DARK ? "dark" : "light");
  const page = await ctx.newPage();
  const coach = makeCoach();
  await mockApi(page, { coach, athlete: makeAthlete() });
  await page.route("**/api/data", async (route) => {
    const b = route.request().postDataJSON() || {};
    if (b.op === "read") await new Promise((r) => setTimeout(r, 15000));
    return route.fallback();
  });
  await loginAsCoach(page, coach).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}-01-coach-dashboard.png` });
  await ctx.close();
}

// ── athlete chat cold start ──────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: BASE });
  await ctx.addInitScript((t) => { try { localStorage.setItem("wilco_theme", t); } catch (_) {} }, DARK ? "dark" : "light");
  const page = await ctx.newPage();
  const athlete = makeAthlete({ program_text: "Day 1 - Push\nBench Press 3x5 @ 185" });
  await mockApi(page, { athlete });
  await page.route("**/api/data", async (route) => {
    const b = route.request().postDataJSON() || {};
    if (b.table === "workouts" && b.op === "read") await new Promise((r) => setTimeout(r, 20000));
    return route.fallback();
  });
  await loginAsAthlete(page, athlete).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}-02-chat-coldstart.png` });
  await ctx.close();
}

await browser.close();
console.log("done →", OUT);
