#!/usr/bin/env node
/* Read-only Firestore data read for the "Firestore read (read only)" workflow.
   Uses the Firestore REST API with GET requests only (a document get, or a
   collection list capped at MAX_DOCS). Needs TOKEN (read access token) and
   PATHS (newline- or comma-separated doc or collection paths).

   The log is allowlist-only: counts, document paths/IDs, field names, and
   value types. Field values are never printed — not strings, numbers,
   emails, phones, addresses, names, or anything nested in a map or array.
   Error lines never echo a response body or other data.

   Exit 0 = all read, 1 = a bad path, 2 = a read failed. */
'use strict';

const PROJECT = 'plumb-467a0';
const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/';
const MAX_DOCS = 50;
const MAX_PATHS = 40;
const SEG = /^[A-Za-z0-9_.@-]{1,128}$/;

const SCALAR = {
  nullValue: 'null',
  stringValue: 'string',
  booleanValue: 'boolean',
  timestampValue: 'timestamp',
  referenceValue: 'reference',
  bytesValue: 'bytes',
  integerValue: 'integer',
  doubleValue: 'double',
  geoPointValue: 'geopoint'
};

function parsePaths(raw) {
  const list = String(raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('No paths given.');
  if (list.length > MAX_PATHS) throw new Error('Too many paths (max ' + MAX_PATHS + ').');
  return list.map(p => {
    const segs = p.split('/');
    if (segs.some(s => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('__')))
      throw new Error('Rejected path.');
    return { path: p, kind: segs.length % 2 === 0 ? 'doc' : 'collection' };
  });
}

function safeKey(k) {
  k = String(k);
  if (/@/.test(k) || /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(k) || /\+\d{10,14}/.test(k))
    return '(key)';
  return k;
}

function typeOf(v) {
  if (!v || typeof v !== 'object') return 'unknown';
  for (const k of Object.keys(SCALAR)) if (Object.prototype.hasOwnProperty.call(v, k)) return SCALAR[k];
  if (Object.prototype.hasOwnProperty.call(v, 'arrayValue')) {
    const vals = (v.arrayValue && Array.isArray(v.arrayValue.values)) ? v.arrayValue.values : [];
    return { type: 'array', length: vals.length, items: vals.map(typeOf) };
  }
  if (Object.prototype.hasOwnProperty.call(v, 'mapValue'))
    return { type: 'map', fields: shape(v.mapValue && v.mapValue.fields) };
  return 'unknown';
}

function shape(fields) {
  const o = {};
  Object.keys(fields || {}).sort().forEach(function (k) { o[safeKey(k)] = typeOf(fields[k]); });
  return o;
}

function renderShape(s, indent) {
  indent = indent || '';
  if (typeof s === 'string') return s;
  if (!s || typeof s !== 'object') return 'unknown';
  if (s.type === 'array') {
    const items = s.items || [];
    if (!items.length) return 'array[0]';
    return 'array[' + s.length + ']\n' + items.map(function (it, i) {
      const inner = renderShape(it, indent + '  ');
      return indent + '  ' + i + ': ' + inner;
    }).join('\n');
  }
  if (s.type === 'map') return 'map' + renderFields(s.fields, indent);
  return 'unknown';
}

function renderFields(fields, indent) {
  indent = indent || '';
  const keys = Object.keys(fields || {});
  if (!keys.length) return ' {}';
  return '\n' + keys.map(function (k) {
    return indent + '  ' + k + ': ' + renderShape(fields[k], indent + '  ');
  }).join('\n');
}

function docPath(name) {
  const s = String(name || '');
  const i = s.indexOf('/documents/');
  return i >= 0 ? s.slice(i + '/documents/'.length) : s;
}

function formatDoc(path, doc) {
  const lines = ['=== ' + path];
  if (!doc) { lines.push('(missing)'); return lines.join('\n'); }
  const fields = shape(doc.fields);
  const keys = Object.keys(fields);
  lines.push(keys.length + ' field(s)' + renderFields(fields, ''));
  return lines.join('\n');
}

function formatCollection(path, docs, capped) {
  const n = (docs || []).length;
  const head = '### ' + path + ': ' + n + ' doc(s)' + (capped ? ' (capped at ' + MAX_DOCS + ')' : '');
  const body = (docs || []).map(function (d) { return formatDoc(docPath(d.name), d); });
  return [head].concat(body).join('\n');
}

function formatError(path) {
  return '=== ' + path + '\nREAD FAILED';
}

async function get(url) {
  const r = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + process.env.TOKEN } });
  if (r.status === 404) return null;
  if (!r.ok) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
  return r.json();
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
        console.log(formatDoc(it.path, d));
      } else {
        const d = await get(BASE + enc + '?pageSize=' + MAX_DOCS);
        const docs = (d && d.documents) || [];
        console.log(formatCollection(it.path, docs, !!(d && d.nextPageToken)));
      }
    } catch (e) { broke++; console.log(formatError(it.path)); }
  }
  process.exit(broke ? 2 : 0);
})();

module.exports = { parsePaths, typeOf, shape, formatDoc, formatCollection, formatError, docPath, MAX_DOCS };
