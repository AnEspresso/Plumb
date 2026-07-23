/* Export a site's PAYMENTS to QuickBooks as Purchases.
   Signed contracts never export: a commitment is not an expense until money
   moves. Only kind==='spent' records become Purchases.
   Idempotent: a cost that already carries qbId is skipped forever.
   Write-backs merge into the cost doc's `data` map with updatedBy:'server',
   so every connected device sees the exported mark via normal sync. */
'use strict';
const qbo = require('./qbo');

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

async function exportCosts(db, uid, siteId) {
  const tokens = await qbo.freshTokens(db, uid);
  if (!tokens || !tokens.realmId) return { ok: false, reason: 'not-connected' };

  const siteRef = db.collection('sites').doc(String(siteId));
  const siteSnap = await siteRef.get();
  if (!siteSnap.exists) return { ok: false, reason: 'no-site' };
  const site = siteSnap.data();
  if (!requireBuilder(site, uid)) return { ok: false, reason: 'not-your-site' };

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
  let created = 0; const failures = [];
  for (const a of pending) {
    try {
      const payee = (a.rec.payee || 'Unknown payee').slice(0, 100);
      if (!vendorCache[payee]) vendorCache[payee] = await qbo.ensureVendor(tokens, payee);
      const note = ('Payment · ' + street + (a.rec.note ? ' · ' + a.rec.note : '') + ' · plumb:' + a.rec.id);
      const qbId = await qbo.createPurchase(tokens, {
        payAccountId, expenseAccountId,
        vendorId: vendorCache[payee], customerId,
        amount: Number(a.rec.amount), dateISO: toISODate(a.rec.t), note,
      });
      await siteRef.collection('costs').doc(a.docId).set(
        { data: { qbId }, updatedAt: Date.now(), updatedBy: 'server' }, { merge: true });
      created++;
    } catch (e) {
      failures.push({ id: a.rec.id, payee: a.rec.payee || '', error: String(e.message || e).slice(0, 200) });
    }
  }
  return { ok: true, created, skipped: actuals.length - pending.length, failures };
}

module.exports = { exportCosts, requireBuilder, toISODate };
