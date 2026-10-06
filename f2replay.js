/* f2replay.js — F-2 app proof against the Firestore emulator (2.463.0).
 *
 * Boots the REAL app/index.html in jsdom and runs its own Sync code (pull,
 * dual-read, migration, projection, push) against the emulator, with the
 * repo's firestore.rules (R, live since #45). Nothing here re-implements the
 * app: phones are the app with Sync.db pointed at an emulator account.
 *
 *  1. Seed a house the OLD way (2.462.0): invoices in meta.invoices, money on
 *     sel records. Some of it already moved (inv/INV-001, selm/12) so absorb
 *     by id and "prefer selm" are exercised; one orphan selm with no sel.
 *  2. Homeowner opens first: dual-read shows everything; ZERO write attempts.
 *  3. Money-gated builder (owner) opens: the real migration runs.
 *  4. Replay gapcheck b1-b4 as the crew, plus inv/selm get/list: no money.
 *  5. Crew, homeowner, Money-only builder and no-money builder phones open:
 *     no refused reads, the right money on each, numbers unchanged.
 *  6. Builder opens again: no writes (idempotent). Builder deletes a
 *     selection: its selm goes with it.
 *
 * RUN (repo root):
 *   npx firebase emulators:exec --only firestore --project demo-plumb-rules 'node f2replay.js'
 * Evidence: $F2_PROOF_DIR (default ./f2-proof). Exit 0 = every check passed.
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { ({ JSDOM } = require(path.join(__dirname, 'app/node_modules/jsdom'))); }
const { applyClaimToSite } = require('./functions/lib/claimStamp.js');

const OUT = process.env.F2_PROOF_DIR || path.join(__dirname, 'f2-proof');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); };
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONEY = ['price', 'allowance', 'cost', 'costLineId', 'invoicedIn'];
const hasMoneyKey = d => MONEY.some(k => d && Object.prototype.hasOwnProperty.call(d, k));

const U = { builder: 'uid-builder-owner', client: 'uid-ana-homeowner', sub: 'uid-clearwater-crew', pm: 'uid-pat-pm', sup: 'uid-sam-super', stranger: 'uid-stranger' };
const SITE = 'h_linden5120';
const T0 = 1791100000000;

/* ---- the house as 2.462.0 wrote it ---- */
const INV1_OLD = { id: 'inv_k3m9q2x', no: 'INV-001', title: 'Selections \u2014 October', due: '2026-10-18',
  items: [{ label: 'Quartz \u2014 Calacatta look \u2014 Countertops \u00b7 Kitchen', amount: 1850, selId: 3 },
          { label: 'Marble hex \u2014 Tile \u00b7 Primary Bath', amount: 120, selId: 7 }],
  total: 1970, status: 'sent', t: T0 + 1e7, sentBy: 'Dean Walsh', payments: [] };
/* inv already holds INV-001 (moved by an F-2 phone) with a payment the stale meta copy lacks: inv wins */
const INV1_NEW = Object.assign({}, INV1_OLD, { payments: [{ id: 'pay1', amount: 500, date: '2026-10-04', note: 'Check 1043' }] });
const INV2 = { id: 'inv_p7w2d4n', no: 'INV-002', title: 'Extras \u2014 October', due: '2026-10-25',
  items: [{ label: 'Extra hose bib', amount: 240 }, { label: 'Pantry shelf credit', amount: -90, adj: true }],
  total: 150, status: 'sent', t: T0 + 2e7, sentBy: 'Dean Walsh', payments: [] };
const SELS = [
  { id: 3, room: 'Kitchen', cat: 'Countertops', item: 'Quartz \u2014 Calacatta look', status: 'selected', approved: true,
    signed: { date: '2026-10-02', by: ['Ana Ruiz'] }, price: 1850, invoicedIn: 'inv_k3m9q2x', spec: {}, specCustom: [] },
  { id: 7, room: 'Primary Bath', cat: 'Tile', item: 'Marble hex', status: 'selected', approved: true,
    signed: { date: '2026-10-03', by: ['Ana Ruiz'] }, allowance: 450, cost: 570, price: 120, costLineId: 'cl_tile', invoicedIn: 'inv_k3m9q2x',
    spec: { finish: 'Honed' }, specCustom: [] },
  /* sel/9: unpriced, as 2.462.0's saveSel writes it (empty money keys): the keys must still leave sel; no selm (lazy) */
  { id: 9, room: 'Laundry', cat: 'Appliances', item: 'Washer hookup', status: 'pending', approved: false, price: null, allowance: null, cost: null, costLineId: null, spec: {}, specCustom: [] },
  { id: 11, room: 'Primary Bath', cat: 'Plumbing Fixtures', item: 'Shower valve', status: 'selected', approved: false,
    allowance: 300, cost: 260, price: -40, costLineId: 'cl_plumb', spec: {}, specCustom: [] },
  { id: 12, room: 'Kitchen', cat: 'Lighting & Electrical', item: 'Pendant trio', status: 'selected', approved: true,
    signed: { date: '2026-10-01', by: ['Ana Ruiz'] }, price: 410, spec: {}, specCustom: [] },
];
/* selm/12 already exists (moved); an older phone put a stale price back on sel/12: selm wins */
const SELM12 = { id: 12, price: 410 };
const SEL12_STALE = Object.assign({}, SELS[4], { price: 999 });
const PMTS = [{ id: 'pm1', amount: 300, date: '2026-09-20', label: 'Deposit' }];

