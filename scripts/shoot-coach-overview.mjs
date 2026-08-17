// Coach overview, shot at phone size for the website's feature deck.
// Same approach as shoot-store-captures.mjs: runs against the DEPLOYED demo,
// so it needs no local server. Coach login is PIN-only (Coach Reed / 4477).
//   node scripts/shoot-coach-overview.mjs --out /tmp/coach
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i+1] : d; };
const URL = arg("--url", "https://wilco-sales-demo.vercel.app");
const OUT = arg("--out", "/tmp/coach");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 });
page.setDefaultTimeout(30_000);
const tap = async (re, n = 0) => {
  const el = page.getByText(re, { exact: false }).nth(n);
  await el.waitFor({ state: "visible" }); await el.click();
};

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
console.log("landed:", (await page.title()) || "(no title)");

try { await tap(/Coach Login/i); } catch (e) { console.log("no coach-login button:", e.message.slice(0,70)); }
await page.waitForTimeout(1200);
const pin = page.locator('input[type="password"], input[inputmode="numeric"], input').first();
await pin.fill("4477");
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
for (const re of [/Let's Get to Work/i, /Enter/i, /Log ?in/i]) {
  try { await tap(re); break; } catch {}
}
await page.getByText(/OVERVIEW/i).first().waitFor({ timeout: 45_000 });
await page.waitForTimeout(4000);
console.log("coach dashboard up");

const h = await page.evaluate(() => document.documentElement.scrollHeight);
console.log("page height:", h);
await page.screenshot({ path: `${OUT}/coach-full.png`, fullPage: true });
for (const [name, y] of [["a",0], ["b",900], ["c",1800], ["d",2700]]) {
  await page.evaluate(v => scrollTo(0, v), y);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/coach-${name}.png` });
}
await browser.close();
console.log("done ->", OUT);
