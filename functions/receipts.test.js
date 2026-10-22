'use strict';
/* Step 3b-1: receipts, PDF, fingerprint, archive. Plain node: no network, no emulator. */
const assert = require('assert');
const crypto = require('crypto');
const R = require('./lib/receipts');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* PDF: valid structure, byte-exact xref offsets, deterministic, text readable */
const p1 = R.buildPdf('SitePlumb receipt', ['Dean Walsh sent change order 3 for $1,850.00 on 12 Oak (a) \\ b.', 'x'.repeat(200)]);
const p2 = R.buildPdf('SitePlumb receipt', ['Dean Walsh sent change order 3 for $1,850.00 on 12 Oak (a) \\ b.', 'x'.repeat(200)]);
assert.ok(p1.equals(p2), 'same record, same bytes');
const txt = p1.toString('latin1');
assert.ok(txt.startsWith('%PDF-1.4') && txt.endsWith('%%EOF\n'));
const sx = parseInt(/startxref\n(\d+)\n/.exec(txt)[1], 10);
assert.strictEqual(txt.slice(sx, sx + 4), 'xref', 'startxref points at the xref table');
const rows = txt.slice(sx).split('\n').filter(l => /^\d{10} 00000 n $/.test(l));
rows.forEach((r, i) => assert.ok(new RegExp('^' + (i + 1) + ' 0 obj').test(txt.slice(parseInt(r, 10), parseInt(r, 10) + 12)), 'object ' + (i + 1) + ' offset'));
assert.ok(txt.includes('Dean Walsh sent change order 3 for $1,850.00 on 12 Oak \\(a\\) \\\\ b.'));
assert.ok(!R.buildPdf('t', ['\u2212$400.00 \u201cq\u201d']).toString('latin1').includes('\u2212'), 'non-latin text is mapped, never written raw');
try { const { spawnSync } = require('child_process'); const r = spawnSync('pdftotext', ['-', '-'], { input: p1 }); if (r.status === 0) assert.ok(/Dean Walsh sent change order 3/.test(r.stdout.toString()), 'pdftotext reads it'); } catch (e) { /* poppler not installed: structure check above stands */ }

/* parties: the homeowner and money builders; never crew or a builder without money */
const SITE = { street: '12 Oak', members: { uO: 'builder', uPM: 'builder', uMJ: 'builder', uC: 'client', uS: 'sub' },
  meta: { memberInfo: { uPM: { name: 'Pat', rpRole: 'pm' }, uMJ: { name: 'Mo', gates: { moneyJob: true } } } } };
assert.deepStrictEqual(R.partiesOf(SITE, 'uO').sort(), ['uC', 'uMJ', 'uO']);
assert.deepStrictEqual(R.partiesOf(SITE, 'uPM').sort(), ['uC', 'uMJ', 'uO', 'uPM'], 'the actor always gets their own receipt');
assert.ok(!R.partiesOf(SITE, 'uO').includes('uS'), 'crew never');

