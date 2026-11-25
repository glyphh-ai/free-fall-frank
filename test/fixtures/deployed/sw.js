// Offline support: try the network first so a new version always shows up, fall back to the saved copy.
// The account, the store (/api/), an emailed sign-in link's page (/auth/) and the admin page are never cached.
// "/" is two pages (the landing page for someone new, the game for a player: the server tells them apart), so its
// answer is never saved: offline it is the game, which is kept as /play. The landing page and its video are left alone.
// (A paid level's stretches come from /api/world each time it is played, so they are never kept here either.)
//
// SAFE BUILDS (server.js). The server writes its build into this file as it sends it, so:
//   - the cache is named by the build, and nobody has to remember to give it a new name;
//   - the cache holds one build's files and no other's. The page is kept as the server sent it for this build, and
//     that page asks for its scripts by the build (game.js?v=<build>), which is the name they are kept under. A copy
//     is only kept when the server that answered says it is this build (X-Build). So what comes out of here offline,
//     or while the server restarts, is always a page with the scripts it was made for;
//   - a new worker waits. It takes over only when a page of its own build asks (net.js, worker()), which is a page
//     that already runs the new files: the files are never changed under a page of the build before, falling or not.
//     A page from before there were builds asks nothing, and keeps the worker it has until it is next opened.
const BUILD = '__BUILD__', CACHE = 'fff-' + BUILD, PAGE = 'play';
// what the game needs besides its page and the scripts the page names (those are read from the page itself)
const FILES = ['manifest.json', 'icon-180.png', 'icon-512.png', 'glyphh-logo.png', 'glyphh-spike.png', 'glyphh-logo-black.png', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-maskable-512.png']
  .concat(['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'snap', 'rim', 'scratch', 'hey', 'crash'].map(function (n) { return 'samples/' + n + '.wav'; }));
const mine = function (res) { return res.status === 200 && res.headers.get('X-Build') === BUILD; };

self.addEventListener('install', function (e) {
  // every file of this build, or none: a deploy in the middle of this leaves the worker that was there in place
  const get = function (u) { return fetch(u, { cache: 'no-store' }).then(function (res) { if (!mine(res)) throw new Error(u + ' is not build ' + BUILD); return res; }); };
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return get(PAGE).then(function (page) {
      return page.clone().text().then(function (html) {
        const files = FILES.slice();
        html.replace(/<script src="([^"]+)"/g, function (m, src) { files.push(src); return m; });
        return Promise.all(files.map(function (u) { return get(u).then(function (res) { return c.put(u, res); }); })).then(function () { return c.put(PAGE, page); });
      });
    });
  }));
});
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'take-over' && e.data.build === BUILD) self.skipWaiting();   // a page of this build asks: only then
});
self.addEventListener('activate', function (e) {
  // the caches of the builds before go; the music a player has already fetched (it is not part of a build) comes along
  e.waitUntil(caches.open(CACHE).then(function (now) {
    return caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.open(k).then(function (old) {
          return old.keys().then(function (reqs) {
            return Promise.all(reqs.filter(function (q) { return /\/music\/[\w-]+\.mp3$/.test(new URL(q.url).pathname); }).map(function (q) {
              return now.match(q).then(function (had) { return had || old.match(q).then(function (res) { return res && now.put(q, res); }); });
            }));
          });
        }).catch(function () { /* the music is fetched again */ }).then(function () { return caches.delete(k); });
      }));
    });
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url), home = url.pathname === '/';
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/admin') === 0 || url.pathname.indexOf('/ad') === 0 || url.pathname.indexOf('/oauth/') === 0 || url.pathname.indexOf('/auth/') === 0 || url.pathname.indexOf('/.well-known/') === 0
    || url.pathname === '/about' || url.pathname.indexOf('/landing/') === 0 || url.pathname === '/healthz' || url.pathname === '/mcp' || url.pathname === '/sw.js') return;
  // the saved copy: a file asked for by a build (?v=) only as that build's; anything else by its address, whatever follows the "?"
  const kept = function () { return caches.open(CACHE).then(function (c) { return c.match(home ? PAGE : e.request, { ignoreSearch: home || !url.searchParams.has('v') }); }); };
  e.respondWith(fetch(e.request).then(function (res) {
    if (res.status >= 500) return kept().then(function (had) { return had || res; });   // the server is restarting: the saved copy, if there is one
    if (!home && mine(res)) { const copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(e.request, copy); }).catch(function () { /* no room: nothing is kept */ }); }
    return res;
  }).catch(function () { return kept().then(function (had) { return had || Response.error(); }); }));
});
