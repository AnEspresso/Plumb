#!/usr/bin/env node
// Build an allowlisted, cloud-disabled preview. Never copy repository docs or QA credentials.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,process.argv[2]||'dist-qa');
if(out===root||out===path.join(root,'app'))throw Error('Choose a separate preview output directory');
fs.mkdirSync(path.join(out,'app'),{recursive:true});
const csp="default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
function isolate(html){
 return html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="'+csp+'">')
 .replace(/<script\s+src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"\n]+"><\/script>/g,'')
 .replace(/<link[^>]+href="https:\/\/fonts\.(googleapis|gstatic)\.com[^>]*>/g,'')
 .replace('</head>','<link rel="stylesheet" href="fonts.css"></head>');
}
let html=isolate(fs.readFileSync(path.join(root,'app/index.html'),'utf8'));
html=html.replace('</body>','<script src="qa-crew-checks.js"></script><script src="qa-preview.js"></script></body>');
fs.writeFileSync(path.join(out,'app/index.html'),html);
fs.writeFileSync(path.join(out,'app/plumb.html'),html);
let guest=isolate(fs.readFileSync(path.join(root,'app/p.html'),'utf8'));
const guestBoot='boot();\n})();';
if(guest.split(guestBoot).length!==2)throw Error('Standalone guest QA hook must match exactly once');
guest=guest.replace('<script src="runtime.js"></script>','<script src="runtime.js"></script><script src="qa-crew-checks.js"></script>')
 .replace(guestBoot,"window.qaCrewChecks({surface:'Standalone',reset:function(g){_pending=null;_snap=null;apply(g);},receive:receive,deny:readError});\n})();");
fs.writeFileSync(path.join(out,'app/p.html'),guest);
fs.copyFileSync(path.join(root,'qa/preview.js'),path.join(out,'app/qa-preview.js'));
fs.copyFileSync(path.join(root,'qa/crew-link-checks.js'),path.join(out,'app/qa-crew-checks.js'));
for(const name of ['workspace.js','workspace.css'])fs.copyFileSync(path.join(root,'app',name),path.join(out,'app',name));
// Forced local, even if someone accidentally serves this bundle on a live host.
fs.writeFileSync(path.join(out,'app/runtime.js'),"window.PlumbRuntime=Object.freeze({kind:'local',config:function(){return null;},functionsBase:null});\n");
// Retain the existing shell's registration contract without caching an old preview.
fs.writeFileSync(path.join(out,'app/sw.js'),"self.addEventListener('install',function(){self.skipWaiting();});\nself.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());});\n");
for(const name of ['terms.html','privacy.html'])fs.copyFileSync(path.join(root,'app',name),path.join(out,'app',name));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'app/manifest.json'),'utf8'));
manifest.name='SitePlumb · QA preview';manifest.short_name='Plumb QA';manifest.start_url='./?demo=1';
fs.writeFileSync(path.join(out,'app/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
for(const name of ['apple-touch-icon.png','icon-192.png','icon-512.png','icon-maskable-512.png'])fs.copyFileSync(path.join(root,name),path.join(out,name));
// The legal pages reference their favicon beside the page.
fs.copyFileSync(path.join(root,'icon-192.png'),path.join(out,'app/icon-192.png'));
fs.cpSync(path.join(root,'app/tour-audio'),path.join(out,'app/tour-audio'),{recursive:true});
const fonts=[['fraunces','Fraunces',[500]],['source-serif-4','Source Serif 4',[400,500,600,700]],['hanken-grotesk','Hanken Grotesk',[400,500,600,700]]];
let css='';fs.mkdirSync(path.join(out,'app/fonts'),{recursive:true});
for(const [pkg] of fonts)fs.copyFileSync(path.join(root,'node_modules/@fontsource',pkg,'LICENSE'),path.join(out,'app/fonts',pkg+'-LICENSE.txt'));
for(const [pkg,family,weights] of fonts)for(const weight of weights)for(const style of (pkg==='source-serif-4'?['normal','italic']:['normal'])){
 const file=`${pkg}-latin-${weight}-${style}.woff2`;
 fs.copyFileSync(path.join(root,'node_modules/@fontsource',pkg,'files',file),path.join(out,'app/fonts',file));
 css+=`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url('fonts/${file}') format('woff2')}\n`;
}
fs.writeFileSync(path.join(out,'app/fonts.css'),css);
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta http-equiv="refresh" content="0;url=app/?demo=1"><title>SitePlumb · Sample workspace</title></head><body><a href="app/?demo=1">Open the SitePlumb sample workspace</a></body></html>`);
console.log('QA preview built: '+out);
