# T59 — Review & fix session (chat-first + mastermind on TestFlight)

**Paste Will's findings under FINDINGS below, then work them top to bottom.**
Read `~/Documents/Claude/MISSION-CONTROL/MISSION-CONTROL.md` first (T59 row), plus
memory `project-wilco-t58-ai-system-awareness` — it holds every ruling and gotcha.

## What you're fixing
The 08-24/25 T59 build: the mastermind brain + chat-first UI, LIVE on the native
(TestFlight) surface only, `main @ c6232f6`. Will drove it on his phone and hit
issues; this session fixes them surgically. He is the ONLY native user — fixes
to flag-gated surfaces may go direct to main after the full ladder, but anything
touching the web/legacy path still follows branch → preview → Will.

## The map (where everything lives)
- Flags: `src/flags.js` — `CHAT_FIRST_ENABLED` + `MASTERMIND_ENABLED`, both live
  only where `isNativeIOS()` (App.jsx `CHAT_FIRST_ON` / `MASTERMIND_ON`; web
  previews via `?chatfirst=1&mastermind=1` on app.trainwilco.com).
- Chat-first UI: all in `src/App.jsx` — dock/sheet state + handlers right after
  `dismissDock`; workout bar/sheet + program bar/sheet + blueprint strip render
  near the composer (`grep "T58"` finds every block). Builder engine:
  `src/builderChat.js` (re-housed brains from `src/programBuilder.js`; parks to
  `program_drafts`, resumes from the Past Blocks pane).
- Mastermind: card `src/ai/card.js` · tools `api/_tools.js` + passthrough in
  `api/claude.js` (tool_use SSE relay) · memory `src/memory.js` +
  `athlete_memory` table (all four `api/data.js` allowlist points) · tool
  execution `executeMasterTools` in App.jsx (position/pref merge into `parsed`).
- Contracts: `scripts/test-mastermind.mjs` (87 checks) · smoke
  `tests/smoke/chat-first.spec.js` + `builder-chat.spec.js` (builder AI mocks in
  `tests/smoke/mocks.js`).

## Known rough edges (check against Will's findings first — likely culprits)
1. **Opener chips missing on a warm reopen**: the restored-transcript boot path
   never re-sets `openerChoicePending`, so the opener question can show with no
   chips (seen in the sim 08-25 ~2:31). Pre-existing, but reads broken now.
2. **Bar fails to appear on "Yes, starting now"** if the Quick Log draft wasn't
   parked yet — `openDockFromStore` reads `qlLoad` once with no retry.
3. **Sheet geometry**: overlay top/bottom use `hdrRef/composerRef` offsetHeight
   with fallbacks — check notch/safe-area fit on a real device, both themes.
   (NO env(safe-area-inset-bottom) — standing rule.)
4. **Session not restored after app relaunch** in the sim (login re-asked) —
   confirm whether real-device TestFlight does the same (token/biometric path).
5. **Double memory**: legacy "remember that" context blob AND `remember_fact`
   can both store; migration of `athlete_context` → `athlete_memory` is pending.
6. **Dark theme**: dock/sheet/strip use CA tokens so dark renders in dark's
   palette, but nobody has eyeballed it. Dark's original look is sacred.
7. Builder-chat v1 skipped the feasibility line and named-phase templates;
   resumed interviews replay as plain bubbles (chips return on the next turn).
8. OTA needs a full close + reopen to apply (stage-then-apply); "old UI on
   first open" is that, not a failed deploy.

## FINDINGS (Will's 08-25 phone batch — ALL 7 FIXED, wave 1, main `8b52cbe`)
1. ✅ Sheet slides up but POPS closed → visibility now rides the .3s transition (both sheets).
2. ✅ Live Activity tap opened the OLD Quick Log screen → `openLogSurface`: chat + sheet open (also the quicklog push target).
3. ✅ Footer looked like something was behind it → stale render-time offsetHeight; ResizeObserver-measured sheet frame.
4. ✅ Date ⓘ did nothing → tap-toggled hint bubble (no hover on iOS).
5. ✅ kg in chat / lbs in log + Live Activity → `draftInUnit` (boot.js) at dock entry + card builds + QL-edit reply. NOTE: Will's row is `weight_unit=kg` — all three now speak kg until he flips Settings.
6. ✅ Top section rough → native chat-first header nav is a balanced full-width bar (web untouched).
7. ✅ Live Activity lagged sheet edits → debounced (600ms) deterministic card re-render on every edit; chat regens also refresh a raised sheet. (Only fix not sim-provable — needs a pinned activity; confirm on the phone.)
Ladder run: build · 33 unit (+11 draftInUnit) · 46 smoke (+2) · push main · chunk grep ×3 markers (App chunk resolves via index-*.js!) · sim native-gate real eyes · live 6/6.

## Working rules
- Fix root causes; extend the owning truth suite for every fix (unit or smoke),
  then the full ladder: `npm run build` → `node scripts/run-tests.mjs` (33) →
  `npx playwright test tests/smoke` (44) → push main → deployed-chunk grep
  (App-*.js) → sim real-eyes under the native gate (boot iPhone 17 Pro sim,
  launch com.trainwilco.wilco TWICE for the OTA) → live pass
  `npx playwright test -c playwright.live.config.js` if chat behavior changed.
- QA fixture: athlete "Claude QA (test)" / PIN in `.env.qa` — reuse, never
  remake; clean any position/memory rows you write.
- Prompt/card edits: update `src/ai/card.js` AND the contract doc
  (`MISSION-CONTROL/outputs/T58-athlete-mastermind-card-DRAFT.md`), rerun
  test-mastermind. When Joe flubs a FACT, compute it in code and inject — never
  add another prompt rule.
- ⚠️ Standing: before App Store "Add for Review", retake screenshots on
  chat-first or flip the flags (note in flags.js).
- Board + memory + APP-STATE addendum updated before you end; one EVENTS line.
