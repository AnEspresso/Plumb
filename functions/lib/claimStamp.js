'use strict';

/* Pure membership stamp. The invite is the authority.
   A client or crew claim never becomes a builder.
   A team claim never turns a homeowner or crew into a builder on that house. */

/* #1 (pre-launch review): the invite is the authority only when the person
   who made it may hand out that access. Same owner model as the rules'
   isOwner(): a builder on the house with no roster entry, or one marked owner.
   A money builder passes the rules' moneyOk() gates. Members may be strings
   ('builder') or a legacy {role} object. */
function roleOn(site, uid) {
  const m = ((site || {}).members || {})[String(uid || '')];
  if (m == null) return '';
  return String(typeof m === 'string' ? m : (m.role || '')).toLowerCase();
}
function infoOn(site, uid) {
  const mi = (((site || {}).meta || {}).memberInfo) || {};
  return Object.prototype.hasOwnProperty.call(mi, String(uid || '')) ? (mi[uid] || {}) : null;
}
function isOwnerOn(site, uid) {
  if (!uid || roleOn(site, uid) !== 'builder') return false;
  const info = infoOn(site, uid);
  return !info || info.rpRole === 'owner' || info.owner === true;
}
function isMoneyBuilderOn(site, uid) {
  if (!uid || roleOn(site, uid) !== 'builder') return false;
  if (isOwnerOn(site, uid)) return true;
  const g = (infoOn(site, uid) || {}).gates || {};
  return g.moneyJob === true || g.moneyJob === 1 || g.moneyCo === true || g.moneyCo === 1;
}
/* May the invite's creator still hand out this access on this house, right now?
   Homeowner or crew: the owner or a money builder of the house. Team: only the
   owner (a team claim reaches every house its creator owns, nothing more). */
function inviterOk(site, invite) {
  invite = invite || {};
  const by = String(invite.createdBy || '');
  if (!by) return false;
  if (invite.role === 'team') return isOwnerOn(site, by);
  if (invite.role === 'client' || invite.role === 'sub') return isMoneyBuilderOn(site, by);
  return false;
}

/* 2.515.0: a uid already the homeowner (client) on this house must not be
   stamped as crew. Members may be a role string or a legacy {role} object,
   and may live on the house or on meta. */
function isHomeownerOn(site, uid) {
  uid = String(uid || '');
  if (!uid) return false;
  const members = (site || {}).members || ((site || {}).meta || {}).members || {};
  const cur = members[uid];
  return String(typeof cur === 'string' ? cur : ((cur && cur.role) || '')).toLowerCase() === 'client';
}

function applyClaimToSite(site, invite, uid, claim) {
  site = site || {};
  invite = invite || {};
  claim = claim || {};
  uid = String(uid || '');
  if (!uid || invite.revoked) return null;
  const role = invite.role === 'client' ? 'client'
    : (invite.role === 'team' ? 'builder'
      : (invite.role === 'sub' ? 'sub' : ''));
  if (!role) return null;
  if (role !== 'builder' && !invite.siteId) return null;
  const meta = Object.assign({}, site.meta || {});
  const members = Object.assign({}, site.members || meta.members || {});
  const info = Object.assign({}, meta.memberInfo || {});
  const cur = members[uid];
  if (role === 'builder' && (cur === 'client' || cur === 'sub')) return null;
  if (cur === 'builder' && role !== 'builder') return null;
  if (role === 'sub' && isHomeownerOn(site, uid)) return null;
  members[uid] = role;
  const prev = info[uid] || {};
  /* A crew is booked under the roster name on the invite, and the rule
     crewOwnBk() matches booking.subName against this stamped name. Take the
     roster name first for a crew, or a crew who typed their own name (or an
     email) at signup sees an empty schedule. Homeowner and team keep what they
     typed: they are not matched against bookings. */
  const rosterFirst = role === 'sub';
  const name = rosterFirst
    ? (invite.name || claim.name || prev.name)
    : (claim.name || invite.name || prev.name);
  info[uid] = Object.assign({}, prev, {
    name: String(name || '').slice(0, 80),
    email: String(claim.email || prev.email || '').slice(0, 120),
    trade: String(invite.trade || prev.trade || ''),
  });
  /* An owner may hand out a role and money gates; nobody else may. */
  if (isOwnerOn(site, invite.createdBy)) {
    if (invite.rpRole) info[uid].rpRole = invite.rpRole;
    if (invite.gates) info[uid].gates = invite.gates;
  }
  const invites = Array.isArray(meta.invites) ? meta.invites.map(function (i) {
    if (!i || i.code !== invite.code) return i;
    return Object.assign({}, i, { status: 'joined', uid: uid });
  }) : meta.invites;
  meta.members = members;
  meta.memberInfo = info;
  if (invites) meta.invites = invites;
  return { members: members, memberUids: Object.keys(members), meta: meta };
}

/* N-2 (Release D): one code, one person. The rules let only the first person
   claim a code, and the server holds the same line on its own: of every claim
   on a code, only the earliest (server create time, then uid) may stamp a
   house. A claim that is not in the list, or loses, is ignored. */
function claimWins(uid, claims) {
  uid = String(uid || '');
  if (!uid) return false;
  const list = (claims || []).filter(function (c) { return c && c.id; }).slice();
  if (!list.some(function (c) { return String(c.id) === uid; })) return false;
  list.sort(function (a, b) {
    return ((Number(a.at) || 0) - (Number(b.at) || 0)) || String(a.id).localeCompare(String(b.id));
  });
  return String(list[0].id) === uid;
}

module.exports = { applyClaimToSite, claimWins, inviterOk, isOwnerOn, isMoneyBuilderOn, isHomeownerOn };
