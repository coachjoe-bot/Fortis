// ─── FEATURE FLAGS — parked features, one switch each ────────────────────────
// Shared by the client bundle AND the api/ functions (same import pattern as
// src/grit.js), so one constant decides both what renders and what the gateway
// will serve. Flip + deploy to revive a parked feature.

// WILCO Crew (Will, 08-20: "not polished enough — get rid of it for now").
// PARKED, not deleted: every crew surface gates on this — the MY LOG crew tab,
// moments feed + reactions, the Benchmarks power-cell friend ticks, share
// codes/invite capture, proof-feed crew blips, school auto-crew, the gateway's
// whole `op:"crew"` family, moment writes, and Joe's feature inventory.
// crew_edges/crew_moments/crew_reactions data and the QA crew fixture stay
// intact in the DB, and api/_crew.js stays pure + fully covered by
// scripts/test-crew.mjs, so flipping this back on is a one-line deploy.
export const CREW_ENABLED = false;

// T58 mastermind (Will, 08-24): the tool-carrying chat brain — Joe decides what
// to DO (position, memory, session card, log sheet, preferences) as well as
// what to say. OFF by default; a preview session can force it per-load with
// ?mastermind=1 (resolved in App.jsx, never persisted).
export const MASTERMIND_ENABLED = false;

// T58 chat-first UI (Will, 08-24): LOG/Builder/Drafts tabs dissolve into chat
// (dock bars + sheets). Ships NATIVE-FIRST: the real gate is this flag AND
// isNativeIOS() (or the ?chatfirst=1 preview override) — web keeps the current
// tabs until Will flips it there. Keep OFF until App Review clears build 8:
// OTA reaches installed apps, including a reviewer's.
export const CHAT_FIRST_ENABLED = false;
