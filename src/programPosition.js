// ─── WHERE THE ATHLETE IS IN THEIR PROGRAM ───────────────────────────────────
// Replaces the guess that shipped before this: anchor on the last logged session's
// typed day label, then advance by `round(daysSince * training_days_per_week / 7)`
// and let the model walk the free-text program forward that many sessions, wrapping
// weeks itself.
//
// That formula assumes training days are spread evenly across the week. On any
// program under 7 days/week they never are — athletes start on different weekdays and
// move their rest days — so it drifted constantly, and every correction the athlete
// typed was thrown away because nothing stored the answer. (Will, 2026-07-27.)
//
// THE RULE NOW (Will's call):
//   • WEEK is calendar. It turns over every SUNDAY, to the first workout of the next
//     week of the program. Anything programmed for last week and not logged was
//     missed — the program moves on without it.
//   • DAY WITHIN THE WEEK is sequence. Log a session, you're on the next day. Rest
//     days are simply days with no log; they don't advance anything and don't need to
//     be modelled.
//   • The athlete outranks both. "I'm on day 2" makes day 2 the truth, and the next
//     session is day 3.
//
// Both numbers are DERIVED, never stored as a mutable counter — a counter drifts the
// moment a write is missed, and it can't be recomputed after the fact. Week comes from
// the calendar; day comes from counting the sessions logged since Sunday. The only
// persisted state is where the program started and any override the athlete stated.
// Nothing to keep in sync, nothing a failed job can corrupt, and it self-heals.

// ─── PROGRAM SHAPE ───────────────────────────────────────────────────────────
// Real programs land in three layouts, and position means the same thing in all of
// them, so the parser reduces all three to ONE weekly template plus a week count:
//   A. Week-sectioned — "Week 1 / Day 1 … Day 2 … Week 2 / Day 1 …"
//   B. Day list with per-week load columns — "Day 1 – Push: Bench 3x5 (Wk1 65%, Wk2 70%)"
//   C. Plain day list, no weeks at all.
// The weekly TEMPLATE (the ordered day labels of one week) is what day-within-week
// indexes into; the week number selects which week's loads to read. For B and C the
// template is just the day list.

const WEEK_HEADER_RE = /^\s*#{0,3}\s*(?:block\s+[^,\n]{1,20}[,\s]+)?(?:week|wk)\s*#?\s*(\d{1,2})\b/i;

// Day headers come in two strengths, and the distinction is load-bearing. Will's own
// program is laid out as:
//     MONDAY — PUSH A          <- the day
//     BENCH — PYRAMID          <- a SECTION inside that day
//     Bench Press — 5 sets climbing: 67% / 72% …
//     OVERHEAD                 <- another section
// A single flat matcher that accepts "bench"/"squat"/"push" reads those section
// headers as days, inflating a 6-day week into fifteen and shifting every subsequent
// day — which is precisely the silent mis-prescription this module exists to stop.
//
// So: STRONG headers (a weekday name, or "Day 3") are unambiguous — they can only be
// a session. If a program uses any, they alone define the week. WEAK headers
// ("Push A", "Upper", "Legs") are only consulted when there are no strong ones,
// because in that layout they ARE the days.
const STRONG_DAY_RE = /^\s*#{0,3}\s*(?:(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|weds?|thur?s?|fri|sat|sun)\b|day\s*#?\s*(\d{1,2})\b)/i;
const WEAK_DAY_RE = /^\s*#{0,3}\s*(?:upper|lower|push|pull|full[\s-]?body|legs?|chest|back|arms|shoulders|conditioning)\b/i;

// Anything prescribing work is an exercise line, never a header. Covers "4×5-6",
// "5x3", "3 sets of 8" and "5 sets climbing" — the last of which has no digit-x-digit
// at all, which is how "Bench Press — 5 sets climbing: 67%" slipped through as a day.
const SETS_REPS_RE = /\d+\s*(?:x|×)\s*\d+|\b\d+\s*sets?\b|@\s*\d|\d\s*%/i;

const WEEKDAY_KEY = { mon:1, monday:1, tue:2, tues:2, tuesday:2, wed:3, weds:3, wednesday:3, thu:4, thur:4, thurs:4, thursday:4, fri:5, friday:5, sat:6, saturday:6, sun:0, sunday:0 };

