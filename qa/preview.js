/* Sample-only harness. Included by build-qa-preview.mjs, never by the live app. */
(function(){
  'use strict';
  window._tourQuiet=true;
  const original=sampleState;
  sampleState=function(){
    const s=original(),p=s.projects.find(x=>x.id==='p2')||s.projects[0];
    p.id='qa-shower';p.name='QA · Cedar House';p.street='42 Sample Lane';p.city='Example Town';p.buyers=['QA Homeowner'];
    p.subs=[{id:9902,name:'QA Plumbing',specialty:'plumb',cleared:true,phone:'',email:'',specsDue:Date.now()+864e5}];
    p.invites=[];p.packetSignoff={};p.docs=[];p.selNotes='Sample project. All dimensions and products are for software testing only.';
    const sel={id:9901,cat:'Plumbing Fixtures',room:'Primary Bath',item:'QA shower valve',price:650,status:'selected',approved:false,spec:{}};
    specFields(sel).forEach(f=>{if(f.who==='builder')sel.spec[f.key]='QA field detail';});
    sel.spec.rough='3.0 in — QA sample';
    p.selections=[sel];
    p.bookings=[{id:'qa-plumbing',trade:'plumb',subName:'QA Plumbing',start:dayStart(Date.now())+3*864e5,end:dayStart(Date.now())+4*864e5,note:'QA shower valve install — sample only',status:'confirmed'}];
    s.projects=[p];s.activeId=p.id;s.session={role:'builder',name:'QA Builder'};return s;
  };
  window.qaGuide=function(){showInfo('Try the shower decision',
    '<p>1. Choose <b>Homeowner</b> and answer the shower questions in Selections.</p>'+
    '<p>2. Open the Plumbing packet and sign off. Choose <b>Builder</b>, open the same packet, review and sign.</p>'+
    '<p>3. As Builder, change the rough-in detail. Open the packet again: both approvals now need review.</p>'+
    '<p>4. Choose <b>Homeowner</b> and open the shower details. Field-owned answers are read-only.</p>'+
    '<p class="c-ink-3">Sample data only. Changes last for this visit. Start over or reload to reset. This preview does not send messages or connect accounts.</p>'+
    '<button class="btn btn-primary btn-block" onclick="closeInfo();openPacketFor(P().id,\'plumb\')">Open Plumbing packet</button>');};
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
