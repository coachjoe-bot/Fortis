// ─── QUICK LOG DRAFT PERSISTENCE ─────────────────────────────────────────────
// A Quick Log draft is a workout IN PROGRESS — the athlete opens it between sets, closes
// it, trains, comes back. So closing the sheet must never throw the draft (or their edits)
// away. React state can't carry it: the sheet unmounts on close, and iOS evicts the whole
// PWA the moment they switch to music or the camera mid-session, so a reopen is often a
// cold boot. localStorage is the only store that survives both.
//
// This lives in its own module rather than inside App.jsx because the rules below are the
// data-safety half of the feature — resuming a draft the athlete already logged would
// double-log their session — and rules that can corrupt history get a regression suite
// (scripts/test-quicklog-draft.mjs).

export const qlKey = (athleteId) => `wilco_quicklog_${athleteId}`;

// How long a parked draft stays resumable. Deliberately a rolling window rather than "same
// calendar day": a session that starts at 11:40pm has to still resume at 12:10am. Long
// enough for any real workout, short enough that yesterday's draft never comes back.
export const QL_RESUME_MS = 8*60*60*1000;

// Fingerprint of the athlete's logged history, stamped onto a saved draft. If it differs on
// reopen, they logged through chat while the draft sat parked — the draft is stale and
// resuming it would double-log the session, so it gets thrown out instead. Row 0 is the
// newest (every load is order=created_at.desc and new logs are prepended). In-place
// corrections re-map the array without changing its length or its head, so they leave a
// draft resumable — only genuinely new sessions invalidate it.
export const qlStamp = (workoutHistory) => {
  const h = Array.isArray(workoutHistory)?workoutHistory:[];
  return `${h.length}:${(h[0]&&(h[0].id??h[0].created_at))||""}`;
};

// The resumable draft, or null. Every rejection path (missing, corrupt, expired, stale,
// empty) returns null so the caller just redrafts — a lost draft is never worth an error
// state in front of someone mid-workout.
export const qlLoad = (athleteId, workoutHistory) => {
  try{
    const d = JSON.parse(localStorage.getItem(qlKey(athleteId))||"null");
    if(!d || typeof d.draft!=="string" || !d.draft.trim()) return null;
    if(Date.now()-(d.savedAt||0) >= QL_RESUME_MS) return null;
    if(d.stamp !== qlStamp(workoutHistory)) return null;
    return {
      draft: d.draft,
      notes: typeof d.notes==="string" ? d.notes : "",
      undoStack: Array.isArray(d.undoStack) ? d.undoStack : [],
      prebuilt: !!d.prebuilt,
      // Warm-up / cool-down tap-to-log toggles (Program Builder: two booleans
      // only — full prep detail lives in the program text, never the log).
      prep: d.prep && typeof d.prep==="object" ? {warmup:!!d.prep.warmup, cooldown:!!d.prep.cooldown} : {warmup:false, cooldown:false},
    };
  }catch(_){ return null; }
};

// Saving an empty draft clears instead — an emptied textarea means "nothing to come back
// to", and leaving a stale row behind would light up the RESUME LOG nav label for nothing.
// `prebuilt` marks a draft the app generated in the BACKGROUND, before the athlete
// ever opened the sheet (see qlPrebuildEligible). It must not be presented as
// "picked up where you left off" — nobody left off anywhere — and must not light
// the RESUME LOG nav label, which is a promise about the athlete's own unfinished
// work. Any later save from the sheet omits the flag, so the moment they touch it
// the draft becomes a normal parked one.
export const qlSave = (athleteId, workoutHistory, {draft, notes, undoStack, prebuilt, prep}) => {
  try{
    if(!draft||!draft.trim()){ qlClear(athleteId); return; }
    localStorage.setItem(qlKey(athleteId), JSON.stringify({
      draft,
      notes: notes||"",
      undoStack: (undoStack||[]).slice(-5), // a nicety, not worth growing the payload unbounded
      savedAt: Date.now(),
      stamp: qlStamp(workoutHistory),
      prebuilt: !!prebuilt,
      prep: prep && (prep.warmup||prep.cooldown) ? {warmup:!!prep.warmup, cooldown:!!prep.cooldown} : undefined,
    }));
  }catch(_){}
};

