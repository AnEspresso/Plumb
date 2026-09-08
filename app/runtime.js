/* Explicit environment boundary. Unknown origins never inherit production. */
(function(root){
  'use strict';
  var production=['https://siteplumb.com','https://www.siteplumb.com'];
  var origin=root.location&&root.location.origin||'';
  var github=origin==='https://anespresso.github.io'&&/^\/Plumb(?:\/|$)/.test(root.location.pathname);
  var kind=production.indexOf(origin)>=0||github?'production':'local';
  root.PlumbRuntime=Object.freeze({
    kind:kind,
    config:function(productionConfig){return kind==='production'?productionConfig:null;},
    functionsBase:kind==='production'?'https://us-central1-plumb-467a0.cloudfunctions.net/':null,
    packetUrl:function(token){return new URL('p.html?packet='+encodeURIComponent(token),root.location.href).href;}
  });
})(window);
