// ─── PROGRAM HISTORY — block snapshots of program_text ────────────────────────
// Program Builder Phase B (docs/program-builder-build-handoff.md): every
// save-to-program records what the athlete was actually running, so the Builder's
// block hand-off question ("how did the last block go?") has real data at launch.
//
// One row in program_history ≈ one training BLOCK, not one save. The distinction
// is made here, not at the call sites: a save whose text is mostly the same as
// the current block (a weight bump from PR propagation, a check-in tweak, a
// one-lift swap) UPDATES the open block's text in place, keeping its applied_at;
// a save that mostly rewrites it (or replaces it outright) CLOSES the open block
// (completed_at) and opens a new row. Callers that KNOW they're a wholesale
// replacement pass forceNewBlock so a coincidentally-similar new program still
// gets its own block. A block that is already CLOSED is never reopened or
// evolved — any save after a close starts a new block, however similar the text
// (the athlete deliberately ended that chapter via "Start next block").
//
// When a block closes, a RECAP is generated best-effort: the logs inside the
// block's date range + the athlete's goal are condensed into a few sentences
// (what was trained, what moved, goal status) stored in block_recap — the
// "proof feed over a whole block" the Past Blocks tab shows, and the context
// the Builder hands the next interview.
//
// Like changeRequest.js, this module takes the App.jsx data/AI helpers as
// arguments instead of importing them (App.jsx imports this file — a static
// import back would be a cycle). React-free; block-decision logic unit tested by
// scripts/test-program-history.mjs.
import { lineDiff } from "./programDiff.js";

// Fraction of the COMBINED line count that changed between two program texts.
// 0 = identical, 1 = nothing in common. Exported for the test suite.
export function changedRatio(oldText, newText) {
  const diff = lineDiff(oldText, newText);
  const meaningful = diff.filter((d) => d.text.trim() !== "");
  if (meaningful.length === 0) return 0;
  const changed = meaningful.filter((d) => d.type !== "same").length;
  return changed / meaningful.length;
}

// Above this fraction of changed lines, a save is a NEW block rather than an
// evolution of the open one. Half the program rewritten = you changed programs.
export const NEW_BLOCK_RATIO = 0.5;

const SUMMARY_SYS =
  "You summarize a strength training program in ONE line (max 90 characters) for a history list: " +
  "the main focus and split, e.g. \"4-day upper/lower — squat & bench strength, 5s progression\". " +
  "Plain text, no quotes, no preamble, no second line.";

const RECAP_SYS =
  "You are Coach Joe writing the closing recap of a COMPLETED training block for an athlete's " +
  "block history. You get the program that was planned, the training actually logged during the " +
  "block, and the goal that was attached to it. Write 3-5 short plain-text sentences: what the " +
  "block focused on, what actually got trained (be honest about adherence — logged sessions vs " +
  "the plan), what visibly moved (weights, reps, PRs), and where the goal stands — HIT, CLOSE, or " +
  "STILL CHASING — so the next block can pick it up or retire it. Joe's voice: direct, warm, no " +
  "hype, no markdown, no headers. If there are no logs, say the block has no logged training and " +
  "leave it at that — never invent results.";

// Compact one-line-per-session digest of logged training inside a date range.
// Pure formatting (exported for tests); the AI never sees raw rows.
export function digestWorkouts(rows) {
  const lines = [];
  for (const w of Array.isArray(rows) ? rows : []) {
    const d = String(w.created_at || "").slice(0, 10);
    const exs = (w.parsed_data && Array.isArray(w.parsed_data.exercises)) ? w.parsed_data.exercises : [];
    const parts = exs.slice(0, 8).map((e) => {
      if (!e || !e.name) return null;
      const sr = e.sets && e.reps ? ` ${e.sets}x${e.reps}` : "";
      const wt = e.weight ? ` @${e.weight}${e.unit === "kg" ? "kg" : ""}` : "";
      return `${e.name}${sr}${wt}`;
    }).filter(Boolean);
    if (parts.length) lines.push(`${d}: ${parts.join(", ")}`);
  }
  const s = lines.join("\n");
  // Over the cap, keep the block's START and END — progress is first-vs-last
  // numbers; the middle is the least informative part of a long block.
  return s.length <= 3200 ? s : `${s.slice(0, 1600)}\n…\n${s.slice(-1600)}`;
}