// ─── BACKGROUND PRE-BUILD ELIGIBILITY (a cost gate, not a feature flag) ──────
// Pre-building today's draft makes QUICK LOG open instantly instead of behind a
// generation — but a pre-build the athlete never opens is a wasted Sonnet call
// (~$0.01). Two gates keep that bounded and honest:
//   • ONLY athletes who have actually sent a Quick Log in the last 14 days. A
//     brand-new or lapsed athlete never triggers a speculative call, so the spend
//     tracks people who demonstrably use the feature.
//   • AT MOST ONE per athlete per calendar day, so reopening the app ten times
//     costs one generation, not ten.
// Worst case is therefore one call per day per active Quick Log user.
export const QL_PREBUILD_WINDOW_MS = 14*24*60*60*1000;
const qlUsedKey = (athleteId) => `wilco_quicklog_used_${athleteId}`;
const qlPrebuiltKey = (athleteId) => `wilco_quicklog_prebuilt_${athleteId}`;

export const qlMarkUsed = (athleteId) => {
  try{ localStorage.setItem(qlUsedKey(athleteId), String(Date.now())); }catch(_){}
};

// LOCAL date, never UTC — a UTC day stamp rolls over mid-evening and would re-fire
// the pre-build for a second time on the same training day.
export const qlLocalDay = (now) => new Date(now||Date.now()).toLocaleDateString();

// ─── APP-OPEN OPENER CACHE ───────────────────────────────────────────────────
// The generated "here's today's session" opener, cached for the LOCAL calendar day
// so every reopen paints it instantly and free — the ~$0.01 draft call happens at
// most once per day. Day-stamped (not history-stamped like a Quick Log draft)
// because the opener is shown ONLY before today's chat starts: the moment the
// athlete logs or chats, a today-transcript exists and wins over the opener
// outright, so a mid-day history change can never surface a stale opener.
// LOCAL day, never UTC — a UTC stamp rolls over mid-evening and would re-fire the
// draft call a second time on the same training day (same bug class as qlLocalDay).
const qlOpenerKey = (athleteId) => `wilco_today_opener_${athleteId}`;

export const openerLoad = (athleteId, now) => {
  try {
    if (!athleteId) return null;
    const d = JSON.parse(localStorage.getItem(qlOpenerKey(athleteId)) || "null");
    if (!d || d.day !== qlLocalDay(now)) return null;
    if (typeof d.msg !== "string" || !d.msg.trim()) return null;
    return d.msg;
  } catch (_) { return null; }
};

export const openerSave = (athleteId, msg, now) => {
  try {
    if (!athleteId || !msg || !String(msg).trim()) return;
    localStorage.setItem(qlOpenerKey(athleteId), JSON.stringify({ day: qlLocalDay(now), msg: String(msg) }));
  } catch (_) {}
};

export const qlPrebuildEligible = (athleteId, now) => {
  try{
    const t = now||Date.now();
    const used = Number(localStorage.getItem(qlUsedKey(athleteId))||0);
    if(!used || t-used >= QL_PREBUILD_WINDOW_MS) return false;
    return localStorage.getItem(qlPrebuiltKey(athleteId)) !== qlLocalDay(t);
  }catch(_){ return false; }
};

// Stamped BEFORE the call goes out, so a failed generation still consumes the
// day's single attempt — retrying a failing prompt on every reopen is the one way
// this could become an unbounded spend.
export const qlMarkPrebuilt = (athleteId, now) => {
  try{ localStorage.setItem(qlPrebuiltKey(athleteId), qlLocalDay(now)); }catch(_){}
};

export const qlClear = (athleteId) => { try{ localStorage.removeItem(qlKey(athleteId)); }catch(_){} };

