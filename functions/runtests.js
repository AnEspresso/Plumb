/* Runs every functions/*.test.js in its own node process. deploy-functions.yml runs this
   before a deploy, so a failing test stops the deploy. Exit 1 if any test fails. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
if (!files.length) { console.error('runtests: no *.test.js found'); process.exit(1); }
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) { failed++; console.error('runtests: FAIL ' + f); }
}
console.log('runtests: ' + (files.length - failed) + '/' + files.length + ' test files passed');
process.exit(failed ? 1 : 0);
