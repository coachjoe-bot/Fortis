// T44 pricing migration (08-10) — creates the Stripe objects for:
//   1. Pro annual $150/yr → $99/yr   (a NEW price; Stripe prices are immutable)
//   2. Founding cohort → a flat $4.99/mo, locked for life (a NEW coupon; Stripe
//      coupons are immutable on amount_off, so the old $5 one cannot be edited)
//
// Usage — DRY RUN FIRST. It reports what it would do and changes nothing:
//   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-t44-pricing.mjs
//
// Then, to actually create things:
//   STRIPE_SECRET_KEY=sk_live_xxx node scripts/stripe-t44-pricing.mjs --apply
//
// Idempotent: re-running reuses anything that already exists. Works against either
// a live or a test key and says which one it's on. On --apply it writes the new
// annual price id into api/_stripe.js so there's no copy-paste step.
//
// What it deliberately does NOT do:
//   • It never touches an existing subscription. Athletes on $150/yr keep $150/yr
//     forever (Stripe never re-prices a live sub). PRICES_LEGACY in api/_stripe.js
//     is what keeps their renewal webhooks resolving to Pro.
//   • It never deletes the old $5 founding coupon, so anyone already on it is safe.
//     It only deactivates that coupon's PROMOTION CODES, and only when nobody has
//     redeemed them — otherwise it prints a warning and leaves them alone.

import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const APPLY = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error("Set STRIPE_SECRET_KEY before running.");
  console.error("The live key is in Vercel → wilco → Settings → Environment Variables.");
  process.exit(1);
}

// `stripe login` issues a RESTRICTED key (rk_live_…), not a secret key, so mode
// can't be sniffed off "sk_live" alone — an rk_live_ key read as TEST would skip
// retiring the old $150 price and skip writing the new id into the code, while
// happily creating live objects.
const MODE = /^(sk|rk)_live/.test(key) ? "LIVE" : "TEST";
const stripe = new Stripe(key);

const PRO_ANNUAL_CENTS = 9900;   // $99.00/yr  (was $150.00)
const PRO_MONTHLY_CENTS = 1499;  // $14.99/mo  — unchanged, and the anchor below
const FOUNDING_PRICE_CENTS = 499; // the flat $4.99/mo the founding cohort pays
const FOUNDING_AMOUNT_OFF = PRO_MONTHLY_CENTS - FOUNDING_PRICE_CENTS; // = 1000

const OLD_PRO_ANNUAL_ID = "price_1TdXoJRlrDCVlwEBrBG40L0C"; // $150/yr, live
const OLD_FOUNDING_COUPON = "WILCO_FOUNDING_5_FOREVER";
const NEW_FOUNDING_COUPON = "WILCO_FOUNDING_499_FOREVER";

// The code athletes type, and how many can. The cap carries over from the old
// WILCO-FOUNDING-5 code (50) — same cohort, repriced by a penny. `WILCO-FOUNDING-5`
// itself can't be reused: Stripe keeps a promotion-code string reserved even after
// the code is deactivated.
const FOUNDING_CODE = process.env.WILCO_FOUNDING_CODE || "WILCO-FOUNDING";
const FOUNDING_CAP = Number(process.env.WILCO_FOUNDING_CAP || 50);

const log = (...a) => console.log(...a);
const step = (s) => log(`\n── ${s}`);
const would = (s) => log(APPLY ? `   ✓ ${s}` : `   [dry run] would ${s}`);

// The founding discount is an absolute dollar amount, which is only correct while
// the monthly list price is exactly $14.99. If the list price ever moves, this
// assertion fires before anything is created — which is the entire point. See the
// FOUNDING_COUPON_IDS comment in api/_stripe.js.
if (PRO_MONTHLY_CENTS - FOUNDING_AMOUNT_OFF !== FOUNDING_PRICE_CENTS) {
  console.error("Founding discount math is wrong. Refusing to create a coupon.");
  process.exit(1);
}

