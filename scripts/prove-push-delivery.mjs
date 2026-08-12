// ─── PROVE PUSH DELIVERY, FOR REAL (T51) ─────────────────────────────────────
// The question T49 does not ask: does a notification reach a device at all.
//
// Everything else about push is testable from code — the routing decision, the
// payload shape, the schedule. Delivery is not. This drives the REAL send path
// (api/_push.js sendTo, the same function every cron calls) against REAL prod
// subscription rows and reports what the push service actually said, so
// "notifications work" stops being a claim read off a source file.
//
// It is deliberately a script and not a test: it sends actual notifications to
// actual phones. Run it before a release, not in a suite.
//
//   node scripts/prove-push-delivery.mjs --dry              # inventory only, sends nothing
//   node scripts/prove-push-delivery.mjs --apns             # APNs credential probe, sends nothing
//   node scripts/prove-push-delivery.mjs --type=feed        # one real push, feed payload
//   node scripts/prove-push-delivery.mjs --type=feed --athlete=<uuid>
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_KEY / VAPID_* from .env. The local VAPID
// keypair MUST match prod's — a mismatched pair silently kills every send, so
// this checks it against the live /api/push vapid-public-key before sending
// anything (see project-wilco-push-notifications: it has happened).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i < 0 || line.trim().startsWith("#")) continue;
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));

const { sendTo, pushPayload, ensureVapid, resolveTransport, DEEP_LINKS, apnsHost } = await import("../api/_push.js");

// ── APNs credential probe ────────────────────────────────────────────────────
// Zero iOS subscriptions have ever existed, so there is no real device token to
// send to — but the provider-auth half of APNs can still be proven, and it is
// the half that silently fails. Apple validates our ES256 provider token BEFORE
// it looks at the device token, so a fabricated-but-well-formed token separates
// the two failure modes cleanly:
//
//   403 InvalidProviderToken → the .p8, key id, or team id is wrong
//   400 BadDeviceToken       → key + team + topic ACCEPTED; only the token is fake
//
// Nothing is delivered to anyone: the token belongs to no device.
if (args.apns) {
  const fake = "0".repeat(63) + "1";
  for (const env of ["production", "sandbox"]) {
    process.env.APNS_ENVIRONMENT = env;
    // apnsHost(env) is the same selection sendApns makes; printed so the log says
    // which of the two namespaces the answer applies to.
    console.log(`\n── ${env} · ${apnsHost(env)} ──`);
    const outcome = await sendTo({ id: "probe", platform: "ios", endpoint: fake },
      pushPayload({ title: "WILCO", body: "credential probe", type: "test" }), "push_subscriptions");
    console.log(`outcome: ${outcome}  (see the [push] line above for the reason)`);
  }
  console.log("\nBadDeviceToken = credentials good. InvalidProviderToken = key/team/bundle wrong.");
  process.exit(0);
}

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sb = async (p) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

// ── The keypair check that has to come first ─────────────────────────────────
const live = await fetch("https://app.trainwilco.com/api/push", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "vapid-public-key" }),
}).then((r) => r.json());
const keysMatch = live.publicKey === process.env.VAPID_PUBLIC_KEY;
console.log(`VAPID keypair vs prod: ${keysMatch ? "MATCH" : "MISMATCH — every send would silently fail"}`);
if (!keysMatch && !args.dry) process.exit(1);

// ── Inventory ────────────────────────────────────────────────────────────────
const athleteSubs = await sb("push_subscriptions?select=*&order=created_at.desc");
const coachSubs = await sb("coach_push_subscriptions?select=*&order=created_at.desc");
const names = Object.fromEntries(
  (athleteSubs.length
    ? await sb(`athletes?id=in.(${athleteSubs.map((s) => `"${s.athlete_id}"`).join(",")})&select=id,name`)
    : []).map((a) => [a.id, a.name])
);

const row = (s, audience) => ({
  audience,
  who: names[s.athlete_id] || s.coach_id || s.athlete_id,
  transport: resolveTransport(s),
  platform: s.platform || "(null → web)",
  age_days: Math.round((Date.now() - new Date(s.created_at)) / 864e5),
  endpoint: String(s.endpoint).slice(0, 42) + "…",
});
console.log("\n── live subscriptions ──");
console.table([...athleteSubs.map((s) => row(s, "athlete")), ...coachSubs.map((s) => row(s, "coach"))]);
console.log(`athlete: ${athleteSubs.length} · coach: ${coachSubs.length} · ` +
  `apns: ${[...athleteSubs, ...coachSubs].filter((s) => resolveTransport(s) === "apns").length}`);

if (args.dry) { console.log("\n--dry: nothing sent."); process.exit(0); }

// ── The actual send ──────────────────────────────────────────────────────────
const type = String(args.type || "test");
if (!(type in DEEP_LINKS)) {
  console.error(`Unknown push type "${type}". Known: ${Object.keys(DEEP_LINKS).join(", ")}`);
  process.exit(1);
}
ensureVapid();

const targets = [
  ...athleteSubs.filter((s) => !args.athlete || s.athlete_id === args.athlete).map((s) => [s, "push_subscriptions", "athlete"]),
  ...coachSubs.filter((s) => !args.athlete).map((s) => [s, "coach_push_subscriptions", "coach"]),
];
const payload = pushPayload({
  title: "WILCO",
  body: String(args.body || "Delivery check. If you can read this, notifications are working."),
  type,
});
console.log(`\n── sending type="${type}" → ${payload.url} ──`);

const results = [];
for (const [sub, table, audience] of targets) {
  const started = Date.now();
  const outcome = await sendTo(sub, payload, table);
  results.push({
    audience,
    who: names[sub.athlete_id] || sub.coach_id || sub.athlete_id,
    transport: resolveTransport(sub),
    outcome,
    ms: Date.now() - started,
  });
}
console.table(results);
console.log(
  `\nsent: ${results.filter((r) => r.outcome === "sent").length} · ` +
  `failed: ${results.filter((r) => r.outcome === "failed").length} · ` +
  `pruned: ${results.filter((r) => r.outcome === "pruned").length}`
);
console.log("\n'sent' means the PUSH SERVICE accepted it. Whether it rendered on a lock");
console.log("screen, and whether the tap landed on the right screen, is only ever");
console.log("provable by a human looking at the phone.");
