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
html=html.replace('</body>','<script src="qa-preview.js"></script></body>');
fs.writeFileSync(path.join(out,'app/index.html'),html);
fs.writeFileSync(path.join(out,'app/plumb.html'),html);
fs.writeFileSync(path.join(out,'app/p.html'),isolate(fs.readFileSync(path.join(root,'app/p.html'),'utf8')));
fs.copyFileSync(path.join(root,'qa/preview.js'),path.join(out,'app/qa-preview.js'));
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
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>SitePlumb · QA preview</title><link rel="stylesheet" href="app/fonts.css"><style>*{box-sizing:border-box}body{margin:0;background:#f2eee6;color:#29251f;font:18px/1.6 'Hanken Grotesk',sans-serif}main{max-width:600px;padding:64px 24px;margin:auto}.brand{font:500 28px 'Fraunces',serif}.brand::before{content:'●';font-size:14px;color:#ad8056;margin-right:10px}small{color:#746b5f}h1{font:500 38px/1.2 'Fraunces',serif;margin:38px 0 16px}p{margin:16px 0}a{display:inline-block;border-radius:10px;background:#29251f;color:#fff;text-decoration:none;padding:14px 24px;margin:16px 0}ol{padding-left:24px}li{margin:12px 0}footer{border-top:1px solid #d6cdbc;margin-top:32px;padding-top:24px;font-size:15px;color:#746b5f}</style></head><body><main><div class="brand">SitePlumb</div><small>PRIVATE QA PREVIEW</small><h1>Keep the homeowner’s choices clear, all the way to the field.</h1><p>Try a shower decision in a sample house. Switch between Builder, Homeowner and Crew at the top of the app.</p><a href="app/?demo=1">Open the sample house</a><ol><li>Answer the homeowner’s questions.</li><li>Review and sign the Plumbing packet as homeowner and builder.</li><li>Change a field detail. Check that the previous approvals no longer apply.</li></ol><footer>This is the first reliability update. It keeps SitePlumb’s current design. Sample changes last for this visit; reload or Start over to reset. No live records, account connections or messages are involved. Crew acknowledgements, installation evidence, independent verification and live notification delivery remain to be implemented and tested.</footer></main></body></html>`);
console.log('QA preview built: '+out);
