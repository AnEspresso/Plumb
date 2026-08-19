/* Plumb server — Firebase Cloud Functions (2nd gen, Node 20).
   Protocol: POST JSON {data:{…}} with Authorization: Bearer <Firebase ID token>;
   responses are {result:{…}}. qbCallback alone is a browser GET from Intuit. */
'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const qbo = require('./lib/qbo');
const { exportCosts } = require('./lib/exportCosts');
const { deleteAccount } = require('./lib/deleteAccount');

setGlobalOptions({ region: 'us-central1', maxInstances: 5 });
admin.initializeApp();
const db = admin.firestore();

const ALLOWED_ORIGINS = () => (process.env.APP_ORIGINS ||
  'https://siteplumb.com,https://www.siteplumb.com,https://anespresso.github.io').split(',');

function cors(req, res) {
  const o = req.headers.origin || '';
  if (ALLOWED_ORIGINS().includes(o)) res.set('Access-Control-Allow-Origin', o);
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return true; }
  return false;
}

async function requireUser(req, res) {
  try {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) throw new Error('no token');
    return await admin.auth().verifyIdToken(tok);
  } catch (e) { res.status(401).json({ error: 'auth-required' }); return null; }
}

function ownerUids() { return (process.env.OWNER_UIDS || '').split(',').filter(Boolean); }
function callbackUrl() {
  return process.env.QB_REDIRECT_URI ||
    ('https://us-central1-' + (process.env.GCLOUD_PROJECT || 'plumb-467a0') + '.cloudfunctions.net/qbCallback');
}
const body = req => (req.body && req.body.data) || {};

/* ── QuickBooks: begin OAuth ── */
exports.qbConnect = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const state = crypto.randomBytes(20).toString('hex');
  await db.collection('qbStates').doc(state).set({ uid: user.uid, ts: Date.now() });
  res.json({ result: { url: qbo.authorizeUrl(callbackUrl(), state) } });
});

/* ── QuickBooks: OAuth redirect target (no Firebase auth — state doc is the proof) ── */
exports.qbCallback = onRequest(async (req, res) => {
  try {
    const { code, state, realmId } = req.query;
    if (!code || !state || !realmId) throw new Error('missing params');
    const sRef = db.collection('qbStates').doc(String(state));
    const sSnap = await sRef.get();
    if (!sSnap.exists) throw new Error('unknown state');
    const { uid, ts } = sSnap.data();
    await sRef.delete();
    if (Date.now() - ts > 10 * 60 * 1000) throw new Error('state expired');
    const j = await qbo.exchangeCode(String(code), callbackUrl());
    const t = {
      realmId: String(realmId),
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
      connectedAt: Date.now(),
      env: process.env.QB_ENV || 'sandbox',
    };
    t.company = await qbo.companyName(t);
    await db.collection('qb').doc(uid).set(t);
    res.set('Content-Type', 'text/html').send(
      '<!doctype html><body style="font-family:sans-serif;background:#15130F;color:#E7DCC6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>QuickBooks connected ✓</h2><p>You can close this window and return to Plumb.</p></div>' +
      '<script>try{if(window.opener)window.opener.postMessage("qb-connected","*");}catch(e){}setTimeout(function(){try{window.close();}catch(e){}},1500);</script></body>');
  } catch (e) {
    res.status(400).set('Content-Type', 'text/html')
      .send('<!doctype html><body style="font-family:sans-serif"><h3>Connection failed</h3><p>' +
        String(e.message || e).replace(/[<>&]/g, '') + '</p><p>Close this window and try again from Plumb.</p></body>');
  }
});

exports.qbStatus = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const snap = await db.collection('qb').doc(user.uid).get();
  if (!snap.exists || !snap.data().refreshToken) { res.json({ result: { connected: false } }); return; }
  const d = snap.data();
  res.json({ result: { connected: true, company: d.company || '', realmId: d.realmId, env: d.env || 'sandbox', connectedAt: d.connectedAt } });
});

exports.qbDisconnect = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  await db.collection('qb').doc(user.uid).delete();
  res.json({ result: { ok: true } });
});

exports.qbExportCosts = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const siteId = String(body(req).siteId || '');
  if (!siteId) { res.status(400).json({ error: 'siteId required' }); return; }
  try { res.json({ result: await exportCosts(db, user.uid, siteId) }); }
  catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

