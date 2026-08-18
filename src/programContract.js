// ─── PROGRAM CONTRACT — reading the BLOCK INFO header (T53 #7/#8) ─────────────
// The drafter opens every program with a "=== BLOCK INFO ===" header declaring
// the goal, the maxes its percentages run off (with sources), the loading
// language, the dates, and — for multi-block macros — the campaign. This module
// is the ONE reader of that contract: MY PROGRAM's campaign strip, Quick Log,
// and the next block's interview all parse it from here, so the header format
// and its consumers can never drift apart. Plain JS, server-safe.
//
// Tolerant by design: programs written before the contract (or by hand) simply
// return {found:false} and every consumer falls back to today's behavior.

const HEADER_RE = /^\s*=+\s*BLOCK INFO\s*=+\s*$/im;

export function parseBlockInfo(text) {
  const t = String(text || "");
  const m = t.match(HEADER_RE);
  if (!m) return { found: false };
  const after = t.slice(m.index + m[0].length);
  // The header body ends at the first blank line or the first non "Key: value" line.
  const lines = [];
  for (const raw of after.split("\n")) {
    const line = raw.trim();
    if (!line) { if (lines.length) break; else continue; }
    if (!/^[A-Za-z][A-Za-z &/]{1,20}:\s/.test(line)) break;
    lines.push(line);
  }
  const get = (key) => {
    const l = lines.find((x) => new RegExp(`^${key}:`, "i").test(x));
    return l ? l.replace(new RegExp(`^${key}:\\s*`, "i"), "").trim() : "";
  };
  const out = { found: true, goal: get("Goal"), loading: get("Loading"), runs: get("Runs"), gate: get("Gate") || null, maxes: [], campaign: [] };

  // "Maxes used: Back Squat 405 lb (declared/tested 1RM), Bench ~275 lb (est. from logs)"
  const maxesLine = get("Maxes used") || get("Maxes");
  if (maxesLine) {
    for (const part of maxesLine.split(/[,;·]+/)) {
      const p = part.trim();
      const mm = p.match(/^(.+?)\s*~?(\d+(?:\.\d+)?)\s*(kg|lbs?|lb)\b\s*(?:\(([^)]*)\))?/i);
      if (!mm) continue;
      const src = (mm[4] || "").toLowerCase();
      out.maxes.push({
        lift: mm[1].trim(),
        weight: Number(mm[2]),
        unit: /kg/i.test(mm[3]) ? "kg" : "lbs",
        source: /declar|test/.test(src) ? "declared" : /est/.test(src) ? "estimated" : (src || null),
      });
    }
  }

  // "Campaign: Block 1 of 3 (this one): 4 wk strength → checkpoint bench single; Block 2: ..."
  const campLine = get("Campaign");
  if (campLine) {
    for (const part of campLine.split(/;+/)) {
      const p = part.trim();
      if (!p) continue;
      const bm = p.match(/^Block\s*(\d+)(?:\s*of\s*(\d+))?\s*(\(this one\)|\(current\))?\s*:?\s*(.*)$/i);
      if (!bm) continue;
      const rest = bm[4] || "";
      const wk = rest.match(/(\d+(?:\.\d+)?)\s*(?:wk|week)s?\b/i);
      out.campaign.push({
        n: Number(bm[1]),
        of: bm[2] ? Number(bm[2]) : null,
        current: !!bm[3],
        weeks: wk ? Number(wk[1]) : null,
        emphasis: rest.replace(/^\d+(?:\.\d+)?\s*(?:wk|week)s?\b[\s—:-]*/i, "").split(/→|->/)[0].trim() || rest.trim(),
        checkpoint: (rest.split(/→|->/)[1] || "").replace(/^\s*checkpoint[:\s]*/i, "").trim() || null,
      });
    }
    out.campaign.sort((a, b) => a.n - b.n);
  }
  return out;
}

// The program text WITHOUT its BLOCK INFO header — what MY PROGRAM shows once
// the header renders as a card (T57: the raw "=== BLOCK INFO ===" block read
// techy in the monospace body). Walks the same lines parseBlockInfo reads, so
// the two can never disagree about where the header ends. No header → text
// unchanged.
export function stripBlockInfo(text) {
  const t = String(text || "");
  const m = t.match(HEADER_RE);
  if (!m) return t;
  const before = t.slice(0, m.index);
  const after = t.slice(m.index + m[0].length);
  const lines = after.split("\n");
  let i = 0, seen = false;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (seen) { i++; break; } else continue; }
    if (!/^[A-Za-z][A-Za-z &/]{1,20}:\s/.test(line)) break;
    seen = true;
  }
  return (before + lines.slice(i).join("\n")).replace(/^\s*\n/, "");
}

// Render a campaign array (from a blueprint's __campaign or parseBlockInfo) as
// the drafter's Campaign line — the writer half of the same contract.
export function campaignLine(campaign, currentN = 1) {
  const c = Array.isArray(campaign) ? campaign.filter((b) => b && (b.emphasis || b.label)) : [];
  if (!c.length) return "";
  const total = c.length;
  return c.map((b, i) => {
    const n = b.n || i + 1;
    const bits = [
      `Block ${n} of ${total}${n === currentN ? " (this one)" : ""}:`,
      b.weeks ? `${b.weeks} wk` : "",
      b.emphasis || b.label || "",
      b.checkpoint ? `→ checkpoint ${b.checkpoint}` : "",
    ].filter(Boolean);
    return bits.join(" ");
  }).join("; ");
}
