#!/usr/bin/env node
/**
 * Point one crew's memberInfo on one house at one roster row. Admin SDK. DRY RUN unless FIX_APPLY=yes.
 * Writes exactly two fields with one field-path update on sites/<site>:
 *   meta.memberInfo.<uid>.name  = meta.subs[row].name
 *   meta.memberInfo.<uid>.subId = meta.subs[row].id
 * Refuses unless subs[row].id equals invites/<code>.subId, the code is a crew code for this house, the uid holds
 * the code's claim, and members[uid] is 'sub'. Prints only ok/refused, reasons and equal/different/missing:
 * never names, emails, tokens or full uids.
 *
 * Env: FIX_SITE, FIX_UID, FIX_ROW, FIX_CODE, FIX_APPLY
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import * as firestoreModule from 'firebase-admin/firestore';
import { installMoneyGuard } from './lib/moneyGuard.mjs';
import { checkFix, eqState } from './lib/fixMemberRow.mjs';

const SEG = /^[A-Za-z0-9_.-]{1,128}$/;
const siteId = String(process.env.FIX_SITE || '').trim();
const uid = String(process.env.FIX_UID || '').trim();
const row = String(process.env.FIX_ROW || '').trim();
const code = String(process.env.FIX_CODE || '').trim().toUpperCase();
const apply = String(process.env.FIX_APPLY || '').trim() === 'yes';
if (![siteId, uid, code].every(s => SEG.test(s)) || !/^\d{1,3}$/.test(row)) { console.error('bad input (site, uid, row, code)'); process.exit(2); }

initializeApp({ credential: applicationDefault(), projectId: 'plumb-467a0' });
installMoneyGuard(firestoreModule);   // M-16: repair scripts never write money
const db = getFirestore();

const siteRef = db.collection('sites').doc(siteId);
const [siteSnap, invSnap, claimSnap] = await Promise.all([
  siteRef.get(),
  db.collection('invites').doc(code).get(),
  db.collection('invites').doc(code).collection('claims').doc(uid).get(),
]);
const res = checkFix({
  siteId, uid, row,
  site: siteSnap.exists ? siteSnap.data() : null,
  invite: invSnap.exists ? invSnap.data() : null,
  claimExists: claimSnap.exists,
});

console.log((apply ? 'APPLY' : 'DRY RUN (apply=yes to write)') + ' · house ' + siteId + ' · uid ' + uid.slice(0, 6) + '… · row ' + row);
console.log('before: memberInfo name vs row name: ' + res.before.name + ' · memberInfo subId vs row id: ' + res.before.subId);
if (!res.ok) { console.log('REFUSED:'); res.reasons.forEach(r => console.log('  - ' + r)); process.exit(3); }
console.log('checks: row id = code subId, code is a crew code for this house, uid holds the claim, uid is crew: all pass');
if (res.noop) { console.log('nothing to change: both already equal'); process.exit(0); }
console.log('would write 2 fields: meta.memberInfo.<uid>.name, meta.memberInfo.<uid>.subId (nothing else)');
if (!apply) process.exit(0);

const args = [];
for (const [path, value] of res.update) args.push(new FieldPath(...path), value);
await siteRef.update(...args);

const after = (await siteRef.get()).data() || {};
const am = after.meta || {};
const slot = (am.subs || [])[Number(row)] || {};
const ai = (am.memberInfo || {})[uid] || {};
const an = eqState(ai.name, slot.name), as = eqState(ai.subId, slot.id);
console.log('after: memberInfo name vs row name: ' + an + ' · memberInfo subId vs row id: ' + as);
if (an !== 'equal' || as !== 'equal') { console.log('VERIFY FAILED'); process.exit(4); }
console.log('done: 2 fields written');
