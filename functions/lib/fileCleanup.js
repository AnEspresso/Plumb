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
const notFound = (e) => !!e && (e.code === 404 || e.code === '404' || /no such object|not.?found/i.test(String(e.message || '')));

/* doc = the deleted Firestore doc's data ({data:{...record}}); returns what happened. */
async function deleteRecordFiles(bucket, siteId, doc, log) {
  log = log || defaultLog;
  const rec = (doc && doc.data) || {};
  const ids = photoIdsOf(rec);
  const r = { deleted: [], missing: [], failed: [] };
  if (!ID_OK.test(String(siteId || ''))) return r;
  for (const id of ids) {
    const path = 'live/sites/' + siteId + '/photos/' + id;
    try { await bucket.file(path).delete(); r.deleted.push(path); }
    catch (e) {
      if (notFound(e)) { r.missing.push(path); continue; }
      r.failed.push(path);
      try { log({ path, siteId: String(siteId), error: String((e && e.message) || e).slice(0, 300) }); } catch (_) {}
    }
  }
  return r;
}

module.exports = { photoIdsOf, deleteRecordFiles };
