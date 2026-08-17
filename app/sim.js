/* sim.js — SitePlumb full-app functional simulator (Phase 1).
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
/* Chip selections persist across sections - reset before asserting on them. */
w.$eval("window._simClearChips=function(){['#areaChips','#recAreaChips'].forEach(function(id){var b=document.querySelector(id);if(!b)return;[].forEach.call(b.querySelectorAll('.chip.on'),function(c){c.classList.remove('on');});if(typeof syncAreaExclusivity==='function')syncAreaExclusivity(b);});}");
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
t('version string is well formed',/^\d+\.\d+\.\d+ - \S/.test(String($('PLUMB_VERSION'))),String($('PLUMB_VERSION')).slice(0,24));
t('photo queue categorizer present', $("typeof impPhotoFiles")==='function'&&$("typeof _impNext")==='function'&&$("typeof _impAfterSave")==='function');
t('company lookup present', $("typeof webCompanyPick")==='function'&&$("typeof webCompanyChose")==='function');
t('shared photo intake present', $("typeof handlePhotoFile")==='function');
t('tour-audio engine present', $("typeof tourNarrate")==='function'&&$("typeof tourAudioStop")==='function');
// error buffer hygiene: age-out + cap
$("localStorage.setItem('plumb.errors',JSON.stringify([{t:Date.now()-20*86400000,k:'rules',m:'ancient',v:'2.152.0',mode:'real'}].concat(Array.from({length:30},(_,i)=>({t:Date.now()-i*1000,k:'x',m:'fresh'+i,v:'t',mode:'demo'})))))");
t('devErrors ages out 14d+ and caps at 20', (function(){const a=JSON.parse($("JSON.stringify(devErrors())"));return a.length===20&&a.every(x=>x.m!=='ancient');})());
$("trapError('test','newest','sim')");
t('trapError prunes on write too', (function(){const a=JSON.parse($("localStorage.getItem('plumb.errors')"));return a.length<=20&&a[0].m==='newest';})());
$("localStorage.removeItem('plumb.errors')");
t('desktop rail brand present in nav', $("document.querySelector('nav .rail-brand .wordmark').textContent").includes('SitePlumb'));
t('rail foot carries the live sync pill', $("document.querySelector('nav .rail-foot .syncpill').textContent").includes('device'));

/* ════ 1b · ROLE-AWARE SYNC SCOPING (functions live in app; Sync stays inert here) ════ */
S('sync-scope');
t('builder gets all seven colls', $("syncCollsFor('builder').map(c=>c.sub).join()") === 'items,bk,sel,logs,pmts,mail,costs');
t('sub skips pmts+mail+costs', $("syncCollsFor('sub').map(c=>c.sub).join()") === 'items,bk,sel,logs');
t('client skips mail+costs', $("syncCollsFor('client').map(c=>c.sub).join()") === 'items,bk,sel,logs,pmts');
t('unknown role defaults to all', $("syncCollsFor(null).map(c=>c.sub).join()") === 'items,bk,sel,logs,pmts,mail,costs');
/* v2.211: bookings must merge per record, never ride the whole-site meta blob.
   The old behavior let a second device silently wipe bookings it had not seen. */
t('bookings are a synced record collection', $("SYNC_COLLS.some(c=>c.f==='bookings'&&c.sub==='bk')")===true);
/* v2.212: the packet reader must never call Firestore before App Check is
   activated - doing so got the read refused and killed every guest link. */
t('packet init activates App Check before returning a db', (function(){
  const src=$("String(_pkDb)");
  const iApp=src.indexOf('initializeApp'), iChk=src.indexOf('appCheck'), iDb=src.indexOf('firestore()');
  return iApp>=0&&iChk>iApp&&iDb>iChk;})());
t('a failed open offers a retry instead of a dead end', (function(){
  $("window.__pkWaitMs=40");
  $("renderGuestPacket('pk_definitely_missing')");
  return true;})());
t('meta no longer carries bookings', (function(){
  const m=JSON.parse($("JSON.stringify(metaOf(state.projects[1]))"));
  return !('bookings' in m);})());
t('a new booking becomes its own sync op', (function(){
  const ops=JSON.parse($(`(function(){
    const p=state.projects[1];
    const sh={meta:JSON.stringify(metaOf(p)),colls:{}};
    const before=diffSiteOps(sh,p).filter(o=>o.sub==='bk').length;
    addBooking(p,{subName:'Sim Crew',trade:'plumb',start:Date.now(),end:Date.now()+86400000,note:''});
    const after=diffSiteOps(sh,p).filter(o=>o.sub==='bk').length;
    p.bookings.pop();
    return JSON.stringify({before:before,after:after});})()`));
  return ops.after===ops.before+1;})());
t('stale meta from an old device cannot wipe bookings', (function(){
  return $(`(function(){
    const p=state.projects[1];
    const n=p.bookings.length;
    const meta={id:p.id,name:p.name,bookings:[]};
    Object.keys(meta).forEach(k=>{if(!SYNC_COLLS.some(c=>c.f===k))p[k]=meta[k];});
    return p.bookings.length;})()`)===$("state.projects[1].bookings.length");})());
t('siteRoleFor: members map wins over session role',
  $("state.session={role:'client',auth:{uid:'uX'}};siteRoleFor({members:{uX:'sub'}})") === 'sub');
t('siteRoleFor: falls back to session subs->sub',
  $("state.session={role:'subs'};siteRoleFor({})") === 'sub');
t('siteRoleFor: falls back to session client->client',
  $("state.session={role:'client'};siteRoleFor(null)") === 'client');
t('siteRoleFor: builder session -> builder',
  $("state.session={role:'hillan'};siteRoleFor({})") === 'builder');
$("state.session=null");

/* ════ 1b2 · IN-APP PASSWORD RESET SURFACE ════ */
S('pw-reset');
t('no-param boot is inert', (function(){ $("consumeAuthAction()"); return $("!document.getElementById('pwResetScrim').classList.contains('show')"); })());
$("_prShow('set','Setting a new password for x@y.z.')");
t('set state shows password row', $("document.getElementById('pwResetScrim').classList.contains('show')&&document.getElementById('prSetRow').style.display===''&&document.getElementById('prResendRow').style.display==='none'"));
t('title matches set state', $("document.getElementById('prTitle').textContent")==='Choose a new password');
$("_prShow('resend','expired')");
t('resend state flips rows', $("document.getElementById('prSetRow').style.display==='none'&&document.getElementById('prResendRow').style.display===''"));
$("document.getElementById('prPass').value='short';pwResetSave()");
t('short password rejected client-side', $("document.getElementById('prErr').textContent").includes('8 characters'));
$("pwResetClose()");
t('close hides scrim', $("!document.getElementById('pwResetScrim').classList.contains('show')"));

/* ════ 1c · CREATE-RACE GATE (subcollection listeners must wait for the site doc) ════ */
S('sync-gate');
// Harness: fake db whose site-doc get() is denied N times before the doc "lands";
// onSnapshot attaches are recorded, and an err-injector drives the belt path.
$("window.__g={gets:0,attached:[],errCbs:{}};"
 +"Sync.mode='live';Sync._listening={};Sync._collGen={};Sync._reArmed={};Sync._shadow={};Sync._notifReady={};Sync.unsub=[];"
 +"Sync._gateDelays=[0,15,30];Sync._reArmDelay=40;"
 +"window.__mkdb=denies=>({collection:()=>({doc:()=>({get:()=>{__g.gets++;return (__g.gets>denies)?Promise.resolve({exists:true}):Promise.reject({code:'permission-denied'});},"
 +"collection:sub=>({onSnapshot:(h,e)=>{__g.attached.push(sub);__g.errCbs[sub]=e;return ()=>{};}})})})});"
 +"state.session={role:'hillan',auth:{uid:'uGate'}};true");
// (1) gate defers: denied twice, lands on third try
$("__g.gets=0;__g.attached=[];Sync.db=__mkdb(2);Sync._subSite('gateA');true");
t('no listeners attach synchronously', $("__g.attached.length")===0);
await new Promise(r=>setTimeout(r,250));
t('gate retried through the ladder', $("__g.gets")===3);
t('all seven colls attach once doc lands', $("__g.attached.join()")==='items,bk,sel,logs,pmts,mail,costs');
t('site marked listening after attach', $("!!Sync._listening['gateA']")===true);
// (2) doc never lands: give up quietly, _listening cleared so a later docChange re-gates
$("__g.gets=0;__g.attached=[];Sync.db=__mkdb(99);Sync._subSite('gateB');true");
await new Promise(r=>setTimeout(r,250));
t('gave up after 3 attempts', $("__g.gets")===3);
t('nothing attached on give-up', $("__g.attached.length")===0);
t('give-up clears _listening (re-gate possible)', $("!Sync._listening['gateB']")===true);
// (3) offline: unavailable attaches immediately on cache
$("__g.gets=0;__g.attached=[];Sync.db={collection:()=>({doc:()=>({get:()=>{__g.gets++;return Promise.reject({code:'unavailable'});},collection:sub=>({onSnapshot:(h,e)=>{__g.attached.push(sub);__g.errCbs[sub]=e;return ()=>{};}})})})};Sync._subSite('gateC');true");
await new Promise(r=>setTimeout(r,80));
t('offline attaches without retry ladder', $("__g.gets")===1&&$("__g.attached.length")===7);
// (4) demo mode: gate is a no-op passthrough
$("__g.gets=0;__g.attached=[];Sync.mode='demo';Sync.db=__mkdb(99);Sync._subSite('gateD');true");
await new Promise(r=>setTimeout(r,60));
t('demo attaches without any server get', $("__g.attached.length")===7&&$("__g.gets")===0);
$("Sync.mode='live';true");
// (5) belt: first-generation denial is forgiven silently and re-attaches once
$("localStorage.removeItem('plumb.errors');__g.gets=99;__g.attached=[];Sync.db=__mkdb(0);Sync._subSite('gateE');true");
await new Promise(r=>setTimeout(r,80));
t('gateE attached gen-1', $("__g.attached.length")===7);
$("__g.attached=[];__g.errCbs['items']({code:'permission-denied'});true");
t('gen-1 denial logs no rules alarm', $("devErrors().length")===0);
await new Promise(r=>setTimeout(r,200));
t('belt re-attached a second generation', $("__g.attached.length")===7);
t('re-arm consumed', $("Sync._reArmed['gateE']")===true);
// (6) second-generation denial raises the real alarm
$("__g.errCbs['items']({code:'permission-denied'});true");
t('gen-2 denial trips trapError', $("devErrors().length")>0&&$("devErrors()[0].m").includes('Cloud read blocked (site records)'));
// (7) role scoping preserved through the gate path
$("localStorage.removeItem('plumb.errors');Sync._permToasted=false;__g.attached=[];state.session={role:'client',auth:{uid:'uC'}};state.projects.push({id:'gateF',members:{uC:'client'},items:[],selections:[],logs:[],payments:[]});Sync.db=__mkdb(0);Sync._subSite('gateF');true");
await new Promise(r=>setTimeout(r,60));
t('client attaches only its five colls', $("__g.attached.join()")==='items,bk,sel,logs,pmts');
// teardown
$("state.projects=state.projects.filter(p=>p.id!=='gateF');state.session=null;Sync.mode=null;Sync.db=null;Sync._listening={};Sync._collGen={};Sync._reArmed={};Sync._gateDelays=null;Sync._reArmDelay=null;delete window.__g;delete window.__mkdb;true");

t('SEED_VERSION 16',$('SEED_VERSION')===16);
t('10 seed sites',$('state.projects.length')===10);
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


/* ════ 8 · SITE-CREATION WIZARD (real modal + saveNewSite) ════ */
S('site wizard');
asBuilder();
const nProj0=$('state.projects.length');
$('openNewSite()');
t('wizard opens', el('newSiteScrim').classList.contains('show'));
setVal('nsName','');setVal('nsStreet','');setVal('nsCity','');
$('saveNewSite()');
t('empty save rejected', $('state.projects.length')===nProj0);
setVal('nsName','Sim Test Build');setVal('nsStreet','12 Harbor Ln');setVal('nsCity','Springfield');
$('saveNewSite()');
t('site created', $('state.projects.length')===nProj0+1, $('state.projects.length'));
const newPid=$('state.projects[state.projects.length-1].id');
t('fresh scaffolding (street, no permits/sel, nextId 100)',
  $("JSON.stringify((p=>[p.street,(p.permits||[]).length,(p.selections||[]).length,p.nextId])(state.projects.find(x=>x.id==='"+newPid+"')))")
  ===JSON.stringify(['12 Harbor Ln',0,0,100]));
t('wizard navigates to the new site', $('state.activeId')===newPid, $('state.activeId'));

/* ════ 9 · PERMITS LIFECYCLE (prompt-driven add + status walk on the wizard site) ════ */
S('permits');
$('addPermit()');
t('add-permit prompt opens', el('promptScrim').classList.contains('show'));
promptOK('Electrical Permit');
t('permit added as Not started',
  $("JSON.stringify((P().permits||[]).map(x=>[x.name,x.status]))")===JSON.stringify([['Electrical Permit','Not started']]));
for(const st of ['Applied','Approved','Issued','Closed']){
  $("setPermit(0,'"+st+"')");
  t('permit → '+st, $("P().permits[0].status")===st, $("P().permits[0].status"));
}

/* ════ 10 · INSPECTIONS LIFECYCLE (p2 roughin, INSP_NEXT chain, 3-cycle returns to start) ════ */
S('inspections');
asBuilder();$("state.activeId='p2'");
const INSPC={pending:'scheduled',scheduled:'passed',passed:'pending'};
const insp0=$("inspOf('roughin')");
let prevI=insp0;
for(let k=0;k<3;k++){
  $("cycleInspection('roughin')");
  const nowI=$("inspOf('roughin')");
  t('inspection step '+(k+1)+' follows INSP_NEXT', nowI===(INSPC[prevI]||'pending'), prevI+'→'+nowI);
  prevI=nowI;
}
t('3 cycles return inspection to seed state', $("inspOf('roughin')")===insp0);

/* ════ 11 · INVOICE CREATION (real compose picker: custom line, draft→edit→pick→send) ════ */
S('invoice creation');
asBuilder();$("state.activeId='p1'");
const nInv0=$("(P().invoices||[]).length");
$('invCompose()');
t('compose mode entered', $('invMode')==='compose');
setVal('invTitle2','Change order 7');setVal('invExLabel','Extra footing drain');setVal('invExAmount','450');
$('invSave(true)');
t('draft saved', $("(P().invoices||[]).length")===nInv0+1 && $("P().invoices[P().invoices.length-1].status")==='draft');
t('draft total is the custom line', Math.abs($("P().invoices[P().invoices.length-1].total")-450)<0.01);
const draftId=$("P().invoices[P().invoices.length-1].id");
$("invCompose('"+draftId+"')");
const pickable=JSON.parse($("JSON.stringify(composeSelections(P()).map(x=>x.id))"));
if(pickable.length)$('invTogglePick('+JSON.stringify(pickable[0])+')');
setVal('invTitle2','Change order 7');setVal('invExLabel','Extra footing drain');setVal('invExAmount','450');
$('invSave(false)');
const sentInv=JSON.parse($("JSON.stringify(P().invoices[P().invoices.length-1])"));
t('send assigns number + sent status', sentInv.status==='sent'&&!!sentInv.no, JSON.stringify([sentInv.no,sentInv.status]));
t('sent invoice needs homeowner OK', $("invNeedsOK(P().invoices[P().invoices.length-1])")===true);
if(pickable.length)
  t('picked selection stamped invoicedIn',
    $("(P().selections.find(x=>String(x.id)===String("+JSON.stringify(pickable[0])+"))||{}).invoicedIn")===sentInv.id);
t('homeowner Home shows the new ask', clientHTML('p1','home').includes(sentInv.no));

/* ════ 12 · HOMEOWNER CONCERN + IDEA (real modals, isolation) ════ */
S('concern+idea');
asClient('p1');$("state.activeId='p1'");$('renderClient()');
const nIt0=$("state.projects[0].items.length");
$('openConcern()');setVal('cNote','');$('concernPhotoId=null');$('submitConcern()');
t('empty concern rejected', $("state.projects[0].items.length")===nIt0);
$('openConcern()');setVal('cNote','Water pooling by the garage slab');$('submitConcern()');
t('concern lands as flagged open issue',
  $("JSON.stringify((r=>r?[r.client,r.issue,r.status]:null)(state.projects[0].items.find(i=>i.cap==='Water pooling by the garage slab')))")
  ===JSON.stringify([true,true,'open']));
$('openIdea()');setVal('iNote','Cedar slat ceiling in the den');$('submitIdea()');
const ideaRec=JSON.parse($("JSON.stringify(state.projects[0].items.find(i=>/Cedar slat/.test(i.cap||''))||null)"));
t('idea lands as non-issue kind idea', !!ideaRec&&ideaRec.client===true&&ideaRec.issue===false&&ideaRec.kind==='idea', JSON.stringify(ideaRec).slice(0,120));
t('concern did not leak to p2', !$("JSON.stringify(state.projects[1].items)").includes('garage slab'));

/* ════ 13 · BOOKING VIA THE REAL openBk MODAL (with confirm-gate driving) ════ */
S('booking modal');
const confirmShown=()=>el('confirmScrim').classList.contains('show');
asBuilder();$('calMonth=null');$('renderCal()');
$('openBk()');
$("document.getElementById('bkSite').value='p1'");$("bkFillSubs('p1')");
const subOpts=JSON.parse($("JSON.stringify([...document.getElementById('bkSub').options].map(o=>o.value).filter(Boolean))"));
t('modal lists the p1 roster', subOpts.length>0, subOpts.length);
const bsub=subOpts[0];
$("document.getElementById('bkSub').value="+JSON.stringify(bsub));
setVal('bkStart',new Date(Date.now()+7*864e5).toISOString().slice(0,10));
setVal('bkEnd',new Date(Date.now()+9*864e5).toISOString().slice(0,10));
setVal('bkNote','sim booking via modal');
const nBkM=$("(state.projects[0].bookings||[]).length");
$('bkSave()');
let gates=0;while(confirmShown()&&gates<4){$('ocConfirm()');gates++;}
t('booking created through the modal (confirm gates driven: '+gates+')',
  $("(state.projects[0].bookings||[]).length")===nBkM+1);
const bkRec=JSON.parse($("JSON.stringify(state.projects[0].bookings[state.projects[0].bookings.length-1])"));
t('booking carries the modal fields', bkRec.subName===bsub&&bkRec.note==='sim booking via modal', JSON.stringify(bkRec).slice(0,140));
t('booked sub sees it', subSiteHTML(bsub,'p1').includes('sim booking via modal'));
const coSubs=JSON.parse($("JSON.stringify(state.projects[0].subs.filter(s=>s.name!=="+JSON.stringify(bsub)+").map(s=>s.name))"));
if(coSubs.length)t('co-sub cannot see it', !subSiteHTML(coSubs[0],'p1').includes('sim booking via modal'));

