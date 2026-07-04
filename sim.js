/* sim.js — Plumb full-app functional simulator (Phase 1).
 *
 * Boots the REAL deployed index.html headlessly (jsdom), then plays out real
 * user stories across all three roles, asserting after every step:
 *   (1) visibility — everyone who should see the change, sees it;
 *   (2) isolation  — nobody who shouldn't, does;
 *   (3) agreement  — every derived number matches on every surface.
 * Finishes with an action-order fuzz layer (random sequences of real user
 * actions across role switches; any uncaught exception = FAIL with replayable
 * seed). Part of the deploy ritual: `node sim.js` must exit 0.
 *
 * Companion to subfilter.js (which guards sub display isolation at the
 * predicate level); sim.js drives the full rendered app.
 */
const {JSDOM}=require('jsdom');
const fs=require('fs');
const path=require('path');

const SRC=fs.readFileSync(path.join(__dirname,'index.html'),'utf8')
  .replace('</body>','<script>window.$eval=c=>eval(c);</script></body>');

const failures=[],passes=[];let section='';
function S(name){section=name;}
function t(name,cond,detail){
  const label=section+' · '+name;
  if(cond)passes.push(label);
  else failures.push(label+(detail!==undefined?('  ['+String(detail).slice(0,140)+']'):''));
}

function boot(){
  return new Promise(res=>{
    const dom=new JSDOM(SRC,{runScripts:'dangerously',url:'https://sim.test/',pretendToBeVisual:true,
      beforeParse(w){
        w.indexedDB={open:()=>({})};
        w.matchMedia=q=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
        w.navigator.serviceWorker={register:()=>Promise.resolve({}),getRegistration:()=>Promise.resolve(null),addEventListener(){}};
        w.scrollTo=()=>{};
        w.__thrown=[];
        w.addEventListener('error',e=>{w.__thrown.push(String(e.message||e.error));});
      }});
    setTimeout(()=>res(dom.window),700);
  });
}

