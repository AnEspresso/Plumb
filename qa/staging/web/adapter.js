/* Staging-only bridge. The builder/spec/review shell remains the existing app.
   Server responses are the sole source of displayed approval authority. */
(function(){
 'use strict';
 let connection=null,epoch=0,current=null,assignments=[],busy=false,reviewRevision=null;
 const root=document.getElementById('stagingRoot'),message=document.getElementById('stagingMessage');
 const status=t=>{message.textContent=t;};
 for(const id of ['infoScrim','specScrim','toast']){const el=document.getElementById(id);if(el)document.body.append(el);}
 state.projects=[];state.session=null;state.activeId=null;
 persist=()=>{};logEvent=()=>{};Sync.init=async()=>false;Sync.pushAll=()=>{};queueSync=()=>{};
 for(const k of Object.keys(Data))if(typeof Data[k]==='function')Data[k]=()=>{throw Error('This action is unavailable in staging');};
 Data.setActive=id=>{if(current&&id===current.houseId)state.activeId=id;};
 Data.updateSelection=()=>{throw Error('Use the reviewed server specification command');};
 function clear(keepForm=false){
  current=null;reviewRevision=null;state.projects=[];state.activeId=null;_pktCtx=null;
  document.getElementById('infoBody').replaceChildren();document.getElementById('infoFoot').replaceChildren();
  document.getElementById('infoScrim').classList.remove('show');
  if(!keepForm){document.getElementById('specScrim').classList.remove('show');document.getElementById('specBody').replaceChildren();_specId=null;_specCustomDraft=[];}
  document.getElementById('packetActions').replaceChildren();
 }
 function renderAssignments(){
  const box=document.getElementById('assignments');box.replaceChildren();
  assignments.forEach(a=>{const b=document.createElement('button');b.className='btn btn-secondary';b.textContent=a.address+' · '+specLabel(a.trade);b.onclick=()=>load(a);box.append(b);});
 }
 function apply(packet){
  current=packet;const c=packet.content;
  state.session={role:packet.role==='homeowner'?'client':packet.role==='crew'?'subs':'builder',name:packet.role==='crew'?'Assigned crew':packet.role,site:packet.houseId};
  state.activeId=packet.houseId;
  state.projects=[{id:packet.houseId,street:packet.address,name:packet.address,selections:c.selections.map(s=>({...s,status:'selected'})),selNotes:c.notes||'',docs:c.docs.map(d=>({n:d.name,fileId:d.id,fileUrl:d.url,revision:d.revision,trade:packet.trade,aud:'all'})),
   bookings:c.bookings.map(b=>({...b,subName:b.crew,trade:packet.trade})),subs:[{id:'assigned',name:'Assigned crew',specialty:packet.trade}],items:[],logs:[],permits:[],inspections:{},packetSignoff:{}}];
  const actions=document.getElementById('packetActions');actions.replaceChildren();
  const label=document.createElement('p');label.textContent=packet.address+' · '+packet.role;actions.append(label);
  const review=document.createElement('button');review.className='btn btn-primary';review.textContent='Review packet';review.onclick=()=>load({houseId:packet.houseId,packetId:packet.packetId},true);actions.append(review);
  if(packet.capabilities.specify||packet.capabilities.answer){for(const s of c.selections){const b=document.createElement('button');b.className='btn btn-secondary';b.textContent=packet.capabilities.answer?'Answer selections':'Install spec sheet — '+s.item;b.onclick=()=>{if(current)openSpec(s.id);};actions.append(b);}}
 }
 async function call(data,{keepForm=false}={}){
  if(!connection?.auth.currentUser||navigator.onLine===false)throw Error('Sign in and connect before continuing');
  const token=epoch,result=await connection.command(data);
  if(epoch!==token)throw Error('Account changed; response discarded');
  return result;
 }
 async function load(a,review=false){
  const token=epoch;clear();status('Loading current instructions…');
  try{const p=await call({op:'get',houseId:a.houseId,packetId:a.packetId});if(token!==epoch)return;apply(p);status('Current instructions loaded');if(review)openReview();}
  catch(e){if(token===epoch){clear();status(e.message||'Access unavailable');}}
 }
 async function discover(){
  const token=epoch;assignments=[];renderAssignments();clear();
  try{const list=await call({op:'list'});if(token!==epoch)return;assignments=list;renderAssignments();status(list.length?'Choose your assigned packet.':'No assigned packets.');}
  catch(e){if(token===epoch)status(e.message||'Assignments unavailable');}
 }
 function openReview(){if(!current)return;reviewRevision=current.revision;showInfo('Plumbing install packet',packetHTML(P(),current.trade));}
 const originalPacket=packetHTML;
 packetSignoff=()=>{const out={};if(current)for(const role of ['homeowner','builder']){const a=current.approvals[role];if(a.status==='Signed')out[role]={by:role,at:a.at||1,key:current.hash,revision:current.revision};}return out;};
 packetSignedBoth=()=>!!current?.approved;packetReady=()=>!!current?.approved;
 packetReviewLabel=()=>current?.approved?'Instructions approved':'Homeowner and builder approval pending';
 packetChanges=()=>current?.changes||[];
 packetChangesHTML=()=>current?.changes?.length?'<div class="pkt-changes"><b>Instructions changed</b>'+current.changes.map(c=>'<p>'+esc(c.text)+'</p>').join('')+'</div>':'';
 pktAsk=()=>[];
 specFields=s=>(current?.policy?.[s.id]||[]).map(f=>({...f,value:s.spec?.[f.key]||'',custom:false})).concat((s.specCustom||[]).map((f,i)=>({...f,key:'c'+i,custom:true})));
 packetHTML=function(p,trade){
  if(!current)return '<p>Refresh before reviewing instructions.</p>';
  const t=document.createElement('template');t.innerHTML=originalPacket(p,trade);
  // No notification, scheduling, withdrawal or legacy mutation controls are
  // offered by this bounded staging slice. Authorization remains server-side.
  t.content.querySelectorAll('button,[onclick]').forEach(el=>{const action=el.getAttribute('onclick')||'';
   if(/^pktFillSpec\(/.test(action)){if(current.role==='crew')el.removeAttribute('onclick');return;}
   if(/^pktSignBuilder\(/.test(action)){const label=el.querySelector('.row-aside');if(label)label.textContent=current.approvals.builder.status;}
   el.classList.remove('row-tap');el.querySelector('.row-chev')?.remove();
   if(el.tagName==='BUTTON')el.remove();else el.removeAttribute('onclick');
  });
  const notice=document.createElement('p');notice.className='pkt-banner '+(current.approved?'ok':'warn');notice.textContent=current.status;t.content.prepend(notice);
  const revision=document.createElement('p');revision.className='pkt-foot';revision.textContent='Revision '+current.revision;t.content.prepend(revision);
  for(const s of p.selections){const details=document.createElement('section');details.innerHTML='<h3>'+esc(s.item)+'</h3>'+specReadoutHTML(s);t.content.append(details);}
  return t.innerHTML;
 };
 syncInfoFoot=function(){const foot=document.getElementById('infoFoot');foot.replaceChildren();if(!current)return;
  foot.className='sheet-foot action-bar';
  const role=current.role==='homeowner'?'homeowner':'builder';
  if(current.capabilities.approve&&current.approvals[role].status==='Pending'&&!current.missing.length){const b=document.createElement('button');b.className='btn btn-primary';b.textContent=current.changes.length?'Approve changes':'Approve instructions';b.onclick=()=>approve();foot.append(b);}
  const close=document.createElement('button');close.className='btn btn-secondary';close.textContent='Close';close.onclick=closeInfo;foot.append(close);
 };
 async function approve(){
  if(busy||!current||reviewRevision!==current.revision)return;
  const p=current,token=epoch;busy=true;syncInfoFoot();
  try{const result=await call({op:'approve',houseId:p.houseId,packetId:p.packetId,expectedRevision:reviewRevision,requestId:crypto.randomUUID()});if(token!==epoch)return;apply(result);openReview();status('Approval saved for this revision.');}
  catch(e){if(token===epoch){clear();status(e.message||'Approval not saved');}}
  finally{busy=false;}
 }
 // Existing public functions also route here, so a stale inline event cannot
 // invoke local signing or the previous account's authority.
 pktSignBuilder=()=>approve();pktSignHomeowner=()=>approve();setPacketSignoff=()=>{throw Error('Use the reviewed server approval action');};
 const originalOpenSpec=openSpec;
 openSpec=function(id){if(!current||(!current.capabilities.specify&&!current.capabilities.answer))return;reviewRevision=current.revision;originalOpenSpec(id);
  document.querySelectorAll('#specCustomList input,#specCustomList select,#specCustomList button').forEach(el=>el.disabled=true);
  document.querySelectorAll('#specBody .add-sub-btn').forEach(el=>el.hidden=true);
  const save=document.querySelector('#specScrim .sheet-foot .btn-primary')||document.querySelector('#specScrim button[onclick="saveSpec()"]');if(save)save.textContent=current.capabilities.answer?'Submit answers':'Save spec';
 };
 addSpecCustom=()=>{};removeSpecCustom=()=>{};
 saveSpec=async function(){
  if(busy||!current||_specId==null)return;
  const p=current,id=_specId,token=epoch,spec={};
  document.querySelectorAll('#specBody input[data-key]').forEach(el=>{if(!el.readOnly)spec[el.dataset.key]=el.value.trim();});
  busy=true;
  try{const result=await call({op:'spec',houseId:p.houseId,packetId:p.packetId,expectedRevision:reviewRevision,requestId:crypto.randomUUID(),selectionId:id,spec});if(token!==epoch)return;apply(result);closeSpec();openReview();status(p.capabilities.answer?'Answers submitted':'Spec saved');}
  catch(e){if(token===epoch){clear(true);status((e.message||'Save failed')+'. Your unsent answers remain in the form.');}}
  finally{busy=false;}
 };
 clientSaveSpec=()=>saveSpec();renderClient=()=>{};renderSelections=()=>{};
 window.addEventListener('offline',()=>{epoch++;clear();assignments=[];renderAssignments();status('Offline — instructions unavailable. Reconnect and refresh before installation.');});
 document.getElementById('stagingRefresh').onclick=()=>discover();
 document.getElementById('stagingLogout').onclick=async()=>{epoch++;clear();assignments=[];renderAssignments();document.getElementById('stagingPassword').value='';await connection?.logout();};
 document.getElementById('stagingLogin').onsubmit=async e=>{e.preventDefault();if(!connection)return;
  const password=document.getElementById('stagingPassword'),value=password.value;password.value='';
  try{await connection.login(document.getElementById('stagingEmail').value.trim(),value);}catch{status('Sign-in failed. Check your email and password.');}
 };
 window.StagingReview={start:async config=>{
  try{connection=await window.SitePlumbSDK.start(config);connection.watch(user=>{epoch++;clear();assignments=[];renderAssignments();state.session=null;
   document.getElementById('stagingLogin').hidden=!!user;document.getElementById('stagingAccount').hidden=!user;
   document.getElementById('stagingPassword').value='';if(user)discover();else status('Sign in to your assigned work.');});
  }catch(e){status(e.message||'Staging unavailable');document.getElementById('stagingSubmit').disabled=true;}
 },load,discover,clear,get current(){return current;}};
 window.StagingReview.start(window.PlumbStagingConfig);
})();
