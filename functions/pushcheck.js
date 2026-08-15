'use strict';
const assert = require('assert');
const { builderUids, packetNotice } = require('./lib/push');

assert.deepStrictEqual(builderUids({ members: { a: 'builder', b: 'sub', c: 'client' } }), ['a']);
assert.ok(!packetNotice(null, { q: [], resp: null }));
const n = packetNotice({ q: [] }, { q: [{ text: 'Beam drop?', t: 1 }], sub: 'Northwind', site: '288 Calderwood Ln · Ferndale', bookingId: 'bk1' });
assert.ok(n && /asked/.test(n.title) && /Beam/.test(n.body));
const c = packetNotice({ q: [], resp: null }, { q: [], resp: { status: 'confirmed', t: 2 }, sub: 'Northwind', site: '288 Calderwood Ln', bookingId: 'bk1' });
assert.ok(c && /confirmed/.test(c.title));
console.log('pushcheck PASS');
