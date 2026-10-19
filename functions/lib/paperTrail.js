'use strict';
/* Step 3a (2.470.0): the money history writer and the server's own money check.
   DORMANT: every entry point exits at once unless settings/paperTrail has enabled == true
   (written only by the server/console; clients cannot write settings, Rules A1).
   Pure functions first (tested in plain node), then one handler that takes the db. */

/* ---- whole cents, written independently of the app (string arithmetic, half up, no float epsilon) ---- */
function dollarsToCents(v) {
  if (typeof v === 'number' && !isFinite(v)) return NaN;
  let s = String(v == null ? '' : v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const neg = s[0] === '-'; if (neg) s = s.slice(1);
  const parts = s.split('.');
  const whole = parts[0], frac = (parts[1] || '') + '000';
  let c = parseInt(whole, 10) * 100 + parseInt(frac.slice(0, 2), 10);
  if (frac.charCodeAt(2) >= 53) c += 1;                 // third digit 5..9 rounds up (half up on the magnitude)
  return neg ? -c : c;
}
/* A record's cents: the integer twin when present and whole, else the dollars. */
function centsOf(rec, key) {
  const t = rec && rec[key + 'C'];
  if (Number.isInteger(t)) return t;
  return dollarsToCents(rec && rec[key]);
}
function fmtCents(c) {
  const neg = c < 0; const a = Math.abs(c);
  const d = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '\u2212' : '') + '$' + d + '.' + String(a % 100).padStart(2, '0');
}
/* The sentence the homeowner will see above the button (M-8). */
function sentenceFor(kind, cents) {
  if (kind === 'co') return cents < 0 ? 'This credits ' + fmtCents(-cents) + '.' : 'This adds ' + fmtCents(cents) + ' to your contract.';
  return 'This invoice is ' + fmtCents(cents) + '.';
}

/* ---- M-14: recalculate on the server, from the line items, in whole cents ---- */
function invoiceTotalCents(inv) {
  let sum = 0;
  for (const it of (inv && inv.items) || []) { const c = centsOf(it || {}, 'amount'); if (isNaN(c)) return NaN; sum += c; }
  return sum;
}
function verifyInvoice(inv) {
  const calc = invoiceTotalCents(inv);
  const stored = centsOf(inv || {}, 'total');
  return { ok: !isNaN(calc) && !isNaN(stored) && calc === stored, calc, stored, sentence: sentenceFor('inv', calc) };
}
/* A change order's amount is a single signed integer; the server checks it is whole cents, signed to match its kind,
   and writes the sentence the homeowner will be asked to sign. */
function verifyCo(d) {
  const c = d && d.amountC;
  const whole = Number.isInteger(c) && c !== 0;
  const kindOk = d && ((d.kind === 'change' && c > 0) || (d.kind === 'credit' && c < 0));
  const ok = !!(whole && kindOk && Number.isInteger(d.rev) && d.rev >= 1);
  return { ok, calc: c, stored: c, sentence: ok ? sentenceFor('co', c) : '' };
}

/* ---- history lines: what happened, from the before and after of one write ---- */
const SENT_STATES = ['sent', 'approved', 'declined', 'withdrawn'];
function amountOf(coll, d) { return coll === 'co' ? (Number.isInteger(d.amountC) ? d.amountC : NaN) : centsOf(d, 'total'); }
function linesFor(coll, before, after) {
  const out = [];
  const b = before && before.data ? before.data : null;
  const a = after && after.data ? after.data : null;
  if (!a) return out;                                    // a delete writes no line (the archive step, 3b, handles those)
  const outer = after || {};
  const base = (kind, extra) => Object.assign({ kind, ref: String(a.id != null ? a.id : ''), refType: coll, by: outer.byUid || a.decidedBy || a.sentBy || null }, extra || {});
  if (coll === 'co') {
    const bs = b ? b.status : null, as = a.status;
    const amt = amountOf('co', a);
    if (as === 'sent' && bs !== 'sent') out.push(base('sent', { rev: a.rev, amountC: amt, no: a.no }));
    else if (as === 'sent' && bs === 'sent' && b.rev !== a.rev) out.push(base('changed', { rev: a.rev, amountC: amt, no: a.no }));
    if (as === 'approved' && bs !== 'approved') out.push(base('approved', { rev: a.decidedRev, amountC: amt, no: a.no, via: a.approvedVia || 'app', sentence: a.sentence || '', signedName: a.decidedName || '' }));
    if (as === 'declined' && bs !== 'declined') out.push(base('declined', { rev: a.decidedRev, no: a.no, note: a.declineNote || '' }));
    if (as === 'withdrawn' && bs !== 'withdrawn') out.push(base('withdrawn', { rev: a.rev, no: a.no }));
    return out;
  }
  if (coll === 'inv') {
    const bs = b ? b.status : null, as = a.status;
    const tot = centsOf(a, 'total');
    if (as === 'sent' && bs !== 'sent' && !SENT_STATES.concat(['paid', 'overdue', 'partial', 'void']).includes(bs)) out.push(base('sent', { amountC: tot, no: a.no || a.num }));
    if (as === 'approved' && bs !== 'approved') out.push(base('approved', { amountC: tot, no: a.no || a.num, sentence: a.sentence || '' }));
    if (as === 'paid' && bs !== 'paid') out.push(base('paid', { amountC: tot, no: a.no || a.num }));
    if (as === 'void' && bs !== 'void') out.push(base('voided', { amountC: tot, no: a.no || a.num, note: a.voidReason || '' }));
    const bp = (b && b.payments) || [], ap = a.payments || [];
    ap.forEach((p, i) => {
      const o = bp[i];
      if (!o && !(p && p.voidedAt)) out.push(base('payment', { refType: 'inv', payRef: String(p && p.id != null ? p.id : i), amountC: centsOf(p || {}, 'amount') }));
      if (p && p.voidedAt && !(o && o.voidedAt)) out.push(base('payment_voided', { payRef: String(p.id != null ? p.id : i), amountC: centsOf(p, 'amount'), note: p.voidReason || '' }));
    });
    return out;
  }
  if (coll === 'pmts') {
    if (!b && !a.voidedAt) out.push(base('payment', { refType: 'pmt', ref: String(a.id != null ? a.id : ''), amountC: centsOf(a, 'amount') }));
    if (a.voidedAt && !(b && b.voidedAt)) out.push(base('payment_voided', { refType: 'pmt', ref: String(a.id != null ? a.id : ''), amountC: centsOf(a, 'amount'), note: a.voidReason || '' }));
    return out;
  }
  return out;
}

