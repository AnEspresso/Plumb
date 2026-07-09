/* ═══ PLUMB MOTION LAW HARNESS ═══
   Runs the Getting-to-know-Plumb wizard in a real headless Chrome and enforces
   the six Motion Laws numerically, both directions, desktop + phone viewports.
   Prereq: npm i puppeteer   ·   Run: node laws.js  (or node laws.js --quick)
   Screenshots land in /tmp/laws/<view>/<dir><slide>.png for visual review.   */
const p = require('puppeteer');
const fs = require('fs');

const QUICK = process.argv.includes('--quick');
const ARG=k=>{const a=process.argv.find(x=>x.startsWith('--'+k+'='));return a?a.split('=')[1]:null;};
let VIEWS = QUICK ? [{name:'desktop',w:1440,h:900}] : [{name:'desktop',w:1440,h:900},{name:'mobile',w:390,h:844}];
let DIRS  = QUICK ? ['fwd'] : ['fwd','back'];
if(ARG('view'))VIEWS=VIEWS.length>1?VIEWS.filter(v=>v.name===ARG('view')):[{name:ARG('view'),w:ARG('view')==='mobile'?390:1440,h:ARG('view')==='mobile'?844:900}];
if(ARG('dir'))DIRS=[ARG('dir')];
const SLIDES = 16, MIN_DWELL = 2600, SETTLE_MS = 1600, CAP = 26000;

const SAMPLER = `window.__laws={samples:[],presses:[],places:[]};
(function(){const orig=window.tourPlace;
  window.tourPlace=function(rect,instant,dock,skipBub){
    try{const st=(new Error()).stack.split('\\n')[2]||'';
      const m=st.match(/at ([A-Za-z_$][\\w$]*)/);
      window.__laws.places.push({t:Date.now(),top:rect?Math.round(rect.top):null,
        inst:instant?1:0,who:m?m[1]:'step'});}catch(e){}
    return orig(rect,instant,dock,skipBub);
  };})();
(function(){
  const g=id=>{const e=document.getElementById(id);if(!e)return null;
    const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
    return {x:r.left,y:r.top,w:r.width,h:r.height,op:parseFloat(cs.opacity)};};
  let lastTap=false;
  setInterval(()=>{
    try{
      const orbEl=document.getElementById('tourOrb');
      const orb=g('tourOrb');
      const tap=!!(orbEl&&orbEl.classList.contains('tap'));
      let sc=(document.querySelector('main')?.scrollTop||0)
        +(document.querySelector('#calview .sv-body')?.scrollTop||0)
        +(document.getElementById('clBody')?.scrollTop||0)
        +(document.querySelector('#subview .sv-body')?.scrollTop||0);
      document.querySelectorAll('.pmodal-scrim.show .pmodal, #sheet').forEach(m=>{sc+=m.scrollTop||0;
        m.querySelectorAll('div').forEach(d2=>{if(d2.scrollHeight>d2.clientHeight+4)sc+=d2.scrollTop||0;});});
      const s={t:Date.now(),idx:(typeof _tourIdx!=='undefined')?_tourIdx:-1,
        spot:g('tourSpot'),bub:g('tourBubble'),orb,tap,sc};
      if(tap&&!lastTap&&orb){
        const cx=orb.x+orb.w/2, cy=orb.y+orb.h/2;
        const hit=document.elementFromPoint(cx,cy);
        const bub=document.getElementById('tourBubble');
        s.press={x:cx,y:cy,onBubble:!!(bub&&hit&&(hit===bub||bub.contains(hit))),
          hit:hit?(hit.id||hit.className||hit.tagName).toString().slice(0,40):'none'};
        window.__laws.presses.push(s.press);
      }
      lastTap=tap;
      window.__laws.samples.push(s);
      if(window.__laws.samples.length>400)window.__laws.samples.shift();
    }catch(e){}
  },62);
})();`;

const dist=(a,b)=>Math.hypot((a.x+a.w/2)-(b.x+b.w/2),(a.y+a.h/2)-(b.y+b.h/2));

