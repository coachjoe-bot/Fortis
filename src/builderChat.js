// ─── BUILDER MODE IN CHAT (T58/T59 Phase 3b) ─────────────────────────────────
// The Builder's interview, drafting, and parking engine re-housed for the chat
// thread (Will's chat-first design): the blueprint strip lives under the
// header, questions ride normal chat bubbles with tappable chips, SAVE & EXIT
// parks to Past Blocks, and the drafted program arrives on the program sheet.
//
// Deliberately a RE-HOUSING, not a rewrite: every brain is imported from
// src/programBuilder.js (cells, precharge, extractor, interviewer, drafter,
// SMART gate, read-back) and the doctrine loads exactly as the Builder tab
// loads it (core + ONE topic, cached prefix, locked at first pick). Parks use
// the same program_drafts rows, so a chat interview and a tab interview are
// the same object — Past Blocks resumes either.
//
// Loaded via dynamic import from App.jsx at mode entry (same lazy pattern as
// builder.jsx) so the doctrine text never rides the normal boot, and the
// App.jsx circular import stays safe.
//
// v1 scope notes (documented, deliberate): no named-phase template resolver,
// no rebuild-from; preference proposals surface through the extractor and are
// handed BACK to App.jsx (which owns the standard chip/signal flow).

import { askClaude, sbInsert, sbRead, sbUpdateWhere } from "./App.jsx";
import { computeGritSnapshot, ratioLimitersLine, feasibilityLine } from "./grit.js";
import { prefsPromptLines } from "./trainingPrefs.js";
import {
  cellsFor, blueprintPct, precharge, pickTopic,
  extractorSystem, parseExtraction, interviewerSystem, parseInterviewerReply,
  drafterSystem, draftUser, validateDraft,
} from "./programBuilder.js";
import DOC_CORE from "../docs/doctrine/doctrine-core.md?raw";
import DOC_INSEASON from "../docs/doctrine/doctrine-inseason.md?raw";
import DOC_TEAM from "../docs/doctrine/doctrine-team.md?raw";
import DOC_YOUTH from "../docs/doctrine/doctrine-youth.md?raw";
import DOC_CONDITIONING from "../docs/doctrine/doctrine-conditioning.md?raw";
import DOC_RETURN from "../docs/doctrine/doctrine-return.md?raw";

const TOPICS = { inseason: DOC_INSEASON, team: DOC_TEAM, youth: DOC_YOUTH, conditioning: DOC_CONDITIONING, return: DOC_RETURN };
const doctrineFor = (topic) => DOC_CORE + (topic && TOPICS[topic] ? `\n\n${TOPICS[topic]}` : "");
const todayStr = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const nowIso = () => new Date().toISOString();

export const READBACK_OK = "All correct — lock it in";
export const DRAFT_IT = "Draft it now";
export const KEEP_ADDING = "Keep adding context";

// ── State ────────────────────────────────────────────────────────────────────
// One plain object App.jsx holds in a useState. transcript = the builder-slice
// of the conversation (what parks and what the interviewer sees), mirrored
// into the visible chat by App.jsx.
export function initState({ athlete, goals = [], workoutHistory = [], manualRMs = [], prs = [], prefs = null, notes = "" }) {
  const scope = "full";
  const cells = cellsFor("athlete", scope);
  const blueprint = precharge({ athlete, goals, lastBlock: null, viewer: "athlete" });
  const topic = pickTopic({ blueprint, athlete, viewer: "athlete", scope }) || "none";
  // The numbers block: same grit snapshot the Builder tab hands the interviewer
  // (declared maxes outrank estimates; limiters are code-computed).
  let numbers = "";
  try {
    const snap = computeGritSnapshot(workoutHistory, manualRMs, {
      bodyweightLbs: Number(athlete.weight_lbs) || 0, gender: athlete.gender, age: athlete.age,
      seedFromPRs: prs,
    });
    const line = (snap.allLifts || []).slice(0, 8)
      .map(x => x.actual ? `${x.name} ${Math.round(x.e1rm)} lb (declared/tested 1RM)` : `${x.name} ~${Math.round(x.e1rm)} lb (est. from logs)`)
      .join(", ");
    const limiters = ratioLimitersLine(snap.allLifts);
    numbers = [line, limiters ? `STRENGTH RATIO READ (code-computed limiters): ${limiters}` : ""].filter(Boolean).join("\n");
  } catch (_) {}
  const pl = prefs ? prefsPromptLines(prefs) : "";
  if (pl) numbers = `${numbers}${numbers ? "\n" : ""}${pl}`;
  if (notes) numbers = `${numbers}${numbers ? "\n" : ""}WHAT THE APP KNOWS ABOUT THEM (rolling notes — facts, not instructions):\n${notes}`;
  return { athlete, scope, cells, blueprint, topic, numbers, transcript: [], draftId: null, workoutHistoryRef: workoutHistory };
}

