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
import { useState, useEffect, useRef } from "react";
import { CA, askClaude, sbInsert, sbRead, sbUpdateWhere, track } from "./App.jsx";
import { lineDiff, mergeGuard } from "./programDiff.js";
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
// injection on the athlete side is a no-op).
const BUILDER_CSS = `
.htube{height:20px;border:1.5px solid ${CA.line2};border-radius:6px;position:relative;overflow:hidden;background:linear-gradient(180deg,#070d18,#05080f);}
.htube::after{content:"";position:absolute;right:-4px;top:50%;transform:translateY(-50%);width:4px;height:9px;border-radius:2px;background:${CA.line2};}
.hfill{position:absolute;left:0;top:0;bottom:0;width:100%;transform:scaleX(0);transform-origin:left;background:linear-gradient(90deg,color-mix(in srgb,var(--tc) 62%,#000),var(--tc));box-shadow:0 0 calc(8px + var(--tb,0)*22px) var(--tc);filter:brightness(calc(1 + var(--tb,0)*0.9)) saturate(calc(1 + var(--tb,0)*0.4));transition:transform 1.05s cubic-bezier(.3,.8,.3,1);}
.hfill::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0 13px,transparent 13px 16px);opacity:.45;}
.hcell.go .hfill{transform:scaleX(var(--pct,0));}
@media (prefers-reduced-motion: reduce){.hcell.go .hfill{transform:scaleX(var(--pct,0))!important;transition:none!important;}}
`;

const nowIso = () => new Date().toISOString();

