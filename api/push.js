// ─── WEB PUSH ENDPOINT (v2 — notification policy v2) ──────────────────────────
// One route for everything push: the client enables/disables notifications and
// fires a test through POST actions (athlete-authenticated, same token/PIN
// pattern as api/data.js), and the daily inactivity-nudge cron hits GET with the
// CRON_SECRET bearer (same gate as api/trigger-proof-feed.js).
//
// POST { action:"vapid-public-key" }                        -> { publicKey }   (public, no auth)
// POST { auth, action:"subscribe", subscription }           -> { ok }          (upsert by endpoint, bound to caller)
// POST { auth, action:"unsubscribe", endpoint }             -> { ok }          (deletes caller's own row only)
// POST { auth, action:"test" }                              -> { sent, pruned }(immediate test push to caller's devices)
// GET  Authorization: Bearer <CRON_SECRET>                  -> { checked, nudged14, nudged30, pruned }
//
// NOTIFICATION POLICY v2 (Will, 2026-07-04): WILCO sends exactly FOUR kinds of
// push, ever, without Will's explicit sign-off — feed-live (api/trigger-proof-feed.js),
// inactivity (this file), coach programming-update (api/notify-program-changes.js),
// and this file's user-initiated "test." Nothing else.
// POLICY v2.1 (Will sign-off 2026-07-22): three COACH alert types added — injury
// + big-PR (api/data.js insert hooks) and athlete-gone-quiet (this cron, below).
// They back the coach Settings toggles that previously controlled nothing; each
// is gated per-coach via notification_prefs (see notifyCoach in _push.js).
//
// INACTIVITY POLICY (replaces the old repeating 3-day nudge): exactly TWO touches
// per quiet streak — one at 14 days since the athlete's last logged workout, one
// at 30 days — then silence until they log again, which resets the streak and
// re-arms both touches. Tracked in athlete_nudge_state (one row per athlete,
// NOT per device): stage_14_sent_at / stage_30_sent_at record whether each touch
// has already fired for the CURRENT streak, and last_workout_at is the streak
// anchor. A per-athlete table (rather than overloading push_subscriptions,
// which is per-DEVICE) is what makes "have we sent the 14-day touch for THIS
// streak" unambiguous across an athlete's multiple devices — see the migration's
// header for the fuller rationale.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET,
//      SUPABASE_URL + SUPABASE_SERVICE_KEY (via ./_supa.js).

import {
  applyCors, httpErr, str, sbSelect, sbWrite, sbDelete,
  authCaller, tryTokenAuth, authThrottle, clientIp, logError, logPushOutcome,
} from "./_supa.js";
import { ensureVapid, vapidPublicKey, sendToAthlete, pushPayload, notifyCoach, fanOutToDevices, platformOf } from "./_push.js";
import { mapPooled } from "./_pool.js";

const enc = encodeURIComponent;

// Streak thresholds (days since last logged workout).
const STAGE_14_DAYS = 14;
const STAGE_30_DAYS = 30;
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

// Coach Joe inactivity nudges — simple encouragement, no guilt-tripping, rotated
// at random. Two distinct banks (14-day touch is a lighter check-in; 30-day is a
// last honest nudge before we go quiet) so the two touches don't feel identical.
const NUDGE_14_VARIANTS = [
  "Haven't seen a log from you in a couple weeks. No pressure, just checking in — let's get back to it.",
  "It's been 14 days since your last session. Whenever you're ready, I'm here.",
  "Two weeks since we've trained together. Let's get one in today.",
];
const NUDGE_30_VARIANTS = [
  "It's been a month since your last log. Whenever life settles, come back — I'll pick up right where we left off.",
  "30 days quiet. No judgment — just know the door's open whenever you want back in.",
  "It's been a while. If you're ready to start again, I'm ready to coach.",
];

// ── Subscription read, PAGED ─────────────────────────────────────────────────
// This used to be a bare `?select=*` with no bound. PostgREST caps a response at
// its max-rows setting and returns the truncated page WITHOUT erroring, so past
// that cap the cron would simply stop seeing the rest of the athletes — silently,
// forever, with a 200 and a cheerful count. Page explicitly instead, and stop at
// a ceiling that is far above any real subscriber count but still finite.
const SUB_PAGE_SIZE = 1000;
const SUB_MAX_ROWS = 20000;

