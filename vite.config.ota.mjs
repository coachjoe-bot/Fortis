// ─── OTA SINGLE-FILE BUILD (native iOS live-update channel only) ─────────────
// Produces ONE self-contained HTML file (JS/CSS inlined, no separate hashed
// /assets/ chunks) into dist-ota/. This is NOT what Vercel serves to browsers —
// the normal multi-chunk build (vite.config.js -> dist/) is untouched and keeps
// its cache-friendly per-chunk hashing for the web/PWA majority of users.
//
// WHY a separate single-file build at all: the native OTA bootstrap (see
// ios/App/App/OtaUpdater.swift) downloads ONE file, sha256-verifies it, and
// points the WKWebView at it. A multi-file bundle would need the native side to
// fetch+verify N files and reconstruct relative paths — real complexity for a
// mechanism whose whole selling point (per the build plan, §1) is "~150-250
// lines, auditable." One file in, one file rendered, is the simplest thing that
// can possibly work and the easiest to security-review.
//
// Consumed by scripts/build-app-version.mjs, which runs this, hashes the output,
// and publishes it (+ /app-version.json) into public/ before the normal `vite
// build` runs — so both land in dist/ and ship on the next ordinary Vercel deploy.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist-ota',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // inline everything — this build has no other consumer
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
})
