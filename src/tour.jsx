// ─── FIRST-RUN APP TOUR ───────────────────────────────────────────────────────
// Coach-mark spotlight tour shown once per account (athlete + coach), narrated in
// Joe's voice. The offer re-appears every login until the user RESOLVES it (takes
// the tour or taps "No thanks") — closing the app mid-offer doesn't count.
// Resolution is tour_done_at on the athletes/coaches row, so it follows the
// account across devices.
//
// COPY RULE (Will, 2026-07-27): every card is written for someone who has never
// seen WILCO, doesn't keep a workout journal, and may be new to the gym. No
// insider shorthand, no undefined terms ("1RM", "The Proof", "program" all get
// spelled out), and every step names the screen it's talking about via `banner`.
//
// Everything the tour shows is display-only. The Quick Log demo runs on the
// fixture below (never the athlete's parked draft — see the `demo` guards in
// QuickLogSheet), the chat exchange is scripted (no AI call, no transcript
// write), and Replay from Settings runs the identical rails: real data is never
// deleted, never written, and is exactly as it was the moment the tour ends.
//
// Deliberately NOT importing from App.jsx: App imports this file eagerly, so a
// back-import would be a live circular init (coach.jsx/builder.jsx get away with
// it only because they're lazy). The handful of palette values are copied.
import { useEffect, useState } from "react";

// REBRAND 2026-08-07. These MUST be kept in sync by hand with CA in App.jsx — the
// comment above explains why this file cannot import them. If CA changes, change these.
const T = {
  navy2:"#FFFFFF", navy3:"#F7F4EF", border:"#D9D2C7",
  text:"#1F2A37", muted:"#6B7280", muted2:"#4B5563",
  accent:"#28508B", cyan:"#5B7FB5",
  btn:"#28508B",            // flat: the brand bans gradients
  glow:"transparent",       // and glows
  onAccent:"#F7F4EF",
};
// Spotlight scrim. Still a DARK dim even though the app is now light — a spotlight has
// to suppress everything around the cutout, and dimming light-on-light reads as nothing.
// Dropped 0.82 -> 0.55 and moved off near-black onto the brand ink.
const DIM = "rgba(31,42,55,0.55)";

// ── SAMPLE DATA (Quick Log demo) ─────────────────────────────────────────────
// One believable bench day. Number-first like a real draft; the top single is
// the PR the scripted reply celebrates. Tagged SAMPLE in the sheet header so
// nobody thinks they already have a session on file.
export const TOUR_QL_FIXTURE = {
  draft:
`Bench Press 3x5 @ 175
Bench Press 1x1 @ 190
Incline DB Press 3x10 @ 60
Chest-Supported Row 3x12 @ 120
Tricep Pushdown 3x15 @ 45`,
  notes: "Bench day. 175 moved fast last week, if the top sets feel crisp, 190 is there for a single.",
};

// The scripted chat exchange the demo send plays. No AI call — the reply is
// fixed, which also keeps the tour working on preview deploys (no AI key).
// `session` drives the WORKOUT #N stamp that follows the NEW MAX stamp, exactly
// like a real logged session does (see the send() stamp handoff in App.jsx).
export const TOUR_SCRIPT = {
  pr: { exercise:"Bench Press", weight:190, unit:"lb" },
  session: 1,
  reply: "Logged it. 190 on bench is a new max, that's the standard now. Rows and pushdowns in the book too. That's how a session should end.",
};