// ─── A PROGRAM WRITTEN IN THE CONVERSATION ───────────────────────────────────
// Quick Log used to gate purely on the athlete's SAVED program (program_text /
// temp_program_text). No saved program meant the "Add My Program" wall — even when
// Joe had just written them a session in chat two messages earlier. Plenty of
// athletes work exactly that way: they never fill the Program tab, they ask for
// something on the day and train off the answer (Will, 2026-07-27). For them the
// program genuinely exists; it just lives in the transcript.
//
// So this finds it there. Deliberately narrow, because the cost of a false positive
// is real — mistaking a workout the athlete already FINISHED for a plan would have
// Quick Log prescribe the session they just did:
//   • ASSISTANT messages only. Joe writing a session is the signal we want; the
//     athlete's own messages are usually LOGS, and a Quick Log draft is formatted
//     exactly like a program. Athlete-pasted programs already have their own home
//     (the is_program_update flow saves those to the Program tab).
//   • Callers only reach for this when there's NO saved program, so an athlete with
//     a real program in the tab is never affected by anything decided here.
// A single day counts — "write me something for chest today" is the exact case this
// exists for, so requiring a multi-week block would miss the point.

// "Bench Press 4x6", "Incline DB Press 3 x 10 @ 60", "- Squat 5x5", "2. RDL 3x8".
// The lift name has to carry a letter, so a bare "3x8" or a date line can't qualify.
const QL_EX_LINE_RE = /^\s*(?:[-*•]|\d+[.)])?\s*[A-Za-z][A-Za-z0-9 '’&/()+.,-]{2,}?\s+\d+\s*(?:x|×|\s+sets?\s+of\s+)\s*\d+/i;

// A run of exercise lines is what makes something a session rather than a sentence
// mentioning a lift. Three is the floor — two can appear in ordinary coaching prose
// ("get your bench 3x5 in before the 5x10 accessory work").
export const QL_PROGRAM_MIN_EX_LINES = 3;

export const countProgramLines = (text) =>
  String(text || "").split("\n").filter((l) => QL_EX_LINE_RE.test(l)).length;

export const looksLikeProgramText = (text) =>
  countProgramLines(text) >= QL_PROGRAM_MIN_EX_LINES;

// The most recent program Joe wrote in this conversation, or null. Newest-first so a
// revision ("actually swap the incline for flat") wins over the version it replaced.
export const findChatProgram = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.role !== "assistant" || typeof m.content !== "string") continue;
    if (looksLikeProgramText(m.content)) return m.content.trim();
  }
  return null;
};

// ─── SUPERSEDED PROGRAMS IN THE TRANSCRIPT ───────────────────────────────────
// "Adjust today for me" → Joe writes a session → "no, do it again" → Joe writes a
// better one. The athlete has made a clear choice. But the draft prompt is handed the
// last 16 turns VERBATIM and told to honor what the conversation says, so it saw both
// sessions with equal authority and built today's log out of the two of them — the
// rejected version's exercises merged into the one they actually wanted (Will,
// 2026-07-27; it has bitten him more than once).
//
// Picking the newest as THE program isn't enough on its own: the loser is still
// sitting in the conversation block being read. So its content is REPLACED here —
// not just relabelled, because any surviving line of it is a line that can be merged
// in. The turn itself stays so the exchange still reads as a back-and-forth, which is
// what tells the model a revision happened at all.
//
// Applies whether or not the athlete has a saved program: the merge bug came from the
// conversation block, which is built for everyone.
export const QL_SUPERSEDED = "[an earlier version of today's session that the athlete REJECTED — superseded, do not use any part of it]";

export const markSupersededPrograms = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  // Index of the LAST assistant message that reads as a written session: the only
  // one that survives intact.
  let keep = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && m.role === "assistant" && typeof m.content === "string" && looksLikeProgramText(m.content)) { keep = i; break; }
  }
  if (keep < 0) return list;
  return list.map((m, i) => {
    if (i === keep) return m;
    if (m && m.role === "assistant" && typeof m.content === "string" && looksLikeProgramText(m.content)) {
      return { ...m, content: QL_SUPERSEDED };
    }
    return m;
  });
};

