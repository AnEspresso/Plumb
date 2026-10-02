'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyClaimToSite, claimWins } = require('./lib/claimStamp');

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

/* N-2: one code, one person. Pinned here and in rulescheck.js: if either side
   starts letting a second person in on the same code, this fails. */
assert.strictEqual(claimWins('a', [{ id: 'a', at: 5 }]), true, 'the only claim wins');
assert.strictEqual(claimWins('b', [{ id: 'a', at: 5 }, { id: 'b', at: 9 }]), false, 'a second person on a used code is ignored');
assert.strictEqual(claimWins('a', [{ id: 'b', at: 9 }, { id: 'a', at: 5 }]), true, 'the earliest claim wins whatever the list order');
assert.strictEqual(claimWins('b', [{ id: 'a', at: 5 }, { id: 'b', at: 5 }]), false, 'a tie goes to one person only');
assert.strictEqual(claimWins('a', [{ id: 'a', at: 5 }, { id: 'b', at: 5 }]), true, 'a tie goes to one person only (the other one)');
assert.strictEqual(claimWins('c', [{ id: 'a', at: 5 }]), false, 'a claim not on the code never wins');
assert.strictEqual(claimWins('', [{ id: '', at: 1 }]), false, 'no uid never wins');
const fnSrc = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const onClaim = fnSrc.split("exports.onInviteClaim")[1].split('exports.')[0];
assert.ok(/claimWins\(uid, claims\)/.test(onClaim) && onClaim.indexOf('claimWins') < onClaim.indexOf('applyClaimToSite'),
  'onInviteClaim checks one-code-one-person before it stamps a house');
assert.ok(/dropPreview\(code\)/.test(onClaim), 'a used code drops its join-screen preview');
assert.ok(/exports\.onInviteClosed = onDocumentUpdated\('invites\/\{code\}'/.test(fnSrc), 'a revoked code drops its preview on the server');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const claims = rules.split('match /claims/{claimUid}')[1].split('match /orgs/')[0];
assert.ok(claims.indexOf('claimUid == uid()') >= 0, 'claimer can read their claim');
assert.ok(claims.indexOf('createdBy == uid()') >= 0, 'builder who sent it can read claims');
assert.ok(!/allow read:\s*if signedIn\(\);\s*allow create/.test(claims), 'claims are not world-readable');
assert.ok(/getAfter\(inviteDoc\(\)\)\.data\.get\('claimed', false\) == true/.test(claims)
  && /get\(inviteDoc\(\)\)\.data\.get\('claimed', false\) != true/.test(claims),
  'N-2: a claim needs the code unused before and marked used in the same write');

console.log('claimStamp ok');
