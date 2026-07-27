-- THE CLOCK BUG: evening workouts were attributed to the next day.
--
-- workouts.created_at (and athletes.created_at) were `timestamp WITHOUT time zone`
-- while every other timestamp in the schema — prs, proof_digests, program_history,
-- manual_one_rms, error_events — is timestamptz. The database runs UTC, so now()
-- stored the correct instant but WITHOUT an offset marker, and PostgREST returned it
-- as "2026-07-28 00:30:00.123456".
--
-- JavaScript parses that space-separated, offset-less form as LOCAL time. So an
-- Eastern athlete's 8:30 PM MONDAY session came back to the app as 12:30 AM TUESDAY —
-- a 4-hour shift that crosses the day boundary for anything logged after 8 PM ET.
-- 90 of 884 rows (10.2%) sat in that window. It showed up as Joe naming the wrong day,
-- sessions landing on the wrong date in MY LOG, and the weekly streak lighting the
-- wrong square. The SERVER never saw it, because Vercel runs UTC and the local parse
-- was accidentally correct there — which is why it only ever looked like a flaky
-- "internal clock" on device.
--
-- SHOW timezone = UTC, so the stored values genuinely ARE UTC: AT TIME ZONE 'UTC'
-- relabels them without shifting a single instant. Session grouping is interval math
-- (created_at - prev_at > 3 hours) and is therefore unchanged — verified by capturing
-- the v_athlete_session_counts fingerprint before and after (identical: 154 sessions
-- across 16 athletes, md5 be203d17f5a2cb8826459afc6275a4dd).
--
-- The view has to be dropped first: Postgres refuses to alter the type of a column a
-- view depends on. It is recreated verbatim from pg_get_viewdef, and its grants are
-- restored explicitly because a dropped view loses them.

DROP VIEW IF EXISTS v_athlete_session_counts;

ALTER TABLE workouts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- Same class of bug, same fix: signup dates rendered a day early for evening signups.
ALTER TABLE athletes
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

CREATE VIEW v_athlete_session_counts AS
WITH "real" AS (
  SELECT workouts.athlete_id, workouts.created_at,
    (workouts.parsed_data -> 'new_session'::text) = 'true'::jsonb AS forced_new
  FROM workouts
  WHERE jsonb_typeof(workouts.parsed_data -> 'exercises'::text) = 'array'::text
        AND jsonb_array_length(workouts.parsed_data -> 'exercises'::text) > 0
     OR (workouts.parsed_data -> 'run_data'::text) IS NOT NULL
        AND jsonb_typeof(workouts.parsed_data -> 'run_data'::text) <> 'null'::text
        AND ((workouts.parsed_data -> 'run_data'::text) <> ALL (ARRAY['false'::jsonb, '0'::jsonb, '""'::jsonb]))
), marked AS (
  SELECT "real".athlete_id, "real".created_at, "real".forced_new,
    lag("real".created_at) OVER (PARTITION BY "real".athlete_id ORDER BY "real".created_at) AS prev_at,
    row_number() OVER (PARTITION BY "real".athlete_id ORDER BY "real".created_at) AS rn
  FROM "real"
)
SELECT athlete_id,
  count(*) FILTER (WHERE rn = 1 OR forced_new OR (created_at - prev_at) > '03:00:00'::interval)::integer AS session_count,
  max(created_at) AS last_workout_at
FROM marked
GROUP BY athlete_id;

ALTER VIEW v_athlete_session_counts SET (security_invoker = on);
REVOKE ALL ON v_athlete_session_counts FROM anon, authenticated;
GRANT SELECT ON v_athlete_session_counts TO service_role;
