// ─── TYPED TRAINING PREFERENCES (T53 #3) ──────────────────────────────────────
// The missing type: "give me percentages, not RPE" is not a fact about the
// athlete (athlete_context refuses it, correctly — free text is an injection
// path) and it is not a program cell. It's a durable, ENUMERATED preference.
// This module is the single source for the enum vocabulary, validation, and the
// prompt rendering; the DB table (athlete_training_prefs) carries the same
// CHECKs, and api/data.js pins the same values at the gateway. Three layers,
// one vocabulary — defined here.
//
// Contract (from the T53 handoff, Will-approved):
//   • Every default is TODAY'S shipped behavior; no row = all defaults.
//   • Populated by PROPOSING, never assuming — a candidate surfaces as a confirm
//     chip and persists only on an explicit yes.
//   • Values are enums/bounded ints so an AI extraction can never smuggle an
//     instruction through this table.

export const PREF_FIELDS = {
  loading_language: {
    label: "Loading style",
    values: ["percent+rpe", "percent", "rpe", "climb_singles", "fixed_weight"],
    dflt: "percent+rpe",
    say: {
      "percent+rpe": "percentages and RPE mixed (app default)",
      percent: "percentages only, no RPE",
      rpe: "RPE only, no percentages",
      climb_singles: "climbing singles to a top set instead of fixed percentages",
      fixed_weight: "fixed weights written out, no percentages or RPE",
    },
  },
  max_update_policy: {
    label: "Max updates",
    values: ["infer", "declared_only", "pr_single_only"],
    dflt: "infer",
    say: {
      infer: "maxes update from logged training (app default)",
      declared_only: "maxes change only when the athlete states a new one",
      pr_single_only: "maxes change only on a true PR single",
    },
  },
  testing_style: {
    label: "Testing",
    values: ["final_week", "test_day", "retest_cycle"],
    dflt: "retest_cycle",
    say: {
      final_week: "max attempts built into the block's final week",
      test_day: "dedicated test days",
      retest_cycle: "~12-week retest cycle (app default)",
    },
  },
  session_minutes_cap: { label: "Session cap", values: null, int: [15, 240], dflt: null,
    say: (v) => `sessions capped at ${v} minutes` },
  movements_per_day_cap: { label: "Movements/day", values: null, int: [2, 15], dflt: null,
    say: (v) => `at most ${v} movements per day` },
  accessory_load: {
    label: "Accessories",
    values: ["programmed", "athlete_choice"],
    dflt: "programmed",
    say: {
      programmed: "accessory loads written by the program (app default)",
      athlete_choice: "accessory loads left to the athlete",
    },
  },
};

export const PREF_DEFAULTS = Object.fromEntries(
  Object.entries(PREF_FIELDS).map(([k, f]) => [k, f.dflt]));

// Validate one {field, value} candidate (e.g. from an AI extraction). Returns the
// sanitized value, or undefined when the candidate is not in the vocabulary —
// the app-side twin of the DB CHECKs and the gateway value guards.
export function validatePref(field, value) {
  const f = PREF_FIELDS[field];
  if (!f) return undefined;
  if (f.values) return f.values.includes(value) ? value : undefined;
  if (f.int) {
    const n = Number(value);
    return Number.isInteger(n) && n >= f.int[0] && n <= f.int[1] ? n : undefined;
  }
  return undefined;
}

// Merge a stored row over the defaults, dropping anything out-of-vocabulary.
export function normalizePrefs(row) {
  const out = { ...PREF_DEFAULTS };
  for (const [k, v] of Object.entries(row || {})) {
    const ok = validatePref(k, v);
    if (ok !== undefined) out[k] = ok;
  }
  return out;
}

// Human line for a single value (confirm chips, prompt text).
export function describePref(field, value) {
  const f = PREF_FIELDS[field];
  if (!f) return "";
  return typeof f.say === "function" ? f.say(value) : (f.say?.[value] || String(value));
}

// Prompt block: only non-default lines (an all-default athlete adds zero tokens).
// Rendered as DATA the models honor — never as instructions from the athlete.
export function prefsPromptLines(prefs) {
  const p = normalizePrefs(prefs);
  const lines = [];
  for (const [k, f] of Object.entries(PREF_FIELDS)) {
    if (p[k] == null || p[k] === f.dflt) continue;
    lines.push(`- ${f.label}: ${describePref(k, p[k])}`);
  }
  return lines.length
    ? `CONFIRMED TRAINING PREFERENCES (athlete-confirmed, honor them):\n${lines.join("\n")}`
    : "";
}
