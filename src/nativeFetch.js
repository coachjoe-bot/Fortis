// ─── NATIVE API ORIGIN (Capacitor shell only) ────────────────────────────────
// Every API call in the app is a RELATIVE fetch ("/api/identity"). On the web
// that resolves against app.trainwilco.com and is correct. Inside the native
// shell the WebView's origin is capacitor://localhost, so a relative /api call
// never leaves the device — Capacitor's scheme handler answers it with the SPA
// page (a 200), the JSON parse yields {}, and every screen fails in whatever
// way an empty response fails (login shows "couldn't find that account").
//
// One runtime-checked rewrite here keeps every call site relative and keeps ONE
// bundle serving web + native alike (the OTA constraint — see platform.js).
// Server twin: capacitor://localhost must be in ALLOWED_ORIGINS (api/_supa.js)
// or these cross-origin calls die in CORS instead.
import { isCapacitorNative } from "./platform.js";

const API_ORIGIN = "https://app.trainwilco.com";

if (isCapacitorNative()) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return nativeFetch(API_ORIGIN + input, init);
    }
    if (input instanceof Request && new URL(input.url).protocol === "capacitor:") {
      const u = new URL(input.url);
      return nativeFetch(new Request(API_ORIGIN + u.pathname + u.search, input), init);
    }
    return nativeFetch(input, init);
  };
}
