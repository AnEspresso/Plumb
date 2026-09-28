/* rulescheck.js — server-side security-rules test for Plumb (Phase 2).
 *
 * WHY: subfilter.js and sim.js prove the CLIENT hides what it should. This
 * suite proves the SERVER refuses what it must — the boundary that holds even
 * if someone bypasses the app entirely and drives the Firestore/Storage APIs
 * from a script with a stolen token.
 *
 * WHAT IT TESTS: the rules in ./firestore.rules and ./storage.rules — kept
 * logic-verbatim from the DEPLOYED rulesets (v7 Firestore, v2.148+ Storage).
 * Personas: owner builder, second team builder, invited sub, invited
 * homeowner, authed stranger, unauthenticated.
 *
 * TWO TIERS:
 *   INVARIANT — must hold or the product's isolation promise is broken.
 *   GAP       — current deployed behavior we assert AS-IS and flag for a
 *               product decision. If a rules change flips one, this suite
 *               fails loudly so the change is deliberate, never accidental.
 *
 * RUN from the repo root (the emulator handles startup and teardown):
 *   npm run rules        production ruleset (firestore.rules)
 *   npm run rules:next   staging ruleset (firestore-next.rules)
 * Firestore emulator on port 8088, as firebase.json says. Never 8080, never
 * the live project. Storage runs only when storage.rules is in the tree; until
 * then that section is skipped and the report says so out loud.
 * Must exit 0 (prints PASS). CI runs it on every rules change.
 */
