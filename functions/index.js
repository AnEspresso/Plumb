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
const archiveSite = require('./lib/archiveSite');

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
    const r = await deleteAccount(db, admin.auth(), bucket, user.uid, !!body(req).confirm, String(user.email || '').toLowerCase(), undefined, { archive: archiveSite.accountArchiver(db, admin.storage().bucket(process.env.ARCHIVE_BUCKET || 'plumb-467a0-money-archive'), admin.firestore.FieldValue) });
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
const { onDocumentWritten, onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const push = require('./lib/push');
const { applyClaimToSite, claimWins } = require('./lib/claimStamp');

/* The join-screen preview (builder name + street) lives only while the code
   is open. Best-effort: a missing doc is fine. */
async function dropPreview(code) {
  try { await db.collection('invitePreviews').doc(String(code)).delete(); } catch (e) {}
}

async function deliver(uids, notice) {
  const tokens = await push.tokensFor(db, uids);
  return push.sendPush(admin, tokens, notice);
}

/* A claim writes the house. The builder's phone is no longer the publisher. */
exports.onInviteClaim = onDocumentCreated('invites/{code}/claims/{uid}', async (event) => {
  const code = event.params.code;
  const uid = event.params.uid;
  const claim = (event.data && event.data.data && event.data.data()) || {};
  const invSnap = await db.collection('invites').doc(code).get();
  if (!invSnap.exists) return;
  const invite = invSnap.data() || {};
  invite.code = code;
  if (invite.revoked) return;
  /* N-2: one code, one person. Only the first claim on a code stamps a house. */
  const claimSnap = await db.collection('invites').doc(code).collection('claims').get();
  const claims = claimSnap.docs.map((d) => ({ id: d.id, at: d.createTime ? d.createTime.toMillis() : 0 }));
  if (!claimWins(uid, claims)) return;
  if (invite.claimed !== true) {
    try { await invSnap.ref.update({ claimed: true, claimedAt: Date.now() }); } catch (e) {}
  }
  await dropPreview(code);
  let docs = [];
  if (invite.role === 'team') {
    const owner = String(invite.createdBy || '');
    if (!owner) return;
    const q = await db.collection('sites').where('memberUids', 'array-contains', owner).get();
    docs = q.docs;
  } else {
    const siteId = String(invite.siteId || '');
    if (!siteId) return;
    const one = await db.collection('sites').doc(siteId).get();
    if (!one.exists) return;
    docs = [one];
  }
  for (const doc of docs) {
    const patch = applyClaimToSite(doc.data() || {}, invite, uid, claim);
    if (!patch) continue;
    await doc.ref.set(Object.assign({ updatedAt: Date.now() }, patch), { merge: true });
  }
});

/* Revoked or used: the code is closed, so its join-screen preview goes. */
exports.onInviteClosed = onDocumentUpdated('invites/{code}', async (event) => {
  const before = (event.data && event.data.before && event.data.before.data()) || {};
  const after = (event.data && event.data.after && event.data.after.data()) || {};
  const closed = (d) => d.revoked === true || d.claimed === true;
  if (!closed(after) || closed(before)) return;
  await dropPreview(event.params.code);
});

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
    key: 'plumb-test',
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

/* P2-6 (Release I): a deleted field note or cost entry takes its photo files
   out of Storage, gone for good. Fires on deletes only; other collections exit
   at once. A failed file delete is logged and never blocks the user. */
const { deleteRecordFiles, describeDeleteEvent } = require('./lib/fileCleanup');
exports.onRecordDeleted = onDocumentDeleted('sites/{siteId}/{coll}/{docId}', async (event) => {
  const bucketName = process.env.PLUMB_BUCKET || 'plumb-467a0.firebasestorage.app';
  /* Always-on, before any early return: where it fired, what the deleted doc held, which photo ids and
     storage paths it will try, or the exact reason it will do nothing (INFO in Cloud Logging). */
  try { console.log(JSON.stringify(describeDeleteEvent(event, bucketName))); } catch (_) {}
  const coll = event.params.coll;
  if (coll !== 'items' && coll !== 'costs') return;
  /* v2 onDocumentDeleted: event.data is the deleted document's snapshot, so data() is the old doc
     ({data:{...record},updatedAt,updatedBy}); the record, and its photoId, sit under .data. */
  const doc = (event.data && event.data.data && event.data.data()) || {};
  const bucket = admin.storage().bucket(bucketName);
  const r = await deleteRecordFiles(bucket, event.params.siteId, doc);
  /* Outcome line: every attempted path ends up in exactly one of deleted / missing / failed. */
  try { console.log(JSON.stringify(Object.assign({ severity: (r.failed.length ? 'ERROR' : (r.missing.length ? 'WARNING' : 'INFO')), message: 'onRecordDeleted result', bucket: bucketName, siteId: event.params.siteId, docId: event.params.docId }, r))); } catch (_) {}
});

/* Step 3a (2.470.0): the money history writer and the server's own money check.
   DORMANT: each trigger reads settings/paperTrail and returns at once unless it says enabled: true
   (only the console or the server writes that document; no client can). */
const paperTrail = require('./lib/paperTrail');
const _ptTs = () => admin.firestore.FieldValue.serverTimestamp();
exports.paperTrailInv = onDocumentWritten('sites/{siteId}/inv/{docId}', (event) => paperTrail.handle(db, _ptTs, 'inv', event));
exports.paperTrailCo = onDocumentWritten('sites/{siteId}/co/{docId}', (event) => paperTrail.handle(db, _ptTs, 'co', event));
exports.paperTrailPmts = onDocumentWritten('sites/{siteId}/pmts/{docId}', (event) => paperTrail.handle(db, _ptTs, 'pmts', event));
/* 2.483.0: real pushes for the money notices (G1-G3, G5) and for a new flag. 10/22 decision: pushes to homeowners go out
   regardless of the paper-trail switch; pushes to builders still wait for it. The app's bell shows the same notices (same keys). */
async function moneyPush(coll, event) {
  const on = await paperTrail.enabled(db);   /* 10/22: homeowner pushes go regardless; builder pushes need the switch */
  const b = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const a = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!b || !a) return { skipped: 'create or delete' };
  const site = (await db.collection('sites').doc(event.params.siteId).get()).data() || {};
  const list = push.moneyNotices(coll, b, a, push.streetOf(site, event.params.siteId));
  const res = [];
  for (const n of list) { const uids = push.moneyRecipients(site, n.aud, on); if (uids.length) res.push(await deliver(uids, n)); }
  return { sent: res.length };
}
exports.moneyPushInv = onDocumentWritten('sites/{siteId}/inv/{docId}', (event) => moneyPush('inv', event));
exports.moneyPushPmts = onDocumentWritten('sites/{siteId}/pmts/{docId}', (event) => moneyPush('pmts', event));
exports.flagPush = onDocumentCreated('sites/{siteId}/flags/{docId}', async (event) => {
  const on = await paperTrail.enabled(db);   /* 10/22: homeowners always; builders with the switch on */
  const f = event.data && event.data.data ? event.data.data() : null;
  const site = (await db.collection('sites').doc(event.params.siteId).get()).data() || {};
  const n = push.flagNotice(f, event.params.docId, push.streetOf(site, event.params.siteId));
  if (!n) return;
  const uids = push.flagRecipients(site, f && f.byUid, on);
  if (uids.length) await deliver(uids, n);
});
/* M-18 (2.479.0): each flag / resolve becomes one money-history line. Same switch. */
exports.paperTrailFlags = onDocumentWritten('sites/{siteId}/flags/{docId}', (event) => paperTrail.handleFlag(db, _ptTs, event));

