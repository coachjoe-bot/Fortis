// nativeFetch must be the FIRST import: it patches window.fetch for the native
// shell before any module-scope code can issue an API call.
import './nativeFetch.js'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { inject } from '@vercel/analytics'
import App from './App'

// Vercel Web Analytics (page views only — no Speed Insights, that's paid and
// declined). inject() no-ops safely in local dev; it only reports once deployed
// on Vercel with Web Analytics enabled for the project.
inject()

// Native status bar. capacitor.config.json can only carry ONE value, baked into the
// binary, so it was light text on the retired #04060c ground — wrong on the light
// brand, and unreadable whichever single value we pick once dark mode exists. The
// plugin already ships in the binary, so driving it from here follows the app's own
// theme and rides the OTA channel instead of needing a new build. Best-effort and
// never awaited: on web the import simply no-ops.
(async () => {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const dark = localStorage.getItem("wilco_theme") === "dark";
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#04060c" : "#EFEFEF" });
  } catch (_) { /* plugin missing or web — the config default stands */ }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
