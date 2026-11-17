'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { errorEntry, logError } = require('./lib/logError');

// The shape the log-based alert matches (docs/alerts.md): severity ERROR + a fixed message.
const e = errorEntry('deleteAccount', Object.assign(new Error('boom ' + 'x'.repeat(400)), { code: 7 }), { siteId: 'p1' });
assert.strictEqual(e.severity, 'ERROR');
assert.strictEqual(e.message, 'plumb function error');
assert.strictEqual(e.fn, 'deleteAccount');
assert.strictEqual(e.code, '7');
assert.strictEqual(e.siteId, 'p1');
assert.ok(e.error.length <= 300, 'error text is capped');
assert.strictEqual(errorEntry('x', 'plain').error, 'plain');

// logError writes one JSON line on stderr and never throws.
const seen = []; const orig = console.error; console.error = (s) => seen.push(s);
try { logError('qbCallback', new Error('state expired')); logError('x', null); } finally { console.error = orig; }
assert.strictEqual(seen.length, 2);
assert.strictEqual(JSON.parse(seen[0]).message, 'plumb function error');

// Every HTTP 500 path in index.js logs before it answers, so a failure the user sees is one the alert sees.
const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const lines500 = src.split('\n').filter((l) => l.includes('res.status(500)'));
assert.ok(lines500.length >= 3, 'found the 500 paths');
for (const l of lines500) assert.ok(/logError\(/.test(l), 'a 500 path logs: ' + l.trim().slice(0, 80));
assert.ok(/logError\('qbCallback'/.test(src), 'the QuickBooks callback logs its failure');

console.log('logError: all checks passed (' + lines500.length + ' server-error paths log an ERROR line)');
