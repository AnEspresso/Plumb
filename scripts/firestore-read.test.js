#!/usr/bin/env node
/* Proves scripts/firestore-read.js logs only counts, doc IDs, field names and
   value types — never field values (addresses, names, emails, phones, amounts). */
'use strict';

const assert = require('assert');
const { parseCheck, valueAt, compareValues, formatCheck, parsePaths, shape, formatDoc, formatCollection, formatError, docPath } = require('./firestore-read.js');

/* fake push tokens, built at run time so the secret scan never sees a literal */
const FAKE_FCM = 'fake' + ':APA91b' + 'x'.repeat(60);
const FAKE_WEB = 'w'.repeat(50);

const FORBIDDEN = [
  '7 Cottage Ln',
  'The Cottage',
  'pmgottschalkqa+home@gmail.com',
  'pmgottschalkqa+sub@gmail.com',
  '734-555-0100',
  '+17345550100',
  'Jane Builder',
  'paid by Jane',
  '125000',
  'Ann Arbor',
  'PERMISSION_DENIED: street is secret',
  FAKE_FCM,
  FAKE_WEB
];

function fakeDoc(id, fields) {
  return {
    name: 'projects/plumb-467a0/databases/(default)/documents/sites/' + id,
    fields: fields
  };
}

const sample = fakeDoc('abc123', {
  street: { stringValue: '7 Cottage Ln' },
  name: { stringValue: 'The Cottage' },
  city: { stringValue: 'Ann Arbor' },
  email: { stringValue: 'pmgottschalkqa+home@gmail.com' },
  phone: { stringValue: '734-555-0100' },
  mobile: { stringValue: '+17345550100' },
  members: { mapValue: { fields: {
    u1: { stringValue: 'Jane Builder' },
    'pmgottschalkqa+sub@gmail.com': { stringValue: 'sub' }
  } } },
  payments: { arrayValue: { values: [
    { integerValue: '125000' },
    { mapValue: { fields: { note: { stringValue: 'paid by Jane' }, amountC: { integerValue: '125000' } } } }
  ] } },
  active: { booleanValue: true },
  openedAt: { timestampValue: '2026-11-17T15:00:00Z' },
  loc: { geoPointValue: { latitude: 42.28, longitude: -83.74 } },
  none: { nullValue: null }
});

function checkClean(label, text) {
  const s = String(text);
  FORBIDDEN.forEach(function (v) {
    assert.equal(s.indexOf(v), -1, label + ' leaked ' + JSON.stringify(v) + ':\n' + s);
  });
}

let n = 0;
function t(name, fn) {
  try { fn(); n++; }
  catch (e) { console.error('FAIL: ' + name + ' — ' + e.message); process.exit(1); }
}

t('parsePaths accepts a collection and a doc', function () {
  const p = parsePaths('sites,sites/abc123');
  assert.equal(p[0].kind, 'collection');
  assert.equal(p[1].kind, 'doc');
});

t('parsePaths rejects a bad segment without echoing it', function () {
  let msg = '';
  try { parsePaths('sites/7 Cottage Ln'); } catch (e) { msg = e.message; }
  assert.equal(msg, 'Rejected path.');
  checkClean('parsePaths error', msg);
});

t('shape keeps names and types, never values', function () {
  const s = shape(sample.fields);
  assert.equal(s.street, 'string');
  assert.equal(s.email, 'string');
  assert.equal(s.phone, 'string');
  assert.equal(s.active, 'boolean');
  assert.equal(s.openedAt, 'timestamp');
  assert.equal(s.loc, 'geopoint');
  assert.equal(s.none, 'null');
  assert.equal(s.payments.type, 'array');
  assert.equal(s.payments.length, 2);
  assert.equal(s.payments.items[0], 'integer');
  assert.equal(s.members.type, 'map');
  assert.equal(s.members.fields.u1, 'string');
  assert.equal(s.members.fields['(key)'], 'string');
  assert.equal('pmgottschalkqa+sub@gmail.com' in s.members.fields, false);
  checkClean('shape JSON', JSON.stringify(s));
});

