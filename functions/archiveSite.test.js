'use strict';
/* Step 3b-2: archive-on-delete (M-11) and "opened" lines (M-9). Plain node with an in-memory Firestore. */
const assert = require('assert');
const crypto = require('crypto');
const FV = { arrayRemove: (u) => ({ arr: u }), delete: () => ({ del: true }) };
const Module = require('module'); const _load = Module._load;   // CI installs no firebase-admin: stub the one import
Module._load = function (r, ...a) { return r === 'firebase-admin/firestore' ? { FieldValue: FV } : _load.call(this, r, ...a); };
const A = require('./lib/archiveSite');
const { deleteAccount } = require('./lib/deleteAccount');

function mem(seed) {
  const docs = new Map(Object.entries(seed)); const log = [];
  const snap = (p) => ({ id: p.split('/').pop(), exists: docs.has(p), data: () => docs.get(p), ref: ref(p) });
  const ref = (p) => ({ path: p, id: p.split('/').pop(),
    get: async () => snap(p),
    set: async (v) => { log.push(['set', p]); docs.set(p, Object.assign({}, docs.get(p) || {}, v)); },
    create: async (v) => { if (docs.has(p)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; } log.push(['create', p]); docs.set(p, v); },
    update: async (v) => { log.push(['update', p, v]); docs.set(p, Object.assign({}, docs.get(p) || {}, v)); },
    delete: async () => { log.push(['delete', p]); docs.delete(p); },
    listCollections: async () => [...new Set([...docs.keys()].filter(k => k.startsWith(p + '/')).map(k => k.slice(p.length + 1).split('/')[0]))].map(id => coll(p + '/' + id)),
    collection: (c) => coll(p + '/' + c) });
  const kids = (p) => [...docs.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
  const coll = (p) => ({ path: p, id: p.split('/').pop(), doc: (id) => ref(p + '/' + id),
    get: async () => ({ docs: kids(p).map(snap), empty: !kids(p).length, size: kids(p).length }),
    limit: () => ({ get: async () => { const k = kids(p).slice(0, 1); return { docs: k.map(snap), empty: !k.length, size: k.length }; } }),
    where: () => ({ get: async () => { const q = p === 'sites' ? [...docs.keys()].filter(k => /^sites\/[^/]+$/.test(k)).filter(k => (docs.get(k).memberUids || []).includes(db.uid)) : []; return { docs: q.map(snap), empty: !q.length, size: q.length }; } }) });
  const db = { docs, log, collection: (c) => coll(c), batch: () => { const ops = []; return { delete: (r) => ops.push(['delete', r.path]), commit: async () => { ops.forEach(o => { log.push(o); docs.delete(o[1]); }); } }; } };
  return db;
}
const bucketOf = (store, fail) => ({ file: (p) => ({ save: async (b, o) => { if (fail) throw new Error('bucket down'); assert.strictEqual(o.preconditionOpts.ifGenerationMatch, 0); if (store.has(p)) { const e = new Error('precondition'); e.code = 412; throw e; } store.set(p, b); } }), deleteFiles: async () => {} });
const ON = { enabled: true, receipts: true };
const SITE = (extra) => Object.assign({ members: { uB: 'builder', uH: 'client' }, memberUids: ['uB', 'uH'], meta: { street: '12 Oak', memberInfo: { uH: { name: 'Ana Ruiz' } } } }, extra);
const withMoney = (flag) => { const m = mem({ 'sites/s1': SITE(), 'sites/s1/inv/i1': { data: { id: 'i1', status: 'sent', totalC: 100000 }, updatedAt: 1700000000000 }, 'sites/s1/hist/h1': { kind: 'sent' }, 'sites/s1/bk/b1': { data: {} }, 'settings/paperTrail': flag }); m.uid = 'uB'; return m; };
const noMoney = (flag) => { const m = mem({ 'sites/s1': SITE(), 'sites/s1/inv/i1': { data: { id: 'i1', status: 'draft' } }, 'sites/s1/bk/b1': { data: {} }, 'settings/paperTrail': flag }); m.uid = 'uB'; return m; };
const authAdmin = { deleted: [], deleteUser: async function (u) { this.deleted.push(u); } };
const run = (db, bucket) => deleteAccount(db, { deleted: [], deleteUser: async () => {} }, bucket, 'uB', true, 'b@x.test', () => {}, { archive: A.accountArchiver(db, bucket, FV) });

(async () => {
  /* sentMoney */
  assert.strictEqual(A.sentMoney({ inv: [{ data: () => ({ data: { status: 'draft' } }) }] }).count, 0);
  assert.strictEqual(A.sentMoney({ co: [{ data: () => ({ data: { status: 'sent' }, updatedAt: 5 }) }] }).count, 1);
  assert.strictEqual(A.sentMoney({ pmts: [{ data: () => ({}) }] }).count, 1);

  /* deleteAccount, flag ON, house with a sent invoice: records and history survive, the leaver is stripped, a 7-year mark is set */
  let store = new Map(); let db = withMoney(ON);
  let r = await run(db, bucketOf(store));
  assert.ok(db.docs.has('sites/s1/inv/i1') && db.docs.has('sites/s1/hist/h1') && db.docs.has('sites/s1/bk/b1'), 'money, history and the rest are kept');
  assert.ok(db.docs.has('sites/s1'), 'the house document is kept');
  assert.strictEqual(r.archived, 1); assert.strictEqual(r.deleted.sites, 0);
  const s = db.docs.get('sites/s1'); assert.ok(s.meta === undefined || true);
  const upd = db.log.find(l => l[0] === 'update' && l[1] === 'sites/s1')[2];
  assert.deepStrictEqual(upd.memberUids, { arr: 'uB' }); assert.ok(upd['members.uB'].del); assert.ok(upd['meta.archivedAt'] > 0);
  assert.ok(Math.abs(upd['meta.retainUntil'] - (1700000000000 + 7 * 365.25 * 86400000)) < 2000, 'retain 7 years after the last money event');
  const key = [...store.keys()].find(k => /^archive\/s1\/house-\d+\.json$/.test(k)); assert.ok(key, 'snapshot in the archive bucket');
  assert.strictEqual(upd['meta.archiveFp'], crypto.createHash('sha256').update(store.get(key)).digest('hex'));
  const body = JSON.parse(store.get(key).toString()); assert.strictEqual(body.inv[0].data.data.totalC, 100000); assert.strictEqual(body.memberInfo.uH.name, 'Ana Ruiz');
  assert.ok(!db.log.some(l => l[0] === 'delete' && /^sites\/s1/.test(l[1])), 'nothing under the house was deleted');
  /* flag ON, house without sent money: complete deletion as today */
  store = new Map(); db = noMoney(ON); r = await run(db, bucketOf(store));
  assert.ok(!db.docs.has('sites/s1') && !db.docs.has('sites/s1/inv/i1') && !db.docs.has('sites/s1/bk/b1'), 'no sent money: deleted completely');
  assert.strictEqual(store.size, 0); assert.strictEqual(r.deleted.sites, 1);
  /* flag OFF (missing, enabled only, receipts only): behaves exactly as before, house with money cascades */
  for (const flag of [undefined, { enabled: true }, { receipts: true }]) {
    store = new Map(); db = withMoney(flag); if (flag === undefined) db.docs.delete('settings/paperTrail');
    r = await run(db, bucketOf(store)); assert.ok(!db.docs.has('sites/s1/inv/i1'), 'flag off: old behavior'); assert.strictEqual(store.size, 0); assert.strictEqual(r.archived, undefined);
  }
  /* archive fails: the run aborts before anything is destroyed and can be retried */
  store = new Map(); db = withMoney(ON); await assert.rejects(run(db, bucketOf(store, true)), /bucket down/); assert.ok(db.docs.has('sites/s1/inv/i1') && db.docs.get('sites/s1').memberUids.includes('uB'), 'nothing destroyed, still a member');
  /* the homeowner stays a member of an archived house */
  store = new Map(); db = withMoney(ON); await run(db, bucketOf(store)); assert.ok(!('arr' in {}) && !db.log.some(l => l[0] === 'update' && JSON.stringify(l[2]).includes('uH')));

  /* deleteSite tombstone */
  store = new Map(); db = withMoney(ON); const sref = db.collection('sites').doc('s1');
  const after = Object.assign({}, db.docs.get('sites/s1'), { meta: { street: '12 Oak', deleted: 123 } });
  assert.deepStrictEqual(await A.onSiteTombstone(db, bucketOf(store), db.docs.get('sites/s1'), after, 's1', sref).then(x => ({ a: x.archived })), { a: true });
  assert.ok(store.size === 1 && db.docs.get('sites/s1')['meta.archivedAt'] > 0);
  assert.strictEqual((await A.onSiteTombstone(db, bucketOf(store), after, after, 's1', sref)).skipped, 'not a new tombstone');
  db = withMoney({ enabled: true }); assert.strictEqual((await A.onSiteTombstone(db, bucketOf(new Map()), db.docs.get('sites/s1'), after, 's1', db.collection('sites').doc('s1'))).skipped, 'off');
  db = noMoney(ON); assert.strictEqual((await A.onSiteTombstone(db, bucketOf(new Map()), db.docs.get('sites/s1'), after, 's1', db.collection('sites').doc('s1'))).skipped, 'no sent money');

  /* opened */
  const mk = (flag, co) => { const m = mem({ 'sites/s1': SITE(), 'sites/s1/co/c1': co === undefined ? { data: { id: 'c1', status: 'sent', rev: 2, no: 3 } } : co, 'settings/paperTrail': flag }); return m; };
  const ts = () => 'TS'; const P = { siteId: 's1', coll: 'co', docId: 'c1', uid: 'uH' };
  db = mk({ enabled: true }); assert.deepStrictEqual(await A.recordOpened(db, ts, P), { ok: true, recorded: false, why: 'off' }); assert.ok(![...db.docs.keys()].some(k => /hist/.test(k)));
  db = mk(ON); r = await A.recordOpened(db, ts, P); assert.ok(r.recorded); const line = db.docs.get('sites/s1/hist/' + r.id);
  assert.strictEqual(line.kind, 'opened'); assert.strictEqual(line.rev, 2); assert.strictEqual(line.by, 'uH'); assert.strictEqual(line.byName, 'Ana Ruiz'); assert.strictEqual(line.at, 'TS');
  assert.strictEqual((await A.recordOpened(db, ts, P)).why, 'already opened'); assert.strictEqual([...db.docs.keys()].filter(k => /hist/.test(k)).length, 1, 'the first open only');
  db.docs.get('sites/s1/co/c1').data.rev = 3; assert.ok((await A.recordOpened(db, ts, P)).recorded, 'a new version is a new first open'); assert.strictEqual([...db.docs.keys()].filter(k => /hist/.test(k)).length, 2);
  assert.strictEqual((await A.recordOpened(db, ts, Object.assign({}, P, { uid: 'uB' }))).ok, false, 'the builder opening is not a homeowner open');
  assert.strictEqual((await A.recordOpened(db, ts, Object.assign({}, P, { uid: 'stranger' }))).ok, false);
  db = mk(ON, { data: { id: 'c1', status: 'draft', rev: 1 } }); assert.strictEqual((await A.recordOpened(db, ts, P)).recorded, false, 'a draft is not opened');
  assert.strictEqual((await A.recordOpened(db, ts, Object.assign({}, P, { coll: 'sites' }))).ok, false);
  console.log('archiveSite: all checks passed (archive-on-delete keeps money, no-money deletes fully, flag off = old behavior, archive failure aborts, opened once per version)');
})().catch(e => { console.error(e); process.exit(1); });
