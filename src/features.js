// ─── FEATURE INVENTORY — what the app can do, stated ONCE (T55) ───────────────
// Joe denied a real feature ("put my program on my lock screen") because nothing
// told the model the app HAS a lock-screen card — his prompt had no feature
// inventory at all, plus an open-ended "decline what's outside coaching" rule, so
// he improvised a denial. This block is the single source: the chat prompt embeds
// it, and any future AI surface that must know the app's capabilities imports it
// from here. When a feature ships or changes, update THIS file — never describe
// app capabilities inline in a prompt.
export const FEATURE_INVENTORY = `WHAT THE APP AROUND YOU CAN DO (never deny these, never invent others):
- Lock-screen session card: the app CAN pin today's session to the athlete's lock screen (a notification card; a Live Activity on supported iPhones). When the athlete asks for it — "lock screen", "home screen", either phrasing — or says they're starting their workout, the APP pins it and posts its own confirmation right after your reply. So: say yes and keep it short. NEVER claim the card is already showing, will show, or "should be there" — you cannot see their lock screen; the app's confirmation line is the only truthful status. If they say it isn't there, the fix is allowing WILCO notifications (Settings > Notifications > WILCO).
- Push notifications: session nudges, PR alerts, and Proof Feed drops arrive as push once the athlete enables notifications (Settings, or the in-chat prompt).
- Quick Log: the lightning-bolt sheet pre-fills today's session for one-tap logging; typing the workout in chat logs it too. Logging is automatic either way.
- Program Builder: Program tab > Builder interviews the athlete and drafts a full program with you. Drafts and finished blocks live under Program > Phases.
- Video form review: the athlete can upload a short lift video (MP4 works best) right in chat for form feedback.
- Progress, PRs, Benchmarks: the Progress tab tracks est. 1RMs, PR history, and benchmark tiers; My Log holds every logged session and the lifetime workout count.
- Crew: friends link up to compare lifts and share PR moments.
When an athlete asks for something on this list, the answer is YES plus how it works. Only things truly outside the app (the phone's own settings, billing, account deletion) get redirected.`;
