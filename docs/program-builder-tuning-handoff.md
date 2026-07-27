# Program Builder — Tuning & Tweaks Handoff

**State:** the build is COMPLETE and LIVE ON PROD as BETA (2026-07-24, main `bfe6635`).
All phases of `docs/program-builder-build-handoff.md` shipped: A (subtabs), B (drafts +
block history), C (the Builder AI + doctrine), D (chat redirect, coach summary card,
rebuild-from-block), plus warm-up/cool-down tap-to-log. This doc is for the NEXT kind of
session: beta feedback, doctrine tuning, prompt/UX tweaks, and small extensions. Read it
before touching anything.

## What exists and where

| Piece | File | Notes |
|---|---|---|
| Blueprint cells, scopes, prompts, topic router, draft validator | `src/programBuilder.js` | Pure, no imports from App. Unit tested. |
| Builder UI (interview loop, power cells, draft view, park/resume) | `src/builder.jsx` | Lazy chunk — doctrine text ships ONLY here. |
| Doctrine | `docs/doctrine/` | core + 5 topic files (inseason/team/youth/conditioning/return). Joe's 3-pass interview distillate. |
| Block-history snapshot engine | `src/programHistory.js` | Called fire-and-forget from ALL TEN program_text save paths via `snapshotProgram` (App.jsx). Block-vs-tweak rule: ≥50% changed lines (lineDiff) or forceNewBlock → new row + Haiku summary; else in-place update, zero AI. |
| Drafts subtab (cards + diff gate + resume/rebuild) | `ProgramDraftsPane` in `src/App.jsx` | Shared by athlete modal + coach AthleteDetail. |
| Chat redirect | `src/App.jsx` `builderRedirectPending` | Fires on `program_create_request` for pro+unlocked+non-Field-Mode. Fallback chip runs `builderRedirectFallback` (legacy inline generation). |
| Coach summary card | `src/coach.jsx` (green card) + `applyBuilderText` (App.jsx) | `program_change_requests` row with `source:'builder'` (gateway enum allows it). Actions: Looks good / View / Lock. |
| Warm-up/cool-down booleans | Quick Log sheet chips → `parsed_data.warmup_done/cooldown_done` | Focus-note pattern (`quickLogPrep` ref, outbox `prep`, `qlSave` prep). Coach overview PREP ADHERENCE + proof weekly `brief.prep`. NEVER goes in the parser. |
| Tables | `program_drafts`, `program_history` | RLS-on/zero-policy, gateway-only (`api/data.js` allowlists + athlete col/enum guards; athlete reads of drafts force `owner_type=athlete`). |
| Cost labels | `program_build`, `program_draft`, `program_summary` in `api/claude.js` FEATURES | Check spend: `usage_costs` by feature. |

## Doctrine tuning loop (the most likely ask)
1. Edit `docs/doctrine/*.md`. Keep core small (it rides every Builder call as the cached
   system prefix); topic files load ONE at a time (router priority: return > inseason >
   team > youth > conditioning — `pickTopic` in programBuilder.js).
