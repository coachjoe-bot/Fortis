// ─── ACCOUNT DELETION PROCESSOR (Vercel) ─────────────────────────────────────
// Drains the deletion_requests queue, honoring the Privacy Policy's 30-day
// account-deletion right (Privacy Policy §4 / §5).
//
// For every deletion_requests row that is `pending` AND whose
// scheduled_deletion_at has passed, it hard-deletes all data tied to that
// athlete, deletes the athlete row, then marks the request `completed`. A row
// that fails is left `pending` so it retries on the next run.
//
// HISTORY: this used to run as a Supabase Edge Function (supabase/functions/
// process-deletions), invoked by a fetch from api/trigger-proof-feed.js's cron
// path (both jobs shared one Vercel route because of the old Hobby 12-function
// cap). That edge function was never actually deployed (`supabase functions
// deploy process-deletions` was a manual step that didn't happen), so every
// cron run's deletion leg silently 404'd and did nothing — the queue was never
// draining. This route replaces it: same logic, moved verbatim, now a real
// Vercel cron with its own schedule (see vercel.json), reusing the same
// SUPABASE_SERVICE_KEY + REST helpers every other api/*.js function uses.
//
// GET Authorization: Bearer <CRON_SECRET> -> { processed, deleted, failed, skipped_orphan }
// (same gate as api/trigger-proof-feed.js / api/push.js — the CRON_SECRET
// bearer Vercel injects into cron invocations, never the forgeable x-vercel-cron).
//
// Env: CRON_SECRET, SUPABASE_URL + SUPABASE_SERVICE_KEY (via ./_supa.js).

import { sbSelect, sbDelete, sbWrite, logError } from "./_supa.js";
import { getStripe } from "./_stripe.js";

const enc = encodeURIComponent;

// ─── Cancel billing BEFORE purging the account ───────────────────────────────
// Found 07-30: this job deleted the athlete row and every trace of them while
// never touching Stripe, so a deleted account kept its subscription alive and
// kept charging a real card that no longer had any account behind it, with the
// only record of the link (athletes.stripe_subscription_id) destroyed in the
// same pass. Billing has to die first.
//
// Return contract: true = safe to proceed with the purge, false = do NOT purge
// this run. "Already gone" is a success, not a failure: a subscription Stripe
// says is missing or already canceled cannot bill anyone, so those proceed.
// Any OTHER error (network, auth, rate limit) returns false, which leaves the
// request `pending` so the next run retries. That is deliberate. Deleting on a
// failed cancel would orphan live billing AND destroy the evidence needed to
// find it, which is strictly worse than a deletion landing a day late; a
// persistent failure surfaces in error_events for a human rather than silently
// resolving in either direction.
async function cancelBillingFor(aid) {
  let rows;
  try {
    rows = await sbSelect("athletes", `?id=eq.${enc(aid)}&select=stripe_subscription_id`);
  } catch (e) {
    console.error(`[process-deletions] could not read billing for athlete ${aid}:`, e.message);
    return false;
  }
  const subId = Array.isArray(rows) && rows[0] ? rows[0].stripe_subscription_id : null;
  if (!subId) return true; // never subscribed, or already cleared — nothing to cancel

  try {
    await getStripe().subscriptions.cancel(subId);
    return true;
  } catch (e) {
    // resource_missing = the subscription does not exist. Stripe also rejects a
    // cancel on one that is already canceled; both mean nothing can bill.
    const code = e?.code || e?.raw?.code;
    const msg = String(e?.message || "");
    if (code === "resource_missing" || /no such subscription|already canceled|already been canceled/i.test(msg)) {
      return true;
    }
    console.error(`[process-deletions] Stripe cancel FAILED for athlete ${aid} (sub ${subId}):`, msg);
    await logError({
      source: "server", severity: "error", area: "billing", route: "api/process-deletions",
      message: `Stripe cancel failed before account deletion (sub ${subId}): ${msg}`,
    }).catch(() => {});
    return false;
  }
}

// Every table that holds athlete-scoped data. Tables with an ON DELETE CASCADE FK
// to athletes(id) would be cleaned by the athletes delete anyway, but we delete
// them explicitly so the function is correct even if a prod FK is missing. Order
// doesn't matter — all are keyed by athlete_id and deleted before the parent row.
const ATHLETE_TABLES = [
  "prs",
  "workouts",
  "athlete_goals",
  "manual_one_rms",
  "program_modifications",
  "proof_digests",
  "athlete_context",
  "push_subscriptions",
  "legal_acceptances",
  // WILCO Crew V1. crew_moments/crew_reactions are athlete_id-keyed exactly like
  // the tables above. crew_edges is DELIBERATELY NOT listed here — it has no
  // athlete_id column (athlete_a/athlete_b instead), and adding it to this list
  // would silently no-op (a `?athlete_id=eq.<id>` delete matches zero rows) and
  // strand edges on account deletion. See deleteCrewEdges() below instead.
  "crew_moments",
  "crew_reactions",
];

// Analytics ledgers carry athlete_id/actor_id but have NO foreign key to athletes,
// so nothing cleans them on delete — they'd keep the personal linkage forever. We
// don't hard-delete them (that would erase a churned athlete's cost/usage from the
// aggregate business metrics); instead we ANONYMIZE — null the identifiers so the
// row survives as an unattributed usage count. Honors the deletion promise (no
// personal linkage remains) without wrecking the rollups.
const ANON_TABLES = ["usage_costs", "error_events", "usage_events"];