async function selectAllSubscriptions() {
  const all = [];
  for (let offset = 0; offset < SUB_MAX_ROWS; offset += SUB_PAGE_SIZE) {
    const page = await sbSelect(
      "push_subscriptions",
      `?select=*&order=id.asc&offset=${offset}&limit=${SUB_PAGE_SIZE}`
    );
    all.push(...page);
    if (page.length < SUB_PAGE_SIZE) return all;
  }
  console.error(`[push] subscription read hit the ${SUB_MAX_ROWS}-row ceiling — raise SUB_MAX_ROWS`);
  return all;
}

// ── When a nudge is allowed to land (T51) ────────────────────────────────────
// The cron used to be a single daily fire at 21:00 UTC, which is a reasonable
// 5pm for the Eastern athletes WILCO has today and an indefensible 6am for a
// West-Coast-plus-a-timezone athlete the App Store will hand us. `proof_timezone`
// already exists on every athlete row and the Proof Feed already schedules per
// athlete against it — the nudge cron was simply the one sender that never did.
//
// So: the cron runs HOURLY and each athlete is nudged in the hour their own
// clock reads NUDGE_LOCAL_HOUR. Evening, after training has either happened or
// clearly hasn't. An athlete with no (or an unparseable) timezone falls back to
// the exact behaviour that shipped — the fixed UTC hour — so nobody's cadence
// changes without a timezone to justify it.
const NUDGE_LOCAL_HOUR = 18;      // 6pm, the athlete's own clock
const NUDGE_FALLBACK_UTC_HOUR = 21; // unchanged legacy fire time for tz-less rows

// Exported for scripts/test-push-schedule.mjs — this is pure and the whole
// correctness of "never wake someone at 6am" lives in it.
export function localHourIn(tz, at = new Date()) {
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
      .formatToParts(at);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    return Number.isFinite(h) ? h % 24 : null;
  } catch { return null; }
}

export function nudgeDueNow(athlete, at = new Date()) {
  const local = localHourIn(athlete?.proof_timezone, at);
  if (local == null) return at.getUTCHours() === NUDGE_FALLBACK_UTC_HOUR;
  return local === NUDGE_LOCAL_HOUR;
}

