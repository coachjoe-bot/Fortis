// T46 GAUNTLET — create the three tagged persona accounts on PROD.
// Idempotent-ish: refuses to re-create if .gauntlet-accounts.json already holds them.
import { createAthlete, login, loadState, saveState, check, summary } from "./lib.mjs";

const PERSONAS = [
  {
    key: "powerlifter", pin: "8461",
    name: "Gauntlet Powerlifter", email: "gauntlet.pl@trainwilco.test",
    athlete: { sport: "Powerlifting", level: "advanced", age: 24, gender: "male",
      height_inches: 70, weight_lbs: 198, training_days_per_week: 4,
      equipment: "full gym", position_or_event: "raw classic 198", injury_history: "none" },
  },
  {
    key: "volleyball", pin: "3927",
    name: "Gauntlet Volleyball", email: "gauntlet.vb@trainwilco.test",
    athlete: { sport: "Volleyball", level: "intermediate", age: 16, gender: "female",
      height_inches: 70, weight_lbs: 145, training_days_per_week: 2,
      equipment: "school weight room", position_or_event: "outside hitter",
      injury_history: "none", recruiting_intent: "college" },
  },
  {
    key: "rehab", pin: "5140",
    name: "Gauntlet Rehab", email: "gauntlet.rh@trainwilco.test",
    athlete: { sport: "Football", level: "intermediate", age: 17, gender: "male",
      height_inches: 73, weight_lbs: 215, training_days_per_week: 4,
      equipment: "full gym", position_or_event: "tight end",
      injury_history: "right shoulder impingement, on and off since spring" },
  },
];

const state = loadState();
for (const p of PERSONAS) {
  if (state.accounts[p.key]) { check(`seed:${p.key}`, "already seeded", true, state.accounts[p.key].id); continue; }
  const a = await createAthlete(p);
  state.accounts[p.key] = { key: p.key, id: a.id, pin: a.pin, name: a.name, email: a.email, token: a.token };
  saveState(state);
  check(`seed:${p.key}`, "created on prod", !!a.id, `${a.id}  tier=${a.row.tier}  source=${a.row.signup_source}`);
  // signup_source must be exactly the tag or these rows pollute real metrics
  check(`seed:${p.key}:tag`, "signup_source == gauntlet_test", a.row.signup_source === "gauntlet_test", a.row.signup_source);
  check(`seed:${p.key}:tier`, "server forced tier=free (client can't self-grant)", a.row.tier === "free", a.row.tier);
  check(`seed:${p.key}:nopin`, "PIN never returned to the client", a.row.pin === undefined, JSON.stringify(Object.keys(a.row)).slice(0, 120));
  const li = await login(p.name, p.pin);
  check(`seed:${p.key}:login`, "login round-trips", !!li.athlete?.id && li.athlete.id === a.id, li.reason || li.athlete?.id);
}
saveState(state);
process.exit(summary("SEED") ? 1 : 0);