// ─── "WANT ME TO KEEP THAT?" — OFFER RATE LIMIT ──────────────────────────────
// A structured program is genuinely the difference between logging workouts and
// making progress, and an athlete with an empty Program tab should hear that. Once.
// Joe writes sessions in chat constantly for these athletes, so an ungated offer
// would attach a pitch to nearly every reply — and a nudge that shows up every day
// stops being a nudge and becomes something you learn to swipe past.
//
// Two limits, both required: at most ONE offer per local calendar day, and at most
// THREE across the athlete's lifetime. After that Joe drops it entirely — they've
// heard the case and declined it three times, which is an answer.
// LOCAL day, never UTC — same rollover trap as qlLocalDay.
export const QL_PROGRAM_OFFER_MAX = 3;
const qlProgOfferKey = (athleteId) => `wilco_prog_offer_${athleteId}`;

const readProgOffer = (athleteId) => {
  try{
    const d = JSON.parse(localStorage.getItem(qlProgOfferKey(athleteId))||"null");
    return d && typeof d==="object" ? {day: d.day||"", count: Number(d.count)||0} : {day:"", count:0};
  }catch(_){ return {day:"", count:0}; }
};

export const programSaveOfferAllowed = (athleteId, now) => {
  if(!athleteId) return false;
  const {day, count} = readProgOffer(athleteId);
  if(count >= QL_PROGRAM_OFFER_MAX) return false;
  return day !== qlLocalDay(now);
};

export const markProgramSaveOffered = (athleteId, now) => {
  try{
    if(!athleteId) return;
    const {count} = readProgOffer(athleteId);
    localStorage.setItem(qlProgOfferKey(athleteId), JSON.stringify({day: qlLocalDay(now), count: count+1}));
  }catch(_){}
};

// ─── THE "===" REPLY SPLITTER ────────────────────────────────────────────────
// Both Quick Log AI calls answer in two sections — the TODAY'S FOCUS note, then a
// "===" line, then the log itself. Three call sites parse that (draft, edit, and
// now the streaming draft, which re-parses on EVERY delta), and getting it wrong
// is not cosmetic: a missed separator dumps Joe's coaching prose straight into the
// athlete's workout log, where it gets parsed as exercises.
//
// `notes` is null — not "" — when there was no separator, so a caller can tell
// "the model rewrote the note as empty" from "the model didn't send a note".
// The edit path depends on that distinction to decide whether to keep the note it
// already has. Deliberately tolerant of any run of 3+ equals signs with padding,
// which is what the models actually emit.
// `^` as well as `\n` so a reply that opens with the separator (the model choosing
// to send no focus note at all) still splits into an EMPTY note rather than being
// read as a log whose first line happens to be "===".
export const QL_SPLIT_RE = /(?:^|\n)[ \t]*={3,}[ \t]*(?:\n|$)/;

export const splitQuickLogReply = (text) => {
  const t = String(text || "").trim();
  const parts = t.split(QL_SPLIT_RE);
  if (parts.length < 2) return { notes: null, log: t };
  return { notes: parts[0].trim(), log: parts.slice(1).join("\n").trim() };
};

// Streaming view of the same reply. Before the separator arrives, everything so
// far IS the focus note (the prompt orders it first), so it renders into the note
// box and the log stays empty. A partial separator mid-stream ("==" at the tail)
// is trimmed off the displayed note rather than flickering as content.
export const streamQuickLogReply = (accumulated) => {
  const { notes, log } = splitQuickLogReply(accumulated);
  if (notes !== null) return { notes, log, complete: true };
  return { notes: log.replace(/\n?\s*={1,}\s*$/, "").trim(), log: "", complete: false };
};
