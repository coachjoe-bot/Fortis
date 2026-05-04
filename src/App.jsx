import { useState, useEffect, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_KEY;
const MASTER_CODE   = "FORTIS-MASTER";

const SPORTS = ["Football","Basketball","Volleyball","Soccer","Baseball","Archery","Olympic Weightlifting","Running","General Fitness"];

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const sbH = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`};
const sbGet = async (table,params="") => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`,{headers:{...sbH,"Prefer":"return=representation"}});
  return r.json();
};
const sbInsert = async (table,data) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:{...sbH,"Prefer":"return=representation"},body:JSON.stringify(data)});
  return r.json();
};
const sbUpdate = async (table,id,data) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:{...sbH,"Prefer":"return=representation"},body:JSON.stringify(data)});
  return r.json();
};

// ─── CLAUDE ──────────────────────────────────────────────────────────────────
const askClaude = async (system,user,maxTokens=600) => {
  const r = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:maxTokens,system,messages:[{role:"user",content:user}]})
  });
  const d = await r.json();
  if(d.error) throw new Error(d.error.message);
  return d.content?.[0]?.text||"";
};

const parseWorkout = async (message,name,sport) => {
  const sys = `Extract workout data from an athlete message. Return ONLY valid JSON, no markdown.
{"exercises":[{"name":string,"sets":number|null,"reps":number|null,"weight":number|null,"unit":"lbs"|"kg"|"bodyweight","feel":"easy"|"good"|"hard"|null,"notes":string|null}],"pain_flags":[{"area":string,"description":string}],"equipment_issues":[string],"questions":[string],"pr_attempts":[{"exercise":string,"weight":number,"reps":number,"achieved":boolean}],"session_feel":"great"|"good"|"average"|"rough"|null,"general_notes":string|null}`;
  const text = await askClaude(sys,`Athlete: ${name} (${sport})\nMessage: ${message}`,800);
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
  catch { return {exercises:[],pain_flags:[],equipment_issues:[],questions:[],pr_attempts:[],session_feel:null,general_notes:message}; }
};

const getJoeBotReply = async (message,athlete,history,workoutHistory=[]) => {
  const hist = history.slice(-6).map(m=>`${m.role==="user"?athlete.name:"Coach Joe"}: ${m.content}`).join("\n");
  let pastContext = "";
  if(workoutHistory&&workoutHistory.length>0) {
    const recent = workoutHistory.slice(0,5).map(w=>{
      const d = new Date(w.created_at).toLocaleDateString();
      const exs = w.parsed_data?.exercises?.map(e=>`${e.name}${e.weight?" "+e.weight+"lbs":""}${e.sets&&e.reps?" "+e.sets+"x"+e.reps:""}${e.feel?" ("+e.feel+")":""}`).join(", ")||"";
      const pain = w.parsed_data?.pain_flags?.map(p=>p.area).join(", ")||"";
      return `${d}: ${exs||w.raw_message?.slice(0,100)}${pain?" | PAIN: "+pain:""}`;
    }).filter(Boolean).join("\n");
    pastContext = `\n\nATHLETE RECENT HISTORY (last ${workoutHistory.slice(0,5).length} sessions):\n${recent}\nReference their actual numbers and note patterns.`;
  }
  let phaseContext = "";
  if(athlete.season_date) {
    const weeks = Math.max(0,Math.round((new Date(athlete.season_date)-new Date())/(7*24*60*60*1000)));
    if(weeks>12) phaseContext = `PHASE: STRENGTH (${weeks} wks to season). Compound lifts, progressive overload. No plyos yet.`;
    else if(weeks>4) phaseContext = `PHASE: POWER (${weeks} wks to season). Convert strength to explosiveness.`;
    else if(weeks>0) phaseContext = `PHASE: PEAK (${weeks} wks to season). Reduce volume, stay sharp.`;
    else phaseContext = `PHASE: IN-SEASON or post-season. Maintenance and recovery.`;
  } else {
    phaseContext = `PHASE: No season date. Default to strength-first.`;
  }
  const sportPriorities = {
    "Football":"Lower body power (squat/deadlift/hip hinge), upper body strength (bench/row), explosive hip extension.",
    "Basketball":"Lower body explosiveness, vertical (after strength base), lateral quickness, core stability.",
    "Volleyball":"Vertical jump (after strength base), shoulder stability, core power, lower body strength.",
    "Soccer":"Lower body strength and power, single-leg stability, change of direction, aerobic base.",
    "Baseball":"Rotational power, posterior chain, shoulder health, single-leg strength.",
    "Archery":"Shoulder stability, posterior chain, core anti-rotation, grip strength.",
    "Olympic Weightlifting":"Snatch and clean technique, posterior chain, mobility, overhead stability.",
    "Running":"Single-leg strength, posterior chain, hip stability, calf/ankle strength.",
    "General Fitness":"Build a balanced foundation -- squat, hinge, push, pull, carry. Health and longevity focus."
  };
  const sportFocus = sportPriorities[athlete.sport]||"Build a general strength base.";
  const sys = `You are Coach Joe Thomas -- high school strength coach, 20+ years military S&C. Direct, real, no fluff.
Athlete: ${athlete.name}, Sport: ${athlete.sport}, Level: ${athlete.level||"Unknown"}
${phaseContext}
SPORT: ${sportFocus}

BANNED PHRASES:
- "Atta boy/girl": BANNED except when athlete explicitly hits a NEW PR. A normal workout does NOT qualify.
- Exclamation points: Maximum ONE per response.
- "Let's go!" / "Get after it!": BANNED as fillers.

FOR NORMAL WORKOUT LOGS respond with one of: "Good work." / "Solid session." / "Numbers are moving." / "Nice." -- then one specific observation. That's it.

RESERVED (only when situation genuinely matches):
- "Atta boy/girl": New PR only.
- "If it were easy, everybody would do it.": Athlete struggling mentally only.
- "It's not about workout 1, it's about workout 100.": Athlete missed sessions only.
- "You're only in competition with the you of yesterday.": Athlete comparing to others only.

FORMATTING: Use numbered lists for exercises/alternatives/steps. Never paragraph format for exercise lists.
Keep under 200 words. Use their name once naturally.
If pain mentioned: suggest alternatives, note if serious.
If equipment unavailable: give 2-3 specific alternatives.
For programming: strength before plyos, always.
Out of scope: "That's one for Coach Joe directly -- email joe.thomas@commandengineering.com."${pastContext}`;
  return askClaude(sys,`${hist}\n\n${athlete.name}: ${message}`,450);
};

