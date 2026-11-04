/*
 * Service worker for the Connestee Crit Series app.
 *
 * Its one job is to make the staff check-in screen open without a signal:
 * - Visits to /staff/check-in are network-first, with the last good copy kept
 *   as a fallback.
 * - Next.js build files under /_next/static/ are cache-first (their names
 *   change with every build, so a cached copy is never stale).
 * Everything else, including every API call, goes straight to the network.
 * The roster and queued check-ins live in the page's local storage, not here.
 */
const VERSION = "v1";
const PAGES = `crs-pages-${VERSION}`;
const ASSETS = `crs-assets-${VERSION}`;
const CHECK_IN = "/staff/check-in";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, ASSETS]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname.startsWith(CHECK_IN)) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    // Cache only a real check-in page, not a redirect to sign in.
    if (res.ok && !res.redirected) await cache.put(req, res.clone());
    return res;
  } catch {
    const exact = await cache.match(req);
    if (exact) return exact;
    for (const key of await cache.keys()) {
      if (new URL(key.url).pathname.startsWith(CHECK_IN)) {
        const any = await cache.match(key);
        if (any) return any;
      }
    }
    return new Response(
      "<!doctype html><meta name=viewport content='width=device-width'><title>Offline</title><body style='font-family:system-ui;padding:24px'><h1>Offline</h1><p>Open the check-in screen once with a signal so it works offline.</p>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}