function stampedSite() {
  let site = { members: { [U.builder]: 'builder' }, meta: {} };
  const claim = (inv, uid, c) => { const r = applyClaimToSite(site, inv, uid, c); site = { members: r.members, meta: r.meta, memberUids: r.memberUids }; };
  claim({ code: 'HOME1', role: 'client', siteId: SITE }, U.client, { name: 'Ana Ruiz', email: 'ana@example.com' });
  claim({ code: 'CRW1', role: 'sub', siteId: SITE, trade: 'tile', name: 'Clearwater Tile' }, U.sub, { name: 'Mike Chen', email: 'mike@example.com' });
  claim({ code: 'TEAM1', role: 'team', siteId: SITE, rpRole: 'pm', gates: { field: 1, schedule: 1, selections: 1, site: 1, jobs: 1, moneyJob: 1, moneyCo: 0, people: 1 } }, U.pm, { name: 'Pat Lee', email: 'pat@example.com' });
  claim({ code: 'TEAM2', role: 'team', siteId: SITE, rpRole: 'superintendent', gates: { field: 1, schedule: 1, selections: 1, site: 1, jobs: 0, moneyJob: 0, moneyCo: 0, people: 0 } }, U.sup, { name: 'Sam Ortiz', email: 'sam@example.com' });
  return site;
}
const STAMP = stampedSite();
function oldMeta() {
  return { id: SITE, name: '5120 Linden Ridge Ct', street: '5120 Linden Ridge Ct', t: T0, phase: 'finish', allowanceCredit: true,
    stageDone: { site: true, foundation: true }, packetSignoff: {}, packetSpecAt: {}, packetStale: {},
    invoices: [INV1_OLD, INV2], members: STAMP.members, memberInfo: STAMP.meta.memberInfo, subs: [], docs: [] };
}
async function seedOld(env) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const S = db.collection('sites').doc(SITE);
    await S.set({ meta: oldMeta(), id: SITE, mode: 'live', updatedAt: T0, updatedBy: 'dev-old-phone', updatedByUid: U.builder, members: STAMP.members, memberUids: STAMP.memberUids });
    for (const s of SELS) await S.collection('sel').doc(String(s.id)).set({ data: s.id === 12 ? SEL12_STALE : s, updatedAt: T0, updatedBy: 'dev-old-phone' });
    await S.collection('inv').doc(INV1_NEW.id).set({ data: INV1_NEW, updatedAt: T0 + 3e7, updatedBy: 'dev-f2-phone' });
    await S.collection('selm').doc('12').set({ data: SELM12, updatedAt: T0 + 3e7, updatedBy: 'dev-f2-phone' });
    await S.collection('selm').doc('99').set({ data: { id: 99, price: 75 }, updatedAt: Date.now() - 10 * 60000, updatedBy: 'dev-f2-phone' });
    for (const x of PMTS) await S.collection('pmts').doc(x.id).set({ data: x, updatedAt: T0, updatedBy: 'dev-old-phone' });
    await S.collection('costs').doc('cl_tile').set({ data: { id: 'cl_tile', rt: 'line', label: 'Tile', budget: 9000, stage: 'finish' }, updatedAt: T0, updatedBy: 'dev-old-phone' });
    await S.collection('items').doc('1').set({ data: { id: 1, cap: 'Tile layout marked', t: T0, by: 'Dean Walsh' }, updatedAt: T0, updatedBy: 'dev-old-phone' });
  });
}
async function serverDump(env) {
  const out = {};
  await env.withSecurityRulesDisabled(async ctx => {
    const S = ctx.firestore().collection('sites').doc(SITE);
    const d = (await S.get()).data(); out.meta = d.meta; out.updatedBy = d.updatedBy;
    for (const c of ['sel', 'selm', 'inv', 'pmts', 'costs', 'items']) {
      const q = await S.collection(c).get(); out[c] = {}; q.docs.forEach(x => { out[c][x.id] = x.data().data; });
    }
  });
  return out;
}

