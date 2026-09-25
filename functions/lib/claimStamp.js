'use strict';

/* Pure membership stamp. The invite is the authority.
   A client or crew claim never becomes a builder.
   A team claim never turns a homeowner or crew into a builder on that house. */

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
  members[uid] = role;
  const prev = info[uid] || {};
  info[uid] = Object.assign({}, prev, {
    name: String(claim.name || invite.name || prev.name || '').slice(0, 80),
    email: String(claim.email || prev.email || '').slice(0, 120),
    trade: String(invite.trade || prev.trade || ''),
  });
  if (invite.rpRole) info[uid].rpRole = invite.rpRole;
  if (invite.gates) info[uid].gates = invite.gates;
  const invites = Array.isArray(meta.invites) ? meta.invites.map(function (i) {
    if (!i || i.code !== invite.code) return i;
    return Object.assign({}, i, { status: 'joined', uid: uid });
  }) : meta.invites;
  meta.members = members;
  meta.memberInfo = info;
  if (invites) meta.invites = invites;
  return { members: members, memberUids: Object.keys(members), meta: meta };
}

module.exports = { applyClaimToSite };
