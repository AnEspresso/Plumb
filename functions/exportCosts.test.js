'use strict';
/* #13 (2.513.0): QuickBooks export takes a per-cost lock and checks the app's money gate. Plain node, fake db and fake QuickBooks. */
const assert = require('assert');
const X = require('./lib/exportCosts');

function world(site, costs) {
  const store = {};
  store['sites/s1'] = site;
  Object.keys(costs).forEach(id => { store['sites/s1/costs/' + id] = { data: costs[id] }; });
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const merge = (t, d) => { Object.keys(d).forEach(k => { if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && t[k] && typeof t[k] === 'object') merge(t[k], d[k]); else t[k] = clone(d[k]); }); return t; };
  const ref = (path) => ({ path,
    get: async () => ({ exists: store[path] !== undefined, data: () => clone(store[path]) }),
    set: async (v, o) => { store[path] = (o && o.merge && store[path]) ? merge(clone(store[path]), v) : clone(v); },
    delete: async () => { delete store[path]; },
    collection: (c) => ({ doc: (id) => ref(path + '/' + c + '/' + id), get: async () => { const pre = path + '/' + c + '/'; const docs = Object.keys(store).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ id: k.slice(pre.length), data: () => clone(store[k]) })); return { forEach: (f) => docs.forEach(f) }; } }) });
  /* transactions run one at a time, like Firestore's serialized commits on the same documents */
  let chain = Promise.resolve();
  const db = { store, collection: (c) => ({ doc: (id) => ref(c + '/' + id) }),
    runTransaction: (fn) => { const run = chain.then(async () => { const writes = []; const out = await fn({ get: (r) => r.get(), set: (r, v) => writes.push([r, v]) }); for (const [r, v] of writes) await r.set(v); return out; }); chain = run.catch(() => {}); return run; } };
  return db;
}
function fakeQbo(opts) {
  opts = opts || {};
  const purchases = []; const seenIds = {};
  return { purchases, seenIds, qbo: {
    freshTokens: async () => ({ realmId: 'R1', accessToken: 'T' }),
    ensureAccount: async (t, n) => 'acct:' + n, ensureCustomer: async () => 'cust1', ensureVendor: async (t, n) => 'v:' + n,
    createPurchase: async (t, p) => {
      await new Promise(r => setTimeout(r, 5));
      if (opts.fail) { const e = new Error(opts.fail.msg); if (opts.fail.status) e.status = opts.fail.status; throw e; }
      if (p.requestId && seenIds[p.requestId]) return seenIds[p.requestId];   /* QuickBooks returns the first result for a repeated requestid */
      const id = 'P' + (purchases.length + 1); purchases.push(p); if (p.requestId) seenIds[p.requestId] = id; return id;
    } } };
}
const SITE = { street: '12 Oak', members: { uB: 'builder', uPM: 'builder', uS: 'builder', uC: 'client' },
  meta: { memberInfo: { uPM: { name: 'Pat', rpRole: 'pm', gates: { moneyJob: true, moneyCo: true } }, uS: { name: 'Sam', rpRole: 'super', gates: { moneyJob: true } } } } };
const COST = (id, o) => Object.assign({ id, rt: 'actual', kind: 'spent', amount: 120, payee: 'Lumber Co', t: 1792400000000 }, o || {});

