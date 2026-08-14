// nativeFetch must be the FIRST import: it patches window.fetch for the native
// shell before any module-scope code can issue an API call.
import './nativeFetch.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import { isNativeIOS } from './platform.js'
import { checkForOtaUpdate } from './nativeOta.js'

// Vercel Web Analytics (page views only — no Speed Insights, that's paid and
// declined). inject() no-ops safely in local dev; it only reports once deployed
// on Vercel with Web Analytics enabled for the project.
//
// The semicolon here is LOAD-BEARING. On 08-13 this line had none, and the
// parenthesized IIFE below joined onto it as `inject()(async () => {...})()` —
// a module-scope TypeError that took down prod web AND bricked TestFlight
// build 5 before React could mount. Every statement in this file that precedes
// a `(` keeps its semicolon, and every IIFE leads with one.
inject();

// Native status bar. capacitor.config.json can only carry ONE value, baked into the
// binary, so it was light text on the retired #04060c ground — wrong on the light
// brand, and unreadable whichever single value we pick once dark mode exists. The
// plugin already ships in the binary, so driving it from here follows the app's own
// theme and rides the OTA channel instead of needing a new build. Best-effort and
// never awaited: on web the import simply no-ops.
;(async () => {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const dark = localStorage.getItem("wilco_theme") === "dark";
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#04060c" : "#EFEFEF" });
  } catch (_) { /* plugin missing or web — the config default stands */ }
})();

// OTA freshness check — moved HERE from WilcoRoot's boot effect on 08-14. It must
// not depend on React mounting: if the running bundle crashes before first render,
// the effect never fires and the device can never download the fixed bundle — the
// app is permanently dead until a new binary ships. Exactly what happened to
// TestFlight build 5. Fire-and-forget, never blocks paint (see src/nativeOta.js).
if (isNativeIOS()) checkForOtaUpdate().catch(() => {});

// The app module is imported DYNAMICALLY for the same reason the OTA check lives
// above: a module-scope crash anywhere in App.jsx's import graph must not take
// this file down with it. The failure path keeps the boot splash, tells the user,
// and — on native — the OTA check above has already staged a fix for next launch.
const root = ReactDOM.createRoot(document.getElementById('root'));
import('./App')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  })
  .catch((e) => {
    console.error("[boot] app bundle failed to start:", e);
    const el = document.getElementById('root');
    if (el) el.innerHTML =
      '<div class="boot boot-splash" style="flex-direction:column;gap:12px">' +
        '<div class="boot-brand">WILCO</div>' +
        '<div style="font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#555">' +
          'Something went wrong starting up. Close the app fully and reopen it.' +
        '</div>' +
      '</div>';
  });