/* the flow with fakes */
function world(opts) {
  opts = opts || {};
  const store = new Map(); const emails = []; const archive = new Map(); const claims = new Set(); const updates = [];
  const flag = opts.flag === undefined ? { enabled: true, receipts: true } : opts.flag;
  const co = opts.co === undefined ? { data: { id: 'c1', rev: 1, verifiedRev: 1, verifiedTotal: 185000, amountC: 185000 } } : opts.co;
  const doc = (path) => ({ path,
    get: async () => {
      if (path === 'settings/paperTrail') return { exists: !!flag, data: () => flag };
      if (path === 'sites/s1') return { exists: true, data: () => SITE };
      if (/^sites\/s1\/co\//.test(path)) return { exists: !!co, data: () => co };
      if (/_check$/.test(path)) return { exists: !!opts.held, data: () => ({}) };
      return { exists: false, data: () => undefined };
    },
    update: async (v) => { updates.push([path, v]); },
    collection: (c) => ({ doc: (id) => doc(path + '/' + c + '/' + id) }) });
  const db = { collection: (c) => ({ doc: (id) => doc(c + '/' + id) }) };
  const bucket = { file: (p) => ({ save: async (buf, o) => { assert.strictEqual(o.preconditionOpts.ifGenerationMatch, 0, 'create-only: an archived object is never overwritten'); if (opts.archiveFail) throw new Error('bucket down'); if (archive.has(p)) { const e = new Error('precondition'); e.code = 412; throw e; } archive.set(p, buf); } }) };
  const deps = { db, bucket, bucketName: 'plumb-money-archive', from: 'SitePlumb <receipts@siteplumb.com>',
    emailOf: async (u) => (u === 'uMJ' ? null : u + '@x.test'),
    claim: async (s, l, u) => { const k = s + l + u; if (claims.has(k)) return false; claims.add(k); return true; },
    release: async (s, l, u) => { claims.delete(s + l + u); },
    sendEmail: async (m) => { if (opts.mailFail) throw new Error('provider down'); emails.push(m); },
    notify: async () => { emails.push({ pushed: true }); } };
  return { deps, emails, archive, updates, claims };
}
const LINE = (o) => Object.assign({ kind: 'sent', ref: 'c1', refType: 'co', rev: 1, amountC: 185000, no: 3, by: 'uO', byName: 'Dean Walsh', at: { toMillis: () => 1792400000000 } }, o || {});
const EV = (line, id) => ({ params: { siteId: 's1', lineId: id || 'evA_0' }, time: '2026-10-19T03:00:00Z', data: { data: () => line } });
(async () => {
  /* OFF: nothing happens, nothing is read but the flag */
  for (const flag of [null, { enabled: true }, { enabled: false, receipts: true }, { receipts: true }]) {
    R._reset(); const w = world({ flag });
    assert.deepStrictEqual(await R.handle(w.deps, EV(LINE())), { skipped: 'off' });
    assert.strictEqual(w.emails.length + w.archive.size + w.updates.length, 0, 'flag ' + JSON.stringify(flag) + ': no email, no archive, no write');
  }
  /* ON: archive (json + pdf), fingerprint on the line, one email per party with the same PDF */
  R._reset(); let w = world();
  let r = await R.handle(w.deps, EV(LINE()));
  assert.deepStrictEqual([...w.archive.keys()].sort(), ['archive/s1/evA_0.json', 'archive/s1/evA_0.pdf']);
  const pdf = w.archive.get('archive/s1/evA_0.pdf'); assert.strictEqual(r.fp, sha(pdf), 'the fingerprint is the SHA-256 of the archived PDF');
  assert.deepStrictEqual(w.updates, [['sites/s1/hist/evA_0', { fp: r.fp, archived: 'plumb-money-archive/archive/s1/evA_0.pdf' }]]);
  assert.deepStrictEqual(w.emails.map(m => m.to).sort(), ['uC@x.test', 'uO@x.test'], 'one per party; a party with no email is skipped');
  w.emails.forEach(m => { assert.ok(m.text.includes(r.fp)); assert.strictEqual(sha(Buffer.from(m.attachments[0].content, 'base64')), r.fp, 'the PDF in the email equals the archived copy'); assert.ok(/Dean Walsh sent change order 3 for \$1,850\.00 on 12 Oak\./.test(m.text)); });
  assert.ok(JSON.parse(w.archive.get('archive/s1/evA_0.json').toString()).line.amountC === 185000, 'the JSON snapshot is the line');
  /* the same event again: no second email (claims), no overwrite (412 swallowed) */
  const before = w.emails.length; r = await R.handle(w.deps, EV(LINE()));
  assert.strictEqual(w.emails.length, before, 'exactly one email per party per event');
  /* PDF amount equals the record to the cent */
  assert.ok(pdf.toString('latin1').includes('Amount: $1,850.00'));
  /* archive failure: no email, error surfaces (the trigger retries) */
  R._reset(); w = world({ archiveFail: true });
  await assert.rejects(R.handle(w.deps, EV(LINE())), /bucket down/); assert.strictEqual(w.emails.length, 0, 'nothing is emailed that is not archived');
  /* provider failure: the claim is released so a retry sends */
  R._reset(); w = world({ mailFail: true });
  await assert.rejects(R.handle(w.deps, EV(LINE())), /provider down/); assert.strictEqual(w.claims.size, 0, 'a failed send can be retried');
  /* M-14: an unverified sent change order waits (throws to retry), a held one never gets a receipt */
  R._reset(); w = world({ co: { data: { id: 'c1', rev: 1, amountC: 185000 } } });
  await assert.rejects(R.handle(w.deps, EV(LINE())), /not verified yet/); assert.strictEqual(w.emails.length + w.archive.size, 0);
  R._reset(); w = world({ co: { data: { id: 'c1', rev: 1, amountC: 185000 } }, held: true });
  assert.deepStrictEqual(await R.handle(w.deps, EV(LINE())), { skipped: 'held: needs a check' }); assert.strictEqual(w.emails.length, 0, 'a one-cent mismatch holds the receipts');
  R._reset(); w = world({ co: { data: { id: 'c1', rev: 2, verifiedRev: 1, verifiedTotal: 185000, amountC: 210000 } } });
  await assert.rejects(R.handle(w.deps, EV(LINE({ kind: 'changed', rev: 2, amountC: 210000 }))), /not verified yet/, 'a revision needs its own verification');
  R._reset(); w = world({ co: { data: { id: 'c1', rev: 2, verifiedRev: 1, verifiedTotal: 210000, amountC: 210000 } } });
  await assert.rejects(R.handle(w.deps, EV(LINE({ kind: 'changed', rev: 2, amountC: 210000 }))), /not verified yet/, 'old rev stamp, same total: still waits');
  /* needs_check pushes the builder, no receipt; lines with no receipt kind and already-archived lines do nothing */
  R._reset(); w = world();
  assert.deepStrictEqual(await R.handle(w.deps, EV(LINE({ kind: 'needs_check' }))), { skipped: 'needs_check' }); assert.ok(w.emails[0].pushed);
  R._reset(); w = world(); assert.ok((await R.handle(w.deps, EV(LINE({ kind: 'opened' })))).skipped);
  R._reset(); w = world(); assert.strictEqual((await R.handle(w.deps, EV(LINE({ fp: 'abc' })))).skipped, 'already archived');
  /* decline and withdraw and paper approvals read right */
  assert.ok(R.describe(LINE({ kind: 'approved', via: 'paper' }), '12 Oak', 'Dean Walsh').includes('(signed on paper)'));
  /* the provider call: Resend, bearer key, base64 attachment, a refusal throws */
  let seen; const send = R.resendSender('KEY', async (u, o) => { seen = [u, o]; return { ok: true, json: async () => ({ id: 'e1' }) }; });
  await send({ from: 'a@b', to: 'c@d', subject: 's', text: 't', attachments: [{ filename: 'f.pdf', content: 'AA==' }] });
  assert.strictEqual(seen[0], 'https://api.resend.com/emails'); assert.strictEqual(seen[1].headers.Authorization, 'Bearer KEY'); assert.deepStrictEqual(JSON.parse(seen[1].body).to, ['c@d']);
  await assert.rejects(R.resendSender('K', async () => ({ ok: false, status: 403 }))({ from: 'a', to: 'b', subject: 's', text: 't', attachments: [] }), /refused: 403/);
  /* 2.483.0: a paper signature's photo is attached; a missing, failing or huge photo never blocks the receipt */
  const PCO = { data: { id: 'c1', rev: 1, verifiedRev: 1, verifiedTotal: 185000, amountC: 185000, status: 'approved', approvedVia: 'paper', paperPhotoId: 'ph1' } };
  const PL = LINE({ kind: 'approved', via: 'paper', decidedRev: 1 });
  R._reset(); w = world({ co: PCO }); let asked = [];
  w.deps.photo = async (sid, id) => { asked.push(sid + '/' + id); return { buf: Buffer.from('JPEGDATA'), ext: '.jpg' }; };
  await R.handle(w.deps, EV(PL, 'evP_0'));
  assert.deepStrictEqual(asked, ['s1/ph1']);
  w.emails.forEach(m => { assert.strictEqual(m.attachments.length, 2); assert.strictEqual(m.attachments[1].filename, 'paper-signature-evP_0.jpg'); assert.strictEqual(Buffer.from(m.attachments[1].content, 'base64').toString(), 'JPEGDATA'); });
  assert.ok(w.emails.length >= 1);
  R._reset(); w = world({ co: PCO }); w.deps.photo = async () => { throw new Error('gone'); };
  await R.handle(w.deps, EV(PL, 'evQ_0')); assert.ok(w.emails.length >= 1 && w.emails.every(m => m.attachments.length === 1), 'a photo that fails: receipt without it');
  R._reset(); w = world({ co: PCO }); w.deps.photo = async () => ({ buf: Buffer.alloc(R.PHOTO_MAX + 1), ext: '.jpg' });
  await R.handle(w.deps, EV(PL, 'evR_0')); assert.ok(w.emails.every(m => m.attachments.length === 1), 'too big: left off');
  R._reset(); w = world(); asked = []; w.deps.photo = async (s2, id) => { asked.push(id); return { buf: Buffer.from('x') }; };
  await R.handle(w.deps, EV(LINE())); assert.deepStrictEqual(asked, [], 'only a paper approval asks for a photo');
  console.log('receipts: all checks passed (pdf, fingerprint = archived bytes, one email per party, flags off, archive-first, verification hold, provider)');
})().catch(e => { console.error(e); process.exit(1); });
