/* Tests for the read-only live-rules check: compare logic, and a guard that
   nothing in it can publish. Run: npm run liverules */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalize, shortDiff, compareRules } = require('./liveRules');
let fail = 0;
function t(name, ok) { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name); }

const base = "rules_version = '2';\nservice x {\n  match /a { allow read: if true; }\n}\n";
t('normalize: CRLF, trailing spaces and edge blank lines are ignored',
  normalize('\n\n' + base.replace(/\n/g, ' \r\n') + '\n\n') === normalize(base));
t('compare: same text with different line endings and trailing space MATCHES',
  compareRules(base.replace(/\n/g, '\r\n'), base.replace(/\n/g, '  \n')).match === true);
t('compare: leading spaces still count (indentation is content)',
  compareRules(base, base.replace('  match', '    match')).match === false);
const changed = base.replace('if true', 'if false');
const r = compareRules(base, changed);
t('compare: a changed rule is a DIFF', r.match === false);
t('diff: names the live line and the repo line',
  r.diff.lines.some(l => l.startsWith('- ') && l.includes('if true')) && r.diff.lines.some(l => l.startsWith('+ ') && l.includes('if false')));
t('diff: identical text gives no diff lines', shortDiff(base, base).total === 0);
t('diff: output is capped', shortDiff('a\n'.repeat(5), 'b\n'.repeat(200), 10).lines.length === 10);
t('compare: empty live vs real rules is a DIFF', compareRules('', base).match === false);
t('compare: the repo rules match themselves',
  compareRules(fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8')).match === true);

/* Nothing here may publish: no firebase deploy, no ruleset/release create or patch,
   no write HTTP verbs, no firebase-tools, no write permissions, no secrets other than the read account. */
const files = ['scripts/check-live-rules.js', 'scripts/liveRules.js', '.github/workflows/check-live-rules.yml'];
const banned = [/deploy/i, /rulesets?\s*:?\s*create/i, /releases?\s*:?\s*(create|patch|update)/i, /\bfirebase-tools\b/i,
  /\bnpx\b/, /['"](POST|PATCH|PUT|DELETE)['"]/, /-X\s*(POST|PATCH|PUT|DELETE)/i, /--data|\s-d\s/,
  /GCP_DEPLOY_KEY_JSON/, /FIREBASE_RULES_DEPLOYER/, /(contents|actions|id-token|packages|deployments):\s*write/i,
  /workflow_run|\bpush:|pull_request/, /gh\s+(release|workflow\s+run)/, /releases\/\$\{?[^/]*\}?\s*,\s*\{\s*method/];
files.forEach(f => {
  const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const hit = banned.filter(b => b.test(s));
  t('guard: ' + f + ' has nothing that can publish' + (hit.length ? ' (found ' + hit[0] + ')' : ''), hit.length === 0);
});
const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/check-live-rules.yml'), 'utf8');
t('guard: workflow is workflow_dispatch only', /^on:\n  workflow_dispatch: \{\}\n/m.test(wf) && !/^\s+(push|schedule|pull_request)/m.test(wf));
t('guard: workflow permissions are contents: read only', /^permissions:\n  contents: read\n\njobs:/m.test(wf));
t('guard: script only sends GET', /method: 'GET'/.test(fs.readFileSync(path.join(__dirname, 'check-live-rules.js'), 'utf8')));
t('guard: script reads only the two release names it should', (() => {
  const s = fs.readFileSync(path.join(__dirname, 'check-live-rules.js'), 'utf8');
  return s.includes("'cloud.firestore'") && s.includes("'firebase.storage/plumb-467a0.firebasestorage.app'");
})());

console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
process.exit(fail ? 1 : 0);
