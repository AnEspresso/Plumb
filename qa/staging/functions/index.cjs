'use strict';
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {configuration}=require('./config.cjs');
const {service}=require('./service.cjs');
const config=configuration(),app=initializeApp({projectId:config.project});
const packets=service(getFirestore(app),config.project),auth=getAuth(app);
exports.packetCommand=onCall({region:'us-central1',minInstances:0,maxInstances:1,memory:'256MiB',timeoutSeconds:30,
 ...(config.emulator?{}:{serviceAccount:'siteplumb-packets@siteplumb-staging.iam.gserviceaccount.com'}),
 cors:[config.origin],enforceAppCheck:!config.emulator},async req=>{
 if(req.rawRequest.headers.origin!==config.origin)throw new HttpsError('permission-denied','Origin not permitted');
 if(!req.auth?.uid)throw new HttpsError('unauthenticated','Sign in required');
 const token=/^Bearer (\S+)$/.exec(req.rawRequest.headers.authorization||'')?.[1];
 if(!token)throw new HttpsError('unauthenticated','Sign in required');
 try{const verified=await auth.verifyIdToken(token,true);if(verified.uid!==req.auth.uid)throw Error('Identity mismatch');const user=await auth.getUser(verified.uid);if(user.disabled)throw Error('Disabled');}
 catch{throw new HttpsError('unauthenticated','Sign in again');}
 if(!config.emulator&&!req.app)throw new HttpsError('unauthenticated','App verification required');
 return packets.run(req.auth.uid,req.data);
});
