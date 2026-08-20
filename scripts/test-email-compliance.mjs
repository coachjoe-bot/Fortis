// Email-compliance regression suite (CAN-SPAM, Will's 08-19 "make all the
// emailing legal" ruling). Two layers:
//   1. Behavior of api/_email.js: token determinism, footer contents, the
//      fail-closed suppression check.
//   2. Sender contracts: every outbound surface carries the postal footer;
//      the RECURRING surfaces (proof-feed digests, weekly report) also check
//      suppression and send one-click unsubscribe headers; the TRANSACTIONAL
//      surfaces must NOT be suppression-gated (an unsubscribed athlete still
//      gets PIN recovery).
// Run with: node scripts/test-email-compliance.mjs

import { readFileSync } from "node:fs";

process.env.CRON_SECRET = process.env.CRON_SECRET || "test-secret-for-suite";

const { unsubToken, unsubUrl, emailFooter, unsubHeaders, isUnsubscribed, normEmail, POSTAL_LINE } =
  await import("../api/_email.js");

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}`); } };

// ── _email.js behavior ────────────────────────────────────────────────────────
ok(normEmail("  Coach@Example.COM ") === "coach@example.com", "normEmail lowercases + trims");
ok(unsubToken("a@b.com") === unsubToken(" A@B.COM "), "token is address-normalized (same link for same inbox)");
ok(unsubToken("a@b.com") !== unsubToken("c@d.com"), "different addresses get different tokens");
ok(/^[0-9a-f]{32}$/.test(unsubToken("a@b.com")), "token is 32 hex chars");

const url = unsubUrl("coach@example.com");
ok(url.startsWith("https://app.trainwilco.com/api/unsubscribe?e="), "unsubscribe URL targets prod endpoint");
ok(url.includes(`t=${unsubToken("coach@example.com")}`), "URL carries the address's own token");
{
  const e = new URL(url).searchParams.get("e");
  ok(Buffer.from(e, "base64url").toString("utf8") === "coach@example.com", "URL round-trips the address");
}

ok(POSTAL_LINE.includes("801 International Pkwy"), "postal line is the ToS address");
const plain = emailFooter("a@b.com");
ok(plain.includes("801 International Pkwy") && !plain.includes("Unsubscribe"),
   "transactional footer: address yes, unsubscribe no");
const rec = emailFooter("a@b.com", { unsubscribe: true });
ok(rec.includes("801 International Pkwy") && rec.includes("/api/unsubscribe?e="),
   "recurring footer: address + working unsubscribe link");

const hdrs = unsubHeaders("a@b.com");
ok(hdrs["List-Unsubscribe"].startsWith("<https://") && hdrs["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click",
   "RFC 8058 one-click headers");

// Fail CLOSED: with no reachable database, an address reads as unsubscribed.
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no db in tests"); };
  ok((await isUnsubscribed("a@b.com")) === true, "suppression check fails closed on DB error");
  ok((await isUnsubscribed("")) === true, "empty address never sends");
  globalThis.fetch = realFetch;
}

// ── Sender contracts ─────────────────────────────────────────────────────────
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const RECURRING = ["api/trigger-proof-feed.js", "api/send-weekly-report.js"];
for (const f of RECURRING) {
  const s = src(f);
  ok(s.includes("isUnsubscribed("), `${f} honors opt-outs before sending`);
  ok(s.includes("unsubHeaders("), `${f} sends one-click unsubscribe headers`);
  ok(s.includes("emailFooter(") && s.includes("unsubscribe: true"), `${f} carries the full compliance footer`);
}

const TRANSACTIONAL = [
  "api/send-athlete-welcome.js", "api/send-coach-welcome.js",
  "api/send-coach-invite.js", "api/send-pin-recovery.js",
  "api/notify-program-changes.js",
];
for (const f of TRANSACTIONAL) {
  const s = src(f);
  ok(s.includes("emailFooter("), `${f} carries the postal-address footer`);
  ok(!s.includes("isUnsubscribed("), `${f} is transactional: never suppression-gated`);
}

// The endpoint exists and takes both verbs (RFC 8058 sends POST).
{
  const s = src("api/unsubscribe.js");
  ok(s.includes('req.method !== "GET" && req.method !== "POST"'), "unsubscribe endpoint accepts GET + POST");
  ok(s.includes("timingSafeEqual"), "token compare is constant-time");
}

if (fail) { console.error(`\n${fail} FAILURE(S) (${pass} passed)`); process.exit(1); }
console.log(`\nAll ${pass} email-compliance checks pass.`);