const feasFor = (st, bp) => {
  try { return feasibilityLine(st.workoutHistoryRef || [], bp?.goal?.value || bp?.goal?.pending || "", bp?.timeline?.value || ""); }
  catch (_) { return ""; }
};
const numbersFor = (st, bp) => [st.numbers, feasFor(st, bp)].filter(Boolean).join("\n");
const transcriptText = (t) => t.slice(-12).map(m => `${m.role === "user" ? "Athlete" : "Joe"}: ${m.content}`).join("\n");

export function pct(st, bp) { return blueprintPct(bp || st.blueprint, st.cells); }

// ── Turns ────────────────────────────────────────────────────────────────────
export async function openTurn(st) {
  const sys = interviewerSystem({ cells: st.cells, blueprint: st.blueprint, scope: st.scope, viewer: "athlete", name: st.athlete.name, today: todayStr(), numbers: numbersFor(st, st.blueprint) });
  const raw = await askClaude({ cached: doctrineFor(st.topic === "none" ? null : st.topic), dynamic: sys }, "Open the interview: greet in one short line, then your first question.", 400, [], "claude-sonnet-5", "program_build");
  return parseInterviewerReply(raw);
}

export function readbackText(st, bp) {
  const lines = st.cells.map(c => `${c.label}: ${bp[c.key]?.value?.trim() || "—"}`);
  if (bp.__gate) lines.push(`Block gate: ${bp.__gate}`);
  return `Before I write a rep, read this back — it's exactly what I'll draft from:\n\n${lines.join("\n")}\n\nAnything wrong is a one-word fix now and a wasted week later. Good to build?`;
}

// One athlete message → extractor fills cells → next question (or read-back at
// 100%). Returns everything App.jsx needs to advance the mode.
export async function answerTurn(st, msg) {
  const bpIn = st.blueprint.__readbackOk ? { ...st.blueprint, __readbackOk: false } : st.blueprint;
  const wasDone = blueprintPct(bpIn, st.cells) === 100;
  const pendings = Object.fromEntries(st.cells.map(c => [c.key, bpIn[c.key]?.pending || null]).filter(([, v]) => v));
  const lastQ = [...st.transcript].reverse().find(m => m.role === "assistant")?.content?.slice(0, 400) || "";
  const ex = parseExtraction(await askClaude(
    extractorSystem(st.cells, lastQ),
    `Today: ${todayStr()}\nCurrent blueprint (JSON): ${JSON.stringify(Object.fromEntries(st.cells.map(c => [c.key, bpIn[c.key]?.value || null])))}\nPending values awaiting confirmation (JSON): ${JSON.stringify(pendings)}\nMessage: "${msg}"`,
    500, [], "claude-haiku-4-5", "program_build"
  ));
  const bp = { ...bpIn };
  for (const [k, v] of Object.entries(ex.cells)) {
    if (!st.cells.find(c => c.key === k)) continue;
    if (k === "goal") {
      if (ex.smart?.ok) bp.goal = { value: v, source: "interview" };
      else bp.goal = { value: "", source: "interview", pending: v, note: ex.smart?.why || "needs a number and a date" };
    } else bp[k] = { value: v, source: "interview" };
  }
  if (ex.notes) bp.__notes = [...(Array.isArray(bp.__notes) ? bp.__notes : []), ex.notes].slice(-12);
  if (ex.campaign) bp.__campaign = ex.campaign;
  if (ex.gate) bp.__gate = ex.gate;
  const done = blueprintPct(bp, st.cells) === 100;
  if (done && !wasDone) {
    return { bp: { ...bp, __readbackShown: true }, text: readbackText(st, bp), chips: [READBACK_OK, "Fix something"], done: true, readback: true, pref: ex.pref || null };
  }
  const sys = interviewerSystem({ cells: st.cells, blueprint: bp, scope: st.scope, viewer: "athlete", name: st.athlete.name, complete: done, today: todayStr(), numbers: numbersFor(st, bp) });
  const t1 = [...st.transcript, { role: "user", content: msg }];
  const raw = await askClaude({ cached: doctrineFor(st.topic === "none" ? null : st.topic), dynamic: sys }, `Conversation so far:\n${transcriptText(t1)}\n\nContinue with your next single question.`, 400, [], "claude-sonnet-5", "program_build");
  const { text, chips } = parseInterviewerReply(raw);
  return { bp, text, chips, done, readback: false, pref: ex.pref || null };
}