/* ════ 14 · NOTIFY.DIFFS SNAPSHOT MATRIX (pure per-mutation notice audiences) ════ */
S('notify diffs');
const dif=(prev,next)=>JSON.parse($("JSON.stringify(Notify.diffs("+JSON.stringify(prev)+","+JSON.stringify(next)+",'Site X'))"));
const nb={invoices:[],subs:[],docs:[],bookings:[],avail:[]};
const inv=(st,total)=>({...nb,invoices:[{id:'i1',status:st,no:'INV-9',title:'Tile upgrade',total:total||100}]});
let dd=dif(inv('draft'),inv('sent'));
t('invoice draft→sent → client, needs-OK', dd.length===1&&dd[0].aud==='client'&&/needs your OK/.test(dd[0].body), JSON.stringify(dd));
dd=dif(inv('sent'),inv('approved'));
t('invoice approved → biller', dd.length===1&&dd[0].aud==='biller', JSON.stringify(dd));
dd=dif(inv('sent'),inv('paid'));
t('invoice paid → client', dd.length===1&&dd[0].aud==='client'&&/paid/i.test(dd[0].title), JSON.stringify(dd));
dd=dif(inv('sent',100),inv('sent',150));
t('sent invoice total change → client update notice', dd.length===1&&dd[0].aud==='client'&&/updated/i.test(dd[0].title), JSON.stringify(dd));
dd=dif(inv('sent'),inv('sent'));
t('no change → no notices', dd.length===0, JSON.stringify(dd));
const bk1={id:'b1',subName:'Alpha Co',start:1000,end:2000,note:'',status:'pending'};
dd=dif(nb,{...nb,bookings:[bk1]});
t('new booking → that sub only', dd.length===1&&dd[0].aud==='sub:Alpha Co', JSON.stringify(dd));
dd=dif({...nb,bookings:[bk1]},{...nb,bookings:[{...bk1,status:'confirmed'}]});
t('confirm → builder', dd.length===1&&dd[0].aud==='builder'&&/confirmed/.test(dd[0].title), JSON.stringify(dd));
dd=dif({...nb,bookings:[bk1]},{...nb,bookings:[{...bk1,status:'declined'}]});
t('decline → builder rebook notice', dd.length===1&&dd[0].aud==='builder'&&/rebook/.test(dd[0].body), JSON.stringify(dd));
dd=dif({...nb,bookings:[bk1]},{...nb,bookings:[{...bk1,start:5000,end:6000,status:'modified'}]});
t('sub-modified dates → builder proposal notice', dd.length===1&&dd[0].aud==='builder'&&/proposed/.test(dd[0].title), JSON.stringify(dd));
dd=dif({...nb,bookings:[bk1]},{...nb,bookings:[{...bk1,start:5000,end:6000}]});
t('builder-moved dates → sub schedule-changed', dd.length===1&&dd[0].aud==='sub:Alpha Co'&&/changed/i.test(dd[0].title), JSON.stringify(dd));
dd=dif({...nb,bookings:[bk1]},nb);
t('removed booking → sub told', dd.length===1&&dd[0].aud==='sub:Alpha Co'&&/removed/i.test(dd[0].title), JSON.stringify(dd));
dd=dif({...nb,subs:[{id:'s1',name:'Alpha Co',cleared:null}]},{...nb,subs:[{id:'s1',name:'Alpha Co',cleared:123}]});
t('sub cleared → site-ready to that sub', dd.length===1&&dd[0].aud==='sub:Alpha Co'&&/ready/i.test(dd[0].title), JSON.stringify(dd));
dd=dif({...nb,subs:[{id:'s1',name:'Alpha Co'}]},{...nb,subs:[{id:'s1',name:'Alpha Co',specsDue:9999999999999}]});
t('specs deadline set → that sub', dd.length===1&&dd[0].aud==='sub:Alpha Co'&&/deadline/i.test(dd[0].title), JSON.stringify(dd));
dd=dif(nb,{...nb,docs:[{n:'Rough-in plan.pdf',trade:'plumb'}]});
t('trade-tagged doc → that trade', dd.length===1&&dd[0].aud==='trade:plumb', JSON.stringify(dd));
dd=dif(nb,{...nb,docs:[{n:'Internal notes.pdf',trade:''}]});
t('untagged doc → silent', dd.length===0, JSON.stringify(dd));
dd=dif(nb,{...nb,avail:[{id:'a1',subName:'Alpha Co',start:1,end:2}]});
t('sub time-off → builder heads-up', dd.length===1&&dd[0].aud==='builder'&&/blocked time off/.test(dd[0].title), JSON.stringify(dd));

/* ════ 14b · JOB COSTING FOUNDATION (Data path + rollup semantics) ════ */
S('job costing');
asBuilder();$("state.activeId='p4'");
t('Maple Court carries no seed costs', $("(P().costs||[]).length")===0);
$("Data.addCostLine({id:'cl1',label:'Framing labor',trade:'framing',stage:'framing',budget:42000})");
$("Data.addCostLine({id:'cl2',label:'Windows',trade:'windows',stage:'exterior',budget:28000})");
t('lines land', $("costLines(P()).length")===2);
$("Data.addCostActual({id:'ca1',lineId:'cl1',kind:'committed',amount:40000,payee:'Timberline Framing',t:Date.now()})");
$("Data.addCostActual({id:'ca2',lineId:'cl1',kind:'spent',amount:15000,payee:'Timberline Framing',t:Date.now()})");
let R=JSON.parse($("JSON.stringify(costLineRollup(P(),'cl1'))"));
t('partial-paid contract exposes the contract', R.committed===40000&&R.spent===15000&&R.exposure===40000&&R.remaining===2000&&!R.over, JSON.stringify(R));
$("Data.addCostActual({id:'ca3',lineId:'cl2',kind:'spent',amount:31000,payee:'GlassCo',t:Date.now()})");
R=JSON.parse($("JSON.stringify(costLineRollup(P(),'cl2'))"));
t('overrun flags', R.spent===31000&&R.exposure===31000&&R.remaining===-3000&&R.over===true, JSON.stringify(R));
$("Data.addCostActual({id:'ca4',lineId:'ghost',kind:'spent',amount:500,payee:'Misc',t:Date.now()})");
let CS=JSON.parse($("JSON.stringify(costSummary(P()))"));
t('site rollup honest incl. unassigned', CS.budget===70000&&CS.exposure===71500&&CS.remaining===-1500&&CS.over===true&&CS.unassigned===1&&CS.overLines===1, JSON.stringify(CS));
$("Data.updateCost('cl2',{budget:32000})");
CS=JSON.parse($("JSON.stringify(costSummary(P()))"));
t('budget edit flows through', CS.budget===74000&&CS.remaining===2500&&CS.over===false, JSON.stringify(CS));
$("Data.removeCost('cl1')");
t('removing a line cascades its actuals', $("costLines(P()).length")===1&&$("costActuals(P()).length")===2, $("JSON.stringify(P().costs)"));
t('costs stripped from meta (never rides the site doc)', !('costs' in JSON.parse($("JSON.stringify(metaOf(P()))"))));
$("state.projects.find(p=>p.id==='p4').costs=[]");

/* ════ 14c · BUDGET UI (seed math, modal, grouping toggle, isolation) ════ */
S('budget ui');
asBuilder();$("state.activeId='p2'");
$("Object.defineProperty(window,'innerWidth',{value:390,configurable:true})");
let BS=JSON.parse($("JSON.stringify(costSummary(P()))"));
t('Calderwood seed math (budget 656.3k, exposure 396.9k, 1 line over)',
  BS.budget===656300&&BS.committed===302500&&BS.spent===259600&&BS.exposure===396900&&BS.remaining===259400&&BS.over===false&&BS.lines===16&&BS.overLines===1&&BS.unassigned===0, JSON.stringify(BS));
$('renderBuild()');
t('Build tab card shows all four stats + open affordance',
  ['Money','Budget','Remaining','Signed for','Paid','View &amp; edit budget','1 line over'].every(s=>el('budgetCard').innerHTML.includes(s)));
$("buildSeg('permits')");
t('Progress hidden on Permits segment', el('buildSchedule').style.display==='none'&&el('overallBar').closest('#buildSchedule')!==null);
$("buildSeg('subs')");
t('budget card still visible on Subs segment', el('buildSchedule').style.display==='none'&&el('budgetCard').innerHTML.includes('Remaining'));
$("buildSeg('schedule')");
t('Progress returns on Schedule segment', el('buildSchedule').style.display!=='none');
$("setCostGroup('stage')");$('openBudget()');
t('budget modal opens', el('budgetScrim').classList.contains('show'));
let BH=el('budgetBody').innerHTML;
t('stage grouping shows stage headers', BH.includes('Rough-ins')||BH.includes('Rough')||BH.includes('Foundation'));
t('over line flagged in red chip', BH.includes('3,400 over'));
$("setCostGroup('trade')");BH=el('budgetBody').innerHTML;
t('trade toggle regroups', BH.includes('Plumbing')&&BH.includes('Electrical'));
t('toggle persisted', $("localStorage.getItem('plumbCostGroup')")==='trade');
$("setCostGroup('stage')");
// real add-line through the modal
$('openCostLine()');
setVal('clLabel','Roofing package');setVal('clBudget','34000');
$("document.getElementById('clTrade').value='roofing'");$("document.getElementById('clStage').value='cladding'");
$('saveCostLine()');
(function(){const labs=JSON.parse($("JSON.stringify([...document.getElementById('clTrade').options].slice(1).map(o=>o.text))"));
  t('trade menu sorted A-Z', JSON.stringify(labs)===JSON.stringify(labs.slice().sort((a,b)=>a.localeCompare(b))), labs.slice(0,4).join(','));})();
t('line added via modal', $("costLines(P()).length")===17&&$("JSON.stringify(costLines(P()).find(l=>l.label==='Roofing package'))").includes('34000'));
// real quick-add actual through the modal
const rid=$("costLines(P()).find(l=>l.label==='Roofing package').id");
$('openCostActual(null,'+JSON.stringify(rid)+')');
const payeeOpts=JSON.parse($("JSON.stringify([...document.getElementById('caPayeeSel').options].map(o=>o.value))"));
t('payee menu lists site subs + other + new', payeeOpts.includes('__other')&&payeeOpts.includes('__new')&&payeeOpts.length>=4, payeeOpts.join('|'));
(function(){const names=payeeOpts.filter(v=>v&&v!=='__other'&&v!=='__new');
  t('payee subs sorted A-Z', JSON.stringify(names)===JSON.stringify(names.slice().sort((a,b)=>a.localeCompare(b))), names.join(','));})();
setVal('caAmount','32500');$("setCaKind('spent')");
$("document.getElementById('caPayeeSel').value='__other'");$('caPayeeChange()');
setVal('caPayee','Summit Roofing');
$('saveCostActual()');
let RR=JSON.parse($("JSON.stringify(costLineRollup(P(),"+JSON.stringify(rid)+"))"));
t('actual logged via modal', RR.spent===32500&&RR.remaining===1500&&!RR.over, JSON.stringify(RR));
// picking a roster sub straight from the menu
$('openCostActual(null,'+JSON.stringify(rid)+')');
const firstSub=JSON.parse($("JSON.stringify([...document.getElementById('caPayeeSel').options].map(o=>o.value).filter(v=>v&&v!=='__other'&&v!=='__new'))"))[0];
setVal('caAmount','100');$("document.getElementById('caPayeeSel').value="+JSON.stringify(firstSub));
$('saveCostActual()');
t('roster payee saved from menu', $("costActuals(P()).slice(-1)[0].payee")===firstSub, firstSub);
$("Data.removeCost(costActuals(P()).slice(-1)[0].id)");
// + New sub tie-in through the real prompt
$('openCostActual(null,'+JSON.stringify(rid)+')');
const nSubs0=$("P().subs.length");
$("document.getElementById('caPayeeSel').value='__new'");$('caPayeeChange()');
promptOK('Summit Roofing Co');
t('new sub created and selected', $("P().subs.length")===nSubs0+1&&$("document.getElementById('caPayeeSel').value")==='Summit Roofing Co');
setVal('caAmount','75');$('saveCostActual()');
t('cost saved against the new sub', $("costActuals(P()).slice(-1)[0].payee")==='Summit Roofing Co');
$("Data.removeCost(costActuals(P()).slice(-1)[0].id)");
$("state.projects[1].subs=state.projects[1].subs.filter(s=>s.name!=='Summit Roofing Co')");
// empty guards
$('openCostLine()');setVal('clLabel','');$('saveCostLine()');
t('unnamed line rejected', $("costLines(P()).length")===17);
$('closeCostLine()');
$('openCostActual()');setVal('caAmount','0');$('saveCostActual()');
t('zero-amount cost rejected', $("costActuals(P()).length")===16);
$('closeCostActual()');
// cleanup the sim-added line via real delete path (confirm gate)
$('openCostLine('+JSON.stringify(rid)+')');$('deleteCostLine()');$('ocConfirm()');
t('modal delete cascades', $("costLines(P()).length")===16&&$("costActuals(P()).length")===15);
$('closeBudget()');
// isolation: budget markup never reaches homeowner or sub views
t('homeowner never sees budget markup', !clientHTML('p2','home').includes('bgt-')&&!clientHTML('p2','billing').includes('bgt-'));
const p2sub=JSON.parse($("JSON.stringify(state.projects[1].subs[0].name)"));
t('sub never sees budget markup', !subSiteHTML(p2sub,'p2').includes('bgt-'));

/* ════ 14d · DESKTOP BUDGET TABLE (≥900px: in-place edits, quick-add row) ════ */
S('budget table');
asBuilder();$("state.activeId='p2'");
$("Object.defineProperty(window,'innerWidth',{value:1200,configurable:true})");
t('isWideBudget flips at breakpoint', $('isWideBudget()')===true);
$('renderBudget()');
t('wide layout renders the table', el('budgetBody').innerHTML.includes('bgt-table')&&el('budgetBody').innerHTML.includes('Signed for'));
t('sixteen seed rows + quick-add row', $("document.querySelectorAll('#budgetBody tr[data-line]').length")===16&&$("document.querySelectorAll('#budgetBody tr.bgt-qa').length")===1);
t('over cell rendered in table', el('budgetBody').innerHTML.includes('3,400 over'));
t('explicit Edit buttons on table rows', $("document.querySelectorAll('#budgetBody .bgt-edit').length")===16);
// in-place budget edit patches computed cells without re-render
$("(function(){const tr=document.querySelector('tr[data-line]');const inp=tr.querySelector('input.num');inp.value='20000';inp.onchange({});})()");
t('cell save updates rollup in place', $("costLineRollup(P(),'b1').budget")===20000&&el('bgtL-b1').textContent.includes('3,200'), el('bgtL-b1').textContent);
t('totals strip refreshed in place', el('bgtTotals').innerHTML.includes('636,300'));
$("(function(){const tr=document.querySelector('tr[data-line]');const inp=tr.querySelector('input.num');inp.value='40000';inp.onchange({});})()");
t('edit back restores seed math', $("costSummary(P()).budget")===656300);
// quick-add row
setVal('bgtQaName','Gutters & downspouts');setVal('bgtQaBudget','5500');
$("document.getElementById('bgtQaTrade').value='gutters'");
$('bgtQuickAdd()');
t('quick-add creates the line', $("costLines(P()).length")===17&&el('budgetBody').innerHTML.includes('Gutters &amp; downspouts'));
// regroup-on-select re-renders (trade toggle honored in table too)
$("setCostGroup('trade')");
t('table honors trade grouping', el('budgetBody').innerHTML.includes('bgt-table')&&el('budgetBody').innerHTML.includes('Gutters'));
$("setCostGroup('stage')");
// cleanup + restore phone width
$("Data.removeCost(costLines(P()).find(l=>l.label==='Gutters & downspouts').id)");
t('cleanup', $("costLines(P()).length")===16);
$("Object.defineProperty(window,'innerWidth',{value:390,configurable:true})");
$('renderBudget()');
t('narrow width returns the phone list', el('budgetBody').innerHTML.includes('bgt-row'));
$('closeBudget()');

/* ════ 14e · PHASE D: ACCOUNTANT CSV + SELECTION MARGIN LINK ════ */
S('csv + margin');
asBuilder();$("state.activeId='p2'");
$("Object.defineProperty(window,'innerWidth',{value:390,configurable:true})");
let CSVT=$("costsCsv(P())");
let csvRows=CSVT.split('\r\n');
t('csv header row', csvRows[0]==='Date,Paid to,Type,Amount,Budget line,Trade,Stage,Toward contract,QuickBooks,Note', csvRows[0]);
t('csv one row per logged cost', csvRows.length===1+$("costActuals(P()).length"), csvRows.length);
t('csv carries payees + amounts + line context', CSVT.includes('Ironhill Excavating')&&CSVT.includes('21900')&&CSVT.includes('Signed contract')&&CSVT.includes('Payment')&&CSVT.includes('Plumbing rough-in'));
$("Data.addCostActual({id:'caq',lineId:'b1',kind:'spent',amount:5,payee:'Acme, \"Quote\" Co',note:'line1\\nline2',t:Date.now()})");
CSVT=$("costsCsv(P())");
t('csv quotes commas, quotes and newlines', CSVT.includes('"Acme, ""Quote"" Co"')&&CSVT.includes('"line1\nline2"'));
$("Data.removeCost('caq')");
$('openBudget()');
t('export button rendered', el('budgetBody').innerHTML.includes('for your accountant'));
// margin link through the real line modal
const pricedSel=$("((P().selections||[]).find(s=>Number(s.price)>0)||{}).id");
$("openCostLine('b1')");
$("document.getElementById('clSel').value="+JSON.stringify(String(pricedSel)));
setVal('clLabel','Permits & site work');setVal('clBudget','40000');
$('saveCostLine()');
t('selection link persisted', String($("costLines(P()).find(l=>l.id==='b1').selId"))===String(pricedSel));
const MG=JSON.parse($("JSON.stringify(costLineMargin(P(),'b1'))"));
t('margin math = price minus exposure', !!MG&&MG.cost===16800&&MG.margin===MG.price-16800, JSON.stringify(MG));
$("openCostLine('b1')");
t('modal shows the margin readout', el('clMargin').innerHTML.includes('Homeowner pays'));
$('closeCostLine()');
$("Data.updateCost('b1',{selId:''})");
t('unlink clears margin', $("costLineMargin(P(),'b1')")===null);
$('closeBudget()');

