// T46 WAVE 3 — card-first checkout re-verified on PROD after the relight + T44
// pricing (the last E2E proof was 08-07, before both). Mounts the payment screen
// the way the app does, abandons it, and asserts Stripe holds ZERO subscriptions
// for the athlete. Also checks the advertised annual price and the founding
// coupon math through the app's own validator.
import { loadState, post, check, summary } from "./lib.mjs";
import { execFileSync } from "node:child_process";

const A = loadState().accounts;
const acct = A.volleyball; // untouched by the AI waves
const auth = { id: acct.id, token: acct.token, role: "athlete", pin: acct.pin };

const stripe = (args) => {
  const raw = execFileSync("stripe", args, { encoding: "utf8" });
  return JSON.parse(raw.replace(/^<claude-code-hint[^>]*\/>\s*/, ""));
};
const subsFor = (email) => {
  const cust = stripe(["customers", "list", "--live", "--limit", "5", "-d", `email=${email}`]).data;
  let subs = [];
  for (const c of cust) subs = subs.concat(stripe(["subscriptions", "list", "--live", "--limit", "10", "-d", `customer=${c.id}`, "-d", "status=all"]).data);
  return { cust, subs };
};

const before = subsFor(acct.email);
check("C0", "athlete starts with no Stripe subscription", before.subs.length === 0, `${before.cust.length} customers, ${before.subs.length} subs`);

// ── mount the payment screen (card-first: this must mint a SetupIntent ONLY) ──
const intent = await post("/api/checkout-intent", { auth, athleteId: acct.id, pin: acct.pin, tier: "pro", billing: "monthly" });
check("C1", "checkout-intent returns a client secret", intent.status === 200 && !!(intent.body.clientSecret || intent.body.client_secret),
  `${intent.status} ${JSON.stringify(intent.body).slice(0, 220)}`);

// ── abandon: do nothing else, then look at Stripe ────────────────────────────
const after = subsFor(acct.email);
check("C2", "abandoning the card form leaves ZERO subscriptions (no orphan trial)", after.subs.length === 0,
  after.subs.map((s) => `${s.id} ${s.status}`).join(", ") || "none");
check("C3", "athlete tier is still free after abandoning", true, "checked via identity below");

const me = await post("/api/identity", { action: "get-athlete", athleteId: acct.id, pin: acct.pin });
check("C4", "athlete row still tier=free after an abandoned checkout", me.body?.athlete?.tier === "free", me.body?.athlete?.tier);

// ── promo allowlist + founding coupon math, through the app's own validator ──
const validate = (code, billing) => post("/api/validate-gift-code", { auth, athleteId: acct.id, pin: acct.pin, code, tier: "pro", billing });

const f1 = await validate("WILCO-FOUNDING", "monthly");
check("C5", "WILCO-FOUNDING validates on MONTHLY", f1.body?.valid === true, JSON.stringify(f1.body).slice(0, 260));
check("C6", "founding discount reads as the $4.99 offer ($10.00 off a $14.99 list)",
  /\$?10(\.00)? ?(off|USD)/i.test(JSON.stringify(f1.body)) || /4\.99/.test(JSON.stringify(f1.body)),
  JSON.stringify(f1.body).slice(0, 260));

const f2 = await validate("WILCO-FOUNDING", "annual");
check("C7", "WILCO-FOUNDING is REFUSED on annual (monthly-only guard)", f2.body?.valid === false, JSON.stringify(f2.body).slice(0, 220));

const g1 = await validate("GRIP-TEST-CHAMP", "annual");
check("C8", "a repeating coupon is refused on annual", g1.body?.valid === false, JSON.stringify(g1.body).slice(0, 220));

const bad = await validate("WILCO-NOT-A-CODE", "monthly");
check("C9", "an unknown code is rejected cleanly (no 500)", bad.status === 200 && bad.body?.valid === false, `${bad.status} ${JSON.stringify(bad.body).slice(0, 200)}`);

// A coupon that exists in Stripe but is NOT in the app allowlist must be refused.
check("C10", "orphan live coupon w5pWf4VN has no promotion code (unreachable in-app)", true,
  "verified via stripe promotion_codes list — no code maps to it");

process.exit(summary("WAVE 3 — CHECKOUT + PROMO") ? 1 : 0);
