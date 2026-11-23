'use strict';
/* #17 (batch 3): telemetry writes need a real account and a rate limit; owner reads are bounded. */
const assert = require('assert');
const T = require('./lib/telemetry');
const P = require('./lib/push');

/* A small in-memory Firestore: collections, docs, subcollections, orderBy/limit, transactions. */
function fakeDb() {
  const store = {};   // path -> data
  const reads = [];
  const kids = (path) => Object.keys(store).filter((k) => k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0);
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => snapOf(path),
    set: async (d) => { store[path] = Object.assign({}, d); },
    delete: async () => { delete store[path]; },
    collection: (c) => coll(path + '/' + c),
  });
  const snapOf = (path) => ({ id: path.split('/').pop(), exists: path in store, ref: docRef(path), data: () => (store[path] ? Object.assign({}, store[path]) : undefined) });
  const coll = (path, ord, lim) => ({
    doc: (id) => docRef(path + '/' + id),
    orderBy: (f, dir) => coll(path, [f, dir], lim),
    limit: (n) => coll(path, ord, n),
    add: async (d) => { const id = 'a' + Object.keys(store).length + Math.random().toString(36).slice(2, 6); store[path + '/' + id] = d; return docRef(path + '/' + id); },
    get: async () => {
      let ks = kids(path);
      if (ord) ks = ks.filter((k) => store[k][ord[0]] != null).sort((a, b) => (ord[1] === 'desc' ? -1 : 1) * (store[a][ord[0]] - store[b][ord[0]]));
      if (lim != null) ks = ks.slice(0, lim);
      reads.push({ path, n: ks.length, lim });
      return { docs: ks.map(snapOf), size: ks.length };
    },
  });
  return {
    store, reads,
    collection: (c) => coll(c),
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, d) => { store[ref.path] = Object.assign({}, d); } }),
  };
}

