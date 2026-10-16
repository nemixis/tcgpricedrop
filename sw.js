/* PackDrop service worker — app shell + offline.
 *
 * Goals, in order:
 *   1. Installability (this file is what makes the manifest count).
 *   2. A shell that loads with no network, so the app opens and shows its own
 *      "couldn't reach the card data" message instead of a browser error page.
 *   3. Near-instant repeat visits, shell served from cache.
 *
 * Deliberately NOT cached: Scryfall card art and the Supabase/price feeds.
 * They are large, dynamic, and the app already degrades gracefully without
 * them — caching them would bloat storage for no gain.
 *
 * Safety rule: anything this file does not explicitly handle is passed
 * straight through to the network, and every branch falls back rather than
 * throwing. A service worker that breaks the fetch path breaks the whole app,
 * so the default is always "let the browser do it".
 */

const VERSION = 'v1';
const SHELL_CACHE = 'packdrop-shell-' + VERSION;
const FONT_CACHE = 'packdrop-fonts-' + VERSION;

// Relative URLs so the same file works at a GitHub Pages subpath (/packdrop/)
// and at a server root. Resolved against this worker's own scope.
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache each entry on its own: one missing file must not fail the whole
    // install and leave the player with no worker at all.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (e) { /* a 404 here only costs that one asset */ }
    }));
    // Take over as soon as it is installed rather than waiting for every tab
    // to close — players reload this app often, so waiting would stall updates.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop caches from previous versions; stale shells are the classic way a
    // PWA ends up serving an old build forever.
    const keep = [SHELL_CACHE, FONT_CACHE];
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (keep.includes(k) ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Never intercept anything but plain GETs.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // ---- TEST_index.html: complete passthrough, never cached ----
  // The dev twin is rebuilt constantly, and a worker that caches it serves a
  // stale build with no visible error — prices that work on a fresh browser
  // and silently do not on the one that did the testing. Bypass every branch
  // below so the network always answers and nothing is ever stored.
  if (url.pathname.endsWith('TEST_index.html')) return;

  // ---- navigations: network-first, cached shell as the offline fallback ----
  // Network-first (not cache-first) on purpose: index.html is unversioned, so
  // serving it from cache first would pin players to whatever build they
  // first loaded. Online they always get the latest; offline they get the
  // shell they last saw.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(req);
        // Only the shell itself may claim the shell cache slot. Storing any
        // other document under './index.html' means the next offline open of
        // index.html gets whatever file was last navigated to.
        if (fresh && fresh.ok && url.pathname === self.location.pathname) {
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const shell = (await cache.match('./index.html')) || (await cache.match('./'));
        return shell || new Response(
          '<!doctype html><meta charset="utf-8"><title>PackDrop</title>' +
          '<body style="background:#0a0d18;color:#edeff7;font-family:sans-serif;' +
          'display:flex;align-items:center;justify-content:center;height:100vh;' +
          'margin:0;text-align:center;padding:24px">' +
          '<div><h1 style="font-size:20px">PackDrop</h1>' +
          '<p style="color:#8a90ac;font-size:14px">You are offline and no saved ' +
          'copy was found yet. Reconnect once, then it will work offline.</p></div>',
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // ---- Google Fonts: cache-first so typography survives offline ----
  // Stored as opaque responses; they cannot be read back but render fine.
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // ---- same-origin statics (icons, manifest): cache-first ----
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        // The dev twin is deliberately never cached (see the top of this
        // handler), and it must not be served from the shell cache either —
        // cache.match(req) above would have hit an entry a previous version
        // of this file stored before the passthrough existed.
        if (res && res.ok && !url.pathname.endsWith('TEST_index.html')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // ---- everything else (Scryfall art, Supabase, price feeds): passthrough ----
});

// Lets the page ask for an immediate takeover after a deploy, without making
// the player hunt for it.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