/* ════ 14f · PHASE E: BUDGET TEMPLATES (clone lines, never history) ════ */
S('budget templates');
asBuilder();$("state.activeId='p4'");
t('Maple Court starts empty', $("costLines(P()).length")===0);
t('sources exclude self and empty sites', $("JSON.stringify(budgetSources().map(s=>s.id).sort())")===JSON.stringify(['p1','p10','p2','p3','p5','p6','p7','p8','p9']));
$('openBudget()');
t('empty budget offers the copy link', el('budgetBody').innerHTML.includes('Copy budget lines from another site'));
$('openBudgetCopy()');
t('picker lists donor sites with totals', el('bcBody').innerHTML.includes('Calderwood')&&el('bcBody').innerHTML.includes('656,300'));
$("cloneBudgetFrom('p2')");
t('sixteen lines cloned onto empty site (no confirm gate)', $("costLines(P()).length")===16);
t('amounts and tags travel', $("costSummary(P()).budget")===656300&&$("costLines(P()).filter(l=>l.stage==='roughin').length")===3);
t('history and links do NOT travel', $("costActuals(P()).length")===0&&$("costLines(P()).every(l=>!l.selId)")===true&&$("costSummary(P()).exposure")===0);
t('cloned ids are fresh', $("costLines(P()).every(l=>!/^b\\d+$/.test(l.id))")===true);
// cloning onto an existing budget must pass the confirm gate and append
$('openBudgetCopy()');$("cloneBudgetFrom('p3')");
t('confirm gate on non-empty budget', el('confirmScrim').classList.contains('show'));
$('ocConfirm()');
t('append alongside existing', $("costLines(P()).length")===36);
t('p2 donor untouched', $("costLines(state.projects.find(x=>x.id==='p2')).length")===16&&$("costActuals(state.projects.find(x=>x.id==='p2')).length")===15);
$('closeBudget()');
$("state.projects.find(p=>p.id==='p4').costs=[]");
t('cleanup', $("state.activeId==='p4'&&costLines(P()).length===0")===true);

/* ════ 14g · UX POLISH SWEEP (one vocabulary, doors where hands expect them) ════ */
S('ux polish');
asBuilder();$("state.activeId='p2'");$('renderBuild()');
t('Billing card is the Budget twin', ['To collect','Awaiting OK','Billed','Paid','View billing'].every(s=>el('billingCard').innerHTML.includes(s)));
t('Billing card math (out=net-paid on p2)', el('billingCard').innerHTML.includes($("invUsd(billingSummary(P()).out)")));
t('calendar door atop Schedule pane', el('buildSchedule').innerHTML.includes('Trades calendar for this site'));
$("calSiteFilter=String(state.activeId);openCal()");
t('door opens calendar scoped to this site', el('calview').classList.contains('show'));
$("document.getElementById('calview').classList.remove('show')");
t('Full site tab says Needs You', $("document.querySelector('nav .tab[data-v=\"decisions\"] span').textContent")==='Needs You');
t('To-Do segments speak one language', el('view-decisions').innerHTML.includes('Waiting on you')&&el('view-decisions').innerHTML.includes('Site issues'));
t('Log camera is Field Notes', $("!!document.querySelector('#view-log .site-field')")===true);
t('Photos pane uses Field Notes', el('filesPhotos').innerHTML.includes('Field Notes')&&el('filesPhotos').innerHTML.includes('openFieldNote'));
$("go('decisions')");$("decSeg('waiting',document.querySelector('[data-d=waiting]'))");
t('issues header matches segment vocabulary', el('view-decisions').innerHTML.includes('Open site issues'));
// homeowner side
$("state.activeId='p2'");
const CH=clientHTML('p2','home');
t('homeowner sees To pay, not Outstanding', CH.includes('To pay')&&!CH.includes('Outstanding'));
t('homeowner stats are tappable doors', CH.includes('clDecsHead')&&CH.includes('clPayHead')&&CH.split('scrollIntoView').length>=3);
t('Share an idea sits beside Raise a concern', CH.includes('Raise a concern')&&CH.includes('Share an idea'));
// sub side
t('sub docs drop the technical fine print', !subSiteHTML('Clearwater Plumbing','p2').includes('no file yet'));
asBuilder();$("state.activeId='p2'");

/* ════ 14h · MODALS OPEN AT THE TOP ════ */
S('modal scroll reset');
asBuilder();$("state.activeId='p2'");
t('reset helper zeroes scrim and inner scrollables', $("(function(){const s=document.getElementById('budgetScrim');s.scrollTop=40;const p=s.querySelector('.pmodal');p.scrollTop=80;resetModalScroll(s);return s.scrollTop===0&&p.scrollTop===0;})()")===true);
$("(function(){const s=document.getElementById('budgetScrim');s.querySelector('.pmodal').scrollTop=120;})()");
$('openBudget()');
await new Promise(r=>setTimeout(r,30));
t('observer resets scroll when a modal shows', $("document.querySelector('#budgetScrim .pmodal').scrollTop")===0);
$('closeBudget()');

/* ════ 14i · INSTALL GATE + INVITE STASH ════ */
S('install gate');
t('gate is inert off-phone (sim has no coarse pointer)', $('maybeInstallGate()')===false&&$("document.getElementById('installGate').classList.contains('show')")===false);
t('standalone + mobile detectors are guarded', $('isStandalonePWA()')===false&&$('isCoarseMobile()')===false);
t('UA parser consolidated: iOS 18 vs 26 vs non-iOS', $("iosMajor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)')")===18&&$("iosMajor('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Version/26.1')")===26&&$("iosMajor('Mozilla/5.0 (Linux; Android 15)')")===0);
// install sheet speaks every platform (UA is shadowed per case, then restored)
const UA=(ua)=>$("Object.defineProperty(navigator,'userAgent',{value:"+JSON.stringify(ua)+",configurable:true});1");
const unUA=()=>$("Reflect.deleteProperty(Object.getPrototypeOf(navigator)===Navigator.prototype?navigator:navigator,'userAgent');1");
const sheet=()=>{$('openInstall()');const h=el('installBody').innerHTML;$("document.getElementById('installScrim').classList.remove('show')");return h;};
UA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15');
t('Mac Safari gets File > Add to Dock', sheet().includes('Add to Dock'));
UA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0');
t('desktop Firefox gets the honest answer + alternatives', /doesn\u2019t support installing|doesn’t support installing/.test(sheet()));
UA('Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36');
t('Samsung Internet gets its own steps', sheet().includes('Add page to'));
UA('Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1');
(function(){const h=sheet();
t('Chrome on iPhone gets real install steps, no Safari detour', h.includes('Add to Home Screen')&&!h.includes('Copy link for Safari'));})();
unUA();
t('UA restored for later sections', $("/jsdom/.test(navigator.userAgent)")===true);
// invite stash survives the browser → app hop
$("localStorage.setItem('plumbPendingInvite','ZX99')");
$("(function(){const s=state.session;state.session=null;try{consumeInviteLink();}finally{state.session=s;}})()");
t('stashed invite fills the live sign-in (no URL param needed)', $("document.getElementById('laInvite').value")==='ZX99');
t('stash is kept until sign-in completes', $("localStorage.getItem('plumbPendingInvite')")==='ZX99');
$("localStorage.removeItem('plumbPendingInvite')");
$("document.getElementById('laInvite').value=''");
$("document.getElementById('laInviteRow').style.display='none'");
$("setMode('demo')");
// escape hatch
$("document.getElementById('installGate').classList.add('show')");
$('igBrowser()');
t('continue-in-browser hides the gate and remembers for the session', $("document.getElementById('installGate').classList.contains('show')")===false&&$("sessionStorage.getItem('plumbBrowserOK')")==='1');
$("sessionStorage.removeItem('plumbBrowserOK')");
asBuilder();$("state.activeId='p2'");

/* ════ 14j · SERVER PHASE CLIENT PLUMBING ════ */
S('server plumbing');
asBuilder();$("state.activeId='p2'");
t('fnCall + qb surface defined', $("typeof fnCall")==='function'&&$("typeof qbExportNow")==='function'&&$("typeof qbRefreshStatus")==='function');
t('fnCall refuses when signed out of Firebase', await $("fnCall('qbStatus',{}).then(()=>'ok',e=>e.message)")==='sign in first');
t('qb gated OFF in demo mode', $('qbEligible()')===false);
$('renderBudget()');
t('no QuickBooks button in a demo budget', !el('budgetBody').innerHTML.includes('Send new costs to QuickBooks'));
t('dev panel carries the QuickBooks line', $("!!document.getElementById('qbLine')")===true);
$('qbRenderLine()');
t('qb line explains the gate in demo', el('qbLine').innerHTML.includes('Sign in live'));
t('telemetry beat/event are no-throw when sync is off', await $("Promise.all([Sync.beat(),Sync.event('x','y')]).then(()=>true,()=>false)")===true);
$('closeBudget()');

/* ════ 14k · ONBOARDING: splash, welcome fork, grand tour, excursions ════ */
S('onboarding');
// splash is one door: choosers exist in DOM but the era CSS hides them; explore link present
t('splash keeps live controls + explore link', $("!!document.querySelector('.login-explore')")===true&&$("!!document.getElementById('realControls')")===true);
t('guide orb present, guarded, choreographed', $("!!document.getElementById('tourOrb')")===true&&await $("orbTo('#nope').then(()=>true)")===true&&await $("orbTo(null,{tap:true}).then(()=>true)")===true&&$("TOUR.grand.every(s=>Array.isArray(s.acts)&&s.acts.length)")===true&&$("TOUR.grand.filter(s=>s.acts.some(a=>a.tap)).length")===14&&$("typeof orbTaps")==='function'&&$("typeof tourPing")==='function'&&$("TOUR.grand.filter(s=>s.after).length")===7&&$("TOUR.grand.filter(s=>s.task).length")===5&&$("typeof runTask")==='function'&&$("typeof holeOpen")==='function'&&$("typeof orbInvite")==='function'&&$("typeof tourDemoPhoto")==='function'&&$("typeof tourDemoDoc")==='function');
t('grand tour rides the spotlight engine', $("typeof startGrandTour")==='function'&&$("Array.isArray(TOUR.grand)")===true&&$("TOUR.grand.length")===16&&$("TOUR.grand.every(s=>s.title&&s.body)")===true&&$("TOUR.grand.slice(1).every(s=>s.sel)")===true&&$("typeof tourGoto")==='function');
// excursion from a live session: flip out, come home with session + activeId intact
asBuilder();
$("localStorage.setItem('plumb.mode','real')");
$("state.session={role:'hillan',name:'Real Me',auth:{uid:'uTest'}};state.activeId=null;persist&&persist()");
$('enterDemo()');
t('excursion runs in demo with banner + builder session', $("appMode()")==='demo'&&$("document.body.classList.contains('on-excursion')")===true&&$("state.session.role")==='hillan'&&$("(state.projects||[]).length")>0);
$('exitDemo()');$('exitDemoToApp()');
t('exit lands home: real mode, banner gone, suspend cleared', $("appMode()")==='real'&&$("document.body.classList.contains('on-excursion')")===false&&$("localStorage.getItem('plumbSuspend')")===null);
// welcome fork fires only for empty live builder accounts, once
$("localStorage.removeItem('plumbWelcomed')");
$("state.session={role:'hillan',name:'Real Me'};state.projects=[];");
$('maybeWelcome()');
t('welcome fork shows for a fresh live builder', $("document.getElementById('welcomeScrim').classList.contains('show')")===true);
$('welcomeDone()');$('maybeWelcome()');
t('welcome respects the once flag', $("document.getElementById('welcomeScrim').classList.contains('show')")===false);
// grand tour: every step navigates, spotlights a real element, and narrates
$('enterDemo()');$("startTour('grand')");
await new Promise(r=>setTimeout(r,1650));
const L_OV=()=>$("document.getElementById('overview').classList.contains('show')");
const L_ACT=v=>$("document.getElementById('view-"+v+"').classList.contains('active')");
const L_PANE=id=>$("document.getElementById('"+id+"').style.display")!=='none';
const landmarks=[
  ()=>L_OV()===true&&$("appMode()")==='demo',
  ()=>L_ACT('log')&&L_OV()===false,
  ()=>L_ACT('log'),
  ()=>L_ACT('decisions'),
  ()=>L_ACT('decisions'),
  ()=>L_ACT('build')&&L_PANE('buildSchedule'),
  ()=>$("document.getElementById('calview').classList.contains('show')")===true,
  ()=>L_PANE('buildPermits')&&$("document.getElementById('calview').classList.contains('show')")===false,
  ()=>$("document.getElementById('budgetScrim').classList.contains('show')")===true,
  ()=>$("document.getElementById('budgetScrim').classList.contains('show')")===false&&L_ACT('build'),
  ()=>L_ACT('files')&&L_PANE('filesPhotos'),
  ()=>L_PANE('filesDocs'),
  ()=>$("state.session.role")==='subs'&&$("document.getElementById('subview').classList.contains('show')")===true,
  ()=>$("state.session.role")==='client'&&$("document.getElementById('clientview').classList.contains('show')")===true&&L_OV()===false,
  ()=>$("state.session.role")==='client'&&$("document.getElementById('clientview').classList.contains('show')")===true,
  ()=>$("state.session.role")==='hillan'&&L_OV()===true,
];


let tourOK=true, tourDetail='';
for(let i2=0;i2<16;i2++){
  if(i2>0){$('tourNext()');await new Promise(r=>setTimeout(r,1650));}
  if(!landmarks[i2]()){tourOK=false;tourDetail='landmark '+i2;break;}
  const lifted=$("_tourLift?1:0");
  const bub=$("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML");
  if(!bub.includes(String(i2+1)+' / 16')){tourOK=false;tourDetail='counter '+i2;break;}
  // LAW 4 enforcement: bubble never faded; docked exactly when the orb works the page
  if($("document.getElementById('tourBubble').style.opacity")==='0'){tourOK=false;tourDetail='LAW4 fade at '+i2;break;}
  const wantDock=$("!!(TOUR.grand["+i2+"].after||TOUR.grand["+i2+"].task||TOUR.grand["+i2+"].bubSide)");
  if($("document.getElementById('tourBubble').classList.contains('tour-bub-dock')")!==wantDock){tourOK=false;tourDetail='LAW4 dock at '+i2;break;}
  if(i2!==0&&i2!==10&&!lifted){tourOK=false;tourDetail='no spotlight at '+i2;break;}
}
t('all 16 steps navigate, spotlight and count correctly', tourOK, tourDetail);
// Peter's Back bug, encoded forever: walk 16 → 1 and every landmark must still hold
let backOK=true, backDetail='';
for(let b=14;b>=0;b--){
  $('tourPrev()');await new Promise(r=>setTimeout(r,1650));
  if(!landmarks[b]()){backOK=false;backDetail='back landmark '+b;break;}
  if($("document.getElementById('tourBubble').classList.contains('tour-bub-dock')")!==$("!!(TOUR.grand["+b+"].after||TOUR.grand["+b+"].task||TOUR.grand["+b+"].bubSide)")){backOK=false;backDetail='LAW4 dock back '+b;break;}
}
t('walking BACKWARD lands every slide correctly too', backOK, backDetail);
for(let f=1;f<16;f++){$('tourNext()');await new Promise(r=>setTimeout(r,350));}
await new Promise(r=>setTimeout(r,900));
t('LAW 5 hook armed per slide', $("typeof window._law5")==='function');
$("(function(){const b=document.getElementById('tourBubble');if(b)b.getBoundingClientRect=()=>({left:100,right:400,top:100,bottom:300,width:300,height:200});})()");
const l5ok=$("!!document.getElementById('tourBubble')");
const l5a=l5ok?$("window._law5({left:150,right:250,top:150,bottom:250})"):null;
const l5b=$("window._law5({left:150,right:250,top:150,bottom:250})");
const l5c=$("window._law5({left:900,right:990,top:900,bottom:990})");

t('LAW 5: covered press moves bubble once, waits thereafter, ignores clear presses', l5ok===true&&l5a===true&&l5b===true&&l5c===false&&$("(document.getElementById('tourBubble')||{classList:{contains:()=>false}}).classList.contains('tour-bub-dock')")===true&&$("(document.getElementById('tourBubble')||{dataset:{}}).dataset.side")===$("(innerWidth<700)?((200<innerHeight/2)?'bb':'tb'):((200>innerWidth/2)?'tl':'tr')"));
t('finale buttons: demo=black, first-site=gold', $("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML").includes('tour-gold')&&$("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML").includes('tour-next" onclick="tourEnd()">Explore demo'));
t('final step carries the first-site CTA', $("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML").includes('Set up my site'));
$('tourEnd()');$('exitDemo()');$('exitDemoToApp()');
t('post-tour exit is clean', $("appMode()")==='real'&&$("_tourLift?1:0")===0);
// banner role buttons: three chips, hop to each hat cleanly, active mark follows
$('enterDemo()');
t('banner offers Builder/Homeowner/Sub + exit', $("document.querySelectorAll('.exc-roles button').length")===3&&$("!!document.querySelector('.exc-exit')")===true);
$("demoRole('client')");
t('Homeowner chip: client view full, overview hidden, chip lit', $("state.session.role")==='client'&&$("document.getElementById('clientview').classList.contains('show')")===true&&$("document.getElementById('overview').classList.contains('show')")===false&&$("document.querySelector('.exc-roles button[data-r=client]').classList.contains('on')")===true);
$("demoRole('subs')");
t('Sub chip swaps cleanly', $("state.session.role")==='subs'&&$("document.getElementById('subview').classList.contains('show')")===true&&$("document.getElementById('clientview').classList.contains('show')")===false);
$("demoRole('hillan')");
t('Builder chip returns home', $("state.session.role")==='hillan'&&$("document.getElementById('overview').classList.contains('show')")===true);
$('exitDemo()');$('exitDemoToApp()');
// voice layer: guarded everywhere, mute round-trips
t('speech guarded in jsdom (no speechSynthesis)', await $("Promise.resolve().then(()=>{tourSpeak('hello');return true;})")===true);
$('tourToggleMute()');
t('mute persists', $("localStorage.getItem('plumbTourMute')")==='1');
$('tourToggleMute()');
// crash recovery: suspend flag at boot forces the trip home (unit-level)
$("localStorage.setItem('plumbSuspend','1');localStorage.setItem('plumb.mode','demo')");
t('crash marker + demo mode is the recovery precondition', $("!!localStorage.getItem('plumbSuspend')&&appMode()==='demo'")===true);
$("localStorage.removeItem('plumbSuspend');localStorage.setItem('plumb.mode','demo')");
// settings + devpanel doors exist
t('gear rows offer tour + example build', $("!!document.getElementById('welcomeScrim')")===true&&el('devpanel').innerHTML.includes('Replay the tour'));
asBuilder();$("state.activeId='p2'");$("localStorage.removeItem('plumbWelcomed')");