/* Step 3b-1 (M-10 receipts, M-12 archive): for each money-history line the server archives a snapshot,
   emails each party the PDF with its SHA-256 fingerprint, and stamps the fingerprint on the line.
   DORMANT: needs settings/paperTrail { enabled: true, receipts: true }. Provider: Resend (RESEND_API_KEY).
   retry:true re-runs a failed line; claims on the line make a re-run send each party one email only. */
const receipts = require('./lib/receipts');
exports.paperTrailReceipt = onDocumentCreated({ document: 'sites/{siteId}/hist/{lineId}', retry: true }, async (event) => {
  const f = await receipts.flags(db);
  if (!(f.on && f.receipts)) return;
  const key = process.env.RESEND_API_KEY || '';
  if (!key) throw new Error('paperTrail receipts are on but RESEND_API_KEY is not set');
  const bucketName = process.env.ARCHIVE_BUCKET || 'plumb-467a0-money-archive';
  const histRef = (s, l) => db.collection('sites').doc(s).collection('hist').doc(l);
  const deps = {
    db, bucket: admin.storage().bucket(bucketName), bucketName,
    from: process.env.RECEIPT_FROM || 'SitePlumb <receipts@siteplumb.com>',
    sendEmail: receipts.resendSender(key),
    /* 2.483.0: the paper-signature photo (live/sites/<house>/costs/<photoId> in the app bucket), size-checked before download */
    photo: async (siteId, photoId) => {
      const file = admin.storage().bucket(process.env.PLUMB_BUCKET || 'plumb-467a0.firebasestorage.app').file('live/sites/' + siteId + '/costs/' + photoId);
      const [md] = await file.getMetadata(); if (Number(md.size) > receipts.PHOTO_MAX) return null;
      const [buf] = await file.download();
      const ext = /png/.test(md.contentType || '') ? '.png' : /heic/.test(md.contentType || '') ? '.heic' : '.jpg';
      return { buf, ext };
    },
    emailOf: async (uid) => { try { return (await admin.auth().getUser(uid)).email || ''; } catch (e) { return ''; } },
    claim: (s, l, uid) => db.runTransaction(async (tx) => {
      const snap = await tx.get(histRef(s, l)); const rc = ((snap.data() || {}).rc) || {};
      if (rc[uid]) return false;
      tx.update(histRef(s, l), { ['rc.' + uid]: Date.now() }); return true;
    }),
    release: (s, l, uid) => histRef(s, l).update({ ['rc.' + uid]: admin.firestore.FieldValue.delete() }),
    notify: async (siteId, line) => {
      const siteSnap = await db.collection('sites').doc(siteId).get();
      const uids = push.builderUids(siteSnap.data() || {}); if (!uids.length) return;
      await deliver(uids, { key: 'pcheck:' + siteId + ':' + String(line.ref) + ':' + String(line.rev), title: 'A change order needs a check', body: 'The numbers did not add up, so it has not been sent to the homeowner.' });
    },
  };
  return receipts.handle(deps, event);
});

