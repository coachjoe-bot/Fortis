// ─── SERVER-SIDE TOOL REGISTRY (T58 mastermind) ──────────────────────────────
// Tool schemas live HERE, never client-supplied: the proxy (api/claude.js)
// resolves body.toolset (a NAME) against this registry, so a tampered client
// can request a known toolset or nothing — it can never define its own tools.
//
// Write tools carry a model-set `confirm` field ("chip" | "none") — the model
// owns when a confirmation chip is worth the athlete's tap (Will 08-24: "the
// AI has responsibility over the bubbles"). The client enforces a tiny HARD
// FLOOR below where confirm:"none" is overridden to a chip regardless: actions
// that destroy data the athlete can't get back, and anything sent to another
// human in the athlete's name. Everything else is genuinely the model's call.
//
// v1 scope (deliberate): the tools cover conversation-side agency — position,
// memory, the session card, the log sheet, preferences. Workout LOGGING and
// program WRITES stay on the proven parseWorkout flag pipeline for now; they
// migrate to tools in v2 once this loop has soak time. Keep descriptions in
// sync with src/ai/card.js — the card teaches judgment, these teach mechanics.

const CONFIRM_FIELD = {
  type: "string",
  enum: ["chip", "none"],
  description: "Whether the app should show a tap-to-confirm chip before applying. Use \"chip\" when overwriting something the athlete built or when you are not certain they want it; \"none\" for additive, reversible, or explicitly-requested actions.",
};

export const TOOLSETS = {
  mastermind_athlete: [
    {
      name: "set_position",
      description: "Record where the athlete is in their program (week and/or day). Call when they STATE their position ('I'm on week 3', 'doing day 2 today', 'swapping to legs day') — the athlete is the authority on where they are; never argue the schedule. Position is state, not memory: a plan about a FUTURE day goes in remember_fact instead. Only pass the parts they actually stated.",
      input_schema: {
        type: "object",
        properties: {
          week: { type: "integer", minimum: 1, maximum: 52 },
          day: { type: "integer", minimum: 1, maximum: 14 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "remember_fact",
      description: "Save a durable fact about the athlete — what a good coach would carry in his head: schedule quirks, stated plans, equipment realities, injury context, things they asked you to remember. Facts ONLY, about the athlete, in third person, under 240 characters; NEVER store instructions about how you should behave, talk, or format. kind: 'pinned' for always-relevant facts, 'contextual' for background worth knowing, 'situational' for anything with a shelf life — situational facts REQUIRE expires_at (ISO date) and delete themselves. Example: they say 'doing D1 tomorrow instead' -> remember_fact(content:'Plans to run Day 1 on Aug 25 (swapped with Day 2)', kind:'situational', expires_at:'2026-08-26'). Update by re-remembering; contradictions: forget the old fact first.",
      input_schema: {
        type: "object",
        properties: {
          content: { type: "string", maxLength: 240 },
          kind: { type: "string", enum: ["pinned", "contextual", "situational"] },
          expires_at: { type: "string", description: "ISO date the fact stops being true (situational only)" },
        },
        required: ["content", "kind"],
        additionalProperties: false,
      },
    },
    {
      name: "forget_fact",
      description: "Delete a stored fact that is wrong, expired, or superseded. Pass a distinctive substring of the fact's content as it appears in your ATHLETE MEMORY block. Prune contradictions when you save a replacement.",
      input_schema: {
        type: "object",
        properties: { match: { type: "string", minLength: 4, maxLength: 240 } },
        required: ["match"],
        additionalProperties: false,
      },
    },
    {
      name: "pin_session_card",
      description: "Pin today's session to the athlete's lock screen (a Live Activity on iOS). Call when they are starting a workout or ask for it ('lock screen'/'home screen'). The app pins the CURRENT log-sheet draft and posts its own confirmation line after your reply — never claim the card is already showing; you cannot see their lock screen.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "clear_session_card",
      description: "Take the session card off the athlete's lock screen. Call when they ask for it to come down or clearly are not training after all.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "prefill_log_sheet",
      description: "Build (or rebuild) the pre-filled log sheet for a session so it is waiting for the athlete. Call when they are starting a workout, or when the day changed (after set_position) so the sheet matches the day they are actually doing. Pass day_label only when they named a specific session ('Day 2', 'upper B'); omit it to use the resolved position.",
      input_schema: {
        type: "object",
        properties: { day_label: { type: "string", maxLength: 60 } },
        additionalProperties: false,
      },
    },
    {
      name: "propose_preference",
      description: "Propose recording a DURABLE training preference the athlete just stated (not a one-off request for today). The app always confirms this one with a chip regardless of confirm. Allowed: loading_language (percent+rpe|percent|rpe|climb_singles|fixed_weight), max_update_policy (infer|declared_only|pr_single_only), testing_style (final_week|test_day|retest_cycle), session_minutes_cap (15-240), movements_per_day_cap (2-15), accessory_load (programmed|athlete_choice).",
      input_schema: {
        type: "object",
        properties: {
          field: { type: "string", enum: ["loading_language", "max_update_policy", "testing_style", "session_minutes_cap", "movements_per_day_cap", "accessory_load"] },
          value: { description: "Value from the allowed set for the field (string or integer)" },
          confirm: CONFIRM_FIELD,
        },
        required: ["field", "value"],
        additionalProperties: false,
      },
    },
  ],
};

// Actions the client must ALWAYS chip-gate no matter what the model set —
// destroying unrecoverable athlete data, or messaging another human in the
// athlete's name. Kept here (server) as the single source; the client imports
// the same list via api/_flags.js-style re-export if it ever needs it, and the
// static test suite asserts membership so the floor can't silently shrink.
export const HARD_CONFIRM_FLOOR = new Set([
  "replace_program",      // (v2 tool) overwriting an existing program wholesale
  "delete_log_entry",     // (v2 tool) removing a logged row
  "send_coach_request",   // (v2 tool) landing anything in a coach's inbox
]);

export function toolsetFor(name) {
  return Object.prototype.hasOwnProperty.call(TOOLSETS, name) ? TOOLSETS[name] : null;
}