// Close an open block row: stamp completed_at, then best-effort generate the
// recap from the logs that fell inside the block. The stamp must land even when
// the recap fails (recap is AI + extra reads; the close is the source of truth).
async function closeBlock(athleteId, row, deps) {
  const { sbRead, sbUpdateWhere, askClaude } = deps;
  const completedAt = new Date().toISOString();
  await sbUpdateWhere("program_history", `?id=eq.${row.id}`, { completed_at: completedAt });
  try {
    const from = row.applied_at ? `&created_at=gte.${encodeURIComponent(row.applied_at)}` : "";
    const [logs, goals] = await Promise.all([
      sbRead("workouts", `?athlete_id=eq.${athleteId}${from}&created_at=lte.${encodeURIComponent(completedAt)}&order=created_at.asc&limit=80&select=created_at,parsed_data`).catch(() => []),
      sbRead("athlete_goals", `?athlete_id=eq.${athleteId}&order=created_at.desc&limit=1`).catch(() => []),
    ]);
    const digest = digestWorkouts(logs);
    const goal = (Array.isArray(goals) && goals[0] && (goals[0].goal_text || goals[0].text)) || "";
    const user =
      `PROGRAM THE BLOCK RAN:\n${String(row.program_text || "").slice(0, 2500)}\n\n` +
      `GOAL ATTACHED TO THIS BLOCK: ${goal || "(none on file)"}\n\n` +
      `TRAINING LOGGED DURING THE BLOCK (${row.applied_at ? String(row.applied_at).slice(0, 10) : "?"} → ${completedAt.slice(0, 10)}):\n${digest || "(no logged sessions)"}`;
    const recap = await askClaude(RECAP_SYS, user, 400, [], "claude-sonnet-5", "program_summary");
    const text = (recap || "").trim();
    if (text) await sbUpdateWhere("program_history", `?id=eq.${row.id}`, { block_recap: text.slice(0, 1500) });
  } catch (e) { console.error("[history] block recap failed:", e?.message || e); }
}

// Fire-and-forget from every program_text save path (never await it on the save's
// critical path, never let it throw into the caller). deps = {sbRead, sbInsert,
// sbUpdateWhere, askClaude} from App.jsx.
export async function snapshotProgramHistory({ athleteId, text, source, forceNewBlock = false }, deps) {
  const { sbRead, sbInsert, askClaude } = deps;
  const t = (text || "").trim();
  const rows = await sbRead(
    "program_history",
    `?athlete_id=eq.${athleteId}&order=applied_at.desc&limit=1&select=id,program_text,completed_at,applied_at`
  );
  const latest = (Array.isArray(rows) && rows[0]) || null;

  // Program cleared → the block ended; close it (with recap), snapshot nothing.
  if (!t) {
    if (latest && !latest.completed_at) await closeBlock(athleteId, latest, deps);
    return;
  }

  if (latest && !latest.completed_at && (latest.program_text || "").trim() === t) return; // no-op save

  // A closed latest block never evolves in place — a save after "Start next
  // block" (or after the program was cleared) is a new chapter by definition.
  const isNewBlock = forceNewBlock || !latest || !!latest.completed_at
    || changedRatio(latest.program_text || "", t) >= NEW_BLOCK_RATIO;
  if (!isNewBlock) {
    // Same block, evolved text. applied_at and source stay those of the block's
    // first save; per-tweak provenance already lives in program_modifications.
    await deps.sbUpdateWhere("program_history", `?id=eq.${latest.id}`, { program_text: t });
    return;
  }

  if (latest && !latest.completed_at) await closeBlock(athleteId, latest, deps);

  // Haiku one-liner BEFORE the insert so the row lands complete in one write
  // (the gateway's insert doesn't return the new id). Best-effort: a summary
  // failure must never cost the snapshot itself.
  let summary = null;
  try {
    const line = await askClaude(SUMMARY_SYS, t.slice(0, 4000), 80, [], "claude-haiku-4-5", "program_summary");
    summary = (line || "").trim().split("\n")[0].slice(0, 120) || null;
  } catch (_) {}

  await sbInsert("program_history", {
    athlete_id: athleteId,
    program_text: t,
    source,
    block_summary: summary,
    // Explicit rather than relying on the DB default: the demo's mock store has
    // no column defaults, and ordering/date-ranges key off this everywhere.
    applied_at: new Date().toISOString(),
  });
}

// "Start next block": the athlete (or coach) declares the CURRENT block done
// without changing the program text — e.g. a 12-week program with two internal
// blocks, moving from block 1 to block 2. Closes the open row (recap and all)
// and opens a fresh row on the same text, so each block gets its own date
// range, logs window, and recap. Returns true when a transition happened.
export async function startNextBlock({ athleteId, programText }, deps) {
  const { sbRead, sbInsert } = deps;
  const rows = await sbRead(
    "program_history",
    `?athlete_id=eq.${athleteId}&order=applied_at.desc&limit=1&select=id,program_text,block_summary,completed_at,applied_at`
  );
  const latest = (Array.isArray(rows) && rows[0]) || null;
  if (!latest || latest.completed_at) return false;
  await closeBlock(athleteId, latest, deps);
  await sbInsert("program_history", {
    athlete_id: athleteId,
    program_text: (programText || latest.program_text || "").trim() || latest.program_text,
    source: "next_block",
    block_summary: latest.block_summary || null,
    applied_at: new Date().toISOString(),
  });
  return true;
}
