// ─── PLATFORM DETECTION (T18 iOS payments surgery) ───────────────────────────
// Runtime check, not a build-time flag — the same JS bundle is what WILCO's
// planned OTA/live-update mechanism ships to every platform, so a build-time
// env var would require a separate iOS-specific web build and defeat that plan.
// `window.Capacitor` only exists inside a Capacitor-wrapped native shell; it is
// undefined in the browser/PWA, so this is false everywhere except the actual
// iOS app build. See ~/Documents/Claude/MISSION-CONTROL/outputs/T18-appstore-build-plan.md §2.
//
// NOTE: this tiny helper may also be created independently by the parallel
// Capacitor-shell build (a different worktree). If both branches add it
// byte-for-byte identical, the merge just dedupes — no conflict.
export function isNativeIOS() {
  try {
    return typeof window !== "undefined" && window.Capacitor?.getPlatform?.() === "ios";
  } catch {
    return false;
  }
}
