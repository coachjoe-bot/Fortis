// ─── PLATFORM DETECTION (native iOS shell vs. web/PWA) ───────────────────────
// Tiny, dependency-free module so both the payments-surgery work (T18 iOS
// payments compliance — see ~/Documents/Claude/MISSION-CONTROL/outputs/T18-appstore-build-plan.md §2)
// and the App Store build (push/OTA/native-feel/biometrics) share ONE
// definition of "are we running inside the Capacitor iOS wrapper right now."
// Runtime check (not a build-time env flag) because the JS bundle itself is
// what the self-hosted OTA mechanism serves — a build-time flag would require
// a SEPARATE iOS-only web build, which defeats live-updating the same bundle
// to web + native alike.
//
// window.Capacitor is injected by the native shell's bridge script before any
// app code runs; it is simply undefined in a browser tab or installed PWA, so
// every check here is safe to call unconditionally on any platform (all
// property access is via optional chaining — nothing here throws).
export const isCapacitorNative = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

export const nativePlatform = () =>
  (typeof window !== "undefined" && window.Capacitor?.getPlatform?.()) || "web";

export const isNativeIOS = () => isCapacitorNative() && nativePlatform() === "ios";
export const isNativeAndroid = () => isCapacitorNative() && nativePlatform() === "android";
