-- T61 Memory tab (Will 08-29): facts are no longer capped at 240 chars as a
-- product limit -- the injected block is bounded by a 1750-token budget instead
-- (src/memory.js MEMORY_TOKEN_BUDGET). 2000 chars stays as the per-fact abuse
-- bound. Gateway twin: api/data.js ATHLETE_COL_ALLOW.athlete_memory.content.
-- APPLIED to prod via MCP 2026-08-29 (same session that shipped the tab).
ALTER TABLE public.athlete_memory DROP CONSTRAINT athlete_memory_content_check;
ALTER TABLE public.athlete_memory ADD CONSTRAINT athlete_memory_content_check
  CHECK (char_length(content) >= 1 AND char_length(content) <= 2000);
