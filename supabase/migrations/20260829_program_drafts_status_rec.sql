-- Program Recs (Will 08-28 design): staged program changes ride program_drafts
-- with two new statuses, rec (proposed/parked) and rec_applied (live with an
-- optional revert clock). Mirrors the api/data.js gateway enum. APPLIED to prod
-- 2026-08-29 via MCP apply_migration (program_drafts_status_rec).
ALTER TABLE program_drafts DROP CONSTRAINT program_drafts_status_check;
ALTER TABLE program_drafts ADD CONSTRAINT program_drafts_status_check
  CHECK (status = ANY (ARRAY['interview'::text, 'draft'::text, 'applied'::text, 'rec'::text, 'rec_applied'::text]));
