-- T62 (Will 08-31): the rec review sheet gains a DISMISS action — the rec goes
-- away as a real status, not a hidden card, and the row stays in Past Blocks as
-- an audit trail. Mirrors the api/data.js gateway enum (the recs-wave trap:
-- constraint and gateway are SEPARATE gates, extend both).
ALTER TABLE program_drafts DROP CONSTRAINT program_drafts_status_check;
ALTER TABLE program_drafts ADD CONSTRAINT program_drafts_status_check
  CHECK (status = ANY (ARRAY['interview'::text, 'draft'::text, 'applied'::text, 'rec'::text, 'rec_applied'::text, 'rec_dismissed'::text]));
