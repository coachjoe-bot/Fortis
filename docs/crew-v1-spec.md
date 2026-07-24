# WILCO Crew — V1 build spec & handoff

**Status:** design LOCKED 2026-07-24 (Will), not built. This doc is the build handoff.
**Concept artifact (visual reference):** https://claude.ai/code/artifact/e014dd85-aadf-4334-a1b5-35e6d8e43aa4
**Design history:** `project-wilco-crew-feature` memory (v1 concept 07-10 → v3 lock 07-24).

---

## Kickoff prompt for the build session

> Build WILCO Crew V1 per `docs/crew-v1-spec.md`. Work in an isolated git worktree off
> current `origin/main` (never in `~/dev/WILCO` directly — parallel sessions have swept
> uncommitted work before). Follow the build sequence in the spec, phase by phase, and stop
> at the end of each phase for Will to look. Crew is user-visible, so it goes
> branch → Vercel preview → Will, NOT straight to main. The spec's "Hard rules" section is
> non-negotiable — every one of them is a legal or trust decision Will already made.
> Testing needs TWO real accounts (see Verification).

---

## What Crew is

Training partners inside WILCO. You add the people you actually lift with (by code), see how
their week is going, celebrate what they hit, and keep each other showing up.

**Why it exists:** retention is the bottleneck, not features (`project-wilco-business-reality-2026-07`).
Athletes who train with someone stay. This is a retention feature wearing a social costume.

**What it is not:** a social network. No messaging, no strangers, no global leaderboard, no
standings board of any kind.

---

## Scope

### In V1
- Crew codes + QR, request / accept / decline, remove
- Crew tab in the Progress modal: roster glance (weekly chain + goal per member) and a
  **Moments** sub-tab (the feed)
- Four moment types: **PR**, **hit the week**, **Total Workouts milestone**, **goal hit**
- Preset reactions only: 🤝 💪 🔥
- Quiet-crewmate nudge ("gone quiet · no workout in 8 days · send a 💪")
- Goal progress: AI parses the athlete's existing goal text; numeric goals get a real
  progress bar, non-numeric ones show as a stated aspiration
- A small crew highlight blip inside the weekly Proof digest
- **Everything in-app. Zero new push notifications.**

### Deferred to V2
- **Comparison.** Two surfaces, both mutual-opt-in:
  1. A thin tier-coloured **friend strip** on your own Benchmarks power cell — strip
     **colour = their tier**, **position = how far through that tier they are** (near the end
     = about to rank up). Rides on top of the existing within-tier tube; no redesign of the
     power cell. Multiple opted-in friends = multiple strips.
  2. The overall **strength-score head-to-head** ("You 385 · Marcus 410") in the Crew tab.
- Ships only after watching V1 behave with real athletes.

### Explicitly OUT for now
- **School / coached accounts get no Crew at all.** Will's call 2026-07-24: too weedy until
  he's had the conversation with schools. This removes roster-adds, coach controls, and the
  coach kill-switch from V1 entirely.
- **Under-16 lockout: REMOVED.** Will's call — it made the product less inclusive, and with
  schools out the safety model rests on the guardrails below (no messaging, no stranger
  discovery, opt-in comparison), not an age gate. Crew adds no free text and no new personal
  data, so dropping the age gate opens no new COPPA surface.
- Any push notification about crew activity.

---

## Hard rules (non-negotiable — each one is a decision Will already made)

1. **No messaging. Ever.** Zero free text between users: no DMs, no comments, no captions on
   reactions. Typed words travelling between users (many of them minors) means moderation,
   reporting, and state-by-state minor-safety obligations. Preset reactions carry none of it.
2. **No stranger discovery.** No global name search, no directory, no "people you may know."
   The only way to connect is a code handed to someone in person.
3. **Never in chat.** Crew activity NEVER appears in the Coach Joe conversation. Chat is Joe.
   The only place crew content appears outside the Crew tab is the weekly Proof blip.
4. **No push.** Nothing about someone else's training leaves the app. The Proof blip rides the
   *existing* weekly Proof push — it is not a new notification type.
5. **Quiet on a miss.** No red, no "falling behind," no streak-loss threat, no ranking that
   has a bottom. A missed dated goal quietly rephrases to the progress made
   ("Will pushed his bench to 305") — never "missed."
