'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
function boot(){
 const root=path.join(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'app/index.html'),'utf8').replace('<script src="workspace.js"></script>','<script>'+fs.readFileSync(path.join(root,'app/workspace.js'),'utf8')+'</script><script>window.run=s=>eval(s)</script>');
 const dom=new JSDOM(html,{url:'https://qa.invalid/',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){},addListener(){}});w.indexedDB={open:()=>({})};w.scrollTo=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};}});
 const w=dom.window,run=w.run;run(`state.session={role:'builder',name:'QA Builder'};state.activeId=state.projects[0].id;P().street='42 Sample Lane';P().selections=[{id:9901,item:'QA shower valve',cat:'Plumbing Fixtures',room:'Primary Bath',price:650,spec:{},status:'selected'}];specFields(P().selections[0]).forEach(f=>P().selections[0].spec[f.key]=f.who==='homeowner'?'Matte Black':'QA detail');P().packetSignoff={};P().workspaceRecords=[];P().subs=[{id:9902,name:'QA Plumbing',specialty:'plumb',cleared:Date.now()}];P().bookings=[];P().docs=[];`);
 const approve=()=>run(`state.session={role:'client',name:'QA Homeowner',site:P().id};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'));state.session={role:'builder',name:'QA Builder'};setPacketSignoff(P(),'plumb','builder',true,packetApprovalKey(P(),'plumb'));`);
 const crew=()=>run(`state.session={role:'subs',name:'QA Plumbing'};SitePlumbWorkspace.workReview(P().id,'plumb');`);
 return {w,run,approve,crew,close:()=>w.close()};
}
test('workspace follows the real approval owner and exposes a working selection route',()=>{const h=boot();try{
 h.run('renderOverview()');assert.match(h.w.document.getElementById('ovToday').textContent,/Keep the build moving/);
 assert.equal(h.run("SitePlumbWorkspace.next(P(),'plumb').who"),'Homeowner');
 h.run("state.session={role:'client',name:'QA Homeowner',site:P().id};setPacketSignoff(P(),'plumb','homeowner',true,packetApprovalKey(P(),'plumb'))");
 assert.equal(h.run("SitePlumbWorkspace.next(P(),'plumb').label"),'Approval needed');
 h.run("state.session={role:'builder',name:'QA Builder'};SitePlumbWorkspace.house(P().id,'selections')");assert.ok(h.w.document.querySelector('#view-decisions.active'));assert.notEqual(h.w.document.getElementById('decSelections').style.display,'none');
 }finally{h.close();}});
test('crew cannot acknowledge until both current approvals exist, and another trade cannot acknowledge',async()=>{const h=boot();try{
 h.crew();assert.equal(await h.w.SitePlumbWorkspace.recordWork('ack'),false);h.approve();h.crew();h.run("state.session={role:'subs',name:'Different crew'}");assert.equal(await h.w.SitePlumbWorkspace.recordWork('ack'),false);
 h.crew();assert.equal(await h.w.SitePlumbWorkspace.recordWork('ack'),true);assert.equal(h.run('P().workspaceRecords.length'),1);
 }finally{h.close();}});
test('instruction revision archives the record, invalidates approvals, and rejects a stale acknowledgement',async()=>{const h=boot();try{
 h.approve();h.crew();await h.w.SitePlumbWorkspace.recordWork('ack');const old=h.run('JSON.stringify(P().workspaceRecords[0].instructions)');
 h.crew();h.run("state.session={role:'builder',name:'QA Builder'};Data.updateSelection(9901,{spec:Object.assign({},P().selections[0].spec,{finish:'Polished Black'})});state.session={role:'subs',name:'QA Plumbing'}");
 assert.equal(await h.w.SitePlumbWorkspace.recordWork('ack'),false);assert.equal(h.run("SitePlumbWorkspace.currentRecord(P(),'plumb')"),undefined);assert.equal(h.run("packetSignedBoth(P(),'plumb')"),false);assert.equal(h.run('JSON.stringify(P().workspaceRecords[0].instructions)'),old);assert.match(h.run("SitePlumbWorkspace.lifecycleHTML(P(),'plumb')"),/Superseded/);
 }finally{h.close();}});
test('installation evidence requires acknowledgement; verification requires a different authorized actor and explicit check',async()=>{const h=boot();try{
 h.approve();h.crew();assert.equal(await h.w.SitePlumbWorkspace.recordWork('install'),false);await h.w.SitePlumbWorkspace.recordWork('ack');h.crew();
 h.w.document.getElementById('wsInstallNote').value='Installed the sample valve and checked the recorded finish and location.';assert.equal(await h.w.SitePlumbWorkspace.recordWork('install'),true);
 h.run("SitePlumbWorkspace.workReview(P().id,'plumb')");assert.equal(await h.w.SitePlumbWorkspace.recordWork('verify'),false);
 h.run("state.session={role:'builder',name:'QA Builder'};SitePlumbWorkspace.workReview(P().id,'plumb')");assert.equal(await h.w.SitePlumbWorkspace.recordWork('verify'),false);
 h.w.document.getElementById('wsVerifyNote').value='Independently checked the installed finish and location against the instructions.';h.w.document.getElementById('wsVerifyCheck').checked=true;
 assert.equal(await h.w.SitePlumbWorkspace.recordWork('verify'),true);assert.equal(h.run("SitePlumbWorkspace.next(P(),'plumb').label"),'Verified');
 }finally{h.close();}});
test('withdrawal holds previously acknowledged work and rejects installation',async()=>{const h=boot();try{
 h.approve();h.crew();await h.w.SitePlumbWorkspace.recordWork('ack');h.crew();
 h.run("state.session={role:'client',name:'QA Homeowner',site:P().id};setPacketSignoff(P(),'plumb','homeowner',false);state.session={role:'subs',name:'QA Plumbing'}");assert.equal(await h.w.SitePlumbWorkspace.recordWork('install'),false);assert.match(h.run("SitePlumbWorkspace.lifecycleHTML(P(),'plumb')"),/Do not install/);
 }finally{h.close();}});
test('homeowner build brief changes do not silently rewrite approved installation instructions',()=>{const h=boot();try{
 h.approve();const key=h.run("packetApprovalKey(P(),'plumb')");h.run("state.session={role:'client',name:'QA Homeowner',site:P().id};SitePlumbWorkspace.brief(P().id)");h.w.document.getElementById('wsPriorities').value='Comfort and easy maintenance.';h.w.SitePlumbWorkspace.saveBrief();assert.equal(h.run('P().buildBrief.priorities'),'Comfort and easy maintenance.');assert.equal(h.run("packetApprovalKey(P(),'plumb')"),key);assert.equal(h.run("packetSignedBoth(P(),'plumb')"),true);
 }finally{h.close();}});
