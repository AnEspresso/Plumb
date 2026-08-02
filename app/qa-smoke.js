/* qa-smoke.js — SitePlumb cross-engine smoke (Playwright, runs in CI).
 *
 * qa.js covers Chromium in depth. This lane replays the CORE demo flows in
 * real WebKit (the engine inside every iPhone, iPad and Mac Safari) and in
 * Firefox, so engine-level differences surface in the Actions tab instead of
 * on a device. Engine, not platform: true iOS standalone behavior, keyboards
 * and share sheets remain on-device QA.
 *
 * Designed for GitHub Actions where Playwright browsers can download.
 * `node qa-smoke.js` must exit 0 (the workflow gates on it once promoted).
 */
const {webkit,firefox}=require('playwright');
const http=require('http');
const fs=require('fs');
const path=require('path');

const PORT=8131;
const failures=[],passes=[];
function t(engine,name,cond,detail){
  const label=engine+' \u00b7 '+name;
  if(cond)passes.push(label);
  else failures.push(label+(detail!==undefined?('  ['+String(detail).slice(0,160)+']'):''));
}
function serve(){
  return new Promise(res=>{
    const srv=http.createServer((req,resp)=>{
      let f=path.join(__dirname,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'')||'index.html');
      if(!f.startsWith(__dirname)||!fs.existsSync(f)||!fs.statSync(f).isFile())f=path.join(__dirname,'index.html');
      resp.writeHead(200,{'Content-Type':path.extname(f)==='.js'?'text/javascript':'text/html'});
      resp.end(fs.readFileSync(f));
    });
    srv.listen(PORT,()=>res(srv));
  });
}

async function lane(name,browserType){
  const browser=await browserType.launch();
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',e=>failures.push(name+' \u00b7 pageerror: '+String(e).slice(0,160)));
  await page.goto('http://localhost:'+PORT+'/index.html?demo=1',{waitUntil:'load'});
  await page.waitForTimeout(2000);
  const js=c=>page.evaluate(c);

  t(name,'demo arrival shows the banner', await js("document.body.classList.contains('on-excursion')&&getComputedStyle(document.getElementById('excBanner')).display!=='none'"));
  t(name,'tour offer appears', await js("document.getElementById('demoIntroScrim').classList.contains('show')"));
  await js("demoIntroExplore()");

  t(name,'ten site cards render', await js("(function(){demoRole('hillan');return document.querySelectorAll('#ovCards .ov-card').length;})()")===10);

  await js("legalOpenTerms()");
  await page.waitForTimeout(300);
  const done=await js(`(function(){const el=document.querySelector('#legalDocScrim .ld-bar button');if(!el)return 'missing';
    const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return (el===hit||el.contains(hit))?'ok':('covered by '+(hit?(hit.id||hit.className||hit.tagName):'nothing'));})()`);
  t(name,'policy sheet Done tappable in the demo', done==='ok', done);
  await js("closeLegalDoc()");
  t(name,'Done returns to the demo', await js("document.body.classList.contains('on-excursion')&&!document.getElementById('legalDocScrim').classList.contains('show')"));

  t(name,'role chips follow the active site', await js("(function(){state.activeId='p9';demoRole('subs');return state.session.name;})()")==='Ridgeline Plumbing');
  await js("demoRole('hillan')");

  await page.reload({waitUntil:'load'});
  await page.waitForTimeout(2000);
  t(name,'reload mid-demo resumes the demo', await js("document.body.classList.contains('on-excursion')&&appMode()==='demo'"));

  t(name,'Beaumont amber overrun renders', await js("(function(){demoRole('hillan');openSiteFromOverview('p8');openBudget();return document.getElementById('budgetBody').innerHTML.includes('5,200 over');})()"));

  await browser.close();
}

(async()=>{
  const srv=await serve();
  await lane('WEBKIT',webkit);
  await lane('FIREFOX',firefox);
  srv.close();
  const v=fs.readFileSync(path.join(__dirname,'index.html'),'utf8').match(/PLUMB_VERSION='([\d.]+)/)[1];
  console.log('qa-smoke [index.html '+v+']: '+(passes.length+failures.length)+' checks across WebKit + Firefox');
  if(failures.length){console.log('FAIL ('+failures.length+'):');failures.forEach(f=>console.log('  x '+f));process.exit(1);}
  console.log('PASS: core demo flows hold in the Safari engine and Firefox.');
  process.exit(0);
})().catch(e=>{console.log('FAIL: harness error - '+e.message);process.exit(1);});
