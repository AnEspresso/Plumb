/* M-16: the guard refuses money writes, lets other writes through, and every repair script loads it. Plain node. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { installMoneyGuard, isMoneyPath, MoneyGuardError, MONEY } from './lib/moneyGuard.mjs';

/* path rules */
['sites/s1/inv/i1', 'sites/s1/pmts/p1', 'sites/s1/co/c', 'sites/s1/hist/h', 'sites/s1/numbers/n', 'sites/s1/consent/x', 'sites/s1/flags/x', 'sites/s1/costs/c', 'sites/s1/selm/a', 'archive/s1/x', 'sites/s1/inv'].forEach(p => assert.ok(isMoneyPath(p), p));
['sites/s1', 'sites/s1/bk/b1', 'sites/s1/sel/a', 'invites/c1/claims/u', 'users/u1', 'sites/s1/notes/inv'].forEach(p => assert.ok(!isMoneyPath(p), p));

/* a fake Firestore with the real class shapes */
const calls = [];
const hold = { co: [true] };   // house s1 has a money doc; s2 has none
class DocumentReference { constructor(p) { this.path = p; } async set() { calls.push(['set', this.path]); } async update() { calls.push(['update', this.path]); } async create() { calls.push(['create', this.path]); } async delete() { calls.push(['delete', this.path]); }
  async listCollections() { const id = this.path.split('/')[1]; return id === 's1' ? [{ id: 'inv', limit: () => ({ get: async () => ({ empty: false }) }) }, { id: 'bk', limit: () => ({ get: async () => ({ empty: false }) }) }] : [{ id: 'bk', limit: () => ({ get: async () => ({ empty: false }) }) }, { id: 'inv', limit: () => ({ get: async () => ({ empty: true }) }) }]; } }
class CollectionReference { constructor(p) { this.path = p; } async add() { calls.push(['add', this.path]); } }
class WriteBatch { set(r) { calls.push(['bset', r.path]); } update(r) { calls.push(['bupdate', r.path]); } create(r) { calls.push(['bcreate', r.path]); } delete(r) { calls.push(['bdelete', r.path]); } }
class Transaction { set(r) { calls.push(['tset', r.path]); } update(r) { calls.push(['tu', r.path]); } create(r) { calls.push(['tc', r.path]); } delete(r) { calls.push(['td', r.path]); } }
class BulkWriter { set(r) { calls.push(['bw', r.path]); } update(r) { calls.push(['bw', r.path]); } create(r) { calls.push(['bw', r.path]); } delete(r) { calls.push(['bw', r.path]); } }
class Firestore { recursiveDelete() { calls.push(['rd']); } }
installMoneyGuard({ DocumentReference, CollectionReference, WriteBatch, Transaction, BulkWriter, Firestore });
installMoneyGuard({ DocumentReference, CollectionReference, WriteBatch, Transaction, BulkWriter, Firestore });   // twice is harmless

const D = (p) => new DocumentReference(p);
(async () => {
  for (const m of ['set', 'update', 'create', 'delete']) await assert.rejects(D('sites/s1/inv/i1')[m](), MoneyGuardError, m + ' on inv');
  await assert.rejects(new CollectionReference('sites/s1/pmts').add({}), MoneyGuardError);
  const b = new WriteBatch(); for (const m of ['set', 'update', 'create', 'delete']) assert.throws(() => b[m](D('sites/s1/co/c1')), MoneyGuardError, 'batch ' + m);
  assert.throws(() => new Transaction().set(D('sites/s1/hist/h')), MoneyGuardError); assert.throws(() => new BulkWriter().delete(D('sites/s1/consent/c')), MoneyGuardError);
  assert.throws(() => new Firestore().recursiveDelete(), MoneyGuardError);
  assert.strictEqual(calls.length, 0, 'nothing reached the database');
  /* deleting a house: refused with money under it, allowed without (the retire-dup-street case) */
  await assert.rejects(D('sites/s1').delete(), /still has money records/);
  await D('sites/s2').delete(); assert.deepStrictEqual(calls.pop(), ['delete', 'sites/s2']);
  assert.throws(() => new WriteBatch().delete(D('sites/s2')), MoneyGuardError);
  /* everything else passes through unchanged */
  await D('sites/s1').set({}); await D('sites/s1/bk/b').update({}); await D('invites/c').delete(); await new CollectionReference('sites/s1/bk').add({}); new WriteBatch().update(D('sites/s1'));
  assert.strictEqual(calls.length, 5);
  /* every script that opens Firestore with the admin SDK loads the guard before it does */
  const dir = path.dirname(new URL(import.meta.url).pathname); let n = 0;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/from 'firebase-admin\/firestore'/.test(src)) continue; n++;
    assert.ok(/import \{ installMoneyGuard \} from '\.\/lib\/moneyGuard\.mjs';/.test(src) && /installMoneyGuard\(firestoreModule\)/.test(src) && /import \* as firestoreModule from 'firebase-admin\/firestore'/.test(src), f + ' must load the money guard');
    assert.ok(src.indexOf('installMoneyGuard(firestoreModule)') < src.indexOf('getFirestore()'), f + ': guard installed before the database is opened');
  }
  assert.ok(n >= 5, 'found the repair scripts');
  console.log('moneyGuard: all checks passed (' + MONEY.length + ' money collections, ' + n + ' scripts guarded)');
})().catch(e => { console.error(e); process.exit(1); });
