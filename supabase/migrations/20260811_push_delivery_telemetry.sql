-- ─── PUSH DELIVERY TELEMETRY (T51) ───────────────────────────────────────────
-- The notification system had no delivery telemetry at all. usage_events carried
-- push_enabled / push_disabled — the athlete flipping a switch — and nothing
-- about whether a single notification was ever sent, failed, or opened. Which is
-- how the subscription table sat at two rows, newest 2026-07-06, for five weeks
-- while every cron reported a cheerful 200 and nobody noticed.
--
-- api/_supa.js's logPushOutcome now writes push_sent / push_failed / push_pruned
-- (source='server', one row per device) and the client raises notification_opened
-- on a deep-link tap. These three views are so Will can answer the four questions
-- without reading code:
--
--   how many went out yesterday  → v_push_delivery_daily.sent
--   how many failed              → v_push_delivery_daily.failed
--   how many were tapped         → v_push_delivery_daily.opened
--   live subscriptions per platform → v_push_subscriptions_live
--
-- SECURITY: security_invoker=on for the same reason as v_athlete_session_counts —
-- a view defaults to the DEFINER's rights, which would hand anon a read straight
-- through usage_events' RLS. Grants are explicit and service_role only.

-- ── 1. Daily delivery, by push type and platform ─────────────────────────────
-- One row per (day, type, platform). `opened` is a LEFT-side count on the same
-- grain: a tap is a client event that carries the target, not the type, so it
-- lands in its own column rather than being force-joined to a send it can't be
-- matched to individually.
CREATE OR REPLACE VIEW v_push_delivery_daily
WITH (security_invoker = on) AS
SELECT
  (created_at AT TIME ZONE 'UTC')::date            AS day,
  COALESCE(meta->>'push_type', 'unknown')          AS push_type,
  COALESCE(meta->>'platform', 'unknown')           AS platform,
  COUNT(*) FILTER (WHERE event_name = 'push_sent')     AS sent,
  COUNT(*) FILTER (WHERE event_name = 'push_failed')   AS failed,
  COUNT(*) FILTER (WHERE event_name = 'push_pruned')   AS pruned,
  -- Share of attempts that landed. NULL rather than 0 when nothing was attempted,
  -- so an idle day reads as "no data" instead of "100% failure".
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE event_name = 'push_sent')
    / NULLIF(COUNT(*) FILTER (WHERE event_name IN ('push_sent','push_failed','push_pruned')), 0)
  , 1)                                                 AS sent_pct
FROM usage_events
WHERE source = 'server'
  AND event_name IN ('push_sent', 'push_failed', 'push_pruned')
GROUP BY 1, 2, 3;

-- ── 2. Taps, by day and destination ──────────────────────────────────────────
-- The only honest engagement number push has. Deliberately separate from the
-- send view: the client knows which SCREEN it opened, not which send it came
-- from, and pretending otherwise would invent an attribution that doesn't exist.
CREATE OR REPLACE VIEW v_push_opens_daily
WITH (security_invoker = on) AS
SELECT
  (created_at AT TIME ZONE 'UTC')::date   AS day,
  COALESCE(meta->>'target', 'unknown')    AS target,
  role,
  COUNT(*)                                AS opened
FROM usage_events
WHERE event_name = 'notification_opened'
GROUP BY 1, 2, 3;

-- ── 3. Live subscriptions per platform ───────────────────────────────────────
-- The number that was two, and iOS-zero, and that nobody was looking at.
--
-- The grid of (audience × platform) is generated and LEFT JOINed, NOT grouped
-- out of the tables. A plain GROUP BY emits no row for an empty combination, so
-- "zero coach subscriptions, ever" and "zero iOS subscriptions, ever" — the two
-- facts that made this task necessary — would render as MISSING ROWS. A missing
-- row reads as "not applicable"; a zero reads as "broken." They must be zeros.
CREATE OR REPLACE VIEW v_push_subscriptions_live
WITH (security_invoker = on) AS
WITH grid AS (
  SELECT a.audience, p.platform
  FROM (VALUES ('athlete'), ('coach')) AS a(audience)
  CROSS JOIN (VALUES ('web'), ('ios')) AS p(platform)
),
rows_ AS (
  SELECT 'athlete'::text AS audience, COALESCE(platform, 'web') AS platform,
         athlete_id AS recipient_id, created_at
  FROM push_subscriptions
  UNION ALL
  SELECT 'coach'::text, COALESCE(platform, 'web'), coach_id, created_at
  FROM coach_push_subscriptions
)
SELECT
  g.audience,
  g.platform,
  COUNT(r.recipient_id)                    AS subscriptions,
  COUNT(DISTINCT r.recipient_id)           AS recipients,
  MAX(r.created_at)                        AS newest_subscription
FROM grid g
LEFT JOIN rows_ r ON r.audience = g.audience AND r.platform = g.platform
GROUP BY g.audience, g.platform;

REVOKE ALL ON v_push_delivery_daily      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_push_opens_daily         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON v_push_subscriptions_live  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON v_push_delivery_daily      TO service_role;
GRANT SELECT ON v_push_opens_daily         TO service_role;
GRANT SELECT ON v_push_subscriptions_live  TO service_role;
