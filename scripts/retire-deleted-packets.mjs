#!/usr/bin/env node
/**
 * One-shot cloud cleanup: retire guest packets whose house is gone.
 * Admin SDK only. Never prints tokens, specs, or bearer URLs.
 *
 * Matches:
 *   1. packets whose site/sub/note names Ink Test 2421 (Astra leftover)
 *   2. packets whose siteId is a tombstoned house (deleted stamp)
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'plumb-467a0' });
const db = getFirestore();

function hayOf(p) {
  return [p.site, p.sub, p.note, p.builder, p.tradeLabel]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
}

function reasonOf(p, deletedIds) {
  if (hayOf(p).includes('ink test 2421')) return 'ink-test-2421';
  if (p.siteId && deletedIds.has(String(p.siteId))) return 'deleted-house';
  return null;
}

const sites = await db.collection('sites').get();
const deletedIds = new Set();
for (const d of sites.docs) {
  const data = d.data() || {};
  const meta = data.meta || {};
  if (data.deleted || meta.deleted) deletedIds.add(d.id);
}

const packets = await db.collection('packets').get();
const now = Date.now();
const counts = { scanned: packets.size, retired: 0, already: 0, skipped: 0 };
const by = { 'ink-test-2421': 0, 'deleted-house': 0 };
const labels = [];

for (const d of packets.docs) {
  const p = d.data() || {};
  const why = reasonOf(p, deletedIds);
  if (!why) {
    counts.skipped += 1;
    continue;
  }
  const gone =
    p.siteDeleted === true ||
    p.revoked === true ||
    (typeof p.expires === 'number' && p.expires < now);
  const siteLabel = String(p.site || p.siteId || 'packet').slice(0, 80);
  if (gone && p.siteDeleted === true) {
    counts.already += 1;
    continue;
  }
  await d.ref.update({
    revoked: true,
    siteDeleted: true,
    expires: now - 1,
    retiredAt: now,
    retiredWhy: why,
  });
  counts.retired += 1;
  by[why] += 1;
  labels.push(siteLabel + ' (' + why + ')');
}

console.log(
  'scanned ' +
    counts.scanned +
    ' packets; deleted houses ' +
    deletedIds.size +
    '; retired ' +
    counts.retired +
    '; already gone ' +
    counts.already +
    '; left alone ' +
    counts.skipped
);
console.log('ink-test-2421 ' + by['ink-test-2421'] + '; deleted-house ' + by['deleted-house']);
for (const l of labels) console.log('retired: ' + l);
if (counts.retired === 0 && by['ink-test-2421'] === 0 && counts.already === 0) {
  console.log('NOTE: no Ink Test 2421 packet found. It may already be gone, or the site string differs.');
}
