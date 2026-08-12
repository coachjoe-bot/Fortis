// ─── WEB PUSH — shared send helper ────────────────────────────────────────────
// Extracted from api/push.js (v1) so every push-sending caller (the subscribe/test
// endpoint, the inactivity-nudge cron, the Proof Feed engine, and the coach
// programming-update cron) shares ONE implementation of "send to a subscription,
// prune dead endpoints, never throw." Underscore-prefixed — Vercel does not route
// this as its own function.
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// APNs (native iOS, App Store build plan §3/§6 step 5): APNS_KEY_ID, APNS_TEAM_ID,
// APNS_PRIVATE_KEY (the .p8 contents, PEM), APNS_BUNDLE_ID.

import http2 from "node:http2";
import crypto from "node:crypto";
import webpush from "web-push";
import { httpErr, sbDelete, sbSelect, logPushOutcome } from "./_supa.js";
import { mapPooled } from "./_pool.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:coachwill@trainwilco.com";

let vapidReady = false;
export function ensureVapid() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw httpErr(500, "Push not configured");
  if (!vapidReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
}

export function vapidPublicKey() {
  return VAPID_PUBLIC_KEY;
}

// ── APNs (native iOS) — token-based provider API over HTTP/2 ─────────────────
// No new npm dependency: Node's built-in http2 module talks to Apple directly,
// and the ES256 "provider authentication token" JWT is signed with the built-in
// crypto module (ECDSA P-256, IEEE-P1363/JWS signature encoding) — a hand-rolled
// three-field JWT is a much smaller, more auditable surface than pulling in a
// whole APNs client library for one POST-per-send. Apple allows one token to be
// reused for up to an hour; we cache it and re-sign only when it's stale.
const APNS_KEY_ID = process.env.APNS_KEY_ID || "";
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || "";
const APNS_PRIVATE_KEY = process.env.APNS_PRIVATE_KEY || "";
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || "com.trainwilco.wilco";

// ── The sandbox-vs-production environment trap (T51) ──────────────────────────
// APNs is TWO separate services with two separate device-token namespaces, and a
// token minted against one is rejected by the other with 400 BadDeviceToken:
//
//   api.push.apple.com          production  ← App Store AND TestFlight builds
//   api.sandbox.push.apple.com  sandbox     ← Xcode/development builds only
//
// The distributed build's `aps-environment` entitlement is what decides which
// environment the DEVICE registers against. ios/App/App/App.entitlements says
// `development`, which is correct in the repo — Xcode's export step rewrites it
// to `production` for App Store and TestFlight distribution. So:
//
//   • TestFlight on Will's phone  → production token → this default host. Works.
//   • Xcode "Run" on a wired phone → sandbox token → 400 BadDeviceToken here,
//     and (before this change) the row got PRUNED as if the device were dead.
//
// APNS_ENVIRONMENT lets a dev build be tested without editing code; unset means
// production, which is what every shipped build uses.
// Read at CALL time, not module load: scripts/prove-push-delivery.mjs --apns
// probes both gateways in one process, and a module-level capture would make the
// second probe silently re-test the first one's host — the exact class of
// false-green this whole section is about.
const apnsEnvironment = () => (process.env.APNS_ENVIRONMENT === "sandbox" ? "sandbox" : "production");
export const apnsHost = (env = apnsEnvironment()) =>
  env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let apnsJwtCache = null; // { token, mintedAt }
const APNS_JWT_MAX_AGE_MS = 45 * 60 * 1000; // Apple allows up to 60m; refresh a bit early