// ── COPY ─────────────────────────────────────────────────────────────────────
// Per step:
//   banner  — screen name pinned to the top of the display ("you are here")
//   target  — data-tour anchor. An ARRAY unions the rects (chat + its input box
//             read as one region). null → centered card over a full dim.
//   parts   — tap-through text stages; the second lands with emphasis
//   partTargets / interactive / noDim — scalars, or arrays indexed by part
//   cta     — label of a button that must be pressed instead of tapping through
export const athleteTourSteps = ({ free }) => free ? [
  { key:"chat", banner:"WILCO CHAT BOT", target:["chat","chat-input"], title:"TALK TO ME",
    parts:["WILCO is your AI strength coach. Text me like you'd text a real coach: workouts you finished, questions, a knee that's acting up. All of it goes in the box at the bottom."] },
  { key:"thanks", banner:null, target:null, title:"THANKS FOR USING WILCO",
    parts:["We hope you love it as much as we do.\nJoe"], cta:"Finish" },
] : [
  { key:"chat", banner:"WILCO CHAT BOT", target:["chat","chat-input"], title:"TALK TO ME",
    parts:["WILCO is your AI strength coach. This chat is the whole app, really. Text me like you'd text a real coach: workouts you finished, questions, a knee that's acting up. All of it goes in the box at the bottom."] },

  { key:"program", banner:"THE PROGRAM TAB", target:"program-btn", title:"YOUR PROGRAM",
    parts:[
      "Your program is your training plan: which days you train and exactly what you do on each of those days. If your coach is programming for you, it'll show up here. Got your own program already? Paste it in or drop in a screenshot.",
      "Don't have one? No problem. You can build one right here.",
    ],
    cta:"Show me the builder →" },

  { key:"builder", banner:"THE PROGRAM BUILDER", target:"builder-tab", title:"TAKE YOUR TIME ON THIS ONE",
    parts:[
      "This is where you and I build your plan together. Tell me what you're working toward and I'll write the workouts for you. The more you tell me, the better the plan fits. \"Get stronger\" gives me almost nothing. \"I want to add 30 pounds to my squat by October, I can train 3 days a week, and I have a bad left knee\" gives me everything.",
      "These are the workouts you'll actually be following. Take the time to make them yours.",
    ] },

  { key:"programClose", banner:"THE PROGRAM TAB", target:"program-close", title:null,
    parts:["Once your program's in place, you're ready to log your first workout. Let's do one right now."],
    cta:"Continue →" },

  { key:"quicklog", banner:"QUICK LOG", target:"quicklog-btn", title:"⚡ QUICK LOG", interactive:true,
    parts:["When you finish training, this button is how you log what you did."],
    hint:"Tap it" },

  // Inside the sheet. Part 0 shows the WHOLE sample log with nothing dimmed —
  // the point is that they see what a filled-out log actually looks like. Part 1
  // narrows the spotlight to the send button and waits for the real tap.
  // No banner: the sheet's own header already reads "⚡ QUICK LOG · SAMPLE", and
  // a pill on top of it just collides.
  { key:"qlSheet", banner:null, target:"ql-send", title:null,
    noDim:[true,false], interactive:[false,true], partTargets:[null,"ql-send"],
    parts:[
      "This is today's workout, already filled out for you. It's built from the program saved in your Program tab, plus anything you told me in chat that day. After you train, you open this, fix anything that went differently, and send it. Prefer typing? You can always just tell me your workout in the chat instead. This is just a shortcut.",
      "This one's a sample workout. Go ahead, hit Send to Chat.",
    ],
    hint:"Tap Send to Chat" },

  { key:"script", banner:null, target:null, script:true, parts:[] },

  // What just happened, as a tour card rather than a third chat bubble (Will):
  // the tutorial explains itself instead of putting teaching text in Joe's mouth.
  // noDim so the workout they just sent and Joe's reply stay readable behind it.
  { key:"logged", banner:"WILCO CHAT BOT", target:null, noDim:true, title:null,
    parts:["See that? Sending it to chat logged the whole session and caught your PR. Anything else you tell me, injuries included, I take note of too."] },

  { key:"mylog", banner:"MY LOG", target:"mylog-btn", title:"MY LOG",
    parts:["Every session you've logged lives here. And once a week, The Proof drops. The Proof is a news-feed overview of your training: you zoom out from the day to day, see which direction you're headed and how close you are to your goals, and have a conversation with WILCO over any changes you want to make."] },

  { key:"progress", banner:"PROGRESS", target:"progress-btn", title:"PROGRESS",
    parts:[
      "Your numbers, rankings, strength standards and personal records are all stored here. When your program calls for a percentage or an estimated weight, I work it off your true 1-rep max if you've entered one, or off my best estimate built from what you've actually logged.",
      "The more you log, the sharper this gets.",
    ] },

  { key:"thanks", banner:null, target:null, title:"THANKS FOR USING WILCO",
    parts:["We hope you love it as much as we do.\nJoe"], cta:"Finish" },
];

