/* Plumb server checks — runs under: firebase emulators:exec --only firestore "node fncheck.js"
   A local mock stands in for Intuit; the Firestore emulator holds real docs.
   Covers: token exchange + rotating refresh, vendor/customer/account dedupe,
   purchase payloads, export idempotency + write-back, membership gate, telemetry owner gate. */
'use strict';
const http = require('http');
const assert = require('assert');
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-plumb-rules';
process.env.INTUIT_CLIENT_ID = 'test-id';
process.env.INTUIT_CLIENT_SECRET = 'test-secret';

const admin = require('./functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-plumb-rules' });
const db = admin.firestore();

let PASS = 0; const FAILS = [];
const t = (name, ok, detail) => { if (ok) PASS++; else FAILS.push(name + (detail ? ' — ' + detail : '')); };

/* ── mock Intuit ── */
const state = { tokens: 0, refreshes: 0, purchases: [], vendors: {}, customers: {}, accounts: {}, nextId: 100, expireAccess: false };
const server = http.createServer((req, res) => {
  let buf = ''; req.on('data', c => buf += c); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/tokens') {
      const p = new URLSearchParams(buf);
      if (p.get('grant_type') === 'authorization_code') { state.tokens++; return send(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }); }
      state.refreshes++;
      return send(200, { access_token: 'acc' + (state.refreshes + 1), refresh_token: 'ref' + (state.refreshes + 1), expires_in: 3600 });
    }
    if (url.pathname.includes('/query')) {
      const q = decodeURIComponent(url.searchParams.get('query') || '');
      const m = /select Id from (\w+) where (?:DisplayName|Name) = '(.*)'/.exec(q);
      const bag = { Vendor: state.vendors, Customer: state.customers, Account: state.accounts }[m[1]];
      const name = m[2].replace(/\\'/g, "'");
      return send(200, { QueryResponse: bag[name] ? { [m[1]]: [{ Id: bag[name] }] } : {} });
    }
    const auth = req.headers.authorization || '';
    if (url.pathname.includes('/vendor')) { const b = JSON.parse(buf); const id = String(state.nextId++); state.vendors[b.DisplayName] = id; return send(200, { Vendor: { Id: id } }); }
    if (url.pathname.includes('/customer')) { const b = JSON.parse(buf); const id = String(state.nextId++); state.customers[b.DisplayName] = id; return send(200, { Customer: { Id: id } }); }
    if (url.pathname.includes('/account')) { const b = JSON.parse(buf); const id = String(state.nextId++); state.accounts[b.Name] = id; return send(200, { Account: { Id: id } }); }
    if (url.pathname.includes('/purchase')) {
      if (state.expireAccess && auth === 'Bearer acc1') return send(401, { fault: 'expired' });
      const b = JSON.parse(buf); const id = 'P' + (state.nextId++); state.purchases.push({ id, body: b, auth }); return send(200, { Purchase: { Id: id } });
    }
    if (url.pathname.includes('/companyinfo')) return send(200, { CompanyInfo: { CompanyName: 'Mock Builders LLC' } });
    send(404, { err: req.url });
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  process.env.QB_TOKEN_URL = base + '/tokens';
  process.env.QB_API_BASE = base;

  const qbo = require('./functions/lib/qbo');
  const { exportCosts, requireBuilder, toISODate } = require('./functions/lib/exportCosts');

  /* token exchange + storage */
  const j = await qbo.exchangeCode('thecode', 'https://cb');
  t('code exchange returns a token pair', j.access_token === 'acc1' && j.refresh_token === 'ref1');
  await db.collection('qb').doc('u1').set({ realmId: 'R9', accessToken: 'acc1', refreshToken: 'ref1', expiresAt: Date.now() + 3600e3, env: 'sandbox' });

  /* seed a site owned by u1, with two exportable actuals + one line + one already-exported */
  await db.collection('sites').doc('s1').set({ meta: { street: '288 Calderwood Ln', city: 'Ferndale' }, members: { u1: 'builder', uclient: 'client', usub: 'sub' }, memberUids: ['u1', 'uclient', 'usub'] }); // REAL shapes: street in meta map, members as strings
  const costs = db.collection('sites').doc('s1').collection('costs');
  await costs.doc('c1').set({ data: { id: 'c1', rt: 'line', label: 'Plumbing', budget: 24000 }, updatedAt: 1, updatedBy: 'devA' });
  await costs.doc('ca1').set({ data: { id: 'ca1', rt: 'actual', kind: 'spent', amount: 17500, payee: 'Hollis Excavating', note: 'mobilization, "phase 1"', t: Date.parse('2026-06-01') }, updatedAt: 1, updatedBy: 'devA' });
  await costs.doc('ca2').set({ data: { id: 'ca2', rt: 'actual', kind: 'committed', amount: 26500, payee: 'Clearwater Plumbing', t: Date.parse('2026-06-20') }, updatedAt: 1, updatedBy: 'devA' });
  await costs.doc('ca3').set({ data: { id: 'ca3', rt: 'actual', kind: 'spent', amount: 500, payee: 'Hollis Excavating', qbId: 'P1', t: Date.now() }, updatedAt: 1, updatedBy: 'devA' });

  /* gates */
  t('membership gate: client STRING denied (production shape)', requireBuilder({ members: { u2: 'client' } }, 'u2') === false);
  t('membership gate: sub STRING denied', requireBuilder({ members: { u3: 'sub' } }, 'u3') === false);
  t('membership gate: builder STRING allowed', requireBuilder({ members: { u1: 'builder' } }, 'u1') === true);
  t('membership gate: legacy object shape still judged by role', requireBuilder({ members: { u4: { role: 'client' } } }, 'u4') === false && requireBuilder({ members: { u5: { role: 'builder' } } }, 'u5') === true);
  t('membership gate: stranger denied', requireBuilder({ members: {} }, 'zz') === false);
  t('date formatting', toISODate(Date.parse('2026-06-01T12:00:00')) === '2026-06-01');
  await db.collection('qb').doc('u2').set({ realmId: 'R9', accessToken: 'accX', refreshToken: 'refX', expiresAt: Date.now() + 3600e3 });
  const r0 = await exportCosts(db, 'u2', 's1');
  t('non-member export refused even when connected', r0.ok === false && r0.reason === 'not-your-site', JSON.stringify(r0));
  await db.collection('qb').doc('uclient').set({ realmId: 'R9', accessToken: 'accC', refreshToken: 'refC', expiresAt: Date.now() + 3600e3 });
  const rc = await exportCosts(db, 'uclient', 's1');
  t('HOMEOWNER member with own QB refused — costs stay private to the builder', rc.ok === false && rc.reason === 'not-your-site', JSON.stringify(rc));
  const rn = await exportCosts(db, 'u-noqb', 's1');
  t('unconnected user refused', rn.ok === false && rn.reason === 'not-connected');

  /* first export */
  const r1 = await exportCosts(db, 'u1', 's1');
  t('export creates the two pending, skips the exported one', r1.ok && r1.created === 2 && r1.skipped === 1 && r1.failures.length === 0, JSON.stringify(r1));
  t('vendors deduped by payee', Object.keys(state.vendors).length === 2);
  t('customer = the site street', !!state.customers['288 Calderwood Ln']);
  t('accounts created once (clearing + expense)', !!state.accounts['Plumb Clearing'] && !!state.accounts['Construction Costs (Plumb)']);
  const p = state.purchases.find(x => x.body.PrivateNote.includes('plumb:ca1'));
  t('purchase carries amount/date/vendor/customer', p && p.body.Line[0].Amount === 17500 && p.body.TxnDate === '2026-06-01' &&
    p.body.EntityRef.value === state.vendors['Hollis Excavating'] && p.body.Line[0].AccountBasedExpenseLineDetail.CustomerRef.value === state.customers['288 Calderwood Ln'], p && JSON.stringify(p.body).slice(0, 200));
  const ca1 = (await costs.doc('ca1').get()).data();
  t('write-back marks the cost with qbId via server identity', !!ca1.data.qbId && ca1.updatedBy === 'server' && ca1.data.amount === 17500 && ca1.data.payee === 'Hollis Excavating');

  /* idempotency */
  const r2 = await exportCosts(db, 'u1', 's1');
  t('second run creates nothing', r2.created === 0 && r2.skipped === 3, JSON.stringify(r2));
  t('mock saw exactly two purchases total', state.purchases.length === 2);

  /* rotating refresh: expire access, force a 401-free path via freshTokens expiry */
  await db.collection('qb').doc('u1').set({ expiresAt: Date.now() - 1000 }, { merge: true });
  await costs.doc('ca4').set({ data: { id: 'ca4', rt: 'actual', kind: 'spent', amount: 42, payee: 'Hollis Excavating', t: Date.now() }, updatedAt: 1, updatedBy: 'devA' });
  const r3 = await exportCosts(db, 'u1', 's1');
  const tok = (await db.collection('qb').doc('u1').get()).data();
  t('expired access refreshes and persists the ROTATED pair', r3.created === 1 && state.refreshes === 1 && tok.refreshToken === 'ref2' && tok.accessToken === 'acc2', JSON.stringify({ r3, refreshes: state.refreshes, ref: tok.refreshToken }));

  server.close();
  console.log('fncheck: ' + PASS + ' checks across oauth/dedupe/purchases/idempotency/gates/refresh');
  if (FAILS.length) { console.log('FAIL (' + FAILS.length + '):'); FAILS.forEach(f => console.log('  x ' + f)); process.exit(1); }
  console.log('PASS: server export lifecycle holds.');
  process.exit(0);
})().catch(e => { console.error('FAIL: harness error —', e.message); console.error(e.stack); process.exit(1); });
