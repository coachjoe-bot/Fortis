// T46 GAUNTLET — shared driver for the pre-launch stress test.
//
// Drives PROD (app.trainwilco.com) as real athletes, because the AI and billing
// paths only exist there. Every account it creates is tagged
// `signup_source=gauntlet_test` so it can be excluded from metrics and deleted
// through the real deletion path (which cancels Stripe first, T19) at the end.
//
// NEVER point this at a real athlete id.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HOST = process.env.WILCO_HOST || "https://app.trainwilco.com";
const here = dirname(fileURLToPath(import.meta.url));
export const STATE_FILE = join(here, ".gauntlet-accounts.json");
export const TAG = "gauntlet_test";

export const loadState = () =>
  existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { accounts: {}, calls: 0 };
export const saveState = (s) => {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
};

let CALLS = 0;
export const aiCalls = () => CALLS;

export async function post(path, body, { auth } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth?.token) headers.authorization = `Bearer ${auth.token}`;
  const r = await fetch(`${HOST}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 400) }; }
  return { status: r.status, body: json };
}

// ── accounts ────────────────────────────────────────────────────────────────
export async function createAthlete({ name, email, pin, athlete = {} }) {
  const r = await post("/api/identity", {
    action: "create-athlete",
    pin,
    signupSource: TAG,
    athlete: { name, email, ...athlete },
  });
  if (r.status !== 200 || !r.body.athlete) throw new Error(`create-athlete failed ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return { id: r.body.athlete.id, token: r.body.token, pin, name, email, row: r.body.athlete };
}

export async function login(name, pin) {
  const r = await post("/api/identity", { action: "athlete-login", name, pin });
  return r.body;
}

// ── gateway (server-scoped reads/writes as this athlete) ────────────────────
const asAuth = (a) => ({ id: a.id, token: a.token, role: "athlete", pin: a.pin });
export const dataOp = (auth, payload) => post("/api/data", { auth: asAuth(auth), ...payload });

export const read = (auth, table, params = "?select=*") => dataOp(auth, { op: "read", table, params });
export const insert = (auth, table, data) => dataOp(auth, { op: "insert", table, data });
export const update = (auth, table, params, data) => dataOp(auth, { op: "update", table, params, data });

// ── Coach Joe (the real chat path, real Anthropic spend) ────────────────────
export async function claude(auth, payload) {
  CALLS++;
  return await post("/api/claude", { auth: asAuth(auth), ...payload });
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ── reporting ───────────────────────────────────────────────────────────────
export const results = [];
export function check(id, desc, pass, detail = "") {
  results.push({ id, desc, pass, detail });
  const mark = pass === true ? "✓" : pass === false ? "✗" : "?";
  console.log(`${mark} ${id}  ${desc}${detail ? `\n     ${String(detail).replace(/\n/g, "\n     ").slice(0, 700)}` : ""}`);
  return pass;
}
export function summary(label) {
  const fail = results.filter((r) => r.pass === false);
  const unk = results.filter((r) => r.pass !== true && r.pass !== false);
  console.log(`\n── ${label} ── ${results.length - fail.length - unk.length} pass · ${fail.length} FAIL · ${unk.length} inconclusive · ${CALLS} AI calls`);
  if (fail.length) { console.log("FAILURES:"); for (const f of fail) console.log(`  ✗ ${f.id} ${f.desc}\n      ${String(f.detail).slice(0, 400)}`); }
  return fail.length;
}
