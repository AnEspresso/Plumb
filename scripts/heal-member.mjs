#!/usr/bin/env node
/**
 * Restamp a person onto a live house. Admin SDK only.
 * Does not print emails, tokens, or full uids.
 *
 * Env:
 *   HEAL_STREET  substring of the street / name (required)
 *   HEAL_EMAIL   account email (required)
 *   HEAL_ROLE    client | sub | builder  (default client)
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'plumb-467a0' });
const db = getFirestore();
const auth = getAuth();

const street = String(process.env.HEAL_STREET || '').trim().toLowerCase();
const email = String(process.env.HEAL_EMAIL || '').trim().toLowerCase();
const role = String(process.env.HEAL_ROLE || 'client').trim().toLowerCase();
if (!street || !email) {
  console.error('need HEAL_STREET and HEAL_EMAIL');
  process.exit(2);
}
if (!['client', 'sub', 'builder'].includes(role)) {
  console.error('HEAL_ROLE must be client, sub, or builder');
  process.exit(2);
}

const user = await auth.getUserByEmail(email);
const uid = user.uid;
const sites = await db.collection('sites').get();
let hits = 0;
let patched = 0;

for (const d of sites.docs) {
  const data = d.data() || {};
  const meta = data.meta || {};
  const label = String(meta.street || meta.name || data.street || data.name || '');
  if (!label.toLowerCase().includes(street)) continue;
  hits += 1;
  const members = Object.assign({}, data.members || meta.members || {});
  const memberInfo = Object.assign({}, (meta.memberInfo) || {});
  const ownerUid = data.updatedByUid || meta.updatedByUid || '';
  if (ownerUid && !members[ownerUid]) members[ownerUid] = 'builder';
  members[uid] = role;
  memberInfo[uid] = Object.assign({}, memberInfo[uid] || {}, {
    name: user.displayName || '',
    email: email,
  });
  meta.members = members;
  meta.memberInfo = memberInfo;
  const memberUids = Object.keys(members);
  await d.ref.set(
    {
      members,
      memberUids,
      meta,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  patched += 1;
  console.log(
    'healed ' +
      label.slice(0, 40) +
      ' · uid ' +
      uid.slice(0, 8) +
      ' · ' +
      role +
      ' · members ' +
      memberUids.length
  );
}

if (!hits) {
  console.log('no house matched');
  process.exit(3);
}
console.log('matched ' + hits + '; patched ' + patched);
