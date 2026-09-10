'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {FieldValue}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {PROJECT,DEMO}=require('./config.cjs');
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const hash=x=>createHash('sha256').update(stable(x)).digest('hex');
function fail(code,message){throw new HttpsError(code,message);}
function identifier(x){if(typeof x!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(x))fail('invalid-argument','Invalid identifier');return x;}
function exact(x,fields,required=fields){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!fields.includes(k))||required.some(k=>!Object.hasOwn(x,k)))fail('invalid-argument','Unexpected or missing request field');}
function request(data){
 const fields={list:['op'],get:['op','houseId','packetId','requestedRevision'],approve:['op','houseId','packetId','expectedRevision','requestId'],spec:['op','houseId','packetId','expectedRevision','requestId','selectionId','spec']};
 const keys=fields[data?.op];if(!keys)fail('invalid-argument','Unsupported command');
 exact(data,keys,keys.filter(x=>x!=='requestedRevision'));
 if(Buffer.byteLength(JSON.stringify(data))>32768)fail('invalid-argument','Request too large');
 for(const key of ['houseId','packetId','expectedRevision','requestId','requestedRevision'])if(data[key]!==undefined)identifier(data[key]);
 return data;
}
function service(db,project){
 if(![PROJECT,DEMO].includes(project)||db.projectId!==project)throw Error('Staging database required');
 async function authorize(tx,uid,houseId,packetId){
  const houseRef=db.doc('houses/'+identifier(houseId)),packetRef=houseRef.collection('packets').doc(identifier(packetId));
  const [hs,ms,ps]=await tx.getAll(houseRef,houseRef.collection('members').doc(identifier(uid)),packetRef);
  if(!hs.exists||!ms.exists||!ps.exists)fail('permission-denied','Packet access unavailable');
  const house=hs.data(),member=ms.data(),packet=ps.data();
  if(member.active!==true||member.companyId!==house.companyId||!['owner','gc','pm','employee','homeowner','crew'].includes(member.role))fail('permission-denied','Packet access unavailable');
  if(!['homeowner','crew'].includes(member.role)){
   const cm=await tx.get(db.doc('companies/'+identifier(house.companyId)+'/members/'+uid));
   if(!cm.exists||cm.data().active!==true)fail('permission-denied','Company access unavailable');
  }
  if(member.role==='crew'&&(!Array.isArray(member.trades)||!member.trades.includes(packet.trade)))fail('permission-denied','Trade access unavailable');
  return {houseRef,packetRef,house,member,packet};
 }
 const can=(m,cap)=>['owner','gc'].includes(m.role)||(['pm','employee'].includes(m.role)&&Array.isArray(m.capabilities)&&m.capabilities.includes(cap));
 async function readRevision(tx,ctx){
  const snap=await tx.get(ctx.packetRef.collection('revisions').doc(identifier(ctx.packet.currentRevision)));
  if(!snap.exists)fail('failed-precondition','Instructions unavailable');const rev=snap.data();
  if(rev.id!==ctx.packet.currentRevision||hash(rev.content)!==rev.hash)fail('failed-precondition','Instruction integrity check failed');
  return rev;
 }
 function view(ctx,rev,requested){
  const {house,member,packet}=ctx,content=JSON.parse(JSON.stringify(rev.content));
  const approvals={};for(const role of ['homeowner','builder']){const a=packet.approvals?.[role];approvals[role]=a?.revision===rev.id&&a.hash===rev.hash?{status:'Signed',uid:a.uid,at:a.at?.toMillis?.()??a.at??null,revision:rev.id}: {status:'Pending',revision:rev.id};}
  const missing=content.selections.flatMap(s=>(packet.policy?.[s.id]||[]).filter(f=>f.required&&!String(s.spec?.[f.key]??'').trim()).map(f=>f.label));
  const approved=!missing.length&&Object.values(approvals).every(a=>a.status==='Signed');
  const crew=member.role==='crew';
  if(crew)content.selections.forEach(s=>{delete s.price;});
  const changes=(rev.changes||[]).filter(c=>!crew||c.field!=='Price');
  return {houseId:ctx.houseRef.id,packetId:ctx.packetRef.id,address:house.address,trade:packet.trade,role:member.role,
   capabilities:{specify:can(member,'specify'),approve:can(member,'approve')||member.role==='homeowner',answer:member.role==='homeowner'},
   revision:rev.id,hash:rev.hash,content,policy:packet.policy,changes,approvals,missing,approved,
   status:approved?'Instructions approved':'Do not install — current homeowner and builder approvals are required.',
   superseded:!!requested&&requested!==rev.id};
 }
 async function get(uid,data){return db.runTransaction(async tx=>{const ctx=await authorize(tx,uid,data.houseId,data.packetId);return view(ctx,await readRevision(tx,ctx),data.requestedRevision);});}
 async function list(uid){
  const index=await db.collection('users').doc(identifier(uid)).collection('packetAssignments').limit(101).get();
  if(index.size>100)fail('resource-exhausted','Too many assignments');
  const out=[];for(const row of index.docs){const d=row.data();try{const p=await get(uid,{houseId:d.houseId,packetId:d.packetId});out.push({houseId:p.houseId,packetId:p.packetId,address:p.address,trade:p.trade,role:p.role});}catch(e){if(e.code!=='permission-denied')throw e;}}
  return out;
 }
 async function mutate(uid,data){
  const newId='rev_'+randomUUID().replaceAll('-',''),fingerprint=hash({uid,...data});
  await db.runTransaction(async tx=>{
   const ctx=await authorize(tx,uid,data.houseId,data.packetId),{packetRef,packet,member}=ctx;
   const isHome=member.role==='homeowner';
   if(data.op==='approve'&&!isHome&&!can(member,'approve'))fail('permission-denied','Approval not permitted');
   if(data.op==='spec'&&!isHome&&!can(member,'specify'))fail('permission-denied','Specification changes not permitted');
   const commandRef=packetRef.collection('commands').doc(data.requestId),previous=await tx.get(commandRef);
   if(previous.exists){if(previous.data().fingerprint!==fingerprint)fail('already-exists','Request ID already used');return;}
   if(data.expectedRevision!==packet.currentRevision)fail('failed-precondition','Instructions changed. Refresh and review the current revision.');
   const rev=await readRevision(tx,ctx);
   if(data.op==='approve'){
    if(view(ctx,rev).missing.length)fail('failed-precondition','Complete required details before approval');
    const role=isHome?'homeowner':'builder',existing=packet.approvals?.[role];
    if(!existing){
     const approval={uid,role,revision:rev.id,hash:rev.hash,at:FieldValue.serverTimestamp()};
     tx.create(packetRef.collection('revisions').doc(rev.id).collection('approvals').doc(role),approval);
     tx.update(packetRef,{['approvals.'+role]:approval});
    }
   }else{
    if(!Number.isSafeInteger(data.selectionId))fail('invalid-argument','Invalid selection');
    const content=JSON.parse(JSON.stringify(rev.content)),selection=content.selections.find(s=>s.id===data.selectionId);
    if(!selection)fail('invalid-argument','Unknown selection');
    const policy=packet.policy?.[data.selectionId];if(!Array.isArray(policy))fail('failed-precondition','Field policy unavailable');
    exact(data.spec,policy.map(f=>f.key),[]);
    const changes=[];
    for(const [key,value] of Object.entries(data.spec)){
     if(typeof value!=='string'||value.length>2000)fail('invalid-argument','Invalid specification value');
     const next=value.trim(),before=selection.spec[key]??'',field=policy.find(f=>f.key===key);
     if(next===before)continue;
     if(isHome&&field.who!=='homeowner')fail('permission-denied','Technical changes require a proposal');
     changes.push({selectionId:selection.id,field:field.label,before,after:next,text:`${field.label}: ${before||'Not set'} → ${next||'Not set'}`});selection.spec[key]=next;
    }
    if(changes.length){
     const next={id:newId,hash:hash(content),content,previous:rev.id,changes,createdBy:uid,createdAt:FieldValue.serverTimestamp()};
     tx.create(packetRef.collection('revisions').doc(newId),next);
     tx.update(packetRef,{currentRevision:newId,approvals:{}});
    }
   }
   tx.create(commandRef,{fingerprint,uid,op:data.op,createdAt:FieldValue.serverTimestamp()});
  });
  return get(uid,data);
 }
 return {async run(uid,data){identifier(uid);request(data);return data.op==='list'?list(uid):data.op==='get'?get(uid,data):mutate(uid,data);}};
}
module.exports={service,hash,stable,request};
