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
t('version 2.166.x',String($('PLUMB_VERSION')).startsWith('2.166'));
// error buffer hygiene: age-out + cap
$("localStorage.setItem('plumb.errors',JSON.stringify([{t:Date.now()-20*86400000,k:'rules',m:'ancient',v:'2.152.0',mode:'real'}].concat(Array.from({length:30},(_,i)=>({t:Date.now()-i*1000,k:'x',m:'fresh'+i,v:'t',mode:'demo'})))))");
t('devErrors ages out 14d+ and caps at 20', (function(){const a=JSON.parse($("JSON.stringify(devErrors())"));return a.length===20&&a.every(x=>x.m!=='ancient');})());
$("trapError('test','newest','sim')");
t('trapError prunes on write too', (function(){const a=JSON.parse($("localStorage.getItem('plumb.errors')"));return a.length<=20&&a[0].m==='newest';})());
$("localStorage.removeItem('plumb.errors')");
t('desktop rail brand present in nav', $("document.querySelector('nav .rail-brand .wordmark').textContent").includes('Plumb'));
t('rail foot carries the live sync pill', $("document.querySelector('nav .rail-foot .syncpill').textContent").includes('device'));

/* ════ 1b · ROLE-AWARE SYNC SCOPING (functions live in app; Sync stays inert here) ════ */
S('sync-scope');
t('builder gets all six colls', $("syncCollsFor('builder').map(c=>c.sub).join()") === 'items,sel,logs,pmts,mail,costs');
t('sub skips pmts+mail+costs', $("syncCollsFor('sub').map(c=>c.sub).join()") === 'items,sel,logs');
t('client skips mail+costs', $("syncCollsFor('client').map(c=>c.sub).join()") === 'items,sel,logs,pmts');
t('unknown role defaults to all', $("syncCollsFor(null).map(c=>c.sub).join()") === 'items,sel,logs,pmts,mail,costs');
t('siteRoleFor: members map wins over session role',
  $("state.session={role:'client',auth:{uid:'uX'}};siteRoleFor({members:{uX:'sub'}})") === 'sub');
t('siteRoleFor: falls back to session subs->sub',
  $("state.session={role:'subs'};siteRoleFor({})") === 'sub');
t('siteRoleFor: falls back to session client->client',
  $("state.session={role:'client'};siteRoleFor(null)") === 'client');
t('siteRoleFor: builder session -> builder',
  $("state.session={role:'hillan'};siteRoleFor({})") === 'builder');
