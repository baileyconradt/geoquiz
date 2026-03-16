import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import {
  onAuthStateChanged, signInWithPopup, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, addDoc, collection,
  query, where, orderBy, limit, getDocs, deleteDoc,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase.js";
import { RAW } from "./data/CountryData.js";
import { REGIONS } from "./data/Regions.js";
import { MICROSTATE_PINS } from "./data/MicrostatePins.js";

const COUNTRIES = RAW.map(([name,id,alpha2,numeric,capital,region])=>({
  id,alpha2,numeric,name,capital,region,
})).sort((a,b)=>a.name.localeCompare(b.name));

const ALIASES = new Map([
  ["czech republic","CZE"],["usa","USA"],["united states of america","USA"],
  ["uae","ARE"],["ivory coast","CIV"],["cote divoire","CIV"],["cote d ivoire","CIV"],
  ["democratic republic of the congo","COD"],["drc","COD"],["dr congo","COD"],
  ["republic of the congo","COG"],["burma","MMR"],["timor leste","TLS"],["east timor","TLS"],
  ["cape verde","CPV"],["swaziland","SWZ"],["viet nam","VNM"],
  ["russia","RUS"],["russian federation","RUS"],["vatican","VAT"],["holy see","VAT"],
  ["macedonia","MKD"],["south korea","KOR"],["north korea","PRK"],
  ["trinidad","TTO"],["saint vincent","VCT"],["st lucia","LCA"],
  ["st kitts","KNA"],["st kitts and nevis","KNA"],["united arab emirates","ARE"],
  ["palestine","PSE"],["cabo verde","CPV"],["eswatini","SWZ"],
]);



/* ─── Fuzzy answer matching ──────────────────────────────────────────────── */
// Normalize: lowercase, strip accents, strip punctuation, collapse spaces
function normStr(s){
  return s.toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
}
function levenshtein(a,b){
  const m=a.length,n=b.length;
  const d=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)
    d[i][j]=a[i-1]===b[j-1]?d[i-1][j-1]:1+Math.min(d[i-1][j-1],d[i-1][j],d[i][j-1]);
  return d[m][n];
}
// Returns {ok, close} — close=true means accepted via fuzzy/alias (not exact)
function checkAnswer(input,target,isCountry=false){
  const a=normStr(input),b=normStr(target);
  if(!a)return{ok:false,close:false};
  if(a===b)return{ok:true,close:false};
  // Levenshtein tolerance: 0 for ≤4 chars, 1 for 5–9, 2 for 10+
  const tol=b.length>=10?2:b.length>=5?1:0;
  if(levenshtein(a,b)<=tol)return{ok:true,close:true};
  // For country names also check ALIASES (e.g. "Czech Republic" → Czechia)
  if(isCountry){
    const aliasId=ALIASES.get(a);
    if(aliasId){
      const ac=COUNTRIES.find(c=>c.id===aliasId);
      if(ac&&normStr(ac.name)===b)return{ok:true,close:true};
    }
  }
  return{ok:false,close:false};
}



const byRegion = id => id==="world" ? COUNTRIES
  : COUNTRIES.filter(c=>c.region==={africa:"Africa",europe:"Europe",asia:"Asia",americas:"Americas",oceania:"Oceania"}[id]);

/* ─── Design tokens ───────────────────────────────────────────────────────── */
const C = {
  bg:"#f0f5fc", s1:"#ffffff", s2:"#e8f0fb", s3:"#d0e0f7",
  b1:"rgba(30,80,180,.1)", b2:"rgba(30,80,180,.2)",
  tx:"#0d1b3e", mu:"#3d5a8a", dim:"#7a9ac4",
  az:"#1a5fdb", azBg:"rgba(26,95,219,.08)", azBd:"rgba(26,95,219,.28)", azHov:"rgba(26,95,219,.14)",
  gr:"#0a7d55", grBg:"rgba(10,125,85,.08)", grBd:"rgba(10,125,85,.3)",
  re:"#c8201a", reBg:"rgba(200,32,26,.07)", reBd:"rgba(200,32,26,.25)",
  am:"#d97706", amBg:"rgba(217,119,6,.12)", amBd:"rgba(217,119,6,.3)",
  ocean:"#ddeeff", land:"#c8daf5", landDim:"#e8edf6",
};

