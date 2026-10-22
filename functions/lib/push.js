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

function pushMessage(tokens, notice) {
  const title = String((notice && notice.title) || 'SitePlumb');
  const body = String((notice && notice.body) || '');
  const key = String((notice && notice.key) || '');
  return {
    tokens,
    data: { title: title, body: body, key: key },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        title: title,
        body: body,
        icon: 'https://siteplumb.com/icon-192.png',
        badge: 'https://siteplumb.com/icon-192.png',
        tag: key || 'plumb',
        renotify: true,
      },
      fcmOptions: { link: 'https://siteplumb.com/app/' },
    },
  };
}

async function sendPush(admin, tokens, notice) {
  if (!tokens.length || !notice) return { sent: 0, failed: 0 };
  const r = await admin.messaging().sendEachForMulticast(pushMessage(tokens, notice));
  return { sent: r.successCount || 0, failed: r.failureCount || 0 };
}

/* 2.483.0: people on a house by role (members map: uid -> role or {role}) */
function roleUids(site, want) {
  const out = []; const m = (site && site.members) || {};
  Object.keys(m).forEach(uid => { const role = typeof m[uid] === 'string' ? m[uid] : String((m[uid] && m[uid].role) || ''); if (role.toLowerCase() === want) out.push(uid); });
  return out;
}
/* builders who pass the rules' moneyOk(): no memberInfo entry (the owner), owner, or a money gate */
function moneyBuilderUids(site) {
  const info = (site && site.meta && site.meta.memberInfo) || {};
  return roleUids(site, 'builder').filter(uid => {
    const m = info[uid]; if (!m) return true;
    const g = m.gates || {};
    return m.rpRole === 'owner' || m.owner === true || g.moneyJob === true || g.moneyJob === 1 || g.moneyCo === true || g.moneyCo === 1;
  });
}
/* who gets a notice: 'client' = homeowners, 'builder' = money builders only (M-5: crew and non-money builders never hear money) */
function audUids(site, aud) { return aud === 'client' ? roleUids(site, 'client') : moneyBuilderUids(site); }
const money = (n) => { const v = Math.abs(Number(n) || 0); return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const cut = (t, n) => String(t || '').slice(0, n || 140);
function streetOf(site, id) { return String((site && (site.street || (site.meta && site.meta.street) || site.name)) || id || 'your house').split(' · ')[0]; }

/* 2.483.0: the same notices the app shows in its bell (same keys, so a phone that is open shows one, not two).
   coll is 'inv' or 'pmts'; b/a are the {data} records before/after. Returns [{aud:'client'|'builder', key, title, body}]. */
function moneyNotices(coll, before, after, street) {
  const o = before && before.data, i = after && after.data, out = [];
  if (!i) return out;
  if (coll === 'inv') {
    if (!o) return out;
    if (o.status !== 'void' && i.status === 'void' && o.status !== 'draft') out.push({ aud: 'client', key: 'inv:' + i.id + ':void', title: 'Invoice canceled — ' + street, body: i.no + (i.voidReason ? ' · ' + cut(i.voidReason) : '') + ' · you don\u2019t owe this one' });
    else if (o.status !== i.status && i.status === 'approved') out.push({ aud: 'builder', key: 'inv:' + i.id + ':ok', title: 'Invoice approved — ' + street, body: i.no + ' approved by the homeowner' });
    else if (i.status !== 'void' && i.status !== 'draft' && (i.items || []).length > (o.items || []).length) {
      const it = i.items[i.items.length - 1];
      if (it && it.adj) out.push({ aud: 'client', key: 'inv:' + i.id + ':adj:' + i.items.length, title: ((Number(it.amount) || 0) < 0 ? 'Credit added to your invoice — ' : 'Charge added to your invoice — ') + street, body: i.no + ' · ' + (it.label || '') + ' ' + money(it.amount) + ' · now ' + money(i.total) });
    }
    if (i.status !== 'draft') {
      const op = {}; (o.payments || []).forEach(x => { if (x && x.id) op[x.id] = x; });
      (i.payments || []).forEach(x => { if (x && x.voidedAt && x.id && op[x.id] && !op[x.id].voidedAt) out.push({ aud: 'client', key: 'pmv:' + x.id, title: 'Payment no longer counted — ' + street, body: money(x.amount) + ' on ' + i.no + (x.voidReason ? ' · ' + cut(x.voidReason) : '') }); });
    }
  }
  if (coll === 'pmts' && o && i.voidedAt && !o.voidedAt) out.push({ aud: 'client', key: 'pmv:' + i.id, title: 'Payment no longer counted — ' + street, body: money(i.amount) + (i.label ? ' · ' + i.label : '') + (i.voidReason ? ' · ' + cut(i.voidReason) : '') });
  return out;
}

/* 2.483.0: a new flag reaches everyone with money on the house except the person who raised it. */
function flagNotice(f, flagId, street) {
  if (!f || f.kind !== 'flag') return null;
  const what = { inv: 'an invoice', co: 'a change order', sel: 'a selection price', pmt: 'a payment' }[f.targetType] || 'a record';
  /* Agency final (10/22): a selection price reads 'Selection price: <note>' */
  const lead = f.targetType === 'sel' ? 'Selection price' : 'On ' + what;
  return { key: 'flag:' + flagId, title: 'Something\u2019s wrong — ' + street, body: lead + ': ' + cut(f.note, 160) };
}

/* Decision 10/22 (relayed by PM as Peter's decision): homeowner pushes go out regardless of the paper-trail switch;
   builder pushes (G5, and builders on a flag) still wait for it. on = the switch. */
/* 10/22 (later): G5 'Invoice approved' to money builders also goes regardless; flag pushes to builders still wait (flagRecipients). */
function moneyRecipients(site, aud, on) { return aud === 'client' ? roleUids(site, 'client') : moneyBuilderUids(site); }
function flagRecipients(site, byUid, on) {
  return (on ? moneyBuilderUids(site) : []).concat(roleUids(site, 'client')).filter(u => u !== byUid);
}

module.exports = { moneyRecipients, flagRecipients, builderUids, packetNotice, tokensFor, sendPush, pushMessage, roleUids, moneyBuilderUids, audUids, moneyNotices, flagNotice, streetOf };