/* ── Account deletion: preview without {confirm}, execute with it. The bucket
   name is explicit — this project uses a new-style firebasestorage.app bucket,
   which the Admin SDK's appspot.com default would miss. ── */
exports.deleteAccount = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  try {
    const bucket = admin.storage().bucket(process.env.PLUMB_BUCKET || 'plumb-467a0.firebasestorage.app');
    const r = await deleteAccount(db, admin.auth(), bucket, user.uid, !!body(req).confirm, String(user.email || '').toLowerCase());
    res.json({ result: r });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});

/* ── Telemetry through the server: clients lose direct Firestore access ── */
exports.telemetryBeat = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const b = body(req);
  const deviceId = String(b.deviceId || '').slice(0, 60);
  if (!deviceId) { res.status(400).json({ error: 'deviceId required' }); return; }
  await db.collection('telemetry').doc(deviceId).set({
    device: deviceId, uid: user.uid,
    mode: String(b.mode || '').slice(0, 12), role: String(b.role || '').slice(0, 12),
    name: String(b.name || '').slice(0, 60), v: String(b.v || '').slice(0, 20),
    ua: String(b.ua || '').slice(0, 200), t: Date.now(),
  }, { merge: true });
  res.json({ result: { ok: true } });
});

exports.telemetryEvent = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const b = body(req);
  const deviceId = String(b.deviceId || '').slice(0, 60);
  if (!deviceId) { res.status(400).json({ error: 'deviceId required' }); return; }
  await db.collection('telemetry').doc(deviceId).collection('events').add({
    name: String(b.name || '').slice(0, 60), detail: String(b.detail || '').slice(0, 200),
    role: String(b.role || '').slice(0, 12), uid: user.uid, t: Date.now(),
  });
  res.json({ result: { ok: true } });
});

exports.telemetryUsage = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  if (!ownerUids().includes(user.uid)) { res.status(403).json({ error: 'owner-only' }); return; }
  const out = [];
  const snap = await db.collection('telemetry').get();
  for (const doc of snap.docs) {
    const d = doc.data(); let events = [];
    try {
      const es = await db.collection('telemetry').doc(doc.id).collection('events').orderBy('t', 'desc').limit(10).get();
      events = es.docs.map(e => e.data());
    } catch (e) {}
    out.push({ ...d, events });
  }
  res.json({ result: { devices: out } });
});

exports.telemetryClear = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  if (!ownerUids().includes(user.uid)) { res.status(403).json({ error: 'owner-only' }); return; }
  let n = 0;
  const snap = await db.collection('telemetry').get();
  for (const doc of snap.docs) {
    try {
      const es = await db.collection('telemetry').doc(doc.id).collection('events').get();
      for (const e of es.docs) { await e.ref.delete(); }
      await doc.ref.delete(); n++;
    } catch (e) {}
  }
  res.json({ result: { ok: true, n } });
});

/* ── Lock-screen push when a sub replies on a packet ── */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const push = require('./lib/push');

async function deliver(uids, notice) {
  const tokens = await push.tokensFor(db, uids);
  return push.sendPush(admin, tokens, notice);
}

exports.onPacketReply = onDocumentWritten('packets/{token}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const notice = push.packetNotice(before, after);
  if (!notice) return;
  const siteId = after && after.siteId;
  if (!siteId) return;
  const siteSnap = await db.collection('sites').doc(String(siteId)).get();
  if (!siteSnap.exists) return;
  const uids = push.builderUids(siteSnap.data() || {});
  if (!uids.length) return;
  await deliver(uids, notice);
});

exports.notifyTest = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  const b = body(req) || {};
  const notice = {
    key: 'test:' + Date.now(),
    title: 'SitePlumb test',
    body: 'Lock-screen push is on for this phone.',
  };
  let tokens = [];
  if (b.token && String(b.token).length > 20) {
    tokens = [String(b.token)];
    try {
      await db.collection('users').doc(user.uid).set({ fcm: { [tokens[0]]: Date.now() }, t: Date.now() }, { merge: true });
    } catch (e) {}
  } else {
    res.json({ result: { ok: true, sent: 0, failed: 0, reason: 'no-token' } });
    return;
  }
  const r = await push.sendPush(admin, tokens, notice);
  res.json({ result: { ok: true, sent: r.sent || 0, failed: r.failed || 0 } });
});

