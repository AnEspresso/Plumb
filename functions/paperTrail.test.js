'use strict';
/* Step 3a: the money history writer and the server's own calculation. Plain node, no emulator. */
const assert = require('assert');
const pt = require('./lib/paperTrail');

/* cents: half up, no float noise */
const T = [['1849.5', 184950], [10.125, 1013], [0.1 + 0.2, 30], [1254.9199999999998, 125492], ['-400', -40000], [5.555, 556], [0, 0], ['2,000', NaN], ['abc', NaN], [1e21, NaN]];
T.forEach(([v, want]) => { const g = pt.dollarsToCents(v); assert.ok(Object.is(g, want) || g === want, 'dollarsToCents(' + v + ') = ' + g + ' want ' + want); });
assert.strictEqual(pt.fmtCents(184950), '$1,849.50'); assert.strictEqual(pt.fmtCents(-40000), '\u2212$400.00'); assert.strictEqual(pt.fmtCents(5), '$0.05');
assert.strictEqual(pt.sentenceFor('co', 210000), 'This adds $2,100.00 to your contract.');
assert.strictEqual(pt.sentenceFor('co', -40000), 'This credits $400.00.');
assert.strictEqual(pt.sentenceFor('inv', 1250000), 'This invoice is $12,500.00.');

/* M-14: an invoice that is off by one cent does not verify; a matching one does */
assert.strictEqual(pt.verifyInvoice({ items: [{ amount: 0.1 }, { amount: 0.2 }], total: 0.3 }).ok, true);
assert.strictEqual(pt.verifyInvoice({ items: [{ amountC: 1000 }, { amountC: 550 }], totalC: 1550, total: 15.5 }).ok, true);
assert.strictEqual(pt.verifyInvoice({ items: [{ amountC: 1000 }, { amountC: 550 }], totalC: 1551 }).ok, false, 'one cent off');
assert.strictEqual(pt.verifyInvoice({ items: [{ amount: 'x' }], total: 1 }).ok, false);
/* property: 10,000 random invoices, the server's sum equals the sum of integer cents */
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = 0; i < 10000; i++) {
  const n = 1 + Math.floor(rnd() * 8), items = []; let want = 0;
  for (let k = 0; k < n; k++) { const c = Math.round((rnd() - 0.3) * 500000); items.push({ amountC: c, amount: c / 100 }); want += c; }
  const v = pt.verifyInvoice({ items, totalC: want, total: want / 100 });
  assert.ok(v.ok && v.calc === want, 'random invoice ' + i);
}
assert.strictEqual(pt.verifyCo({ amountC: 185000, kind: 'change', rev: 1 }).ok, true);
assert.strictEqual(pt.verifyCo({ amountC: -40000, kind: 'credit', rev: 2 }).sentence, 'This credits $400.00.');
assert.strictEqual(pt.verifyCo({ amountC: -40000, kind: 'change', rev: 1 }).ok, false, 'sign must match the kind');
assert.strictEqual(pt.verifyCo({ amountC: 1850.5, kind: 'change', rev: 1 }).ok, false, 'not whole cents');
assert.strictEqual(pt.verifyCo({ amountC: 100, kind: 'change' }).ok, false, 'no rev');