export const coachTourSteps = () => [
  { key:"overview", banner:"THE OVERVIEW TAB", target:"coach-tab-overview", title:"YOUR MORNING GLANCE",
    parts:["Start here. Who trained, who's gone quiet, and what needs your eyes today, before you've had your coffee."] },
  { key:"athletes", banner:"THE ATHLETES TAB", target:"coach-tab-athletes", title:"YOUR ROSTER",
    parts:[
      "Every athlete you coach lives here: their workout log, their numbers, and the training plan they're following.",
      "Any change you make to an athlete's plan is staged for you to review before they ever see it.",
    ] },
  { key:"reports", banner:"THE REPORTS TAB", target:"coach-tab-reports", title:"REPORTS",
    parts:["Weekly write-ups covering your whole roster. The story of your program, written while you coach it."] },
  { key:"thanks", banner:null, target:null, title:"THANKS FOR USING WILCO",
    parts:["We hope you love it as much as we do.\nJoe"], cta:"Finish" },
];

// Joe's first real message, landed the moment the first-run tour finishes (the
// scripted exchange and sample data are already gone). Free tier gets the
// no-Quick-Log variant.
export const tourWelcome = (firstName, free) => free
  ? `Welcome, ${firstName}. Tell me what you're training for and we'll get to work.`
  : `Welcome, ${firstName}. Glad to see you've joined, let's get to work. Ready to log your first workout, or want to build your program first?`;

// ── OFFER POPUP ──────────────────────────────────────────────────────────────
// Doubles as the app's welcome moment: it's the first thing a brand-new account
// ever sees. Replay (from Settings) skips it entirely and starts the tour, so
// the "welcome" framing only ever shows on a genuine first run.
export function TourOffer({ role="athlete", onStart, onDecline }) {
  const body = role==="coach"
    ? "Want a quick tour? I'll show you where everything lives on your dashboard."
    : "Want a quick tour? I'll show you where everything lives.";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(31,42,55,0.55)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-up" style={{width:"100%",maxWidth:360,background:T.navy2,border:`1px solid ${T.border}`,borderRadius:16,padding:22,textAlign:"center"}}>
        <img src="/icon-192.png" alt="" width={52} height={52} style={{borderRadius:13,marginBottom:10}}/>
        <div style={{...DISP,fontSize:26,color:T.cyan,letterSpacing:2}}>WELCOME TO WILCO</div>
        <div style={{color:T.muted2,fontSize:13.5,lineHeight:1.6,marginTop:6,marginBottom:16}}>{body}</div>
        <button onClick={onStart}
          style={{width:"100%",background:T.btn,boxShadow:`0 0 12px ${T.glow}`,border:"none",color:T.onAccent,borderRadius:10,padding:"13px",cursor:"pointer",fontSize:15,fontWeight:700,...DISP,letterSpacing:2}}>
          SHOW ME AROUND
        </button>
        <button onClick={onDecline}
          style={{width:"100%",background:"none",border:"none",color:T.muted,borderRadius:8,padding:"10px",cursor:"pointer",fontSize:12.5,marginTop:6}}>
          No thanks
        </button>
      </div>
    </div>
  );
}