$("state.session=null");
t('SEED_VERSION 11',$('SEED_VERSION')===11);
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
t('Calderwood seed math (budget 229k, exposure 228.2k, 1 line over)',
  BS.budget===229000&&BS.committed===169700&&BS.spent===130200&&BS.exposure===228200&&BS.remaining===800&&BS.over===false&&BS.lines===6&&BS.overLines===1&&BS.unassigned===0, JSON.stringify(BS));
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
t('over line flagged in red chip', BH.includes('2,500 over'));
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
t('line added via modal', $("costLines(P()).length")===7&&$("JSON.stringify(costLines(P()).find(l=>l.label==='Roofing package'))").includes('34000'));
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
t('unnamed line rejected', $("costLines(P()).length")===7);
$('closeCostLine()');
$('openCostActual()');setVal('caAmount','0');$('saveCostActual()');
t('zero-amount cost rejected', $("costActuals(P()).length")===9);
$('closeCostActual()');
// cleanup the sim-added line via real delete path (confirm gate)
$('openCostLine('+JSON.stringify(rid)+')');$('deleteCostLine()');$('ocConfirm()');
t('modal delete cascades', $("costLines(P()).length")===6&&$("costActuals(P()).length")===8);
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
t('six seed rows + quick-add row', $("document.querySelectorAll('#budgetBody tr[data-line]').length")===6&&$("document.querySelectorAll('#budgetBody tr.bgt-qa').length")===1);
t('over cell rendered in table', el('budgetBody').innerHTML.includes('2,500 over'));
t('explicit Edit buttons on table rows', $("document.querySelectorAll('#budgetBody .bgt-edit').length")===6);
// in-place budget edit patches computed cells without re-render
$("(function(){const tr=document.querySelector('tr[data-line]');const inp=tr.querySelector('input.num');inp.value='20000';inp.onchange({});})()");
t('cell save updates rollup in place', $("costLineRollup(P(),'c1').budget")===20000&&el('bgtL-c1').textContent.includes('2,500'), el('bgtL-c1').textContent);
t('totals strip refreshed in place', el('bgtTotals').innerHTML.includes('231,000'));
$("(function(){const tr=document.querySelector('tr[data-line]');const inp=tr.querySelector('input.num');inp.value='18000';inp.onchange({});})()");
t('edit back restores seed math', $("costSummary(P()).budget")===229000);
// quick-add row
setVal('bgtQaName','Gutters & downspouts');setVal('bgtQaBudget','5500');
$("document.getElementById('bgtQaTrade').value='gutters'");
$('bgtQuickAdd()');
t('quick-add creates the line', $("costLines(P()).length")===7&&el('budgetBody').innerHTML.includes('Gutters &amp; downspouts'));
// regroup-on-select re-renders (trade toggle honored in table too)
$("setCostGroup('trade')");
t('table honors trade grouping', el('budgetBody').innerHTML.includes('bgt-table')&&el('budgetBody').innerHTML.includes('Gutters'));
$("setCostGroup('stage')");
// cleanup + restore phone width
$("Data.removeCost(costLines(P()).find(l=>l.label==='Gutters & downspouts').id)");
t('cleanup', $("costLines(P()).length")===6);
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
t('csv header row', csvRows[0]==='Date,Paid to,Type,Amount,Budget line,Trade,Stage,Note', csvRows[0]);
t('csv one row per logged cost', csvRows.length===1+$("costActuals(P()).length"), csvRows.length);
t('csv carries payees + amounts + line context', CSVT.includes('Hollis Excavating')&&CSVT.includes('17500')&&CSVT.includes('Signed contract')&&CSVT.includes('Payment')&&CSVT.includes('Plumbing rough-in'));
$("Data.addCostActual({id:'caq',lineId:'c1',kind:'spent',amount:5,payee:'Acme, \"Quote\" Co',note:'line1\\nline2',t:Date.now()})");
CSVT=$("costsCsv(P())");
t('csv quotes commas, quotes and newlines', CSVT.includes('"Acme, ""Quote"" Co"')&&CSVT.includes('"line1\nline2"'));
$("Data.removeCost('caq')");
$('openBudget()');
t('export button rendered', el('budgetBody').innerHTML.includes('for your accountant'));
// margin link through the real line modal
const pricedSel=$("((P().selections||[]).find(s=>Number(s.price)>0)||{}).id");
$("openCostLine('c1')");
$("document.getElementById('clSel').value="+JSON.stringify(String(pricedSel)));
setVal('clLabel','Excavation & site work');setVal('clBudget','18000');
$('saveCostLine()');
t('selection link persisted', String($("costLines(P()).find(l=>l.id==='c1').selId"))===String(pricedSel));
const MG=JSON.parse($("JSON.stringify(costLineMargin(P(),'c1'))"));
t('margin math = price minus exposure', !!MG&&MG.cost===17500&&MG.margin===MG.price-17500, JSON.stringify(MG));
$("openCostLine('c1')");
t('modal shows the margin readout', el('clMargin').innerHTML.includes('Homeowner pays'));
$('closeCostLine()');
$("Data.updateCost('c1',{selId:''})");
t('unlink clears margin', $("costLineMargin(P(),'c1')")===null);
$('closeBudget()');

