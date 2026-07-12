/* watch.js — film the tour in real Chrome; contact sheets for review.
   node watch.js --slide=3 [--to=5] [--view=mobile|desktop] [--fps=2.5] [--interact]
   --interact: participate in LAW-7 invitations (click the gold frame) like a user. */
const p=require('puppeteer');const {execSync}=require('child_process');const fs=require('fs');
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith('--'+k+'='));return m?m.split('=')[1]:d;};
const has=(k)=>process.argv.includes('--'+k);
(async()=>{
  const from=parseInt(arg('slide','1'),10), to=parseInt(arg('to',arg('slide','1')),10);
  const view=arg('view','mobile'), fps=parseFloat(arg('fps','2.5')), interact=has('interact');
  const vp=view==='mobile'?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:900};
  fs.rmSync('/tmp/watch',{recursive:true,force:true});fs.mkdirSync('/tmp/watch',{recursive:true});
  const b=await p.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const pg=await b.newPage();await pg.setViewport(vp);
  await pg.evaluateOnNewDocument(()=>{try{localStorage.setItem('plumbTourMute','1');}catch(e){}});
  await pg.goto('file://'+process.cwd()+'/index.html');
  await new Promise(r=>setTimeout(r,1500));
  await pg.evaluate(()=>{setMode('demo');load();enterDemo();startGrandTour();});
  await new Promise(r=>setTimeout(r,2800));
  for(let i=1;i<from;i++){
    // step through pre-roll slides quickly, completing tasks if interactive
    const idx0=await pg.evaluate(()=>_tourIdx);
    if(interact){const done=Date.now()+16000;
      while(Date.now()<done){const inv=await pg.evaluate(()=>window._tourInvite&&window._tourInvite.rect);
        if(inv){await new Promise(r=>setTimeout(r,500));await pg.mouse.click(inv.x,inv.y);await new Promise(r=>setTimeout(r,800));}
        else await new Promise(r=>setTimeout(r,350));
        if(await pg.evaluate(()=>_tourIdx)!==idx0)break;}}
    if(await pg.evaluate(()=>_tourIdx)===idx0)await pg.evaluate(()=>tourNext());
    await new Promise(r=>setTimeout(r,2200));
  }
  const gap=1000/fps;
  for(let s=from;s<=to;s++){
    const idx0=await pg.evaluate(()=>_tourIdx);
    const frames=[];const t0=Date.now();const CAPMS=26000;
    let fi=0;
    while(Date.now()-t0<CAPMS){
      const ts=((Date.now()-t0)/1000).toFixed(1);
      const fp=`/tmp/watch/s${s}_f${String(fi++).padStart(3,'0')}_${ts}s.png`;
      await pg.screenshot({path:fp});frames.push(fp);
      if(interact){
        const inv=await pg.evaluate(()=>window._tourInvite&&window._tourInvite.rect);
        if(inv){await new Promise(r=>setTimeout(r,Math.max(0,gap-150)));
          await pg.mouse.click(inv.x,inv.y);continue;}
      }
      const idx=await pg.evaluate(()=>_tourIdx);
      if(idx!==idx0)break;
      // stop filming a settled non-task slide after ~14s
      if(Date.now()-t0>14000&&!(await pg.evaluate(()=>!!window._tourInvite)))break;
      await new Promise(r=>setTimeout(r,Math.max(0,gap-150)));
    }
    const per=12;
    for(let k=0;k*per<frames.length;k++){
      const batch=frames.slice(k*per,(k+1)*per).map(f=>`-label "${f.split('_').pop().replace('.png','')}" ${f}`).join(' ');
      execSync(`montage ${batch} -tile 4x3 -geometry +3+3 -background gray20 -fill white /tmp/watch/SHEET_s${s}_${k}.png`);
    }
    frames.forEach(f=>fs.rmSync(f,{force:true}));
    const idx=await pg.evaluate(()=>_tourIdx);
    if(idx===idx0&&s<to){await pg.evaluate(()=>tourNext());await new Promise(r=>setTimeout(r,600));}
    console.log('slide',s,'filmed');
  }
  await b.close();
  console.log('sheets:',fs.readdirSync('/tmp/watch').filter(f=>f.startsWith('SHEET')).sort().join(' '));
})();
