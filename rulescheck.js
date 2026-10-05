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
  query, where, onSnapshot, writeBatch,
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
  demoMember: 'uid-demo-member',     // stamped on a non-live house (P2-4)
};
/* The house exactly as the server stamps it when a crew joins having typed
   their own name at signup. The crew must still be matched by the roster name. */
const JOIN = applyClaimToSite({ members: { [U.builder]: 'builder' }, meta: {} },
  { code: 'CRWJ', role: 'sub', siteId: 'liveJoin', trade: 'plumb', name: 'Clearwater Plumbing' },
  U.sub, { name: 'Mike Chen', email: 'mike@example.com' });

/* PR 0: a selection as the app stores it ({data, updatedAt, updatedBy}),
   every one of the nine install-detail spec fields and seven custom slots
   filled, plus every money field a selection carries or will carry. */
const SEL_IDS = ['s9a', 's9b', 's9c', 's9d', 's9e', 's9f', 's9g', 's9h', 's9i', 's9j', 's9k'];
function selRec(over) {
  return Object.assign({
    id: 9, room: 'Primary Bath', cat: 'Plumbing Fixtures', item: 'Brushed brass package',
    status: 'selected', approved: false, note: 'Rough-in confirmed on site',
    price: 850, allowance: 1200, cost: 640, costLineId: 'cl_plumb_fix', invoicedIn: 'inv_p2_1',
    spec: {
      finish: 'Brushed brass', roughin: '8 in widespread', mount: 'Deck', mounting: 'Deck, 3-hole',
      height: '36 in vanity', supply: '1/2 in compression', drain: '1-1/4 in pop-up',
      location: 'Centered on sink', loc: 'Wall B', valve: 'Pressure-balance',
    },
    specCustom: [
      { label: 'Handle style', who: 'homeowner', required: true, value: 'Lever' },
      { label: 'Shower head', who: 'homeowner', required: true, value: 'Rain, 10 in' },
      { label: 'Tub filler', who: 'homeowner', required: false, value: 'Floor-mount' },
      { label: 'Blocking', who: 'builder', required: true, value: '2x10 at 48 in' },
      { label: 'Trim kit', who: 'builder', required: true, value: 'T14 series' },
      { label: 'Accessories', who: 'homeowner', required: false, value: 'Towel bar + hook' },
      { label: 'Supply stops', who: 'builder', required: false, value: 'Quarter-turn' },
    ],
  }, over || {});
}
const selDoc = (over) => ({ data: selRec(over), updatedAt: 1, updatedBy: 'dev-builder' });
/* What clientSignoff() sends: the whole record, approved + signed changed, merged. */
const approveAs = (d, id, over) => setDoc(doc(d, `sites/liveA/sel/${id}`), {
  data: selRec(Object.assign({ approved: true, signed: { date: '2026-10-04', by: ['Ana Ruiz'] } }, over || {})),
  updatedAt: 2, updatedBy: 'dev-client',
}, { merge: true });

/* House-doc sign-off: a house with N trades signed by the builder, written
   the way the app pushes a house ({meta, id, mode, ...} merged). */
