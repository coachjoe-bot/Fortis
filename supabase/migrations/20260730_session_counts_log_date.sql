-- v_athlete_session_counts is the SQL port of groupIntoSessions and is the
-- AUTHORITATIVE lifetime session count (athletes.total_sessions_logged, the
-- header "WORKOUTS" number, coach roster counts, adherence denominators).
--
-- It keyed off created_at only, so it could not see parsed_data.log_date -- the
-- field the workout parser writes when an athlete says "I did this yesterday".
-- A backdated log was therefore counted on the day it was TYPED. src/grit.js's
-- effectiveDate() has always preferred log_date over created_at; this brings the
-- SQL port in line with it.
--
-- log_date is a plain 'YYYY-MM-DD' local calendar day. Regex-guarded before the
-- cast so a malformed value can never raise and take the whole view down; it
-- falls back to created_at exactly like effectiveDate does.
--
-- APPLIED to prod 2026-07-30 and verified: zero athletes changed count, because
-- no existing row carries log_date yet. Forward-looking only.
create or replace view v_athlete_session_counts as
with real as (
  select
    workouts.athlete_id,
    case
      when workouts.parsed_data ->> 'log_date' ~ '^\d{4}-\d{2}-\d{2}$'
        then (workouts.parsed_data ->> 'log_date')::timestamptz
      else workouts.created_at
    end as effective_at,
    (workouts.parsed_data -> 'new_session') = 'true'::jsonb as forced_new
  from workouts
  where jsonb_typeof(workouts.parsed_data -> 'exercises') = 'array'
        and jsonb_array_length(workouts.parsed_data -> 'exercises') > 0
     or (workouts.parsed_data -> 'run_data') is not null
        and jsonb_typeof(workouts.parsed_data -> 'run_data') <> 'null'
        and ((workouts.parsed_data -> 'run_data') <> all (array['false'::jsonb, '0'::jsonb, '""'::jsonb]))
), marked as (
  select
    real.athlete_id,
    real.effective_at,
    real.forced_new,
    lag(real.effective_at) over (partition by real.athlete_id order by real.effective_at) as prev_at,
    row_number() over (partition by real.athlete_id order by real.effective_at) as rn
  from real
)
select
  athlete_id,
  count(*) filter (where rn = 1 or forced_new or (effective_at - prev_at) > '03:00:00'::interval)::integer as session_count,
  max(effective_at) as last_workout_at
from marked
group by athlete_id;
