/* f1replay.js — F-1 app proof against the Firestore emulator (2.464.0).
 *
 * Boots the REAL app/index.html in jsdom and runs its own code against the
 * emulator with the repo's firestore.rules (R2, live since run 37603319702,
 * MATCH). The harness (adapt/phone) is f2replay.js's, unchanged.
 *
 *  1. A migrated house (2.463.0 way): invoices in inv, meta.invoices = [].
 *  2. Homeowner opens: zero writes. Taps Approve this invoice on INV-001:
 *     one merged write to inv/{id} (data.status + data.approvedAt), accepted;
 *     the server record is approved + integer approvedAt, every other field
 *     unchanged; zero writes to the house doc or meta.invoices.
 *  3. The builder's phone then sees INV-001 approved; opening writes nothing.
 *  4. The same tap on the LIVE 2.463.0 app (meta.invoices write) is refused
 *     by these rules and rolls back (why F-1 is needed).
 *  5. An invoice only in legacy meta.invoices (house not yet migrated) is
 *     refused cleanly: nothing changes, nothing queued, no house write.
 *
 * RUN (repo root):
 *   F1_OLD_INDEX=<2.463.0 index.html> npx firebase emulators:exec --only firestore --project demo-plumb-rules 'node f1replay.js'
 * Evidence: $F1_PROOF_DIR (default ./f1-proof). Exit 0 = every check passed.
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) { ({ JSDOM } = require(path.join(__dirname, 'app/node_modules/jsdom'))); }
const { applyClaimToSite } = require('./functions/lib/claimStamp.js');

const OUT = process.env.F1_PROOF_DIR || path.join(__dirname, 'f1-proof');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); LOG.push(s); console.log(s); };
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : '')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const U = { builder: 'uid-builder-owner', client: 'uid-ana-homeowner', sub: 'uid-clearwater-crew' };
const SITE = 'h_linden5120';
const T0 = 1791100000000;
const INV1 = { id: 'inv_k3m9q2x', no: 'INV-001', title: 'Selections \u2014 October', due: '2026-10-18',
  items: [{ label: 'Quartz \u2014 Calacatta look \u2014 Countertops \u00b7 Kitchen', amount: 1850, selId: 3 },
          { label: 'Marble hex \u2014 Tile \u00b7 Primary Bath', amount: 120, selId: 7 }],
  total: 1970, status: 'sent', t: T0 + 1e7, sentBy: 'Dean Walsh', payments: [] };
const INV2 = { id: 'inv_p7w2d4n', no: 'INV-002', title: 'Extras \u2014 October', due: '2026-10-25',
  items: [{ label: 'Extra hose bib', amount: 240 }, { label: 'Pantry shelf credit', amount: -90, adj: true }],
  total: 150, status: 'sent', t: T0 + 2e7, sentBy: 'Dean Walsh', payments: [] };
const INV3 = { id: 'inv_d9r4t1a', no: 'INV-003', title: 'Draft \u2014 finals', due: '2026-11-01',
  items: [{ label: 'French doors', amount: 900 }], total: 900, status: 'draft', t: T0 + 3e7, sentBy: 'Dean Walsh', payments: [] };
const LEG = { id: 'inv_legacy9', no: 'INV-009', title: 'Legacy \u2014 only on the house doc', due: '2026-10-30',
  items: [{ label: 'Hose bib', amount: 80 }], total: 80, status: 'sent', t: T0 + 4e7, sentBy: 'Dean Walsh', payments: [] };
const SELS = [{ id: 3, room: 'Kitchen', cat: 'Countertops', item: 'Quartz \u2014 Calacatta look', status: 'selected', approved: true, spec: {}, specCustom: [] },
              { id: 7, room: 'Primary Bath', cat: 'Tile', item: 'Marble hex', status: 'selected', approved: true, spec: {}, specCustom: [] }];
const SELM = [{ id: 3, price: 1850, invoicedIn: 'inv_k3m9q2x' }, { id: 7, allowance: 450, cost: 570, price: 120, costLineId: 'cl_tile', invoicedIn: 'inv_k3m9q2x' }];

function stampedSite() {
  let site = { members: { [U.builder]: 'builder' }, meta: {} };
  const claim = (inv, uid, c) => { const r = applyClaimToSite(site, inv, uid, c); site = { members: r.members, meta: r.meta, memberUids: r.memberUids }; };
  claim({ code: 'HOME1', role: 'client', siteId: SITE }, U.client, { name: 'Ana Ruiz', email: 'ana@example.com' });
  claim({ code: 'CRW1', role: 'sub', siteId: SITE, trade: 'tile', name: 'Clearwater Tile' }, U.sub, { name: 'Mike Chen', email: 'mike@example.com' });
  return site;
}
const STAMP = stampedSite();
function meta(invoices) {
  return { id: SITE, name: '5120 Linden Ridge Ct', street: '5120 Linden Ridge Ct', t: T0, phase: 'finish', allowanceCredit: true,
    stageDone: { site: true, foundation: true }, packetSignoff: {}, packetSpecAt: {}, packetStale: {},
    invoices, members: STAMP.members, memberInfo: STAMP.meta.memberInfo, subs: [], docs: [] };
}
/* migrated: inv holds the invoices, meta.invoices = []; legacy: one more invoice only in meta.invoices */
async function seed(env, legacy) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const S = ctx.firestore().collection('sites').doc(SITE);
    await S.set({ meta: meta(legacy ? [LEG] : []), id: SITE, mode: 'live', updatedAt: T0, updatedBy: 'dev-f2-phone', updatedByUid: U.builder, members: STAMP.members, memberUids: STAMP.memberUids });
    for (const v of [INV1, INV2, INV3]) await S.collection('inv').doc(v.id).set({ data: v, updatedAt: T0 + 5e7, updatedBy: 'dev-f2-phone' });
    for (const s of SELS) await S.collection('sel').doc(String(s.id)).set({ data: s, updatedAt: T0, updatedBy: 'dev-f2-phone' });
    for (const m of SELM) await S.collection('selm').doc(String(m.id)).set({ data: m, updatedAt: T0, updatedBy: 'dev-f2-phone' });
  });
}
async function serverDump(env) {
  const out = {};
  await env.withSecurityRulesDisabled(async ctx => {
    const S = ctx.firestore().collection('sites').doc(SITE);
    const d = (await S.get()).data(); out.meta = d.meta; out.updatedBy = d.updatedBy; out.updatedAt = d.updatedAt;
    for (const c of ['inv', 'sel', 'selm']) { const q = await S.collection(c).get(); out[c] = {}; q.docs.forEach(x => { out[c][x.id] = x.data(); }); }
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
const houseWrites = W => W.filter(e => /^sites\/[^/]+$/.test(e.path));
const metaInvWrites = W => W.filter(e => e.data && e.data.meta && Object.prototype.hasOwnProperty.call(e.data.meta, 'invoices'));
const HO = { role: 'client', site: SITE, name: 'Ana Ruiz', auth: { uid: U.client } };
const BU = { role: 'builder', name: 'Dean Walsh', auth: { uid: U.builder } };
/* the homeowner taps Approve this invoice (open the invoice, tap the button), then waits for the write to settle */
async function tapApprove(ph, invId) {
  ph.$(`window.__toasts=[];var __t0=toast;toast=function(m){__toasts.push(m);return __t0(m);};state.activeId='${SITE}';clientTab='home';renderClient();openInvoiceDetail('${SITE}','${invId}','client');true`);
  const label = ph.$("(function(){var b=document.querySelector('#infoBody .inv-ok');return b?b.textContent:'';})()");
  const n0 = ph.W.length;
  ph.$(`window.__ivP=invApprove('${SITE}','${invId}');true`);
  await sleep(30);
  const saving = ph.$("(function(){var b=document.querySelector('#infoBody .inv-ok');return b?(b.textContent+(b.disabled?'|disabled':'')):'';})()");
  try { await ph.w.$eval('window.__ivP'); } catch (e) {}
  for (let i = 0; i < 40 && ph.W.inflight > 0; i++) await sleep(100);
  await sleep(600);
  return { label, saving, writes: ph.W.slice(n0), toasts: JSON.parse(ph.$('JSON.stringify(__toasts)')),
    inv: JSON.parse(ph.$(`JSON.stringify((state.projects.find(x=>String(x.id)==='${SITE}').invoices||[]).find(v=>v.id==='${invId}')||null)`)),
    errs: JSON.parse(ph.$("JSON.stringify(devErrors())")) };
}

(async () => {
  const RULES = process.env.RULES_FILE || 'firestore.rules';
  const env = await initializeTestEnvironment({ projectId: 'demo-plumb-rules',
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync(path.join(__dirname, RULES), 'utf8') } });
  log('rules: ' + RULES + ' (sha256 ' + require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, RULES))).digest('hex').slice(0, 16) + ')');
  log('app: ' + String(SRC.match(/PLUMB_VERSION='([^']*)'/)[1]));

  /* ================= 1-2. migrated house; homeowner approves INV-001 ================= */
  await seed(env, false);
  const s0 = await serverDump(env);
  fs.writeFileSync(path.join(OUT, 'server-0-before.json'), JSON.stringify(s0, null, 2));
  const ho = await phone(env, { who: 'homeowner', uid: U.client, deviceId: 'dev-ho', session: HO });
  check('homeowner opens: zero write attempts', ho.W.length === 0, ho.W);
  check('homeowner opens: sees INV-001 waiting for OK', (ho.proj().invoices || []).some(v => v.id === INV1.id && v.status === 'sent'));
  const r = await tapApprove(ho, INV1.id);
  fs.writeFileSync(path.join(OUT, 'writes-homeowner-approve.json'), JSON.stringify(r.writes, null, 2));
  check('homeowner: the invoice offers Approve this invoice', r.label === 'Approve this invoice', r.label);
  check('homeowner: Saving\u2026 (disabled) while the server answers', r.saving === 'Saving\u2026|disabled', r.saving);
  check('homeowner approve: exactly one write, to sites/{id}/inv/{invId}', r.writes.length === 1 && r.writes[0].path === `sites/${SITE}/inv/${INV1.id}`, r.writes.map(e => e.op + ' ' + e.path));
  check('homeowner approve: the server ACCEPTED it under the live rules (clientInvOk)', r.writes.length === 1 && r.writes[0].ok === true, r.writes);
  const w0 = r.writes[0] || {};
  check('homeowner approve: merged {data:{status,approvedAt},updatedAt,updatedBy} only', w0.merge === true && Object.keys(w0.data || {}).sort().join() === 'data,updatedAt,updatedBy'
    && Object.keys((w0.data || {}).data || {}).sort().join() === 'approvedAt,status' && w0.data.data.status === 'approved' && Number.isInteger(w0.data.data.approvedAt), w0.data);
  const s1 = await serverDump(env);
  fs.writeFileSync(path.join(OUT, 'server-1-after-approve.json'), JSON.stringify(s1, null, 2));
  const d1 = (s1.inv[INV1.id] || {}).data || {};
  check('server: INV-001 is status approved with an integer approvedAt', d1.status === 'approved' && Number.isInteger(d1.approvedAt), d1);
  { const a = Object.assign({}, d1); delete a.status; delete a.approvedAt; const b = Object.assign({}, INV1); delete b.status;
    check('server: every other INV-001 field is unchanged (amounts, lines, payments, total, no paid/void)', JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map(k => [k, b[k]])), { got: a, want: b }); }
  check('server: INV-002 and INV-003 untouched', JSON.stringify(s1.inv[INV2.id]) === JSON.stringify(s0.inv[INV2.id]) && JSON.stringify(s1.inv[INV3.id]) === JSON.stringify(s0.inv[INV3.id]));
  check('server: house doc untouched (meta.invoices still [], same updatedBy/updatedAt)', JSON.stringify(s1.meta) === JSON.stringify(s0.meta) && s1.updatedBy === s0.updatedBy && s1.updatedAt === s0.updatedAt, { meta: s1.meta.invoices, by: s1.updatedBy });
  check('homeowner phone: approved here (same approvedAt as the server) and the existing toast', r.inv && r.inv.status === 'approved' && r.inv.approvedAt === d1.approvedAt && r.toasts[r.toasts.length - 1] === 'INV-001 approved', { inv: r.inv, toasts: r.toasts });
  await sleep(1500);
  check('homeowner phone: zero writes to the house doc and zero writes carrying meta.invoices, all session', houseWrites(ho.W).length === 0 && metaInvWrites(ho.W).length === 0, ho.W.map(e => e.op + ' ' + e.path));
  check('homeowner phone: nothing queued after (no house, inv or selm op)', ho.$(`diffSiteOps(Sync._shadow['${SITE}'],state.projects.find(x=>String(x.id)==='${SITE}')).filter(o=>o.kind==='meta'||o.sub==='inv'||o.sub==='selm').length`) === 0);
  check('homeowner phone: no refused write, no rules error logged', refused(ho.W).length === 0 && !r.errs.some(e => e.k === 'rules'), r.errs);
  /* tampering through the app's own write path is refused: a homeowner cannot approve INV-003 (draft) */
  const rD = await tapApprove(ho, INV3.id);
  check('homeowner: a draft invoice offers no Approve and writes nothing', rD.label === '' && rD.writes.length === 0, { label: rD.label, writes: rD.writes });
  ho.close();

  /* ================= 3. builder sees it ================= */
  const bu = await phone(env, { who: 'builder', uid: U.builder, deviceId: 'dev-bu', session: BU });
  const bInv = (bu.proj().invoices || []).find(v => v.id === INV1.id) || {};
  check('builder phone: INV-001 shows approved with the homeowner\u2019s approvedAt', bInv.status === 'approved' && bInv.approvedAt === d1.approvedAt, bInv);
  check('builder phone: opening the migrated house writes nothing (no meta.invoices write, no refused write)', bu.W.length === 0, bu.W.map(e => e.op + ' ' + e.path + ' ' + e.ok));
  bu.close();

  /* ================= 4. the live 2.463.0 app's tap is refused by these rules ================= */
  if (process.env.F1_OLD_INDEX) {
    await seed(env, false);
    const OLD = fs.readFileSync(process.env.F1_OLD_INDEX, 'utf8').replace('</body>', '<script>window.$eval=c=>eval(c);</script></body>');
    const old = await phone(env, { src: OLD, who: 'homeowner-2.463', uid: U.client, deviceId: 'dev-ho-old', session: HO });
    log('old app: ' + String(OLD.match(/PLUMB_VERSION='([^']*)'/)[1]));
    const ro = await tapApprove(old, INV1.id);
    const so = await serverDump(env);
    fs.writeFileSync(path.join(OUT, 'writes-2.463.0-homeowner-approve.json'), JSON.stringify(ro.writes, null, 2));
    check('2.463.0 (live today): its approve writes meta.invoices on the house doc and the live rules REFUSE it', ro.writes.length === 1 && /^sites\/[^/]+$/.test(ro.writes[0].path) && ro.writes[0].ok === false && /permission/.test(ro.writes[0].err), ro.writes);
    check('2.463.0: rolls back (still waiting), refused toast; server INV-001 still sent', ro.inv && ro.inv.status === 'sent' && ro.toasts.indexOf('Not approved yet. Ask your builder to check your access.') >= 0 && so.inv[INV1.id].data.status === 'sent', { inv: ro.inv, toasts: ro.toasts });
    old.close();
  }

  /* ================= 5. an invoice only in legacy meta.invoices ================= */
  await seed(env, true);
  const sl0 = await serverDump(env);
  const hl = await phone(env, { who: 'homeowner-legacy', uid: U.client, deviceId: 'dev-ho2', session: HO });
  check('legacy house, homeowner opens: zero writes; dual-read shows INV-009', hl.W.length === 0 && (hl.proj().invoices || []).some(v => v.id === LEG.id), hl.W);
  const rl = await tapApprove(hl, LEG.id);
  const sl1 = await serverDump(env);
  check('legacy-only invoice: no write at all (not in inv: the rules would refuse it; never the house doc)', rl.writes.length === 0, rl.writes);
  { const d = env.authenticatedContext(U.client).firestore().collection('sites').doc(SITE).collection('inv').doc(LEG.id);
    let denied = false; try { await d.set({ data: { status: 'approved', approvedAt: Date.now() }, updatedAt: Date.now(), updatedBy: 'dev-ho2' }, { merge: true }); } catch (e) { denied = /permission/i.test(String(e && (e.code || e.message))); }
    check('legacy-only invoice: that write, sent anyway straight to the API, is refused by the live rules (homeowner cannot create inv)', denied); }
  check('legacy-only invoice: nothing changes here (still waiting), the existing refused toast', rl.inv && rl.inv.status === 'sent' && rl.inv.approvedAt === undefined && rl.toasts.indexOf('Not approved yet. Ask your builder to check your access.') >= 0, { inv: rl.inv, toasts: rl.toasts });
  check('legacy-only invoice: server unchanged (no inv doc created, meta.invoices still the legacy list)', JSON.stringify(sl1) === JSON.stringify(sl0));
  check('legacy-only invoice: zero house-doc writes, nothing queued', houseWrites(hl.W).length === 0 && hl.$(`diffSiteOps(Sync._shadow['${SITE}'],state.projects.find(x=>String(x.id)==='${SITE}')).filter(o=>o.kind==='meta'||o.sub==='inv').length`) === 0);
  hl.close();

  await env.cleanup();
  const failed = results.filter(x => !x.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, 'f1replay.log'), LOG.join('\n') + '\n');
  log(`\nf1replay: ${results.length - failed.length}/${results.length} checks passed` + (failed.length ? ' \u2014 FAIL' : ' \u2014 PASS'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
