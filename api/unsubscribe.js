// ─── ONE-CLICK EMAIL UNSUBSCRIBE (CAN-SPAM / RFC 8058) ───────────────────────
// GET  /api/unsubscribe?e=<base64url email>&t=<hmac>  → records the opt-out and
//      renders a tiny confirmation page. No login: the law requires the link to
//      work without one.
// POST (same query params) → the RFC 8058 one-click path mail clients use;
//      records silently, returns 200.
// The token is an HMAC of the address (api/_email.js), so a link can only
// unsubscribe its own recipient — the address is not guessable-actionable.
// Suppression applies ONLY to recurring mail (digests, weekly reports);
// transactional sends (PIN recovery, welcomes) never consult this table.

import crypto from "node:crypto";
import { unsubToken, normEmail } from "./_email.js";
import { sbWrite } from "./_supa.js";

export const maxDuration = 15;

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#0b1730;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:420px;margin:80px auto;padding:32px;background:#0f1f3d;border-radius:12px;text-align:center">
<p style="color:#F7F4EF;font-size:20px;font-weight:700;letter-spacing:1px;margin:0 0 12px">WILCO</p>
<p style="color:#cbd5e1;font-size:14px;line-height:1.7;margin:0">${body}</p>
</div></body></html>`;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { e, t } = req.query || {};
  let email = "";
  try { email = normEmail(Buffer.from(String(e || ""), "base64url").toString("utf8")); } catch {}

  const expected = unsubToken(email);
  const given = String(t || "");
  const valid =
    email.includes("@") &&
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));

  if (!valid) {
    if (req.method === "POST") return res.status(400).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(400).send(page("Invalid link", "This unsubscribe link is invalid or incomplete. Reply to the email you received and we'll take care of it."));
  }

  try {
    await sbWrite({
      method: "POST",
      table: "email_unsubscribes",
      query: "?on_conflict=email",
      body: { email, source: req.method === "POST" ? "one-click" : "link" },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  } catch (err) {
    console.error("[unsubscribe] write failed:", err.message);
    if (req.method === "POST") return res.status(500).end();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(page("Something went wrong", "We couldn't record that just now. Reply to the email you received and we'll unsubscribe you by hand."));
  }

  if (req.method === "POST") return res.status(200).end();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(page("Unsubscribed", `<b style="color:#F7F4EF">${email}</b> won't receive recurring WILCO emails anymore. Account and security emails (like PIN recovery) still send. Changed your mind? Reply to any WILCO email.`));
}