// ── Nudge run (GET, cron-only) ────────────────────────────────────────────────
// Runs hourly; each athlete is considered in their own 6pm hour (see above). For
// each athlete due right now: find their most recent workout, and if none in
// 14/30 days AND the matching stage hasn't already fired for this streak, send it
// and stamp the stage. A workout since the last stage stamp resets last_workout_at
// (via upsert below) which naturally re-arms both stages for the NEXT streak — no
// separate "reset" branch needed, since the 14/30-day check is always relative to
// the CURRENT last_workout_at.
async function runNudges(res) {
  ensureVapid();
  const subs = await selectAllSubscriptions();
  if (subs.length === 0) return res.status(200).json({ checked: 0, nudged14: 0, nudged30: 0, pruned: 0 });

  const bySubscriber = {};
  for (const s of subs) (bySubscriber[s.athlete_id] = bySubscriber[s.athlete_id] || []).push(s);
  const subscribedIds = Object.keys(bySubscriber);
  const subscribedList = subscribedIds.map((id) => `"${id}"`).join(",");

  // Athlete rows FIRST, so the timezone gate runs before any of the expensive
  // per-athlete work. On 23 of every 24 hourly runs almost nobody is due, and
  // this is what keeps those runs to two cheap queries.
  const allAthleteRows = await sbSelect(
    "athletes", `?id=in.(${subscribedList})&select=id,name,coach_id,proof_timezone`
  ).catch(() => []);
  const athleteById = Object.fromEntries(allAthleteRows.map((a) => [a.id, a]));

  const now = new Date();
  const byAthlete = {};
  for (const id of subscribedIds) {
    // A subscribed athlete with no athletes row at all still gets the legacy
    // fixed-UTC-hour treatment rather than being dropped from the run.
    if (nudgeDueNow(athleteById[id] || null, now)) byAthlete[id] = bySubscriber[id];
  }
  const athleteIds = Object.keys(byAthlete);
  if (athleteIds.length === 0) {
    return res.status(200).json({ checked: 0, skippedOffHour: subscribedIds.length, nudged14: 0, nudged30: 0, pruned: 0 });
  }
  const idList = athleteIds.map((id) => `"${id}"`).join(",");

  // Most recent workout per athlete (single query, then reduced client-side —
  // PostgREST has no native "latest per group"). BOUNDED to the last 31 days:
  // unbounded, this query ships every subscribed athlete's entire history and
  // PostgREST silently truncates at its max-rows cap (1000), which would make an
  // athlete whose newest row fell past the cap read as never-logged and fire a
  // premature nudge. An athlete absent from a 31-day window is by definition 30+
  // days stale — exactly what lastWorkout=null already means to the stage logic
  // below — so bounding preserves who gets nudged while fixing the truncation
  // class. (Deliberately NOT v_athlete_session_counts: that view counts REAL
  // sessions only, but this cron's clock has always reset on ANY workouts row —
  // chat messages included — and switching semantics would start nudging
  // athletes who talk to Joe without logging.)
  const NUDGE_WINDOW_DAYS = 31; // must stay > STAGE_30_DAYS
  const recentWorkouts = await sbSelect(
    "workouts",
    `?athlete_id=in.(${idList})&created_at=gte.${enc(daysAgo(NUDGE_WINDOW_DAYS))}&select=athlete_id,created_at&order=created_at.desc`
  );
  const lastWorkoutAt = {};
  for (const w of recentWorkouts) {
    if (!lastWorkoutAt[w.athlete_id]) lastWorkoutAt[w.athlete_id] = w.created_at; // first hit per id = latest (query is DESC)
  }

  const stateRows = await sbSelect("athlete_nudge_state", `?athlete_id=in.(${idList})&select=*`);
  const stateByAthlete = Object.fromEntries(stateRows.map((r) => [r.athlete_id, r]));

  const cutoff14 = daysAgo(STAGE_14_DAYS);
  const cutoff30 = daysAgo(STAGE_30_DAYS);

  // Coach quiet-athlete alerts (policy v2.1) ride the SAME once-per-streak stage
  // stamps as the athlete nudges — a coach hears about a quiet athlete exactly
  // when that athlete crosses a stage, never on repeat runs. Name + coach_id for
  // the alert copy; aggregated per coach below so a multi-quiet day is one push.
  const quietByCoach = {}; // coach_id -> [{name, stage}]

  // Per-athlete work runs POOLED, not sequentially. Each athlete costs an awaited
  // push per device plus an awaited state upsert; run end to end that made the
  // cron's wall clock the SUM of every subscriber, under maxDuration 60 — the
  // first thing in the system that breaks on subscriber growth (T46 scale).
  // Concurrency 25 is the width the hourly proof sweep has run at since it
  // shipped. See the ceiling arithmetic in outputs/T51-notification-delivery.md.
  const NUDGE_CONCURRENCY = 25;

  let nudged14 = 0, nudged30 = 0, pruned = 0;
  const perAthlete = await mapPooled(Object.entries(byAthlete), NUDGE_CONCURRENCY, async ([athleteId, rows]) => {
    const lastWorkout = lastWorkoutAt[athleteId] || null; // null = no workout row in NUDGE_WINDOW_DAYS (never logged, or 31+ days quiet — both past every stage cutoff)
    const state = stateByAthlete[athleteId] || null;

    // If the athlete's last workout is NEWER than what we have stamped as the
    // streak anchor (or we've never stamped one), the streak is fresh/reset —
    // clear any stage stamps so both touches are re-armed for THIS streak.
    const priorAnchor = state?.last_workout_at || null;
    const streakReset = lastWorkout && (!priorAnchor || new Date(lastWorkout) > new Date(priorAnchor));

    let stage14Sent = streakReset ? null : (state?.stage_14_sent_at || null);
    let stage30Sent = streakReset ? null : (state?.stage_30_sent_at || null);

    const isStale14 = !lastWorkout || lastWorkout <= cutoff14;
    const isStale30 = !lastWorkout || lastWorkout <= cutoff30;

    let stageToSend = null; // "14" | "30" | null
    if (isStale30 && !stage30Sent) stageToSend = "30";
    else if (isStale14 && !stage14Sent) stageToSend = "14";

    let patch = null;
    if (streakReset) patch = { athlete_id: athleteId, last_workout_at: lastWorkout, stage_14_sent_at: null, stage_30_sent_at: null };

    if (stageToSend) {
      const variants = stageToSend === "30" ? NUDGE_30_VARIANTS : NUDGE_14_VARIANTS;
      const body = variants[Math.floor(Math.random() * variants.length)];
      const payload = pushPayload({ title: "WILCO", body, type: stageToSend === "30" ? "nudge30" : "nudge14" });
      const { pruned: p } = await sendToAthlete(rows, payload);
      pruned += p;
      // Stamp the stage even if every device failed — retrying a broken endpoint
      // tomorrow just burns the run; the rows self-heal (prune) or the athlete
      // re-subscribes, and this is a once-per-streak touch, not a repeating nudge.
      // (T51 re-confirmed this is still the right call: the alternative is a
      // permanently-dead endpoint re-firing every hour forever. The delivery
      // telemetry logPushOutcome now writes is what makes a stamped-but-undelivered
      // nudge VISIBLE rather than merely tolerated.)
      if (stageToSend === "30") { nudged30++; stage30Sent = new Date().toISOString(); }
      else { nudged14++; stage14Sent = new Date().toISOString(); }
      patch = { athlete_id: athleteId, last_workout_at: lastWorkout, stage_14_sent_at: stage14Sent, stage_30_sent_at: stage30Sent };
      const ath = athleteById[athleteId];
      if (ath?.coach_id) (quietByCoach[ath.coach_id] = quietByCoach[ath.coach_id] || []).push({ name: ath.name, stage: stageToSend });
    }

    if (patch) {
      try {
        await sbWrite({
          method: "POST", table: "athlete_nudge_state", query: "?on_conflict=athlete_id",
          body: patch, prefer: "resolution=merge-duplicates,return=minimal",
        });
      } catch { /* state stamp is best-effort — worst case we re-evaluate next run */ }
    }
  });
  void perAthlete; // outcomes are tallied through the closure counters above

  // Fan out one quiet-athlete alert per coach (aggregated), pref-gated in notifyCoach.
  const coachIds = Object.entries(quietByCoach);
  const coachResults = await mapPooled(coachIds, NUDGE_CONCURRENCY, async ([coachId, quiet]) => {
    const body = quiet.length === 1
      ? `${quiet[0].name} has gone quiet — no logged workouts in ${quiet[0].stage} days.`
      : `${quiet.length} athletes have gone quiet: ${quiet.map((q) => `${q.name} (${q.stage}d)`).join(", ")}.`;
    const { sent } = await notifyCoach(coachId, "inactive", { title: "WILCO", body, type: "coach_quiet" });
    return sent ? 1 : 0;
  });
  const coachAlerts = coachResults.reduce((n, r) => n + (typeof r === "number" ? r : 0), 0);

  return res.status(200).json({
    checked: athleteIds.length, skippedOffHour: subscribedIds.length - athleteIds.length,
    nudged14, nudged30, pruned, coachAlerts,
  });
}

