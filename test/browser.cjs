// node test/browser.cjs : SAFE BUILDS in a real browser (server.js): the page that was open through a deploy, the
// outbox, a purchase through a restart, and what the browser keeps. A headless phone is driven through the server's
// own handle (its requests are routed into it in this process: no port is bound, no email is sent, Stripe is a
// stand-in, the database is a throwaway one), from a copy of the client's files that the test can change, which is
// what a deploy does: deploy() changes net.js in the copy and has the server work out its build again. The machine
// being asleep, restarting, or losing an answer is played by the route (net.mode).
//   a new build while he is on the main page -> reloads by itself, once it has heard (and it does not ask to find
//   out, but once a minute when he comes back to the tab); in a fall -> never, and nothing is shown; paused, on the
//   win screen, with the account sheet open, waiting for an emailed link, on the way to Stripe -> not until he is
//   done, with the small note; RELOAD and the x on the note; the card or the Frank he was on is where he lands;
//   the outbox: tokens, scores and runs made while the server answers 503, drops the connection or loses its answer
//   are delivered once it is back, exactly once, across a reload and a closed tab; nothing kept for one player is sent
//   as another; a device's things go with it when it signs in; reads are asked again through a restart;
//   a purchase whose return meets a restarting server, or a closed tab, is still confirmed;
//   every shape of what a browser keeps (test/fixtures/saves) opens the game, and what cannot be read is set aside;
//   the service worker: its cache named by the build and holding that build only, the game offline and through a
//   503 (a NEW worker waiting and taking over is run in test/safe.cjs: the browser's own look for a new sw.js cannot
//   be routed into the server from here);
//   and, when the client of the release that is live is kept (test/fixtures/deployed, or FFF_PREV_CLIENT), that page
//   is played against this server.
// It needs Playwright (not a dependency of the game): PLAYWRIGHT_PATH, or NODE_PATH with it. Without it: skipped.
'use strict';
const assert = require('assert'), os = require('os'), fs = require('fs'), path = require('path'), { Readable, Writable } = require('stream');
let chromium;
try { chromium = require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium; } catch (e) { console.log('SKIPPED browser: Playwright is not here (set PLAYWRIGHT_PATH or NODE_PATH to drive the safe reload, the outbox and the saves in a browser)'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), D = require('./db.cjs'), SITE = 'https://freefallfrank.test', STRIPE = 'https://checkout.stripe.test';
process.env.SESSION_SECRET = 'test-secret'; process.env.PUBLIC_URL = SITE; process.env.RESEND_API_KEY = 're_test_never_used'; process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
['APPLE_SERVICE_ID', 'ADMIN_EMAILS', 'ADMIN_MCP_KEY', 'ADMIN_PASSWORD', 'EMAIL_FROM', 'GOOGLE_CLIENT_ID', 'FLY_APP_NAME'].forEach(function (k) { delete process.env[k]; });
const sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
let S, T, W, browser, builds = 0;
// what stands between the page and the server: 'ok', or for the paths in net.only: '503' (the proxy's page, the machine
// not up), '503j' (the server's own 503), 'abort' (no connection), 'lose' (the server does it and the answer is lost);
// net.fail: that many of them fail (503) and then it is 'ok' again; net.slow: that path is answered this many ms late
const net = { mode: 'ok', only: /^\/api\/(tokens|score|track|secret|heart|profile)$/, fail: 0, slow: null, log: [] };
function serve(method, url, body, headers) {
  return new Promise(function (done) {
    const req = Object.assign(Readable.from(body ? [body] : []), { method: method, url: url, headers: headers }), parts = [];
    const res = new Writable({ write: function (c, e, next) { parts.push(Buffer.from(c)); next(); } });
    Object.assign(res, { status: 200, heads: {}, setHeader: function (k, v) { this.heads[k] = v; }, writeHead: function (c, h) { this.status = c; Object.assign(this.heads, h || {}); } });
    res.on('finish', function () { done({ status: res.status, body: Buffer.concat(parts), heads: res.heads }); });
    S.handle(req, res);
  });
}
// a phone: who is signed in on it ('' for nobody), and what its browser kept before (store: localStorage, set once)
async function phone(who, store, o) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: (o && o.workers) || 'block' }), errors = [];
  const signIn = function (id) { who = id; return ctx.addCookies([{ name: 'fff', value: D.as(id).cookie.slice(4), url: SITE, httpOnly: true, secure: true, sameSite: 'Lax' }]); };
  if (who) await signIn(who);
  // (skew: the page's clock can be moved on, for "once a minute"; the first page of the phone gets what it kept before)
  await ctx.addInitScript(function (kept) {
    const real = Date.now.bind(Date); window.__skew = 0; Date.now = function () { return real() + window.__skew; };
    if (kept && !sessionStorage.getItem('fff.test.kept')) { try { if (!localStorage.getItem('fff.test.kept')) { localStorage.setItem('fff.test.kept', '1'); Object.keys(kept).forEach(function (k) { localStorage.setItem(k, kept[k]); }); } } catch (e) { /* not this origin's page */ } }
  }, store || null);
  await ctx.route('**/*', async function (route) {
    const q = route.request(), u = new URL(q.url());
    if (u.origin === STRIPE) {   // Stripe's checkout page: she pays, and is sent back to where the checkout said
      const sid = 'cs_test_' + u.pathname.split('/').pop(); W.sessions[sid].payment_status = 'paid'; net.log.push({ m: 'GET', p: 'stripe:' + sid, q: '', who: who || '' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(W.sessions[sid].success.replace('{CHECKOUT_SESSION_ID}', sid).replace('https://freefallfrank.com', SITE)) + ')</script>' });   // (the game's own address, which here is the test's)
    }
    if (u.origin !== SITE) return route.abort();
    const h = Object.assign({}, await q.allHeaders(), { host: 'freefallfrank.com' }), jar = (await ctx.cookies(SITE)).map(function (c) { return c.name + '=' + c.value; }).join('; ');
    if (jar) h.cookie = jar; else delete h.cookie;
    const hit = net.only.test(u.pathname);
    let mode = hit ? net.mode : 'ok'; if (hit && net.fail > 0) { net.fail--; mode = '503'; }
    net.log.push({ m: q.method(), p: u.pathname, q: u.search, key: h['idempotency-key'] || '', as: h['x-as'] || '', mode: mode, who: who || '' });
    if (net.slow && net.slow.test(u.pathname)) await sleep(net.slowMs || 2500);
    if (mode === '503') return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503 Service Unavailable</h1>' });
    if (mode === '503j') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"starting"}' });
    if (mode === 'abort') return route.abort('connectionrefused');
    const r = await serve(q.method(), u.pathname + u.search, q.postData(), h), heads = {};
    if (mode === 'lose') return route.abort('connectionreset');
    Object.keys(r.heads).forEach(function (k) { if (k.toLowerCase() !== 'set-cookie') heads[k] = String(r.heads[k]); });
    route.fulfill({ status: r.status, headers: heads, body: r.body }).catch(function () { /* the page went on to the next one */ });
  });
  const open = async function (url) { const page = await ctx.newPage(); page.on('pageerror', function (e) { errors.push(String(e.message || e)); }); await page.goto(SITE + url, { waitUntil: 'load' }); await ready(page); return page; };
  return { ctx: ctx, open: open, errors: errors, signIn: signIn };
}
// wait until something is true in the page, through a reload if one happens (the page is asked again and again)
async function until(page, fn, arg, ms, what) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { try { if (await page.evaluate(fn, arg)) return Date.now(); } catch (e) { /* between two pages */ } await sleep(60); }
  let at = ''; try { at = JSON.stringify(await see(page)); } catch (e) { at = String(e.message); }
  throw new Error('waited ' + (ms || 8000) + ' ms for: ' + (what || fn) + '\n  the page: ' + at);
}
const ready = function (page) { return until(page, function () { return !!(window.FFF && window.FFFAccount && window.FFFAccount.me.ready); }, null, 15000, 'the game and who is playing'); };
const see = function (page) {
  return page.evaluate(function () {
    const el = document.getElementById('fresh'), A = window.FFFAccount, N = window.FFFNet, w = window.FFF.where();
    return { state: w.state, lv: w.lv, sel: w.sel, mark: window.__mark || 0, build: N.build, heard: N.fresh(), fresh: !!el && !el.hidden && el.getClientRects().length > 0, url: location.pathname + location.search, box: N.waiting().map(function (x) { return x.t; }).sort().join(), who: N.who(),
      user: !!A.me.user, offline: !!A.me.offline, coins: A.me.coins, wallet: A.wallet(), sheet: A.isOpen() };
  });
};
const mark = function (page) { return page.evaluate(function () { window.__mark = 1; }); };
const came = function (page) { return page.evaluate(function () { document.dispatchEvent(new Event('visibilitychange')); }); };   // he comes back to the tab
const online = function (page) { return page.evaluate(function () { window.dispatchEvent(new Event('online')); }); };
const look = function (page) { return page.evaluate(function () { return window.FFFAccount.refresh().then(function () { return true; }); }); };   // an answer from the server, as any the game gets
const heard = function (page, b) { return until(page, function (x) { return window.FFFNet.fresh() === x; }, b, 6000, 'the page to have heard of build ' + b); };
const reloaded = function (page, ms) { return until(page, function () { return !window.__mark && !!(window.FFF && window.FFFNet && window.FFFAccount && window.FFFAccount.me.ready); }, null, ms || 7000, 'the page to have reloaded itself'); };
const shows = function (page) { return until(page, function () { const el = document.getElementById('fresh'); return !el.hidden && el.getClientRects().length > 0; }, null, 3000, 'the note'); };
const stateIs = function (page, st, ms) { return until(page, function (x) { return x.split('|').indexOf(window.FFF.state()) >= 0; }, st, ms || 6000, 'the game to be ' + st); };
// no reload, for that long: the same page is there, in one of these states all the while (looked at every 100 ms)
async function stays(page, ms, states, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await see(page); assert.strictEqual(s.mark, 1, what + ': the page was reloaded under him (' + s.state + ')'); if (states) assert(states.indexOf(s.state) >= 0, what + ': he is in ' + s.state); await sleep(100); }
}
// the note: small, on the bottom edge, over no button of the screen he is on and nowhere near Frank
async function note(page, what) {
  const g = await page.evaluate(function () {
    const r = document.getElementById('fresh').getBoundingClientRect(), c = getComputedStyle(document.getElementById('fresh-go')), x = getComputedStyle(document.getElementById('fresh-no'));
    const rgb = function (s) { return s.match(/\d+/g).slice(0, 3).map(Number); };
    return { text: document.getElementById('fresh-go').textContent, top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: innerHeight, w: innerWidth, font: parseFloat(c.fontSize), ink: rgb(c.color), ink2: rgb(x.color), over: window.FFF.hits().filter(function (b) { return b.x < r.right && b.x + b.w > r.left && b.y < r.bottom && b.y + b.h > r.top; }) };
  });
  assert.strictEqual(g.text, 'NEW VERSION · RELOAD', what); assert(g.bottom <= g.h && g.top >= g.h - 34 && g.bottom - g.top <= 30 && g.font <= 12 && g.left >= 0 && g.right <= g.w, what + ': the note is one small line on the bottom edge: ' + JSON.stringify(g));
  assert(g.top > g.h * 0.9, what + ': nowhere near Frank, who falls in the top third'); assert.deepStrictEqual(g.over, [], what + ': it is over no button');
  [g.ink, g.ink2].forEach(function (c) { assert(Math.max.apply(null, c) >= 0x99, what + ': its words are never darker than #999: ' + c); });
}
// A DEPLOY: a client file changes, and the server works out which build it now is
function deploy() { fs.appendFileSync(path.join(process.env.CLIENT_DIR, 'net.js'), '\n// build ' + (++builds) + '\n'); const was = S.build(), now = S.rebuild(); assert.notStrictEqual(now, was); return now; }
const hits = function (p, since, m) { return net.log.slice(since || 0).filter(function (x) { return x.p === p && x.m === (m || 'POST'); }); };
const n = async function (sql, p) { return Number((await S.db.get(sql, p)).n); };
const coinsOf = async function (uid) { const u = await S.db.get('SELECT coins FROM users WHERE id = ?', [uid]); return u ? u.coins : null; };

