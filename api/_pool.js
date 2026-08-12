// ─── BOUNDED-CONCURRENCY FAN-OUT ──────────────────────────────────────────────
// Extracted from api/trigger-proof-feed.js (where it has run at concurrency 25
// since the hourly proof sweep shipped) so every fan-out cron shares ONE
// implementation. api/push.js was the last sequential fan-out in the system —
// a per-athlete awaited push plus an awaited state upsert, under maxDuration 60,
// which is the arithmetic that made it the first thing to break at launch volume
// (T46 scale section; T51).
//
// Underscore-prefixed: Vercel does not route this as its own function.

// Run `fn` over `items` at bounded concurrency, collecting settled results IN
// ORDER. A rejected item resolves to { ok:false, error } rather than aborting
// the batch — one dead device can never drop the rest of a run.
export async function mapPooled(items, concurrency, fn) {
  const out = [];
  const width = Math.max(1, concurrency | 0);
  for (let i = 0; i < items.length; i += width) {
    const settled = await Promise.allSettled(items.slice(i, i + width).map(fn));
    for (const s of settled) {
      out.push(s.status === "fulfilled" ? s.value : { ok: false, error: s.reason?.message || String(s.reason) });
    }
  }
  return out;
}
