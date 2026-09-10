const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const {build}=require('../build.cjs');
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('UI state timed out');};
test('spec sheet sends Finish, displays hold, and clears packet offline',async()=>{
 const {out}=build('emulator');
 const html=fs.readFileSync(path.join(out,'app/index.html'),'utf8').replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/g,'');
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 let packet={houseId:'a',packetId:'plumbing',address:'42 Sample Lane',trade:'plumbing',role:'homeowner',capabilities:{answer:true,approve:true,specify:false},revision:'r1',hash:'h',policy:{9001:[{key:'finish',label:'Finish',who:'homeowner',required:true},{key:'rough',label:'Rough-in',who:'builder',required:true}]},content:{selections:[{id:9001,item:'QA shower valve',cat:'Plumbing Fixtures',spec:{finish:'',rough:'Approved valve'},note:'Do not alter',specCustom:[]}],docs:[],bookings:[],notes:''},changes:[],approvals:{homeowner:{status:'Pending'},builder:{status:'Pending'}},missing:['Finish'],approved:false,status:'Do not install — current homeowner and builder approvals are required.'};
 let sent;
 const dom=new JSDOM(html,{url:'http://127.0.0.1:5002',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});w.scrollTo=()=>{};w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.load=()=>{};w.PlumbRuntime={kind:'local',config:()=>null,functionsBase:null};}});
 const w=dom.window;
 w.SitePlumbSDK={start:async()=>({auth:{currentUser:{uid:'home'}},watch:fn=>fn({uid:'home'}),command:async data=>{if(data.op==='list')return [{houseId:'a',packetId:'plumbing',address:'42 Sample Lane',trade:'plumbing'}];if(data.op==='spec'){sent=data;packet=structuredClone(packet);packet.revision='r2';packet.content.selections[0].spec.finish=data.spec.finish;packet.missing=[];packet.changes=[{text:'Finish: Not set → Matte Black'}];}return structuredClone(packet);}})};
 w.eval(fs.readFileSync(path.join(out,'app/staging-adapter.js'),'utf8'));
 try{
  await wait(()=>w.document.querySelector('#assignments button'));w.document.querySelector('#assignments button').click();await wait(()=>w.StagingReview.current);
  [...w.document.querySelectorAll('#packetActions button')].find(b=>b.textContent==='Answer selections').click();
  const finish=w.document.querySelector('#specBody input[data-key="finish"]');assert.ok(finish);assert.equal(w.document.querySelector('#specBody input[data-key="rough"]').readOnly,true);
  finish.value='Matte Black';await w.saveSpec();assert.deepEqual(Object.keys(sent.spec),['finish']);assert.equal(sent.spec.finish,'Matte Black');
  assert.match(w.document.getElementById('infoBody').textContent,/Matte Black/);assert.match(w.document.getElementById('infoBody').textContent,/Do not install/);assert.equal(w.StagingReview.current.content.selections[0].note,'Do not alter');
  w.dispatchEvent(new w.Event('offline'));assert.equal(w.StagingReview.current,null);assert.equal(w.document.getElementById('infoBody').textContent,'');assert.deepEqual(errors,[]);
 }finally{w.close();}
});
