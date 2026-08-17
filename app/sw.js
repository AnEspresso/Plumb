/* Plumb service worker — caches the app shell for offline use.
   Bump CACHE when you ship a new build so clients update. */
const CACHE = 'plumb-v2.270.0';
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  '../icon-192.png',
  '../icon-512.png',
  '../icon-maskable-512.png',
  '../apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'VERSION' && e.ports && e.ports[0]) e.ports[0].postMessage(CACHE);
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app shell itself: NETWORK-FIRST with a short timeout, cache fallback.
  // New builds appear on the next launch; offline still works from cache.
  const isShell = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (url.origin === location.origin && isShell) {
    e.respondWith((async () => {
      try {
        const net = await Promise.race([
          fetch(req, { cache: 'no-cache' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3500))
        ]);
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return net;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('index.html'));
      }
    })());
    return;
  }

  // Other same-origin assets: cache-first, fall back to network, update cache.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit =>
        hit || fetch(req).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => caches.match('index.html'))
      )
    );
    return;
  }

  // Cross-origin (e.g. Google Fonts): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});


/* ── Step 8 layer 2: background push (FCM). Fully guarded — if the SDK can't
   load (offline install, no network) the cache logic above is unaffected.
   Fires only once the server function is deployed and sending. Config mirrors
   PLUMB_FIREBASE_CONFIG in plumb.html (public by design). ── */
try{
  importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');
  firebase.initializeApp({
    "apiKey":"AIzaSyBSu0L0yqURyQOx57LZnj4EdS_9rhWxrwo",
    "authDomain":"plumb-467a0.firebaseapp.com",
    "projectId":"plumb-467a0",
    "storageBucket":"plumb-467a0.firebasestorage.app",
    "messagingSenderId":"746860454898",
    "appId":"1:746860454898:web:67e0b710d48ba55f90016b"
  });
  firebase.messaging().onBackgroundMessage(function(payload){
    const n=(payload&&payload.notification)||{};
    const d=(payload&&payload.data)||{};
    self.registration.showNotification(n.title||d.title||'Plumb',{
      body:n.body||d.body||'',icon:'icon192.png',badge:'icon192.png',tag:d.key||undefined});
  });
}catch(e){/* push SDK unavailable — caching unaffected */}

/* Tapping a notification focuses an open Plumb window, or opens one. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
