// ─── SELF-HOSTED OTA (native iOS live-update) — build plan §1/§6 step 3 ───────
// At native launch, poll the static /app-version.json manifest (built by
// scripts/build-app-version.mjs, deployed as an ordinary static file — no new
// Vercel function). If its content-addressed `version` differs from what's
// already applied on this device, download the ONE single-file bundle it points
// at, verify its sha256, and hand it to Capacitor's OWN built-in "swap the served
// directory" mechanism (the `WebView` core plugin's setServerBasePath /
// persistServerBasePath — this is not new/custom native code, it's the same hook
// Capacitor ships for its own live-update story). No custom Swift required.
//
// Fallback guarantee, by construction, not by a try/catch alone:
//  - Any failure below (network, timeout, checksum mismatch, write failure)
//    simply returns without calling setServerBasePath/persistServerBasePath —
//    the CURRENT session keeps running on whatever is already loaded, and the
//    NEXT cold launch falls back to the last successfully-persisted version, or,
//    if one was never persisted, to the bundled copy inside the binary (the
//    ios/App/App/public/ snapshot baked in at `npx cap sync` time). Capacitor's
//    own CAPBridgeViewController.isNewBinary check additionally ignores any
//    persisted path the moment the binary itself is upgraded via the App
//    Store — a fresh install/update ALWAYS starts from the bundled copy, never
//    a stale OTA snapshot from a previous binary.
//  - The swap only ever takes effect on the NEXT launch, never mid-session —
//    hot-swapping the served root under a live app risks losing in-progress
//    state (an open QuickLog draft, an unsent chat message).
//
// Where this is called from: WilcoRoot's boot effect in src/App.jsx, gated on
// isNativeIOS(), fire-and-forget (never awaited, never blocks first paint).
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { WebView } from "@capacitor/core";
import { isNativeIOS } from "./platform.js";

// Same-origin as the deployed app (app.trainwilco.com in prod; vite dev proxies
// /api but this is a plain static file, so a relative fetch works identically in
// prod and in a native shell pointed at the bundled/OTA copy of THIS same app).
const MANIFEST_PATH = "/app-version.json";
const OTA_SNAPSHOT_ROOT = "NoCloud/ionic_built_snapshots"; // fixed by Capacitor's own instanceDescriptor() default — see node_modules/@capacitor/ios source
const PREF_APPLIED_VERSION = "wilco_ota_applied_version";
const PREF_APPLIED_DIR = "wilco_ota_applied_dir"; // last snapshot dir name, so we can prune it once a newer one lands
const FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { signal: ctrl.signal, cache: "no-store" }); }
  finally { clearTimeout(t); }
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Best-effort removal of the PREVIOUS snapshot directory once a new one is
// confirmed applied — keeps only ONE OTA snapshot on disk at a time (the
// bundled binary copy is the real fallback, not a chain of old OTA versions).
async function pruneOldSnapshot(dirName) {
  if (!dirName) return;
  try {
    await Filesystem.rmdir({ path: `${OTA_SNAPSHOT_ROOT}/${dirName}`, directory: Directory.Library, recursive: true });
  } catch { /* best-effort only — a leftover old snapshot costs disk space, not correctness */ }
}

export async function checkForOtaUpdate() {
  if (!isNativeIOS()) return; // web/PWA/Android never run this — they already get updates via the ordinary Vercel deploy
  try {
    const res = await fetchWithTimeout(MANIFEST_PATH, FETCH_TIMEOUT_MS);
    if (!res.ok) return;
    const manifest = await res.json();
    if (!manifest || typeof manifest.version !== "string" || typeof manifest.bundleUrl !== "string") return;

    const { value: appliedVersion } = await Preferences.get({ key: PREF_APPLIED_VERSION });
    if (appliedVersion === manifest.version) return; // already on the latest — nothing to do

    const bundleRes = await fetchWithTimeout(manifest.bundleUrl, FETCH_TIMEOUT_MS);
    if (!bundleRes.ok) return;
    const html = await bundleRes.text();

    if (typeof manifest.sha256 === "string" && manifest.sha256.length === 64) {
      const actual = await sha256Hex(html);
      if (actual !== manifest.sha256) {
        console.error("[ota] checksum mismatch — refusing to apply", { expected: manifest.sha256, actual });
        return;
      }
    }

    const snapshotDir = `v-${manifest.version}`;
    await Filesystem.writeFile({
      path: `${OTA_SNAPSHOT_ROOT}/${snapshotDir}/index.html`,
      directory: Directory.Library,
      data: html,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    const { uri: folderUri } = await Filesystem.getUri({ path: `${OTA_SNAPSHOT_ROOT}/${snapshotDir}`, directory: Directory.Library });
    const nativePath = folderUri.replace(/^file:\/\//, "");

    await WebView.setServerBasePath({ path: nativePath });
    await WebView.persistServerBasePath();

    const { value: previousDir } = await Preferences.get({ key: PREF_APPLIED_DIR });
    await Preferences.set({ key: PREF_APPLIED_VERSION, value: manifest.version });
    await Preferences.set({ key: PREF_APPLIED_DIR, value: snapshotDir });
    if (previousDir && previousDir !== snapshotDir) await pruneOldSnapshot(previousDir);

    console.log(`[ota] applied ${manifest.version} — takes effect on next launch`);
  } catch (e) {
    console.error("[ota] update check failed (non-fatal, keeping current bundle):", e?.message || e);
  }
}
