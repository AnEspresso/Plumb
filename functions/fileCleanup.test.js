'use strict';
/* P2-6: deleted entries take their photo files with them. Plain node, no emulator. */
const assert = require('assert');
const { photoIdsOf, deleteRecordFiles } = require('./lib/fileCleanup');

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

  console.log('fileCleanup: all checks pass');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
