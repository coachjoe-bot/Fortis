// Vercel serverless function — starts checkout by minting a SetupIntent for card
// collection. Deliberately creates NO subscription and NO trial: the invariant
// (T37, 2026-08-07) is that a Stripe subscription must never exist without a
// payment method attached. The old flow created a live trialing subscription the
// moment the payment screen MOUNTED, so every abandoned checkout left an orphan
// sub behind — 10 of the first 19 subscriptions ever created were orphans, and
// Stripe and Supabase permanently disagreed about who was trialing.
//
// New order: this endpoint (mount) → client collects the card via Stripe Elements
// and confirms the SetupIntent → create-subscription is called WITH the saved
// paymentMethodId and builds the subscription card-first. Abandoning checkout now
// leaves nothing behind but an unconsumed SetupIntent (free, inert, expires).
//
// A SetupIntent is plan-agnostic — it doesn't know price, interval, or promo code
// — so plan changes and gift codes no longer touch Stripe at all until the final
// subscribe. That also kills the duplicate-subscription bug (the old payment step
// re-created the sub on every plan/code change) and the capped-promo-code burn.
import {
  applyCors,
  verifyAthlete,
  getStripe,
  ensureStripeCustomer,
  adIdentityMeta,
} from "./_stripe.js";
import { logError } from "./_supa.js";

export const maxDuration = 30;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { athleteId, pin, ad } = req.body || {};
  let athlete = null; // hoisted so the catch can attribute (only if verified)

  try {
    athlete = await verifyAthlete({ athleteId, pin, auth: req.body?.auth });
    const stripe = getStripe();

    // Stamp ad identity on the customer at first touch, same as the legacy flow
    // did — the webhook's Meta Purchase reads it from subscription metadata later,
    // but the customer-level mirror keeps Stripe self-describing.
    const customerId = await ensureStripeCustomer(stripe, athlete, adIdentityMeta(ad));

    // usage:"off_session" — the card will be charged later (trial end, renewals)
    // without the athlete present. Creating several of these (retry, re-mount) is
    // harmless: unconsumed SetupIntents carry no money state and expire on their own.
    const si = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      metadata: { athlete_id: String(athlete.id) },
    });

    return res.status(200).json({ clientSecret: si.client_secret });
  } catch (e) {
    console.error("[checkout-intent] error:", e.message);
    const status = e.status || e.statusCode || 500;
    // Same ledger policy as create-subscription: real failures (Stripe API errors
    // carry e.type; 5xx like a dead Supabase patch) land in error_events. Routine
    // 4xx (bad PIN) stay out.
    if (status >= 500 || e.type) {
      await logError({
        source: "server", severity: "error", area: "billing", route: "api/checkout-intent",
        error_type: e.type || `http_${status}`, message: e.message, status_code: status,
        role: athlete ? "athlete" : null, actor_id: athlete?.id ?? null,
        athlete_id: athlete?.id ?? null,
      });
    }
    return res.status(status).json({ error: e.message || "Couldn't start checkout" });
  }
}
