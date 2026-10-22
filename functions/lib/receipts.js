'use strict';
/* Step 3b-1 (M-10 receipts, M-12 archive): when the server writes a money-history line, it
     1. writes a snapshot (JSON + PDF) to the locked archive bucket (create-only, never overwrites),
     2. emails each party one plain paragraph with that same PDF and its SHA-256 fingerprint,
     3. stamps the fingerprint on the history line.
   DORMANT: runs only when settings/paperTrail has enabled === true AND receipts === true.
   Plain node, everything outside (db, bucket, email provider, auth) is injected so it is tested without a network. */
const crypto = require('crypto');
const { fmtCents } = require('./paperTrail');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ---- a small deterministic PDF (one page, Helvetica, no dates, no random ids): same record, same bytes ---- */
function pdfText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function wrap(line, n) {
  const out = []; let cur = '';
  String(line).split(/\s+/).forEach(w => { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
  if (cur) out.push(cur); return out.length ? out : [''];
}
function buildPdf(title, lines) {
  const rows = []; rows.push({ t: title, s: 16 }); rows.push({ t: '', s: 11 });
  lines.forEach(l => wrap(l, 88).forEach(x => rows.push({ t: x, s: 11 })));
  const body = rows.slice(0, 52);
  let y = 750; let stream = 'BT\n';
  body.forEach(r => { stream += '/F1 ' + r.s + ' Tf 1 0 0 1 54 ' + y + ' Tm (' + pdfText(r.t) + ') Tj\n'; y -= r.s + 4; });
  stream += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + '\nendstream'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

/* ---- what was agreed, in words ---- */
const KIND_WORDS = { sent: 'sent', changed: 'updated', approved: 'approved', declined: 'declined', withdrawn: 'withdrawn',
  paid: 'marked paid', voided: 'voided', payment: 'recorded a payment on', payment_voided: 'voided a payment on' };
const RECEIPT_KINDS = Object.keys(KIND_WORDS);
const THING = { co: 'change order', inv: 'invoice', pmt: 'payment' };
function utc(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; }
function whatOf(line) {
  const noun = THING[line.refType] || 'item';
  return noun + (line.no ? ' ' + line.no : '');
}
function describe(line, house, who) {
  const amt = Number.isInteger(line.amountC) ? ' for ' + fmtCents(line.amountC) : '';
  const nm = who || 'Someone';
  const via = line.via === 'paper' ? ' (signed on paper)' : '';
  return nm + ' ' + (KIND_WORDS[line.kind] || line.kind) + ' ' + whatOf(line) + amt + ' on ' + house + via + '.';
}
/* The snapshot is exactly the line, the record it points to, and the sentence shown: nothing else. */
function snapshotOf(siteId, house, lineId, line, atMs, record) {
  const pick = {}; ['kind', 'ref', 'refType', 'rev', 'amountC', 'no', 'via', 'sentence', 'signedName', 'by', 'byName', 'note', 'payRef'].forEach(k => { if (line[k] !== undefined) pick[k] = line[k]; });
  return { site: siteId, house, lineId, at: utc(atMs), line: pick, record: record === undefined ? null : record };
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); }); return o; }
  return v;
}
const canonJson = (v) => JSON.stringify(canon(v), null, 2);
function pdfFor(snap) {
  const l = snap.line;
  const rows = [
    describe(l, snap.house, l.byName),
    '',
    'House: ' + snap.house,
    'Event: ' + (KIND_WORDS[l.kind] || l.kind) + ' ' + whatOf(l),
    'Server time: ' + snap.at,
    l.rev != null ? 'Revision: ' + l.rev : null,
    Number.isInteger(l.amountC) ? 'Amount: ' + fmtCents(l.amountC) : null,
    l.sentence ? 'What was shown above the button: ' + l.sentence : null,
    l.signedName ? 'Signed by: ' + l.signedName : (l.byName ? 'By: ' + l.byName : null),
    l.note ? 'Note: ' + l.note : null,
    '',
    'Record id: ' + snap.lineId,
    'This file is the archived copy. Its SHA-256 fingerprint is in your email and in the money history.'].filter(x => x !== null);
  return buildPdf('SitePlumb receipt', rows);
}

