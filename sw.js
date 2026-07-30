/* Root service worker — RETIREMENT ONLY.

   The app used to live at the site root, so existing installs registered a
   service worker here with scope "/" and cached the whole app shell against it.
   The root now serves the marketing site, and the app lives at /app/ with its
   own worker.

   If this file simply disappeared, GitHub Pages would return the marketing
   page for /sw.js, the browser would refuse it as a script, and the old worker
   would stay registered and keep serving a stale cached app at the root for
   anyone who has ever installed it. So this file has to exist, and its only
   job is to stand the old worker down cleanly:

     1. take control immediately
     2. delete every cache the old app left behind
     3. unregister itself

   After one online visit to the root, the old registration is gone and the
   root is served straight from the network. Nothing here caches anything.
   Once no installs from before the move remain, this file can be deleted. */

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
  })());
});

/* No fetch handler on purpose. Every request goes straight to the network. */
