// ─── NOTIFICATION DEEP LINKS — the client half (T51) ─────────────────────────
// Every push used to open the app root. api/_push.js now stamps a destination on
// each payload (its DEEP_LINKS map) as a `?n=<target>` query param, and this
// module is what turns that param into an actual screen.
//
// Why a query param and not a route: WILCO is one page with modal screens, not a
// routed SPA. A path would need a server rewrite for every destination and would
// still land on the same component. `?n=` needs neither — it is read once at
// boot, stripped from the URL bar immediately (so a refresh or a screenshotted
// URL can't re-fire it), and held in memory until the view that owns that screen
// is mounted and can consume it.
//
// The targets are a CLOSED set, mirrored in api/_push.js. Anything unrecognised
// is dropped rather than stored, so a malformed or hand-typed `?n=` can never put
// the app into a state no push can produce. scripts/test-push-deeplinks.mjs
// asserts the two halves agree.

export const NOTIFICATION_TARGETS = {
  // athlete
  proof: "MY LOG → Proof tab (the digest a feed push is announcing)",
  log: "MY LOG → workouts (the inactivity nudges' destination)",
  program: "the athlete's program",
  crew: "MY LOG → Crew",
  quicklog: "today's Quick Log sheet",
  // coach
  "coach-proof": "coach dashboard → the digest",
  "coach-roster": "coach dashboard → roster (injury / PR / gone-quiet alerts)",
};

export const isAthleteTarget = (t) => ["proof", "log", "program", "crew", "quicklog"].includes(t);
export const isCoachTarget = (t) => typeof t === "string" && t.startsWith("coach-");

// Held in memory, not localStorage: a deep link is about THIS launch. Persisting
// it would re-open the Proof tab days later on an unrelated cold start, and a
// stale destination is worse than none.
let pending = null;

// Parse a target out of a URL's search string. Pure, so the suite can exercise
// every shape without a browser.
export const parseNotificationTarget = (search) => {
  try {
    const raw = new URLSearchParams(search || "").get("n");
    if (!raw) return null;
    const t = String(raw).slice(0, 24);
    return Object.prototype.hasOwnProperty.call(NOTIFICATION_TARGETS, t) ? t : null;
  } catch (_) { return null; }
};

// Run at module load, before anything reroutes or tidies the URL — same contract
// as captureCrewInvite. Strips the param on the way out.
export const captureNotificationTarget = () => {
  try {
    if (typeof window === "undefined") return null;
    const t = parseNotificationTarget(window.location.search);
    if (!t) return null;
    pending = t;
    const url = new URL(window.location.href);
    url.searchParams.delete("n");
    window.history.replaceState({}, "", url.toString());
    return t;
  } catch (_) { return null; }
};

// Read once and clear: a target opens its screen exactly one time. Without the
// clear, every re-render of the owning view would yank the athlete back.
export const takeNotificationTarget = () => {
  const t = pending;
  pending = null;
  return t;
};

// Peek without consuming — for a view that wants to know whether a target exists
// for someone ELSE (e.g. the athlete shell ignoring a coach- target).
export const peekNotificationTarget = () => pending;

// A tap that arrives while the app is already running (the native
// pushNotificationActionPerformed path, which has no page load to capture a
// query param) hands its url straight here.
export const armNotificationTarget = (urlOrTarget) => {
  if (!urlOrTarget) return null;
  const s = String(urlOrTarget);
  const t = s.includes("?") ? parseNotificationTarget(s.slice(s.indexOf("?") + 1))
    : (Object.prototype.hasOwnProperty.call(NOTIFICATION_TARGETS, s) ? s : null);
  if (t) pending = t;
  return t;
};
