/* Pure helpers for the read-only live-rules check. No network, no files, no publishing. */
'use strict';

/* Same text for comparison: LF line ends, no trailing spaces or tabs on a line,
   no blank lines at the very start or end. */
function normalize(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/* Line diff (LCS). Returns lines like "- live line" / "+ repo line", at most `max` of them. */
function shortDiff(live, repo, max) {
  max = max || 40;
  const a = normalize(live).split('\n'), b = normalize(repo).split('\n');
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) out.push('- ' + a[i++] + '   (live only, line ' + i + ')');
    else out.push('+ ' + b[j++] + '   (repo only, line ' + j + ')');
  }
  const total = out.length;
  return { total, lines: out.slice(0, max), more: Math.max(0, total - max) };
}

/* { match, diff } for one live ruleset against one repo file. */
function compareRules(live, repo) {
  const same = normalize(live) === normalize(repo);
  return { match: same, diff: same ? null : shortDiff(live, repo) };
}

module.exports = { normalize, shortDiff, compareRules };
