const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {JSDOM,VirtualConsole}=require('jsdom');
const {getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore'),{getApp,deleteApp}=require('firebase-admin/app');
const {hash}=require('../functions/service.cjs'),{build}=require('../build.cjs');
let server,db,w,corePassed=false;const errors=[],requests=[];
const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label+'; '+w?.document.getElementById('stagingMessage')?.textContent+'; '+errors.join(';'));};
before(async()=>{
 assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');process.env.GCLOUD_PROJECT='demo-siteplumb-qa';
 const {packetCommand}=require('../functions/index.cjs');const express=require('express'),app=express();app.use(express.json());app.post('/demo-siteplumb-qa/us-central1/packetCommand',packetCommand);server=http.createServer(app);await new Promise(r=>server.listen(5001,'127.0.0.1',r));
 db=getFirestore();const content={selections:[{id:9001,item:'QA shower valve',cat:'Plumbing Fixtures',room:'Bath',price:450,note:'Keep Note unchanged',spec:{finish:'',rough:'Approved valve'},specCustom:[]}],docs:[],bookings:[],notes:''};
 const batch=db.batch();batch.set(db.doc('houses/sdk'),{companyId:'sdk',address:'42 Sample Lane'});batch.set(db.doc('houses/sdk/packets/plumb'),{trade:'plumb',currentRevision:'sdk_r1',approvals:{},policy:{9001:[{key:'rough',label:'Rough-in',who:'builder',required:true},{key:'finish',label:'Finish',who:'homeowner',required:true}]}});batch.set(db.doc('houses/sdk/packets/plumb/revisions/sdk_r1'),{id:'sdk_r1',content,hash:hash(content),changes:[]});
 for(const [uid,role] of [['sdkhome','homeowner'],['sdkbuilder','owner'],['sdkcrew','crew']]){await getAuth().createUser({uid,email:uid+'@example.test',password:'OnlyLocalFake123!'});batch.set(db.doc('houses/sdk/members/'+uid),{active:true,companyId:'sdk',role,trades:['plumb']});batch.set(db.doc('companies/sdk/members/'+uid),{active:true});batch.set(db.doc('users/'+uid+'/packetAssignments/sdk'),{houseId:'sdk',packetId:'plumb'});}
 await batch.commit();
 const {out}=build('emulator'),vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const html=fs.readFileSync(path.join(out,'app/index.html'),'utf8').replace(/<script[^>]*src=["'][^"']+["'][^>]*><\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:5002',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(win){win.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){}});win.scrollTo=()=>{};win.HTMLMediaElement.prototype.pause=()=>{};win.HTMLMediaElement.prototype.load=()=>{};win.PlumbRuntime={kind:'local',config:()=>null};win.TextEncoder=TextEncoder;win.TextDecoder=TextDecoder;win.Response=Response;win.Request=Request;win.Headers=Headers;
 win.fetch=async(input,init={})=>{const url=new URL(typeof input==='string'?input:input.url);if(url.hostname!=='127.0.0.1'||!['9099','5001'].includes(url.port))throw Error('Unexpected network destination: '+url.origin);requests.push(url.origin+url.pathname);const headers=new Headers(init.headers);headers.set('Origin','http://127.0.0.1:5002');return fetch(input,{...init,headers});};}});
 w=dom.window;w.eval(fs.readFileSync(path.join(out,'app/staging-sdk.js'),'utf8'));w.eval(fs.readFileSync(path.join(out,'app/staging-adapter.js'),'utf8'));await wait(()=>w.document.getElementById('stagingMessage').textContent.includes('Sign in'),'SDK startup');
});
after(async()=>{if(w){w.document.getElementById('stagingLogout').click();await new Promise(r=>setTimeout(r,50));w.close();}await new Promise(r=>server?.close(r));await db?.terminate();await deleteApp(getApp());});
async function login(uid){
 if(!w.document.getElementById('stagingAccount').hidden){w.document.getElementById('stagingLogout').click();await wait(()=>!w.document.getElementById('stagingLogin').hidden,'logout');assert.equal(w.document.getElementById('infoBody').textContent,'');}
 w.document.getElementById('stagingEmail').value=uid+'@example.test';w.document.getElementById('stagingPassword').value='OnlyLocalFake123!';w.document.getElementById('stagingLogin').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>w.document.querySelector('#assignments button'),'assignment discovery');assert.equal(w.document.getElementById('stagingPassword').value,'');w.document.querySelector('#assignments button').click();await wait(()=>w.StagingReview.current,'packet load');
}
async function review(){[...w.document.querySelectorAll('#packetActions button')].find(b=>b.textContent==='Review packet').click();await wait(()=>w.document.getElementById('infoScrim').classList.contains('show'),'review');}
async function approve(role){const b=w.document.querySelector('#infoFoot .btn-primary');assert.ok(b,'Actual approval action');b.click();await wait(()=>w.StagingReview.current?.approvals[role].status==='Signed','approval saved');}
async function finish(value){[...w.document.querySelectorAll('#packetActions button')].find(b=>/Answer selections|Install spec sheet/.test(b.textContent)).click();const input=w.document.querySelector('#specBody input[data-key="finish"]');assert.ok(input);input.value=value;await w.saveSpec();assert.equal(w.StagingReview.current?.content.selections[0].spec.finish,value);}
test('real Web SDK signs in and completes the revision approval sequence',async()=>{
 await login('sdkhome');await finish('Matte Black');await approve('homeowner');
 await login('sdkbuilder');await review();assert.equal(w.StagingReview.current.approvals.homeowner.status,'Signed');assert.equal(w.StagingReview.current.approvals.builder.status,'Pending');const builderRow=[...w.document.querySelectorAll('#infoBody .row')].find(r=>r.querySelector('.row-title')?.textContent==='Builder / team');assert.match(builderRow.textContent,/Pending/);await approve('builder');
 await login('sdkcrew');await review();assert.equal(w.StagingReview.current.approved,true);assert.match(w.document.getElementById('infoBody').textContent,/Matte Black/);assert.equal(w.StagingReview.current.content.selections[0].price,undefined);
 await login('sdkbuilder');await finish('Polished Black');assert.equal(w.StagingReview.current.changes[0].text,'Finish: Matte Black → Polished Black');assert.equal(w.StagingReview.current.content.selections[0].note,'Keep Note unchanged');
 await login('sdkcrew');await review();assert.equal(w.StagingReview.current.approved,false);assert.deepEqual(Array.from(Object.values(w.StagingReview.current.approvals),a=>a.status),['Pending','Pending']);assert.match(w.document.getElementById('infoBody').textContent,/Do not install/);
 await login('sdkhome');await review();assert.equal(w.document.querySelector('#infoFoot .btn-primary').textContent,'Approve changes');await approve('homeowner');
 await login('sdkcrew');await review();assert.equal(w.StagingReview.current.approvals.homeowner.status,'Signed');assert.equal(w.StagingReview.current.approvals.builder.status,'Pending');assert.match(w.document.getElementById('infoBody').textContent,/Do not install/);
 await login('sdkbuilder');await review();await approve('builder');await login('sdkcrew');await review();assert.equal(w.StagingReview.current.approved,true);assert.match(w.document.getElementById('infoBody').textContent,/Polished Black/);assert.match(w.document.getElementById('infoBody').textContent,/Instructions approved/);
 assert.ok(requests.some(u=>u.includes(':9099/')));assert.ok(requests.some(u=>u.includes(':5001/')));assert.deepEqual(errors,[]);
 corePassed=true;
});
test('revoked house membership clears previously approved crew instructions on refresh',async t=>{
 if(!corePassed){t.skip('Core sequence did not pass');return;}
 assert.equal(w.StagingReview.current?.approved,true);
 await db.doc('houses/sdk/members/sdkcrew').update({active:false});
 [...w.document.querySelectorAll('#packetActions button')].find(b=>b.textContent==='Review packet').click();
 await wait(()=>w.document.getElementById('stagingMessage').textContent.includes('Packet access unavailable'),'revoked response');
 await wait(()=>w.StagingReview.current===null,'revoked packet cleared');
 assert.equal(w.document.getElementById('infoBody').textContent,'');assert.equal(w.document.querySelector('#infoFoot .btn-primary'),null);assert.match(w.document.getElementById('stagingMessage').textContent,/Packet access unavailable/);
});
