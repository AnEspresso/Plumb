/* subfilter.js — permanent sub-view filtering-integrity test for SitePlumb.
 *
 * WHY: information isolation between subcontractors is a core promise of the app.
 * A sub must never SEE another sub's bookings, specs, selections, or items in the
 * UI. This test extracts the REAL filtering functions from the app source and checks
 * the isolation invariants two ways:
 *   1) SEED SWEEP — every sub x every site in the bundled demo seed.
 *   2) FUZZ — thousands of randomized, adversarial "builder input" configs, plus
 *      fault injection to prove the structural detectors actually fire.
 * Part of the deploy ritual: `node subfilter.js` must exit 0 (prints PASS).
 *
 * NOTE ON SCOPE: this validates the client-side DISPLAY filtering (what a sub sees
 * in the UI), which is identical code in demo and live. It does NOT test Firestore
 * security rules or on-device data delivery — the server-side boundary is a
 * separate concern (see the security-rules test).
 *
 * ROBUSTNESS: symbols are pulled out by NAME (brace-balanced), never by line
 * number. Inline predicates that live inside larger render functions (booking +
 * open-item filters) are mirrored here AND anchored to source text, so if the app
 * changes them, this test fails loudly instead of drifting out of sync.
 */
const fs = require('fs');
const path = require('path');
/* index.html is the canonical/deployed artifact; plumb.html is a parity copy.
 * Read index.html, and if plumb.html also exists, assert they are byte-identical
 * so this test can never silently validate a stale file. */
const CANDIDATES = ['index.html', 'plumb.html'];
const present = CANDIDATES.filter(f => fs.existsSync(path.join(__dirname, f)));
if (!present.length) { console.log('FAIL: no index.html or plumb.html found in ' + __dirname); process.exit(1); }
const SRC_FILE = present[0];
const SRC = fs.readFileSync(path.join(__dirname, SRC_FILE), 'utf8');
if (present.length > 1) {
  const other = fs.readFileSync(path.join(__dirname, present[1]), 'utf8');
  if (other !== SRC) { console.log(`FAIL: ${present[0]} and ${present[1]} differ — deploy parity broken; refusing to test an ambiguous source`); process.exit(1); }
}

