#!/usr/bin/env node
/* Local tests for scripts/retire-old-doc-tokens.js. No network, no secrets.
   Proves the script only targets the old docs folder, dry-run writes nothing,
   a write run only updates the download token, and the log never prints
   tokens or download URLs. */
'use strict';

const assert = require('assert');
const { isOldDocPath, formatReport, reportLeaks, retireOldDocTokens } = require('./retire-old-doc-tokens.js');

const SECRET = '11111111-2222-4333-8444-555555555555';
const OLD_TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function file(name, meta, hooks) {
  hooks = hooks || {};
  return {
    name: name,
    getMetadata: async function () {
      if (hooks.getBoom) throw new Error('get failed: ' + SECRET);
      return [{ metadata: Object.assign({ uploader: 'uid-builder', firebaseStorageDownloadTokens: OLD_TOKEN }, meta || {}) }];
    },
    setMetadata: async function (patch) {
      hooks.sets = hooks.sets || [];
      hooks.sets.push(patch);
      if (hooks.setBoom) throw new Error('set failed: ' + SECRET);
    }
  };
}

let n = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(function () { n++; })
    .catch(function (e) { console.error('FAIL: ' + name + ' — ' + e.message); process.exit(1); });
}

(async () => {
  await t('isOldDocPath accepts only live/sites/{id}/docs/{fileId}', function () {
    assert.equal(isOldDocPath('live/sites/abc123/docs/file1'), true);
    assert.equal(isOldDocPath('live/sites/abc123/docs-team/file1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/docs-subs/file1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/docs-homeowner/file1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/docs-all/file1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/photos/p1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/costs/c1'), false);
    assert.equal(isOldDocPath('live/sites/abc123/docs/file1/extra'), false);
    assert.equal(isOldDocPath('live/sites/abc123/docs'), false);
    assert.equal(isOldDocPath('demo/sites/abc123/docs/file1'), false);
  });

  const hooks = {};
  const files = [
    file('live/sites/s1/docs/docA', null, hooks),
    file('live/sites/s1/docs-team/newDoc', null, hooks),
    file('live/sites/s1/photos/ph1', null, hooks),
    file('live/sites/s2/docs/docB', null, hooks),
    { name: 'live/sites/s1/costs/r1', getMetadata: async function () { throw new Error(SECRET); }, setMetadata: async function () { hooks.sets = hooks.sets || []; hooks.sets.push('costs'); } }
  ];
  const bucket = { getFiles: async function () { return [files]; } };

  await t('dry run plans old docs only and writes nothing', async function () {
    const r = await retireOldDocTokens(bucket, { confirm: false, newToken: function () { return SECRET; } });
    assert.equal(r.scanned, 2);
    assert.equal(r.planned, 2);
    assert.equal(r.wrote, 0);
    assert.deepStrictEqual(r.paths, ['live/sites/s1/docs/docA', 'live/sites/s2/docs/docB']);
    assert.equal(hooks.sets, undefined);
  });

  const writeHooksA = {};
  const writeHooksB = {};
  const writeFiles = [
    file('live/sites/s1/docs/docA', { other: 'keep-me' }, writeHooksA),
    file('live/sites/s1/docs-subs/x', null, writeHooksB)
  ];
  const writeBucket = { getFiles: async function () { return [writeFiles]; } };

  await t('write run updates only the token and keeps other metadata', async function () {
    const r = await retireOldDocTokens(writeBucket, { confirm: true, newToken: function () { return SECRET; } });
    assert.equal(r.wrote, 1);
    assert.equal(r.planned, 1);
    assert.equal(writeHooksA.sets.length, 1);
    assert.deepStrictEqual(writeHooksA.sets[0], {
      metadata: {
        uploader: 'uid-builder',
        firebaseStorageDownloadTokens: SECRET,
        other: 'keep-me'
      }
    });
    assert.equal(writeHooksB.sets, undefined);
  });

  const boom = {};
  const boomBucket = { getFiles: async function () { return [[file('live/sites/s1/docs/bad', null, Object.assign(boom, { getBoom: true }))]]; } };
  await t('a failed object is counted as failed, not written, and the error is not logged', async function () {
    const r = await retireOldDocTokens(boomBucket, { confirm: true, newToken: function () { return SECRET; } });
    assert.equal(r.planned, 0);
    assert.equal(r.wrote, 0);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].path, 'live/sites/s1/docs/bad');
    const out = formatReport(r, true);
    assert.equal(out.indexOf(SECRET), -1);
    assert.equal(out.indexOf(OLD_TOKEN), -1);
    assert.equal(reportLeaks(out).length, 0);
    assert.ok(out.indexOf('FAILED live/sites/s1/docs/bad') >= 0);
  });

  await t('the report never contains tokens or download URLs', function () {
    const out = formatReport({
      scanned: 2, planned: 2, wrote: 0,
      paths: ['live/sites/s1/docs/docA', 'live/sites/s2/docs/docB'],
      errors: []
    }, false);
    assert.ok(out.indexOf('DRY RUN') === 0);
    assert.ok(out.indexOf('2 document file(s)') >= 0);
    assert.equal(out.indexOf(SECRET), -1);
    assert.equal(out.indexOf(OLD_TOKEN), -1);
    assert.equal(reportLeaks(out).length, 0);
    assert.deepStrictEqual(reportLeaks('token=' + SECRET), ['token query']);
    assert.deepStrictEqual(reportLeaks('https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media&token=' + SECRET).sort(),
      ['token query', 'download host', 'media url'].sort());
  });

  console.log('retire-old-doc-tokens test: ' + n + ' checks passed');
})();
