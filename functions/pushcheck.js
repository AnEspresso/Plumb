'use strict';
const assert = require('assert');
const fs = require('fs');
const { builderUids, packetNotice, pushMessage } = require('./lib/push');

assert.deepStrictEqual(builderUids({ members: { a: 'builder', b: 'sub', c: 'client' } }), ['a']);
assert.ok(!packetNotice(null, { q: [], resp: null }));
const n = packetNotice({ q: [] }, { q: [{ text: 'Beam drop?', t: 1 }], sub: 'Northwind', site: '288 Calderwood Ln · Ferndale', bookingId: 'bk1' });
assert.ok(n && /asked/.test(n.title) && /Beam/.test(n.body));
const c = packetNotice({ q: [], resp: null }, { q: [], resp: { status: 'confirmed', t: 2 }, sub: 'Northwind', site: '288 Calderwood Ln', bookingId: 'bk1' });
assert.ok(c && /confirmed/.test(c.title));
const msg = pushMessage(['tok'], { title: 'T', body: 'B', key: 'k1' });
assert.equal(msg.webpush.fcmOptions.link, 'https://siteplumb.com/app/');
assert.equal(msg.data.title, 'T');
assert.ok(!msg.notification);
assert.equal(msg.webpush.notification.tag, 'k1');
const src = fs.readFileSync(__dirname + '/lib/push.js', 'utf8');
assert.ok(src.indexOf('fcmOptions') >= 0);
console.log('pushcheck PASS');
