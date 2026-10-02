#!/usr/bin/env node
/**
 * One-time Release D backfill for invites made before 2.447.0.
 *  1. Single use (N-2): an invite that already has a claim gets claimed:true
 *     (and claimedAt from the earliest claim), so the rules refuse a second claim.
 *  2. Show the house first (option B): an open invite (not revoked, not claimed,
 *     no claims) gets invitePreviews/{code} = { builder, street } and nothing else.
 *     Previews of revoked or used invites are deleted.
 * Never changes who can read invites/{code}. Codes are printed redacted.
 *
 * Env:
 *   BACKFILL_CONFIRM 1 to write, otherwise dry run (prints what it would do)
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'plumb-467a0' });
const db = getFirestore();
const confirm = process.env.BACKFILL_CONFIRM === '1';
const red = (c) => String(c || '').slice(0, 4) + '…';
const s = (v, n) => String(v || '').trim().slice(0, n);

const orgs = (await db.collection('orgs').get()).docs.map((d) => d.data() || {});
function builderName(uid, site) {
  const org = orgs.find((o) => o.members && o.members[uid] === 'builder' && o.prefs && o.prefs.company);
  if (org) return s(org.prefs.company, 80);
  const meta = (site && site.meta) || {};
  const info = (meta.memberInfo || (site && site.memberInfo) || {})[uid] || {};
  return s(info.name, 80);
}
function streetOf(site) {
  const meta = (site && site.meta) || {};
  return s(meta.street || meta.name || (site && (site.street || site.name)), 120);
}

const siteCache = new Map();
async function site(id) {
  if (!id) return null;
  if (!siteCache.has(id)) {
    const snap = await db.collection('sites').doc(String(id)).get();
    siteCache.set(id, snap.exists ? snap.data() : null);
  }
  return siteCache.get(id);
}

let stamped = 0, previews = 0, dropped = 0, skipped = 0;
for (const doc of (await db.collection('invites').get()).docs) {
  const inv = doc.data() || {};
  const code = doc.id;
  const claims = (await doc.ref.collection('claims').get()).docs;
  const used = inv.claimed === true || claims.length > 0;
  if (claims.length && inv.claimed !== true) {
    const first = Math.min(...claims.map((c) => c.createTime.toMillis()));
    console.log(`stamp claimed  ${red(code)}  (${claims.length} claim${claims.length > 1 ? 's' : ''})`);
    if (confirm) await doc.ref.update({ claimed: true, claimedAt: first });
    stamped++;
  }
  const pref = db.collection('invitePreviews').doc(code);
  if (inv.revoked === true || used) {
    if ((await pref.get()).exists) {
      console.log(`drop preview   ${red(code)}`);
      if (confirm) await pref.delete();
      dropped++;
    }
    continue;
  }
  const st = await site(inv.siteId);
  const fields = { builder: builderName(inv.createdBy, st), street: streetOf(st) };
  if (!fields.builder && !fields.street) { skipped++; continue; }
  console.log(`write preview  ${red(code)}  builder:${fields.builder ? 'yes' : 'no'} street:${fields.street ? 'yes' : 'no'}`);
  if (confirm) await pref.set(fields);
  previews++;
}
console.log(`${confirm ? 'DONE' : 'DRY RUN'}: ${stamped} stamped claimed, ${previews} previews, ${dropped} previews dropped, ${skipped} open with nothing to show`);