2. **Re-run the fixture harness on EVERY doctrine edit:**
   `ANTHROPIC_API_KEY=... node scripts/test-program-build.mjs` (needs a real key —
   NOT in local .env; it's in Vercel prod env, Sensitive). 5 fixtures from the original
   handoff; deterministic asserts via `validateDraft` + per-fixture rules.
3. `npm test` (pure suites incl. `test-program-builder-logic.mjs`, `test-program-history.mjs`).
4. Doctrine changes are invisible plumbing-ish but change AI output → preview on the
   demo before prod (below).

## How to test with LIVE AI (no key needed locally)
The demo is the test bed: its `/api/claude` passes through to the deployed function
(real key), everything else is mocked. In `~/dev/WILCO-demo`:
- Sync changed mirrored files from `~/dev/WILCO` (`npm run check:parity` prints the copy
  command and the 16-file list), port any `api/_proof.js` prompt change into
  `src/demoProofEngine.js` (demo-owned copy).
- `preview_start` name `wilco-demo` (port 5176). Logins: Marcus Ellison/1234 (athlete,
  unlocked, has block history + prep data), Coach Reed/4477.
- If state looks stale: run `wilcoDemoReset()` in the console (the pagehide-resurrection
  bug is FIXED — reset actually resets now).
- Demo fixtures for Builder beats live in `demoFixtures.js`: `ALL_PROGRAM_HISTORY`,
  `ALL_PROGRAM_DRAFTS` (parked coach interview), `BUILDER_SAVE_CARD` (green coach card).

## Ship discipline
- User-visible changes: branch → preview → Will reviews → merge (he sometimes waives it —
  ask/announce, don't assume). Invisible plumbing may go main-direct.
- After merging prod main: resync demo (mirrored files byte-identical; `check:parity`
  green), `npm test` both repos, `npx vercel --prod --yes` in BOTH `~/dev/WILCO` and
  `~/dev/WILCO-demo`. The CLI hangs after upload in this env — background it and check
  `npx vercel ls` instead of waiting.
- Verify prod in a previously-used browser only after purging "/" from CacheStorage
  (wilco-v4 SW serves navigations from cached shell).
- **WILCO-demo has NO git remote** — commit locally, never expect a push to work.
- Probe athletes on prod: create via SQL (`crypt('<pin>', gen_salt('bf',10))` works with
  the app's bcrypt login), name them obviously, DELETE when done (cascades cover
  drafts/history; delete `legal_acceptances` first if they went through signup).

## Known sharp edges
- Vercel PREVIEW deployments cannot run AI: `ANTHROPIC_KEY` is Production-only AND
  Sensitive (uncopyable via CLI). Only Will can tick Preview in the dashboard.
- `builder.jsx` imports doctrine via `?raw` from `../docs/doctrine/` — renaming doctrine
  files breaks the build. The cached-prefix must stay byte-identical within a session
  (topic is locked at first pick via `topicRef`) or Anthropic cache hits stop.
- The Program modal subtab resets on CLOSE, not open (deep-links pre-set the subtab
  before opening). Don't "fix" that back.
- Athlete quick-scope is deliberately absent (quick = coach-only, per the original
  handoff). Athlete quick builds stay in chat / Field Mode.
- Never add `env(safe-area-inset-bottom)` to bottom bars; flush every behavior change to
  all sibling call sites (the snapshot engine has TEN callers — grep `snapshotProgram(`).

## 2026-07-27 beta-feedback wave (branch feat/builder-tweaks)
First real-user pass (Will) surfaced three live defects + a UX wave. Shipped:
- **P0 gateway fix:** athlete `program_history` inserts 403'd on `applied_at`
  (not allowlisted) → program_history was EMPTY on prod since launch. Also the
  root cause of "how does it know my last block?" — it never did.
- **park() never nulls draft_text** (interview parks were erasing finished
  drafts); parks serialized on a chain (no double-insert); park returns the row id.
- **Builder stays mounted** across subtab switches (athlete modal + coach) and
  **auto-resumes** the latest open draft row on mount — no more re-generated
  first question, no lost sessions on modal close. `onParked` finally wired
  (Park/Save&exit now visibly land you in Drafts).
- **Background drafting:** module-scope GEN registry; DRAFT IT keeps writing
  after the pane unmounts and parks the finished draft to the row. Animated
  drafting screen with rotating status lines + "you can leave" note.
- **Confirm-don't-prefill:** precharge() now yields PENDING (amber half-charge)
  for everything known; extractor accepts confirmations ("yes, still 4 days");
  interviewer framed on the NEXT block, asks keep-chasing-or-shift on stale
  goals; at 100% invites "keep talking" (extractor `notes` → draft EXTRA NOTES).
- **Reset button** (armed confirm) wipes the session + re-precharges fresh;
  "Start a new program" from the saved state does the same.
- **Athletes get ONE version** (scope buttons hidden; short/quick stay coach-only).
- **Colors:** cyan → CA.accent blue throughout the Builder; blueprint master
  cell charges white at 100%; DRAFT IT is the blue-gradient primary.
- **Past Blocks is its own subtab** (4th tab, athlete + coach). Drafts is the
  workbench only; "Open & edit" routes into the Builder (AI editor always there).
- **Block system v1:** closed rows never evolve; "Start next block" explicit
  boundary; AI **block recap** (logs+goal → HIT/CLOSE/STILL CHASING) written on
  every close into `program_history.block_recap` (migration applied, additive);
  recap rides the next interview's hand-off cell; zero-history accounts backfill
  their current program on first Past Blocks view. Full design + roadmap:
  `docs/program-builder-blocks-goals-design.md`.

## Likely tweak backlog (nothing committed, gather from Will/beta)
- Interviewer voice/pacing tuning from real transcripts (check `program_drafts.transcript`
  of real interviews — remember they're user PII, read only what's needed).
- Draft format polish per Will's taste (drafterSystem in programBuilder.js; plain text,
  no markdown, no "doctrine" mentions — validator + fixtures enforce the floor).
- Doctrine gaps surfaced by usage: the open-questions.md process — flag scenarios where
  the AI had to guess, route back to Joe/Will.
- Possible later: push notification on the coach Builder card (currently in-app card
  only), staged-panel deep-link into Builder edit mode (decided AGAINST for v1 — keep
  the shipped fast path unless Will asks).
- Cost check-in: `select feature, count(*), sum(cost)` on usage_costs for program_*
  labels after a week of beta.