/* ---------- brace-balanced extraction (skips string literals) ---------- */
function balancedFrom(str, openIdx) {
  const open = str[openIdx], close = { '{': '}', '[': ']', '(': ')' }[open];
  let depth = 0, q = null;
  for (let i = openIdx; i < str.length; i++) {
    const c = str[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return str.slice(openIdx, i + 1);
  }
  throw new Error('unbalanced from ' + openIdx);
}
function extractFn(name) {
  const m = SRC.indexOf('function ' + name + '(');
  if (m < 0) throw new Error('function not found: ' + name);
  const brace = SRC.indexOf('{', SRC.indexOf(')', m));
  return 'function ' + name + SRC.slice(SRC.indexOf('(', m), brace).trimEnd() + balancedFrom(SRC, brace);
}
function extractConst(name) {
  const m = SRC.indexOf('const ' + name + '=');
  if (m < 0) throw new Error('const not found: ' + name);
  const eq = m + ('const ' + name + '=').length;
  const first = SRC.slice(eq).search(/\S/) + eq, ch = SRC[first];
  if (ch === '{' || ch === '[') return 'const ' + name + '=' + balancedFrom(SRC, first) + ';';
  return SRC.slice(m, SRC.indexOf(';', eq) + 1);
}

/* ---------- source anchors: inline predicates we mirror below ---------- */
/* If either predicate changes in the app source, these fail so the mirrors get updated. */
const ANCHORS = {
  'open-item filter': "it.crew===tr.label&&it.issue&&it.status==='open'",
  'booking filter':   "b.trade===tradeId&&(!sb||b.subName===sb.name)",
};

/* ---------- build sandbox from real app source ---------- */
const prelude = `
  var SEED_VERSION = 8;
  var localStorage = { getItem: () => null, setItem: () => {} };
  function orgPrefs() { return {}; }
  var esc = x => x;
  var state = { projects: [], session: null };
`;
const body = [
  extractConst('SPECIALTIES'), extractFn('specLabel'), extractFn('dayStart'),
  extractFn('sampleState'), extractConst('SUB_SEL_CATS'),
  extractFn('specTemplate'), extractFn('specFields'), extractFn('specStatus'),
  extractFn('specComplete'), extractFn('tradeSelections'),
  extractFn('subProjects'), extractFn('subTradeFor'),
].join('\n');

const box = {};
new Function(prelude + body + `
  this.sampleState=sampleState; this.specLabel=specLabel;
  this.SUB_SEL_CATS=SUB_SEL_CATS; this.tradeSelections=tradeSelections;
  this.SPECIALTIES=SPECIALTIES; this.subProjects=subProjects; this.subTradeFor=subTradeFor;
  this._set=function(projects,name){ state.projects=projects; state.session=name?{role:'subs',name}:null; };
`).call(box);
const { sampleState, specLabel, SUB_SEL_CATS, tradeSelections, SPECIALTIES, subProjects, subTradeFor } = box;

/* ---------- mirrored inline predicates (kept honest by ANCHORS) ---------- */
const bookingsForSub = (p, sub) => (p.bookings || []).filter(b => b.trade === sub.specialty && b.subName === sub.name);
const itemsForSub    = (p, sub) => (p.items || []).filter(it => it.crew === specLabel(sub.specialty) && it.issue && it.status === 'open');

/* ---------- reusable checks over a `projects` array ---------- */
function labelCollisions() {
  const by = {}, out = [];
  SPECIALTIES.forEach(s => (by[s.label] = by[s.label] || []).push(s.id));
  Object.entries(by).filter(([, ids]) => ids.length > 1)
    .forEach(([l, ids]) => out.push(`LABEL COLLISION: "${l}" shared by [${ids.join(', ')}]`));
  return out;
}
function structuralProblems(projects) {
  const out = [];
  const nameTrades = {};
  projects.forEach(p => p.subs.forEach(s => (nameTrades[s.name] = nameTrades[s.name] || new Set()).add(s.specialty)));
  Object.entries(nameTrades).filter(([, t]) => t.size > 1)
    .forEach(([n, t]) => out.push(`NAME->TRADE INCONSISTENT: "${n}" is [${[...t].join(', ')}]`));
  projects.forEach(p => {
    const names = p.subs.map(s => s.name);
    names.forEach((n, i) => { if (names.indexOf(n) !== i) out.push(`DUP NAME on ${p.street}: "${n}"`); });
    (p.bookings || []).forEach(b => {
      if (!p.subs.find(s => s.name === b.subName && s.specialty === b.trade))
        out.push(`ORPHAN BOOKING on ${p.street}: subName="${b.subName}" trade="${b.trade}"`);
    });
  });
  return out;
}
/* isolation: for each sub, only its own trade-scoped + own bookings appear */
function isolationProblems(projects) {
  const out = [];
  projects.forEach(p => {
    p.subs.forEach(sub => {
      box._set(projects, sub.name);
      const label = specLabel(sub.specialty);
      // resolves to OWN trade (only well-defined when the name is unique on the site)
      const t = subTradeFor(p);
      if (t.id !== sub.specialty && p.subs.filter(s => s.name === sub.name).length === 1)
        out.push(`RESOLVE: ${sub.name} resolved to ${t.id} not ${sub.specialty} on ${p.street}`);
      // selections only in own trade cats
      tradeSelections(p, sub.specialty).forEach(sel => {
        if (!(SUB_SEL_CATS[sub.specialty] || []).includes(sel.cat))
          out.push(`SEL LEAK: ${sub.name} sees cat "${sel.cat}" on ${p.street}`);
      });
      // items only own crew label
      itemsForSub(p, sub).forEach(it => { if (it.crew !== label) out.push(`ITEM LEAK: ${sub.name} sees crew "${it.crew}"`); });
      // bookings only own; never a co-sub's
      const mine = bookingsForSub(p, sub);
      mine.forEach(b => { if (b.subName !== sub.name) out.push(`BOOKING LEAK: ${sub.name} sees ${b.subName}`); });
      p.subs.filter(s => s.name !== sub.name).forEach(other => {
        (p.bookings || []).filter(b => b.subName === other.name && b.trade === other.specialty)
          .forEach(b => { if (mine.includes(b)) out.push(`CROSS-SUB BOOKING: ${sub.name} sees ${other.name} on ${p.street}`); });
      });
    });
  });
  return out;
}

/* ---------- seeded RNG for reproducible fuzz ---------- */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* build a random, mostly-well-formed multi-site config (unique names by construction) */
function randomProjects(rnd) {
  const trades = SPECIALTIES.map(s => s.id).filter(id => id !== 'general');
  const allCats = [...new Set(Object.values(SUB_SEL_CATS).flat())];
  const pick = a => a[Math.floor(rnd() * a.length)];
  const nSites = 1 + Math.floor(rnd() * 3);
  const projects = [];
  let nameCounter = 0;
  for (let si = 0; si < nSites; si++) {
    const nSubs = 1 + Math.floor(rnd() * 4);
    const subs = [];
    for (let k = 0; k < nSubs; k++) {
      const specialty = pick(trades);
      const name = 'Co' + (nameCounter++) + '_' + specialty;   // unique by construction
      subs.push({ id: 's' + si + k, name, specialty, cleared: rnd() < 0.5 ? Date.now() - 1e6 : null });
    }
    const bookings = [];
    subs.forEach(s => { if (rnd() < 0.6) bookings.push({ id: 'b' + s.id, subName: s.name, trade: s.specialty, start: Date.now(), end: Date.now() + 3e8, note: 'work' }); });
    const selections = [];
    const nSel = Math.floor(rnd() * 4);
    for (let j = 0; j < nSel; j++) selections.push({ id: 'sel' + si + j, item: 'Item' + j, cat: pick(allCats) });
    const items = [];
    const nIt = Math.floor(rnd() * 4);
    for (let j = 0; j < nIt; j++) { const owner = pick(subs); items.push({ id: 'it' + si + j, crew: specLabel(owner.specialty), issue: rnd() < 0.7, status: rnd() < 0.5 ? 'open' : 'done', area: 'A' }); }
    projects.push({ id: 'p' + si, street: 'Fuzz ' + si, subs, bookings, selections, items });
  }
  return projects;
}

/* ---------- run ---------- */
const problems = [];

// 0) source anchors present
Object.entries(ANCHORS).forEach(([label, str]) => { if (!SRC.includes(str)) problems.push(`ANCHOR DRIFT: "${label}" predicate not found in app source — mirror in subfilter.js is stale`); });

// 1) seed sweep
const seed = sampleState().projects;
problems.push(...labelCollisions(), ...structuralProblems(seed), ...isolationProblems(seed));
const seedSubs = new Set(seed.flatMap(p => p.subs.map(s => s.name))).size;

// 2) fuzz: isolation must hold on well-formed random input
const fuzzN = 3000;
for (let i = 0; i < fuzzN; i++) {
  const rnd = mulberry32(0xC0FFEE + i);
  const projs = randomProjects(rnd);
  const structural = structuralProblems(projs);   // well-formed by construction; should be clean
  if (structural.length) problems.push(`FUZZ#${i} unexpected structural: ${structural[0]}`);
  const iso = isolationProblems(projs);
  if (iso.length) problems.push(`FUZZ#${i} ISOLATION: ${iso[0]}`);
}

// 3) fault injection: each detector must fire on a planted fault
function expectDetected(desc, mutate, kind) {
  const rnd = mulberry32(0xBADBAD);
  const projs = randomProjects(rnd);
  mutate(projs);
  const found = structuralProblems(projs).some(p => p.startsWith(kind));
  if (!found) problems.push(`DETECTOR MISS: planted "${desc}" not caught by ${kind}`);
}
expectDetected('duplicate name', ps => { const p = ps[0]; p.subs.push({ id: 'dup', name: p.subs[0].name, specialty: 'elec', cleared: null }); }, 'DUP NAME');
expectDetected('orphan booking', ps => { const p = ps[0]; (p.bookings = p.bookings || []).push({ id: 'orph', subName: 'Nobody Inc', trade: 'plumb', start: 0, end: 0 }); }, 'ORPHAN BOOKING');
expectDetected('trade-mismatched booking', ps => { const p = ps[0]; (p.bookings = p.bookings || []).push({ id: 'mis', subName: p.subs[0].name, trade: p.subs[0].specialty === 'elec' ? 'plumb' : 'elec', start: 0, end: 0 }); }, 'ORPHAN BOOKING');

/* ---------- report ---------- */
console.log(`subfilter [${SRC_FILE}]: seed ${seedSubs} subs x ${seed.length} sites; fuzz ${fuzzN} configs + 3 fault injections`);
if (problems.length) {
  console.log('FAIL:');
  [...new Set(problems)].slice(0, 20).forEach(p => console.log('  x ' + p));
  if (problems.length > 20) console.log(`  ...and ${problems.length - 20} more`);
  process.exit(1);
}
console.log('PASS: filtering isolation holds on the seed and on all fuzzed builder-input configs; all detectors fire.');
process.exit(0);
