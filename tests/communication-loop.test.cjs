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
function guestBoot(update){
 const fixture={site:'QA sample home',siteId:'qa-house',bookingId:'qa-booking',trade:'plumb',tradeLabel:'Plumbing',sub:'QA Plumbing',builder:'QA Builder',start:Date.now(),end:Date.now(),expires:Date.now()+86400000,q:[],resp:null,specs:[{item:'QA valve',rows:[]}],release:{approved:false,label:'Hold — approval needed'}};
 const dom=new JSDOM(fs.readFileSync(path.join(app,'p.html'),'utf8'),{url:'https://qa.invalid/app/p.html?packet=pk_test',runScripts:'dangerously',virtualConsole:new VirtualConsole(),beforeParse(w){
  w.__packetFixture=fixture;w.PlumbRuntime={kind:'production'};
  const firestore=()=>({collection:()=>({doc:()=>({update})})});
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
  w.demoRole('client');assert.equal(w.inspect('state.session.role'),'client');w.openSpec(9901);
  assert.ok([...w.document.querySelectorAll('#specBody input')].some(x=>x.readOnly));
  w.demoRole('subs');assert.equal(w.inspect('state.session.name'),'QA Plumbing');w.demoRole('builder');w.qaGuide();
  assert.match(w.document.getElementById('infoBody').textContent,/Try|Choose|Homeowner/);assert.deepEqual(external,[]);
 }finally{if(dom)dom.window.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('an expired or revoked packet replaces cached instructions and refuses responses',async()=>{const h=boot();try{
 h.run("_gpToken='pk_qa';_gpSnap=packetSnapshot(P(),P().bookings[0]);_gpRender();_gpApplyRemote(Object.assign({},_gpSnap,{revoked:true}))");
 assert.match(h.w.document.getElementById('gpBody').textContent,/no longer current/);
 assert.doesNotMatch(h.w.document.getElementById('gpBody').textContent,/QA shower valve/);
 let calls=0;h.w.testDB={collection:()=>({doc:()=>({update:async()=>{calls++;}})})};h.run('_pkDb=()=>window.testDB');
 assert.equal(await h.run("_gpWriteResp({status:'confirmed'})"),false);assert.equal(calls,0);
}finally{h.close();}});
