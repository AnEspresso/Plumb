'use strict';
/* Step 3b-2 (M-11 archive-on-delete, M-9 "opened"): DORMANT behind settings/paperTrail { enabled: true, receipts: true }.
   Flag off: deleteAccount behaves exactly as before (cascade). Flag on: a house with sent money is archived, never erased. */
const crypto = require('crypto');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const MONEY_COLLS = ['inv', 'selm', 'pmts', 'co', 'costs', 'hist', 'consent', 'flags', 'numbers'];
const SEVEN_YEARS_MS = 7 * 365.25 * 24 * 3600 * 1000;
const SENT = ['sent', 'approved', 'declined', 'withdrawn', 'paid', 'overdue', 'partial', 'void'];

async function flagOn(db) {
  try { const s = await db.collection('settings').doc('paperTrail').get(); const d = s.exists ? s.data() : null; return !!(d && d.enabled === true && d.receipts === true); } catch (e) { return false; }
}
function dataOf(doc) { const x = doc.data() || {}; return x.data && typeof x.data === 'object' ? x.data : x; }
/* "has sent money": any invoice past draft, any change order past draft, any recorded payment. */
function sentMoney(snaps) {
  let n = 0, last = 0;
  const bump = (x) => { const t = Number(x.updatedAt || x.at || 0); if (t > last) last = t; n++; };
  (snaps.inv || []).forEach(d => { const s = dataOf(d); if (SENT.includes(s.status)) bump(d.data() || {}); });
  (snaps.co || []).forEach(d => { const s = dataOf(d); if (SENT.includes(s.status)) bump(d.data() || {}); });
  (snaps.pmts || []).forEach(d => { bump(d.data() || {}); });
  return { count: n, lastMs: last };
}
function plain(v) { return JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x.toMillis === 'function' ? x.toMillis() : x))); }
function canon(v) { if (Array.isArray(v)) return v.map(canon); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; } return v; }

/* Returns { archived:false } for a house with no sent money (caller deletes completely, as today). */
async function archiveSite(db, bucket, siteDoc, opts) {
  const o = opts || {}; const nowMs = o.now == null ? Date.now() : o.now;
  const snaps = {};
  for (const c of MONEY_COLLS) snaps[c] = (await siteDoc.ref.collection(c).get()).docs;
  const sm = sentMoney(snaps);
  if (!sm.count) return { archived: false };
  const site = siteDoc.data() || {};
  const body = { site: siteDoc.id, archivedAt: nowMs, reason: o.reason || 'delete',
    members: plain(site.members || {}), memberInfo: plain(((site.meta || {}).memberInfo) || {}), street: (site.meta && site.meta.street) || site.street || '' };
  MONEY_COLLS.forEach(c => { body[c] = snaps[c].map(d => ({ id: d.id, data: plain(d.data() || {}) })); });
  const buf = Buffer.from(JSON.stringify(canon(body), null, 2), 'utf8'); const fp = sha256(buf);
  const path = 'archive/' + siteDoc.id + '/house-' + nowMs + '.json';
  try { await bucket.file(path).save(buf, { contentType: 'application/json', resumable: false, metadata: { metadata: { sha256: fp } }, preconditionOpts: { ifGenerationMatch: 0 } }); }
  catch (e) { if (!(e && (e.code === 412 || /precondition/i.test(String(e.message))))) throw e; }
  const retainUntil = Math.round((sm.lastMs || nowMs) + SEVEN_YEARS_MS);
  return { archived: true, fp, path, count: sm.count, retainUntil };
}

/* deleteAccount hook: archive an owned house that has sent money, keep every record, strip only the leaver. */
function accountArchiver(db, bucket, FieldValue) {
  return async function (doc, uid) {
    if (!(await flagOn(db))) return false;
    const r = await archiveSite(db, bucket, doc, { reason: 'account' });
    if (!r.archived) return false;
    await doc.ref.update({
      memberUids: FieldValue.arrayRemove(uid), ['members.' + uid]: FieldValue.delete(), ['memberInfo.' + uid]: FieldValue.delete(),
      'meta.archivedAt': Date.now(), 'meta.archiveFp': r.fp, 'meta.retainUntil': r.retainUntil,
    });
    return true;
  };
}
/* the client's deleteSite is a tombstone (meta.deleted). On the first tombstone of a house with sent money: snapshot + retention mark. */
async function onSiteTombstone(db, bucket, before, after, siteId, ref) {
  const b = before && before.meta && before.meta.deleted; const a = after && after.meta && after.meta.deleted;
  if (!a || b) return { skipped: 'not a new tombstone' };
  if (after.meta.archivedAt) return { skipped: 'already archived' };
  if (!(await flagOn(db))) return { skipped: 'off' };
  const r = await archiveSite(db, bucket, { id: siteId, ref, data: () => after }, { reason: 'deleteSite' });
  if (!r.archived) return { skipped: 'no sent money' };
  await ref.update({ 'meta.archivedAt': Date.now(), 'meta.archiveFp': r.fp, 'meta.retainUntil': r.retainUntil });
  return r;
}

/* M-9 "opened": the first time the homeowner opens each version, one line; a second open writes nothing. */
async function recordOpened(db, ts, p) {
  if (!(await flagOn(db))) return { ok: true, recorded: false, why: 'off' };
  const coll = p.coll === 'inv' ? 'inv' : p.coll === 'co' ? 'co' : null;
  if (!coll || !p.siteId || !p.docId) return { ok: false, why: 'bad request' };
  const site = ((await db.collection('sites').doc(p.siteId).get()).data()) || {};
  const m = (site.members || {})[p.uid]; const role = String(typeof m === 'string' ? m : (m && m.role) || '').toLowerCase();
  if (role !== 'client') return { ok: false, why: 'only the homeowner opens' };
  const snap = await db.collection('sites').doc(p.siteId).collection(coll).doc(p.docId).get();
  const d = snap.exists ? dataOf(snap) : null;
  if (!d || d.status !== 'sent') return { ok: true, recorded: false, why: 'not open for signing' };
  const rev = coll === 'co' ? d.rev : 0; if (coll === 'co' && !Number.isInteger(rev)) return { ok: true, recorded: false, why: 'no rev' };
  const info = ((site.meta || {}).memberInfo || {})[p.uid] || {};
  const id = 'open_' + p.docId + '_r' + rev + '_' + p.uid;
  try {
    await db.collection('sites').doc(p.siteId).collection('hist').doc(id).create({ kind: 'opened', ref: String(d.id != null ? d.id : p.docId), refType: coll, rev, no: d.no || d.num || null, by: p.uid, byName: String(info.name || ''), at: ts(), seq: 0, src: coll + '/' + p.docId });
  } catch (e) { if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return { ok: true, recorded: false, why: 'already opened' }; throw e; }
  return { ok: true, recorded: true, id };
}
module.exports = { MONEY_COLLS, flagOn, sentMoney, archiveSite, accountArchiver, onSiteTombstone, recordOpened };