async function anonymizeAnalytics(aid) {
  for (const tbl of ANON_TABLES) {
    // Rows scoped to this athlete → drop the athlete link.
    await sbWrite({
      method: "PATCH", table: tbl, query: `?athlete_id=eq.${enc(aid)}`,
      body: { athlete_id: null }, prefer: "return=minimal",
    });
    // Rows the athlete themselves initiated (actor_id == their id) → drop the actor
    // link too. Scoped to actor_id=aid so a COACH acting on this athlete keeps theirs.
    await sbWrite({
      method: "PATCH", table: tbl, query: `?actor_id=eq.${enc(aid)}`,
      body: { actor_id: null }, prefer: "return=minimal",
    });
  }
}

async function runDeletions() {
  const summary = { processed: 0, deleted: 0, failed: 0, skipped_orphan: 0 };

  const nowIso = new Date().toISOString();
  // Due = pending AND scheduled_deletion_at <= now.
  const due = await sbSelect(
    "deletion_requests",
    `?status=eq.pending&scheduled_deletion_at=lte.${enc(nowIso)}&select=id,athlete_id`
  );

  for (const reqRow of due) {
    summary.processed++;
    const aid = reqRow.athlete_id;

    // Orphan request (athlete already gone) — just close it out.
    if (!aid) {
      try {
        await sbWrite({
          method: "PATCH", table: "deletion_requests", query: `?id=eq.${enc(reqRow.id)}`,
          body: { status: "completed", completed_at: new Date().toISOString() },
          prefer: "return=minimal",
        });
        summary.skipped_orphan++;
      } catch (e) {
        console.error(`[process-deletions] orphan close failed for ${reqRow.id}:`, e.message);
        summary.failed++;
      }
      continue;
    }

    try {
      // 0. Kill billing FIRST. If this cannot be confirmed, skip the purge and
      //    retry next run rather than orphan a live subscription.
      if (!(await cancelBillingFor(aid))) {
        summary.failed++;
        continue;
      }
      // 1. Delete all athlete-scoped data.
      for (const tbl of ATHLETE_TABLES) {
        await sbDelete(tbl, `?athlete_id=eq.${enc(aid)}`);
      }
      // 1a. crew_edges — NOT athlete_id-keyed (athlete_a/athlete_b instead), so it
      // can't ride the loop above (see the ATHLETE_TABLES comment). Both columns
      // carry an ON DELETE CASCADE FK to athletes(id), so the athletes delete in
      // step 2 would clean these up on its own — but this explicit two-query
      // delete runs first anyway rather than trusting that alone: it's the exact
      // trap the crew build spec flagged as easy to miss because the table LOOKS
      // athlete-scoped, so belt-and-braces here costs nothing.
      await sbDelete("crew_edges", `?athlete_a=eq.${enc(aid)}`);
      await sbDelete("crew_edges", `?athlete_b=eq.${enc(aid)}`);
      // 1b. Anonymize the FK-less analytics ledgers (keep the counts, drop the link).
      await anonymizeAnalytics(aid);
      // 2. Delete the athlete row itself (cascades any remaining FK children).
      await sbDelete("athletes", `?id=eq.${enc(aid)}`);
      // 3. Mark the request completed. athlete_id is now NULL (ON DELETE SET
      //    NULL) but the request row survives as an audit record.
      await sbWrite({
        method: "PATCH", table: "deletion_requests", query: `?id=eq.${enc(reqRow.id)}`,
        body: { status: "completed", completed_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
      summary.deleted++;
    } catch (e) {
      // Leave the row `pending` so it retries next run.
      console.error(`[process-deletions] deletion failed for athlete ${aid} (request ${reqRow.id}):`, e.message);
      summary.failed++;
    }
  }

  // ── rate_limits janitor (piggybacks on this daily cron) ─────────────────────
  // rateLimit()/authThrottle() in api/_supa.js insert a rate_limits row on every
  // AI proxy call, telemetry batch, and login attempt, but nothing ever deleted
  // old rows (only per-key resets on successful login), so the table grew
  // forever — and every windowed rate-limit check scans it in the hot path of
  // every AI call. All windows in use are 15-60 minutes; 25h keeps a full day of
  // slack beyond the longest window, so sweeping older rows can never change a
  // rate-limit decision. Best-effort: a failed sweep never blocks the deletion
  // queue and simply retries tomorrow.
  try {
    const cutoff = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await sbDelete("rate_limits", `?created_at=lt.${enc(cutoff)}`);
    summary.rate_limits_swept = true;
  } catch (e) {
    console.error("[process-deletions] rate_limits sweep failed:", e.message);
    summary.rate_limits_swept = false;
  }

  console.log("[process-deletions] done —", JSON.stringify(summary));
  return summary;
}

// Fast, DB-only writes; the daily queue is small. A small budget is plenty, but
// give it real room in case the queue backs up (each deletion is ~10 sequential
// REST calls).
export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Cron-only: gated SOLELY by the CRON_SECRET bearer Vercel injects (same gate
  // as api/trigger-proof-feed.js and api/push.js — never the forgeable
  // x-vercel-cron header, and never a "secret unset → open" fail-open).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: "Missing CRON_SECRET" });
  if (req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Not authorized" });
  }

  try {
    const summary = await runDeletions();
    return res.status(200).json(summary);
  } catch (e) {
    console.error("[process-deletions] fatal:", e);
    logError({
      source: "server", severity: "error", area: "other", route: "api/process-deletions",
      error_type: `http_${e.status || 500}`, message: e.message, status_code: e.status || 500,
    });
    return res.status(500).json({ error: e.message });
  }
}
