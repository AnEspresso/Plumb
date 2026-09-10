import {initializeApp} from 'firebase/app';
import {getAuth,setPersistence,inMemoryPersistence,signInWithEmailAndPassword,signOut,onAuthStateChanged,connectAuthEmulator} from 'firebase/auth';
import {initializeAppCheck,ReCaptchaEnterpriseProvider} from 'firebase/app-check';
import {getFunctions,httpsCallable,connectFunctionsEmulator} from 'firebase/functions';
window.SitePlumbSDK={async start(config){
 const local=config.mode==='emulator';
 if(local){if(location.origin!=='http://127.0.0.1:5002'||config.firebase.projectId!=='demo-siteplumb-qa')throw Error('Emulator origin required');}
 else if(config.mode!=='staging'||location.origin!=='https://siteplumb-staging.web.app'||config.firebase.projectId!=='siteplumb-staging'||config.firebase.appId!=='1:625071693246:web:3c749d78ca9b83be146def'||!config.siteKey)throw Error('Staging configuration incomplete');
 const app=initializeApp(config.firebase,'staging-review'),auth=getAuth(app);
 if(local)connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
 else initializeAppCheck(app,{provider:new ReCaptchaEnterpriseProvider(config.siteKey),isTokenAutoRefreshEnabled:true});
 await setPersistence(auth,inMemoryPersistence);
 const functions=getFunctions(app,'us-central1');if(local)connectFunctionsEmulator(functions,'127.0.0.1',5001);
 const invoke=httpsCallable(functions,'packetCommand',{timeout:15000});
 return {auth,login:(email,password)=>signInWithEmailAndPassword(auth,email,password),logout:()=>signOut(auth),watch:fn=>onAuthStateChanged(auth,fn),command:async data=>(await invoke(data)).data};
}};