/* ─── Styles ──────────────────────────────────────────────────────────────── */
//...and they said my inline css was too much -ryan
(() => {
  if (document.getElementById("gd-css")) return;
  const el = document.createElement("style"); el.id="gd-css";
  el.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:${C.bg};font-family:'DM Sans',sans-serif;color:${C.tx};-webkit-font-smoothing:antialiased}
    button{cursor:pointer;border:none;background:none;font-family:inherit;color:inherit}
    input{font-family:'DM Sans',sans-serif}
    input:focus{outline:none}
    ::selection{background:rgba(26,95,219,.18)}
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-thumb{background:${C.s3};border-radius:4px}
    @keyframes fadeIn {from{opacity:0}to{opacity:1}}
    @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
    @keyframes spin   {to{transform:rotate(360deg)}}
    @keyframes pop    {0%{transform:scale(.82);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes pulse  {0%,100%{opacity:1}50%{opacity:.3}}
    @keyframes bump   {0%{transform:scale(1)}40%{transform:scale(1.07)}100%{transform:scale(1)}}
    @keyframes shake  {0%{transform:translateX(0)}20%{transform:translateX(-5px)}50%{transform:translateX(5px)}80%{transform:translateX(-3px)}100%{transform:translateX(0)}}
    .fadein {animation:fadeIn  .3s ease-out both}
    .slideup{animation:slideUp .3s ease-out both}
    .popin  {animation:pop     .22s ease-out both}
    .pulse-a{animation:pulse   2s  ease-in-out infinite}
    .bump   {animation:bump    .22s ease-out}
    .shake  {animation:shake   .3s  ease-out}
    .spin-el{display:inline-block;width:24px;height:24px;border:2px solid ${C.azBd};border-top-color:${C.az};border-radius:50%;animation:spin .7s linear infinite}
    .zc-btn{width:30px;height:30px;border-radius:8px;background:${C.s1};border:1px solid ${C.b1};
      display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;
      color:${C.az};cursor:pointer;transition:all .15s;box-shadow:0 1px 4px rgba(30,80,180,.08);
      font-family:'DM Sans',sans-serif;}
    .zc-btn:hover{background:${C.azBg};border-color:${C.azBd}}
    .choice-btn{width:100%;padding:12px 14px;border-radius:12px;font-size:13px;font-weight:500;
      text-align:left;cursor:pointer;transition:all .15s;border:1.5px solid ${C.b1};
      background:${C.s1};color:${C.tx};font-family:'DM Sans',sans-serif;
      box-shadow:0 1px 4px rgba(30,80,180,.05);}
    .choice-btn:hover:not(:disabled){background:${C.azBg};border-color:${C.azBd};color:${C.az}}
    .choice-btn:disabled{cursor:default}
    .choice-correct{background:${C.grBg}!important;border-color:${C.grBd}!important;color:${C.gr}!important}
    .choice-wrong  {background:${C.reBg}!important;border-color:${C.reBd}!important;color:${C.re}!important}
  `;
  document.head.appendChild(el);
})();

/* ─── Utils ───────────────────────────────────────────────────────────────── */
const norm    = s=>(s||"").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9\s'-]/g,"");
const pct     = (a,b)=>b===0?0:Math.round(a/b*100);
const shuffle = a=>[...a].sort(()=>Math.random()-.5);
const fmtTime = s=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const relTime = ms=>{
  const s=Math.round((Date.now()-ms)/1000);
  if(s<60)return"just now"; if(s<3600)return`${Math.floor(s/60)}m ago`;
  if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`;
};
const makeChoices = (correct, pool, getLabel) =>
  shuffle([getLabel(correct), ...shuffle(pool.filter(c=>c.id!==correct.id)).slice(0,3).map(getLabel)]);

/* ─── Firebase storage helpers ────────────────────────────────────────────── */
async function saveResult(uid,displayName,result){
  const newP=pct(result.score,result.total);
  const ts=Date.now();

  // 1. Add to recent subcollection; prune to 30
  const recentCol=collection(db,`users/${uid}/recent`);
  await addDoc(recentCol,{...result,ts});
  const oldQ=query(recentCol,orderBy("ts","desc"),limit(1000));
  const snap=await getDocs(oldQ);
  if(snap.size>30){
    const toDelete=snap.docs.slice(30);
    await Promise.all(toDelete.map(d=>deleteDoc(d.ref)));
  }

  // 2. Personal best: set if improved
  const bestKey=`${result.mode}_${result.region}`;
  const bestRef=doc(db,`users/${uid}/bests`,bestKey);
  const bestSnap=await getDoc(bestRef);
  if(!bestSnap.exists()||newP>(bestSnap.data().pct||0)){
    await setDoc(bestRef,{...result,pct:newP,ts});
  }

  // 3. Leaderboard: flat collection, one doc per user per mode+region
  const lbKey=`${uid}_${result.mode}_${result.region}`;
  const lbRef=doc(db,"leaderboard",lbKey);
  const lbSnap=await getDoc(lbRef);
  if(!lbSnap.exists()||newP>(lbSnap.data().pct||0)){
    await setDoc(lbRef,{uid,displayName,...result,pct:newP,ts});
  }
}

async function getLeaderboard(mode,region){
  const q=query(
    collection(db,"leaderboard"),
    where("mode","==",mode),
    where("region","==",region),
    orderBy("pct","desc"),
    limit(100)
  );
  const snap=await getDocs(q);
  return snap.docs.map(d=>d.data());
}

/* ─── Primitives ──────────────────────────────────────────────────────────── */
const Spinner=()=><div className="spin-el"/>;
function Toggle({value,onChange}){
  return(
    <button onClick={()=>onChange(!value)}
      style={{width:44,height:24,borderRadius:12,background:value?C.az:C.s3,
        padding:2,cursor:"pointer",transition:"background .2s",border:`1px solid ${value?C.azBd:C.b1}`,flexShrink:0}}>
      <span style={{display:"block",width:20,height:20,background:"#fff",borderRadius:10,
        transition:"transform .2s",transform:value?"translateX(20px)":"none",
        boxShadow:"0 1px 3px rgba(0,0,0,.2)"}}/>
    </button>
  );
}

/* ─── WorldMap with zoom ──────────────────────────────────────────────────── */
// ~0.72° ≈ 80 km ≈ 50 miles — buffer added around the correct country's bounding box
const PROX_DEG=0.72;

function WorldMap({geo,regionId,highlightNumerics,flashNumeric,flashCorrect,correctNumeric,onTap,zoomable=false}){
  const svgRef  = useRef(null);
  const zoomRef = useRef(null);
  const [xfm,setXfm]=useState({x:0,y:0,k:1});

  const regionNums=useMemo(()=>{
    if(!regionId||regionId==="world")return null;
    const label={africa:"Africa",europe:"Europe",asia:"Asia",americas:"Americas",oceania:"Oceania"}[regionId];
    if(!label)return null;
    return new Set(COUNTRIES.filter(c=>c.region===label).map(c=>c.numeric).filter(Boolean));
  },[regionId]);

  const {paths,projFn,geoData}=useMemo(()=>{
    if(!geo)return{paths:[],projFn:null,geoData:{}};
    const proj=d3.geoNaturalEarth1();const VW=960,VH=500;
    if(regionNums&&regionNums.size<190){
      const feats=geo.features.filter(f=>regionNums.has(String(f.id)));
      feats.length?proj.fitExtent([[32,22],[VW-32,VH-22]],{type:"FeatureCollection",features:feats})
        :proj.fitExtent([[10,10],[VW-10,VH-10]],geo);
    }else proj.fitExtent([[5,5],[VW-5,VH-5]],geo);
    const pathFn=d3.geoPath().projection(proj);
    const paths=geo.features.map((f,i)=>{const d=pathFn(f);return d?{id:f.id!=null?String(f.id):`feat_${i}`,d,feature:f}:null;}).filter(Boolean);
    // Geographic centroid + bounding-box for proximity detection (works in degree-space, not SVG-pixels)
    const geoData={};
    geo.features.forEach(f=>{
      const id=f.id!=null?String(f.id):null;if(!id)return;
      try{
        const c=d3.geoCentroid(f);
        const b=d3.geoBounds(f); // [[minLon,minLat],[maxLon,maxLat]]
        if(!isNaN(c[0])&&!isNaN(c[1]))geoData[id]={lon:c[0],lat:c[1],bounds:b};
      }catch{}
    });
    // Microstates: use their pin coords with a small bounding box
    MICROSTATE_PINS.forEach(p=>{
      geoData[p.numeric]={lon:p.lon,lat:p.lat,
        bounds:[[p.lon-0.5,p.lat-0.5],[p.lon+0.5,p.lat+0.5]]};
    });
    return{paths,projFn:proj,geoData};
  },[geo,regionNums]);

  // Microstate pins: dots for all MICROSTATE_PINS in the current region.
  // We always show pins even for countries that ARE in the TopoJSON, because their
  // polygons are too tiny to click reliably at normal zoom levels.
  const microPins=useMemo(()=>{
    if(!projFn||!onTap)return[];
    return MICROSTATE_PINS
      .filter(p=>(!regionNums||regionNums.has(p.numeric)))
      .map(p=>{
        try{const [x,y]=projFn([p.lon,p.lat]);return isNaN(x)||isNaN(y)?null:{...p,x,y};}
        catch{return null;}
      }).filter(Boolean);
  },[projFn,regionNums,onTap]);

  useEffect(()=>{
    if(!zoomable||!svgRef.current||!paths.length)return;
    const zoom=d3.zoom().scaleExtent([1,10]).translateExtent([[0,0],[960,500]])
      .on("zoom",e=>setXfm(e.transform));
    zoomRef.current=zoom;
    d3.select(svgRef.current).call(zoom);
    return()=>{try{d3.select(svgRef.current).on(".zoom",null)}catch{}};
  },[zoomable,paths.length]);

  const zoomBy=f=>{if(svgRef.current&&zoomRef.current)d3.select(svgRef.current).transition().duration(220).call(zoomRef.current.scaleBy,f);};
  const resetZoom=()=>{if(svgRef.current&&zoomRef.current)d3.select(svgRef.current).transition().duration(280).call(zoomRef.current.transform,d3.zoomIdentity);};

  // tappableFeatures: paths in the active region, used for geoContains hit testing
  const tappableFeatures=useMemo(()=>
    paths.filter(p=>!regionNums||regionNums.has(p.id))
  ,[paths,regionNums]);

  // Proximity-aware click: correct if the clicked country's centroid lands within
  // PROX_DEG degrees of the correct country's geographic bounding box (~50 miles buffer).
  const handleClick=useCallback(tappedId=>{
    if(!onTap)return;
    if(!correctNumeric||tappedId===correctNumeric){onTap(tappedId);return;}
    const tc=geoData[tappedId],cc=geoData[correctNumeric];
    if(tc&&cc){
      const[[mnLon,mnLat],[mxLon,mxLat]]=cc.bounds;
      if(tc.lon>=mnLon-PROX_DEG&&tc.lon<=mxLon+PROX_DEG&&
         tc.lat>=mnLat-PROX_DEG&&tc.lat<=mxLat+PROX_DEG){onTap(correctNumeric);return;}
    }
    onTap(tappedId);
  },[onTap,correctNumeric,geoData]);

  // SVG-level click handler using d3.geoContains for exact point-in-polygon detection.
  // Eliminates z-order hit-target overlap that caused Belgium→Germany-style misregistrations.
  const handleSvgClick=useCallback(e=>{
    if(!onTap||!projFn)return;
    const rect=svgRef.current.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*960;
    const svgY=(e.clientY-rect.top)/rect.height*500;
    const geoX=(svgX-xfm.x)/xfm.k;
    const geoY=(svgY-xfm.y)/xfm.k;
    const pt=projFn.invert([geoX,geoY]);
    if(!pt)return;
    const hits=tappableFeatures.filter(p=>{try{return d3.geoContains(p.feature,pt);}catch{return false;}});
    if(!hits.length)return;
    handleClick(hits[0].id);
  },[onTap,projFn,xfm,tappableFeatures,handleClick]);

  const getColor=useCallback(id=>{
    if(flashNumeric===id)return flashCorrect?C.gr:C.re;
    // Highlight the correct country in amber when the player got it wrong
    if(!flashCorrect&&flashNumeric&&id===correctNumeric)return C.am;
    if(highlightNumerics?.has(id))return C.az;
    if(regionNums&&!regionNums.has(id))return C.landDim;
    return C.land;
  },[flashNumeric,flashCorrect,highlightNumerics,regionNums,correctNumeric]);

  if(!geo||!paths.length)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:180,background:C.s2,borderRadius:12}}><Spinner/></div>
  );
  const tStr=`translate(${xfm.x},${xfm.y}) scale(${xfm.k})`;
  return(
    <div style={{position:"relative",borderRadius:12,overflow:"hidden",border:`1px solid ${C.b1}`,background:C.ocean,boxShadow:"0 2px 12px rgba(30,80,180,.07)"}}>
      <svg ref={svgRef} viewBox="0 0 960 500"
        style={{display:"block",width:"100%",cursor:zoomable?"grab":"default"}}
        onClick={onTap?handleSvgClick:undefined}
        onMouseDown={e=>{if(zoomable)e.currentTarget.style.cursor="grabbing"}}
        onMouseUp  ={e=>{if(zoomable)e.currentTarget.style.cursor="grab"}}
        onMouseLeave={e=>{if(zoomable)e.currentTarget.style.cursor="grab"}}>
        <rect width={960} height={500} fill={C.ocean}/>
        <g transform={tStr}>
          {paths.map(p=>{
            const tappable=onTap&&(!regionNums||regionNums.has(p.id));
            return(
              <g key={p.id}>
                <path d={p.d} fill={getColor(p.id)} stroke="#fff" strokeWidth={0.5/Math.max(1,xfm.k)}
                  style={{transition:"fill .12s ease",cursor:tappable?"pointer":"default"}}/>
              </g>
            );
          })}

          {/* Microstate pins — clickable dots for countries absent from the TopoJSON */}
          {microPins.map(p=>{
            const r=5/Math.max(1,xfm.k);
            const hitR=14/Math.max(1,xfm.k);
            return(
              <g key={`pin_${p.numeric}`}>
                {/* Outer ring */}
                <circle cx={p.x} cy={p.y} r={r+1.5/Math.max(1,xfm.k)} fill="#fff" opacity={0.9}/>
                {/* Filled dot */}
                <circle cx={p.x} cy={p.y} r={r} fill={getColor(p.numeric)}
                  stroke="#fff" strokeWidth={0.8/Math.max(1,xfm.k)}
                  style={{transition:"fill .12s ease"}}/>
                {/* Large transparent hit area */}
                <circle cx={p.x} cy={p.y} r={hitR} fill="rgba(0,0,0,0)"
                  pointerEvents="all" style={{cursor:"pointer"}}
                  onClick={()=>handleClick(p.numeric)}/>
              </g>
            );
          })}
        </g>
      </svg>
      {zoomable&&(
        <div style={{position:"absolute",bottom:10,right:10,display:"flex",flexDirection:"column",gap:4}}>
          <button className="zc-btn" onClick={()=>zoomBy(1.6)}>+</button>
          <button className="zc-btn" onClick={()=>zoomBy(1/1.6)}>−</button>
          <button className="zc-btn" onClick={resetZoom} style={{fontSize:12}}>⊙</button>
        </div>
      )}
      {zoomable&&xfm.k===1&&(
        <div style={{position:"absolute",bottom:10,left:10,fontSize:10,color:C.dim,
          background:"rgba(255,255,255,.85)",borderRadius:6,padding:"3px 7px",
          pointerEvents:"none",backdropFilter:"blur(4px)"}}>
          scroll to zoom · drag to pan
        </div>
      )}
    </div>
  );
}

