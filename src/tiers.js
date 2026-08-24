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

// The tier the app should BEHAVE as. Elevates a stored-free athlete inside an
// unexpired trial window — and GRANDFATHERED free accounts (Will's 08-24 ruling,
// final): a free athlete with NO trial_ends_at predates the W18-3 trial system
// (identity.js stamps every non-school signup at creation), and those accounts
// keep Pro access for free, permanently. Only a LAPSED stamp locks an account
// down to the bare free surface. pro/elite/school pass through unchanged.
export function effectiveTier(a) {
  const t = (a && a.tier) || "free";
  if (t === "free" && a) {
    if (!a.trial_ends_at) return "pro"; // grandfathered pre-trial account
    const ends = Date.parse(a.trial_ends_at);
    if (Number.isFinite(ends) && ends > Date.now()) return "pro";
  }
  return t;
}

// Is this athlete currently riding the card-less free-pick trial? Requires a
// live stamp: a grandfathered account (no stamp, permanent free Pro) is NOT on
// a trial and must never see trial countdown copy.
export function trialActive(a) {
  return ((a && a.tier) || "free") === "free" && !!(a && a.trial_ends_at) && effectiveTier(a) === "pro";
}