// ── SPOTLIGHT ENGINE ─────────────────────────────────────────────────────────
// Tracks anchor rects on an interval (cheap, and survives layout shifts / pane
// animations without wiring refs through 10k lines of App.jsx). An array target
// unions its rects into one region. The dim is the ring's own giant box-shadow,
// so the hole is genuinely clear; four blocker panels around it make everything
// outside inert, and passive steps cover the hole too, so the only thing a tap
// can do is advance.
function useAnchorRect(target) {
  const key = Array.isArray(target) ? target.join("|") : (target || "");
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!key) { setRect(null); return; }
    const names = key.split("|");
    let alive = true;
    const measure = () => {
      if (!alive) return;
      let box = null;
      for (const n of names) {
        const el = document.querySelector(`[data-tour="${n}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        box = box
          ? { top:Math.min(box.top,r.top), left:Math.min(box.left,r.left),
              right:Math.max(box.right,r.right), bottom:Math.max(box.bottom,r.bottom) }
          : { top:r.top, left:r.left, right:r.right, bottom:r.bottom };
      }
      if (!box) { setRect(null); return; }
      const next = { top:box.top, left:box.left, width:box.right-box.left, height:box.bottom-box.top };
      setRect((prev) =>
        prev && Math.abs(prev.top-next.top)<1 && Math.abs(prev.left-next.left)<1 &&
        Math.abs(prev.width-next.width)<1 && Math.abs(prev.height-next.height)<1
          ? prev : next);
    };
    measure();
    const iv = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("resize", measure); };
  }, [key]);
  return rect;
}

// Scalar-or-per-part step fields.
const atPart = (v, part, fallback) =>
  Array.isArray(v) ? (v[part] !== undefined ? v[part] : fallback) : (v !== undefined ? v : fallback);

// Exported so App.jsx's tap handler agrees with the overlay about which parts
// wait on a real tap (a per-part array is truthy, so `!!step.interactive` lies).
export const tourInteractiveAt = (step, part) => !!atPart(step?.interactive, part, false);

export function TourSpotlight({ step, part, steps, stepIndex, onTap, onCta, onSkip }) {
  const target = step.partTargets ? atPart(step.partTargets, part, step.target) : step.target;
  const interactive = atPart(step.interactive, part, false);
  const noDim = atPart(step.noDim, part, false);
  const rect = useAnchorRect(noDim ? null : target);
  const pad = Array.isArray(target) || target === "chat" ? 2 : 6;
  const text = step.parts[Math.min(part, step.parts.length - 1)] || "";
  const lastPart = part >= step.parts.length - 1;
  const showCta = !!step.cta && lastPart;

  // Progress dots skip the invisible scripted step so the count matches what
  // the user actually sees.
  const visible = (steps || []).filter(s => !s.script);
  const dotCount = visible.length;
  const dotIndex = Math.max(0, visible.findIndex(s => s.key === step.key));

  const Banner = step.banner ? (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:1104,display:"flex",justifyContent:"center",
      paddingTop:"calc(8px + env(safe-area-inset-top, 0px))",paddingBottom:8,pointerEvents:"none",
      background:"linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(31,42,55,0.55) 70%, rgba(247,244,239,0) 100%)"}}>
      <div style={{...DISP,fontSize:13,letterSpacing:3,color:T.cyan,
        border:`1px solid ${T.cyan}55`,borderRadius:999,padding:"4px 14px",background:"rgba(31,42,55,0.55)"}}>
        {step.banner}
      </div>
    </div>
  ) : null;

  // Script step: invisible full blocker — the chat plays underneath, taps do
  // nothing, Skip stays available.
  if (step.script) {
    return (
      <div style={{position:"fixed",inset:0,zIndex:1100}}>
        <SkipBtn onSkip={onSkip}/>
      </div>
    );
  }

  const hole = rect && !noDim
    ? { top:rect.top-pad, left:rect.left-pad, width:rect.width+pad*2, height:rect.height+pad*2 }
    : null;

  // Card below the hole when there's room, above it when there's room up top,
  // centered otherwise (a hole that fills the screen — the chat step).
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let cardTop = "38%", cardBottom = null;
  if (noDim) { cardTop = null; cardBottom = 16; }        // full screen visible; card sits at the bottom
  else if (hole) {
    const spaceBelow = vh - (hole.top + hole.height);
    if (spaceBelow > 250) cardTop = hole.top + hole.height + 12;
    else if (hole.top > 250) { cardTop = null; cardBottom = vh - hole.top + 12; }
  }

  // The dim is FOUR PANELS around the hole, not one giant box-shadow spread off
  // the ring. The shadow approach painted over the spotlit control and the card
  // no matter their z-index — a bright blue Send button rendered as muddy navy.
  // Panels leave the hole genuinely untouched, and they double as the tap
  // blockers that keep the tour on rails.
  const panel = (extra) => ({ position:"fixed", background:DIM, zIndex:1101, ...extra });
  const clear = (extra) => ({ position:"fixed", background:"transparent", zIndex:1101, ...extra });
  const tapProps = interactive ? {} : { onClick: onTap };

  return (
    <>
      {Banner}
      {/* Ring: 2px cyan + outer glow only, never a fill or inner glow (both wash
          over controls that have their own colour). Deliberately loud — at 1.5px
          over a dark UI the "highlighted" control read as merely less-dark. */}
      {hole && (
        <div style={{position:"fixed",top:hole.top,left:hole.left,width:hole.width,height:hole.height,
          borderRadius:12,border:`2px solid ${T.cyan}`,
          boxShadow:"0 0 18px 2px rgba(55,230,255,.55)",
          animation:"tourPulse 1.8s ease-in-out infinite",
          transition:"top .35s ease, left .35s ease, width .35s ease, height .35s ease",
          pointerEvents:"none",zIndex:1102}}/>
      )}
      {noDim ? (
        // Nothing dimmed (the whole sample log has to be readable), but the tour
        // still owns every tap.
        <div style={clear({inset:0})} {...tapProps}/>
      ) : hole ? (
        <>
          <div style={panel({top:0,left:0,right:0,height:Math.max(0,hole.top)})} {...tapProps}/>
          <div style={panel({top:hole.top,left:0,width:Math.max(0,hole.left),height:hole.height})} {...tapProps}/>
          <div style={panel({top:hole.top,left:hole.left+hole.width,right:0,height:hole.height})} {...tapProps}/>
          <div style={panel({top:hole.top+hole.height,left:0,right:0,bottom:0})} {...tapProps}/>
          {/* passive steps: the hole is inert too, so a stray tap just advances */}
          {!interactive && <div style={clear({top:hole.top,left:hole.left,width:hole.width,height:hole.height})} {...tapProps}/>}
        </>
      ) : (
        <div style={panel({inset:0})} {...tapProps}/>
      )}
      {/* card. Centered via left/right+margin, NOT translateX — the fade-up
          animation animates transform and would clobber it mid-flight. */}
      <div key={`${step.key}-${part}`} className="fade-up" onClick={interactive ? undefined : onTap}
        style={{position:"fixed",left:16,right:16,marginLeft:"auto",marginRight:"auto",
          ...(cardTop!==null ? {top:cardTop} : {bottom:cardBottom}),
          width:"100%",maxWidth:340,background:T.navy2,border:`1px solid ${T.border}`,
          borderRadius:14,padding:"16px 18px",zIndex:1102,cursor:interactive?"default":"pointer",
          boxShadow:"0 12px 40px rgba(31,42,55,0.35)"}}>
        {step.title && <div style={{...DISP,fontSize:19,color:T.cyan,letterSpacing:2,marginBottom:6}}>{step.title}</div>}
        <div style={{color:T.text,fontSize:13.5,lineHeight:1.65,whiteSpace:"pre-wrap"}}>{text}</div>
        {showCta && (
          <button onClick={(e)=>{e.stopPropagation();onCta();}}
            style={{width:"100%",marginTop:12,background:T.btn,boxShadow:`0 0 12px ${T.glow}`,border:"none",color:T.onAccent,borderRadius:9,padding:"11px",cursor:"pointer",fontSize:13.5,fontWeight:700,...DISP,letterSpacing:1.5}}>
            {step.cta}
          </button>
        )}
        {interactive && step.hint && (
          <div style={{color:T.cyan,fontSize:11.5,marginTop:10,letterSpacing:.5,display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:T.cyan,animation:"tourPulse 1.2s ease-in-out infinite"}}/>
            {step.hint}
          </div>
        )}
        {!interactive && !showCta && (
          <div style={{color:T.muted,fontSize:10.5,marginTop:10,letterSpacing:.5}}>Tap to continue</div>
        )}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10}}>
          <div style={{display:"flex",gap:5}}>
            {Array.from({length:dotCount}).map((_,i)=>(
              <span key={i} style={{width:6,height:6,borderRadius:"50%",background:i===dotIndex?T.cyan:T.border,display:"inline-block"}}/>
            ))}
          </div>
          <button onClick={(e)=>{e.stopPropagation();onSkip();}}
            style={{background:"none",border:"none",color:T.muted,fontSize:11.5,cursor:"pointer",padding:"2px 4px"}}>
            Skip tour
          </button>
        </div>
      </div>
      <style>{`@keyframes tourPulse{0%,100%{box-shadow:0 0 18px 2px rgba(55,230,255,.55),0 0 0 0 rgba(55,230,255,.45)}50%{box-shadow:0 0 18px 2px rgba(55,230,255,.55),0 0 0 9px rgba(55,230,255,0)}}`}</style>
    </>
  );
}

function SkipBtn({ onSkip }) {
  return (
    <button onClick={onSkip}
      style={{position:"fixed",right:14,bottom:18,zIndex:1103,
        background:"rgba(255,255,255,0.94)",border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,
        padding:"6px 12px",cursor:"pointer",fontSize:11.5}}>
      Skip tour
    </button>
  );
}