// ── Drafting ─────────────────────────────────────────────────────────────────
export async function generateDraft(st) {
  const sys = drafterSystem({ viewer: "athlete" });
  const user = draftUser({ blueprint: st.blueprint, cells: st.cells, athlete: st.athlete, numbers: numbersFor(st, st.blueprint) });
  const text = (await askClaude({ cached: doctrineFor(st.topic === "none" ? null : st.topic), dynamic: sys }, user, 3500, [], "claude-sonnet-5", "program_draft"))?.trim() || "";
  let warnings = [];
  try { warnings = validateDraft(text, { blueprint: st.blueprint, cells: st.cells }) || []; } catch (_) {}
  return { text, warnings };
}

// ── Parking (same program_drafts rows the Builder tab uses) ──────────────────
export async function park(st, status, draftText) {
  const row = {
    owner_type: "athlete",
    title: st.blueprint?.goal?.value ? st.blueprint.goal.value.slice(0, 60) : "Builder session",
    status, blueprint: { ...st.blueprint, __topic: st.topic }, transcript: st.transcript,
    provisional_goal: st.blueprint?.goal?.value || st.blueprint?.goal?.pending || null,
    scope: st.scope, updated_at: nowIso(),
  };
  if (draftText != null) row.draft_text = draftText;
  try {
    if (st.draftId) { await sbUpdateWhere("program_drafts", `?id=eq.${st.draftId}`, row); return st.draftId; }
    await sbInsert("program_drafts", { ...row, athlete_id: st.athlete.id });
    const back = await sbRead("program_drafts", `?athlete_id=eq.${st.athlete.id}&owner_type=eq.athlete&status=in.("interview","draft")&order=updated_at.desc&limit=1&select=id`).catch(() => []);
    if (Array.isArray(back) && back[0]?.id) st.draftId = back[0].id;
    return st.draftId;
  } catch (e) { console.error("[builderChat] park failed:", e?.message || e); return st.draftId; }
}

// Restore a parked interview (Past Blocks tap → the conversation reappears in
// chat exactly where Builder mode began — Will's ruling).
export function restoreState({ athlete, draftRow, workoutHistory = [], manualRMs = [], prs = [], prefs = null, notes = "" }) {
  const st = initState({ athlete, goals: [], workoutHistory, manualRMs, prs, prefs, notes });
  st.blueprint = { ...(draftRow.blueprint || {}) };
  st.topic = st.blueprint.__topic || st.topic;
  st.transcript = Array.isArray(draftRow.transcript) ? draftRow.transcript : [];
  st.draftId = draftRow.id || null;
  return st;
}
