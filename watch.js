/* watch.js — film a tour slide in real Chrome and lay it out as contact sheets.
   Usage: node watch.js --slide=3 [--view=mobile|desktop] [--fps=3] [--secs=18]
   Output: /tmp/watch/sheet_*.png (4x3 grids, timestamped frames)              */
const p=require('puppeteer');const {execSync}=require('child_process');const fs=require('fs');
const arg=(k,d)=>{const m=process.argv.find(a=>a.startsWith('--'+k+'='));return m?m.split('=')[1]:d;};
(async()=>{
  const slide=parseInt(arg('slide','3'),10), view=arg('view','mobile');
  const fps=parseFloat(arg('fps','3')), secs=parseFloat(arg('secs','18'));
  const vp=view==='mobile'?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:900};
  fs.rmSync('/tmp/watch',{recursive:true,force:true});fs.mkdirSync('/tmp/watch',{recursive:true});
  const b=await p.launch({headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']});
  const pg=await b.newPage();await pg.setViewport(vp);
  await pg.evaluateOnNewDocument(()=>{try{localStorage.setItem('plumbTourMute','1');}catch(e){}});
  await pg.goto('file://'+process.cwd()+'/index.html');
  await new Promise(r=>setTimeout(r,1500));
  await pg.evaluate(()=>{setMode('demo');load();enterDemo();startTour('grand');});
  await new Promise(r=>setTimeout(r,2500));
  for(let i=1;i<slide;i++){await pg.evaluate(()=>tourNext());await new Promise(r=>setTimeout(r,i===slide-1?0:3300));}
  const n=Math.round(fps*secs), gap=1000/fps, t0=Date.now();
  for(let i=0;i<n;i++){
    const ts=((Date.now()-t0)/1000).toFixed(1);
    await pg.screenshot({path:`/tmp/watch/f${String(i).padStart(3,'0')}_${ts}s.png`});
    await new Promise(r=>setTimeout(r,Math.max(0,gap-120)));
  }
  await b.close();
  const frames=fs.readdirSync('/tmp/watch').filter(f=>f.startsWith('f')).sort();
  const per=12;
  for(let s=0;s*per<frames.length;s++){
    const batch=frames.slice(s*per,(s+1)*per).map(f=>`-label "${f.split('_')[1].replace('.png','')}" /tmp/watch/${f}`).join(' ');
    execSync(`montage ${batch} -tile 4x3 -geometry +3+3 -background gray20 -fill white /tmp/watch/sheet_${s}.png`);
  }
  console.log('sheets:',fs.readdirSync('/tmp/watch').filter(f=>f.startsWith('sheet')).join(' '));
})();
