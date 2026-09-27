#!/usr/bin/env node
/**
 * Restamp crews who joined before 2.429 with the roster name from their invite.
 *
 * Why: until 2.429 a joining crew was stamped with whatever they typed at
 * signup (or their email). The rule crewOwnBk() matches booking.subName against
 * that stamped name, so those crews see an empty schedule. New joins are fixed
 * by the 2.429 claim stamp. Crews who already joined are not: the stamp only
 * runs when a claim is created. This script fixes them.
 *
 * It changes one field per crew: meta.memberInfo.<uid>.name on a live house.
 * It never deletes, never touches members, and never touches a homeowner or a
 * teammate. The roster name comes from the invite the crew redeemed.
 *
 * Safe to run again. A builder phone that was offline while this ran can push
 * its old copy back later; running this again puts it right.
 *
 * Env:
 *   RESTAMP_CONFIRM  1 to write. Anything else is a dry run.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
initializeApp(emulator ? { projectId: process.env.GCLOUD_PROJECT || 'demo-plumb-rules' }
                       : { credential: applicationDefault(), projectId: 'plumb-467a0' });
const db = getFirestore();
const confirm = process.env.RESTAMP_CONFIRM === '1';

function labelOf(data) {
  const meta = data.meta || {};
  return String(meta.street || meta.name || data.street || data.name || '(unnamed house)');
}
async function bookingsFor(siteRef, name) {
  if (!name) return 0;
  const q = siteRef.collection('bk').where('data.subName', '==', name);
  try { return (await q.count().get()).data().count; } catch (e) { return (await q.get()).size; }
}

const plan = [];
const skipped = [];
const sites = await db.collection('sites').get();
for (const d of sites.docs) {
  const data = d.data() || {};
  const meta = data.meta || {};
  if ((data.mode || meta.mode) !== 'live') continue;
  const members = data.members || meta.members || {};
  const info = meta.memberInfo || {};
  const invites = Array.isArray(meta.invites) ? meta.invites : [];
  for (const [uid, role] of Object.entries(members)) {
    if (role !== 'sub') continue;
    const inv = invites.find(i => i && i.uid === uid && i.role === 'sub' && i.status === 'joined')
             || invites.find(i => i && i.uid === uid && i.role === 'sub');
    if (!inv || !inv.code) { skipped.push([labelOf(data), uid, 'no invite on record for this crew - left alone']); continue; }
    let roster = '';
    try { const iv = await db.collection('invites').doc(String(inv.code)).get(); roster = String((iv.exists && iv.data().name) || ''); } catch (e) {}
    if (!roster) roster = String(inv.name || '');
    if (!roster) { skipped.push([labelOf(data), uid, 'invite carries no roster name - left alone']); continue; }
    const have = String((info[uid] || {}).name || '');
    if (have === roster) continue;
    plan.push({ ref: d.ref, label: labelOf(data), uid, have, roster,
      now: await bookingsFor(d.ref, have), after: await bookingsFor(d.ref, roster) });
  }
}

console.log(confirm ? 'WRITING' : 'DRY RUN (set RESTAMP_CONFIRM=1 to write)');
console.log(`${plan.length} crew${plan.length === 1 ? '' : 's'} to restamp, ${skipped.length} left alone\n`);
for (const p of plan) {
  console.log(`  ${p.label} · ${p.uid.slice(0, 8)} · ${JSON.stringify(p.have)} -> ${JSON.stringify(p.roster)} · sees ${p.now} booking(s) now, ${p.after} after`);
}
for (const [label, uid, why] of skipped) console.log(`  left alone: ${label} · ${uid.slice(0, 8)} · ${why}`);

if (confirm) {
  for (const p of plan) await p.ref.update(new FieldPath('meta', 'memberInfo', p.uid, 'name'), p.roster);
  console.log(`\nrestamped ${plan.length}`);
}
