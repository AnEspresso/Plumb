'use strict';
const PROJECT='siteplumb-staging', DEMO='demo-siteplumb-qa';
const ORIGIN='https://siteplumb-staging.web.app';
const SITE_KEY='6LeaC7QtAAAAAHEx1tFlalcQYfBiCcBgSDd7jiCV';
function configuration(env=process.env){
  const project=env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT;
  if(env.GCLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT && env.GCLOUD_PROJECT!==env.GOOGLE_CLOUD_PROJECT)throw Error('Conflicting project identities');
  if(env.FIREBASE_CONFIG){const fc=JSON.parse(env.FIREBASE_CONFIG);if(fc.projectId && fc.projectId!==project)throw Error('Conflicting Firebase project');}
  if(project===DEMO){
    for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^127\.0\.0\.1:\d+$/.test(env[key]||''))throw Error('Loopback emulators required');
    return {project,emulator:true,origin:'http://127.0.0.1:5002'};
  }
  if(project!==PROJECT || env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Staging identity required; mixed targets forbidden');
  return {project,emulator:false,origin:ORIGIN};
}
module.exports={PROJECT,DEMO,ORIGIN,SITE_KEY,configuration};
