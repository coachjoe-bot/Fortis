// ─── SELF-HOSTED OTA (native iOS live-update) — build plan §1/§6 step 3 ───────
// At native launch, poll the static /app-version.json manifest (built by
// scripts/build-app-version.mjs, deployed as an ordinary static file — no new
// Vercel function). If its content-addressed `version` differs from what's
// already applied on this device, download the ONE single-file bundle it points
// at, verify its sha256, and STAGE it. The swap to the new bundle happens at the
// START of the NEXT launch, never mid-download.
//
// ── WHY STAGE-THEN-APPLY, learned the hard way (08-14) ────────────────────────
// Capacitor's WebView.setServerBasePath is NOT a passive setter: the native side
// (CAPBridgeViewController.setServerBasePath) queues an IMMEDIATE webView.load
// of the new path. The first version of this file swapped right after the
// download and persisted its "applied version" bookkeeping AFTER the swap — so
// the reload killed the JS context before the bookkeeping landed, the next page
// ran this check again, saw a "new" version again, downloaded and swapped
// again… a visible reload LOOP (the home screen flashing ~8 times over ~15s on
// every launch that followed a deploy) until the persist finally won the race.
//
// The contract now:
//  1. STAGING (this launch): download, verify, write the snapshot, then persist
//     PREF_APPLIED_DIR *before* PREF_APPLIED_VERSION — dir-without-version
//     re-downloads the same content-addressed bytes and converges; version-
//     without-dir would skip the download with nothing staged. NO swap here.
//  2. APPLY (next launch, from main.jsx BEFORE render): if the recorded
//     snapshot is not what this page was served from, setServerBasePath — the
//     reload it triggers lands during the boot splash, costing one barely
//     visible repaint instead of interrupting a live session.
//  3. NEW BINARY: an App Store update's baked bundle supersedes any snapshot
//     from the previous binary (Capacitor's own isNewBinary ignores the
//     persisted path for the same reason). Detect the build-number change,
//     wipe our OTA state, and start clean from the baked copy.
//
// Fallback guarantee, by construction: any failure (network, timeout, checksum
// mismatch, write failure) simply returns without staging — the CURRENT session
// keeps running whatever is loaded, and the NEXT cold launch falls back to the
// last successfully-applied snapshot or the bundled copy inside the binary.
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { WebView } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { isNativeIOS } from "./platform.js";

// Same-origin as the deployed app (app.trainwilco.com in prod; the native shell
// rewrites relative fetches there — see nativeFetch.js).
const MANIFEST_PATH = "/app-version.json";
const OTA_SNAPSHOT_ROOT = "NoCloud/ionic_built_snapshots"; // fixed by Capacitor's own instanceDescriptor() default
const PREF_APPLIED_VERSION = "wilco_ota_applied_version";
const PREF_APPLIED_DIR = "wilco_ota_applied_dir";
const PREF_BINARY_BUILD = "wilco_ota_binary_build";
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

const snapshotFile = (dir) => `${OTA_SNAPSHOT_ROOT}/${dir}/index.html`;

async function snapshotExists(dir) {
  try { await Filesystem.stat({ path: snapshotFile(dir), directory: Directory.Library }); return true; }
  catch { return false; }
}

// Is THIS page being served from the given snapshot dir? Compared by dir-name
// suffix, not full-path equality — iOS reports the same location as /var/… or
// /private/var/… depending on who asks, and a strict compare would re-apply
// (and re-reload) forever on a path-prefix technicality.
async function servingFrom(dir) {
  try {
    const { path } = await WebView.getServerBasePath();
    return typeof path === "string" && path.replace(/\/+$/, "").endsWith(`/${dir}`);
  } catch { return false; }
}

