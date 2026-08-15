'use strict';

function builderUids(site) {
  const out = [];
  const m = (site && site.members) || {};
  Object.keys(m).forEach(uid => {
    const role = typeof m[uid] === 'string' ? m[uid] : String((m[uid] && m[uid].role) || '');
    if (role.toLowerCase() === 'builder') out.push(uid);
  });
  return out;
}

function packetNotice(before, after) {
  if (!after) return null;
  const prevQ = ((before && before.q) || []).length;
  const nextQ = (after.q || []).length;
  const pr = (before && before.resp) || null;
  const nr = after.resp || null;
  const who = String(after.sub || 'A sub');
  const site = String(after.site || 'a job').split(' · ')[0];
  if (nextQ > prevQ) {
    const last = after.q[after.q.length - 1] || {};
    return {
      key: 'pkq:' + String(after.bookingId || '') + ':' + String(last.t || Date.now()),
      title: who + ' asked — ' + site,
      body: String(last.text || 'Opened a question').slice(0, 180),
    };
  }
  const ps = pr && pr.status;
  const ns = nr && nr.status;
  if (ns && ns !== ps) {
    if (ns === 'confirmed') {
      return { key: 'pkok:' + String(after.bookingId || '') + ':' + String(nr.t || Date.now()), title: who + ' confirmed — ' + site, body: 'Dates work' };
    }
    if (ns === 'change') {
      return { key: 'pkchg:' + String(after.bookingId || '') + ':' + String(nr.t || Date.now()), title: who + ' suggested new dates — ' + site, body: String(nr.note || 'See the booking').slice(0, 180) };
    }
  }
  return null;
}

async function tokensFor(db, uids) {
  const toks = [];
  for (const uid of uids) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      const fcm = (snap.exists && snap.data() && snap.data().fcm) || {};
      Object.keys(fcm).forEach(t => { if (t && t.length > 20) toks.push(t); });
    } catch (e) {}
  }
  return [...new Set(toks)];
}

async function sendPush(admin, tokens, notice) {
  if (!tokens.length || !notice) return { sent: 0 };
  const r = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title: notice.title, body: notice.body },
    data: { title: notice.title, body: notice.body, key: notice.key || '' },
  });
  return { sent: r.successCount || 0, failed: r.failureCount || 0 };
}

module.exports = { builderUids, packetNotice, tokensFor, sendPush };
