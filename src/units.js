// ─── UNITS — THE single source for lbs↔kg (T55) ───
// Every conversion in the app lives here. Four hand-copies of toLbs (two different
// constants) caused the kg leaks Will hit in TestFlight; do not add a fifth.
//
// Contract:
//   • STORAGE is always the raw (weight, unit) pair exactly as the athlete typed it.
//     Lossless by construction. Never store a converted or rounded number.
//   • DISPLAY converts from that raw pair in ONE step (identity when units match),
//     so flipping the Settings toggle back and forth never re-rounds a number.
//   • Derived values (e1RM, tonnage, diffs) are computed in lbs internally and
//     converted to the display unit only at the moment they're shown.
//   • Rounding happens ONLY at display: stats (PRs, e1RMs) to 1 lb / 0.5 kg,
//     working loads to 5 lb / 2.5 kg (Will's rule: no decimal working weights).
// Server code imports this via api/_units.js (same pattern as api/_grit.js).

export const LBS_PER_KG = 2.20462;

// Raw conversions — no rounding. Same signature/semantics as the old grit.js toLbs.
export const toLbs = (weight, unit) => (unit === "kg" ? weight * LBS_PER_KG : weight);
export const toKg = (weight, unit) => (unit === "kg" ? weight : weight / LBS_PER_KG);

// The athlete's chosen display unit. Set once at boot from athletes.weight_unit and
// again when the Settings toggle flips; read by every formatter below so no surface
// can drift from the setting.
let DISPLAY_UNIT = "lbs";
export const setDisplayUnit = (u) => { DISPLAY_UNIT = u === "kg" ? "kg" : "lbs"; };
export const getDisplayUnit = () => DISPLAY_UNIT;

// A raw stored (weight, unit) pair → number in the display unit. One conversion, ever.
export const toDisplay = (weight, unit, displayUnit = DISPLAY_UNIT) =>
  displayUnit === "kg" ? toKg(Number(weight) || 0, unit === "kg" ? "kg" : "lbs")
                       : toLbs(Number(weight) || 0, unit === "kg" ? "kg" : "lbs");

export const roundStat = (v, displayUnit = DISPLAY_UNIT) =>
  displayUnit === "kg" ? Math.round(v * 2) / 2 : Math.round(v);
export const roundLoad = (v, displayUnit = DISPLAY_UNIT) =>
  displayUnit === "kg" ? Math.round(v / 2.5) * 2.5 : Math.round(v / 5) * 5;

// Format a raw stored pair in the display unit. kind: "stat" (default) | "load".
export const fmtWeightIn = (weight, unit, { displayUnit = DISPLAY_UNIT, kind = "stat", space = false } = {}) => {
  const v = kind === "load" ? roundLoad(toDisplay(weight, unit, displayUnit), displayUnit)
                            : roundStat(toDisplay(weight, unit, displayUnit), displayUnit);
  return `${v}${space ? " " : ""}${displayUnit === "kg" ? "kg" : "lbs"}`;
};

// Format an ALREADY-lbs derived value (e1RM, tonnage, diff) in the display unit.
export const fmtLbsValue = (lbs, opts = {}) => fmtWeightIn(lbs, "lbs", opts);

// Bare display number (no unit suffix) for an already-lbs derived value.
export const displayStat = (lbs, displayUnit = DISPLAY_UNIT) =>
  roundStat(toDisplay(lbs, "lbs", displayUnit), displayUnit);

// The unit label alone, for JSX that renders number and suffix separately.
export const unitLabel = (displayUnit = DISPLAY_UNIT) => (displayUnit === "kg" ? "kg" : "lbs");
