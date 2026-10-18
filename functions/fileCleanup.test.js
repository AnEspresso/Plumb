'use strict';
/* P2-6: deleted entries take their photo files with them. Plain node, no emulator. */
const assert = require('assert');
const { photoIdsOf, deleteRecordFiles, describeDeleteEvent, planDelete } = require('./lib/fileCleanup');

function bucket(behave) {
  const b = { calls: [], file(p) { return { delete: async () => { b.calls.push(p); const x = behave[p]; if (x) throw x; } }; } };
  return b;
}

(async () => {
  assert.deepStrictEqual(photoIdsOf({ photoId: 'phA', edits: [{ snap: { photoId: 'phB' } }, { snap: { photoId: 'phA' } }, { snap: {} }] }), ['phA', 'phB']);
  assert.deepStrictEqual(photoIdsOf({ photoId: null }), []);
  assert.deepStrictEqual(photoIdsOf({ photoId: '../x' }), [], 'path-like ids are ignored');

  const ok = bucket({});
  const r1 = await deleteRecordFiles(ok, 's1', { data: { id: 3, photoId: 'phA', edits: [{ snap: { photoId: 'phB' } }] } }, () => { throw new Error('should not log'); });
  assert.deepStrictEqual(ok.calls, ['live/sites/s1/photos/phA', 'live/sites/s1/photos/phB']);
  assert.strictEqual(r1.deleted.length, 2);

  const nf = Object.assign(new Error('No such object: live/sites/s1/photos/phA'), { code: 404 });
  const logs = [];
  const r2 = await deleteRecordFiles(bucket({ 'live/sites/s1/photos/phA': nf }), 's1', { data: { photoId: 'phA' } }, (e) => logs.push(e));
  assert.deepStrictEqual(r2.missing, ['live/sites/s1/photos/phA'], 'a missing file counts as done');
  assert.strictEqual(logs.length, 0, 'a missing file is not an error');

  const boom = Object.assign(new Error('storage unavailable'), { code: 503 });
  const r3 = await deleteRecordFiles(bucket({ 'live/sites/s1/photos/phA': boom }), 's1', { data: { photoId: 'phA', edits: [{ snap: { photoId: 'phB' } }] } }, (e) => logs.push(e));
  assert.deepStrictEqual(r3.failed, ['live/sites/s1/photos/phA']);
  assert.deepStrictEqual(r3.deleted, ['live/sites/s1/photos/phB'], 'one failure does not stop the rest');
  assert.ok(logs.length === 1 && logs[0].path === 'live/sites/s1/photos/phA' && /storage unavailable/.test(logs[0].error));

  const none = bucket({});
  await deleteRecordFiles(none, 's1', { data: { id: 9 } });
  await deleteRecordFiles(none, '../evil', { data: { photoId: 'phA' } });
  assert.strictEqual(none.calls.length, 0, 'no photo or a bad site id touches nothing');

  /* the always-on log line: written for every delete event, whatever the collection or shape */
  const ev = { params: { siteId: 's1', coll: 'items', docId: '7' }, data: { data: () => ({ data: { id: 7, photoId: 'phA', edits: [{ snap: { photoId: 'phB' } }] }, updatedAt: 1 }) } };
  const d1 = describeDeleteEvent(ev);
  assert.deepStrictEqual([d1.siteId, d1.coll, d1.docId, d1.hasEventData, d1.hasDocData, d1.recordKeys.length > 0, d1.photoIds], ['s1', 'items', '7', true, true, true, ['phA', 'phB']]);
  const d2 = describeDeleteEvent({ params: { siteId: 's1', coll: 'bk', docId: '2' } });
  assert.deepStrictEqual([d2.coll, d2.hasEventData, d2.hasDocData, d2.photoIds], ['bk', false, false, []], 'no data: logged, not thrown');
  assert.doesNotThrow(() => describeDeleteEvent(undefined));
  assert.strictEqual(describeDeleteEvent({ params: {}, data: { data: () => { throw new Error('x'); } } }).hasDocData, false);

  /* the real note shape the app writes (sites/{site}/items/{id}): {data:{...note}, updatedAt, updatedBy} with photoId inside data,
     photoUrl stamped after upload (app/index.html SYNC_COLLS items, Sync._pushOne set, CloudFiles._stamp) */
  const real = { data: { id: 12, cap: 'Test delete', area: 'Whole House', crew: '', issue: false, photoId: 'phmve8pivu3f66', photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/live%2Fsites%2Fpmraom9qz%2Fphotos%2Fphmve8pivu3f66?alt=media&token=t', sw: 'dove', t: 1792353018000, day: 0, share: false }, updatedAt: 1792353060000, updatedBy: 'dev1' };
  const pl = planDelete({ siteId: 'pmraom9qz', coll: 'items', docId: '12' }, real);
  assert.deepStrictEqual([pl.earlyReturn, pl.photoIds, pl.paths, pl.docPath], [null, ['phmve8pivu3f66'], ['live/sites/pmraom9qz/photos/phmve8pivu3f66'], 'sites/pmraom9qz/items/12']);
  assert.ok(pl.docKeys.includes('data') && pl.recordKeys.includes('photoId') && pl.photoFields.photoId === 'phmve8pivu3f66', 'field keys are reported');
  const rb = bucket({});
  const rr = await deleteRecordFiles(rb, 'pmraom9qz', real, () => { throw new Error('no log expected'); });
  assert.deepStrictEqual([rb.calls, rr.deleted.length, rr.missing.length, rr.failed.length], [['live/sites/pmraom9qz/photos/phmve8pivu3f66'], 1, 0, 0]);
  /* every way to do nothing names its reason: no silent return */
  const why = (params, doc) => planDelete(params, doc).earlyReturn;
  assert.strictEqual(why({ siteId: 's1', coll: 'bk', docId: '1' }, real), 'coll-not-handled');
  assert.strictEqual(why({ siteId: 's1', coll: 'items', docId: '1' }, undefined), 'no-doc-data');
  assert.strictEqual(why({ siteId: 's1', coll: 'items', docId: '1' }, { updatedAt: 1 }), 'no-record-under-data');
  assert.strictEqual(why({ siteId: 's1', coll: 'items', docId: '1' }, { data: {} }), 'no-photo-ids');
  assert.strictEqual(why({ siteId: 's1', coll: 'items', docId: '1' }, { data: { photoId: 'a/b' } }), 'no-photo-ids', 'a bad id is named, not skipped quietly');
  assert.strictEqual(why({ siteId: '../x', coll: 'items', docId: '1' }, real), 'bad-site-id');
  assert.strictEqual(why({ siteId: 's1', coll: 'costs', docId: '1' }, { data: { photoId: 'phR' } }), null);
  const dd = describeDeleteEvent({ params: { siteId: 'pmraom9qz', coll: 'items', docId: '12' }, data: { data: () => real } }, 'plumb-467a0.firebasestorage.app');
  assert.deepStrictEqual([dd.bucket, dd.earlyReturn, dd.paths, dd.hasDocData], ['plumb-467a0.firebasestorage.app', null, ['live/sites/pmraom9qz/photos/phmve8pivu3f66'], true]);
  /* a wrong or missing BUCKET is a 404 too: it must be a logged failure, never "missing = done" */
  const nb = Object.assign(new Error('The specified bucket does not exist.'), { code: 404 });
  const lg = [];
  const rn = await deleteRecordFiles(bucket({ 'live/sites/pmraom9qz/photos/phmve8pivu3f66': nb }), 'pmraom9qz', real, (e) => lg.push(e));
  assert.deepStrictEqual([rn.failed.length, rn.missing.length, lg.length], [1, 0, 1], 'missing bucket is failed + logged');
  const no = Object.assign(new Error('No such object: b/o'), { code: 404 });
  const rm = await deleteRecordFiles(bucket({ 'live/sites/pmraom9qz/photos/phmve8pivu3f66': no }), 'pmraom9qz', real, () => {});
  assert.deepStrictEqual([rm.missing.length, rm.failed.length], [1, 0], 'a missing object stays done (and is reported as missing)');

  console.log('fileCleanup: all checks pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
