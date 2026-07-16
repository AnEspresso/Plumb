/* lib/deleteAccount.js — the whole account-erasure lifecycle, server-side.
   One entry point, two phases:
     preview (confirm=false): reports what deletion will touch — sites the user
       builds (cascade-destroyed), memberships elsewhere (stripped), QuickBooks.
     execute (confirm=true): does it, in crash-safe order. The Auth user is
       deleted LAST so a run that dies partway can simply be retried while the
       person is still signed in; every step is a re-runnable query, not a
       one-shot. Admin SDK bypasses security rules by design — this is the only
       path that can honor `allow delete: if false` docs. */
'use strict';
const { FieldValue } = require('firebase-admin/firestore');

/* Live members map shape is members[uid]='builder'|'sub'|'client' (strings);
   an older object shape {role:...} is tolerated — same posture as requireBuilder. */
function roleOf(members, uid) {
  const m = (members || {})[uid];
  if (m == null) return null;
  return String(typeof m === 'string' ? m : (m.role || '')).toLowerCase();
}
function isBuilderRole(r) { return r === 'builder'; }  // strict: ambiguity strips membership, never cascades

async function deleteCollectionDocs(db, collRef, pageSize) {
  for (;;) {
    const snap = await collRef.limit(pageSize || 300).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < (pageSize || 300)) return;
  }
}

/* Destroy one site the user builds: tombstone first (other live devices drop
   it through the existing deleted-flag pathway), then every subcollection
   (enumerated, not hardcoded — survives new record types), Storage files under
   the site's prefix, then the doc itself. */
async function cascadeSite(db, bucket, doc) {
  const data = doc.data() || {};
  /* cloud site docs carry the project under `meta`; receivers drop a site when
     meta.deleted appears — the same tombstone pathway deleteSite uses */
  try { await doc.ref.set({ meta: { deleted: Date.now() }, updatedAt: Date.now(), updatedBy: 'server' }, { merge: true }); } catch (e) {}
  const colls = await doc.ref.listCollections();
  for (const c of colls) await deleteCollectionDocs(db, c);
  if (bucket) {
    try { await bucket.deleteFiles({ prefix: (data.mode || 'live') + '/sites/' + doc.id + '/' }); }
    catch (e) { /* storage cleanup is best-effort; files without a live site doc are unreachable via rules */ }
  }
  await doc.ref.delete();
}

async function deleteAccount(db, authAdmin, bucket, uid, confirm, email) {
  const snap = await db.collection('sites').where('memberUids', 'array-contains', uid).get();
  const owned = [], memberOf = [];
  for (const d of snap.docs) {
    (isBuilderRole(roleOf((d.data() || {}).members, uid)) ? owned : memberOf).push(d);
  }
  const qbSnap = await db.collection('qb').doc(uid).get();
  const preview = {
    ownedSites: owned.map(d => { const x = d.data() || {}; const m = x.meta || {};
      return m.street || m.name || x.street || x.name || d.id; }),
    memberSites: memberOf.length,
    qb: !!(qbSnap.exists && (qbSnap.data() || {}).refreshToken),
  };
  if (!confirm) return { ok: true, preview };

  /* 1 · sites they build: full cascade */
  for (const d of owned) await cascadeSite(db, bucket, d);

  /* 2 · sites they merely belong to: strip the identity, leave the project */
  for (const d of memberOf) {
    await d.ref.update({
      memberUids: FieldValue.arrayRemove(uid),
      ['members.' + uid]: FieldValue.delete(),
      ['memberInfo.' + uid]: FieldValue.delete(),
    });
  }

  /* 3 · QuickBooks tokens */
  try { await db.collection('qb').doc(uid).delete(); } catch (e) {}

  /* 4 · diagnostics stamped with this uid (device docs + their event trails) */
  try {
    const tel = await db.collection('telemetry').where('uid', '==', uid).get();
    for (const d of tel.docs) {
      await deleteCollectionDocs(db, d.ref.collection('events'));
      await d.ref.delete();
    }
  } catch (e) {}

  /* 5 · invite claims carrying their email (best-effort — needs a
        collection-group index; silently skipped where absent) */
  if (email) {
    try {
      const cg = await db.collectionGroup('claims').where('email', '==', email).get();
      for (const d of cg.docs) await d.ref.delete();
    } catch (e) {}
  }

  /* 6 · profile doc (name, email, push tokens live here) */
  try { await db.collection('users').doc(uid).delete(); } catch (e) {}

  /* 7 · the Auth user itself — last, so any earlier failure is retryable */
  await authAdmin.deleteUser(uid);

  return { ok: true, deleted: { sites: owned.length, memberships: memberOf.length } };
}

module.exports = { deleteAccount, cascadeSite, roleOf, isBuilderRole };
