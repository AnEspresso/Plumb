const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),{getDoc,doc}=require('firebase/firestore');
const {fixtures}=require('../release/fixtures.cjs'),{parse,provision}=require('../release/provision.cjs'),{service}=require('../functions/service.cjs');
let app,db,auth,rules;const plan=fixtures();
before(()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');app=initializeApp({projectId:'demo-siteplumb-qa'},'release-tests');db=getFirestore(app);auth=getAuth(app);});
after(async()=>{await rules?.cleanup();await db?.terminate();if(app)await deleteApp(app);});
test('provisioner defaults to plan and rejects production/malformed apply arguments',()=>{
 assert.deepEqual(parse([]),{apply:false});assert.throws(()=>parse(['--apply','plumb-467a0','--credentials-out','/tmp/secret.json']));assert.throws(()=>parse(['--apply','siteplumb-staging','--credentials-out','relative.json']));assert.throws(()=>parse(['--apply','siteplumb-staging','--credentials-out',process.cwd()+'/secret.json']));assert.equal(plan.users.length,12);assert.equal(plan.houses.length,3);
});
test('reviewed fixtures provision locally without overwriting existing accounts or data',async()=>{
 let credentials;const result=await provision(db,auth,data=>{credentials=data;});assert.equal(result.accounts,12);assert.equal(result.documents,plan.documents.length);assert.equal(credentials.accounts.length,12);assert.equal(new Set(credentials.accounts.map(a=>a.password)).size,12);assert.ok(credentials.accounts.every(a=>a.password.length>=32));
 assert.equal((await auth.getUser('qa_disabled')).disabled,true);assert.equal((await auth.getUser('qa_homeowner')).disabled,false);
 await assert.rejects(provision(db,auth,()=>{throw Error('Should not overwrite credentials');}),/already exist/);
});
test('fixture membership matrix enforces house, company, trade and capability boundaries',async()=>{
 const api=service(db,'demo-siteplumb-qa'),get={op:'get',houseId:'qa_a1',packetId:'plumb'};
 for(const uid of ['qa_owner','qa_gc','qa_pm']){const p=await api.run(uid,get);assert.equal(p.capabilities.specify,true);assert.equal(p.capabilities.approve,true);}
 assert.equal((await api.run('qa_employee',get)).capabilities.approve,false);
 assert.equal((await api.run('qa_homeowner',get)).capabilities.answer,true);
 assert.equal((await api.run('qa_crew',get)).content.selections[0].price,undefined);
 for(const uid of ['qa_wrong_trade','qa_revoked','qa_other_house','qa_other_company','qa_unassigned'])await assert.rejects(api.run(uid,get),{code:'permission-denied'});
 assert.deepEqual(await api.run('qa_wrong_trade',{op:'list'}),[]);assert.deepEqual(await api.run('qa_unassigned',{op:'list'}),[]);
});
test('rollback deny-all rules reject previously authorized direct client access',async()=>{
 rules=await initializeTestEnvironment({projectId:'demo-siteplumb-qa',firestore:{rules:fs.readFileSync('release/rollback/firestore.rules','utf8')}});
 for(const uid of ['qa_owner','qa_homeowner','qa_crew'])await assertFails(getDoc(doc(rules.authenticatedContext(uid).firestore(),'houses/qa_a1/packets/plumb')));
 const page=fs.readFileSync('release/rollback/index.html','utf8');assert.match(page,/Do not install/);assert.doesNotMatch(page,/<script|https?:\/\//);
});
