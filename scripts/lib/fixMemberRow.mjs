/* One-off repair (Peter 11/23: "Make +sub Metro Appliance on Beaumont"): point one crew's memberInfo at one
   roster row. Pure checks here; scripts/fix-member-row.mjs reads and writes. Nothing here returns a value from
   the database: only ok/refused, reasons, and equal/different/missing. */
export function eqState(a, b) {
  if (a === undefined || a === null || a === '' || b === undefined || b === null || b === '') return 'missing';
  return String(a) === String(b) ? 'equal' : 'different';
}
function roleOf(m) { return String(typeof m === 'string' ? m : ((m && m.role) || '')).toLowerCase(); }

/* site: the sites/<id> doc data; invite: invites/<code> data; claimExists: invites/<code>/claims/<uid> exists */
export function checkFix({ siteId, site, invite, claimExists, uid, row }) {
  const reasons = [];
  site = site || null; invite = invite || null; uid = String(uid || '');
  const r = Number(row);
  if (!site) reasons.push('house not found');
  if (!invite) reasons.push('code not found');
  if (!uid) reasons.push('no uid given');
  if (!Number.isInteger(r) || r < 0) reasons.push('row must be a whole number, 0 or more');
  const meta = (site && site.meta) || {};
  const subs = Array.isArray(meta.subs) ? meta.subs : [];
  const slot = Number.isInteger(r) && r >= 0 ? subs[r] : undefined;
  if (site && !slot) reasons.push('no roster row at that index');
  if (slot && (slot.id === undefined || slot.id === null || slot.id === '' || !slot.name)) reasons.push('roster row has no id or no name');
  if (invite && slot && eqState(slot.id, invite.subId) !== 'equal') reasons.push('roster row id is not the code\'s subId');
  if (invite && eqState(invite.siteId, siteId) !== 'equal') reasons.push('the code is for a different house');
  if (invite && invite.role !== 'sub') reasons.push('the code is not a crew code');
  if (!claimExists) reasons.push('this uid does not hold the code\'s claim');
  const members = (site && (site.members || meta.members)) || {};
  if (site && roleOf(members[uid]) !== 'sub') reasons.push('this uid is not crew on the house');
  const info = (meta.memberInfo || {})[uid];
  if (site && !info) reasons.push('this uid has no memberInfo entry on the house');
  const before = {
    name: eqState(info && info.name, slot && slot.name),
    subId: eqState(info && info.subId, slot && slot.id),
  };
  const ok = reasons.length === 0;
  return {
    ok, reasons, before,
    noop: ok && before.name === 'equal' && before.subId === 'equal',
    /* the only two fields ever written */
    update: ok ? [[['meta', 'memberInfo', uid, 'name'], String(slot.name)], [['meta', 'memberInfo', uid, 'subId'], String(slot.id)]] : null,
  };
}