/* ---- who gets a receipt: the homeowner(s) and the builders who can see money (mirrors the rules' moneyOk) ---- */
function partiesOf(site, actorUid) {
  const members = (site && site.members) || {}; const info = ((site && site.meta) || {}).memberInfo || {};
  const out = [];
  Object.keys(members).forEach(u => {
    const r = String(typeof members[u] === 'string' ? members[u] : (members[u] && members[u].role) || '').toLowerCase();
    const mi = info[u];
    if (r === 'client') out.push(u);
    else if (r === 'builder') {
      const g = (mi && mi.gates) || {};
      const money = !mi || mi.rpRole === 'owner' || mi.owner === true || g.moneyJob === true || g.moneyJob === 1 || g.moneyCo === true || g.moneyCo === 1;
      if (money || u === actorUid) out.push(u);
    }
  });
  return out;
}

function emailBody(line, house, who, fp) {
  return describe(line, house, who) + '\n\n' + (line.sentence ? 'What was agreed: ' + line.sentence + '\n\n' : '') +
    'The attached PDF is the copy that was archived. Its fingerprint (SHA-256) is:\n' + fp +
    '\n\nKeep this email. The same fingerprint appears in the money history in SitePlumb, so you can show your copy matches.\n\nSitePlumb';
}

/* Same switch idea as the history writer, with a second key for receipts. */
const _c = { at: 0, v: { on: false, receipts: false } };
async function flags(db, now) {
  const t = now == null ? Date.now() : now;
  if (t - _c.at < 30000) return _c.v;
  let v = { on: false, receipts: false };
  try { const s = await db.collection('settings').doc('paperTrail').get(); const d = s.exists ? s.data() : null; v = { on: !!(d && d.enabled === true), receipts: !!(d && d.receipts === true) }; } catch (e) { /* off */ }
  _c.at = t; _c.v = v; return v;
}
function _reset() { _c.at = 0; _c.v = { on: false, receipts: false }; }