const fs = require('fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } =
  require('@firebase/rules-unit-testing');
const {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  query, where, onSnapshot,
} = require('firebase/firestore');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

/* Profiles: default = PRODUCTION ruleset (firestore.rules, the published hardened
   set); RULES_PROFILE=next = firestore-next.rules, where a rules change is staged
   before it is promoted. Today the two files are identical: the costs, telemetry
   and invite hardening that used to live only in next has been promoted, so the
   old "production still has this hole" gaps are invariants now in both profiles.
   The retired v7 ruleset and its GAP carve-outs are gone from the suite. */
const NEXT = process.env.RULES_PROFILE === 'next';
const HARD = true;
const FS_RULES = NEXT ? 'firestore-next.rules' : 'firestore.rules';
const ST_RULES = NEXT ? 'storage-next.rules' : 'storage.rules';
/* Storage is tested only when the profile's storage file exists AND storage.rules
   does: firebase.json names storage.rules, so without it the emulator never starts. */
const HAS_ST = fs.existsSync(ST_RULES) && fs.existsSync('storage.rules');
const { applyClaimToSite } = require('./functions/lib/claimStamp.js');
const PROJECT = 'demo-plumb-rules';
const U = {
  builder:  'uid-builder-owner',
  builder2: 'uid-builder-second',
  sub:      'uid-sub-invited',
  client:   'uid-client-invited',
  stranger: 'uid-authed-stranger',
  otherBuilder: 'uid-other-builder', // owns liveB (cross-site isolation)
};
/* The house exactly as the server stamps it when a crew joins having typed
   their own name at signup. The crew must still be matched by the roster name. */
const JOIN = applyClaimToSite({ members: { [U.builder]: 'builder' }, meta: {} },
  { code: 'CRWJ', role: 'sub', siteId: 'liveJoin', trade: 'plumb', name: 'Clearwater Plumbing' },
  U.sub, { name: 'Mike Chen', email: 'mike@example.com' });

const results = [];
let testEnv;

function tally(tier, name, ok, err) {
  results.push({ tier, name, ok, err: err && String(err).split('\n')[0] });
  process.stdout.write(ok ? '.' : 'X');
}
async function expect(tier, name, promise, shouldPass) {
  try {
    if (shouldPass) { await assertSucceeds(promise); }
    else            { await assertFails(promise); }
    tally(tier, name, true);
  } catch (e) { tally(tier, name, false, e); }
}
const INV = (n, p, pass) => expect('INVARIANT', n, p, pass);
const GAP = (n, p, pass) => expect('GAP', n, p, pass);

/* ---------- fixtures (written with rules disabled) ---------- */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // liveA: fully stamped live site, all four roles
    await setDoc(doc(db, 'sites/liveA'), {
      mode: 'live', street: 'Live A',
      members: { [U.builder]: 'builder', [U.builder2]: 'builder', [U.sub]: 'sub', [U.client]: 'client' },
      memberUids: [U.builder, U.builder2, U.sub, U.client],
    });
    for (const c of ['items', 'sel', 'logs', 'pmts', 'mail', 'costs'])
      await setDoc(doc(db, `sites/liveA/${c}/r1`), { seeded: true, note: c });
    // liveB: a different builder's live site — our personas are strangers here
    await setDoc(doc(db, 'sites/liveB'), {
      mode: 'live', street: 'Live B',
      members: { [U.otherBuilder]: 'builder' },
      memberUids: [U.otherBuilder],
    });
    await setDoc(doc(db, 'sites/liveB/pmts/r1'), { seeded: true });
    // legacy: live with memberUids ABSENT (real pre-stamp shape) — rules ERROR->deny
    await setDoc(doc(db, 'sites/legacy'), { mode: 'live', street: 'Legacy Absent' });
    await setDoc(doc(db, 'sites/legacy/items/r1'), { seeded: true });
    // legacyNull: live with memberUids/members EXPLICITLY null — the only shape
    // where v7's written carve-out actually fires (app never writes this shape)
    await setDoc(doc(db, 'sites/legacyNull'), { mode: 'live', street: 'Legacy Null', members: null, memberUids: null });
    await setDoc(doc(db, 'sites/legacyNull/items/r1'), { seeded: true });
    // demo1: shared demo sandbox
    await setDoc(doc(db, 'sites/demo1'), { mode: 'demo', street: 'Demo One' });
    await setDoc(doc(db, 'sites/demo1/items/r1'), { seeded: true });
    // invites / orgs / users / telemetry
    await setDoc(doc(db, 'invites/SECRETCODE1'), { createdBy: U.builder, site: 'liveA', trade: 'plumb' });
    await setDoc(doc(db, 'orgs/org1'), { members: { [U.builder]: 'builder', [U.builder2]: 'builder' } });
    await setDoc(doc(db, 'users/' + U.builder), { name: 'Owner', email: 'o@x.com' });
    await setDoc(doc(db, 'telemetry/deviceOfBuilder'), { owner: U.builder, hb: 1 });
    await setDoc(doc(db, 'telemetry/deviceOfBuilder/events/e1'), { ev: 'open' });
    // liveCrew: crewOwnBk() matches booking.subName against the name stamped on the house
    await setDoc(doc(db, 'sites/liveCrew'), {
      mode: 'live', street: 'Live Crew',
      members: { [U.builder]: 'builder', [U.sub]: 'sub' },
      memberUids: [U.builder, U.sub],
      meta: { memberInfo: { [U.sub]: { name: 'Clearwater Plumbing', trade: 'plumb' } } },
    });
    await setDoc(doc(db, 'sites/liveCrew/bk/b1'), { data: { subName: 'Clearwater Plumbing', trade: 'plumb' } });
    await setDoc(doc(db, 'sites/liveCrew/bk/b2'), { data: { subName: 'Brightpath Electric', trade: 'elec' } });
    // liveJoin: written by the real claim stamp, not by hand
    await setDoc(doc(db, 'sites/liveJoin'), { mode: 'live', street: 'Live Join',
      members: JOIN.members, memberUids: JOIN.memberUids, meta: JOIN.meta });
    await setDoc(doc(db, 'sites/liveJoin/bk/b1'), { data: { subName: 'Clearwater Plumbing', trade: 'plumb' } });
  });
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync(FS_RULES, 'utf8') },
    ...(HAS_ST ? { storage: { host: '127.0.0.1', port: 9199, rules: fs.readFileSync(ST_RULES, 'utf8') } } : {}),
  });
  await testEnv.clearFirestore();
  await seed();

  const db = {};
  for (const k of Object.keys(U)) db[k] = testEnv.authenticatedContext(U[k]).firestore();
  db.unauth = testEnv.unauthenticatedContext().firestore();
  const st = {};
  if (HAS_ST) {
    for (const k of Object.keys(U)) st[k] = testEnv.authenticatedContext(U[k]).storage();
    st.unauth = testEnv.unauthenticatedContext().storage();
  }

  /* ══════════ SITES doc ══════════ */
  for (const [who, d] of [['builder', db.builder], ['builder2', db.builder2], ['sub', db.sub], ['client', db.client]])
    await INV(`sites: ${who} reads liveA`, getDoc(doc(d, 'sites/liveA')), true);
  await INV('sites: stranger DENIED read liveA', getDoc(doc(db.stranger, 'sites/liveA')), false);
  await INV('sites: unauth DENIED read liveA', getDoc(doc(db.unauth, 'sites/liveA')), false);
  await INV('sites: builder of liveA DENIED read liveB (cross-builder)', getDoc(doc(db.builder, 'sites/liveB')), false);
  await INV('sites: sub of liveA DENIED read liveB (cross-site)', getDoc(doc(db.sub, 'sites/liveB')), false);
  await INV('sites: any signed-in reads demo', getDoc(doc(db.stranger, 'sites/demo1')), true);
  await INV('sites: unauth DENIED read demo', getDoc(doc(db.unauth, 'sites/demo1')), false);

  await INV('sites: builder updates liveA meta', updateDoc(doc(db.builder, 'sites/liveA'), { street: 'Live A upd' }), true);
  await INV('sites: second builder updates liveA meta', updateDoc(doc(db.builder2, 'sites/liveA'), { street: 'Live A upd2' }), true);
  await INV('sites: sub DENIED update liveA meta', updateDoc(doc(db.sub, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: client DENIED update liveA meta', updateDoc(doc(db.client, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: stranger DENIED update liveA meta', updateDoc(doc(db.stranger, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: sub DENIED self-promotion to builder', updateDoc(doc(db.sub, 'sites/liveA'), { [`members.${U.sub}`]: 'builder' }), false);
  await INV('sites: delete denied even to builder', deleteDoc(doc(db.builder, 'sites/liveA')), false);

  await INV('sites: create live stamping SELF as builder allowed',
    setDoc(doc(db.builder, 'sites/newLive1'), { mode: 'live', members: { [U.builder]: 'builder' }, memberUids: [U.builder] }), true);
  await INV('sites: create live WITHOUT self-stamp denied',
    setDoc(doc(db.stranger, 'sites/newLive2'), { mode: 'live', members: { [U.builder]: 'builder' }, memberUids: [U.builder] }), false);
  await INV('sites: create live with uid missing from memberUids denied',
    setDoc(doc(db.stranger, 'sites/newLive3'), { mode: 'live', members: { [U.stranger]: 'builder' }, memberUids: [U.builder] }), false);
  await INV('sites: unauth DENIED create', setDoc(doc(db.unauth, 'sites/newLive4'), { mode: 'demo' }), false);

  /* LEGACY, memberUids ABSENT (the shape old docs actually have): the v7 comment
     claims a migration carve-out, but missing-property access ERRORS -> DENY.
     Net effect: pre-stamp live docs are bricked — even the builder's own
     stampMemberUids() migration write is blocked. Safer than open, but the
     comment is wrong and the migration cannot run under these rules. */
  await GAP('LEGACY-ABSENT: stranger DENIED read (carve-out does NOT fire)', getDoc(doc(db.stranger, 'sites/legacy')), false);
  await GAP('LEGACY-ABSENT: even builder DENIED the stamping update (migration bricked)',
    updateDoc(doc(db.builder, 'sites/legacy'), { members: { [U.builder]: 'builder' }, memberUids: [U.builder] }), false);
  /* LEGACY, explicit nulls (shape the app never writes): carve-out DOES fire */
  await GAP(HARD ? 'LEGACY-NULL: carve-out removed — stranger denied' : 'LEGACY-NULL: stranger CAN read live site with explicit-null stamp fields',
    getDoc(doc(db.stranger, 'sites/legacyNull')), !HARD);
  await GAP(HARD ? 'LEGACY-NULL: carve-out removed — stranger update denied' : 'LEGACY-NULL: stranger CAN update it (incl. stamping themselves in)',
    updateDoc(doc(db.stranger, 'sites/legacyNull'), { note: 'poked' }), !HARD);

  /* ══════════ SITES subcollections ══════════ */
  for (const [who, d] of [['builder', db.builder], ['sub', db.sub], ['client', db.client]])
    await INV(`records: ${who} reads liveA items`, getDoc(doc(d, 'sites/liveA/items/r1')), true);
  await INV('records: stranger DENIED read liveA items', getDoc(doc(db.stranger, 'sites/liveA/items/r1')), false);
  await INV('records: sub of liveA DENIED read liveB pmts (cross-site)', getDoc(doc(db.sub, 'sites/liveB/pmts/r1')), false);
  await INV('records: unauth DENIED read liveA items', getDoc(doc(db.unauth, 'sites/liveA/items/r1')), false);

  await INV('records: builder writes pmts', setDoc(doc(db.builder, 'sites/liveA/pmts/p2'), { amt: 1 }), true);
  await INV('records: builder writes mail status', setDoc(doc(db.builder, 'sites/liveA/mail/m2'), { status: 'filed' }), true);
  await INV('records: sub writes items', setDoc(doc(db.sub, 'sites/liveA/items/i2'), { crew: 'Plumbing' }), true);
  await INV('records: sub writes logs', setDoc(doc(db.sub, 'sites/liveA/logs/l2'), { note: 'day' }), true);
  await INV('records: sub DENIED write sel', setDoc(doc(db.sub, 'sites/liveA/sel/s2'), { item: 'x' }), false);
  await INV('records: sub DENIED write pmts', setDoc(doc(db.sub, 'sites/liveA/pmts/p3'), { amt: 9 }), false);
  await INV('records: sub DENIED write mail', setDoc(doc(db.sub, 'sites/liveA/mail/m3'), { status: 'x' }), false);
  await INV('records: client writes sel', setDoc(doc(db.client, 'sites/liveA/sel/s3'), { signed: true }), true);
  await INV('records: client writes items', setDoc(doc(db.client, 'sites/liveA/items/i3'), { issue: true }), true);
  await INV('records: client DENIED write logs', setDoc(doc(db.client, 'sites/liveA/logs/l3'), { note: 'x' }), false);
  await INV('records: client DENIED write pmts', setDoc(doc(db.client, 'sites/liveA/pmts/p4'), { amt: 0 }), false);
  await INV('records: stranger DENIED write items', setDoc(doc(db.stranger, 'sites/liveA/items/i4'), { x: 1 }), false);
  await INV('records: demo records open to signed-in', setDoc(doc(db.stranger, 'sites/demo1/items/i5'), { x: 1 }), true);

  /* pmts read: server allows ANY member (incl. sub) to read money records; price hiding is display-only */
  await GAP(HARD ? 'MONEY: sub pmts read now DENIED at API level' : 'MONEY: sub CAN read pmts records at API level (price hiding is client-side only)',
    getDoc(doc(db.sub, 'sites/liveA/pmts/r1')), !HARD);
  await GAP(HARD ? 'MAIL: sub/client mail read now DENIED (builder-only review tray)' : 'MAIL: sub CAN read quarantined inbound mail at API level',
    getDoc(doc(db.sub, 'sites/liveA/mail/r1')), !HARD);
  await INV('MONEY: client still reads pmts (their own invoices)', getDoc(doc(db.client, 'sites/liveA/pmts/r1')), true);
  await INV('MAIL: builder still reads mail tray', getDoc(doc(db.builder, 'sites/liveA/mail/r1')), true);
  /* legacy subcollections follow the same split */
  await GAP('LEGACY-ABSENT: stranger DENIED records under it (error->deny)',
    setDoc(doc(db.stranger, 'sites/legacy/items/iX'), { x: 1 }), false);
  await GAP(HARD ? 'LEGACY-NULL: records under it denied too' : 'LEGACY-NULL: stranger CAN read+write records under explicit-null site',
    setDoc(doc(db.stranger, 'sites/legacyNull/items/iX'), { x: 1 }), !HARD);

  /* ══════════ COSTS (job costing — builder-only) ══════════ */
  await INV('costs: builder reads', getDoc(doc(db.builder, 'sites/liveA/costs/r1')), true);
  await INV('costs: builder writes', setDoc(doc(db.builder, 'sites/liveA/costs/c2'), { line: 'Framing', budget: 42000 }), true);
  await INV('costs: sub DENIED write', setDoc(doc(db.sub, 'sites/liveA/costs/c3'), { x: 1 }), false);
  await INV('costs: client DENIED write', setDoc(doc(db.client, 'sites/liveA/costs/c4'), { x: 1 }), false);
  await INV('costs: stranger DENIED everything', getDoc(doc(db.stranger, 'sites/liveA/costs/r1')), false);
  await INV('costs: sub DENIED read (margin privacy)', getDoc(doc(db.sub, 'sites/liveA/costs/r1')), false);
  await INV('costs: client DENIED read', getDoc(doc(db.client, 'sites/liveA/costs/r1')), false);

  /* ══════════ BOOKINGS (a crew sees only its own) ══════════ */
  const bkQ = (d, site, name) => query(collection(d, `sites/${site}/bk`), where('data.subName', '==', name));
  const exactly = (n, p) => p.then(r => { if (r.size !== n) throw new Error('expected ' + n + ' booking(s), saw ' + r.size); return r; });
  await INV('bookings: crew reads own bookings, filtered to the stamped name',
    exactly(1, getDocs(bkQ(db.sub, 'liveCrew', 'Clearwater Plumbing'))), true);
  await INV('bookings: crew reads own booking by id', getDoc(doc(db.sub, 'sites/liveCrew/bk/b1')), true);
  await INV('bookings: crew DENIED another crew\'s booking by id', getDoc(doc(db.sub, 'sites/liveCrew/bk/b2')), false);
  await INV('bookings: crew DENIED a query for another crew', getDocs(bkQ(db.sub, 'liveCrew', 'Brightpath Electric')), false);
  await INV('bookings: crew DENIED an unfiltered bookings query', getDocs(collection(db.sub, 'sites/liveCrew/bk')), false);
  await INV('bookings: a filter that contradicts the stamped name is refused (why the crew phone filters on the stamp)',
    getDocs(bkQ(db.sub, 'liveCrew', 'Mike Chen')), false);
  await INV('bookings: builder reads every booking', exactly(2, getDocs(collection(db.builder, 'sites/liveCrew/bk'))), true);
  await INV('bookings: stranger DENIED', getDocs(bkQ(db.stranger, 'liveCrew', 'Clearwater Plumbing')), false);
  await INV('bookings: a crew who typed their own name at signup still sees their booking (claim stamp + rule, end to end)',
    exactly(1, getDocs(bkQ(db.sub, 'liveJoin', (JOIN.meta.memberInfo[U.sub] || {}).name || ''))), true);

  /* ══════════ INVITES ══════════ */
  await INV('invites: get by exact code allowed signed-in', getDoc(doc(db.stranger, 'invites/SECRETCODE1')), true);
  await INV('invites: unauth DENIED get', getDoc(doc(db.unauth, 'invites/SECRETCODE1')), false);
  await INV('invites: LIST denied (no enumeration/harvest)', getDocs(collection(db.stranger, 'invites')), false);
  await INV('invites: create with createdBy=self allowed',
    setDoc(doc(db.builder, 'invites/NEWCODE1'), { createdBy: U.builder, site: 'liveA' }), true);
  await INV('invites: create claiming someone else denied',
    setDoc(doc(db.stranger, 'invites/NEWCODE2'), { createdBy: U.builder, site: 'liveA' }), false);
  await INV('invites: another builder DENIED revoking a code they did not send',
    updateDoc(doc(db.builder2, 'invites/SECRETCODE1'), { revoked: true, revokedAt: 1 }), false);
  await INV('invites: stranger holding the code DENIED revoking it',
    updateDoc(doc(db.stranger, 'invites/SECRETCODE1'), { revoked: true, revokedAt: 2 }), false);
  await INV('invites: creator DENIED reassigning createdBy while revoking',
    updateDoc(doc(db.builder, 'invites/SECRETCODE1'), { revoked: true, revokedAt: 3, createdBy: U.builder2 }), false);
  await INV('invites: creator revokes own invite (revoked/revokedAt only)',
    updateDoc(doc(db.builder, 'invites/SECRETCODE1'), { revoked: true, revokedAt: 4 }), true);
  await INV('invites: update touching other fields denied',
    updateDoc(doc(db.builder, 'invites/SECRETCODE1'), { trade: 'elec' }), false);
  await INV('invites: delete denied', deleteDoc(doc(db.builder, 'invites/SECRETCODE1')), false);
  await INV('claims: create own uid allowed',
    setDoc(doc(db.sub, `invites/SECRETCODE1/claims/${U.sub}`), { at: 1 }), true);
  await INV('claims: create under someone else\'s uid denied',
    setDoc(doc(db.stranger, `invites/SECRETCODE1/claims/${U.sub}`), { at: 1 }), false);
  await INV('claims: update denied (immutable)',
    updateDoc(doc(db.sub, `invites/SECRETCODE1/claims/${U.sub}`), { at: 2 }), false);
  await INV('claims: delete denied (immutable)',
    deleteDoc(doc(db.sub, `invites/SECRETCODE1/claims/${U.sub}`)), false);
  await INV('claims: stranger DENIED creating a fresh claim under another uid',
    setDoc(doc(db.stranger, `invites/SECRETCODE1/claims/${U.client}`), { at: 1 }), false);
  await INV('claims: joiner reads own claim',
    getDoc(doc(db.sub, `invites/SECRETCODE1/claims/${U.sub}`)), true);
  await INV('claims: builder who sent the code reads the claim',
    getDoc(doc(db.builder, `invites/SECRETCODE1/claims/${U.sub}`)), true);
  await INV('claims: builder who sent the code lists claims',
    getDocs(collection(db.builder, 'invites/SECRETCODE1/claims')), true);
  await INV('claims: stranger DENIED read', getDoc(doc(db.stranger, `invites/SECRETCODE1/claims/${U.sub}`)), false);
  await INV('claims: another builder on the house DENIED read (did not send the code)',
    getDoc(doc(db.builder2, `invites/SECRETCODE1/claims/${U.sub}`)), false);
  await INV('claims: signed-out DENIED read', getDoc(doc(db.unauth, `invites/SECRETCODE1/claims/${U.sub}`)), false);
  await INV('claims: stranger DENIED list', getDocs(collection(db.stranger, 'invites/SECRETCODE1/claims')), false);
  await INV('claims: another builder DENIED list', getDocs(collection(db.builder2, 'invites/SECRETCODE1/claims')), false);

  /* ══════════ ORGS ══════════ */
  await INV('orgs: member reads', getDoc(doc(db.builder, 'orgs/org1')), true);
  await INV('orgs: non-member DENIED read of existing', getDoc(doc(db.stranger, 'orgs/org1')), false);
  await INV('orgs: signed-in get of missing org allowed', getDoc(doc(db.stranger, 'orgs/orgDoesNotExist')), true);
  await INV('orgs: create stamping self builder allowed',
    setDoc(doc(db.stranger, 'orgs/orgNew'), { members: { [U.stranger]: 'builder' } }), true);
  await INV('orgs: create without self-as-builder denied',
    setDoc(doc(db.sub, 'orgs/orgNew2'), { members: { [U.builder]: 'builder' } }), false);
  await INV('orgs: builder updates keeping self builder',
    updateDoc(doc(db.builder, 'orgs/org1'), { members: { [U.builder]: 'builder', [U.builder2]: 'builder' }, prefs: { a: 1 } }), true);
  await INV('orgs: update by non-member denied',
    updateDoc(doc(db.stranger, 'orgs/org1'), { prefs: { a: 2 } }), false);
  await INV('orgs: builder cannot drop own builder role in update',
    updateDoc(doc(db.builder2, 'orgs/org1'), { members: { [U.builder]: 'builder' } }), false);

  /* ══════════ USERS ══════════ */
  await INV('users: read own doc', getDoc(doc(db.builder, 'users/' + U.builder)), true);
  await INV('users: read someone else DENIED', getDoc(doc(db.stranger, 'users/' + U.builder)), false);
  await INV('users: write own with allowed shape',
    setDoc(doc(db.builder, 'users/' + U.builder), { name: 'O', email: 'o@x.com', fcm: 'tok', updatedAt: 1 }), true);
  await INV('users: write own with FOREIGN key denied',
    setDoc(doc(db.builder, 'users/' + U.builder), { name: 'O', isAdmin: true }), false);
  await INV('users: write someone else\'s doc denied',
    setDoc(doc(db.stranger, 'users/' + U.builder), { name: 'hacked' }), false);
  await INV('users: delete denied', deleteDoc(doc(db.builder, 'users/' + U.builder)), false);

  /* ══════════ TELEMETRY (header/body mismatch in deployed v7) ══════════ */
  // Telemetry, QuickBooks tokens and OAuth states are server-only: every client path denies.
  await INV('TELEMETRY: stranger read denied',
    getDoc(doc(db.stranger, 'telemetry/deviceOfBuilder')), false);
  await INV('TELEMETRY: stranger overwrite denied',
    setDoc(doc(db.stranger, 'telemetry/deviceOfBuilder'), { hb: 999, owner: 'spoofed' }), false);
  await INV('TELEMETRY: builder himself denied (server-only now)',
    setDoc(doc(db.builder, 'telemetry/deviceOfBuilder'), { hb: 2 }), false);
  await INV('TELEMETRY: event delete denied',
    deleteDoc(doc(db.stranger, 'telemetry/deviceOfBuilder/events/e1')), false);
  await INV('QB: tokens unreadable by their own user',
    getDoc(doc(db.builder, 'qb/' + U.builder)), false);
  await INV('QB: oauth states unwritable',
    setDoc(doc(db.stranger, 'qbStates/forged'), { uid: U.stranger }), false);

  if (HAS_ST) {
  /* ══════════ STORAGE ══════════ */
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]);
  const meta = { contentType: 'image/png' };
  // seed one live + one demo object with rules disabled so read tests have a target
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.storage();
    await uploadBytes(ref(s, 'live/sites/liveA/photos/seed1'), png, meta);
    await uploadBytes(ref(s, 'demo/sites/demo1/photos/seed1'), png, meta);
    await uploadBytes(ref(s, 'live/sites/liveB/docs/seed1'), png, meta);
    await uploadBytes(ref(s, 'live/sites/liveA/costs/receipt1'), png, meta);
  });

  await INV('storage: member uploads image to live site', uploadBytes(ref(st.builder, 'live/sites/liveA/photos/u1'), png, meta), true);
  await INV('storage: sub member uploads to own live site', uploadBytes(ref(st.sub, 'live/sites/liveA/photos/u2'), png, meta), true);
  await INV('storage: member uploads PDF', uploadBytes(ref(st.builder, 'live/sites/liveA/docs/u3'), png, { contentType: 'application/pdf' }), true);
  await INV('storage: stranger DENIED upload to live site', uploadBytes(ref(st.stranger, 'live/sites/liveA/photos/u4'), png, meta), false);
  await INV('storage: member DENIED wrong content type', uploadBytes(ref(st.builder, 'live/sites/liveA/docs/u5'), png, { contentType: 'text/plain' }), false);
  await INV('storage: member reads live file', getBytes(ref(st.client, 'live/sites/liveA/photos/seed1')), true);
  await INV('storage: stranger DENIED read live file', getBytes(ref(st.stranger, 'live/sites/liveA/photos/seed1')), false);
  await INV('storage: unauth DENIED read live file', getBytes(ref(st.unauth, 'live/sites/liveA/photos/seed1')), false);
  await INV('storage: liveA sub DENIED read liveB file (cross-site)', getBytes(ref(st.sub, 'live/sites/liveB/docs/seed1')), false);
  await INV('storage: signed-in reads demo file', getBytes(ref(st.stranger, 'demo/sites/demo1/photos/seed1')), true);
  await INV('storage: signed-in uploads demo file', uploadBytes(ref(st.stranger, 'demo/sites/demo1/photos/u6'), png, meta), true);
  await INV('storage: unauth DENIED demo read', getBytes(ref(st.unauth, 'demo/sites/demo1/photos/seed1')), false);
  await INV('storage: path outside demo|live denied', uploadBytes(ref(st.builder, 'sites/liveA/photos/u7'), png, meta), false);
  await INV('storage: builder reads costs receipt', getBytes(ref(st.builder, 'live/sites/liveA/costs/receipt1')), true);
  await INV('storage: builder uploads costs receipt', uploadBytes(ref(st.builder, 'live/sites/liveA/costs/r2'), png, meta), true);
  await INV('storage: stranger DENIED costs receipt', getBytes(ref(st.stranger, 'live/sites/liveA/costs/receipt1')), false);
  /* Live since 2026-07-04: a costs receipt is builder-only. The old gaps
     expected a crew to be able to read one. That hole is not in the ruleset. */
  await INV('storage: sub DENIED costs receipt read', getBytes(ref(st.sub, 'live/sites/liveA/costs/receipt1')), false);
  await INV('storage: client DENIED costs receipt read', getBytes(ref(st.client, 'live/sites/liveA/costs/receipt1')), false);
  await INV('storage: sub DENIED costs receipt upload', uploadBytes(ref(st.sub, 'live/sites/liveA/costs/r3'), png, meta), false);
  const big = Buffer.alloc(26 * 1024 * 1024);
  await INV('storage: >25MB upload denied even for member', uploadBytes(ref(st.builder, 'live/sites/liveA/photos/big1'), big, meta), false);
  }

  /* ══════════ PROPAGATION round-trip (the app's exact live listener shape) ══════════ */
  // Member (sub persona) subscribes with array-contains OWN uid, then the
  // builder updates the site; the listener must receive the new value.
  const liveQ = (d, uid) => query(collection(d, 'sites'), where('memberUids', 'array-contains', uid));
  await INV('propagation: member listener receives builder update', (async () => {
    let unsub;
    try {
      const got = new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('listener timeout — update never propagated')), 8000);
        unsub = onSnapshot(liveQ(db.sub, U.sub), snap => {
          snap.forEach(d2 => { if (d2.id === 'liveA' && d2.data().street === 'Round Trip') { clearTimeout(t); res(true); } });
        }, err => { clearTimeout(t); rej(err); });
      });
      await new Promise(r => setTimeout(r, 400));
      await updateDoc(doc(db.builder, 'sites/liveA'), { street: 'Round Trip' });
      await got;
    } finally { if (unsub) unsub(); }
  })(), true);
  // Same-shaped query by a stranger with his OWN uid: legal but must be EMPTY.
  await INV('propagation: stranger\'s own-uid query returns ZERO live sites', (async () => {
    const snap = await getDocs(liveQ(db.stranger, U.stranger));
    if (snap.size !== 0) throw new Error('leak: stranger query returned ' + snap.size + ' sites');
  })(), true);
  // Harvest attempt: stranger queries array-contains the BUILDER's uid — the
  // result set would contain docs he can't read, so the query itself is denied.
  await INV('propagation: stranger DENIED query on someone else\'s uid (harvest)',
    getDocs(liveQ(db.stranger, U.builder)), false);
  await INV('propagation: unauth DENIED the live listener query',
    getDocs(liveQ(db.unauth, U.builder)), false);
  // Unfiltered collection listen (what the old app did): must be denied now
  // that reads are member-scoped — confirms the app's scoped-listener redesign.
  await INV('propagation: unfiltered sites collection query denied',
    getDocs(collection(db.stranger, 'sites')), false);

  /* ---------- report ---------- */
  await testEnv.cleanup();
  const bad = results.filter(r => !r.ok);
  const inv = results.filter(r => r.tier === 'INVARIANT');
  const gaps = results.filter(r => r.tier === 'GAP');
  console.log(`\nrulescheck [${NEXT ? 'NEXT (staging)' : 'PRODUCTION'}]: ${inv.length} invariants + ${gaps.length} documented-gap assertions across 6 personas`);
  if (!HAS_ST) console.log('STORAGE: SKIPPED - ' + ST_RULES + ' is not in the tree, so nothing about uploads or file reads is proven here.');
  console.log('Documented gaps asserted as current deployed behavior:');
  gaps.forEach(g => console.log('  ~ ' + g.name));
  if (bad.length) {
    console.log('FAIL:');
    bad.forEach(b => console.log(`  x [${b.tier}] ${b.name}${b.err ? ' — ' + b.err : ''}`));
    process.exit(1);
  }
  console.log('PASS: every invariant holds; every documented gap behaves exactly as recorded.');
  process.exit(0);
}

main().catch(e => { console.error('\nHARNESS ERROR:', e); process.exit(1); });