// Vercel Pro: cap this function's execution time. 60s gives the nudge run room
// to fan out sends (each is a network call to a browser push service).
export const maxDuration = 60;

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  // ── Cron path: GET gated SOLELY by the CRON_SECRET bearer Vercel injects ──
  // (same gate as api/trigger-proof-feed.js — never the forgeable x-vercel-cron).
  if (req.method === "GET") {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return res.status(500).json({ error: "Missing CRON_SECRET" });
    if (req.headers["authorization"] !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Not authorized" });
    }
    try {
      return await runNudges(res);
    } catch (e) {
      console.error("[push] nudge run failed:", e);
      logError({
        source: "server", severity: "error", area: "sync", route: "api/push",
        error_type: `http_${e.status || 500}`, message: e.message, status_code: e.status || 500,
      });
      return res.status(e.status || 500).json({ error: e.message || "Server error" });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  }
  body = body || {};

  // Public: the VAPID public key is by definition public — no auth needed.
  if (body.action === "vapid-public-key") {
    const key = vapidPublicKey();
    if (!key) return res.status(500).json({ error: "Push not configured" });
    return res.status(200).json({ publicKey: key });
  }

  let caller = null;
  try {
    // Same auth pattern as api/data.js: token fast path, throttled PIN fallback.
    caller = tryTokenAuth(body.auth);
    if (!caller) {
      const recordAuthFail = await authThrottle(`push-authfail:${clientIp(req)}`);
      try {
        caller = await authCaller(body.auth);
      } catch (e) {
        if (e.status === 401) await recordAuthFail();
        throw e;
      }
    }
    if (caller.role !== "athlete" && caller.role !== "coach") throw httpErr(403, "This account can't manage notifications");
    // Coaches subscribe their own devices to a parallel table (the athlete table's
    // athlete_id is NOT NULL). Same actions, role-routed to the right table/column.
    const isCoachCaller = caller.role === "coach";
    const subTable = isCoachCaller ? "coach_push_subscriptions" : "push_subscriptions";
    const ownCol = isCoachCaller ? "coach_id" : "athlete_id";

    // Platform-aware subscribe (App Store build plan §3/§6 step 5): native iOS
    // sends a raw APNs device token, not a Web Push subscription object — same
    // upsert-by-endpoint pattern, same auth, same per-role table routing, just a
    // different request shape and a `platform` tag on the row so sendTo() (in
    // _push.js) knows which transport to use later. Web callers are entirely
    // unaffected: omitting `platform` (or sending "web") takes the exact path
    // that shipped in v1/v2.
    if (body.action === "subscribe") {
      const platform = body.platform === "ios" ? "ios" : "web";

      if (platform === "ios") {
        const deviceToken = str(body.deviceToken, { max: 300, name: "deviceToken" });
        if (!/^[0-9a-fA-F]+$/.test(deviceToken)) throw httpErr(400, "deviceToken must be a hex APNs token");
        await sbWrite({
          method: "POST", table: subTable,
          query: "?on_conflict=endpoint",
          body: {
            [ownCol]: caller.id, endpoint: deviceToken, platform: "ios", p256dh: null, auth: null,
            user_agent: String(req.headers["user-agent"] || "").slice(0, 200) || null,
          },
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        return res.status(200).json({ ok: true });
      }

      const sub = body.subscription;
      if (!sub || typeof sub !== "object") throw httpErr(400, "subscription is required");
      const endpoint = str(sub.endpoint, { max: 1000, name: "endpoint" });
      if (!/^https:\/\//.test(endpoint)) throw httpErr(400, "endpoint must be an https URL");
      const keys = sub.keys || {};
      const p256dh = str(keys.p256dh, { max: 300, name: "p256dh" });
      const auth = str(keys.auth, { max: 300, name: "auth" });
      await sbWrite({
        method: "POST", table: subTable,
        query: "?on_conflict=endpoint",
        body: {
          [ownCol]: caller.id, endpoint, p256dh, auth, platform: "web",
          user_agent: String(req.headers["user-agent"] || "").slice(0, 200) || null,
        },
        prefer: "resolution=merge-duplicates,return=minimal",
      });
      return res.status(200).json({ ok: true });
    }

    // A13: does THIS browser's endpoint exist in the CALLER's own table? The coach
    // Settings toggle used to seed from the browser subscription alone — on any
    // device where an athlete had enabled push, a coach saw "On" while
    // coach_push_subscriptions had no row and digest pushes never arrived.
    if (body.action === "status") {
      const endpoint = str(body.endpoint, { max: 1000, name: "endpoint" });
      const rows = await sbSelect(subTable, `?endpoint=eq.${enc(endpoint)}&${ownCol}=eq.${enc(caller.id)}&select=id`);
      return res.status(200).json({ registered: rows.length > 0 });
    }

    if (body.action === "unsubscribe") {
      const endpoint = str(body.endpoint, { max: 1000, name: "endpoint" });
      // Scoped to the caller: you can only ever delete your own subscription row.
      await sbWrite({
        method: "DELETE", table: subTable,
        query: `?endpoint=eq.${enc(endpoint)}&${ownCol}=eq.${enc(caller.id)}`,
        prefer: "return=minimal",
      });
      return res.status(200).json({ ok: true });
    }

    // "welcome" fires automatically the moment notifications are turned on (client
    // enablePush); "test" is the legacy manual variant. Same payload.
    if (body.action === "test" || body.action === "welcome") {
      ensureVapid();
      const rows = await sbSelect(subTable, `?${ownCol}=eq.${enc(caller.id)}&select=*`);
      if (rows.length === 0) return res.status(200).json({ sent: 0, pruned: 0 });
      const payload = pushPayload({
        title: "WILCO", // every push is from WILCO, never a persona (Will, 08-11)
        body: isCoachCaller ? "Notifications are on. I'll flag what needs you." : "Notifications are on. I'll keep you posted.",
        type: body.action,
      });
      // Prunes from the caller's OWN table (coach rows live in coach_push_subscriptions).
      const tally = await fanOutToDevices(rows, payload, subTable);
      logPushOutcome({
        pushType: payload.type, platform: platformOf(rows), outcomes: tally,
        role: caller.role, athleteId: isCoachCaller ? null : caller.id, coachId: isCoachCaller ? caller.id : null,
      });
      // `failed` is returned so the client can tell "you have no devices" (sent:0,
      // failed:0) apart from "your device rejected it" (sent:0, failed:1) — the
      // exact distinction that made the empty subscription table invisible.
      return res.status(200).json({ sent: tally.sent, pruned: tally.pruned, failed: tally.failed });
    }

    throw httpErr(400, "Unknown action");
  } catch (e) {
    const status = e.status || 500;
    // Mirror api/data.js: log genuine reliability events (5xx) only — routine
    // 4xx auth/validation results are normal user flow, not failures.
    if (status >= 500) {
      logError({
        source: "server", severity: "error", area: "sync", route: "api/push",
        error_type: `http_${status}`, message: e.message, status_code: status,
        role: caller?.role, actor_id: caller?.id,
        athlete_id: caller?.role === "athlete" ? caller.id : null,
        meta: { action: body.action },
      });
    }
    return res.status(status).json({ error: e.message || "Server error" });
  }
}