/* history lines */
const co = (o, outer) => Object.assign({ data: Object.assign({ id: 'c1', status: 'sent', rev: 1, no: 3, kind: 'change', amountC: 185000, sentBy: 'uB' }, o || {}), byUid: 'uB' }, outer || {});
let l = pt.linesFor('co', null, co());
assert.deepStrictEqual(l.map(x => x.kind), ['sent']); assert.strictEqual(l[0].amountC, 185000);
l = pt.linesFor('co', co({ status: 'draft', rev: undefined }), co());
assert.deepStrictEqual(l.map(x => x.kind), ['sent'], 'draft to sent');
l = pt.linesFor('co', co(), co({ rev: 2, amountC: 210000 }));
assert.deepStrictEqual(l.map(x => x.kind), ['changed']); assert.strictEqual(l[0].rev, 2);
l = pt.linesFor('co', co({ rev: 2 }), co({ rev: 2, verifiedRev: 2, verifiedTotal: 185000 }));
assert.deepStrictEqual(l, [], 'the server verification write adds no line');
l = pt.linesFor('co', co(), co({ status: 'approved', decidedRev: 1, decidedBy: 'uH', decidedName: 'Ana Ruiz', sentence: 'This adds $1,850.00 to your contract.' }, { byUid: 'uH' }));
assert.deepStrictEqual(l.map(x => x.kind), ['approved']); assert.strictEqual(l[0].by, 'uH'); assert.strictEqual(l[0].sentence, 'This adds $1,850.00 to your contract.'); assert.strictEqual(l[0].signedName, 'Ana Ruiz'); assert.strictEqual(l[0].via, 'app');
l = pt.linesFor('co', co(), co({ status: 'approved', approvedVia: 'paper', decidedBy: 'uB' }));
assert.strictEqual(l[0].via, 'paper');
l = pt.linesFor('co', co(), co({ status: 'declined', declineNote: 'Too much' }));
assert.deepStrictEqual(l.map(x => x.kind), ['declined']); assert.strictEqual(l[0].note, 'Too much');
l = pt.linesFor('co', co(), co({ status: 'withdrawn' }));
assert.deepStrictEqual(l.map(x => x.kind), ['withdrawn']);
assert.deepStrictEqual(pt.linesFor('co', co(), null), [], 'a delete writes no line');
assert.deepStrictEqual(pt.linesFor('co', null, co({ status: 'draft', rev: undefined })), [], 'a draft is not a money event');

const inv = (o) => ({ data: Object.assign({ id: 'i1', no: 'INV-014', status: 'draft', totalC: 100000, total: 1000, payments: [] }, o || {}), byUid: 'uB' });
assert.deepStrictEqual(pt.linesFor('inv', inv(), inv({ status: 'sent' })).map(x => x.kind), ['sent']);
assert.deepStrictEqual(pt.linesFor('inv', inv({ status: 'paid' }), inv({ status: 'sent' })), [], 'a paid invoice reopened by a void is not sent again');
assert.deepStrictEqual(pt.linesFor('inv', inv({ status: 'sent' }), inv({ status: 'approved' })).map(x => x.kind), ['approved']);
assert.deepStrictEqual(pt.linesFor('inv', inv({ status: 'approved' }), inv({ status: 'paid' })).map(x => x.kind), ['paid']);
assert.deepStrictEqual(pt.linesFor('inv', inv({ status: 'sent' }), inv({ status: 'void', voidReason: 'wrong job' })).map(x => x.kind), ['voided']);
l = pt.linesFor('inv', inv({ status: 'sent' }), inv({ status: 'sent', payments: [{ id: 'p1', amountC: 25000, amount: 250 }] }));
assert.deepStrictEqual(l.map(x => x.kind), ['payment']); assert.strictEqual(l[0].amountC, 25000);
l = pt.linesFor('inv', inv({ status: 'sent', payments: [{ id: 'p1', amountC: 25000 }] }), inv({ status: 'sent', payments: [{ id: 'p1', amountC: 25000, voidedAt: 5, voidReason: 'bounced' }] }));
assert.deepStrictEqual(l.map(x => x.kind), ['payment_voided']); assert.strictEqual(l[0].note, 'bounced');
assert.deepStrictEqual(pt.linesFor('inv', inv({ status: 'sent' }), inv({ status: 'sent' })), [], 'no change, no line');
const pm = (o) => ({ data: Object.assign({ id: 'p9', amountC: 200000, amount: 2000 }, o || {}), byUid: 'uB' });
assert.deepStrictEqual(pt.linesFor('pmts', null, pm()).map(x => x.kind), ['payment']);
assert.deepStrictEqual(pt.linesFor('pmts', pm(), pm({ voidedAt: 9, voidReason: 'typo' })).map(x => x.kind), ['payment_voided']);
assert.deepStrictEqual(pt.linesFor('pmts', pm(), pm({ note: 'edited' })), []);

