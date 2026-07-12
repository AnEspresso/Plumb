/* story.js — the four-element timeline: ring(stage) · orb(gesture) · scroll · bubble.
   node story.js [--view=mobile] [--from=1 --to=16] — prints per-slide event logs. */
const p=require('puppeteer');
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith('--'+k+'='));return m?m.split('=')[1]:d;};
(async()=>{
  const from=+arg('from','1'),to=+arg('to','16'),view=arg('view','mobile');
  const vp=view==='mobile'?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:900};
  const b=await p.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const pg=await b.newPage();await pg.setViewport(vp);
  await pg.evaluateOnNewDocument(()=>{try{localStorage.setItem('plumbTourMute','1');}catch(e){}});
  await pg.goto('file://'+process.cwd()+'/index.html');
  await new Promise(r=>setTimeout(r,1500));
  await pg.evaluate(()=>{setMode('demo');load();enterDemo();startGrandTour();});
  await new Promise(r=>setTimeout(r,2800));
  const scene=()=>pg.evaluate(()=>{
    const g=id=>{const e=document.getElementById(id);if(!e)return null;const r=e.getBoundingClientRect();return r;};
    const sp=g('tourSpot'),o=document.getElementById('tourOrb'),bu=document.getElementById('tourBubble');
    const or=o?o.getBoundingClientRect():null;
    let stage='—';
    if(sp&&sp.height>4){const el=document.elementFromPoint(Math.min(innerWidth-4,Math.max(4,sp.left+sp.width/2)),Math.min(innerHeight-4,Math.max(4,sp.top+8)));
      const host=el&&(el.closest('[id]')||el);stage=host?(host.id||host.className.split(' ')[0]||host.tagName):'?';}
    let sc=0;document.querySelectorAll('main,#clBody,.sv-body').forEach(e=>sc+=e.scrollTop||0);
    const btxt=bu?bu.querySelector('.tour-b'):null;
    return {idx:_tourIdx,
      ring:sp?[Math.round(sp.top),Math.round(sp.height)]:null, stage,
      orb:or?[Math.round(or.left),Math.round(or.top)]:null,
      orbTap:o&&o.classList.contains('tap'),orbInv:o&&o.classList.contains('invite'),
      sc, hole:!!window._tourInvite,
      bub:btxt?btxt.textContent.slice(0,52):'',bubDo:bu&&bu.classList.contains('tour-do'),
      bubY:bu?Math.round(bu.getBoundingClientRect().top):null};
  });
  for(let s=1;s<from;s++){await pg.evaluate(()=>tourNext());await new Promise(r=>setTimeout(r,2000));}
  for(let s=from;s<=to;s++){
    const idx0=await pg.evaluate(()=>_tourIdx);
    console.log('\n═ SLIDE '+s+' ═');
    const t0=Date.now();let last='';
    while(Date.now()-t0<26000){
      const sn=await scene();
      const line=`ring@${sn.ring?sn.ring[0]+'/'+sn.ring[1]:'-'}[${sn.stage}] orb@${sn.orb?sn.orb[0]+','+sn.orb[1]:'-'}${sn.orbTap?' TAP':''}${sn.orbInv?' INV':''} sc${sn.sc} ${sn.hole?'HOLE ':''}bub${sn.bubDo?'*':''}@${sn.bubY}"${sn.bub}"`;
      if(line!==last){console.log(((Date.now()-t0)/1000).toFixed(1).padStart(5),line);last=line;}
      if(sn.hole){await new Promise(r=>setTimeout(r,600));
        const inv=await pg.evaluate(()=>window._tourInvite&&window._tourInvite.rect);
        if(inv)await pg.mouse.click(inv.x,inv.y);}
      if(sn.idx!==idx0)break;
      if(Date.now()-t0>14000&&!sn.hole)break;
      await new Promise(r=>setTimeout(r,320));
    }
    if(await pg.evaluate(()=>_tourIdx)===idx0&&s<to){await pg.evaluate(()=>tourNext());await new Promise(r=>setTimeout(r,500));}
  }
  await b.close();
})();
