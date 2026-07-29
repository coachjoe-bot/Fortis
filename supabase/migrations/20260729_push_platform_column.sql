-- ─── NATIVE iOS PUSH: platform column (App Store build plan §3/§6 step 5) ────
-- ADDITIVE ONLY. No table drop/recreate, no RLS/policy change (both tables stay
-- RLS-enabled with zero policies — service-role-only access, unchanged), no
-- backfill required: existing rows simply read as platform IS NULL, and every
-- consumer (sendTo/notifyCoach/runNudges in api/_push.js, the subscribe/status/
-- unsubscribe actions in api/push.js) treats NULL the same as 'web' — the only
-- platform that has ever written a row before this migration.
--
-- Why relax p256dh/auth to nullable: those two columns hold the Web Push
-- library's per-subscription encryption keys (see api/_push.js sendTo()) — they
-- make no sense for an APNs device-token row, and iOS subscribe rows will never
-- populate them. `endpoint` is reused unchanged to hold the APNs device token
-- string for platform='ios' rows (same convention the build plan calls for),
-- so no new "token" column is needed either.
--
-- Run via Supabase MCP apply_migration (or the SQL Editor). Safe to re-run:
-- every statement is idempotent (IF NOT EXISTS / guarded ADD CONSTRAINT).

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE push_subscriptions
  ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE push_subscriptions
  ALTER COLUMN auth DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_platform_check'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_platform_check
      CHECK (platform IS NULL OR platform IN ('web', 'ios'));
  END IF;
END $$;

ALTER TABLE coach_push_subscriptions
  ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE coach_push_subscriptions
  ALTER COLUMN p256dh DROP NOT NULL;
ALTER TABLE coach_push_subscriptions
  ALTER COLUMN auth DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coach_push_subscriptions_platform_check'
  ) THEN
    ALTER TABLE coach_push_subscriptions
      ADD CONSTRAINT coach_push_subscriptions_platform_check
      CHECK (platform IS NULL OR platform IN ('web', 'ios'));
  END IF;
END $$;

-- RLS/policies: UNCHANGED (both tables keep RLS enabled, zero policies — anon
-- fully denied, service_role bypasses, exactly as 20260704_push_subscriptions.sql
-- and 20260706_coach_overhaul.sql left them).
