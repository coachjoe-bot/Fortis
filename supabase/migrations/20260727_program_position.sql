-- Program position: where the athlete actually is in their program.
--
-- Until now nothing stored this. Every surface re-derived it per call from the last
-- logged session's typed day label plus round(daysSince * training_days_per_week / 7),
-- which assumes training days are spread evenly across the week — false for any
-- program under 7 days/week — so it drifted, and every correction the athlete typed
-- was discarded. See src/programPosition.js for the replacement rules.
--
-- Both columns are NULLABLE with no backfill: the reader falls back to
-- program_history.applied_at and degrades to "week 1" when it knows nothing, which is
-- exactly the old behaviour for an athlete with no data. Nothing breaks on deploy.

-- When the CURRENT program became active. The week number counts Sunday turnovers
-- from here. program_history.applied_at is the preferred source; this is the fallback
-- for athletes whose history predates that table being written reliably.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS program_started_on timestamptz;

-- The athlete stating where they are: {"week":2,"day":3,"at":"2026-07-27T14:00:00Z"}.
-- Outranks the derived day for the rest of that calendar week; the Sunday rule still
-- turns the week, because saying which day you're on is not a request to freeze the
-- program. Overwritten by the next claim — only the latest one is ever read.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS program_position_override jsonb;

-- The athlete's answer to "does this block end, and when?" —
-- {appliedAt, endsAt, weeks, repeating, answeredAt}. Needed because an athlete on a
-- simple repeatable week has a program with NO end, and reading that as a one-week
-- block would tell them their block was finished in every single digest. Until this is
-- answered (or program_history.ends_at is set, which outranks it) the week-ahead
-- section is withheld entirely rather than guessed. `appliedAt` pins the answer to the
-- block it describes, so starting a new block naturally re-asks.
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS program_block_span jsonb;

COMMENT ON COLUMN athletes.program_started_on IS
  'When the current program became active; week number counts Sunday turnovers from here. Fallback for program_history.applied_at.';
COMMENT ON COLUMN athletes.program_position_override IS
  'Athlete-stated program position {week, day, at}. Wins over the derived day within the same calendar week.';
COMMENT ON COLUMN athletes.program_block_span IS
  'Athlete answer to "does this block end?": {appliedAt, endsAt, weeks, repeating, answeredAt}. appliedAt pins it to the block it describes, so a new block re-asks. program_history.ends_at outranks it when set.';