(async () => {
  /* anonymous sessions are refused */
  assert.strictEqual(T.isAnonymous({ uid: 'u1', firebase: { sign_in_provider: 'anonymous' } }), true);
  assert.strictEqual(T.isAnonymous({ uid: 'u1', firebase: { sign_in_provider: 'password' } }), false);
  assert.strictEqual(T.isAnonymous({ uid: 'u1', firebase: { sign_in_provider: 'google.com' } }), false);
  assert.strictEqual(T.isAnonymous(null), true);
  let db = fakeDb();
  let g = await T.writeGate(db, { uid: 'anon1', firebase: { sign_in_provider: 'anonymous' } }, 1000);
  assert.deepStrictEqual([g.ok, g.status, g.error], [false, 403, 'account-required'], 'anonymous: refused before anything is counted');
  assert.ok(!('telemetryRate/anon1' in db.store), 'an anonymous call writes nothing');

  /* the rate limit: max calls per window per account, then 429, then a new window */
  const rate = { windowMs: 60000, max: 3 };
  const U = { uid: 'u1', firebase: { sign_in_provider: 'password' } };
  const t0 = 1791200000000;
  for (let i = 0; i < 3; i++) assert.ok((await T.writeGate(db, U, t0 + i, rate)).ok, 'call ' + (i + 1) + ' inside the budget');
  g = await T.writeGate(db, U, t0 + 10, rate);
  assert.deepStrictEqual([g.ok, g.status, g.error], [false, 429, 'rate-limited'], 'the 4th call in the window is refused');
  assert.ok((await T.writeGate(db, { uid: 'u2', firebase: { sign_in_provider: 'password' } }, t0 + 11, rate)).ok, 'another account has its own budget');
  assert.ok((await T.writeGate(db, U, t0 + 60000, rate)).ok, 'a new window opens after a minute');
  assert.deepStrictEqual(db.store['telemetryRate/u1'], { w: t0 + 60000, n: 1 });
  assert.ok((await T.writeGate(db, U, t0 + 5, rate)).ok, 'a clock that went backwards starts a fresh window, never locks the account out');
  assert.strictEqual(T.RATE.max >= 2 && T.RATE.windowMs >= 60000, true, 'default: a beat a minute always fits');

  /* bounded admin reads */
  db = fakeDb();
  for (let i = 0; i < 7; i++) {
    db.store['telemetry/dev' + i] = { device: 'dev' + i, t: 1000 + i };
    for (let j = 0; j < 4; j++) db.store['telemetry/dev' + i + '/events/e' + j] = { name: 'x', t: j };
  }
  let u = await T.usage(db, { devicesMax: 5, eventsPerDevice: 2 });
  assert.strictEqual(u.devices.length, 5, 'usage: one page of devices');
  assert.deepStrictEqual(u.devices.map((d) => d.device), ['dev6', 'dev5', 'dev4', 'dev3', 'dev2'], 'newest first');
  assert.ok(u.devices.every((d) => d.events.length === 2), 'events capped per device');
  assert.strictEqual(u.more, true, 'more pages flagged');
  assert.ok(db.reads.every((r) => r.lim != null), 'every read in usage has a limit');
  u = await T.usage(db);
  assert.strictEqual(u.more, false);
  db.reads.length = 0;
  let c = await T.clear(db, { devicesMax: 5, eventsMax: 3 });
  assert.ok(db.reads.every((r) => r.lim != null), 'every read in clear has a limit');
  assert.strictEqual(c.n, 0, 'a device with more events than the cap is kept until its events are gone');
  assert.strictEqual(c.more, true);
  c = await T.clear(db, { devicesMax: 5, eventsMax: 3 });
  assert.strictEqual(c.n, 5); assert.strictEqual(c.more, true, 'devices left: more');
  c = await T.clear(db, { devicesMax: 5, eventsMax: 3 });
  assert.ok(c.n >= 2 || c.more);
  while ((await T.clear(db, { devicesMax: 5, eventsMax: 3 })).more);
  assert.deepStrictEqual(Object.keys(db.store).filter((k) => k.startsWith('telemetry/')), [], 'repeated clears empty it');

  /* #14: packet pushes only for a creator on the house */
  const SITE = { members: { uB: 'builder', uS: 'sub', uH: 'client' }, memberUids: ['uB', 'uS', 'uH', 'uOld'] };
  assert.strictEqual(P.packetCreatorOk(SITE, { createdBy: 'uB' }), true, 'builder of the house');
  assert.strictEqual(P.packetCreatorOk(SITE, { createdBy: 'uS' }), true, 'a member of the house');
  assert.strictEqual(P.packetCreatorOk(SITE, { createdBy: 'uOld' }), true, 'listed in memberUids');
  assert.strictEqual(P.packetCreatorOk(SITE, { createdBy: 'uX' }), false, 'a stranger naming the house: no push');
  assert.strictEqual(P.packetCreatorOk(SITE, {}), false, 'no creator: no push');
  assert.strictEqual(P.packetCreatorOk(SITE, { createdBy: 'toString' }), false, 'no prototype keys');
  assert.strictEqual(P.packetCreatorOk(null, { createdBy: 'uB' }), false);
  const src = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');
  const fn = src.slice(src.indexOf('exports.onPacketReply'), src.indexOf('exports.notifyTest'));
  assert.ok(fn.indexOf('packetCreatorOk') > 0 && fn.indexOf('packetCreatorOk') < fn.indexOf('deliver('), 'onPacketReply checks the creator before it pushes');
  const tsrc = src.slice(src.indexOf('exports.telemetryBeat'), src.indexOf('exports.telemetryUsage'));
  assert.ok((tsrc.match(/telemetryWriter\(req, res\)/g) || []).length === 2, 'both telemetry writes go through the gate');
  assert.ok(src.indexOf("db.collection('telemetry').get()") < 0, 'no unbounded telemetry read is left');
  console.log('telemetry: all checks passed (no anonymous writes, rate limit, bounded owner reads, packet creator check)');
})().catch((e) => { console.error(e); process.exit(1); });
