/* lib/telemetry.js — #17 (batch 3): the telemetry endpoints, server side.
   Writes (telemetryBeat, telemetryEvent) need a real signed-in account, never an
   anonymous session, and each account gets a simple fixed-window rate limit
   (telemetryRate/{uid}, server-only: the rules match nothing there, so no
   client can read or reset it). The owner-only reads (telemetryUsage,
   telemetryClear) are bounded: one page of devices, newest first, and a cap on
   events per device; `more` says when there is another page. */
'use strict';

const RATE = { windowMs: 60 * 1000, max: 20 };   // a beat a minute plus a burst of events
const DEVICES_MAX = 200;
const EVENTS_PER_DEVICE = 10;
const CLEAR_EVENTS_MAX = 500;

function isAnonymous(user) {
  const f = (user && user.firebase) || {};
  return !user || !user.uid || f.sign_in_provider === 'anonymous';
}

/* true when this call is inside the account's budget; counts it. */
async function rateOk(db, uid, now, rate) {
  const r = rate || RATE;
  const ref = db.collection('telemetryRate').doc(String(uid));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() || {}) : {};
    const w = Number(d.w) || 0;
    const n = Number(d.n) || 0;
    if (!snap.exists || now - w >= r.windowMs || now < w) { tx.set(ref, { w: now, n: 1 }); return true; }
    if (n >= r.max) return false;
    tx.set(ref, { w, n: n + 1 });
    return true;
  });
}

/* The gate both write endpoints use. {ok:true} or {ok:false, status, error}. */
async function writeGate(db, user, now, rate) {
  if (isAnonymous(user)) return { ok: false, status: 403, error: 'account-required' };
  if (!(await rateOk(db, user.uid, now, rate))) return { ok: false, status: 429, error: 'rate-limited' };
  return { ok: true };
}

async function usage(db, opts) {
  const o = opts || {};
  const max = o.devicesMax || DEVICES_MAX;
  const per = o.eventsPerDevice || EVENTS_PER_DEVICE;
  const snap = await db.collection('telemetry').orderBy('t', 'desc').limit(max).get();
  const devices = [];
  for (const doc of snap.docs) {
    let events = [];
    try {
      const es = await db.collection('telemetry').doc(doc.id).collection('events').orderBy('t', 'desc').limit(per).get();
      events = es.docs.map((e) => e.data());
    } catch (e) {}
    devices.push(Object.assign({}, doc.data(), { events }));
  }
  return { devices, more: snap.docs.length >= max };
}

async function clear(db, opts) {
  const o = opts || {};
  const max = o.devicesMax || DEVICES_MAX;
  const evMax = o.eventsMax || CLEAR_EVENTS_MAX;
  const snap = await db.collection('telemetry').limit(max).get();
  let n = 0;
  let more = snap.docs.length >= max;
  for (const doc of snap.docs) {
    try {
      const es = await doc.ref.collection('events').limit(evMax).get();
      for (const e of es.docs) await e.ref.delete();
      if (es.docs.length >= evMax) { more = true; continue; }   // device kept until its events are gone
      await doc.ref.delete(); n++;
    } catch (e) {}
  }
  return { ok: true, n, more };
}

module.exports = { RATE, DEVICES_MAX, EVENTS_PER_DEVICE, CLEAR_EVENTS_MAX, isAnonymous, rateOk, writeGate, usage, clear };
