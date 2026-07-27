// ─── PROGRAM BUILDER UI (Phase C) ────────────────────────────────────────────
// The Builder subtab of the Program view, shared by athlete (self, unlocked
// only) and coach (per-athlete / team). Lazy-loaded (like coach.jsx) so the
// doctrine text + this UI never ride the normal boot. All rules/prompts live in
// src/programBuilder.js; this file is the interview loop + power-cell console.
//
// AI calls (all through /api/claude): interviewer + extractor use feature
// "program_build"; generation uses "program_draft"; scoped draft edits reuse
// the shipped "program_apply_change" contract (mergeGuard + lineDiff).
// Doctrine rides ONLY as the cached system prefix on these calls (cost rule).
//
// Session persistence contract (the beta-week lesson — three separate bugs came
// from getting this wrong):
// - park() NEVER clears draft_text: an interview park after a draft exists must
//   not nuke the draft (that's exactly how Will's first draft died).
// - With no initialDraft, the pane AUTO-RESUMES the latest open draft row from
//   the DB instead of opening a fresh (token-spending) interview.
// - Draft generation runs in a MODULE-scope registry (GEN): it keeps writing
//   after the pane unmounts and parks the finished draft straight to the DB, so
//   leaving the tab never loses a draft.
import { useState, useEffect, useMemo, useRef } from "react";
import { CA, CA_BTN, askClaude, sbDelete, sbInsert, sbRead, sbUpdateWhere, track } from "./App.jsx";
import { epley1RM, normalizeExName, toLbs } from "./grit.js";
import { lineDiff, mergeGuard } from "./programDiff.js";
import { parseTimeline } from "./programHistory.js";
import {
  cellsFor, blueprintPct, filledCount, precharge, pickTopic,
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
// Cached prefix = core + at most ONE topic. The prefix must be byte-identical
// across a session's calls to actually hit Anthropic's cache, so the topic is
// LOCKED at first pick (locking to first pick also keeps the router cheap).
const doctrineFor = (topic) => DOC_CORE + (topic && TOPICS[topic] ? `\n\n${TOPICS[topic]}` : "");

// Power-cell CSS — the GSA .hcell battery tube verbatim (coach.jsx never mounts
// GSA, so the Builder carries its own copy; identical class rules, so double
// injection on the athlete side is a no-op). bscan = the drafting screen's
// indeterminate charge sweep.
const BUILDER_CSS = `
.htube{height:20px;border:1.5px solid ${CA.line2};border-radius:6px;position:relative;overflow:hidden;background:linear-gradient(180deg,#070d18,#05080f);}
.htube::after{content:"";position:absolute;right:-4px;top:50%;transform:translateY(-50%);width:4px;height:9px;border-radius:2px;background:${CA.line2};}
.hfill{position:absolute;left:0;top:0;bottom:0;width:100%;transform:scaleX(0);transform-origin:left;background:linear-gradient(90deg,color-mix(in srgb,var(--tc) 62%,#000),var(--tc));box-shadow:0 0 calc(8px + var(--tb,0)*22px) var(--tc);filter:brightness(calc(1 + var(--tb,0)*0.9)) saturate(calc(1 + var(--tb,0)*0.4));transition:transform 1.05s cubic-bezier(.3,.8,.3,1);}
.hfill::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0 13px,transparent 13px 16px);opacity:.45;}
.hcell.go .hfill{transform:scaleX(var(--pct,0));}
@keyframes bscan{0%{transform:translateX(-105%);}100%{transform:translateX(305%);}}
.bscan{position:absolute;top:0;bottom:0;width:34%;background:linear-gradient(90deg,transparent,${CA.accent},transparent);box-shadow:0 0 18px ${CA.accent};animation:bscan 1.5s ease-in-out infinite;}
@keyframes bfade{0%{opacity:0;transform:translateY(3px);}12%{opacity:1;transform:none;}88%{opacity:1;}100%{opacity:0;}}
.bline{animation:bfade 2.6s ease-in-out both;}
@media (prefers-reduced-motion: reduce){.hcell.go .hfill{transform:scaleX(var(--pct,0))!important;transition:none!important;}.bscan{animation:none;left:33%;}.bline{animation:none;}}
`;

const nowIso = () => new Date().toISOString();

// ── Background draft generation ───────────────────────────────────────────────
// Keyed by draft row id. The job outlives the pane: it finishes the AI calls,
// parks the finished draft to the row (status "draft"), and leaves its result
// here for whichever mount looks next. Entries are deleted once a pane syncs
// them (the DB row is the durable copy).
const GEN = new Map(); // id -> {status:"running"|"done"|"error", text, promise}

function startGeneration(id, { cached, sys, userPrompt, blueprint, cells }) {
  if (GEN.get(id)?.status === "running") return GEN.get(id);
  const entry = { status: "running", text: "", promise: null };
  entry.promise = (async () => {
    try {
      let text = await askClaude({ cached, dynamic: sys }, userPrompt, 3500, [], "claude-sonnet-5", "program_draft");
      let check = validateDraft(text, { blueprint, cells });
      if (!check.ok) {
        // one corrective retry with the exact failures — the harness asserts the same rules
        text = await askClaude({ cached, dynamic: sys },
          userPrompt + `\n\nYour previous attempt failed these checks — fix ALL of them:\n- ${check.problems.join("\n- ")}`,
          3500, [], "claude-sonnet-5", "program_draft");
        check = validateDraft(text, { blueprint, cells });
      }
      if (!check.ok) console.error("[builder] draft failed validation after retry:", check.problems);
      entry.text = String(text || "").trim();
      // Park straight to the DB — this is what makes leaving the tab safe.
      await sbUpdateWhere("program_drafts", `?id=eq.${id}`, { status: "draft", draft_text: entry.text, updated_at: nowIso() });
      entry.status = "done";
    } catch (e) {
      console.error("[builder] background draft failed:", e?.message || e);
      entry.status = "error";
    }
  })();
  GEN.set(id, entry);
  return entry;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// Compact "CURRENT NUMBERS" line from logged history: best estimated 1RM per
// lift, top 6. This is what lets Joe judge whether a goal and a timeline are
// realistic together (275→315 bench is not a 3-week block) and base %1RM loads
// on real numbers instead of vibes.
function bestNumbersLine(rows) {
  const best = {};
  for (const w of Array.isArray(rows) ? rows : []) {
    for (const e of w?.parsed_data?.exercises || []) {
      if (!e?.name || !e.weight || !e.reps) continue;
      const est = epley1RM(toLbs(Number(e.weight), e.unit), Number(e.reps));
      if (!est || !Number.isFinite(est)) continue;
      const k = normalizeExName(e.name);
      if (!best[k] || est > best[k].est) best[k] = { name: e.name, est };
    }
  }
  return Object.values(best).sort((a, b) => b.est - a.est).slice(0, 6)
    .map(x => `${x.name} ~${Math.round(x.est)} lb`).join(", ");
}

const DRAFTING_LINES = [
  "Reading your blueprint…",
  "Checking the schedule against the doctrine…",
  "Blocking out the week…",
  "Writing week 1, day by day…",
  "Setting loads and progressions…",
  "Adding every warm-up and cool-down…",
  "Final pass — checking the details…",
];

export function ProgramBuilderPane({ athlete, viewer = "athlete", coachId = null, initialDraft = null, rebuildFrom = null, locked = false, workoutHistory = [], onSaveToProgram, onParked }) {
  // Individuals get ONE version — the full interview. short/quick are coach
  // tools (draft today's session / a one-week plan fast for a roster).
  const scopes = viewer === "coach" ? ["full", "short", "quick"] : ["full"];
  const [scope, setScope] = useState(() => {
    const s = initialDraft?.scope || "full";
    return scopes.includes(s) ? s : "full";
  });
  const [blueprint, setBlueprint] = useState(initialDraft?.blueprint || null); // null until precharge/resume
  const [transcript, setTranscript] = useState(initialDraft?.transcript || []);
  const [phase, setPhase] = useState(initialDraft?.status === "draft" ? "draft" : initialDraft ? "interview" : "boot"); // boot|interview|drafting|draft|saved
  const [draftText, setDraftText] = useState(initialDraft?.draft_text || "");
  const [chips, setChips] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [go, setGo] = useState(false);           // benchGo idiom: cells charge shortly after mount
  const [editReq, setEditReq] = useState("");     // "Tell Joe what to change" input
  const [confirmSave, setConfirmSave] = useState(null); // diff view before Save to My Program
  const [resetArm, setResetArm] = useState(false);
  const [draftLine, setDraftLine] = useState(0);  // rotating status line while drafting
  const topicRef = useRef(initialDraft?.blueprint?.__topic || null); // locked at first pick (cache-identity)
  const draftIdRef = useRef(initialDraft?.id || null);
  const parkChain = useRef(Promise.resolve());    // serializes parks → exactly one row per session
  const bootRef = useRef({ goals: [], lastBlock: null }); // kept for reset re-precharge
  const scrollRef = useRef(null);
  const cells = cellsFor(viewer, scope);
  const pct = blueprint ? blueprintPct(blueprint, cells) : 0;
  const numbers = useMemo(() => bestNumbersLine(workoutHistory), [workoutHistory]);

  useEffect(() => { const t = setTimeout(() => setGo(true), 80); return () => clearTimeout(t); }, []);
  useEffect(() => { scrollRef.current?.scrollTo?.(0, 1e9); }, [transcript, phase]);
  useEffect(() => {
    if (phase !== "drafting") { setDraftLine(0); return; }
    const t = setInterval(() => setDraftLine(l => (l + 1) % DRAFTING_LINES.length), 2600);
    return () => clearInterval(t);
  }, [phase]);

  // Pick up a background generation for the draft this pane owns.
  const attachGen = (id) => {
    const g = GEN.get(id);
    if (!g) return false;
    const sync = () => {
      if (draftIdRef.current !== id) return;
      const e = GEN.get(id);
      GEN.delete(id);
      if (e?.status === "done") { setDraftText(e.text); setPhase("draft"); }
      else if (e?.status === "error") { setErr("Draft didn't come through — hit DRAFT IT again."); setPhase("interview"); }
    };
    if (g.status === "running") { setPhase("drafting"); g.promise.then(sync, sync); }
    else sync();
    return true;
  };

  // ── Boot: resume the open session if one exists, else pre-charge fresh ──────
  useEffect(() => {
    if (blueprint) { // resumed via initialDraft — just check for a running generation
      if (phase === "boot") setPhase("interview");
      if (draftIdRef.current) attachGen(draftIdRef.current);
      return;
    }
    let on = true;
    (async () => {
      // "Rebuild from this": a chosen past block IS the hand-off — skip the
      // latest-block fetch and anchor the interview on the block they picked.
      let lastBlock = rebuildFrom, goals = [];
      let resumeRow = null;
      const ownerFilter = viewer === "coach" ? "coach" : "athlete";
      if (!rebuildFrom) {
        // Auto-resume: the latest open session is THE session. Every parked turn
        // is in the row, so nothing regenerates and no tokens are re-spent.
        try {
          const r = await sbRead("program_drafts", `?athlete_id=eq.${athlete.id}&owner_type=eq.${ownerFilter}&status=in.("interview","draft")&order=updated_at.desc&limit=1&select=*`);
          resumeRow = (Array.isArray(r) && r[0]) || null;
        } catch (_) {}
      }
      if (!on) return;
      if (resumeRow && resumeRow.blueprint) {
        draftIdRef.current = resumeRow.id;
        topicRef.current = resumeRow.blueprint.__topic || null;
        if (scopes.includes(resumeRow.scope)) setScope(resumeRow.scope);
        setBlueprint(resumeRow.blueprint);
        setTranscript(Array.isArray(resumeRow.transcript) ? resumeRow.transcript : []);
        setDraftText(resumeRow.draft_text || "");
        if (!attachGen(resumeRow.id)) setPhase(resumeRow.status === "draft" && resumeRow.draft_text ? "draft" : "interview");
        if (!(Array.isArray(resumeRow.transcript) && resumeRow.transcript.length)) openInterview(resumeRow.blueprint, scopes.includes(resumeRow.scope) ? resumeRow.scope : scope);
        return;
      }
      if (!lastBlock) {
        try {
          const h = await sbRead("program_history", `?athlete_id=eq.${athlete.id}&order=applied_at.desc&limit=1&select=block_summary,block_recap,program_text,applied_at`);
          lastBlock = (Array.isArray(h) && h[0]) || null;
        } catch (_) {}
      }
      try {
        const g = await sbRead("athlete_goals", `?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=1`);
        goals = Array.isArray(g) ? g : [];
      } catch (_) {}
      if (!on) return;
      bootRef.current = { goals, lastBlock: rebuildFrom ? null : lastBlock };
      const bp = precharge({ athlete, goals, lastBlock, viewer });
      if (rebuildFrom) {
        const name = rebuildFrom.block_summary || (rebuildFrom.program_text || "").split("\n").find(l => l.trim()) || "a previous block";
        bp.handoff = { value: `REBUILD of a past block: ${name}. Its full text is the starting template — keep what worked, change what the interview surfaces.`, source: "known" };
      }
      setBlueprint(bp);
      setPhase("interview");
      openInterview(bp, scope);
    })();
    return () => { on = false; };
  }, [athlete.id]);

  const doctrine = () => {
    if (!topicRef.current) topicRef.current = pickTopic({ blueprint: blueprint || {}, athlete, viewer, scope }) || "none";
    return doctrineFor(topicRef.current === "none" ? null : topicRef.current);
  };

  const transcriptText = (t) => t.slice(-12).map(m => `${m.role === "user" ? (viewer === "coach" ? "Coach" : "Athlete") : "Joe"}: ${m.content}`).join("\n");

  // ── Persistence: park after every assistant turn (crash-safe interview) ────
  // Serialized on parkChain (no double-insert races) and returns the row id.
  // dText=null means "no new draft text" — an existing draft_text is NEVER
  // overwritten with null.
  const park = (bp, t, status, dText) => {
    const run = async () => {
      const row = {
        owner_type: viewer, title: bp?.goal?.value ? bp.goal.value.slice(0, 60) : "Builder session",
        status, blueprint: { ...bp, __topic: topicRef.current }, transcript: t,
        provisional_goal: bp?.goal?.value || bp?.goal?.pending || null,
        scope, updated_at: nowIso(),
      };
      if (dText != null) row.draft_text = dText;
      try {
        if (draftIdRef.current) {
          await sbUpdateWhere("program_drafts", `?id=eq.${draftIdRef.current}`, row);
        } else {
          const ins = viewer === "coach"
            ? { ...row, coach_id: coachId, athlete_id: athlete.id }
            : { ...row, athlete_id: athlete.id };
          const res = await sbInsert("program_drafts", ins);
          const id = Array.isArray(res) && res[0]?.id;
          if (id) draftIdRef.current = id;
          else {
            // Gateway inserts don't return rows — recover the id so background
            // generation and future parks target the right row.
            const back = await sbRead("program_drafts", `?athlete_id=eq.${athlete.id}&owner_type=eq.${viewer}&status=in.("interview","draft")&order=updated_at.desc&limit=1&select=id`).catch(() => []);
            if (Array.isArray(back) && back[0]?.id) draftIdRef.current = back[0].id;
          }
        }
      } catch (e) { console.error("[builder] park failed:", e?.message || e); }
      return draftIdRef.current;
    };
    parkChain.current = parkChain.current.then(run, run);
    return parkChain.current;
  };

  // ── Interview turns ────────────────────────────────────────────────────────
  const openInterview = async (bp, sc) => {
    setBusy(true); setErr("");
    try {
      const sys = interviewerSystem({ cells: cellsFor(viewer, sc), blueprint: bp, scope: sc, viewer, name: athlete.name, today: todayStr(), numbers });
      const raw = await askClaude({ cached: doctrine(), dynamic: sys }, "Open the interview: greet in one short line, then your first question.", 400, [], "claude-sonnet-5", "program_build");
      const { text, chips: ch } = parseInterviewerReply(raw);
      const t1 = [{ role: "assistant", content: text }];
      setTranscript(t1);
      setChips(ch);
      // Park the opener too: switching away and back must never re-spend this call.
      park(bp, t1, "interview", null);
    } catch (e) { setErr("Couldn't reach Joe — try again in a sec."); }
    setBusy(false);
  };

  const send = async (msgArg) => {
    const msg = (typeof msgArg === "string" ? msgArg : input).trim();
    if (!msg || busy || !blueprint) return;
    setInput(""); setChips([]); setBusy(true); setErr("");
    const t1 = [...transcript, { role: "user", content: msg }];
    setTranscript(t1);
    const wasDone = blueprintPct(blueprint, cells) === 100;
    try {
      // 1) extractor — can fill ANY cell from this one message (and confirm
      // pending profile values: "yes, still 4 days" charges the cell).
      const pendings = Object.fromEntries(cells.map(c => [c.key, blueprint[c.key]?.pending || null]).filter(([, v]) => v));
      const ex = parseExtraction(await askClaude(
        extractorSystem(cells),
        `Today: ${todayStr()}\nCurrent blueprint (JSON): ${JSON.stringify(Object.fromEntries(cells.map(c => [c.key, blueprint[c.key]?.value || null])))}\nPending values awaiting confirmation (JSON): ${JSON.stringify(pendings)}\nMessage: "${msg}"`,
        500, [], "claude-haiku-4-5", "program_build"
      ));
      const bp = { ...blueprint };
      for (const [k, v] of Object.entries(ex.cells)) {
        if (!cells.find(c => c.key === k)) continue;
        if (k === "goal" && scope !== "quick") {
          // SMART gate: the goal cell only fills when specific+measurable+timebound.
          if (ex.smart?.ok) bp.goal = { value: v, source: "interview" };
          else bp.goal = { value: "", source: "interview", pending: v, note: ex.smart?.why || "needs a number and a date" };
        } else {
          bp[k] = { value: v, source: "interview" };
        }
      }
      if (ex.notes) bp.__notes = [...(Array.isArray(bp.__notes) ? bp.__notes : []), ex.notes].slice(-12);
      setBlueprint(bp);
      const done = blueprintPct(bp, cells) === 100;
      if (done && !wasDone) {
        const closing = "That's everything I need — the blueprint's at 100%. Hit ⚡ DRAFT IT when you're ready. Or keep going: I hold onto everything you tell me, and the more you give me about how you want this block to look and feel, the better it comes out.";
        const t2 = [...t1, { role: "assistant", content: closing }];
        setTranscript(t2); setChips([]);
        park(bp, t2, "interview", null);
      } else {
        // 2) interviewer — next question (or, at 100%, a brief "noted" ack).
        const sys = interviewerSystem({ cells, blueprint: bp, scope, viewer, name: athlete.name, complete: done, today: todayStr(), numbers });
        const raw = await askClaude({ cached: doctrine(), dynamic: sys }, `Conversation so far:\n${transcriptText(t1)}\n\nContinue with your next single question.`, 400, [], "claude-sonnet-5", "program_build");
        const { text, chips: ch } = parseInterviewerReply(raw);
        const t2 = [...t1, { role: "assistant", content: text }];
        setTranscript(t2); setChips(ch);
        park(bp, t2, "interview", null);
      }
    } catch (e) { setErr("Couldn't reach Joe — your answers are safe, try again."); }
    setBusy(false);
  };

  // ── Draft generation (hard rule: never below 100%) ─────────────────────────
  // The pane only STARTS the job — GEN owns it from there. Leaving the tab (or
  // the app) doesn't stop it; the finished draft parks itself to the row.
  const generate = async () => {
    if (busy || pct !== 100) return;
    setBusy(true); setErr(""); setPhase("drafting");
    try {
      track("builder_draft_generate", "ai");
      const id = await park(blueprint, transcript, "interview", null);
      if (!id) throw new Error("no draft row");
      const sys = drafterSystem({ viewer });
      // A rebuild carries the old block's full text as the starting template.
      let userPrompt = draftUser({ blueprint, cells, athlete, numbers });
      if (rebuildFrom?.program_text) userPrompt += `\n\nPREVIOUS BLOCK (rebuild starting template — keep its working structure unless the blueprint says otherwise):\n${rebuildFrom.program_text.slice(0, 3000)}`;
      startGeneration(id, { cached: doctrine(), sys, userPrompt, blueprint, cells });
      attachGen(id);
    } catch (e) { setErr("Draft didn't come through — try DRAFT IT again."); setPhase("interview"); }
    setBusy(false);
  };

  // ── Draft editing: hand-edit OR scoped NL edit (Quick Log contract) ────────
  const tellJoe = async () => {
    const req = editReq.trim();
    if (!req || busy) return;
    setBusy(true); setErr("");
    try {
      const sys = `You are applying ONE change to a training program draft for its owner. Return ONLY the complete updated program text — no preamble, no fences. Make ONLY the change requested; preserve every other line character-for-character; keep the format.`;
      const raw = await askClaude(sys, `CURRENT DRAFT:\n${draftText}\n\nREQUESTED CHANGE: ${req}`, 4000, [], "claude-sonnet-5", "program_apply_change");
      const guard = mergeGuard(draftText, raw);
      if (!guard.ok) { setErr("Couldn't make that change cleanly — say it more specifically."); }
      else {
        setDraftText(guard.text); setEditReq("");
        park(blueprint, transcript, "draft", guard.text);
      }
    } catch (e) { setErr("Couldn't make that change — try again."); }
    setBusy(false);
  };

  const saveToProgram = async () => {
    if (busy || !confirmSave) return;
    setBusy(true); setErr("");
    try {
      // The blueprint's timeline rides along so the save can stamp the new
      // block's start (applied_at) and planned end (ends_at).
      await onSaveToProgram(draftText, parseTimeline(blueprint?.timeline?.value));
      if (draftIdRef.current) await sbUpdateWhere("program_drafts", `?id=eq.${draftIdRef.current}`, { status: "applied", updated_at: nowIso() }).catch(() => {});
      track("builder_draft_applied", "ai");
      setConfirmSave(null);
      setPhase("saved");
    } catch (e) { setErr("Couldn't save that — try again in a sec."); }
    setBusy(false);
  };

  // ── Full reset: wipe this session, re-charge from fresh data ───────────────
  // Everything pre-filled returns to unconfirmed pending; the next program
  // starts from new everything. Also the exit door for the "saved" state.
  const resetAll = async () => {
    if (busy) return;
    setBusy(true); setErr(""); setResetArm(false);
    const id = draftIdRef.current;
    draftIdRef.current = null;
    if (id) { GEN.delete(id); await sbDelete("program_drafts", `?id=eq.${id}&status=in.("interview","draft")`).catch(() => {}); }
    topicRef.current = null;
    setTranscript([]); setChips([]); setDraftText(""); setConfirmSave(null); setInput(""); setEditReq("");
    // Re-read goals + last block so a just-finished block hands off correctly.
    let { goals, lastBlock } = bootRef.current;
    try {
      const [g, h] = await Promise.all([
        sbRead("athlete_goals", `?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=1`).catch(() => []),
        sbRead("program_history", `?athlete_id=eq.${athlete.id}&order=applied_at.desc&limit=1&select=block_summary,block_recap,program_text,applied_at`).catch(() => []),
      ]);
      goals = Array.isArray(g) ? g : goals;
      lastBlock = (Array.isArray(h) && h[0]) || lastBlock;
      bootRef.current = { goals, lastBlock };
    } catch (_) {}
    const bp = precharge({ athlete, goals, lastBlock, viewer });
    setBlueprint(bp);
    setPhase("interview");
    setBusy(false);
    openInterview(bp, scope);
  };

  // ── UI atoms ───────────────────────────────────────────────────────────────
  const mono = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };
  const subhead = { ...mono, fontSize: 9, letterSpacing: 2, color: CA.muted, textTransform: "uppercase" };
  const miniBtn = (active, color = CA.accent) => ({ background: active ? `${color}20` : "transparent", border: `1px solid ${active ? color : CA.border}`, color: active ? color : CA.muted, borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'DM Sans'" });
  const priBtn = { background: CA_BTN, color: "#02040c", border: "none", borderRadius: 9, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Bebas Neue'", letterSpacing: 1 };
  const cellTube = (charged, pending) => (
    <div className={`hcell${go ? " go" : ""}`}>
      <div className="htube" style={{ height: 10 }}>
        <div className="hfill" style={{ "--pct": charged ? 1 : pending ? 0.45 : 0, "--tc": pending && !charged ? CA.amber : CA.accent, "--tb": charged ? 0.55 : 0.2 }} />
      </div>
    </div>
  );

  if (viewer === "athlete" && locked) {
    return (
      <div style={{ color: CA.muted2, fontSize: 13, lineHeight: 1.7, padding: "24px 4px", textAlign: "center" }}>
        🔒 Your coach owns your program, so the Builder is their console for you. Want something changed? Use <b>Request a change</b> on the My Program tab.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%", minHeight: 0 }}>
      <style>{BUILDER_CSS}</style>

      {/* ── Blueprint console: master cell + sub-cells ── */}
      <div style={{ border: `1px solid ${CA.border}`, borderRadius: 12, padding: 13, background: "rgba(5,10,24,.55)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
          <span style={{ fontFamily: "'Bebas Neue'", fontSize: 15, letterSpacing: 1.5, color: CA.text }}>BLUEPRINT</span>
          <span title="The Builder is brand new — double-check what Joe writes and tell us if something feels off."
            style={{ ...mono, fontSize: 7.5, letterSpacing: 1, color: CA.amber, border: `1px solid ${CA.amber}88`, borderRadius: 4, padding: "1px 4px" }}>BETA</span>
          <span style={{ ...mono, fontSize: 11, color: pct === 100 ? CA.led : CA.accent }}>{pct}%</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
            {scopes.length > 1 && scopes.map(s => (
              <button key={s} disabled={transcript.length > 1} onClick={() => { setScope(s); if (blueprint) openInterview(blueprint, s); }}
                title={transcript.length > 1 ? "Scope locks once the interview starts" : ""}
                style={{ ...miniBtn(scope === s), padding: "2px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1, opacity: transcript.length > 1 && scope !== s ? 0.4 : 1 }}>
                {s}
              </button>
            ))}
            {phase !== "boot" && phase !== "drafting" && (resetArm ? (
              <>
                <button onClick={resetAll} disabled={busy} style={{ ...miniBtn(true, CA.red), padding: "2px 8px", fontSize: 9.5 }}>Really reset</button>
                <button onClick={() => setResetArm(false)} style={{ ...miniBtn(false), padding: "2px 8px", fontSize: 9.5 }}>Keep</button>
              </>
            ) : (
              <button onClick={() => setResetArm(true)} title="Wipe this interview and start over — every pre-filled bar goes back to unconfirmed"
                style={{ ...miniBtn(false), padding: "2px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1 }}>
                ↺ Reset
              </button>
            ))}
          </span>
        </div>
        <div className={`hcell${go ? " go" : ""}`} style={{ marginBottom: 10 }}>
          <div className="htube">
            <div className="hfill" style={{ "--pct": pct / 100, "--tc": pct === 100 ? CA.led : CA.accent, "--tb": pct === 100 ? 0.75 : pct / 130 }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(118px,1fr))", gap: "8px 12px" }}>
          {cells.map(c => {
            const b = blueprint?.[c.key];
            const chargedCell = !!b?.value;
            return (
              <div key={c.key} title={`${c.why}${b?.note ? `\n(${b.note})` : ""}${!chargedCell && b?.pending ? `\nOn file: ${b.pending} — Joe will confirm it with you.` : ""}`}>
                <div style={{ display: "flex", gap: 5, alignItems: "baseline", marginBottom: 3 }}>
                  <span style={{ fontSize: 10.5, color: chargedCell ? CA.text : CA.muted, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                  {b?.source === "known" && chargedCell && <span style={{ ...mono, fontSize: 7.5, color: CA.muted }}>KNOWN</span>}
                </div>
                {cellTube(chargedCell, !!b?.pending)}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Saved state ── */}
      {phase === "saved" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ border: `1px solid ${CA.green}55`, background: `${CA.green}0d`, borderRadius: 12, padding: 16, color: CA.text, fontSize: 13, lineHeight: 1.7 }}>
            ✅ Saved to {viewer === "coach" ? `${athlete.name}'s program` : "My Program"} — it drives every session from here. The old block is archived under Past Blocks.
          </div>
          <div>
            <button onClick={resetAll} style={priBtn}>START A NEW PROGRAM</button>
          </div>
        </div>
      )}

      {/* ── Drafting: Joe writes in the background — leaving is safe ── */}
      {phase === "drafting" && (
        <div style={{ border: `1px solid ${CA.border}`, borderRadius: 12, padding: "22px 18px", background: "rgba(5,10,24,.55)", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontFamily: "'Bebas Neue'", fontSize: 17, letterSpacing: 2, color: CA.text }}>⚡ JOE'S WRITING YOUR BLOCK</div>
          <div className="htube" style={{ height: 14 }}>
            <div className="bscan" />
          </div>
          <div key={draftLine} className="bline" style={{ ...mono, fontSize: 12, color: CA.accent, minHeight: 18 }}>{DRAFTING_LINES[draftLine]}</div>
          <div style={{ color: CA.muted, fontSize: 11.5, lineHeight: 1.6 }}>
            You don't have to watch — leave this tab and Joe keeps writing. The finished draft lands in <b>Drafts</b>.
          </div>
        </div>
      )}

      {/* ── Draft view ── */}
      {phase === "draft" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
          {confirmSave ? (
            <div style={{ overflowY: "auto" }}>
              <div style={subhead}>Review — replaces the current program</div>
              <div style={{ border: `1px solid ${CA.border}`, borderRadius: 10, background: "rgba(5,10,24,.5)", padding: "10px 12px", maxHeight: 260, overflowY: "auto", margin: "8px 0 10px" }}>
                {confirmSave.map((d, i) => (
                  <div key={i} style={{ ...mono, fontSize: 11.5, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", color: d.type === "add" ? CA.green : d.type === "del" ? CA.red : CA.muted, opacity: d.type === "same" ? 0.55 : 1 }}>
                    {d.type === "add" ? "+ " : d.type === "del" ? "− " : "  "}{d.text || " "}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveToProgram} disabled={busy} style={{ ...priBtn, background: busy ? CA.navy3 : CA_BTN, color: busy ? CA.muted : "#02040c", cursor: busy ? "wait" : "pointer" }}>{busy ? "SAVING…" : "REPLACE PROGRAM"}</button>
                <button onClick={() => setConfirmSave(null)} style={miniBtn(false)}>Back to draft</button>
              </div>
            </div>
          ) : (
            <>
              <div style={subhead}>Draft — edit by hand, or tell Joe what to change</div>
              <textarea value={draftText} onChange={e => setDraftText(e.target.value)} rows={14}
                style={{ flex: 1, minHeight: 180, width: "100%", boxSizing: "border-box", background: "rgba(58,123,255,0.03)", border: `1px solid ${CA.line2}`, borderRadius: 10, padding: "10px 12px", color: CA.text, fontSize: 12, outline: "none", resize: "vertical", lineHeight: 1.7, ...mono }} />
              <div style={{ display: "flex", gap: 6 }}>
                <input value={editReq} onChange={e => setEditReq(e.target.value)} onKeyDown={e => { if (e.key === "Enter") tellJoe(); }}
                  placeholder='Tell Joe what to change — "swap day 2 to dumbbells"'
                  style={{ flex: 1, background: CA.navy3, border: `1px solid ${CA.border}`, borderRadius: 9, padding: "8px 11px", color: CA.text, fontSize: 12, outline: "none", fontFamily: "'DM Sans'" }} />
                <button onClick={tellJoe} disabled={busy || !editReq.trim()} style={miniBtn(!!editReq.trim())}>{busy ? "…" : "Apply"}</button>
              </div>
              {err && <div style={{ color: CA.red, fontSize: 11.5 }}>{err}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setConfirmSave(lineDiff(athlete.program_text || "", draftText).filter(x => x.type !== "same" || x.text.trim()))}
                  disabled={busy || !draftText.trim()} style={priBtn}>
                  SAVE TO {viewer === "coach" ? "THEIR PROGRAM" : "MY PROGRAM"}
                </button>
                <button onClick={async () => { await park(blueprint, transcript, "draft", draftText); onParked && onParked(); }} disabled={busy} style={miniBtn(false)}>Send to Drafts</button>
                <button onClick={() => setPhase("interview")} disabled={busy} style={miniBtn(false)}>Back to interview</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Interview view ── */}
      {(phase === "interview" || phase === "boot") && (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, gap: 10 }}>
          <div ref={scrollRef} style={{ flex: 1, minHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 9, paddingRight: 2 }}>
            {phase === "boot" && <div style={{ color: CA.muted, fontSize: 12, ...mono }}>▮▯▯ charging blueprint…</div>}
            {transcript.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.role === "user" ? `${CA.accent}18` : CA.navy3, border: `1px solid ${m.role === "user" ? `${CA.accent}44` : CA.border}`, borderRadius: 11, padding: "8px 12px", color: CA.text, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {m.content}
              </div>
            ))}
            {busy && <div style={{ color: CA.muted, fontSize: 11, ...mono }}>Joe's thinking…</div>}
            {err && <div style={{ color: CA.red, fontSize: 11.5 }}>{err}{transcript.length === 0 && <button onClick={() => openInterview(blueprint, scope)} style={{ ...miniBtn(true), marginLeft: 8 }}>Retry</button>}</div>}
          </div>
          {chips.length > 0 && !busy && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
              {chips.map((c, i) => <button key={i} onClick={() => send(c)} style={miniBtn(true, CA.accent)}>{c}</button>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} disabled={busy || phase === "boot"}
              placeholder="Answer Joe…"
              style={{ flex: 1, background: CA.navy3, border: `1px solid ${CA.border}`, borderRadius: 10, padding: "10px 12px", color: CA.text, fontSize: 13, outline: "none", fontFamily: "'DM Sans'" }} />
            <button onClick={() => send()} disabled={busy || !input.trim()} style={{ ...miniBtn(!!input.trim()), padding: "8px 14px" }}>Send</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
            {pct === 100 && (
              <button onClick={generate} disabled={busy}
                style={{ ...priBtn, padding: "9px 18px", boxShadow: `0 0 14px ${CA_GLOW_SAFE}` }}>
                ⚡ DRAFT IT
              </button>
            )}
            {draftText.trim() && pct === 100 && !busy && (
              <button onClick={() => setPhase("draft")} style={miniBtn(false)}>View draft</button>
            )}
            {pct < 100 && <span style={{ color: CA.muted, fontSize: 10.5 }}>Joe drafts only from a 100% blueprint — {cells.length - filledCount(blueprint || {}, cells)} cell{cells.length - filledCount(blueprint || {}, cells) !== 1 ? "s" : ""} to go.</span>}
            <button onClick={async () => { await park(blueprint, transcript, draftText ? "draft" : "interview", draftText || null); onParked && onParked(); }} disabled={busy || !blueprint || transcript.length === 0}
              style={{ ...miniBtn(false), marginLeft: "auto" }}>
              Save & exit → Drafts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Glow color for the DRAFT IT button (CA_GLOW lives in App.jsx but isn't in the
// import list above to keep the mirrored-file diff tight — same value).
const CA_GLOW_SAFE = "rgba(58,123,255,.5)";