function apnsAuthToken() {
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY) throw httpErr(500, "APNs not configured");
  const now = Date.now();
  if (apnsJwtCache && now - apnsJwtCache.mintedAt < APNS_JWT_MAX_AGE_MS) return apnsJwtCache.token;

  const header = { alg: "ES256", kid: APNS_KEY_ID };
  const payload = { iss: APNS_TEAM_ID, iat: Math.floor(now / 1000) };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // dsaEncoding "ieee-p1363" gives the raw r||s bytes JWS/ES256 requires (vs.
  // Node's default DER encoding, which JWT verifiers reject).
  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key: APNS_PRIVATE_KEY.replace(/\\n/g, "\n"), // Vercel env values often carry literal "\n"
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${b64url(signature)}`;
  apnsJwtCache = { token, mintedAt: now };
  return token;
}

// One HTTP/2 request to APNs for one device token. Resolves to the same
// "sent" | "pruned" | "failed" vocabulary sendTo() already uses, so callers
// never need to know which transport a subscription row uses.
function sendApns(deviceToken, payload) {
  return new Promise((resolve) => {
    // Check config (throws if unconfigured) BEFORE opening any socket — keeps an
    // unconfigured/misconfigured APNs setup a fast, network-free failure (this is
    // also what makes scripts/test-push-platform.mjs safe to run with no APNs
    // secrets present and no real network call).
    let jwt;
    try { jwt = apnsAuthToken(); } catch (e) { return resolve("failed"); }

    let client;
    try {
      client = http2.connect(apnsHost());
    } catch (e) {
      console.error("[push] apns connect failed:", e?.message);
      return resolve("failed");
    }
    client.on("error", (e) => { console.error("[push] apns session error:", e?.message); resolve("failed"); });

    const apnsBody = JSON.stringify({
      aps: {
        alert: { title: payload.title, body: payload.body },
        sound: "default",
        ...(payload.badge != null && typeof payload.badge === "number" ? { badge: payload.badge } : {}),
      },
      url: payload.url,
      tag: payload.tag,
      type: payload.type,
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${encodeURIComponent(deviceToken)}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": APNS_BUNDLE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = null;
    req.on("response", (headers) => { status = headers[":status"]; });
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      client.close();
      if (status === 200) return resolve("sent");
      let reason = "";
      try { reason = JSON.parse(body)?.reason || ""; } catch { /* non-JSON error body */ }
      // 410 Unregistered is the ONLY unambiguous "this device is gone" — the app
      // was deleted or the token was invalidated. Prune it, same semantics as a
      // 404/410 from a web-push endpoint.
      if (status === 410) return resolve("pruned");
      // 400 used to prune too, and that was wrong in the one case most likely to
      // happen (T51): a sandbox token hitting the production gateway answers 400
      // BadDeviceToken, and deleting the row turns a fixable environment mismatch
      // into a silently unsubscribed athlete with nothing left to diagnose. Log
      // loudly with the environment we sent to and KEEP the row.
      if (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")) {
        console.error(
          `[push] apns REJECTED token (${reason}) against the ${apnsEnvironment()} gateway — ` +
          `a token minted by the other environment looks exactly like this. Row kept, not pruned.`
        );
        return resolve("failed");
      }
      console.error(`[push] apns send failed (${status || "network"}${reason ? ` ${reason}` : ""}):`, body.slice(0, 300));
      resolve("failed");
    });
    req.on("error", (e) => { console.error("[push] apns request error:", e?.message); client.close(); resolve("failed"); });
    req.end(apnsBody);
  });
}

// Every push payload gets the same WILCO icon/badge so notifications look
// consistent across the four allowed types + test — "branding" is the icon,
// the title convention, and copy quality; the OS controls everything else about
// how the bubble renders.
const ICON = "/icon-192.png";

// tag scopes which OS notification slot a push lands in — two pushes with the
// SAME tag replace each other in the tray (renotify:true still buzzes, but only
// the newer one is visible). Each notification type gets its own tag so, e.g.,
// a feed-live push can never silently swallow a still-unread coach-update push.
// Explicit map (not a free-form string) keeps these the only types that exist.
// Policy v2.1 (Will sign-off 2026-07-22): the three coach alert types (injury,
// big PR, athlete-gone-quiet) join the original four athlete types + the coach
// digest — they back the Settings toggles that previously controlled nothing.
const TAGS = {
  feed: "wilco-feed",
  nudge14: "wilco-nudge-14",
  nudge30: "wilco-nudge-30",
  program: "wilco-program",
  test: "wilco-test",
  // "welcome" is the auto-fired confirmation the moment notifications are turned
  // on. It had no entry here, so it fell through to the "wilco-proof-feed"
  // default and shared a tray slot with feed pushes — an unread feed push could
  // be silently replaced by a welcome, or vice versa.
  welcome: "wilco-welcome",
  coach_digest: "wilco-coach-digest",
  coach_injury: "wilco-coach-injury",
  coach_pr: "wilco-coach-pr",
  coach_quiet: "wilco-coach-quiet",
};

// ── DEEP LINKS (T51) ─────────────────────────────────────────────────────────
// Every one of the five pushPayload call sites passed `url: "/"`, so "Coach
// updated your program" and "New PRs are in your Proof Feed" both opened the app
// root and left the athlete to go find it. T49 was verifying that taps land
// correctly; this is why they couldn't — there was nothing to land on.
//
// The app is a single page with modal screens, not a routed SPA, so a target is
// a query param the client consumes at boot (`captureNotificationTarget` in
// src/App.jsx) rather than a path a server has to serve. `?n=` is deliberately
// short and opaque: it is stripped from the URL bar on arrival, never persisted,
// and carries no ids — just which screen to open.
//
// Keyed by push TYPE so a new type cannot ship without a decision about where it
// lands: an unmapped type falls back to "/" and scripts/test-push-deeplinks.mjs
// fails the build-adjacent suite until it is added here.
export const DEEP_LINKS = {
  feed: "/?n=proof",              // the digest the push is announcing
  nudge14: "/?n=log",             // "let's get back to it" → the log/chat screen
  nudge30: "/?n=log",
  program: "/?n=program",         // "coach updated your program" → the program
  session_card: "/?n=quicklog",   // the lock-screen card → today's Quick Log
  test: "/",                      // a test proves delivery; it has no destination
  welcome: "/",
  coach_digest: "/?n=coach-proof",
  coach_injury: "/?n=coach-roster",
  coach_pr: "/?n=coach-roster",
  coach_quiet: "/?n=coach-roster",
};

// Build a standard payload. `title` is "WILCO" on every type (Will, 08-11 — the
// app speaks, never a persona); `type` selects both the tray tag from TAGS and
// the deep-link target from DEEP_LINKS. An explicit `url` still wins, for the
// rare caller that has a more specific destination than the type implies.
export function pushPayload({ title, body, url, type }) {
  return {
    title,
    body,
    url: url || DEEP_LINKS[type] || "/",
    icon: ICON,
    badge: ICON,
    tag: TAGS[type] || "wilco-proof-feed",
    type: type || null,   // carried through to the client so a tap can be attributed
  };
}

// Send one push to one subscription row. Returns "sent", "pruned", or "failed".
// 404/410 from the push service mean the subscription is dead — delete the row.
// Any other failure is logged and swallowed so one bad device can't break a batch.
// `table` is where the row came from: athlete devices live in push_subscriptions
// (the default), coach devices in coach_push_subscriptions — the prune must
// target the row's OWN table (it used to hard-code the athlete table, so dead
// coach endpoints were never actually deleted and got retried forever).
//
// Platform branch (App Store build plan §3/§6 step 5): `sub.platform` is NULL
// for every row written before the native iOS migration — those are all web
// rows (the only platform that has ever subscribed until now), so `platform ===
// "ios"` is the ONLY thing that routes to APNs; everything else (undefined,
// null, "web") keeps the exact web-push call that shipped in v1/v2, unchanged.
// Extracted to its own pure function so the routing decision itself — the exact
// thing a platform-branch bug would get wrong — has a direct, network-free
// regression test (scripts/test-push-platform.mjs) independent of whether
// VAPID/APNs secrets are present in the test environment.
export const resolveTransport = (sub) => (sub && sub.platform === "ios" ? "apns" : "webpush");

