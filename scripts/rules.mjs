#!/usr/bin/env node
/* npm run rules / npm run rules:next
   Starts the Firestore emulator, and the Storage emulator too once
   storage.rules is in the tree, then runs rulescheck.js. The storage section
   switches on by itself the day the file lands; until then the report says it
   was skipped. firebase.json names storage.rules, so the Storage emulator
   cannot start without it. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const next = process.argv.includes('--next');
const only = existsSync('storage.rules') ? 'firestore,storage' : 'firestore';
const env = { ...process.env, ...(next ? { RULES_PROFILE: 'next' } : {}) };
console.log(`rules: ${next ? 'staging' : 'production'} profile, emulators: ${only}`);
const r = spawnSync('firebase',
  ['emulators:exec', '--only', only, '--project', 'demo-plumb-rules', 'node rulescheck.js'],
  { stdio: 'inherit', env });
if (r.error) { console.error('rules: could not start the emulator -', r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
