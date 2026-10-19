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
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, deleteField, collection,
  query, where, onSnapshot, writeBatch, serverTimestamp,
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
/* F-2 R2: money keys live on selm, not sel. Default fixture has none so
   homeowner clientSelOk writes and builder sel writes without money pass.
   selRecMoney keeps a leftover-money shape for the residual crew-read GAP. */
function selRec(over) {
  return Object.assign({
    id: 9, room: 'Primary Bath', cat: 'Plumbing Fixtures', item: 'Brushed brass package',
    status: 'selected', approved: false, note: 'Rough-in confirmed on site',
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
function selRecMoney(over) {
  return selRec(Object.assign({ price: 850, allowance: 1200, cost: 640,
    costLineId: 'cl_plumb_fix', invoicedIn: 'inv_p2_1' }, over || {}));
}
const selDocMoney = (over) => ({ data: selRecMoney(over), updatedAt: 1, updatedBy: 'dev-builder' });
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

/* F-2 R: an invoice (sites/{id}/inv/{invId}) and a selection's money
   (sites/{id}/selm/{selId}, doc id = the selection id), written the way the
   app writes a record ({data, updatedAt, updatedBy}). */
const INV_DOC = (over) => ({ data: Object.assign({ id: 'inv_r1', num: 3, status: 'sent', amount: 18500,
  lines: [{ label: 'Draw 3: framing', amount: 18500 }] }, over || {}), updatedAt: 1, updatedBy: 'dev-builder' });
const SELM_DOC = (over) => ({ data: Object.assign({ selId: 's9a', price: 850, allowance: 1200, cost: 640,
  costLineId: 'cl_plumb_fix', invoicedIn: 'inv_r1' }, over || {}), updatedAt: 1, updatedBy: 'dev-builder' });

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

/* Rules A1 denials. The emulator evaluates a denied record write on several passes; one errors or hits the
   1,000-expression limit while walking every branch. Proof of a denial by the A1 rule itself is a pass that ends in a
   plain "false for '<method>' @ L<n>" on one of the A1 allow lines (found in the rules file), not the limit. */
const A1_LINES = (() => {
  const L = fs.readFileSync(FS_RULES, 'utf8').split('\n');
  const at = L.findIndex(x => x.includes('Rules A1: the five new collections'));
  const out = {};
  for (const m of ['read', 'create', 'update', 'delete']) { const i = L.findIndex((x, k) => k > at && x.trim().startsWith('allow ' + m + ':')); out[m] = i + 1; }
  return out;
})();
const A1_RE = new RegExp(`false for '(create|update|delete)' @ L(${A1_LINES.create}|${A1_LINES.update}|${A1_LINES.delete})\\b`);
const INV_A1 = (n, p) => expect('INVARIANT', n, p.then(
  () => { throw new Error('write was allowed'); },
  (e) => {
    const m = String(e && e.message);
    if (!/PERMISSION_DENIED|permission/i.test(m) && (e && e.code) !== 'permission-denied') throw new Error('not a permission denial: ' + m.slice(0, 160));
    if (!A1_RE.test(m)) throw new Error('no clean A1 rule pass ended in false: ' + m.slice(0, 200));
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
    // F-2 R: an invoice and a selection's money, in their own collections
    await setDoc(doc(db, 'sites/liveA/inv/inv_r1'), INV_DOC());
    await setDoc(doc(db, 'sites/liveA/selm/s9a'), SELM_DOC());
    // F-2 R: the second builder is on the roster without the money gate
    // (liveGate) and with moneyJob (liveGateJ); the owner has no roster entry.
    for (const [id, info] of [['liveGate', { name: 'Pat PM', rpRole: 'pm' }],
                              ['liveGateJ', { name: 'Pat PM', rpRole: 'pm', gates: { moneyJob: true } }]]) {
      await setDoc(doc(db, `sites/${id}`), { mode: 'live', street: id,
        members: { [U.builder]: 'builder', [U.builder2]: 'builder', [U.client]: 'client' },
        memberUids: [U.builder, U.builder2, U.client],
        meta: { memberInfo: { [U.builder2]: info } } });
      await setDoc(doc(db, `sites/${id}/costs/r1`), { seeded: true });
      await setDoc(doc(db, `sites/${id}/inv/inv_r1`), INV_DOC());
      await setDoc(doc(db, `sites/${id}/selm/s9a`), SELM_DOC());
    }
    // PR 0: realistic selections, written the way the app writes a record
    // F-2 R2: default sel has no money keys; sGap keeps leftover money for the residual GAP
    for (const id of SEL_IDS) await setDoc(doc(db, `sites/liveA/sel/${id}`), selDoc());
    await setDoc(doc(db, 'sites/liveA/sel/sGap'), selDocMoney());
    // F-1 clientInvOk fixtures: a draft invoice and a second sent one
    await setDoc(doc(db, 'sites/liveA/inv/inv_draft'), INV_DOC({ id: 'inv_draft', status: 'draft' }));
    await setDoc(doc(db, 'sites/liveA/inv/inv_sent2'), INV_DOC({ id: 'inv_sent2', status: 'sent' }));
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
  /* F-2 R2: money on sel is refused for every role, including builder. */
  await INV('sel: builder writing price on sel - DENIED (R2; money lives on selm)',
    setDoc(doc(db.builder, 'sites/liveA/sel/s9k'), { data: selRec({ price: 900 }), updatedAt: 3, updatedBy: 'dev-builder' }, { merge: true }), false);
  await INV('sel: builder writing sel without money keys - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/sel/s9k'), { data: selRec({ item: 'Updated package' }), updatedAt: 3, updatedBy: 'dev-builder' }, { merge: true }), true);
  /* Residual GAP: a leftover pre-migration sel that still carries money is
     still readable by crew (sel read is sMember()). R2 blocks new money
     writes on sel; migration + absorb clear live houses. sGap is that leftover. */
  await GAP('RESIDUAL: crew can still read leftover money on an unmigrated sel',
    getDoc(doc(db.sub, 'sites/liveA/sel/sGap')).then(r => {
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

  /* Costs follow the money gate: a builder on the roster without it is
     refused, the same builder with moneyJob gets in. */
  await INV('costs: builder without the money gate DENIED read', getDoc(doc(db.builder2, 'sites/liveGate/costs/r1')), false);
  await INV('costs: builder without the money gate DENIED write', setDoc(doc(db.builder2, 'sites/liveGate/costs/c2'), { x: 1 }), false);
  await INV('costs: builder with moneyJob reads', getDoc(doc(db.builder2, 'sites/liveGateJ/costs/r1')), true);

  /* ══════════ F-2 R: INVOICES (inv) and SELECTION MONEY (selm) ══════════
     Additive: new collections only. The house doc and sel are untouched here
     (R2 refuses meta.invoices and money on sel, and adds the homeowner's
     invoice approve). Read: builder with moneyOk() or the homeowner. Write:
     builder with moneyOk() only. */
  for (const [c, id, mk] of [['inv', 'inv_r1', INV_DOC], ['selm', 's9a', SELM_DOC]]) {
    const at = (d, site, docId) => doc(d, `sites/${site}/${c}/${docId || id}`);
    // builder who passes moneyOk(): full create / read / update / delete
    await INV(`${c}: builder (owner) reads`, getDoc(at(db.builder, 'liveA')), true);
    await INV(`${c}: builder (owner) lists`, getDocs(collection(db.builder, `sites/liveA/${c}`)), true);
    await INV(`${c}: builder (owner) creates`, setDoc(at(db.builder, 'liveA', 'n1'), mk({ id: 'n1' })), true);
    await INV(`${c}: builder (owner) updates`, updateDoc(at(db.builder, 'liveA', 'n1'), { 'data.amount': 1, updatedAt: 2 }), true);
    await INV(`${c}: builder (owner) deletes`, deleteDoc(at(db.builder, 'liveA', 'n1')), true);
    await INV(`${c}: builder with moneyJob reads`, getDoc(at(db.builder2, 'liveGateJ')), true);
    await INV(`${c}: builder with moneyJob creates`, setDoc(at(db.builder2, 'liveGateJ', 'n2'), mk()), true);
    await INV(`${c}: builder with moneyJob updates`, updateDoc(at(db.builder2, 'liveGateJ', 'n2'), { updatedAt: 3 }), true);
    await INV(`${c}: builder with moneyJob deletes`, deleteDoc(at(db.builder2, 'liveGateJ', 'n2')), true);
    // builder on the roster without the money gate: refused, same as costs
    await INV(`${c}: builder without the money gate DENIED read`, getDoc(at(db.builder2, 'liveGate')), false);
    await INV(`${c}: builder without the money gate DENIED list`, getDocs(collection(db.builder2, `sites/liveGate/${c}`)), false);
    await INV(`${c}: builder without the money gate DENIED create`, setDoc(at(db.builder2, 'liveGate', 'n3'), mk()), false);
    await INV(`${c}: builder without the money gate DENIED update`, updateDoc(at(db.builder2, 'liveGate'), { updatedAt: 9 }), false);
    await INV(`${c}: builder without the money gate DENIED delete`, deleteDoc(at(db.builder2, 'liveGate')), false);
    // homeowner: reads; create/delete denied; incomplete update denied
    // (full clientInvOk suite is the R2 block below — only for inv)
    await INV(`${c}: homeowner reads`, getDoc(at(db.client, 'liveA')), true);
    await INV(`${c}: homeowner lists`, getDocs(collection(db.client, `sites/liveA/${c}`)), true);
    await INV(`${c}: homeowner DENIED create`, setDoc(at(db.client, 'liveA', 'n4'), mk()), false);
    await INV(`${c}: homeowner DENIED update (incomplete / not clientInvOk)`, updateDoc(at(db.client, 'liveA'), { 'data.status': 'approved', updatedAt: 9 }), false);
    await INV(`${c}: homeowner DENIED delete`, deleteDoc(at(db.client, 'liveA')), false);
    // crew: nothing
    await INV(`${c}: crew DENIED read`, getDoc(at(db.sub, 'liveA')), false);
    await INV(`${c}: crew DENIED list`, getDocs(collection(db.sub, `sites/liveA/${c}`)), false);
    await INV(`${c}: crew DENIED create`, setDoc(at(db.sub, 'liveA', 'n5'), mk()), false);
    await INV(`${c}: crew DENIED update`, updateDoc(at(db.sub, 'liveA'), { updatedAt: 9 }), false);
    await INV(`${c}: crew DENIED delete`, deleteDoc(at(db.sub, 'liveA')), false);
    // stranger, other builder, signed out
    await INV(`${c}: stranger DENIED read`, getDoc(at(db.stranger, 'liveA')), false);
    await INV(`${c}: stranger DENIED write`, setDoc(at(db.stranger, 'liveA', 'n6'), mk()), false);
    await INV(`${c}: other house's builder DENIED read`, getDoc(at(db.otherBuilder, 'liveA')), false);
    await INV(`${c}: other house's builder DENIED write`, setDoc(at(db.otherBuilder, 'liveA', 'n7'), mk()), false);
    await INV(`${c}: unauth DENIED read`, getDoc(at(db.unauth, 'liveA')), false);
  }
  /* #40 stays stripped: a homeowner still cannot write invoices onto the house
     doc (clientHouseOk has no invoices key). */
  await INV_LOGIC('F-2 R: homeowner writing meta.invoices on the house - DENIED by the rule (no #40 allow)',
    signPlumb(db.client, 'so29d', 29, m => { m.invoices = [{ id: 'inv_r1', status: 'approved', amount: 18500 }]; return {}; }));

  /* ══════════ F-2 R2: LOCK meta.invoices + sel money; F-1 clientInvOk ══════════ */
  const invBody = (over) => Object.assign({ id: 'inv_r1', num: 3, status: 'sent', amount: 18500,
    lines: [{ label: 'Draw 3: framing', amount: 18500 }] }, over || {});
  const invWrite = (d, id, data, at) => setDoc(doc(d, `sites/liveA/inv/${id}`), {
    data, updatedAt: at || 2, updatedBy: 'dev-client' }, { merge: true });
  const houseMeta = (d, invoices) => setDoc(doc(d, 'sites/liveA'), {
    meta: { invoices }, updatedAt: 9, updatedBy: 'dev-builder', updatedByUid: U.builder,
  }, { merge: true });

  // 1. Refuse non-empty meta.invoices; allow empty clear
  await INV_LOGIC('R2: owner writing non-empty meta.invoices - DENIED',
    houseMeta(db.builder, [{ id: 'inv_x', status: 'sent', amount: 100 }]));
  await INV_LOGIC('R2: builder writing non-empty meta.invoices - DENIED',
    houseMeta(db.builder2, [{ id: 'inv_y', status: 'draft', amount: 50 }]));
  await INV('R2: owner writing meta.invoices: [] - ALLOWED (leftover clear)',
    houseMeta(db.builder, []), true);

  // 2. Refuse money fields on sel for every role; selm still takes money
  for (const [k, v] of [['price', 0], ['allowance', 100], ['cost', 50], ['costLineId', 'cl_x'], ['invoicedIn', 'inv_z']]) {
    await INV(`R2: builder create sel with ${k} - DENIED`,
      setDoc(doc(db.builder, 'sites/liveA/sel/r2c_' + k), { data: selRec({ [k]: v }), updatedAt: 1, updatedBy: 'dev-builder' }), false);
    await INV(`R2: builder update sel with ${k} - DENIED`,
      setDoc(doc(db.builder, 'sites/liveA/sel/s9a'), { data: selRec({ [k]: v }), updatedAt: 4, updatedBy: 'dev-builder' }, { merge: true }), false);
  }
  await INV('R2: builder create sel without money keys - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/sel/r2ok'), { data: selRec({ id: 42, item: 'No money' }), updatedAt: 1, updatedBy: 'dev-builder' }), true);
  await INV('R2: builder writing selm with money - still ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/selm/s9a'), SELM_DOC({ price: 999 }), { merge: true }), true);

  // 3. clientInvOk suite
  await INV('R2 clientInvOk: homeowner sent→approved + approvedAt - ALLOWED',
    invWrite(db.client, 'inv_r1', invBody({ status: 'approved', approvedAt: 1791130000000 })), true);
  await INV_RULE('R2 clientInvOk: homeowner changing amount while approving - DENIED',
    invWrite(db.client, 'inv_sent2', invBody({ id: 'inv_sent2', status: 'approved', approvedAt: 1791130000001, amount: 1 })));
  await INV('R2 clientInvOk: draft→approved - DENIED',
    invWrite(db.client, 'inv_draft', invBody({ id: 'inv_draft', status: 'approved', approvedAt: 1791130000002 })), false);
  await INV('R2 clientInvOk: sent→paid - DENIED',
    invWrite(db.client, 'inv_sent2', invBody({ id: 'inv_sent2', status: 'paid', approvedAt: 1791130000003 })), false);
  await INV('R2 clientInvOk: crew DENIED approve',
    invWrite(db.sub, 'inv_sent2', invBody({ id: 'inv_sent2', status: 'approved', approvedAt: 1791130000004 })), false);
  await INV('R2 clientInvOk: stranger DENIED approve',
    invWrite(db.stranger, 'inv_sent2', invBody({ id: 'inv_sent2', status: 'approved', approvedAt: 1791130000005 })), false);
  await INV('R2: builder still full write on inv',
    setDoc(doc(db.builder, 'sites/liveA/inv/inv_sent2'), INV_DOC({ id: 'inv_sent2', status: 'void', amount: 0 }), { merge: true }), true);

  /* ══════════ STEP 1 (2.469.0): the app's new money fields against the CURRENT rules ══════════
     Cents twins (amountC, totalC, priceC ...) sit inside data; the stamp (byUid, tappedAt, appV) sits
     beside data. A money builder may write both on every money collection. The homeowner's Approve is
     exactly the old write: the current clientInvOk refuses anything beside status and approvedAt, so the
     app does not stamp that one write until rules A2 allows it. */
  const STAMP = { byUid: U.builder, tappedAt: 1791130000100, appV: '2.469.0' };
  const twinDoc = (data) => Object.assign({ data, updatedAt: 5, updatedBy: 'dev-builder' }, STAMP);
  await INV('step 1: builder writes an invoice with totalC, line amountC, payment amountC and the stamp - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/inv/inv_c1'), twinDoc({ id: 'inv_c1', status: 'draft', total: 5.86, totalC: 586,
      items: [{ label: 'a', amount: 5.86, amountC: 586 }], payments: [{ id: 'pm_1', amount: 1, amountC: 100 }] })), true);
  await INV('step 1: builder writes selm with priceC, allowanceC, costC and the stamp - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/selm/s9a'), twinDoc({ id: 's9a', price: 850, priceC: 85000, allowance: 1200, allowanceC: 120000, cost: 640, costC: 64000 }), { merge: true }), true);
  await INV('step 1: builder writes a payment (pmts) with amountC and the stamp - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/pmts/pm_c1'), twinDoc({ id: 'pm_c1', label: 'Deposit', amount: 2000, amountC: 200000 })), true);
  await INV('step 1: builder writes a cost with amountC, budgetC and the stamp - ALLOWED',
    setDoc(doc(db.builder, 'sites/liveA/costs/c_c1'), twinDoc({ id: 'c_c1', rt: 'actual', amount: 12.5, amountC: 1250, adds: [{ amount: 3, amountC: 300 }] })), true);
  await INV('step 1: a builder without the money gate is still DENIED an invoice with the stamp',
    setDoc(doc(db.builder2, 'sites/liveGate/inv/inv_c2'), twinDoc({ id: 'inv_c2', status: 'draft', total: 1, totalC: 100 })), false);
  await INV('step 1: crew DENIED a payment with the stamp',
    setDoc(doc(db.sub, 'sites/liveA/pmts/pm_c3'), twinDoc({ id: 'pm_c3', amount: 1, amountC: 100 })), false);
  await GAP('step 1: a priceC twin on sel is not refused by the current rules (the app strips it; the sim proves sel carries none)',
    setDoc(doc(db.builder, 'sites/liveA/sel/r2ok'), { data: selRec({ id: 42, item: 'No money', priceC: 5 }), updatedAt: 6, updatedBy: 'dev-builder' }, { merge: true }), true);
  await INV('step 1: homeowner Approve carrying the stamp beside data is DENIED by the current rules (so the 2.469.0 app sends the plain approve)',
    setDoc(doc(db.client, 'sites/liveA/inv/inv_sent2'), Object.assign({ data: { status: 'approved', approvedAt: 1791130000200 }, updatedAt: 7, updatedBy: 'dev-client' },
      { byUid: U.client, tappedAt: 1791130000200, appV: '2.469.0' }), { merge: true }), false);

  /* ══════════ RULES A1: change orders and the paper trail (co, hist, consent, flags, numbers, settings) ══════════
     Additive. Every new collection is strict from day one: byUid == uid(), at == request.time (serverTimestamp()),
     rev bumps on content change, decidedRev == rev, never un-sent, never deleted once sent, paper signature needs a
     photo, consent before the homeowner decides, the server verified the total, claims are create-once. */
  const SRV = serverTimestamp;
  const APPV = '2.470.0';
  const stampNow = (uid, extra) => Object.assign({ byUid: uid, at: SRV(), appV: APPV, tappedAt: 1 }, extra || {});
  const coData = (o) => Object.assign({ id: 'co1', title: 'Add a window', amountC: 185000, kind: 'change', status: 'draft', t: 1 }, o || {});
  const sentOf = (o) => coData(Object.assign({ status: 'sent', no: 1, rev: 1, sentAt: 1790000000000, sentBy: U.builder, sentName: 'Dean Walsh', sentRole: 'builder' }, o || {}));
  const coDoc = (uid, data, extra) => Object.assign({ data, updatedAt: 9, updatedBy: 'dev-x' }, stampNow(uid, extra));
  const coRef = (d, id, site) => doc(d, `sites/${site || 'liveA'}/co/${id}`);
  const putCo = (d, id, data, uid, site, extra) => setDoc(coRef(d, id, site), coDoc(uid || U.builder, data, extra));
  const claimDoc = (uid, kind, no) => ({ kind, no, byUid: uid, at: SRV(), appV: APPV });
  /* Sign and send in one batch: the number claim and the change order land together. */
  const sendBatch = (d, id, data, no, uid, site) => { const b = writeBatch(d);
    b.set(doc(d, `sites/${site || 'liveA'}/numbers/co-${no}`), claimDoc(uid || U.builder, 'co', no));
    b.set(coRef(d, id, site), coDoc(uid || U.builder, data));
    return b.commit(); };
  const SEEDS = {
    d1: coData({ id: 'd1' }),
    d2: coData({ id: 'd2' }),
    s_edit: sentOf({ id: 's_edit', no: 11, rev: 1 }),
    s_edit2: sentOf({ id: 's_edit2', no: 12, rev: 1 }),
    s_back: sentOf({ id: 's_back', no: 13 }),
    s_wd: sentOf({ id: 's_wd', no: 14 }),
    s_wd2: sentOf({ id: 's_wd2', no: 15 }),
    s_paper: sentOf({ id: 's_paper', no: 16 }),
    s_paper2: sentOf({ id: 's_paper2', no: 17 }),
    s_paper3: sentOf({ id: 's_paper3', no: 18 }),
    s_paper4: sentOf({ id: 's_paper4', no: 19, rev: 3 }),
    s_noapp: sentOf({ id: 's_noapp', no: 20 }),
    s_del: sentOf({ id: 's_del', no: 21 }),
    a_ok: sentOf({ id: 'a_ok', no: 30, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_stale: sentOf({ id: 'a_stale', no: 31, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_unv: sentOf({ id: 'a_unv', no: 32, rev: 2, verifiedRev: 1, verifiedTotal: 185000 }),
    a_cent: sentOf({ id: 'a_cent', no: 33, rev: 2, verifiedRev: 2, verifiedTotal: 184999 }),
    a_who: sentOf({ id: 'a_who', no: 34, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_time: sentOf({ id: 'a_time', no: 35, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_amt: sentOf({ id: 'a_amt', no: 36, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_nocons: sentOf({ id: 'a_nocons', no: 37, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    a_dec: sentOf({ id: 'a_dec', no: 38, rev: 2 }),
    a_dec2: sentOf({ id: 'a_dec2', no: 39, rev: 2 }),
    a_draft: coData({ id: 'a_draft' }),
    ap1: sentOf({ id: 'ap1', no: 40, status: 'approved', approvedVia: 'paper', decidedBy: U.builder, decidedRev: 1 }),
    ap2: sentOf({ id: 'ap2', no: 41, status: 'approved', approvedVia: 'paper', decidedBy: U.builder, decidedRev: 1 }),
    dc1: sentOf({ id: 'dc1', no: 42, status: 'declined', decidedBy: U.client, decidedRev: 1 }),
    wd1: sentOf({ id: 'wd1', no: 43, status: 'withdrawn', withdrawnBy: U.builder }),
    sx: sentOf({ id: 'sx', no: 44 }),
    app_d: coData({ id: 'app_d', note: 'South wall', days: 2 }),
    app_d2: coData({ id: 'app_d2' }),
    app_s: sentOf({ id: 'app_s', no: 60, note: 'South wall', days: 2 }),
    app_s2: sentOf({ id: 'app_s2', no: 62 }),
    app_s3: sentOf({ id: 'app_s3', no: 63 }),
    app_a: sentOf({ id: 'app_a', no: 64, rev: 2, verifiedRev: 2, verifiedTotal: 185000 }),
    app_p1: sentOf({ id: 'app_p1', no: 69, rev: 2 }),
    app_p2: sentOf({ id: 'app_p2', no: 70, rev: 2 }),
    app_a2: sentOf({ id: 'app_a2', no: 65, rev: 2, verifiedRev: 1, verifiedTotal: 185000 }),
    app_dc: sentOf({ id: 'app_dc', no: 66, rev: 2 }),
    app_dc2: sentOf({ id: 'app_dc2', no: 67, rev: 2 }),
    app_y1: sentOf({ id: 'app_y1', no: 71 }),
    app_y2: sentOf({ id: 'app_y2', no: 72 }),
  };
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const sdb = ctx.firestore();
    for (const [id, data] of Object.entries(SEEDS))
      await setDoc(doc(sdb, `sites/liveA/co/${id}`), { data, updatedAt: 1, updatedBy: 'dev-b', byUid: U.builder, at: 1790000000000, appV: '2.470.0' });
    await setDoc(doc(sdb, 'sites/liveA/hist/h1'), { kind: 'sent', ref: 'co1', at: 1790000000000 });
    await setDoc(doc(sdb, 'sites/liveGateJ/co/dj1'), { data: sentOf({ id: 'dj1', no: 50 }), updatedAt: 1, updatedBy: 'dev-b', byUid: U.builder2, at: 1790000000000, appV: '2.470.0' });
  });
  const upd = (d, id, base, over, uid, extra) => { const m = Object.assign({}, base, over); Object.keys(m).forEach(k => { if (m[k] === undefined) delete m[k]; }); return putCo(d, id, m, uid || U.builder, undefined, extra); };

  /* create */
  await INV('A1 co: builder creates a draft change order', putCo(db.builder, 'n1', coData({ id: 'n1' })), true);
  await INV_A1('A1 co: a draft with a key outside the list (the builder cost) is DENIED', putCo(db.builder, 'n2', coData({ id: 'n2', cost: 900 })));
  await INV_A1('A1 co: a Change with a negative amount (or a Credit with a positive one) is DENIED', putCo(db.builder, 'n3', coData({ id: 'n3', amountC: -500 })));
  await INV_A1('A1 co: a draft that names someone else as byUid is DENIED', putCo(db.builder, 'n4', coData({ id: 'n4' }), U.builder2));
  await INV_A1('A1 co: a draft whose "at" is a phone time, not server time, is DENIED',
    setDoc(coRef(db.builder, 'n5'), { data: coData({ id: 'n5' }), updatedAt: 9, updatedBy: 'x', byUid: U.builder, at: 1790000000000, appV: APPV }));
  await INV_A1('A1 co: a draft with no appV is DENIED',
    setDoc(coRef(db.builder, 'n6'), { data: coData({ id: 'n6' }), updatedAt: 9, updatedBy: 'x', byUid: U.builder, at: SRV() }));
  await INV_A1('A1 co: a draft with a non-integer amount is DENIED', putCo(db.builder, 'n7', coData({ id: 'n7', amountC: 1850.5 })));
  await INV_A1('A1 co: crew DENIED creating a change order', putCo(db.sub, 'n8', coData({ id: 'n8' }), U.sub));
  await INV_A1('A1 co: homeowner DENIED creating a change order', putCo(db.client, 'n9', coData({ id: 'n9' }), U.client));
  await INV_A1('A1 co: a builder without the money gate DENIED', putCo(db.builder2, 'n10', coData({ id: 'n10' }), U.builder2, 'liveGate'));
  await INV('A1 co: a builder with moneyJob may create', putCo(db.builder2, 'n11', coData({ id: 'n11' }), U.builder2, 'liveGateJ'), true);
  await INV('A1 co: Sign and send (rev 1, number claimed in the same batch) ALLOWED',
    sendBatch(db.builder, 'n12', sentOf({ id: 'n12', no: 1, sentAt: SRV() }), 1), true);
  await INV_A1('A1 co: sending without claiming the number is DENIED',
    putCo(db.builder, 'n13', sentOf({ id: 'n13', no: 2, sentAt: SRV() })));
  await INV_A1('A1 co: sending at rev 2 is DENIED', sendBatch(db.builder, 'n14', sentOf({ id: 'n14', no: 3, rev: 2, sentAt: SRV() }), 3));
  await INV_A1('A1 co: sending with a sentAt that is not server time is DENIED', sendBatch(db.builder, 'n15', sentOf({ id: 'n15', no: 4 }), 4));
  await INV_A1('A1 co: the sent name must match membership (Pat PM on this house)',
    sendBatch(db.builder2, 'n16', sentOf({ id: 'n16', no: 5, sentAt: SRV(), sentBy: U.builder2, sentName: 'Somebody Else' }), 5, U.builder2, 'liveGateJ'));
  await INV('A1 co: ... and with the membership name it is ALLOWED',
    sendBatch(db.builder2, 'n17', sentOf({ id: 'n17', no: 5, sentAt: SRV(), sentBy: U.builder2, sentName: 'Pat PM' }), 5, U.builder2, 'liveGateJ'), true);
  await INV('A1 co: a draft becomes sent (rev 1, claim in the batch) ALLOWED',
    sendBatch(db.builder, 'd1', sentOf({ id: 'd1', no: 6, sentAt: SRV() }), 6), true);

  /* 2.471.0 builder app (4a): it writes with merge: set({data: only the changed keys, ...outer stamps}, { merge: true }) and
     clears an optional key with deleteField(). The rules read the merged result, so these must pass exactly as the app sends them. */
  const mrg = (d, id, part) => setDoc(coRef(d, id), Object.assign({ data: part, updatedAt: 9, updatedBy: 'devB' }, stampNow(U.builder)), { merge: true });
  await INV('A1 app 4a: a draft becomes sent by a merge in one batch, clearing its note and days, claim alongside: ALLOWED', (async () => {
    const b = writeBatch(db.builder);
    b.set(doc(db.builder, 'sites/liveA/numbers/co-61'), claimDoc(U.builder, 'co', 61));
    b.set(coRef(db.builder, 'app_d'), Object.assign({ data: { title: 'Add a window', amountC: 185000, kind: 'change', status: 'sent', no: 61, rev: 1, sentAt: SRV(), sentBy: U.builder, sentName: 'Dean Walsh', sentRole: 'builder', note: deleteField(), days: deleteField() }, updatedAt: 9, updatedBy: 'devB' }, stampNow(U.builder)), { merge: true });
    return b.commit(); })(), true);
  await INV('A1 app 4a: a sent change order edited by merge (amountC, rev + 1, note cleared): ALLOWED', mrg(db.builder, 'app_s', { amountC: 210000, rev: 2, note: deleteField() }), true);
  await INV_A1('A1 app 4a: the same merge without the rev bump is DENIED', mrg(db.builder, 'app_s2', { amountC: 210000 }));
  await INV('A1 app 4a: withdraw by merge (status, withdrawnAt server time, withdrawnBy): ALLOWED', mrg(db.builder, 'app_s3', { status: 'withdrawn', withdrawnAt: SRV(), withdrawnBy: U.builder }), true);
  await INV('A1 app 4a: a never-sent draft is deleted: ALLOWED', deleteDoc(coRef(db.builder, 'app_d2')), true);
  /* 2.475.0 builder app (4d-1): Record a paper signature, exactly the merge the app sends. */
  const APAPER = (o) => Object.assign({ status: 'approved', approvedVia: 'paper', paperPhotoId: 'copaper_app_p1_r2_abc123', decidedBy: U.builder, decidedAt: SRV(), decidedRev: 2, sentence: 'This adds $1,850.00 to your contract.' }, o || {});
  await INV_A1('A1 app 4d-1: paper signature on an old revision is DENIED', mrg(db.builder, 'app_p1', APAPER({ decidedRev: 1 })));
  await INV_A1('A1 app 4d-1: paper signature without the photo id is DENIED', mrg(db.builder, 'app_p2', (() => { const d = APAPER(); delete d.paperPhotoId; return d; })()));
  await INV_A1('A1 app 4d-1: paper signature carrying a homeowner name is DENIED (paper is the builder\'s record)', mrg(db.builder, 'app_p2', APAPER({ decidedName: 'Ana Ruiz' })));
  await INV('A1 app 4d-1: Record a paper signature by merge (photo id, builder, server time, current rev, sentence): ALLOWED', mrg(db.builder, 'app_p1', APAPER()), true);
  /* 2.476.0 builder app (4d-2): print and the Schedule-door days note are read-only; the only write behind them is the days field
     (More details), replayed here exactly as the app sends it: a whole number 0-365, and a sent one needs rev + 1. */
  await INV('A1 app 4d-2: a new draft with days added (whole number): ALLOWED', putCo(db.builder, 'app_y0', coData({ id: 'app_y0', days: 3 })), true);
  await INV_A1('A1 app 4d-2: days added over 365 is DENIED (the app refuses it first)', putCo(db.builder, 'app_y3', coData({ id: 'app_y3', days: 400 })));
  await INV_A1('A1 app 4d-2: days added as text is DENIED', putCo(db.builder, 'app_y4', coData({ id: 'app_y4', days: '3' })));
  await INV_A1('A1 app 4d-2: days added on a sent one without rev + 1 is DENIED', mrg(db.builder, 'app_y2', { days: 4 }));
  await INV('A1 app 4d-2: days added on a sent one by merge with rev 2: ALLOWED', mrg(db.builder, 'app_y1', { days: 4, rev: 2 }), true);
  /* 2.474.0 builder app (4c-2): budget line under More details. Only the id is stored; it is chosen before sending and kept after. */
  await INV('A1 app 4c-2: a new draft with a budget line id: ALLOWED', setDoc(coRef(db.builder, 'app_l1'), Object.assign({ data: { id: 'app_l1', status: 'draft', t: 1, title: 'Bigger window', amountC: 200000, kind: 'change', lineId: 'L2' }, updatedAt: 9, updatedBy: 'devB' }, stampNow(U.builder))), true);
  await INV('A1 app 4c-2: that draft sent by merge with its claim, line kept: ALLOWED', (async () => {
    const b = writeBatch(db.builder);
    b.set(doc(db.builder, 'sites/liveA/numbers/co-68'), claimDoc(U.builder, 'co', 68));
    b.set(coRef(db.builder, 'app_l1'), Object.assign({ data: { title: 'Bigger window', amountC: 200000, kind: 'change', lineId: 'L2', status: 'sent', no: 68, rev: 1, sentAt: SRV(), sentBy: U.builder, sentName: 'Dean Walsh', sentRole: 'builder' }, updatedAt: 9, updatedBy: 'devB' }, stampNow(U.builder)), { merge: true });
    return b.commit(); })(), true);
  await INV('A1 app 4c-2: an update to it (amount, rev 2) that leaves the line alone: ALLOWED', mrg(db.builder, 'app_l1', { amountC: 210000, rev: 2 }), true);
  await INV_A1('A1 app 4c-2: changing the line of a sent one without a new revision is DENIED (why the app locks it after send)', mrg(db.builder, 'app_l1', { lineId: 'L1' }));

  /* C-1: rev bumps on any content change of a sent change order */
  await INV_A1('A1 C-1: a builder changes a sent amount WITHOUT bumping rev: DENIED', upd(db.builder, 's_edit', SEEDS.s_edit, { amountC: 285000 }));
  await INV('A1 C-1: ... with rev + 1 and status still sent: ALLOWED', upd(db.builder, 's_edit', SEEDS.s_edit, { amountC: 285000, rev: 2 }), true);
  await INV_A1('A1 C-1: a revision that jumps rev by 2 is DENIED', upd(db.builder, 's_edit2', SEEDS.s_edit2, { amountC: 285000, rev: 3 }));
  await INV_A1('A1 C-1: a sent change order cannot change its number', upd(db.builder, 's_edit2', SEEDS.s_edit2, { no: 99 }));
  await INV_A1('A1 C-1: a builder cannot write verifiedRev (server only)', upd(db.builder, 's_edit2', SEEDS.s_edit2, { verifiedRev: 1, verifiedTotal: 185000 }));
  /* C-2: never un-sent, never deleted */
  await INV_A1('A1 C-2: sent back to draft is DENIED', upd(db.builder, 's_back', SEEDS.s_back, { status: 'draft' }));
  await INV('A1 C-2: Withdraw (status withdrawn, who and server time) ALLOWED',
    upd(db.builder, 's_wd', SEEDS.s_wd, { status: 'withdrawn', withdrawnBy: U.builder, withdrawnAt: SRV() }), true);
  await INV_A1('A1 C-2: a withdrawn change order cannot change again', upd(db.builder, 'wd1', SEEDS.wd1, { status: 'sent' }));
  await INV_A1('A1 C-2: the homeowner cannot withdraw', upd(db.client, 's_wd2', SEEDS.s_wd2, { status: 'withdrawn', withdrawnBy: U.client, withdrawnAt: SRV() }, U.client));
  for (const [nm, id] of [['sent', 's_del'], ['approved', 'ap1'], ['declined', 'dc1'], ['withdrawn', 'wd1']])
    await INV_RULE(`A1 C-2: delete of a ${nm} change order is DENIED`, deleteDoc(coRef(db.builder, id)));
  await INV('A1 C-2: delete of a never-sent draft is ALLOWED', deleteDoc(coRef(db.builder, 'd2')), true);
  await INV_A1('A1 C-2: the homeowner cannot delete a change order', deleteDoc(coRef(db.client, 'a_draft')));
  /* C-5: paper signature */
  const PAPER = { status: 'approved', approvedVia: 'paper', paperPhotoId: 'ph_1', decidedBy: U.builder, decidedAt: SRV(), decidedRev: 1 };
  await INV('A1 C-5: a builder records a paper signature (photo, decidedBy = uid, rev match) ALLOWED', upd(db.builder, 's_paper', SEEDS.s_paper, PAPER), true);
  await INV_A1('A1 C-5: paper signature without a photo is DENIED', upd(db.builder, 's_paper2', SEEDS.s_paper2, Object.assign({}, PAPER, { paperPhotoId: '' })));
  await INV_A1('A1 C-5: approvedVia other than paper is DENIED', upd(db.builder, 's_paper2', SEEDS.s_paper2, Object.assign({}, PAPER, { approvedVia: 'app' })));
  await INV_A1('A1 C-5: paper signature with someone else as decidedBy is DENIED', upd(db.builder, 's_paper3', SEEDS.s_paper3, Object.assign({}, PAPER, { decidedBy: U.builder2 })));
  await INV_A1('A1 C-5: paper signature at a stale rev is DENIED', upd(db.builder, 's_paper4', SEEDS.s_paper4, PAPER));
  await INV_A1('A1 C-5: a builder approving without paper is DENIED', upd(db.builder, 's_noapp', SEEDS.s_noapp, { status: 'approved', decidedBy: U.builder, decidedAt: SRV(), decidedRev: 1 }));
  await INV_A1('A1 C-5: a homeowner setting approvedVia paper is DENIED', upd(db.client, 's_paper3', SEEDS.s_paper3, PAPER, U.client));
  await INV('A1 co: an approved change order may only gain invoicedIn', upd(db.builder, 'ap1', SEEDS.ap1, { invoicedIn: 'inv_9' }), true);
  await INV_A1('A1 co: an approved change order cannot change its amount', upd(db.builder, 'ap2', SEEDS.ap2, { amountC: 1 }));

  /* C-3 + C-1 + M-8 + M-14 + M-17: the homeowner's decision */
  const DEC = (o) => Object.assign({ status: 'approved', decidedBy: U.client, decidedAt: SRV(), decidedRev: 2, decidedName: 'Ana Ruiz', decidedRole: 'client', sentence: 'This adds $1,850.00 to your contract.' }, o || {});
  await INV_A1('A1 M-8: approving with no consent record is DENIED', upd(db.client, 'a_nocons', SEEDS.a_nocons, DEC(), U.client));
  await INV('A1 M-8: the homeowner records consent for themselves (own doc id, server time)',
    setDoc(doc(db.client, `sites/liveA/consent/${U.client}`), { byUid: U.client, at: SRV(), agreed: true, textV: 'esign-v1', appV: APPV }), true);
  /* 2.472.0 homeowner app (4b): the decision is one merge write, exactly these keys; consent is {agreed, textV} + stamps. */
  const hmrg = (id, part) => setDoc(coRef(db.client, id), Object.assign({ data: Object.fromEntries(Object.entries(part).filter(([, v]) => v !== undefined)), updatedAt: 9, updatedBy: 'devH' }, stampNow(U.client)), { merge: true });
  const HDEC = (o) => Object.assign({ status: 'approved', decidedAt: SRV(), decidedBy: U.client, decidedRev: 2, decidedName: 'Ana Ruiz', decidedRole: 'client', sentence: 'This adds $1,850.00 to your contract.' }, o || {});
  await INV('A1 app 4b: the consent the app writes ({agreed, textV, byUid, at, appV, tappedAt}) is ALLOWED', setDoc(doc(db.client, 'sites/liveGateJ/consent/' + U.client), { agreed: true, textV: 'v0-placeholder-2026-10', byUid: U.client, at: SRV(), appV: APPV, tappedAt: 1 }), true);
  await INV('A1 app 4b: Approve and sign by merge (current rev, verified total, sentence, consent given): ALLOWED', hmrg('app_a', HDEC()), true);
  await INV_A1('A1 app 4b: the same approve on a revision the server has not verified is DENIED', hmrg('app_a2', HDEC()));
  await INV_A1('A1 app 4b: approving a stale revision (the builder updated it) is DENIED', hmrg('app_dc', HDEC({ decidedRev: 1 })));
  await INV('A1 app 4b: Decline by merge with a reason: ALLOWED', hmrg('app_dc', HDEC({ status: 'declined', sentence: undefined, declineNote: 'Too much' })), true);
  await INV('A1 app 4b: Decline by merge without a reason: ALLOWED', hmrg('app_dc2', (() => { const d = HDEC({ status: 'declined' }); delete d.sentence; return d; })()), true);
  await INV('A1 C-1: approve with the current decidedRev and a verified total ALLOWED', upd(db.client, 'a_ok', SEEDS.a_ok, DEC(), U.client), true);
  await INV_A1('A1 C-1: approve with a stale decidedRev is DENIED', upd(db.client, 'a_stale', SEEDS.a_stale, DEC({ decidedRev: 1 }), U.client));
  await INV_A1('A1 M-14: approve while verifiedRev != rev is DENIED', upd(db.client, 'a_unv', SEEDS.a_unv, DEC(), U.client));
  await INV_A1('A1 M-14: approve when the verified total is one cent off is DENIED', upd(db.client, 'a_cent', SEEDS.a_cent, DEC(), U.client));
  await INV_A1('A1 C-3: a homeowner writing someone else\'s uid as decidedBy is DENIED', upd(db.client, 'a_who', SEEDS.a_who, DEC({ decidedBy: U.builder }), U.client));
  await INV_A1('A1 C-3: a decidedAt that is not server time is DENIED', upd(db.client, 'a_time', SEEDS.a_time, DEC({ decidedAt: 1790000000000 }), U.client));
  await INV_A1('A1 C-3: the byUid beside data must be the homeowner', upd(db.client, 'a_who', SEEDS.a_who, DEC(), U.builder));
  await INV_A1('A1 C-1: a decision that also changes the amount is DENIED', upd(db.client, 'a_amt', SEEDS.a_amt, DEC({ amountC: 1 }), U.client));
  await INV_A1('A1 M-8: approve without the saved sentence is DENIED', upd(db.client, 'a_amt', SEEDS.a_amt, DEC({ sentence: undefined }), U.client));
  await INV('A1 C-1: decline (a note, current rev) ALLOWED even before the server check', upd(db.client, 'a_dec', SEEDS.a_dec, DEC({ status: 'declined', sentence: undefined, declineNote: 'Too much' }), U.client), true);
  await INV_A1('A1 co: a decline note over the size cap is DENIED', upd(db.client, 'a_dec2', SEEDS.a_dec2, DEC({ status: 'declined', sentence: undefined, declineNote: 'x'.repeat(501) }), U.client));
  await INV_A1('A1 co: the homeowner cannot touch a draft', upd(db.client, 'a_draft', SEEDS.a_draft, { title: 'Mine' }, U.client));
  await INV_A1('A1 co: crew DENIED any decision', upd(db.sub, 'sx', SEEDS.sx, DEC({ decidedBy: U.sub }), U.sub));
  await INV_A1('A1 co: stranger DENIED any decision', upd(db.stranger, 'sx', SEEDS.sx, DEC({ decidedBy: U.stranger }), U.stranger));

  /* C-5 list rule and who reads */
  const COQ = (d, withFilter) => withFilter
    ? query(collection(d, 'sites/liveA/co'), where('data.status', 'in', ['sent', 'approved', 'declined', 'withdrawn']))
    : collection(d, 'sites/liveA/co');
  await INV('A1 C-5: homeowner list WITH the status filter ALLOWED', getDocs(COQ(db.client, true)), true);
  await INV('A1 C-5: homeowner list WITHOUT the status filter DENIED', getDocs(COQ(db.client, false)), false);
  await INV('A1 co: homeowner reads a sent change order by id', getDoc(coRef(db.client, 'sx')), true);
  await INV('A1 co: homeowner DENIED a draft by id', getDoc(coRef(db.client, 'a_draft')), false);
  await INV('A1 co: builder reads every change order', getDocs(COQ(db.builder, false)), true);
  await INV('A1 co: crew DENIED get', getDoc(coRef(db.sub, 'sx')), false);
  await INV('A1 co: crew DENIED list (with the filter too)', getDocs(COQ(db.sub, true)), false);
  await INV('A1 co: a builder without the money gate DENIED get', getDoc(coRef(db.builder2, 'dj1', 'liveGate')), false);
  await INV('A1 co: stranger DENIED', getDoc(coRef(db.stranger, 'sx')), false);
  await INV('A1 co: unauth DENIED', getDoc(coRef(db.unauth, 'sx')), false);

  /* hist: the server writes it; nobody on a phone does */
  const H = (d, site) => doc(d, `sites/${site || 'liveA'}/hist/h1`);
  await INV('A1 hist: builder reads', getDoc(H(db.builder)), true);
  await INV('A1 hist: homeowner reads', getDoc(H(db.client)), true);
  await INV('A1 hist: crew DENIED read', getDoc(H(db.sub)), false);
  await INV('A1 hist: a builder without the money gate DENIED read', getDoc(doc(db.builder2, 'sites/liveGate/hist/h1')), false);
  /* 2.477.0 app (3c-2): the History screen and each change order list the whole hist collection, exactly as the app queries it. */
  const HL = (d, site) => getDocs(collection(d, `sites/${site || 'liveA'}/hist`));
  await INV('A1 app 3c-2: builder lists the house history', HL(db.builder), true);
  await INV('A1 app 3c-2: homeowner lists the house history', HL(db.client), true);
  await INV('A1 app 3c-2: crew DENIED listing history', HL(db.sub), false);
  await INV('A1 app 3c-2: a builder without the money gate DENIED listing history', HL(db.builder2, 'liveGate'), false);
  await INV_A1('A1 hist: any client write is DENIED (builder)', setDoc(doc(db.builder, 'sites/liveA/hist/h9'), { kind: 'sent', at: SRV() }));
  await INV_A1('A1 hist: any client write is DENIED (homeowner)', setDoc(doc(db.client, 'sites/liveA/hist/h9'), { kind: 'approved', at: SRV() }));
  await INV_A1('A1 hist: a builder cannot edit a line', setDoc(H(db.builder), { kind: 'void', at: SRV() }));
  await INV_A1('A1 hist: a builder cannot delete a line', deleteDoc(H(db.builder)));

  /* consent: the homeowner's own, never edited */
  const CONS = (uid, o) => Object.assign({ byUid: uid, at: SRV(), agreed: true, textV: 'esign-v1', appV: APPV }, o || {});
  await INV_A1('A1 consent: the homeowner cannot write another person\'s consent doc', setDoc(doc(db.client, `sites/liveA/consent/${U.builder}`), CONS(U.client)));
  await INV_A1('A1 consent: the builder cannot consent for the homeowner', setDoc(doc(db.builder, `sites/liveA/consent/${U.client}x`), CONS(U.builder)));
  await INV_A1('A1 consent: a consent with a phone time is DENIED', setDoc(doc(db.client, 'sites/liveGateJ/consent/' + U.client), CONS(U.client, { at: 1790000000000 })));
  await INV_A1('A1 consent: agreed must be true', setDoc(doc(db.client, 'sites/liveGateJ/consent/' + U.client), CONS(U.client, { agreed: false })));
  await INV_A1('A1 consent: never edited', setDoc(doc(db.client, `sites/liveA/consent/${U.client}`), CONS(U.client, { textV: 'esign-v2' })));
  await INV_A1('A1 consent: never deleted', deleteDoc(doc(db.client, `sites/liveA/consent/${U.client}`)));
  await INV('A1 consent: the homeowner reads their own', getDoc(doc(db.client, `sites/liveA/consent/${U.client}`)), true);
  await INV('A1 consent: the builder reads it (proof)', getDoc(doc(db.builder, `sites/liveA/consent/${U.client}`)), true);
  await INV('A1 consent: crew DENIED', getDoc(doc(db.sub, `sites/liveA/consent/${U.client}`)), false);

  /* flags: either side creates; never edited or deleted; crews never */
  const FLAG = (uid, o) => Object.assign({ kind: 'flag', targetType: 'inv', targetId: 'inv_r1', note: 'The total looks wrong', byUid: uid, at: SRV(), appV: APPV }, o || {});
  await INV('A1 flags: the homeowner flags an invoice', setDoc(doc(db.client, 'sites/liveA/flags/f1'), FLAG(U.client)), true);
  await INV('A1 flags: the builder flags a payment', setDoc(doc(db.builder, 'sites/liveA/flags/f2'), FLAG(U.builder, { targetType: 'pmt', targetId: 'pm_1' })), true);
  await INV('A1 flags: resolving is a new entry with a note and the flag id', setDoc(doc(db.builder, 'sites/liveA/flags/f3'), FLAG(U.builder, { kind: 'resolve', ref: 'f1', note: 'Fixed' })), true);
  await INV_A1('A1 flags: a resolve with no ref is DENIED', setDoc(doc(db.builder, 'sites/liveA/flags/f4'), FLAG(U.builder, { kind: 'resolve' })));
  await INV_A1('A1 flags: crew DENIED', setDoc(doc(db.sub, 'sites/liveA/flags/f5'), FLAG(U.sub)));
  await INV_A1('A1 flags: a builder without the money gate DENIED', setDoc(doc(db.builder2, 'sites/liveGate/flags/f6'), FLAG(U.builder2)));
  await INV_A1('A1 flags: a flag in someone else\'s name is DENIED', setDoc(doc(db.client, 'sites/liveA/flags/f7'), FLAG(U.builder)));
  await INV_A1('A1 flags: an empty note is DENIED', setDoc(doc(db.client, 'sites/liveA/flags/f8'), FLAG(U.client, { note: '' })));
  await INV_A1('A1 flags: a key outside the list is DENIED', setDoc(doc(db.client, 'sites/liveA/flags/f9'), FLAG(U.client, { amountC: 5 })));
  await INV_A1('A1 flags: no one can edit a flag', setDoc(doc(db.client, 'sites/liveA/flags/f1'), FLAG(U.client, { note: 'changed' })));
  await INV_A1('A1 flags: no one can delete a flag', deleteDoc(doc(db.builder, 'sites/liveA/flags/f1')));
  await INV('A1 flags: the homeowner reads flags', getDoc(doc(db.client, 'sites/liveA/flags/f1')), true);
  await INV('A1 flags: crew DENIED read', getDoc(doc(db.sub, 'sites/liveA/flags/f1')), false);

  /* number claims: create once, never update or delete */
  await INV('A1 numbers: a builder claims co-100', setDoc(doc(db.builder, 'sites/liveA/numbers/co-100'), claimDoc(U.builder, 'co', 100)), true);
  await INV_A1('A1 numbers: a second claim of the same number is DENIED', setDoc(doc(db.builder2, 'sites/liveA/numbers/co-100'), claimDoc(U.builder2, 'co', 100)));
  await INV('A1 numbers: invoices use the same mechanism (inv-14)', setDoc(doc(db.builder, 'sites/liveA/numbers/inv-14'), claimDoc(U.builder, 'inv', 14)), true);
  await INV_A1('A1 numbers: the document id must match the kind and number', setDoc(doc(db.builder, 'sites/liveA/numbers/co-101'), claimDoc(U.builder, 'co', 102)));
  await INV_A1('A1 numbers: a claim cannot be deleted', deleteDoc(doc(db.builder, 'sites/liveA/numbers/co-100')));
  await INV_A1('A1 numbers: homeowner DENIED claiming', setDoc(doc(db.client, 'sites/liveA/numbers/co-103'), claimDoc(U.client, 'co', 103)));
  await INV_A1('A1 numbers: crew DENIED claiming', setDoc(doc(db.sub, 'sites/liveA/numbers/co-104'), claimDoc(U.sub, 'co', 104)));
  await INV_A1('A1 numbers: a claim with a phone time is DENIED', setDoc(doc(db.builder, 'sites/liveA/numbers/co-105'), Object.assign(claimDoc(U.builder, 'co', 105), { at: 1790000000000 })));
  /* 2.478.0 app (3c-3, M-6): Send writes the invoice record (the sync's replace shape) and numbers/inv-N in ONE batch. */
  const appInv = (id, no) => Object.assign({ data: { id, no: 'INV-' + String(no).padStart(3, '0'), title: 'Selections invoice', due: '', items: [{ label: 'Tile', amount: 250 }], total: 250, status: 'sent', t: 1791000000000, sentBy: 'Dean Walsh', payments: [] }, updatedAt: 9, updatedBy: 'devB' }, { byUid: U.builder, tappedAt: 9, appV: APPV });
  const invSendBatch = (d, id, no, uid) => { const b = writeBatch(d); b.set(doc(d, `sites/liveA/inv/${id}`), appInv(id, no)); b.set(doc(d, `sites/liveA/numbers/inv-${no}`), claimDoc(uid || U.builder, 'inv', no)); return b.commit(); };
  await INV('A1 app 3c-3: Send an invoice: the record and its inv-15 claim in one batch: ALLOWED', invSendBatch(db.builder, 'inv_app1', 15), true);
  await INV_A1('A1 app 3c-3: a second phone sending with the same number (inv-15) is DENIED, record and all', invSendBatch(db.builder2, 'inv_app2', 15, U.builder2));
  await INV('A1 app 3c-3: ... the invoice from the refused batch was not written', getDoc(doc(db.builder, 'sites/liveA/inv/inv_app2')).then(s => { if (s.exists()) throw new Error('written'); }), true);
  await INV('A1 app 3c-3: the builder lists claims to find the next number', getDocs(collection(db.builder, 'sites/liveA/numbers')), true);
  await INV('A1 app 3c-3: crew DENIED listing claims', getDocs(collection(db.sub, 'sites/liveA/numbers')), false);
  await INV('A1 numbers: the builder reads claims', getDoc(doc(db.builder, 'sites/liveA/numbers/co-100')), true);
  await INV('A1 numbers: homeowner DENIED read', getDoc(doc(db.client, 'sites/liveA/numbers/co-100')), false);

  /* the version settings document: signed-in read, nobody writes */
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'settings/money'), { minAppV: 2470 }); });
  await INV('A1 settings: a signed-in person reads settings/money', getDoc(doc(db.client, 'settings/money')), true);
  await INV('A1 settings: unauth DENIED', getDoc(doc(db.unauth, 'settings/money')), false);
  await INV('A1 settings: no client write (builder)', setDoc(doc(db.builder, 'settings/money'), { minAppV: 1 }), false);
  await INV('A1 settings: no client write (homeowner)', setDoc(doc(db.client, 'settings/money'), { minAppV: 1 }), false);
  await INV('A1 settings: no listing', getDocs(collection(db.builder, 'settings')), false);
  /* additive proof: the old record rules for existing names are untouched */
  await INV('A1 additive: a builder still writes a plain items record', setDoc(doc(db.builder, 'sites/liveA/items/a1_plain'), { data: { id: 1 }, updatedAt: 1, updatedBy: 'd' }), true);
  await INV('A1 additive: the homeowner still reads pmts', getDoc(doc(db.client, 'sites/liveA/pmts/r1')), true);

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
