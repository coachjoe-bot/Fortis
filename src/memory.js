// ─── MASTERMIND MEMORY (T58) ─────────────────────────────────────────────────
// Pure logic for the per-athlete fact store (athlete_memory) — validation,
// expiry, and the prompt block builder. No I/O and no React: the tool handlers
// in App.jsx do the gateway reads/writes; everything here is unit-tested in
// scripts/test-mastermind.mjs.
//
// Model: a fact is one row. `pinned` facts are always relevant; `contextual`
// facts are background the model attends to when relevant; `situational` facts
// carry an expiry and die on their own ("runs D1 tomorrow" must not survive
// the week). Position is STATE (program_position_override), never memory —
// memory holds PLANS and durable truths about the athlete.

export const MEMORY_MAX_LEN = 240;
export const MEMORY_INDEX_CAP = 24;   // bounded prompt block: pinned first, then newest
export const MEMORY_ROW_CAP = 60;     // absolute active-row ceiling per athlete (hygiene)

// A fact is data about the ATHLETE — never an instruction about how the coach
// behaves. Same guardrail the old context_request extractor enforced by prompt;
// here it is deterministic. Deliberately narrow: it must block behavior/persona
// injections without eating legitimate facts ("prefers morning sessions").
const BEHAVIOR_RE = /\b(ignore|disregard|forget) (your|all|previous|prior) (rules|instructions|guidelines)|\byou (must|should|will) (always|never)\b|\bact as\b|\bpretend to be\b|\brespond (only )?(in|with)\b|\bchange your (tone|persona|personality|behavior)\b|\bsystem prompt\b/i;

export function validateFact({ content, kind, expires_at } = {}) {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MEMORY_MAX_LEN) return { ok: false, reason: "too_long" };
  if (!["pinned", "contextual", "situational"].includes(kind)) return { ok: false, reason: "bad_kind" };
  if (BEHAVIOR_RE.test(text)) return { ok: false, reason: "behavior_instruction" };
  if (kind === "situational") {
    const t = Date.parse(expires_at || "");
    if (!Number.isFinite(t)) return { ok: false, reason: "situational_needs_expiry" };
  } else if (expires_at != null && !Number.isFinite(Date.parse(expires_at))) {
    return { ok: false, reason: "bad_expiry" };
  }
  return { ok: true, content: text };
}

// Active = not deleted, not expired. Expiry is evaluated at READ time — no cron:
// once expires_at passes, the fact simply stops appearing (the D2/D1 contract:
// "runs D1 on Aug 25" is in Monday's prompt and gone by Tuesday's).
export function activeFacts(rows, now = new Date()) {
  const t = now.getTime();
  return (rows || []).filter((r) => {
    if (!r || r.status === "deleted" || !String(r.content || "").trim()) return false;
    if (r.expires_at) {
      const e = Date.parse(r.expires_at);
      if (Number.isFinite(e) && e <= t) return false;
    }
    return true;
  });
}

// Near-duplicate guard for remember_fact: same normalized content = update the
// stamp, don't mint a twin.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
export function findDuplicate(rows, content) {
  const n = norm(content);
  return (rows || []).find((r) => r.status !== "deleted" && norm(r.content) === n) || null;
}

// forget_fact resolution: a distinctive substring, case-insensitive. Returns
// the matching ACTIVE rows (caller marks them deleted). More than 3 matches =
// the match string was too vague; refuse rather than mass-delete.
export function matchFacts(rows, match, now = new Date()) {
  const m = String(match || "").toLowerCase().trim();
  if (m.length < 4) return { ok: false, reason: "too_vague", rows: [] };
  const hits = activeFacts(rows, now).filter((r) => String(r.content).toLowerCase().includes(m));
  if (!hits.length) return { ok: false, reason: "no_match", rows: [] };
  if (hits.length > 3) return { ok: false, reason: "ambiguous", rows: [] };
  return { ok: true, rows: hits };
}

// Pin/unpin from the Memory tab (T61). Pinning clears the expiry — a pinned
// fact is "always relevant" and must never silently die at read time under a
// leftover situational expires_at. Unpinning lands on contextual (background),
// never back on situational: the athlete's tap carries no new expiry date.
export function pinTogglePatch(row) {
  return row && row.kind === "pinned"
    ? { kind: "contextual" }
    : { kind: "pinned", expires_at: null };
}

// The prompt block. Pinned facts in full first, then the newest contextual/
// situational facts as index lines, bounded to MEMORY_INDEX_CAP total. The
// legacy athlete_context blob (dated notes, one line each) rides along until
// its content has migrated — same data, same trust level.
export function buildMemoryBlock(rows, legacyContext = "", now = new Date()) {
  const act = activeFacts(rows, now);
  const pinned = act.filter((r) => r.kind === "pinned");
  const rest = act.filter((r) => r.kind !== "pinned")
    .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0));
  const lines = [];
  for (const r of pinned) lines.push(`- [pinned] ${r.content}`);
  for (const r of rest) {
    if (lines.length >= MEMORY_INDEX_CAP) break;
    const exp = r.expires_at ? ` (until ${String(r.expires_at).slice(0, 10)})` : "";
    lines.push(`- ${r.content}${exp}`);
  }
  const legacy = String(legacyContext || "").trim();
  if (!lines.length && !legacy) return "";
  let block = "\n\nATHLETE MEMORY (facts you chose to keep about this athlete — draw on what's relevant, never recite the list; prune with forget_fact when something is wrong or done):";
  if (lines.length) block += "\n" + lines.join("\n");
  if (legacy) block += `\nOlder notes:\n${legacy}`;
  return block;
}
