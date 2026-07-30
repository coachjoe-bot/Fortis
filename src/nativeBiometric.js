// ─── NATIVE FACE ID (iOS shell only) — build plan §6 step "Face ID" ───────────
// Replaces the web WebAuthn dance (src/App.jsx's biometricEnroll/biometricAssert,
// built on navigator.credentials) with a direct call into LocalAuthentication via
// @aparajita/capacitor-biometric-auth. See the long comment on ROOT CAUSE in
// App.jsx above BIO_PREFIX for why the web version is flaky and why this is a
// platform swap, not a bug fix to the WebAuthn code.
//
// Deliberately tiny: two functions, no enrollment/credential bookkeeping of its
// own. Unlike WebAuthn, LocalAuthentication doesn't "register a credential" —
// it just asks "is the person holding this device the one enrolled in Face ID
// right now?" every time. WILCO's own enrollment record (which role/name/pin this
// device is allowed to unlock) still lives in the existing bioKey() localStorage
// slot in App.jsx — this module only replaces the ASSERTION step.
import { isNativeIOS } from "./platform.js";

export async function nativeBiometricAvailable() {
  if (!isNativeIOS()) return false;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const result = await BiometricAuth.checkBiometry();
    return !!result.isAvailable;
  } catch {
    return false;
  }
}

// Resolves on success, throws on cancel/failure/lockout (same contract the
// WebAuthn navigator.credentials.get() call had, so App.jsx's existing
// try/catch + noteBioFailure bookkeeping around biometricAssert keeps working
// unchanged for the ONE thing that still matters there: falling back to the PIN
// form cleanly). Unlike WebAuthn's NotAllowedError, a native BiometryError.type
// distinguishes user-cancel from an actual scan failure — iOS's own "Try Again"
// sheet handles the retry-after-a-failed-scan case natively, which is exactly
// the flakiness the web version pushed back onto the user as a manual re-tap.
export async function nativeBiometricVerify(reason) {
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  await BiometricAuth.authenticate({
    reason: reason || "Sign in to WILCO",
    cancelTitle: "Use PIN instead",
    allowDeviceCredential: false, // Face ID/Touch ID only — a passcode fallback would bypass the "same person" guarantee the app relies on
  });
}