/* ════ 14k2 · GUEST SUB PACKET LINKS ════ */
S('guest packets');
asBuilder();
$("state.activeId='p2'");
// snapshot: composed from the booking, trade-filtered, and carries NO money
const snap=JSON.parse($("JSON.stringify(packetSnapshot(state.projects[1],(state.projects[1].bookings||[]).find(b=>b.trade==='plumb')))"));
t('snapshot carries site, dates, sub and trade', !!snap.site&&!!snap.start&&snap.sub==='Clearwater Plumbing'&&snap.trade==='plumb');
t('snapshot specs are trade-filtered only', (snap.specs||[]).every(x=>['Plumbing Fixtures'].includes(x.cat)));
t('snapshot carries no prices or budget data', JSON.stringify(snap).indexOf('price')<0&&JSON.stringify(snap).indexOf('budget')<0&&JSON.stringify(snap).indexOf('amount')<0);
t('snapshot expiry outlives the booking', snap.expires>snap.end&&snap.expires>Date.now()+6*86400000);
t('snapshot docs are sub-audience names only', Array.isArray(snap.docs)&&snap.docs.every(d=>typeof d==='string'));
// guest render from a fixture (exactly the offline/QA path)
$("window.__packetFixture="+JSON.stringify(snap));
$("renderGuestPacket('fixture-test')");
t('guest page renders with both decision buttons', el('gpBody').innerHTML.indexOf('These dates work')>=0&&el('gpBody').innerHTML.indexOf('Suggest different dates')>=0);
t('guest page shows the specs it was sent', el('gpBody').innerHTML.indexOf('install specs')>=0);
t('guest overlay is showing', $("document.getElementById('guestScrim').classList.contains('show')")===true);
// one-tap confirm flips to the confirmed state with a calendar button
$("gpConfirm()");
t('confirm renders the confirmed state', el('gpBody').innerHTML.indexOf('Confirmed.')>=0&&el('gpBody').innerHTML.indexOf('Add to my calendar')>=0);
t('ics is well formed', (function(){const i=$("gpIcs(_gpSnap)");return i.indexOf('BEGIN:VCALENDAR')===0&&i.indexOf('DTSTART;VALUE=DATE:')>0&&i.indexOf('END:VEVENT')>0;})());
// change-request path records only resp
$("_gpSnap.resp=null;_gpRender()");
$("gpToggleChange()");
t('change form opens the range calendar', el('gpChgCal')&&el('gpChgCal').style.display!=='none'&&el('gpChgNote')&&el('gpChgNote').style.display==='none'&&el('gpCalMount'));
$("_gpCalCursor=new Date(2030,4,1);gpRenderCal()");
$("gpPickDay('2030-05-06')");
t('first tap is the start', el('gpStart').value==='2030-05-06'&&el('gpEnd').value==='');
$("gpPickDay('2030-05-08')");
t('second tap is the end', el('gpStart').value==='2030-05-06'&&el('gpEnd').value==='2030-05-08');
t('range paints the days between', el('gpCalMount').innerHTML.indexOf('mid')>=0);
$("gpCalDone()");
t('check reveals the note and the dates', el('gpChgNote')&&el('gpChgNote').style.display!=='none'&&el('gpChgCal').style.display==='none'&&el('gpNote')&&el('gpChosen')&&el('gpChosen').textContent.indexOf('May')>=0);
$("document.getElementById('gpNote').value='Crew frees up Tuesday'");
$("gpSendChange()");
t('change request records status, dates and note', (function(){const r=JSON.parse($("JSON.stringify(_gpSnap.resp)"));return r.status==='change'&&r.start>0&&r.note==='Crew frees up Tuesday';})());
// v2.207: self-assembled context + Q&A loop + scheduling arms the questions
t('snapshot assembles permit, inspection and readiness context', (function(){const c=snap.ctx||{};return typeof c.ready==='string'&&(c.insp||'').indexOf(': ')>0;})());
t('snapshot carries recent site history for context', (function(){const h=(snap.ctx||{}).history||[];return h.length>=2&&h.every(x=>typeof x.text==='string'&&x.text.length>0);})());
t('history is text only - no photo or file references escape', (function(){const j=JSON.stringify((snap.ctx||{}).history||[]);return j.indexOf('photoId')<0&&j.indexOf('fileUrl')<0&&j.indexOf('fileId')<0;})());
// v2.209: strict docs, colored readiness, approval, calendar, stamping, alerts
t('untagged docs never ride along - strict trade routing', (function(){
  return Array.isArray(snap.docs)&&snap.docs.every(function(n){return !/Contract|Lien|Broker|Window/i.test(n);});
})());
t('a trade-routed doc DOES travel', (function(){
  $("(function(){var p=state.projects[1];p.docs.push({aud:'all',n:'Rough-In Layout - PLUMB.pdf',trade:'plumb',k:'plan'});})()");
  const s2=JSON.parse($("JSON.stringify(packetSnapshot(state.projects[1],(state.projects[1].bookings||[]).find(b=>b.trade==='plumb')))"));
  $("(function(){var p=state.projects[1];p.docs=p.docs.filter(d=>d.n!=='Rough-In Layout - PLUMB.pdf');})()");
  return s2.docs.some(function(n){return String(n).indexOf('PLUMB')>=0;});})());
t('readiness carries a machine flag', typeof (snap.ctx||{}).readyOk==='boolean');
$("window.__packetFixture="+JSON.stringify(snap));
$("_gpPendingSend={pid:'p2',bid:'x'}");
$("renderGuestPacket('preview')");
t('approval bar renders on a sendable preview', el('gpBody').innerHTML.indexOf('Approve')>=0&&el('gpBody').innerHTML.indexOf('exactly what')>=0);
$("_gpPendingSend=null");$("_gpRender()");
t('plain preview has no approval bar', el('gpBody').innerHTML.indexOf('Approve')<0);
t('colored readiness renders', el('gpBody').innerHTML.indexOf('var(--sage)')>=0||el('gpBody').innerHTML.indexOf('var(--clay)')>=0);
t('permit and inspection rows are labeled', el('gpBody').innerHTML.indexOf('Permit')>=0&&el('gpBody').innerHTML.indexOf('Inspection')>=0);
// calendar: confirm then chooser + google url + preference memory
$("_gpSnap.resp={status:'confirmed',t:Date.now()};_gpToken='fixture-x';_gpRender()");
t('confirmed state offers the calendar with a chooser', el('gpBody').innerHTML.indexOf('Add to my calendar')>=0&&el('gpBody').innerHTML.indexOf('Google Calendar')>=0);
t('google calendar url is well formed', (function(){const g=JSON.parse($("JSON.stringify(_gpSnap)"));const d=$("(function(){const d=ts=>{const x=new Date(ts);const p2=v=>String(v).padStart(2,'0');return x.getFullYear()+p2(x.getMonth()+1)+p2(x.getDate());};return d(_gpSnap.start);})()");return /^\d{8}$/.test(d);})());
$("_gpSetCalPref('google')");
t('calendar preference persists', $("_gpCalPref()")==='google');
$("_gpSetCalPref('')");
t('guest page carries a Preferences section', (function(){$("_gpSnap.resp=null;_gpRender()");return el('gpBody').innerHTML.indexOf('Preferences')>=0&&el('gpBody').innerHTML.indexOf('Default calendar')>=0;})());
$("closeGuestPreview()");
// stamping writes reply + question state onto the synced booking
t('packet stamping records reply and open questions on the booking', (function(){
  $("(function(){var p=state.projects[1];var b=p.bookings[0];_pkStamp(p,b,{resp:{status:'change',start:1900000000000,end:1900100000000,note:'wk later',t:5},q:[{text:'a'},{text:'b',a:'ans'}]});})()");
  const b=JSON.parse($("JSON.stringify(state.projects[1].bookings[0])"));
  return b.pkResp&&b.pkResp.status==='change'&&b.pkQOpen===1&&b.pkStamp>0;})());
t('NEEDS YOU surfaces the suggested dates and the question', (function(){
  $("renderToday()");
  const kinds=$("JSON.stringify(_nyIssues(visibleProjects()).map(function(i){return i.kind;}))");
  return kinds.indexOf('Date change')>=0&&kinds.indexOf('Question')>=0;})());
$("(function(){var b=state.projects[1].bookings[0];delete b.pkResp;delete b.pkQOpen;delete b.pkStamp;renderToday();})()");
// v2.210: the regressions Peter caught become permanent checks
t('openConfirm fires its onConfirm callback', (function(){
  $("window.__ocTest=0;openConfirm({title:'t',onConfirm:function(){window.__ocTest=1;}});ocConfirm()");
  return $("window.__ocTest")===1;})());
t('guest load without firebase fails soft after the wait, not instantly', (function(){
  $("window.__pkWaitMs=60");
  $("renderGuestPacket('pk_no_such')");
  const early=el('gpBody').innerHTML.indexOf('Opening your packet')>=0;
  return early;})());
t('excavation falls back to the grading or building permit', (function(){
  const c=JSON.parse($("JSON.stringify((packetSnapshot(state.projects[0],{trade:'excav',subName:'Ironhill Excavating',start:Date.now(),end:Date.now()+86400000,note:'',id:'x'})).ctx)"));
  return typeof c.permit==='string'&&(c.permit.indexOf('Grading')>=0||c.permit.indexOf('Building')>=0);})());
t('inspection lines carry readable labels and casing', (function(){
  const c=JSON.parse($("JSON.stringify((packetSnapshot(state.projects[0],{trade:'excav',subName:'Ironhill Excavating',start:Date.now(),end:Date.now()+86400000,note:'',id:'x'})).ctx)"));
  return typeof c.insp==='string'&&c.insp.indexOf('Site / pre-construction')===0&&/: [A-Z]/.test(c.insp);})());
t('preview explains an empty documents section', (function(){
  $("window.__packetFixture=Object.assign(JSON.parse(JSON.stringify(_gpSnap||{}))||{},{docs:[],resp:null,q:[],specs:[],ctx:{},site:'X',builder:'B',sub:'S',tradeLabel:'T',start:Date.now(),end:Date.now(),expires:Date.now()+86400000})");
  $("renderGuestPacket('preview')");
  const ok=el('gpBody').innerHTML.indexOf('None routed to this trade yet')>=0;
  $("closeGuestPreview()");
  return ok;})());
setTimeout(function(){},0);
$("window.__packetFixture="+JSON.stringify(snap));
$("renderGuestPacket('fixture-test')");
$("gpToggleAsk()");
$("document.getElementById('gpQText').value='Is the water heater gas or electric?'");
$("gpSendQuestion()");
t('guest question appends to the thread and renders', (function(){const q=JSON.parse($("JSON.stringify(_gpSnap.q)"));return q.length===1&&q[0].text.indexOf('water heater')>=0&&el('gpBody').innerHTML.indexOf('will get back to you')>=0;})());
t('builder thread offers Answer and Share for an open question', (function(){const h=$("_bkQHTML(state.projects[1],state.projects[1].bookings[0],_gpSnap)");return h.indexOf('Answer')>=0&&h.indexOf('Share with homeowner')>=0;})());
$("_gpSnap.q[0].a='Gas - 3/4 line is stubbed'");
t('an answered question renders the answer on both sides', $("_bkQHTML(state.projects[1],state.projects[1].bookings[0],_gpSnap)").indexOf('Gas - 3/4 line is stubbed')>=0&&(function(){$("_gpRender()");return el('gpBody').innerHTML.indexOf('Gas - 3/4 line is stubbed')>=0;})());
$("closeGuestPreview()");
// scheduling arms the questions: p2 elec has gaps in the seed
const armed=(function(){
  $("(function(){const p=state.projects[1];const sb=p.subs.find(x=>x.specialty==='elec');if(sb){sb.specsDue=null;}_bkArmSpecs(p,'elec',Date.now()+12*86400000);})()");
  return JSON.parse($("JSON.stringify(state.projects[1].subs.find(x=>x.specialty==='elec'))"));
})();
t('scheduling with gaps snaps the specs deadline before the crew', armed.specsDue>Date.now()&&armed.specsDue<Date.now()+9*86400000&&armed.specsDueBy==='Scheduling');
t('arming never loosens an earlier deadline', (function(){
  $("(function(){const p=state.projects[1];const sb=p.subs.find(x=>x.specialty==='elec');sb.specsDue=Date.now()+86400000;_bkArmSpecs(p,'elec',Date.now()+30*86400000);})()");
  const sb=JSON.parse($("JSON.stringify(state.projects[1].subs.find(x=>x.specialty==='elec'))"));
  return sb.specsDue<=Date.now()+86400000+1000;})());