(async () => {
  log(`\nWILCO T44 pricing migration — ${MODE} mode${APPLY ? " — APPLYING" : " — DRY RUN"}`);

  // ── 1. Find the Pro product by walking back from the known monthly price ─────
  step("Locating the Pro product");
  const proMonthly = await stripe.prices.retrieve(
    MODE === "LIVE" ? "price_1TdXoIRlrDCVlwEBt7EyYqvO" : process.env.STRIPE_TEST_PRICE_PRO_MONTHLY
  );
  const productId = typeof proMonthly.product === "string" ? proMonthly.product : proMonthly.product.id;
  log(`   Pro product: ${productId}  (monthly = $${(proMonthly.unit_amount / 100).toFixed(2)})`);

  if (proMonthly.unit_amount !== PRO_MONTHLY_CENTS) {
    console.error(`   ✗ Monthly list price is $${(proMonthly.unit_amount / 100).toFixed(2)}, expected $14.99.`);
    console.error("     The founding coupon's dollar discount is sized against $14.99. Stopping.");
    process.exit(1);
  }

  // ── 2. Pro annual @ $99 ──────────────────────────────────────────────────────
  step("Pro annual — $99/yr");
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  let annual = prices.data.find(
    (p) => p.unit_amount === PRO_ANNUAL_CENTS && p.recurring?.interval === "year"
  );

  if (annual) {
    log(`   Already exists: ${annual.id}`);
  } else if (APPLY) {
    annual = await stripe.prices.create({
      product: productId,
      nickname: "Pro Annual ($99)",
      unit_amount: PRO_ANNUAL_CENTS,
      currency: "usd",
      recurring: { interval: "year" },
      metadata: { wilco_note: "T44 08-10 — replaces the $150/yr price" },
    });
    log(`   ✓ Created: ${annual.id}`);
  } else {
    would(`create a $99/yr recurring price on ${productId}`);
  }

  // ── 3. Retire the old $150 annual so nothing new can be sold at it ───────────
  step("Retiring the $150/yr price");
  if (MODE === "LIVE") {
    const old = await stripe.prices.retrieve(OLD_PRO_ANNUAL_ID).catch(() => null);
    if (!old) {
      log("   Not found (already gone?) — skipping.");
    } else if (!old.active) {
      log("   Already inactive.");
    } else if (APPLY) {
      await stripe.prices.update(OLD_PRO_ANNUAL_ID, { active: false });
      log(`   ✓ Deactivated ${OLD_PRO_ANNUAL_ID}. Existing subs on it are UNAFFECTED.`);
    } else {
      would(`deactivate ${OLD_PRO_ANNUAL_ID} (existing subs keep billing at $150 — that is correct)`);
    }
  } else {
    log("   Test mode — the live $150 id doesn't exist here. Skipping.");
  }

  // ── 4. Founding coupon @ a flat $4.99/mo ────────────────────────────────────
  step(`Founding coupon — $${(FOUNDING_AMOUNT_OFF / 100).toFixed(2)} off, forever (→ $4.99/mo)`);
  let coupon = await stripe.coupons.retrieve(NEW_FOUNDING_COUPON).catch(() => null);
  if (coupon) {
    log(`   Already exists: ${coupon.id} ($${(coupon.amount_off / 100).toFixed(2)} off, ${coupon.duration})`);
  } else if (APPLY) {
    coupon = await stripe.coupons.create({
      id: NEW_FOUNDING_COUPON,
      amount_off: FOUNDING_AMOUNT_OFF,
      currency: "usd",
      duration: "forever",
      name: "WILCO Founding — $4.99/mo for life",
      // No `applies_to`. It looks like a Pro-only guard but isn't: in LIVE, Pro,
      // Elite and School are all prices on the SAME product (prod_UaYuCOpyRjoAk4),
      // so scoping to that product excludes nothing. No live coupon sets it either.
      // Pro-only is enforced in app code — create-subscription.js `if (tier !== "pro")`.
      metadata: {
        wilco_note: "T44 08-10. MONTHLY ONLY — enforced by FOUNDING_COUPON_IDS in api/_stripe.js.",
      },
    });
    log(`   ✓ Created: ${coupon.id}`);
  } else {
    would(`create ${NEW_FOUNDING_COUPON} — $10.00 off forever, scoped to the Pro product`);
  }

  // ── 4b. The promotion code athletes actually type ───────────────────────────
  // A coupon on its own is not redeemable — resolvePromotionCode() looks up a
  // PROMOTION CODE and reads the coupon off it. A coupon with no code is invisible.
  step(`Founding promotion code — ${FOUNDING_CODE} (cap ${FOUNDING_CAP})`);
  // ⚠️ Stripe's `code` filter is NOT an exact match — listing `code=WILCO-FOUNDING-5`
  // happily returns `WILCO-FOUNDING`, and vice versa. Deactivating whatever came back
  // first is how the new code got switched off seconds after it was created (08-10).
  // Always re-check `code` client-side before acting on the result.
  const existingCodes = await stripe.promotionCodes.list({ limit: 100 });
  const exact = existingCodes.data.filter((c) => c.code === FOUNDING_CODE);
  if (exact.length) {
    const c = exact[0];
    log(`   Already exists: ${c.code} — used ${c.times_redeemed}/${c.max_redemptions ?? "∞"}, active=${c.active}`);
  } else if (APPLY && coupon) {
    const created = await stripe.promotionCodes.create({
      // Newer API shape. A flat `coupon:` is rejected outright ("Received unknown
      // parameter: coupon") — this is the same nested shape resolvePromotionCode()
      // already reads back via promo.promotion.coupon.
      promotion: { type: "coupon", coupon: NEW_FOUNDING_COUPON },
      code: FOUNDING_CODE,
      max_redemptions: FOUNDING_CAP,
      metadata: { wilco_note: "T44 08-10 — founding cohort, $4.99/mo for life, MONTHLY ONLY" },
    });
    log(`   ✓ Created: ${created.code} (cap ${FOUNDING_CAP})`);
  } else {
    would(`create promotion code ${FOUNDING_CODE} on ${NEW_FOUNDING_COUPON}, capped at ${FOUNDING_CAP}`);
  }

  // ── 5. Report on the old $5 coupon, and stand its promo codes down if unused ─
  step(`Old founding coupon (${OLD_FOUNDING_COUPON})`);
  const oldCoupon = await stripe.coupons.retrieve(OLD_FOUNDING_COUPON).catch(() => null);
  if (!oldCoupon) {
    log("   Not found in this mode — nothing to do.");
  } else {
    log(`   $${(oldCoupon.amount_off / 100).toFixed(2)} off, ${oldCoupon.duration}, redeemed ${oldCoupon.times_redeemed}x`);
    const codes = await stripe.promotionCodes.list({ coupon: OLD_FOUNDING_COUPON, limit: 100 });
    const active = codes.data.filter((c) => c.active);
    log(`   ${codes.data.length} promotion code(s), ${active.length} active:`);
    for (const c of codes.data) {
      log(`     ${c.code.padEnd(24)} used ${c.times_redeemed}/${c.max_redemptions ?? "∞"}  active=${c.active}`);
    }
    // ⚠️ THE NUMBER WILL WANTED: how many founding slots are actually spent.
    const totalRedeemed = codes.data.reduce((n, c) => n + c.times_redeemed, 0);
    log(`   → founding-$5 slots claimed so far: ${totalRedeemed}`);

    for (const c of active) {
      if (c.code === FOUNDING_CODE) continue; // never stand down the code we just made
      if (c.times_redeemed > 0) {
        log(`   ⚠ ${c.code} has ${c.times_redeemed} redemption(s) — LEAVING IT ACTIVE. Decide by hand.`);
      } else if (APPLY) {
        await stripe.promotionCodes.update(c.id, { active: false });
        log(`   ✓ Deactivated unused code ${c.code} (superseded by the $4.99 coupon)`);
      } else {
        would(`deactivate unused code ${c.code}`);
      }
    }
  }

  // ── 6. Free founding cohort — report only, nothing changes ──────────────────
  step("Free founding cohort (WILCO_FOUNDING_FREE_FOREVER) — report only");
  const freeCodes = await stripe.promotionCodes
    .list({ coupon: "WILCO_FOUNDING_FREE_FOREVER", limit: 100 })
    .catch(() => ({ data: [] }));
  if (!freeCodes.data.length) {
    log("   No promotion codes found in this mode.");
  } else {
    for (const c of freeCodes.data) {
      log(`     ${c.code.padEnd(24)} used ${c.times_redeemed}/${c.max_redemptions ?? "∞"}  active=${c.active}`);
    }
    const used = freeCodes.data.reduce((n, c) => n + c.times_redeemed, 0);
    const cap = freeCodes.data.reduce((n, c) => n + (c.max_redemptions ?? 0), 0);
    log(`   → free slots claimed: ${used}${cap ? ` of ${cap}` : ""}`);
  }

  // ── 7. Write the new annual price id into the code ──────────────────────────
  if (APPLY && annual && MODE === "LIVE") {
    step("Wiring the price id into api/_stripe.js");
    const here = dirname(fileURLToPath(import.meta.url));
    const target = join(here, "..", "api", "_stripe.js");
    const src = readFileSync(target, "utf8");
    const next = src.replace(
      /const PRO_ANNUAL_99 = process\.env\.STRIPE_PRICE_PRO_ANNUAL \|\| "[^"]*";/,
      `const PRO_ANNUAL_99 = process.env.STRIPE_PRICE_PRO_ANNUAL || "${annual.id}";`
    );
    if (next === src) {
      log(`   ⚠ Could not find the PRO_ANNUAL_99 line. Set it by hand to: ${annual.id}`);
    } else {
      writeFileSync(target, next);
      log(`   ✓ api/_stripe.js now points at ${annual.id}`);
    }
  }

  log(`\n${APPLY ? "Done." : "Dry run complete — re-run with --apply to make these changes."}`);
  if (APPLY && MODE === "LIVE") {
    log("Next: commit api/_stripe.js, then deploy. Until deployed, annual checkout");
    log("refuses with a 500 rather than charging the old $150 — that is intentional.\n");
  }
})().catch((e) => {
  console.error("\n✗ Failed:", e.message);
  process.exit(1);
});
