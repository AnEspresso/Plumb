/* Plumb ↔ QuickBooks Online core.
   Every URL comes from env so tests can point at a mock server.
   Intuit refresh tokens ROTATE on every use — persist the new pair every time. */
'use strict';

const TOKEN_URL = () => process.env.QB_TOKEN_URL || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE  = () => process.env.QB_API_BASE  ||
  (process.env.QB_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com');
const AUTH_URL  = () => process.env.QB_AUTH_URL || 'https://appcenter.intuit.com/connect/oauth2';
const MINOR = '75';

function basicAuth() {
  return 'Basic ' + Buffer.from(process.env.INTUIT_CLIENT_ID + ':' + process.env.INTUIT_CLIENT_SECRET).toString('base64');
}

function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({
    client_id: process.env.INTUIT_CLIENT_ID,
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return AUTH_URL() + '?' + q.toString();
}

async function exchangeCode(code, redirectUri) {
  const r = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!r.ok) throw new Error('token exchange failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json(); // {access_token, refresh_token, expires_in, x_refresh_token_expires_in}
}

async function refreshTokens(refreshToken) {
  const r = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!r.ok) throw new Error('token refresh failed: ' + r.status);
  return r.json();
}

/* Load tokens for uid, refreshing (and persisting the rotated pair) when near expiry. */
async function freshTokens(db, uid) {
  const ref = db.collection('qb').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  let t = snap.data();
  if (!t.refreshToken) return null;
  const slack = 120 * 1000; // refresh 2 min early
  if (!t.accessToken || !t.expiresAt || Date.now() > t.expiresAt - slack) {
    const j = await refreshTokens(t.refreshToken);
    t = {
      ...t,
      accessToken: j.access_token,
      refreshToken: j.refresh_token,               // rotated — must persist
      expiresAt: Date.now() + (j.expires_in || 3600) * 1000,
      refreshedAt: Date.now(),
    };
    await ref.set(t, { merge: true });
  }
  return t;
}

async function qbFetch(t, method, path, body) {
  const url = API_BASE() + '/v3/company/' + encodeURIComponent(t.realmId) + path +
    (path.includes('?') ? '&' : '?') + 'minorversion=' + MINOR;
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + t.accessToken, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 400);
    const err = new Error('QBO ' + r.status + ' on ' + path + ': ' + txt);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

function qEsc(s) { return String(s || '').replace(/'/g, "\\'"); }

async function query(t, q) {
  const j = await qbFetch(t, 'GET', '/query?query=' + encodeURIComponent(q));
  return j.QueryResponse || {};
}

/* find-or-create helpers — all idempotent by DisplayName / Name */
async function ensureVendor(t, name) {
  const qr = await query(t, "select Id from Vendor where DisplayName = '" + qEsc(name) + "'");
  if (qr.Vendor && qr.Vendor.length) return qr.Vendor[0].Id;
  const j = await qbFetch(t, 'POST', '/vendor', { DisplayName: name });
  return j.Vendor.Id;
}

async function ensureCustomer(t, name) {
  const qr = await query(t, "select Id from Customer where DisplayName = '" + qEsc(name) + "'");
  if (qr.Customer && qr.Customer.length) return qr.Customer[0].Id;
  const j = await qbFetch(t, 'POST', '/customer', { DisplayName: name });
  return j.Customer.Id;
}

async function ensureAccount(t, name, accountType) {
  const qr = await query(t, "select Id from Account where Name = '" + qEsc(name) + "'");
  if (qr.Account && qr.Account.length) return qr.Account[0].Id;
  const j = await qbFetch(t, 'POST', '/account', { Name: name, AccountType: accountType });
  return j.Account.Id;
}

/* One logged cost → one QBO Purchase (expense). */
async function createPurchase(t, { payAccountId, expenseAccountId, vendorId, customerId, amount, dateISO, note }) {
  const j = await qbFetch(t, 'POST', '/purchase', {
    PaymentType: 'Cash',
    AccountRef: { value: payAccountId },
    EntityRef: { value: vendorId, type: 'Vendor' },
    TxnDate: dateISO,
    PrivateNote: (note || '').slice(0, 4000),
    Line: [{
      Amount: amount,
      DetailType: 'AccountBasedExpenseLineDetail',
      AccountBasedExpenseLineDetail: {
        AccountRef: { value: expenseAccountId },
        CustomerRef: { value: customerId },
        BillableStatus: 'NotBillable',
      },
    }],
  });
  return j.Purchase.Id;
}

async function companyName(t) {
  try {
    const j = await qbFetch(t, 'GET', '/companyinfo/' + encodeURIComponent(t.realmId));
    return (j.CompanyInfo && j.CompanyInfo.CompanyName) || '';
  } catch (e) { return ''; }
}

module.exports = { authorizeUrl, exchangeCode, refreshTokens, freshTokens, qbFetch, query,
  ensureVendor, ensureCustomer, ensureAccount, createPurchase, companyName, API_BASE };