/* Step 3b-2 (dormant, same flags): M-11 deleteSite is a client tombstone; the first tombstone of a house with sent money
   writes the archive snapshot and a 7-year retention mark. M-9 "opened": the homeowner's app calls this once per version. */
exports.paperTrailSiteTombstone = onDocumentUpdated('sites/{siteId}', async (event) => {
  const b = event.data.before.data() || null, a = event.data.after.data() || null;
  if (!(a && a.meta && a.meta.deleted) || (b && b.meta && b.meta.deleted)) return;
  return archiveSite.onSiteTombstone(db, admin.storage().bucket(process.env.ARCHIVE_BUCKET || 'plumb-467a0-money-archive'), b, a, event.params.siteId, event.data.after.ref);
});
exports.moneyOpened = onRequest(async (req, res) => {
  if (cors(req, res)) return;
  const user = await requireUser(req, res); if (!user) return;
  try {
    const b = body(req);
    const r = await archiveSite.recordOpened(db, () => admin.firestore.FieldValue.serverTimestamp(), { uid: user.uid, siteId: String(b.siteId || ''), coll: String(b.coll || ''), docId: String(b.docId || '') });
    res.json({ result: r });
  } catch (e) { res.status(500).json({ error: String(e.message || e).slice(0, 300) }); }
});