6. **Comparison is earned** (V2): mutual opt-in, silently killable by either side, no exit
   notification.
7. **Scoping is enforced server-side.** Who can read whose moments is decided in the API
   gateway, never in the client.

---

## Information architecture

**Home:** a new **Crew tab inside the Progress modal**, alongside Benchmarks / Strength /
Running / PRs. `src/App.jsx` ~L8258, tab list is `["benchmarks","strength","running","pr"]` →
append `"crew"`.

Deliberately NOT a new top-level destination — the app must not grow rooms (anti-bloat rule
from the 07-24 IA session). It sits next to Benchmarks because that's where the V2 friend
strips live and where comparison already has a language.

**Inside the Crew tab, two sub-tabs:**

| Sub-tab | Contents |
|---|---|
| **Crew** (landing) | Your crew code + share/scan. Pending requests. Roster: one row per member with **this week's chain** and **their goal at a glance**. Quiet members show the nudge + Send 💪. |
| **Moments** | The feed. Newest first, reactions inline. |

Roster is the landing because "how's everyone doing right now" is the glance; the feed is a
deliberate "show me what they've been up to" tap. Sub-tabs (not one scroll) so a growing
roster can't push the feed off the screen.

**Empty state matters.** An athlete with no crew must see their code + "add someone you train
with," never an empty feed.

---

## Moment lifetime (Will's call, 07-24)

- **Display window: rolling 7 days** for `pr` and `week` moments. Not a Monday reset — a hard
  weekly wipe leaves the feed empty exactly when someone opens on Monday, and drops Saturday's
  PR two days later.
- **`goal` and `milestone` moments pin for 14 days.** They're rare and worth lingering.
- **Storage: hard-delete rows older than 30 days** via a sweep (reuse the
  `api/process-deletions.js` cron pattern or add to an existing cron).
- The feed is never paginated and has no archive. It cannot bloat.

---

## Data model

All new tables: RLS on, **zero policies** (same as every other WILCO table — access is via the
service-key gateway only).

```sql
-- One row per PAIR. Canonical ordering: always store athlete_a < athlete_b (uuid compare)
-- so a pair can never be duplicated in both directions.
create table crew_edges (
  id            uuid primary key default gen_random_uuid(),
  athlete_a     uuid not null references athletes(id) on delete cascade,
  athlete_b     uuid not null references athletes(id) on delete cascade,
  status        text not null default 'pending',   -- 'pending' | 'accepted'
  requested_by  uuid not null,                     -- which side sent it (direction of the request)
  compare_a     boolean not null default false,    -- a's opt-in to V2 comparison
  compare_b     boolean not null default false,    -- b's opt-in
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  constraint crew_edges_ordered check (athlete_a < athlete_b),
  constraint crew_edges_pair unique (athlete_a, athlete_b)
);

create table crew_moments (
  id          uuid primary key default gen_random_uuid(),
  athlete_id  uuid not null references athletes(id) on delete cascade,  -- whose moment
  type        text not null,     -- 'pr' | 'week' | 'milestone' | 'goal'
  payload     jsonb not null,    -- display-ready, see below
  created_at  timestamptz not null default now()
);
create index crew_moments_athlete_created on crew_moments (athlete_id, created_at desc);

create table crew_reactions (
  id          uuid primary key default gen_random_uuid(),
  moment_id   uuid not null references crew_moments(id) on delete cascade,
  athlete_id  uuid not null references athletes(id) on delete cascade,
  emoji       text not null,     -- '🤝' | '💪' | '🔥'  (allowlist, enforce server-side)
  created_at  timestamptz not null default now(),
  constraint crew_reactions_once unique (moment_id, athlete_id, emoji)
);
```

**Crew code:** add `crew_code text unique` to `athletes`, generated on first Crew open.
Format `NAME-XXXX` (4 chars, unambiguous alphabet — no O/0/I/1). Regeneratable from Settings
(invalidates the old one).

**Goal parsing:** `athlete_goals` already exists with free-text `goal_text` (written from chat
when the parser emits `goal_update`, `src/App.jsx` ~L2599). Add:

```sql
alter table athlete_goals
  add column parsed_lift      text,        -- canonical lift id, or NULL if not numeric
  add column target_lbs       numeric,
  add column target_date      date,
  add column parsed_at        timestamptz,
  add column share_with_crew  boolean not null default false;
```

