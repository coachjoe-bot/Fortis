// ─── EFFECTIVE TIER — the W18-3 trial clock (Will's 08-20 ruling) ─────────────
// Every signup starts a 7-day free trial. Paid picks run theirs through Stripe
// (card at signup, trial_period_days — see api/create-subscription.js), so their
// stored tier is already pro/elite while trialing. The FREE pick has no Stripe
// object at all: the server stamps athletes.trial_ends_at at account creation
// (api/identity.js, service-key write — the column is deliberately NOT in
// ATHLETE_COL_ALLOW), and this helper presents that athlete as "pro" until the
// clock runs out. The revert is purely derived — no cron, no write, no countdown:
// once trial_ends_at passes, effectiveTier simply answers "free" again, which is
// exactly the "silently revert, the features just aren't there anymore" ruling.
//
// Rules for call sites:
//   • FEATURE gating (nav buttons, Quick Log, opener, history persistence,
//     weekly reports) reads effectiveTier.
//   • BILLING truth (plan drawer, checkout, webhook-lag reconciliation) reads
//     the raw athlete.tier — a trial athlete's plan is still Free.
// Shared client + server (same import pattern as src/grit.js).

export const TRIAL_DAYS = 7;

// The tier the app should BEHAVE as. Elevates only a stored-free athlete inside
// an unexpired trial window; pro/elite/school always pass through unchanged.
export function effectiveTier(a) {
  const t = (a && a.tier) || "free";
  if (t === "free" && a && a.trial_ends_at) {
    const ends = Date.parse(a.trial_ends_at);
    if (Number.isFinite(ends) && ends > Date.now()) return "pro";
  }
  return t;
}

// Is this athlete currently riding the card-less free-pick trial?
export function trialActive(a) {
  return ((a && a.tier) || "free") === "free" && effectiveTier(a) === "pro";
}
