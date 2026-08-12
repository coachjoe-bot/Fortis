// v5 (2026-08-07 rebrand): the version MUST bump here or installed clients keep
// serving the v4 shell and the retired Bebas Neue / DM Sans files from cache, and the
// new type never appears no matter what ships.
const CACHE = "wilco-v11";
const ASSETS = [
  "/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png",
  // Self-hosted fonts (latin subsets only — the ones every screen actually uses;
  // other subsets are cached on demand by the misc handler below). Precaching
  // them means fonts render offline from the very first installed open.
  // Inter is variable (300-700) and replaced BOTH Bebas Neue and DM Sans.
  "/fonts/inter-latin.woff2",
  "/fonts/playfair-display-latin.woff2",
  "/fonts/playfair-display-italic-latin.woff2",
];

// SELF-DESTRUCT on non-canonical origins. A SW installed against an old Vercel
// alias (e.g. fortis-ten.vercel.app) keeps serving cached code and phoning home
// long after the alias is retired. If this script ever activates anywhere but the
// canonical production host, it unregisters itself and wipes its caches so the
// stale install cleans up and future loads follow the redirect to the real host.
// localhost is exempt so local dev/PWA testing is unaffected.
const CANONICAL_HOST = "app.trainwilco.com";
const IS_CANONICAL =
  self.location.hostname === CANONICAL_HOST ||
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

if (!IS_CANONICAL) {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", e => {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.registration.unregister();
      const clientList = await self.clients.matchAll({ type: "window" });
      clientList.forEach(c => c.navigate(c.url).catch(() => {}));
    })());
  });
} else {

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => pruneStaleAssets()));
  self.clients.claim();
});

// How long a navigation waits on the network before falling back to the cached
// shell. Long enough that a normal connection (~100-300ms) always wins and the
// athlete sees the current deploy; short enough that a dead connection can't hang
// first paint. See the navigation handler below.
const NAV_TIMEOUT_MS = 2500;

// ─── STALE-ASSET PRUNING ──────────────────────────────────────────────────────
// /assets/ entries are cache-first forever and the cache name never changes per
// deploy, so without pruning every deploy leaks its full set of dead hashed
// chunks into CacheStorage permanently (raising iOS storage-pressure eviction
// risk, where Safari drops the WHOLE cache — shell included). The build emits
// /asset-manifest.json (see vite.config.js) listing the current deploy's hashed
// files; anything cached under /assets/ that isn't in it is a dead old chunk.
//
// Deletion is TWO-PHASE with a 24h grace period: an entry missing from the
// manifest is only stamped on first sighting and deleted on a later prune ≥24h
// after that stamp. That protects a client that opened mid-deploy and is still
// RUNNING the previous build (its lazy chunks stay cached for the rest of that
// session and day). Known limit: a session left open across 24h+ AND overlapping
// two deploys can lose a not-yet-loaded lazy chunk from the cache — the existing
// stale-chunk self-heal (purge + one guarded reload) already covers exactly that
// path. Only /assets/ paths are ever considered: the shell ("/", "/index.html"),
// icons, manifest, and /fonts/ can never be evicted here.
const PRUNE_INDEX_KEY = "/__wilco-prune-index__";
const PRUNE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;   // run at most every 6h
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;          // missing-for-24h before delete

async function pruneStaleAssets() {
  try {
    const cache = await caches.open(CACHE);
    let idx = { lastRun: 0, missing: {} };
    try {
      const hit = await cache.match(PRUNE_INDEX_KEY);
      if (hit) idx = await hit.json();
    } catch (_) { /* corrupt index → start fresh */ }
    const now = Date.now();
    if (now - (idx.lastRun || 0) < PRUNE_MIN_INTERVAL_MS) return;

    const res = await fetch("/asset-manifest.json", { cache: "no-store" });
    if (!res.ok) return;
    const manifest = await res.json();
    const live = new Set(Array.isArray(manifest && manifest.assets) ? manifest.assets : []);
    if (live.size === 0) return;   // empty/bad manifest → never prune on bad data

    const keys = await cache.keys();
    const missing = {};
    for (const req of keys) {
      const path = new URL(req.url).pathname;
      if (!path.startsWith("/assets/")) continue;   // shell/icons/fonts are untouchable
      if (live.has(path)) continue;
      const firstSeen = (idx.missing && idx.missing[path]) || now;
      if (now - firstSeen >= PRUNE_GRACE_MS) await cache.delete(req);
      else missing[path] = firstSeen;
    }
    await cache.put(PRUNE_INDEX_KEY, new Response(
      JSON.stringify({ lastRun: now, missing }),
      { headers: { "Content-Type": "application/json" } }
    ));
  } catch (_) { /* pruning is best-effort; never break the SW */ }
}

