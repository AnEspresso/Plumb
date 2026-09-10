'use strict';
// Default is a local plan. Cloud writes require an explicit release-time flag.
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {fixtures}=require('./fixtures.cjs');
function parse(args){
 if(args.length===0||args.length===1&&args[0]==='--plan')return {apply:false};
 if(args.length!==4||args[0]!=='--apply'||args[1]!=='siteplumb-staging'||args[2]!=='--credentials-out'||!path.isAbsolute(args[3]))throw Error('Use --plan, or --apply siteplumb-staging --credentials-out /private/absolute/path.json after release approval');
 if(args[3].startsWith(path.resolve(__dirname,'../../..')+path.sep))throw Error('Credentials must be outside the source checkout');
 return {apply:true,out:args[3]};
}
async function provision(db,auth,saveCredentials){
 if(!['demo-siteplumb-qa','siteplumb-staging'].includes(db.projectId))throw Error('Wrong database project');
 const plan=fixtures(),refs=plan.documents.map(d=>db.doc(d.path));
 if((await db.getAll(...refs)).some(s=>s.exists))throw Error('Fixture documents already exist; no overwrite or reset performed');
 for(const u of plan.users){
  for(const lookup of [()=>auth.getUser(u.uid),()=>auth.getUserByEmail(u.email)]){
   try{await lookup();throw Error('Fixture identity already exists; no overwrite performed');}catch(e){if(e.code!=='auth/user-not-found')throw e;}
  }
 }
 const accounts=plan.users.map(u=>({uid:u.uid,email:u.email,password:randomBytes(24).toString('base64url'),disabled:u.disabled}));
 await saveCredentials({target:plan.target,fixtureVersion:plan.version,accounts});
 const created=[];
 try{
  for(const a of accounts){await auth.createUser({...a,disabled:true,emailVerified:false});created.push(a.uid);}
  const batch=db.batch();plan.documents.forEach(d=>batch.create(db.doc(d.path),d.data));await batch.commit();
  for(const a of accounts)if(!a.disabled)await auth.updateUser(a.uid,{disabled:false});
 }catch(e){
  const cleanup=await Promise.allSettled(created.map(uid=>auth.updateUser(uid,{disabled:true})));
  throw Error('Provisioning incomplete. Created test identities were disabled where possible; review the private credentials file and staging fixtures before retrying. Disable failures: '+cleanup.filter(x=>x.status==='rejected').length+'. Cause: '+e.message);
 }
 return {status:'FIXTURES_CREATED',project:db.projectId,accounts:accounts.length,documents:refs.length};
}
async function main(){
 const options=parse(process.argv.slice(2)),plan=fixtures();
 if(!options.apply){console.log(JSON.stringify({mode:'PLAN_ONLY',target:plan.target,projectNumber:plan.projectNumber,accounts:plan.users.map(({uid,email,role,houseId,disabled})=>({uid,email,role,houseId,disabled})),houses:plan.houses,documents:plan.documents.length},null,2));return;}
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','GOOGLE_APPLICATION_CREDENTIALS'])if(process.env[key])throw Error('Use owner Cloud Shell without emulator or key-file credentials');
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT','GOOGLE_CLOUD_QUOTA_PROJECT'])if(process.env[key]&&process.env[key]!==plan.target)throw Error('Conflicting project environment');
 const token=execFileSync('gcloud',['auth','print-access-token','--project=siteplumb-staging'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const response=await fetch('https://cloudresourcemanager.googleapis.com/v1/projects/siteplumb-staging',{headers:{Authorization:'Bearer '+token,'x-goog-user-project':'siteplumb-staging'}});
 if(!response.ok)throw Error('Staging identity check failed: HTTP '+response.status);
 const identity=await response.json();if(identity.projectId!==plan.target||String(identity.projectNumber)!==plan.projectNumber||identity.lifecycleState!=='ACTIVE')throw Error('Staging project identity mismatch');
 const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth');
 const app=initializeApp({projectId:plan.target,credential:{getAccessToken:async()=>({access_token:token,expires_in:300})}},'fixture-provisioner'),db=getFirestore(app);
 try{const result=await provision(db,getAuth(app),data=>{const fd=fs.openSync(options.out,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data,null,2));}finally{fs.closeSync(fd);}});console.log(JSON.stringify(result));}
 finally{await db.terminate();await deleteApp(app);}
}
module.exports={parse,provision};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