const cleanLabel = (line) =>
  String(line).trim().replace(/^#+\s*/, "").replace(/[:\-–—\s]+$/, "").slice(0, 80);

// Ordered day labels of ONE week, plus how many weeks the program covers.
export const parseProgramShape = (programText) => {
  const lines = String(programText || "").split("\n");
  const weeks = new Set();
  // ONE ordered list of distinct days, deduped by IDENTITY rather than by text. That
  // makes the week-sectioned layout collapse for free — Week 1's "Day 1/2/3" and Week
  // 2's are the same three days — so there's no need to guess which week's block is
  // the "real" template. It also survives a multi-block program repeating its weekdays
  // with drifting wording ("WEDNESDAY — OLY + LEGS (moderate)" in one block,
  // "WEDNESDAY — OLY + LEGS" in the next): keyed on the weekday those are one day,
  // keyed on the string they'd be two, and a phantom day shifts everything after it.
  const days = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const wm = t.match(WEEK_HEADER_RE);
    if (wm) {
      // A WEEK SECTION header is a line that declares one week and stops. A load
      // column ("Wk1 top set: 88% | Wk2: 89% | Wk3: 91%") also starts with a week
      // token but names several — counting them apart keeps a progression note from
      // being read as the start of a new section.
      const mentions = (t.match(/\b(?:wk|week)\s*#?\s*\d{1,2}\b/gi) || []).length;
      const n = parseInt(wm[1], 10);
      if (mentions === 1 && n >= 1 && n <= 52) { weeks.add(n); continue; }
    }
    if (SETS_REPS_RE.test(t)) continue;                 // an exercise line, never a header
    const strong = t.match(STRONG_DAY_RE);
    if (!strong && !WEAK_DAY_RE.test(t)) continue;
    const key = strong
      ? (strong[1] ? `wd:${WEEKDAY_KEY[strong[1].toLowerCase()]}` : `dn:${parseInt(strong[2], 10)}`)
      : `wk:${cleanLabel(t).toLowerCase()}`;
    if (!days.some((e) => e.key === key)) days.push({ key, label: cleanLabel(t), strong: !!strong });
  }
  // Strong headers win outright when the program has any: the weak matches alongside
  // them are section headings inside a day ("BENCH — PYRAMID" under "MONDAY — PUSH A"),
  // not days of their own.
  const strongOnly = days.filter((e) => e.strong);
  const template = (strongOnly.length ? strongOnly : days).map((e) => e.label);
  // Layout B declares its length INLINE rather than in headers — the days are written
  // once and the loads carry a column per week ("Bench 3x5 (Wk1 65%, Wk2 70%, Wk3
  // 75%)"). Without this a 4-week block reports zero weeks, so nothing would tell the
  // draft which column to read and the block could never register as finished.
  let weekCount = weeks.size ? Math.max(...weeks) : 0;
  // Layouts that declare their length INLINE rather than in headers also count —
  // a "Wk1 / Wk2 / Wk3 / Wk4" progression line says the block is four weeks just as
  // clearly as four section headers would. Taken as the max across the whole text so
  // it works whether the weeks are sections, columns, or both.
  let inlineMax = 0;
  for (const m of String(programText || "").matchAll(/\b(?:wk|week)\s*#?\s*(\d{1,2})\b/gi)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 52 && n > inlineMax) inlineMax = n;
  }
  // A single stray "week 1" is a sentence, not a structure — two or more distinct
  // week numbers is a real block length.
  if (inlineMax >= 2 && inlineMax > weekCount) weekCount = inlineMax;
  if (weekCount === 1 && weeks.size <= 1) weekCount = 0;
  return {
    dayTemplate: template,
    weekCount,
    hasWeeks: weekCount > 0,
  };
};

// ─── CALENDAR ────────────────────────────────────────────────────────────────
// LOCAL dates throughout, never UTC. A UTC day boundary rolls over mid-evening, which
// would turn the week early for anyone west of Greenwich — the same class of bug that
// has already bitten the Quick Log day stamp and the demo's week cache.

// Midnight local on the Sunday on or before `d`. Sunday is day 0, so this is simply
// "back up to the start of this calendar week".
export const sundayOnOrBefore = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

// How many Sunday boundaries fall in (from, to]. This is the number of times the
// program week has turned over — NOT elapsed days / 7, which would be wrong whenever
// the start date isn't itself a Sunday.
export const weeksTurnedOver = (from, to) => {
  const a = sundayOnOrBefore(from), b = sundayOnOrBefore(to);
  if (b <= a) return 0;
  return Math.round((b - a) / (7 * 24 * 60 * 60 * 1000));
};

// ─── POSITION ────────────────────────────────────────────────────────────────
// `sessions` = timestamps (ms or Date) of REAL logged sessions, any order. Callers
// pass one per session, not one per workout row — the caller groups first.
//
// `override` = {week, day, at} — the athlete stating where they are ("I'm on day 2").
// It wins over the derived day for the rest of that calendar week; the Sunday rule
// still turns the week, because the athlete telling us their day is not a statement
// that the program should stop advancing.
export const currentPosition = ({ programText, startedOn, override, sessions, now } = {}) => {
  const t = now ? new Date(now) : new Date();
  const shape = parseProgramShape(programText);
  const dayCount = shape.dayTemplate.length;
  const weekStart = sundayOnOrBefore(t);

  // ── WEEK ──
  // Only claimed when we can actually derive it — from the athlete's own statement, or
  // from when the program became active. With neither, `weekKnown` is false and the
  // caller must NOT assert a week: defaulting silently to "Week 1" is how an athlete
  // three weeks into a block gets shown week 1's loads with total confidence, which is
  // the failure this module exists to end. The DAY is still solid either way — it comes
  // from sessions logged since Sunday, which needs no anchor.
  let week = 1;
  let weekKnown = false;
  if (override?.week && override?.at) {
    week = override.week + weeksTurnedOver(override.at, t);
    weekKnown = true;
  } else if (startedOn) {
    week = 1 + weeksTurnedOver(startedOn, t);
    weekKnown = true;
  }
  week = Math.max(1, week);
  // A program that has run out of weeks holds on its last one rather than inventing
  // a Week 9 of an 8-week block. `blockComplete` is the honest signal to act on.
  const blockComplete = weekKnown && shape.weekCount > 0 && week > shape.weekCount;
  if (blockComplete) week = shape.weekCount;

  // ── DAY WITHIN THE WEEK ──
  const times = (sessions || [])
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n));
  const sinceWeekStart = times.filter((n) => n >= weekStart.getTime()).length;

  let day;
  const overrideAt = override?.at ? new Date(override.at) : null;
  const overrideThisWeek = overrideAt && overrideAt.getTime() >= weekStart.getTime();
  if (override?.day && overrideThisWeek) {
    // They named their day, then logged N sessions since saying so → day + N.
    const after = times.filter((n) => n > overrideAt.getTime()).length;
    day = override.day + after;
  } else {
    // Sunday reset: the first session of a new calendar week is day 1, whatever
    // happened last week and whatever was left unlogged in it.
    day = sinceWeekStart + 1;
  }
  // Logging more sessions than the week has days holds at the last one rather than
  // running off the end — the week turns on Sunday, not on session count.
  if (dayCount > 0) day = Math.min(Math.max(1, day), dayCount);
  else day = Math.max(1, day);

  // Sessions programmed for LAST week that never got logged. Will's rule is that the
  // program moves on regardless, so this is reported, never acted on — it's what the
  // week-ahead recap and the coach's brief need in order to say something true.
  const prevStart = new Date(weekStart); prevStart.setDate(prevStart.getDate() - 7);
  const loggedLastWeek = times.filter((n) => n >= prevStart.getTime() && n < weekStart.getTime()).length;
  const missedLastWeek = dayCount > 0 ? Math.max(0, dayCount - loggedLastWeek) : 0;

  return {
    week,
    weekKnown,
    day,
    label: dayCount > 0 ? (shape.dayTemplate[day - 1] || "") : "",
    dayTemplate: shape.dayTemplate,
    hasWeeks: shape.hasWeeks,
    weekCount: shape.weekCount,
    blockComplete,
    loggedThisWeek: sinceWeekStart,
    loggedLastWeek,
    missedLastWeek,
    weekStart,
  };
};

// The block handed to the draft/opener prompts. Stated flatly and without hedging:
// the whole point of this module is that the model no longer has to work position out
// for itself, so the prompt must not invite it to.
export const positionBlock = (pos) => {
  if (!pos || !pos.dayTemplate?.length) return "";
  const weekPrefix = pos.hasWeeks && pos.weekKnown ? `Week ${pos.week}, ` : "";
  const lines = [
    `- TODAY IS: ${weekPrefix}Day ${pos.day}${pos.label ? ` — "${pos.label}"` : ""}. This is RESOLVED — use it exactly. Do NOT re-derive the day from the calendar, from how long ago they last trained, or from the exercises in their history.`,
    `- The week runs Sunday to Saturday and turns over every Sunday to the next week of the program.${pos.hasWeeks && pos.weekCount ? ` This program covers ${pos.weekCount} week${pos.weekCount === 1 ? "" : "s"}.` : ""}`,
    `- Sessions logged since Sunday: ${pos.loggedThisWeek}. This week's session order: ${pos.dayTemplate.map((d, i) => `${i + 1}. ${d}`).join(" | ")}.`,
  ];
  if (pos.hasWeeks && pos.weekKnown) lines.push(`- Read every load, percentage and progression from the WEEK ${pos.week} column/section. Not week 1, unless week 1 is where they are.`);
  // Say so plainly rather than defaulting to week 1 and sounding certain. Asking once
  // costs a sentence; guessing wrong costs the athlete a session at the wrong loads.
  if (pos.hasWeeks && !pos.weekKnown) lines.push(`- WHICH WEEK of the program they're on is NOT known — nothing on record establishes it. Do NOT assume Week 1 and do NOT state a week as if it were fact. Use the loads you can justify from their recent logged sessions, and ask them once, plainly, which week they're on ("Which week of the block are you on?") so it can be recorded.`);
  if (pos.missedLastWeek > 0) lines.push(`- They missed ${pos.missedLastWeek} programmed session${pos.missedLastWeek === 1 ? "" : "s"} last week. The program has MOVED ON — do not try to make them up, and do not mention it unless they raise it.`);
  if (pos.blockComplete) lines.push(`- They have reached the END of this program's ${pos.weekCount} weeks and are holding on the final week. Worth telling them the block is done when it fits naturally.`);
  return lines.join("\n");
};
