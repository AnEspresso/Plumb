'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const app=path.join(__dirname,'../app');
const source=fs.readFileSync(path.join(app,'index.html'),'utf8');
function boot(){
 const dom=new JSDOM(source.replace('</body>','<script>window.inspect=c=>eval(c)</script></body>'),{url:'https://qa.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){
  w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});w.scrollTo=()=>{};w.indexedDB={open:()=>({})};
  w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
 }});
 const w=dom.window;const run=c=>w.inspect(c);
 run(`state.session={role:'builder',name:'QA builder'};state.activeId=state.projects[0].id;
 P().selections=[{id:9001,cat:'Plumbing Fixtures',room:'Primary Bath',item:'QA shower valve',price:650,status:'selected',approved:false,spec:{}}];
 specFields(P().selections[0]).forEach(f=>{P().selections[0].spec[f.key]=f.who==='homeowner'?'brushed brass':'QA dimension';});
 P().packetSignoff={};P().bookings=[{id:'qa-booking',trade:'plumb',subName:'QA Plumbing',start:Date.now(),end:Date.now(),note:'QA ONLY'}];
 P().docs=[];P().selNotes='';`);
 return {w,run,close:()=>dom.window.close()};
}
test('preview and unknown hosts cannot select production services',()=>{
 const js=fs.readFileSync(path.join(app,'runtime.js'),'utf8');
 for(const u of ['https://qa.invalid/app/','http://localhost:8080/app/','https://anespresso.github.io/other/','https://siteplumb.com.evil.invalid/app/']){
  const w={location:new URL(u)};vm.runInNewContext(js,{window:w,URL});assert.equal(w.PlumbRuntime.config({projectId:'production'}),null);assert.equal(w.PlumbRuntime.functionsBase,null);
 }
 const w={location:new URL('https://siteplumb.com/app/')};vm.runInNewContext(js,{window:w,URL});assert.equal(w.PlumbRuntime.config({projectId:'production'}).projectId,'production');
});
test('missing runtime fails closed for cloud calls',async()=>{
 const h=boot();try{assert.equal(h.run('fbConfig()'),null);assert.equal(h.run('_pkDb()'),null);await assert.rejects(h.run("fnCall('deleteAccount',{})"),/disabled/);}finally{h.close();}
});
test('builder and homeowner signatures cover the exact revision; status chatter does not invalidate',()=>{
 const h=boot();try{
  h.run("setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'))");assert.equal(h.run("!!packetSignoff(P(),'plumb').builder"),true);
  h.run("state.session={role:'client',site:P().id,name:'QA homeowner'};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'))");
  assert.equal(h.run("packetSignedBoth(P(),'plumb')"),true);
  h.run("state.session={role:'builder',name:'QA builder'};Data.updateSelection(9001,{status:'ordered'})");assert.equal(h.run("packetSignedBoth(P(),'plumb')"),true);
  h.run("Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{rough:'QA REVISION C'})})");
  assert.equal(h.run("packetSignedBoth(P(),'plumb')"),false);assert.equal(h.run("!!P().packetSignoff.plumb.builder"),true,'old signature retained for audit');
  assert.equal(h.run('P().selections[0].specRevision'),2);assert.equal(h.run('P().selections[0].approved'),false);
 }finally{h.close();}
});
test('legacy unbound signatures never authorize new instructions',()=>{const h=boot();try{
 h.run("P().packetSignoff={plumb:{builder:{at:1,by:'Legacy'},homeowner:{at:1,by:'Legacy'}}}");assert.equal(h.run("packetSignedBoth(P(),'plumb')"),false);
}finally{h.close();}});
test('a date change and document replacement invalidate current approval',()=>{const h=boot();try{
 h.run("setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'));P().bookings[0].start+=86400000");assert.equal(h.run("!!packetSignoff(P(),'plumb').builder"),false);
 h.run("setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'));P().docs.push({n:'QA drawing',trade:'plumb',fileId:'drawing-v2'})");assert.equal(h.run("!!packetSignoff(P(),'plumb').builder"),false);
}finally{h.close();}});
test('homeowner editor and mutation layer preserve builder-owned fields',()=>{const h=boot();try{
 const key=h.run("specFields(P().selections[0]).find(f=>f.who==='builder').key");
 h.run("state.session={role:'client',site:P().id,name:'QA homeowner'};openSpec(9001)");
 assert.equal(h.w.document.querySelector('input[data-key="'+key+'"]').readOnly,true);
 h.run(`Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{[${JSON.stringify(key)}]:'UNAUTHORIZED'})})`);
 assert.notEqual(h.run(`P().selections[0].spec[${JSON.stringify(key)}]`),'UNAUTHORIZED');
 const homeKey=h.run("specFields(P().selections[0]).find(f=>f.who==='homeowner').key");
 h.run(`Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{[${JSON.stringify(homeKey)}]:'polished chrome'})})`);
 assert.equal(h.run(`P().selections[0].spec[${JSON.stringify(homeKey)}]`),'polished chrome');
 assert.equal(h.run("setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'))"),false);
}finally{h.close();}});
test('packet shows a hold when approvals are absent; no prices leak',()=>{const h=boot();try{
 const snapshot=JSON.parse(h.run('JSON.stringify(packetSnapshot(P(),P().bookings[0]))'));
 assert.equal(snapshot.release.approved,false);assert.equal(snapshot.specs[0].revision,1);assert.equal(JSON.stringify(snapshot).includes('650'),false);
 assert.match(h.run("packetHTML(P(),'plumb')"),/approval pending/);
}finally{h.close();}});
test('failed packet publication retries; successful update preserves Q&A, response and expiry',async()=>{const h=boot();try{
 h.run("P().bookings[0].pkToken='pk_qa';appMode=()=> 'real';_pkDb=()=>window.testDB");
 let remote=JSON.parse(h.run('JSON.stringify(packetSnapshot(P(),P().bookings[0]))'));
 remote.q=[{text:'QA question',a:'QA answer'}];remote.resp={status:'confirmed',t:1};const expires=remote.expires;
 let attempts=0;h.w.testDB={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>remote}),update:async patch=>{attempts++;if(attempts===1)throw Error('offline');Object.assign(remote,JSON.parse(JSON.stringify(patch)));}})})};
 h.run("Data.updateSelection(9001,{item:'QA updated valve'})");
 await h.run('pkPublishOne(P(),P().bookings[0],null,false)');assert.equal(attempts,1);assert.ok(h.run('P().bookings[0].pkPublishError'));
 await h.run('pkPublishOne(P(),P().bookings[0],null,false)');assert.equal(attempts,2);assert.equal(remote.specs[0].item,'QA updated valve');
 assert.equal(remote.q[0].a,'QA answer');assert.equal(remote.resp.status,'confirmed');assert.equal(remote.expires,expires);assert.equal(h.run('P().bookings[0].pkPublishError'),null);
 await h.run('pkPublishOne(P(),P().bookings[0],null,false)');assert.equal(attempts,2,'unchanged packet does not write again');
}finally{h.close();}});
test('re-sharing the same booking reuses its link and conversation',async()=>{const h=boot();try{
 h.run("P().bookings[0].pkToken='pk_qa';appMode=()=> 'real';_pkDb=()=>window.testDB;_pkListenAll=()=>{};_sharePacketLink=(s,t)=>window.sharedToken=t");
 let remote=JSON.parse(h.run('JSON.stringify(packetSnapshot(P(),P().bookings[0]))'));remote.q=[{text:'Keep this question'}];let creates=0;
 h.w.testDB={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>remote}),set:async()=>{creates++;},update:async patch=>Object.assign(remote,patch)})})};
 h.run("sendGuestPacket(P().id,'qa-booking');gpApproveSend()");
 for(let n=0;n<20&&!h.w.sharedToken;n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(h.w.sharedToken,'pk_qa');assert.equal(creates,0);assert.equal(remote.q[0].text,'Keep this question');
}finally{h.close();}});
test('publisher rejects a packet reassigned to a different crew',async()=>{const h=boot();try{
 h.run("P().bookings[0].pkToken='pk_qa';appMode=()=> 'real';_pkDb=()=>window.testDB");let calls=0;
 let remote=JSON.parse(h.run('JSON.stringify(packetSnapshot(P(),P().bookings[0]))'));remote.sub='Other Crew';
 h.w.testDB={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>remote}),update:async()=>{calls++;}})})};
 await h.run('pkPublishOne(P(),P().bookings[0],null,false)');assert.equal(calls,0);assert.ok(h.run('P().bookings[0].pkPublishError'));
}finally{h.close();}});

