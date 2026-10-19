#!/usr/bin/env node
/* Read-only: GET the released Firestore and Storage rulesets from the Firebase
   Rules REST API and compare them with firestore.rules and storage.rules in the
   repo. Needs TOKEN (a read access token) in the environment. Exit 0 = both
   match, 1 = a difference, 2 = could not read. Only ever sends GET. */
'use strict';
const fs = require('fs');
const path = require('path');
const { compareRules } = require('./liveRules');

const PROJECT = 'plumb-467a0';
const BASE = 'https://firebaserules.googleapis.com/v1/';
const TARGETS = [
  { label: 'Firestore', release: 'cloud.firestore', file: 'firestore.rules' },
  { label: 'Storage', release: 'firebase.storage/plumb-467a0.firebasestorage.app', file: 'storage.rules' }
];

async function get(p) {
  const r = await fetch(BASE + p, { method: 'GET', headers: { Authorization: 'Bearer ' + process.env.TOKEN } });
  if (!r.ok) throw new Error('GET ' + p + ' -> HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

(async () => {
  if (!process.env.TOKEN) { console.error('No TOKEN in the environment.'); process.exit(2); }
  const root = path.join(__dirname, '..');
  let bad = 0, broke = 0;
  const md = ['## Live rules check (read only)', ''];
  for (const t of TARGETS) {
    try {
      const rel = await get('projects/' + PROJECT + '/releases/' + t.release);
      const rs = await get(rel.rulesetName);
      const files = (rs.source && rs.source.files) || [];
      if (files.length !== 1) throw new Error('expected 1 rules file in the live ruleset, found ' + files.length);
      const res = compareRules(files[0].content, fs.readFileSync(path.join(root, t.file), 'utf8'));
      const head = (res.match ? 'MATCH' : 'DIFF') + ' ' + t.file;
      const info = 'release ' + rel.name.split('/releases/')[1] + ', updated ' + (rel.updateTime || '?') +
        ', ruleset ' + rel.rulesetName.split('/').pop() + ' created ' + (rs.createTime || '?');
      console.log(head + '\n  ' + info);
      md.push('### ' + t.label + ': ' + head, '', info, '');
      if (!res.match) {
        bad++;
        const d = res.diff.lines.join('\n') + (res.diff.more ? '\n... ' + res.diff.more + ' more' : '');
        console.log(d);
        md.push('```diff', d, '```', '');
      }
    } catch (e) {
      broke++;
      console.log('ERROR ' + t.file + ': ' + e.message);
      md.push('### ' + t.label + ': ERROR', '', e.message, '');
    }
  }
  const verdict = broke ? 'COULD NOT READ' : bad ? 'DIFF' : 'MATCH';
  console.log('RESULT ' + verdict);
  md.unshift('**RESULT: ' + verdict + '**', '');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  process.exit(broke ? 2 : bad ? 1 : 0);
})();
