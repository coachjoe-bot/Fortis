#!/usr/bin/env node
// ─── OTA MANIFEST GENERATOR (self-hosted live-update, build plan §1/§3) ───────
// Runs BEFORE the normal `vite build` (both in vercel.json's buildCommand and
// npm run build's prebuild chain — see package.json) so its output lands in
// public/ and gets copied into dist/ by the ordinary build, same as any other
// static asset. No new Vercel function, no new vendor.
//
// What it does:
//  1. Builds the native-only single-file bundle (vite.config.ota.mjs -> dist-ota/).
//  2. Hashes that ONE file (sha256) — the hash IS the version. Content-addressed,
//     so "is there a new version" is never a manually-bumped number that can
//     drift from what actually shipped; it changes exactly when the bundle's
//     bytes change and never otherwise.
//  3. Writes public/ota/bundle-<hash12>.html (the file the native app downloads)
//     and public/app-version.json (the manifest the native app polls at launch):
//       { version, bundleUrl, sha256, generatedAt }
//  4. Prunes older public/ota/bundle-*.html files — the native bootstrap only
//     ever wants the CURRENT one; keeping old ones around is dead weight, not a
//     rollback mechanism (rollback is "the native app already has its last-good
//     cached copy AND its bundled fallback," per the plan's fallback design).
//
// Safe to run locally (npm run build) and in CI/Vercel identically.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const otaOutDir = join(root, "dist-ota");
const publicOtaDir = join(root, "public", "ota");
const manifestPath = join(root, "public", "app-version.json");

console.log("[ota] building single-file native bundle...");
// Resolve vite's REAL js entrypoint, not node_modules/.bin/vite. The .bin entry
// is a POSIX `#!/bin/sh` wrapper on this toolchain, so handing it to
// process.execPath means "node <shell script>" and the build dies with
// "SyntaxError: missing ) after argument list". That failure is not local-only:
// vercel.json's buildCommand runs this same script, so it takes prod deploys
// down too. vite/bin/vite.js is plain JS and is what the wrapper ultimately
// execs anyway, so calling it directly is both correct and platform-neutral.
const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  console.error(`[ota] cannot find vite at ${viteBin} — run npm install first`);
  process.exit(1);
}
execFileSync(process.execPath, [viteBin, "build", "--config", "vite.config.ota.mjs"], {
  cwd: root,
  stdio: "inherit",
});

const bundlePath = join(otaOutDir, "index.html");
if (!existsSync(bundlePath)) {
  console.error(`[ota] expected build output missing: ${bundlePath}`);
  process.exit(1);
}
const bundle = readFileSync(bundlePath);
const sha256 = createHash("sha256").update(bundle).digest("hex");
const version = sha256.slice(0, 12); // short, still content-addressed, plenty of collision headroom

mkdirSync(publicOtaDir, { recursive: true });

// Prune previous bundle-*.html files before writing the new one.
for (const f of readdirSync(publicOtaDir)) {
  if (/^bundle-[0-9a-f]+\.html$/.test(f)) {
    try { unlinkSync(join(publicOtaDir, f)); } catch { /* best-effort */ }
  }
}

const bundleFileName = `bundle-${version}.html`;
writeFileSync(join(publicOtaDir, bundleFileName), bundle);

const manifest = {
  version,
  bundleUrl: `/ota/${bundleFileName}`,
  sha256,
  generatedAt: new Date().toISOString(),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`[ota] wrote public/app-version.json + public/ota/${bundleFileName} (${bundle.length} bytes, sha256 ${sha256})`);