const PHOTO_MAX = 8 * 1024 * 1024;   /* Resend allows 40 MB per email; keep the photo well under it */
/* deps: { db, bucket, bucketName, sendEmail, emailOf, ts, notify, from } */
async function handle(deps, event) {
  const f = await flags(deps.db);
  if (!(f.on && f.receipts)) return { skipped: 'off' };
  const siteId = event.params.siteId, lineId = event.params.lineId;
  const snapDoc = event.data;
  const line = snapDoc && snapDoc.data ? snapDoc.data() : null;
  if (!line) return { skipped: 'empty' };
  if (line.kind === 'needs_check') {
    try { if (deps.notify) await deps.notify(siteId, line); } catch (e) { /* a push that fails must not block */ }
    return { skipped: 'needs_check' };
  }
  if (!RECEIPT_KINDS.includes(line.kind)) return { skipped: 'no receipt for ' + line.kind };
  if (line.fp) return { skipped: 'already archived' };

  const siteSnap = await deps.db.collection('sites').doc(siteId).get();
  const site = (siteSnap && siteSnap.data && siteSnap.data()) || {};
  const house = String((site.street || (site.meta && site.meta.street) || site.name || siteId));
  /* M-14: a change order's sent/updated receipt waits for the server's own check. A bad total never gets a receipt. */
  let record = null;
  if (line.refType === 'co') {
    const cs = await deps.db.collection('sites').doc(siteId).collection('co').doc(String(line.ref)).get();
    record = cs && cs.exists ? cs.data() : null;
    if ((line.kind === 'sent' || line.kind === 'changed')) {
      const d = record && record.data;
      if (!d || d.verifiedRev !== line.rev || d.verifiedTotal !== line.amountC) {
        const held = await deps.db.collection('sites').doc(siteId).collection('hist').doc(lineId.replace(/_\d+$/, '') + '_check').get();
        if (held && held.exists) return { skipped: 'held: needs a check' };
        const err = new Error('change order not verified yet'); err.retry = true; throw err;   // retry:true re-runs it in a moment
      }
    }
  } else if (line.refType === 'inv' || line.refType === 'pmt') {
    const coll = line.refType === 'inv' ? 'inv' : 'pmts';
    const rs = await deps.db.collection('sites').doc(siteId).collection(coll).doc(String(line.ref)).get();
    record = rs && rs.exists ? rs.data() : null;
  }
  const atMs = line.at && line.at.toMillis ? line.at.toMillis() : (typeof line.at === 'number' ? line.at : (event.time ? Date.parse(event.time) : 0));
  const snap = snapshotOf(siteId, house, lineId, line, atMs, record && record.data !== undefined ? record.data : record);
  const pdf = pdfFor(snap); const fp = sha256(pdf);
  const json = Buffer.from(canonJson(snap), 'utf8');
  /* 1. archive first: a receipt must never describe a copy that is not archived */
  const base = 'archive/' + siteId + '/' + lineId;
  for (const [ext, buf, type] of [['json', json, 'application/json'], ['pdf', pdf, 'application/pdf']]) {
    try { await deps.bucket.file(base + '.' + ext).save(buf, { contentType: type, resumable: false, metadata: { metadata: { sha256: sha256(buf) } }, preconditionOpts: { ifGenerationMatch: 0 } }); }
    catch (e) { if (!(e && (e.code === 412 || /precondition/i.test(String(e.message))))) throw e; }   // 412: already archived (a retry), same bytes
  }
  /* 2. stamp the fingerprint on the line (server-only collection) */
  await deps.db.collection('sites').doc(siteId).collection('hist').doc(lineId).update({ fp, archived: (deps.bucketName || '') + '/' + base + '.pdf' });
  /* 3. one email per party, once: the claim is a transaction on the line itself */
  /* 2.483.0: a paper signature's photo rides along with the receipt. Best effort: a missing or too-big photo never blocks the receipt. */
  const atts = [{ filename: 'receipt-' + lineId + '.pdf', content: pdf.toString('base64') }];
  const photoId = line.kind === 'approved' && line.via === 'paper' && record && record.data && record.data.paperPhotoId;
  if (photoId && deps.photo) {
    try { const ph = await deps.photo(siteId, String(photoId)); if (ph && ph.buf && ph.buf.length && ph.buf.length <= PHOTO_MAX) atts.push({ filename: 'paper-signature-' + lineId + (ph.ext || '.jpg'), content: ph.buf.toString('base64') }); } catch (e) { /* receipt goes without it */ }
  }
  const parties = partiesOf(site, line.by);
  const sent = [];
  for (const uid of parties) {
    const claimed = await deps.claim(siteId, lineId, uid);
    if (!claimed) continue;
    const to = await deps.emailOf(uid);
    if (!to) { await deps.release(siteId, lineId, uid); continue; }
    try {
      await deps.sendEmail({ from: deps.from, to, subject: 'SitePlumb receipt: ' + (KIND_WORDS[line.kind] || line.kind) + ' ' + whatOf(line) + (Number.isInteger(line.amountC) ? ' ' + fmtCents(line.amountC) : ''),
        text: emailBody(line, house, line.byName, fp), attachments: atts });
      sent.push(uid);
    } catch (e) { await deps.release(siteId, lineId, uid); throw e; }
  }
  return { fp, sent };
}

/* the real provider: Resend (one HTTPS call, API key in the Functions environment) */
function resendSender(apiKey, fetchFn) {
  return async function sendEmail(m) {
    const r = await (fetchFn || fetch)('https://api.resend.com/emails', { method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, text: m.text, attachments: m.attachments }) });
    if (!r.ok) throw new Error('email provider refused: ' + r.status);
    return r.json ? r.json() : {};
  };
}

module.exports = { PHOTO_MAX, sha256, buildPdf, pdfFor, snapshotOf, canonJson, describe, partiesOf, emailBody, flags, handle, resendSender, _reset, RECEIPT_KINDS };