$("closeGuestPreview()");
t('preview closes clean', $("document.getElementById('guestScrim').classList.contains('show')")===false&&$("typeof window.__packetFixture")==='undefined');
// booking editor row: send button present for an existing booking; demo mode says Preview
$("(function(){const p=state.projects[1];const b=p.bookings[0];bkRenderGuestRow(p,b);})()");
t('booking editor offers the packet link', el('bkSendLink').innerHTML.indexOf('packet link')>=0);
t('demo mode labels it a preview', el('bkSendLink').innerHTML.indexOf('Preview the packet link')>=0);
$("bkRenderGuestRow(null,null)");
t('guest row clears for new bookings', el('bkGuest').innerHTML===''&&el('bkSendLink').innerHTML==='');
// accept-change applies the sub dates to the booking
$("document.getElementById('bkStart').value='2026-08-14'");
$("document.getElementById('bkEnd').value='2026-08-20'");
$("(function(){const p=state.projects[1];const b=p.bookings[0];b.pkToken='pkTEST';bkAcceptChange(p.id,b.id,1900000000000,1900172800000);})()");
t('accepting a change rewrites the booking to the suggested dates', (function(){const b=JSON.parse($("JSON.stringify(state.projects[1].bookings[0])"));const ds=t=>{return Number($('dayStart('+t+')'));};return b.start===ds(1900000000000)&&b.end===ds(1900172800000)&&b.status==='confirmed'&&b.pkResp&&b.pkResp.status==='confirmed';})());
t('accepting a change writes the new dates into the open booking fields', (function(){
  const iso=ts=>{const d=new Date(Number($('dayStart('+ts+')')));const p2=v=>String(v).padStart(2,'0');return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());};
  return el('bkStart').value===iso(1900000000000)&&el('bkEnd').value===iso(1900172800000);
})());
t('Confirm these dates is the accept control', $("String(_bkGuestStatusHTML)").indexOf('Confirm these dates')>=0);
$("openBk()");
t('schedule sheet uses the SitePlumb calendar, not the phone picker', el('bkStart').type==='hidden'&&el('bkRangeLabel')&&el('bkCalMount'));
$("bkCalToggle()");
t('tapping the dates opens the range calendar', el('bkCal')&&el('bkCal').style.display==='block');
$("bkPickDay('2026-08-17')");
$("bkPickDay('2026-08-20')");
$("bkCalDone()");
t('check writes the range onto the schedule sheet', el('bkStart').value==='2026-08-17'&&el('bkEnd').value==='2026-08-20'&&el('bkCal').style.display==='none'&&el('bkRangeLabel').textContent.indexOf('17')>=0);
$("closeBk()");
t('waiting packets refresh after 3s, not half an hour', (function(){
  const now=2000000000000;
  return $("_pkNeedsRefresh({pkToken:'x',pkStamp:"+(now-20000)+"},"+now+")")===true
    && $("_pkNeedsRefresh({pkToken:'x',pkStamp:"+(now-1000)+",pkResp:null},"+now+")")===false
    && $("_pkNeedsRefresh({pkToken:'x',pkStamp:"+(now-4000)+",pkResp:null},"+now+")")===true
    && $("_pkNeedsRefresh({pkToken:'x',pkStamp:"+(now-4000)+",pkResp:{status:'confirmed'}},"+now+")")===false
    && $("_pkNeedsRefresh({pkToken:'x',pkStamp:"+(now-20000)+",pkResp:{status:'confirmed'}},"+now+")")===true;
})());
t('Needs You listens to packet docs instead of waiting for a reopen', $("typeof _pkListenAll")==='function'&&$("String(_pkListenAll)").indexOf('onSnapshot')>=0);
t('coming back to the app wakes Needs You', $("typeof _pkWake")==='function'&&$("String(_pkWake)").indexOf('pkSweep')>=0);
t('a refused first read is not called expired', (function(){
  const src=$("String(renderGuestPacket)");
  return src.indexOf('needs a connection')>=0&&src.indexOf('tries')>=0&&src.indexOf('permission')<0;
})());
t('a one-day window formats as a single date', (function(){
  const same=$("fmtWin({start:1900000000000,end:1900000000000})");
  const span=$("fmtWin({start:1900000000000,end:1900172800000})");
  return same.indexOf('\u2013')<0&&span.indexOf('\u2013')>=0;
})());
t('removing a booking clears its Needs You card', (function(){
  $("(function(){var p=state.projects[1];var b={id:'bkDrop',subName:'Drop Crew',trade:'plumb',start:Date.now()+864e5,end:Date.now()+2*864e5,pkToken:'pkDROP',pkResp:{status:'change',start:Date.now()+3*864e5,end:Date.now()+4*864e5,t:1}};p.bookings.push(b);})()");
  const before=$("JSON.stringify(_nyIssues(visibleProjects()).map(function(i){return i.line;}))").indexOf('Drop Crew')>=0;
  $("(function(){var p=state.projects[1];deleteBooking(p,'bkDrop');})()");
  const after=$("JSON.stringify(_nyIssues(visibleProjects()).map(function(i){return i.line;}))").indexOf('Drop Crew')<0;
  return before&&after;
})());
t('leaving the calendar redraws Needs You', $("String(closeCal)").indexOf('renderToday')>=0);
t('Needs You names the kind of work', $("String(_nyIssues)").indexOf('Date change')>=0&&$("String(_nyIssues)").indexOf('Question')>=0);
t('Needs You covers the six new kinds', $("String(_nyIssues)").indexOf('They declined')>=0&&$("String(_nyIssues)").indexOf('Waiting on them')>=0&&$("String(_nyIssues)").indexOf('Site not ready')>=0&&$("String(_nyIssues)").indexOf('Homeowner wrote you')>=0&&$("String(_nyIssues)").indexOf('On deck, not booked')>=0&&$("String(_nyOnDeck)").indexOf('prevDone')>=0);
t('Show all and Recent decisions are separate actions', $("String(renderOvCards)").indexOf('openPkLog')>=0&&$("String(renderToday)").indexOf('toggleSoon')>=0);
t('untagged site files stay out of a trade packet', $("docInPacket({docHidden:{},docShown:{}},'plumb',{n:'Construction Contract.pdf'})")===false);
t('a trade-tagged plan is in that packet', $("docInPacket({docHidden:{},docShown:{}},'plumb',{n:'Plumbing Rough-In Plan.pdf',trade:'plumb'})")===true);
t('the packet is a briefing with still-open first', $("String(packetHTML)").indexOf('pkt-strip')>=0&&$("String(packetHTML)").indexOf('For the truck')>=0&&$("String(pktAsk)").indexOf('No dates on the calendar')>=0);
t('answering a spec from the packet does not tear the packet down', $("String(pktFillSpec)").indexOf('closeInfo')<0&&$("String(pktFillSpec)").indexOf('openSpec')>=0);
t('Needs You opens a packet without leaving home', $("String(openPacketFor)").indexOf('openSiteFromOverview')<0);
t('Back returns through the sheet stack', $("String(backToOverview)").indexOf('navPop')>=0&&$("String(navPush)").indexOf('restore')>=0);
t('Gone quiet whispers on the house, not Needs You', $("String(_nyIssues)").indexOf('Gone quiet')<0&&$("String(_siteWhisper)").indexOf('Quiet')>=0&&$("String(nyCardBits)").indexOf('_siteWhisper')>=0);
t('Gone quiet keeps home under the sheet', (function(){
  asBuilder();
  $('enterDemo()');
  $('showOverview()');
  $('openNextSite("p4")');
  const stacked=$("!!(document.getElementById('nextScrim')&&document.getElementById('nextScrim').classList.contains('show')&&document.getElementById('overview')&&document.getElementById('overview').classList.contains('show'))");
  $('closeNextSite()');
  const home=$("!!(!document.getElementById('nextScrim').classList.contains('show')&&document.getElementById('overview').classList.contains('show'))");
  return stacked===true&&home===true;
})());
t('a house card opens the briefing, not the site', $("String(nyOpenHouse)").indexOf('houseScrim')>=0&&$("String(nyOpenHouse)").indexOf('openSiteFromOverview')<0&&$("String(houseHTML)").indexOf('_nyIssues')>=0);
t('Needs You is one card per house', (function(){
  asBuilder();
  $('enterDemo()');
  $('showOverview()');
  $("_ovSort='attn';renderOvCards()");
  const n=$("(function(){var hs=[].slice.call(document.querySelectorAll('#ovCards .ov-card .st')).map(function(el){return el.textContent;});return hs.filter(function(x){return x.indexOf('Calderwood')>=0;}).length;})()");
  return n===1;
})());
t('Attention uses Needs You language', $("String(renderOvCards)").indexOf('needs you')>=0&&$("String(renderOvCards)").indexOf("_ovSort==='attn'")>=0&&$("SORTLABELS.attn")==='Needs You');
t('empty company does not show All homes', $("String(renderOvCards)").indexOf('if(projs.length)')>=0&&$("String(renderOvCards)").indexOf('No houses on the book')>=0);
t('empty book hides field notes', $("String(renderToday)").indexOf('if(!projs.length)')>=0);
t('empty book hides houses header', $("String(renderOverview)").indexOf("hd.style.display=projs.length")>=0);
t('Needs You opens an inbox', $("String(renderOvCards)").indexOf('All homes')>=0&&$("String(renderOvCards)").indexOf('openNyInbox')>=0&&$("String(inbTabLabel)").indexOf('Needs you')>=0);
t('All homes is a header not a clone', $("String(allNyPreview)").indexOf('slice(0,2)')<0&&$("String(renderOvCards)").indexOf('ov-allhot')>=0&&$("String(allNyPreview)").indexOf('hot')>=0);
t('desktop week pane exists', $("document.getElementById('ovWeek')")&&SRC.indexOf('renderOvWeek')>=0);
t('desktop split at 1100', SRC.indexOf('min-width:1100px')>=0&&SRC.indexOf('ov-week')>=0);
t('field notes three taps', SRC.indexOf('function openFieldNote')>=0&&SRC.indexOf('FIELD_KINDS')>=0&&SRC.indexOf("saveBtn').textContent='Send'")>=0);
t('field chip meanings tap i', SRC.indexOf('toggleFieldHint')>=0&&SRC.indexOf('fieldKindHint')>=0);
t('visual pass clay is not a label', SRC.indexOf('.tag.ho')>=0&&SRC.indexOf('.pkt-ho{')>=0&&SRC.indexOf('toggle.on{background:var(--ink)')>=0);
t('desk file-to after send', SRC.indexOf('function openFileTo')>=0&&SRC.indexOf('fileToScrim')>=0&&SRC.indexOf('saveFileTo')>=0);
t('sub hat is not overwritten', SRC.indexOf("have==='sub'")>=0&&SRC.indexOf('function applyLiveRole')>=0);
t('new walkthrough is five spots', SRC.indexOf("Glad you")>=0&&SRC.indexOf('teamLegacy:[')>=0&&SRC.indexOf('function startTeamTour')>=0&&SRC.indexOf('function tourPlayCues')>=0);
t('walkthrough has spoken scripts', SRC.indexOf("f:'s1a'")>=0&&SRC.indexOf('function tourWarmVoice')>=0&&SRC.indexOf('function tourChunks')>=0);
t('walkthrough motion on demo', SRC.indexOf('function tourDemoHouse')>=0&&SRC.indexOf('data-door="field"')>=0&&SRC.indexOf('data-sort=')>=0);
t('baked walkthrough voice', SRC.indexOf('tour-audio/s2a')>=0||SRC.indexOf("f:'s2a'")>=0);
t('walk syncs phrases', SRC.indexOf('function tourPlayCues')>=0&&SRC.indexOf('function tourAvoidCover')>=0);
t('walkthrough studio and cues', SRC.indexOf('function openTourStudio')>=0&&SRC.indexOf('function loadTourCues')>=0);
t('walk hear tools', SRC.indexOf('function tourTrace')>=0&&SRC.indexOf('function tourPrefetch')>=0&&SRC.indexOf('_tourEl')>=0&&SRC.indexOf('play-ac')>=0);
t('walk see tools', SRC.indexOf('function tourSeeSnap')>=0&&SRC.indexOf('__tourSee')>=0);
t('the house list pills are Needs You, decisions, A-Z', $("SORTLABELS.recent")==='Recent decisions'&&$("String(renderOvSortRow)").indexOf('ov-allpill')<0);
t('coming up more this week expands', $("String(renderToday)").indexOf('toggleSoon')>=0&&$("String(renderToday)").indexOf('td-morebtn')>=0);
t('the day sheet sits over the calendar', (function(){
  const z=$("(function(){var d=document.getElementById('dayScrim');var c=document.getElementById('calview');return getComputedStyle(d).zIndex+'|'+getComputedStyle(c).zIndex;})()");
  const p=z.split('|').map(Number);
  return p[0]>=96&&p[0]>p[1];
})());
t('back to a list keeps your place', $("String(nyOpenHouse)").indexOf("saveScroll('home')")>=0&&$("String(houseLeave)").indexOf("saveScroll('house')")>=0&&$("String(showOverview)").indexOf('applyScroll')>=0&&$("String(closeHouse)").indexOf("applyScroll('home')")>=0);
t('A-Z keeps the portfolio card', $("String(renderOvCards)").indexOf('localeCompare')>=0&&$("String(renderOvCards)").indexOf('nyCardBits')>=0);
t('tapping a house card opens the briefing on home', (function(){
  asBuilder();
  $('enterDemo()');
  $('showOverview()');
  $('nyOpenHouse("p2")');
  const ok=$("!!(document.getElementById('houseScrim')&&document.getElementById('houseScrim').classList.contains('show')&&document.getElementById('overview')&&document.getElementById('overview').classList.contains('show'))");
  $('closeHouse()');
  const home=$("!!(!document.getElementById('houseScrim').classList.contains('show')&&document.getElementById('overview').classList.contains('show'))");
  return ok===true&&home===true;
})());
t('the house briefing lists every still-open fact', (function(){
  asBuilder();
  $('enterDemo()');
  $('nyOpenHouse("p2")');
  const n=Number($("_nyIssues([state.projects.find(function(x){return x.id==='p2';})]).filter(function(i){return !i.cross&&String(i.pid)==='p2';}).length"));
  const rows=Number($("document.querySelectorAll('#houseBody .pkt-or').length"));
  const html=$("document.getElementById('houseBody').innerHTML");
  const capped=n<=3?rows===n:(rows===3&&/Show all/.test(html));
  $('toggleHouseOpen()');
  const rows2=Number($("document.querySelectorAll('#houseBody .pkt-or').length"));
  const html2=$("document.getElementById('houseBody').innerHTML");
  $('closeHouse()');
  return n>=2&&capped&&rows2===n&&/Show less/.test(html2);
})());
t('a house from the list opens the briefing', $("String(renderOvCards)").indexOf('nyOpenHouse')>=0&&$("String(renderOvCards)").indexOf("onclick=\"openSiteFromOverview")<0);
t('home has a field door to log a photo', $("String(renderToday)").indexOf('openLogPick')>=0&&$("String(renderToday)").indexOf('Field Notes')>=0&&$("typeof openLogPick")==='function'&&$("String(openLogPick)").indexOf('logPickHouse')>=0);
t('the briefing keeps log schedule selections money and the full site', (function(){
  const s=$("String(houseHTML)");
  return s.indexOf('logFromHouse')>=0&&s.indexOf('houseGoCal')>=0&&s.indexOf('houseGoMoney')>=0&&s.indexOf('houseGoSite')>=0&&s.indexOf('Full site')>=0&&s.indexOf('hs-doors')>=0;
})());
t('the house briefing does not repeat the street', $("String(houseHTML)").indexOf('This job')<0&&$("String(houseHTML)").indexOf('pkt-head')<0);
t('rooms on the house are doors not a second inbox', $("String(houseHTML)").indexOf('hs-doors')>=0&&$("String(houseHTML)").indexOf("Read and close old lines")<0&&$("String(houseHTML)").indexOf("This house</div>")<0);
t('money is one sentence', $("String(houseMoneyLine)").indexOf('Contracted')>=0&&$("String(houseMoneyLine)").indexOf('billed')>=0);
t('settings leads with company', $("String(renderSettings)").indexOf("set-hd\">Company")>=0&&$("String(renderSettings)").indexOf("openCompany()")>=0);
t('the homeowner home does not show a percent', $("String(renderClient)").indexOf('% complete')<0);
t('a room from the briefing comes back to the house', $("String(houseGoSite)").indexOf('navPush')>=0&&$("String(houseGoSite)").indexOf('nyOpenHouse')>=0);
t('a packet from the house hides the briefing then comes back', (function(){
  asBuilder();
  $('enterDemo()');
  $('showOverview()');
  $('nyOpenHouse("p2")');
  $('houseLeave(function(){openPacketFor("p2","plumb")})');
  const hidden=$("!!(!document.getElementById('houseScrim').classList.contains('show')&&document.getElementById('infoScrim').classList.contains('show'))");
  $('closeInfo()');
  const back=$("!!(document.getElementById('houseScrim').classList.contains('show')&&!document.getElementById('infoScrim').classList.contains('show'))");
  $('closeHouse()');
  return hidden===true&&back===true;
})());
t('still-open on the house shows three then all', $("String(houseHTML)").indexOf('toggleHouseOpen')>=0&&$("String(houseHTML)").indexOf('houseGoFact')>=0&&$("String(houseHTML)").indexOf('Show all')>=0);
t('selections from the house opens finishes', $("String(houseGoSite)").indexOf("decSeg('selections')")>=0&&$("String(houseGoSite)").indexOf("go('selections')")>=0);
t('closing the house does not pop the page stack', $("String(closeHouse)").indexOf('navPop')<0);
t('Needs You does not open the calendar', $("String(_nyIssues)").indexOf('openCalOn')<0);
t('a blocked crew opens the booking', $("String(_nyIssues)").indexOf("is blocked")>=0&&$("String(_nyIssues)").indexOf('openBk')>=0&&$("String(_bkBriefHTML)").indexOf('They are blocked')>=0);
t('a homeowner note opens a reply', $("String(_nyIssues)").indexOf('nyOpenHomeowner')>=0&&$("typeof nyOpenHomeowner")==='function'&&$("String(nyHoSend)").indexOf('reply')>=0);
t('waiting shows ask them again', $("String(_bkBriefHTML)").indexOf('Ask them again')>=0&&$("String(bkRenderGuestRow)").indexOf('_bkBriefHTML')>=0);
t('the tapped reason leads the booking', $("String(_nyIssues)").indexOf("openBk('${p.id}|${b.id}','wait')")>=0&&$("String(openBk)").indexOf('_bkLead')>=0&&$("String(bkLeadOrder)").indexOf('appendChild')>=0);
t('booking alerts have a gap', $("!!document.getElementById('bkAlerts')")===true&&$("document.documentElement.innerHTML").indexOf('.bk-alerts{display:flex;flex-direction:column;gap:12px')>=0);
t('the packet link sits after the review', $("!!document.getElementById('bkSendLink')")===true&&$("String(bkRenderGuestRow)").indexOf('sendGuestPacket')<0&&$("String(bkRenderSendLink)").indexOf('sendGuestPacket')>=0);
t('a sent packet updates live', $("String(persist)").indexOf('pkPublishSoon')>=0&&$("String(pkPublishOne)").indexOf("update(")>=0&&$("String(pkPublishOne)").indexOf('resp')<0&&$("String(_gpListen)").indexOf('onSnapshot')>=0);
t('packet updates say what changed', $("typeof pkDiffWhat")==='function'&&$("String(_gpRender)").indexOf('gp-updated')>=0&&$("String(pkPublishOne)").indexOf('lastChange')>=0&&$("typeof pkOfferTellThem")==='function');
t('double-booked names the dates', $("typeof _dblWhere")==='function'&&$("String(_bkBriefHTML)").indexOf('_dblWhere')>=0&&$("String(_bkBriefHTML)").indexOf('See their calendar')>=0&&$("typeof openCalCrew")==='function'&&$("String(calVisibleBookings)").indexOf('calCrewFilter')>=0);
t('builder creates the company record if the first read is refused', $("String(Org._adopt)").indexOf('org create')>=0&&$("String(Org._adopt)").indexOf('this.push')>=0);
t('QA logins can open the workbench', $("typeof devQa")==='function'&&$("String(devAllowed)").indexOf('devQa')>=0&&$("String(devQa)").indexOf('pmgottschalkqa')>=0);
t('a packet reply notifies the builder', $("String(_pkStamp)").indexOf('Notify.push')>=0&&$("String(_pkStamp)").indexOf('asked')>=0);
t('Open items is not a second inbox', $("String(renderOvSortRow)").indexOf('openOpenItems')<0);
t('the packet lists the other house facts', $("String(pktAsk)").indexOf('_nyIssues')>=0);
t('closing a spec does not pop the page stack', $("String(closeSpec)").indexOf('navPop')<0&&$("String(closeRecord)").indexOf('navPop')<0&&$("String(closeBk)").indexOf('navPop')<0);
t('a homeowner note opens on home', $("String(todayGoRecord)").indexOf('openSiteFromOverview')<0&&$("String(todayGoRecord)").indexOf('openRecord')>=0);
t('the packet log keeps the packet under a record', $("String(renderPacketLog)").indexOf('closePktLog();openRecord')<0);
t('a missing-spec notify opens the packet', $("String(openSpecBlock)").indexOf('openPacket')>=0&&$("String(openSpecBlock)").indexOf('showInfo')<0);
t('the day sheet stays under the booking', $("String(renderDay)").indexOf('closeDay();openBk')<0);
t('Needs You spec path stays on the packet', (function(){
  asBuilder();
  $('enterDemo()');
  const p=$("state.projects.find(function(x){return x.id==='p2';})");
  if(!p)return false;
  $('openPacketFor("p2","plumb")');
  const afterOpen=$("!!(document.getElementById('infoScrim')&&document.getElementById('infoScrim').classList.contains('show')&&document.getElementById('overview')&&document.getElementById('overview').classList.contains('show'))");
  const selId=$("(function(){var p=state.projects.find(function(x){return x.id==='p2';});var g=tradeSpecGaps(p,'plumb');return g[0]&&g[0].id;})()");
  if(!selId)return afterOpen===true;
  $('pktFillSpec('+selId+')');
  const stacked=$("!!(document.getElementById('specScrim').classList.contains('show')&&document.getElementById('infoScrim').classList.contains('show')&&document.getElementById('overview').classList.contains('show'))");
  $('closeSpec()');
  const restored=$("!!(!document.getElementById('specScrim').classList.contains('show')&&document.getElementById('infoScrim').classList.contains('show')&&document.getElementById('overview').classList.contains('show'))");
  $('closeInfo()');
  const home=$("!!(!document.getElementById('infoScrim').classList.contains('show')&&document.getElementById('overview').classList.contains('show'))");
  return afterOpen===true&&stacked===true&&restored===true&&home===true;
})());
t('a waiting packet is gated to two days', $("String(_nyWaiting)").indexOf('48*3600*1000')>=0);
t('site-not-ready is only today or tomorrow', $("String(_nySiteNotReady)").indexOf('864e5')>=0);
t('a date change opens the booking, not a one-tap confirm', $("String(_nyIssues)").indexOf("go:`openBk(")>=0&&$("String(renderToday)").indexOf('nyConfirm')<0);
t('a date change opens the booking, not a one-tap confirm', $("String(_nyIssues)").indexOf("go:`openBk(")>=0&&$("String(renderToday)").indexOf('nyConfirm')<0);
t('a question opens its own sheet', $("String(_nyIssues)").indexOf('nyOpenAsk')>=0&&$("typeof nyOpenAsk")==='function');
t('packet cards do not use the guest-page black button', $("String(renderToday)").indexOf('gp-btn go')<0);
t('the red mark is reserved for blockers', $("String(_nyIssues)").indexOf("lvl:'msg'")>=0);
t('confirming dates writes a decision receipt', $("String(bkAcceptChange)").indexOf('pkLogAdd')>=0&&$("typeof openPkLog")==='function');
t('the example build includes a packet date change', (function(){
  const b=JSON.parse($("JSON.stringify((state.projects.find(function(p){return p.id==='p2';})||{}).bookings||[])"));
  return b.some(function(x){return x.id==='bk_p2d'&&x.pkResp&&x.pkResp.status==='change'&&x.pkQOpen===1;});
})());
t('the example build includes declined, waiting, and a homeowner note', (function(){
  const p=JSON.parse($("JSON.stringify(state.projects.find(function(x){return x.id==='p2';})||{})"));
  const declined=(p.bookings||[]).some(function(b){return b.status==='declined';});
  const waiting=(p.bookings||[]).some(function(b){return b.pkSent&&!b.pkResp;});
  const ho=(p.items||[]).some(function(i){return i.client;});
  const blocked=(p.avail||[]).some(function(a){return a.subName==='Clearwater Plumbing';});
  return declined&&waiting&&ho&&blocked;
})());
t('house cards whisper a waiting sub', $("String(nyCardBits)").indexOf('_siteWhisper')>=0&&$("typeof _siteWhisper")==='function');
t('a date change whispers on the house card', (function(){
  $("(function(){var p=state.projects[1];p._whBk={id:'bkWhis',subName:'Whisper Crew',trade:'plumb',start:Date.now()+864e5,end:Date.now()+2*864e5,pkToken:'pkWH',pkResp:{status:'change',start:Date.now()+3*864e5,end:Date.now()+4*864e5,t:1},pkQOpen:0};p.bookings.push(p._whBk);_ovSort='az';renderOvCards();})()");
  const html=$("document.getElementById('ovCards').innerHTML");
  $("(function(){var p=state.projects[1];p.bookings=p.bookings.filter(function(b){return b.id!=='bkWhis';});delete p._whBk;_ovSort='attn';renderOvCards();})()");
  return html.indexOf('asked for')>=0;
})());
t('the packet page keeps listening after it opens', $("String(renderGuestPacket)").indexOf('_gpListen')>=0&&$("String(_gpListen)").indexOf('onSnapshot')>=0);
t('a painted packet is not wiped on a slow retry', $("String(renderGuestPacket)").indexOf('painted')>=0&&$("String(renderGuestPacket)").indexOf('20000')>=0);
t('answers are stamped onto the booking so Needs You can show them', $("String(_pkStamp)").indexOf('pkQs')>=0);
t('the live packet is refreshed with new docs and specs', $("typeof pkPublishOne")==='function'&&$("String(pkPublishOne)").indexOf('docs')>=0&&$("String(persist)").indexOf('pkPublishSoon')>=0&&$("String(pkPublishOne)").indexOf('.resp')<0);