**`crew_moments.payload` shapes** (keep display-ready so the feed needs no lookups):
```
pr        {lift, tier, prevTier, weight?, unit?}
week      {done, target, perfect: bool}
milestone {count}          -- 50th workout etc.
goal      {goalText, lift, target}
```

---

## API surface

Everything goes through the existing gateway (`api/data.js`) — **no new Vercel functions**
(the 12-function cap is why; current count is 18 routed but check `npm run check:api-config`).

Add to `WRITABLE` (api/data.js ~L38): `crew_edges`, `crew_moments`, `crew_reactions`.

**The critical scoping work.** A generic `?athlete_id=eq.X` read is NOT sufficient here,
because the feed reads *other people's* rows. Add a dedicated scoped action that, server-side:

1. Resolves the caller's accepted crew ids from `crew_edges` (both directions).
2. Returns only `crew_moments` whose `athlete_id` is in that set (plus the caller's own),
   within the display window (7d, or 14d for `goal`/`milestone`).
3. Same for reactions.

A client must never be able to ask for an arbitrary athlete's moments. Mirror the existing
`assertRows`/coach-scoping pattern already in `api/data.js`.

**Actions needed:** `crew-code-ensure`, `crew-request` (by code), `crew-accept`,
`crew-decline`, `crew-remove`, `crew-list` (roster + week + goal), `crew-feed`,
`crew-react` (toggle).

---

## The gate (school/coached accounts excluded)

```js
const crewEligible = !athlete.coach_id && !athlete.school_id;
```

Both columns confirmed present (`src/App.jsx` ~L3407-3411). When false: the Crew tab does not
render at all — not a disabled tab, not an upsell. Enforce the same check **server-side** on
every crew action, so an ineligible athlete can't be added to someone else's crew either.

---

## Where moments get written

All four detections **already exist** in `send()` in `src/App.jsx`. Each is one insert at an
existing site — this is the "flush changes across sibling call sites" rule
(`feedback-wilco-flush-changes`); get all four or the feed will be silently partial.

| Type | Existing site |
|---|---|
| `pr` | the `newPRs` flow (~L5194, where the NEW MAX stamp fires). Only emit when the lift **changed tier** — a rank-up, not every PR, or the feed floods. |
| `week` | wherever the weekly target completion is computed (the charge-chain logic). Fire on **crossing** the target, once per week. |
| `milestone` | the `total_sessions_logged` milestone block (~L5023, `MILESTONES` array). Reuse the same crossing rule. |
| `goal` | when a lift's e1RM crosses `athlete_goals.target_lbs` for `parsed_lift`. |

**Gate every write** on `crewEligible && athlete has ≥1 accepted edge` — no point writing
moments nobody can see.

---

## Goal parsing

- **One AI call per goal text**, on insert/edit only (never on render). Add a `goalParse`
  feature to the `FEATURES` set in `api/claude.js`. Haiku is fine.
- Output: `{lift, target_lbs, target_date}` or `{lift: null}` when the goal isn't numeric.
- **The AI only parses. It never computes progress.** Progress is deterministic client-side
  math from e1RM history (`bestE1RMForExercise` + `resolveLift` in `src/grit.js`), so the
  number can't hallucinate.
- Non-numeric (`parsed_lift` null) → render as `Working toward · make varsity`, **no bar**.
- **Missed dated goal:** when `target_date` passes unmet, the goal quietly retires from the
  crew row or rephrases to progress made. Never render "missed." (Hard rule 5.)
- `share_with_crew` defaults **false** — sharing a goal is opt-in.
- ⚠️ Set `max_tokens` generously for the schema. Three separate data-loss bugs in this file
  came from a structured-extraction call truncating (`project-wilco-quick-log`); the rule is
  that max_tokens scales with schema verbosity, not input length.

---

## The Proof blip

`api/_proof.js` builds the weekly digest.

- Query the athlete's accepted crew's moments in the digest window.
- Pick the **top 1–2** by priority: `goal` > `pr` (rank-up) > perfect `week` > `milestone`.
- **Template the line deterministically — no AI call.** e.g.
  *"Your crew had a week — Marcus hit 315, Devin went 5 for 5."*
- Add a `crew` field to `content_json`; the Proof tab renders it as a small blip.
- **Omit the section entirely when there's nothing.** It never says "your crew was quiet."
- Highlights only, never a roll-call of everyone.

---

## Decisions already made (override only if Will says so)

| Decision | Value | Why |
|---|---|---|
| Crew size cap | **10** | Keeps the feed human and stops Crew drifting into a social network. |
| Remove a member | **One-sided + silent**, deletes the edge for both | Same logic as the silent comparison exit: people only use an exit that isn't announced. |
| Reactions | One of each emoji per person per moment, **toggleable** | Prevents spam-tapping; no counts to game. |
| Goal share | Opt-in, default **off** | It's personal. |
| Comparison opt-in | Default **off**, both sides required (V2) | Hard rule 6. |
| Moment window | 7 days; 14 for `goal`/`milestone` | Will, 07-24. |

## Open questions for Will

1. **Is Crew free-tier or paid-tier?** Quick Log is paid-only. Crew is a *retention* play, and
   retention arguably matters most for free users deciding whether to stay — but that's a
   business call, not a build call. **Default assumption if unanswered: available to all
   individual accounts regardless of tier.**
2. Crew code format/regeneration — is `WILL-7F2K` right, and should regenerating be in
   Settings?
3. Should a pending request expire (e.g. 30 days) or sit forever?

---

## Build sequence

Stop at the end of each phase for Will.

1. **Schema + gateway** (invisible): tables, RLS, `WRITABLE`, scoped read actions, the
   eligibility gate server-side, deletion handling. Verify scoping with a second account
   before any UI exists.
2. **Crew tab shell**: code generation, share/scan, request/accept/decline/remove, roster
   glance with weekly chains. Empty state.
3. **Moments**: the four write sites, the Moments sub-tab, reactions, the window rules.
4. **Goals**: the parse call, progress math, roster rendering, the miss-safe retirement.
5. **Proof blip**.
6. *(V2, later)* comparison: friend strips on the power cells + strength-score head-to-head.

---

## Verification

- **Two real accounts are required** — a crew of one proves nothing. Will has two
  (`project-wilco-gift-codes`: the comped daily account and paid Coach Will). Note Coach Will
  may be coach-linked and therefore **ineligible** under the gate; a second individual test
  account may be needed. Delete any throwaway accounts afterward and exclude them from metrics
  (precedent: the 07-10 and 07-23 probe-account cleanups).
- `/api` is not served under `vite dev` and there's a PIN wall, so **local click-verification
  is not possible** — the real check is a Vercel preview with Will. `npm run build` +
  `npm test` are the safety net.
- Preview URLs are SSO-protected (Will's browser only). `SUPABASE_SERVICE_KEY` is already on
  the Preview env; `ANTHROPIC_KEY` is **not** — the goal parser won't run on preview unless
  it's added.
- Add a regression suite for the pure logic (window rules, priority ordering, canonical pair
  ordering, goal-progress math) — `scripts/test-crew.mjs`, picked up by `npm test`'s glob.

---

## Gotchas specific to this codebase

- **Work in an isolated worktree.** Two agents in `~/dev/WILCO` = one sweeps the other's
  uncommitted work (`project-wilco-aesthetic-build`). Origin has **only** `main`, so an
  unpushed local branch is the only copy of the work.
- **Preview before ship.** Crew is user-visible → branch → preview → Will
  (`feedback-wilco-preview-before-ship`).
- **Deletion sweep — the specific trap.** `api/process-deletions.js` purges `ATHLETE_TABLES`
  by `?athlete_id=eq.<id>`. `crew_edges` has **no `athlete_id` column** — it has `athlete_a`
  and `athlete_b`. Adding it to that list would silently no-op and strand edges. Either rely
  on the `on delete cascade` FKs (both columns reference `athletes`) **and verify it**, or add
  an explicit two-query delete. `crew_moments` and `crew_reactions` are `athlete_id`-keyed and
  can go in the list normally.
- **No bottom safe-area padding** on any bottom bar (`feedback-wilco-no-bottom-safe-area`) —
  Will has flagged this twice.
- **Copy style**: no em-dashes, no "not X but Y" symmetry; write like a lifter
  (`feedback-wilco-human-copy`).
- Palette is `CA` (athlete side), tier colours from `src/grit.js` `TIER_COLORS` — the crew
  chains should reuse the existing charge-chain visual, not a new one.
