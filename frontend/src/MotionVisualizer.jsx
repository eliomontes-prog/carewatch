import { useState, useEffect, useRef } from "react";

const W = 520, H = 520;
const WS_URL = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:4000/ws/pose`
  : 'ws://localhost:4000/ws/pose';

const SKELETON = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16],
];
const NODES = [
  { x:0.08, y:0.08, label:"Node 1" },
  { x:0.92, y:0.08, label:"Node 2" },
  { x:0.5,  y:0.92, label:"Node 3" },
];
const COLORS = ['#00d4aa','#f59e0b','#818cf8','#f472b6'];
const toRgba = (hex, a) => ({
  '#00d4aa':`rgba(0,212,170,${a})`,'#f59e0b':`rgba(245,158,11,${a})`,
  '#818cf8':`rgba(129,140,248,${a})`,'#f472b6':`rgba(244,114,182,${a})`
})[hex] ?? `rgba(0,212,170,${a})`;

function useSimPose(active) {
  const [pose, setPose] = useState(null);
  useEffect(() => {
    if (!active) return;
    let raf;
    const animate = ts => {
      const t = ts * 0.001, pt = t * 0.18;
      const cx = 0.5 + Math.sin(pt) * 0.28, cy = 0.52 + Math.sin(pt*2) * 0.2;
      const sw = 0.07, hipW = 0.055, h = 0.26;
      const act = 0.7 + Math.sin(t*0.5)*0.3;
      const sw2 = Math.sin(t*4)*0.03*act, bob = Math.abs(Math.sin(t*4))*0.008*act;
      const raw = [
        [cx,cy-h+bob],[cx-0.02,cy-h+bob-0.01],[cx+0.02,cy-h+bob-0.01],
        [cx-0.03,cy-h+bob],[cx+0.03,cy-h+bob],
        [cx-sw,cy-h*0.65+bob],[cx+sw,cy-h*0.65+bob],
        [cx-sw-0.015,cy-h*0.38+sw2],[cx+sw+0.015,cy-h*0.38-sw2],
        [cx-sw-0.02,cy-h*0.12+sw2*1.4],[cx+sw+0.02,cy-h*0.12-sw2*1.4],
        [cx-hipW,cy-h*0.22+bob],[cx+hipW,cy-h*0.22+bob],
        [cx-hipW,cy+0.02-sw2],[cx+hipW,cy+0.02+sw2],
        [cx-hipW+sw2*0.5,cy+h*0.55],[cx+hipW-sw2*0.5,cy+h*0.55],
      ];
      setPose({
        persons:[{ id:'s0', cx, cy, confidence:0.91,
          keypoints: raw.map(([x,y])=>({ x:Math.max(0.05,Math.min(0.95,x)), y:Math.max(0.05,Math.min(0.95,y)), confidence:0.85+Math.random()*0.15 })) }],
        vitals:{ breathingRate:+(14+Math.sin(t*0.25)*2).toFixed(1), heartRate:+(68+Math.sin(t*0.1)*5).toFixed(0) },
        posture: act>0.5?'standing':'sitting', activityLevel:act, simulated:true,
      });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return pose;
}

function useRuViewSocket() {
  const [livePose, setLivePose] = useState(null);
  const [wsState, setWsState] = useState('connecting');
  useEffect(() => {
    let ws, timer;
    const connect = () => {
      try { ws = new WebSocket(WS_URL); } catch { setWsState('disconnected'); timer=setTimeout(connect,4000); return; }
      ws.onopen = () => setWsState('live');
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type==='POSE_FRAME' && msg.data) setLivePose(msg.data);
          else if (msg.type==='CONNECTION_STATE') setWsState(msg.ruviewConnected?'live':'connecting');
        } catch {}
      };
      ws.onclose = () => { setWsState('disconnected'); setLivePose(null); timer=setTimeout(connect,3000); };
      ws.onerror = () => setWsState('disconnected');
    };
    connect();
    return () => { ws?.close(); clearTimeout(timer); };
  }, []);
  return { livePose, wsState };
}

function useTrail(persons) {
  const trails = useRef({});
  (persons||[]).forEach(p => {
    if (!trails.current[p.id]) trails.current[p.id] = [];
    const trail = trails.current[p.id];
    const last = trail[trail.length-1];
    if (!last || Math.abs(p.cx-last.x)+Math.abs(p.cy-last.y) > 0.003) {
      trail.push({ x:p.cx, y:p.cy, t:Date.now() });
      if (trail.length > 140) trail.shift();
    }
  });
  return trails.current;
}

function RoomCanvas({ pose, trails, showHeatmap, showSkeleton, showSignal }) {
  const ref = useRef(null);
  const phase = useRef(0);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio||1;
    c.width=W*dpr; c.height=H*dpr; c.style.width=W+'px'; c.style.height=H+'px';
    c.getContext('2d').scale(dpr,dpr);
  }, []);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    let raf;
    const draw = () => {
      phase.current += 0.025;
      const ph = phase.current;
      const persons = pose?.persons ?? [];
      ctx.fillStyle='#060a0f'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(0,212,170,0.04)'; ctx.lineWidth=1;
      for (let x=0;x<=W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
      for (let y=0;y<=H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
      ctx.strokeStyle='rgba(0,212,170,0.18)'; ctx.lineWidth=2;
      ctx.strokeRect(20,20,W-40,H-40);
      ctx.fillStyle='rgba(0,212,170,0.2)'; ctx.font="600 9px 'DM Mono',monospace"; ctx.fillText('ROOM 01',28,36);
      if (showSignal) {
        NODES.forEach((n,i)=>{
          const nx=n.x*W,ny=n.y*H,off=(ph+i*2.1)%(Math.PI*2);
          for(let r=0;r<4;r++){
            const rad=((off+r*1.57)%(Math.PI*2))/(Math.PI*2)*280;
            const alpha=(1-rad/280)*0.22; if(alpha<0.01)continue;
            ctx.beginPath();ctx.arc(nx,ny,rad,0,Math.PI*2);
            ctx.strokeStyle=`rgba(0,212,170,${alpha})`;ctx.lineWidth=1;ctx.stroke();
          }
          ctx.beginPath();ctx.arc(nx,ny,5,0,Math.PI*2);ctx.fillStyle='rgba(0,212,170,0.9)';ctx.fill();
          ctx.beginPath();ctx.arc(nx,ny,9,0,Math.PI*2);ctx.strokeStyle='rgba(0,212,170,0.3)';ctx.lineWidth=1.5;ctx.stroke();
          ctx.fillStyle='rgba(0,212,170,0.45)';ctx.font="500 8px 'DM Mono',monospace";ctx.fillText(n.label,nx+12,ny+4);
        });
      }
      persons.forEach((p,pi)=>{
        const col=COLORS[pi%COLORS.length],px2=p.cx*W,py2=p.cy*H;
        const trail=trails[p.id]??[];
        if(showHeatmap&&trail.length>1){
          const now=Date.now();
          trail.forEach((pt,i)=>{
            const age=(now-pt.t)/8000,alpha=Math.max(0,(1-age)*0.5*(i/trail.length));
            const r2=18+(1-age)*8,g=ctx.createRadialGradient(pt.x*W,pt.y*H,0,pt.x*W,pt.y*H,r2);
            g.addColorStop(0,toRgba(col,alpha*0.8));g.addColorStop(1,toRgba(col,0));
            ctx.beginPath();ctx.arc(pt.x*W,pt.y*H,r2,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
          });
          ctx.beginPath();trail.forEach((pt,i)=>i===0?ctx.moveTo(pt.x*W,pt.y*H):ctx.lineTo(pt.x*W,pt.y*H));
          ctx.strokeStyle=toRgba(col,0.12);ctx.lineWidth=2;ctx.stroke();
        }
        const r1=28+Math.sin(ph*2)*3,r2b=44+Math.sin(ph*2+1)*4;
        ctx.beginPath();ctx.arc(px2,py2,r1,0,Math.PI*2);ctx.strokeStyle=toRgba(col,0.35);ctx.lineWidth=1.5;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(px2,py2,r2b,0,Math.PI*2);ctx.strokeStyle=toRgba(col,0.12);ctx.lineWidth=1;ctx.stroke();
        if(showSkeleton&&p.keypoints?.length===17){
          SKELETON.forEach(([a,b])=>{
            if(!p.keypoints[a]||!p.keypoints[b])return;
            const conf=Math.min(p.keypoints[a].confidence,p.keypoints[b].confidence);
            ctx.beginPath();ctx.moveTo(p.keypoints[a].x*W,p.keypoints[a].y*H);ctx.lineTo(p.keypoints[b].x*W,p.keypoints[b].y*H);
            ctx.strokeStyle=toRgba(col,conf*0.85);ctx.lineWidth=1.8;ctx.stroke();
          });
          p.keypoints.forEach((kp,i)=>{
            ctx.beginPath();ctx.arc(kp.x*W,kp.y*H,i<5?3.5:2.5,0,Math.PI*2);
            ctx.fillStyle=toRgba(col,kp.confidence*(i<5?1:0.9));ctx.fill();
          });
          const nose=p.keypoints[0];
          if(nose){ctx.beginPath();ctx.arc(nose.x*W,nose.y*H-14,11,0,Math.PI*2);ctx.strokeStyle=toRgba(col,0.6);ctx.lineWidth=1.5;ctx.stroke();}
        } else if(showSkeleton){
          ctx.beginPath();ctx.arc(px2,py2,8,0,Math.PI*2);ctx.fillStyle=toRgba(col,0.6);ctx.fill();
        }
        ctx.fillStyle=toRgba(col,0.7);ctx.font="600 9px 'DM Mono',monospace";
        ctx.fillText(`${persons.length>1?`P${pi+1} · `:''}CONF ${(p.confidence*100).toFixed(0)}%`,px2+30,py2-20);
      });
      if(!persons.length){
        ctx.fillStyle='rgba(0,212,170,0.08)';ctx.font="500 11px 'DM Mono',monospace";
        ctx.textAlign='center';ctx.fillText('NO PRESENCE DETECTED',W/2,H/2);ctx.textAlign='left';
      }
      raf=requestAnimationFrame(draw);
    };
    raf=requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(raf);
  },[pose,trails,showHeatmap,showSkeleton,showSignal]);
  return <canvas ref={ref} style={{ display:'block',borderRadius:16,border:'1px solid rgba(0,212,170,0.15)' }} />;
}

const Pill = ({label,value,unit}) => (
  <div style={{display:'flex',flexDirection:'column',gap:3,background:'rgba(0,212,170,0.04)',border:'1px solid rgba(0,212,170,0.12)',borderRadius:10,padding:'10px 14px',flex:1}}>
    <span style={{fontSize:9,color:'#334a44',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:"'DM Mono',monospace"}}>{label}</span>
    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
      <span style={{fontSize:22,fontWeight:700,color:'#00d4aa',fontFamily:"'DM Mono',monospace",lineHeight:1}}>{value}</span>
      <span style={{fontSize:10,color:'#335544'}}>{unit}</span>
    </div>
  </div>
);

const Toggle = ({label,active,onClick}) => (
  <button onClick={onClick} style={{padding:'6px 14px',borderRadius:8,fontSize:10,fontWeight:600,fontFamily:"'DM Mono',monospace",letterSpacing:'0.08em',cursor:'pointer',border:`1px solid ${active?'rgba(0,212,170,0.5)':'rgba(255,255,255,0.08)'}`,background:active?'rgba(0,212,170,0.12)':'rgba(255,255,255,0.02)',color:active?'#00d4aa':'#445566',transition:'all 0.2s ease'}}>{label}</button>
);

export default function MotionVisualizer() {
  const [showHeatmap,setShowHeatmap]=useState(true);
  const [showSkeleton,setShowSkeleton]=useState(true);
  const [showSignal,setShowSignal]=useState(true);
  const {livePose,wsState}=useRuViewSocket();
  const isLive=wsState==='live'&&livePose!==null;
  const simPose=useSimPose(!isLive);
  const activePose=isLive?livePose:simPose;
  const trails=useTrail(activePose?.persons??[]);
  const persons=activePose?.persons??[];
  const vitals=activePose?.vitals??{};
  const now=new Date();
  const STATUS={live:{color:'#00d4aa',glow:true,label:'LIVE · RUVIEW CONNECTED'},connecting:{color:'#f59e0b',glow:false,label:'CONNECTING TO BACKEND…'},disconnected:{color:'#445566',glow:false,label:'SIMULATED · START BACKEND TO GO LIVE'}};
  const st=STATUS[wsState]??STATUS.disconnected;
  return (
    <div style={{minHeight:'100vh',background:'#060a0f',fontFamily:"'DM Sans',system-ui,sans-serif",color:'#c8e8e0',display:'flex',flexDirection:'column',alignItems:'center',padding:'24px 20px'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box}@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <div style={{width:'100%',maxWidth:800,display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:st.color,boxShadow:st.glow?`0 0 10px ${st.color}`:'none',animation:st.glow?'blink 2s infinite':'none'}}/>
            <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:st.color,letterSpacing:'0.12em'}}>{st.label}</span>
          </div>
          <h1 style={{margin:0,fontSize:26,fontWeight:700,letterSpacing:'-0.03em',color:'#d8f0e8'}}>Motion Visualizer</h1>
          <div style={{fontSize:11,color:'#2a4040',marginTop:3,fontFamily:"'DM Mono',monospace"}}>WiFi CSI · RuView · {persons.length} person{persons.length!==1?'s':''} detected · {isLive?'live frames':'simulated'}</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:18,fontFamily:"'DM Mono',monospace",color:'#00d4aa'}}>{now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
          <div style={{fontSize:10,color:'#1a3030',marginTop:2,fontFamily:"'DM Mono',monospace"}}>{now.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}</div>
        </div>
      </div>
      <div style={{display:'flex',gap:20,width:'100%',maxWidth:800,alignItems:'flex-start'}}>
        <div style={{position:'relative',flexShrink:0}}>
          <RoomCanvas pose={activePose} trails={trails} showHeatmap={showHeatmap} showSkeleton={showSkeleton} showSignal={showSignal}/>
          <div style={{position:'absolute',inset:0,pointerEvents:'none',borderRadius:16,overflow:'hidden',background:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)'}}/>
        </div>
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:14}}>
          <div style={{background:'rgba(0,212,170,0.03)',border:'1px solid rgba(0,212,170,0.08)',borderRadius:14,padding:16}}>
            <div style={{fontSize:9,color:'#2a4040',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:"'DM Mono',monospace",marginBottom:12}}>Layers</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <Toggle label="WiFi Signals" active={showSignal} onClick={()=>setShowSignal(v=>!v)}/>
              <Toggle label="Motion Trail" active={showHeatmap} onClick={()=>setShowHeatmap(v=>!v)}/>
              <Toggle label="Skeleton Pose" active={showSkeleton} onClick={()=>setShowSkeleton(v=>!v)}/>
            </div>
          </div>
          <div style={{background:'rgba(0,212,170,0.03)',border:'1px solid rgba(0,212,170,0.08)',borderRadius:14,padding:16}}>
            <div style={{fontSize:9,color:'#2a4040',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:"'DM Mono',monospace",marginBottom:12}}>Live Vitals</div>
            <div style={{display:'flex',gap:8}}>
              <Pill label="Breathing" value={vitals.breathingRate?.toFixed(1)??'—'} unit="BPM"/>
              <Pill label="Heart Rate" value={vitals.heartRate?.toFixed(0)??'—'} unit="BPM"/>
            </div>
          </div>
          {persons.map((p,pi)=>(
            <div key={p.id} style={{background:'rgba(0,212,170,0.03)',border:`1px solid ${toRgba(COLORS[pi%COLORS.length],0.2)}`,borderRadius:14,padding:16}}>
              <div style={{fontSize:9,color:'#2a4040',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:"'DM Mono',monospace",marginBottom:12}}>{persons.length>1?`Person ${pi+1}`:'Detection'}</div>
              {[['Confidence',`${(p.confidence*100).toFixed(0)}%`],['Posture',activePose?.posture??'—'],['Keypoints',`${p.keypoints?.length??0} / 17`],['Activity',activePose?.activityLevel?(activePose.activityLevel>0.7?'active':'calm'):'—'],['Position',`${(p.cx*100).toFixed(0)}%, ${(p.cy*100).toFixed(0)}%`]].map(([k,v])=>(
                <div key={k} style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:10,color:'#2a4040',fontFamily:"'DM Mono',monospace"}}>{k}</span>
                  <span style={{fontSize:10,color:COLORS[pi%COLORS.length],fontFamily:"'DM Mono',monospace",fontWeight:600}}>{v}</span>
                </div>
              ))}
            </div>
          ))}
          <div style={{background:'rgba(0,212,170,0.03)',border:'1px solid rgba(0,212,170,0.08)',borderRadius:14,padding:16}}>
            <div style={{fontSize:9,color:'#2a4040',textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:"'DM Mono',monospace",marginBottom:12}}>ESP32 Nodes</div>
            {NODES.map((n,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'#00d4aa',boxShadow:'0 0 6px #00d4aa',flexShrink:0}}/>
                <span style={{fontSize:10,color:'#2a6655',fontFamily:"'DM Mono',monospace",flex:1}}>{n.label}</span>
                <span style={{fontSize:9,color:'#1a3030',fontFamily:"'DM Mono',monospace"}}>{Math.round(n.x*100)}%, {Math.round(n.y*100)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:18,fontSize:10,color:'#1a2e2a',fontFamily:"'DM Mono',monospace",textAlign:'center'}}>
        {isLive?`Live pose frames from RuView · ${WS_URL}`:`Simulated · Start backend + RuView to go live · ${WS_URL}`}
      </div>
    </div>
  );
}
