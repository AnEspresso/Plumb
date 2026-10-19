/* M-16: the one guard every repair script loads before it touches the database.
   It patches the Firestore write methods themselves (DocumentReference, CollectionReference.add, WriteBatch, Transaction,
   BulkWriter), so a reference obtained any way at all (a query result's .ref included) goes through it.
   Refused, by throwing (the run fails): any write or delete under inv, selm, pmts, co, costs, hist, consent, flags,
   numbers or the archive; deleting a house document that still has money records under it (that would strand them);
   recursiveDelete. A script that must change money is a reviewed PR with a dry-run report, never a one-off. */
export const MONEY = ['inv', 'selm', 'pmts', 'co', 'costs', 'hist', 'consent', 'flags', 'numbers', 'archive'];
export class MoneyGuardError extends Error {}
export function isMoneyPath(path) {
  const seg = String(path || '').split('/').filter(Boolean);
  for (let i = 0; i < seg.length; i += 2) if (MONEY.includes(seg[i]) && (i > 0 || seg[0] === 'archive')) return true;
  return false;
}
const isSiteDoc = (p) => /^sites\/[^/]+$/.test(String(p || ''));
function refuse(path, why) { throw new MoneyGuardError('money guard: ' + why + ' (' + path + ') is not allowed from a repair script'); }
async function hasMoneyUnder(ref) {
  if (!ref.listCollections) return false;
  for (const c of await ref.listCollections()) {
    if (MONEY.includes(c.id)) { const s = await c.limit(1).get(); if (!s.empty) return true; }
  }
  return false;
}
let installed = new WeakSet();
export function installMoneyGuard(mod) {
  const { DocumentReference, CollectionReference, WriteBatch, Transaction, BulkWriter, Firestore } = mod;
  const wrap = (proto, name, fn) => { if (!proto || typeof proto[name] !== 'function') return; const o = proto[name]; proto[name] = function (...a) { return fn.call(this, o, a); }; };
  if (DocumentReference && !installed.has(DocumentReference)) {
    installed.add(DocumentReference);
    for (const m of ['set', 'update', 'create', 'delete']) wrap(DocumentReference.prototype, m, async function (o, a) {
      if (isMoneyPath(this.path)) refuse(this.path, m + ' on a money record');
      if (m === 'delete' && isSiteDoc(this.path) && await hasMoneyUnder(this)) refuse(this.path, 'deleting a house that still has money records');
      return o.apply(this, a);
    });
  }
  if (CollectionReference && !installed.has(CollectionReference)) {
    installed.add(CollectionReference);
    wrap(CollectionReference.prototype, 'add', async function (o, a) { if (isMoneyPath(this.path + '/x')) refuse(this.path, 'add to a money collection'); return o.apply(this, a); });
  }
  for (const C of [WriteBatch, Transaction, BulkWriter]) {
    if (!C || installed.has(C)) continue; installed.add(C);
    for (const m of ['set', 'update', 'create', 'delete']) wrap(C.prototype, m, function (o, a) {
      const ref = a[0];
      if (ref && isMoneyPath(ref.path)) refuse(ref.path, m + ' on a money record');
      if (m === 'delete' && ref && isSiteDoc(ref.path)) refuse(ref.path, 'a batched delete of a house (use the single, checked delete)');
      return o.apply(this, a);
    });
  }
  if (Firestore && !installed.has(Firestore)) {
    installed.add(Firestore);
    for (const m of ['recursiveDelete']) wrap(Firestore.prototype, m, function () { refuse('recursiveDelete', 'recursiveDelete'); });
  }
}
