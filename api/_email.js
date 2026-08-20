// ─── SHARED EMAIL COMPLIANCE (CAN-SPAM) ──────────────────────────────────────
// Every outbound email carries the sender's postal address; RECURRING mail
// (proof-feed digests, the coach weekly report) also carries a working
// one-click unsubscribe and is suppressed for opted-out addresses.
// Transactional mail (welcome, PIN recovery, coach invite, program-change
// notices) is exempt from the opt-out requirement and must keep sending even
// to unsubscribed addresses — never wire isUnsubscribed into those paths.
//
// Suppression is keyed by ADDRESS, not athlete id: the weekly report goes to
// coach emails that may have no account row at all.

import crypto from "node:crypto";
import { sbSelect } from "./_supa.js";

export const POSTAL_LINE =
  "Wilco Training LLC · 801 International Pkwy, Suite #5034, Lake Mary, FL 32746";

const APP_URL = process.env.APP_URL || "https://app.trainwilco.com";

// HMAC over the lowercased address so a link can only unsubscribe its own
// recipient. CRON_SECRET is production-scope — matches where email sends from.
const secret = () =>
  process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || "";

export const normEmail = (e) => String(e || "").trim().toLowerCase();

export const unsubToken = (email) =>
  crypto.createHmac("sha256", secret()).update(normEmail(email)).digest("hex").slice(0, 32);

export const unsubUrl = (email) => {
  const e = Buffer.from(normEmail(email)).toString("base64url");
  return `${APP_URL}/api/unsubscribe?e=${e}&t=${unsubToken(email)}`;
};

// Footer block appended inside the email body. Address always; the
// unsubscribe line only on recurring mail.
export const emailFooter = (email, { unsubscribe = false } = {}) => `
  <div style="text-align:center;padding:16px 20px 6px">
    <p style="color:#64748b;font-size:11px;line-height:1.7;margin:0">${POSTAL_LINE}</p>
    ${unsubscribe ? `<p style="color:#64748b;font-size:11px;margin:6px 0 0"><a href="${unsubUrl(email)}" style="color:#64748b;text-decoration:underline">Unsubscribe from these emails</a></p>` : ""}
  </div>`;

// RFC 8058 one-click headers (Resend forwards custom headers verbatim).
export const unsubHeaders = (email) => ({
  "List-Unsubscribe": `<${unsubUrl(email)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

// FAIL CLOSED: an error while checking reads as "unsubscribed" — a missed
// digest is recoverable, mailing an opted-out address is a violation.
export async function isUnsubscribed(email) {
  const e = normEmail(email);
  if (!e) return true;
  try {
    const rows = await sbSelect(
      "email_unsubscribes",
      `?email=eq.${encodeURIComponent(e)}&select=email&limit=1`
    );
    return !Array.isArray(rows) || rows.length > 0;
  } catch {
    return true;
  }
}