/* ─── Geo hook ────────────────────────────────────────────────────────────── */
function useGeo(){
  const [geo,setGeo]=useState(null);
  useEffect(()=>{
    (async()=>{
      try{
        if(!window.topojson){
          await new Promise((res,rej)=>{
            const s=document.createElement("script");
            s.src="https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js";
            s.onload=res;s.onerror=rej;document.head.appendChild(s);
          });
        }
        const r=await fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json");
        const w=await r.json();
        setGeo(window.topojson.feature(w,w.objects.countries));
      }catch(e){console.error("Map:",e);}
    })();
  },[]);
  return geo;
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP ROOT
═══════════════════════════════════════════════════════════════════════════ */
export default function App(){
  const [user,          setUser]         =useState(null);
  const [screen,        setScreen]       =useState("boot");
  const [quizCfg,       setQuizCfg]      =useState(null);
  const [pendingResult, setPendingResult]=useState(null);
  const geo=useGeo();

  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,async fbUser=>{
      if(fbUser){
        let displayName=fbUser.displayName||fbUser.email?.split("@")[0]||"Explorer";
        try{
          const userRef=doc(db,"users",fbUser.uid);
          const snap=await getDoc(userRef);
          if(snap.exists()&&snap.data().displayName){
            displayName=snap.data().displayName;
          }else{
            await setDoc(userRef,{displayName,photoURL:fbUser.photoURL||""},{merge:true});
          }
        }catch(e){
          console.warn("Firestore profile load failed, using auth name:",e.message);
        }
        setUser({uid:fbUser.uid,displayName,photoURL:fbUser.photoURL||""});
        setScreen("home");
      }else{
        setUser(null);
        if(screen!=="home")setScreen("login");
      }
    });
    return unsub;
  },[]);// Save any pending guest result once a user signs in
  useEffect(()=>{
    if(user&&pendingResult){
      saveResult(user.uid,user.displayName,pendingResult).catch(e=>console.warn(e));
      setPendingResult(null);
    }
  },[user,pendingResult]);

  const handleChangeName=async name=>{
    if(!user)return;
    await setDoc(doc(db,"users",user.uid),{displayName:name},{merge:true});
    setUser(u=>({...u,displayName:name}));
  };
  const handleSignOut=()=>signOut(auth);
  const startQuiz=cfg=>{setQuizCfg(cfg);setScreen(cfg.mode);};
  const goHome=()=>setScreen("home");
  const goGuest=useCallback(()=>setScreen("home"),[]);
  const onFinish=useCallback(async result=>{
    if(user)try{await saveResult(user.uid,user.displayName,result);}catch(e){console.warn(e);}
    else setPendingResult(result);
  },[user]);

  if(screen==="boot")return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:44}} className="pulse-a">🌐</div>
      <div style={{fontFamily:"'Libre Baskerville',serif",fontSize:28,fontWeight:700,color:C.tx}}>Geo<span style={{color:C.az}}>Quiz</span></div>
      <Spinner/>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:C.bg}}>
      {user&&<Navbar screen={screen} setScreen={setScreen} user={user} onChangeName={handleChangeName} onSignOut={handleSignOut}/>}
      <div style={{paddingTop:user?52:0}}>
        {screen==="login"      &&<LoginScreen onGuest={goGuest}/>}
        {screen==="home"       &&<HomeScreen user={user} onStart={startQuiz} geo={geo} onSignIn={()=>setScreen("login")}/>}
        {screen==="listing"    &&quizCfg&&<ListingQuiz  config={quizCfg} geo={geo} goHome={goHome} onFinish={onFinish} user={user}/>}
        {screen==="tapmap"     &&quizCfg&&<TapMapQuiz   config={quizCfg} geo={geo} goHome={goHome} onFinish={onFinish} user={user}/>}
        {screen==="flags"      &&quizCfg&&<PairingGame  config={quizCfg} goHome={goHome} onFinish={onFinish} gameType="flags" user={user}/>}
        {screen==="capitals"   &&quizCfg&&<PairingGame  config={quizCfg} goHome={goHome} onFinish={onFinish} gameType="capitals" user={user}/>}
        {screen==="profile"    &&<ProfileScreen user={user}/>}
        {screen==="leaderboard"&&<LeaderboardScreen user={user}/>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LOGIN
═══════════════════════════════════════════════════════════════════════════ */
const EMAIL_ERRORS={
  "auth/user-not-found":"No account found with that email. Check your email or create an account.",
  "auth/wrong-password":"Incorrect password. Please try again.",
  "auth/invalid-credential":"Incorrect email or password.",
  "auth/invalid-email":"Please enter a valid email address.",
  "auth/weak-password":"Password must be at least 6 characters.",
  "auth/too-many-requests":"Too many attempts. Please wait a moment and try again.",
};

function LoginScreen({onGuest}){
  const [mode,setMode]=useState("signin"); // "signin"|"signup"
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [loading,setLoading]=useState(null); // "google"|"email"|null
  const [error,setError]=useState("");

  const signInGoogle=async()=>{
    setLoading("google");setError("");
    try{await signInWithPopup(auth,googleProvider);}
    catch(e){
      if(e.code==="auth/account-exists-with-different-credential"){
        // Their Google email is already registered with email/password
        setError("This email already has a password account. Enter your email and password in the form below to sign in.");
      } else if(e.code!=="auth/popup-closed-by-user"){
        setError(EMAIL_ERRORS[e.code]||"Google sign-in failed. Please try again.");
      }
      setLoading(null);
    }
  };

  const submitEmail=async e=>{
    e.preventDefault();
    if(!email.trim()||!password)return;
    if(mode==="signup"&&!name.trim()){setError("Please enter your name.");return;}
    setLoading("email");setError("");
    try{
      if(mode==="signup"){
        const cred=await createUserWithEmailAndPassword(auth,email.trim(),password);
        await updateProfile(cred.user,{displayName:name.trim()});
      }else{
        await signInWithEmailAndPassword(auth,email.trim(),password);
      }
      // onAuthStateChanged handles navigation
    }catch(e){
      if(e.code==="auth/email-already-in-use"&&mode==="signup"){
        // Email exists — could be Google or another password account
        setMode("signin");
        setError("This email is already registered. We've switched to Sign In — if you signed up with Google, use 'Continue with Google' above.");
      } else {
        setError(EMAIL_ERRORS[e.code]||"Something went wrong. Please try again.");
      }
      setLoading(null);
    }
  };

  const inputStyle={
    width:"100%",padding:"12px 14px",borderRadius:10,fontSize:14,
    background:C.s1,border:`1.5px solid ${C.b1}`,color:C.tx,
    outline:"none",boxSizing:"border-box",transition:"border-color .15s",
  };

  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,opacity:.45,pointerEvents:"none",backgroundImage:`radial-gradient(${C.b1} 1px,transparent 1px)`,backgroundSize:"28px 28px"}}/>
      <div style={{position:"absolute",top:"28%",left:"50%",transform:"translate(-50%,-50%)",width:560,height:420,background:`radial-gradient(ellipse,rgba(26,95,219,.12),transparent 70%)`,pointerEvents:"none"}}/>
      <div className="fadein" style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center",padding:"0 28px",maxWidth:400,width:"100%"}}>
        <div style={{fontSize:52,marginBottom:16}} className="pulse-a">🌐</div>
        <h1 style={{fontFamily:"'Libre Baskerville',serif",fontSize:46,fontWeight:700,letterSpacing:-1.5,lineHeight:.95,marginBottom:10,color:C.tx}}>
          Geo<span style={{color:C.az}}>Quiz</span>
        </h1>
        <p style={{color:C.mu,fontSize:15,lineHeight:1.65,marginBottom:30,maxWidth:270}}>
          Test your world geography. Name countries, tap maps, race the clock.
        </p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",marginBottom:28}}>
          {["✍️ Region Listing","🗺️ Tap the Map","🚩 Flag Match","🏛️ Capitals"].map(m=>(
            <span key={m} style={{background:C.s1,border:`1px solid ${C.b1}`,borderRadius:20,padding:"5px 12px",fontSize:11,color:C.mu,boxShadow:"0 1px 4px rgba(30,80,180,.07)"}}>{m}</span>
          ))}
        </div>

        <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10}}>
          {/* Google */}
          <button onClick={signInGoogle} disabled={!!loading}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"13px 16px",
              borderRadius:12,fontWeight:600,fontSize:15,border:`1.5px solid ${C.b2}`,
              background:C.s1,color:C.tx,cursor:loading?"not-allowed":"pointer",
              opacity:loading&&loading!=="google"?.5:1,transition:"all .15s",
              boxShadow:"0 2px 10px rgba(30,80,180,.08)"}}>
            {loading==="google"?<Spinner/>:<GoogleIcon/>}
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{display:"flex",alignItems:"center",gap:10,margin:"2px 0"}}>
            <div style={{flex:1,height:1,background:C.b1}}/>
            <span style={{fontSize:11,color:C.dim}}>or</span>
            <div style={{flex:1,height:1,background:C.b1}}/>
          </div>

          {/* Email/password form */}
          <form onSubmit={submitEmail} style={{display:"flex",flexDirection:"column",gap:8,textAlign:"left"}}>
            {mode==="signup"&&(
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"
                style={inputStyle} disabled={!!loading}
                onFocus={e=>e.target.style.borderColor=C.azBd}
                onBlur={e=>e.target.style.borderColor=C.b1}/>
            )}
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address"
              style={inputStyle} disabled={!!loading} autoComplete="email"
              onFocus={e=>e.target.style.borderColor=C.azBd}
              onBlur={e=>e.target.style.borderColor=C.b1}/>
            <div style={{position:"relative"}}>
              <input type={showPw?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)}
                placeholder="Password" style={{...inputStyle,paddingRight:42}} disabled={!!loading}
                autoComplete={mode==="signup"?"new-password":"current-password"}
                onFocus={e=>e.target.style.borderColor=C.azBd}
                onBlur={e=>e.target.style.borderColor=C.b1}/>
              <button type="button" onClick={()=>setShowPw(p=>!p)}
                style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
                  background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:13,padding:2}}>
                {showPw?"🙈":"👁"}
              </button>
            </div>
            <button type="submit" disabled={!!loading||!email.trim()||!password}
              style={{padding:"13px",borderRadius:12,fontWeight:700,fontSize:15,border:"none",marginTop:2,
                background:email.trim()&&password?C.az:"rgba(26,95,219,.2)",
                color:email.trim()&&password?"#fff":"rgba(26,95,219,.45)",
                cursor:email.trim()&&password&&!loading?"pointer":"not-allowed",
                transition:"all .15s",boxShadow:email.trim()&&password?`0 4px 18px rgba(26,95,219,.28)`:"none"}}>
              {loading==="email"?<Spinner/>:mode==="signup"?"Create Account":"Sign In"}
            </button>
          </form>
        </div>

        {error&&<p style={{marginTop:10,color:C.re,fontSize:12,textAlign:"center"}}>{error}</p>}

        <p style={{marginTop:14,color:C.dim,fontSize:12}}>
          {mode==="signin"?"Don't have an account? ":"Already have an account? "}
          <button onClick={()=>{setMode(m=>m==="signin"?"signup":"signin");setError("");}}
            style={{background:"none",border:"none",color:C.az,fontWeight:600,fontSize:12,cursor:"pointer",padding:0}}>
            {mode==="signin"?"Create one":"Sign in"}
          </button>
        </p>
        <button onClick={onGuest}
          style={{marginTop:18,background:"none",border:"none",color:C.dim,fontSize:12,
            cursor:"pointer",textDecoration:"underline",padding:0}}>
          Continue without signing in
        </button>
      </div>
    </div>
  );
}

