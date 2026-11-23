#!/usr/bin/env node
/* Retire old document download links (script (a) from PR #112).

   Before 2.512.0, download links for document files were saved in meta.docs,
   which every member could read. A Firebase download link keeps working until
   its token changes, even after the new audience rules are published.

   For each live/sites/{siteId}/docs/{fileId} object (the old shared folder),
   this sets metadata.firebaseStorageDownloadTokens to a new UUID. Old links
   stop working. Phones on 2.512.0+ fetch a fresh link from the file path when
   someone opens a file, and do not save it.

   Does not touch photos, costs, or the 2.512.0+ docs-* audience folders.
   Does not print tokens or download URLs — only counts and object paths.
   Safe to run again. Dry run unless RETIRE_DOC_TOKENS_CONFIRM=1.

   When to run: after the batch 3 rules (#112) are published and every phone
   is on 2.512.0. #115 (Word/Excel uploads) is not a prerequisite.

   Bucket: plumb-467a0.firebasestorage.app (the Admin SDK's appspot.com
   default would miss these files). */
'use strict';

const crypto = require('crypto');

const PROJECT = 'plumb-467a0';
const BUCKET = process.env.PLUMB_BUCKET || 'plumb-467a0.firebasestorage.app';
const PREFIX = 'live/sites/';

function isOldDocPath(p) {
  const parts = String(p || '').replace(/\/+$/, '').split('/');
  return parts.length === 5
    && parts[0] === 'live'
    && parts[1] === 'sites'
    && parts[2] !== '' && parts[2] !== '.' && parts[2] !== '..'
    && parts[3] === 'docs'
    && parts[4] !== '' && parts[4] !== '.' && parts[4] !== '..';
}

function formatReport(result, confirm) {
  const lines = [];
  lines.push(confirm ? 'WRITING' : 'DRY RUN (set RETIRE_DOC_TOKENS_CONFIRM=1 to write)');
  lines.push(
    result.scanned + ' document file(s) in the old docs folder, '
    + result.planned + ' ' + (confirm ? 'given a new token' : 'would get a new token')
    + (result.errors.length ? ', ' + result.errors.length + ' failed' : '')
  );
  for (const path of result.paths) lines.push('  ' + path);
  for (const e of result.errors) lines.push('  FAILED ' + e.path);
  if (confirm) lines.push('retokened ' + result.wrote);
  return lines.join('\n');
}

function reportLeaks(text) {
  const s = String(text || '');
  const hits = [];
  if (/firebaseStorageDownloadTokens/i.test(s)) hits.push('token field');
  if (/(?:[?&]|\b)token=/.test(s)) hits.push('token query');
  if (/firebasestorage\.(googleapis\.com|app)/.test(s)) hits.push('download host');
  if (/alt=media/.test(s)) hits.push('media url');
  return hits;
}

async function retireOldDocTokens(bucket, opts) {
  opts = opts || {};
  const confirm = !!opts.confirm;
  const newToken = opts.newToken || (function () { return crypto.randomUUID(); });
  const [files] = await bucket.getFiles({ prefix: PREFIX });
  const result = { scanned: 0, planned: 0, wrote: 0, paths: [], errors: [] };
  for (const f of files || []) {
    const path = String(f.name || '');
    if (!isOldDocPath(path)) continue;
    result.scanned++;
    result.paths.push(path);
    try {
      const [meta] = await f.getMetadata();
      const custom = Object.assign({}, (meta && meta.metadata) || {});
      const token = newToken();
      if (!token || typeof token !== 'string') throw new Error('no token');
      custom.firebaseStorageDownloadTokens = token;
      result.planned++;
      if (confirm) {
        await f.setMetadata({ metadata: custom });
        result.wrote++;
      }
    } catch (e) {
      result.errors.push({ path: path });
    }
  }
  return result;
}

if (require.main === module) (async () => {
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getStorage } = require('firebase-admin/storage');
  const emulator = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST || !!process.env.STORAGE_EMULATOR_HOST;
  initializeApp(emulator
    ? { projectId: process.env.GCLOUD_PROJECT || PROJECT }
    : { credential: applicationDefault(), projectId: PROJECT });
  const bucket = getStorage().bucket(BUCKET);
  const confirm = process.env.RETIRE_DOC_TOKENS_CONFIRM === '1';
  const result = await retireOldDocTokens(bucket, { confirm: confirm });
  const out = formatReport(result, confirm);
  const leaks = reportLeaks(out);
  if (leaks.length) {
    console.error('Refusing to print a report that looks like it contains a token or URL.');
    process.exit(2);
  }
  console.log(out);
  process.exit(result.errors.length ? 2 : 0);
})().catch((e) => {
  console.error('Retire failed.');
  process.exit(2);
});

module.exports = { isOldDocPath, formatReport, reportLeaks, retireOldDocTokens, PREFIX, BUCKET, PROJECT };
