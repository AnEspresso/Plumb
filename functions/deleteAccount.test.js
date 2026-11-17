'use strict';
/* #2 + #16 (pre-launch review): deleting an account erases a house only when that
   person is its only builder. Everyone else just steps off the house, from every
   copy of the member list. Plain node with an in-memory Firestore. */
const assert = require('assert');
const FV = { arrayRemove: (u) => ({ __arrRemove: u }), delete: () => ({ __del: true }) };
const Module = require('module'); const _load = Module._load;   // CI installs no firebase-admin: stub the one import
Module._load = function (r, ...a) { return r === 'firebase-admin/firestore' ? { FieldValue: FV } : _load.call(this, r, ...a); };
const { deleteAccount, soleBuilder } = require('./lib/deleteAccount');

/* update() applies dotted paths, deletes and arrayRemove the way Firestore does. */
function applyUpdate(doc, patch) {
  const out = JSON.parse(JSON.stringify(doc || {}));
  for (const [k, v] of Object.entries(patch)) {
    const parts = k.split('.'); let o = out;
    for (let i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (v && v.__del) delete o[last];
    else if (v && v.__arrRemove !== undefined) o[last] = (o[last] || []).filter(x => x !== v.__arrRemove);
    else o[last] = v;
  }
  return out;
}
function mem(seed, me) {
  const docs = new Map(Object.entries(seed));
  const kids = (p) => [...docs.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
  const snap = (p) => ({ id: p.split('/').pop(), exists: docs.has(p), data: () => docs.get(p), ref: ref(p) });
  const ref = (p) => ({ path: p, id: p.split('/').pop(),
    get: async () => snap(p),
    set: async (v) => { docs.set(p, Object.assign({}, docs.get(p) || {}, v)); },
    update: async (v) => { docs.set(p, applyUpdate(docs.get(p), v)); },
    delete: async () => { docs.delete(p); },
    listCollections: async () => [...new Set([...docs.keys()].filter(k => k.startsWith(p + '/')).map(k => k.slice(p.length + 1).split('/')[0]))].map(id => coll(p + '/' + id)),
    collection: (c) => coll(p + '/' + c) });
  const coll = (p) => ({ path: p, doc: (id) => ref(p + '/' + id),
    get: async () => ({ docs: kids(p).map(snap), empty: !kids(p).length, size: kids(p).length }),
    limit: () => ({ get: async () => { const k = kids(p).slice(0, 1); return { docs: k.map(snap), empty: !k.length, size: k.length }; } }),
    where: () => ({ get: async () => { const q = p === 'sites' ? [...docs.keys()].filter(k => /^sites\/[^/]+$/.test(k)).filter(k => (docs.get(k).memberUids || []).includes(me)) : []; return { docs: q.map(snap), empty: !q.length, size: q.length }; } }) });
  return { docs, collection: (c) => coll(c), batch: () => { const ops = []; return { delete: (r) => ops.push(r.path), commit: async () => { ops.forEach(p => docs.delete(p)); } }; }, collectionGroup: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }) };
}
const auth = () => ({ deleted: [], async deleteUser(u) { this.deleted.push(u); } });
const bucket = { deleted: [], async deleteFiles(o) { this.deleted.push(o.prefix); } };
/* A house run by an owner (no roster entry) and a teammate PM, with a homeowner and a crew. */
const TEAM_HOUSE = () => ({ mode: 'live', members: { own: 'builder', pm: 'builder', ho: 'client', crew: 'sub' }, memberUids: ['own', 'pm', 'ho', 'crew'],
  meta: { street: '12 Oak', members: { own: 'builder', pm: 'builder', ho: 'client', crew: 'sub' }, memberInfo: { pm: { name: 'Pat PM', email: 'pat@example.test', rpRole: 'pm' }, ho: { name: 'Ana' }, crew: { name: 'Crew' } } } });
const SOLO_HOUSE = () => ({ mode: 'live', members: { own: 'builder', ho: 'client' }, memberUids: ['own', 'ho'], meta: { street: '9 Elm', members: { own: 'builder', ho: 'client' }, memberInfo: { ho: { name: 'Ana' } } } });
const seed = () => ({ 'sites/team': TEAM_HOUSE(), 'sites/team/inv/i1': { data: { status: 'sent' } }, 'sites/team/items/n1': { data: {} },
  'sites/solo': SOLO_HOUSE(), 'sites/solo/inv/i2': { data: { status: 'draft' } } });

