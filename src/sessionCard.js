// ─── LOCK-SCREEN SESSION CARD (T40 V1) ───────────────────────────────────────
// Today's session pinned to the lock screen as a notification, so the athlete
// glances between sets instead of unlocking, opening the app, and waiting.
//
// The rules this feature lives by (Will, 2026-08-10):
//   • The card is a PROJECTION of the Quick Log draft — the app's one canonical
//     "today's session, number-first, position-resolved" artifact. It is never
//     built from model chat text, and nothing here re-derives position or
//     weights (coach-brain lesson: compute facts in code, hand them over).
//   • Static reference sheet: no check-offs, no progress. Logging the workout
//     clears the whole card; that's the only "done" state it has.
//   • It exists only when the athlete said yes to the chat offer. No cron, no
//     scheduled time, nothing appears unasked.
//
// V1 delivery is a web notification via the service worker (tag-replaced on
// update, closed on log) — every current user is on the PWA. The native
// Live Activity rides a post-launch App Store update along with
// @capacitor/local-notifications; ios/ is deliberately untouched while the T23
// submission is in flight.

import { qlLocalDay } from "./quicklog.js";

export const SESSION_CARD_TAG = "wilco-session-card";
// An abandoned session shouldn't haunt the lock screen: past this age the card
// is stale and gets cleared on the next app open (the web platform has no
// self-expiring notifications, so expiry is enforced at boot).
export const SESSION_CARD_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const cardKey = (athleteId) => `wilco_sessioncard_${athleteId}`;
const declineKey = (athleteId) => `wilco_sessioncard_declined_${athleteId}`;

// ── the chat trigger ─────────────────────────────────────────────────────────
// Deterministic intent match for "Joe is about to serve today's session" — the
// same phrasings the chat prompt's today's-workout rule enumerates, plus
// "start my workout". The offer only ever rides one of these; a model reply
// never decides whether to offer (nothing for it to get wrong).
export const TODAYS_WORKOUT_RE =
  /what(?:'|’)?s?\s+(?:my|the|on|today)(?:[a-z'’ ]{0,12})?\s*(?:workout|session|training|lift(?:ing)?|program)?\s*(?:for\s+)?today|what\s+am\s+i\s+(?:doing|lifting|training)\s+today|show\s+me\s+today(?:'|’)?s?\s+(?:workout|session)|today(?:'|’)?s?\s+(?:workout|session)\b|start\s+(?:my|the|today(?:'|’)?s?)\s+workout/i;
export const asksTodaysWorkout = (msg) => TODAYS_WORKOUT_RE.test(String(msg || ""));

// ── card content, from the draft ─────────────────────────────────────────────
// Input is the Quick Log draft's log text: first line = day label, then one
// exercise per line "Name SETSxREPS @ WEIGHT (source)". The card shows real
// weights and drops the source tags — "@ 225", never "@ 75%" (Will's call).
const SOURCE_TAG_RE = /\s*\((?:~?\d+(?:\.\d+)?\s*%[^)]*|RPE[^)]*|last time[^)]*)\)\s*$/i;

export const buildSessionCard = (draftText, { week } = {}) => {
  const lines = String(draftText || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const dayLabel = lines[0].replace(/[:\-–—\s]+$/, "");
  const exercises = lines.slice(1).map((l) => l.replace(SOURCE_TAG_RE, ""));
  if (!exercises.length) return null;
  // "Push A · Week 3" — but never repeat a week the label already states.
  const weekTag = week && !/\bw(?:ee)?k\s*\d/i.test(dayLabel) ? ` · Week ${week}` : "";
  return {
    title: `${dayLabel}${weekTag}`,
    body: exercises.slice(0, 12).join("\n"),
  };
};

// ── platform support / permission ────────────────────────────────────────────
export const sessionCardSupported = () =>
  typeof window !== "undefined" && "Notification" in window &&
  typeof navigator !== "undefined" && "serviceWorker" in navigator;

// ── show / clear / query ─────────────────────────────────────────────────────
// Same tag every time, so an update silently REPLACES the pinned card instead
// of stacking a second one.
export const showSessionCard = async (athleteId, card) => {
  if (!card || !sessionCardSupported()) return false;
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch (_) { return false; }
  }
  if (perm !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(card.title, {
      body: card.body,
      tag: SESSION_CARD_TAG,
      renotify: false,
      silent: true, // a reference sheet, not an alert — no buzz on show or update
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: "/", type: "session_card" },
    });
    const existing = readCardState(athleteId);
    writeCardState(athleteId, {
      day: qlLocalDay(),
      // An update keeps the original start time — the card "started" when the
      // athlete first pinned it, not when it last re-rendered.
      startedAt: existing && existing.day === qlLocalDay() ? existing.startedAt : Date.now(),
    });
    return true;
  } catch (_) { return false; }
};

export const clearSessionCard = async (athleteId) => {
  try { localStorage.removeItem(cardKey(athleteId)); } catch (_) {}
  if (!sessionCardSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications({ tag: SESSION_CARD_TAG })).forEach((n) => n.close());
  } catch (_) {}
};

const readCardState = (athleteId) => {
  try { return JSON.parse(localStorage.getItem(cardKey(athleteId)) || "null"); } catch (_) { return null; }
};
const writeCardState = (athleteId, state) => {
  try { localStorage.setItem(cardKey(athleteId), JSON.stringify(state)); } catch (_) {}
};

// Pure staleness rule, exported for tests: a card is live only same-local-day
// and under the age cap.
export const sessionCardIsLive = (state, now = Date.now()) =>
  !!state && state.day === qlLocalDay(now) && now - (state.startedAt || 0) <= SESSION_CARD_MAX_AGE_MS;

// The card the app believes is currently pinned, or null. Never clears — the
// boot path owns that (expireSessionCardIfStale), so a stale read here can't
// race a show in progress.
export const activeSessionCard = (athleteId) => {
  const d = readCardState(athleteId);
  return sessionCardIsLive(d) ? d : null;
};

// Boot-time expiry: yesterday's card, or one past the age cap, comes down.
export const expireSessionCardIfStale = async (athleteId) => {
  const d = readCardState(athleteId);
  if (d && !sessionCardIsLive(d)) await clearSessionCard(athleteId);
};

// ── one offer per day ────────────────────────────────────────────────────────
// "No thanks" means not today — the offer comes back tomorrow, not next message.
export const sessionCardDeclinedToday = (athleteId) => {
  try { return localStorage.getItem(declineKey(athleteId)) === qlLocalDay(); } catch (_) { return false; }
};
export const markSessionCardDeclined = (athleteId) => {
  try { localStorage.setItem(declineKey(athleteId), qlLocalDay()); } catch (_) {}
};