/* Movement episodes: stationary → moving → stationary, with metadata. */
function episodes(samples, key){
  const eps=[]; let cur=null, still0=null;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1][key], b=samples[i][key];
    if(!a||!b)continue;
    const d=dist(a,b);
    if(d>2.5){
      if(!cur)cur={start:samples[i].t,from:a,stillBefore:still0?samples[i-1].t-still0:0,revs:0,lastDy:0,scroll:0};
      cur.scroll+=Math.abs((samples[i].sc||0)-(samples[i-1].sc||0));
      const dy=(b.y+b.h/2)-(a.y+a.h/2);
      if(Math.abs(dy)>4&&cur.lastDy&&Math.sign(dy)!==Math.sign(cur.lastDy)&&Math.abs(dy)>25)cur.revs++;
      if(Math.abs(dy)>4)cur.lastDy=dy;
      still0=null;
    } else {
      if(still0===null)still0=samples[i].t;
      if(cur&&samples[i].t-still0>=180){cur.end=still0;cur.to=b;cur.dist=dist(cur.from,b);eps.push(cur);cur=null;}
    }
  }
  return eps;
}

function analyze(slide, dir, view, samples, presses,places){
  const V=[];
  const t0=samples.length?samples[0].t:0;
  const tail=samples.filter(s=>s.t>=(samples[samples.length-1]?.t||0)-1400);

  /* LAW 1 — ring lands and stays: no small "correction" jumps after real stillness;
     stationary at slide end. */
  const spotEps=episodes(samples,'spot');
  spotEps.forEach(e=>{
    const animated=(e.end-e.start)>140;
    const tapNear=samples.some(s=>s.tap&&s.t>=e.start-200&&s.t<=e.end+800);
    if(animated&&!tapNear&&e.stillBefore>380&&e.dist>3&&e.dist<45&&(e.scroll||0)<5){
      const chor=(places||[]).some(p=>!p.inst&&Math.abs(p.t-e.start)<420);   /* animated placements ARE choreography; corrections are instant by design */
      if(!chor)V.push(`L1 jitter: ring visibly corrected ${e.dist|0}px after ${e.stillBefore|0}ms still`);
    }
  });
  const endSpots=tail.map(s=>s.spot).filter(Boolean);
  if(endSpots.length>4){
    const drift=Math.max(...endSpots.map(s=>dist(s,endSpots[0])));
    if(drift>3)V.push(`L1 unrest: ring drifting ${drift|0}px at slide end`);
  }

  /* LAW 2 — one smooth motion: no double-reversal bounces per episode. */
  spotEps.forEach(e=>{if(e.revs>1)V.push(`L2 bounce: ring reversed ${e.revs}x in one move`);});

  /* LAW 3 — every press hits a real thing: whiffs land on the catcher/dim/body. */
  presses.forEach(pr=>{
    if(/tour-catch|^BODY$|^HTML$|^none$/.test(pr.hit))
      V.push(`L3 whiff: press hit ${pr.hit} at ${pr.x|0},${pr.y|0}`);
  });

  /* LAW 4 — bubble: never faded once shown; at most one move after entry glide;
     zero moves late in the slide. */
  const shown=samples.filter(s=>s.bub&&s.bub.op>0.05);
  if(shown.some(s=>s.bub.op<0.05))V.push('L4 fade: bubble opacity dropped mid-slide');
  const bubEps=episodes(samples,'bub').filter(e=>e.dist>8);
  if(bubEps.length>2)V.push(`L4 dance: ${bubEps.length} bubble moves in one slide`);
  const tailMoves=bubEps.filter(e=>e.start>=(samples[samples.length-1]?.t||0)-2000);
  if(tailMoves.length)V.push('L4 unrest: bubble still moving at slide end');

  /* LAW 5 — no press ever lands on the bubble. */
  presses.forEach(pr=>{if(pr.onBubble)V.push(`L5 press ON BUBBLE at ${pr.x|0},${pr.y|0} (hit ${pr.hit})`);});

  /* LAW 6 — phones: bubble hugs the far band, full width. */
  if(view.name==='mobile'&&tail.length){
    const s=tail[tail.length-1];
    if(s.bub&&s.spot&&s.spot.h>0&&s.bub.op>0.05){
      const bC=s.bub.y+s.bub.h/2, rC=s.spot.y+s.spot.h/2, vh=view.h;
      const band=bC<vh*0.45?'top':(bC>vh*0.55?'bottom':'mid');
      if(band==='mid')V.push('L6 band: bubble is mid-screen on mobile');
      const ovY=Math.min(s.bub.y+s.bub.h,s.spot.y+s.spot.h)-Math.max(s.bub.y,s.spot.y);
      if(ovY>28){
        const bh2=s.bub.h;
        const ovTop=Math.max(0,Math.min(12+bh2,s.spot.y+s.spot.h)-Math.max(12,s.spot.y));
        const ovBot=Math.max(0,Math.min(vh-12,s.spot.y+s.spot.h)-Math.max(vh-12-bh2,s.spot.y));
        const best=Math.min(ovTop,ovBot);
        if(ovY>best+10)V.push(`L6 overlap: bubble covers ${ovY|0}px (optimal band would cover ${best|0})`);
      }
      if(s.bub.w<view.w-40)V.push(`L6 width: mobile bubble ${s.bub.w|0}px (< full band)`);
    }
  }
  return V;
}