const SO_TRADES = ['excav','concrete','framing','roofing','siding','hvac','plumb','elec','insul','drywall','finish','floor','paint','landscape','cabinets','counter','windows','garage','gutters','lowvolt','fireplace','waterproof','septic','appliance','cleaning','demo','steel','stucco','general'];
const SO_MEMBERS = { [U.builder]: 'builder', [U.sub]: 'sub', [U.client]: 'client' };
function soMeta(nSigned) {
  const so = {}, at = {};
  SO_TRADES.slice(0, nSigned).forEach(t => { so[t] = { builder: { by: 'Dean Walsh', at: 1790000000000 } }; at[t] = '{"sels":[],"docs":[]}'; });
  if (!so.plumb) { so.plumb = { builder: { by: 'Dean Walsh', at: 1790000000000 } }; at.plumb = '{"sels":[],"docs":[]}'; }
  return { memberInfo: { [U.client]: { name: 'Ana Ruiz' }, [U.sub]: { name: 'Clearwater Plumbing', trade: 'plumb' } },
    packetSignoff: so, packetSpecAt: at, packetStale: {}, t: 1 };
}
const soHouse = (nSigned) => ({ mode: 'live', id: 'h', street: 'Sign-off House', members: SO_MEMBERS, memberUids: Object.keys(SO_MEMBERS), meta: soMeta(nSigned), updatedAt: 1 });
/* What setPacketSignoff(p, 'plumb', 'homeowner', true) sends from the homeowner's phone, plus any tamper. */
function signPlumb(d, site, nSigned, tamper) {
  const m = soMeta(nSigned);
  m.packetSignoff.plumb.homeowner = { by: 'Ana Ruiz', at: 1791130000000 };
  m.packetStale.plumb = false; m.t = 2;
  const extra = tamper ? tamper(m) : {};
  return setDoc(doc(d, `sites/${site}`), Object.assign({ meta: m, id: 'h', mode: 'live', updatedAt: 2, updatedBy: 'dev-client',
    updatedByUid: U.client, members: SO_MEMBERS, memberUids: Object.keys(SO_MEMBERS) }, extra), { merge: true });
}

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
/* Denied by the rule's own logic. A refusal that only comes from Firestore's
   1,000-expression limit is not proof (PR 0: the old selection rule refused
   every homeowner write that way, the good ones included). */
const INV_RULE = (n, p) => expect('INVARIANT', n, p.then(
  () => { throw new Error('write was allowed'); },
  (e) => { if (/maximum of 1000 expressions/.test(String(e && e.message))) throw new Error('denied only by the 1,000-expression limit'); }), true);
/* Same proof for house-doc updates. The emulator evaluates an update twice
   and reports both: one pass errors at signedIn() (it cannot read the
   sign-in) and then walks every branch without short-circuiting; on any
   denied house update that pass runs into the 1,000-expression limit (on main
   too). The other pass is the real one. Proof of a rule denial is the real
   pass ending in a plain false; a refusal with no such pass (limit or error
   only) fails, as INV_RULE does. */