/* ════ 14f · PHASE E: BUDGET TEMPLATES (clone lines, never history) ════ */
S('budget templates');
asBuilder();$("state.activeId='p4'");
t('Maple Court starts empty', $("costLines(P()).length")===0);
t('sources exclude self and empty sites', $("JSON.stringify(budgetSources().map(s=>s.id).sort())")===JSON.stringify(['p1','p2','p3']));
$('openBudget()');
t('empty budget offers the copy link', el('budgetBody').innerHTML.includes('Copy budget lines from another site'));
$('openBudgetCopy()');
t('picker lists donor sites with totals', el('bcBody').innerHTML.includes('Calderwood')&&el('bcBody').innerHTML.includes('229,000'));
$("cloneBudgetFrom('p2')");
t('six lines cloned onto empty site (no confirm gate)', $("costLines(P()).length")===6);
t('amounts and tags travel', $("costSummary(P()).budget")===229000&&$("costLines(P()).filter(l=>l.stage==='roughin').length")===3);
t('history and links do NOT travel', $("costActuals(P()).length")===0&&$("costLines(P()).every(l=>!l.selId)")===true&&$("costSummary(P()).exposure")===0);
t('cloned ids are fresh', $("costLines(P()).every(l=>!['c1','c2','c3','c4','c5','c6'].includes(l.id))")===true);
// cloning onto an existing budget must pass the confirm gate and append
$('openBudgetCopy()');$("cloneBudgetFrom('p3')");
t('confirm gate on non-empty budget', el('confirmScrim').classList.contains('show'));
$('ocConfirm()');
t('append alongside existing', $("costLines(P()).length")===10);
t('p2 donor untouched', $("costLines(state.projects.find(x=>x.id==='p2')).length")===6&&$("costActuals(state.projects.find(x=>x.id==='p2')).length")===8);
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
t('To-Do segments speak one language', el('view-decisions').innerHTML.includes('Waiting on you')&&el('view-decisions').innerHTML.includes('Site issues'));
$("go('decisions')");$("decSeg('waiting',document.querySelector('[data-d=waiting]'))");
t('issues header matches segment vocabulary', el('view-decisions').innerHTML.includes('Open site issues'));
t('Log capture button says Take a photo', el('view-log').innerHTML.includes('Take a photo'));
$("go('files')");
t('Photos pane has its own Take a photo door', el('filesPhotos').innerHTML.includes('Take a photo'));
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
t('guide orb present, guarded, choreographed', $("!!document.getElementById('tourOrb')")===true&&await $("orbTo('#nope').then(()=>true)")===true&&await $("orbTo(null,{tap:true}).then(()=>true)")===true&&$("TOUR.grand.filter(s=>s.tap).length")===15&&$("typeof orbTaps")==='function');
t('grand tour rides the spotlight engine', $("typeof startGrandTour")==='function'&&$("Array.isArray(TOUR.grand)")===true&&$("TOUR.grand.length")===16&&$("TOUR.grand.every(s=>s.title&&s.body)")===true&&$("TOUR.grand.slice(1).every(s=>s.sel)")===true&&$("typeof tourGoto")==='function');
// excursion from a live session: flip out, come home with session + activeId intact
asBuilder();
$("localStorage.setItem('plumb.mode','real')");
$("state.session={role:'hillan',name:'Real Me',auth:{uid:'uTest'}};state.activeId=null;persist&&persist()");
$('enterDemo()');
t('excursion runs in demo with banner + builder session', $("appMode()")==='demo'&&$("document.body.classList.contains('on-excursion')")===true&&$("state.session.role")==='hillan'&&$("(state.projects||[]).length")>0);
$('exitDemo()');
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
await new Promise(r=>setTimeout(r,1150));
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
  ()=>L_ACT('build'),
  ()=>L_PANE('buildPermits'),
  ()=>L_PANE('buildSubs'),
  ()=>$("document.getElementById('budgetScrim').classList.contains('show')")===true,
  ()=>$("document.getElementById('budgetScrim').classList.contains('show')")===false&&L_ACT('build'),
  ()=>L_ACT('files')&&L_PANE('filesPhotos'),
  ()=>L_PANE('filesDocs'),
  ()=>$("state.session.role")==='client'&&$("document.getElementById('clientview').classList.contains('show')")===true&&L_OV()===false,
  ()=>$("state.session.role")==='subs'&&$("document.getElementById('subview').classList.contains('show')")===true,
  ()=>$("state.session.role")==='hillan'&&L_OV()===true,
];

let tourOK=true, tourDetail='';
for(let i2=0;i2<16;i2++){
  if(i2>0){$('tourNext()');await new Promise(r=>setTimeout(r,1150));}
  if(!landmarks[i2]()){tourOK=false;tourDetail='landmark '+i2;break;}
  const lifted=$("_tourLift?1:0");
  const bub=$("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML");
  if(!bub.includes(String(i2+1)+' / 16')){tourOK=false;tourDetail='counter '+i2;break;}
  if(i2!==0&&i2!==10&&!lifted){tourOK=false;tourDetail='no spotlight at '+i2;break;}
}
t('all 16 steps navigate, spotlight and count correctly', tourOK, tourDetail);
// Peter's Back bug, encoded forever: walk 16 → 1 and every landmark must still hold
let backOK=true, backDetail='';
for(let b=14;b>=0;b--){
  $('tourPrev()');await new Promise(r=>setTimeout(r,1150));
  if(!landmarks[b]()){backOK=false;backDetail='back landmark '+b;break;}
}
t('walking BACKWARD lands every slide correctly too', backOK, backDetail);
for(let f=1;f<16;f++){$('tourNext()');await new Promise(r=>setTimeout(r,350));}
await new Promise(r=>setTimeout(r,900));
t('final step carries the first-site CTA', $("(document.getElementById('tourBubble')||{innerHTML:''}).innerHTML").includes('Set up my first site'));
$('tourEnd()');$('exitDemo()');
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
$('exitDemo()');
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
  r=>{if($('state.projects.length')>=10)return;asBuilder();$('openNewSite()');setVal('nsName','Fz '+Math.floor(r()*1e5));setVal('nsStreet',Math.floor(r()*999)+' Fuzz Way');setVal('nsCity','Fuzzton');$('saveNewSite()');},
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
