'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyClaimToSite } = require('./lib/claimStamp');

const client = applyClaimToSite(
  { members: { b1: 'builder' }, memberUids: ['b1'], meta: { invites: [{ code: 'AB', role: 'client', status: 'open' }] } },
  { code: 'AB', role: 'client', siteId: 'p1' },
  'ho1',
  { name: 'Pat', email: 'pat@example.com' }
);
assert.strictEqual(client.members.ho1, 'client');
assert.ok(client.memberUids.indexOf('ho1') >= 0);
assert.strictEqual(client.members.b1, 'builder');
assert.strictEqual(client.meta.invites[0].status, 'joined');

const noDowngrade = applyClaimToSite(
  { members: { b1: 'builder' }, meta: {} },
  { code: 'AB', role: 'client', siteId: 'p1' },
  'b1',
  {}
);
assert.strictEqual(noDowngrade, null);

const noUpgrade = applyClaimToSite(
  { members: { ho1: 'client' }, meta: {} },
  { code: 'TM', role: 'team', siteId: '' },
  'ho1',
  {}
);
assert.strictEqual(noUpgrade, null);

const crew = applyClaimToSite(
  { members: {}, meta: { invites: [{ code: 'CD', role: 'sub', status: 'open' }] } },
  { code: 'CD', role: 'sub', siteId: 'p1', trade: 'tile', name: 'Lee' },
  'c1',
  { name: 'Lee' }
);
assert.strictEqual(crew.members.c1, 'sub');
assert.strictEqual(crew.meta.memberInfo.c1.trade, 'tile');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const claims = rules.split('match /claims/{claimUid}')[1].split('match /orgs/')[0];
assert.ok(claims.indexOf('claimUid == uid()') >= 0, 'claimer can read their claim');
assert.ok(claims.indexOf('createdBy == uid()') >= 0, 'builder who sent it can read claims');
assert.ok(!/allow read:\s*if signedIn\(\);\s*allow create/.test(claims), 'claims are not world-readable');

console.log('claimStamp ok');