const INV_LOGIC = (n, p) => expect('INVARIANT', n, p.then(
  () => { throw new Error('write was allowed'); },
  (e) => {
    const m = String(e && e.message);
    if (!/PERMISSION_DENIED|permission/i.test(m) && (e && e.code) !== 'permission-denied') throw new Error('not a permission denial: ' + m.slice(0, 160));
    if (!/(^|[:,]\s*)false for 'update'/.test(m)) throw new Error(/maximum of 1000 expressions/.test(m) ? 'denied only by the 1,000-expression limit' : 'no rule pass ended in false: ' + m.slice(0, 160));
  }), true);

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
    // PR 0: realistic selections, written the way the app writes a record
    for (const id of SEL_IDS) await setDoc(doc(db, `sites/liveA/sel/${id}`), selDoc());
    // House-doc sign-off houses: 6 and all 29 trades signed by the builder
    for (const [id, n] of [['so6', 6], ['so29', 29], ['so29d', 29]]) await setDoc(doc(db, `sites/${id}`), soHouse(n));
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
    // demoStamped: a non-live house that even names the stranger as its builder (P2-4)
    await setDoc(doc(db, 'sites/demoStamped'), { mode: 'demo', street: 'Demo Stamped',
      members: { [U.demoMember]: 'builder' }, memberUids: [U.demoMember] });
    await setDoc(doc(db, 'sites/demoStamped/items/r1'), { seeded: true });
    // invites / orgs / users / telemetry
    await setDoc(doc(db, 'invites/SECRETCODE1'), { createdBy: U.builder, site: 'liveA', trade: 'plumb' });
    await setDoc(doc(db, `invites/SECRETCODE1/claims/${U.sub}`), { name: 'Mike', at: 1 });
    // Release D: open, used and revoked invites, each with a preview doc
    await setDoc(doc(db, 'invites/OPENCODE2'), { createdBy: U.builder, role: 'client', siteId: 'liveA' });
    await setDoc(doc(db, 'invitePreviews/OPENCODE2'), { builder: 'Calder Homes', street: '12 Elm St' });
    await setDoc(doc(db, 'invites/USEDCODE3'), { createdBy: U.builder, role: 'sub', siteId: 'liveA', claimed: true });
    await setDoc(doc(db, 'invitePreviews/USEDCODE3'), { builder: 'Calder Homes', street: '12 Elm St' });
    await setDoc(doc(db, 'invites/REVOKED4'), { createdBy: U.builder, role: 'sub', siteId: 'liveA', revoked: true });
    await setDoc(doc(db, 'invitePreviews/REVOKED4'), { builder: 'Calder Homes', street: '12 Elm St' });
    await setDoc(doc(db, 'invites/CLAIMCODE5'), { createdBy: U.builder, role: 'sub', siteId: 'liveA' });
    await setDoc(doc(db, 'invites/CLAIMCODE6'), { createdBy: U.builder, role: 'client', siteId: 'liveA' });
    await setDoc(doc(db, 'invites/PREVCODE7'), { createdBy: U.builder, role: 'client', siteId: 'liveA' });
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
  /* P2-4 (Release D) flipped these: a house that is not live is closed to every
     session. Before, any signed-in (even anonymous) session could read and write
     one. The example build keeps practice houses on the phone, so nothing breaks. */
  await INV('sites: P2-4 non-live house closed - signed-in DENIED read', getDoc(doc(db.stranger, 'sites/demo1')), false);
  await INV('sites: unauth DENIED read demo', getDoc(doc(db.unauth, 'sites/demo1')), false);
  await INV('sites: P2-4 even a member stamped on a non-live house DENIED read', getDoc(doc(db.demoMember, 'sites/demoStamped')), false);
  await INV('sites: P2-4 member stamped on a non-live house DENIED update', updateDoc(doc(db.demoMember, 'sites/demoStamped'), { street: 'x' }), false);
  /* List stays member-scoped: the memberships query every app version listens
     with cannot prove mode. Only someone already stamped on an old non-live doc
     gets it back, the app drops it, and no one can stamp themselves onto one now. */
  await GAP('P2-4: a person already stamped on an old non-live house still gets it from their own memberships query',
    getDocs(query(collection(db.demoMember, 'sites'), where('memberUids', 'array-contains', U.demoMember)))
      .then(r => { if (r.size !== 1) throw new Error('expected 1, saw ' + r.size); }), true);
  await INV('sites: P2-4 signed-in DENIED update of a non-live house', updateDoc(doc(db.stranger, 'sites/demo1'), { street: 'x' }), false);
  await INV('sites: P2-4 stranger DENIED taking over a non-live house by flipping it live',
    updateDoc(doc(db.stranger, 'sites/demo1'), { mode: 'live', members: { [U.stranger]: 'builder' }, memberUids: [U.stranger] }), false);
  await INV('sites: P2-4 create of a non-live house DENIED, even self-stamped',
    setDoc(doc(db.stranger, 'sites/newDemo1'), { mode: 'demo', members: { [U.stranger]: 'builder' }, memberUids: [U.stranger] }), false);
  await INV('sites: P2-4 create with no mode DENIED', setDoc(doc(db.stranger, 'sites/newDemo2'), { street: 'x' }), false);

  await INV('sites: builder updates liveA meta', updateDoc(doc(db.builder, 'sites/liveA'), { street: 'Live A upd' }), true);
  await INV('sites: second builder updates liveA meta', updateDoc(doc(db.builder2, 'sites/liveA'), { street: 'Live A upd2' }), true);
  await INV('sites: sub DENIED update liveA meta', updateDoc(doc(db.sub, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: client DENIED update liveA meta', updateDoc(doc(db.client, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: stranger DENIED update liveA meta', updateDoc(doc(db.stranger, 'sites/liveA'), { street: 'x' }), false);
  await INV('sites: sub DENIED self-promotion to builder', updateDoc(doc(db.sub, 'sites/liveA'), { [`members.${U.sub}`]: 'builder' }), false);
  await INV('sites: delete denied even to builder', deleteDoc(doc(db.builder, 'sites/liveA')), false);
  await INV('sites: P2-4 owner DENIED flipping a live house to non-live', updateDoc(doc(db.builder, 'sites/liveA'), { mode: 'demo' }), false);

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
  await INV('records: PR 0 client DENIED creating a sel (homeowners never create selections)', setDoc(doc(db.client, 'sites/liveA/sel/s3'), { signed: true }), false);
  await INV('records: client writes items', setDoc(doc(db.client, 'sites/liveA/items/i3'), { issue: true }), true);
  await INV('records: client DENIED write logs', setDoc(doc(db.client, 'sites/liveA/logs/l3'), { note: 'x' }), false);
  await INV('records: client DENIED write pmts', setDoc(doc(db.client, 'sites/liveA/pmts/p4'), { amt: 0 }), false);
  await INV('records: stranger DENIED write items', setDoc(doc(db.stranger, 'sites/liveA/items/i4'), { x: 1 }), false);
  /* P2-4 flipped: records under a non-live house were open to any signed-in session. */
  await INV('records: P2-4 non-live house records DENIED write', setDoc(doc(db.stranger, 'sites/demo1/items/i5'), { x: 1 }), false);
  await INV('records: P2-4 non-live house records DENIED read', getDoc(doc(db.stranger, 'sites/demo1/items/r1')), false);
  await INV('records: P2-4 member stamped on a non-live house DENIED read', getDoc(doc(db.demoMember, 'sites/demoStamped/items/r1')), false);
  await INV('records: P2-4 member stamped on a non-live house DENIED write', setDoc(doc(db.demoMember, 'sites/demoStamped/items/i6'), { x: 1 }), false);

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

  /* ══════════ HOUSE: homeowner signs a trade's crew instructions ══════════ */
  await INV('signoff: homeowner signs one trade on a house with 6 builder-signed trades - ALLOWED', signPlumb(db.client, 'so6', 6), true);
  await INV('signoff: homeowner signs one trade on a house with all 29 builder-signed - ALLOWED', signPlumb(db.client, 'so29', 29), true);
  await INV_LOGIC('signoff: homeowner also changing another trade\'s builder sign-off - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.packetSignoff.elec.builder.at = 1; return {}; }));
  await INV_LOGIC('signoff: homeowner also clearing another trade\'s builder sign-off - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.packetSignoff.general = {}; return {}; }));
  await INV_LOGIC('signoff: homeowner signing the builder\'s half of the same trade - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.packetSignoff.plumb.builder = { by: 'Ana Ruiz', at: 1791130000000 }; return {}; }));
  await INV_LOGIC('signoff: homeowner signing a trade that is not on the list - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.packetSignoff.pool = { homeowner: { by: 'Ana Ruiz', at: 1 } }; return {}; }));
  await INV_LOGIC('signoff: homeowner also writing the crew roster (memberInfo) - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.memberInfo[U.client].rpRole = 'owner'; return {}; }));
  await INV_LOGIC('signoff: homeowner also writing crew work (packetWork) - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, m => { m.packetWork = { plumb: { fp: 'x', ack: { at: 1 } } }; return {}; }));
  await INV_LOGIC('signoff: homeowner also promoting themselves to builder - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, () => ({ members: Object.assign({}, SO_MEMBERS, { [U.client]: 'builder' }) })));
  await INV_LOGIC('signoff: homeowner also changing a top-level field - DENIED by the rule',
    signPlumb(db.client, 'so29d', 29, () => ({ street: 'Elsewhere' })));
  await INV('signoff: builder still signs (nothing changed for builders)',
    setDoc(doc(db.builder, 'sites/so6'), { meta: Object.assign(soMeta(6), { packetSignoff: Object.assign(soMeta(6).packetSignoff, { elec: { builder: { by: 'Dean Walsh', at: 1791130000002 } } }) }), updatedAt: 3 }, { merge: true }), true);

  /* ══════════ SELECTIONS: homeowner allowlist (PR 0, R-1 prep) ══════════ */
  await INV('sel: (a) homeowner approves a full selection - 9 spec fields + 7 custom slots filled - ALLOWED',
    approveAs(db.client, 's9a'), true);
  await INV('sel: homeowner takes the final OK back (approved false, signed cleared) - ALLOWED',
    approveAs(db.client, 's9a', { approved: false, signed: null }), true);
  await INV('sel: homeowner answers their own questions (spec finish + a homeowner slot value) - ALLOWED',
    setDoc(doc(db.client, 'sites/liveA/sel/s9b'), {
      data: selRec({ spec: Object.assign({}, selRec().spec, { finish: 'Matte black' }),
        specCustom: selRec().specCustom.map((c, i) => i === 0 ? Object.assign({}, c, { value: 'Cross handle' }) : c) }),
      updatedAt: 2, updatedBy: 'dev-client' }, { merge: true }), true);
  for (const [k, v, id] of [['price', -50000, 's9c'], ['allowance', 99999, 's9d'], ['cost', 0, 's9e'],
                            ['costLineId', 'cl_other', 's9f'], ['invoicedIn', null, 's9g']])
    await INV_RULE(`sel: (b) homeowner changing ${k} while approving - DENIED by the rule`, approveAs(db.client, id, { [k]: v }));
  await INV('sel: homeowner marking it installed - DENIED', approveAs(db.client, 's9h', { status: 'installed' }), false);
  await INV('sel: homeowner changing an install detail (rough-in) - DENIED',
    approveAs(db.client, 's9i', { spec: Object.assign({}, selRec().spec, { roughin: '4 in centerset' }) }), false);
  await INV('sel: homeowner adding or dropping a custom slot - DENIED',
    approveAs(db.client, 's9j', { specCustom: selRec().specCustom.slice(0, 6) }), false);
  /* GAP (PR 0, by design for the expression budget): custom slots are not
     checked one by one, so a homeowner driving the API (never the app) can
     rewrite a builder slot's text. No money lives in a slot. */
  await GAP('PR 0: homeowner can rewrite a builder custom slot through the API (no slot-by-slot check)',
    approveAs(db.client, 's9b', { specCustom: selRec().specCustom.map((c, i) => i === 3 ? Object.assign({}, c, { value: 'none' }) : c) }), true);
  await INV('sel: homeowner adding a top-level field beside the record - DENIED',
    setDoc(doc(db.client, 'sites/liveA/sel/s9k'), { price: -50000 }, { merge: true }), false);
  await INV('sel: (c) homeowner creating a priced selection (-$50,000) - DENIED',
    setDoc(doc(db.client, 'sites/liveA/sel/s9new'), { data: { id: 99, room: 'Kitchen', cat: 'Appliances', item: 'Credit', status: 'selected', price: -50000 }, updatedAt: 1, updatedBy: 'dev-client' }), false);
  await INV('sel: builder still sets the price (nothing loosened for builders)',
    setDoc(doc(db.builder, 'sites/liveA/sel/s9k'), { data: selRec({ price: 900 }), updatedAt: 3, updatedBy: 'dev-builder' }, { merge: true }), true);
  /* KNOWN GAP (Day-one: PM and crews can't see Money): a crew member can read a
     selection's price, allowance and cost straight from the database; only
     the app hides them. This asserts today's behavior so a rules change that
     closes it is deliberate. It MUST flip to DENIED before the first paying
     customer. */
  await GAP('KNOWN GAP (Day-one: PM and crews can\'t see Money): crew can read selection money',
    getDoc(doc(db.sub, 'sites/liveA/sel/s9a')).then(r => {
      const d = (r.data() || {}).data || {};
      if (d.price !== 850 || d.allowance !== 1200) throw new Error('money not visible: ' + JSON.stringify(d).slice(0, 80));
    }), true);

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
  await INV('invites: create with claimed already set denied',
    setDoc(doc(db.builder, 'invites/NEWCODE3'), { createdBy: U.builder, site: 'liveA', claimed: true }), false);
  /* Option B must never widen reads on invites/{code}: signed out still gets nothing. */
  await INV('invites: option B - unauth still DENIED get of an open invite', getDoc(doc(db.unauth, 'invites/OPENCODE2')), false);
  await INV('invites: option B - unauth still DENIED list', getDocs(collection(db.unauth, 'invites')), false);

  /* ══════════ N-2: one code, one person ══════════ */
  const claimBatch = (d, code, who) => {
    const b = writeBatch(d);
    b.update(doc(d, `invites/${code}`), { claimed: true, claimedAt: 1 });
    b.set(doc(d, `invites/${code}/claims/${who}`), { name: who, t: 1 });
    return b.commit();
  };
  await INV('claims: N-2 a bare claim that does not mark the code used is DENIED',
    setDoc(doc(db.sub, `invites/CLAIMCODE5/claims/${U.sub}`), { at: 1 }), false);
  await INV('claims: N-2 claim + mark used in one batch allowed (first person)',
    claimBatch(db.sub, 'CLAIMCODE5', U.sub), true);
  await INV('claims: N-2 second person DENIED - the code is used',
    claimBatch(db.client, 'CLAIMCODE5', U.client), false);
  await INV('claims: N-2 second person DENIED a bare claim too',
    setDoc(doc(db.client, `invites/CLAIMCODE5/claims/${U.client}`), { at: 1 }), false);
  await INV('invites: N-2 joiner cannot mark the code unused again',
    updateDoc(doc(db.sub, 'invites/CLAIMCODE5'), { claimed: false }), false);
  await INV('invites: N-2 builder cannot mark the code unused again',
    updateDoc(doc(db.builder, 'invites/CLAIMCODE5'), { claimed: false }), false);
  await INV('invites: N-2 stranger DENIED marking a code used without claiming it',
    updateDoc(doc(db.stranger, 'invites/CLAIMCODE6'), { claimed: true, claimedAt: 1 }), false);
  await INV('invites: N-2 joiner DENIED touching other fields while claiming', (() => {
    const b = writeBatch(db.client);
    b.update(doc(db.client, 'invites/CLAIMCODE6'), { claimed: true, claimedAt: 1, role: 'team' });
    b.set(doc(db.client, `invites/CLAIMCODE6/claims/${U.client}`), { t: 1 });
    return b.commit();
  })(), false);
  await INV('claims: N-2 a revoked code cannot be claimed',
    claimBatch(db.client, 'SECRETCODE1', U.client), false);
  await INV('claims: N-2 an already-used code cannot be claimed', claimBatch(db.client, 'USEDCODE3', U.client), false);
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

  /* ══════════ INVITE PREVIEWS (option B) ══════════ */
  await INV('previews: signed-out get by exact code allowed (join screen before sign-up)',
    getDoc(doc(db.unauth, 'invitePreviews/OPENCODE2')), true);
  await INV('previews: signed-in get by exact code allowed', getDoc(doc(db.stranger, 'invitePreviews/OPENCODE2')), true);
  await INV('previews: holds only the builder name and the street', (async () => {
    const snap = await getDoc(doc(db.unauth, 'invitePreviews/OPENCODE2'));
    const keys = Object.keys(snap.data() || {}).sort().join(',');
    if (keys !== 'builder,street') throw new Error('preview fields: ' + keys);
  })(), true);
  await INV('previews: signed-out LIST denied', getDocs(collection(db.unauth, 'invitePreviews')), false);
  await INV('previews: signed-in LIST denied', getDocs(collection(db.stranger, 'invitePreviews')), false);
  await INV('previews: builder LIST denied', getDocs(collection(db.builder, 'invitePreviews')), false);
  await INV('previews: used code - preview unreadable', getDoc(doc(db.unauth, 'invitePreviews/USEDCODE3')), false);
  await INV('previews: revoked code - preview unreadable', getDoc(doc(db.unauth, 'invitePreviews/REVOKED4')), false);
  await INV('previews: no invite behind the code - unreadable', getDoc(doc(db.unauth, 'invitePreviews/NOSUCHCODE')), false);
  await INV('previews: sender creates one with builder + street',
    setDoc(doc(db.builder, 'invitePreviews/PREVCODE7'), { builder: 'Calder Homes', street: '9 Oak Ave' }), true);
  await INV('previews: a third field is refused',
    setDoc(doc(db.builder, 'invitePreviews/CLAIMCODE6'), { builder: 'Calder Homes', street: '9 Oak Ave', siteId: 'liveA' }), false);
  await INV('previews: the creator uid is refused',
    setDoc(doc(db.builder, 'invitePreviews/CLAIMCODE6'), { builder: 'Calder Homes', street: '9 Oak Ave', createdBy: U.builder }), false);
  await INV('previews: a missing field is refused',
    setDoc(doc(db.builder, 'invitePreviews/CLAIMCODE6'), { builder: 'Calder Homes' }), false);
  await INV('previews: a non-text field is refused',
    setDoc(doc(db.builder, 'invitePreviews/CLAIMCODE6'), { builder: 'Calder Homes', street: { siteId: 'liveA' } }), false);
  await INV('previews: another builder DENIED creating one for an invite they did not send',
    setDoc(doc(db.builder2, 'invitePreviews/CLAIMCODE6'), { builder: 'Other', street: '1 Main' }), false);
  await INV('previews: stranger DENIED creating one', setDoc(doc(db.stranger, 'invitePreviews/CLAIMCODE6'), { builder: 'X', street: 'Y' }), false);
  await INV('previews: signed-out DENIED creating one', setDoc(doc(db.unauth, 'invitePreviews/CLAIMCODE6'), { builder: 'X', street: 'Y' }), false);
  await INV('previews: no preview without an invite behind it',
    setDoc(doc(db.builder, 'invitePreviews/NOSUCHCODE'), { builder: 'X', street: 'Y' }), false);
  await INV('previews: update denied (write once)',
    setDoc(doc(db.builder, 'invitePreviews/PREVCODE7'), { builder: 'Calder Homes', street: '10 Oak Ave' }), false);
  await INV('previews: stranger DENIED delete', deleteDoc(doc(db.stranger, 'invitePreviews/PREVCODE7')), false);
  await INV('previews: another builder DENIED delete', deleteDoc(doc(db.builder2, 'invitePreviews/PREVCODE7')), false);
  await INV('previews: sender deletes it (revoke)', deleteDoc(doc(db.builder, 'invitePreviews/PREVCODE7')), true);

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
    await uploadBytes(ref(s, 'live/sites/demoStamped/photos/seed1'), png, meta);
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
  await INV('storage: signed-in DENIED demo read (closed)', getBytes(ref(st.stranger, 'demo/sites/demo1/photos/seed1')), false);
  await INV('storage: signed-in DENIED demo upload (closed)', uploadBytes(ref(st.stranger, 'demo/sites/demo1/photos/u6'), png, meta), false);
  await INV('storage: builder DENIED demo upload (closed)', uploadBytes(ref(st.builder, 'demo/sites/demo1/photos/u6b'), png, meta), false);
  await INV('storage: unauth DENIED demo read', getBytes(ref(st.unauth, 'demo/sites/demo1/photos/seed1')), false);
  await INV('storage: path outside demo|live denied', uploadBytes(ref(st.builder, 'sites/liveA/photos/u7'), png, meta), false);
  /* P2-4: files follow the house - a non-live house doc never opens its file path. */
  await INV('storage: P2-4 member stamped on a non-live house DENIED upload',
    uploadBytes(ref(st.demoMember, 'live/sites/demoStamped/photos/u8'), png, meta), false);
  await INV('storage: P2-4 member stamped on a non-live house DENIED read',
    getBytes(ref(st.demoMember, 'live/sites/demoStamped/photos/seed1')), false);
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
