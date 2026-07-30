// ─── PUSH PLATFORM-BRANCH REGRESSION SUITE ────────────────────────────────────
// Covers the one thing the App Store build plan's own risk table (§7) flags as
// the highest-blast-radius change in the native push migration: "APNs migration
// introduces a platform-conditional bug in the shared sendTo()/notifyCoach()/
// runNudges() path that all push types depend on ... test the platform branch
// against a WEB subscription row first (regression check)."
//
// resolveTransport() is the exact decision sendTo() makes before choosing
// web-push vs. APNs — every pre-migration row has no `platform` column value at
// all (NULL), so the single most important case here is "a bare/legacy web row,
// with no platform field whatsoever, must still resolve to webpush." Getting
// this wrong would silently break push for every existing web subscriber.
//
// No network, no mocking, no APNs/VAPID secrets required — this only checks the
// routing decision, not delivery (delivery is exercised by hand via the
// existing POST /api/push {action:"test"} path, same as before this migration).
//
//   node scripts/test-push-platform.mjs
//
import { resolveTransport, pushPayload } from "../api/_push.js";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

console.log("resolveTransport — every pre-migration / web-shaped row stays on webpush:");
check("no platform key at all (every row before this migration)", resolveTransport({ endpoint: "https://fcm.example/x" }), "webpush");
check("platform explicitly 'web'", resolveTransport({ endpoint: "https://fcm.example/x", platform: "web" }), "webpush");
check("platform null", resolveTransport({ endpoint: "https://fcm.example/x", platform: null }), "webpush");
check("platform undefined", resolveTransport({ endpoint: "https://fcm.example/x", platform: undefined }), "webpush");
check("empty string platform (defensive)", resolveTransport({ endpoint: "https://fcm.example/x", platform: "" }), "webpush");
check("garbage platform value doesn't accidentally route to apns", resolveTransport({ endpoint: "x", platform: "android" }), "webpush");
check("a null sub itself doesn't throw and stays on webpush", resolveTransport(null), "webpush");

console.log("\nresolveTransport — only an explicit 'ios' row goes to APNs:");
check("platform 'ios'", resolveTransport({ endpoint: "abc123deviceToken", platform: "ios" }), "apns");

console.log("\npushPayload — badge stays a string (icon URL), never a number:");
// sendApns()'s numeric-badge guard (api/_push.js) deliberately only forwards
// payload.badge to APNs' aps.badge when it's a NUMBER — pushPayload's `badge`
// field is actually an icon URL (a web-push/notification-tray convention), and
// if that shape ever drifted to a number, sendApns would misinterpret it as an
// app-icon badge COUNT instead of silently ignoring it.
const p = pushPayload({ title: "Coach Joe", body: "test", type: "test" });
check("badge field type is string, not number", typeof p.badge, "string");

const total = pass + fail;
console.log(`\n${fail === 0 ? `All ${total} checks passed.` : `${fail} of ${total} FAILED.`}`);
process.exit(fail === 0 ? 0 : 1);
