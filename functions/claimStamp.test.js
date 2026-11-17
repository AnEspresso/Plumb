'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { applyClaimToSite, claimWins, inviterOk, isOwnerOn, isMoneyBuilderOn } = require('./lib/claimStamp');

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

/* #1 (pre-launch review): who may hand out access, re-checked at claim time. */
const HOUSE = () => ({
  members: { own: 'builder', pm: 'builder', pmMoney: 'builder', crewX: 'sub', ho: 'client' },
  memberUids: ['own', 'pm', 'pmMoney', 'crewX', 'ho'],
  meta: { memberInfo: { pm: { name: 'Pat', rpRole: 'pm' }, pmMoney: { name: 'Mo', rpRole: 'pm', gates: { moneyJob: true } },
    crewX: { name: 'Crew X', trade: 'plumb' }, ho: { name: 'Ana' } } },
});
assert.strictEqual(isOwnerOn(HOUSE(), 'own'), true, 'a builder with no roster entry is the owner');
assert.strictEqual(isOwnerOn(HOUSE(), 'pm'), false, 'a PM is not the owner');
assert.strictEqual(isOwnerOn({ members: { o2: 'builder' }, meta: { memberInfo: { o2: { rpRole: 'owner' } } } }, 'o2'), true, 'rpRole owner is the owner');
assert.strictEqual(isOwnerOn(HOUSE(), 'crewX'), false, 'a crew is never the owner');
assert.strictEqual(isMoneyBuilderOn(HOUSE(), 'pmMoney'), true);
assert.strictEqual(isMoneyBuilderOn(HOUSE(), 'pm'), false);
/* Legitimate invites still work. */
assert.strictEqual(inviterOk(HOUSE(), { role: 'client', siteId: 'h', createdBy: 'own' }), true, 'owner invites a homeowner');
assert.strictEqual(inviterOk(HOUSE(), { role: 'sub', siteId: 'h', createdBy: 'pmMoney' }), true, 'money builder invites a crew');
assert.strictEqual(inviterOk(HOUSE(), { role: 'team', createdBy: 'own' }), true, 'owner invites a teammate');
const legit = applyClaimToSite(HOUSE(), { code: 'TM1', role: 'team', createdBy: 'own', rpRole: 'pm', gates: { moneyJob: true } }, 'newPm', { name: 'New PM' });
assert.strictEqual(legit.members.newPm, 'builder');
assert.deepStrictEqual(legit.meta.memberInfo.newPm.gates, { moneyJob: true }, 'an owner hands out gates');
assert.strictEqual(legit.meta.memberInfo.newPm.rpRole, 'pm');
/* The exploit: crew X makes a team code (owner role, money gates) and claims it with a second account Y. */
const forged = { code: 'EVIL', role: 'team', createdBy: 'crewX', rpRole: 'owner', gates: { moneyJob: true, moneyCo: true } };
assert.strictEqual(inviterOk(HOUSE(), forged), false, 'a crew-made team code grants nothing on a house the crew does not own');
const leaked = applyClaimToSite(HOUSE(), forged, 'acctY', {});
assert.ok(!leaked.meta.memberInfo.acctY.rpRole && !leaked.meta.memberInfo.acctY.gates, 'even if stamped, a non-owner code carries no role or gates');
assert.strictEqual(inviterOk(HOUSE(), { role: 'client', siteId: 'h', createdBy: 'crewX' }), false, 'a crew cannot make a homeowner code');
assert.strictEqual(inviterOk(HOUSE(), { role: 'sub', siteId: 'h', createdBy: 'ho' }), false, 'a homeowner cannot make a crew code');
assert.strictEqual(inviterOk(HOUSE(), { role: 'client', siteId: 'h', createdBy: 'stranger' }), false, 'a stranger cannot make a code for a house they are not on');
assert.strictEqual(inviterOk(HOUSE(), { role: 'client', siteId: 'h', createdBy: 'pm' }), false, 'a builder without money cannot make a homeowner code');
assert.strictEqual(inviterOk(HOUSE(), { role: 'team', createdBy: 'pmMoney' }), false, 'only the owner makes team codes');
assert.strictEqual(inviterOk(HOUSE(), { role: 'client', siteId: 'h' }), false, 'a code with no creator grants nothing');
assert.strictEqual(inviterOk(HOUSE(), { role: 'builder', createdBy: 'own' }), false, 'unknown roles grant nothing');
const mbGrant = applyClaimToSite(HOUSE(), { code: 'C2', role: 'client', siteId: 'h', createdBy: 'pmMoney', rpRole: 'owner', gates: { moneyJob: true } }, 'ho2', {});
assert.ok(!mbGrant.meta.memberInfo.ho2.rpRole && !mbGrant.meta.memberInfo.ho2.gates, 'a money builder cannot hand out a role or gates');
/* The server runs the check before it stamps, on every house it would touch. */
{
  const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').split('exports.onInviteClaim')[1].split('exports.')[0];
  assert.ok(/inviterOk\(/.test(src) && src.indexOf('inviterOk(') < src.indexOf('applyClaimToSite('), 'onInviteClaim re-checks the creator before stamping');
  assert.ok(/for \(const doc of allowed\)/.test(src), 'only allowed houses are stamped');
}

console.log('claimStamp ok');
