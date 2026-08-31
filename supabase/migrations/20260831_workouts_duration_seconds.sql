-- T62 (Will 08-31): session duration. Stamped by the client only when a workout
-- that was STARTED in-app (Start Workout tap / lock-screen pin) is logged the
-- same local day; backdated or typed-after-the-fact logs stay NULL. The client
-- writes 300..28800 (5 min .. the 8h draft window); the CHECK is the abuse
-- bound. workouts carries no ATHLETE_COL_ALLOW entry in api/data.js (row-scoped
-- only), so no gateway twin exists for this column.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS duration_seconds integer;
ALTER TABLE workouts ADD CONSTRAINT workouts_duration_seconds_range
  CHECK (duration_seconds IS NULL OR (duration_seconds >= 60 AND duration_seconds <= 43200));
