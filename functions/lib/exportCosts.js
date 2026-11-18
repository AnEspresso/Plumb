/* Export a site's PAYMENTS to QuickBooks as Purchases.
   Signed contracts never export: a commitment is not an expense until money
   moves. Only kind==='spent' records become Purchases.
   Idempotent: a cost that already carries qbId is skipped forever.
   Write-backs merge into the cost doc's `data` map with updatedBy:'server',
   so every connected device sees the exported mark via normal sync. */
'use strict';
const crypto = require('crypto');
const qboLib = require('./qbo');

/* #13 (2.513.0): the same money gate as the app's QuickBooks line (qbEligible: a builder with canGate('moneyCo')),
   read from this house: no memberInfo entry (the creator), the owner, or the Change orders & money gate. */
function moneyGateOk(site, uid) {
  if (!requireBuilder(site, uid)) return false;
  const mi = (((site && site.meta) || {}).memberInfo || {})[uid];
  if (!mi) return true;
  const g = mi.gates || {};
  return mi.rpRole === 'owner' || mi.owner === true || g.moneyCo === true || g.moneyCo === 1;
}

/* #13: one export per cost, across taps, phones and builders. The lock lives in qbExports/{site}__{cost}, a
   server-only collection (no client rule matches it, so clients can neither read nor write it). A transaction
   claims it; 'done' is permanent; a 'pending' claim older than LOCK_MS can be taken over (the QuickBooks requestid
   below makes that second try return the first purchase instead of a duplicate). */
const LOCK_MS = 15 * 60 * 1000;
const lockId = (siteId, docId) => String(siteId) + '__' + String(docId);
const requestIdFor = (realmId, siteId, docId) => 'plumb-' + crypto.createHash('sha1').update(String(realmId) + '/' + String(siteId) + '/' + String(docId)).digest('hex').slice(0, 40);
async function claim(db, siteRef, siteId, docId, uid, now) {
  const lockRef = db.collection('qbExports').doc(lockId(siteId, docId));
  const costRef = siteRef.collection('costs').doc(docId);
  return db.runTransaction(async (tx) => {
    const ls = await tx.get(lockRef); const cs = await tx.get(costRef);
    const rec = ((cs && cs.exists && cs.data()) || {}).data || {};
    const L = ls && ls.exists ? (ls.data() || {}) : null;
    if (rec.qbId) return { state: 'done', qbId: rec.qbId };
    if (L && L.state === 'done' && L.qbId) return { state: 'done', qbId: L.qbId, heal: true };
    if (L && L.state === 'pending' && now - Number(L.at || 0) < LOCK_MS) return { state: 'busy' };
    tx.set(lockRef, { state: 'pending', by: uid, at: now, siteId: String(siteId), costId: String(docId) });
    return { state: 'mine' };
  });
}

function requireBuilder(site, uid) {
  // Production writes members as STRINGS: members[uid] === 'builder' | 'sub' | 'client'.
  // Strict allow-list: only 'builder' exports. (Object {role} tolerated for any legacy doc.)
  const m = (site.members || {})[uid];
  if (!m) return false;
  const role = typeof m === 'string' ? m : String(m.role || '');
  return role.toLowerCase() === 'builder';
}

