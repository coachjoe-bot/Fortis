// ─── FIRST-RUN APP TOUR ───────────────────────────────────────────────────────
// Coach-mark spotlight tour shown once per account (athlete + coach), narrated in
// Joe's voice. The offer popup re-appears every login until the user RESOLVES it
// (takes the tour or taps "No thanks") — closing the app mid-offer doesn't count.
// Resolution is tour_done_at on the athletes/coaches row, so it follows the
// account across devices.
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
import { useEffect, useRef, useState } from "react";

const T = {
  navy2:"#0a0f1d", navy3:"#0e1830", border:"#182543",
  text:"#e6ecf6", muted:"#7c8aa3", muted2:"#aeb9cf",
  accent:"#3a7bff", cyan:"#37e6ff",
  btn:"linear-gradient(180deg,#57a0ff,#2a63e6)",
  glow:"rgba(58,123,255,.5)",
};
const DIM = "rgba(2,5,15,0.82)";

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
  notes: "Bench day. 175 moved fast last week — if the top sets feel crisp, 190 is there for a single.",
};

// The scripted chat exchange the demo send plays. No AI call — the reply is
// fixed, which also keeps the tour working on preview deploys (no AI key).
export const TOUR_SCRIPT = {
  pr: { exercise:"Bench Press", weight:190, unit:"lb" },
  reply: "Logged it. 190 on bench is a new max — that's the standard now. Rows and pushdowns in the book too. That's how a session should end.",
  followup: "See that? Sending it to chat logged the whole session and caught your PR. Anything else you tell me — injuries included — I take note of too.",
};

// ── COPY ─────────────────────────────────────────────────────────────────────
// Each step: target = data-tour anchor (null → centered card, full dim),
// parts = tap-through text stages (Will: split + fade so the second line lands
// with emphasis), interactive = the real control in the spotlight is live and
// the tour waits on it (backdrop taps do nothing).
export const athleteTourSteps = ({ free }) => free ? [
  { key:"chat", target:"chat", title:"TALK TO ME",
    parts:["Text me like you'd text your coach. Workouts, questions, all of it."] },
] : [
  { key:"chat", target:"chat", title:"TALK TO ME",
    parts:["This is the whole app, really. Text me like you'd text your coach. Finished workouts, questions, a knee that's acting up — all of it goes here."] },
  { key:"program", target:"program-btn", title:"YOUR PROGRAM",
    parts:[
      "If your coach is programming for you, it'll show up here. Got your own program? Paste it in or drop in a screenshot.",
      "Don't have one? No problem. You can build one right here.",
    ],
    cta:"Show me the builder →" },
  { key:"builder", target:"builder-tab", title:"TAKE YOUR TIME ON THIS ONE",
    parts:[
      "This is where you and I build programs together. The more context you give me, the better I build. \"Get stronger\" gives me almost nothing. \"Put 30 pounds on my squat by October, 3 days a week, bad left knee\" gives me everything.",
      "These are the workouts you'll actually be following. Make them yours.",
    ] },
  { key:"programClose", target:"program-close", title:null, interactive:true,
    parts:["Once your program's in place, you're ready to log. Let's do one right now."],
    hint:"Tap ✕ Close" },
  { key:"quicklog", target:"quicklog-btn", title:"⚡ QUICK LOG", interactive:true,
    parts:["After you train, hit this. Today's workout is already filled out from your program, plus anything you told me in chat. Look it over, fix what needs fixing, send it. You can always just type your workout to me in chat instead — this is the shortcut."],
    hint:"Tap it" },
  { key:"qlSend", target:"ql-send", title:null, interactive:true,
    parts:["Go ahead, hit Send to Chat."] },
  { key:"script", target:null, script:true, parts:[] },
  { key:"mylog", target:"mylog-btn", title:"MY LOG",
    parts:["Every session you've logged lives here. And once a week, The Proof drops: this is where you zoom out from the day to day, see which direction you're headed, how close you are to your goals, and have a conversation over any changes in them."] },
  { key:"progress", target:"progress-btn", title:"PROGRESS",
    parts:[
      "Your numbers. Rankings, strength standards, PRs. Percentages and estimated weights run off your real 1RM if you've put one in, or your e1RM from what you've logged.",
      "The more you log, the sharper this gets.",
    ] },
];

