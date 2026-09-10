const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,serverTimestamp}=require('firebase/firestore');
const {service,hash}=require('../functions/service.cjs');
const {configuration,DEMO}=require('../functions/config.cjs');
let app,db,api,rules;
const get={op:'get',houseId:'a',packetId:'plumbing'};
let seq=0;
const command=(op,revision,extra={})=>({...get,op,expectedRevision:revision,requestId:'request_'+ ++seq,...extra});
before(async()=>{
 assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
 app=initializeApp({projectId:DEMO},'tests');db=getFirestore(app);api=service(db,DEMO);
 rules=await initializeTestEnvironment({projectId:DEMO,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 await rules.clearFirestore();
 const content={selections:[{id:9001,item:'QA shower valve',price:450,note:'Keep this note',spec:{finish:'',rough:'Approved valve'},specCustom:[]}],notes:'Job notes',docs:[],bookings:[]};
 const batch=db.batch();
 for(const house of ['a','b']){
  batch.set(db.doc('houses/'+house),{companyId:house,address:house==='a'?'42 Sample Lane':'Other house'});
  batch.set(db.doc(`houses/${house}/packets/plumbing`),{trade:'plumbing',currentRevision:'r1',approvals:{},policy:{9001:[{key:'finish',label:'Finish',who:'homeowner',required:true},{key:'rough',label:'Rough-in',who:'builder',required:true}]}});
  batch.set(db.doc(`houses/${house}/packets/plumbing/revisions/r1`),{id:'r1',content,hash:hash(content),changes:[]});
 }
 for(const [uid,role,extra] of [['home','homeowner',{}],['builder','owner',{}],['crew','crew',{trades:['plumbing']}],['wrongtrade','crew',{trades:['electrical']}],['employee','employee',{capabilities:[]}],['pm','pm',{capabilities:['specify','approve']}],['revoked','owner',{}]]){
  batch.set(db.doc('houses/a/members/'+uid),{active:true,companyId:'a',role,...extra});
  batch.set(db.doc('companies/a/members/'+uid),{active:uid!=='revoked'});
  batch.set(db.doc('users/'+uid+'/packetAssignments/a'),{houseId:'a',packetId:'plumbing'});
 }
 await batch.commit();
});
after(async()=>{await rules?.cleanup();await db?.terminate();if(app)await deleteApp(app);});
test('configuration rejects production and mixed targets',()=>{
 assert.throws(()=>configuration({GCLOUD_PROJECT:'plumb-467a0'}));
 assert.throws(()=>configuration({GCLOUD_PROJECT:'siteplumb-staging',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}));
 assert.throws(()=>configuration({GCLOUD_PROJECT:DEMO,FIRESTORE_EMULATOR_HOST:'remote:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'}));
 assert.equal(configuration({GCLOUD_PROJECT:'siteplumb-staging'}).emulator,false);
});
test('cross-house, wrong trade, revoked company and unassigned access denied',async()=>{
 for(const uid of ['outsider','wrongtrade','revoked'])await assert.rejects(api.run(uid,get),{code:'permission-denied'});
 await assert.rejects(api.run('builder',{...get,houseId:'b'}),{code:'permission-denied'});
 assert.equal((await api.run('home',{op:'list'})).length,1);
});
test('revision loop preserves Note, invalidates both approvals and resolves old revisions',async()=>{
 await assert.rejects(api.run('home',command('approve','r1')),{code:'failed-precondition'});
 let p=await api.run('home',command('spec','r1',{selectionId:9001,spec:{finish:'Matte Black'}}));
 const matte=p.revision;
 p=await api.run('home',command('approve',matte));
 assert.equal(p.approvals.homeowner.status,'Signed');assert.equal(p.approvals.builder.status,'Pending');
 p=await api.run('builder',command('approve',matte));assert.equal(p.approved,true);
 const immutable=(await db.doc('houses/a/packets/plumbing/revisions/'+matte).get()).data();
 const edit=command('spec',matte,{selectionId:9001,spec:{finish:'Polished Black'}});
 p=await api.run('builder',edit);const polished=p.revision;
 assert.notEqual(polished,matte);assert.equal(p.content.selections[0].note,'Keep this note');
 assert.equal(p.changes[0].text,'Finish: Matte Black → Polished Black');
 assert.deepEqual(Object.values(p.approvals).map(a=>a.status),['Pending','Pending']);
 assert.match(p.status,/Do not install/);
 assert.equal((await api.run('builder',edit)).revision,polished);
 await assert.rejects(api.run('builder',{...edit,spec:{finish:'White'}}),{code:'already-exists'});
 await assert.rejects(api.run('home',command('approve',matte)),{code:'failed-precondition'});
 const old=await api.run('crew',{...get,requestedRevision:matte});assert.equal(old.superseded,true);assert.equal(old.revision,polished);assert.equal(old.content.selections[0].price,undefined);
 p=await api.run('home',command('approve',polished));assert.equal(p.approved,false);assert.match(p.status,/Do not install/);
 p=await api.run('builder',command('approve',polished));assert.equal(p.approved,true);assert.equal(p.status,'Instructions approved');
 assert.deepEqual((await db.doc('houses/a/packets/plumbing/revisions/'+matte).get()).data(),immutable);
});
test('capabilities and technical ownership enforced by service',async()=>{
 const p=await api.run('home',get);
 await assert.rejects(api.run('home',command('spec',p.revision,{selectionId:9001,spec:{rough:'Other'}})),{code:'permission-denied'});
 for(const uid of ['employee','crew'])await assert.rejects(api.run(uid,command('approve',p.revision)),{code:'permission-denied'});
 await assert.rejects(api.run('builder',command('spec',p.revision,{selectionId:9001,spec:{note:'Wrong field'}})),{code:'invalid-argument'});
});
test('rules deny direct authoritative writes and crew price-bearing reads',async()=>{
 const home=rules.authenticatedContext('home').firestore(),crew=rules.authenticatedContext('crew').firestore(),other=rules.authenticatedContext('outsider').firestore();
 const path='houses/a/packets/plumbing';
 await assertSucceeds(getDoc(doc(home,path)));
 await assertFails(getDoc(doc(crew,path)));await assertFails(getDoc(doc(other,path)));
 await assertFails(setDoc(doc(home,path),{currentRevision:'forged'}));
 await assertFails(setDoc(doc(home,'houses/a/members/home'),{role:'owner'}));
 const p=await api.run('home',get);
 const proposal={uid:'home',revision:p.revision,field:'Rough-in',value:'Please review',createdAt:serverTimestamp()};
 await assertSucceeds(setDoc(doc(home,path+'/proposals/one'),proposal));
 await assertFails(setDoc(doc(home,path+'/proposals/one'),proposal));
 await assertFails(setDoc(doc(home,path+'/proposals/two'),{...proposal,uid:'builder'}));
});
test('concurrent edits cannot silently overwrite each other',async()=>{
 const p=await api.run('builder',get);
 const results=await Promise.allSettled(['Chrome','Brass'].map(finish=>api.run('builder',command('spec',p.revision,{selectionId:9001,spec:{finish}}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'failed-precondition');
});
