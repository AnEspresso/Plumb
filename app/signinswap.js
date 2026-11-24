/* #129 banner repro: Sync is live bound to the last account (bX) with no session, then the sign-in form signs in +sub (U).
   The fake Firestore does what the SDK does on a credential change: every open sites listener is re-run under the new
   token, and the rules refuse any whose array-contains uid is not the token's uid (sites list: uid() in memberUids). */
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');
const APP=process.env.APP||__dirname;
const SRC=fs.readFileSync(path.join(APP,'index.html'),'utf8').replace('</body>','<script>window.$eval=c=>eval(c);</script></body>');
const U='uAXTG',B='bXbuild';
const dom=new JSDOM(SRC,{runScripts:'dangerously',url:'https://siteplumb.com/app/',pretendToBeVisual:true,beforeParse(w){
  const prof={provider:'firebase',uid:B,email:'b@x.co',name:'Builder',rpRole:'owner'};
  const member={role:'sub',siteId:'qamB',name:'Northwind Mechanical'};
  w.localStorage.setItem('plumb.mode','real');w.localStorage.setItem('plumb.cacheUid',B);
  w.localStorage.setItem('plumb.liveAuth',JSON.stringify(prof));
  w.localStorage.setItem('plumb.hats',JSON.stringify({[U]:{member,rpRole:null,name:'Northwind Mechanical',email:'sub@x.co'}}));
  w.localStorage.setItem('plumb.state.real.'+B+'.v1',JSON.stringify({projects:[],showSamples:false,seeded:true,feedback:[],eventLog:[],pkLog:[],session:{role:'builder',name:'Builder',since:1,mode:'real',owner:true,auth:{uid:B,email:'b@x.co',provider:'firebase'},rpRole:'owner'}}));
  w.indexedDB={open:()=>{const r={};setTimeout(()=>{r.error=new Error('no idb');r.onerror&&r.onerror({target:r});},0);return r;}};w.scrollTo=()=>{};
  w.matchMedia=q=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.navigator.serviceWorker={register:()=>Promise.resolve({}),getRegistration:()=>Promise.resolve(null),addEventListener(){}};
  w.fetch=()=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({result:{}}),text:()=>Promise.resolve('')});
  w.location.reload=()=>{};
  const log=[];w.__log=log;const live=[];
  const mk=uid=>({uid,isAnonymous:false,email:uid===U?'sub@x.co':'b@x.co',emailVerified:true,displayName:'',getIdToken:()=>Promise.resolve('t')});
  const snapOf=(docs,fromCache)=>({metadata:{fromCache,hasPendingWrites:false},docs:docs.map(d=>({id:d.id,data:()=>d})),docChanges:()=>docs.map(d=>({type:'added',doc:{id:d.id,data:()=>d}}))});
  const coll=(p,q)=>({doc:id=>docRef(p+'/'+id),where:function(f,op,v){return coll(p,{f,op,v});},
    onSnapshot:function(o,h,e){if(typeof o==='function'){e=h;h=o;}
      if(p==='sites'&&q){const L={q,h,e,alive:true};live.push(L);log.push('listen sites by '+(q.v===U?'U':q.v===B?'B':'?'));
        setTimeout(()=>{if(!L.alive)return;if(q.v!==auth.currentUser.uid){L.alive=false;log.push('DENIED sites by '+(q.v===U?'U':'B'));e&&e({code:'permission-denied'});}else h(snapOf([],false));},20);
        return ()=>{L.alive=false;};}
      setTimeout(()=>h(snapOf([],false)),30);return ()=>{};},get:()=>Promise.resolve({docs:[],empty:true,forEach(){}})});
  const docRef=(p)=>({id:p.split('/').pop(),collection:s=>coll(p+'/'+s),set:()=>Promise.resolve(),update:()=>Promise.resolve(),delete:()=>Promise.resolve(),
    get:()=>new Promise(r=>setTimeout(()=>r({exists:true,id:p.split('/').pop(),data:()=>({}),get:()=>undefined}),+(process.env.GETMS||300))),onSnapshot:(o,h)=>()=>{}});
  const db={clearPersistence:()=>Promise.resolve(),terminate:()=>Promise.resolve(),enablePersistence:()=>Promise.resolve(),collection:p=>coll(p),doc:docRef,batch:()=>({set(){},update(){},delete(){},commit:()=>Promise.resolve()}),runTransaction:f=>f({get:()=>Promise.resolve({exists:false,data:()=>({})}),set(){},update(){}})};
  const fs_=()=>db;fs_.FieldValue={delete:()=>({__del:1}),serverTimestamp:()=>({__ts:1}),arrayUnion:()=>({}),arrayRemove:()=>({})};
  const cbs=[];
  const auth={currentUser:mk(B),onAuthStateChanged:cb=>{cbs.push(cb);setTimeout(()=>cb(auth.currentUser),0);return ()=>{};},onIdTokenChanged:cb=>()=>{},signOut:()=>Promise.resolve(),setPersistence:()=>Promise.resolve(),
    signInWithEmailAndPassword:()=>{if(process.env.FAIL)return Promise.reject({code:'auth/wrong-password'});auth.currentUser=mk(U);log.push('token now U');
      /* the SDK re-sends every open listen under the new token */
      live.filter(L=>L.alive).forEach(L=>setTimeout(()=>{if(!L.alive)return;if(L.q.v!==U){L.alive=false;log.push('DENIED sites by '+(L.q.v===B?'B':'?'));L.e&&L.e({code:'permission-denied'});}},5));
      cbs.forEach(cb=>setTimeout(()=>cb(auth.currentUser),0));
      return new Promise(r=>setTimeout(()=>r({user:auth.currentUser}),2));}};
  const au=()=>auth;au.Auth={Persistence:{LOCAL:'local'}};
  w.firebase={apps:[],initializeApp(){this.apps.push({});},firestore:fs_,auth:au,storage:()=>({ref:()=>({})}),messaging:undefined,appCheck:undefined,functions:undefined};
}});
const w=dom.window;const $=c=>w.$eval(c);
setTimeout(()=>{
  $(`window.__toasts=[];var _t0=toast;toast=function(m){window.__toasts.push(m);return _t0(m);};`);
  /* the observed state at each refusal: Sync on and bound to the other account, no session */
  $(`Data.setSession(null);`);
  const pre=JSON.parse($(`JSON.stringify({on:Sync.on,bound:Sync.uid})`));
  if(process.env.CACHEU)w.localStorage.setItem('plumb.cacheUid',U);
  if(process.env.DIRECT){$(`Sync._signingIn=true;firebase.auth().signInWithEmailAndPassword('sub@x.co','pw');`);}else
  $(`document.getElementById('laEmail').value='sub@x.co';document.getElementById('laPass').value='pw123456';liveAuthSubmit();`);
  setTimeout(()=>{
    const o=JSON.parse($(`JSON.stringify({toasts:__toasts,laErr:(document.getElementById("laErr")||{}).textContent,boundAfter:Sync.uid,on:Sync.on,sess:state.session&&state.session.auth&&state.session.auth.uid,
      events:(state.eventLog||[]).map(function(e){return e.type+(e.detail?':'+String(e.detail).slice(0,70):'');}).filter(function(s){return /clientError|syncRebind|login|staleListen|liveHousesRetry/.test(s);})})`));
    o.events=o.events||[];const banner=o.toasts.some(t=>/blocked by security rules/.test(t));
    console.log(JSON.stringify({pre:{on:pre.on,bound:pre.bound===B?'B':pre.bound},log:w.__log,banner,boundAfter:o.boundAfter===U?'U':o.boundAfter,sessAfter:o.sess===U?'U':o.sess,on:o.on,laErr:o.laErr,events:o.events.map(s=>s.replace(/uAXTG|bXbuild/g,m=>m===U?'U':'B'))},null,1));
    process.exit(0);
  },+(process.env.WAIT||4000));
},+(process.env.BOOT||4000));
