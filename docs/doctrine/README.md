# Doctrine — programming knowledge for the Program Builder

**Status: awaiting Will's doctrine-extraction interview.** Phase C of the Builder
(docs/program-builder-build-handoff.md) does not start until these files exist.

This directory is the drop point. When the interview lands, it gets distilled into:

- `doctrine-core.md` — the always-loaded core: how Will programs, non-negotiables,
  house formatting style, red-flag handling, warm-up/cool-down defaults, progression
  defaults. Target: small enough to ride every Builder call (~cached system prefix).
- `doctrine-<topic>.md` — one file per topic, loaded ONE at a time by the classifier
  (never the whole library). Planned topics from the handoff: `in-season`, `team`,
  `youth`, `conditioning`, `return` (return-to-play).

Rules (cost control, from the handoff — non-negotiable):

- Doctrine loads only via the `/api/claude` proxy's cached system prefix
  (`system_cached`), paid once per session, ~10% on cached calls after that.
- Doctrine rides ONLY on Builder / drafting / merge calls — never daily chat.
- A session carries core + ONE topic file, chosen by the existing classifier.
- Every doctrine edit re-runs `scripts/test-program-build.mjs` (the Phase C eval
  harness — fixture blueprints in, drafted programs out, rules asserted).

Raw interview material (transcripts, notes) goes in `raw/` (gitignored if it ever
contains anything Will doesn't want in the repo — ask him).