// ─── STYLES ──────────────────────────────────────────────────────────────────
const C = {navy:"#060d1e",navy2:"#0a1228",navy3:"#0d1836",border:"#1e2a4a",gold:"#d4a017",green:"#10b981",red:"#ef4444",text:"#e2e8f0",muted:"#64748b",muted2:"#94a3b8"};
const GS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:${C.navy};color:${C.text};font-family:'DM Sans',sans-serif;}
input,textarea,select,button{font-family:'DM Sans',sans-serif;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:${C.navy2};}::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}
.fade-up{animation:fadeUp 0.25s ease forwards;}
`;

const inp = (extra={}) => ({width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",color:C.text,fontSize:15,outline:"none",...extra});
const btn = (bg,color,extra={}) => ({background:bg,color,border:"none",borderRadius:12,padding:"14px",fontWeight:700,fontSize:16,cursor:"pointer",width:"100%",fontFamily:"'Bebas Neue'",letterSpacing:2,...extra});

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FortisApp() {
  const [view,setView] = useState("home"); // home | signup | login | athlete | coachLogin | coachSetup | coach
  const [athlete,setAthlete] = useState(null);
  const [coach,setCoach] = useState(null);
  const [err,setErr] = useState("");

  if(view==="athlete"&&athlete) return <AthleteView athlete={athlete} onLogout={()=>{setAthlete(null);setView("home");}}/>;
  if(view==="coach"&&coach) return <CoachDashboard coach={coach} onLogout={()=>{setCoach(null);setView("home");}}/>;

  return (
    <div style={{minHeight:"100vh",background:C.navy,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <style>{GS}</style>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:40}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:56,color:C.gold,letterSpacing:6,lineHeight:1}}>FORTIS</div>
          <div style={{color:C.muted,fontSize:12,letterSpacing:4,marginTop:4}}>COACH JOE-BOT</div>
        </div>

        {view==="home" && <HomeScreen setView={setView}/>}
        {view==="signup" && <SignupScreen setView={setView} setAthlete={setAthlete} setErr={setErr} err={err}/>}
        {view==="login" && <LoginScreen setView={setView} setAthlete={setAthlete} setErr={setErr} err={err}/>}
        {view==="coachLogin" && <CoachLoginScreen setView={setView} setCoach={setCoach} setErr={setErr} err={err}/>}
        {view==="coachSetup" && <CoachSetupScreen setView={setView} setCoach={setCoach} setErr={setErr} err={err}/>}
      </div>
    </div>
  );
}

// ─── HOME SCREEN ─────────────────────────────────────────────────────────────
function HomeScreen({setView}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <button onClick={()=>setView("login")} style={btn(C.gold,"#000")}>Athlete Login</button>
      <button onClick={()=>setView("signup")} style={btn("transparent",C.gold,{border:`2px solid ${C.gold}`})}>New Athlete Sign Up</button>
      <div style={{height:1,background:C.border,margin:"8px 0"}}/>
      <button onClick={()=>setView("coachLogin")} style={btn(C.navy2,C.muted2,{border:`1px solid ${C.border}`})}>Coach Login</button>
      <button onClick={()=>setView("coachSetup")} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",textAlign:"center",marginTop:4}}>
        First time coach? Enter access code
      </button>
    </div>
  );
}

// ─── ATHLETE SIGNUP ──────────────────────────────────────────────────────────
function SignupScreen({setView,setAthlete,setErr,err}) {
  const [step,setStep] = useState(1); // 1=name/sport, 2=pin, 3=season
  const [data,setData] = useState({name:"",sport:SPORTS[0],pin:"",confirmPin:"",seasonDate:"",noSeason:false});
  const [loading,setLoading] = useState(false);

  const setD = (k,v) => setData(p=>({...p,[k]:v}));

  const nextStep = async () => {
    setErr("");
    if(step===1) {
      if(!data.name.trim()) { setErr("Enter your name."); return; }
      // Check name not already taken
      setLoading(true);
      const existing = await sbGet("athletes",`?name=ilike.${encodeURIComponent(data.name.trim())}`);
      setLoading(false);
      if(existing?.length>0) { setErr("That name is already registered. Go to Athlete Login instead."); return; }
      setStep(2);
    } else if(step===2) {
      if(data.pin.length!==4) { setErr("PIN must be 4 digits."); return; }
      if(data.pin!==data.confirmPin) { setErr("PINs don't match."); return; }
      setStep(3);
    } else if(step===3) {
      setLoading(true);
      try {
        const seasonDate = data.noSeason ? null : data.seasonDate || null;
        const created = await sbInsert("athletes",{
          name:data.name.trim(),
          sport:data.sport,
          pin:data.pin,
          season_date:seasonDate,
          no_season:data.noSeason
        });
        if(created?.length>0) { setAthlete(created[0]); /* navigate to athlete view handled by parent */ }
        else setErr("Could not create account. Try again.");
      } catch(e) { setErr("Connection error."); }
      setLoading(false);
    }
  };

  return (
    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={()=>step>1?setStep(step-1):setView("home")} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18}}>←</button>
        <div style={{color:C.gold,fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:2}}>NEW ATHLETE — STEP {step} OF 3</div>
      </div>

      {step===1 && <>
        <div style={{marginBottom:16}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>FULL NAME</label>
          <input value={data.name} onChange={e=>setD("name",e.target.value)} placeholder="Your name" style={inp()}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>PRIMARY SPORT</label>
          <select value={data.sport} onChange={e=>setD("sport",e.target.value)} style={inp()}>
            {SPORTS.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </>}

      {step===2 && <>
        <div style={{color:C.muted2,fontSize:13,marginBottom:16,lineHeight:1.6}}>Choose a 4-digit PIN you'll remember. You'll need this every time you log in. There's no way to recover it if you forget.</div>
        <div style={{marginBottom:16}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>CREATE PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={data.pin}
            onChange={e=>setD("pin",e.target.value.replace(/\D/g,"").slice(0,4))}
            placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>CONFIRM PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={data.confirmPin}
            onChange={e=>setD("confirmPin",e.target.value.replace(/\D/g,"").slice(0,4))}
            placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
        </div>
      </>}

      {step===3 && <>
        <div style={{color:C.muted2,fontSize:13,marginBottom:16,lineHeight:1.6}}>When does your season start? This helps Joe-bot tailor your training to where you are in the year.</div>
        {!data.noSeason && <>
          <div style={{marginBottom:12}}>
            <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>SEASON START DATE</label>
            <input type="date" value={data.seasonDate} onChange={e=>setD("seasonDate",e.target.value)} style={inp()}/>
          </div>
        </>}
        <div onClick={()=>setD("noSeason",!data.noSeason)} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",marginBottom:20,padding:"10px 12px",background:C.navy3,borderRadius:10,border:`1px solid ${C.border}`}}>
          <div style={{width:20,height:20,borderRadius:4,border:`2px solid ${data.noSeason?C.gold:C.muted}`,background:data.noSeason?C.gold:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {data.noSeason&&<span style={{color:"#000",fontSize:12,fontWeight:700}}>✓</span>}
          </div>
          <div style={{color:C.muted2,fontSize:13}}>I don't have a season / general fitness only</div>
        </div>
      </>}

      {err&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{err}</div>}
      <button onClick={nextStep} disabled={loading} style={btn(C.gold,"#000",{opacity:loading?0.7:1,cursor:loading?"not-allowed":"pointer"})}>
        {loading?"Please wait...":(step===3?"Create Account →":"Next →")}
      </button>
    </div>
  );
}

// ─── ATHLETE LOGIN ────────────────────────────────────────────────────────────
function LoginScreen({setView,setAthlete,setErr,err}) {
  const [name,setName] = useState("");
  const [pin,setPin] = useState("");
  const [loading,setLoading] = useState(false);

  const login = async () => {
    if(!name.trim()||pin.length!==4) { setErr("Enter your name and 4-digit PIN."); return; }
    setLoading(true); setErr("");
    try {
      const results = await sbGet("athletes",`?name=eq.${encodeURIComponent(name.trim())}&pin=eq.${pin}&select=*`);
      if(results?.length>0) { setAthlete(results[0]); }
      else {
        // Check if name exists but wrong PIN
        const nameCheck = await sbGet("athletes",`?name=eq.${encodeURIComponent(name.trim())}`);
        if(nameCheck?.length>0) setErr("Wrong PIN. Try again.");
        else setErr("Name not found. Check spelling or sign up as a new athlete.");
      }
    } catch(e) { setErr("Connection error. Check your internet."); }
    setLoading(false);
  };

  return (
    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18}}>←</button>
        <div style={{color:C.gold,fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:2}}>ATHLETE LOGIN</div>
      </div>
      <div style={{marginBottom:16}}>
        <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>YOUR NAME</label>
        <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="Exact name you signed up with" style={inp()}/>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>YOUR PIN</label>
        <input type="password" inputMode="numeric" maxLength={4} value={pin}
          onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
          onKeyDown={e=>e.key==="Enter"&&login()}
          placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
      </div>
      {err&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{err}</div>}
      <button onClick={login} disabled={loading} style={btn(C.gold,"#000",{opacity:loading?0.7:1,cursor:loading?"not-allowed":"pointer"})}>
        {loading?"Checking...":"Let's Get to Work ->"}
      </button>
      <div style={{textAlign:"center",marginTop:12}}>
        <button onClick={()=>setView("signup")} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>New athlete? Sign up here</button>
      </div>
    </div>
  );
}

// ─── COACH LOGIN ──────────────────────────────────────────────────────────────
function CoachLoginScreen({setView,setCoach,setErr,err}) {
  const [pin,setPin] = useState("");
  const [loading,setLoading] = useState(false);

  const login = async () => {
    if(pin.length!==4) { setErr("Enter your 4-digit PIN."); return; }
    setLoading(true); setErr("");
    try {
      const results = await sbGet("coaches",`?pin=eq.${pin}&select=*`);
      if(results?.length>0) { setCoach(results[0]); }
      else setErr("PIN not found. Check your PIN or set up your coach account first.");
    } catch(e) { setErr("Connection error."); }
    setLoading(false);
  };

  return (
    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={()=>setView("home")} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18}}>←</button>
        <div style={{color:C.gold,fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:2}}>COACH LOGIN</div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>COACH PIN</label>
        <input type="password" inputMode="numeric" maxLength={4} value={pin}
          onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
          onKeyDown={e=>e.key==="Enter"&&login()}
          placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
      </div>
      {err&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{err}</div>}
      <button onClick={login} disabled={loading} style={btn(C.gold,"#000",{opacity:loading?0.7:1})}>
        {loading?"Checking...":"Access Dashboard ->"}
      </button>
      <div style={{textAlign:"center",marginTop:12}}>
        <button onClick={()=>setView("coachSetup")} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer"}}>First time? Enter access code</button>
      </div>
    </div>
  );
}

// ─── COACH SETUP (first time) ─────────────────────────────────────────────────
function CoachSetupScreen({setView,setCoach,setErr,err}) {
  const [step,setStep] = useState(1);
  const [code,setCode] = useState("");
  const [coachRecord,setCoachRecord] = useState(null);
  const [pin,setPin] = useState("");
  const [confirmPin,setConfirmPin] = useState("");
  const [loading,setLoading] = useState(false);

  const verifyCode = async () => {
    if(!code.trim()) { setErr("Enter your access code."); return; }
    setLoading(true); setErr("");
    try {
      const results = await sbGet("coaches",`?access_code=eq.${encodeURIComponent(code.trim().toUpperCase())}&select=*`);
      if(results?.length>0) {
        if(results[0].pin) { setErr("This code has already been used. Go to Coach Login."); setLoading(false); return; }
        setCoachRecord(results[0]);
        setStep(2);
      } else {
        setErr("Invalid access code. Check with your athletic director.");
      }
    } catch(e) { setErr("Connection error."); }
    setLoading(false);
  };

  const setCoachPin = async () => {
    if(pin.length!==4) { setErr("PIN must be 4 digits."); return; }
    if(pin!==confirmPin) { setErr("PINs don't match."); return; }
    setLoading(true); setErr("");
    try {
      const updated = await sbUpdate("coaches",coachRecord.id,{pin});
      if(updated?.length>0) { setCoach({...coachRecord,pin}); }
      else setErr("Could not save PIN. Try again.");
    } catch(e) { setErr("Connection error."); }
    setLoading(false);
  };

  return (
    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:16,padding:24}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <button onClick={()=>step>1?setStep(1):setView("home")} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:18}}>←</button>
        <div style={{color:C.gold,fontFamily:"'Bebas Neue'",fontSize:18,letterSpacing:2}}>COACH SETUP — STEP {step} OF 2</div>
      </div>
      {step===1 && <>
        <div style={{color:C.muted2,fontSize:13,marginBottom:16,lineHeight:1.6}}>Enter the access code provided by your athletic director.</div>
        <div style={{marginBottom:20}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>ACCESS CODE</label>
          <input value={code} onChange={e=>setCode(e.target.value)} placeholder="e.g. FORTIS-FOOTBALL" style={inp({textTransform:"uppercase",letterSpacing:2})}/>
        </div>
        {err&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{err}</div>}
        <button onClick={verifyCode} disabled={loading} style={btn(C.gold,"#000",{opacity:loading?0.7:1})}>
          {loading?"Verifying...":"Verify Code ->"}
        </button>
      </>}
      {step===2 && <>
        <div style={{color:C.muted2,fontSize:13,marginBottom:4,lineHeight:1.6}}>Welcome, {coachRecord?.name}. Set your 4-digit PIN.</div>
        <div style={{color:C.muted,fontSize:12,marginBottom:16}}>You'll use this PIN every time you log in.</div>
        <div style={{marginBottom:16}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>CREATE PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={pin}
            onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))}
            placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{color:C.muted,fontSize:11,letterSpacing:1,display:"block",marginBottom:6}}>CONFIRM PIN</label>
          <input type="password" inputMode="numeric" maxLength={4} value={confirmPin}
            onChange={e=>setConfirmPin(e.target.value.replace(/\D/g,"").slice(0,4))}
            placeholder="----" style={inp({fontSize:24,letterSpacing:8,textAlign:"center"})}/>
        </div>
        {err&&<div style={{color:C.red,fontSize:12,marginBottom:12,textAlign:"center"}}>{err}</div>}
        <button onClick={setCoachPin} disabled={loading} style={btn(C.gold,"#000",{opacity:loading?0.7:1})}>
          {loading?"Saving...":"Set PIN & Enter Dashboard ->"}
        </button>
      </>}
    </div>
  );
}

// ─── ATHLETE VIEW ─────────────────────────────────────────────────────────────
function AthleteView({athlete,onLogout}) {
  const [messages,setMessages] = useState([]);
  const [input,setInput] = useState("");
  const [loading,setLoading] = useState(false);
  const [saved,setSaved] = useState(false);
  const [workoutHistory,setWorkoutHistory] = useState([]);
  const [historyLoaded,setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,loading]);

  // Load history and build greeting
  useEffect(()=>{
    (async()=>{
      try {
        const logs = await sbGet("workouts",`?athlete_id=eq.${athlete.id}&order=created_at.desc&limit=10&select=*`);
        if(logs&&logs.length>0) setWorkoutHistory(logs);

        // Build greeting based on last session
        const lastLog = logs?.[0];
        const daysAgo = lastLog ? Math.floor((new Date()-new Date(lastLog.created_at))/(1000*60*60*24)) : null;
        const lastExs = lastLog?.parsed_data?.exercises?.map(e=>`${e.name}${e.weight?" "+e.weight+"lbs":""}${e.sets&&e.reps?" "+e.sets+"x"+e.reps:""}`).join(", ")||"";
        const lastDate = lastLog ? new Date(lastLog.created_at).toLocaleDateString() : null;
        const summary = lastExs ? `Last session (${lastDate}): ${lastExs}.` : "";

        let greeting;
        if(!lastLog) {
          // Brand new athlete
          if(!athlete.season_date&&!athlete.no_season) {
            greeting = `Hey ${athlete.name}, welcome to FORTIS. I'm Coach Joe-bot. Before we get started -- when does your ${athlete.sport} season begin? Give me a rough date like "September 1" or check the box below if you don't have one.`;
          } else {
            greeting = `Welcome to FORTIS, ${athlete.name}. Tell me about your first workout -- what you did, how it felt, any questions.`;
          }
        } else if(daysAgo>=7) {
          greeting = `${athlete.name}. It's been ${daysAgo} days since your last log. That's a week. What happened? We can't build anything on inconsistency. ${summary} What did you get after today?`;
        } else if(daysAgo>=4) {
          greeting = `${athlete.name}. ${daysAgo} days since your last log. It's not about workout 1 -- it's about workout 100. ${summary} What did you do today?`;
        } else if(daysAgo>=2) {
          greeting = `Back at it, ${athlete.name}. ${summary} What did you get after today?`;
        } else {
          greeting = summary ? `${athlete.name}. ${summary} What are you getting after today?` : `What's up, ${athlete.name}. What did you get after today?`;
        }

        setMessages([{role:"assistant",content:greeting}]);
      } catch(e) {
        setMessages([{role:"assistant",content:`What's up, ${athlete.name}. What did you get after today?`}]);
      }
      setHistoryLoaded(true);
    })();
  },[]);

  const send = async () => {
    const msg = input.trim();
    if(!msg||loading||!historyLoaded) return;
    setInput("");
    const newMsgs = [...messages,{role:"user",content:msg}];
    setMessages(newMsgs);
    setLoading(true);

    try {
      // Check if this is a season date response for new athletes
      let updatedAthlete = {...athlete};
      if(!athlete.season_date&&!athlete.no_season) {
        const noSeasonPhrases = ["no season","don't have","dont have","general fitness","no date","not sure","unknown"];
        const hasNoSeason = noSeasonPhrases.some(p=>msg.toLowerCase().includes(p));
        if(hasNoSeason) {
          await sbUpdate("athletes",athlete.id,{no_season:true});
          updatedAthlete.no_season = true;
        } else {
          try {
            const dateStr = await askClaude("Extract a season start date. Return ONLY YYYY-MM-DD format or null. Nothing else.",msg,50);
            const cleaned = dateStr.trim().replace(/[^0-9-]/g,"");
            if(cleaned.match(/^\d{4}-\d{2}-\d{2}$/)) {
              await sbUpdate("athletes",athlete.id,{season_date:cleaned});
              updatedAthlete.season_date = cleaned;
              athlete.season_date = cleaned;
            }
          } catch(e){}
        }
      }

      const [reply,parsed] = await Promise.all([
        getJoeBotReply(msg,updatedAthlete,newMsgs,workoutHistory),
        parseWorkout(msg,athlete.name,athlete.sport)
      ]);

      // Save workout
      await sbInsert("workouts",{athlete_id:athlete.id,raw_message:msg,bot_reply:reply,parsed_data:parsed});
      setSaved(true); setTimeout(()=>setSaved(false),3000);

      // Auto PR detection
      const newPRs = [];
      if(parsed.exercises?.length>0) {
        const existingPRs = await sbGet("prs",`?athlete_id=eq.${athlete.id}`);
        const prMap = {};
        if(Array.isArray(existingPRs)) {
          existingPRs.forEach(pr=>{
            const k = pr.exercise?.toLowerCase().trim();
            if(!prMap[k]||pr.weight>prMap[k].weight) prMap[k]=pr;
          });
        }
        for(const ex of parsed.exercises) {
          if(!ex.name||!ex.weight||ex.unit==="bodyweight") continue;
          const k = ex.name.toLowerCase().trim();
          if(!prMap[k]) {
            await sbInsert("prs",{athlete_id:athlete.id,exercise:ex.name,weight:ex.weight,reps:ex.reps||1});
          } else if(ex.weight>prMap[k].weight) {
            await sbInsert("prs",{athlete_id:athlete.id,exercise:ex.name,weight:ex.weight,reps:ex.reps||1});
            newPRs.push({exercise:ex.name,weight:ex.weight,prev:prMap[k].weight,diff:ex.weight-prMap[k].weight});
          }
        }
      }

      setMessages(prev=>[...prev,{role:"assistant",content:reply}]);
      setWorkoutHistory(prev=>[{raw_message:msg,parsed_data:parsed,created_at:new Date().toISOString()},...prev]);

      if(newPRs.length>0) {
        try {
          const prCallout = newPRs.map(pr=>`${pr.exercise}: ${pr.weight}lbs (+${pr.diff}lbs)`).join("\n");
          const prReply = await askClaude(
            "You are Coach Joe Thomas. An athlete just hit a new PR. Acknowledge it directly -- short, punchy, in Coach Joe's voice. Atta boy/girl is appropriate here.",
            `Athlete: ${athlete.name} (${athlete.sport})\nNew PRs:\n${prCallout}`,150
          );
          setMessages(prev=>[...prev,{role:"assistant",content:prReply}]);
        } catch(e) {
          setMessages(prev=>[...prev,{role:"assistant",content:newPRs.map(pr=>`New PR -- ${pr.exercise} at ${pr.weight}lbs. +${pr.diff}lbs. That's what the work is for.`).join("\n")}]);
        }
      }
    } catch(e) {
      setMessages(prev=>[...prev,{role:"assistant",content:"Hit a snag. Try again."}]);
    }
    setLoading(false);
  };

  const quick = ["No squat rack today","My knee is sore","I'm at the hotel gym","Can't do pull-ups","Bench alternative?"];

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
        {!historyLoaded ? (
          <div style={{textAlign:"center",padding:40,color:C.muted}}>Loading...</div>
        ) : (
          <>
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
                <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:"16px 16px 16px 4px",padding:"12px 16px",display:"flex",gap:5}}>
                  {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:C.muted,animation:`pulse 1.2s ease ${i*0.2}s infinite`}}/>)}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{padding:"0 16px 8px",display:"flex",gap:6,overflowX:"auto",flexShrink:0}}>
        {quick.map(p=>(
          <button key={p} onClick={()=>setInput(p)} style={{background:C.navy3,border:`1px solid ${C.border}`,color:C.muted2,borderRadius:20,padding:"6px 12px",cursor:"pointer",fontSize:12,whiteSpace:"nowrap",flexShrink:0}}>{p}</button>
        ))}
      </div>

      <div style={{padding:"8px 16px 20px",flexShrink:0,borderTop:`1px solid ${C.border}`,background:C.navy2}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
          <textarea value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder={`Tell Coach Joe about your workout, ${athlete.name}...`} rows={2}
            style={{flex:1,background:C.navy3,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",color:C.text,fontSize:14,outline:"none",resize:"none",lineHeight:1.5}}/>
          <button onClick={send} disabled={loading||!input.trim()||!historyLoaded}
            style={{background:C.gold,border:"none",borderRadius:12,width:44,height:44,cursor:loading||!input.trim()?"not-allowed":"pointer",opacity:loading||!input.trim()?0.5:1,fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:"#000",fontWeight:700}}>
            →
          </button>
        </div>
        <div style={{color:C.muted,fontSize:10,marginTop:6,textAlign:"center"}}>Just type naturally. Joe-bot saves your workout automatically.</div>
      </div>
    </div>
  );
}

// ─── COACH DASHBOARD ──────────────────────────────────────────────────────────
function CoachDashboard({coach,onLogout}) {
  const isMaster = coach.role==="master"||coach.access_code===MASTER_CODE;
  const [athletes,setAthletes] = useState([]);
  const [workouts,setWorkouts] = useState([]);
  const [prs,setPrs] = useState([]);
  const [allCoaches,setAllCoaches] = useState([]);
  const [selected,setSelected] = useState(null);
  const [loading,setLoading] = useState(true);
  const [viewMode,setViewMode] = useState("conversation");
  const [search,setSearch] = useState("");
  const [filterPain,setFilterPain] = useState(false);
  const [filterEquip,setFilterEquip] = useState(false);
  const [activeTab,setActiveTab] = useState("athletes"); // athletes | report | coaches
  const [report,setReport] = useState(null);
  const [reportLoading,setReportLoading] = useState(false);
  const [reportPeriod,setReportPeriod] = useState("week"); // week | all

  useEffect(()=>{loadAll();},[]);

  const loadAll = async () => {
    setLoading(true);
    try {
      let athleteQuery = isMaster ? "?order=created_at.desc&select=*" : `?sport=eq.${encodeURIComponent(coach.sports?.[0]||"")}&order=created_at.desc&select=*`;
      // For multi-sport coaches, load all athletes in their sports
      const [a,w,p,c] = await Promise.all([
        sbGet("athletes", isMaster ? "?order=created_at.desc&select=*" : `?order=created_at.desc&select=*`),
        sbGet("workouts","?order=created_at.desc&select=*"),
        sbGet("prs","?order=created_at.desc&select=*"),
        isMaster ? sbGet("coaches","?select=*") : Promise.resolve([])
      ]);
      let filteredAthletes = Array.isArray(a)?a:[];
      if(!isMaster&&coach.sports?.length>0) {
        filteredAthletes = filteredAthletes.filter(at=>coach.sports.includes(at.sport));
      }
      setAthletes(filteredAthletes);
      const athleteIds = filteredAthletes.map(at=>at.id);
      setWorkouts((Array.isArray(w)?w:[]).filter(wk=>athleteIds.includes(wk.athlete_id)));
      setPrs((Array.isArray(p)?p:[]).filter(pr=>athleteIds.includes(pr.athlete_id)));
      setAllCoaches(Array.isArray(c)?c:[]);
    } catch(e){console.error(e);}
    setLoading(false);
  };

  const generateReport = async (period) => {
    setReportLoading(true);
    const cutoff = period==="week" ? new Date(Date.now()-7*24*60*60*1000) : new Date(0);
    const periodWorkouts = workouts.filter(w=>new Date(w.created_at)>=cutoff);
    const activeAthletes = [...new Set(periodWorkouts.map(w=>w.athlete_id))];
    const inactiveAthletes = athletes.filter(a=>!activeAthletes.includes(a.id));
    const periodPRs = prs.filter(p=>new Date(p.created_at||p.date)>=cutoff);
    const painFlags = periodWorkouts.filter(w=>w.parsed_data?.pain_flags?.length>0);
    const allQuestions = periodWorkouts.flatMap(w=>w.parsed_data?.questions||[]);

    // Use Claude to summarize common questions
    let questionSummary = "No questions logged.";
    if(allQuestions.length>0) {
      try {
        questionSummary = await askClaude(
          "Summarize these athlete questions into 3-5 common themes. Be brief and specific.",
          allQuestions.slice(0,20).join("\n"),300
        );
      } catch(e){}
    }

    setReport({
      period,
      totalAthletes:athletes.length,
      activeSessions:periodWorkouts.length,
      activeAthletes:activeAthletes.length,
      inactiveAthletes:inactiveAthletes.map(a=>a.name),
      newPRs:periodPRs.length,
      prDetails:periodPRs.slice(0,10).map(p=>{const a=athletes.find(at=>at.id===p.athlete_id);return `${a?.name||"Unknown"}: ${p.exercise} ${p.weight}lbs`;}),
      painCount:painFlags.length,
      painDetails:painFlags.slice(0,5).map(w=>{const a=athletes.find(at=>at.id===w.athlete_id);return `${a?.name||"Unknown"}: ${w.parsed_data.pain_flags.map(p=>p.area).join(", ")}`;}),
      questionSummary
    });
    setReportLoading(false);
  };

  const aw = selected ? workouts.filter(w=>w.athlete_id===selected.id) : [];
  const ap = selected ? prs.filter(p=>p.athlete_id===selected.id) : [];
  const lastActive = (id) => { const ws=workouts.filter(w=>w.athlete_id===id); return ws.length?new Date(ws[0].created_at):null; };
  const daysAgo = (d) => d?Math.floor((new Date()-d)/(1000*60*60*24)):null;

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
          <div style={{fontFamily:"'Bebas Neue'",fontSize:22,color:C.gold,letterSpacing:2}}>FORTIS {isMaster?"— MASTER":"— COACH"} DASHBOARD</div>
          <div style={{color:C.muted,fontSize:11}}>{coach.name} {coach.sports&&!isMaster?`· ${coach.sports.join(", ")}`:""}</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={loadAll} style={{background:C.navy3,border:`1px solid ${C.border}`,color:C.muted2,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12}}>↻</button>
          <button onClick={onLogout} style={{background:"none",border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:12}}>Log Out</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{background:C.navy2,borderBottom:`1px solid ${C.border}`,display:"flex",padding:"0 20px"}}>
        {["athletes","report",...(isMaster?["coaches"]:[])].map(t=>(
          <button key={t} onClick={()=>setActiveTab(t)} style={{padding:"12px 16px",background:"none",border:"none",borderBottom:`2px solid ${activeTab===t?C.gold:"transparent"}`,color:activeTab===t?C.gold:C.muted,cursor:"pointer",fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:1,fontFamily:"'DM Sans'"}}>
            {t}
          </button>
        ))}
      </div>

      <div style={{padding:20,maxWidth:1200,margin:"0 auto"}}>
        {loading ? (
          <div style={{textAlign:"center",padding:60,color:C.muted}}>Loading...</div>
        ) : (
          <>
            {/* ── ATHLETES TAB ── */}
            {activeTab==="athletes" && (
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
                  {/* Athlete list */}
                  <div>
                    <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                      <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`}}>
                        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search athletes..."
                          style={{width:"100%",background:C.navy3,border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 12px",color:C.text,fontSize:13,outline:"none",marginBottom:8}}/>
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>setFilterPain(p=>!p)} style={{flex:1,background:filterPain?"#ef444420":"transparent",border:`1px solid ${filterPain?C.red:C.border}`,color:filterPain?C.red:C.muted,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontFamily:"'DM Sans'"}}>Pain flags</button>
                          <button onClick={()=>setFilterEquip(p=>!p)} style={{flex:1,background:filterEquip?"#d4a01720":"transparent",border:`1px solid ${filterEquip?C.gold:C.border}`,color:filterEquip?C.gold:C.muted,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontFamily:"'DM Sans'"}}>Equipment</button>
                        </div>
                      </div>
                      {filtered.length===0 ? (
                        <div style={{padding:24,textAlign:"center",color:C.muted,fontSize:13}}>No athletes yet</div>
                      ) : filtered.map(a=>{
                        const d=daysAgo(lastActive(a.id));
                        const hasPain=workouts.filter(w=>w.athlete_id===a.id).some(w=>w.parsed_data?.pain_flags?.length>0);
                        const isSel=selected?.id===a.id;
                        return (
                          <div key={a.id} onClick={()=>setSelected(isSel?null:a)}
                            style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",background:isSel?C.navy3:"transparent",transition:"background 0.15s",display:"flex",alignItems:"center",gap:12}}>
                            <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,color:"#000",flexShrink:0}}>{a.name[0].toUpperCase()}</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{color:C.text,fontWeight:600,fontSize:14}}>{a.name}</div>
                              <div style={{color:C.muted,fontSize:11}}>{a.sport} · {workouts.filter(w=>w.athlete_id===a.id).length} sessions</div>
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

                  {/* Athlete detail */}
                  {selected&&(
                    <div>
                      <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,padding:20,marginBottom:16}}>
                        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                          <div style={{width:48,height:48,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:22,color:"#000"}}>{selected.name[0].toUpperCase()}</div>
                          <div>
                            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,color:C.text,letterSpacing:1}}>{selected.name}</div>
                            <div style={{color:C.muted,fontSize:12}}>{selected.sport} · Since {new Date(selected.created_at).toLocaleDateString()}</div>
                            {selected.season_date&&<div style={{color:C.gold,fontSize:11,marginTop:2}}>Season: {new Date(selected.season_date).toLocaleDateString()}</div>}
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
                          <button key={m} onClick={()=>setViewMode(m)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${viewMode===m?C.gold:C.border}`,background:viewMode===m?C.gold+"20":"transparent",color:viewMode===m?C.gold:C.muted,cursor:"pointer",fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:1,fontFamily:"'DM Sans'"}}>
                            {m==="conversation"?"Conversation":"Structured Data"}
                          </button>
                        ))}
                      </div>

                      {viewMode==="conversation"&&(
                        <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                          {aw.length===0 ? <div style={{padding:24,textAlign:"center",color:C.muted}}>No sessions logged yet</div> : aw.map((w,i)=>(
                            <div key={i} style={{padding:16,borderBottom:`1px solid ${C.border}`}}>
                              <div style={{color:C.muted,fontSize:10,letterSpacing:1,marginBottom:8}}>{new Date(w.created_at).toLocaleString()}</div>
                              <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
                                <div style={{maxWidth:"85%",background:C.gold,borderRadius:"12px 12px 4px 12px",padding:"10px 14px",fontSize:13,color:"#000",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{w.raw_message}</div>
                              </div>
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
                                    {["Date","Exercise","Weight","Sets x Reps","Feel","Pain","Equipment","Questions"].map(h=>(
                                      <th key={h} style={{padding:"10px 12px",color:C.muted,fontSize:10,letterSpacing:1,textAlign:"left",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {aw.flatMap((w,i)=>{
                                    const date=new Date(w.created_at).toLocaleDateString();
                                    const exs=w.parsed_data?.exercises||[];
                                    const pain=w.parsed_data?.pain_flags?.map(p=>p.area).join(", ")||"";
                                    const equip=w.parsed_data?.equipment_issues?.join(", ")||"";
                                    const qs=w.parsed_data?.questions?.join("; ")||"";
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
                                        <td style={{padding:"10px 12px"}}>{ex.feel&&<span style={{background:ex.feel==="easy"?"#0a1428":ex.feel==="good"?"#0a1e14":"#1e0a0a",color:ex.feel==="easy"?"#60a5fa":ex.feel==="good"?C.green:C.red,borderRadius:4,padding:"2px 6px",fontSize:11}}>{ex.feel}</span>}</td>
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

            {/* ── REPORT TAB ── */}
            {activeTab==="report" && (
              <div style={{maxWidth:800}}>
                <div style={{display:"flex",gap:10,marginBottom:20,alignItems:"center",flexWrap:"wrap"}}>
                  <button onClick={()=>generateReport("week")} disabled={reportLoading}
                    style={{background:C.gold,color:"#000",border:"none",borderRadius:10,padding:"10px 20px",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"'DM Sans'",opacity:reportLoading?0.7:1}}>
                    {reportLoading?"Generating...":"This Week's Report"}
                  </button>
                  <button onClick={()=>generateReport("all")} disabled={reportLoading}
                    style={{background:C.navy2,color:C.muted2,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 20px",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans'",opacity:reportLoading?0.7:1}}>
                    All-Time Stats
                  </button>
                  {report&&<div style={{color:C.muted,fontSize:12}}>Report for: {report.period==="week"?"Last 7 days":"All time"}</div>}
                </div>

                {report&&(
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
                      {[{l:"Total Athletes",v:report.totalAthletes,c:C.gold},{l:"Sessions Logged",v:report.activeSessions,c:C.green},{l:"Active Athletes",v:report.activeAthletes,c:C.green},{l:"New PRs",v:report.newPRs,c:"#3b82f6"},{l:"Pain Flags",v:report.painCount,c:C.red}].map(s=>(
                        <div key={s.l} style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:28,color:s.c}}>{s.v}</div>
                          <div style={{color:C.muted,fontSize:10,letterSpacing:1}}>{s.l}</div>
                        </div>
                      ))}
                    </div>

                    {report.inactiveAthletes.length>0&&(
                      <div style={{background:C.navy2,border:`1px solid ${C.red}40`,borderRadius:14,padding:16}}>
                        <div style={{color:C.red,fontSize:11,letterSpacing:1,fontWeight:700,marginBottom:8}}>INACTIVE THIS PERIOD</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {report.inactiveAthletes.map((n,i)=>(
                            <div key={i} style={{background:"#1e0a0a",border:`1px solid ${C.red}30`,borderRadius:6,padding:"4px 10px",fontSize:12,color:C.red}}>{n}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {report.prDetails.length>0&&(
                      <div style={{background:C.navy2,border:`1px solid ${C.gold}40`,borderRadius:14,padding:16}}>
                        <div style={{color:C.gold,fontSize:11,letterSpacing:1,fontWeight:700,marginBottom:8}}>NEW PRs</div>
                        {report.prDetails.map((p,i)=>(
                          <div key={i} style={{color:C.muted2,fontSize:13,padding:"4px 0",borderBottom:`1px solid ${C.border}20`}}>{p}</div>
                        ))}
                      </div>
                    )}

                    {report.painDetails.length>0&&(
                      <div style={{background:C.navy2,border:`1px solid ${C.red}40`,borderRadius:14,padding:16}}>
                        <div style={{color:C.red,fontSize:11,letterSpacing:1,fontWeight:700,marginBottom:8}}>PAIN FLAGS</div>
                        {report.painDetails.map((p,i)=>(
                          <div key={i} style={{color:C.muted2,fontSize:13,padding:"4px 0",borderBottom:`1px solid ${C.border}20`}}>{p}</div>
                        ))}
                      </div>
                    )}

                    <div style={{background:C.navy2,border:`1px solid #3b82f640`,borderRadius:14,padding:16}}>
                      <div style={{color:"#3b82f6",fontSize:11,letterSpacing:1,fontWeight:700,marginBottom:8}}>COMMON QUESTIONS & THEMES</div>
                      <div style={{color:C.muted2,fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{report.questionSummary}</div>
                    </div>
                  </div>
                )}

                {!report&&!reportLoading&&(
                  <div style={{textAlign:"center",padding:60,color:C.muted}}>Click "This Week's Report" to generate your report.</div>
                )}
              </div>
            )}

            {/* ── COACHES TAB (master only) ── */}
            {activeTab==="coaches"&&isMaster&&(
              <div style={{maxWidth:800}}>
                <div style={{marginBottom:16,color:C.muted2,fontSize:13,lineHeight:1.6}}>
                  To add a new coach, go to your Supabase dashboard → Table Editor → coaches → Insert row.<br/>
                  Set their name, email, sports (as an array e.g. {"{Football}"}), access_code, and role ("coach" or "master").
                </div>
                <div style={{background:C.navy2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                  <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,color:C.gold,fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:2}}>ALL COACHES</div>
                  {allCoaches.length===0 ? (
                    <div style={{padding:24,textAlign:"center",color:C.muted}}>No coaches yet</div>
                  ) : allCoaches.map((c,i)=>(
                    <div key={i} style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:12}}>
                      <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${C.gold},#8a6000)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,color:"#000",flexShrink:0}}>{c.name?.[0]?.toUpperCase()||"?"}</div>
                      <div style={{flex:1}}>
                        <div style={{color:C.text,fontWeight:600,fontSize:14}}>{c.name}</div>
                        <div style={{color:C.muted,fontSize:11}}>{c.role==="master"?"Master Access":c.sports?.join(", ")||"No sports assigned"}</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{color:C.muted,fontSize:11}}>Code: {c.access_code}</div>
                        <div style={{color:c.pin?C.green:C.red,fontSize:10}}>{c.pin?"PIN set":"Not activated"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