test('signing a packet that changed since it was displayed is refused',()=>{const h=boot();try{
 h.run("packetHTML(P(),'plumb');Data.updateSelection(9001,{item:'A different valve'});pktSignBuilder(P().id,'plumb')");
 assert.equal(h.run("!!packetSignoff(P(),'plumb').builder"),false);
 assert.match(h.w.document.getElementById('toast').textContent,/changed/);
}finally{h.close();}});
test('a packet that changes while its link is being prepared is not sent',async()=>{const h=boot();try{
 let finish,creates=0;
 h.run("appMode=()=> 'real';_pkDb=()=>window.testDB;_sharePacketLink=()=>window.didShare=true");
 h.w.testDB={collection:()=>({doc:()=>({get:()=>new Promise(r=>{finish=r;}),set:async()=>{creates++;}})})};
 h.run("sendGuestPacket(P().id,'qa-booking');gpApproveSend();Data.updateSelection(9001,{item:'Changed during preparation'})");
 finish({exists:false});await new Promise(r=>setTimeout(r,30));
 assert.equal(creates,0);assert.equal(h.w.didShare,undefined);assert.match(h.w.document.getElementById('toast').textContent,/changed/);
}finally{h.close();}});
test('in-app crew response stays unsaved on failure and can be retried',async()=>{const h=boot();try{
 h.run("_gpToken='pk_qa';_gpSnap=packetSnapshot(P(),P().bookings[0]);_pkDb=()=>window.testDB;_gpRender()");let calls=0;
 h.w.testDB={collection:()=>({doc:()=>({update:async()=>{if(++calls===1)throw Error('offline');}})})};
 assert.equal(await h.run("_gpWriteResp({status:'confirmed',t:100})"),false);assert.equal(h.run('_gpSnap.resp'),null);
 assert.equal(await h.run("_gpWriteResp({status:'confirmed',t:100})"),true);assert.equal(h.run('_gpSnap.resp.status'),'confirmed');
}finally{h.close();}});
function guestBoot(update,onSnapshot){
 const fixture={site:'QA sample home',siteId:'qa-house',bookingId:'qa-booking',trade:'plumb',tradeLabel:'Plumbing',sub:'QA Plumbing',builder:'QA Builder',start:Date.now(),end:Date.now(),expires:Date.now()+86400000,q:[],resp:null,specs:[{item:'QA valve',rows:[]}],release:{approved:false,label:'Hold — approval needed'}};
 const dom=new JSDOM(fs.readFileSync(path.join(app,'p.html'),'utf8').replace('boot();\n})();','window.guestInspect=c=>eval(c);boot();\n})();'),{url:'https://qa.invalid/app/p.html?packet=pk_test',runScripts:'dangerously',virtualConsole:new VirtualConsole(),beforeParse(w){
  w.__packetFixture=fixture;w.PlumbRuntime={kind:'production'};
  const firestore=()=>({collection:()=>({doc:()=>({update,onSnapshot})})});
  firestore.FieldValue={arrayUnion:q=>({union:q})};w.firebase={apps:[{}],firestore};
 }});return {w:dom.window,fixture,close:()=>dom.window.close()};
}
test('standalone crew page preserves an unsent question and appends atomically on retry',async()=>{
 let calls=0,firstId;const h=guestBoot(async patch=>{calls++;assert.ok(patch.q.union);if(calls===1){firstId=patch.q.union.id;throw Error('offline');}assert.equal(patch.q.union.id,firstId);});
 try{
  assert.match(h.w.document.getElementById('body').textContent,/Do not install/);
  h.w.gpToggleAsk();h.w.document.getElementById('gpQText').value='QA: what is the valve depth?';
  await h.w.gpSendQuestion();assert.equal(h.fixture.q.length,0);assert.equal(h.w.document.getElementById('gpQText').value,'QA: what is the valve depth?');
  assert.match(h.w.document.getElementById('toast').textContent,/Not saved/);
  await h.w.gpSendQuestion();assert.equal(h.fixture.q.length,1);assert.equal(calls,2);
 }finally{h.close();}
});
test('standalone crew page never paints a failed confirmation as confirmed',async()=>{
 const h=guestBoot(async()=>{throw Error('offline');});try{
  h.w.gpConfirm();await new Promise(r=>setTimeout(r,10));assert.equal(h.fixture.resp,null);assert.doesNotMatch(h.w.document.getElementById('body').textContent,/You said these dates work/);
 }finally{h.close();}
});

