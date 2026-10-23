#!/usr/bin/env node
/* Read-only Firestore data read for the "Firestore read (read only)" workflow.
   Uses the Firestore REST API with GET requests only (a document get, or a
   collection list capped at MAX_DOCS). Needs TOKEN (read access token) and
   PATHS (newline- or comma-separated doc or collection paths). Emails and
   phone numbers are masked before anything is printed.
   Exit 0 = all read, 1 = a bad path, 2 = a read failed. */
'use strict';

const PROJECT = 'plumb-467a0';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const MAX_DOCS = 50;
const MAX_PATHS = 40;
const SEG = /^[A-Za-z0-9_.@-]{1,128}$/;

function parsePaths(raw) {
  const list = String(raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('No paths given.');
  if (list.length > MAX_PATHS) throw new Error('Too many paths (max ' + MAX_PATHS + ').');
  return list.map(p => {
    const segs = p.split('/');
    if (segs.some(s => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('__')))
      throw new Error('Rejected path: ' + JSON.stringify(p.slice(0, 200)));
    return { path: p, kind: segs.length % 2 === 0 ? 'doc' : 'collection' };
  });
}

function mask(s) {
  return String(s)
    .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]*?(\.[A-Za-z]{2,})\b/g, '$1***@***$2')
    .replace(/(?<![\w$,.])(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, '[phone]')
    .replace(/\+\d{10,14}\b/g, '[phone]');   // phone shapes only; plain numbers and ms timestamps stay readable
}

function plain(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  for (const k of ['stringValue', 'booleanValue', 'timestampValue', 'referenceValue', 'bytesValue'])
    if (k in v) return v[k];
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) return fields(v.mapValue.fields);
  return v;
}
function fields(f) { const o = {}; Object.keys(f || {}).sort().forEach(k => { o[k] = plain(f[k]); }); return o; }

async function get(url) {
  const r = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + process.env.TOKEN } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + mask((await r.text()).slice(0, 200)));
  return r.json();
}

function show(name, doc) {
  console.log('=== ' + name);
  console.log(mask(JSON.stringify(fields(doc.fields), null, 2)));
}

if (require.main === module) (async () => {
  let items;
  try { items = parsePaths(process.env.PATHS); } catch (e) { console.error(e.message); process.exit(1); }
  if (!process.env.TOKEN) { console.error('No TOKEN in the environment.'); process.exit(2); }
  let broke = 0;
  for (const it of items) {
    const enc = it.path.split('/').map(encodeURIComponent).join('/');
    try {
      if (it.kind === 'doc') {
        const d = await get(BASE + enc);
        if (!d) console.log('=== ' + it.path + '\n(missing)');
        else show(it.path, d);
      } else {
        const d = await get(BASE + enc + '?pageSize=' + MAX_DOCS);
        const docs = (d && d.documents) || [];
        console.log('### ' + it.path + ': ' + docs.length + ' doc(s)' + (d && d.nextPageToken ? ' (capped at ' + MAX_DOCS + ')' : ''));
        docs.forEach(x => show(x.name.split('/documents/')[1], x));
      }
    } catch (e) { broke++; console.log('=== ' + it.path + '\nREAD FAILED: ' + e.message); }
  }
  process.exit(broke ? 2 : 0);
})();

module.exports = { parsePaths, mask };