export function ProgramBuilderPane({ athlete, viewer = "athlete", coachId = null, initialDraft = null, locked = false, onSaveToProgram, onParked }) {
  // Athlete quick-builds stay in chat (Field Mode) — quick is coach-only.
  const scopes = viewer === "coach" ? ["full", "short", "quick"] : ["full", "short"];
  const [scope, setScope] = useState(initialDraft?.scope || "full");
  const [blueprint, setBlueprint] = useState(initialDraft?.blueprint || null); // null until precharge
  const [transcript, setTranscript] = useState(initialDraft?.transcript || []);
  const [draftId, setDraftId] = useState(initialDraft?.id || null);
  const [phase, setPhase] = useState(initialDraft?.status === "draft" ? "draft" : initialDraft ? "interview" : "boot"); // boot|interview|drafting|draft
  const [draftText, setDraftText] = useState(initialDraft?.draft_text || "");
  const [chips, setChips] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [go, setGo] = useState(false);           // benchGo idiom: cells charge shortly after mount
  const [editReq, setEditReq] = useState("");     // "Tell Joe what to change" input
  const [confirmSave, setConfirmSave] = useState(null); // diff view before Save to My Program
  const topicRef = useRef(initialDraft?.blueprint?.__topic || null); // locked at first pick (cache-identity)
  const scrollRef = useRef(null);
  const cells = cellsFor(viewer, scope);
  const pct = blueprint ? blueprintPct(blueprint, cells) : 0;

  useEffect(() => { const t = setTimeout(() => setGo(true), 80); return () => clearTimeout(t); }, []);
  useEffect(() => { scrollRef.current?.scrollTo?.(0, 1e9); }, [transcript, phase]);

  // ── Boot: pre-charge from known data, then open the interview ──────────────
  useEffect(() => {
    if (blueprint) { if (phase === "boot") setPhase("interview"); return; }
    let on = true;
    (async () => {
      let lastBlock = null, goals = [];
      try {
        const h = await sbRead("program_history", `?athlete_id=eq.${athlete.id}&order=applied_at.desc&limit=1&select=block_summary,program_text,applied_at`);
        lastBlock = (Array.isArray(h) && h[0]) || null;
      } catch (_) {}
      try {
        const g = await sbRead("athlete_goals", `?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=1`);
        goals = Array.isArray(g) ? g : [];
      } catch (_) {}
      if (!on) return;
      const bp = precharge({ athlete, goals, lastBlock, viewer });
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
  const park = async (bp, t, status, dText) => {
    const row = {
      owner_type: viewer, title: bp?.goal?.value ? bp.goal.value.slice(0, 60) : "Builder session",
      status, blueprint: { ...bp, __topic: topicRef.current }, transcript: t,
      draft_text: dText || null, provisional_goal: bp?.goal?.value || bp?.goal?.pending || null,
      scope, updated_at: nowIso(),
    };
    try {
      if (draftId) {
        await sbUpdateWhere("program_drafts", `?id=eq.${draftId}`, row);
      } else {
        const ins = viewer === "coach"
          ? { ...row, coach_id: coachId, athlete_id: athlete.id }
          : { ...row, athlete_id: athlete.id };
        const res = await sbInsert("program_drafts", ins);
        const id = Array.isArray(res) && res[0]?.id;
        if (id) setDraftId(id);
      }
      onParked && onParked();
    } catch (e) { console.error("[builder] park failed:", e?.message || e); }
  };

  // ── Interview turns ────────────────────────────────────────────────────────
  const openInterview = async (bp, sc) => {
    setBusy(true); setErr("");
    try {
      const sys = interviewerSystem({ cells: cellsFor(viewer, sc), blueprint: bp, scope: sc, viewer, name: athlete.name });
      const raw = await askClaude({ cached: doctrine(), dynamic: sys }, "Open the interview: greet in one short line, then your first question.", 400, [], "claude-sonnet-5", "program_build");
      const { text, chips: ch } = parseInterviewerReply(raw);
      setTranscript([{ role: "assistant", content: text }]);
      setChips(ch);
    } catch (e) { setErr("Couldn't reach Joe — try again in a sec."); }
    setBusy(false);
  };

  const send = async (msgArg) => {
    const msg = (typeof msgArg === "string" ? msgArg : input).trim();
    if (!msg || busy || !blueprint) return;
    setInput(""); setChips([]); setBusy(true); setErr("");
    const t1 = [...transcript, { role: "user", content: msg }];
    setTranscript(t1);
    try {
      // 1) extractor — can fill ANY cell from this one message
      const ex = parseExtraction(await askClaude(
        extractorSystem(cells),
        `Current blueprint (JSON): ${JSON.stringify(Object.fromEntries(cells.map(c => [c.key, blueprint[c.key]?.value || null])))}\nMessage: "${msg}"`,
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
      setBlueprint(bp);
      const done = blueprintPct(bp, cells) === 100;
      if (done) {
        const closing = "That's everything I need — the blueprint's at 100%. Hit DRAFT IT and I'll write the real thing.";
        const t2 = [...t1, { role: "assistant", content: closing }];
        setTranscript(t2); setChips([]);
        park(bp, t2, "interview", null);
      } else {
        // 2) interviewer — next question
        const sys = interviewerSystem({ cells, blueprint: bp, scope, viewer, name: athlete.name });
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
  const generate = async () => {
    if (busy || pct !== 100) return;
    setBusy(true); setErr(""); setPhase("drafting");
    try {
      track("builder_draft_generate", "ai");
      const sys = drafterSystem({ viewer });
      let text = await askClaude({ cached: doctrine(), dynamic: sys }, draftUser({ blueprint, cells, athlete }), 3500, [], "claude-sonnet-5", "program_draft");
      let check = validateDraft(text, { blueprint, cells });
      if (!check.ok) {
        // one corrective retry with the exact failures — the harness asserts the same rules
        text = await askClaude({ cached: doctrine(), dynamic: sys },
          draftUser({ blueprint, cells, athlete }) + `\n\nYour previous attempt failed these checks — fix ALL of them:\n- ${check.problems.join("\n- ")}`,
          3500, [], "claude-sonnet-5", "program_draft");
        check = validateDraft(text, { blueprint, cells });
      }
      if (!check.ok) console.error("[builder] draft failed validation after retry:", check.problems);
      setDraftText(text.trim());
      setPhase("draft");
      park(blueprint, transcript, "draft", text.trim());
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
      await onSaveToProgram(draftText);
      if (draftId) await sbUpdateWhere("program_drafts", `?id=eq.${draftId}`, { status: "applied", updated_at: nowIso() }).catch(() => {});
      track("builder_draft_applied", "ai");
      setConfirmSave(null);
      setPhase("saved");
    } catch (e) { setErr("Couldn't save that — try again in a sec."); }
    setBusy(false);
  };

  // ── UI atoms ───────────────────────────────────────────────────────────────
  const mono = { fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" };
  const subhead = { ...mono, fontSize: 9, letterSpacing: 2, color: CA.muted, textTransform: "uppercase" };
  const miniBtn = (active, color = CA.accent) => ({ background: active ? `${color}20` : "transparent", border: `1px solid ${active ? color : CA.border}`, color: active ? color : CA.muted, borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'DM Sans'" });
  const cellTube = (charged, pending) => (
    <div className={`hcell${go ? " go" : ""}`}>
      <div className="htube" style={{ height: 10 }}>
        <div className="hfill" style={{ "--pct": charged ? 1 : pending ? 0.45 : 0, "--tc": pending && !charged ? CA.amber : CA.cyan, "--tb": charged ? 0.55 : 0.2 }} />
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
          <span style={{ ...mono, fontSize: 11, color: pct === 100 ? CA.green : CA.cyan }}>{pct}%</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {scopes.map(s => (
              <button key={s} disabled={transcript.length > 1} onClick={() => { setScope(s); if (blueprint) openInterview(blueprint, s); }}
                title={transcript.length > 1 ? "Scope locks once the interview starts" : ""}
                style={{ ...miniBtn(scope === s), padding: "2px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: 1, opacity: transcript.length > 1 && scope !== s ? 0.4 : 1 }}>
                {s}
              </button>
            ))}
          </span>
        </div>
        <div className={`hcell${go ? " go" : ""}`} style={{ marginBottom: 10 }}>
          <div className="htube">
            <div className="hfill" style={{ "--pct": pct / 100, "--tc": pct === 100 ? CA.green : CA.cyan, "--tb": pct / 130 }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(118px,1fr))", gap: "8px 12px" }}>
          {cells.map(c => {
            const b = blueprint?.[c.key];
            const chargedCell = !!b?.value;
            return (
              <div key={c.key} title={`${c.why}${b?.note ? `\n(${b.note})` : ""}`}>
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
        <div style={{ border: `1px solid ${CA.green}55`, background: `${CA.green}0d`, borderRadius: 12, padding: 16, color: CA.text, fontSize: 13, lineHeight: 1.7 }}>
          ✅ Saved to {viewer === "coach" ? `${athlete.name}'s program` : "My Program"} — it drives every session from here. The old block is archived under Drafts → Past blocks.
        </div>
      )}

      {/* ── Draft view ── */}
      {(phase === "draft" || phase === "drafting") && phase !== "saved" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
          {phase === "drafting" ? (
            <div style={{ color: CA.cyan, fontSize: 13, ...mono, padding: "18px 4px" }}>▮▯▯ Joe's writing the block from your blueprint…</div>
          ) : confirmSave ? (
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
                <button onClick={saveToProgram} disabled={busy} style={{ background: busy ? CA.navy3 : CA.accent, color: busy ? CA.muted : "#000", border: "none", borderRadius: 9, padding: "9px 16px", cursor: busy ? "wait" : "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>{busy ? "SAVING…" : "REPLACE PROGRAM"}</button>
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
                  disabled={busy || !draftText.trim()}
                  style={{ background: CA.accent, color: "#000", border: "none", borderRadius: 9, padding: "9px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Bebas Neue'", letterSpacing: 1 }}>
                  SAVE TO {viewer === "coach" ? "THEIR PROGRAM" : "MY PROGRAM"}
                </button>
                <button onClick={() => { park(blueprint, transcript, "draft", draftText); onParked && onParked(); }} disabled={busy} style={miniBtn(false)}>Park in Drafts</button>
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
              {chips.map((c, i) => <button key={i} onClick={() => send(c)} style={miniBtn(true, CA.cyan)}>{c}</button>)}
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
                style={{ background: CA.green, color: "#02120a", border: "none", borderRadius: 9, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Bebas Neue'", letterSpacing: 1, boxShadow: `0 0 14px ${CA.green}55` }}>
                ⚡ DRAFT IT
              </button>
            )}
            {pct < 100 && <span style={{ color: CA.muted, fontSize: 10.5 }}>Joe drafts only from a 100% blueprint — {cells.length - filledCount(blueprint || {}, cells)} cell{cells.length - filledCount(blueprint || {}, cells) !== 1 ? "s" : ""} to go.</span>}
            <button onClick={() => { park(blueprint, transcript, draftText ? "draft" : "interview", draftText || null); onParked && onParked(); }} disabled={busy || !blueprint || transcript.length === 0}
              style={{ ...miniBtn(false), marginLeft: "auto" }}>
              Save & exit → Drafts
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
