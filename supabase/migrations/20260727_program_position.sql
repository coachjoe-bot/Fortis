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

COMMENT ON COLUMN athletes.program_started_on IS
  'When the current program became active; week number counts Sunday turnovers from here. Fallback for program_history.applied_at.';
COMMENT ON COLUMN athletes.program_position_override IS
  'Athlete-stated program position {week, day, at}. Wins over the derived day within the same calendar week.';