// Offline strategy: the app shell alone isn't enough — index.html references a
// HASHED bundle under /assets/, so unless those files are cached too, an offline
// open loads the shell and then dies on the missing script. Hashed assets are
// immutable → cache-first; navigations stay network-first (so deploys show up
// immediately) with the cached shell as the offline fallback; everything else
// same-origin is network-first with cache fallback. API calls are never cached.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fonts/Stripe: browser cache handles these
  if (url.pathname.startsWith("/api/")) return;       // live data only, never from cache

  // Immutable hashed build assets: serve from cache, fetch+store on first miss.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Navigations: NETWORK-FIRST with a short timeout, cached shell as fallback.
  //
  // This was stale-while-revalidate (always serve cache, refresh in background),
  // which meant a deploy needed TWO cold opens to appear. On iOS that is much worse
  // than it sounds: an installed PWA/native shell RESUMES from memory instead of
  // cold-starting, so the "second open" can be days away — the app looks permanently
  // stuck on an old build. That is exactly what Will hit on 08-11 ("why won't my app
  // update"), so freshness now wins by default.
  //
  // Online, the athlete always gets the current deploy. Offline or on a bad
  // connection the timeout fires and the cached shell still paints, so the white
  // screen that SWR was introduced to kill stays killed. A served-from-cache shell
  // is still self-consistent: it references hashed /assets/ URLs, cache-first above.
  if (req.mode === "navigate") {
    const network = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("/", copy)); }
      return res;
    });
    // Attaching this catch ALSO prevents an unhandled rejection when we've already
    // answered from cache and the network promise settles late. Then prune dead
    // hashed assets (throttled internally; after the refresh, so the cached shell is
    // current-deploy before anything is considered for deletion).
    e.waitUntil(network.catch(() => {}).then(() => pruneStaleAssets()));
    e.respondWith((async () => {
      try {
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error("nav-timeout")), NAV_TIMEOUT_MS));
        return await Promise.race([network, timeout]);
      } catch (_) {
        return (await caches.match("/")) || network;   // offline/slow → last good shell
      }
    })());
    return;
  }

  // Icons, manifest, misc static: network-first with cache fallback.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────────
// tag is PAYLOAD-DRIVEN (notification policy v2): with four distinct push types
// (feed-live, 14/30-day inactivity, coach programming-update, test) now live, a
// single hardcoded tag would let one type's notification silently replace another
// still sitting in the tray (same tag = same OS notification slot). The server
// sends `data.tag` per type (api/_push.js's pushPayload sets a sensible default
// when a caller omits it); "wilco-proof-feed" stays as the fallback ONLY for
// payloads sent before this change (old queued pushes, if any).
self.addEventListener("push", e => {
  let data = { title: "WILCO", body: "Your Proof Feed is ready.", url: "/", tag: "wilco-proof-feed" };
  if (e.data) {
    try { data = { ...data, ...JSON.parse(e.data.text()) }; } catch (_) {}
  }
  const options = {
    body: data.body,
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    tag: data.tag || "wilco-proof-feed",
    renotify: true,
    data: { url: data.url || "/", type: data.type || null },
    actions: [{ action: "open", title: "View Now" }],
  };
  e.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── NOTIFICATION TAP → THE SCREEN THE PUSH IS ABOUT (T51) ────────────────────
// This used to call client.focus() and RETURN, before ever looking at the URL. So
// a cold start landed correctly (openWindow got the url) while a warm start — the
// PWA already open in the background, which is the common case on a phone —
// dropped the athlete wherever they happened to be. "Coach updated your program"
// tapped from a backgrounded app reopened the chat.
//
// Now: focus the existing window AND navigate it. WindowClient.navigate is what
// makes the warm path land; it needs the client to be same-origin and controlled,
// which every WILCO window is. If a browser refuses it (or the client is
// uncontrolled), fall back to opening a fresh window at the target rather than
// leaving the athlete on the wrong screen.
//
// Deliberately a real navigation rather than a postMessage the app routes
// in-place: a postMessage only lands if the OPEN tab is already running a build
// that understands it, and the whole point here is that the tap lands regardless
// of which build the athlete is sitting on.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  const target = new URL(url, self.location.origin).href;
  e.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientList) {
      try {
        // Order matters: navigate first, then focus the (possibly new) client
        // handle it returns — focusing first can settle the tap before the
        // navigation is applied on some engines.
        const navigated = client.navigate ? await client.navigate(target) : null;
        const focusable = navigated || client;
        if ("focus" in focusable) await focusable.focus();
        return;
      } catch (_) {
        // navigate() rejected (uncontrolled client, or unsupported): fall through
        // to opening a window at the target — landing right beats reusing a tab.
        break;
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});

} // end canonical-host handlers (see SELF-DESTRUCT guard above)