function toISODate(t) {
  const d = t ? new Date(t) : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function exportCosts(db, uid, siteId, opts) {
  const qbo = (opts && opts.qbo) || qboLib;
  const nowFn = (opts && opts.now) || Date.now;
  const tokens = await qbo.freshTokens(db, uid);
  if (!tokens || !tokens.realmId) return { ok: false, reason: 'not-connected' };

  const siteRef = db.collection('sites').doc(String(siteId));
  const siteSnap = await siteRef.get();
  if (!siteSnap.exists) return { ok: false, reason: 'no-site' };
  const site = siteSnap.data();
  if (!requireBuilder(site, uid)) return { ok: false, reason: 'not-your-site' };
  if (!moneyGateOk(site, uid)) return { ok: false, reason: 'no-money-access' };

  // Site display name for the QBO Customer. In production docs the street lives
  // inside the meta MAP (see 3863 Robina doc shape); tolerate every historical shape.
  let street = site.street || '';
  if (!street && site.meta && typeof site.meta === 'object') street = site.meta.street || '';
  if (!street && typeof site.meta === 'string') { try { street = (JSON.parse(site.meta) || {}).street || ''; } catch (e) {} }
  if (!street) street = 'Plumb site ' + siteId;

  const costsSnap = await siteRef.collection('costs').get();
  const actuals = [];
  costsSnap.forEach(doc => {
    const d = doc.data() || {};
    const rec = d.data;
    if (rec && rec.rt === 'actual' && rec.kind === 'spent' && Number(rec.amount) > 0) actuals.push({ docId: doc.id, rec });
  });

  const pending = actuals.filter(a => !a.rec.qbId);
  if (!pending.length) return { ok: true, created: 0, skipped: actuals.length, failures: [] };

  const payAccountId = await qbo.ensureAccount(tokens, 'Plumb Clearing', 'Bank');
  const expenseAccountId = await qbo.ensureAccount(tokens, 'Construction Costs (Plumb)', 'Expense');
  const customerId = await qbo.ensureCustomer(tokens, street);

  const vendorCache = {};
  let created = 0, already = 0, busy = 0; const failures = [];
  for (const a of pending) {
    const lockRef = db.collection('qbExports').doc(lockId(siteId, a.docId));
    const costRef = siteRef.collection('costs').doc(a.docId);
    let c;
    try { c = await claim(db, siteRef, siteId, a.docId, uid, nowFn()); }
    catch (e) { failures.push({ id: a.rec.id, payee: a.rec.payee || '', error: String(e.message || e).slice(0, 200) }); continue; }
    if (c.state === 'busy') { busy++; continue; }
    if (c.state === 'done') {
      already++;
      if (c.heal) { try { await costRef.set({ data: { qbId: c.qbId }, updatedAt: Date.now(), updatedBy: 'server' }, { merge: true }); } catch (e) { /* next run heals it */ } }
      continue;
    }
    let qbId = null;
    try {
      const payee = (a.rec.payee || 'Unknown payee').slice(0, 100);
      if (!vendorCache[payee]) vendorCache[payee] = await qbo.ensureVendor(tokens, payee);
      const note = ('Payment · ' + street + (a.rec.note ? ' · ' + a.rec.note : '') + ' · plumb:' + a.rec.id);
      qbId = await qbo.createPurchase(tokens, {
        payAccountId, expenseAccountId,
        vendorId: vendorCache[payee], customerId,
        amount: Number(a.rec.amount), dateISO: toISODate(a.rec.t), note,
        requestId: requestIdFor(tokens.realmId, siteId, a.docId),
      });
    } catch (e) {
      /* A clear refusal (4xx) made nothing: free the cost for the next tap. Anything else (timeout, 5xx) may have
         made the purchase: keep the claim until it goes stale; the requestid makes the next try return that one. */
      if (Number(e && e.status) >= 400 && Number(e && e.status) < 500) { try { await lockRef.delete(); } catch (e2) { /* goes stale */ } }
      failures.push({ id: a.rec.id, payee: a.rec.payee || '', error: String(e.message || e).slice(0, 200) });
      continue;
    }
    try { await lockRef.set({ state: 'done', qbId: String(qbId), by: uid, at: nowFn(), siteId: String(siteId), costId: String(a.docId) }); } catch (e) { /* the cost mark below still holds it */ }
    try {
      await costRef.set({ data: { qbId }, updatedAt: Date.now(), updatedBy: 'server' }, { merge: true });
    } catch (e) { failures.push({ id: a.rec.id, payee: a.rec.payee || '', error: 'sent, mark pending: ' + String(e.message || e).slice(0, 160) }); }
    created++;
  }
  return { ok: true, created, skipped: actuals.length - pending.length + already, busy, failures };
}

module.exports = { exportCosts, requireBuilder, moneyGateOk, toISODate, LOCK_MS, lockId, requestIdFor };
