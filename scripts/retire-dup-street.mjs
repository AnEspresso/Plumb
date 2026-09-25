#!/usr/bin/env node
/**
 * Retire an empty duplicate house that shares a street name with a numbered one.
 * "Cottage Ln" goes away only when "7 Cottage Ln" exists and the short one has no work.
 * Members on the short house are copied onto the numbered one first.
 *
 * Env:
 *   RETIRE_STREET  street name without the number, e.g. cottage ln
 *   RETIRE_CONFIRM 1 to delete, otherwise dry run
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'plumb-467a0' });
const db = getFirestore();
const want = String(process.env.RETIRE_STREET || '').trim().toLowerCase();
const confirm = process.env.RETIRE_CONFIRM === '1';
if (!want) {
  console.error('need RETIRE_STREET');
  process.exit(2);
}

function streetKey(label) {
  return String(label || '').replace(/^\d+\s+/, '').trim().toLowerCase();
}
function labelOf(data) {
  const meta = data.meta || {};
  return String(meta.street || meta.name || data.street || data.name || '');
}
function workCount(meta) {
  const keys = ['items', 'selections', 'bookings', 'invoices', 'docs', 'logs', 'subs'];
  let n = 0;
  keys.forEach(function (k) { n += Array.isArray(meta[k]) ? meta[k].length : 0; });
  return n;
}

const sites = await db.collection('sites').get();
const group = [];
sites.docs.forEach(function (d) {
  const data = d.data() || {};
  const key = streetKey(label);
  if (!key) return;
  const hit = key === want || key.startsWith(want + ' ') || want.startsWith(key + ' ');
  if (!hit) return;
  group.push({ id: d.id, ref: d.ref, label: label, data: data });
});
console.log('matched ' + group.length);
group.forEach(function (g) { console.log(' - ' + g.label.slice(0, 48) + ' · ' + g.id.slice(0, 12)); });
const numbered = group.filter(function (g) { return /^\d+\s+/.test(g.label); });
const bare = group.filter(function (g) { return !/^\d+\s+/.test(g.label); });
if (numbered.length !== 1 || bare.length !== 1) {
  console.log('not a single numbered house plus one short name — leaving them');
  process.exit(0);
}
const keep = numbered[0];
const drop = bare[0];
const meta = drop.data.meta || {};
const n = workCount(meta);
if (n) {
  console.log('short house has ' + n + ' records — not retiring');
  process.exit(0);
}
const subs = await drop.ref.listCollections();
let subDocs = 0;
for (const c of subs) {
  const snap = await c.limit(1).get();
  subDocs += snap.size;
}
if (subDocs) {
  console.log('short house has subcollection records — not retiring');
  process.exit(0);
}
const keepData = keep.data || {};
const keepMeta = Object.assign({}, keepData.meta || {});
const members = Object.assign({}, keepData.members || keepMeta.members || {}, drop.data.members || meta.members || {});
const info = Object.assign({}, keepMeta.memberInfo || {}, meta.memberInfo || {});
keepMeta.members = members;
keepMeta.memberInfo = info;
console.log('keep ' + keep.label.slice(0, 48) + ' · drop ' + drop.label.slice(0, 48) + ' · members ' + Object.keys(members).length);
if (!confirm) {
  console.log('dry run — set RETIRE_CONFIRM=1 to retire the short house');
  process.exit(0);
}
await keep.ref.set({ members: members, memberUids: Object.keys(members), meta: keepMeta, updatedAt: Date.now() }, { merge: true });
await drop.ref.delete();
console.log('retired short house');