export async function sendTo(sub, payload, table = "push_subscriptions") {
  if (resolveTransport(sub) === "apns") {
    const outcome = await sendApns(sub.endpoint, payload);
    if (outcome === "pruned") {
      try { await sbDelete(table, `?id=eq.${encodeURIComponent(sub.id)}`); } catch { /* prune is best-effort */ }
    }
    return outcome;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return "sent";
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 404 || code === 410) {
      try { await sbDelete(table, `?id=eq.${encodeURIComponent(sub.id)}`); } catch { /* prune is best-effort */ }
      return "pruned";
    }
    console.error(`[push] send failed (${code || "network"}) for sub ${sub.id}:`, e?.message);
    return "failed";
  }
}

// ── Coach alert fanout (policy v2.1, Will-approved 2026-07-22) ────────────────
// Send one payload to every device of ONE coach, gated on that coach's own
// notification_prefs[prefKey] (undefined counts as enabled — matching the
// Settings toggle's `!==false` rendering and the digest gate in the proof cron).
// Reads the coach row + subscriptions itself. Best-effort: never throws, so a
// failed alert can never break the athlete write or cron run that triggered it.
export async function notifyCoach(coachId, prefKey, msg) {
  if (!coachId) return { sent: 0 };
  try {
    ensureVapid();
    const enc = encodeURIComponent;
    const coach = (await sbSelect("coaches", `?id=eq.${enc(coachId)}&select=id,notification_prefs`))[0];
    if (!coach || (coach.notification_prefs || {})[prefKey] === false) return { sent: 0 };
    const subs = await sbSelect("coach_push_subscriptions", `?coach_id=eq.${enc(coachId)}&select=*&limit=${DEVICE_LIMIT}`);
    if (!subs.length) return { sent: 0 };
    const payload = pushPayload(msg);
    const tallied = await fanOutToDevices(subs, payload, "coach_push_subscriptions");
    logPushOutcome({ pushType: payload.type, platform: platformOf(subs), outcomes: tallied, role: "coach", coachId });
    return { sent: tallied.sent };
  } catch (e) {
    console.error(`[push] coach alert (${prefKey}) failed:`, e?.message);
    return { sent: 0 };
  }
}

