/* QA-only event fixtures. No Firebase client, network, or production import. */
(function(){
  'use strict';
  function fixture(){
    const now=Date.now();
    return {site:'42 Sample Lane',tradeLabel:'Plumbing',sub:'QA Plumbing',builder:'QA Builder',
      start:now+3*864e5,end:now+4*864e5,expires:now+30*864e5,t:now,
      note:'Fake crew-link fixture — browser UI checks only.',
      release:{approved:true,label:'Instructions approved'},
      specs:[{item:'QA shower valve',cat:'Plumbing Fixtures',room:'Primary Bath',rows:[{k:'Finish',v:'Polished Black'}]}],
      docs:[],q:[],ctx:{},resp:null};
  }
  window.qaCrewChecks=function(adapter){
    const prior=document.getElementById('qaCrewControls');if(prior)prior.remove();
    const box=document.createElement('aside');box.id='qaCrewControls';
    box.setAttribute('aria-label','Crew-link QA controls');
    box.style.cssText='position:fixed;z-index:99999;bottom:12px;left:12px;width:280px;max-width:calc(100vw - 24px);padding:16px;background:#FBF9F4;color:#1B1916;border:1px solid #B0895A;border-radius:12px;box-shadow:0 4px 20px #0002;font:14px/1.4 sans-serif';
    const heading=document.createElement('strong');heading.textContent=adapter.surface+' crew-link checks';box.append(heading);
    const scope=document.createElement('p');scope.textContent='Simulated server events. No backend connection.';scope.style.margin='8px 0';box.append(scope);
    const state=document.createElement('p');state.setAttribute('role','status');state.style.margin='8px 0';box.append(state);
    let old;
    const button=(label,act)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='display:block;width:100%;min-height:40px;margin-top:6px;border:1px solid #E4DDD0;background:white;border-radius:8px;color:#1B1916;font:inherit;cursor:pointer';b.onclick=act;box.append(b);};
    function reset(){old=fixture();adapter.reset(old);state.textContent='Event: valid sample packet loaded';}
    button('Reset crew-link fixture',reset);
    button('Simulate packet removed',()=>{adapter.receive({exists:false,metadata:{fromCache:false}},false);state.textContent='Event: server-confirmed missing packet';});
    button('Simulate access denied',()=>{adapter.deny({code:'permission-denied'});state.textContent='Event: permission-denied';});
    button('Replay stale cached packet',()=>{adapter.receive({exists:true,metadata:{fromCache:true},data:()=>old},false);state.textContent='Event: stale cached packet replayed';});
    if(adapter.close)button('Back to sample',()=>{box.remove();adapter.close();});
    else {const a=document.createElement('a');a.href='./?demo=1';a.textContent='Back to sample';a.style.cssText='display:block;margin-top:10px;color:inherit';box.append(a);}
    if(adapter.surface==='In-app'){const a=document.createElement('a');a.href='p.html';a.textContent='Open standalone crew-link checks';a.style.cssText='display:block;margin-top:10px;color:inherit';box.append(a);}
    document.body.append(box);reset();
  };
  window.qaOpenCrewChecks=function(){
    closeInfo();
    qaCrewChecks({surface:'In-app',reset:g=>{_gpPendingRemote=null;openGuestPreview(g);_gpToken='qa-crew-fixture';_gpCacheWrite(_gpToken,g);},
      receive:_gpReceive,deny:_gpReadError,close:()=>{_gpToken='preview';closeGuestPreview();}});
  };
})();