/* ---- an emulator account handed to the app's Sync (records every write) ---- */
function adapt(db, who, W) {
  const toNode = v => {
    if (v == null || typeof v !== 'object') return v;
    if (v instanceof firebase.firestore.FieldValue) return v;
    if (v && v.constructor && /FieldValue/.test(v.constructor.name)) return v;
    if (Array.isArray(v)) return Array.prototype.map.call(v, toNode);
    const o = {}; Object.keys(v).forEach(k => { o[k] = toNode(v[k]); }); return o;
  };
  const show = v => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && x.constructor && /FieldValue/.test(x.constructor.name)) ? '<deleteField>' : x));
  const rec = (op, p, data, opts, prom) => {
    const e = { who, op, path: p, data: data === undefined ? undefined : show(data), merge: !!(opts && opts.merge), ok: null };
    W.push(e); W.inflight = (W.inflight || 0) + 1; W.last = Date.now();
    return prom.then(r => { e.ok = true; W.inflight--; W.last = Date.now(); return r; },
      err => { e.ok = false; e.err = String(err && (err.code || err.message)).slice(0, 120); W.inflight--; W.last = Date.now(); throw err; });
  };
  const wDoc = (ref, p) => ({ id: ref.id,
    set: (d, o) => rec('set', p, d, o, o ? ref.set(toNode(d), o) : ref.set(toNode(d))),
    update: d => rec('update', p, d, null, ref.update(toNode(d))),
    delete: () => rec('delete', p, undefined, null, ref.delete()),
    get: () => ref.get(),
    onSnapshot: (...a) => ref.onSnapshot(...a),
    collection: n => wColl(ref.collection(n), p + '/' + n) });
  /* a refused listener is recorded with its path */
  const snapErr = (p, a) => { const i = a.length - 1; if (typeof a[i] === 'function' && typeof a[i - 1] === 'function') { const f = a[i]; a = a.slice(); a[i] = e => { (W.denied || (W.denied = [])).push(p + ' ' + String(e && e.code)); return f(e); }; } return a; };
  const wQuery = (q, p) => ({ where: (...a) => wQuery(q.where(...a), p), onSnapshot: (...a) => q.onSnapshot(...snapErr(p, a)), get: () => q.get() });
  const wColl = (c, p) => Object.assign(wQuery(c, p), { doc: id => wDoc(c.doc(String(id)), p + '/' + id) });
  return { collection: n => wColl(db.collection(n), n) };
}

const SRC = fs.readFileSync(path.join(__dirname, 'app/index.html'), 'utf8').replace('</body>', '<script>window.$eval=c=>eval(c);</script></body>');
async function phone(env, opt) {
  const W = []; W.inflight = 0; W.last = Date.now();
  const dom = new JSDOM(opt.src || SRC, { runScripts: 'dangerously', url: 'https://sim.test/', pretendToBeVisual: true,
    beforeParse(w) {
      w.indexedDB = { open: () => ({}) };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.navigator.serviceWorker = { register: () => Promise.resolve({}), getRegistration: () => Promise.resolve(null), addEventListener() {} };
      w.scrollTo = () => {}; w.__thrown = [];
      w.addEventListener('error', e => { w.__thrown.push(String(e.message || e.error)); });
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.localStorage.setItem('plumb.mode', 'real');
      if (opt.localStorage) Object.keys(opt.localStorage).forEach(k => w.localStorage.setItem(k, opt.localStorage[k]));
    } });
  await sleep(900);
  const w = dom.window; const $ = c => w.$eval(c);
  const db = env.authenticatedContext(opt.uid).firestore();
  w.__db = adapt(db, opt.who, W);
  w.firebase = { apps: [1], firestore: { FieldValue: firebase.firestore.FieldValue },
    auth: () => ({ currentUser: { uid: opt.uid, isAnonymous: false }, onAuthStateChanged() { return () => {}; } }) };
  $("clearTimeout(Sync._retryT);Sync.init=function(){return Promise.resolve(false);};Sync.startHeartbeat=function(){};true");
  $(`localStorage.removeItem('plumb.errors');state.session=${JSON.stringify(opt.session)};state.projects=${JSON.stringify(opt.local || [])};state.activeId=${JSON.stringify(opt.local && opt.local[0] ? opt.local[0].id : null)};
     Object.assign(Sync,{db:window.__db,on:true,mode:'live',uid:${JSON.stringify(opt.uid)},authKind:'account',deviceId:${JSON.stringify(opt.deviceId)},_held:{},_gateDelays:[0,300,900],_permToasted:false,_selNoteMs:50});
     ${opt.base ? "localStorage.setItem(Sync._baseKey(),JSON.stringify(" + JSON.stringify(opt.base) + "));" : ''}Sync._loadBase();true`);
  $("Sync.subscribe();Sync.pushAll();true");
  /* settle: everything pulled, no write in flight, quiet for 2.5 s */
  const t0 = Date.now();
  for (;;) {
    await sleep(250);
    const pulled = $(`(function(){var p=state.projects.find(x=>String(x.id)==='${SITE}');if(!p||!Sync._sitesPulled)return false;var g=Sync._pulled['${SITE}']||{};return syncCollsFor(siteRoleFor(p)).every(c=>g[c.sub]);})()`);
    if (pulled && W.inflight === 0 && Date.now() - W.last > 2500 && Date.now() - t0 > 3000) break;
    if (Date.now() - t0 > 40000) { log('settle timeout for ' + opt.who); break; }
  }
  const proj = () => JSON.parse($(`JSON.stringify(state.projects.find(x=>String(x.id)==='${SITE}')||null)`));
  const errs = () => JSON.parse($("JSON.stringify(devErrors())"));
  const close = () => { try { $("Sync.disconnect();true"); } catch (e) {} try { w.close(); } catch (e) {} };
  return { w, $, W, proj, errs, close };
}
const refused = W => W.filter(e => e.ok === false);
const nums = (s) => (String(s).match(/[-\u2212]?\$[\d,]+(\.\d+)?/g) || []);
/* the money a phone shows, through the app's own single source of billing truth */
function moneyOf(ph, role) {
  return JSON.parse(ph.$(`(function(){var p=state.projects.find(x=>String(x.id)==='${SITE}');if(!p)return 'null';
    var b=billingSummary(p);var sel=(p.selections||[]).map(function(s){return [s.id,selMoney(s.price),s.allowance==null?null:s.allowance,s.cost==null?null:s.cost,chargeState(selCharge(s,p)).state];});
    var inv=(p.invoices||[]).map(function(v){return [v.no,v.total,invPaidAmt(v),v.status];}).sort();
    var out={billing:b,sels:sel.sort(function(a,b){return a[0]-b[0];}),invoices:inv};
    ${role === 'client' ? "try{var c=clientCostsHTML(p);out.clientLine=c.line;out.clientNums=(c.ledger+c.invoices).match(/[-\\u2212+]?\\$[\\d,]+/g);}catch(e){out.clientErr=String(e);}" : ''}
    return JSON.stringify(out);})()`));
}