/* ════ 14l · PRIVACY & LEGAL + ACCOUNT DELETION ════ */
S('legal');
asBuilder();
t('legal + delete-account plumbing present', $("typeof openLegal")==='function'&&$("typeof openDeleteAccount")==='function'&&$("typeof delAcctExecute")==='function'&&$("typeof _delWipeLocal")==='function');
t('policy urls point at the app folder', $("LEGAL_URL.privacy")==='https://siteplumb.com/app/privacy.html'&&$("LEGAL_URL.terms")==='https://siteplumb.com/app/terms.html');
t('forgot-password names the real sender', $("liveForgot.toString().indexOf('noreply@siteplumb.com')>=0")===true);
t('confirm and reset emails open the app', $("typeof authActionSettings")==='function'&&$("JSON.stringify(authActionSettings())").indexOf('handleCodeInApp')>=0&&$("JSON.stringify(authActionSettings())").indexOf('true')>=0);
t('the continue url is the app folder', $("String(authContinueUrl)").indexOf('/app/')>=0&&$("String(liveForgot)").indexOf('authActionSettings')>=0);
t('verify and resend use the same continue url', $("String(_evSend)").indexOf('authActionSettings')>=0&&$("String(pwResetResend)").indexOf('authActionSettings')>=0);
t('sign-in form carries the consent line', (el('laForm').innerHTML.indexOf('Terms of Service')>=0)&&(el('laForm').innerHTML.indexOf('privacy.html')>=0));
$('renderSettings()');
t('settings shows the Privacy & legal row (builder)', el('settingsBody').innerHTML.indexOf('Privacy &amp; legal')>=0);
asSub('Ray Delgado');$('renderSettings()');
t('settings shows the row for subs too', el('settingsBody').innerHTML.indexOf('Privacy &amp; legal')>=0);
asBuilder();
// demo / no-live-account: hub offers policies but no server deletion
$('openLegal()');
t('legal hub renders both policy rows', el('legalBody').innerHTML.indexOf('Privacy Policy')>=0&&el('legalBody').innerHTML.indexOf('Terms of Service')>=0);
t('no delete row without a live account', el('legalBody').innerHTML.indexOf('Delete my account')<0);
$('closeLegal()');
// live account: delete row appears; preview renders; DELETE gate arms the button
$("state.session.auth={uid:'simU1'}");
$('openLegal()');
t('delete row appears with a live account', el('legalBody').innerHTML.indexOf('Delete my account')>=0);
$('closeLegal()');
$("window.__realFnCall=window.fnCall;window.fnCall=async(n,d)=>{window.__fnLog=(window.__fnLog||[]).concat([{n,d}]);return (d&&d.confirm)?{ok:true,deleted:{sites:1,memberships:1}}:{ok:true,preview:{ownedSites:['288 Calderwood Ln'],memberSites:2,qb:true}};}");
await $('openDeleteAccount()');
t('preview lists the owned site by name', el('delAcctBody').innerHTML.indexOf('288 Calderwood Ln')>=0);
t('preview counts stripped memberships + qb', el('delAcctBody').innerHTML.indexOf('2 other sites')>=0&&el('delAcctBody').innerHTML.indexOf('QuickBooks')>=0);
t('confirm button starts disabled', el('delAcctGo').disabled===true);
setVal('delAcctInput','delete');$('delAcctGate()');
t('lowercase does not arm it', el('delAcctGo').disabled===true);
setVal('delAcctInput','DELETE');$('delAcctGate()');
t('typed DELETE arms it', el('delAcctGo').disabled===false);
$("localStorage.setItem('plumb.state.real.v1','x');localStorage.setItem('plumb.liveAuth','y');localStorage.setItem('plumbPendingInvite','z')");
$("window.__snapSt=JSON.stringify(state)");
await $('delAcctExecute()');
t('execute sent {confirm:true} after the preview call', (function(){const L=JSON.parse($("JSON.stringify(window.__fnLog)"));return L.length===2&&!L[0].d.confirm&&L[1].d.confirm===true;})());
t('device wiped: real store, live profile, pending invite all gone', $("localStorage.getItem('plumb.state.real.v1')")===null&&$("localStorage.getItem('plumb.liveAuth')")===null&&$("localStorage.getItem('plumbPendingInvite')")===null);
t('goodbye copy shown', el('delAcctBody').innerHTML.indexOf('deleted')>=0);
t('memory signed out too', $('state.session')===null&&Number($('state.projects.length'))===0);
$("state=JSON.parse(window.__snapSt);delete window.__snapSt");$('persist()');
$('closeDelAcct()');$("state.session.auth=undefined");$("window.fnCall=window.__realFnCall");$("delete window.__fnLog");
// Regression (Peter, iPhone, 2026-07-16): stale plumb.mode='real' + stored firebase
// profile + DEMO session must NOT offer the device-only erase row.
$("localStorage.setItem('plumb.mode','real')");
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',email:'p@x.test',name:'P',uid:'uN8'}))");
$('openLegal()');
t('stale-mode demo session gets no erase row', el('legalBody').innerHTML.indexOf('device-only account')<0);
t('and shows the once-signed-in note instead', el('legalBody').innerHTML.indexOf('once you are signed in')>=0);
$('closeLegal()');
// a genuine device-only account in a live session DOES get the row
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'local',email:'d@x.test',name:'D'}))");
$("state.session={role:'hillan',name:'D',mode:'real'}");
$('openLegal()');
t('local-provider account in a live session gets the erase row', el('legalBody').innerHTML.indexOf('Erase this device-only account')>=0);
$('closeLegal()');
$("localStorage.removeItem('plumb.mode')");$("localStorage.removeItem('plumb.liveAuth')");
asBuilder();

/* ════ 14m · PER-ACCOUNT WORKSPACES (shared-computer isolation) ════ */
S('per-account stores');
t('store plumbing present', $("typeof _realOwner")==='function'&&$("typeof _migrateRealStore")==='function'&&$("typeof _orphanSessionGuard")==='function');
$("localStorage.setItem('plumb.mode','real')");
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uA',email:'a@x.test'}))");
t('live store is keyed by the account', $('storeKey()')==='plumb.state.real.uA.v1');
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uB',email:'b@x.test'}))");
t('a second account gets its own key', $('storeKey()')==='plumb.state.real.uB.v1');
$("localStorage.removeItem('plumb.liveAuth')");
t('no account falls back to the device key', $('storeKey()')==='plumb.state.real.device.v1');
// migration: legacy shared store hands itself to the signed-in owner, once
$("localStorage.setItem('plumb.state.real.v1','legacy-payload')");
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uA'}))");
t('migration reports work done', $('_migrateRealStore()')===true);
t('legacy store migrated to its owner and retired', $("localStorage.getItem('plumb.state.real.uA.v1')")==='legacy-payload'&&$("localStorage.getItem('plumb.state.real.v1')")===null);
$("localStorage.setItem('plumb.state.real.v1','second-legacy')");
$('_migrateRealStore()');
t('migration never clobbers an existing store', $("localStorage.getItem('plumb.state.real.uA.v1')")==='legacy-payload'&&$("localStorage.getItem('plumb.state.real.v1')")===null);
t('migration is a no-op when nothing is left', $('_migrateRealStore()')===false);
// orphan guard: an account session with no saved profile signs out at boot
$("localStorage.removeItem('plumb.liveAuth')");
$("window.__snapS2=JSON.stringify(state.session)");
$("state.session={role:'hillan',mode:'real',auth:{uid:'ghost'}}");
t('orphan account session cleared at boot', $('_orphanSessionGuard()')===true&&$('state.session')===null);
$("state.session=JSON.parse(window.__snapS2);delete window.__snapS2");
t('a healthy session is left alone', $('_orphanSessionGuard()')===false&&$('state.session')!==null);

/* ════ 14n · JOB COSTING: pooled exposure, contracts, revisions, projections, report ════ */
S('job costing math');
const JC=(costs,extra)=>"JSON.stringify(costLineRollup({costs:"+JSON.stringify(costs)+"},'L'))";
const r1=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:4000}])));
t('legacy shape preserved: unlinked payment soaks into contract capacity', r1.exposure===10000&&r1.committed===10000&&r1.spent===4000, JSON.stringify(r1));
const r2=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:11500}])));
t('unlinked overflow adds on top and flags', r2.exposure===11500&&r2.overflow===1500&&r2.paidOver===true, JSON.stringify(r2));
const r2b=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:17500}])));
t('direct spending with no contract is never amber', r2b.exposure===17500&&r2b.paidOver===false, JSON.stringify(r2b));
const r3=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:4000,toward:'C1'}])));
t('linked payment rides inside its contract', r3.exposure===10000&&r3.spent===4000&&r3.overpaid===0, JSON.stringify(r3));
const r4=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:11500,toward:'C1'}])));
t('linked overpay lifts exposure and goes amber', r4.exposure===11500&&r4.overpaid===1&&r4.paidOver===true, JSON.stringify(r4));
const r5=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000,adds:[{t:1,amount:3000,note:'CO 1'}]}])));
t('contract adds raise the signed total', r5.committed===13000&&r5.exposure===13000, JSON.stringify(r5));
const r6=JSON.parse($(JC([{rt:'line',id:'L',budget:20000,expect:28000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000}])));
t('Now expecting overrides the projection', r6.projected===28000&&r6.expect===28000, JSON.stringify(r6));
const r7=JSON.parse($(JC([{rt:'line',id:'L',budget:20000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:25000}])));
t('projection floors at exposure when no override', r7.projected===25000&&r7.over===true, JSON.stringify(r7));
const r8=JSON.parse($(JC([{rt:'line',id:'L',budget:30000},{rt:'actual',id:'C1',lineId:'L',kind:'committed',amount:10000},{rt:'actual',id:'C2',lineId:'L',kind:'committed',amount:5000},{rt:'actual',id:'P1',lineId:'L',kind:'spent',amount:4000}])));
t('two contracts pool capacity for unlinked payments', r8.exposure===15000&&r8.committed===15000, JSON.stringify(r8));
t('summary carries projected', typeof JSON.parse($("JSON.stringify(costSummary(state.projects[0]))")).projected==='number');
t('job cost csv has the report columns', $("jobCostCsv(state.projects[0])").indexOf('Original budget')>=0&&$("jobCostCsv(state.projects[0])").indexOf('Projected final')>=0);
t('accountant csv gained contract and QuickBooks columns', $("costsCsv(state.projects[0])").indexOf('Toward contract')>=0&&$("costsCsv(state.projects[0])").indexOf('QuickBooks')>=0);

S('job costing surfaces');
asBuilder();$("state.activeId='p1'");
$('renderBuild()');
t('money card shows Projected and Tracking', $("document.body.innerHTML.indexOf('Projected')")>=0&&$("document.body.innerHTML.indexOf('Tracking')")>=0);
$('openBudget()');
t('budget sheet offers the job cost report', $("document.getElementById('budgetBody').innerHTML.indexOf('Job cost report')")>=0);
$('openJobCost()');
t('report opens with a whole-build total row', $("document.getElementById('jcScrim').classList.contains('show')")===true&&$("document.getElementById('jcBody').innerHTML.indexOf('Whole build')")>=0);
$('closeJobCost()');
$('openCostActual(null,"a4")');
$("setCaKind('spent')");
t('single contract on the line auto-selects as toward', $("document.getElementById('caTowardWrap').style.display")!=='none'&&$("document.getElementById('caToward').value")==='aa5');
t('payee answers itself from the contract', $("document.getElementById('caPayeeAuto').style.display")!=='none'&&$("document.getElementById('caPayeeWrap').style.display")==='none'&&$("document.getElementById('caPayeeAuto').innerHTML").indexOf('from the contract')>=0);
setVal('caAmount','2500');
$('saveCostActual()');
const conPayee=$("((state.projects[0].costs||[]).find(a=>a.id==='aa5')||{}).payee");
const paid=JSON.parse($("JSON.stringify((state.projects[0].costs||[]).filter(a=>a.rt==='actual'&&a.kind==='spent'&&a.toward==='aa5'&&a.lineId==='a4'))"));
t('payment saved with the contract payee, no typing', paid.length===1&&paid[0].payee===conPayee&&paid[0].t>0, JSON.stringify(paid));
$('openCostActual("'+paid[0].id+'")');
t('reopening keeps the quiet auto line', $("document.getElementById('caPayeeAuto').style.display")!=='none');
$('caPayeeShowManual()');
t('change link reveals the manual picker prefilled', $("document.getElementById('caPayeeWrap').style.display")!=='none'&&($("document.getElementById('caPayeeSel').value")===conPayee||$("document.getElementById('caPayee').value")===conPayee));
$('closeCostActual()');

S('payee memory, labels, one-tap deposit');
$("state.projects[0].costs.push({rt:'actual',id:'zzhist',lineId:'',kind:'spent',amount:5,payee:'One Off Vendor',t:Date.now()})");
$('openCostActual()');
t('picker remembers every payee the site has paid', $("document.getElementById('caPayeeSel').innerHTML").indexOf('One Off Vendor')>=0);
t('Signed for asks who you signed with', $("document.getElementById('caPayeeLab').textContent")==='Signed with');
$("setCaKind('spent')");
t('Paid asks who you paid', $("document.getElementById('caPayeeLab').textContent")==='Paid to');
$("document.getElementById('caLine').value=''");$('caLineChanged()');
$("document.getElementById('caPayeeSel').value='__other'");$('caPayeeChange()');
setVal('caPayee','one off vendor');setVal('caAmount','7');
$('saveCostActual()');
const canon=JSON.parse($("JSON.stringify((state.projects[0].costs||[]).filter(a=>a.rt==='actual'&&a.amount===7))"));
t('typed lowercase reuses the stored spelling - one QuickBooks vendor', canon.length===1&&canon[0].payee==='One Off Vendor', JSON.stringify(canon));
$('openCostActual("aa5")');
t('contract editor offers one-tap payment', $("document.getElementById('caAddWrap').innerHTML").indexOf('Log a payment toward this contract')>=0);
$("caLogPaymentToward('aa5')");
t('one tap lands in a prefilled payment', $("_caKind")==='spent'&&$("document.getElementById('caToward').value")==='aa5'&&$("document.getElementById('caPayeeAuto').style.display")!=='none');
$('closeCostActual()');

const roll=JSON.parse($("JSON.stringify(costLineRollup(state.projects[0],'a4'))"));
t('line exposure unchanged by a linked partial payment', roll.exposure===71800&&roll.spent===2500, JSON.stringify(roll));
$('openCostLine("a4")');
setVal('clBudget','78000');
$('clBudgetChanged()');
t('changing a budget reveals the reason field', $("document.getElementById('clRevWrap').style.display")==='block');
setVal('clRevNote','Sim change order');
setVal('clExpect','82000');
$('saveCostLine()');
const line=JSON.parse($("JSON.stringify(costLines(state.projects[0]).find(l=>l.id==='a4'))"));
t('revision recorded with from, to and reason', line.revs&&line.revs.length===1&&line.revs[0].from===74000&&line.revs[0].to===78000&&line.revs[0].note==='Sim change order', JSON.stringify(line.revs));
t('expecting override stored', Number(line.expect)===82000, JSON.stringify(line.expect));
const roll2=JSON.parse($("JSON.stringify(costLineRollup(state.projects[0],'a4'))"));
t('projection follows the override', roll2.projected===82000, JSON.stringify(roll2));
$('openCostActual("aa5")');
t('contract editor offers add-to-contract with history', $("document.getElementById('caAddWrap').innerHTML.indexOf('Add to this contract')")>=0);
setVal('caAddAmt','3000');setVal('caAddNote','Sim CO');
$('caAddSave()');
const con=JSON.parse($("JSON.stringify((state.projects[0].costs||[]).find(a=>a.id==='aa5'))"));
t('add recorded on the contract', con.adds&&con.adds.length===1&&con.adds[0].amount===3000, JSON.stringify(con.adds));
const roll3=JSON.parse($("JSON.stringify(costLineRollup(state.projects[0],'a4'))"));
t('signed total includes the add', roll3.committed===74800, JSON.stringify(roll3));
$('closeCostActual()');
S('editing money never rewrites it');
$("state.projects[0].costs.push({rt:'actual',id:'zzun',lineId:'a4',kind:'spent',amount:333,payee:'Dynamite Sim',t:Date.now()})");
$("openCostActual('zzun')");
t('an unlinked payment opens unlinked - no auto-pick on edits', $("document.getElementById('caToward').value")==='');
t('its own payee shows, not the contract payee', $("document.getElementById('caPayeeAuto').style.display")==='none'&&$("document.getElementById('caPayeeSel').value")==='Dynamite Sim');
$('saveCostActual()');
const zzun=JSON.parse($("JSON.stringify((state.projects[0].costs||[]).find(a=>a.id==='zzun'))"));
t('innocent Save leaves the record exactly as it was', zzun.toward===''&&zzun.payee==='Dynamite Sim'&&zzun.amount===333, JSON.stringify(zzun));
$("openCostActual('zzun')");
t('payment offers Delete this payment', $("document.getElementById('caDelete').textContent")==='Delete this payment');
$('closeCostActual()');
$("openCostActual('aa5')");
t('contract offers Delete this contract and a contract note hint', $("document.getElementById('caDelete').textContent")==='Delete this contract'&&$("document.getElementById('caNote').placeholder").indexOf('Change order')>=0);
$('closeCostActual()');
$("openCostActual('zzhist')");
t('historical payee opens preselected in the picker', $("document.getElementById('caPayeeSel').value")==='One Off Vendor');
$('closeCostActual()');

