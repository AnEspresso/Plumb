'use strict';
/* P2-6: deleted entries take their photo files with them. Plain node, no emulator. */
const assert = require('assert');
const { photoIdsOf, deleteRecordFiles, describeDeleteEvent } = require('./lib/fileCleanup');

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
  assert.deepStrictEqual([d1.siteId, d1.coll, d1.docId, d1.hasEventData, d1.hasDocData, d1.hasRecord, d1.photoIds], ['s1', 'items', '7', true, true, true, ['phA', 'phB']]);
  const d2 = describeDeleteEvent({ params: { siteId: 's1', coll: 'bk', docId: '2' } });
  assert.deepStrictEqual([d2.coll, d2.hasEventData, d2.hasDocData, d2.photoIds], ['bk', false, false, []], 'no data: logged, not thrown');
  assert.doesNotThrow(() => describeDeleteEvent(undefined));
  assert.strictEqual(describeDeleteEvent({ params: {}, data: { data: () => { throw new Error('x'); } } }).hasDocData, false);

  console.log('fileCleanup: all checks pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