/* ---- M-18 (2.479.0): a flag or a resolve becomes one history line. Flags are raw docs (no data envelope), create-only. ---- */
function flagLine(f, flagId) {
  if (!f || (f.kind !== 'flag' && f.kind !== 'resolve')) return null;
  if (!['inv', 'co', 'sel', 'pmt'].includes(f.targetType) || !f.targetId) return null;
  const ln = { kind: f.kind === 'flag' ? 'flagged' : 'flag_resolved', ref: String(f.targetId), refType: f.targetType, flagId: String(flagId), note: String(f.note || '').slice(0, 500), by: f.byUid || null };
  if (f.kind === 'resolve') ln.flagRef = String(f.ref || '');
  return ln;
}
async function handleFlag(db, ts, event) {
  if (!(await enabled(db))) return { skipped: 'off' };
  const before = event.data && event.data.before && event.data.before.exists;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (before || !after) return { skipped: 'not a create' };
  const ln = flagLine(after, event.params.docId);
  if (!ln) return { skipped: 'shape' };
  const siteId = event.params.siteId;
  const site = (await db.collection('sites').doc(siteId).get()).data() || {};
  const info = ((site.meta || {}).memberInfo) || {};
  const row = Object.assign({}, ln, { byName: ln.by && info[ln.by] && info[ln.by].name ? String(info[ln.by].name) : '', at: ts(), seq: 0, src: 'flags/' + event.params.docId });
  await db.collection('sites').doc(siteId).collection('hist').doc(String(event.id) + '_0').set(row);
  return { lines: 1 };
}

/* ---- the switch: off unless settings/paperTrail.enabled === true; cached 30 s ---- */
const _cache = { at: 0, on: false };
async function enabled(db, now) {
  const t = now == null ? Date.now() : now;
  if (t - _cache.at < 30000) return _cache.on;
  let on = false;
  try { const s = await db.collection('settings').doc('paperTrail').get(); on = !!(s.exists && s.data() && s.data().enabled === true); } catch (e) { on = false; }
  _cache.at = t; _cache.on = on; return on;
}
function _resetCache() { _cache.at = 0; _cache.on = false; }

/* ---- the handler (db and a server timestamp factory are passed in so tests can fake them) ---- */
async function handle(db, ts, coll, event) {
  if (!(await enabled(db))) return { skipped: 'off' };
  const siteId = event.params.siteId;
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return { skipped: 'delete' };
  const res = { lines: 0, verified: null };
  const lines = linesFor(coll, before, after);
  if (lines.length) {
    const site = (await db.collection('sites').doc(siteId).get()).data() || {};
    const info = ((site.meta || {}).memberInfo) || {};
    const batch = db.batch();
    lines.forEach((ln, i) => {
      const nm = ln.by && info[ln.by] && info[ln.by].name ? String(info[ln.by].name) : '';
      const row = Object.assign({}, ln, { byName: nm, at: ts(), seq: i, src: coll + '/' + event.params.docId });
      Object.keys(row).forEach(k => { if (row[k] === undefined) delete row[k]; });
      batch.set(db.collection('sites').doc(siteId).collection('hist').doc(String(event.id) + '_' + i), row);   // same event, same id: a retry cannot double a line
    });
    await batch.commit(); res.lines = lines.length;
  }
  if (coll === 'co' && after.data && after.data.status === 'sent') {
    const d = after.data, v = verifyCo(d);
    if (v.ok && (d.verifiedRev !== d.rev || d.verifiedTotal !== d.amountC)) {
      await db.collection('sites').doc(siteId).collection('co').doc(event.params.docId).update({ 'data.verifiedRev': d.rev, 'data.verifiedTotal': d.amountC });
      res.verified = true;
    } else if (!v.ok && d.verifiedRev === d.rev) {
      await db.collection('sites').doc(siteId).collection('co').doc(event.params.docId).update({ 'data.verifiedRev': null, 'data.verifiedTotal': null });
      res.verified = false;
    }
    if (!v.ok) {
      await db.collection('sites').doc(siteId).collection('hist').doc(String(event.id) + '_check').set({ kind: 'needs_check', ref: String(d.id || ''), refType: 'co', rev: d.rev == null ? null : d.rev, at: ts(), src: 'co/' + event.params.docId, by: null, byName: '' });
    }
  }
  return res;
}

module.exports = { flagLine, handleFlag, dollarsToCents, centsOf, fmtCents, sentenceFor, invoiceTotalCents, verifyInvoice, verifyCo, linesFor, enabled, handle, _resetCache };