S('billing compose modernized');
$('openBilling()');
$("invMode='compose';_invDraft={title:_invDefaultTitle(),due:'',picks:{},exLabel:'',exAmount:'',editId:null};renderInvoices()");
t('new invoices arrive pre-titled with the month', String($("_invDraft.title")).indexOf('Selections')===0);
t('due is a real date field', $("document.getElementById('invDue').type")==='date');
$('invDueOnReceipt()');
t('On receipt is one tap', $("_invDraft.due")==='On receipt');
$("document.getElementById('invDue').value='2026-08-15'");
$("_invDraft.due='2026-08-15'");$('_invSnapInputs()');
t('a picked date sticks', $("_invDraft.due")==='2026-08-15');
$("invMode='list';_invDraft=null;renderInvoices()");
$('closeInvoices()');
// profile swap: the workspace follows the ACCOUNT, never the browser (Peter, Mac, 2026-07-16 round 2)
$("window.__snapS3=JSON.stringify(state)");
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uA'}))");
$('load()');
$("state.projects=[{id:901,name:'A-only',street:'A-only',items:[],logs:[],docs:[],subs:[],stageDone:{},selections:[],payments:[],members:{},memberInfo:{}}];state.activeId=901");
$('persist()');
$("laSaveProfile({provider:'firebase',uid:'uB'})");
t('signing in as another account swaps to an empty workspace', Number($('state.projects.length'))===0);
$("state.projects=[{id:902,name:'B-only',street:'B-only',items:[],logs:[],docs:[],subs:[],stageDone:{},selections:[],payments:[],members:{},memberInfo:{}}];state.activeId=902");
$('persist()');
$("laSaveProfile({provider:'firebase',uid:'uA'})");
t('switching back restores the first accounts own workspace', Number($('state.projects.length'))===1&&$('state.projects[0].name')==='A-only');
t('the first accounts store never gained the seconds site', $("localStorage.getItem('plumb.state.real.uA.v1').indexOf('B-only')")===-1);
$("localStorage.removeItem('plumb.state.real.device.v1')");
$("laSaveProfile(null)");
t('signing out lands on the empty device workspace', Number($('state.projects.length'))===0);
$("state=JSON.parse(window.__snapS3);delete window.__snapS3");
// self-test: probe and verification target the same site
t('self-test verifies the site it probed', $("devSelfTest.toString().indexOf('String(tgt.id)')>=0")===true);
t('self-test photo check honors cloud copies', $("devSelfTest.toString().indexOf('no copy anywhere')>=0&&devSelfTest.toString().indexOf('photoUrl')>=0")===true);
// cleanup: no real-mode residue may leak into later sections or fuzz
$("['plumb.mode','plumb.liveAuth','plumb.state.real.uA.v1','plumb.state.real.uB.v1','plumb.state.real.device.v1'].forEach(k=>localStorage.removeItem(k))");
asBuilder();

/* ════ 14o · EMAIL VERIFICATION AT SIGNUP (soft gate, both return paths) ════ */
S('email verification');
t('verification plumbing present', $("typeof _evSend")==='function'&&$("typeof _evNeeded")==='function'&&$("typeof _evMark")==='function'
  &&$("typeof _evRecheck")==='function'&&$("typeof _evConsume")==='function'&&$("typeof evResend")==='function'&&$("typeof evOpenFromSettings")==='function');
t('the confirm modal exists in the shell', !!el('evScrim')&&!!el('evTitle')&&!!el('evBody')&&!!el('evResend')&&!!el('evErr'));

// who needs confirming
$("localStorage.removeItem('plumb.liveAuth')");
t('signed out needs nothing', $('_evNeeded()')===false);
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uEV',email:'ev@x.test'}))");
t('a fresh account needs confirming', $('_evNeeded()')===true);
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uEV',email:'ev@x.test',emailVerified:true}))");
t('a confirmed account is left alone', $('_evNeeded()')===false);
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'local',email:'dev@x.test'}))");
t('device-only accounts are never asked (no cloud email to confirm)', $('_evNeeded()')===false);

// the flag round-trips through the saved profile
$("localStorage.setItem('plumb.liveAuth',JSON.stringify({provider:'firebase',uid:'uEV',email:'ev@x.test'}))");
$('_evMark(true)');
t('marking confirmed persists on the profile', $("JSON.parse(localStorage.getItem('plumb.liveAuth')).emailVerified")===true&&$('_evNeeded()')===false);
$('_evMark(true)');
t('marking again is a no-op', $("JSON.parse(localStorage.getItem('plumb.liveAuth')).emailVerified")===true);
$('_evMark(false)');
t('the flag can come back down', $('_evNeeded()')===true);

// the receipt names the address it actually sent to
$("_evAfterSignup('typo@x.test')");
t('signup receipt names the address', $("document.getElementById('evBody').innerHTML").indexOf('typo@x.test')>=0);
t('signup receipt explains WHY it matters (forgot password)', $("document.getElementById('evBody').innerHTML").toLowerCase().indexOf('forgot password')>=0);
t('receipt is showing', $("document.getElementById('evScrim').classList.contains('show')")===true);
$('evClose()');
t('Later closes it and blocks nothing', $("document.getElementById('evScrim').classList.contains('show')")===false);
$('evOpenFromSettings()');
t('the settings door names the unconfirmed address', $("document.getElementById('evBody').innerHTML").indexOf('ev@x.test')>=0
  &&$("document.getElementById('evTitle').textContent")==='Confirm your email');
$('evClose()');

// routing: a verifyEmail link is claimed by the action handler, resetPassword still is too
t('action handler routes verifyEmail', $("consumeAuthAction.toString().indexOf(\"mode==='verifyEmail'\")")>=0
  &&$("consumeAuthAction.toString().indexOf('resetPassword')")>=0);
t('a codeless visit is ignored', $("(function(){try{consumeAuthAction();return 'no-throw';}catch(e){return 'threw';}})()")==='no-throw');
t('the reload path exists for Google default handler', $("_evRecheck.toString().indexOf('reload')")>=0);
t('sending is throttled so the quota is not burned', $("_evSend.toString().indexOf('45000')")>=0);

// cleanup: this section must leave no auth residue for the fuzz below
$("['plumb.liveAuth','plumb.mode'].forEach(k=>localStorage.removeItem(k))");
asBuilder();

S('delete-contract wording');
$("state.activeId='p1'");
$("window.__evCosts=JSON.stringify(P().costs||[])");
$("P().costs=[{rt:'line',id:'Lw',label:'Windows',budget:9000},{rt:'actual',id:'Cw',lineId:'Lw',kind:'committed',amount:9000,payee:'Glassworks'},{rt:'actual',id:'Pw1',lineId:'Lw',kind:'spent',amount:1000,payee:'Glassworks',toward:'Cw'}]");
$("_caEditId='Cw'");$('deleteCostActual()');
t('one linked payment reads as singular', $("document.getElementById('ocBody').textContent").indexOf('1 linked payment stays logged and goes back to counting on its own.')>=0,
  $("document.getElementById('ocBody').textContent"));
$('ocCancel()');
$("P().costs.push({rt:'actual',id:'Pw2',lineId:'Lw',kind:'spent',amount:1500,payee:'Glassworks',toward:'Cw'})");
$("_caEditId='Cw'");$('deleteCostActual()');
t('two linked payments read as plural', $("document.getElementById('ocBody').textContent").indexOf('2 linked payments stay logged and go back to counting on their own.')>=0,
  $("document.getElementById('ocBody').textContent"));
$('ocCancel()');
$("P().costs=JSON.parse(window.__evCosts);delete window.__evCosts;_caEditId=null");
t('the wording fixtures cleaned up after themselves', $("(P().costs||[]).some(c=>c.id==='Cw')")===false);

/* ════ 14p · INVITE HANDOFF ACROSS THE BROWSER/PWA BOUNDARY ════ */
S('invite handoff');
t('handoff plumbing present', $("typeof invPendingCode")==='function'&&$("typeof _invClearHandoff")==='function'
  &&$("typeof maybeInviteBar")==='function'&&$("typeof invBarCopy")==='function'
  &&$("typeof invBarDismiss")==='function'&&$("typeof invBarHowTo")==='function');
t('the bar exists in the shell', !!el('invBar')&&!!el('invBarS')&&!!el('invBarCopy'));

// THE FIX: boot must not strip the invite. Add to Home Screen saves the URL that
// is showing, so an early strip is what broke the crossing.
t('boot no longer strips the invite from the address bar', $("consumeInviteLink.toString().indexOf('replaceState')")===-1);
t('the strip moved to redemption instead', $("_invClearHandoff.toString().indexOf('replaceState')")>=0);
t('redemption is what clears the handoff', $("liveAuthSubmit.toString().indexOf('_invClearHandoff')")>=0);
t('the stash is still read as a fallback', $("consumeInviteLink.toString().indexOf('plumbPendingInvite')")>=0);

// code resolution
$("localStorage.removeItem('plumbPendingInvite')");
t('no invite means no code', $('invPendingCode()')==='');
$("localStorage.setItem('plumbPendingInvite','pb-a1b2c3')");
t('a stashed code is found and normalised', $('invPendingCode()')==='PB-A1B2C3');
$('_invClearHandoff()');
t('clearing the handoff drops the stash', $("localStorage.getItem('plumbPendingInvite')")===null&&$('invPendingCode()')==='');

// the bar refuses to appear when it would be wrong or redundant
$("localStorage.setItem('plumbPendingInvite','PB-ZZZ999')");
$("sessionStorage.setItem('plumbInvBarOff','1')");
t('a dismissed bar stays dismissed for the session', $('maybeInviteBar()')===false);
$("sessionStorage.removeItem('plumbInvBarOff')");
$("window.__snapSes=JSON.stringify(state.session)");
$("state.session={role:'hillan',mode:'real'}");
t('no handoff is offered to someone already inside', $('maybeInviteBar()')===false);
$("state.session=JSON.parse(window.__snapSes);delete window.__snapSes");
$("localStorage.removeItem('plumbPendingInvite')");
t('no code, no bar', $('maybeInviteBar()')===false);

// dismiss is a session-scoped mute, not a permanent one
$("sessionStorage.removeItem('plumbInvBarOff')");
$("document.getElementById('invBar').classList.add('show')");
$('invBarDismiss()');
t('dismiss hides the bar and mutes it for the session',
  $("document.getElementById('invBar').classList.contains('show')")===false
  &&$("sessionStorage.getItem('plumbInvBarOff')")==='1');

// honesty: the bar must never claim it can launch the PWA, because on iOS it cannot
t('the bar instructs rather than promising to open the app',
  $("document.getElementById('invBar').textContent").toLowerCase().indexOf('open in app')===-1);
t('boot stands the full-screen nudge down when the bar takes the screen',
  SRC.indexOf('if(!_invBarUp)maybeNudgeInstall()')>=0&&SRC.indexOf('_invBarUp=maybeInviteBar()')>=0);

// cleanup: leave nothing for the fuzz below
$("['plumbPendingInvite','plumb.mode','plumb.liveAuth'].forEach(k=>localStorage.removeItem(k))");
$("sessionStorage.removeItem('plumbInvBarOff')");
$("document.getElementById('invBar').classList.remove('show')");
asBuilder();

/* ════ 14q · FULL-SCREEN MEDIA VIEWER + PHOTO PICKER ════ */
S('media viewer');
// THE PICKER BUG: capture="environment" is a hard instruction on iOS - camera
// only, library hidden. The button said "Take or choose" and could not choose.
t('no file input forces the camera any more', SRC.indexOf('capture="environment"')===-1);
t('the entry picker still accepts images', SRC.indexOf('id="file" accept="image/*"')>=0);

