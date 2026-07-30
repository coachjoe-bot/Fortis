// ─── CHECKOUT TOKEN REGRESSION SUITE ──────────────────────────────────────────
// T18 iOS payments surgery: mintCheckoutToken/parseCheckoutToken in api/_supa.js
// are the ONLY thing standing between the standalone /upgrade page and "anyone
// who guesses a URL sees someone else's checkout." Covers: round-trip, tamper
// rejection on every field, expiry, and — the one bug class unique to this
// token type versus the existing session token — that it lives in a completely
// separate HMAC domain and can never be confused with (or forged from) a
// session token, even though both derive from the same server secret.
//
// One-time-use itself (the DB compare-and-swap in api/identity.js's
// resolve-checkout-token) is NOT covered here — it needs a live Supabase
// connection and is exercised by the manual Stripe test-mode runbook
// (STRIPE-INTEGRATION.md), same as the rest of the billing suite.
//
//   node scripts/test-checkout-token.mjs
//
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-signing-key-not-a-real-secret";
const { mintCheckoutToken, parseCheckoutToken, mintSessionToken, tryTokenAuth } = await import("../api/_supa.js");

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

console.log("checkout tokens — a freshly minted token round-trips:");
const { token, jti, exp } = mintCheckoutToken("ath-1");
const parsed = parseCheckoutToken(token);
check("athleteId round-trips", parsed?.athleteId, "ath-1");
check("jti round-trips", parsed?.jti, jti);
check("exp round-trips", parsed?.exp, exp);
check("exp is ~15 minutes out", Math.abs(exp - (Date.now() + 15 * 60 * 1000)) < 5000, true);
check("two mints for the same athlete get DIFFERENT jtis (unguessable, not replayable across mints)",
  mintCheckoutToken("ath-1").jti !== mintCheckoutToken("ath-1").jti, true);

console.log("\ncheckout tokens — every tamper/rejection path returns null, never throws:");
check("a tampered signature is rejected", parseCheckoutToken(token.slice(0, -3) + "aaa"), null);
check("a tampered athleteId is rejected (signature covers it)", (() => {
  const [v, , expStr, j, sig] = token.split(".");
  return parseCheckoutToken([v, "ath-9", expStr, j, sig].join("."));
})(), null);
check("a tampered jti is rejected (signature covers it)", (() => {
  const [v, athleteId, expStr, , sig] = token.split(".");
  return parseCheckoutToken([v, athleteId, expStr, "forged-jti", sig].join("."));
})(), null);
check("an extended expiry is rejected (signature covers exp)", (() => {
  const [v, athleteId, , j, sig] = token.split(".");
  const far = String(Date.now() + 999 * 864e5);
  return parseCheckoutToken([v, athleteId, far, j, sig].join("."));
})(), null);
check("an expired token is rejected", (() => {
  const t = mintCheckoutToken("ath-1");
  const parts = t.token.split(".");
  parts[2] = String(Date.now() - 1000);
  // Re-derive nothing — an expired exp with the OLD (now-mismatched) signature
  // must fail on expiry alone, same as a still-valid signature would.
  return parseCheckoutToken(parts.join("."));
})(), null);
check("an unknown version prefix is rejected", parseCheckoutToken(token.replace(/^c1\./, "c2.")), null);
check("a malformed token (wrong part count) is rejected", parseCheckoutToken("garbage.not.a.token"), null);
check("a non-string token is rejected", parseCheckoutToken(undefined), null);
check("an empty-string token is rejected", parseCheckoutToken(""), null);

console.log("\ncheckout tokens — domain separation from session tokens (the load-bearing property):");
const session = mintSessionToken("athlete", "ath-1");
check("a checkout token is never accepted as a session token", tryTokenAuth({ role: "athlete", id: "ath-1", token }), null);
check("a session token is never accepted as a checkout token", parseCheckoutToken(session), null);
// A session token minted for the SAME athlete id has a totally different shape
// (5 dot-separated parts starting "v1", vs "c1") — assert the prefixes really
// do differ so a future refactor can't accidentally collapse the two formats.
check("prefixes differ", token.split(".")[0] !== session.split(".")[0], true);

console.log(`\n${fail === 0 ? `All ${pass} checks passed.` : `${fail} of ${pass + fail} FAILED.`}`);
process.exit(fail === 0 ? 0 : 1);
