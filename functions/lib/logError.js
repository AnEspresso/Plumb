/* One ERROR line per failure, as JSON, so Cloud Logging reads severity and fields and a
   log-based alert can match message "plumb function error" (docs/alerts.md). Ids and the
   error text only: no tokens, emails or request bodies. */
'use strict';
function errorEntry(fn, err, ctx) {
  const e = err || {};
  return Object.assign({
    severity: 'ERROR',
    message: 'plumb function error',
    fn: String(fn || ''),
    error: String(e.message || e).slice(0, 300),
    code: e.code === undefined ? undefined : String(e.code),
  }, ctx || {});
}
function logError(fn, err, ctx) {
  try { console.error(JSON.stringify(errorEntry(fn, err, ctx))); } catch (_) {}
}
module.exports = { errorEntry, logError };