export const coachTourSteps = () => [
  { key:"overview", target:"coach-tab-overview", title:"YOUR MORNING GLANCE",
    parts:["Start here. Who trained, who's gone quiet, and what needs your eyes today — before you've had your coffee."] },
  { key:"athletes", target:"coach-tab-athletes", title:"YOUR ROSTER",
    parts:[
      "Every athlete lives here — their log, their numbers, their program.",
      "Program edits you make are staged and reviewed before the athlete sees a thing.",
    ] },
  { key:"reports", target:"coach-tab-reports", title:"REPORTS",
    parts:["Weekly rollups of the whole roster. The story of your program, written while you coach it."] },
];

// Joe's first real message, landed the moment the first-run tour finishes (the
// scripted exchange and sample data are already gone). Free tier gets the
// no-Quick-Log variant.
export const tourWelcome = (firstName, free) => free
  ? `Welcome, ${firstName}. Tell me what you're training for and we'll get to work.`
  : `Welcome, ${firstName}. Glad to see you've joined — let's get to work. Ready to log your first workout, or want to build your program first?`;

// ── OFFER POPUP ──────────────────────────────────────────────────────────────
export function TourOffer({ role="athlete", free=false, onStart, onDecline }) {
  const body = role==="coach"
    ? "I'll show you where everything lives on your dashboard."
    : free
      ? "I'll show you how WILCO works."
      : "I'll show you where everything lives, and you'll log a workout on the way.";
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(3,8,20,0.88)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div className="fade-up" style={{width:"100%",maxWidth:360,background:T.navy2,border:`1px solid ${T.border}`,borderRadius:16,padding:22,textAlign:"center"}}>
        <img src="/icon-192.png" alt="" width={52} height={52} style={{borderRadius:13,marginBottom:10}}/>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:T.cyan,letterSpacing:2}}>WANT A QUICK TOUR?</div>
        <div style={{color:T.muted2,fontSize:13.5,lineHeight:1.6,marginTop:6,marginBottom:16}}>{body}</div>
        <button onClick={onStart}
          style={{width:"100%",background:T.btn,boxShadow:`0 0 12px ${T.glow}`,border:"none",color:"#02040c",borderRadius:10,padding:"13px",cursor:"pointer",fontSize:15,fontWeight:700,fontFamily:"'Bebas Neue'",letterSpacing:2}}>
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
// Tracks the anchor's rect on an interval (cheap, and survives layout shifts /
// pane animations without wiring refs through 10k lines of App.jsx). The dim is
// the spotlight ring's own giant box-shadow, so the hole is genuinely clear.
// Four blocker panels around the hole make everything OUTSIDE it inert; passive
// steps also cover the hole so the only thing a tap can do is advance.
function useAnchorRect(target) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!target) { setRect(null); return; }
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const el = document.querySelector(`[data-tour="${target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && Math.abs(prev.top-r.top)<1 && Math.abs(prev.left-r.left)<1 &&
        Math.abs(prev.width-r.width)<1 && Math.abs(prev.height-r.height)<1
          ? prev : { top:r.top, left:r.left, width:r.width, height:r.height });
    };
    measure();
    const iv = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("resize", measure); };
  }, [target]);
  return rect;
}

export function TourSpotlight({ step, part, stepIndex, stepCount, onTap, onCta, onSkip }) {
  const rect = useAnchorRect(step.target);
  const pad = step.target === "chat" ? 0 : 6;
  const text = step.parts[Math.min(part, step.parts.length - 1)] || "";
  const lastPart = part >= step.parts.length - 1;

  // Script step: invisible full blocker — the chat plays underneath, taps do
  // nothing, Skip stays available.
  if (step.script) {
    return (
      <div style={{position:"fixed",inset:0,zIndex:1100}}>
        <SkipBtn onSkip={onSkip}/>
      </div>
    );
  }

  const hole = rect
    ? { top:rect.top-pad, left:rect.left-pad, width:rect.width+pad*2, height:rect.height+pad*2 }
    : null;

  // Card below the hole when there's room, above it when there's room up top,
  // centered INSIDE it otherwise (the whole-chat step: the hole ~is the screen).
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  let cardTop = "40%", cardBottom = null;
  if (hole) {
    const spaceBelow = vh - (hole.top + hole.height);
    if (spaceBelow > 230) { cardTop = hole.top + hole.height + 12; }
    else if (hole.top > 230) { cardTop = null; cardBottom = vh - hole.top + 12; }
    // else: keep the centered default — the card floats over the spotlit region
  }

  const blockerStyle = { position:"fixed", background:"transparent", zIndex:1101 };
  const tapProps = step.interactive ? {} : { onClick: onTap };

  return (
    <>
      {/* dim + ring (pointer-transparent; the hole punches through the shadow) */}
      {hole ? (
        <div style={{position:"fixed",top:hole.top,left:hole.left,width:hole.width,height:hole.height,
          borderRadius:12,boxShadow:`0 0 0 200vmax ${DIM}`,border:`1.5px solid ${T.cyan}`,
          animation:"tourPulse 1.6s ease-in-out infinite",
          transition:"top .35s ease, left .35s ease, width .35s ease, height .35s ease",
          pointerEvents:"none",zIndex:1100}}/>
      ) : (
        <div style={{position:"fixed",inset:0,background:DIM,zIndex:1100}} {...tapProps}/>
      )}
      {/* blocker panels: outside the hole always inert; hole covered too on passive steps */}
      {hole && (
        <>
          <div style={{...blockerStyle,top:0,left:0,right:0,height:Math.max(0,hole.top)}} {...tapProps}/>
          <div style={{...blockerStyle,top:hole.top,left:0,width:Math.max(0,hole.left),height:hole.height}} {...tapProps}/>
          <div style={{...blockerStyle,top:hole.top,left:hole.left+hole.width,right:0,height:hole.height}} {...tapProps}/>
          <div style={{...blockerStyle,top:hole.top+hole.height,left:0,right:0,bottom:0}} {...tapProps}/>
          {!step.interactive && <div style={{...blockerStyle,top:hole.top,left:hole.left,width:hole.width,height:hole.height}} {...tapProps}/>}
        </>
      )}
      {/* card */}
      {/* Centered via left/right+margin, NOT translateX — the fade-up animation
          animates transform and would clobber it mid-flight. */}
      <div key={`${step.key}-${part}`} className="fade-up" onClick={step.interactive ? undefined : onTap}
        style={{position:"fixed",left:16,right:16,marginLeft:"auto",marginRight:"auto",
          ...(cardTop!==null ? {top:cardTop} : {bottom:cardBottom}),
          width:"100%",maxWidth:340,background:T.navy2,border:`1px solid ${T.border}`,
          borderRadius:14,padding:"16px 18px",zIndex:1102,cursor:step.interactive?"default":"pointer",
          boxShadow:"0 12px 40px rgba(0,0,0,.55)"}}>
        {step.title && <div style={{fontFamily:"'Bebas Neue'",fontSize:19,color:T.cyan,letterSpacing:2,marginBottom:6}}>{step.title}</div>}
        <div style={{color:T.text,fontSize:13.5,lineHeight:1.65,whiteSpace:"pre-wrap"}}>{text}</div>
        {step.cta && lastPart && (
          <button onClick={(e)=>{e.stopPropagation();onCta();}}
            style={{width:"100%",marginTop:12,background:T.btn,boxShadow:`0 0 10px ${T.glow}`,border:"none",color:"#02040c",borderRadius:9,padding:"11px",cursor:"pointer",fontSize:13.5,fontWeight:700,fontFamily:"'Bebas Neue'",letterSpacing:1.5}}>
            {step.cta}
          </button>
        )}
        {step.interactive && step.hint && (
          <div style={{color:T.cyan,fontSize:11.5,marginTop:10,letterSpacing:.5,display:"flex",alignItems:"center",gap:6}}>
            <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:T.cyan,animation:"tourPulse 1.2s ease-in-out infinite"}}/>
            {step.hint}
          </div>
        )}
        {!step.interactive && !(step.cta && lastPart) && (
          <div style={{color:T.muted,fontSize:10.5,marginTop:10,letterSpacing:.5}}>Tap to continue</div>
        )}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:10}}>
          <div style={{display:"flex",gap:5}}>
            {Array.from({length:stepCount}).map((_,i)=>(
              <span key={i} style={{width:6,height:6,borderRadius:"50%",background:i===stepIndex?T.cyan:T.border,display:"inline-block"}}/>
            ))}
          </div>
          <button onClick={(e)=>{e.stopPropagation();onSkip();}}
            style={{background:"none",border:"none",color:T.muted,fontSize:11.5,cursor:"pointer",padding:"2px 4px"}}>
            Skip tour
          </button>
        </div>
      </div>
      <style>{`@keyframes tourPulse{0%,100%{box-shadow:0 0 0 200vmax ${DIM},0 0 0 0 rgba(55,230,255,.45)}50%{box-shadow:0 0 0 200vmax ${DIM},0 0 0 7px rgba(55,230,255,0)}}`}</style>
    </>
  );
}

function SkipBtn({ onSkip }) {
  return (
    <button onClick={onSkip}
      style={{position:"fixed",right:14,bottom:18,zIndex:1103,
        background:"rgba(10,15,29,.85)",border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,
        padding:"6px 12px",cursor:"pointer",fontSize:11.5}}>
      Skip tour
    </button>
  );
}