(async()=>{
  fs.rmSync('/tmp/laws',{recursive:true,force:true});
  const b=await p.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  let total=0, fails=[];
  for(const view of VIEWS){
    const pg=await b.newPage();
    await pg.setViewport({width:view.w,height:view.h,isMobile:view.name==='mobile',hasTouch:view.name==='mobile'});
    await pg.goto('file://'+process.cwd()+'/index.html');
    await new Promise(r=>setTimeout(r,1400));
    await pg.evaluate(()=>{try{localStorage.setItem('plumbTourMute','1');}catch(e){}});
    await pg.evaluate(()=>{setMode('demo');load();enterDemo();startTour('grand');});
    await pg.evaluate(SAMPLER);
    fs.mkdirSync(`/tmp/laws/${view.name}`,{recursive:true});

    for(const dir of DIRS){
      const steps=dir==='fwd'?SLIDES:SLIDES-1;
      for(let k=0;k<steps;k++){
        const slide=dir==='fwd'?k:SLIDES-2-k;              /* fwd: 0..15 · back: 14..0 */
        if(!(dir==='fwd'&&k===0))
          await pg.evaluate(d=>d==='fwd'?tourNext():tourPrev(),dir);
        await pg.evaluate(()=>{window.__laws.samples=[];window.__laws.presses=[];});
        /* adaptive dwell: settle = all actors still + no taps for SETTLE_MS */
        const t0=Date.now(); let settled=false;
        while(Date.now()-t0<CAP){
          await new Promise(r=>setTimeout(r,240));
          if(Date.now()-t0<MIN_DWELL)continue;
          settled=await pg.evaluate((S)=>{
            const ss=window.__laws.samples;
            if(ss.length<8)return false;
            const cut=Date.now()-S;
            const win=ss.filter(s=>s.t>=cut);
            if(win.length<6)return false;
            if(win.some(s=>s.tap))return false;
            const d=(a,b)=>!a||!b?0:Math.hypot(a.x-b.x,a.y-b.y);
            for(let i=1;i<win.length;i++){                 /* EVERY frame still — endpoints alone can hide a full ride */
              if(d(win[i].spot,win[i-1].spot)>2)return false;
              if(d(win[i].orb,win[i-1].orb)>2)return false;
              if(d(win[i].bub,win[i-1].bub)>2)return false;
            }
            return true;
          },SETTLE_MS);
          if(settled)break;
        }
        const data=await pg.evaluate(()=>({samples:window.__laws.samples,presses:window.__laws.presses,places:window.__laws.places}));
        const V=analyze(slide,dir,view,data.samples,data.presses,data.places);
        total++;
        const tag=`${view.name}/${dir}${String(slide+1).padStart(2,'0')}`;
        await pg.screenshot({path:`/tmp/laws/${tag.replace('/','_')}.png`});
        if(V.length&&process.env.TAIL){const tl=data.samples.slice(-26);
          console.log('TAIL',tl.map(s=>`${s.t%100000}:${s.spot?Math.round(s.spot.y):'-'}${s.tap?'T':''}`).join(' '));}
        if(V.length){fails.push({tag,V});console.log(`✗ ${tag}${settled?'':' (cap)'}: ${V.join(' | ')}`);}
        else console.log(`✓ ${tag}${settled?'':' (cap)'}`);
      }
    }
    await pg.close();
  }
  await b.close();
  console.log(`\nLAWS: ${total-fails.length}/${total} slide-passes clean.`);
  if(fails.length){console.log('VIOLATIONS:',fails.length);process.exit(1);}
})();
