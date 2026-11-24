#!/usr/bin/env node
/* Checks for the one-off roster-row fix: refuses on every mismatch, writes only the two memberInfo fields,
   and its report carries no values. */
import assert from 'assert';
import { checkFix, eqState } from './lib/fixMemberRow.mjs';

const U = 'uidCREW1';
const base = () => ({
  siteId: 'site1', uid: U, row: 1, claimExists: true,
  invite: { role: 'sub', siteId: 'site1', subId: 's7', name: 'Metro Appliance' },
  site: { members: { [U]: 'sub', b: 'builder' }, meta: {
    subs: [{ id: 's0', name: 'Timberline Framing' }, { id: 's7', name: 'Metro Appliance' }, { id: 's8', name: 'Lakeside Crew' }],
    memberInfo: { [U]: { name: 'Lakeside Crew', email: 'crew@example.com', trade: 'general' } } } },
});
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL: ' + name + ' - ' + e.message); process.exit(1); } };

t('a matching row, code, claim and crew member passes and writes exactly the two fields', () => {
  const r = checkFix(base());
  assert.equal(r.ok, true, r.reasons.join('; '));
  assert.deepEqual(r.before, { name: 'different', subId: 'missing' });
  assert.deepEqual(r.update, [[['meta', 'memberInfo', U, 'name'], 'Metro Appliance'], [['meta', 'memberInfo', U, 'subId'], 's7']]);
});
t('refuses when the row id is not the code subId', () => { const c = base(); c.row = 2; assert.equal(checkFix(c).ok, false); });
t('refuses when the uid holds no claim', () => { const c = base(); c.claimExists = false; assert.equal(checkFix(c).ok, false); });
t('refuses when the uid is not crew on the house', () => { const c = base(); c.site.members[U] = 'client'; assert.equal(checkFix(c).ok, false); });
t('refuses a code for a different house', () => { const c = base(); c.invite.siteId = 'other'; assert.equal(checkFix(c).ok, false); });
t('refuses a missing row, a bad row and missing docs', () => {
  const c = base(); c.row = 9; assert.equal(checkFix(c).ok, false);
  const d = base(); d.row = -1; assert.equal(checkFix(d).ok, false);
  const e = base(); e.site = null; e.invite = null; assert.equal(checkFix(e).ok, false);
});
t('already pointed at the row: a no-op', () => { const c = base(); c.site.meta.memberInfo[U] = { name: 'Metro Appliance', subId: 's7' }; const r = checkFix(c); assert.equal(r.ok && r.noop, true); });
t('legacy {role} member objects count as crew', () => { const c = base(); c.site.members[U] = { role: 'sub' }; assert.equal(checkFix(c).ok, true); });
t('the report (everything but the write list) carries no names, emails or ids', () => {
  const r = checkFix(base()); const { update, ...report } = r; const s = JSON.stringify(report);
  ['Metro Appliance', 'Lakeside Crew', 'crew@example.com', 's7', U].forEach(v => assert.equal(s.indexOf(v), -1, v));
  const bad = checkFix(Object.assign(base(), { claimExists: false })); assert.equal(JSON.stringify(bad).indexOf('Metro'), -1);
});
t('eqState never returns a value', () => { assert.equal(eqState('a', 'a'), 'equal'); assert.equal(eqState('a', 'b'), 'different'); assert.equal(eqState(undefined, 'b'), 'missing'); });
console.log('fixMemberRow test: ' + n + ' checks passed');
