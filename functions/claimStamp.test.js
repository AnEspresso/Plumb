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

/* A crew is booked under the roster name the builder chose. The rule
   crewOwnBk() matches booking.subName against memberInfo[uid].name, so the
   stamped name must be the roster name, never what the crew typed at signup
   or their email. The old test passed invite.name === claim.name, which is
   exactly how this slipped through. */
const roster = { code: 'CR', role: 'sub', siteId: 'p1', trade: 'plumb', name: 'Clearwater Plumbing' };
const crewSite = () => ({ members: { b1: 'builder' }, meta: { invites: [{ code: 'CR', role: 'sub', status: 'open' }] } });
for (const typed of ['Mike Chen', 'Clearwater Plumbing LLC', 'mike@gmail.com', 'clearwater plumbing', '']) {
  const got = applyClaimToSite(crewSite(), roster, 'c9', { name: typed, email: 'mike@gmail.com' });
  assert.strictEqual(got.meta.memberInfo.c9.name, 'Clearwater Plumbing',
    'crew who typed ' + JSON.stringify(typed) + ' must be stamped with the roster name');
}
/* A re-stamp of a crew already on the house keeps the roster name too. */
const restamp = applyClaimToSite(
  { members: { b1: 'builder', c9: 'sub' }, meta: { memberInfo: { c9: { name: 'Mike Chen', trade: 'plumb' } } } },
  roster, 'c9', { name: 'Mike Chen' });
assert.strictEqual(restamp.meta.memberInfo.c9.name, 'Clearwater Plumbing', 're-stamp heals a crew stamped with a typed name');
/* An old crew invite that carried no name still falls back to what the crew sent. */
const noRosterName = applyClaimToSite(crewSite(), { code: 'CR', role: 'sub', siteId: 'p1', trade: 'plumb' }, 'c9', { name: 'Lee' });
assert.strictEqual(noRosterName.meta.memberInfo.c9.name, 'Lee', 'crew invite without a roster name keeps the claim name');
/* Homeowner and team are unchanged: they are not matched against bookings. */
const ho = applyClaimToSite({ members: { b1: 'builder' }, meta: {} }, { code: 'HO', role: 'client', siteId: 'p1' }, 'h1', { name: 'Pat Smith' });
assert.strictEqual(ho.meta.memberInfo.h1.name, 'Pat Smith', 'homeowner keeps their own name');
const tm = applyClaimToSite({ members: {}, meta: {} }, { code: 'TM', role: 'team', siteId: '', name: '' }, 't1', { name: 'Sam Lee' });
assert.strictEqual(tm.meta.memberInfo.t1.name, 'Sam Lee', 'teammate keeps their own name');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const claims = rules.split('match /claims/{claimUid}')[1].split('match /orgs/')[0];
assert.ok(claims.indexOf('claimUid == uid()') >= 0, 'claimer can read their claim');
assert.ok(claims.indexOf('createdBy == uid()') >= 0, 'builder who sent it can read claims');
assert.ok(!/allow read:\s*if signedIn\(\);\s*allow create/.test(claims), 'claims are not world-readable');

console.log('claimStamp ok');
