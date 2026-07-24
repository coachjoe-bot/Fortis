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
// gets its own block.
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

// Fire-and-forget from every program_text save path (never await it on the save's
// critical path, never let it throw into the caller). deps = {sbRead, sbInsert,
// sbUpdateWhere, askClaude} from App.jsx.
export async function snapshotProgramHistory({ athleteId, text, source, forceNewBlock = false }, deps) {
  const { sbRead, sbInsert, sbUpdateWhere, askClaude } = deps;
  const t = (text || "").trim();
  const rows = await sbRead(
    "program_history",
    `?athlete_id=eq.${athleteId}&order=applied_at.desc&limit=1&select=id,program_text,completed_at`
  );
  const latest = (Array.isArray(rows) && rows[0]) || null;

  // Program cleared → the block ended; close it, snapshot nothing.
  if (!t) {
    if (latest && !latest.completed_at) {
      await sbUpdateWhere("program_history", `?id=eq.${latest.id}`, { completed_at: new Date().toISOString() });
    }
    return;
  }

  if (latest && (latest.program_text || "").trim() === t) return; // no-op save

  const isNewBlock = forceNewBlock || !latest || changedRatio(latest.program_text || "", t) >= NEW_BLOCK_RATIO;
  if (!isNewBlock) {
    // Same block, evolved text. applied_at and source stay those of the block's
    // first save; per-tweak provenance already lives in program_modifications.
    await sbUpdateWhere("program_history", `?id=eq.${latest.id}`, { program_text: t });
    return;
  }

  if (latest && !latest.completed_at) {
    await sbUpdateWhere("program_history", `?id=eq.${latest.id}`, { completed_at: new Date().toISOString() });
  }

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
  });
}