// Best-effort removal of every snapshot EXCEPT the one in use. Runs only on a
// boot that is already serving the kept snapshot — pruning at stage time could
// delete the directory the persisted base path still points at.
async function pruneAllExcept(keepDir) {
  try {
    const { files } = await Filesystem.readdir({ path: OTA_SNAPSHOT_ROOT, directory: Directory.Library });
    for (const f of files || []) {
      const name = typeof f === "string" ? f : f.name;
      if (name && name !== keepDir && name.startsWith("v-")) {
        await Filesystem.rmdir({ path: `${OTA_SNAPSHOT_ROOT}/${name}`, directory: Directory.Library, recursive: true }).catch(() => {});
      }
    }
  } catch { /* nothing to prune, or no snapshot root yet */ }
}

export async function checkForOtaUpdate() {
  if (!isNativeIOS()) return; // web/PWA/Android get updates via the ordinary Vercel deploy
  try {
    // ── 3. New binary? Its baked bundle wins; forget the old binary's OTA state.
    let binaryBuild = null;
    try { binaryBuild = String((await CapApp.getInfo()).build || ""); } catch { /* info unavailable — skip the guard */ }
    if (binaryBuild) {
      const { value: knownBuild } = await Preferences.get({ key: PREF_BINARY_BUILD });
      if (knownBuild !== binaryBuild) {
        await Preferences.remove({ key: PREF_APPLIED_VERSION });
        await Preferences.remove({ key: PREF_APPLIED_DIR });
        await Filesystem.rmdir({ path: OTA_SNAPSHOT_ROOT, directory: Directory.Library, recursive: true }).catch(() => {});
        await Preferences.set({ key: PREF_BINARY_BUILD, value: binaryBuild });
      }
    }

    const { value: appliedDir } = await Preferences.get({ key: PREF_APPLIED_DIR });
    const { value: appliedVersion } = await Preferences.get({ key: PREF_APPLIED_VERSION });

    // ── 2. APPLY a staged snapshot this page is not yet being served from.
    if (appliedDir) {
      if (await servingFrom(appliedDir)) {
        pruneAllExcept(appliedDir); // fire-and-forget housekeeping
      } else if (await snapshotExists(appliedDir)) {
        const { uri } = await Filesystem.getUri({ path: `${OTA_SNAPSHOT_ROOT}/${appliedDir}`, directory: Directory.Library });
        await WebView.setServerBasePath({ path: uri.replace(/^file:\/\//, "") }); // queues an immediate reload
        await WebView.persistServerBasePath(); // best-effort; a lost write just re-runs this branch next boot
        return; // this JS context is about to be torn down
      } else {
        // Recorded snapshot vanished (storage pressure, manual clear) — forget
        // it so the manifest check below can re-download and re-stage.
        await Preferences.remove({ key: PREF_APPLIED_VERSION });
        await Preferences.remove({ key: PREF_APPLIED_DIR });
      }
    }

    // ── 1. STAGE anything newer than what's recorded.
    const res = await fetchWithTimeout(MANIFEST_PATH, FETCH_TIMEOUT_MS);
    if (!res.ok) return;
    const manifest = await res.json();
    if (!manifest || typeof manifest.version !== "string" || typeof manifest.bundleUrl !== "string") return;
    if (appliedVersion === manifest.version) return; // already staged/serving the latest

    const bundleRes = await fetchWithTimeout(manifest.bundleUrl, FETCH_TIMEOUT_MS);
    if (!bundleRes.ok) return;
    const html = await bundleRes.text();

    if (typeof manifest.sha256 === "string" && manifest.sha256.length === 64) {
      const actual = await sha256Hex(html);
      if (actual !== manifest.sha256) {
        console.error("[ota] checksum mismatch — refusing to stage", { expected: manifest.sha256, actual });
        return;
      }
    }

    const snapshotDir = `v-${manifest.version}`;
    await Filesystem.writeFile({
      path: snapshotFile(snapshotDir),
      directory: Directory.Library,
      data: html,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    // Bookkeeping BEFORE any swap could ever happen, dir first (see header).
    await Preferences.set({ key: PREF_APPLIED_DIR, value: snapshotDir });
    await Preferences.set({ key: PREF_APPLIED_VERSION, value: manifest.version });

    console.log(`[ota] staged ${manifest.version} — applies on next launch`);
  } catch (e) {
    console.error("[ota] update check failed (non-fatal, keeping current bundle):", e?.message || e);
  }
}