// An athlete or coach with more devices than this has a runaway/duplicated
// subscription problem, not a device collection. Bounds the per-recipient fan-out
// so one broken client can't consume a whole cron run.
const DEVICE_LIMIT = 20;

// Devices belonging to ONE recipient go out concurrently — they are independent
// network calls to (usually) different push services, and awaiting them in
// sequence is the shape that made the nudge cron's wall-clock the sum of every
// device it has ever seen.
const DEVICE_CONCURRENCY = 10;

export async function fanOutToDevices(rows, payload, table) {
  const outcomes = await mapPooled(rows || [], DEVICE_CONCURRENCY, (sub) => sendTo(sub, payload, table));
  const tally = { sent: 0, failed: 0, pruned: 0 };
  for (const o of outcomes) {
    if (o === "sent") tally.sent++;
    else if (o === "pruned") tally.pruned++;
    else tally.failed++;
  }
  return tally;
}

// "ios" / "web" / "mixed" — one label for the telemetry row, so the delivery
// views can answer "how many subscriptions are live per platform" and "which
// platform is failing" without unpacking a per-device array.
export const platformOf = (rows) => {
  const kinds = new Set((rows || []).map((r) => (resolveTransport(r) === "apns" ? "ios" : "web")));
  return kinds.size === 1 ? [...kinds][0] : kinds.size ? "mixed" : null;
};

// Send one payload to every subscription row for an athlete (all their devices).
// Returns { sentAny, pruned, sent, failed } — sentAny is kept for the existing
// callers that only ask "did anyone get it."
export async function sendToAthlete(rows, payload) {
  const tally = await fanOutToDevices(rows, payload, "push_subscriptions");
  if (rows?.length) {
    logPushOutcome({
      pushType: payload.type, platform: platformOf(rows), outcomes: tally,
      role: "athlete", athleteId: rows[0]?.athlete_id || null,
    });
  }
  return { ...tally, sentAny: tally.sent > 0 };
}