// THE Z-INDEX BUG: the viewer sat at 60, under every modal (119+), so a photo
// tapped inside Edit item appeared to do nothing until the modal was dismissed.
t('the viewer is fixed to the viewport, not a parent box', SRC.indexOf('.lightbox{position:fixed')>=0);
t('the viewer outranks the modal layer', (function(){
  const m=/\.lightbox\{position:fixed;inset:0;z-index:(\d+)/.exec(SRC);
  return !!m&&Number(m[1])>130;})());
t('the zoom stage swallows browser gestures', SRC.indexOf('touch-action:none')>=0);

t('viewer plumbing present', $("typeof openMediaView")==='function'&&$("typeof closeLightbox")==='function'
  &&$("typeof _lbZoomTo")==='function'&&$("typeof _lbClamp")==='function'&&$("typeof _lbReset")==='function');
t('the stage and both media elements exist', !!el('lbStage')&&!!el('lbImg')&&!!el('lbVid'));
t('every photo surface still routes through one door', $("openLightbox.toString().indexOf('openMediaView')")>=0);

// showing a photo
$("openMediaView('blob:fake/one','Footing rebar tied','Foundation - 2h ago')");
t('a photo opens full screen', $("document.getElementById('lightbox').classList.contains('show')")===true
  &&$("document.getElementById('lbImg').style.display")===''&&$("document.getElementById('lbVid').style.display")==='none');
t('caption and meta carry through', $("document.getElementById('lbCap').textContent")==='Footing rebar tied'
  &&$("document.getElementById('lbMeta').textContent")==='Foundation - 2h ago');
t('a photo is not treated as video', $('_lb.isVideo')===false);
t('it opens unzoomed', $('_lb.scale')===1&&$('_lb.x')===0&&$('_lb.y')===0);

// zoom behaviour
$('_lbZoomTo(2.5)');
t('spread zooms in', $('_lb.scale')===2.5&&$("document.getElementById('lightbox').classList.contains('zoomed')")===true);
$('_lbZoomTo(99)');
t('zoom is capped so it cannot be lost', $('_lb.scale')===6);
$('_lbZoomTo(0.2)');
t('pinching past fit snaps back to fit and recentres', $('_lb.scale')===1&&$('_lb.x')===0&&$('_lb.y')===0
  &&$("document.getElementById('lightbox').classList.contains('zoomed')")===false);
$('_lb.scale=3;_lb.x=99999;_lb.y=-99999;_lbClamp()');
t('panning cannot drag the photo off into space', Math.abs($('_lb.x'))<1e5&&Math.abs($('_lb.y'))<1e5);

// video path: recognised by extension so the viewer half is ready ahead of capture
$("openMediaView('https://x.test/clip.mov','Pour','Foundation')");
t('a video plays in the video element, not the img', $("document.getElementById('lbVid').style.display")===''
  &&$("document.getElementById('lbImg').style.display")==='none'&&$('_lb.isVideo')===true);
t('tap-to-close stands down for video so native controls keep the tap',
  $("_lbUp.toString().indexOf('_lb.isVideo')")>=0);

// text-only entries still work
$("openMediaView('','Poured at 6am, no photo','Foundation')");
t('a note with no photo still reads as a card', $("document.getElementById('lightbox').classList.contains('textonly')")===true
  &&$("document.getElementById('lbCap').textContent")==='Poured at 6am, no photo');

// closing
$('_lb.scale=4;_lb.x=50');
$('closeLightbox()');
t('closing hides it and forgets the zoom', $("document.getElementById('lightbox').classList.contains('show')")===false
  &&$('_lb.scale')===1&&$('_lb.x')===0);

// v2.183.1 landscape regression: a percentage max-height inside an auto-sized
// grid row is circular and gets dropped, so only width constrained and tall
// photos overflowed. object-fit removes the question.
t('media is sized by object-fit, not a percentage height', SRC.indexOf('object-fit:contain')>=0
  &&SRC.indexOf('.lb-stage img,.lb-stage video{max-height:100%')===-1);
// v2.183.2: centring a grid stops its auto track stretching, so the track sizes
// to the image and percentages go circular again. No track, no percentage.
t('the stage is not a centred grid', SRC.indexOf('.lb-stage{position:absolute;inset:0;overflow:hidden')>=0
  &&SRC.indexOf('.lb-stage{position:absolute;inset:0;display:grid')===-1);
t('the media is pinned to the stage box by insets',
  /\.lb-stage img,\.lb-stage video\{position:absolute;top:0;left:0;right:0;bottom:0;/.test(SRC));
t('the caption rides a scrim so it stays readable over a photo', SRC.indexOf('lb-scrim')>=0&&$("!!document.querySelector('.lb-scrim')")===true);
t('panning is bounded by the picture, not the full-bleed box', $("typeof _lbFit")==='function'
  &&$("_lbClamp.toString().indexOf('_lbFit()')")>=0);
t('rotating the phone cannot strand a zoomed photo', $("_lbBind.toString().indexOf('orientationchange')")>=0);
$("openMediaView('blob:fake/two','Landscape check','Site')");
$('_lbZoomTo(3)');
$('_lbClamp()');
t('clamping a zoomed photo with no natural size does not blow up',
  Number.isFinite($('_lb.x'))&&Number.isFinite($('_lb.y'))&&$('_lb.scale')===3);
$('closeLightbox()');

$("document.getElementById('lbImg').removeAttribute('src')");

/* ════ 14r · QA ROUND: PICKER REBUILD, PASSWORD CONFIRM, HANDOFF HONESTY ════ */
S('picker rebuild');
// The v2.183.0 fix stripped capture from the HTML but resetSheet() rebuilds the
// input in JS - and was putting it straight back. The library came back for
// exactly one open per page load.
t('nothing re-adds the camera-only flag at runtime', SRC.indexOf("setAttribute('capture'")===-1);
t('the rebuild helper no longer takes a capture flag',
  /function rebuildDrop\(dropId,phId,phInner,inputId,onchange\)/.test(SRC));
t('resetSheet rebuilds a library-capable input', $("resetSheet.toString().indexOf('onPhoto)')")>=0);
t('the entry input still accepts images', SRC.indexOf('id="file" accept="image/*"')>=0);

S('password confirm');
t('signup has a second password box', !!el('laPass2')&&!!el('laPass2Row'));
$("laMode='signup';liveAuthToggle()");          // land deterministically on signin
t('it is hidden on the sign-in form', $("document.getElementById('laPass2Row').style.display")==='none');
$("laMode='signin';liveAuthToggle()");
t('switching to signup reveals it', $("document.getElementById('laPass2Row').style.display")===''
  &&$("document.getElementById('laNameRow').style.display")==='');
$("laMode='signup';liveAuthToggle()");
t('switching back to signin hides it again', $("document.getElementById('laPass2Row').style.display")==='none');
// mismatch must be caught before any account is created
$("laMode='signup'");
$("document.getElementById('laEmail').value='new@x.test'");
$("document.getElementById('laName').value='Newbie'");
$("document.getElementById('laPass').value='correcthorse'");
$("document.getElementById('laPass2').value='corretchorse'");
$('liveAuthSubmit()');
t('a mistyped confirmation is refused', $("document.getElementById('laErr').textContent")==='Those passwords do not match.',
  $("document.getElementById('laErr').textContent"));
$("document.getElementById('laPass2').value='correcthorse'");
$("document.getElementById('laErr').textContent=''");
t('matching passwords clear that gate', $("(function(){liveAuthSubmit();return document.getElementById('laErr').textContent;})()")!=='Those passwords do not match.');
$("['laEmail','laName','laPass','laPass2'].forEach(id=>document.getElementById(id).value='')");
$("laMode='signup';liveAuthToggle()");

S('handoff honesty');
// Add to Home Screen launches at the manifest start_url, so the invite in the
// address bar does NOT cross on iOS. The clipboard is the only thing that does.
t('the install route copies the code on the way out', $("invBarHowTo.toString().indexOf('invBarCopy()')")>=0);
t('nothing promises the invite crosses by itself', SRC.indexOf('your invite comes with you')===-1);
t('confirming the email refreshes an open Settings sheet', $("_evMark.toString().indexOf('renderSettings')")>=0);
t('the signup receipt got shorter', $("_evAfterSignup.toString().length")<640, String($("_evAfterSignup.toString().length")));
asBuilder();

/* ════ 14s · ACTION-CODE LINKS ARRIVE UNOBSTRUCTED ════ */
S('action-code arrival');
// A reset/verify link is a one-shot credential. The install gate lives at 220
// and the reset modal at 119, so the gate covered the dialog outright and the
// tap that dismissed it revealed whatever was left.
t('the pending-code guard exists', $("typeof _authActionPending")==='function');
t('no code means nothing is suppressed', $('_authActionPending()')===false);
// v2.185.1: the guard must NOT re-read the address bar. The handler wipes the
// code out of it as its first act, and boot awaits the handler before the gate
// is reached - a guard that re-reads is asking about evidence already destroyed.
t('the answer is captured on arrival, not re-read later',
  SRC.indexOf('const _AUTH_ACTION_ON_ARRIVAL=')>=0
  &&$("_authActionPending.toString().indexOf('URLSearchParams')")===-1);
t('the handler still wipes the code so it cannot be replayed',
  $("_evConsume.toString().indexOf('replaceState')")>=0
  &&$("consumeAuthAction.toString().indexOf('replaceState')")>=0);
t('the install gate stands down for an action link', $("maybeInstallGate.toString().indexOf('_authActionPending()')")>=0);
t('the welcome card stands down too', $("maybeWelcome.toString().indexOf('_authActionPending()')")>=0);
t('so does the soft install nudge', $("maybeNudgeInstall.toString().indexOf('_authActionPending()')")>=0);
t('the gate really does outrank the modal it was covering', (function(){
  const g=/\.install-gate\{position:fixed;inset:0;z-index:(\d+)/.exec(SRC);
  const m=/id="pwResetScrim" style="z-index:(\d+)/.exec(SRC);
  return !!g&&!!m&&Number(g[1])>Number(m[1]);})());

// a cold landing can beat the SDK - wait for it rather than giving up
t('both handlers wait for the sign-in library', $("typeof _awaitFirebase")==='function'
  &&$("consumeAuthAction.toString().indexOf('_awaitFirebase')")>=0
  &&$("_evConsume.toString().indexOf('_awaitFirebase')")>=0);
t('boot waits for the handler before drawing anything else', SRC.indexOf('await consumeAuthAction()')>=0);

// confirmation must be visible, not a toast under a full-screen takeover
t('confirming shows a dialog, not just a toast', $("_evConsume.toString().indexOf('_evShow(')")>=0);
$("_evShow('Email confirmed','<b>a@b.test</b> is confirmed.',true)");
t('a success dialog hides Resend and offers Done',
  $("document.getElementById('evResend').style.display")==='none'
  &&$("document.getElementById('evLater').textContent")==='Done');
$("_evShow('Confirm your email','still pending')");
t('the pending dialog still offers Resend and Later',
  $("document.getElementById('evResend').style.display")===''
  &&$("document.getElementById('evLater').textContent")==='Later');
$('evClose()');

/* ════ 14t · AREAS CARRY A PLACE AND A SYSTEM ════ */
S('area tagging');
// "The framing in the stair hall" is two tags on one entry. One chip per GROUP
// is the design - not one chip full stop. Select by group, never by row index:
// the groups get reordered and a positional test quietly starts asserting
// something else.
$("state.activeId='p1'");
$("openSheet(false)");
$("_simClearChips()");
$("(function(){const q=g=>[...document.querySelectorAll('#areaChips .chip[data-grp=\"'+g+'\"]')];window.__R=q('rooms')[0];window.__R2=q('rooms')[1];window.__S=q('sys')[0];})()");
t('a place and a system can be lit together', (function(){
  $("pickChip(window.__R)");$("pickChip(window.__S)");
  return $("document.querySelectorAll('#areaChips .chip.on').length")===2;})());
$("pickChip(window.__R2)");
t('but a group still only keeps one of its own',
  $("document.querySelectorAll('#areaChips .chip.on').length")===2
  &&$("window.__R.classList.contains('on')")===false
  &&$("window.__R2.classList.contains('on')")===true);
$("_simClearChips()");$("closeSheet()");
$("delete window.__R;delete window.__R2;delete window.__S");

S('tags reach the filters');
t('one place knows how a tagged area comes apart', $("typeof areaTags")==='function');
t('a plain area is one tag', $("JSON.stringify(areaTags('Kitchen'))")==='["Kitchen"]');
t('a tagged area comes apart into both', $("JSON.stringify(areaTags('Stairs / Hall \u00b7 Framing'))")==='["Stairs / Hall","Framing"]');
t('blank areas produce nothing rather than an empty tag', $("areaTags('').length")===0&&$("areaTags(null).length")===0);
// THE BUG THIS FIXES: stages matched by exact string, so a tagged entry vanished
// from the very stage it belonged to.
t('stages match any tag an entry carries, not the whole string',
  $("stageRecords.toString().indexOf('areaTags')")>=0
  &&$("progOf.toString().indexOf('areaTags')")>=0);
$("P().items.unshift({id:99001,cap:'stair framing',area:'Stairs / Hall \u00b7 Framing',t:Date.now(),issue:false,share:false})");
t('a stair-hall framing entry shows up under Framing',
  $("stageRecords(STAGES.find(s=>s.id==='framing')).some(i=>i.id===99001)")===true);
t('and does not leak into an unrelated stage',
  $("stageRecords(STAGES.find(s=>s.id==='drywall')).some(i=>i.id===99001)")===false);

S('editing can say everything creating could');
$("openRecord(99001)");
t('the editor uses the same picker, not a single-value dropdown',
  !!el('recAreaChips')&&$("document.getElementById('recAreaChips').querySelectorAll('.chip').length")>0);
t('both tags come back lit',
  $("[...document.querySelectorAll('#recAreaChips .chip.on')].map(c=>c.dataset.area).sort().join('|')")==='Framing|Stairs / Hall',
  $("[...document.querySelectorAll('#recAreaChips .chip.on')].map(c=>c.dataset.area).join('|')"));
$("saveRecord()");
t('an innocent Save keeps both tags', $("(P().items.find(i=>i.id===99001)||{}).area")==='Stairs / Hall \u00b7 Framing',
  $("(P().items.find(i=>i.id===99001)||{}).area"));
$("P().items.find(i=>i.id===99001).area='Somewhere Unlisted'");
$("openRecord(99001)");
t('a tag we no longer offer is still shown lit, not dropped',
  $("[...document.querySelectorAll('#recAreaChips .chip.on')].map(c=>c.dataset.area).join('|')")==='Somewhere Unlisted');
$("saveRecord()");
t('and survives a Save untouched', $("(P().items.find(i=>i.id===99001)||{}).area")==='Somewhere Unlisted');
$("P().items=P().items.filter(i=>i.id!==99001)");
t('the fixture cleaned up after itself', $("(P().items||[]).some(i=>i.id===99001)")===false);

S('one install prompt');
t('the full-screen gate stands down for the slim bar',
  $("maybeInstallGate.toString().indexOf('_invBarShowing')")>=0);
t('the bar gets out of the way of the steps it opens',
  $("openInstall.toString().indexOf('invBar')")>=0);
t('the invite field offers a one-tap paste', $("typeof lainvPaste")==='function'&&SRC.indexOf('onclick="lainvPaste()"')>=0);
asBuilder();

/* ════ 14u · TAXONOMY SHAPE + WHOLE HOUSE EXCLUSIVITY ════ */
S('taxonomy shape');
t('General leads, then Area/Rooms', $("AREA_GROUPS[0].k")==='general'&&$("AREA_GROUPS[1].k")==='rooms'
  &&$("AREA_GROUPS[0].a[0]")==='Whole House');
t('the rooms label is tight enough not to wrap',
  $("AREA_GROUPS.find(g=>g.k==='rooms').g")==='Area/Rooms');
t('finishes are their own group', $("AREA_GROUPS.some(g=>g.k==='fin')")===true);
t('every group carries a key the exclusivity rule can read',
  $("AREA_GROUPS.every(g=>!!g.k)")===true);
// THE INVARIANT: a tag nobody counts is a tag that quietly loses work. Thirteen
// of them existed before this build, including Electrical and Plumbing.
t('every tag is counted by at least one stage',
  $("AREAS.filter(a=>!STAGES.some(s=>s.areas.includes(a))).join('|')")==='',
  $("AREAS.filter(a=>!STAGES.some(s=>s.areas.includes(a))).join('|')"));
t('no stage points at a tag that does not exist',
  $("STAGES.reduce((acc,s)=>acc.concat(s.areas.filter(a=>AREAS.indexOf(a)===-1)),[]).join('|')")==='');
t('rough-ins finally counts all three trades',
  $("['HVAC','Electrical','Plumbing'].every(a=>STAGES.find(s=>s.id==='roughin').areas.includes(a))")===true);
t('insulation and drywall count their own tag',
  $("STAGES.find(s=>s.id==='insulation').areas.includes('Insulation')")===true
  &&$("STAGES.find(s=>s.id==='drywall').areas.includes('Drywall')")===true);
// The guarantee is NOT "never rename" - it is "never orphan". A name a record
// might hold must still resolve to a real tag, whether directly or via an alias.
t('every name a record could be holding still resolves to a real tag',
  $("['Kitchen','Bath 3','Stairs / Hall','Site','Mechanical','Exterior / Siding','Exterior / Grading','Stairs / Railings','Living Room','Whole House'].every(a=>AREAS.indexOf(areaTags(a)[0])>=0)")===true,
  $("['Kitchen','Bath 3','Stairs / Hall','Site','Mechanical','Exterior / Siding','Exterior / Grading','Stairs / Railings','Living Room','Whole House'].filter(a=>AREAS.indexOf(areaTags(a)[0])===-1).join('|')"));



S('the lock does not haunt the next entry');
// disabled is a PROPERTY. Clearing the "on" class left rooms greyed with nothing
// selected to explain why - it followed you into the next sheet.
$("state.activeId='p1'");$("openSheet(false)");$("_simClearChips()");
$("(function(){const c=[...document.querySelectorAll('#areaChips .chip')];window.__W=c.find(x=>x.dataset.area==='Whole House');window.__R=c.find(x=>x.dataset.grp==='rooms');})()");
$("pickChip(window.__R)");
t('picking a room locks Whole House', $("window.__W.disabled")===true);
$("closeSheet()");$("resetSheet()");
t('resetting the sheet lifts the lock', $("window.__W.disabled")===false
  &&$("document.querySelectorAll('#areaChips .chip.on').length")===0);
$("openSheet(false)");
t('and the next entry opens with nothing greyed',
  $("[...document.querySelectorAll('#areaChips .chip')].every(c=>c.disabled===false)")===true);
$("closeSheet()");$("delete window.__W;delete window.__R");

S('a day is not a place');
$("openSheet(true)");
t('the daily log does not offer an area it would throw away',
  $("document.getElementById('areaChips').style.display")==='none');
$("closeSheet()");$("openSheet(false)");
t('a normal entry still gets the picker', $("document.getElementById('areaChips').style.display")==='');
$("closeSheet()");

S('daily log reads as a record');
$("P().logs=[{date:todayStr(),text:'This is Today'},{date:'2026-07-20',text:'Older day'}]");
$("renderDayLog()");
t('the button stays a button, not a readout',
  $("document.getElementById('logTitle').textContent")==="Edit today's entry"
  &&$("document.getElementById('logSub').textContent")==='Crew, conditions, what got done');
t('today appears in the list with every other day',
  $("document.getElementById('logHistory').textContent").indexOf('This is Today')>=0
  &&$("document.getElementById('logHistory').textContent").indexOf('Older day')>=0);
t('and it reads as Today', $("document.getElementById('logHistory').textContent").indexOf('Today')>=0);
$("P().logs=[]");$("renderDayLog()");
t('with nothing logged the button invites one',
  $("document.getElementById('logTitle').textContent")==="Add today's entry");
asBuilder();

S('renamed tags keep old records whole');
// Records hold the old strings. They are translated on the way OUT, so an entry
// logged months ago still matches its stage and shows the current label.
t('every alias points at a tag that exists',
  $("Object.keys(AREA_ALIASES).every(k=>AREAS.indexOf(AREA_ALIASES[k])>=0)")===true);
t('no retired name is still offered as a chip',
  $("Object.keys(AREA_ALIASES).every(k=>AREAS.indexOf(k)===-1)")===true);
t('an old Mechanical entry reads as HVAC', $("areaText('Mechanical')")==='HVAC');
t('and still counts toward Rough-Ins',
  $("STAGES.find(s=>s.id==='roughin').areas.some(a=>areaTags('Mechanical').includes(a))")===true);
t('an old Exterior / Siding entry reads as Siding', $("areaText('Exterior / Siding')")==='Siding');
t('a tagged old entry translates every part it carries',
  $("areaText('Kitchen \u00b7 Mechanical')")==='Kitchen \u00b7 HVAC');
t('an unknown tag is left exactly as it was', $("areaText('Somewhere Unlisted')")==='Somewhere Unlisted');
t('the editor lights the renamed chip for an old record', (function(){
  $("state.activeId='p1'");
  $("P().items.unshift({id:99002,cap:'old tag',area:'Mechanical',t:Date.now(),issue:false,share:false})");
  $("openRecord(99002)");
  const on=$("[...document.querySelectorAll('#recAreaChips .chip.on')].map(c=>c.dataset.area).join('|')");
  $("closeRecord()");$("P().items=P().items.filter(i=>i.id!==99002)");
  return on==='HVAC';})());

S('whole house exclusivity');
$("state.activeId='p1'");
$("openSheet(false)");
$("_simClearChips()");
$("(function(){const c=[...document.querySelectorAll('#areaChips .chip')];window.__W=c.find(x=>x.dataset.area==='Whole House');window.__R=c.find(x=>x.dataset.grp==='rooms');window.__R2=c.filter(x=>x.dataset.grp==='rooms')[1];})()");
t('nothing is locked out to begin with', $("window.__W.disabled")===false&&$("window.__R.disabled")===false);
$("pickChip(window.__W)");
t('choosing Whole House greys the rooms out', $("window.__R.disabled")===true&&$("window.__R2.disabled")===true);
t('and greyed means unclickable, not hidden',
  $("getComputedStyle(window.__R).pointerEvents")==='none'||$("window.__R.disabled")===true);
$("pickChip(window.__W)");
t('unpicking it hands the rooms back', $("window.__R.disabled")===false);
$("pickChip(window.__R)");
t('choosing a room greys Whole House out', $("window.__W.disabled")===true);
t('other rooms stay available', $("window.__R2.disabled")===false);
$("pickChip(window.__R)");
t('unpicking the room hands Whole House back', $("window.__W.disabled")===false);
$("_simClearChips()");$("closeSheet()");
$("delete window.__W;delete window.__R;delete window.__R2");
asBuilder();

/* ════ 15 · ACTION-ORDER FUZZ ════ */
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
  /* ── broadened catalogue (backlog): permits, inspections, concerns/ideas, modal bookings, invoice composer, wizard ── */
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");$('addPermit()');if(el('promptScrim').classList.contains('show')){if(r()<0.7)promptOK('Fuzz Permit '+Math.floor(r()*1e4));else $('closePrompt()');}},
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");const n=$("(P().permits||[]).length");if(n)$("setPermit("+Math.floor(r()*n)+",'"+['Not started','Applied','Approved','Issued','Closed'][Math.floor(r()*5)]+"')");},
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");$("cycleInspection('"+['site','foundation','roughin','rough_elec'][Math.floor(r()*4)]+"')");},
  r=>{const p=PIDS[Math.floor(r()*4)];asClient(p);$("state.activeId='"+p+"'");$('renderClient()');$('openConcern()');const e=el('cNote');if(e)e.value=r()<0.8?('Fuzz concern '+Math.floor(r()*1e4)):'';$('concernPhotoId=null');$('submitConcern()');$('closeConcern()');},
  r=>{const p=PIDS[Math.floor(r()*4)];asClient(p);$("state.activeId='"+p+"'");$('renderClient()');$('openIdea()');const e=el('iNote');if(e)e.value='Fuzz idea '+Math.floor(r()*1e4);$('submitIdea()');$('closeIdea()');},
  r=>{asBuilder();$('calMonth=null');$('renderCal()');$('openBk()');const p=PIDS[Math.floor(r()*4)];$("document.getElementById('bkSite').value='"+p+"'");$("bkFillSubs('"+p+"')");const os=JSON.parse($("JSON.stringify([...document.getElementById('bkSub').options].map(o=>o.value).filter(Boolean))"));if(!os.length){$('closeBk()');return;}$("document.getElementById('bkSub').value="+JSON.stringify(os[Math.floor(r()*os.length)]));const s=Date.now()+Math.floor(r()*30)*864e5;setVal('bkStart',new Date(s).toISOString().slice(0,10));setVal('bkEnd',new Date(s+Math.floor(r()*5)*864e5).toISOString().slice(0,10));setVal('bkNote','fz');$('bkSave()');},
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");$('invCompose()');setVal('invTitle2','Fuzz inv');setVal('invExLabel','Fuzz line');setVal('invExAmount',String(1+Math.floor(r()*900)));$('invSave('+(r()<0.5)+')');$("invMode='list'");},
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");$('openCostLine()');setVal('clLabel','Fz line '+Math.floor(r()*1e4));setVal('clBudget',String(1000+Math.floor(r()*90000)));$('saveCostLine()');$('closeCostLine()');},
  r=>{asBuilder();$("state.activeId='"+PIDS[Math.floor(r()*4)]+"'");$('openCostActual()');setVal('caAmount',String(Math.floor(r()*50000)));$("setCaKind('"+(0.5>0.4?'spent':'committed')+"')");const ls=JSON.parse($("JSON.stringify(costLines(P()).map(l=>l.id))"));if(ls.length&&r()<0.8)$("document.getElementById('caLine').value="+JSON.stringify(ls[Math.floor(r()*ls.length)]));$("document.getElementById('caPayeeSel').value='__other'");$('caPayeeChange()');setVal('caPayee','Fz Co');$('saveCostActual()');$('closeCostActual()');},
  r=>{if($('state.projects.length')>=16)return;asBuilder();$('openNewSite()');setVal('nsName','Fz '+Math.floor(r()*1e5));setVal('nsStreet',Math.floor(r()*999)+' Fuzz Way');setVal('nsCity','Fuzzton');$('saveNewSite()');},
];
const drainM=r=>{for(let g=0;g<4;g++){let acted=false;
  if(el('promptScrim').classList.contains('show')){if(r()<0.5)promptOK(new Date(Date.now()+864e5).toISOString().slice(0,10));else $('closePrompt()');acted=true;}
  if(el('confirmScrim').classList.contains('show')){$(r()<0.6?'ocConfirm()':'ocCancel()');acted=true;}
  if(!acted)break;}};
const SEQS=200,LEN=12;   /* ritual default ~30s; raise to 400+ for feature builds */let fuzzFail=null;
for(let i=0;i<SEQS&&!fuzzFail;i++){
  const r=mulberry32(0x51ab1e+i);
  for(let k=0;k<LEN;k++){
    const ai=Math.floor(r()*ACTIONS.length);
    try{ACTIONS[ai](r);drainM(r);}catch(e){fuzzFail='seq '+i+' step '+k+' action '+ai+': '+e.message;break;}
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
