// ─── APP STORE CAPTURE SHOOT ─────────────────────────────────────────────────
// Rebuilt 08-10 from 04-Screenshot-Plan.md (the 07-30 original lived in a wiped
// session scratchpad — this one is committed so it never has to be rebuilt again).
//
// Shoots the 9-shot listing set against the SALES DEMO (Marcus Ellison fixtures,
// synthetic by construction) at the exact required 1320×2868: viewport 440×956
// at deviceScaleFactor 3. PNGs land in --out, then convert with sips (JPEG kills
// the alpha channel App Store Connect rejects):
//   for f in *.png; do sips -s format jpeg -s formatOptions best "$f" --out "${f%.png}.jpg"; done
//
// Usage: node scripts/shoot-store-captures.mjs [--url https://wilco-sales-demo.vercel.app] [--out /tmp/captures]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const URL = arg("--url", "https://wilco-sales-demo.vercel.app");
const OUT = arg("--out", "/tmp/store-captures");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
page.setDefaultTimeout(30_000);

const shot = async (name) => {
  await page.waitForTimeout(1200); // let entrance animations settle
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}`);
};
// Text-click helper: the app's nav is styled <button>s and chips found by text.
const tap = async (re, { nth = 0 } = {}) => {
  const el = page.getByText(re, { exact: false }).nth(nth);
  await el.waitFor({ state: "visible" });
  await el.click();
};

// ── login as the demo athlete ────────────────────────────────────────────────
await page.goto(URL);
await tap(/^Athlete Login$/i);
await page.locator("input").first().fill("Marcus Ellison");
await page.locator('input[type="password"]').fill("1234");
await tap(/Let's Get to Work/i);
await page.getByText(/QUICK LOG/i).first().waitFor({ timeout: 45_000 });

// 01 — today's session in chat: ask Joe directly (the chip row scrolls, typing
// is deterministic), wait out the live AI stream, then shoot the fresh reply.
try {
  const composer = page.locator('input[placeholder*="Coach Joe" i], textarea[placeholder*="Coach Joe" i]').first();
  await composer.fill("What's my workout for today?");
  await composer.press("Enter");
  await page.waitForTimeout(20_000);
} catch (e) { console.log("composer fallback:", e.message?.slice(0, 60)); }
await shot("01-home-today");

// 02 — Quick Log, AI-prefilled sheet.
await tap(/QUICK LOG/i);
await page.waitForTimeout(16_000); // draft generation
await shot("02-quick-log");
await tap(/✕/i).catch(() => tap(/Close/i));

// 03 + 07 — Progress: Benchmarks (default tab), then Strength.
await tap(/^PROGRESS$/i);
await page.waitForTimeout(2500); // power-cell fills gate on 1RM load
await shot("03-benchmarks");
await tap(/^STRENGTH$/i);
await shot("07-strength");
await tap(/✕/i).catch(() => {});

// 04 + 06 + 05 — My Log: Workouts, Proof, Crew.
await tap(/MY LOG/i);
await shot("04-my-log");
await tap(/^PROOF$/i);
await page.waitForTimeout(2000);
await shot("06-proof");
await tap(/^CREW$/i);
await shot("05-crew");
await tap(/✕/i).catch(() => {});

// 08 + 09 — Program: My Program, then the Builder interview.
await tap(/^Program$/i).catch(() => tap(/📋/i));
await shot("08-program");
await tap(/BUILDER/i);
await page.waitForTimeout(3000);
await shot("09-builder");

await browser.close();
console.log(`Done → ${OUT}`);
