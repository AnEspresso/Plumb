/* lib/fileCleanup.js — P2-6 (Release I): a deleted photo is gone for good.
   When a field note (sites/{siteId}/items/{id}) or a cost entry
   (sites/{siteId}/costs/{id}) is deleted, its photo files are deleted from
   Storage too, with the Admin SDK (no client delete, so no rules change).
   The file layout matches the app's CloudFiles.path: live/sites/{siteId}/photos/{photoId}.
   Photos named in the entry's edit history go too: the whole entry is gone,
   so nothing can restore them. A missing file counts as done. A failed delete
   is logged at ERROR (Cloud Logging, same as P2-5) and never retried in a loop. */
'use strict';

const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

function photoIdsOf(rec) {
  const out = new Set();
  const add = (v) => { if (typeof v === 'string' && ID_OK.test(v)) out.add(v); };
  if (!rec || typeof rec !== 'object') return [];
  add(rec.photoId);
  (Array.isArray(rec.edits) ? rec.edits : []).forEach((e) => { add(e && e.snap && e.snap.photoId); });
  return [...out];
}

function defaultLog(entry) {
  console.error(JSON.stringify(Object.assign({ severity: 'ERROR', message: 'fileCleanup: file delete failed' }, entry)));
}
/* A missing OBJECT is done. A missing BUCKET is also a 404 from Storage ("The specified bucket does not
   exist"), and must never count as done: that would hide a wrong bucket name forever. */
const notFound = (e) => {
  if (!e) return false;
  const msg = String(e.message || '');
  if (/bucket/i.test(msg) && /not exist|not found|no such/i.test(msg)) return false;
  return e.code === 404 || e.code === '404' || /no such object|not.?found/i.test(msg);
};

/* doc = the deleted Firestore doc's data ({data:{...record}}); returns what happened. */
async function deleteRecordFiles(bucket, siteId, doc, log) {
  log = log || defaultLog;
  const rec = (doc && doc.data) || {};
  const ids = photoIdsOf(rec);
  const r = { deleted: [], missing: [], failed: [] };
  if (!ID_OK.test(String(siteId || ''))) return r;
  for (const id of ids) {
    const path = pathOf(siteId, id);
    try { await bucket.file(path).delete(); r.deleted.push(path); }
    catch (e) {
      if (notFound(e)) { r.missing.push(path); continue; }
      r.failed.push(path);
      try { log({ path, siteId: String(siteId), error: String((e && e.message) || e).slice(0, 300) }); } catch (_) {}
    }
  }
  return r;
}

const HANDLED = { items: 1, costs: 1 };
const pathOf = (siteId, id) => 'live/sites/' + siteId + '/photos/' + id;

/* What a delete event will do, and why it would do nothing. Pure; never throws. earlyReturn is null when
   at least one file path will be tried, else the exact reason nothing is. */
function planDelete(params, doc) {
  const p = params || {};
  const rec = (doc && typeof doc === 'object' && doc.data && typeof doc.data === 'object') ? doc.data : null;
  const photoIds = photoIdsOf(rec);
  const siteOk = ID_OK.test(String(p.siteId || ''));
  let earlyReturn = null;
  if (!HANDLED[p.coll]) earlyReturn = 'coll-not-handled';
  else if (!doc || typeof doc !== 'object') earlyReturn = 'no-doc-data';
  else if (!rec) earlyReturn = 'no-record-under-data';
  else if (!siteOk) earlyReturn = 'bad-site-id';
  else if (!photoIds.length) earlyReturn = 'no-photo-ids';
  return {
    docPath: 'sites/' + (p.siteId || '?') + '/' + (p.coll || '?') + '/' + (p.docId || '?'),
    coll: p.coll || null,
    docKeys: doc && typeof doc === 'object' ? Object.keys(doc) : [],
    recordKeys: rec ? Object.keys(rec) : [],
    photoFields: rec ? { photoId: rec.photoId === undefined ? null : rec.photoId, editPhotoIds: (Array.isArray(rec.edits) ? rec.edits : []).map((e) => (e && e.snap && e.snap.photoId) || null).filter(Boolean) } : null,
    photoIds,
    paths: earlyReturn ? [] : photoIds.map((id) => pathOf(p.siteId, id)),
    earlyReturn,
  };
}

/* One log object per delete event, written before any filtering. */
function describeDeleteEvent(event, bucketName) {
  const p = (event && event.params) || {};
  let doc = null;
  try { doc = (event && event.data && typeof event.data.data === 'function') ? event.data.data() : null; } catch (_) { doc = null; }
  return Object.assign({
    severity: 'INFO', message: 'onRecordDeleted fired',
    hasEventData: !!(event && event.data), hasDocData: !!doc, bucket: bucketName || null,
    siteId: p.siteId || null, docId: p.docId || null,
  }, planDelete(p, doc));
}

module.exports = { photoIdsOf, deleteRecordFiles, describeDeleteEvent, planDelete };
