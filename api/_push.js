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
import { httpErr, sbDelete, sbSelect } from "./_supa.js";

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
const APNS_HOST = "https://api.push.apple.com"; // production APNs gateway

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
      client = http2.connect(APNS_HOST);
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
      // 410 Unregistered / 400 BadDeviceToken: the device token is dead — prune it,
      // same semantics as a 404/410 from a web-push endpoint.
      if (status === 410 || status === 400) return resolve("pruned");
      console.error(`[push] apns send failed (${status || "network"}):`, body.slice(0, 300));
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
  coach_digest: "wilco-coach-digest",
  coach_injury: "wilco-coach-injury",
  coach_pr: "wilco-coach-pr",
  coach_quiet: "wilco-coach-quiet",
};

// Build a standard payload. `title` varies by type (branding convention: "Coach
// Joe" for Joe-voice pushes — feed/nudges/test — vs "Program Update" for the
// coach-authored one, so an athlete can tell at a glance who's talking); `type`
// selects the tag from TAGS above (falls back to the generic proof-feed tag if
// omitted, matching the pre-v2 payload shape).
export function pushPayload({ title, body, url = "/", type }) {
  return { title, body, url, icon: ICON, badge: ICON, tag: TAGS[type] || "wilco-proof-feed" };
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
    const subs = await sbSelect("coach_push_subscriptions", `?coach_id=eq.${enc(coachId)}&select=*`);
    if (!subs.length) return { sent: 0 };
    const payload = pushPayload(msg);
    let sent = 0;
    for (const s of subs) {
      if ((await sendTo(s, payload, "coach_push_subscriptions")) === "sent") sent++;
    }
    return { sent };
  } catch (e) {
    console.error(`[push] coach alert (${prefKey}) failed:`, e?.message);
    return { sent: 0 };
  }
}

// Send one payload to every subscription row for an athlete (all their devices).
// Returns { sentAny, pruned } — sentAny is true if at least one device got it.
export async function sendToAthlete(rows, payload) {
  let sentAny = false;
  let pruned = 0;
  for (const sub of rows || []) {
    const outcome = await sendTo(sub, payload);
    if (outcome === "sent") sentAny = true;
    if (outcome === "pruned") pruned++;
  }
  return { sentAny, pruned };
}