(async () => {
  assert.strictEqual(soleBuilder({ a: 'builder' }, 'a'), true);
  assert.strictEqual(soleBuilder({ a: 'builder', b: 'builder' }, 'a'), false, 'another builder: not sole');
  assert.strictEqual(soleBuilder({ a: 'builder', b: { role: 'builder' } }, 'a'), false, 'legacy {role} builder counts too');
  assert.strictEqual(soleBuilder({ a: 'builder', h: 'client', s: 'sub' }, 'a'), true, 'homeowner and crew do not keep a house');
  assert.strictEqual(soleBuilder({ a: 'sub' }, 'a'), false, 'a crew never erases a house');

  /* The exploit path: a teammate deletes their account. The owner's house stays, records and all. */
  let db = mem(seed(), 'pm'); let a = auth();
  const pv = await deleteAccount(db, a, bucket, 'pm', false, 'pat@example.test', () => {});
  assert.deepStrictEqual(pv.preview.ownedSites, [], 'preview: a teammate erases no house');
  assert.strictEqual(pv.preview.memberSites, 1);
  let r = await deleteAccount(db, a, bucket, 'pm', true, 'pat@example.test', () => {});
  assert.strictEqual(r.deleted.sites, 0); assert.strictEqual(r.deleted.memberships, 1);
  const t = db.docs.get('sites/team');
  assert.ok(t && db.docs.has('sites/team/inv/i1') && db.docs.has('sites/team/items/n1'), 'the house and its records are kept');
  assert.ok(!('pm' in t.members) && !t.memberUids.includes('pm'), 'the teammate is off the top-level member list');
  assert.ok(!('pm' in t.meta.members) && !('pm' in t.meta.memberInfo), '#16: off meta.members and meta.memberInfo too (name and email gone)');
  assert.strictEqual(t.members.own, 'builder'); assert.strictEqual(t.meta.memberInfo.ho.name, 'Ana', 'everyone else is untouched');
  assert.deepStrictEqual(a.deleted, ['pm'], 'the account itself is deleted');

  /* The owner leaving a house a teammate still runs: the house stays, the owner steps off. */
  db = mem(seed(), 'own'); a = auth();
  const pv2 = await deleteAccount(db, a, bucket, 'own', false, '', () => {});
  assert.deepStrictEqual(pv2.preview.ownedSites, ['9 Elm'], 'preview names only the house the owner runs alone');
  r = await deleteAccount(db, a, bucket, 'own', true, '', () => {});
  assert.ok(db.docs.has('sites/team') && db.docs.has('sites/team/inv/i1'), 'a house another builder runs is kept');
  assert.ok(!('own' in db.docs.get('sites/team').members), 'the owner is off it');
  /* The sole owner's house is erased, records and files, as before. */
  assert.ok(!db.docs.has('sites/solo') && !db.docs.has('sites/solo/inv/i2'), 'the sole-builder house is erased');
  assert.ok(bucket.deleted.includes('live/sites/solo/'), 'its files go too');
  assert.ok(!bucket.deleted.includes('live/sites/team/'), 'the kept house keeps its files');
  assert.strictEqual(r.deleted.sites, 1); assert.strictEqual(r.deleted.memberships, 1);

  /* A homeowner or crew deleting their account never erases a house. */
  db = mem(seed(), 'ho'); r = await deleteAccount(db, auth(), bucket, 'ho', true, '', () => {});
  assert.ok(db.docs.has('sites/team') && db.docs.has('sites/solo')); assert.strictEqual(r.deleted.sites, 0);
  assert.ok(!('ho' in db.docs.get('sites/solo').meta.memberInfo), 'the homeowner name leaves meta.memberInfo');

  console.log('deleteAccount: all checks passed (a teammate or a shared house is never erased, a sole owner\'s house is, every member copy is stripped)');
})().catch(e => { console.error(e); process.exit(1); });
