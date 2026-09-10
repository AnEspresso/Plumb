/* Sample-only harness. Included by build-qa-preview.mjs, never by the live app. */
(function(){
  'use strict';
  window._tourQuiet=true;
  const original=sampleState;
  sampleState=function(){
    const s=original(),p=s.projects.find(x=>x.id==='p2')||s.projects[0];
    p.id='qa-shower';p.name='QA · Cedar House';p.street='42 Sample Lane';p.city='Example Town';p.buyers=['QA Homeowner'];
    p.subs=[{id:9902,name:'QA Plumbing',specialty:'plumb',cleared:Date.now(),phone:'',email:'',specsDue:Date.now()+864e5}];
    p.invites=[];p.packetSignoff={};p.packetApprovalHistory=[];p.docs=[];p.payments=[];p.invoices=[];
    p.selNotes='Sample project. All dimensions and products are for software testing only.';
    const sel={id:9901,cat:'Plumbing Fixtures',room:'Primary Bath',item:'QA shower valve',price:650,status:'selected',approved:false,spec:{}};
    specFields(sel).forEach(f=>{if(f.who==='builder')sel.spec[f.key]='QA field detail';});
    sel.spec.height='48 in above finished floor — QA sample';
    sel.spec.roughin='3.0 in — QA sample';
    sel.spec.loc='Shower wall A — QA sample';
    p.selections=[sel];
    p.bookings=[{id:'qa-plumbing',trade:'plumb',subName:'QA Plumbing',start:dayStart(Date.now())+3*864e5,end:dayStart(Date.now())+4*864e5,note:'QA shower valve install — sample only',status:'confirmed'}];
    s.projects=[p];s.activeId=p.id;s.session={role:'builder',name:'QA Builder'};return s;
  };
  window.qaGuide=function(){showInfo('Try the shower decision',
    '<p>1. Choose <b>Homeowner</b> → Selections. Enter <b>Matte Black</b> for Finish and submit. Open the Plumbing packet: <b>Approve instructions</b> should stay at the bottom while you scroll. Approve, then Close. The approval request should disappear immediately.</p>'+
    '<p>2. Choose <b>Builder</b>. Needs you should say <b>Approval needed</b>. Open the Plumbing packet and approve. The selection should now say <b>Approved</b>. In <b>Crew</b>, check that the instructions are approved.</p>'+
    '<p>3. As <b>Builder</b>, open the shower spec and change Finish to <b>Polished Black</b>. Save. The packet should show <b>Matte Black → Polished Black</b> and require both approvals again.</p>'+
    '<p>4. Approve the changes as <b>Homeowner</b>. The packet should say <b>Builder approval pending</b>, including in Crew. Approve as Builder, then check Crew sees the new finish and approved instructions.</p>'+
    '<p>5. Homeowner and Crew should each show just one SitePlumb header, with Test steps accessible above it. The sample balance is <b>$650</b> everywhere. Optional: reopen your signed packet and <b>Withdraw my approval</b>; the review request should return.</p>'+
    '<p class="c-ink-3">Sample data only. Changes last for this visit. Start over or reload to reset. This preview does not send messages or connect accounts.</p>'+
    '<button class="btn btn-primary btn-block" onclick="closeInfo();openPacketFor(P().id,\'plumb\')">Open Plumbing packet</button>'+
    '<button class="btn btn-secondary btn-block" onclick="qaOpenCrewChecks()">Crew-link checks</button>');};
  // Keep preview navigation inside the sample experience, including share buttons.
  exitDemoToApp=function(){toast('This preview uses sample data. Choose a role above.');};
  pkDoShare=function(){toast('Test preview — no message was sent.');};
  pkOfferTellThem=function(){toast('Test preview — no message was sent.');};
  _smsOrCopy=function(){toast('Test preview — no message was sent.');};
  _sharePacketLink=function(snap){openGuestPreview(snap);toast('Sample packet — no message was sent.');};
  document.querySelector('#excBanner .exc-k').textContent='QA preview';
  const exit=document.querySelector('#excBanner .exc-exit');exit.textContent='Test steps';exit.onclick=qaGuide;
  enterDemo({skipTour:true});
})();