(async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-plumb-rules',
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync(path.join(__dirname, process.env.RULES_FILE || 'firestore.rules'), 'utf8') } });

  /* ---- truth: the 2.462.0 house fully in memory (every money field where 2.462 had it) ---- */
  /* truth runs on the 2.462.0 app (F2_OLD_INDEX), or this one if not given */
  const SRC_OLD = process.env.F2_OLD_INDEX ? fs.readFileSync(process.env.F2_OLD_INDEX, 'utf8').replace('</body>', '<script>window.$eval=c=>eval(c);</script></body>') : SRC;
  log('truth app: ' + (process.env.F2_OLD_INDEX ? process.env.F2_OLD_INDEX : 'this app'));
  const truthPh = await (async () => {
    const dom = new JSDOM(SRC_OLD, { runScripts: 'dangerously', url: 'https://sim.test/', pretendToBeVisual: true,
      beforeParse(w) { w.indexedDB = { open: () => ({}) }; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.navigator.serviceWorker = { register: () => Promise.resolve({}), getRegistration: () => Promise.resolve(null), addEventListener() {} }; w.scrollTo = () => {}; } });
    await sleep(900);
    const p = Object.assign(oldMeta(), { invoices: [INV1_NEW, INV2], selections: SELS.map(s => s.id === 12 ? Object.assign({}, s, SELM12) : s), payments: PMTS, items: [], bookings: [], logs: [], mailReview: [], costs: [] });
    dom.window.$eval(`state.projects=[${JSON.stringify(p)}];state.activeId='${SITE}';state.session={role:'client',site:'${SITE}'};true`);
    return { $: c => dom.window.$eval(c), close: () => dom.window.close() };
  })();
  const TRUTH = moneyOf(truthPh, 'client'); truthPh.close();
  log('TRUTH (2.462.0 placement, in memory):', TRUTH);

  /* ================= 1. seed the old way ================= */
  await seedOld(env);
  const before = await serverDump(env);
  fs.writeFileSync(path.join(OUT, 'server-0-seeded-old-way.json'), JSON.stringify(before, null, 2));
  check('seed: meta.invoices holds INV-001 and INV-002 (old way)', (before.meta.invoices || []).map(v => v.no).join() === 'INV-001,INV-002');
  check('seed: sel/7 carries money (old way)', hasMoneyKey(before.sel['7']), before.sel['7']);

  /* ================= 2. homeowner opens first ================= */
  const ho = await phone(env, { who: 'homeowner', uid: U.client, deviceId: 'dev-ho', session: { role: 'client', site: SITE, name: 'Ana Ruiz', auth: { uid: U.client } } });
  check('homeowner-first: zero write attempts (no refused writes, nothing queued)', ho.W.length === 0, ho.W);
  check('homeowner-first: no refused reads', !ho.errs().some(e => /Cloud read blocked/.test(e.m)), ho.errs());
  check('homeowner-first: nothing held to push later', ho.$("Object.keys(Sync._held).length") === 0);
  check('homeowner-first: next push would write nothing', ho.$(`diffSiteOps(Sync._shadow['${SITE}'],state.projects.find(x=>String(x.id)==='${SITE}')).length`) === 0,
    JSON.parse(ho.$(`JSON.stringify(diffSiteOps(Sync._shadow['${SITE}'],state.projects.find(x=>String(x.id)==='${SITE}')))`)));
  const hoBefore = moneyOf(ho, 'client');
  check('homeowner-first: dual-read shows the same money as 2.462.0 (union by id, selm preferred)', JSON.stringify(hoBefore) === JSON.stringify(TRUTH), { got: hoBefore, want: TRUTH });
  ho.close();
  const afterHo = await serverDump(env);
  check('homeowner-first: server unchanged', JSON.stringify(afterHo) === JSON.stringify(before));

  /* the same superintendent on 2.462.0 against the same old house: which listeners did the rules refuse then? */
  if (process.env.F2_OLD_INDEX) {
    const old = await phone(env, { src: SRC_OLD, who: 'super-2.462', uid: U.sup, deviceId: 'dev-sup-old', session: { role: 'builder', name: 'Sam Ortiz', member: true, rpRole: 'superintendent', gates: { field: 1, schedule: 1, selections: 1, site: 1, jobs: 0, moneyJob: 0, moneyCo: 0, people: 0 }, auth: { uid: U.sup } } });
    log('2.462.0 superintendent refused listeners (baseline):', old.W.denied || []);
    const op = old.proj();
    log('2.462.0 superintendent phone held invoices:', (op && op.invoices || []).map(v => v.no), 'sel money on sel/7:', op && op.selections && op.selections.find(x => x.id === 7));
    old.close();
    await seedOld(env);
  }
  /* ================= 3. money-gated builder migrates ================= */
  const bu = await phone(env, { who: 'builder', uid: U.builder, deviceId: 'dev-bu', session: { role: 'builder', name: 'Dean Walsh', auth: { uid: U.builder } } });
  fs.writeFileSync(path.join(OUT, 'writes-builder-migration.json'), JSON.stringify(bu.W, null, 2));
  check('builder: migration writes all accepted (no refused write)', refused(bu.W).length === 0, refused(bu.W));
  { const ps = bu.W.filter(e => !/^sites\/[^/]+$/.test(e.path)).map(e => e.op + ' ' + e.path); const dup = ps.filter((x, i) => ps.indexOf(x) !== i);
    check('builder: each record written once (one push per house at a time)', dup.length === 0, { writes: bu.W.length, dup }); }
  check('builder: no refused reads', !bu.errs().some(e => /Cloud read blocked|refused/.test(e.m)), bu.errs());
  const selW = bu.W.filter(e => /\/sel\//.test(e.path) && e.op === 'set');
  check('builder: every sel write explicitly deletes the five money keys (correction 2)', selW.length > 0 && selW.every(e => MONEY.every(k => e.data.data[k] === '<deleteField>')), selW.map(e => [e.path, e.data.data]));
  const selmW = bu.W.filter(e => /\/selm\//.test(e.path) && e.op === 'set');
  check('builder: every selm write carries only id + money keys (correction 5)', selmW.length > 0 && selmW.every(e => Object.keys(e.data.data).every(k => k === 'id' || MONEY.includes(k))), selmW.map(e => [e.path, e.data.data]));
  const order = bu.W.map(e => e.op + ' ' + e.path);
  const i7m = order.indexOf('set sites/' + SITE + '/selm/7'), i7s = order.indexOf('set sites/' + SITE + '/sel/7');
  check('builder: money lands in selm/7 before sel/7 drops it', i7m >= 0 && i7s > i7m, order);
  const mid = await serverDump(env);
  fs.writeFileSync(path.join(OUT, 'server-1-after-builder-migration.json'), JSON.stringify(mid, null, 2));
  check('absorb-by-id: inv holds INV-001 and INV-002', Object.values(mid.inv).map(v => v.no).sort().join() === 'INV-001,INV-002', Object.keys(mid.inv));
  check('absorb-by-id: INV-001 already in inv kept the inv copy (its payment), not the stale meta copy', (mid.inv[INV1_NEW.id].payments || []).length === 1);
  check('absorb-by-id: meta.invoices cleared', Array.isArray(mid.meta.invoices) && mid.meta.invoices.length === 0, mid.meta.invoices);
  check('migration: no sel record carries a money key', Object.values(mid.sel).every(d => !hasMoneyKey(d)), mid.sel);
  check('migration: selm/3, selm/7, selm/11, selm/12 exist; none for sel/9 (lazy: no money, no doc)', ['3', '7', '11', '12'].every(k => mid.selm[k]) && !mid.selm['9'], Object.keys(mid.selm));
  check('migration: selm/7 = {id,price,allowance,cost,costLineId,invoicedIn} exactly', JSON.stringify(mid.selm['7']) === JSON.stringify({ id: 7, price: 120, allowance: 450, cost: 570, costLineId: 'cl_tile', invoicedIn: 'inv_k3m9q2x' }), mid.selm['7']);
  check('migration: selm/12 kept the selm price (410), not the stale sel price (999)', mid.selm['12'] && mid.selm['12'].price === 410, mid.selm['12']);
  check('orphan: selm/99 (no sel/99) deleted', !mid.selm['99']);
  check('orphan: no selm without a sel', Object.keys(mid.selm).every(k => mid.sel[k]), Object.keys(mid.selm));
  check('builder: same money on screen as 2.462.0 after migrating', JSON.stringify(moneyOf(bu, 'builder')) === JSON.stringify(Object.assign({}, TRUTH, { clientLine: undefined, clientNums: undefined })) || (function () { const a = moneyOf(bu, 'builder'); return JSON.stringify(a.billing) === JSON.stringify(TRUTH.billing) && JSON.stringify(a.sels) === JSON.stringify(TRUTH.sels) && JSON.stringify(a.invoices) === JSON.stringify(TRUTH.invoices); })(), moneyOf(bu, 'builder'));
  bu.close();

  /* ================= 4. crew replay b1-b4 + inv/selm ================= */
  const crew = env.authenticatedContext(U.sub).firestore();
  const attempt = async (label, fn) => { try { const r = await fn(); log('ALLOWED  ' + label); return { ok: true, r }; } catch (e) { log('DENIED   ' + label + '  (' + String(e && e.code) + ')'); return { ok: false, e }; } };
  const S = crew.collection('sites').doc(SITE);
  const b1 = await attempt('b1 crew: get sites/' + SITE, () => S.get());
  check('b1 crew get house: allowed, and no invoices inside', b1.ok && !((b1.r.data().meta.invoices || []).length), b1.ok ? b1.r.data().meta.invoices : null);
  const b2 = await attempt('b2 crew: memberships query', () => crew.collection('sites').where('memberUids', 'array-contains', U.sub).get());
  check('b2 crew memberships query: no invoices on any house', b2.ok && b2.r.docs.every(d => !((d.data().meta.invoices || []).length)));
  const b3 = await attempt('b3 crew: get sel/7', () => S.collection('sel').doc('7').get());
  check('b3 crew get sel/7: allowed, NO money keys', b3.ok && !hasMoneyKey(b3.r.data().data), b3.ok ? b3.r.data().data : null);
  const b4 = await attempt('b4 crew: list sel', () => S.collection('sel').get());
  check('b4 crew list sel: allowed, NO money keys on any record', b4.ok && b4.r.size === SELS.length && b4.r.docs.every(d => !hasMoneyKey(d.data().data)), b4.ok ? b4.r.docs.map(d => d.data().data) : null);
  const g1 = await attempt('crew: get inv/' + INV2.id, () => S.collection('inv').doc(INV2.id).get());
  check('crew get inv: DENIED', !g1.ok);
  const g2 = await attempt('crew: list inv', () => S.collection('inv').get());
  check('crew list inv: DENIED', !g2.ok);
  const g3 = await attempt('crew: get selm/7', () => S.collection('selm').doc('7').get());
  check('crew get selm: DENIED', !g3.ok);
  const g4 = await attempt('crew: list selm', () => S.collection('selm').get());
  check('crew list selm: DENIED', !g4.ok);

  /* ================= 5. other phones open the migrated house ================= */
  const cr = await phone(env, { who: 'crew', uid: U.sub, deviceId: 'dev-crew', session: { role: 'subs', name: 'Clearwater Tile', auth: { uid: U.sub } } });
  const crp = cr.proj();
  check('crew phone: listens to no inv/selm', JSON.stringify(cr.$(`syncCollsFor(siteRoleFor(state.projects.find(x=>String(x.id)==='${SITE}'))).map(c=>c.sub).join()`)) === JSON.stringify('items,bk,sel,logs'));
  check('crew phone: no refused reads', !cr.errs().some(e => /Cloud read blocked/.test(e.m)), cr.errs());
  check('crew phone: zero write attempts', cr.W.length === 0, cr.W);
  check('crew phone: holds no invoices and no selection money', crp && (crp.invoices || []).length === 0 && (crp.selections || []).length === SELS.length && crp.selections.every(s => !hasMoneyKey(s)), crp && { inv: crp.invoices, sels: crp.selections });
  cr.close();

  const ho2 = await phone(env, { who: 'homeowner', uid: U.client, deviceId: 'dev-ho', session: { role: 'client', site: SITE, name: 'Ana Ruiz', auth: { uid: U.client } } });
  const hoAfter = moneyOf(ho2, 'client');
  check('homeowner after migration: same money as 2.462.0 (from inv + selm)', JSON.stringify(hoAfter) === JSON.stringify(TRUTH), { got: hoAfter, want: TRUTH });
  check('homeowner after migration: zero write attempts, no refused reads', ho2.W.length === 0 && !ho2.errs().some(e => /Cloud read blocked/.test(e.m)), { W: ho2.W, errs: ho2.errs() });
  fs.writeFileSync(path.join(OUT, 'homeowner-money-before-after.json'), JSON.stringify({ truth: TRUTH, homeownerFirstOpen: hoBefore, homeownerAfterMigration: hoAfter }, null, 2));
  ho2.close();

  const pmGates = { field: 1, schedule: 1, selections: 1, site: 1, jobs: 1, moneyJob: 1, moneyCo: 0, people: 1 };
  const pm = await phone(env, { who: 'pm', uid: U.pm, deviceId: 'dev-pm', session: { role: 'builder', name: 'Pat Lee', member: true, rpRole: 'pm', gates: pmGates, auth: { uid: U.pm } } });
  const pmp = pm.proj();
  check('Money-only builder: listens to selm and costs, not inv', pm.$(`syncCollsFor(siteRoleFor(state.projects.find(x=>String(x.id)==='${SITE}'))).map(c=>c.sub).join()`) === 'items,bk,sel,logs,pmts,mail,costs,selm');
  check('Money-only builder: no refused reads, zero writes', !pm.errs().some(e => /Cloud read blocked/.test(e.m)) && pm.W.length === 0, { errs: pm.errs(), W: pm.W });
  check('Money-only builder: holds selection money, no invoices', pmp && (pmp.invoices || []).length === 0 && pmp.selections.find(s => s.id === 7).allowance === 450);
  const pmLine = pm.$(`houseMoneyLine(state.projects.find(x=>String(x.id)==='${SITE}'))`);
  check('Money-only builder: house Money line hides invoice numbers (no Paid $0 / owed)', !/Paid|owed/.test(pmLine), pmLine);
  pm.$(`state.activeId='${SITE}';true`);
  const pmTot = pm.$(`moneyTotHTML(P())`), pmBill = pm.$(`moneyBillHTML(P())`), pmCard = pm.$(`billingCardHTML(P())`);
  check('Money-only builder: Money screen shows no homeowner invoice rows and no $0 invoiced/paid', !/invoiced|Homeowner/.test(pmTot) && !/bgt-grp">Invoices/.test(pmBill) && pmCard === '', { pmTot, pmBill, pmCard });
  pm.close();

  const supGates = { field: 1, schedule: 1, selections: 1, site: 1, jobs: 0, moneyJob: 0, moneyCo: 0, people: 0 };
  const su = await phone(env, { who: 'super', uid: U.sup, deviceId: 'dev-sup', session: { role: 'builder', name: 'Sam Ortiz', member: true, rpRole: 'superintendent', gates: supGates, auth: { uid: U.sup } } });
  const sup = su.proj();
  check('no-money builder: listens to no inv/selm/costs', su.$(`syncCollsFor(siteRoleFor(state.projects.find(x=>String(x.id)==='${SITE}'))).map(c=>c.sub).join()`) === 'items,bk,sel,logs,pmts,mail');
  check('no-money builder: zero writes; no refused listener on inv/selm/costs (only mail, refused in 2.462.0 too)', su.W.length === 0 && (su.W.denied || []).every(x => /\/mail /.test(x)), { denied: su.W.denied, W: su.W });
  check('no-money builder: holds no invoices and no selection money', sup && (sup.invoices || []).length === 0 && sup.selections.every(s => !hasMoneyKey(s)));
  su.close();

  /* ================= 6. idempotent re-open, then delete a selection ================= */
  const bu2 = await phone(env, { who: 'builder', uid: U.builder, deviceId: 'dev-bu2', session: { role: 'builder', name: 'Dean Walsh', auth: { uid: U.builder } } });
  check('idempotent: a second money-gated builder phone opening the migrated house writes nothing', bu2.W.length === 0, bu2.W);
  bu2.$(`state.activeId='${SITE}';Data.removeSelection(11);true`);
  for (let i = 0; i < 40 && !(bu2.W.length && bu2.W.inflight === 0 && Date.now() - bu2.W.last > 1500); i++) await sleep(200);
  const end = await serverDump(env);
  check('orphan: deleting sel 11 deleted selm/11 (and sel/11)', !end.selm['11'] && !end.sel['11'], bu2.W.map(e => e.op + ' ' + e.path + ' ' + e.ok));
  check('orphan: still no selm without a sel', Object.keys(end.selm).every(k => end.sel[k]), Object.keys(end.selm));
  const dOrder = bu2.W.map(e => e.op + ' ' + e.path);
  check('orphan: selm/11 deleted before sel/11', dOrder.indexOf('delete sites/' + SITE + '/selm/11') >= 0 && dOrder.indexOf('delete sites/' + SITE + '/selm/11') < dOrder.indexOf('delete sites/' + SITE + '/sel/11'), dOrder);
  bu2.close();
  fs.writeFileSync(path.join(OUT, 'server-2-end.json'), JSON.stringify(end, null, 2));

  /* ================= 7. the builder's OWN 2.462.0 phone (it wrote every record: updatedBy = this phone) ================= */
  if (process.env.F2_OLD_INDEX) {
    const OWN = 'dev-bu-own';
    const meta = oldMeta();
    const sels = SELS.map(x => x.id === 12 ? Object.assign({}, x, SELM12) : x);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const S2 = ctx.firestore().collection('sites').doc(SITE);
      await S2.set({ meta: Object.assign({}, meta, { invoices: [INV1_NEW, INV2] }), id: SITE, mode: 'live', updatedAt: T0, updatedBy: OWN, updatedByUid: U.builder, members: STAMP.members, memberUids: STAMP.memberUids });
      for (const x of sels) await S2.collection('sel').doc(String(x.id)).set({ data: x, updatedAt: T0, updatedBy: OWN });
      for (const x of PMTS) await S2.collection('pmts').doc(x.id).set({ data: x, updatedAt: T0, updatedBy: OWN });
    });
    /* the phone's own copy and its 2.462.0 sync base, hashed by the 2.462.0 app itself */
    const local = Object.assign({}, meta, { invoices: [INV1_NEW, INV2], selections: sels, payments: PMTS, items: [], bookings: [], logs: [], mailReview: [], costs: [] });
    const od = new JSDOM(SRC_OLD, { runScripts: 'dangerously', url: 'https://sim.test/', pretendToBeVisual: true,
      beforeParse(w) { w.indexedDB = { open: () => ({}) }; w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        w.navigator.serviceWorker = { register: () => Promise.resolve({}), getRegistration: () => Promise.resolve(null), addEventListener() {} }; w.scrollTo = () => {}; } });
    await sleep(900);
    const base = JSON.parse(od.window.$eval(`(function(){var p=${JSON.stringify(local)};var m=metaOf(p);var sh={meta:_syncHash(JSON.stringify(m)),mk:{},mem:${JSON.stringify(STAMP.members)},colls:{sel:{},pmts:{}}};
      Object.keys(m).forEach(function(k){sh.mk[k]=_syncHash(JSON.stringify(m[k]));});
      p.selections.forEach(function(r){sh.colls.sel[String(r.id)]=_syncHash(JSON.stringify(r));});p.payments.forEach(function(r){sh.colls.pmts[String(r.id)]=_syncHash(JSON.stringify(r));});
      var o={};o['${SITE}']=sh;return JSON.stringify(o);})()`));
    od.window.close();
    const own = await phone(env, { who: 'builder-own-phone', uid: U.builder, deviceId: OWN, local: [local], base, session: { role: 'builder', name: 'Dean Walsh', auth: { uid: U.builder } } });
    fs.writeFileSync(path.join(OUT, 'writes-builder-own-phone-migration.json'), JSON.stringify(own.W, null, 2));
    const o = await serverDump(env);
    fs.writeFileSync(path.join(OUT, 'server-3-own-phone-migration.json'), JSON.stringify(o, null, 2));
    { const ps = own.W.filter(e => !/^sites\/[^/]+$/.test(e.path)).map(e => e.op + ' ' + e.path); const dup = ps.filter((x, i) => ps.indexOf(x) !== i);
      check('own 2.462.0 phone: each record written once (one push per house at a time)', dup.length === 0, { writes: own.W.length, dup }); }
    check('own 2.462.0 phone: migration writes all accepted', own.W.length > 0 && refused(own.W).length === 0, own.W.map(e => e.op + ' ' + e.path + ' ' + e.ok));
    check('own 2.462.0 phone: inv holds both invoices, meta.invoices cleared', Object.values(o.inv).map(v => v.no).sort().join() === 'INV-001,INV-002' && Array.isArray(o.meta.invoices) && o.meta.invoices.length === 0, { inv: Object.keys(o.inv), meta: o.meta.invoices });
    check('own 2.462.0 phone: no sel record carries money; selm for every priced selection', Object.values(o.sel).every(d => !hasMoneyKey(d)) && ['3', '7', '11', '12'].every(k => o.selm[k]) && !o.selm['9'], Object.keys(o.selm));
    check('own 2.462.0 phone: same money on screen as 2.462.0', (function () { const a = moneyOf(own, 'builder'); return JSON.stringify(a.billing) === JSON.stringify(TRUTH.billing) && JSON.stringify(a.sels) === JSON.stringify(TRUTH.sels) && JSON.stringify(a.invoices) === JSON.stringify(TRUTH.invoices); })(), moneyOf(own, 'builder'));
    own.close();
    const crew2 = env.authenticatedContext(U.sub).firestore().collection('sites').doc(SITE);
    const r3 = await crew2.collection('sel').doc('7').get(), r4 = await crew2.collection('sel').get(), r1 = await crew2.get();
    check('own-phone replay b1/b3/b4: crew house has no invoices; crew sel get/list has no money keys', !(r1.data().meta.invoices || []).length && !hasMoneyKey(r3.data().data) && r4.docs.every(d => !hasMoneyKey(d.data().data)));
  }

  await env.cleanup();
  const failed = results.filter(r => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'f2replay.log'), LOG.join('\n') + '\n');
  log(`\nf2replay: ${results.length - failed.length}/${results.length} checks passed` + (failed.length ? ' — FAIL' : ' — PASS'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
