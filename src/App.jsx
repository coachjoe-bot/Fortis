import { useState, useEffect, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_KEY;
const COACH_PIN     = "1234";
const SPORTS = ["Football","Basketball","Volleyball","Soccer","Baseball","Archery","Olympic Weightlifting","Running"];

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
const sbH = { "Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}` };
async function sbGet(table, params="") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`,{headers:{...sbH,"Prefer":"return=representation"}});
  return r.json();
}
async function sbInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:{...sbH,"Prefer":"return=representation"},body:JSON.stringify(data)});
  return r.json();
}

// ─── CLAUDE HELPERS ───────────────────────────────────────────────────────────
async function askClaude(system, user, maxTokens=600) {
  const r = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages:[{role:"user",content:user}]})
  });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.content?.[0]?.text || "";
}

async function parseWorkout(message, name, sport) {
  const sys = `Extract workout data from an athlete message. Return ONLY valid JSON, no markdown.
{
  "exercises":[{"name":string,"sets":number|null,"reps":number|null,"weight":number|null,"unit":"lbs"|"kg"|"bodyweight","feel":"easy"|"good"|"hard"|null,"notes":string|null}],
  "pain_flags":[{"area":string,"description":string}],
  "equipment_issues":[string],
  "questions":[string],
  "pr_attempts":[{"exercise":string,"weight":number,"reps":number,"achieved":boolean}],
  "session_feel":"great"|"good"|"average"|"rough"|null,
  "general_notes":string|null
}`;
  const text = await askClaude(sys, `Athlete: ${name} (${sport})\nMessage: ${message}`, 800);
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
  catch { return {exercises:[],pain_flags:[],equipment_issues:[],questions:[],pr_attempts:[],session_feel:null,general_notes:message}; }
}

async function getJoeBotReply(message, athlete, history, workoutHistory=[]) {
  const hist = history.slice(-6).map(m=>`${m.role==="user"?athlete.name:"Coach Joe"}: ${m.content}`).join("\n");

  // Build recent workout context from Supabase logs
  let pastContext = "";
  if(workoutHistory && workoutHistory.length > 0) {
    const recentSessions = workoutHistory.slice(0, 5).map(w => {
      const d = new Date(w.created_at).toLocaleDateString();
      const exs = w.parsed_data?.exercises?.map(e =>
        `${e.name}${e.weight ? " " + e.weight + "lbs" : ""}${e.sets && e.reps ? " " + e.sets + "x" + e.reps : ""}${e.feel ? " ("+e.feel+")" : ""}`
      ).join(", ") || "";
      const pain = w.parsed_data?.pain_flags?.map(p => p.area).join(", ") || "";
      const note = w.raw_message?.slice(0, 120) || "";
      return `${d}: ${exs}${pain ? " | PAIN: "+pain : ""}${!exs ? note : ""}`;
    }).filter(Boolean).join("\n");
    pastContext = `

ATHLETE'S RECENT WORKOUT HISTORY (last ${workoutHistory.slice(0,5).length} sessions):
${recentSessions}
Use this to give context-aware advice -- reference their actual numbers, note progress or patterns, flag if something looks off.`;
  }

  // Determine training phase from season date
  let phaseContext = "";
  if(athlete._needsSeasonDate) {
    phaseContext = "The athlete has not yet provided their season start date. Your first priority in this response is to acknowledge what they said, then naturally follow up asking when their season starts if they did not mention it. Keep it brief and conversational.";
  } else if(athlete.season_date) {
    const now = new Date();
    const season = new Date(athlete.season_date);
    const weeksOut = Math.max(0, Math.round((season - now) / (7*24*60*60*1000)));
    if(weeksOut > 12) {
      phaseContext = `Training phase: STRENGTH (${weeksOut} weeks until season). Focus on building maximal strength -- compound lifts, progressive overload, 5x5 at 75-85% 1RM. Strength is the foundation. Do NOT prioritize plyometrics or sport-specific conditioning yet.`;
    } else if(weeksOut > 4) {
      phaseContext = `Training phase: POWER (${weeksOut} weeks until season). Athlete has built a strength base. Now converting to power -- Olympic lifts, jumps, med ball work, explosive movements. Still maintain strength work but reduce volume.`;
    } else if(weeksOut > 0) {
      phaseContext = `Training phase: PEAK (${weeksOut} weeks until season). Reduce volume, maintain intensity, sport-specific work. No new stressors. Keep the athlete fresh and sharp.`;
    } else {
      phaseContext = `Season is active or has passed. Focus on maintenance, recovery, and sport-specific performance.`;
    }
  } else {
    phaseContext = `No season date set. Default to strength-first programming -- build the foundation before anything else.`;
  }

  // Sport-specific priorities
  const sportPriorities = {
    "Football": "Priority: lower body power (squat, deadlift, hip hinge), upper body strength (bench, row), explosive hip extension. Linemen need max strength and mass. Skill positions need speed and change of direction.",
    "Basketball": "Priority: lower body explosiveness, vertical jump development (after strength base), lateral quickness, core stability. Build strength base first -- jumps and plyos come after.",
    "Volleyball": "Priority: vertical jump (after strength base), shoulder stability, core power, lower body strength. Approach jumps and arm swing power come from a strength foundation.",
    "Soccer": "Priority: lower body strength and power, single-leg stability, change of direction, aerobic base. Hip hinge and squat patterns are foundational.",
    "Baseball": "Priority: rotational power (hip-to-shoulder), posterior chain strength, shoulder health and stability, single-leg strength. Rotational power comes from a strong base.",
    "Archery": "Priority: shoulder stability, posterior chain, core anti-rotation strength, grip and forearm. Low-load, high-precision movements.",
    "Olympic Weightlifting": "Priority: technical proficiency on snatch and clean and jerk, posterior chain strength, mobility, overhead stability.",
    "Running": "Priority: single-leg strength, posterior chain (glutes/hamstrings), hip stability, calf and ankle strength. Running economy comes from strength, not just mileage."
  };
  const sportFocus = sportPriorities[athlete.sport] || "Build a general strength base -- squat, hinge, push, pull, carry.";

  // Experience level adjustments
  const levelContext = athlete.level === "Untrained" || athlete.level === "Beginner"
    ? "Athlete is new to training. Keep it simple -- master the basic movement patterns first. No Olympic lifts yet. Form before load, always."
    : athlete.level === "Intermediate"
    ? "Athlete has training experience. Can handle more complexity. Introduce variations, but stay disciplined with progression."
    : "Trained athlete. Can handle advanced programming. Push intensity, focus on weak points, introduce sport-specific power work when phase appropriate.";

  const sys = `You are Coach Joe Thomas -- high school strength coach with 20+ years military S&C experience and 10 years coaching high school athletes. You know these kids and you care about them getting better the right way.

ATHLETE: ${athlete.name}, Sport: ${athlete.sport}, Level: ${athlete.level || "Unknown"}
${phaseContext}
SPORT PRIORITIES: ${sportFocus}
EXPERIENCE: ${levelContext}

TONE GUIDELINES:
- Be direct and real. Not every response needs enthusiasm.
- When an athlete logs a normal workout: acknowledge it matter-of-factly. "Good work. Squat numbers are moving." Not every log deserves a celebration.
- Reserve genuine praise for actual accomplishments -- new PRs, consistency streaks, pushing through something hard.
- Phrases like "Atta boy" should be rare and earned, not a reflex.
- Casual and conversational, not corporate. Talk like a coach, not a hype machine.
- If something looks off (too heavy too fast, skipping fundamentals, pain), say so directly.

BANNED PHRASES -- do NOT use these unless the specific condition is met:
- "Atta boy" / "Atta girl": BANNED except when athlete explicitly hits a new PR or breaks a personal record. A normal logged workout does NOT qualify. Showing up does NOT qualify. If no PR was mentioned, do not use it.
- "Let's go!": BANNED as a standalone filler. Only use if genuinely fitting.
- "Get after it!": BANNED as a filler.
- Exclamation points: Use maximum ONE per response, and only when something genuinely warrants excitement.

WHEN AN ATHLETE LOGS A NORMAL WORKOUT, respond with ONE of these and nothing more elaborate:
- "Good work."
- "Solid session."
- "Numbers are moving."
- "Nice."
- "That's how it's done."
Then add one specific observation or recommendation. That's it.

RESERVED PHRASES -- only use when the situation genuinely matches:
- "Atta boy/girl": New PR only.
- "If it were easy, everybody would do it.": Athlete is struggling or doubting themselves only.
- "It's not about workout 1, it's about workout 100.": Athlete missed sessions or needs long-game perspective only.
- "You're only in competition with the you of yesterday.": Athlete is comparing themselves to others only.

RESPONSE GUIDELINES:
- Keep under 200 words.
- Use their name once, naturally -- not every sentence.
- If they mention pain or injury: suggest alternatives, tell them to back off the aggravating movement, note if it sounds like something a doctor should look at.
- If equipment is unavailable: give 2-3 specific alternatives that train the same pattern.
- For programming questions: follow the phase and sport priorities above. Always build strength before plyometrics or jump training. Always.
- For movement questions: explain setup, cues, and what they should feel. Keep it practical.
- If a question is outside your scope as a training bot: "That's one for Coach Joe directly -- email him at joe.thomas@commandengineering.com."

FORMATTING RULES -- follow these exactly:
- When listing exercises, alternatives, or steps: ALWAYS use a numbered list. One item per line.
- When explaining a movement: use short numbered steps for setup, then bullet points for cues.
- When giving a program or workout: number each exercise. Include sets x reps after each one.
- Never write exercise lists as a paragraph. Always break them into lines.
- Short conversational responses (acknowledgments, single answers) stay as plain text -- no lists needed.
- Example format for alternatives:
  Try these instead:
  1. Dumbbell bench press -- 3x8
  2. Landmine press -- 3x10
  3. Push-up variations -- 3x15
- Example format for movement breakdown:
  Setup:
  1. Bar over mid-foot
  2. Hip-width stance
  3. Hinge at the hips, grip just outside legs
  Cues:
  - Push the floor away
  - Keep the bar close
  - Lock hips and knees out together`;

  return askClaude(sys + pastContext, `${hist}\n\n${athlete.name}: ${message}`, 450);
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const C = {navy:"#060d1e",navy2:"#0a1228",navy3:"#0d1836",border:"#1e2a4a",gold:"#d4a017",green:"#10b981",red:"#ef4444",text:"#e2e8f0",muted:"#64748b",muted2:"#94a3b8"};
const GS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${C.navy};color:${C.text};font-family:'DM Sans',sans-serif;}
input,textarea,select,button{font-family:'DM Sans',sans-serif;}
::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:${C.navy2};} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
.fade-up{animation:fadeUp 0.25s ease forwards;}
`;

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FortisApp() {
  const [view,setView] = useState("login");
  const [athlete,setAthlete] = useState(null);
  const [loginData,setLoginData] = useState({name:"",sport:SPORTS[0],pin:""});
  const [loginErr,setLoginErr] = useState("");
  const [loginLoading,setLoginLoading] = useState(false);
  const [coachPin,setCoachPin] = useState("");
  const [coachErr,setCoachErr] = useState("");
  const [mode,setMode] = useState("athlete");

  const handleAthleteLogin = async () => {
    const {name,sport,pin} = loginData;
    if(!name.trim()||pin.length!==4){setLoginErr("Enter your name and a 4-digit PIN.");return;}
    setLoginLoading(true); setLoginErr("");
    try {
      const existing = await sbGet("athletes",`?name=ilike.${encodeURIComponent(name.trim())}&pin=eq.${pin}`);
      if(existing?.length>0){setAthlete(existing[0]);setView("athlete");}
      else {
        const created = await sbInsert("athletes",{name:name.trim(),sport,pin});
        if(created?.length>0){setAthlete(created[0]);setView("athlete");}
        else setLoginErr("Could not create account. Try again.");
      }
    } catch { setLoginErr("Connection error. Check your internet."); }
    setLoginLoading(false);
  };

  const handleCoachLogin = () => {
    if(coachPin===COACH_PIN){setView("coach");setCoachErr("");}
    else setCoachErr("Wrong PIN.");
  };

  if(view==="athlete"&&athlete) return <AthleteView athlete={athlete} onLogout={()=>{setAthlete(null);setView("login");}}/>;
  if(view==="coach") return <CoachDashboard onLogout={()=>setView("login")}/>;

  return (
    <div style={{minHeight:"100vh",background:C.navy,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{GS}</style>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:56,color:C.gold,letterSpacing:6,lineHeight:1}}>FORTIS</div>
          <div style={{color:C.muted,fontSize:12,letterSpacing:4,marginTop:4}}>COACH JOE-BOT</div>
        </div>
        <div style={{display:"flex",background:C.navy2,borderRadius:12,padding:4,marginBottom:24,border:`1px solid ${C.border}`}}>
          {["athlete","coach"].map(m=>(
            <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"10px",borderRadius:10,border:"none",background:mode===m?C.gold:"transparent",color:mode===m?"#000":C.muted,fontWeight:700,fontSize:13,cursor:"pointer",textTransform:"uppercase",letterSpacing:1,transition:"all 0.15s"}}>
              {m==="athlete"?"Athlete":"Coach"}
            </button>
          ))}
        </div>

        {mode==="athlete" ? (
          <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
            {[{label:"YOUR NAME",key:"name",type:"text",placeholder:"First name"},{label:"YOUR SPORT",key:"sport",type:"select"}].map(f=>(
              <div key={f.key} style={{marginBottom:16}}>
                <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>{f.label}</label>
                {f.type==="select"?(
                  <select value={loginData.sport} onChange={e=>setLoginData(p=>({...p,sport:e.target.value}))}
                    style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:15,outline:"none"}}>
                    {SPORTS.map(s=><option key={s}>{s}</option>)}
                  </select>
                ):(
                  <input value={loginData[f.key]} onChange={e=>setLoginData(p=>({...p,[f.key]:e.target.value}))}
                    onKeyDown={e=>e.key==="Enter"&&onAthleteLogin}
                    placeholder={f.placeholder} style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:15,outline:"none"}}/>
                )}
              </div>
            ))}
            <div style={{marginBottom:20}}>
              <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>4-DIGIT PIN</label>
              <input type="password" inputMode="numeric" maxLength={4} value={loginData.pin}
                onChange={e=>setLoginData(p=>({...p,pin:e.target.value.replace(/\D/g,"").slice(0,4)}))}
                onKeyDown={e=>e.key==="Enter"&&handleAthleteLogin()}
                placeholder="----" style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:24,outline:"none",letterSpacing:8,textAlign:"center"}}/>
            </div>
            {loginErr&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{loginErr}</div>}
            <button onClick={handleAthleteLogin} disabled={loginLoading}
              style={{width:"100%",background:C.gold,color:"#000",border:"none",borderRadius:12,padding:"14px",fontWeight:700,fontSize:16,cursor:loginLoading?"not-allowed":"pointer",opacity:loginLoading?0.7:1,fontFamily:"'Bebas Neue'",letterSpacing:2}}>
              {loginLoading?"Loading...":"Let's Get to Work ->"}
            </button>
            <div style={{color:C.muted,fontSize:11,textAlign:"center",marginTop:10}}>New athlete? We'll set you up automatically.</div>
          </div>
        ):(
          <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
            <div style={{marginBottom:20}}>
              <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>COACH PIN</label>
              <input type="password" inputMode="numeric" maxLength={4} value={coachPin}
                onChange={e=>setCoachPin(e.target.value.replace(/\D/g,"").slice(0,4))}
                onKeyDown={e=>e.key==="Enter"&&handleCoachLogin()}
                placeholder="----" style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:24,outline:"none",letterSpacing:8,textAlign:"center"}}/>
            </div>
            {coachErr&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{coachErr}</div>}
            <button onClick={handleCoachLogin}
              style={{width:"100%",background:C.gold,color:"#000",border:"none",borderRadius:12,padding:"14px",fontWeight:700,fontSize:16,cursor:"pointer",fontFamily:"'Bebas Neue'",letterSpacing:2}}>
              Access Dashboard ->
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ATHLETE VIEW ─────────────────────────────────────────────────────────────
function AthleteView({athlete,onLogout}) {
  const hasSeasonDate = !!(athlete.season_date);

  // Calculate days since last workout
  const getLastWorkoutDays = () => {
    if(!athlete.logs||athlete.logs.length===0) return null;
    const last = new Date(athlete.logs[athlete.logs.length-1]?.timestamp||athlete.logs[athlete.logs.length-1]?.date);
    if(isNaN(last)) return null;
    return Math.floor((new Date()-last)/(1000*60*60*24));
  };

  const buildGreeting = () => {
    if(!hasSeasonDate) {
      return `Hey ${athlete.name}, good to have you in the system. Before we get started -- when does your ${athlete.sport} season begin? Just give me a rough date like "September 1" or "end of March." That helps me make sure we're training you right for where you are in the year.`;
    }
    return `What's up, ${athlete.name}. What did you get after today?`;
  };

  const [messages,setMessages] = useState([{role:"assistant",content:buildGreeting()}]);
  const [greeted,setGreeted] = useState(false);

  // On mount, check Supabase for last workout and update greeting if needed
  useEffect(()=>{
    if(greeted||!hasSeasonDate) return;
    setGreeted(true);
    (async()=>{
      try {
        const logs = await sbGet("workouts",`?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=1&select=*`);
        if(!logs||logs.length===0) { return; }
        const lastLog = new Date(logs[0].created_at);
        const daysAgo = Math.floor((new Date()-lastLog)/(1000*60*60*24));

        // Build last session summary for context
        const lastParsed = logs[0]?.parsed_data;
        const lastExs = lastParsed?.exercises?.map(e=>
          `${e.name}${e.weight?" "+e.weight+"lbs":""}${e.sets&&e.reps?" "+e.sets+"x"+e.reps:""}`
        ).join(", ") || "";
        const lastDate = new Date(logs[0].created_at).toLocaleDateString();
        const summary = lastExs ? `Last session (${lastDate}): ${lastExs}.` : "";

        let callout = null;
        if(daysAgo>=7) {
          callout = `${athlete.name}. It's been ${daysAgo} days since your last log. That's a week. What happened? We can't build anything on inconsistency. ${summary} What did you get after today?`;
        } else if(daysAgo>=4) {
          callout = `${athlete.name}. ${daysAgo} days since your last log. It's not about workout 1 -- it's about workout 100. ${summary} What did you do today?`;
        } else if(daysAgo>=2) {
          callout = `Back at it, ${athlete.name}. ${summary} What did you get after today?`;
        } else {
          callout = summary ? `${athlete.name}. ${summary} What are you getting after today?` : null;
        }
        if(callout) { setMessages([{role:"assistant",content:callout}]); }
      } catch(e) { /* silently fail, default greeting stays */ }
    })();
  },[]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [saved,setSaved] = useState(false);
  const [workoutHistory,setWorkoutHistory] = useState([]);
  const bottomRef = useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  // Load recent workout history on mount for Joe-bot context
  useEffect(()=>{
    (async()=>{
      try {
        const logs = await sbGet("workouts",`?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=10&select=*`);
        if(logs&&logs.length>0) setWorkoutHistory(logs);
      } catch(e) {}
    })();
  },[]);

  const send = async () => {
    const msg = input.trim();
    if(!msg||loading) return;
    setInput("");
    const newMsgs = [...messages,{role:"user",content:msg}];
    setMessages(newMsgs);
    setLoading(true);
    try {
      // If athlete has no season date yet, try to extract it from this message
      const needsSeasonDate = !athlete.season_date;
      
      const [reply,parsed] = await Promise.all([
        getJoeBotReply(msg, {...athlete, _needsSeasonDate: needsSeasonDate}, newMsgs, workoutHistory),
        parseWorkout(msg,athlete.name,athlete.sport)
      ]);

      // Try to extract and save season date if we don't have one
      if(needsSeasonDate) {
        try {
          const dateExtract = await askClaude(
            "Extract a season start date from this message. Return ONLY a date in YYYY-MM-DD format, or null if no date is mentioned. No other text.",
            msg, 50
          );
          const cleaned = dateExtract.trim().replace(/[^0-9-]/g,"");
          if(cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) {
            await sbUpdate("athletes", athlete.id, {season_date: cleaned});
            const updated = {...athlete, season_date: cleaned};
            // Update local athlete state via a ref so subsequent messages use the date
            athlete.season_date = cleaned;
          }
        } catch(e) { /* couldn't extract date, that's ok */ }
      }

      // Always save the workout
      await sbInsert("workouts",{athlete_id:athlete.id,raw_message:msg,bot_reply:reply,parsed_data:parsed});
      setSaved(true); setTimeout(()=>setSaved(false),3000);

      // Auto-detect PRs by comparing to existing bests
      // Rule: must have a previous entry for that exercise -- first time logging = baseline only, not a PR
      const newPRs = [];
      if(parsed.exercises?.length>0) {
        const existingPRs = await sbGet("prs",`?athlete_id=eq.${athlete.id}`);
        const prMap = {};
        if(Array.isArray(existingPRs)) {
          existingPRs.forEach(pr => {
            const key = pr.exercise?.toLowerCase().trim();
            if(!prMap[key]||pr.weight>prMap[key].weight) prMap[key]=pr;
          });
        }

        for(const ex of parsed.exercises) {
          if(!ex.name||!ex.weight||ex.unit==="bodyweight") continue;
          const key = ex.name.toLowerCase().trim();
          const existing = prMap[key];

          if(!existing) {
            // First time logging this exercise -- save as baseline but do NOT flag as PR
            await sbInsert("prs",{athlete_id:athlete.id,exercise:ex.name,weight:ex.weight,reps:ex.reps||1});
          } else if(ex.weight > existing.weight) {
            // Beat their previous best -- this is a real PR
            await sbInsert("prs",{athlete_id:athlete.id,exercise:ex.name,weight:ex.weight,reps:ex.reps||1});
            newPRs.push({exercise:ex.name,weight:ex.weight,prev:existing.weight,diff:ex.weight-existing.weight});
          }
        }
      }

      // If new PRs were hit, append a callout to Joe-bot's reply
      if(newPRs.length>0) {
        const prCallout = newPRs.map(pr=>
          `${pr.exercise}: ${pr.weight}lbs (+${pr.diff}lbs over previous best of ${pr.prev}lbs)`
        ).join("\n");
        const prMsg = `\n\nNEW PR ALERT:\n${prCallout}\n\nCall this out in Coach Joe's voice. This is earned -- acknowledge it directly. One line per PR.`;
        try {
          const prReply = await askClaude(
            `You are Coach Joe Thomas. An athlete just hit a new personal record. Acknowledge it directly in your voice. No fluff, no paragraph -- just a short punchy callout. "Atta boy/girl" is appropriate here if it fits.`,
            `Athlete: ${athlete.name} (${athlete.sport})\nNew PRs hit today:\n${prCallout}`,
            150
          );
          setMessages(prev=>[...prev,{role:"assistant",content:prReply}]);
        } catch(e) {
          // Fallback PR message
          setMessages(prev=>[...prev,{role:"assistant",content:newPRs.map(pr=>`New PR -- ${pr.exercise} at ${pr.weight}lbs. +${pr.diff}lbs over your previous best. That's what the work is for.`).join("\n")}]);
        }
      }
      setMessages(prev=>[...prev,{role:"assistant",content:reply}]);
    } catch(e) {
      setMessages(prev=>[...prev,{role:"assistant",content:"Hit a snag -- "+e.message+". Try again."}]);
    }
    setLoading(false);
  };

  const quick = ["Bench rack was taken","My knee is bothering me","I'm at the hotel gym","Can't do pull-ups today"];

  return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:C.navy,maxWidth:600,margin:"0 auto"}}>
      <style>{GS}</style>
      <div style={{background:C.navy2,borderBottom:`1px solid ${C.border}`,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:C.gold,letterSpacing:2}}>COACH JOE-BOT</div>
          <div style={{color:C.muted,fontSize:11}}>{athlete.name} · {athlete.sport}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {saved&&<div style={{background:"#0a1e0a",border:`1px solid ${C.green}`,borderRadius:8,padding:"4px 10px",color:C.green,fontSize:11,fontWeight:600}}>Saved</div>}
          <button onClick={onLogout} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12}}>Log Out</button>
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"16px 16px 8px"}}>
        {messages.map((m,i)=>(
          <div key={i} className="fade-up" style={{marginBottom:12,display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#000",flexShrink:0,marginRight:8,marginTop:2}}>J</div>}
            <div style={{maxWidth:"80%",padding:"10px 14px",borderRadius:m.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",background:m.role==="user"?C.gold:C.navy2,color:m.role==="user"?"#000":C.text,fontSize:14,lineHeight:1.7,border:m.role==="assistant"?`1px solid ${C.border}`:"none",whiteSpace:"pre-wrap"}}>
              {m.content}
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#000"}}>J</div>
            <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:"16px 16px 16px 4px",padding:"12px 16px",display:"flex",gap:5,alignItems:"center"}}>
              {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.muted,animation:`pulse 1.2s ease ${i*0.2}s infinite`}}/>)}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{padding:"0 16px 8px",display:"flex",gap:6,overflowX:"auto",flexShrink:0}}>
        {quick.map(p=>(
          <button key={p} onClick={()=>setInput(p)} style={{background:C.navy3,border:`1px solid ${C.border}`,color:C.muted2,borderRadius:20,padding:"6px 12px",cursor:"pointer",fontSize:12,whiteSpace:"nowrap",flexShrink:0}}>
            {p}
          </button>
        ))}
      </div>

      <div style={{padding:"8px 16px 20px",flexShrink:0,borderTop:`1px solid ${C.border}`,background:C.navy2}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <textarea value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder={`Tell Coach Joe about your workout, ${athlete.name}...`} rows={2}
            style={{flex:1,background:C.navy3,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",color:C.text,fontSize:14,outline:"none",resize:"none",lineHeight:1.5}}/>
          <button onClick={send} disabled={loading||!input.trim()}
            style={{background:C.gold,border:"none",borderRadius:12,width:44,height:44,cursor:loading||!input.trim()?"not-allowed":"pointer",opacity:loading||!input.trim()?0.5:1,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#000",fontWeight:700}}>
            ->
          </button>
        </div>
        <div style={{color:C.muted,fontSize:10,marginTop:6,textAlign:"center"}}>Just type naturally. Joe-bot saves your workout automatically.</div>
      </div>
    </div>
  );
}

// ─── COACH DASHBOARD ──────────────────────────────────────────────────────────
function CoachDashboard({onLogout}) {
  const [athletes,setAthletes] = useState([]);
  const [workouts,setWorkouts] = useState([]);
  const [prs,setPrs] = useState([]);
  const [selected,setSelected] = useState(null);
  const [loading,setLoading] = useState(true);
  const [viewMode,setViewMode] = useState("conversation");
  const [search,setSearch] = useState("");
  const [filterPain,setFilterPain] = useState(false);
  const [filterEquip,setFilterEquip] = useState(false);

  useEffect(()=>{loadAll();},[]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [a,w,p] = await Promise.all([
        sbGet("athletes","?order=created_at.desc"),
        sbGet("workouts","?order=created_at.desc&select=*"),
        sbGet("prs","?order=created_at.desc")
      ]);
      setAthletes(Array.isArray(a)?a:[]);
      setWorkouts(Array.isArray(w)?w:[]);
      setPrs(Array.isArray(p)?p:[]);
    } catch(e){console.error(e);}
    setLoading(false);
  };

  const aw = selected ? workouts.filter(w=>w.athlete_id===selected.id) : [];
  const ap = selected ? prs.filter(p=>p.athlete_id===selected.id) : [];

  const lastActive = (id) => {
    const ws = workouts.filter(w=>w.athlete_id===id);
    if(!ws.length) return null;
    return new Date(ws[0].created_at);
  };
  const daysAgo = (d) => d ? Math.floor((new Date()-d)/(1000*60*60*24)) : null;

  const filtered = athletes.filter(a=>{
    if(search&&!a.name.toLowerCase().includes(search.toLowerCase())&&!a.sport.toLowerCase().includes(search.toLowerCase())) return false;
    if(filterPain&&!workouts.filter(w=>w.athlete_id===a.id).some(w=>w.parsed_data?.pain_flags?.length>0)) return false;
    if(filterEquip&&!workouts.filter(w=>w.athlete_id===a.id).some(w=>w.parsed_data?.equipment_issues?.length>0)) return false;
    return true;
  });

  return (
    <div style={{minHeight:"100vh",background:C.navy}}>
      <style>{GS}</style>
      <div style={{background:C.navy2,borderBottom:`1px solid ${C.border}`,padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:C.gold,letterSpacing:2}}>FORTIS -- COMMAND CENTER</div>
          <div style={{color:C.muted,fontSize:11}}>Coach Joe Thomas</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={loadAll} style={{background:C.navy3,border:`1px solid ${C.border}`,color:C.muted2,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12}}>Refresh</button>
          <button onClick={onLogout} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12}}>Log Out</button>
        </div>
      </div>

      <div style={{padding:20,maxWidth:1200,margin:"0 auto"}}>
        {loading ? (
          <div style={{textAlign:"center",padding:60,color:C.muted}}>Loading...</div>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:24}}>
              {[{label:"ATHLETES",val:athletes.length,color:C.gold},{label:"SESSIONS",val:workouts.length,color:C.green},{label:"PAIN FLAGS",val:workouts.reduce((n,w)=>n+(w.parsed_data?.pain_flags?.length||0),0),color:C.red},{label:"TOTAL PRs",val:prs.length,color:"#3b82f6"}].map(s=>(
                <div key={s.label} style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:32,color:s.color}}>{s.val}</div>
                  <div style={{color:C.muted,fontSize:10,letterSpacing:1}}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={{display:"grid",gridTemplateColumns:selected?"280px 1fr":"1fr",gap:20}}>
              <div>
                <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                    <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search athletes..."
                      style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",marginBottom:8}}/>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>setFilterPain(p=>!p)} style={{flex:1,background:filterPain?"#ef444420":"transparent",border:`1px solid ${filterPain?C.red:C.border}`,color:filterPain?C.red:C.muted,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>
                        Pain flags
                      </button>
                      <button onClick={()=>setFilterEquip(p=>!p)} style={{flex:1,background:filterEquip?"#d4a01720":"transparent",border:`1px solid ${filterEquip?C.gold:C.border}`,color:filterEquip?C.gold:C.muted,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11}}>
                        Equipment
                      </button>
                    </div>
                  </div>
                  {filtered.length===0 ? (
                    <div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>No athletes yet</div>
                  ) : filtered.map(a=>{
                    const d = daysAgo(lastActive(a.id));
                    const aw2 = workouts.filter(w=>w.athlete_id===a.id);
                    const hasPain = aw2.some(w=>w.parsed_data?.pain_flags?.length>0);
                    const isSel = selected?.id===a.id;
                    return (
                      <div key={a.id} onClick={()=>setSelected(isSel?null:a)}
                        style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:isSel?C.navy3:"transparent",transition:"background 0.15s",display:"flex",alignItems:"center",gap:12}}>
                        <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,color:"#000",flexShrink:0}}>
                          {a.name[0].toUpperCase()}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{color:C.text,fontWeight:600,fontSize:14}}>{a.name}</div>
                          <div style={{color:C.muted,fontSize:11}}>{a.sport} · {aw2.length} sessions</div>
                        </div>
                        <div style={{textAlign:"right",flexShrink:0}}>
                          {hasPain&&<div style={{color:C.red,fontSize:10,marginBottom:2}}>pain flag</div>}
                          <div style={{width:8,height:8,borderRadius:"50%",background:d===null?C.muted:d<=3?C.green:d<=7?C.gold:C.red,marginLeft:"auto"}}/>
                          <div style={{color:C.muted,fontSize:10}}>{d===null?"never":d===0?"today":`${d}d ago`}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {selected&&(
                <div>
                  <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,padding:20,marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                      <div style={{width:48,height:48,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:22,color:"#000"}}>{selected.name[0].toUpperCase()}</div>
                      <div>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:C.text,letterSpacing:1}}>{selected.name}</div>
                        <div style={{color:C.muted,fontSize:12}}>{selected.sport} · Since {new Date(selected.created_at).toLocaleDateString()}</div>
                      </div>
                      <a href={`mailto:joe.thomas@commandengineering.com?subject=Feedback for ${selected.name}`}
                        style={{marginLeft:"auto",background:C.gold,color:"#000",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,textDecoration:"none"}}>
                        Email Coach Joe
                      </a>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {[{l:"Sessions",v:aw.length},{l:"PRs",v:ap.length},{l:"Pain flags",v:aw.reduce((n,w)=>n+(w.parsed_data?.pain_flags?.length||0),0)},{l:"Questions",v:aw.reduce((n,w)=>n+(w.parsed_data?.questions?.length||0),0)}].map(s=>(
                        <div key={s.l} style={{background:C.navy3,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px"}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:C.gold}}>{s.v}</div>
                          <div style={{color:C.muted,fontSize:10}}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {ap.length>0&&(
                    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:16}}>
                      <div style={{color:C.gold,fontSize:11,letterSpacing:1,fontWeight:700,marginBottom:10}}>PERSONAL RECORDS</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {ap.map((pr,i)=>(
                          <div key={i} style={{background:C.navy3,border:`1px solid ${C.gold}40`,borderRadius:8,padding:"8px 12px"}}>
                            <div style={{color:C.text,fontSize:13,fontWeight:600}}>{pr.exercise}</div>
                            <div style={{color:C.gold,fontFamily:"'Bebas Neue'",fontSize:18}}>{pr.weight} lbs</div>
                            <div style={{color:C.muted,fontSize:10}}>{pr.reps} reps</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{display:"flex",gap:8,marginBottom:12}}>
                    {["conversation","structured"].map(m=>(
                      <button key={m} onClick={()=>setViewMode(m)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${viewMode===m?C.gold:C.border}`,background:viewMode===m?C.gold+"20":"transparent",color:viewMode===m?C.gold:C.muted,cursor:"pointer",fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:1}}>
                        {m==="conversation"?"Conversation":"Structured Data"}
                      </button>
                    ))}
                  </div>

                  {viewMode==="conversation"&&(
                    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                      {aw.length===0 ? <div style={{padding:24,textAlign:"center",color:C.muted}}>No sessions logged yet</div> : aw.map((w,i)=>(
                        <div key={i} style={{padding:16,borderBottom:`1px solid ${C.border}`}}>
                          <div style={{color:C.muted,fontSize:10,letterSpacing:1,marginBottom:8}}>{new Date(w.created_at).toLocaleString()}</div>
                          {/* Athlete message */}
                          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
                            <div style={{maxWidth:"85%",background:C.gold,borderRadius:"12px 12px 4px 12px",padding:"10px 14px",fontSize:13,color:"#000",lineHeight:1.6}}>{w.raw_message}</div>
                          </div>
                          {/* Joe-bot reply */}
                          {w.bot_reply&&(
                            <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
                              <div style={{width:26,height:26,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#000",flexShrink:0}}>J</div>
                              <div style={{maxWidth:"85%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:"12px 12px 12px 4px",padding:"10px 14px",fontSize:13,color:C.text,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{w.bot_reply}</div>
                            </div>
                          )}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {w.parsed_data?.exercises?.map((ex,j)=>(
                              <div key={j} style={{background:"#0a1e14",border:`1px solid ${C.green}30`,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.green}}>
                                {ex.name}{ex.weight?` ${ex.weight}lbs`:""}{ex.sets&&ex.reps?` ${ex.sets}x${ex.reps}`:""}
                              </div>
                            ))}
                            {w.parsed_data?.pain_flags?.map((pf,j)=>(
                              <div key={j} style={{background:"#1e0a0a",border:`1px solid ${C.red}30`,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.red}}>pain: {pf.area}</div>
                            ))}
                            {w.parsed_data?.equipment_issues?.map((eq,j)=>(
                              <div key={j} style={{background:"#1a0e00",border:`1px solid ${C.gold}30`,borderRadius:6,padding:"3px 8px",fontSize:11,color:C.gold}}>equip: {eq}</div>
                            ))}
                            {w.parsed_data?.questions?.map((q,j)=>(
                              <div key={j} style={{background:"#0a0e1e",border:"1px solid #3b82f630",borderRadius:6,padding:"3px 8px",fontSize:11,color:"#3b82f6"}}>Q: {q.length>50?q.slice(0,50)+"...":q}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {viewMode==="structured"&&(
                    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                      {aw.length===0 ? <div style={{padding:24,textAlign:"center",color:C.muted}}>No sessions logged yet</div> : (
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                            <thead>
                              <tr style={{borderBottom:`1px solid ${C.border}`}}>
                                {["Date","Exercise","Weight","Sets x Reps","Feel","Pain","Equipment Issue","Questions"].map(h=>(
                                  <th key={h} style={{padding:"10px 12px",color:C.muted,fontSize:10,letterSpacing:1,textAlign:"left",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {aw.flatMap((w,i)=>{
                                const date = new Date(w.created_at).toLocaleDateString();
                                const exs = w.parsed_data?.exercises||[];
                                const pain = w.parsed_data?.pain_flags?.map(p=>p.area).join(", ")||"";
                                const equip = w.parsed_data?.equipment_issues?.join(", ")||"";
                                const qs = w.parsed_data?.questions?.join("; ")||"";
                                if(!exs.length) return [(
                                  <tr key={`${i}-0`} style={{borderBottom:`1px solid ${C.border}20`}}>
                                    <td style={{padding:"10px 12px",color:C.muted}}>{date}</td>
                                    <td colSpan={3} style={{padding:"10px 12px",color:C.muted,fontStyle:"italic"}}>No exercises parsed</td>
                                    <td style={{padding:"10px 12px"}}/>
                                    <td style={{padding:"10px 12px",color:pain?C.red:C.muted}}>{pain||"--"}</td>
                                    <td style={{padding:"10px 12px",color:equip?C.gold:C.muted}}>{equip||"--"}</td>
                                    <td style={{padding:"10px 12px",color:"#3b82f6",fontSize:12}}>{qs||"--"}</td>
                                  </tr>
                                )];
                                return exs.map((ex,j)=>(
                                  <tr key={`${i}-${j}`} style={{borderBottom:`1px solid ${C.border}20`}}>
                                    <td style={{padding:"10px 12px",color:C.muted,whiteSpace:"nowrap"}}>{j===0?date:""}</td>
                                    <td style={{padding:"10px 12px",color:C.text,fontWeight:500}}>{ex.name}</td>
                                    <td style={{padding:"10px 12px",color:C.gold,fontWeight:600}}>{ex.weight?`${ex.weight} ${ex.unit||"lbs"}`:"--"}</td>
                                    <td style={{padding:"10px 12px",color:C.text}}>{ex.sets&&ex.reps?`${ex.sets}x${ex.reps}`:"--"}</td>
                                    <td style={{padding:"10px 12px"}}>
                                      {ex.feel&&<span style={{background:ex.feel==="easy"?"#0a1428":ex.feel==="good"?"#0a1e14":"#1e0a0a",color:ex.feel==="easy"?"#60a5fa":ex.feel==="good"?C.green:C.red,borderRadius:4,padding:"2px 6px",fontSize:11}}>{ex.feel}</span>}
                                    </td>
                                    <td style={{padding:"10px 12px",color:j===0&&pain?C.red:C.muted}}>{j===0?pain||"--":""}</td>
                                    <td style={{padding:"10px 12px",color:j===0&&equip?C.gold:C.muted}}>{j===0?equip||"--":""}</td>
                                    <td style={{padding:"10px 12px",color:"#3b82f6",fontSize:12}}>{j===0?qs||"--":""}</td>
                                  </tr>
                                ));
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