test('refreshing an expired link updates instructions atomically while preserving its conversation',async()=>{const h=boot();try{
 h.run("appMode=()=> 'real';P().bookings[0].pkToken='pk_qa';_pkDb=()=>window.testDB;gpApproveSend=()=>{window.renewed=true;}");
 let remote=JSON.parse(h.run('JSON.stringify(packetSnapshot(P(),P().bookings[0]))'));remote.expires=1;remote.q=[{text:'Keep this',a:'And this'}];remote.resp={status:'confirmed',t:10};let saves=0;
 h.w.testDB={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>remote}),update:async patch=>{assert.ok(patch.expires>Date.now());assert.ok(patch.release);assert.ok(patch.specs);Object.assign(remote,patch);saves++;}})})};
 h.run("Data.updateSelection(9001,{item:'Current valve'})");
 await h.run('gpRenewExpiredLink(P(),P().bookings[0],packetSnapshot(P(),P().bookings[0]))');
 assert.equal(saves,1);assert.equal(remote.specs[0].item,'Current valve');assert.equal(remote.q[0].a,'And this');assert.equal(remote.resp.t,10);assert.equal(h.w.renewed,true);
}finally{h.close();}});
test('built preview boots the sample house, keeps roles usable, and makes no external request',async()=>{
 const os=require('node:os'),cp=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plumb-preview-'));
 let dom;try{
  cp.execFileSync(process.execPath,[path.join(app,'../scripts/build-qa-preview.mjs'),dir]);
  const preview=fs.readFileSync(path.join(dir,'app/index.html'),'utf8');assert.match(preview,/connect-src 'self'/);
  assert.doesNotMatch(preview,/<script\s+src="https:\/\/www.gstatic.com/);
  let external=[];class LocalResources extends require('jsdom').ResourceLoader{fetch(url){const u=new URL(url);if(u.origin!=='https://preview.invalid'){external.push(url);return null;}const f=path.join(dir,u.pathname);if(fs.existsSync(f))return Promise.resolve(fs.readFileSync(f));return null;}}
  dom=new JSDOM(preview.replace('</body>','<script>window.inspect=c=>eval(c)</script></body>'),{url:'https://preview.invalid/app/?demo=1',runScripts:'dangerously',pretendToBeVisual:true,resources:new LocalResources(),virtualConsole:new VirtualConsole(),beforeParse(w){
   w.matchMedia=()=>({matches:false,addListener(){},addEventListener(){}});w.scrollTo=()=>{};w.indexedDB={open:()=>({})};
   w.fetch=async url=>{external.push(String(url));throw Error('No network in preview test');};
   w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
  }});
  await new Promise(r=>dom.window.addEventListener('load',()=>setTimeout(r,80),{once:true}));
  const w=dom.window;assert.equal(w.inspect('P().id'),'qa-shower');assert.equal(w.inspect('fbConfig()'),null);
  assert.equal(w.inspect('billingSummary(P()).out'),650);
  assert.equal(w.inspect('billingSummary(P()).billed'),0);
  assert.equal(w.inspect('billingSummary(P()).paid'),0);
  assert.equal(w.inspect('P().selections[0].spec.roughin'),'3.0 in — QA sample');
  assert.equal(w.inspect('typeof P().subs[0].cleared'),'number');
  w.demoRole('client');assert.equal(w.inspect('state.session.role'),'client');w.openSpec(9901);
  assert.ok([...w.document.querySelectorAll('#specBody input')].some(x=>x.readOnly));
  w.demoRole('subs');assert.equal(w.inspect('state.session.name'),'QA Plumbing');w.demoRole('builder');w.qaGuide();
  assert.match(w.document.getElementById('infoBody').textContent,/Matte Black → Polished Black/);
  assert.match(w.document.getElementById('infoBody').textContent,/\$650/);assert.deepEqual(external,[]);
 }finally{if(dom)dom.window.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('an expired or revoked packet replaces cached instructions and refuses responses',async()=>{const h=boot();try{
 h.run("_gpToken='pk_qa';_gpSnap=packetSnapshot(P(),P().bookings[0]);_gpRender();_gpApplyRemote(Object.assign({},_gpSnap,{revoked:true}))");
 assert.match(h.w.document.getElementById('gpBody').textContent,/no longer current/);
 assert.doesNotMatch(h.w.document.getElementById('gpBody').textContent,/QA shower valve/);
 let calls=0;h.w.testDB={collection:()=>({doc:()=>({update:async()=>{calls++;}})})};h.run('_pkDb=()=>window.testDB');
 assert.equal(await h.run("_gpWriteResp({status:'confirmed'})"),false);assert.equal(calls,0);
}finally{h.close();}});

function approveBoth(h){
 h.run("state.session={role:'builder',name:'QA builder'};setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'));state.session={role:'client',site:P().id,name:'QA homeowner'};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'))");
}
test('the photographed finish-change sequence has one approval source and a stable before/after summary',()=>{const h=boot();try{
 h.run("Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{finish:'Matte Black'})})");approveBoth(h);
 h.run("state.session={role:'builder',name:'QA builder'};renderSelections()");
 assert.equal(h.w.document.querySelector('[data-sel="9001"] .approve-ro').textContent,'Approved');
 assert.equal(h.run('selectionHomeownerApproved(P(),P().selections[0])'),true);
 h.run("Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{finish:'Polished Black'})})");
 let html=h.run("packetHTML(P(),'plumb')");assert.match(html,/Matte Black → Polished Black/);assert.match(html,/Homeowner and builder approval pending/);assert.match(html,/Details changed — review again/);
 h.run("state.session={role:'client',site:P().id,name:'QA homeowner'};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'));clientGo('home')");
 assert.doesNotMatch(h.w.document.getElementById('clBody').textContent,/QA shower valve needs your review/);
 h.run("state.session={role:'subs',name:'QA Plumbing'}");html=h.run("packetHTML(P(),'plumb')");
 assert.match(html,/Builder approval pending/);assert.match(html,/Matte Black → Polished Black/);assert.match(html,/Do not install/);
 h.run("state.session={role:'builder',name:'QA builder'};setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'))");
 assert.match(h.run("packetHTML(P(),'plumb')"),/Instructions approved/);
 assert.match(h.run("packetHTML(P(),'plumb')"),/Matte Black → Polished Black/);
 h.run("Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{finish:'Brushed Nickel'})})");
 assert.match(h.run("packetHTML(P(),'plumb')"),/Polished Black → Brushed Nickel/);
 assert.doesNotMatch(h.run("packetHTML(P(),'plumb')"),/Matte Black → Brushed Nickel/);
}finally{h.close();}});
test('a routed selection never falls back to its stale legacy approval or requests a duplicate sign-off',()=>{const h=boot();try{
 h.run('P().selections[0].approved=true');assert.equal(h.run('selectionHomeownerApproved(P(),P().selections[0])'),false);
 h.run("state.session={role:'client',site:P().id,name:'QA homeowner'};clientGo('specs')");
 const card=[...h.w.document.querySelectorAll('#clBody .sel-row')].find(x=>x.textContent.includes('QA shower valve'));
 assert.equal(card.querySelector('button').textContent,'Review packet');assert.match(card.querySelector('button').getAttribute('onclick'),/openSelectionReview/);
 h.run("P().selections[0].spec.finish='';clientGo('home')");
 const requests=[...h.w.document.querySelectorAll('#clBody .pkt-or')].filter(x=>x.textContent.includes('QA shower valve'));
 assert.equal(requests.length,1);assert.match(requests[0].textContent,/needs your answer/);
}finally{h.close();}});
test('multiple affected packet approvals are all required, while unrouted legacy choices retain their flow',()=>{const h=boot();try{
 h.run("P().selections[0].cat='Other';P().subs=[];P().bookings=[];P().selections[0].approved=true");
 assert.equal(h.run('selectionHomeownerApproved(P(),P().selections[0])'),true);
 h.run("P().selections[0].cat='Plumbing Fixtures';P().bookings=[{id:'a',trade:'plumb'},{id:'b',trade:'qa-other'}];SUB_SEL_CATS['qa-other']=['Plumbing Fixtures'];P().selections[0].approved=true");
 approveBoth(h);assert.equal(h.run('selectionHomeownerApproved(P(),P().selections[0])'),false);
 assert.equal(h.run('selectionReviewState(P(),P().selections[0]).approved'),false);
}finally{h.close();}});
test('change summaries escape user text, cover dimensions/dates/documents, and never reveal prices to a crew',()=>{const h=boot();try{
 approveBoth(h);
 h.run("state.session={role:'builder',name:'QA builder'};Data.updateSelection(9001,{price:777,spec:Object.assign({},P().selections[0].spec,{roughin:'<img src=x onerror=alert(1)>'})});P().bookings[0].start+=864e5;P().docs=[{n:'New drawing',trade:'plumb',fileId:'b'}]");
 let html=h.run("packetHTML(P(),'plumb')");assert.match(html,/Rough-in dimension/);assert.match(html,/&lt;img/);assert.match(html,/Dates/);assert.match(html,/New drawing/);assert.match(html,/777/);
 h.run("state.session={role:'subs',name:'QA Plumbing'}");html=h.run("packetHTML(P(),'plumb')");assert.doesNotMatch(html,/777|\$650|<img src=x/);assert.match(html,/Rough-in dimension/);
}finally{h.close();}});
test('crew home distinguishes legacy site readiness from current instruction approval and handles unknown dates',()=>{const h=boot();try{
 h.run("P().subs=[{id:22,name:'QA Plumbing',specialty:'plumb',cleared:true}];state.session={role:'subs',name:'QA Plumbing'};openSubSite(P().id)");
 let body=h.w.document.getElementById('svBody').textContent;assert.match(body,/Instructions need approval/);assert.doesNotMatch(body,/\d+d ago|Cleared to start/);
 approveBoth(h);h.run("state.session={role:'subs',name:'QA Plumbing'};openSubSite(P().id)");
 assert.match(h.w.document.getElementById('svBody').textContent,/Instructions approved · site marked ready/);
 h.run("P().subs[0].cleared=null");assert.match(h.run("packetHTML(P(),'plumb')"),/Wait for your builder to confirm the site is ready/);
 for(const value of ['true','false','null','NaN','1',String(Date.now()+864e5)])assert.equal(h.run('clearanceWhen('+value+')'),'');
 assert.match(h.run('clearanceWhen(Date.now())'),/just now/);
}finally{h.close();}});
test('credit, amount owed, and zero balance agree on homeowner home, both ledgers and the detail sheet',()=>{const h=boot();try{
 h.run("P().invoices=[];P().selections[0].price=650;P().payments=[{amount:3000}]");
 for(const [amount,label,value] of [[3000,'Credit balance','$2,350'],[0,'Still to pay','$650'],[650,'Balance','$0']]){
  h.run(`P().payments=[{amount:${amount}}];state.session={role:'client',site:P().id,name:'QA homeowner'};clientGo('home')`);
  assert.ok(h.w.document.getElementById('clBody').textContent.includes(label+' · '+value));
  h.run("clientGo('specs')");let total=h.w.document.querySelector('#clBody .lr.out').textContent;assert.equal(total,label+value);
  h.run("state.session={role:'builder',name:'QA builder'};renderSelections()");total=h.w.document.querySelector('#selSummary .lr.out').textContent;assert.equal(total,label+value);
  assert.match(h.run('ledgerDetailHTML(P())'),new RegExp(label));
 }
 h.run("P().invoices=[{status:'sent',total:4800,items:[{selId:9001,amount:4800}],payments:[]}];clientTab='specs';state.session={role:'client',site:P().id,name:'QA homeowner'};renderClient()");
 assert.match(h.w.document.getElementById('clBody').textContent,/Invoiced above net change/);
}finally{h.close();}});
test('overpayment on fully invoiced choices is shown as credit rather than a zero invoice balance',()=>{const h=boot();try{
 h.run("P().payments=[];P().invoices=[{status:'sent',total:650,items:[{selId:9001,amount:650}],payments:[{amount:800}]}];state.session={role:'client',site:P().id,name:'QA homeowner'};clientGo('specs')");
 assert.equal(h.w.document.querySelector('#clBody .lr.out').textContent,'Credit balance$150');
 h.run("state.session={role:'builder',name:'QA builder'};renderSelections()");
 assert.equal(h.w.document.querySelector('#selSummary .lr.out').textContent,'Credit balance$150');
}finally{h.close();}});
test('builder packet presents approval before sharing and stops showing review deadlines once approved',()=>{const h=boot();try{
 h.run("P().subs=[{name:'QA Plumbing',specialty:'plumb',specsDue:Date.now()-864e5,cleared:true}]");
 let html=h.run("packetHTML(P(),'plumb')");assert.match(html,/Approve instructions/);assert.doesNotMatch(html,/>Text this link<|Ready for this trade/);
 h.run("P().selections[0].spec.finish=''");assert.match(h.run("packetHTML(P(),'plumb')"),/Complete details/);h.run("P().selections[0].spec.finish='brushed brass'");
 approveBoth(h);h.run("state.session={role:'builder',name:'QA builder'}");html=h.run("packetHTML(P(),'plumb')");
 assert.match(html,/>Text this link</);assert.doesNotMatch(html,/Overdue|review due|Ready for this trade/);
 h.run("state.session={role:'client',site:P().id,name:'QA homeowner'}");html=h.run("packetHTML(P(),'plumb')");
 assert.doesNotMatch(html,/>Signed<\/button>/);assert.match(html,/Withdraw my approval/);
}finally{h.close();}});

test('homeowner approval and withdrawal refresh the underlying page and keep one action in the fixed footer',()=>{const h=boot();try{
 h.run("P().subs=[{id:22,name:'QA Plumbing',specialty:'plumb',cleared:Date.now()}];state.session={role:'client',site:P().id,name:'QA homeowner'};clientGo('specs');openClientPacket('plumb')");
 const doc=h.w.document, body=doc.getElementById('clBody'), foot=doc.getElementById('infoFoot');
 assert.match(body.textContent,/Install packets to approve/);
 assert.equal(foot.querySelector('.btn-primary').textContent,'Approve instructions');
 assert.equal(doc.querySelectorAll('#infoScrim [data-packet-approve]').length,1);
 assert.equal(doc.querySelector('#infoBody [data-packet-approve]'),null);
 assert.equal(foot.closest('.sheet-body'),null,'approval stays outside the scrolling content');
 foot.querySelector('.btn-primary').click();
 assert.equal(h.run("!!packetSignoff(P(),'plumb').homeowner"),true);
 assert.doesNotMatch(body.textContent,/Install packets to approve/,'page updates without navigation or reload');
 assert.equal(foot.querySelector('.btn-primary'),null);
 assert.match(doc.getElementById('infoBody').textContent,/Your builder reviews next/);
 h.run("closeInfo();openClientPacket('plumb')");
 const withdraw=[...doc.querySelectorAll('#infoBody button')].find(b=>b.textContent==='Withdraw my approval');
 withdraw.click();
 assert.equal(h.run("!!packetSignoff(P(),'plumb').homeowner"),false);
 assert.match(body.textContent,/Install packets to approve/);
 assert.ok(foot.querySelector('.btn-primary'));
 for(const own of [false,true]){
  h.run("openClientPacket('plumb')");
  h.run("showInfo('Another sheet','<p>Unrelated information</p>',"+own+")");
  assert.equal(foot.querySelector('.btn-primary'),null,'an unrelated sheet cannot inherit an approval action');
  assert.ok(foot.classList.contains('leave-bar'));
 }
}finally{h.close();}});

test('the fixed approval action refuses changed instructions and disappears when required details are missing',()=>{const h=boot();try{
 approveBoth(h);
 h.run("state.session={role:'builder',name:'QA builder'};Data.updateSelection(9001,{spec:Object.assign({},P().selections[0].spec,{finish:'Matte Black'})});state.session={role:'client',site:P().id,name:'QA homeowner'};openClientPacket('plumb')");
 const doc=h.w.document, foot=doc.getElementById('infoFoot');
 assert.equal(foot.querySelector('.btn-primary').textContent,'Approve changes');
 h.run("P().selections[0].spec.finish='Polished Black'");
 foot.querySelector('.btn-primary').click();
 assert.equal(h.run("!!packetSignoff(P(),'plumb').homeowner"),false);
 assert.match(doc.getElementById('toast').textContent,/changed/);
 assert.match(doc.getElementById('infoBody').textContent,/Polished Black/);
 foot.querySelector('.btn-primary').click();
 assert.equal(h.run("!!packetSignoff(P(),'plumb').homeowner"),true);
 assert.equal(h.run("packetReady(P(),'plumb')"),false,'builder must still approve the revision');
 h.run("P().selections[0].spec.finish='';refreshPacket()");
 assert.equal(foot.querySelector('.btn-primary'),null);
}finally{h.close();}});

test('builder attention labels distinguish missing specifications from pending approvals',()=>{const h=boot();try{
 h.run("P().subs=[{id:22,name:'QA Plumbing',specialty:'plumb',cleared:Date.now()}];P().bookings[0].start=dayStart(Date.now())+3*864e5;P().bookings[0].end=dayStart(Date.now())+4*864e5");
 const issues=()=>JSON.parse(h.run("JSON.stringify(_nyIssues([P()]).filter(x=>x.go===\"openPacketFor('\"+P().id+\"','plumb')\"))"));
 assert.ok(issues().some(x=>x.kind==='Approval needed'&&x.line==='Homeowner and builder approval pending'));
 h.run("state.session={role:'client',site:P().id,name:'QA homeowner'};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'));state.session={role:'builder',name:'QA builder'}");
 assert.ok(issues().some(x=>x.kind==='Approval needed'&&x.line==='Builder approval pending'));
 assert.equal(h.run("pktAsk(P(),'plumb').some(x=>String(x.go).startsWith('openPacketFor('))"),false,'packet does not link back to its own approval request');
 h.run("P().selections[0].spec.finish=''");
 assert.ok(issues().some(x=>x.kind==='Spec still open'));
 h.run("P().selections[0].spec.finish='Matte Black'");approveBoth(h);
 assert.equal(issues().length,0);
}finally{h.close();}});

for(const loss of ['missing','permission-denied']){
 test('in-app guest clears instructions after authoritative access loss: '+loss,async()=>{const h=boot();try{
  let next,error,writes=0;
  h.w.testDB={collection:()=>({doc:()=>({onSnapshot:(opts,n,e)=>{assert.equal(opts.includeMetadataChanges,true);next=n;error=e;return ()=>{};},update:async()=>{writes++;}})})};
  h.run("_gpToken='pk_qa';_gpSnap=packetSnapshot(P(),P().bookings[0]);_gpCacheWrite(_gpToken,_gpSnap);_gpRender();_pkDb=()=>window.testDB;_gpListen();_gpPendingRemote=_gpSnap");
  if(loss==='missing')next({exists:false,metadata:{fromCache:false}});else error({code:'permission-denied'});
  assert.match(h.w.document.getElementById('gpBody').textContent,/no longer current/);
  assert.doesNotMatch(h.w.document.getElementById('gpBody').textContent,/QA shower valve/);
  assert.equal(h.run('_gpPendingRemote'),null);
  assert.equal(h.run("_gpCacheRead('pk_qa').revoked"),true);
  assert.equal(await h.run("_gpWriteResp({status:'confirmed'})"),false);assert.equal(writes,0);
 }finally{h.close();}});
 test('standalone guest clears instructions after authoritative access loss: '+loss,async()=>{
  let next,error,writes=0;
  const h=guestBoot(async()=>{writes++;},(opts,n,e)=>{assert.equal(opts.includeMetadataChanges,true);next=n;error=e;return ()=>{};});try{
   h.w.guestInspect('listen();_pending=_snap');
   if(loss==='missing')next({exists:false,metadata:{fromCache:false}});else error({code:'permission-denied'});
   assert.match(h.w.document.getElementById('body').textContent,/no longer current/);
   assert.doesNotMatch(h.w.document.getElementById('body').textContent,/QA valve/);
   assert.equal(h.w.guestInspect('_pending'),null);
   h.w.gpConfirm();await new Promise(r=>setTimeout(r,0));assert.equal(writes,0);
  }finally{h.close();}
 });
}

test('cache misses and transient read errors do not revoke either guest; cached data cannot undo access loss',()=>{
 const h=boot(),g=guestBoot(async()=>{});try{
  h.run("_gpToken='pk_qa';_gpSnap=packetSnapshot(P(),P().bookings[0]);_gpRender();window.oldGuest=_gpSnap");
  g.w.guestInspect('window.oldGuest=_snap');
  for(const code of ['unavailable','deadline-exceeded']){
   h.run("_gpReceive({exists:false,metadata:{fromCache:true}},false);_gpReadError({code:"+JSON.stringify(code)+"})");
   g.w.guestInspect("receive({exists:false,metadata:{fromCache:true}},false);readError({code:"+JSON.stringify(code)+"})");
  }
  assert.match(h.w.document.getElementById('gpBody').textContent,/QA shower valve/);
  assert.match(g.w.document.getElementById('body').textContent,/QA valve/);
  h.run("_gpReceive({exists:false,metadata:{fromCache:false}},false);_gpReceive({exists:true,metadata:{fromCache:true},data:()=>window.oldGuest},false)");
  g.w.guestInspect("receive({exists:false,metadata:{fromCache:false}},false);receive({exists:true,metadata:{fromCache:true},data:()=>window.oldGuest},false)");
  assert.match(h.w.document.getElementById('gpBody').textContent,/no longer current/);
  assert.match(g.w.document.getElementById('body').textContent,/no longer current/);
  h.run("_gpReceive({exists:true,metadata:{fromCache:false},data:()=>window.oldGuest},true)");
  g.w.guestInspect("receive({exists:true,metadata:{fromCache:false},data:()=>window.oldGuest},true)");
  assert.match(h.w.document.getElementById('gpBody').textContent,/QA shower valve/);
  assert.match(g.w.document.getElementById('body').textContent,/QA valve/);
 }finally{h.close();g.close();}
});