t('formatDoc prints path, count, field names and types, no values', function () {
  const out = formatDoc(docPath(sample.name), sample);
  assert.equal(out.indexOf('=== sites/abc123') >= 0, true, out);
  assert.equal(out.indexOf('12 field(s)') >= 0, true, out);
  assert.equal(out.indexOf('(key)')>=0, true, out);
  ['street', 'name', 'city', 'email', 'phone', 'mobile', 'members', 'payments', 'active', 'openedAt', 'loc', 'none', 'amountC', 'note'].forEach(function (k) {
    assert.equal(out.indexOf(k) >= 0, true, 'missing field name ' + k + ':\n' + out);
  });
  ['string', 'integer', 'boolean', 'timestamp', 'geopoint', 'null', 'map', 'array[2]'].forEach(function (k) {
    assert.equal(out.indexOf(k) >= 0, true, 'missing type ' + k + ':\n' + out);
  });
  checkClean('formatDoc', out);
});

t('formatCollection prints the count and each doc id, no values', function () {
  const out = formatCollection('sites', [sample, fakeDoc('zzz', { street: { stringValue: '7 Cottage Ln' } })], true);
  assert.equal(out.indexOf('### sites: 2 doc(s) (capped at 50)') >= 0, true, out);
  assert.equal(out.indexOf('=== sites/abc123') >= 0, true, out);
  assert.equal(out.indexOf('=== sites/zzz') >= 0, true, out);
  checkClean('formatCollection', out);
});

t('formatDoc of a missing doc has no values', function () {
  const out = formatDoc('sites/gone', null);
  assert.equal(out, '=== sites/gone\n(missing)');
});

t('formatError never echoes a response body', function () {
  const out = formatError('sites/abc123', new Error('PERMISSION_DENIED: street is secret'));
  assert.equal(out, '=== sites/abc123\nREAD FAILED');
  checkClean('formatError', out);
});

t('EQ: compares two stored values and prints only equal, different or missing', function () {
  const c = parseCheck('eq:sites/abc123#members.u1=sites/abc123#payments.1.note');
  const out = [
    formatCheck(c.label, compareValues(valueAt(sample, c.a.field), valueAt(sample, c.b.field))),
    formatCheck('x', compareValues(valueAt(sample, ['payments', '0']), valueAt(sample, ['payments', '1', 'amountC']))),
    formatCheck('y', compareValues(valueAt(sample, ['street']), valueAt(sample, ['nope']))),
    formatCheck('z', compareValues(valueAt(sample, ['__id']), { stringValue: 'abc123' }))
  ];
  assert.ok(/: different$/.test(out[0]) && /: equal$/.test(out[1]) && /: missing$/.test(out[2]) && /: equal$/.test(out[3]), out.join('\n'));
  checkClean('EQ output', out.join('\n'));
});

t('EQ: no literals, no bad paths, and a rejection never echoes the entry', function () {
  ['eq:sites/abc123#street=7 Cottage Ln', 'eq:sites/abc123#street', 'eq:sites#street=sites/abc123#city', 'eq:sites/abc123#street=sites/abc123#a.__id', 'eq:sites/7 Cottage Ln#x=sites/a#y']
    .forEach(function (e) { let msg = ''; try { parseCheck(e); } catch (x) { msg = x.message; } assert.equal(msg, 'Rejected check.', e); checkClean('EQ rejection', msg); });
});

t('EQ entries are left out of the path list', function () {
  const p = parsePaths('sites/abc123,eq:sites/abc123#a=sites/abc123#b');
  assert.equal(p.length, 1);
});

t('push-token maps print only a key count, never a token (users/{uid}.fcm, Peter 11/23)', function () {
  const u = fakeDoc('uid1', {
    name: { stringValue: 'Jane Builder' },
    fcm: { mapValue: { fields: {
      [FAKE_FCM]: { integerValue: '1' },
      [FAKE_WEB]: { integerValue: '2' }
    } } },
    other: { mapValue: { fields: {
      [FAKE_FCM]: { integerValue: '1' },
      u2: { stringValue: 'sub' }
    } } }
  });
  const s = shape(u.fields);
  assert.equal(s.fcm.type, 'redacted');
  assert.equal(s.fcm.count, 2);
  assert.equal(s.other.fields.u2, 'string');
  assert.equal(s.other.fields['(token keys)'].count, 1);
  const out = formatDoc(docPath(u.name), u);
  assert.equal(out.indexOf('fcm: {<2 keys>}') >= 0, true, out);
  assert.equal(/APA91/.test(out), false, out);
  checkClean('token map', out);
});

console.log('firestore-read test: ' + n + ' checks passed');
