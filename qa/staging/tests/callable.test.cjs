const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {getApp,deleteApp}=require('firebase-admin/app');
let server,url,token;
before(async()=>{
 process.env.GCLOUD_PROJECT='demo-siteplumb-qa';
 const {packetCommand}=require('../functions/index.cjs');
 const express=require('express'),handler=express();handler.use(express.json());handler.use(packetCommand);server=http.createServer(handler);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;
 const auth=getAuth();await auth.createUser({uid:'transport',email:'transport@example.test',password:'FakeSampleOnly123!'});
 const response=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'transport@example.test',password:'FakeSampleOnly123!',returnSecureToken:true})});
 token=(await response.json()).idToken;assert.ok(token);
});
after(async()=>{await new Promise(r=>server?.close(r));await getFirestore().terminate();await deleteApp(getApp());});
async function send(origin,authToken){const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(authToken?{Authorization:'Bearer '+authToken}:{})},body:JSON.stringify({data:{op:'list'}})});return {status:res.status,body:await res.json()};}
test('actual callable middleware accepts emulator identity, rejects missing auth and wrong origin',async()=>{
 assert.equal((await send('http://127.0.0.1:5002')).status,401);
 assert.equal((await send('https://siteplumb-qa.pmgottschalk.chatgpt.site',token)).status,403);
 const good=await send('http://127.0.0.1:5002',token);assert.equal(good.status,200);assert.deepEqual(good.body.result,[]);
});
test('disabled identity loses callable access',async()=>{
 await getAuth().updateUser('transport',{disabled:true});assert.equal((await send('http://127.0.0.1:5002',token)).status,401);
});