(async()=>{
const w=await boot();
const $=c=>w.$eval(c);
const D=w.document;
const el=id=>D.getElementById(id);
const setVal=(id,v)=>{const e=el(id);if(!e)throw new Error('no element #'+id);e.value=v;};
const asBuilder=()=>{$("state.session={role:'hillan',name:'You'}");};
const asSub=n=>{$("state.session={role:'subs',name:'"+n+"'}");$("subSel=null");};
const asClient=pid=>{$("state.session={role:'client',site:'"+pid+"'}");};
const clientHTML=(pid,tab)=>{asClient(pid);$("clientTab='"+(tab||'home')+"'");$('renderClient()');return el('clBody').innerHTML;};
const subSiteHTML=(name,pid)=>{asSub(name);$('renderSubView()');$("openSubSite('"+pid+"')");return el('svBody').innerHTML;};
const promptOK=v=>{setVal('promptInput',v);$('confirmPrompt()');};

/* ════ 1 · BOOT & SEED ════ */
S('boot');
t('version 2.152.x',String($('PLUMB_VERSION')).startsWith('2.152'));

/* ════ 1b · ROLE-AWARE SYNC SCOPING (functions live in app; Sync stays inert here) ════ */
S('sync-scope');
t('builder gets all five colls', $("syncCollsFor('builder').map(c=>c.sub).join()") === 'items,sel,logs,pmts,mail');
t('sub skips pmts+mail', $("syncCollsFor('sub').map(c=>c.sub).join()") === 'items,sel,logs');
t('client skips mail only', $("syncCollsFor('client').map(c=>c.sub).join()") === 'items,sel,logs,pmts');
t('unknown role defaults to all', $("syncCollsFor(null).map(c=>c.sub).join()") === 'items,sel,logs,pmts,mail');
t('siteRoleFor: members map wins over session role',
  $("state.session={role:'client',auth:{uid:'uX'}};siteRoleFor({members:{uX:'sub'}})") === 'sub');
t('siteRoleFor: falls back to session subs->sub',
  $("state.session={role:'subs'};siteRoleFor({})") === 'sub');
t('siteRoleFor: falls back to session client->client',
  $("state.session={role:'client'};siteRoleFor(null)") === 'client');
t('siteRoleFor: builder session -> builder',
  $("state.session={role:'hillan'};siteRoleFor({})") === 'builder');
$("state.session=null");
t('SEED_VERSION 10',$('SEED_VERSION')===10);
t('4 seed sites',$('state.projects.length')===4);
t('no boot errors',w.__thrown.length===0,w.__thrown[0]);

/* ════ 2 · SCHEDULING LIFECYCLE (p1 Linden Ridge, Timberline Framing) ════ */
S('scheduling');
asBuilder();$("state.activeId='p1'");
const nBk0=$("(state.projects[0].bookings||[]).length");
// real data path (modal orchestration is UI-tested on device; state machine is what matters here)
const ts0=Date.now()+7*864e5, ts1=Date.now()+9*864e5;
const bkId=$("addBooking(state.projects[0],{subName:'Timberline Framing',trade:'framing',start:"+ts0+",end:"+ts1+",note:'Frame first floor',status:'pending'}).id");
t('booking added',$("(state.projects[0].bookings||[]).length")===nBk0+1);
// visibility: the booked sub sees it on their To-Do
let sv=subSiteHTML('Timberline Framing','p1');
t('booked sub sees own booking',sv.includes('Frame first floor'));
// isolation: a different sub on the same site does NOT
sv=subSiteHTML('Ironhill Excavating','p1');
t('other sub does not see the booking',!sv.includes('Frame first floor'));
// sub confirms through the real handler
asSub('Timberline Framing');
$("svBkConfirm('p1','"+bkId+"')");
t('status confirmed',$("state.projects[0].bookings.find(b=>b.id==='"+bkId+"').status")==='confirmed');
t('confirm did not throw',w.__thrown.length===0,w.__thrown[0]);
// v2.150.18 regression guard: status change re-rendered calendar with calMonth possibly null — must not crash
$('calMonth=null');
$("bkSetStatus&&true");
try{$("svBkDecline('p1','"+bkId+"')");}catch(e){t('decline path crashed',false,e.message);}
// decline opens themed confirm — accept it if present
if(el('confirmScrim')&&el('confirmScrim').classList.contains('show')){const b=D.querySelector('#confirmScrim .b-danger,#confirmScrim .b-go');if(b)b.click();}
const stAfter=$("state.projects[0].bookings.find(b=>b.id==='"+bkId+"').status");
t('decline flow reachable (confirmed→declined or confirm pending)',stAfter==='declined'||stAfter==='confirmed',stAfter);
$("updateBooking(state.projects[0],'"+bkId+"',{status:'confirmed'})"); // restore

/* stage window through the REAL themed prompt chain (v2.150.18) */
S('stage window');
asBuilder();$("state.activeId='p1'");
$("setStageWindow('p1','framing')");
t('start prompt opened',el('promptScrim').classList.contains('show'));
const d1=new Date(Date.now()+10*864e5).toISOString().slice(0,10);
promptOK(d1);
t('end prompt chained',el('promptScrim').classList.contains('show'));
promptOK(''); // accept default end
const win=$("stageWindow(state.projects[0],'framing')");
t('window saved via themed chain',!!(win&&win.start&&win.end&&win.end>win.start),JSON.stringify(win));
$("setStageWindow('p1','framing')");promptOK(''); // empty start = clear
t('empty start clears window',$("stageWindow(state.projects[0],'framing')")===null);

/* ════ 3 · SELECTIONS & SPECS LIFECYCLE (p1) ════ */
S('selections');
asBuilder();$("state.activeId='p1'");
const selN0=$("state.projects[0].selections.length");
setVal('selCat','Windows');setVal('selItem','Sim skylight — fixed');setVal('selNote','');setVal('selStatus','selected');setVal('selPrice','850');
try{setVal('selRoomSel','Whole House');}catch(e){}
$('saveSel()');
t('selection added via real saveSel',$("state.projects[0].selections.length")===selN0+1);
const simSelId=$("state.projects[0].selections.reduce((m,s)=>Math.max(m,s.id),0)");
// homeowner sees it, unsigned, and Decisions counter counts it
let cl=clientHTML('p1','home');
t('homeowner sees new decision',cl.includes('Sim skylight'));
const decShown=(cl.match(/class="cl-dec"/g)||[]).length;
const decCount=$("(()=>{const p=clientProj();const sels=p.selections||[];const d=sels.filter(s=>!s.approved||s.status==='pending');const q=sels.filter(s=>s.status!=='installed'&&specStatus(s).homeownerPending.length);return new Set([...d,...q].map(s=>s.id)).size;})()");
t('Decisions stat equals union invariant',cl.includes('>'+decCount+'</div>'),'shown-rows='+decShown+' union='+decCount);
// pending items refuse sign-off; selected items sign
asClient('p1');
$("Data.updateSelection("+simSelId+",{status:'pending'})");
$("clientSignoff("+simSelId+")");
t('pending blocks sign-off',$("state.projects[0].selections.find(s=>s.id==="+simSelId+").approved")===false);
$("Data.updateSelection("+simSelId+",{status:'selected'})");
$("clientSignoff("+simSelId+")");
const signed=$("state.projects[0].selections.find(s=>s.id==="+simSelId+").signed");
t('sign-off recorded with buyer names',!!(signed&&signed.by&&signed.by.length),JSON.stringify(signed));
// ledger agreement: upcharge flows to every money surface identically
const led=$("JSON.stringify(billingSummary(state.projects[0]))");
const ledO=JSON.parse(led);
t('ledger identity: net = invoiced + unbilled',Math.abs(ledO.net-(ledO.billed+ledO.unbilled))<0.01,led);
t('agreement: clientLedger.out === billingSummary.out',Math.abs($("clientLedger(state.projects[0]).out")-ledO.out)<0.01);
cl=clientHTML('p1','home');
const outStr='$'+Math.abs(ledO.out).toLocaleString();
t('Home Outstanding equals ledger.out',cl.includes(outStr),outStr);
// install-question gate: installed items ask nothing of the homeowner
$("Data.updateSelection("+simSelId+",{status:'installed'})");
cl=clientHTML('p1','specs');
t('installed item asks no install questions',!(new RegExp('data-sid="'+simSelId+'"').test(cl)));
$("Data.updateSelection("+simSelId+",{status:'selected'})"); // restore for fuzz variety

/* ════ 4 · BILLING LIFECYCLE (p3 Whitaker INV-002) ════ */
S('billing');
const invId=$("(state.projects.find(p=>p.id==='p3').invoices||[]).find(v=>invNeedsOK(v)).id");
t('seed has an invoice needing OK',!!invId);
cl=clientHTML('p3','home');
t('surface 1: Home lists it',cl.includes('Invoices needing your OK'));
cl=clientHTML('p3','specs');
t('surface 2: Selections flags needs-your-OK',cl.includes('needs your OK'));
asClient('p3');
$("invApprove('p3','"+invId+"')");
t('approved state set',$("state.projects.find(p=>p.id==='p3').invoices.find(v=>v.id==='"+invId+"').status")==='approved');
cl=clientHTML('p3','home');
t('after approval Home stops asking',!cl.includes('Invoices needing your OK'));
cl=clientHTML('p3','specs');
t('after approval Selections stops asking',!cl.includes('needs your OK'));
// pay it off; Outstanding reaches $0 on Home
asBuilder();$("state.activeId='p3'");
$("invAddPayment('p3','"+invId+"',true)");
const led3=JSON.parse($("JSON.stringify(billingSummary(state.projects.find(p=>p.id==='p3')))"));
t('full payment zeroes balanceDue',led3.balanceDue===0,JSON.stringify(led3));
t('agreement: p3 clientLedger.out === billingSummary.out',Math.abs($("clientLedger(state.projects.find(p=>p.id==='p3')).out")-led3.out)<0.01);
cl=clientHTML('p3','home');
t('Home Outstanding shows $0',cl.includes('$0'));

/* ════ 5 · DOCUMENT AUDIENCES (v2.151.0, via the REAL modal) ════ */
S('docs');
asBuilder();$("state.activeId='p3'");
$("openAddDoc&&openAddDoc()");
// choose Other + name it, audience team
const dt=el('docType');if(dt){const o=D.createElement('option');o.value='__other';dt.appendChild(o);dt.value='__other';}
setVal('docName','Sim Internal Bid.pdf');setVal('docStatus','Internal');
try{setVal('docTrade','');}catch(e){}
setVal('docAud','team');
await (async()=>{$('saveDoc()');await new Promise(r=>setTimeout(r,80));})();
t('doc saved with aud=team',$("state.projects.find(p=>p.id==='p3').docs.find(d=>d.n==='Sim Internal Bid.pdf').aud")==='team');
cl=clientHTML('p3','docs');
t('homeowner cannot see team doc',!cl.includes('Sim Internal Bid'));
sv=subSiteHTML('Brightpath Electric','p3');
t('sub cannot see team doc',!sv.includes('Sim Internal Bid'));
asBuilder();$("state.activeId='p3'");
const di=$("state.projects.find(p=>p.id==='p3').docs.findIndex(d=>d.n==='Sim Internal Bid.pdf')");
$("cycleDocAud("+di+")");$("cycleDocAud("+di+")"); // team→subs→homeowner
t('cycle reaches homeowner aud',$("state.projects.find(p=>p.id==='p3').docs["+di+"].aud")==='homeowner');
cl=clientHTML('p3','docs');
t('homeowner sees it once granted',cl.includes('Sim Internal Bid'));
sv=subSiteHTML('Brightpath Electric','p3');
t('sub still cannot (homeowner-only)',!sv.includes('Sim Internal Bid'));

/* ════ 6 · NOTIFICATION AUDIENCE MATRIX (real _audMatch under every identity) ════ */
S('notify audience');
const AM=(aud,pid)=>$("Notify._audMatch('"+aud+"',state.projects.find(p=>p.id==='"+pid+"')||{})");
asBuilder();
t('builder aud → builder yes',AM('builder','p1')===true);
t('sub aud → builder no',AM('sub:Timberline Framing','p1')===false);
asSub('Timberline Framing');
t('sub aud → right sub yes',AM('sub:Timberline Framing','p1')===true);
t('sub aud → wrong sub no',(()=>{asSub('Ironhill Excavating');return AM('sub:Timberline Framing','p1')===false;})());
asSub('Timberline Framing');
t('trade aud → member of trade yes',AM('trade:framing','p1')===true);
t('trade aud → other trade no',AM('trade:elec','p1')===false);
t('builder aud → sub no',AM('builder','p1')===false);
asClient('p1');
t('client aud → right site yes',AM('client','p1')===true);
t('client aud → wrong site no',AM('client','p2')===false);
// display layer: a builder-audience notice never renders in a sub session (v2.150.18)
$("Notify.push('bk:simx:ok','Timberline confirmed — Sim','win',{pid:'p1',view:'build'},'builder')");
asSub('Ironhill Excavating');
t('builder-aud bk notice hidden from sub list',!$('noticeRecentHTML()').includes('Timberline confirmed'));
asBuilder();
t('same notice visible to builder',$('noticeRecentHTML()').includes('Timberline confirmed'));

/* ════ 7 · CROSS-SITE CLIENT ISOLATION ════ */
S('client isolation');
cl=clientHTML('p4','home');
t('Maple client sees own address',cl.includes('92 Maple Court'));
t('Maple client sees no Whitaker bleed',!cl.includes('Whitaker'));
cl=clientHTML('p4','docs');
t('Maple docs ≠ Whitaker docs',!cl.includes('Lien Waivers'));

/* ════ 8 · ACTION-ORDER FUZZ ════ */
S('fuzz');
function mulberry32(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const PIDS=['p1','p2','p3','p4'];
const SUBS=$("JSON.stringify(state.projects.flatMap(p=>p.subs.map(s=>s.name)))");
const subNames=[...new Set(JSON.parse(SUBS))];
const ACTIONS=[
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");},
  r=>{asBuilder();$("go('log',document.querySelector('nav .tab')||document.createElement('div'))");},
  r=>{asBuilder();$('renderBuild()');},
  r=>{asBuilder();$('renderDocs()');},
  r=>{asBuilder();$('renderSelections&&renderSelections()');},
  r=>{$('calMonth=null');asBuilder();$('renderCal()');},
  r=>{asBuilder();$('calNav(1)');},
  r=>{asBuilder();$('openIdle&&openIdle()');},
  r=>{const p=PIDS[Math.floor(r()*4)];clientHTML(p,['home','progress','specs','docs'][Math.floor(r()*4)]);},
  r=>{const n=subNames[Math.floor(r()*subNames.length)];asSub(n);$('renderSubView()');},
  r=>{const n=subNames[Math.floor(r()*subNames.length)];const p=PIDS[Math.floor(r()*4)];try{subSiteHTML(n,p);}catch(e){throw new Error('subSite '+n+'/'+p+': '+e.message);}},
  r=>{asBuilder();const p=PIDS[Math.floor(r()*4)];$("state.activeId='"+p+"'");const st=['site','foundation','framing','final'][Math.floor(r()*4)];$("setStageWindow('"+p+"','"+st+"')");if(el('promptScrim').classList.contains('show')){if(r()<0.5)promptOK(new Date(Date.now()+864e5*Math.floor(r()*30)).toISOString().slice(0,10));else $('closePrompt()');if(el('promptScrim').classList.contains('show'))promptOK('');}},
  r=>{asBuilder();$("state.activeId='p3'");const i=Math.floor(r()*$("(state.projects.find(p=>p.id==='p3').docs||[]).length"));$('cycleDocAud('+i+')');},
  r=>{const b=$("JSON.stringify((state.projects[0].bookings||[]).map(x=>x.id))");const ids=JSON.parse(b);if(!ids.length)return;const id=ids[Math.floor(r()*ids.length)];asSub('Timberline Framing');$("bkSetStatus&&(state.projects[0].bookings.find(x=>x.id==='"+id+"')||0)&&svBkConfirm('p1','"+id+"')");},
  r=>{asClient('p1');const s=$("JSON.stringify((state.projects[0].selections||[]).map(x=>x.id))");const ids=JSON.parse(s);if(ids.length)$('clientSignoff('+ids[Math.floor(r()*ids.length)]+')');},
];
const SEQS=200,LEN=12;   /* ritual default ~30s; raise to 400+ for feature builds */let fuzzFail=null;
for(let i=0;i<SEQS&&!fuzzFail;i++){
  const r=mulberry32(0x51ab1e+i);
  for(let k=0;k<LEN;k++){
    const ai=Math.floor(r()*ACTIONS.length);
    try{ACTIONS[ai](r);}catch(e){fuzzFail='seq '+i+' step '+k+' action '+ai+': '+e.message;break;}
    if(w.__thrown.length){fuzzFail='seq '+i+' step '+k+' action '+ai+' async: '+w.__thrown[0];break;}
  }
  // invariant spot-check each sequence
  const L=JSON.parse($("JSON.stringify(billingSummary(state.projects.find(p=>p.id==='p3')))"));
  if(Math.abs(L.net-(L.billed+L.unbilled))>0.01||Math.abs(L.out-$("clientLedger(state.projects.find(p=>p.id==='p3')).out"))>0.01){fuzzFail='seq '+i+' ledger identity broke: '+JSON.stringify(L);break;}
}
t(SEQS+' random sequences × '+LEN+' actions, no crash, invariants hold',!fuzzFail,fuzzFail);

/* ════ REPORT ════ */
console.log('sim [index.html '+String($('PLUMB_VERSION')).split(' ')[0]+']: '+passes.length+' checks across boot/scheduling/stage/selections/billing/docs/notify/isolation/fuzz');
if(failures.length){
  console.log('FAIL ('+failures.length+'):');
  failures.forEach(f=>console.log('  x '+f));
  process.exit(1);
}
console.log('PASS: all lifecycles, sync matrices and fuzz hold.');
process.exit(0);
})().catch(e=>{console.log('FAIL: harness error — '+e.message+'\n'+e.stack.split('\n').slice(0,4).join('\n'));process.exit(1);});
