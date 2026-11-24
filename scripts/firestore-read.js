#!/usr/bin/env node
/* Read-only Firestore data read for the "Firestore read (read only)" workflow.
   Uses the Firestore REST API with GET requests only (a document get, or a
   collection list capped at MAX_DOCS). Needs TOKEN (read access token) and
   PATHS (newline- or comma-separated doc or collection paths).

   The log is allowlist-only: counts, document paths/IDs, field names, and
   value types. Field values are never printed — not strings, numbers,
   emails, phones, addresses, names, or anything nested in a map or array.
   Error lines never echo a response body or other data. Push-token maps
   (fcm and the like) print only a key count: their keys are the tokens.

   EQ checks (2026-11-17): an entry "eq:<doc>#<field.path>=<doc>#<field.path>" in PATHS prints only
   whether the two stored values are equal, different, or missing - never either value. A field path walks
   maps by name and arrays by index; "__id" is the document ID (already printed above). There are no
   literals, so a check can only compare two things already in the database, never test a guess.

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

function parseSide(side) {
  const i = side.indexOf('#');
  if (i <= 0) throw new Error('Rejected check.');
  const doc = side.slice(0, i), field = side.slice(i + 1);
  const segs = doc.split('/');
  if (segs.length % 2 !== 0 || segs.some(s => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('__')))
    throw new Error('Rejected check.');
  const fsegs = field.split('.');
  if (!field || fsegs.some(f => !/^[A-Za-z0-9_-]{1,128}$/.test(f)) || (fsegs.length > 1 && fsegs.includes('__id')))
    throw new Error('Rejected check.');
  return { doc, field: fsegs };
}
function parseCheck(entry) {
  const body = entry.slice(3);
  const parts = body.split('=');
  if (parts.length !== 2) throw new Error('Rejected check.');
  return { label: body, a: parseSide(parts[0].trim()), b: parseSide(parts[1].trim()) };
}
/* the stored value at a field path, as the REST API's typed value; undefined when missing */
function valueAt(doc, field) {
  if (!doc) return undefined;
  if (field.length === 1 && field[0] === '__id') return { stringValue: docPath(doc.name).split('/').pop() };
  let cur = { mapValue: { fields: doc.fields || {} } };
  for (const f of field) {
    if (cur && cur.mapValue) cur = (cur.mapValue.fields || {})[f];
    else if (cur && cur.arrayValue && /^\d+$/.test(f)) cur = ((cur.arrayValue.values) || [])[Number(f)];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}
function canonValue(v) {
  if (Array.isArray(v)) return '[' + v.map(canonValue).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonValue(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function compareValues(a, b) {
  if (a === undefined || b === undefined) return 'missing';
  return canonValue(a) === canonValue(b) ? 'equal' : 'different';
}
function formatCheck(label, result) { return 'EQ ' + label + ': ' + result; }

function parsePaths(raw) {
  const list = String(raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).filter(s => !/^(eq|members|events):/.test(s));
  if (!list.length) throw new Error('No paths given.');
  if (list.length > MAX_PATHS) throw new Error('Too many paths (max ' + MAX_PATHS + ').');
  return list.map(p => {
    const segs = p.split('/');
    if (segs.some(s => !SEG.test(s) || s === '.' || s === '..' || s.startsWith('__')))
      throw new Error('Rejected path.');
    return { path: p, kind: segs.length % 2 === 0 ? 'doc' : 'collection' };
  });
}

/* Push tokens (Peter 11/23): users/{uid}.fcm is a map keyed BY the device's FCM
   token, so its keys are secrets. A map whose field name says token/fcm prints
   only its key count, and any key shaped like a token prints as (token). */
const TOKEN_MAP = /^(fcm|apns|webpush|push)$|token/i;
function tokenLike(k) {
  return /:APA91/.test(k) || /^[A-Za-z0-9_:.-]{40,}$/.test(k);
}
function safeKey(k) {
  k = String(k);
  if (/@/.test(k) || /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(k) || /\+\d{10,14}/.test(k))
    return '(key)';
  if (tokenLike(k)) return '(token)';
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
  let hidden = 0;
  Object.keys(fields || {}).sort().forEach(function (k) {
    const v = fields[k];
    if (TOKEN_MAP.test(k) && v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'mapValue')) {
      o[safeKey(k)] = { type: 'redacted', count: Object.keys((v.mapValue && v.mapValue.fields) || {}).length };
      return;
    }
    const sk = safeKey(k);
    if (sk === '(token)') { hidden++; return; }
    o[sk] = typeOf(v);
  });
  if (hidden) o['(token keys)'] = { type: 'redacted', count: hidden };
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
  if (s.type === 'redacted') return '{<' + (s.count || 0) + ' keys>}';
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

/* SCANS (2026-11-24, +sub crew home, issue #129). Two entries, GET only, paged with nextPageToken:
   "members:<uid>"  lists EVERY site doc (only the fields memberUids, members, mode, meta.memberInfo are
                    fetched) and prints only the IDs of sites that name <uid>, with where it is named
                    (memberUids / members / memberInfo), its role from an allowlist and whether the site is live.
                    It also flags the site that users/<uid>.hatSite points at, without printing hatSite.
   "events:<device>" prints, newest first, only event names from a fixed allowlist (anything else is
                    "(other)"), the event time in America/Detroit, and for clientError only which listener
                    was refused (live houses / site records / other). The device's app version prints only
                    when it is a plain x.y.z. No detail text, uid, name or token is ever printed. */
const EVENT_NAMES = ['clientError', 'liveHousesRetry', 'crewLocalDropped', 'crewNameHealed', 'syncConnected', 'authChange', 'uidHeal', 'syncRebind', 'authRepair', 'login', 'cacheCleared'];
const ROLES = ['sub', 'builder', 'client', 'team'];
const UID = /^[A-Za-z0-9]{10,40}$/;
const DEV = /^dev_[a-z0-9]{4,20}$/;
function strOf(v) { return v && typeof v.stringValue === 'string' ? v.stringValue : null; }
function intOf(v) { if (!v) return null; if (v.integerValue != null) return Number(v.integerValue); if (v.doubleValue != null) return Number(v.doubleValue); return null; }
function memberHit(doc, uid) {
  const f = (doc && doc.fields) || {};
  const where = [];
  const arr = (f.memberUids && f.memberUids.arrayValue && f.memberUids.arrayValue.values) || [];
  if (arr.some(v => strOf(v) === uid)) where.push('memberUids');
  const mem = (f.members && f.members.mapValue && f.members.mapValue.fields) || {};
  let role = '';
  if (Object.prototype.hasOwnProperty.call(mem, uid)) {
    where.push('members');
    const r = strOf(mem[uid]) || strOf(((mem[uid].mapValue || {}).fields || {}).role);
    role = ROLES.includes(r) ? r : '(other)';
  }
  const meta = (f.meta && f.meta.mapValue && f.meta.mapValue.fields) || {};
  const mi = (meta.memberInfo && meta.memberInfo.mapValue && meta.memberInfo.mapValue.fields) || {};
  if (Object.prototype.hasOwnProperty.call(mi, uid)) where.push('memberInfo');
  if (!where.length) return null;
  const mode = strOf(f.mode);
  return { id: docPath(doc.name).split('/').pop(), where, role, live: mode === 'live' };
}
function formatHit(h, hatSite) {
  return 'MEMBER ' + h.id + ': ' + h.where.join('+') + (h.role ? ' · role ' + h.role : '') + (h.live ? ' · live' : ' · not live') + (hatSite && hatSite === h.id ? ' · hatSite' : '');
}
function etTime(ms) {
  if (!(ms > 0)) return '(no time)';
  return new Date(ms).toLocaleString('en-US', { timeZone: 'America/Detroit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) + ' ET';
}
/* clientError "Cloud read blocked" names three short uids: the Firebase token, the uid Sync is bound to, and the
   session's. Print only how each relates to the given uid (self / other / none / anon), never the uids. */
function uidRelations(d, self) {
  const pre = String(self).slice(0, 8);
  const rel = (m, anon) => !m ? 'unread' : m === 'none' || m === 'no-auth' ? 'none' : (anon ? 'anon ' : '') + (m === pre ? 'self' : 'other');
  const t = /token \[(?:(anon|account) ([A-Za-z0-9]{1,8})|(no-auth))\]/.exec(d);
  const b = /bound \[([A-Za-z0-9]{1,8}|none)\]/.exec(d);
  const se = /session \[([A-Za-z0-9]{1,8}|none)\]/.exec(d);
  return ' · token ' + (t ? (t[3] ? 'none' : rel(t[2], t[1] === 'anon')) : 'unread') + ' · bound ' + rel(b && b[1]) + ' · session ' + rel(se && se[1]);
}
function eventLine(doc, self) {
  const f = (doc && doc.fields) || {};
  const n = strOf(f.name);
  const name = EVENT_NAMES.includes(n) ? n : '(other)';
  let extra = '';
  if (name === 'clientError') {
    const d = strOf(f.detail) || '';
    extra = /Cloud read blocked \(live houses\)/.test(d) ? ' · live houses refused' : /Cloud read blocked \(site records\)/.test(d) ? ' · site records refused' : ' · other';
    if (self && /Cloud read blocked/.test(d)) extra += uidRelations(d, self);
  }
  const r = strOf(f.role);
  const role = ['subs', 'builder', 'client', '\u2014'].includes(r) ? r : '(other)';
  return 'EVENT ' + etTime(intOf(f.t)) + ' ' + name + extra + ' · role ' + role;
}
function versionOf(doc) {
  const v = strOf(((doc && doc.fields) || {}).v);
  return v && /^\d+\.\d+\.\d+$/.test(v) ? v : '(other)';
}
async function listAll(path, params) {
  const out = []; let tok = '';
  for (let i = 0; i < 200; i++) {
    const d = await get(BASE + path + '?pageSize=300' + (params || '') + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''));
    ((d && d.documents) || []).forEach(x => out.push(x));
    tok = d && d.nextPageToken; if (!tok) break;
  }
  return out;
}

async function get(url) {
  const r = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + process.env.TOKEN } });
  if (r.status === 404) return null;
  if (!r.ok) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
  return r.json();
}

if (require.main === module) (async () => {
  let items, checks;
  try {
    checks = String(process.env.PATHS || '').split(/[\n,]+/).map(s => s.trim()).filter(s => /^eq:/.test(s)).map(parseCheck);
    if (checks.length > MAX_PATHS) throw new Error('Too many checks (max ' + MAX_PATHS + ').');
    items = String(process.env.PATHS || '').split(/[\n,]+/).some(s => s.trim() && !/^(eq|members|events):/.test(s.trim())) ? parsePaths(process.env.PATHS) : [];
  } catch (e) { console.error(e.message); process.exit(1); }
  if (!process.env.TOKEN) { console.error('No TOKEN in the environment.'); process.exit(2); }
  let broke = 0;
  const scans = String(process.env.PATHS || '').split(/[\n,]+/).map(x => x.trim()).filter(x => /^(members|events):/.test(x));
  for (const sc of scans) {
    const [kind, arg] = [sc.slice(0, sc.indexOf(':')), sc.slice(sc.indexOf(':') + 1)];
    try {
      if (kind === 'members') {
        if (!UID.test(arg)) throw new Error('bad uid');
        const u = await get(BASE + 'users/' + arg + '?mask.fieldPaths=hatSite');
        const hatSite = strOf(((u && u.fields) || {}).hatSite);
        const docs = await listAll('sites', '&mask.fieldPaths=memberUids&mask.fieldPaths=members&mask.fieldPaths=mode&mask.fieldPaths=meta.memberInfo');
        const hits = docs.map(d => memberHit(d, arg)).filter(Boolean);
        console.log('### members scan: ' + docs.length + ' site doc(s) read, ' + hits.length + ' name this uid' + (hatSite ? '' : ' (no hatSite)'));
        hits.forEach(h => console.log(formatHit(h, hatSite)));
        if (hatSite && !docs.some(d => docPath(d.name).split('/').pop() === hatSite)) console.log('hatSite: no site doc with that id');
      } else {
        const [dev, self] = arg.split(':');
        if (!DEV.test(dev) || (self && !UID.test(self))) throw new Error('bad device');
        const dv = await get(BASE + 'telemetry/' + dev + '?mask.fieldPaths=v&mask.fieldPaths=t');
        console.log('### events ' + dev + ': device app version ' + versionOf(dv) + ' · last beat ' + etTime(intOf(((dv && dv.fields) || {}).t)));
        const evs = await listAll('telemetry/' + dev + '/events', '&mask.fieldPaths=name&mask.fieldPaths=t&mask.fieldPaths=role&mask.fieldPaths=detail');
        evs.sort((a, b) => (intOf((b.fields || {}).t) || 0) - (intOf((a.fields || {}).t) || 0));
        console.log(evs.length + ' event(s)');
        evs.slice(0, 120).forEach(e => console.log(eventLine(e, self)));
      }
    } catch (e) { broke++; console.log('### ' + kind + ' scan: READ FAILED'); }
  }
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
  const cache = {};
  const docOf = async (p) => {
    if (!(p in cache)) cache[p] = await get(BASE + p.split('/').map(encodeURIComponent).join('/'));
    return cache[p];
  };
  for (const c of checks) {
    try { console.log(formatCheck(c.label, compareValues(valueAt(await docOf(c.a.doc), c.a.field), valueAt(await docOf(c.b.doc), c.b.field)))); }
    catch (e) { broke++; console.log(formatCheck(c.label, 'READ FAILED')); }
  }
  process.exit(broke ? 2 : 0);
})();

module.exports = { uidRelations, memberHit, formatHit, eventLine, versionOf, etTime, parseCheck, valueAt, compareValues, formatCheck, parsePaths, typeOf, shape, formatDoc, formatCollection, formatError, docPath, MAX_DOCS };
