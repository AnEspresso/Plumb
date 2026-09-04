/* qa.js — SitePlumb real-browser QA v2 (Puppeteer + bundled Chrome).
 *
 * Layers on top of sim.js (headless logic) with everything jsdom cannot see:
 * real CSS, stacking, layout, hit-targets, REAL FONTS, and pixel-level visual
 * regression against blessed baselines.
 *
 * - Fonts: Fraunces / Source Serif 4 / Hanken Grotesk load from the fontsource
 *   npm packages, so glyph-level review happens HERE, not on a phone.
 * - Clock: Date.now is frozen inside the page, so the demo seed renders the
 *   same dates every run and screenshots are byte-comparable.
 * - Baselines: shots diff against qa-baseline/*.png (pixelmatch). More than
 *   0.6% changed pixels fails the run. After INTENDED visual changes, re-bless
 *   with `node qa.js --bless`. First run auto-blesses with a notice.
 * - Site: the marketing page runs too - hero animation must finish, and a
 *   spoofed-standalone launch must redirect to /app/.
 * - Monkey: 12 seconds of random taps in the demo; any page error fails.
 *
 * Out of scope forever (on-device QA): true iOS standalone behavior,
 * service-worker update cycles on a real device, live Firebase.
 * `node qa.js` must exit 0 as part of the deploy ritual.
 */
const puppeteer=require('puppeteer');
const http=require('http');
const fs=require('fs');
const path=require('path');
const {PNG}=require('pngjs');
const pixelmatch=require('pixelmatch').default||require('pixelmatch');

const PORT=8123,SITE_PORT=8124;
const SHOTS=path.join(__dirname,'qa-shots');
const BASE=path.join(__dirname,'qa-baseline');
const BLESS=process.argv.includes('--bless');
const FROZEN_NOW=1785630000000;   /* fixed instant: every relative seed date derives from this */
const failures=[],passes=[];let blessed=0;
function t(name,cond,detail){
  if(cond)passes.push(name);
  else failures.push(name+(detail!==undefined?('  ['+String(detail).slice(0,160)+']'):''));
}