function FlagImg({alpha2, width=40, style={}}){
  return(
    <img
      src={`https://flagcdn.com/${alpha2}.svg`}
      width={width}
      alt=""
      style={{display:"inline-block",verticalAlign:"middle",borderRadius:2,flexShrink:0,outline:"3px solid rgba(0,0,0,0.25)",...style}}
    />
  );
}

function GoogleIcon(){
  return(
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVBAR
═══════════════════════════════════════════════════════════════════════════ */
function Navbar({screen,setScreen,user,onChangeName,onSignOut}){
  const [editing,setEditing]=useState(false);
  const [val,setVal]=useState(user.displayName);
  const [showMenu,setShowMenu]=useState(false);
  const items=[{id:"home",label:"Play"},{id:"leaderboard",label:"Scores"},{id:"profile",label:"Profile"}];
  const commit=()=>{const t=val.trim();if(t)onChangeName(t);else setVal(user.displayName);setEditing(false);};
  return(
    <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:100,height:52,background:"rgba(240,245,252,.92)",backdropFilter:"blur(14px)",borderBottom:`1px solid ${C.b1}`,display:"flex",alignItems:"center",padding:"0 18px",justifyContent:"space-between",gap:8}}>
      <div style={{fontFamily:"'Libre Baskerville',serif",fontWeight:700,fontSize:19,cursor:"pointer",color:C.tx,letterSpacing:-.5,flexShrink:0}} onClick={()=>setScreen("home")}>
        Geo<span style={{color:C.az}}>Quiz</span>
      </div>
      <div style={{display:"flex",gap:2}}>
        {items.map(n=>(
          <button key={n.id} onClick={()=>setScreen(n.id)}
            style={{padding:"5px 12px",borderRadius:8,fontSize:13,fontWeight:500,transition:"all .15s",
              background:screen===n.id?C.azBg:"transparent",color:screen===n.id?C.az:C.mu,
              border:`1px solid ${screen===n.id?C.azBd:"transparent"}`}}>
            {n.label}
          </button>
        ))}
      </div>
      <div style={{flexShrink:0,position:"relative"}}>
        {editing?(
          <input value={val} onChange={e=>setVal(e.target.value)} onBlur={commit}
            onKeyDown={e=>e.key==="Enter"&&commit()} maxLength={24} autoFocus
            style={{padding:"4px 9px",borderRadius:7,background:C.s1,border:`1.5px solid ${C.azBd}`,color:C.tx,fontSize:12,width:120}}/>
        ):(
          <button onClick={()=>setShowMenu(m=>!m)}
            style={{display:"flex",alignItems:"center",gap:5,fontSize:12,color:C.mu,padding:"4px 6px",borderRadius:8,border:`1px solid transparent`,background:"none",cursor:"pointer",transition:"all .15s"}}
            onMouseEnter={e=>e.currentTarget.style.background=C.azBg}
            onMouseLeave={e=>e.currentTarget.style.background="none"}>
            {user.photoURL
              ?<img src={user.photoURL} style={{width:22,height:22,borderRadius:"50%",objectFit:"cover"}} alt=""/>
              :<span style={{fontSize:15}}>👤</span>}
            <span style={{fontWeight:500,maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.displayName}</span>
            <span style={{fontSize:9,color:C.dim}}>▾</span>
          </button>
        )}
        {showMenu&&!editing&&(
          <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:C.s1,border:`1px solid ${C.b1}`,borderRadius:10,boxShadow:"0 4px 16px rgba(30,80,180,.12)",minWidth:140,overflow:"hidden",zIndex:200}}
            onMouseLeave={()=>setShowMenu(false)}>
            <button onClick={()=>{setVal(user.displayName);setEditing(true);setShowMenu(false);}}
              style={{width:"100%",padding:"10px 14px",textAlign:"left",fontSize:12,color:C.tx,background:"none",border:"none",cursor:"pointer",borderBottom:`1px solid ${C.b1}`}}
              onMouseEnter={e=>e.currentTarget.style.background=C.azBg}
              onMouseLeave={e=>e.currentTarget.style.background="none"}>
              ✎ Edit name
            </button>
            <button onClick={()=>{setShowMenu(false);onSignOut();}}
              style={{width:"100%",padding:"10px 14px",textAlign:"left",fontSize:12,color:C.re,background:"none",border:"none",cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.background=C.reBg}
              onMouseLeave={e=>e.currentTarget.style.background="none"}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   HOME
═══════════════════════════════════════════════════════════════════════════ */
const MODES = [
  {id:"listing", emoji:"✍️", title:"Region Listing",  desc:"Name every country from memory"},
  {id:"tapmap",  emoji:"🗺️", title:"Tap the Map",     desc:"Find and tap the named country"},
  {id:"flags",   emoji:"🚩", title:"Flag Match",       desc:"Identify countries by their flag"},
  {id:"capitals",emoji:"🏛️", title:"Capital Quiz",     desc:"Match countries to their capitals"},
];

function HomeScreen({user,onStart,geo,onSignIn}){
  const [mode,   setMode]  =useState(null);
  const [region, setRegion]=useState(null);
  const [timerOn,setTimer] =useState(true);
  const [tMin,   setTMin]  =useState(5);
  const [hint,   setHint]  =useState(false);
  const [typeMode,setTypeMode]=useState(false);
  const [showSubset,setShowSubset]=useState(false);

  const needsSubset = !!mode;
  const canProceed  = !!(mode&&region);

  if(showSubset&&mode&&region){
    return(
      <SubsetSelector
        region={region} mode={mode} geo={geo}
        onBack={()=>setShowSubset(false)}
        onStart={subset=>onStart({
          mode,region,subset,
          timerEnabled:mode==="listing"&&timerOn,
          timerDuration:tMin*60,
          showFirstLetter:hint,
          typeMode,
        })}
      />
    );
  }

  return(
    <div style={{maxWidth:620,margin:"0 auto",padding:"24px 16px"}} className="fadein">
      <div style={{marginBottom:26,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <p style={{color:C.dim,fontSize:13,marginBottom:2}}>{user?"Welcome back,":"Playing as"}</p>
          <h1 style={{fontFamily:"'Libre Baskerville',serif",fontSize:28,fontWeight:700,color:C.tx}}>{user?user.displayName:"Guest"}</h1>
        </div>
        {!user&&(
          <button onClick={onSignIn}
            style={{padding:"9px 18px",borderRadius:10,background:C.az,color:"#fff",fontWeight:600,fontSize:13,border:"none",cursor:"pointer",boxShadow:`0 2px 10px rgba(26,95,219,.25)`}}>
            Sign In
          </button>
        )}
      </div>

      <Step n={1} title="Pick a mode">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {MODES.map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)}
              style={{padding:"16px 14px",borderRadius:14,textAlign:"left",cursor:"pointer",
                background:mode===m.id?C.azBg:C.s1,border:`1.5px solid ${mode===m.id?C.az:C.b1}`,
                transition:"all .15s",display:"flex",flexDirection:"column",gap:7,
                boxShadow:mode===m.id?`0 0 0 3px ${C.azBg}`:"0 1px 4px rgba(30,80,180,.06)"}}>
              <span style={{fontSize:22}}>{m.emoji}</span>
              <span style={{fontWeight:600,fontSize:13,color:mode===m.id?C.az:C.tx}}>{m.title}</span>
              <span style={{fontSize:11,color:C.dim,lineHeight:1.5}}>{m.desc}</span>
            </button>
          ))}
        </div>
      </Step>

      {mode&&(
        <Step n={2} title="Choose a region" cls="slideup">
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {REGIONS.map(r=>(
              <button key={r.id} onClick={()=>setRegion(r.id)}
                style={{padding:"10px 8px",borderRadius:12,textAlign:"center",cursor:"pointer",transition:"all .15s",
                  background:region===r.id?C.azBg:C.s1,border:`1.5px solid ${region===r.id?C.az:C.b1}`,
                  boxShadow:region===r.id?`0 0 0 2px ${C.azBg}`:"0 1px 4px rgba(30,80,180,.05)"}}>
                <div style={{fontSize:20}}>{r.emoji}</div>
                <div style={{fontSize:12,fontWeight:600,color:region===r.id?C.az:C.tx,marginTop:3}}>{r.label}</div>
                <div style={{fontSize:10,color:C.dim,marginTop:1}}>{r.hint}</div>
              </button>
            ))}
          </div>
        </Step>
      )}

      {/* Options — listing mode */}
      {mode==="listing"&&region&&(
        <Step n={3} title="Options" cls="slideup">
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <OptRow label="Timer" desc="Countdown pressure" right={<Toggle value={timerOn} onChange={setTimer}/>}/>
            {timerOn&&(
              <OptRow label="Time limit" desc={`${tMin} minutes`}
                right={<div style={{display:"flex",gap:6}}>
                  {[3,5,10,15].map(m=>(
                    <button key={m} onClick={()=>setTMin(m)}
                      style={{width:32,height:32,borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .15s",
                        background:tMin===m?C.az:C.s2,color:tMin===m?"#fff":C.mu,border:`1px solid ${tMin===m?C.az:C.b1}`}}>
                      {m}
                    </button>
                  ))}
                </div>}/>
            )}
            <OptRow label="First letter hint" desc="Show each country's initial" right={<Toggle value={hint} onChange={setHint}/>}/>
          </div>
        </Step>
      )}

      {/* Options — flags / capitals mode */}
      {(mode==="flags"||mode==="capitals")&&region&&(
        <Step n={3} title="Options" cls="slideup">
          <OptRow label="Answer style" desc={typeMode?"Type the answer":"Pick from 4 choices"}
            right={
              <div style={{display:"flex",borderRadius:10,overflow:"hidden",border:`1px solid ${C.b1}`}}>
                {[["choice","Multiple choice"],["type","Type it in"]].map(([v,lbl])=>{
                  const on=(v==="type")===typeMode;
                  return(
                    <button key={v} onClick={()=>setTypeMode(v==="type")}
                      style={{padding:"7px 13px",fontSize:12,fontWeight:600,cursor:"pointer",border:"none",
                        background:on?C.az:C.s1,color:on?"#fff":C.mu,transition:"all .15s"}}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            }
          />
        </Step>
      )}

      {/* All modes: country selection on next screen */}
      {region&&(
        <div className="slideup" style={{marginBottom:12,padding:"12px 14px",borderRadius:12,
          background:C.azBg,border:`1px solid ${C.azBd}`,fontSize:13,color:C.mu,lineHeight:1.5}}>
          🎯 You'll be able to choose exactly which countries to study on the next screen.
        </div>
      )}

      {canProceed&&(
        <button className="slideup"
          onClick={()=>{
            if(needsSubset){setShowSubset(true);}
            else onStart({mode,region,timerEnabled:mode==="listing"&&timerOn,timerDuration:tMin*60,showFirstLetter:hint});
          }}
          style={{width:"100%",padding:"15px",borderRadius:14,background:C.az,color:"#fff",
            fontWeight:700,fontSize:15,border:"none",cursor:"pointer",marginTop:8,
            boxShadow:`0 4px 20px rgba(26,95,219,.28)`}}>
          {needsSubset?"Choose Countries →":"Start Quiz →"}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUBSET SELECTOR
═══════════════════════════════════════════════════════════════════════════ */
function SubsetSelector({region,mode,geo,onBack,onStart}){
  // For TapMap, exclude countries that have no path in the TopoJSON (e.g. Kosovo)
  const geoNumerics=useMemo(()=>{
    if(!geo)return null;
    const s=new Set(geo.features.map(f=>f.id!=null?String(f.id):null).filter(Boolean));
    MICROSTATE_PINS.forEach(p=>s.add(p.numeric)); // pins count as "on the map"
    return s;
  },[geo]);
  const pool=useMemo(()=>{
    const all=byRegion(region);
    if(mode==="tapmap"&&geoNumerics) return all.filter(c=>!c.numeric||geoNumerics.has(c.numeric));
    return all;
  },[region,mode,geoNumerics]);
  const excluded=useMemo(()=>{
    if(mode!=="tapmap"||!geoNumerics)return[];
    return byRegion(region).filter(c=>c.numeric&&!geoNumerics.has(c.numeric));
  },[region,mode,geoNumerics]);
  const [selected,setSelected]=useState(()=>new Set(pool.map(c=>c.id)));
  const rl=REGIONS.find(r=>r.id===region);

  const toggle=id=>setSelected(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const selAll=()=>setSelected(new Set(pool.map(c=>c.id)));
  const selNone=()=>setSelected(new Set());
  const selRandom=n=>setSelected(new Set(shuffle(pool).slice(0,n).map(c=>c.id)));

  const count=selected.size;
  const canStart=count>=4;

  return(
    <div style={{maxWidth:660,margin:"0 auto",padding:"20px 16px"}} className="fadein">
      <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:6,color:C.mu,fontSize:13,marginBottom:18,background:"none",border:"none",cursor:"pointer"}}>
        ← Back
      </button>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:8}}>
        <div>
          <h2 style={{fontFamily:"'Libre Baskerville',serif",fontSize:20,fontWeight:700,color:C.tx}}>
            {rl?.emoji} {rl?.label} — {MODES.find(m2=>m2.id===mode)?.emoji} {MODES.find(m2=>m2.id===mode)?.title}
          </h2>
          <p style={{color:C.dim,fontSize:12,marginTop:2}}>
            {count} of {pool.length} countries selected
            {!canStart&&<span style={{color:C.re,marginLeft:8}}>— need at least 4</span>}
          </p>
        </div>
      </div>

      {/* Quick-select buttons */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
        {["All","None","Random 10","Random 20","Random 30"].map(lbl=>(
          <button key={lbl} onClick={()=>{
            if(lbl==="All")selAll();
            else if(lbl==="None")selNone();
            else selRandom(parseInt(lbl.split(" ")[1]));
          }}
          style={{padding:"5px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",transition:"all .15s",
            background:C.s1,border:`1px solid ${C.b1}`,color:C.mu}}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Country grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(148px,1fr))",gap:6,
        maxHeight:400,overflowY:"auto",paddingRight:4,marginBottom:16}}>
        {pool.map(c=>{
          const on=selected.has(c.id);
          return(
            <button key={c.id} onClick={()=>toggle(c.id)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"7px 10px",borderRadius:10,
                cursor:"pointer",transition:"all .15s",textAlign:"left",
                background:on?C.azBg:C.s1,border:`1.5px solid ${on?C.az:C.b1}`,
                boxShadow:on?`0 0 0 2px ${C.azBg}`:"none"}}>
              <FlagImg alpha2={c.alpha2} width={22}/>
              <span style={{fontSize:12,fontWeight:on?600:400,color:on?C.az:C.tx,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
            </button>
          );
        })}
      </div>

      {excluded.length>0&&(
        <p style={{fontSize:11,color:C.dim,marginBottom:8,lineHeight:1.5}}>
          ⚠️ {excluded.map(c=>c.name).join(", ")} {excluded.length===1?"is":"are"} not available in Tap the Map — {excluded.length===1?"it doesn't":"they don't"} appear in our map data.
        </p>
      )}
      <button onClick={()=>onStart([...selected])} disabled={!canStart}
        style={{width:"100%",padding:"14px",borderRadius:14,background:canStart?C.az:"rgba(26,95,219,.2)",
          color:canStart?"#fff":"rgba(26,95,219,.4)",fontWeight:700,fontSize:15,border:"none",
          cursor:canStart?"pointer":"not-allowed",boxShadow:canStart?`0 4px 20px rgba(26,95,219,.28)`:"none",transition:"all .15s"}}>
        Start with {count} countries →
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAIRING GAME  (flags + capitals share this component)
═══════════════════════════════════════════════════════════════════════════ */
function PairingGame({config,goHome,onFinish,gameType,user}){
  // gameType: "flags" | "capitals"
  const pool     = useMemo(()=>byRegion(config.region),[config.region]);
  const subsetIds= useMemo(()=>new Set(config.subset||pool.map(c=>c.id)),[config.subset,pool]);
  const items    = useMemo(()=>shuffle(pool.filter(c=>subsetIds.has(c.id))),[pool,subsetIds]);
  // Decoy pool: same region as what's being quizzed.
  // When playing "world" mode with a subset, derive region from the subset items themselves.
  const choicePool = useMemo(()=>{
    if(config.region!=="world") return pool; // already regional
    if(!config.subset) return pool;          // world with no subset — all countries fine
    // world + subset: collect which region(s) the subset items belong to
    const subsetRegions=new Set(items.map(c=>c.region).filter(Boolean));
    if(subsetRegions.size===1){
      // All from one region → use the full region as decoy pool (avoids giving away answers)
      return COUNTRIES.filter(c=>c.region===[...subsetRegions][0]);
    }
    // Mixed regions → fall back to full world pool
    return pool;
  },[config.region,config.subset,pool,items]);

  const [idx,    setIdx]    =useState(0);
  const [score,  setScore]  =useState(0);
  const [streak, setStreak] =useState(0);
  const [maxSt,  setMaxSt]  =useState(0);
  const [chosen, setChosen] =useState(null); // null | {answer, correct, close?}
  const [phase,  setPhase]  =useState("playing");
  const [startMs]           =useState(()=>Date.now());
  const [typeInput,setTypeInput]=useState("");
  const inputRef=useRef(null);

  const current = items[idx];

  // Auto-focus type input on each new question
  useEffect(()=>{
    if(config.typeMode&&inputRef.current&&phase==="playing"&&!chosen){
      inputRef.current.focus();
    }
  },[idx,config.typeMode,phase,chosen]);

  // Generate choices for current item
  const choices = useMemo(()=>{
    if(!current) return [];
    if(gameType==="flags")    return makeChoices(current, choicePool, c=>c.name);
    if(gameType==="capitals") return makeChoices(current, choicePool, c=>c.capital);
    return [];
  },[current, choicePool, gameType, idx]); // idx forces re-shuffle each question

  const finish=useCallback(fs=>{
    setPhase("done");
    onFinish({mode:gameType,region:config.region,score:fs,total:items.length,
      timeTaken:Math.round((Date.now()-startMs)/1000)});
  },[config,gameType,items.length,startMs,onFinish]);

  const handleChoice=answer=>{
    if(chosen||phase!=="playing")return;
    const correctAnswer = gameType==="flags" ? current.name : current.capital;
    const ok = answer===correctAnswer;
    setChosen({answer,correct:ok});
    if(ok){
      const ns=score+1,nstr=streak+1;
      setScore(ns);setStreak(nstr);setMaxSt(m=>Math.max(m,nstr));
    }else{
      setStreak(0);
    }
    setTimeout(()=>{
      setChosen(null);
      const ni=idx+1;
      if(ni>=items.length)finish(ok?score+1:score);
      else setIdx(ni);
    },900);
  };

  const handleTypedAnswer=()=>{
    if(chosen||phase!=="playing"||!typeInput.trim())return;
    const correctAnswer = gameType==="flags" ? current.name : current.capital;
    const {ok,close}=checkAnswer(typeInput,correctAnswer,gameType==="flags");
    setChosen({answer:typeInput,correct:ok,close});
    if(ok){
      const ns=score+1,nstr=streak+1;
      setScore(ns);setStreak(nstr);setMaxSt(m=>Math.max(m,nstr));
    }else{
      setStreak(0);
    }
    setTimeout(()=>{
      setChosen(null);setTypeInput("");
      const ni=idx+1;
      if(ni>=items.length)finish(ok?score+1:score);
      else setIdx(ni);
    },1400);
  };

  if(!items.length)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh",flexDirection:"column",gap:12}}>
      <Spinner/><p style={{color:C.mu,fontSize:13}}>Loading…</p>
    </div>
  );

  const rl=REGIONS.find(r=>r.id===config.region);
  const correctAnswer = current ? (gameType==="flags"?current.name:current.capital) : "";

  return(
    <div style={{maxWidth:500,margin:"0 auto",padding:"16px"}} className="fadein">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <span style={{color:C.dim,fontSize:12}}>{rl?.emoji} {rl?.label} · {gameType==="flags"?"🚩 Flag Match":"🏛️ Capitals"}</span>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,marginTop:2,color:C.tx}}>
            {score}<span style={{color:C.dim,fontSize:13}}>/{items.length}</span>
          </div>
        </div>
        {streak>1&&(
          <div style={{padding:"5px 14px",borderRadius:20,background:"rgba(220,140,0,.1)",border:"1px solid rgba(220,140,0,.3)",display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:15}}>🔥</span>
            <span style={{fontFamily:"'DM Mono',monospace",color:"#b86a00",fontWeight:700,fontSize:14}}>{streak}</span>
          </div>
        )}
        <div style={{fontSize:12,color:C.dim}}>{Math.max(0,items.length-idx-1)} left</div>
      </div>

      {/* Progress */}
      <div style={{height:3,background:C.s3,borderRadius:4,marginBottom:16,overflow:"hidden"}}>
        <div style={{height:"100%",background:C.az,width:`${pct(idx,items.length)}%`,borderRadius:4,transition:"width .3s",boxShadow:`0 0 6px rgba(26,95,219,.4)`}}/>
      </div>

      {phase==="done"&&<ResultBanner score={score} total={items.length} extra={`Best streak: ${maxSt} 🔥`} onPlay={goHome} user={user}/>}

      {phase==="playing"&&current&&(
        <>
          {/* Prompt card */}
          <div style={{padding:"28px 16px",borderRadius:16,background:C.s1,border:`1px solid ${C.b1}`,
            textAlign:"center",marginBottom:16,boxShadow:"0 2px 12px rgba(30,80,180,.07)"}}>
            {gameType==="flags"?(
              <>
                <div style={{lineHeight:1,marginBottom:10}}><FlagImg alpha2={current.alpha2} width={120}/></div>
                <p style={{color:C.dim,fontSize:12}}>Which country is this?</p>
              </>
            ):(
              <>
                <div style={{fontSize:18,lineHeight:1.2,marginBottom:6,color:C.dim}}>Capital of</div>
                <div style={{fontFamily:"'Libre Baskerville',serif",fontSize:28,fontWeight:700,color:C.tx,marginBottom:4}}>{current.name}</div>
                <div style={{marginTop:6}}><FlagImg alpha2={current.alpha2} width={40}/></div>
              </>
            )}
          </div>

          {/* Type-in input OR 4 choices */}
          {config.typeMode?(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <input
                ref={inputRef}
                value={typeInput}
                onChange={e=>setTypeInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")handleTypedAnswer();}}
                disabled={!!chosen}
                placeholder={gameType==="flags"?"Type country name…":"Type capital city…"}
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                style={{width:"100%",padding:"13px 16px",borderRadius:12,fontSize:16,boxSizing:"border-box",
                  background:C.s1,color:C.tx,outline:"none",transition:"border-color .15s",
                  border:`1.5px solid ${chosen?(chosen.correct?C.grBd:C.reBd):C.b1}`}}
              />
              <button onClick={handleTypedAnswer} disabled={!!chosen||!typeInput.trim()}
                style={{padding:"13px",borderRadius:12,fontWeight:700,fontSize:15,border:"none",transition:"all .15s",
                  background:typeInput.trim()&&!chosen?C.az:"rgba(26,95,219,.2)",
                  color:typeInput.trim()&&!chosen?"#fff":"rgba(26,95,219,.45)",
                  cursor:typeInput.trim()&&!chosen?"pointer":"not-allowed",
                  boxShadow:typeInput.trim()&&!chosen?`0 4px 18px rgba(26,95,219,.28)`:"none"}}>
                Submit
              </button>
            </div>
          ):(
            <div key={idx} style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {choices.map((ans,ai)=>{
                const isCorrect = ans===correctAnswer;
                const isChosen  = chosen?.answer===ans;
                let cls="choice-btn";
                if(chosen){
                  if(isCorrect)cls+=" choice-correct";
                  else if(isChosen)cls+=" choice-wrong";
                }
                return(
                  <button key={ai} className={cls} onClick={()=>handleChoice(ans)} disabled={!!chosen}>
                    {ans}
                  </button>
                );
              })}
            </div>
          )}

          {/* Feedback strip */}
          {chosen&&(
            <div className="popin" style={{marginTop:12,padding:"10px 14px",borderRadius:10,textAlign:"center",
              background:chosen.correct?C.grBg:C.reBg,border:`1px solid ${chosen.correct?C.grBd:C.reBd}`}}>
              {chosen.correct?(
                <span style={{fontWeight:600,fontSize:13,color:C.gr}}>
                  {chosen.close?`✓ Close enough — ${correctAnswer}`:"✓ Correct!"}
                </span>
              ):(
                <span style={{fontWeight:600,fontSize:13,color:C.re}}>
                  {gameType==="flags"?`✗ That's ${correctAnswer}`:`✗ Capital of ${current.name} is ${correctAnswer}`}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LISTING QUIZ
═══════════════════════════════════════════════════════════════════════════ */
function ListingQuiz({config,geo,goHome,onFinish,user}){
  const countries=useMemo(()=>byRegion(config.region),[config.region]);
  const inputRef=useRef(null);
  const [found,   setFound]  =useState(()=>new Set());
  const [input,   setInput]  =useState("");
  const [timeLeft,setTL]     =useState(config.timerEnabled?config.timerDuration:null);
  const [phase,   setPhase]  =useState("ready");
  const [startMs, setStart]  =useState(null);
  const [lastGot, setLastGot]=useState(null);

  const foundNums=useMemo(()=>{
    const s=new Set();
    found.forEach(id=>{const c=countries.find(c=>c.id===id);if(c?.numeric)s.add(c.numeric);});
    return s;
  },[found,countries]);

  const finish=useCallback(()=>{
    setPhase("done");
    onFinish({mode:"listing",region:config.region,score:found.size,total:countries.length,timeTaken:startMs?Math.round((Date.now()-startMs)/1000):null});
  },[found.size,countries.length,config,startMs,onFinish]);

  useEffect(()=>{
    if(phase!=="playing"||timeLeft===null)return;
    if(timeLeft<=0){finish();return;}
    const id=setTimeout(()=>setTL(t=>t-1),1000);
    return()=>clearTimeout(id);
  },[phase,timeLeft,finish]);

  useEffect(()=>{
    if(phase==="playing"&&countries.length>0&&found.size===countries.length)finish();
  },[found.size,countries.length,phase,finish]);

  const handleInput=val=>{
    setInput(val);const n=norm(val);if(n.length<2)return;
    const aliasId=ALIASES.get(n);
    let match=aliasId&&!found.has(aliasId)?countries.find(c=>c.id===aliasId):null;
    if(!match)match=countries.find(c=>!found.has(c.id)&&norm(c.name)===n);
    if(match){setFound(p=>new Set([...p,match.id]));setLastGot(match.id);setTimeout(()=>setLastGot(null),500);setInput("");}
  };

  const p=pct(found.size,countries.length);
  const warn=timeLeft!==null&&timeLeft<30,low=timeLeft!==null&&timeLeft<60;
  const rl=REGIONS.find(r=>r.id===config.region);

  return(
    <div style={{maxWidth:740,margin:"0 auto",padding:"14px 16px"}} className="fadein">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <h2 style={{fontFamily:"'Libre Baskerville',serif",fontSize:20,fontWeight:700,color:C.tx}}>{rl?.emoji} {rl?.label}</h2>
          <p style={{color:C.dim,fontSize:12,marginTop:1}}>Name every country</p>
        </div>
        <div style={{display:"flex",gap:20,alignItems:"center"}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:24,color:C.az,lineHeight:1}}>{found.size}<span style={{color:C.dim,fontSize:14}}>/{countries.length}</span></div>
            <div style={{fontSize:10,color:C.dim,marginTop:2}}>found</div>
          </div>
          {config.timerEnabled&&(
            <div style={{textAlign:"center"}}>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:24,lineHeight:1,color:warn?C.re:low?"#c87800":C.tx}}>{fmtTime(timeLeft??config.timerDuration)}</div>
              <div style={{fontSize:10,color:C.dim,marginTop:2}}>left</div>
            </div>
          )}
        </div>
      </div>

      <div style={{height:4,background:C.s3,borderRadius:4,marginBottom:12,overflow:"hidden"}}>
        <div style={{height:"100%",background:C.az,width:`${p}%`,borderRadius:4,transition:"width .35s",boxShadow:`0 0 8px rgba(26,95,219,.4)`}}/>
      </div>

      <div style={{marginBottom:12}}>
        <WorldMap geo={geo} regionId={config.region} highlightNumerics={foundNums} zoomable={true}/>
      </div>

      {phase==="ready"&&(
        <button onClick={()=>{setPhase("playing");setStart(Date.now());setTimeout(()=>inputRef.current?.focus(),50);}}
          style={{width:"100%",padding:"13px",borderRadius:13,background:C.az,color:"#fff",fontWeight:700,fontSize:14,border:"none",cursor:"pointer",marginBottom:12,boxShadow:`0 4px 16px rgba(26,95,219,.28)`}}>
          Start →
        </button>
      )}
      {phase==="playing"&&(
        <input ref={inputRef} value={input} onChange={e=>handleInput(e.target.value)}
          placeholder="Type a country name…" autoComplete="off" spellCheck={false}
          style={{width:"100%",padding:"12px 16px",borderRadius:12,background:C.s1,border:`1.5px solid ${C.b2}`,color:C.tx,fontSize:15,marginBottom:12,boxShadow:"0 2px 8px rgba(30,80,180,.07)"}}/>
      )}
      {phase==="done"&&<ResultBanner score={found.size} total={countries.length} onPlay={goHome} user={user}/>}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(138px,1fr))",gap:4,maxHeight:272,overflowY:"auto",paddingRight:2}}>
        {countries.map(c=>{
          const isFound=found.has(c.id),revealed=isFound||phase==="done",missed=!isFound&&phase==="done",justGot=lastGot===c.id;
          return(
            <div key={c.id} className={justGot?"bump":""}
              style={{display:"flex",alignItems:"center",gap:6,padding:"5px 9px",borderRadius:9,fontSize:12,fontWeight:isFound?500:400,
                background:isFound?C.grBg:missed?C.reBg:C.s1,
                border:`1px solid ${isFound?C.grBd:missed?C.reBd:C.b1}`,
                color:isFound?C.gr:missed?C.re:C.mu,transition:"all .18s"}}>
              <FlagImg alpha2={c.alpha2} width={20} style={{opacity:revealed?1:0}}/>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {revealed?c.name:config.showFirstLetter?c.name[0]+"…":"─".repeat(Math.min(9,c.name.length))}
              </span>
            </div>
          );
        })}
      </div>

      {phase==="playing"&&(
        <button onClick={finish} style={{marginTop:10,fontSize:12,color:C.dim,textDecoration:"underline",cursor:"pointer",background:"none",border:"none"}}>Give up / see answers</button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAP MAP QUIZ  (bug fixed: shows clicked country name on wrong tap)
═══════════════════════════════════════════════════════════════════════════ */
function TapMapQuiz({config,geo,goHome,onFinish,user}){
  // Countries are available if they have a TopoJSON path OR a microstate pin
  const geoNumerics=useMemo(()=>{
    if(!geo)return null;
    const s=new Set(geo.features.map(f=>f.id!=null?String(f.id):null).filter(Boolean));
    MICROSTATE_PINS.forEach(p=>s.add(p.numeric));
    return s;
  },[geo]);
  // Respect the subset the user picked, AND exclude countries missing from the map
  const subsetIds=useMemo(()=>new Set(config.subset||byRegion(config.region).map(c=>c.id)),[config.subset,config.region]);
  const countries=useMemo(()=>shuffle(byRegion(config.region).filter(c=>
    c.numeric && subsetIds.has(c.id) && (!geoNumerics||geoNumerics.has(c.numeric))
  )),[config.region,subsetIds,geoNumerics]);
  const [idx,    setIdx]    =useState(0);
  const [score,  setScore]  =useState(0);
  const [streak, setStreak] =useState(0);
  const [maxSt,  setMaxSt]  =useState(0);
  const [correct,setCorrect]=useState(()=>new Set());
  // flash: {numeric, correct, clickedName}
  const [flash,  setFlash]  =useState(null);
  const [phase,  setPhase]  =useState("playing");
  const [startMs]           =useState(()=>Date.now());
  const current=countries[idx];

  const finish=useCallback(fs=>{
    setPhase("done");
    onFinish({mode:"tapmap",region:config.region,score:fs,total:countries.length,timeTaken:Math.round((Date.now()-startMs)/1000)});
  },[config,countries.length,startMs,onFinish]);

  const handleTap=useCallback(numId=>{
    if(phase!=="playing"||!current||flash)return;
    const ok=numId===current.numeric;
    // Look up the name of whatever country was actually clicked
    const clickedCountry=COUNTRIES.find(c=>c.numeric===numId);
    setFlash({numeric:numId,correct:ok,clickedName:clickedCountry?.name||"Unknown"});
    if(ok){
      const ns=score+1,nstr=streak+1;
      setScore(ns);setStreak(nstr);setMaxSt(m=>Math.max(m,nstr));
      setCorrect(p=>new Set([...p,numId]));
      setTimeout(()=>{setFlash(null);const ni=idx+1;if(ni>=countries.length)finish(ns);else setIdx(ni);},560);
    }else{
      setStreak(0);
      setTimeout(()=>{setFlash(null);const ni=idx+1;if(ni>=countries.length)finish(score);else setIdx(ni);},1400);
    }
  },[phase,current,flash,score,streak,idx,countries.length,finish]);

  const rl=REGIONS.find(r=>r.id===config.region);
  if(!countries.length)return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh",flexDirection:"column",gap:12}}>
      <Spinner/><p style={{color:C.mu,fontSize:13}}>Loading countries…</p>
    </div>
  );

  return(
    <div style={{maxWidth:740,margin:"0 auto",padding:"12px 16px"}} className="fadein">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div>
          <span style={{color:C.dim,fontSize:12}}>{rl?.emoji} {rl?.label}</span>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:20,marginTop:2,color:C.tx}}>{score}<span style={{color:C.dim,fontSize:13}}>/{countries.length}</span></div>
        </div>
        {streak>1&&(
          <div style={{padding:"5px 14px",borderRadius:20,background:"rgba(220,140,0,.1)",border:"1px solid rgba(220,140,0,.3)",display:"flex",alignItems:"center",gap:5}}>
            <span style={{fontSize:15}}>🔥</span>
            <span style={{fontFamily:"'DM Mono',monospace",color:"#b86a00",fontWeight:700,fontSize:14}}>{streak}</span>
          </div>
        )}
        <div style={{fontSize:12,color:C.dim}}>{Math.max(0,countries.length-idx-1)} left</div>
      </div>

      {/* Prompt card */}
      {phase==="playing"&&current&&(
        <div style={{padding:"14px 18px",borderRadius:14,marginBottom:10,textAlign:"center",
          background:flash?(flash.correct?C.grBg:C.reBg):C.s1,
          border:`1.5px solid ${flash?(flash.correct?C.grBd:C.reBd):C.b1}`,
          transition:"background .15s,border-color .15s",boxShadow:"0 2px 10px rgba(30,80,180,.06)"}}>
          {flash?(
            flash.correct?(
              <p style={{fontWeight:600,fontSize:16,color:C.gr}}>✓ {current.name}</p>
            ):(
              <div>
                {/* Show what they clicked in red */}
                <p style={{fontWeight:600,fontSize:15,color:C.re}}>✗ {flash.clickedName}</p>
                {/* Show what they were looking for */}
                <p style={{fontSize:12,color:C.mu,marginTop:5}}>
                  Looking for: <strong style={{color:C.tx}}>{current.name}</strong>
                </p>
              </div>
            )
          ):(
            <>
              <p style={{color:C.dim,fontSize:11,marginBottom:5}}>Find on the map:</p>
              <p style={{fontFamily:"'Libre Baskerville',serif",fontSize:26,fontWeight:700,lineHeight:1.2,color:C.tx}}>{current.name}</p>
              <p style={{color:C.mu,fontSize:12,marginTop:5}}>Capital: {current.capital}</p>
            </>
          )}
        </div>
      )}

      {phase==="done"&&<ResultBanner score={score} total={countries.length} extra={`Best streak: ${maxSt} 🔥`} onPlay={goHome} user={user}/>}

      {phase==="playing"&&(
        <WorldMap geo={geo} regionId={config.region} highlightNumerics={correct}
          flashNumeric={flash?.numeric} flashCorrect={flash?.correct}
          correctNumeric={current?.numeric} onTap={handleTap} zoomable={true}/>
      )}
    </div>
  );
}

/* ─── Inline Sign-In (shown in ResultBanner for guests) ──────────────────── */
function InlineSignIn(){
  const [showEmail,setShowEmail]=useState(false);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [loading,setLoading]=useState(null);
  const [error,setError]=useState("");

  const signInGoogle=async()=>{
    setLoading("google");setError("");
    try{await signInWithPopup(auth,googleProvider);}
    catch(e){
      if(e.code!=="auth/popup-closed-by-user")
        setError(EMAIL_ERRORS[e.code]||"Sign-in failed. Please try again.");
      setLoading(null);
    }
  };

  const submitEmail=async e=>{
    e.preventDefault();
    if(!email.trim()||!password)return;
    setLoading("email");setError("");
    try{
      try{await signInWithEmailAndPassword(auth,email.trim(),password);}
      catch(e2){
        if(e2.code==="auth/user-not-found"||e2.code==="auth/invalid-credential")
          await createUserWithEmailAndPassword(auth,email.trim(),password);
        else throw e2;
      }
    }catch(e){
      setError(EMAIL_ERRORS[e.code]||"Sign-in failed. Please try again.");
      setLoading(null);
    }
  };

  const inp={width:"100%",padding:"10px 12px",borderRadius:8,fontSize:13,
    background:C.bg,border:`1.5px solid ${C.b1}`,color:C.tx,outline:"none",boxSizing:"border-box"};

  return(
    <div style={{marginTop:16,borderTop:`1px solid ${C.b1}`,paddingTop:14,textAlign:"left"}}>
      <p style={{color:C.mu,fontSize:12,marginBottom:10,textAlign:"center"}}>Sign in to save this score</p>
      <button onClick={signInGoogle} disabled={!!loading}
        style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",
          width:"100%",borderRadius:10,fontWeight:600,fontSize:13,border:`1.5px solid ${C.b2}`,
          background:C.s2,color:C.tx,cursor:loading?"not-allowed":"pointer",marginBottom:8,
          opacity:loading&&loading!=="google"?.5:1}}>
        {loading==="google"?<Spinner/>:<GoogleIcon/>}
        Continue with Google
      </button>
      {!showEmail?(
        <button onClick={()=>setShowEmail(true)}
          style={{background:"none",border:"none",color:C.az,fontSize:12,cursor:"pointer",
            textDecoration:"underline",padding:0,display:"block",margin:"0 auto"}}>
          Use email instead
        </button>
      ):(
        <form onSubmit={submitEmail} style={{display:"flex",flexDirection:"column",gap:6}}>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="Email" style={inp} disabled={!!loading}/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="Password" style={inp} disabled={!!loading}/>
          <button type="submit" disabled={!!loading||!email.trim()||!password}
            style={{padding:"10px",borderRadius:10,fontWeight:700,fontSize:13,border:"none",
              background:email.trim()&&password?C.az:"rgba(26,95,219,.2)",
              color:email.trim()&&password?"#fff":"rgba(26,95,219,.45)",
              cursor:email.trim()&&password&&!loading?"pointer":"not-allowed"}}>
            {loading==="email"?<Spinner/>:"Sign In / Sign Up"}
          </button>
        </form>
      )}
      {error&&<p style={{color:C.re,fontSize:11,marginTop:6,textAlign:"center"}}>{error}</p>}
    </div>
  );
}

/* ─── Result Banner ───────────────────────────────────────────────────────── */
function ResultBanner({score,total,extra,onPlay,user}){
  const p=pct(score,total);
  const msg=p===100?"🎉 Perfect score!":p>=80?"🌟 Excellent!":p>=50?"👍 Good effort!":"📚 Keep exploring!";
  return(
    <div className="popin" style={{padding:"22px 18px",borderRadius:16,background:C.s1,
      border:`1px solid ${C.b1}`,textAlign:"center",marginBottom:12,boxShadow:"0 4px 24px rgba(30,80,180,.1)"}}>
      <div style={{fontFamily:"'Libre Baskerville',serif",fontSize:52,fontWeight:700,color:C.az,lineHeight:1}}>{p}%</div>
      <p style={{fontWeight:600,marginTop:7,fontSize:15,color:C.tx}}>{score} / {total}</p>
      {extra&&<p style={{color:C.mu,fontSize:12,marginTop:3}}>{extra}</p>}
      <p style={{color:C.mu,fontSize:13,marginTop:5,marginBottom:18}}>{msg}</p>
      <button onClick={onPlay}
        style={{padding:"10px 30px",borderRadius:12,background:C.az,color:"#fff",fontWeight:700,fontSize:14,border:"none",cursor:"pointer",boxShadow:`0 3px 14px rgba(26,95,219,.28)`}}>
        Play again
      </button>
      {!user&&<InlineSignIn/>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROFILE
═══════════════════════════════════════════════════════════════════════════ */
function ProfileScreen({user}){
  const [bests,setBests]=useState(null);
  const [recent,setRecent]=useState(null);
  useEffect(()=>{
    if(!user)return;
    const load=async()=>{
      const [bSnap,rSnap]=await Promise.all([
        getDocs(query(collection(db,`users/${user.uid}/bests`),orderBy("pct","desc"))),
        getDocs(query(collection(db,`users/${user.uid}/recent`),orderBy("ts","desc"),limit(30))),
      ]);
      setBests(bSnap.docs.map(d=>d.data()));
      setRecent(rSnap.docs.map(d=>d.data()));
    };
    load();
  },[user]);
  if(!bests||!recent)return<div style={{display:"flex",justifyContent:"center",padding:60}}><Spinner/></div>;

  const modeLabel=m=>({listing:"✍️ Listing",tapmap:"🗺️ Tap Map",flags:"🚩 Flags",capitals:"🏛️ Capitals"}[m]||m);

  return(
    <div style={{maxWidth:600,margin:"0 auto",padding:"22px 16px"}} className="fadein">
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:26}}>
        <div style={{width:52,height:52,borderRadius:"50%",background:C.azBg,border:`2px solid ${C.azBd}`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:700,color:C.az,flexShrink:0}}>
          {user.displayName[0].toUpperCase()}
        </div>
        <div>
          <h1 style={{fontFamily:"'Libre Baskerville',serif",fontSize:22,fontWeight:700,color:C.tx}}>{user.displayName}</h1>
          <p style={{color:C.dim,fontSize:12,marginTop:2}}>Your stats</p>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:24}}>
        {[{label:"Quizzes",val:recent.length},{label:"Top scores",val:bests.length},{label:"Best %",val:bests.length?`${Math.max(...bests.map(b=>b.pct))}%`:"—"}].map(s=>(
          <div key={s.label} style={{padding:"14px 8px",borderRadius:14,background:C.s1,border:`1px solid ${C.b1}`,textAlign:"center",boxShadow:"0 1px 6px rgba(30,80,180,.05)"}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:22,color:C.az,fontWeight:700}}>{s.val}</div>
            <div style={{fontSize:11,color:C.dim,marginTop:3}}>{s.label}</div>
          </div>
        ))}
      </div>

      {bests.length>0&&(
        <>
          <SecTitle>Personal Bests</SecTitle>
          {[...bests].sort((a,b)=>b.pct-a.pct).map((b,i)=>(
            <SRow key={i}
              left={<><span style={{fontWeight:500,textTransform:"capitalize",color:C.tx}}>{b.region}</span><span style={{marginLeft:8,fontSize:11,color:C.dim}}>{modeLabel(b.mode)}</span></>}
              right={<><span style={{fontSize:11,color:C.dim,marginRight:8}}>{b.score}/{b.total}</span><PctBadge p={b.pct}/></>}/>
          ))}
        </>
      )}

      <SecTitle style={{marginTop:20}}>Recent Games</SecTitle>
      {recent.length===0
        ?<p style={{color:C.dim,fontSize:13,textAlign:"center",padding:"24px 0"}}>No games yet — go play!</p>
        :recent.map((r,i)=>(
          <SRow key={i}
            left={<><span style={{fontWeight:500,textTransform:"capitalize",color:C.tx}}>{r.region}</span><span style={{marginLeft:6,fontSize:11,color:C.dim}}>{modeLabel(r.mode)} {r.score}/{r.total} ({pct(r.score,r.total)}%)</span></>}
            right={<span style={{fontSize:11,color:C.dim}}>{r.ts?relTime(r.ts):"—"}</span>}/>
        ))
      }
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEADERBOARD
═══════════════════════════════════════════════════════════════════════════ */
function LeaderboardScreen({user}){
  const [mode,   setMode]   =useState("listing");
  const [region, setRegion] =useState("europe");
  const [entries,setEntries]=useState([]);
  const [loading,setLoading]=useState(false);
  const [lbError,setLbError]=useState(null);
  useEffect(()=>{
    setLoading(true);setLbError(null);
    getLeaderboard(mode,region)
      .then(e=>{setEntries(e);setLoading(false);})
      .catch(e=>{
        setLoading(false);
        setLbError(e?.code==="failed-precondition"
          ?"⏳ Leaderboard index is still warming up — check back in a minute!"
          :"Unable to load leaderboard. Please try again.");
      });
  },[mode,region]);

  const allModes=[{id:"listing",label:"✍️ Listing"},{id:"tapmap",label:"🗺️ Tap Map"},{id:"flags",label:"🚩 Flags"},{id:"capitals",label:"🏛️ Capitals"}];

  return(
    <div style={{maxWidth:580,margin:"0 auto",padding:"22px 16px"}} className="fadein">
      <h1 style={{fontFamily:"'Libre Baskerville',serif",fontSize:26,fontWeight:700,color:C.tx,marginBottom:4}}>Leaderboard</h1>
      <p style={{color:C.dim,fontSize:12,marginBottom:18}}>Best score per player — shared across all users.</p>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {allModes.map(m=>(
          <button key={m.id} onClick={()=>setMode(m.id)}
            style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all .15s",
              background:mode===m.id?C.az:C.s1,color:mode===m.id?"#fff":C.mu,
              border:`1px solid ${mode===m.id?C.az:C.b1}`,
              boxShadow:mode===m.id?`0 2px 10px rgba(26,95,219,.25)`:"none"}}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:20}}>
        {REGIONS.filter(r=>r.id!=="world").map(r=>(
          <button key={r.id} onClick={()=>setRegion(r.id)}
            style={{padding:"5px 11px",borderRadius:8,fontSize:11,fontWeight:500,cursor:"pointer",transition:"all .15s",
              background:region===r.id?C.azBg:C.s1,color:region===r.id?C.az:C.dim,
              border:`1px solid ${region===r.id?C.azBd:C.b1}`}}>
            {r.emoji} {r.label}
          </button>
        ))}
      </div>

      {loading?(
        <div style={{display:"flex",justifyContent:"center",padding:48}}><Spinner/></div>
      ):lbError?(
        <div style={{textAlign:"center",padding:"48px 0",color:C.mu}}>
          <div style={{fontSize:32,marginBottom:10}}>🔧</div>
          <p style={{fontSize:13,lineHeight:1.6}}>{lbError}</p>
        </div>
      ):entries.length===0?(
        <div style={{textAlign:"center",padding:"48px 0",color:C.dim}}>
          <div style={{fontSize:36,marginBottom:10}}>🏆</div>
          <p style={{fontSize:14}}>No scores yet. Be the first!</p>
        </div>
      ):entries.map((e,i)=>{
        const isMe=e.uid===user?.uid,medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
        return(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",
            borderRadius:12,background:isMe?C.azBg:C.s1,border:`1.5px solid ${isMe?C.az:C.b1}`,
            marginBottom:6,boxShadow:isMe?`0 0 0 3px ${C.azBg}`:"0 1px 4px rgba(30,80,180,.05)"}}>
            <span style={{width:26,textAlign:"center",fontFamily:"'DM Mono',monospace",fontSize:medal?16:12,fontWeight:700,color:i===0?"#b7920a":i===1?"#6b7280":i===2?"#b07040":C.dim}}>
              {medal||`${i+1}`}
            </span>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontSize:13,fontWeight:600,color:isMe?C.az:C.tx,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {e.displayName||"Explorer"}{isMe&&<span style={{fontSize:10,color:C.dim,marginLeft:6}}>(you)</span>}
              </span>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <PctBadge p={e.pct}/>
              <div style={{fontSize:10,color:C.dim,marginTop:2}}>{e.score}/{e.total}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Shared ──────────────────────────────────────────────────────────────── */
function Step({n,title,children,cls=""}){
  return(
    <div style={{marginBottom:20}} className={cls}>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:10}}>
        <span style={{width:24,height:24,borderRadius:"50%",background:C.azBg,border:`1.5px solid ${C.azBd}`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:C.az,flexShrink:0}}>
          {n}
        </span>
        <span style={{fontWeight:600,fontSize:14,color:C.tx}}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function OptRow({label,desc,right}){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderRadius:12,background:C.s1,border:`1px solid ${C.b1}`,gap:12,boxShadow:"0 1px 4px rgba(30,80,180,.05)"}}>
      <div>
        <div style={{fontSize:13,fontWeight:500,color:C.tx}}>{label}</div>
        <div style={{fontSize:11,color:C.dim,marginTop:1}}>{desc}</div>
      </div>
      {right}
    </div>
  );
}
function SecTitle({children,style={}}){
  return<p style={{fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:1,color:C.dim,marginBottom:8,...style}}>{children}</p>;
}
function SRow({left,right}){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 13px",borderRadius:10,background:C.s1,border:`1px solid ${C.b1}`,marginBottom:6,boxShadow:"0 1px 4px rgba(30,80,180,.04)"}}>
      <div style={{fontSize:13}}>{left}</div>
      <div style={{display:"flex",alignItems:"center",fontSize:13}}>{right}</div>
    </div>
  );
}
function PctBadge({p}){
  const color=p===100?C.az:p>=80?C.gr:p>=50?"#b86a00":C.re;
  return<span style={{fontFamily:"'DM Mono',monospace",fontWeight:700,fontSize:13,color}}>{p}%</span>;
}
