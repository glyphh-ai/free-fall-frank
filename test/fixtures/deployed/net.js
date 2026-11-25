// Free Fall Frank, between the page and the server. SAFE BUILDS (server.js): the machine sleeps when nobody plays
// and is restarted by a deploy, and a page that was open through a deploy is the build before the server's. So:
//   - what the game has to tell the server (tokens, a secret found, a score, a run, a heart, the profile) goes through
//     an OUTBOX kept in this browser until the server has answered, each thing with a key made here so that sending it
//     twice counts once;
//   - what is read is asked again through a wake-up or a restart;
//   - the page learns of a new build from the answers it already gets (it never asks just to find out: that would
//     keep the machine awake) and reloads itself into it only at a moment that costs the player nothing;
//   - the service worker of a new build takes over only when a page of that same build asks it to.
// account.js and game.js ask through window.FFFNet. Inside Claude (the game as an MCP App) and opened from a file
// there is no server: everything here stays quiet.
(function (root) {
  'use strict';
  const SV = root.FFFSave, $ = function (id) { return document.getElementById(id); };
  const online = location.protocol.indexOf('http') === 0 && !root.FFF_ME && !root.FFF_PANEL;
  // BUILD is the build this page was loaded with (the server writes it into the page); every answer says which build
  // the server is now (X-Build), which is how a page that was open through a deploy finds out (seen(), below).
  const BUILD = root.FFF_BUILD || '';
  // this device's own id: it owns the wallet until there is an account, and ties plays together for the stats
  let did = SV.get('fff.did');
  if (!did) { did = (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12)); SV.put('fff.did', did); }
  const DEV = 'dev:' + did;

  // one question to the server: { status, body }. key: the Idempotency-Key of something the outbox sends; as: whose it is.
  function ask(path, data, key, as) {
    const h = { 'X-Did': did };
    if (key) { h['Idempotency-Key'] = key; h['X-As'] = as; }
    return fetch(path, data ? { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(data) } : { cache: 'no-store', headers: h })
      .then(function (r) { seen(r.headers.get('X-Build')); return r.json().then(function (j) { return { status: r.status, body: j }; }, function () { return { status: r.status, body: null }; }); });
  }
  // Something read (who I am, a level, a list), asked again through a wake-up or a restart: three more tries over
  // about four seconds, for no answer at all or one that says the server is not there (5xx), before it counts as failed.
  function read(path, n) {
    n = n || 0;
    const again = function () { return new Promise(function (ok) { setTimeout(ok, [400, 1200, 2500][n]); }).then(function () { return read(path, n + 1); }); };
    return ask(path).then(function (r) { if (r.status >= 500 || r.body === null) { if (n < 3) return again(); throw new Error('the server is away'); } return r.body; }, function (e) { if (n < 3) return again(); throw e; });
  }
  // something done by hand at this moment (signing in, starting a checkout): asked once, the answer as it comes
  function post(path, data) { return ask(path, data).then(function (r) { if (r.body === null) throw new Error('the server is away'); return r.body; }); }

  // WHOSE THIS BROWSER IS: the account that is signed in, or else the device itself ("dev:<its id>"), as the server
  // last said (fff.uid). Everything in the outbox is filed under whose it is and is never sent as anybody else: the
  // server is told who it is meant for (X-As) and refuses it for another. One exception, which is the server's own
  // rule: signing in moves a device's wallet onto the account, so what this device still had waiting goes with it.
  let uid = SV.get('fff.uid') || DEV, sure = false;                 // sure: the server has said who this is, since the page loaded
  function iam(d) {
    const now = d.id || (d.user ? (uid !== DEV ? uid : 'user:' + (d.user.email || '')) : DEV);
    if (now !== uid && uid === DEV && now.indexOf('dev:') !== 0) box.set(box.get().map(function (x) { if (x.u === DEV) x.u = now; return x; }));
    uid = now; sure = true; SV.put('fff.uid', uid);
    tries = 0; flush();
  }

  // THE OUTBOX. Each thing is first written to a small queue in this browser (localStorage, 'fff.outbox'), with a
  // key made here, then sent, and taken out only when the server has answered:
  //   2xx                  it is kept there. Out of the queue; the answer goes to whoever is listening (on()).
  //   a refusal (4xx)      it will never be kept: out of the queue.
  //   no answer, or 5xx    the machine is asleep, restarting under a deploy, or the network is gone: it stays, and is
  //                        sent again after 1, 2, 4.. seconds (5 minutes at most), when the network or the tab comes
  //                        back, and when the page is next opened. Closing the tab loses nothing.
  //   409                  it is somebody else's (another account is signed in now): it waits for its own.
  // Sending something twice counts once: the key goes with it (Idempotency-Key) and the server gives a repeat the
  // answer it gave the first time. What waits is kept 30 days.
  const BOX = 'fff.outbox', PATHS = { tokens: '/api/tokens', secret: '/api/secret', score: '/api/score', run: '/api/track', heart: '/api/heart', profile: '/api/profile' }, MOST = 600;
  // (mem: the queue as it was last read; it is read again when another tab of the game has changed it. The game asks
  // what waits on every frame it draws the wallet, so the asking must cost nothing.)
  let mem = null, going = '', tryT = 0, tries = 0;
  const box = {
    get: function () {
      if (!mem) { let a = []; try { a = JSON.parse(root.localStorage.getItem(BOX)) || []; } catch (e) { a = []; } mem = (Array.isArray(a) ? a : []).filter(function (x) { return x && x.k && x.u && x.b && PATHS[x.t] && x.at > Date.now() - 30 * 864e5; }); }
      return mem.slice();
    },
    set: function (a) {
      // (too many to keep: the oldest runs go first, then the oldest scores; they are for the stats and the boards. Tokens and secrets are never dropped.)
      ['run', 'score'].forEach(function (t) { while (a.length > MOST && a.some(function (x) { return x.t === t && x.k !== going; })) a.splice(a.findIndex(function (x) { return x.t === t && x.k !== going; }), 1); });
      mem = a; try { root.localStorage.setItem(BOX, JSON.stringify(mem)); } catch (e) { /* private mode, or no room: it is kept for as long as the page is */ }
    },
  };
  root.addEventListener('storage', function (e) { if (e.key === BOX || e.key === null) mem = null; });
  const newKey = function () { const a = new Uint8Array(16); if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a); else for (let i = 0; i < 16; i++) a[i] = Math.random() * 256; return Array.from(a, function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join(''); };
  const mine = function (t) { return box.get().filter(function (x) { return x.u === uid && (!t || x.t === t); }); };
  const heard = {}, waits = {};
  function on(t, fn) { heard[t] = fn; }
  // put something in the outbox; instead: which of his waiting things of the same kind it takes the place of (a heart
  // on the same level, the same field of the profile). Answers with a promise of the server's answer, for whoever
  // wants to wait for it; with patience (ms) the wait is given up after that long (the thing itself still goes).
  function send(t, b, instead, patience) {
    if (!online) return Promise.reject(new Error('offline'));
    const k = newKey(), all = box.get().filter(function (x) { return !(instead && x.u === uid && x.t === t && x.k !== going && instead(x.b)); });
    box.set(all.concat([{ k: k, t: t, u: uid, b: b, at: Date.now() }]));
    const p = new Promise(function (ok, no) { waits[k] = { ok: ok, no: no }; if (patience) setTimeout(function () { no(new Error('the server is away')); }, patience); });
    p.catch(function () { /* whoever waits says so; nobody has to */ });
    flush();
    return p;
  }
  const drop = function (k) { box.set(box.get().filter(function (x) { return x.k !== k; })); };
  function flush() {
    if (!online || going || !sure) return;
    const x = mine()[0];
    if (!x) return;
    going = x.k; clearTimeout(tryT);
    ask(PATHS[x.t], x.b, x.k, x.u).then(function (r) {
      going = '';
      const w = waits[x.k];
      if (r.status >= 200 && r.status < 300) { drop(x.k); tries = 0; delete waits[x.k]; if (heard[x.t]) heard[x.t](r.body || {}, x); if (w) w.ok(r.body || {}); flush(); }
      else if (r.status === 409) { sure = false; if (heard.who) heard.who(); }             // not who this page thought it was: ask (account.js), and iam() carries on
      else if (r.status === 401 || r.status === 408 || r.status === 429 || r.status >= 500) later();
      else { drop(x.k); tries = 0; delete waits[x.k]; if (w) w.no(new Error((r.body && r.body.error) || 'refused')); flush(); }
    }, function () { going = ''; later(); });
  }
  // (after some fourteen tries in a row, about half an hour, it is left for the next time the network or the tab comes back, or the page is opened: a page left open is not to keep the machine awake for good)
  function later() { clearTimeout(tryT); if (++tries > 14) return; tryT = setTimeout(flush, Math.min(300000, 500 * Math.pow(2, tries)) * (0.8 + Math.random() * 0.4)); }
  function nudge() { tries = 0; clearTimeout(tryT); flush(); }       // the network or the tab is back: try now

  // ---- A NEW BUILD, WHILE THIS PAGE IS OPEN ----
  // A deploy does not stop a fall: the game is in this page. But the page is now the build before the server's, and
  // should become the new one. IT IS NEVER RELOADED UNDER HIM. By itself it reloads only on the main page (the level
  // cards) and the Frank picker, with no finger on the screen for a moment, and never: during a fall, a pause, the
  // win or the wall of a taste; with the account sheet or a clip open; while a sign-in, an emailed link or a
  // checkout is on its way (account.js says so: holds); while he is typing. Until then, when he is not falling, a
  // small note at the bottom edge says NEW VERSION · RELOAD for whoever would rather do it now; the ✕ puts the note
  // away, not the reload. During a fall nothing is shown at all: every touch there is a tap. Before it reloads, the
  // page asks /healthz once, so that it never reloads into a server that is away. After it he is where he was: the
  // address is kept (a level's or a Frank's link), and so are the card or the Frank he was on (back). It reloads by
  // itself once for each build, so a page that still is not the new one afterwards is not sent round and round.
  let fresh = '', hushed = false, freshT = 0, touched = 0, leaving = false;
  const RL = 'fff.reload', holds = [], QUIET = 1500;
  const state = function () { return root.FFF && root.FFF.state ? root.FFF.state() : 'play'; };
  const falling = function () { const s = state(); return s === 'play' || s === 'dead' || s === 'paused'; };
  const was = function () { try { return JSON.parse(root.sessionStorage.getItem(RL)) || {}; } catch (e) { return {}; } };
  // (ours: this page is one that reloaded itself a moment ago; back: where he was then, for game.js)
  const w0 = was(), ours = !!w0.at && w0.at > Date.now() - 60000, back = ours && w0.back ? w0.back : null;
  try { if (w0.at) root.sessionStorage.setItem(RL, JSON.stringify({ to: w0.to })); } catch (e) { /* no storage: he lands on the main page */ }
  function seen(b) {
    if (!b || !BUILD || b === BUILD || b === fresh) return;
    fresh = b; hushed = false;
    clearInterval(freshT); freshT = setInterval(maybe, 500); setTimeout(maybe, 0);   // (it looks, it asks the server nothing)
  }
  function hold(fn) { holds.push(fn); }
  function safe() {
    const s = state(), a = document.activeElement;
    if ((s !== 'title' && s !== 'select') || (root.FFF.busy && root.FFF.busy())) return false;
    if ($('clipbox') || (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) || holds.some(function (f) { return f(); })) return false;
    return Date.now() - touched > QUIET;
  }
  function maybe() {
    const el = $('fresh'), s = state();
    if (!fresh) return;
    if (el) el.hidden = hushed || leaving || s === 'play' || s === 'dead' || s === 'intro' || s === 'howto';
    if (!leaving && !document.hidden && was().to !== fresh && safe()) reload();
  }
  // by: 'hand' when he pressed RELOAD (then it is his call wherever he is, except that the server must be there)
  function reload(by) {
    if (leaving) return;
    leaving = true;
    fetch('/healthz', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('away'); }).then(function () {
      if (by !== 'hand' && !safe()) { leaving = false; return; }    // he did something in the meantime
      const w = root.FFF && root.FFF.where ? root.FFF.where() : null;
      try { root.sessionStorage.setItem(RL, JSON.stringify({ to: fresh, at: Date.now(), back: w })); } catch (e) { /* no storage */ }
      clearInterval(freshT);
      location.reload();
    }).catch(function () { leaving = false; if (by === 'hand' && $('fresh-go')) { $('fresh-go').textContent = 'NO CONNECTION · TRY AGAIN'; setTimeout(function () { $('fresh-go').textContent = 'NEW VERSION · RELOAD'; }, 2500); } });
  }
  // The service worker (sw.js) keeps one build's files and is named by it. A new one waits, and takes over only when
  // a page of its own build asks: so the worker of a new build never changes the files under a page of the old one.
  function worker(reg) {
    const offer = function (w) { if (w && BUILD) w.postMessage({ type: 'take-over', build: BUILD }); };
    if (!reg) return;
    const watch = function (w) { if (w) w.addEventListener('statechange', function () { if (w.state === 'installed') offer(reg.waiting); }); };
    offer(reg.waiting); watch(reg.installing);                      // one that is waiting already, one on its way in, and any found later
    reg.addEventListener('updatefound', function () { watch(reg.installing); });
  }
  if (online) {
    root.addEventListener('online', nudge);
    ['pointerdown', 'pointermove', 'keydown'].forEach(function (n) { root.addEventListener(n, function () { touched = Date.now(); }, { capture: true, passive: true }); });
    document.addEventListener('DOMContentLoaded', function () {
      if ($('fresh-go')) $('fresh-go').onclick = function () { reload('hand'); };
      if ($('fresh-no')) $('fresh-no').onclick = function () { hushed = true; maybe(); };
    });
  }
  root.FFFNet = { online: online, build: BUILD, did: did, read: read, post: post, send: send, on: on, mine: mine, iam: iam, nudge: nudge, who: function () { return uid; }, waiting: function () { return box.get(); },
    hold: hold, falling: falling, maybe: maybe, fresh: function () { return fresh; }, back: back, reloaded: ours, worker: worker };
})(window);
