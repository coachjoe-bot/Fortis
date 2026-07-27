# Blocks & Goals — the block-boundary system (design + roadmap)

**Status:** v1 SHIPPED on branch `feat/builder-tweaks` (2026-07-27). This doc records
what v1 does, the decisions behind it, and the designed-but-not-built next stages, so
the next session doesn't re-derive it. Read `docs/program-builder-tuning-handoff.md`
first for the file map.

## The problem Will named

A "program" and a "block" are not the same thing. His current program contains two
blocks; he's about to move to the next one. The app only snapshotted history when
`program_text` changed, so it had no concept of a boundary INSIDE a program, no idea
when one block ends and another begins, and no memory of whether the goal attached to
a block was hit or missed. Nothing tucked old-block context away when focus shifted.

## v1 (shipped): explicit boundaries + auto recaps

- **One row in `program_history` = one block** (was already the model). New rules:
  - A CLOSED row never evolves in place — any save after a close opens a new block.
  - `startNextBlock()` (programHistory.js) = the explicit boundary: closes the open
    row and opens a fresh one on the SAME program text, source `next_block`. Surfaced
    as **"Start next block"** on the current block's card in the Past Blocks tab
    (armed confirm, athlete + coach).
- **Block recap on every close** (`closeBlock` in programHistory.js): pulls the
  workouts logged inside the block's date range + the athlete's goal, condenses them
  code-side (`digestWorkouts`), and asks Sonnet for 3–5 Joe-voice sentences: focus,
  what actually got trained (honest adherence), what moved, and the goal verdict —
  **HIT / CLOSE / STILL CHASING**. Stored in `program_history.block_recap` (migration
  `program_history_block_recap`, additive). Close never fails on recap failure.
- **The recap IS the hand-off**: `precharge()` feeds `block_recap` (over the one-line
  summary) into the Builder's Last Block cell, as a PENDING confirmation. So the next
  interview opens with "last block bench moved 15 lbs and the 315 goal is HIT — chase
  further or shift focus?" — the "conversation about the shift" Will asked for happens
  inside the interview, where it belongs.
- **Backfill**: accounts with a live program but zero history (everyone, thanks to the
  applied_at 403 bug) get their current program opened as a block on first view of the
  Past Blocks tab (source `backfill`).
- **Goal-switch boundary** (Will's call, and the right one): when a check-in surfaces a
  goal_update that DIFFERS from the goal on file, the open block closes (recap and all)
  and a new one opens on the same text, source `goal_change` (ProofChatModal, App.jsx).
  A shifted goal is the strongest organic signal a chapter turned — and it costs the
  user nothing; nobody has to know what a "block" is. Restating the same goal is a
  guarded no-op (case-insensitive compare against the latest athlete_goals row).

### How boundaries actually get detected (the layered answer)
No single detector survives the variety of training styles, so blocks never depend on
one. Four signals, cheapest-first, each catching a lazy-user case the others miss:
1. **Text-diff magnitude** (deterministic, free): section swap/tweak → same block;
   ≥50% rewrite or outright replacement → new block. Handles "edited one day" and
   "pasted a whole new program without telling anyone".
2. **Goal switch** (organic, shipped): catches "same program for months, new focus".
3. **Explicit** ("Start next block" / the Builder, which always forceNewBlocks):
   for people who DO think in blocks.
4. **Log-pattern drift** (NOT built — v2): propose-only nudge when logged training
   stops matching the open block's recap trajectory. Proposal, never silent action —
   a wrong auto-boundary poisons history silently; a missed one just makes a longer
   block whose recap still covers everything. That asymmetry is why 1–3 act
   automatically and 4 may only ever suggest.

## Deliberately NOT in v1

- **Auto-detecting boundaries from logs** ("these 4 weeks clearly align with block 1").
  Detection heuristics (volume/intensity shifts, program week labels, calendar gaps)
  are noisy; a wrong auto-boundary poisons recaps silently. v1 makes boundaries CHEAP
  and explicit instead. v2 can propose ("looks like you started block 2 this week —
  close out block 1?") as a proof-feed-style nudge with a one-tap confirm — proposal,
  never silent action.
- **A goals ledger.** `athlete_goals` is a single-current-goal shape today. The full
  design: goal rows gain `block_id`/`program span`, `status` (active/hit/missed/
  retired), `outcome_note`; the recap close flips status; the Builder interview offers
  "keep chasing / set new" and writes the successor row with lineage to the old one.
  That's a schema + gateway + Settings-UI change worth its own session. v1 approximates
  the user-visible half: the recap records the verdict in prose, and the interviewer is
  prompted to ask keep-chasing-or-shift when the goal looks finished.
- **Season-aware block sequencing** (auto-proposing the next block type from the
  doctrine block table + weeks-to-season). Doctrine already carries the table; wiring
  it to proactive suggestions belongs with the coach-experience overhaul.

## Sharp edges for the next session

- `closeBlock` reads `workouts` by `created_at` range — the demo mock must support
  gte/lte filters on that column or demo recaps come out empty (they did in testing;
  fine — demo shows the fixture recaps from `ALL_PROGRAM_HISTORY`).
- Recap cost rides the existing `program_summary` feature label in usage_costs.
- `digestWorkouts` caps at 3.2k chars / 80 sessions — a 16-week block with daily logs
  truncates oldest-first (rows come in ascending; the slice keeps the head). Fine for
  recaps; revisit if blocks get long.
- If Will wants the recap re-generated (e.g. logs landed late), there's no re-run
  button yet — delete the row's block_recap via SQL and close... just add a button.