/* ── static servers: app dir (with /qa-fonts/) and site dir ── */
const FONTS={
  'fraunces-500.woff2':'node_modules/@fontsource/fraunces/files/fraunces-latin-500-normal.woff2',
  'ss4-400.woff2':'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2',
  'ss4-500.woff2':'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-500-normal.woff2',
  'ss4-600.woff2':'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2',
  'ss4-400i.woff2':'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2',
  'ss4-700.woff2':'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2',
  'hg-400.woff2':'node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-400-normal.woff2',
  'hg-500.woff2':'node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-500-normal.woff2',
  'hg-600.woff2':'node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-600-normal.woff2',
  'hg-700.woff2':'node_modules/@fontsource/hanken-grotesk/files/hanken-grotesk-latin-700-normal.woff2'
};
const FONT_CSS=`
@font-face{font-family:'Fraunces';font-weight:500;font-style:normal;src:url('http://localhost:${PORT}/qa-fonts/fraunces-500.woff2') format('woff2');}
@font-face{font-family:'Source Serif 4';font-weight:400;font-style:normal;src:url('http://localhost:${PORT}/qa-fonts/ss4-400.woff2') format('woff2');}
@font-face{font-family:'Source Serif 4';font-weight:500;font-style:normal;src:url('http://localhost:${PORT}/qa-fonts/ss4-500.woff2') format('woff2');}
@font-face{font-family:'Source Serif 4';font-weight:600;font-style:normal;src:url('http://localhost:${PORT}/qa-fonts/ss4-600.woff2') format('woff2');}
@font-face{font-family:'Source Serif 4';font-weight:700;font-style:normal;src:url('http://localhost:${PORT}/qa-fonts/ss4-700.woff2') format('woff2');}
@font-face{font-family:'Source Serif 4';font-weight:400;font-style:italic;src:url('http://localhost:${PORT}/qa-fonts/ss4-400i.woff2') format('woff2');}
@font-face{font-family:'Hanken Grotesk';font-weight:400;src:url('http://localhost:${PORT}/qa-fonts/hg-400.woff2') format('woff2');}
@font-face{font-family:'Hanken Grotesk';font-weight:500;src:url('http://localhost:${PORT}/qa-fonts/hg-500.woff2') format('woff2');}
@font-face{font-family:'Hanken Grotesk';font-weight:600;src:url('http://localhost:${PORT}/qa-fonts/hg-600.woff2') format('woff2');}
@font-face{font-family:'Hanken Grotesk';font-weight:700;src:url('http://localhost:${PORT}/qa-fonts/hg-700.woff2') format('woff2');}
`;
function serve(root,port){
  return new Promise(res=>{
    const srv=http.createServer((req,resp)=>{
      const clean=decodeURIComponent(req.url.split('?')[0]);
      if(clean.startsWith('/qa-fonts/')){
        const key=clean.slice('/qa-fonts/'.length);
        const fp=FONTS[key]&&path.join(__dirname,FONTS[key]);
        if(fp&&fs.existsSync(fp)){resp.writeHead(200,{'Content-Type':'font/woff2','Access-Control-Allow-Origin':'*'});resp.end(fs.readFileSync(fp));return;}
        resp.writeHead(404);resp.end();return;
      }
      if(clean.startsWith('/app')){resp.writeHead(200,{'Content-Type':'text/html'});resp.end('<!doctype html><title>app stub</title>app stub');return;}
      let f=path.join(root,clean.replace(/^\//,'')||'index.html');
      if(!f.startsWith(root)||!fs.existsSync(f)||!fs.statSync(f).isFile())f=path.join(root,'index.html');
      const ext=path.extname(f);
      resp.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.json'?'application/json':'text/html'});
      resp.end(fs.readFileSync(f));
    });
    srv.listen(port,()=>res(srv));
  });
}

async function prepPage(browser,{mobile=true,standalone=false}={}){
  const page=await browser.newPage();
  if(mobile)await page.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
  else await page.setViewport({width:1280,height:900});
  page.on('pageerror',e=>failures.push('pageerror: '+String(e).slice(0,160)));
  await page.evaluateOnNewDocument((now,fontCss,standalone)=>{
    Date.now=()=>now;                       /* frozen clock: deterministic seed dates */
    if(standalone){
      const om=window.matchMedia.bind(window);
      window.matchMedia=q=>q.indexOf('display-mode: standalone')>=0?{matches:true,addListener(){},addEventListener(){},removeEventListener(){}}:om(q);
    }
    document.addEventListener('DOMContentLoaded',()=>{const st=document.createElement('style');st.textContent=fontCss;document.head.appendChild(st);});
  },FROZEN_NOW,FONT_CSS,standalone);
  return page;
}

async function shot(page,name){
  const cur=path.join(SHOTS,name+'.png');
  try{await page.evaluate(()=>document.fonts.ready);}catch(e){}
  await page.screenshot({path:cur});
  const base=path.join(BASE,name+'.png');
  if(BLESS||!fs.existsSync(base)){fs.copyFileSync(cur,base);blessed++;return;}
  try{
    const a=PNG.sync.read(fs.readFileSync(base)),b=PNG.sync.read(fs.readFileSync(cur));
    if(a.width!==b.width||a.height!==b.height){t('pixel baseline: '+name,false,'size changed');return;}
    const diff=new PNG({width:a.width,height:a.height});
    const n=pixelmatch(a.data,b.data,diff.data,a.width,a.height,{threshold:.12});
    const pct=n/(a.width*a.height)*100;
    if(pct>0.6){fs.writeFileSync(path.join(SHOTS,name+'.DIFF.png'),PNG.sync.write(diff));}
    t('pixel baseline: '+name, pct<=0.6, pct.toFixed(2)+'% pixels changed - see qa-shots/'+name+'.DIFF.png or re-bless');
  }catch(e){t('pixel baseline: '+name,false,e.message);}
}
async function tappable(page,sel){
  return page.evaluate(s=>{
    const el=document.querySelector(s);
    if(!el)return {ok:false,why:'missing'};
    const r=el.getBoundingClientRect();
    if(r.width===0||r.height===0)return {ok:false,why:'zero-size'};
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    if(!hit)return {ok:false,why:'nothing at point'};
    if(el===hit||el.contains(hit)||hit.contains(el))return {ok:true};
    return {ok:false,why:'covered by '+(hit.id?('#'+hit.id):hit.className||hit.tagName)};
  },sel);
}

(async()=>{
  if(!fs.existsSync(SHOTS))fs.mkdirSync(SHOTS);
  if(!fs.existsSync(BASE))fs.mkdirSync(BASE);
  fs.readdirSync(SHOTS).filter(f=>f.endsWith('.DIFF.png')).forEach(f=>fs.unlinkSync(path.join(SHOTS,f)));
  const appSrv=await serve(__dirname,PORT);
  const siteRoot=path.resolve(__dirname,'../site');
  const siteSrv=fs.existsSync(siteRoot)?await serve(siteRoot,SITE_PORT):null;
  const browser=await puppeteer.launch({args:['--no-sandbox','--disable-dev-shm-usage']});

  /* ══ APP · PHONE ══ */
  const page=await prepPage(browser);
  await page.goto('http://localhost:'+PORT+'/index.html?demo=1',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1600));

  t('demo arrival shows the example-build banner', await page.evaluate(()=>document.body.classList.contains('on-excursion')&&getComputedStyle(document.getElementById('excBanner')).display!=='none'));
  t('public demo arrival does not show the tour offer', await page.evaluate(()=>!document.getElementById('demoIntroScrim').classList.contains('show')));
  t('tour offer appears when QA or owner is allowed', await page.evaluate(()=>{
    const orig=walkAllowed;
    walkAllowed=function(){return true;};
    try{sessionStorage.removeItem('plumbTourOffered');}catch(e){}
    maybeOfferTour();
    const shown=document.getElementById('demoIntroScrim').classList.contains('show');
    walkAllowed=orig;
    try{document.getElementById('demoIntroScrim').classList.remove('show');}catch(e){}
    try{sessionStorage.removeItem('plumbTourOffered');}catch(e){}
    return shown;
  }));
  t('no install gate over the demo', await page.evaluate(()=>{const vis=id=>{const e=document.getElementById(id);return e&&e.classList.contains('show');};return !vis('installGate')&&!vis('installScrim');}));
  t('serif faces really loaded', await page.evaluate(async()=>{
    const faces=["16px 'Source Serif 4'","16px 'Fraunces'"];
    try{
      if(document.fonts&&document.fonts.load){
        await Promise.all(faces.map(f=>document.fonts.load(f).catch(()=>{})));
      }
      if(document.fonts&&document.fonts.ready)await document.fonts.ready;
    }catch(e){}
    const check=()=>faces.every(f=>document.fonts.check(f));
    if(check())return true;
    for(let i=0;i<6;i++){
      await new Promise(r=>setTimeout(r,250));
      try{if(document.fonts&&document.fonts.load)await Promise.all(faces.map(f=>document.fonts.load(f).catch(()=>{})));}catch(e){}
      if(check())return true;
    }
    return check();
  }));
  await shot(page,'01-demo-arrival');
  await page.evaluate(()=>demoIntroExplore());

  await page.evaluate(()=>exitDemo());
  await new Promise(r=>setTimeout(r,250));
  for(const [sel,label] of [["#exitDemoScrim [onclick*='exitDemoToApp']",'Set up my own builds'],["#exitDemoScrim [onclick*='exitDemoToSite']",'Back to the website'],["#exitDemoScrim [onclick*='exitDemoStay']",'Keep exploring']]){
    const r=await tappable(page,sel);t('exit fork tappable: '+label,r.ok,r.why);
  }
  await shot(page,'02-exit-fork');
  await page.evaluate(()=>exitDemoStay());

  await page.evaluate(()=>legalOpenTerms());
  await new Promise(r=>setTimeout(r,300));
  const done=await tappable(page,"#legalDocScrim .ld-bar button");
  t('policy sheet Done tappable in the demo',done.ok,done.why);
  await page.evaluate(()=>closeLegalDoc());
  t('Done returns to the demo intact', await page.evaluate(()=>document.body.classList.contains('on-excursion')&&!document.getElementById('legalDocScrim').classList.contains('show')));

  const cards=await page.evaluate(()=>{try{demoRole('builder');}catch(e){}return document.querySelectorAll('#ovCards .ov-card').length;});
  t('overview renders all ten site cards',cards===10,cards);
  const nyN=await page.evaluate(()=>document.querySelectorAll('#ovToday .ny-home-row').length);
  t('first screen shows at most three Needs-you rows',nyN<=3,nyN);
  await page.evaluate(()=>{const el=document.querySelector('#ovToday .ov-field');if(el)el.scrollIntoView({block:'center'});});
  const fnTap=await tappable(page,'#ovToday .ov-field');
  t('Field Notes card tappable',fnTap.ok,fnTap.why);
  const fnMeta=await page.evaluate(()=>{
    const el=document.querySelector('#ovToday .ov-field');
    if(!el)return {ok:false,why:'missing'};
    const r=el.getBoundingClientRect();
    const cs=getComputedStyle(el);
    const name=(el.getAttribute('aria-label')||el.innerText||'').replace(/\s+/g,' ').trim();
    const txt=(el.innerText||'').replace(/\s+/g,' ').trim();
    return {
      ok:r.height>=48&&r.width>=300&&!!name&&txt.indexOf('Write a field note')>=0,
      why:'h='+Math.round(r.height)+' w='+Math.round(r.width)+' name='+JSON.stringify(name)+' txt='+JSON.stringify(txt)+' bg='+cs.backgroundColor
    };
  });
  t('Field Notes is a labelled full-width primary',fnMeta.ok,fnMeta.why);
  const fnMark=await page.evaluate(()=>{
    const svg=document.querySelector('#ovToday .ov-field svg.cam');
    if(!svg)return {ok:false,why:'missing'};
    const r=svg.getBoundingClientRect();
    return {ok:r.width>=80&&r.height>=50,why:'w='+Math.round(r.width)+' h='+Math.round(r.height)};
  });
  t('Field Notes mark is large enough to read',fnMark.ok,fnMark.why);
  await shot(page,'04-overview');

  await page.evaluate(()=>{try{demoRole('builder');state.activeId='p2';nyOpenHouse('p2');houseGoDesk('docs');}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const docTap=await tappable(page,'#filesDocs .btn-primary');
  t('Documents primary tappable',docTap.ok,docTap.why);
  const docName=await page.evaluate(()=>{const el=document.querySelector('#filesDocs .btn-primary');return (el&&(el.innerText||el.getAttribute('aria-label')||'')).replace(/\s+/g,' ').trim();});
  t('Documents primary is named',!!docName&&docName.indexOf('Add document')>=0,docName);

  await page.evaluate(()=>{try{houseGoDesk('crews');}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const crewTap=await tappable(page,'#buildSubs .btn-primary');
  t('Crews primary tappable',crewTap.ok,crewTap.why);
  const crewName=await page.evaluate(()=>{const el=document.querySelector('#buildSubs .btn-primary');return (el&&(el.innerText||el.getAttribute('aria-label')||'')).replace(/\s+/g,' ').trim();});
  t('Crews primary is named',!!crewName&&crewName.indexOf('Add a crew')>=0,crewName);
  const crewPkt=await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#subList .row')];
    return {n:rows.length,pkt:rows.filter(r=>/\bPacket\b/.test(r.innerText||'')).length,quiet:document.querySelectorAll('#subList .btn-quiet').length};
  });
  t('Crews rows have no Packet button',crewPkt.n>=1&&crewPkt.pkt===0&&crewPkt.quiet===0,JSON.stringify(crewPkt));
  await page.evaluate(()=>{const row=document.querySelector('#subList .row');if(row)row.click();});
  await new Promise(r=>setTimeout(r,200));
  await page.evaluate(()=>{try{closeSubDetail();openPacket((P().subs.find(s=>s.specialty==='plumb')||P().subs[0]||{}).id);}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const pkt=await page.evaluate(()=>{
    const body=document.getElementById('infoBody');
    const n=body?body.querySelectorAll('.btn-primary').length: -1;
    const rows=body?body.querySelectorAll('.row').length:0;
    const more=!!(body&&/packetMore/.test(body.innerHTML));
    const pink=!!(body&&body.querySelector('.pkt-open'));
    return {n,rows,more,pink,open:document.getElementById('infoScrim').classList.contains('show')};
  });
  t('Packet overlay is open',pkt.open,JSON.stringify(pkt));
  t('Packet has at most one primary',pkt.n<=1,JSON.stringify(pkt));
  t('Packet uses rows',pkt.rows>=1,JSON.stringify(pkt));
  t('Packet More is on the overlay',pkt.more,JSON.stringify(pkt));
  t('Packet dropped the pink still-open box',!pkt.pink,JSON.stringify(pkt));
  await page.evaluate(()=>{try{closeInfo();closeSubDetail();}catch(e){}});
  await page.evaluate(()=>{try{nyOpenHouse('p8');const s=(P().subs.find(x=>/Timberline/i.test(x.name))||P().subs[0]);openPacket(s.id);}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const tl=await page.evaluate(()=>{
    const body=document.getElementById('infoBody');
    const primary=(body&&body.querySelector('.btn-primary')&&(body.querySelector('.btn-primary').innerText||body.querySelector('.btn-primary').textContent||'')).replace(/\s+/g,' ').trim();
    const titles=[...((body&&body.querySelectorAll('.row-title'))||[])].map(el=>(el.textContent||'').trim());
    return {primary,titles,open:document.getElementById('infoScrim').classList.contains('show')};
  });
  t('Timberline packet is open',tl.open,JSON.stringify(tl));
  t('Timberline primary follows the calendar',tl.primary.indexOf('Schedule this crew')>=0,tl.primary);
  t('Timberline does not repeat not booked',tl.titles.every(t=>t.indexOf('not booked')<0&&t!=='No dates on the calendar'),JSON.stringify(tl.titles));
  await page.evaluate(()=>{try{closeInfo();const s=(P().subs.find(x=>/Fine Line/i.test(x.name))||P().subs[0]);openPacket(s.id);}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const fl=await page.evaluate(()=>{
    const body=document.getElementById('infoBody');
    const primary=(body&&body.querySelector('.btn-primary')&&(body.querySelector('.btn-primary').innerText||body.querySelector('.btn-primary').textContent||'')).replace(/\s+/g,' ').trim();
    return {primary,open:document.getElementById('infoScrim').classList.contains('show')};
  });
  t('Fine Line primary follows the calendar',fl.open&&fl.primary.indexOf('Text this link')>=0,fl.primary);
  await page.evaluate(()=>{try{closeInfo();closeSubDetail();}catch(e){}});

  await page.evaluate(()=>{
    try{closeInfo();closeSubDetail();closeBk();closeDay();}catch(e){}
    try{[...document.querySelectorAll('.sheet-scrim.show')].forEach(el=>el.classList.remove('show'));}catch(e){}
    try{calMonth=null;calSiteFilter='p8';openCal();}catch(e){}
  });
  await new Promise(r=>setTimeout(r,250));
  await page.evaluate(()=>{const el=document.querySelector('#calBody .btn-primary');if(el)el.scrollIntoView({block:'center'});});
  const calTap=await tappable(page,'#calBody .btn-primary');
  t('Calendar primary tappable',calTap.ok,calTap.why);
  const calName=await page.evaluate(()=>{const el=document.querySelector('#calBody .btn-primary');return (el&&(el.innerText||el.textContent||'')).replace(/\s+/g,' ').trim();});
  t('Calendar primary is Schedule a crew',!!calName&&calName.indexOf('Schedule a crew')>=0,calName);
  await page.evaluate(()=>{try{openBk(null,Date.now());const site=document.getElementById('bkSite');if(site){site.value='p8';bkFillSubs('p8');}}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const bk=await page.evaluate(()=>{
    const scr=document.getElementById('bkScrim');
    const n=scr?scr.querySelectorAll('.btn-primary').length:-1;
    const title=(document.getElementById('bkTitle')&&document.getElementById('bkTitle').textContent)||'';
    const pink=!!(document.getElementById('bkPacket')&&document.getElementById('bkPacket').querySelector('.bk-pkt'));
    const row=!!(document.getElementById('bkPacket')&&document.getElementById('bkPacket').querySelector('.row'));
    return {open:scr&&scr.classList.contains('show'),n,title,pink,row};
  });
  t('Booking sheet is open',bk.open,JSON.stringify(bk));
  t('Booking has one primary',bk.n===1,JSON.stringify(bk));
  t('Booking title is Schedule a crew',bk.title==='Schedule a crew',bk.title);
  t('Booking dropped the pink packet card',!bk.pink&&bk.row,JSON.stringify(bk));
  await page.evaluate(()=>{try{closeBk();closeCal();}catch(e){}});
  await page.evaluate(()=>{try{calMonth=new Date(2026,7,1);calSiteFilter='p8';calCrewFilter='';openCal();}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  const houseCal=await page.evaluate(()=>{
    const txt=(document.getElementById('calBody')&&document.getElementById('calBody').innerText)||'';
    const banners=[...document.querySelectorAll('#calBody .pkt-banner')].map(el=>(el.innerText||'').replace(/\s+/g,' ').trim());
    return {txt,banners,who:(document.getElementById('calWho')&&document.getElementById('calWho').textContent)||''};
  });
  t('Beaumont calendar is this house',houseCal.who.indexOf('Beaumont')>=0,houseCal.who);
  t('Beaumont calendar does not flag other houses',['Calderwood','Whitaker','Clearwater','Juniper'].every(n=>houseCal.txt.indexOf(n)<0),JSON.stringify(houseCal.banners));
  await page.evaluate(()=>{try{closeCal();}catch(e){}});

  await page.evaluate(()=>{try{exitHouseDesk();closeHouse();openSiteFromOverview('p2');go('files');filesSeg('photos');}catch(e){}});
  await new Promise(r=>setTimeout(r,250));
  await page.evaluate(()=>{const el=document.querySelector('#filesPhotos .btn-primary');if(el)el.scrollIntoView({block:'center'});});
  const phTap=await tappable(page,'#filesPhotos .btn-primary');
  t('Photos primary tappable',phTap.ok,phTap.why);
  const phName=await page.evaluate(()=>{const el=document.querySelector('#filesPhotos .btn-primary');return (el&&(el.innerText||el.getAttribute('aria-label')||'')).replace(/\s+/g,' ').trim();});
  t('Photos primary is named',!!phName,phName);

  await page.evaluate(()=>{try{openSettings();}catch(e){}});
  await new Promise(r=>setTimeout(r,200));
  const setDone=await tappable(page,'#settingsScrim .sheet-foot .btn-primary');
  t('Settings Done tappable',setDone.ok,setDone.why);
  const setDoneName=await page.evaluate(()=>{const el=document.querySelector('#settingsScrim .sheet-foot .btn-primary');return (el&&(el.innerText||el.getAttribute('aria-label')||'')).replace(/\s+/g,' ').trim();});
  t('Settings Done is named',!!setDoneName,setDoneName);
  await page.evaluate(()=>{
    try{closeSettings();}catch(e){}
    try{exitHouseDesk();}catch(e){}
    try{closeHouse();}catch(e){}
    try{showOverview();renderToday();}catch(e){}
    try{demoRole('builder');}catch(e){}
  });

  await page.evaluate(()=>{state.activeId='p9';demoRole('subs');});
  await new Promise(r=>setTimeout(r,200));
  t('sub chip on Orchard Row is Ridgeline', await page.evaluate(()=>state.session.name)==='Ridgeline Plumbing');
  await page.evaluate(()=>demoRole('client'));
  t('homeowner chip stays on Orchard Row', await page.evaluate(()=>state.session.site)==='p9');
  await shot(page,'05-homeowner-p9');
  await page.evaluate(()=>{demoRole('builder');state.activeId='p2';demoRole('subs');});
  t('sub chip on Calderwood is still Clearwater', await page.evaluate(()=>state.session.name)==='Clearwater Plumbing');
  await page.evaluate(()=>demoRole('builder'));

  await page.reload({waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1600));
  t('reload mid-demo resumes the demo', await page.evaluate(()=>document.body.classList.contains('on-excursion')&&appMode()==='demo'));
  t('resume does not re-ask the tour', await page.evaluate(()=>!document.getElementById('demoIntroScrim').classList.contains('show')));

  await page.evaluate(()=>{demoRole('builder');openSiteFromOverview('p8');});
  await new Promise(r=>setTimeout(r,300));
  await page.evaluate(()=>openBudget());
  await new Promise(r=>setTimeout(r,300));
  t('Beaumont Park budget shows the amber overrun', await page.evaluate(()=>{
    const b=document.getElementById('budgetBody');
    return !!(b&&b.querySelector('.hero-n.warn')&&b.innerHTML.includes('Over budget')&&b.innerHTML.includes('5,200 over'));
  }));
  t('Beaumont Money body has one primary', await page.evaluate(()=>document.querySelectorAll('#budgetBody .btn-primary').length===1));
  t('Beaumont Money has no leftover oak links', await page.evaluate(()=>{
    const txt=(document.getElementById('budgetBody')||{}).innerText||'';
    return txt.indexOf('Cost report')<0&&txt.indexOf('QuickBooks')<0&&txt.indexOf('accountant')<0&&txt.indexOf('$0 left')<0;
  }));
  await page.evaluate(()=>moneyMore());
  await new Promise(r=>setTimeout(r,150));
  t('More still reaches Cost report', await page.evaluate(()=>{
    const txt=(document.getElementById('choiceBody')||{}).innerText||'';
    return txt.indexOf('Cost report')>=0&&txt.indexOf('Add a budget line')>=0&&txt.indexOf('Download costs for your accountant')>=0;
  }));
  await page.evaluate(()=>closeChoice());
  await shot(page,'07-p8-budget');
  await page.evaluate(()=>closeBudget());
  await page.evaluate(()=>{demoRole('builder');openSiteFromOverview('p8');openBudget();openJobCost();});
  await new Promise(r=>setTimeout(r,300));
  await shot(page,'08-job-cost-report');
  await page.evaluate(()=>{closeJobCost();closeBudget();});

  /* glyph specimen: the letters that caused the font saga, in every live face */
  await page.evaluate(()=>{
    const d=document.createElement('div');d.id='qaSpecimen';
    d.style.cssText='position:fixed;inset:0;z-index:999;background:#F2EEE6;color:#1B1916;padding:40px 24px;display:block;';
    const row=(txt,fam,size,weight,italic)=>{const e=document.createElement('div');
      e.textContent=txt;e.style.fontFamily=fam;e.style.fontSize=size+'px';
      e.style.fontWeight=weight||400;if(italic)e.style.fontStyle='italic';
      e.style.marginTop='18px';d.appendChild(e);};
    row('SitePlumb',"'Fraunces',serif",34,500);
    row('Job cost report',"'Source Serif 4',serif",30,600);
    row('fine \u00b7 four \u00b7 faucet \u00b7 for a handful of',"'Source Serif 4',serif",26,600);
    row('Justify theify - italic J and f',"'Source Serif 4',serif",22,400,true);
    row('Hanken body - Jf 0123456789',"'Hanken Grotesk',sans-serif",18,500);
    document.body.appendChild(d);
  });
  await new Promise(r=>setTimeout(r,250));
  await shot(page,'09-glyph-specimen');
  await page.evaluate(()=>document.getElementById('qaSpecimen').remove());

  /* ══ GUEST PACKET PAGE: arrives from a text, one tap to answer ══ */
  const guest=await prepPage(browser);
  await guest.evaluateOnNewDocument(()=>{
    window.__packetFixture={v:1,t:Date.now(),expires:Date.now()+10*864e5,
      site:'288 Calderwood Ln \u00b7 Ferndale',builder:'Demo Builder',sub:'Clearwater Plumbing',
      trade:'plumb',tradeLabel:'Plumbing',start:Date.now()+3*864e5,end:Date.now()+5*864e5,
      note:'Rough-in \u2014 gate code 4417',
      specs:[{item:'Brushed brass / matte black',cat:'Plumbing Fixtures',room:'Whole House',
        rows:[{k:'Finish',v:'Brushed brass / matte black'},{k:'Valve height',gap:'builder'}]}],
      docs:['Mechanical / HVAC Layout.pdf'],siteId:'p2',bookingId:'bk_p2a',resp:null,
      ctx:{ready:'Site marked ready for you',readyOk:true,permit:'Plumbing Permit: Issued',insp:'rough plumb inspection: scheduled',
        history:[{d:'Jul 30',text:'Roof dried-in, windows and exterior doors installed'},{d:'Jul 28',text:'Framing topped out, trusses set and braced'}]}};
  });
  await guest.goto('http://localhost:'+PORT+'/index.html?packet=qa',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1600));
  t('guest page renders over everything', await guest.evaluate(()=>document.getElementById('guestScrim').classList.contains('show')));
  t('guest page shows no install chrome and no login', await guest.evaluate(()=>{const vis=id=>{const e=document.getElementById(id);return e&&e.classList.contains('show');};return !vis('installGate')&&!vis('installScrim');}));
  t('guest page shows readiness context and site history', await guest.evaluate(()=>{const h=document.getElementById('gpBody').innerHTML;return h.includes('Site marked ready for you')&&h.includes('Before you arrive')&&h.includes('Framing topped out');}));
  for(const [sel,label] of [["#gpBody .gp-btn.go",'These dates work'],["#gpBody .gp-btn.ghost",'Suggest different dates']]){
    const r=await tappable(guest,sel);t('guest button tappable: '+label,r.ok,r.why);
  }
  await shot(guest,'11-guest-packet');
  await guest.evaluate(()=>gpConfirm());
  await new Promise(r=>setTimeout(r,200));
  t('one tap confirms and offers the calendar', await guest.evaluate(()=>document.getElementById('gpBody').innerHTML.includes('Confirmed.')&&document.getElementById('gpBody').innerHTML.includes('Add to my calendar')));
  const cal=await tappable(guest,"#gpBody .gp-btn.ghost");
  t('calendar button tappable after confirm', cal.ok, cal.why);
  await guest.evaluate(()=>gpAddToCal());
  await new Promise(r=>setTimeout(r,150));
  t('calendar chooser offers device and Google', await guest.evaluate(()=>{const h=document.getElementById('gpCalPick');return h&&h.classList.contains('show')&&h.innerHTML.includes('Google Calendar');}));
  await shot(guest,'12-guest-confirmed');
  await guest.evaluate(()=>gpToggleAsk());
  await guest.evaluate(()=>document.querySelector('#gpAsk .gp-btn.go').scrollIntoView({block:'center'}));
  await new Promise(r=>setTimeout(r,250));
  const ask=await tappable(guest,"#gpAsk .gp-btn.go");
  t('guest ask-question send button tappable', ask.ok, ask.why);
  await guest.evaluate(()=>{document.getElementById('gpQText').value='Gas or electric water heater?';gpSendQuestion();});
  await new Promise(r=>setTimeout(r,150));
  t('guest question renders in the thread', await guest.evaluate(()=>document.getElementById('gpBody').innerHTML.includes('Gas or electric water heater?')&&document.getElementById('gpBody').innerHTML.includes('will get back to you')));
  await shot(guest,'13-guest-question');

  /* ══ ACCESSIBILITY (axe-core): no critical violations allowed ══ */
  await page.evaluate(()=>{try{demoRole('builder');showOverview();}catch(e){}});
  await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
  const axeOut=await page.evaluate(async()=>{const r=await axe.run(document,{resultTypes:['violations']});
    return r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length}));});
  const critical=axeOut.filter(v=>v.impact==='critical');
  t('axe: zero critical accessibility violations', critical.length===0, JSON.stringify(critical));
  const serious=axeOut.filter(v=>v.impact==='serious');
  if(serious.length)console.log('  axe note (non-blocking serious): '+serious.map(v=>v.id+'x'+v.n).join(', '));

  /* ══ APP · DESKTOP ══ */
  const desk=await prepPage(browser,{mobile:false});
  await desk.goto('http://localhost:'+PORT+'/index.html?demo=1',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1600));
  await desk.evaluate(()=>{try{demoIntroExplore();}catch(e){}demoRole('builder');state.activeId='p2';openSiteFromOverview('p2');openBudget();});
  await new Promise(r=>setTimeout(r,300));
  t('desktop budget renders the wide table', await desk.evaluate(()=>isWideBudget()===true&&document.getElementById('budgetBody').innerHTML.includes('bgt-table')));
  await shot(desk,'10-desktop-budget');

  /* ══ MONKEY: 12s of random taps in the demo must not throw ══ */
  const monkey=await prepPage(browser);
  const errsBefore=failures.length;
  await monkey.goto('http://localhost:'+PORT+'/index.html?demo=1',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,1500));
  await monkey.evaluate(()=>{try{demoIntroExplore();}catch(e){}});
  let seed=42;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};
  const t0=Date.now();
  while(Date.now()-t0<12000){
    const x=20+rnd()*350,y=60+rnd()*760;
    try{await monkey.mouse.click(x,y);}catch(e){}
    if(rnd()<0.15){try{await monkey.evaluate(()=>{const b=document.querySelector('.exc-exit');});}catch(e){}}
    await new Promise(r=>setTimeout(r,60));
  }
  t('monkey sweep: 12s of random taps, no page errors', failures.length===errsBefore);

  /* ══ SITE ══ */
  if(siteSrv){
    const site=await prepPage(browser);
    await site.goto('http://localhost:'+SITE_PORT+'/index.html',{waitUntil:'load'});
    await new Promise(r=>setTimeout(r,5200));
    t('hero house finishes drawing on its own', await site.evaluate(()=>{
      const read=document.getElementById('stageRead');
      const lns=[...document.querySelectorAll('#house .ln')];
      return read&&read.textContent==='Finished'&&lns.every(p=>p.style.strokeDasharray==='none'||p.style.strokeDashoffset==='0'||p.style.strokeDashoffset===0);
    }));
    await shot(site,'20-site-hero-finished');
    const sa=await prepPage(browser,{standalone:true});
    await sa.goto('http://localhost:'+SITE_PORT+'/index.html',{waitUntil:'load'});
    await new Promise(r=>setTimeout(r,400));
    t('standalone launch of the site redirects to /app/', sa.url().indexOf('/app/')>=0, sa.url());
  }

  await browser.close();appSrv.close();if(siteSrv)siteSrv.close();
  const v=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').match(/PLUMB_VERSION='([\d.]+)/)[1];
  const total=passes.length+failures.length;
  console.log('qa [index.html '+v+']: '+total+' checks, '+fs.readdirSync(SHOTS).filter(f=>!f.includes('DIFF')).length+' screenshots'+(blessed?(', '+blessed+' baseline(s) blessed'):''));
  if(failures.length){console.log('FAIL ('+failures.length+'):');failures.forEach(f=>console.log('  x '+f));process.exit(1);}
  console.log('PASS: layout, stacking, fonts, pixels and flows hold in real Chrome.');
  process.exit(0);
})().catch(e=>{console.log('FAIL: harness error - '+e.message+'\n'+e.stack.split('\n').slice(0,3).join('\n'));process.exit(1);});