/* the handler, with a fake db */
function fakeDb(flag, site) {
  const store = {}; const writes = [];
  const ref = (path) => ({ path,
    get: async () => { if (path === 'settings/paperTrail') { if (flag === 'throw') throw new Error('x'); return { exists: flag !== undefined, data: () => flag }; } if (path === 'sites/s1') return { data: () => site }; return { exists: false, data: () => undefined }; },
    set: async (v) => { writes.push(['set', path, v]); },
    update: async (v) => { writes.push(['update', path, v]); },
    collection: (c) => ({ doc: (id) => ref(path + '/' + c + '/' + id) }) });
  return { writes, collection: (c) => ({ doc: (id) => ref(c + '/' + id) }), batch: () => { const ops = []; return { set: (r, v) => ops.push(['set', r.path, v]), commit: async () => { ops.forEach(o => writes.push(o)); } }; } };
}
const ev = (b, a, id) => ({ id: id || 'ev1', params: { siteId: 's1', docId: 'c1' }, data: { before: { exists: !!b, data: () => b }, after: { exists: !!a, data: () => a } } });
const ts = () => 'SERVER_TS';
const SITE = { meta: { memberInfo: { uB: { name: 'Dean Walsh' } } } };
(async () => {
  pt._resetCache();
  let db = fakeDb(undefined, SITE);
  let r = await pt.handle(db, ts, 'co', ev(null, co()));
  assert.deepStrictEqual(r, { skipped: 'off' }); assert.strictEqual(db.writes.length, 0, 'flag missing: nothing is written');
  pt._resetCache(); db = fakeDb({ enabled: false }, SITE);
  assert.deepStrictEqual(await pt.handle(db, ts, 'co', ev(null, co())), { skipped: 'off' }); assert.strictEqual(db.writes.length, 0, 'flag false: nothing is written');
  pt._resetCache(); db = fakeDb('throw', SITE);
  assert.deepStrictEqual(await pt.handle(db, ts, 'co', ev(null, co())), { skipped: 'off' }, 'a failed flag read is off');
  pt._resetCache(); db = fakeDb({ enabled: true }, SITE);
  r = await pt.handle(db, ts, 'co', ev(null, co(), 'evA'));
  const setW = db.writes.filter(w => w[0] === 'set'), upW = db.writes.filter(w => w[0] === 'update');
  assert.strictEqual(setW.length, 1); assert.strictEqual(setW[0][1], 'sites/s1/hist/evA_0'); assert.strictEqual(setW[0][2].kind, 'sent'); assert.strictEqual(setW[0][2].byName, 'Dean Walsh'); assert.strictEqual(setW[0][2].at, 'SERVER_TS');
  assert.strictEqual(upW.length, 1); assert.deepStrictEqual(upW[0][2], { 'data.verifiedRev': 1, 'data.verifiedTotal': 185000 }, 'server writes the verification');
  assert.strictEqual(upW[0][1], 'sites/s1/co/c1');
  /* the verification write re-fires the trigger: no line, no second update */
  db = fakeDb({ enabled: true }, SITE); pt._resetCache();
  r = await pt.handle(db, ts, 'co', ev(co(), co({ verifiedRev: 1, verifiedTotal: 185000 }), 'evB'));
  assert.strictEqual(db.writes.length, 0, 'verification echo writes nothing');
  /* a bad amount is flagged, not verified */
  db = fakeDb({ enabled: true }, SITE); pt._resetCache();
  await pt.handle(db, ts, 'co', ev(null, co({ amountC: -5 }), 'evC'));
  assert.ok(db.writes.some(w => w[1] === 'sites/s1/hist/evC_check' && w[2].kind === 'needs_check'));
  assert.ok(!db.writes.some(w => w[0] === 'update' && w[2]['data.verifiedRev'] === 1), 'never verified');
  /* an edit that invalidates a stale verification clears it */
  db = fakeDb({ enabled: true }, SITE); pt._resetCache();
  await pt.handle(db, ts, 'co', ev(co({ verifiedRev: 1 }), co({ rev: 2, amountC: 5, kind: 'change', verifiedRev: 1, verifiedTotal: 185000 }), 'evD'));
  assert.ok(db.writes.some(w => w[0] === 'update' && w[2]['data.verifiedRev'] === 2 && w[2]['data.verifiedTotal'] === 5), 'a revision is re-verified at its own rev');
  /* same event id twice: same document ids (a retry cannot double a line) */
  db = fakeDb({ enabled: true }, SITE); pt._resetCache();
  await pt.handle(db, ts, 'pmts', ev(null, pm(), 'evE')); await pt.handle(db, ts, 'pmts', ev(null, pm(), 'evE'));
  const ids = db.writes.filter(w => w[0] === 'set').map(w => w[1]);
  assert.deepStrictEqual(ids, ['sites/s1/hist/evE_0', 'sites/s1/hist/evE_0']);
  console.log('paperTrail: all checks passed (cents, sentences, M-14 verify, 10,000-invoice property, history lines, handler gate)');
})().catch(e => { console.error(e); process.exit(1); });
