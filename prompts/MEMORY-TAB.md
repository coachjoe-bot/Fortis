# PAST BLOCKS → MEMORY (Will's 08-29 spec) — build session prompt

Read `~/Documents/Claude/MISSION-CONTROL/MISSION-CONTROL.md` first and claim a
fresh task id on the board (T58 was once double-claimed by a parallel session —
check before taking a number). Then read these memories: 
`project-wilco-t58-ai-system-awareness` (mastermind + athlete_memory design),
`project-wilco-checkin-program-changes` (Program Recs — they live in this tab).

## Will's spec, verbatim intent
Rename the Program modal's PAST BLOCKS subtab to **MEMORY** — "since it really
is just a memory data bank." It holds, in one place:
1. Past blocks (ProgramBlocksPane — closed phases + current block, as today).
2. Drafts, parked Builder interviews, and **Program Recs** (parked / applied /
   reverted — shipped 08-29, see below).
3. **NEW: the AI's context on the athlete, viewable and manually editable** —
   "so the user can manually manipulate it to better help the user." Will also
   wants this as a window for HIMSELF: he wants to watch what the AI decides to
   remember so he can tune how it supports athletes. Legibility is a feature.

## What "AI context" means in this codebase (don't re-derive)
- `athlete_memory` table — the mastermind's structured facts (src/memory.js):
  kinds pinned/contextual/situational, expiry, status active/deleted. Loaded
  into `memoryRows` state in App.jsx (~search "memoryRows"). This INCLUDES the
  Program Rec "Watching:" pattern-gate notes (source:"inferred").
- `athlete_context` table — the LEGACY rolling text blob (dated lines, capped
  via appendAthleteContext ~220 chars/note). Still injected into prompts via
  buildMemoryBlock's legacy tail. The T59 plan already calls for migrating
  this into athlete_memory "at web flag-flip" — this build is the natural
  place to do the READ side at minimum.
- Typed training prefs (`trainingPrefs`), goals, injury history live in their
  own columns/tables and already have surfaces — DON'T fold them in without
  asking Will.

## Build shape (suggested, verify against the code)
- Rename the subtab label (App.jsx, search `"PAST BLOCKS"`); keep the internal
  key `phases` so nothing else moves. Native chat-first only? NO — ask Will:
  the tab rename is visible on web too (web still shows PHASES today). Default
  to gating the RENAME + memory section under CHAT_FIRST_ON like the rest.
- Add a MEMORY section to that pane (alongside ProgramDraftsPane +
  ProgramBlocksPane): list active athlete_memory rows — content, kind chip
  (pinned/contextual/situational), expiry date, source (athlete_said /
  inferred). Actions: edit content inline (sbUpdate, re-validate through
  validateFact — NEVER bypass it: it's the prompt-injection guard), delete
  (status:"deleted"), pin/unpin (kind change), add a fact manually.
- Show the legacy athlete_context blob read-only beneath (one line per dated
  note) with a "these migrate soon" note — or migrate for real if scope allows.
- The gateway allowlist (api/data.js) currently lets athletes write
  athlete_memory — VERIFY which columns before building edit (T32 trap:
  columns not in ATHLETE_COL_ALLOW die silently).
- Memory edits change what the AI is told — buildMemoryBlock reads rows at
  message time, so no extra plumbing should be needed, but VERIFY memoryRows
  refreshes after an edit made from the modal (App-level state vs pane state).

## Open questions for Will (batch into QUESTIONS.md, don't block)
1. Does editing a fact need any guard beyond validateFact (e.g. a length cap
   note in the UI), or fully free-form?
2. Should the "Watching:" pattern-gate notes be shown (transparency) or
   filtered out (noise)? Default: show them under a "watching" chip — he
   explicitly wants to see what the AI tracks.
3. Web parity: rename + memory section web-visible now, or native-first like
   everything else? Default: native-first.
4. Does the legacy athlete_context migrate in this build or just render?

## Working rules (same as every WILCO session)
Full gate ladder: `npm run build` → `node scripts/run-tests.mjs` →
`npx playwright test tests/smoke` → push main → deployed-chunk grep (the App
chunk is referenced from index-*.js, not the HTML) → sim real-eyes under the
native gate (boot iPhone 17 Pro, launch com.trainwilco.wilco TWICE for OTA).
Extend the owning truth suites (test-mastermind for memory contracts; a new
smoke spec for the tab). QA fixture "Claude QA (test)" PIN in .env.qa — clean
any memory rows you write. Board + memory + EVENTS line before ending.
