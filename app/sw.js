/* Plumb service worker — caches the app shell for offline use.
   Bump CACHE when you ship a new build so clients update. */
const CACHE = 'plumb-v2.404.0';
const SHELL = [
  './',
  'index.html',
  'p.html',
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

  // Guest packet page is not the builder app shell. Never fall back to index.html.
  if (url.origin === location.origin && url.pathname.endsWith('/p.html')) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(async () => (await caches.match('p.html')) || new Response('This packet needs a connection.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))
    );
    return;
  }

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

  // Walk clips must never fall back to index.html (wrong MIME = silent PWA).
  if (url.origin === location.origin && (url.pathname.indexOf('tour-audio') >= 0 || /\.mp3$/i.test(url.pathname))) {
    e.respondWith(fetch(req).catch(() => new Response('', { status: 404, statusText: 'audio-miss' })));
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
   Config mirrors PLUMB_FIREBASE_CONFIG in plumb.html (public by design).
   One showNotification per tag per couple of seconds — iOS will otherwise
   stack the OS auto-display and this handler as two lock-screen cards. ── */
const ICON = 'https://siteplumb.com/icon-192.png';
const _shown = new Map();
function showOnce(title, opts){
  const tag = String((opts && opts.tag) || title || 'plumb');
  const now = Date.now();
  const prev = _shown.get(tag) || 0;
  if (now - prev < 2500) return Promise.resolve();
  _shown.set(tag, now);
  return self.registration.showNotification(title, opts);
}

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
    if(n.title||n.body)return; /* OS already painted the notification payload */
    const d=(payload&&payload.data)||{};
    return showOnce(d.title||'SitePlumb',{
      body:d.body||'',icon:ICON,badge:ICON,tag:d.key||'plumb'});
  });
}catch(e){/* push SDK unavailable — caching unaffected */}

self.addEventListener('push',function(event){
  event.waitUntil((async function(){
    let title='SitePlumb',body='',tag='plumb',hasNote=false;
    try{
      const p=event.data?event.data.json():{};
      const n=p.notification||{};
      const d=p.data||{};
      hasNote=!!(n.title||n.body);
      title=n.title||d.title||title;
      body=n.body||d.body||body;
      tag=d.key||n.tag||tag;
    }catch(e){
      try{body=(event.data&&event.data.text())||'';}catch(e2){}
    }
    /* Notification payloads are displayed by the OS. Showing again stacks two
       lock-screen cards on iPhone. Data-only still needs us to paint. */
    if(hasNote)return;
    return showOnce(title,{
      body:body,icon:ICON,badge:ICON,tag:tag,renotify:true
    });
  })());
});

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
