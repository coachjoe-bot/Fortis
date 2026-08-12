// ─── NOTIFICATION DEEP-LINK + SCHEDULE SUITE (T51) ────────────────────────────
// Three things this locks down, all of which shipped broken:
//
//   1. Every push type has a REAL destination. All five pushPayload call sites
//      passed url:"/", so every notification opened the app root — "Coach updated
//      your program" included. A new type that forgets DEEP_LINKS fails here.
//   2. The server's targets and the client's targets are the SAME closed set. The
//      two halves live in different files (api/_push.js, src/deepLink.js) and a
//      drift between them is silent: the push sends fine, the client drops the
//      target, and the tap lands on the root exactly like before the fix.
//   3. The nudge schedule never fires at 6am. nudgeDueNow is the whole reason an
//      athlete outside Eastern time isn't woken up, and it is pure.
//
// No network, no secrets, no DB.
//
//   node scripts/test-push-deeplinks.mjs
//
import { DEEP_LINKS, pushPayload, apnsHost } from "../api/_push.js";
import { nudgeDueNow, localHourIn } from "../api/push.js";
import { NOTIFICATION_TARGETS, parseNotificationTarget, armNotificationTarget, takeNotificationTarget, isAthleteTarget, isCoachTarget } from "../src/deepLink.js";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

// Every type the system can send. Adding a push type means adding it here AND to
// DEEP_LINKS — that is the point.
const EVERY_PUSH_TYPE = [
  "feed", "nudge14", "nudge30", "program", "session_card",
  "test", "welcome", "coach_digest", "coach_injury", "coach_pr", "coach_quiet",
];

console.log("Every push type has a destination decision:");
for (const type of EVERY_PUSH_TYPE) {
  check(`${type} is mapped`, Object.prototype.hasOwnProperty.call(DEEP_LINKS, type), true);
}

console.log("\nThe destinations the client can actually consume:");
for (const type of EVERY_PUSH_TYPE) {
  const url = DEEP_LINKS[type];
  if (url === "/") { pass++; console.log(`  ✓ ${type} → app root (no destination, by design)`); continue; }
  const target = parseNotificationTarget(url.slice(url.indexOf("?") + 1));
  check(`${type} → a target src/deepLink.js recognises`, target != null && target in NOTIFICATION_TARGETS, true);
}

console.log("\npushPayload derives the url from the type (the five url:\"/\" call sites' fix):");
check("feed carries the proof destination", pushPayload({ title: "WILCO", body: "x", type: "feed" }).url, "/?n=proof");
check("program carries the program destination", pushPayload({ title: "WILCO", body: "x", type: "program" }).url, "/?n=program");
check("an explicit url still wins", pushPayload({ title: "W", body: "x", type: "feed", url: "/?n=crew" }).url, "/?n=crew");
check("an unknown type degrades to the root, never undefined", pushPayload({ title: "W", body: "x", type: "nope" }).url, "/");
check("type rides along for tap attribution", pushPayload({ title: "W", body: "x", type: "feed" }).type, "feed");
check("welcome no longer shares the feed's tray slot", pushPayload({ title: "W", body: "x", type: "welcome" }).tag, "wilco-welcome");

console.log("\nTarget parsing rejects anything that isn't in the closed set:");
check("a hand-typed target is dropped", parseNotificationTarget("n=../../admin"), null);
check("an empty search is null", parseNotificationTarget(""), null);
check("an unrelated param is null", parseNotificationTarget("utm_source=ig"), null);
check("a real target parses", parseNotificationTarget("n=proof"), "proof");
check("a target among other params still parses", parseNotificationTarget("utm_source=ig&n=program"), "program");

console.log("\nAthlete and coach targets never cross over:");
check("proof is athlete-side", [isAthleteTarget("proof"), isCoachTarget("proof")], [true, false]);
check("coach-roster is coach-side", [isAthleteTarget("coach-roster"), isCoachTarget("coach-roster")], [false, true]);

console.log("\nThe warm-start native path (a full url, not just a target):");
armNotificationTarget("https://app.trainwilco.com/?n=quicklog");
check("a full url arms the target", takeNotificationTarget(), "quicklog");
check("and it is consumed exactly once", takeNotificationTarget(), null);
armNotificationTarget("/?n=nope");
check("an unknown target arms nothing", takeNotificationTarget(), null);

console.log("\nAPNs environment selection (the BadDeviceToken trap):");
check("default is the production gateway", apnsHost(), "https://api.push.apple.com");
check("production is explicit too", apnsHost("production"), "https://api.push.apple.com");
check("sandbox is a DIFFERENT host", apnsHost("sandbox"), "https://api.sandbox.push.apple.com");

console.log("\nNudge scheduling — nobody gets a 6am notification:");
// 2026-08-11T22:00:00Z = 6pm America/New_York (EDT), 3pm America/Los_Angeles.
const at = new Date("2026-08-11T22:00:00Z");
check("Eastern athlete is due at their own 6pm", nudgeDueNow({ proof_timezone: "America/New_York" }, at), true);
check("Pacific athlete is NOT due yet (it's 3pm there)", nudgeDueNow({ proof_timezone: "America/Los_Angeles" }, at), false);
check("Pacific athlete IS due three hours later", nudgeDueNow({ proof_timezone: "America/Los_Angeles" }, new Date("2026-08-12T01:00:00Z")), true);
check("Tokyo athlete is not woken at 7am", nudgeDueNow({ proof_timezone: "Asia/Tokyo" }, at), false);
check("Tokyo athlete gets their own 6pm", nudgeDueNow({ proof_timezone: "Asia/Tokyo" }, new Date("2026-08-11T09:00:00Z")), true);
check("a tz-less athlete keeps the legacy 21:00 UTC fire", nudgeDueNow({ proof_timezone: null }, new Date("2026-08-11T21:00:00Z")), true);
check("...and only that hour", nudgeDueNow({ proof_timezone: null }, at), false);
check("a garbage tz falls back rather than throwing", nudgeDueNow({ proof_timezone: "Not/AZone" }, new Date("2026-08-11T21:00:00Z")), true);
check("a null athlete is handled", nudgeDueNow(null, new Date("2026-08-11T21:00:00Z")), true);
check("localHourIn is honest about an unknown zone", localHourIn("Not/AZone", at), null);

const total = pass + fail;
console.log(`\n${fail === 0 ? `All ${total} checks passed.` : `${fail} of ${total} FAILED.`}`);
process.exit(fail === 0 ? 0 : 1);