(async function () {
  // the copy of the client that is served, and changed: the files a browser is given are copied, the music, the
  // landing page's pictures and the ads are only pointed at
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'fff-client-')); process.env.CLIENT_DIR = copy;
  const client = ['index.html', 'landing.html', 'admin.html', 'level.html', 'build.html', 'core.js', 'franks.js', 'music/tracks.js', 'audio.js', 'save.js', 'net.js', 'account.js', 'game.js', 'chart.min.js', 'sw.js', 'manifest.json', 'icon-180.png', 'icon-512.png', 'glyphh-logo.png', 'glyphh-spike.png', 'glyphh-logo-black.png', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-maskable-512.png']
    .concat(fs.readdirSync(path.join(ROOT, 'samples')).map(function (f) { return 'samples/' + f; }));
  ['music', 'samples'].forEach(function (d) { fs.mkdirSync(path.join(copy, d)); }); ['landing', 'marketing'].forEach(function (d) { fs.symlinkSync(path.join(ROOT, d), path.join(copy, d)); });
  fs.readdirSync(path.join(ROOT, 'music')).forEach(function (f) { if (/\.mp3$/.test(f)) fs.symlinkSync(path.join(ROOT, 'music', f), path.join(copy, 'music', f)); });
  client.forEach(function (f) { fs.copyFileSync(path.join(ROOT, f), path.join(copy, f)); });
  W = D.world(); T = await D.open('browser'); S = require('../server.js'); await S.ready;
  assert.deepStrictEqual(S.CLIENT.slice().sort(), client.slice().sort(), 'the copy is the whole client'); assert.strictEqual(S.build(), S.buildOf(ROOT), 'and is this build');
  for (const u of ['ann', 'bea', 'cy', 'dee', 'eve', 'fay']) await S.db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0)', ['google:' + u, u + '@example.com', u + ' Example', Date.now()]);
  browser = await chromium.launch();
  let p, page, s, b0, b1, n0, t0;

  // ---- a new build while he is on the main page: it reloads by itself, once it has heard; and it does not ask to find out ----
  p = await phone('google:ann'); page = await p.open('/play?mute'); b0 = S.build();
  s = await see(page); assert.deepStrictEqual([s.state, s.build, s.fresh, s.user, s.who], ['title', b0, false, true, 'google:ann'], 'the page knows the build it was loaded with');
  assert(['/net.js', '/save.js', '/account.js', '/game.js', '/core.js', '/music/tracks.js'].every(function (f) { return net.log.some(function (x) { return x.p === f && x.q === '?v=' + b0; }); }), 'and asked for its scripts by it');
  // (what the page says to a service worker that is waiting, or on its way in: take over, if you are my build)
  const offered = await page.evaluate(function () {
    const got = [], w = function (st) { const l = []; return { state: st, postMessage: function (m) { got.push(m); }, addEventListener: function (t, f) { l.push(f); }, become: function (s) { this.state = s; l.forEach(function (f) { f(); }); } }; };
    const coming = w('installing'), reg = { waiting: w('installed'), installing: coming, addEventListener: function () {} };
    window.FFFNet.worker(reg); reg.waiting = coming; coming.become('installed'); window.FFFNet.worker(undefined); return got;
  });
  assert.deepStrictEqual(offered, [{ type: 'take-over', build: b0 }, { type: 'take-over', build: b0 }], 'the page offers its build to the worker that waits, and to the one that has just come in');
  await mark(page); b1 = deploy(); n0 = net.log.length; await sleep(1600);
  assert.strictEqual((await see(page)).mark, 1); assert.strictEqual(net.log.length, n0, 'a page that asks the server nothing is told nothing (it does not poll: the machine may sleep)');
  await came(page); await sleep(700); assert.strictEqual(hits('/api/me', n0, 'GET').length, 0, 'back in the tab a moment after it last asked: it does not ask again');
  await page.evaluate(function () { window.__skew = 61000; }); t0 = Date.now(); await came(page); await reloaded(page); s = await see(page);
  assert.deepStrictEqual([s.state, s.build, s.url, s.fresh], ['title', b1, '/play?mute', false], 'back in the tab a minute later, on the main page: it asks who he is once, hears of the new build, and reloads into it, where he was'); assert(Date.now() - t0 < 6000, 'promptly');
  const upTo = net.log.slice(n0).findIndex(function (x) { return x.p === '/play'; }), before = net.log.slice(n0, n0 + upTo).map(function (x) { return x.p; });
  assert.deepStrictEqual(before, ['/api/me', '/healthz'], 'one question to find out, and one to see that the server is there before it reloads: ' + before.join(' '));
  assert(net.log.some(function (x) { return x.p === '/game.js' && x.q === '?v=' + b1; }), 'the new page asks for the new build\'s scripts'); assert.strictEqual(hits('/api/track', n0).filter(function (x) { return x.mode === 'ok'; }).length, 0, 'and the reload is not counted as another visit');
  console.log('OK reload, the main page: a new build (' + b0 + ' -> ' + b1 + ') reloads the page by itself when it hears of it; it asks nothing to find out, but once a minute when he comes back to the tab; it sees that the server is there first');

  // ---- in a fall: never, and nothing on the screen; paused: the small note, and still not until he is out of the fall ----
  await page.keyboard.press('Enter'); await stateIs(page, 'play'); await mark(page); b0 = b1; b1 = deploy(); n0 = net.log.length;
  await until(page, function () { return window.FFF.state() === 'dead'; }, null, 12000, 'Frank to fall into something (nobody is tapping)');
  await heard(page, b1);   // (the fall's own report to the server is answered, and the answer says the build)
  t0 = Date.now(); let falls = 0, shown = 0;
  while (Date.now() - t0 < 6000) { s = await see(page); assert.strictEqual(s.mark, 1, 'in a fall: the page was reloaded under him'); assert(s.state === 'play' || s.state === 'dead', 'he is falling: ' + s.state); if (s.fresh) shown++; if (s.state === 'dead') falls++; await sleep(80); }
  assert.deepStrictEqual([shown, (await see(page)).build], [0, b0], 'six seconds of falling, knowing of the new build: no reload, and nothing is put on the screen'); assert(falls >= 1 && hits('/api/score', n0).length >= 2, 'he fell, and fell again');
  for (let i = 0; i < 40 && (await see(page)).state !== 'paused'; i++) { await page.keyboard.press('Escape'); await sleep(120); }
  await shows(page); s = await see(page); assert.deepStrictEqual([s.state, s.fresh, s.mark], ['paused', true, 1], 'paused: the note'); await note(page, 'paused'); await stays(page, 2600, ['paused'], 'paused');
  await page.click('#fresh-no'); await sleep(400); s = await see(page); assert.deepStrictEqual([s.fresh, s.mark, s.state], [false, 1, 'paused'], 'the x puts the note away and reloads nothing');
  await page.keyboard.press('Escape'); await stateIs(page, 'play|dead'); await stays(page, 1500, ['play', 'dead'], 'falling again');
  await page.evaluate(function () { window.FFF.open(null); }); await reloaded(page); s = await see(page);   // (out of the fall, to the level cards)
  assert.deepStrictEqual([s.state, s.build, s.url, s.fresh, s.box], ['title', b1, '/play?mute', false, ''], 'out of the fall, on the main page: reloaded into the new build; what the falls reported has all been answered');
  assert.strictEqual(await n('SELECT COUNT(*) AS n FROM runs WHERE uid = ?', ['google:ann']), new Set(hits('/api/track', n0).filter(function (x) { return x.key; }).map(function (x) { return x.key; })).size, 'and every fall is one run');
  // RELOAD on the note: his call, wherever he is
  await page.keyboard.press('Enter'); await stateIs(page, 'play'); await mark(page); b0 = b1; b1 = deploy(); await until(page, function () { return window.FFF.state() === 'dead'; }, null, 12000, 'a fall'); await heard(page, b1);
  for (let i = 0; i < 40 && (await see(page)).state !== 'paused'; i++) { await page.keyboard.press('Escape'); await sleep(120); }
  await page.click('#fresh-go'); await reloaded(page); s = await see(page); assert.deepStrictEqual([s.state, s.build, s.url], ['title', b1, '/play?mute'], 'RELOAD, from a pause: the new build at once');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, [], 'nothing threw');
  console.log('OK reload, a fall: six seconds of falling and dying with the new build known: no reload and nothing on the screen; paused, the small note on the bottom edge (over no button, never darker than #999) and still no reload; the x hides it; out of the fall the page reloads; RELOAD does it at once');

  // ---- the win screen: no reload under it, and what the fall won waits for the server through the reload ----
  p = await phone('google:bea'); page = await p.open('/play?bot&mute&at=11'); b0 = S.build();
  await page.keyboard.press('Enter'); await stateIs(page, 'play'); await mark(page); b1 = deploy(); net.mode = '503';
  await stateIs(page, 'win', 25000); await page.evaluate(function () { window.FFFAccount.bank(5, 0); });   // (tokens, as a fall banks them at its end)
  await look(page); await heard(page, b1); await shows(page); s = await see(page); const won = s.wallet;
  assert.deepStrictEqual([s.state, s.fresh, /tokens/.test(s.box), s.coins, won >= 5], ['win', true, true, 0, true], 'he won; his tokens wait for the server, and are his already: ' + JSON.stringify(s));
  await note(page, 'the win screen'); await stays(page, 2600, ['win'], 'the win screen');
  await page.evaluate(function () { window.FFF.open(null); }); await reloaded(page); s = await see(page);
  assert.deepStrictEqual([s.state, s.build, /tokens/.test(s.box), s.wallet, await coinsOf('google:bea')], ['title', b1, true, won, 0], 'back on the main page: reloaded, and the tokens still wait, still his');
  net.mode = 'lose'; n0 = net.log.length; await online(page); for (let i = 0; i < 80 && !(await coinsOf('google:bea')); i++) await sleep(50);
  assert((await coinsOf('google:bea')) > 0, 'the server took them, and its answer was lost on the way'); await sleep(300); assert(/tokens/.test((await see(page)).box), 'so the page still holds them');
  net.mode = 'ok'; await online(page); await until(page, function () { return window.FFFNet.waiting().length === 0; }, null, 8000, 'the outbox to empty'); s = await see(page);
  assert.deepStrictEqual([await coinsOf('google:bea'), s.coins, s.wallet], [won, won, won], 'sent again and answered: banked once'); assert(hits('/api/tokens', n0).length >= 2, 'it was sent more than once');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK reload, the win: no reload on the win screen (the note, over no button); the tokens of the fall waited through a 503, the reload and a lost answer, counted as his all the while, and were banked once (' + won + ')');

  // ---- the account sheet open, typing in it, and waiting for an emailed link: not until she is done ----
  p = await phone(''); page = await p.open('/play?mute'); b0 = S.build();
  await page.evaluate(function () { window.FFFAccount.open(); }); await mark(page); b1 = deploy(); await look(page); await heard(page, b1); await shows(page);
  await stays(page, 2600, ['title'], 'the account sheet open'); await page.fill('#acct-email', 'nell@exam'); await stays(page, 2200, ['title'], 'typing her address');
  await page.click('#acct-close'); await reloaded(page); s = await see(page); assert.deepStrictEqual([s.state, s.build, s.sheet], ['title', b1, false], 'the sheet closed: reloaded');
  await page.evaluate(function () { window.FFFAccount.open(); }); await page.fill('#acct-email', 'nell@example.com'); await page.click('#acct-link-go');
  await until(page, function () { return !document.getElementById('acct-sent').hidden; }, null, 5000, 'CHECK YOUR EMAIL'); assert.strictEqual(W.mails.length, 1, 'the email was caught, not sent');
  await mark(page); b0 = b1; b1 = deploy(); await until(page, function (x) { return window.FFFNet.fresh() === x; }, b1, 9000, 'the page to hear of the build (while she waits it looks for her sign-in every four seconds)');
  await stays(page, 2600, ['title'], 'waiting for her emailed link'); await page.click('#acct-other'); await stays(page, 1800, ['title'], 'the sheet still open');
  await page.click('#acct-close'); await reloaded(page); s = await see(page); assert.deepStrictEqual([s.state, s.build], ['title', b1], 'she gives the wait up and closes the sheet: reloaded');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK reload, the sheet: nothing reloads with the account sheet open, while she types her address, or while she waits for her emailed link');

  // ---- paying: no reload on the way to Stripe; and the way back, through a server that cannot answer and a closed tab ----
  p = await phone('google:dee'); page = await p.open('/play?mute'); b0 = S.build(); await mark(page); b1 = deploy(); n0 = net.log.length;
  net.slow = /^\/api\/checkout$/; net.slowMs = 3500; net.only = /^\/api\/confirm$/; net.fail = 6;
  await page.evaluate(function () { window.FFFAccount.buyLevel('rock').catch(function () {}); }); await look(page); await heard(page, b1);
  await stays(page, 2200, ['title'], 'the checkout on its way');
  // (Stripe's page, paid, and back to /?paid=...: the server answers 503 to the first six tries to confirm it)
  await until(page, function (x) { return location.origin === x && location.pathname === '/' && !!(window.FFFNet && window.FFFAccount && window.FFFAccount.me.ready); }, SITE, 15000, 'her return from Stripe'); net.slow = null;
  await until(page, function () { return localStorage.getItem('fff.paid') === '' && !!window.FFFAccount.me.levels.rock.owned; }, null, 40000, 'the purchase to be confirmed');
  s = await see(page); const tries = hits('/api/confirm', n0, 'GET');
  assert.deepStrictEqual([s.url, s.build, s.state], ['/', b1, 'title'], 'she is back in the game, the address tidy'); assert(tries.length >= 7 && new Set(tries.map(function (x) { return x.q; })).size === 1 && /^\?session_id=cs_test_\d+$/.test(tries[0].q), 'the confirm was asked again and again for the one checkout: ' + tries.map(function (x) { return x.mode; }).join(' '));
  assert.deepStrictEqual([await n('SELECT COUNT(*) AS n FROM owned WHERE uid = ?', ['google:dee']), await n('SELECT COUNT(*) AS n FROM purchases WHERE uid = ?', ['google:dee']), await n('SELECT COALESCE(SUM(amount), 0) AS n FROM purchases WHERE uid = ?', ['google:dee']), await n('SELECT COUNT(*) AS n FROM pending WHERE uid = ?', ['google:dee'])], [1, 1, 99, 0], 'ROCK BOTTOM is hers, paid for once');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  // (and with no server at all on her return, and the tab closed: the next time the game is opened it is confirmed)
  p = await phone('google:eve'); page = await p.open('/play?mute'); n0 = net.log.length; net.only = /^\/api\/(confirm|me)$/; net.mode = 'abort';
  await page.evaluate(function () { window.FFFAccount.buy().catch(function () {}); });
  await until(page, function (x) { return location.origin === x && location.pathname === '/' && !!(window.FFFAccount && window.FFFAccount.me.ready); }, SITE, 15000, 'her return from Stripe');
  await sleep(5200); s = await page.evaluate(function () { return { paid: JSON.parse(localStorage.getItem('fff.paid')).id, packs: window.FFFAccount.me.packs.length, offline: window.FFFAccount.me.offline }; });
  assert(/^cs_test_\d+$/.test(s.paid) && s.packs === 0 && s.offline, 'the checkout is written down in her browser: ' + JSON.stringify(s)); assert.strictEqual(await n('SELECT COUNT(*) AS n FROM packs WHERE uid = ?', ['google:eve']), 0);
  await page.close(); net.mode = 'ok'; n0 = net.log.length; page = await p.open('/play?mute');
  await until(page, function () { return localStorage.getItem('fff.paid') === '' && window.FFFAccount.me.packs.length === 1; }, null, 10000, 'the pack to be confirmed');
  assert.deepStrictEqual([hits('/api/confirm', n0, 'GET').length, await n('SELECT COUNT(*) AS n FROM packs WHERE uid = ?', ['google:eve']), await n('SELECT COUNT(*) AS n FROM purchases WHERE uid = ?', ['google:eve'])], [1, 1, 1], 'opened again: confirmed, once');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []); net.only = /^\/api\/(tokens|score|track|secret|heart|profile)$/;
  console.log('OK money: no reload while the checkout is on its way; back from Stripe to a server that could not answer (' + tries.length + ' tries) the level was confirmed, once, 99 cents; with no server on her return and the tab closed, the pack was confirmed when the game was next opened');

  // ---- where he was: the card he was on, and the Frank picker ----
  p = await phone('google:ann'); page = await p.open('/play?mute'); await page.keyboard.press('ArrowRight'); await until(page, function () { return window.FFF.where().lv === 'rock'; }, null, 3000, 'the ROCK BOTTOM card');
  await mark(page); b0 = S.build(); b1 = deploy(); await look(page); await reloaded(page); s = await see(page); assert.deepStrictEqual([s.state, s.lv, s.build, s.url], ['title', 'rock', b1, '/play?mute'], 'reloaded on the main page: the card he was on');
  await page.close(); page = await p.open('/play?mute&screen=select'); await stateIs(page, 'select'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); const sel = (await see(page)).sel; assert(sel >= 2);
  await mark(page); b1 = deploy(); await look(page); await reloaded(page); s = await see(page); assert.deepStrictEqual([s.state, s.sel, s.build, s.url], ['select', sel, b1, '/play?mute&screen=select'], 'reloaded in the Frank picker: the Frank he was on');
  await page.close(); page = await p.open('/?level=rock&mute&src=insta-dec'); await mark(page); n0 = net.log.length; b1 = deploy(); await look(page); await reloaded(page); s = await see(page);
  assert.deepStrictEqual([s.url, s.lv, s.build], ['/?level=rock&mute&src=insta-dec', 'rock', b1], 'a level\'s link with an ad\'s code: the address is kept'); await sleep(400); assert.strictEqual(hits('/api/track', n0).length, 0, 'and the ad is not counted twice');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK reload, where he was: the level card he was on, the Frank he was on in the picker, and a level\'s link with its ad code are all kept (the ad\'s visit counted once)');

  // ---- THE OUTBOX: the server away (503), the page reloaded, the tab closed, the connection refused, an answer lost ----
  p = await phone(''); net.mode = '503'; n0 = net.log.length; page = await p.open('/play?mute');
  const did = await page.evaluate(function () { return localStorage.getItem('fff.did'); }), DV = 'dev:' + did; assert.strictEqual((await see(page)).who, DV, 'with no account, the device is who he is');
  await page.keyboard.press('Enter'); await stateIs(page, 'play'); await until(page, function () { return window.FFFNet.waiting().filter(function (x) { return x.t === 'run'; }).length >= 2; }, null, 20000, 'two falls');
  await page.evaluate(function () { window.FFF.open(null); window.FFFAccount.bank(7, 0); window.FFFAccount.heart('city'); }); await sleep(300);
  const kept = await page.evaluate(function () { return JSON.parse(localStorage.getItem('fff.outbox')); }), kinds = function (a, t) { return a.filter(function (x) { return x.t === t; }).length; }, falls2 = kinds(kept, 'run');
  assert(falls2 >= 2 && kinds(kept, 'score') === falls2 && kinds(kept, 'tokens') >= 1 && kinds(kept, 'heart') === 1 && kept.every(function (x) { return x.u === DV && /^[0-9a-f]{32}$/.test(x.k); }) && new Set(kept.map(function (x) { return x.k; })).size === kept.length, 'every fall\'s score and run, the tokens and the heart are in localStorage, each with its own key and whose it is: ' + JSON.stringify(kept.map(function (x) { return x.t; })));
  assert.deepStrictEqual([await n('SELECT COUNT(*) AS n FROM runs WHERE did = ?', [did]), (await see(page)).wallet >= 7], [0, true], 'nothing has reached the server; the tokens are his already');
  await page.reload({ waitUntil: 'load' }); await ready(page); await sleep(700); assert.strictEqual((await see(page)).box, kept.map(function (x) { return x.t; }).sort().join(), 'the page reloaded, the server still away: they wait');
  await page.close(); net.mode = 'abort'; page = await p.open('/play?mute'); await sleep(700); s = await see(page); assert.deepStrictEqual([s.box, s.who], [kept.map(function (x) { return x.t; }).sort().join(), DV], 'the tab closed and opened again, no connection at all for them: they wait');
  net.mode = '503j'; await online(page); await sleep(700); assert.strictEqual((await see(page)).box.split(',').length, kept.length, 'the server\'s own 503: they wait');
  net.mode = 'lose'; await online(page); for (let i = 0; i < 80 && !(await n('SELECT COUNT(*) AS n FROM scores WHERE uid = ?', [DV])); i++) await sleep(50);
  assert.strictEqual(await n('SELECT COUNT(*) AS n FROM scores WHERE uid = ?', [DV]), 1, 'the server took the first of them, and its answer was lost on the way'); await sleep(300); assert.strictEqual((await see(page)).box.split(',').length, kept.length, 'so the page still holds it');
  net.mode = 'ok'; await online(page); await until(page, function () { return window.FFFNet.waiting().length === 0; }, null, 12000, 'the outbox to empty');
  assert.deepStrictEqual([await n('SELECT COUNT(*) AS n FROM runs WHERE did = ?', [did]), await coinsOf(DV), await n('SELECT COUNT(*) AS n FROM hearts WHERE uid = ?', [DV]), await n('SELECT COUNT(*) AS n FROM idem WHERE uid = ?', [DV])], [falls2, (await see(page)).coins, 1, kept.length], 'delivered: every fall one run, the tokens banked once, the heart, and an answer kept for each');
  assert((await coinsOf(DV)) >= 7); const firstKey = kept[0].k, sent = net.log.slice(n0).filter(function (x) { return x.key === firstKey; });
  assert(sent.length >= 4 && sent.every(function (x) { return x.as === DV; }), 'every try of the first carried the one key, and whose it is (' + sent.length + ' tries: ' + sent.map(function (x) { return x.mode; }).join(' ') + ')');
  console.log('OK outbox: ' + kept.length + ' things (' + falls2 + ' falls\' scores and runs, tokens, a heart) made while the server answered 503 were kept in the browser through a reload, a closed tab, a refused connection and a lost answer, and delivered when it was back: ' + sent.length + ' tries of the first, each thing counted once');

  // ---- whose it is: nothing kept for one player is sent as another; a device's things go with it when it signs in ----
  await page.evaluate(function () { const a = JSON.parse(localStorage.getItem('fff.outbox') || '[]'); a.push({ k: 'beefbeefbeefbeefbeefbeefbeefbeef', t: 'tokens', u: 'google:zed', b: { frank: 0, count: 50 }, at: Date.now() }); localStorage.setItem('fff.outbox', JSON.stringify(a)); });
  n0 = net.log.length; await page.reload({ waitUntil: 'load' }); await ready(page); await sleep(1500);
  assert.deepStrictEqual([(await page.evaluate(function () { return window.FFFNet.waiting().map(function (x) { return x.u; }); })), hits('/api/tokens', n0).length], [['google:zed'], 0], 'what is someone else\'s stays in the browser, for them, and is never sent');
  await page.evaluate(function () { localStorage.setItem('fff.outbox', '[]'); }); await page.reload({ waitUntil: 'load' }); await ready(page);
  net.mode = '503'; await page.evaluate(function () { window.FFFAccount.bank(9, 0); }); await sleep(300); assert.deepStrictEqual(await page.evaluate(function () { return window.FFFNet.waiting().map(function (x) { return x.u; }); }), [DV]);
  await p.signIn('google:fay'); await look(page); s = await see(page);   // (she signs in on this device while its tokens are still waiting)
  assert.deepStrictEqual([s.who, await page.evaluate(function () { return window.FFFNet.waiting().map(function (x) { return x.u; }); })], ['google:fay', ['google:fay']], 'signing in takes the device\'s wallet with it, and what the device still had waiting');
  net.mode = 'ok'; await online(page); await until(page, function () { return window.FFFNet.waiting().length === 0; }, null, 8000, 'the outbox to empty'); assert.strictEqual(await coinsOf('google:fay'), 9);
  // (and someone else signs in to this browser from another tab while her tokens wait: they are not banked as his)
  net.mode = '503'; await page.evaluate(function () { window.FFFAccount.bank(4, 0); }); await sleep(300); await p.signIn('google:cy'); n0 = net.log.length; net.mode = 'ok'; await online(page);
  await until(page, function () { return window.FFFNet.who() === 'google:cy'; }, null, 8000, 'the page to learn who is signed in now'); await sleep(600);
  assert.deepStrictEqual([await coinsOf('google:cy'), await coinsOf('google:fay'), await page.evaluate(function () { return window.FFFNet.waiting().map(function (x) { return x.u + ' ' + x.b.count; }); }), hits('/api/tokens', n0).length], [0, 9, ['google:fay 4'], 1], 'sent once, refused as not his, and kept for her');
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK outbox, whose it is: another player\'s things are never sent; a device\'s waiting tokens went to the account it signed in to; tokens kept for one account were refused (409) for the one signed in after, and still wait for their own');

  // ---- who he is, and a paid level, asked again through a restart ----
  p = await phone('google:ann'); net.only = /^\/api\/me$/; net.fail = 2; n0 = net.log.length; page = await p.open('/play?mute'); s = await see(page);
  assert.deepStrictEqual([s.user, s.offline, hits('/api/me', n0, 'GET').length], [true, false, 3], 'who he is, after two 503s: asked three times, and he is signed in');
  net.only = /^\/api\/world$/; net.fail = 2; n0 = net.log.length; await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await stateIs(page, 'play|dead', 12000);
  assert.strictEqual(hits('/api/world', n0, 'GET').length, 3, 'ROCK BOTTOM\'s stretches, after two 503s: asked three times, and he is falling'); assert.strictEqual(hits('/api/world', n0, 'GET')[0].q, '?id=rock&v=1');
  await page.evaluate(function () { window.FFF.open(null); }); net.fail = 9; n0 = net.log.length; await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await sleep(6000);
  assert.deepStrictEqual([(await see(page)).state, hits('/api/world', n0, 'GET').length], ['title', 4], 'the server gone for good: four tries, and he is told, on the main page'); net.fail = 0; net.only = /^\/api\/(tokens|score|track|secret|heart|profile)$/;
  await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK reads: who he is and a paid level\'s stretches are asked again through two 503s; after four the game says so and stays where it was');

  // ---- what the browser keeps, in every shape it has had: the game opens on each, and loses nothing ----
  const dir = path.join(__dirname, 'fixtures', 'saves'), shapes = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort();
  for (const f of shapes) {
    const x = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), store = Object.assign({}, x.store), say = function (m) { return f + ': ' + m; };
    if (store['fff.outbox']) store['fff.outbox'] = store['fff.outbox'].replace(/"at":\d+/g, '"at":' + Date.now());   // (what waits is kept 30 days: these wait since now)
    p = await phone('', store); page = await p.open('/play?mute'); await until(page, function () { return window.FFFNet.waiting().length === 0 && window.FFFAccount.me.ready && !window.FFFAccount.me.offline; }, null, 8000, say('the game, and its outbox empty'));
    s = await page.evaluate(function () { const o = {}; for (let i = 0; i < localStorage.length; i++) o[localStorage.key(i)] = localStorage.getItem(localStorage.key(i)); return { store: o, state: window.FFF.state(), wallet: window.FFFAccount.wallet(), who: window.FFFNet.who() }; });
    assert.deepStrictEqual(p.errors, [], say('nothing threw')); assert.strictEqual(s.state, 'title', say('the game is open')); assert.strictEqual(s.store['fff.v'], String(x.want.v), say('the version'));
    Object.keys(x.store).forEach(function (k) { if (['fff.v', 'fff.tokens', 'fff.outbox', 'fff.uid', 'fff.frank', 'fff.heart.city', 'fff.heart.rock'].indexOf(k) < 0) assert.strictEqual(s.store[k], x.store[k], say(k + ' is as it was kept')); });
    x.want.bad.forEach(function (k) { assert.strictEqual(s.store['fff.bad.' + k.replace(/^fff\./, '')], x.store[k], say(k + ' is set aside whole')); });
    const dev = 'dev:' + (x.store['fff.did'] || '');
    if (f === 'v1-today.json') assert.deepStrictEqual([await coinsOf(dev), s.store['fff.tokens'], s.wallet], [37, '0', 37], say('the 37 tokens an earlier build kept back are banked, once'));
    if (f === 'v2.json') assert.deepStrictEqual([await coinsOf(dev), await n('SELECT COUNT(*) AS n FROM hearts WHERE uid = ?', [dev]), s.store['fff.outbox'], s.who], [12, 1, '[]', dev], say('what waited in its outbox is delivered'));
    await p.ctx.close();
  }
  console.log('OK saves: the game opens on all ' + shapes.length + ' kept shapes with nothing thrown and nothing lost; what cannot be read is set aside whole; tokens an earlier build kept back, and an outbox left waiting, are delivered once');

  // ---- the service worker, in the browser: its cache follows the build, and it never changes the files under a fall ----
  const worker = function (pg) { return pg.evaluate(async function () { const reg = await navigator.serviceWorker.getRegistration(), names = (await caches.keys()).sort(), kept = []; for (const k of names) for (const q of await (await caches.open(k)).keys()) kept.push(k + ' ' + new URL(q.url).pathname + new URL(q.url).search); return { waiting: !!(reg && reg.waiting), controlled: !!navigator.serviceWorker.controller, caches: names, kept: kept }; }); };
  const settled = function (pg, names, what) { return until(pg, async function (x) { const reg = await navigator.serviceWorker.getRegistration(); return !!navigator.serviceWorker.controller && !!reg && !reg.waiting && !reg.installing && (await caches.keys()).sort().join() === x; }, names.join(), 12000, what); };
  p = await phone('', null, { workers: 'allow' }); net.mode = 'ok'; page = await p.open('/play?mute'); b0 = S.build(); await settled(page, ['fff-' + b0], 'the worker to be in charge, with its cache'); s = await worker(page);
  assert(s.kept.indexOf('fff-' + b0 + ' /play') >= 0 && ['core.js', 'franks.js', 'music/tracks.js', 'audio.js', 'save.js', 'net.js', 'account.js', 'game.js'].every(function (f) { return s.kept.indexOf('fff-' + b0 + ' /' + f + '?v=' + b0) >= 0; }), 'the page and each of its scripts, by the build: ' + s.kept.join(', '));
  assert(s.kept.every(function (k) { return !/worlds|\/api\/| \/$/.test(k); }), 'and never "/", the API or the paid level\'s file');
  // A deploy. (The browser's own look for a new sw.js cannot be routed into the server from here, so in this test the
  // worker of the build before stays in charge: the waiting and the taking over of a new one are run in test/safe.cjs.)
  // The page reloads into the new build, from the network, through the old worker, which keeps nothing of it.
  await mark(page); b1 = deploy(); await look(page); await reloaded(page); await sleep(900); s = await see(page); assert.deepStrictEqual([s.build, s.state], [b1, 'title'], 'the new build\'s page, through the worker of the build before');
  s = await worker(page); assert.deepStrictEqual(s.caches, ['fff-' + b0]); assert(s.kept.every(function (k) { return k.indexOf(b1) < 0; }) && s.kept.indexOf('fff-' + b0 + ' /game.js?v=' + b0) >= 0, 'its cache still holds its own build, and nothing of the new one: ' + s.kept.filter(function (k) { return k.indexOf(b1) >= 0; }).join(', '));
  // no network at all: what comes out of the cache is one build, whole (its page, with the scripts that page was made for), and the first level plays
  net.only = /./; net.mode = 'abort'; await page.reload({ waitUntil: 'load' }); await ready(page); s = await see(page); assert.deepStrictEqual([s.build, s.state, s.offline], [b0, 'title', true], 'offline: the game opens, as the one build the worker kept');
  await page.keyboard.press('Enter'); await stateIs(page, 'play', 8000); await page.evaluate(function () { window.FFF.open(null); }); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await sleep(5500);
  assert.strictEqual((await see(page)).state, 'title', 'ROCK BOTTOM is not kept in the browser: with no server it cannot be loaded'); assert.strictEqual(await page.evaluate(function () { return fetch('/worlds.js').then(function (r) { return r.status; }, function () { return 'no answer'; }); }), 'no answer');
  // the server restarting (503 to everything): the page still opens, from the cache
  net.mode = '503'; await page.reload({ waitUntil: 'load' }); await ready(page); s = await see(page); assert.deepStrictEqual([s.build, s.state], [b0, 'title'], 'the server restarting: the kept game, not an error page');
  net.mode = 'ok'; net.only = /^\/api\/(tokens|score|track|secret|heart|profile)$/; await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
  console.log('OK worker, in the browser: its cache is named by the build and holds the page and its scripts by that build; after a deploy it passes the new build through and keeps none of it; offline and through a 503 the game opens as one whole build and the first level plays; the paid level is not there to load');

  // ---- the page of the release that is live, against this server: it goes on working, through the deploy ----
  const PREV = process.env.FFF_PREV_CLIENT || path.join(__dirname, 'fixtures', 'deployed');
  if (!fs.existsSync(path.join(PREV, 'index.html'))) console.log('   (the client of the release that is live is not kept yet in test/fixtures/deployed: ./deploy.sh keeps it after each deploy. Until then no page of the release before is played here against this server.)');
  else {
    const mine = {}; client.forEach(function (f) { mine[f] = fs.readFileSync(path.join(copy, f)); if (fs.existsSync(path.join(PREV, f))) fs.copyFileSync(path.join(PREV, f), path.join(copy, f)); });
    const bOld = S.rebuild(); p = await phone(''); n0 = net.log.length; net.mode = 'ok'; page = await p.open('/play?mute');
    const old = await page.evaluate(function () { return { did: localStorage.getItem('fff.did'), net: !!window.FFFNet, state: window.FFF.state() }; }); assert.strictEqual(old.state, 'title');
    await page.keyboard.press('Enter'); await until(page, function () { return window.FFF.state() === 'dead'; }, null, 12000, 'a fall on the old page'); await page.evaluate(function () { window.FFFAccount.bank(3, 0); });
    // THE DEPLOY: this build's client is now what the server serves; the old page is still open, and still falling
    client.forEach(function (f) { fs.writeFileSync(path.join(copy, f), mine[f]); }); const bNew = S.rebuild(); assert.notStrictEqual(bNew, bOld);
    const fallsOld = hits('/api/score', n0).length; await until(page, function () { return true; }, null, 100); for (let i = 0; i < 200 && hits('/api/score', n0).length < fallsOld + 2; i++) await sleep(100);
    assert(hits('/api/score', n0).length >= fallsOld + 2, 'the old page goes on falling and reporting after the deploy'); await page.evaluate(function () { window.FFFAccount.bank(4, 0); window.FFF.open(null); }); await sleep(500);
    // a paid level on the old page: this server's stretches, built by the old page's own builder
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await until(page, function () { return window.FFF.state() === 'play' || window.FFF.state() === 'dead'; }, null, 10000, 'ROCK BOTTOM\'s taste on the old page');
    assert.strictEqual(await page.evaluate(function () { return window.FFF.level().sections[1].key; }), 'jaws'); await page.evaluate(function () { window.FFF.open(null); }); await sleep(400);
    const dvOld = 'dev:' + old.did, runsOld = net.log.slice(n0).filter(function (x) { return x.p === '/api/track' && x.m === 'POST'; }).length;
    assert.deepStrictEqual(p.errors, [], 'nothing threw on the old page'); assert.strictEqual(await coinsOf(dvOld), 7, 'its tokens were banked, before the deploy and after'); assert(await n('SELECT COUNT(*) AS n FROM runs WHERE did = ?', [old.did]) >= 3 && runsOld >= 4, 'and its falls counted');
    await page.reload({ waitUntil: 'load' }); await ready(page); s = await see(page); assert.deepStrictEqual([s.build, s.state, s.who, s.coins, await page.evaluate(function () { return localStorage.getItem('fff.v'); })], [bNew, 'title', dvOld, 7, '2'], 'opened again, it is this build, with his wallet');
    await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
    // and under its own service worker: the old page with the old worker, through the deploy, to this build's page
    client.forEach(function (f) { if (fs.existsSync(path.join(PREV, f))) fs.copyFileSync(path.join(PREV, f), path.join(copy, f)); }); S.rebuild();
    p = await phone('', null, { workers: 'allow' }); page = await p.open('/play?mute'); await until(page, async function () { return !!navigator.serviceWorker.controller && (await caches.keys()).length === 1; }, null, 12000, 'the old worker in charge');
    await page.keyboard.press('Enter'); await until(page, function () { return window.FFF.state() === 'dead'; }, null, 12000, 'a fall on the old page');
    client.forEach(function (f) { fs.writeFileSync(path.join(copy, f), mine[f]); }); assert.strictEqual(S.rebuild(), bNew); await sleep(2500); assert(/^(play|dead)$/.test(await page.evaluate(function () { return window.FFF.state(); })), 'the old page falls on');
    await page.reload({ waitUntil: 'load' }); await ready(page); s = await see(page); assert.deepStrictEqual([s.build, s.state], [bNew, 'title'], 'opened again under the old worker, it is this build\'s page (the worker asks the network first)');
    await p.ctx.close(); assert.deepStrictEqual(p.errors, []);
    console.log('OK the release before: its page (' + (old.net ? 'which knows of builds' : 'from before there were builds') + ') fell, reported and banked against this server before and after the deploy, played ROCK BOTTOM\'s taste from this server\'s stretches with its own builder, and became this build when it was opened again');
  }

  assert.strictEqual(W.mails.length, 1); await browser.close();
  console.log('OK browser (' + builds + ' deploys)');
  await T.done(); process.exit(0);
})().catch(function (e) { console.error(e); Promise.resolve(browser && browser.close()).catch(function () {}).then(function () { return T && T.done(); }).catch(function () {}).then(function () { process.exit(1); }); });
