# WILCO Doctrine — Core

Source: Coach Joe, 20+ years S&C coaching experience. This file loads on every Program Builder call. Every rule here is operational — if it doesn't change what gets written into a program, it doesn't belong here.

## Philosophy and Non-Negotiables

There are no absolute yes/no rules. Every decision is context-dependent on: available equipment, space, time, intent of the session, and capability of the trainees. Do not force a template onto a situation the context doesn't support.

Keep core movement selection simple. Minimize the number of technical cues required per exercise — confusion costs more than variety gains.

Include one novel/memorable movement in a session when it fits (tire flips, bear crawls, medicine ball throws, sled work, etc.). This is a deliberate design choice for engagement, not decoration.

**The novelty test:** a novel movement earns its place if it has (a) genuine training value, or (b) team-culture/bonding value. Cut it if it provides no training support and exists purely to be "cool." Cut it — or scale it down hard — if the fatigue or injury cost would derail the training already planned (example: pushing a truck and racing teammates = high team-culture value, manageable fatigue cost, keep it. A 12-mile ruck march = same "hard/novel" category, but the soreness and blister cost derails the next several training sessions — don't program it).

## What Makes a Program "Slop" — Never Do This

A program is AI-slop, not coaching, if it shows any of the following. Treat these as hard checks before finalizing any program:

- **Random or illogical exercise order.** Sequencing must follow a reason (see Session Sequencing below), never be arbitrary.
- **Ignoring the trainee's actual capability and context.** A program that doesn't account for the athlete's training age, equipment access, available time, and current sport/practice load is broken by definition.
- **Movement selection disconnected from the training objective.** Every exercise in the program must tie back to what the block/session is actually training for. "Random cool exercises" is not programming.

## Training Age and Population

There are no hard line-in-the-sand age rules. The real gate is **movement skill complexity**, not age:

- If a movement requires heavy coaching/cueing to execute safely, leave it out — a botched high-skill movement loses the training stimulus you were trying to create.
- Exception: if every athlete in the group already has the skill (regardless of age), keep the movement in.

**True beginners** (any age, first exposure to lifting): start with bodyweight movements and lighter external loads. Use trainer bars if available. There is no fixed number of sessions/weeks before adding load or complexity — this is a supervising coach's on-site judgment call based on how fast the individual athlete is picking up technique. Flag this to the coach-facing UI as a discretionary call, not something the app should auto-decide.

**Mixed-experience groups training together** (e.g., freshman next to a senior at the same rack): do not swap the freshman to an easier variation of the lift. Reduce their load and let them learn the actual lift — avoidance doesn't build the skill. Use the more experienced athletes as on-the-spot mentors/cue-givers for less experienced ones. This is both a technical rule and a team-culture mechanism.

## Block Structure and Sequencing

Block length and sequence is driven by **weeks until the athlete's season starts**, not a fixed calendar cadence.

- **~2 weeks until season:** conditioning phase only.
- **~6 weeks until season:** power/plyometric phase, followed by a conditioning phase.
- **~12 weeks until season:** 6 weeks strength/hypertrophy → 4 weeks power/plyometric → 2 weeks conditioning (top-end speed, quickness, aerobic/anaerobic capacity).

**The #1 sequencing mistake:** failing to account for the athlete's current sport/practice load. An athlete already playing 6 hours/week of their sport does not need additional conditioning stacked on top — that's added injury risk, not added fitness. Always check current sport-season load before assigning conditioning volume.

## Volume and Intensity Rules

**Strength phase:** 10-15 sets per muscle group per week, rep range 3-5, RPE 7-9 per set.

**Power/plyometric phase:** 2 sessions per week per movement pattern. 1-3 reps per set, 8-12 sets, short rest intervals, RPE-based loading. Often programmed as an EMOM. Example: weighted box jumps as a 12-minute EMOM, 2 jumps per minute, 24" box, holding a 10 lb ball — followed in a subsequent session by broad jumps for distance at a similar rep scheme. **Weekly ceiling: 24-36 total power/plyo sets**, adjusted down based on the athlete's current practice load.

**Conditioning phase:** high reps, lower external load, moved with speed/intensity but sustainable across the session. Think in terms of time-under-tension at a given RPE rather than fixed set/rep counts. **Weekly frequency: 4-6 conditioning sessions if the athlete isn't currently practicing their sport; dial back when they are practicing**, since practice itself supplies conditioning stimulus. Pair pure conditioning sessions with technique/skills-focused practice days rather than full-speed/live practice days, to avoid stacking fatigue.

Favor training movements over isolated muscle groups, but still track muscle-group volume in the background so no body part gets inadvertently over- or under-programmed across a week.

## Progression and Deloads

Progression is performance-triggered, not calendar-triggered. If the athlete continues progressing session to session, stay in the current phase — no deload needed. If they stall or regress across sessions, deload.

**Deload protocol:** cut intensity/weight by ~50%.
- For a highly committed/"gym rat" athlete: reduce weight only, keep session frequency and volume similar.
- For a less-invested athlete: reduce both weight AND session frequency.
- Rare, severe burnout cases: full time off from the gym.

**Deload duration: one week**, standard, regardless of how severe the stall/regression was or whether it was triggered by physical or life/emotional stress. This length is deliberate, not arbitrary — shorter than a week doesn't give the intended mental and physical reset; longer than a week risks the athlete becoming complacent and losing conditioning. Exception: if the deload is injury-driven, duration is dictated by the athlete's physician, not this rule.

Deloads are not purely a barbell-performance decision. Non-training stressors — school load, life stress, motivation loss — can and should trigger an early deload even if lifting numbers still look fine. The body does not distinguish between emotional stress and physical stress load; program accordingly.

## Exercise Selection and Substitution Hierarchy

Define main lifts as the primary compound movements the block is built around; accessories support them.

**Universal substitution priority for any main lift** (driven primarily by equipment access): barbell → machine → dumbbell/kettlebell → bodyweight (add resistance via single-leg/unilateral variations when no external load is available).

## Warm-Up and Cool-Down Standards

**Warm-up:** 5-15 minutes, dynamic movements, general + specific to that day's training. Length is driven by what the athlete has already done that day, not a fixed formula — short warm-up if the session follows practice, longer warm-up if it's a standalone/first session of the day. No fixed starting sequence; leg swings and inchworms are reliable go-to staples. For conditioning-day warm-ups, bias toward hip/leg activation and building up short-sprint/agility intensity. **Minimum floor: never skip the warm-up entirely, even in a heavily time-crunched session.** At minimum, do a few minutes of brief dynamic movement (e.g., jumping jacks) followed by warm-up sets of that day's actual movements at bodyweight or very light load — the compressed version stays specific to what's about to be trained, it doesn't become generic filler.

**Cool-down:** conditional on available time, 5-10 minutes when used. Static stretching of the muscle groups worked that session. Not always programmed — skip when time doesn't allow, but don't treat it as pure theater when it is included.

## Session Sequencing

**Strength sessions:** dynamic warm-up → main lifts/resistance training → short metcon (8-15 min) using movements that support the main lifts (e.g., main lifts of Bulgarian split squat + DB overhead press → metcon of lunges, pushups, kettlebell swings, waiter carries).

**Conditioning sessions:** warm-up focused on hip/leg activation and building sprint/agility intensity → sport-specific conditioning as the main bulk (basketball: suicides, defensive slides, jumps; volleyball: short starts/stops, backpedaling, jumping; soccer: longer sprints, change of direction).

## Red-Flag / Injury Protocols

Default posture: train around a nagging issue (knee, shoulder, hamstring), don't stop.
- For a lower-body issue: shift session focus to upper body work rather than modifying load/ROM on the affected joint.
- For an upper-body issue (e.g., a nagging shoulder): handle with more granularity than the lower-body rule — don't do a full swap to lower-body-only. Instead, avoid the specific exercises/movements that cause direct discomfort, and keep training everything else as normal.
- **Escalate to "see a professional":** if there's no improvement within one week of training around it.
- **All-stop, immediately:** any acute, sudden-onset pain triggered by a specific incident. Do not train around this — this is categorically different from gradual/nagging discomfort.

## Testing and Proof

Test major lifts (squat, bench, deadlift), vertical jump, broad jump, 40m sprint, and longer sprint distances for field-sport athletes (e.g., soccer). Retest on roughly a 12-week cycle.

**Expected gains over a 12-week block** (for calibrating app expectations, not as a guarantee): 10-30% improvement on strength movements, 4-8" on vertical jump, 0.1-1.0s improvement on 40-yard dash. Beginners will see gains toward the higher end of these ranges; athletes with several years of training experience will see gains toward the lower end. Use this range to flag when a result is meaningfully below expectation — worth an adherence/recovery check — versus within normal variation.

If numbers didn't move despite full adherence: in Joe's 20+ years of coaching, this essentially doesn't happen — if an athlete actually showed up and did the program, they improve. The realistic failure mode is under-performing *expectations*, not zero progress. Troubleshoot in this order: volume first, then intensity, then exercise selection/recovery factors.

## Debugging Logic: "The Program Didn't Work"

*Joe's answer, verbatim in intent, to: if an athlete followed a program for 8 weeks and it didn't work, what would you look at first?*

Before diagnosing anything, get specific about what "didn't work" actually means — vague dissatisfaction isn't a diagnosis, and clear goals/expectations should have been established before the block started. Once the actual gap is defined:

1. **First, look at session-to-session weight progression.** Was the athlete actually progressing load week over week, or did it plateau early?
2. **Then ask about sleep, nutrition, and recovery.** These are usually the answer when the program itself was sound but results lagged.

This is the standard troubleshooting sequence the app should walk through before ever concluding the program design itself was flawed.