(async () => {
  /* the money gate: the same as the app's QuickBooks line (moneyCo), never crew, homeowner or a builder without it */
  assert.ok(X.moneyGateOk(SITE, 'uB'), 'the creator (no memberInfo entry)');
  assert.ok(X.moneyGateOk(SITE, 'uPM'), 'a builder with Change orders & money');
  assert.ok(!X.moneyGateOk(SITE, 'uS'), 'a builder with job money only (the app hides QuickBooks from them too)');
  assert.ok(!X.moneyGateOk(SITE, 'uC'), 'the homeowner');
  let db = world(SITE, { c1: COST('c1') }); let q = fakeQbo();
  assert.deepStrictEqual(await X.exportCosts(db, 'uS', 's1', { qbo: q.qbo }), { ok: false, reason: 'no-money-access' });
  assert.deepStrictEqual(await X.exportCosts(db, 'uC', 's1', { qbo: q.qbo }), { ok: false, reason: 'not-your-site' });
  assert.strictEqual(q.purchases.length, 0, '#13 a refused export makes nothing');

  /* two taps at once (two phones, or a double tap): one purchase per cost */
  db = world(SITE, { c1: COST('c1'), c2: COST('c2', { amount: 80 }), c3: COST('c3', { kind: 'contract' }) }); q = fakeQbo();
  const [a, b] = await Promise.all([X.exportCosts(db, 'uB', 's1', { qbo: q.qbo }), X.exportCosts(db, 'uPM', 's1', { qbo: q.qbo })]);
  assert.strictEqual(q.purchases.length, 2, '#13 two concurrent exports: exactly one purchase per cost, got ' + q.purchases.length);
  assert.strictEqual(a.created + b.created, 2);
  assert.strictEqual(db.store['sites/s1/costs/c1'].data.qbId != null && db.store['sites/s1/costs/c2'].data.qbId != null, true);
  assert.strictEqual(db.store['qbExports/s1__c1'].state, 'done');
  /* a third tap later: nothing new */
  let r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo });
  assert.strictEqual(r.created, 0); assert.strictEqual(q.purchases.length, 2);

  /* the cost mark lost (an app overwrote data without qbId): the done lock still stops a duplicate and heals the mark */
  delete db.store['sites/s1/costs/c1'].data.qbId;
  r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo });
  assert.strictEqual(q.purchases.length, 2, '#13 a done lock means no second purchase'); assert.strictEqual(r.created, 0);
  assert.ok(db.store['sites/s1/costs/c1'].data.qbId, '#13 the mark is written back');

  /* a fresh pending claim from another tap: skipped as busy */
  db = world(SITE, { c1: COST('c1') }); q = fakeQbo();
  db.store['qbExports/s1__c1'] = { state: 'pending', by: 'uPM', at: 1000 };
  r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo, now: () => 1000 + 60000 });
  assert.strictEqual(r.busy, 1); assert.strictEqual(q.purchases.length, 0, '#13 a cost another tap is sending is left alone');
  /* a stale claim (a crash mid-send) is taken over, and the requestid makes QuickBooks return the first purchase */
  const rid = X.requestIdFor('R1', 's1', 'c1'); q.seenIds[rid] = 'P-first';
  r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo, now: () => 1000 + X.LOCK_MS + 1 });
  assert.strictEqual(r.created, 1); assert.strictEqual(q.purchases.length, 0, '#13 the retry did not make a second purchase');
  assert.strictEqual(db.store['sites/s1/costs/c1'].data.qbId, 'P-first');
  assert.ok(rid.length <= 50 && rid === X.requestIdFor('R1', 's1', 'c1') && rid !== X.requestIdFor('R1', 's1', 'c2'), 'requestid: stable per cost, QuickBooks length');

  /* a clear refusal (4xx) frees the cost; a timeout keeps the claim until it goes stale */
  db = world(SITE, { c1: COST('c1') }); q = fakeQbo({ fail: { msg: 'QBO 400 bad', status: 400 } });
  r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo }); assert.strictEqual(r.failures.length, 1); assert.ok(!db.store['qbExports/s1__c1'], '#13 a refused create frees the cost');
  q = fakeQbo({ fail: { msg: 'socket hang up' } });
  r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo }); assert.strictEqual(r.failures.length, 1); assert.strictEqual(db.store['qbExports/s1__c1'].state, 'pending', '#13 an unclear failure keeps the claim');
  q = fakeQbo(); r = await X.exportCosts(db, 'uB', 's1', { qbo: q.qbo });
  assert.strictEqual(r.busy, 1); assert.strictEqual(q.purchases.length, 0, '#13 no second try until the claim goes stale');

  /* the requestid reaches QuickBooks */
  const qb = require('./lib/qbo'); let url = '';
  const realFetch = global.fetch; global.fetch = async (u) => { url = u; return { ok: true, json: async () => ({ Purchase: { Id: '9' } }) }; };
  try { await qb.createPurchase({ realmId: 'R1', accessToken: 'T' }, { payAccountId: 'a', expenseAccountId: 'b', vendorId: 'v', customerId: 'c', amount: 1, dateISO: '2026-11-17', note: 'n', requestId: 'plumb-abc' }); }
  finally { global.fetch = realFetch; }
  assert.ok(/[?&]requestid=plumb-abc(&|$)/.test(url), '#13 createPurchase sends the requestid: ' + url);
  console.log('exportCosts: all checks passed (#13 money gate, one purchase per cost under concurrency, stale claim, requestid)');
})().catch(e => { console.error(e); process.exit(1); });
