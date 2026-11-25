// node test/safe.cjs : SAFE BUILDS (server.js), the server's side, the save and the service worker: no network, no
// port, a throwaway database (SQLite, or a schema of its own in the Postgres named by TEST_DATABASE_URL).
//   the build id (the same until a client file changes, in /api/me, on every answer), pages that name their scripts by
//   it, how long each may be kept, the worker sent with it, and that the paid level's file cannot be fetched; /healthz;
//   Idempotency-Key on tokens, a secret, a score, a run, a heart and the profile, and whose they are (X-As);
//   a purchase through a restart between paying and returning, and one whose return never came; a made level's
//   version; what the browser keeps, in every shape it has had (test/fixtures/saves); the service worker, run here
//   against a stand-in for the browser's caches; node server.js --check, in this process and as the command a deploy
//   runs (with test/noport.cjs loaded first).
'use strict';
const assert = require('assert'), os = require('os'), fs = require('fs'), path = require('path'), cp = require('child_process'), vm = require('vm');
const ROOT = path.join(__dirname, '..'), D = require('./db.cjs'), C = require('../core.js');
process.env.SESSION_SECRET = 'test-secret'; process.env.ADMIN_PASSWORD = 'open-sesame'; process.env.STRIPE_SECRET_KEY = 'sk_test_fake'; process.env.GOOGLE_CLIENT_ID = 'test-client';
['APPLE_SERVICE_ID', 'ADMIN_EMAILS', 'ADMIN_MCP_KEY', 'PUBLIC_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'CLIENT_DIR', 'FLY_APP_NAME'].forEach(function (k) { delete process.env[k]; });
const TABLES = ['users', 'unlocks', 'pending', 'packs', 'owned', 'secrets', 'purchases', 'devices', 'runs', 'levels', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'ads', 'profiles', 'franks', 'scores', 'hearts', 'campaigns', 'email_links', 'idem'];
const sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
const DESIGN = { name: 'Safe Alley', author: 'Tester', world: 4, sections: [{ kind: 'patterns', beats: 16, speed: 8, pattern: 'LLRR' }, { kind: 'drop' }, { kind: 'gates', beats: 24, taps: [1, 2] }] };
let S, T, call;
(async function () {
  const W = D.world();
  T = await D.open('safe'); S = require('../server.js'); call = D.caller(S);
  await S.ready;
  const n = async function (sql, p) { return Number((await S.db.get(sql, p)).n); }, coins = async function (uid) { const u = await S.db.get('SELECT coins FROM users WHERE id = ?', [uid]); return u ? u.coins : null; };
  const ann = D.as('google:ann'), bea = D.as('google:bea'), cy = D.as('google:cy');
  for (const u of ['ann', 'bea', 'cy']) await S.db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0)', ['google:' + u, u + '@example.com', u + ' Example', Date.now()]);
  const all = async function () { const o = {}; for (const t of TABLES) o[t] = JSON.stringify(await S.db.all('SELECT * FROM ' + t + ' ORDER BY 1, 2')); return o; };
  // two notes from long ago, there before the first thing that comes with a key (which sweeps)
  await S.db.run('INSERT INTO idem (uid, ikey, at, code, answer) VALUES (?, ?, ?, ?, ?)', ['google:ann', 'a-key-from-40-days-ago', Date.now() - 40 * 864e5, 200, '{}']);
  await S.db.run('INSERT INTO idem (uid, ikey, at, code, answer) VALUES (?, ?, ?, ?, ?)', ['google:ann', 'a-key-from-20-days-ago', Date.now() - 20 * 864e5, 200, '{}']);
  let r;

  // ---- the build id ----
  const B = S.build(); assert(/^[0-9a-f]{10}$/.test(B), 'ten letters of a hash'); assert.strictEqual(S.buildOf(ROOT), B, 'the same files, the same id');
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'fff-build-')); S.CLIENT.forEach(function (f) { fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(copy, f)); });
  assert.strictEqual(S.buildOf(copy), B, 'a copy of the client is the same build');
  for (const f of S.CLIENT) { const was = fs.readFileSync(path.join(copy, f)); fs.appendFileSync(path.join(copy, f), '\n'); assert.notStrictEqual(S.buildOf(copy), B, 'a change to ' + f + ' is another build'); fs.writeFileSync(path.join(copy, f), was); }
  // the logo on the billboard (game.js draws the file, never the word): part of the build, shipped, kept offline, served as a picture, and asked for by the game
  { const LOGO = 'glyphh-logo-black.png', png = fs.readFileSync(path.join(ROOT, LOGO)), got = await call('GET', '/' + LOGO);
    assert(S.CLIENT.indexOf(LOGO) >= 0 && S.ROUTES.indexOf('GET /' + LOGO) >= 0, LOGO + ' is a client file with a route'); assert.strictEqual(png.slice(1, 4).toString(), 'PNG'); assert.strictEqual(png.readUInt32BE(16) + 'x' + png.readUInt32BE(20), '650x215', 'the logo file with the cat, as glyphh.ai has it');
    assert.deepStrictEqual([got.status, got.heads['content-type'], got.heads['x-build']], [200, 'image/png', B], LOGO + ' is served');
    assert(new RegExp("'" + LOGO + "'").test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')) && fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8').indexOf(LOGO) > 0, 'the worker keeps it and the game draws it');
    assert(!/fillText\([^)]*GLYPHH|text\('GLYPHH/i.test(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8')), 'the game never types the wordmark'); }
  // THE ICONS: each answers as a picture of its size, the manifest names only files that are there, the two a browser
  // asks for unprompted may be kept a day, and every kind of page the server sends declares them in its head
  { const ICONS = { 'favicon.ico': ['image/x-icon', 0], 'favicon-16.png': ['image/png', 16], 'favicon-32.png': ['image/png', 32], 'apple-touch-icon.png': ['image/png', 180], 'icon-180.png': ['image/png', 180], 'icon-192.png': ['image/png', 192], 'icon-512.png': ['image/png', 512], 'icon-maskable-512.png': ['image/png', 512] };
    for (const f of Object.keys(ICONS)) {
      const got = await call('GET', '/' + f), buf = fs.readFileSync(path.join(ROOT, f));
      assert.deepStrictEqual([got.status, got.heads['content-type']], [200, ICONS[f][0]], f + ' is served as what it is'); assert(S.CLIENT.indexOf(f) >= 0 && S.ROUTES.indexOf('GET /' + f) >= 0, f + ' is part of the build, with a route');
      if (ICONS[f][1]) assert.deepStrictEqual([buf.slice(1, 4).toString(), buf.readUInt32BE(16), buf.readUInt32BE(20)], ['PNG', ICONS[f][1], ICONS[f][1]], f + ' is a PNG of ' + ICONS[f][1] + ' px');
      else assert.deepStrictEqual([buf.readUInt16LE(0), buf.readUInt16LE(2), buf.readUInt16LE(4), buf[6], buf[22], buf[38]], [0, 1, 3, 16, 32, 48], 'favicon.ico holds 16, 32 and 48 px');
      assert.strictEqual(got.heads['cache-control'], f === 'favicon.ico' || f === 'apple-touch-icon.png' ? 'public, max-age=86400' : 'no-cache', f + ': how long it may be kept');
    }
    const man = JSON.parse((await call('GET', '/manifest.json')).text);
    assert.deepStrictEqual([man.name, man.short_name, man.start_url, man.display, man.theme_color], ['Free Fall Frank', 'Frank', 'play', 'fullscreen', '#15131f'], 'the manifest is what it was'); assert.deepStrictEqual(man.icons.map(function (i) { return i.src; }).sort(), Object.keys(ICONS).sort(), 'and names every icon');
    man.icons.forEach(function (i) { assert(fs.existsSync(path.join(ROOT, i.src)) && /^\d+x\d+( \d+x\d+)*$/.test(i.sizes), 'the manifest\'s ' + i.src + ' is there'); }); assert(man.icons.some(function (i) { return i.purpose === 'maskable' && i.sizes === '512x512'; }) && man.icons.some(function (i) { return i.sizes === '192x192'; }), 'a maskable 512 and a 192');
    const declares = function (html, what) {
      [/<link rel="icon" href="\/?favicon\.ico" sizes="any">/, /<link rel="icon" type="image\/png" sizes="32x32" href="\/?favicon-32\.png">/, /<link rel="apple-touch-icon" href="\/?apple-touch-icon\.png">/, /<link rel="manifest" href="\/?manifest\.json">/, /<meta name="theme-color" content="#15131f">/].forEach(function (re) { assert(re.test(html), what + ' declares ' + re.source); });
    };
    for (const u of ['/', '/play', '/play?level=rock', '/about', '/level', '/build', '/admin']) declares((await call('GET', u)).text, u);
    declares((await call('GET', '/', null, { cookie: 'played=1' })).text, '/ for a player');
    declares((await call('GET', '/auth/link?token=nothing')).text, 'the emailed link\'s page'); declares(fs.readFileSync(path.join(ROOT, 'oauth.js'), 'utf8').split('const PAGE = ')[1].slice(0, 900), 'the sign-in and consent pages (oauth.js PAGE, the one head they and the emailed link\'s page share)');
    const dock = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8'), swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    Object.keys(ICONS).forEach(function (f) { assert(dock.indexOf(' ' + f + ' ') > 0, 'the image ships ' + f); if (!/^icon-(180|512)/.test(f) || true) assert(swText.indexOf("'" + f + "'") > 0, 'the worker keeps ' + f); }); }
  assert.strictEqual(S.buildOf(copy), B, 'and changed back, the same again'); ['server.js', 'worlds.js', 'levels.js'].forEach(function (f) { fs.writeFileSync(path.join(copy, f), 'x'); }); assert.strictEqual(S.buildOf(copy), B, 'the server\'s own files are not the client');
  // every script any page asks for is part of the id, and everything in the id is in the image that is deployed
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').split('\n').filter(function (l) { return /^COPY /.test(l); }).join(' ') + ' ';
  S.CLIENT.forEach(function (f) { assert(docker.indexOf(' ' + f + ' ') >= 0 || (f.indexOf('/') > 0 && docker.indexOf(' ' + f.split('/')[0] + ' ./' + f.split('/')[0] + ' ') >= 0), 'the Dockerfile ships ' + f); });
  S.PAGES.forEach(function (f) { Array.from(fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/<script src="([^"]+)"/g)).forEach(function (m) { assert(S.SCRIPTS.indexOf(m[1].replace(/^\//, '')) >= 0, f + ' asks for ' + m[1] + ', which the build id must cover (server.js SCRIPTS)'); }); });
  assert.deepStrictEqual(Array.from(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/<script src="([^"]+)"/g), function (m) { return m[1]; }), ['core.js', 'franks.js', 'music/tracks.js', 'audio.js', 'save.js', 'net.js', 'account.js', 'game.js'], 'the game\'s scripts, in the order they need each other');
  r = await call('GET', '/api/me', null, D.dev('build')); assert.strictEqual(r.json.build, B, '/api/me says the build');
  for (const x of [['GET', '/api/me'], ['GET', '/api/world?id=rock'], ['GET', '/api/board?level=city'], ['GET', '/api/levels'], ['GET', '/api/nothing'], ['POST', '/api/tokens'], ['POST', '/api/score'], ['POST', '/api/track'], ['GET', '/healthz'], ['POST', '/mcp'], ['GET', '/.well-known/oauth-authorization-server'],
    ['GET', '/auth/link'], ['GET', '/play'], ['GET', '/game.js'], ['GET', '/sw.js'], ['GET', '/samples/kick.wav'], ['GET', '/nothing'], ['GET', '/worlds.js']]) {
    r = await call(x[0], x[1], x[0] === 'POST' ? {} : null); assert.strictEqual(r.heads['x-build'], B, x.join(' ') + ' says the build in X-Build');
  }
  assert.strictEqual((await call('GET', '/music/0.mp3', null, { range: 'bytes=0-99' })).heads['x-build'], B, 'a piece of a file too'); assert.strictEqual((await call('GET', '/play', null, { host: 'www.freefallfrank.com' })).heads['x-build'], B);
  // every page: asked for afresh each time, told its build, and asking for each script by it
  const played = { cookie: 'played=1' };
  for (const u of ['/play', '/play?level=rock', '/index.html', '/', '/about', '/level', '/build', '/admin']) {
    r = await call('GET', u, null, u === '/' ? played : null); const srcs = Array.from(r.text.matchAll(/<script src="([^"]+)"/g), function (m) { return m[1]; }).filter(function (s) { return !/^https:/.test(s); });
    assert.strictEqual(r.status, 200, u); assert.strictEqual(r.heads['cache-control'], u === '/admin' ? 'no-store' : 'no-cache', u + ' is asked for afresh'); assert(r.text.indexOf('<head>\n<script>window.FFF_BUILD = "' + B + '";</script>') > 0, u + ' is told its build');
    assert(srcs.every(function (s) { return new RegExp('^/?[\\w./-]+\\.js\\?v=' + B + '$').test(s); }) && (srcs.length >= 1 || u === '/build'), u + ' asks for every script by the build: ' + srcs.join(' '));
    for (const s of srcs) { const a = await call('GET', '/' + s.replace(/^\//, '')); assert.deepStrictEqual([a.status, a.heads['cache-control']], [200, 'public, max-age=31536000, immutable'], s + ' may be kept for a year'); }
    if (/^\/(play|index|$)/.test(u)) assert(/id="game"/.test(r.text) && /played=1/.test(String(r.heads['set-cookie'])), u + ' is the game');
  }
  r = await call('GET', '/'); assert(/id="pricing"/.test(r.text) && r.heads['cache-control'] === 'no-cache' && r.heads.vary === 'Cookie' && /franks\.js\?v=/.test(r.text), 'the landing page too');
  for (const f of S.SCRIPTS) {
    const now = await call('GET', '/' + f + '?v=' + B), bare = await call('GET', '/' + f), old = await call('GET', '/' + f + '?v=0123456789'), file = fs.readFileSync(path.join(ROOT, f));
    assert.deepStrictEqual([now.heads['cache-control'], bare.heads['cache-control'], old.heads['cache-control']], ['public, max-age=31536000, immutable', 'no-cache', 'no-store'], f + ': kept by this build\'s address, checked with none, never kept under another build\'s');
    assert(now.body.equals(file) && bare.body.equals(file) && old.body.equals(file), f + ' is the file either way');
  }
  // the worker: sent with the build written in, never kept; and what is not a script is not kept for a year whatever is asked
  r = await call('GET', '/sw.js'); assert.deepStrictEqual([r.status, r.heads['cache-control'], /javascript/.test(r.heads['content-type'])], [200, 'no-cache', true]);
  assert(r.text.indexOf("const BUILD = '" + B + "', CACHE = 'fff-' + BUILD") > 0 && !/__BUILD__/.test(r.text), 'the worker\'s cache is named by the build, by the server'); assert(/__BUILD__/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')), 'nobody writes a cache name into sw.js by hand');
  for (const u of ['/manifest.json?v=' + B, '/icon-180.png?v=' + B, '/samples/kick.wav?v=' + B, '/sw.js?v=' + B]) assert.strictEqual((await call('GET', u)).heads['cache-control'], 'no-cache', u);
  // the paid level's stretches are not a file anyone can fetch, by any name; nor is anything else of the server's
  for (const u of ['/worlds.js', '/worlds.js?v=' + B, '/worlds.js?id=rock', '/./worlds.js', '/test/fixtures/worlds/rock-full.json', '/server.js', '/levels.js', '/oauth.js', '/deploy.sh', '/fly.toml', '/package.json', '/deployed.txt']) assert.strictEqual((await call('GET', u)).status, 404, u + ' is not served');
  assert(!/worlds\.js/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\/\/.*$/gm, '')) && S.CLIENT.indexOf('worlds.js') < 0, 'and neither the worker nor the build id knows it');
  console.log('OK build: ' + B + ', the same until a client file changes (' + S.CLIENT.length + ' files), in /api/me and X-Build on every answer; pages no-cache and told their build; scripts by ?v= (a year), bare (no-cache), another build\'s (no-store); the worker named by it; worlds.js is not served');

  // ---- /healthz: 200 only when the database answers ----
  r = await call('GET', '/healthz'); assert.deepStrictEqual([r.status, r.json], [200, { ok: true, build: B }]);
  const get = S.db.get, said = console.error; S.db.get = function () { return Promise.reject(new Error('connection refused')); }; console.error = function () {};
  r = await call('GET', '/healthz'); S.db.get = get; console.error = said;
  assert.deepStrictEqual([r.status, r.json.ok], [503, false], 'the database gone is a 503'); assert.strictEqual((await call('GET', '/healthz')).status, 200);
  console.log('OK healthz: 200 with the build when the database answers, 503 when it does not');

  // ---- Idempotency-Key: what the outbox sends twice is counted once, and gets the first answer ----
  const key = function (k, who, as) { return Object.assign({ 'idempotency-key': k }, who, as ? { 'x-as': as } : {}); }, dv = D.dev('once'), DV = 'dev:device-once-0000';
  // tokens
  const first = await call('POST', '/api/tokens', { frank: 0, count: 10 }, key('tok-key-0001', dv, DV));
  assert.deepStrictEqual([first.status, first.json, first.heads['idempotent-replay']], [200, { coins: 10 }, undefined]);
  await call('POST', '/api/tokens', { frank: 0, count: 5 }, key('tok-key-0002', dv, DV));
  r = await call('POST', '/api/tokens', { frank: 0, count: 10 }, key('tok-key-0001', dv, DV));
  assert.deepStrictEqual([r.status, r.json, r.heads['idempotent-replay']], [200, { coins: 10 }, 'true'], 'the repeat gets the first answer (10, as it was then)'); assert.strictEqual(await coins(DV), 15, 'and is banked once');
  r = await Promise.all([1, 2, 3].map(function () { return call('POST', '/api/tokens', { frank: 0, count: 7 }, key('tok-together-1', dv, DV)); }));
  assert(r.every(function (x) { return x.status === 200 && x.json.coins === 22; }), JSON.stringify(r.map(function (x) { return x.json; }))); assert.strictEqual(await coins(DV), 22, 'three that arrive together are banked once');
  await call('POST', '/api/tokens', { frank: 0, count: 1 }, key('tok-key-0003', dv, DV)); assert.strictEqual(await coins(DV), 23, 'another key is another fall');
  r = await call('POST', '/api/tokens', { frank: 0, count: 4 }, key('tok-key-0001', D.dev('other'), 'dev:device-other-0000')); assert.deepStrictEqual([r.json, r.heads['idempotent-replay']], [{ coins: 4 }, undefined], 'a key is one player\'s: the same one from someone else is theirs');
  await call('POST', '/api/tokens', { frank: 0, count: 2 }, dv); await call('POST', '/api/tokens', { frank: 0, count: 2 }, dv); await call('POST', '/api/tokens', { frank: 0, count: 2 }, key('short', dv));
  assert.strictEqual(await coins(DV), 29, 'with no key (the page of the release before), or one that is not a key, each is banked as it always was');
  // the tokens and their note are one thing: if either cannot be written, neither is (a machine stopped in between has done nothing)
  await assert.rejects(S.db.tx([['UPDATE users SET coins = coins + 1000 WHERE id = ?', [DV]], ['INSERT INTO idem (uid, ikey, at, code, answer) VALUES (?, ?, ?, ?, ?)', [DV, 'tok-key-0001', 1, 200, '{}']]])); assert.strictEqual(await coins(DV), 29, 'all of it, or none');
  await S.db.tx([['UPDATE users SET coins = coins + 1 WHERE id = ?', [DV]], ['UPDATE users SET coins = coins - 1 WHERE id = ?', [DV]]]); assert.strictEqual(await coins(DV), 29);
  // a refusal is an answer too; one that says come back is not
  r = await call('POST', '/api/tokens', { frank: 999, count: 1 }, key('tok-refused-1', dv, DV)); const again = await call('POST', '/api/tokens', { frank: 999, count: 1 }, key('tok-refused-1', dv, DV));
  assert.deepStrictEqual([r.status, r.json.error, again.status, again.json.error, again.heads['idempotent-replay']], [400, 'bad tokens', 400, 'bad tokens', 'true']);
  // whose it is: what was kept for one player is never banked as another
  r = await call('POST', '/api/tokens', { frank: 0, count: 9 }, key('tok-not-mine-1', dv, 'google:ann')); assert.deepStrictEqual([r.status, r.json.id], [409, DV], 'kept for ann, sent as this device: refused'); assert.strictEqual(await coins(DV), 29);
  r = await call('POST', '/api/tokens', { frank: 0, count: 9 }, key('tok-not-mine-1', ann, DV)); assert.strictEqual(r.status, 409, 'and the other way round'); assert.strictEqual(await coins('google:ann'), 0);
  r = await call('POST', '/api/tokens', { frank: 0, count: 9 }, key('tok-not-mine-1', ann, 'google:ann')); assert.deepStrictEqual([r.status, r.json.coins, r.heads['idempotent-replay']], [200, 9, undefined], 'sent as the one it was kept for, it is banked (the refusals were not kept as its answer)');
  // a secret found in the part of the paid level anyone can reach: its tokens once
  r = await call('POST', '/api/secret', { level: 'rock', id: 'r1' }, key('sec-key-0001', dv, DV)); assert.deepStrictEqual([r.status, r.json.first, r.json.tokens, r.json.coins], [200, true, 40, 69]);
  r = await call('POST', '/api/secret', { level: 'rock', id: 'r1' }, key('sec-key-0001', dv, DV)); assert.deepStrictEqual([r.json.first, r.json.coins, r.heads['idempotent-replay']], [true, 69, 'true'], 'the repeat is told what the first was told'); assert.strictEqual(await coins(DV), 69);
  r = await call('POST', '/api/secret', { level: 'rock', id: 'r1' }, key('sec-key-0002', dv, DV)); assert.deepStrictEqual([r.json.first, r.json.tokens], [false, 0], 'found again later: not new'); assert.strictEqual(await coins(DV), 69);
  // a score: the board keeps the best, and a made level's plays count each attempt once
  const code = (await call('GET', '/api/profile', null, ann)).json.code, tool = async function (name, args) { return (await call('POST', '/mcp?k=' + code, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args } })).json.result; };
  const made = (await tool('publish_level', DESIGN)).structuredContent; assert(/^[a-z0-9]{7}$/.test(made.id), JSON.stringify(made));
  const plays = function () { return n('SELECT plays AS n FROM levels WHERE id = ?', [made.id]); }, score = { level: made.id, score: 1200, pct: 12, name: 'Dev', played: true };
  const s1 = await call('POST', '/api/score', score, key('score-key-001', dv, DV)); assert.deepStrictEqual([s1.status, s1.json.me.score, s1.json.players], [200, 1200, 1]);
  r = await call('POST', '/api/score', score, key('score-key-001', dv, DV)); assert.deepStrictEqual([r.json, r.heads['idempotent-replay']], [s1.json, 'true']); assert.strictEqual(await plays(), 1, 'one attempt, one play');
  await call('POST', '/api/score', score, key('score-key-002', dv, DV)); await call('POST', '/api/score', score, dv); assert.strictEqual(await plays(), 3);
  r = await call('POST', '/api/score', { level: 'rock', score: 10, pct: 1, name: 'Dev', played: true }, key('score-key-003', dv, DV)); assert.strictEqual(r.status, 403, 'a taste\'s score is refused, as it always was');
  // a run, for the stats: one row for each key, even when the note of its answer is gone (the machine stopped before writing it)
  const run = { did: 'device-once-0000', t: 'run', frank: 0, pct: 12, sec: 'manhole', secs: 21.4, tokens: 9, res: 'splat' }, runs = function () { return n('SELECT COUNT(*) AS n FROM runs WHERE did = ?', ['device-once-0000']); };
  r = await call('POST', '/api/track', run, key('run-key-00001', dv)); assert.deepStrictEqual([r.status, r.json], [200, { ok: true }]); await call('POST', '/api/track', run, key('run-key-00001', dv)); assert.strictEqual(await runs(), 1, 'a run sent twice is one run');
  await S.db.run('DELETE FROM idem WHERE ikey = ?', ['run-key-00001']); await call('POST', '/api/track', run, key('run-key-00001', dv)); assert.strictEqual(await runs(), 1, 'still one');
  await call('POST', '/api/track', run, key('run-key-00002', dv)); await call('POST', '/api/track', run); await call('POST', '/api/track', run); assert.strictEqual(await runs(), 4, 'another key, or none (the page of the release before), is another run');
  assert.strictEqual((await S.db.get('SELECT ikey FROM runs WHERE did = ? ORDER BY id LIMIT 1', ['device-once-0000'])).ikey, 'run-key-00001');
  // a heart and the profile: the last word stands, and a repeat of an earlier one changes nothing
  await call('POST', '/api/heart', { level: 'city', on: true }, key('heart-key-001', dv, DV)); await call('POST', '/api/heart', { level: 'city', on: false }, key('heart-key-002', dv, DV)); r = await call('POST', '/api/heart', { level: 'city', on: true }, key('heart-key-001', dv, DV));
  assert.strictEqual(r.heads['idempotent-replay'], 'true'); assert.strictEqual(await n('SELECT COUNT(*) AS n FROM hearts WHERE uid = ?', [DV]), 0, 'the heart he took back stays taken back');
  await call('POST', '/api/profile', { name: 'First' }, key('prof-key-0001', dv, DV)); await call('POST', '/api/profile', { name: 'Second' }, key('prof-key-0002', dv, DV)); r = await call('POST', '/api/profile', { name: 'First' }, key('prof-key-0001', dv, DV));
  assert.deepStrictEqual([r.json.name, r.heads['idempotent-replay'], (await call('GET', '/api/profile', null, dv)).json.name], ['First', 'true', 'Second']);
  // signing in moves a device's wallet onto the account, and with it the answers its outbox was given
  const mv = D.dev('mover'), MV = 'dev:device-mover-0000'; await call('POST', '/api/tokens', { frank: 0, count: 6 }, key('tok-mover-001', mv, MV));
  r = await call('POST', '/api/auth/google', { credential: W.idToken({ sub: 'mo', email: 'mo@example.com', name: 'Mo' }) }, mv); assert.strictEqual(r.status, 200); const mo = { cookie: String(r.heads['set-cookie']).split(';')[0], 'x-did': mv['x-did'] };
  assert.strictEqual(await coins('google:mo'), 6); r = await call('POST', '/api/tokens', { frank: 0, count: 6 }, key('tok-mover-001', mo, 'google:mo'));
  assert.deepStrictEqual([r.status, r.json.coins, r.heads['idempotent-replay']], [200, 6, 'true'], 'what the device had sent, sent again as the account it became, is not banked twice'); assert.strictEqual(await coins('google:mo'), 6);
  // notes are kept longer than the outbox keeps what it has not delivered (30 days), and no longer
  for (let i = 0; i < 40 && await n('SELECT COUNT(*) AS n FROM idem WHERE ikey = ?', ['a-key-from-40-days-ago']); i++) await sleep(25);
  assert.strictEqual(await n('SELECT COUNT(*) AS n FROM idem WHERE ikey = ?', ['a-key-from-40-days-ago']), 0, 'a note of 40 days ago is gone'); assert.strictEqual(await n('SELECT COUNT(*) AS n FROM idem WHERE ikey = ?', ['a-key-from-20-days-ago']), 1, 'one of 20 days ago is still there');
  console.log('OK once: tokens, a secret, a score, a run, a heart and the profile sent again with their Idempotency-Key get the first answer and count once (in turn, together, and for a run even when the note was never written); the tokens and their note are written as one; a refusal is kept, a 409 is not; nothing kept for one player is taken as another\'s; a device\'s notes go with it when it signs in');

  // ---- money: a purchase survives a restart between paying and returning, and a return that never came ----
  const sid = function () { const k = Object.keys(W.sessions); return k[k.length - 1]; }, pending = function (s) { return n('SELECT COUNT(*) AS n FROM pending WHERE session = ?', [s]); };
  r = await call('POST', '/api/checkout', { level: 'rock' }, ann); assert(r.status === 200 && /^https:\/\/checkout\.stripe\.test\//.test(r.json.url), JSON.stringify(r.json)); const s1id = sid();
  assert.deepStrictEqual([W.sessions[s1id].amount_total, W.sessions[s1id].metadata.level, await pending(s1id)], [99, 'rock', 1], 'the checkout is written down before she is sent to Stripe');
  W.sessions[s1id].payment_status = 'paid';
  // (she paid, and comes back while the machine is restarting or cannot reach Stripe)
  W.down = true; console.error = function () {}; r = await call('GET', '/api/confirm?session_id=' + s1id, null, ann); console.error = said;
  assert(r.status >= 500, 'no answer for her yet: ' + r.status); assert.deepStrictEqual([await pending(s1id), await n('SELECT COUNT(*) AS n FROM owned WHERE uid = ?', ['google:ann'])], [1, 0], 'and nothing lost: the checkout is still open');
  W.down = false; r = await call('GET', '/api/confirm?session_id=' + s1id, null, ann); assert.deepStrictEqual([r.status, r.json], [200, { ok: true, level: 'rock' }], 'asked again, it is hers');
  r = await call('GET', '/api/confirm?session_id=' + s1id, null, ann); assert.deepStrictEqual(r.json, { ok: true, level: 'rock' }, 'and asked a third time, the same');
  assert.deepStrictEqual([await n('SELECT COUNT(*) AS n FROM owned WHERE uid = ?', ['google:ann']), await n('SELECT COUNT(*) AS n FROM purchases WHERE uid = ?', ['google:ann']), await n('SELECT COALESCE(SUM(amount), 0) AS n FROM purchases WHERE uid = ?', ['google:ann']), await pending(s1id)], [1, 1, 99, 0], 'one level, one purchase, 99 cents, however often it was confirmed');
  assert.strictEqual((await call('GET', '/api/confirm?session_id=' + s1id, null, bea)).json.ok, false, 'nobody else can claim it'); assert.strictEqual((await call('GET', '/api/world?id=rock', null, ann)).json.owned, true);
  // (she paid and never came back at all: the next time her account is looked up, Stripe is asked about what she left open)
  await call('POST', '/api/checkout', { pack: 'classic' }, bea); const s2id = sid(); W.sessions[s2id].payment_status = 'paid';
  W.down = true; r = await call('GET', '/api/me', null, bea); assert.deepStrictEqual([r.status, r.json.packs, await pending(s2id)], [200, [], 1], 'Stripe away: she is answered all the same, and it stays open');
  W.down = false; r = await call('GET', '/api/me', null, bea); assert.deepStrictEqual([r.json.packs, await pending(s2id), await n('SELECT COUNT(*) AS n FROM purchases WHERE uid = ?', ['google:bea'])], [['classic'], 0, 1], 'recovered from Stripe with no return at all');
  await call('POST', '/api/checkout', { level: 'rock' }, bea); const s3id = sid(); W.sessions[s3id].payment_status = 'paid'; r = await call('GET', '/api/me', null, bea); assert.strictEqual(r.json.levels.rock.owned, true, 'a level too');
  // (paid for something this build does not know: nothing is granted in its place, and the checkout stays open for the build that knows it)
  await call('POST', '/api/checkout', { level: 'rock' }, cy); const s4id = sid(); W.sessions[s4id].payment_status = 'paid'; W.sessions[s4id].metadata.level = 'moon';
  r = await call('GET', '/api/confirm?session_id=' + s4id, null, cy); assert.deepStrictEqual([r.json, await pending(s4id), await n('SELECT COUNT(*) AS n FROM unlocks WHERE uid = ?', ['google:cy']), await n('SELECT COUNT(*) AS n FROM purchases WHERE uid = ?', ['google:cy'])], [{ ok: false }, 1, 0, 0]);
  W.sessions[s4id].metadata.level = 'rock'; r = await call('GET', '/api/me', null, cy); assert.deepStrictEqual([r.json.levels.rock.owned, await pending(s4id)], [true, 0]);
  r = await call('GET', '/api/confirm?session_id=cs_test_nothing', null, cy); assert.deepStrictEqual([r.status, r.json], [200, { ok: false }], 'a checkout Stripe does not know is a plain no'); assert.strictEqual((await call('GET', '/api/confirm?session_id=' + s1id, null, dv)).status, 401);
  assert(W.asked.length > 10 && W.asked.every(function (u) { return /^https:\/\/(api\.stripe\.com|www\.googleapis\.com)\//.test(u); }), 'and Stripe was the test\'s own stand-in throughout');
  console.log('OK money: a level paid for is hers after a return that met a server that could not answer (asked again: once granted, 99 cents once); a pack and a level whose return never came are recovered from Stripe at the next /api/me; something this build does not sell is not granted wrong and stays open; an unknown checkout is a plain no');

  // ---- a made level's design carries its version; one kept before there were versions still opens ----
  const kept = function (id) { return S.db.get('SELECT spec FROM levels WHERE id = ?', [id]).then(function (x) { return JSON.parse(x.spec); }); };
  assert.deepStrictEqual([C.MADE_V, (await kept(made.id)).v], [1, 1], 'a design is kept with its version');
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'made', 'before-versions-tiny.json'), 'utf8')).spec; assert.strictEqual(before.v, undefined);
  const put = function (id, spec) { return S.db.run("INSERT INTO levels (id, name, author, spec, created, plays, ip, uid, status, note) VALUES (?, ?, ?, ?, ?, 0, '', ?, 'link', '')", [id, spec.name, spec.author, JSON.stringify(spec), Date.now(), 'google:ann']); };
  await put('oldone1', before); r = await call('GET', '/api/level?id=oldone1'); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.v, undefined, 'what was kept is handed over as it was kept'); assert(C.buildLevel(C.customSpec(r.json)).plan.length > 0, 'and builds: no v is version 1');
  r = await call('GET', '/api/level?id=' + made.id); assert.deepStrictEqual([r.json.v, r.json.sections.length, r.json.name], [1, 3, 'Safe Alley']);
  r = await tool('publish_level', Object.assign({ v: 99 }, DESIGN)); assert(r.isError && /written as version 99, which this game cannot build: it builds version 1/.test(r.content[0].text), JSON.stringify(r));
  r = await call('GET', '/api/world?id=rock&v=1', null, dv); assert.deepStrictEqual([r.status, r.json.v, r.json.taste, C.WORLD_READS.indexOf(r.json.v) >= 0], [200, 1, true, true], 'a paid level\'s stretches say their version');
  assert.throws(function () { C.readable(2, C.WORLD_READS, 'this level'); }, /cannot build/); C.readable(undefined, C.WORLD_READS, 'this level');
  console.log('OK made: a design is stamped with its version (' + C.MADE_V + '), one with none is version 1 and still builds, one from a later game is refused in a sentence; /api/world says the version of its stretches');

  // ---- what the browser keeps: every shape it has had, read so that nothing is ever taken from a player ----
  const SV = require('../save.js'), dir = path.join(__dirname, 'fixtures', 'saves'), files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); });
  const store = function (o) { const m = Object.assign({}, o); return { m: m, getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); } }; };
  assert(['first-visit.json', 'v1-before-difficulties.json', 'v1-today.json', 'v2.json', 'later.json', 'corrupt.json', 'senseless.json'].every(function (f) { return files.indexOf(f) >= 0; }), 'the older shapes, the live build\'s, this one\'s, a later one\'s and the broken ones are all kept');
  files.forEach(function (f) {
    const x = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), st = store(x.store), say = function (m) { return f + ': ' + m; };
    const was = SV.stamp(st), set = SV.settings(st), levels = SV.list('fff.levels', st), franks = SV.list('fff.franks', st);
    assert.deepStrictEqual(set, x.want.settings, say('the settings: each with a value that makes sense, and any this build does not know as they were'));
    assert.deepStrictEqual([levels.map(function (m) { return m.id; }), franks.map(function (m) { return m.id; })], [x.want.levels, x.want.franks], say('the made levels and Franks he has opened'));
    assert.strictEqual(st.m['fff.v'], String(x.want.v), say('the version is written, and never made less')); assert.strictEqual(was, x.store['fff.v'] ? +x.store['fff.v'] : 1);
    Object.keys(x.store).forEach(function (k) { if (k !== 'fff.v') assert.strictEqual(st.m[k], x.store[k], say('reading changes nothing that was kept (' + k + ')')); });
    const aside = Object.keys(st.m).filter(function (k) { return /^fff\.bad\./.test(k); }).sort();
    assert.deepStrictEqual(aside, x.want.bad.map(function (k) { return 'fff.bad.' + k.replace(/^fff\./, ''); }).sort(), say('what is set aside')); x.want.bad.forEach(function (k) { assert.strictEqual(st.m['fff.bad.' + k.replace(/^fff\./, '')], x.store[k], say(k + ' is set aside whole')); });
    // read again: the same, and nothing is set aside twice
    assert.deepStrictEqual([SV.settings(st), SV.list('fff.levels', st).length, Object.keys(st.m).filter(function (k) { return /^fff\.bad\./.test(k); }).length], [set, levels.length, x.want.bad.length], say('read twice is the same'));
    // what the game then writes when he flips a setting, or opens another made level: everything that was there is still there
    const flipped = JSON.parse(JSON.stringify(Object.assign({}, set, { music: !set.music }))); Object.keys(x.want.settings).forEach(function (k) { if (k !== 'music') assert.deepStrictEqual(flipped[k], x.want.settings[k], say(k + ' survives a change of another setting')); });
    levels.forEach(function (m, i) { const raw = JSON.parse(x.store['fff.levels']).filter(function (q) { return q && q.id === m.id; })[0]; assert.deepStrictEqual(m, raw, say('a made level is as it was kept, every field (' + i + ')')); });
    // the levels of his that this build can build are the ones the game shows; the others stay kept
    levels.forEach(function (m) { let ok = true; try { C.customLevel(m); C.buildLevel(C.customSpec(m)); } catch (e) { ok = false; } assert.strictEqual(ok, m.id === 'k3m9x2a', say(m.id + (m.id === 'k3m9x2a' ? ' builds' : ' is refused, not built wrong'))); });
    ['fff.far.0', 'fff.top.0', 'fff.tokens'].forEach(function (k) { const v = SV.num(k, st); assert(typeof v === 'number' && isFinite(v) && (isNaN(+x.store[k]) || !x.store[k] || v === +x.store[k]), say(k + ' is a number: ' + v)); });
  });
  assert.deepStrictEqual(SV.settings({ getItem: function () { throw new Error('private mode'); }, setItem: function () { throw new Error('private mode'); } }), SV.SET, 'no storage at all is a first visit'); assert.strictEqual(SV.put('k', 'v', { setItem: function () { throw new Error('full'); } }), false);
  // twice broken, differently: both texts are kept
  const st2 = store({ 'fff.set': '{bad one' }); SV.settings(st2); st2.m['fff.set'] = '{bad two'; SV.settings(st2); SV.settings(st2); assert.deepStrictEqual([st2.m['fff.bad.set'], st2.m['fff.bad.set.2'], st2.m['fff.bad.set.3']], ['{bad one', '{bad two', undefined]);
  // and the server: signing in only ever adds what the device had to what the account has
  await S.db.run('UPDATE users SET coins = 100 WHERE id = ?', ['google:mo']); await S.db.run('INSERT INTO unlocks (uid, frank, session, created) VALUES (?, 5, ?, 1)', ['google:mo', 'tokens']);
  const d2 = { 'x-did': 'device-second-0000' }; await call('POST', '/api/tokens', { frank: 0, count: 30 }, d2); await call('POST', '/api/heart', { level: 'city', on: true }, d2); await call('POST', '/api/secret', { level: 'rock', id: 'r1' }, d2);
  await S.db.run('UPDATE users SET coins = 300 WHERE id = ?', ['dev:device-second-0000']); await call('POST', '/api/earn', { frank: 7 }, d2);
  r = await call('POST', '/api/auth/google', { credential: W.idToken({ sub: 'mo', email: 'mo@example.com', name: 'Mo' }) }, d2); r = (await call('GET', '/api/me', null, { cookie: String(r.heads['set-cookie']).split(';')[0], 'x-did': d2['x-did'] })).json;
  assert.deepStrictEqual([r.coins, r.unlocked.sort(), r.hearts.city.mine, r.levels.rock.found, r.id], [150, [5, 7], true, ['r1'], 'google:mo'], 'the account has what it had and what the device had');
  console.log('OK save: ' + files.length + ' kept shapes (before the four difficulties, the live build\'s, this build\'s with its outbox, a later build\'s, the unreadable and the senseless) read without losing a best, a level, a Frank or a setting; unknown fields kept; the unreadable set aside whole; signing in only adds');

  // ---- the service worker, against a stand-in for the browser: its cache follows the build and holds one build only ----
  const SITE = 'https://freefallfrank.test', swText = (await call('GET', '/sw.js')).text, pageText = (await call('GET', '/play')).text;
  // a browser's caches, fetch and worker events, as much as sw.js uses; server(url) -> { status, build, body } or throws (no network)
  function worker(text, server, had) {
    const stores = new Map(Object.entries(had || {}).map(function (e) { return [e[0], new Map(Object.entries(e[1]))]; })), listeners = {}, flags = { skipped: false, claimed: false, asked: [] };
    const res = function (o) { return { status: o.status, body: o.body, build: o.build, headers: { get: function (k) { return k === 'X-Build' ? o.build || null : null; } }, clone: function () { return res(o); }, text: function () { return Promise.resolve(String(o.body)); } }; };
    const abs = function (k) { return new URL(typeof k === 'string' ? k : k.url, SITE + '/').href; }, bare = function (u) { return u.split('?')[0]; };
    const cache = function (name) { if (!stores.has(name)) stores.set(name, new Map()); const m = stores.get(name); return { put: function (k, v) { m.set(abs(k), v); return Promise.resolve(); }, keys: function () { return Promise.resolve(Array.from(m.keys()).map(function (u) { return { url: u }; })); },
      match: function (k, o) { const u = abs(k); if (m.has(u)) return Promise.resolve(m.get(u)); if (o && o.ignoreSearch) for (const e of m) if (bare(e[0]) === bare(u)) return Promise.resolve(e[1]); return Promise.resolve(undefined); } }; };
    const sandbox = { URL: URL, Promise: Promise, location: { origin: SITE }, Response: { error: function () { return res({ status: 0, body: 'network error' }); } },
      caches: { open: function (name) { return Promise.resolve(cache(name)); }, keys: function () { return Promise.resolve(Array.from(stores.keys())); }, delete: function (name) { return Promise.resolve(stores.delete(name)); } },
      fetch: function (q) { const u = abs(q); flags.asked.push(u); return Promise.resolve().then(function () { return res(server(u.slice(SITE.length))); }); },
      self: { addEventListener: function (t, f) { listeners[t] = f; }, skipWaiting: function () { flags.skipped = true; }, clients: { claim: function () { flags.claimed = true; return Promise.resolve(); } } } };
    vm.runInNewContext(text, sandbox);
    const life = function (t, data) { let p = Promise.resolve(); listeners[t]({ data: data, waitUntil: function (x) { p = x; } }); return p; };
    // a request from a page: what the worker answers with, or 'not handled' (the browser then asks the network itself)
    const ask = function (u, method) { let p = null; listeners.fetch({ request: { url: SITE + u, method: method || 'GET' }, respondWith: function (x) { p = x; } }); return p ? p.then(function (x) { return x || res({ status: 0 }); }) : Promise.resolve('not handled'); };
    return { stores: stores, flags: flags, life: life, ask: ask, has: function (name, u) { return stores.has(name) && stores.get(name).has(SITE + '/' + u); } };
  }
  // this build's server, as the worker sees it (the real pages and files, through handle); and one of the build after
  const B2 = 'feedfacef0', files2 = {}, live = async function (u) { const a = await call('GET', u); return { status: a.status, build: a.heads['x-build'], body: a.text }; };
  for (const u of Array.from(pageText.matchAll(/<script src="([^"]+)"/g), function (m) { return '/' + m[1]; }).concat(['/play', '/manifest.json', '/icon-180.png', '/icon-512.png', '/glyphh-logo.png', '/glyphh-spike.png', '/glyphh-logo-black.png', '/favicon.ico', '/favicon-16.png', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-maskable-512.png'], ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'snap', 'rim', 'scratch', 'hey', 'crash'].map(function (x) { return '/samples/' + x + '.wav'; }))) files2[u] = await live(u);
  let net = 'b1';   // which server answers: this build's, the next build's, a restarting one (503), or none
  const serverNow = function (u) {
    if (net === 'off') throw new Error('no network');
    if (net === '503') return { status: 503, body: '<h1>503</h1>' };
    const f = files2[u] || files2[u.replace(/\?.*$/, '')] && !/\?v=/.test(u) && files2[u.replace(/\?.*$/, '')];
    if (net === 'b2') return { status: 200, build: B2, body: u.indexOf('/play') === 0 ? pageText.split(B).join(B2) : 'build two: ' + u };
    return f || (u.indexOf('/play') === 0 ? files2['/play'] : /^\/music\/\d+\.mp3$/.test(u) ? { status: 200, build: B, body: 'music ' + u } : { status: 404, build: B, body: 'not found' });
  };
  let w = worker(swText, serverNow, { 'fff-42': { [SITE + '/play']: { status: 200, body: 'the page before builds' }, [SITE + '/game.js']: { status: 200, body: 'old game' }, [SITE + '/music/0.mp3']: { status: 200, body: 'the first level\'s track' }, [SITE + '/music/7.mp3']: { status: 200, body: 'another track' } } });
  await w.life('install');
  const NAME = 'fff-' + B, keptNow = Array.from(w.stores.get(NAME).keys()).map(function (u) { return u.slice(SITE.length + 1); }).sort();
  assert.deepStrictEqual(keptNow, Object.keys(files2).map(function (u) { return u.slice(1); }).sort(), 'installed: the page, every script the page names (by this build), the icons and the drum sounds, and nothing else');
  assert(keptNow.filter(function (u) { return /\.js\?v=/.test(u); }).length === 8 && keptNow.every(function (u) { return !/\.js$/.test(u); }), 'every script is kept under its build\'s address'); assert.strictEqual(w.stores.get(NAME).get(SITE + '/play').body, pageText);
  assert.deepStrictEqual([w.flags.skipped, w.stores.has('fff-42')], [false, true], 'and it waits: the worker and the cache that were there are left as they are');
  await w.life('message', { type: 'take-over', build: B2 }); await w.life('message', { type: 'something' }); await w.life('message', null); assert.strictEqual(w.flags.skipped, false, 'a page of another build cannot make it take over');
  await w.life('message', { type: 'take-over', build: B }); assert.strictEqual(w.flags.skipped, true, 'a page of its own build can');
  await w.life('activate'); assert.deepStrictEqual([Array.from(w.stores.keys()), w.flags.claimed, w.has(NAME, 'music/0.mp3'), w.has(NAME, 'music/7.mp3'), w.has(NAME, 'game.js')], [[NAME], true, true, true, false], 'taking over: the old cache goes, the music he had comes along, the old scripts do not');
  // answering a page of its build: the network first, and a copy kept only of this build's
  r = await w.ask('/play?level=rock'); assert.strictEqual(r.body, pageText); r = await w.ask('/music/3.mp3'); await sleep(5); assert(w.has(NAME, 'music/3.mp3'), 'music is kept as it is fetched');
  for (const u of ['/api/world?id=rock', '/api/me', '/api/confirm?session_id=x', '/admin', '/auth/link?token=x', '/about', '/landing/hero.jpg', '/healthz', '/mcp', '/oauth/authorize']) assert.strictEqual(await w.ask(u), 'not handled', u + ' is never the worker\'s');
  assert.strictEqual(await w.ask('/play', 'POST'), 'not handled'); r = await w.ask('/'); await sleep(5); assert(!w.has(NAME, ''), '"/" is two pages: never kept');
  r = await w.ask('/worlds.js'); await sleep(5); assert.deepStrictEqual([r.status, w.has(NAME, 'worlds.js')], [404, false], 'what the server does not serve is not kept');
  // the server becomes the next build: its files pass through to the page that asks, and none of them is kept here
  net = 'b2'; r = await w.ask('/play'); assert(r.body.indexOf(B2) > 0, 'the new page comes through'); r = await w.ask('/game.js?v=' + B2); assert.strictEqual(r.body, 'build two: /game.js?v=' + B2); await sleep(5);
  assert.deepStrictEqual([w.stores.get(NAME).get(SITE + '/play').body === pageText, w.has(NAME, 'game.js?v=' + B2), Array.from(w.stores.get(NAME).keys()).some(function (u) { return u.indexOf(B2) > 0; })], [true, false, false], 'this build\'s cache still holds this build only');
  // no network: the page of this build, with the scripts it was made for
  net = 'off'; r = await w.ask('/play?level=rock'); assert.strictEqual(r.body, pageText, 'offline: the game'); r = await w.ask('/'); assert.strictEqual(r.body, pageText, 'offline, "/" is the game'); r = await w.ask('/game.js?v=' + B); assert.strictEqual(r.body, files2['/game.js?v=' + B].body);
  r = await w.ask('/game.js?v=' + B2); assert.strictEqual(r.status, 0, 'a script asked for by another build is not answered with this build\'s: no mixed files'); r = await w.ask('/game.js'); assert.strictEqual(r.body, files2['/game.js?v=' + B].body, 'a page from before builds, asking with no build, gets what is kept');
  r = await w.ask('/music/0.mp3'); assert.strictEqual(r.body, 'the first level\'s track', 'the first level\'s music, offline, across the change of worker'); r = await w.ask('/samples/kick.wav'); assert.strictEqual(r.status, 200); assert.strictEqual((await w.ask('/worlds.js')).status, 0);
  net = '503'; r = await w.ask('/play'); assert.strictEqual(r.body, pageText, 'the server restarting (503): the kept game, not an error page'); r = await w.ask('/music/9.mp3'); assert.strictEqual(r.status, 503, 'with nothing kept, the answer as it came');
  // an install that meets a deploy half way is no install: nothing of two builds is ever put together
  let half = 0; const w2 = worker(swText, function (u) { return ++half > 4 ? { status: 200, build: B2, body: 'build two' } : serverNow(u); }); net = 'b1';
  await assert.rejects(w2.life('install'), /is not build/); assert.strictEqual(w2.flags.skipped, false);
  const w3 = worker(swText, function (u) { net = '503'; return serverNow(u); }); await assert.rejects(w3.life('install'), /is not build/); net = 'b1';
  // the worker the live site has today (fff-42) is the one this replaces: it claimed pages at once and kept whatever came
  assert(/skipWaiting\(\)/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\/\/.*$/gm, '').split("addEventListener('install'")[1].split('addEventListener')[0]) === false, 'install does not take over by itself');
  console.log('OK worker: installed, it keeps this build\'s page and the ' + (keptNow.length - 1) + ' files it names and needs, and waits; it takes over only when a page of its own build asks, drops the old cache and keeps the music; it never keeps "/", the API, or a file of another build; offline and through a 503 it answers with one build\'s page and scripts; an install across a deploy fails whole');

  // ---- node server.js --check, in this process: passes, changes no row, and says exactly what is wrong ----
  const beforeAll = await all(); r = await S.check();
  assert(r.ok, r.lines.join('\n')); assert.strictEqual(r.lines[r.lines.length - 1], 'CHECK PASSED'); assert.deepStrictEqual(await all(), beforeAll, 'not a row is changed');
  assert(r.lines.some(function (l) { return /^ok    21 of 21 tables read/.test(l); }) && r.lines.some(function (l) { return /^ok    server\.js: (\d+) of \1 statements/.test(l) && +/(\d+) of/.exec(l)[1] > 60; }) && r.lines.some(function (l) { return /^ok    levels\.js: (\d+) of \1 statements/.test(l) && +/(\d+) of/.exec(l)[1] > 20; })
    && r.lines.some(function (l) { return /^ok    oauth\.js: (\d+) of \1 statements/.test(l); }) && r.lines.some(function (l) { return /^ok    2 of 2 made levels build/.test(l); }) && r.lines.some(function (l) { return /^ok    11 of 11 lists and reads/.test(l); }) && r.lines.some(function (l) { return /^ok    the game's own levels build/.test(l); }), r.lines.join('\n'));
  // a statement that names a column that is not there: a read is run, a write is only planned; neither changes anything
  r = await S.check({ statements: ['SELECT id, shoe_size FROM users WHERE id = ?', 'UPDATE users SET shoe_size = ? WHERE id = ?', 'DELETE FROM users WHERE id <> ?', 'SELEC id FROM users'] });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.failed.length, 3, r.failed.join('\n')); assert(/shoe_size/.test(r.failed[0]) && /SELECT id, shoe_size FROM users/.test(r.failed[0]) && /shoe_size/.test(r.failed[1]) && /UPDATE users SET shoe_size/.test(r.failed[1]) && /SELEC id FROM users/.test(r.failed[2]), r.failed.join('\n'));
  assert(/^CHECK FAILED: 3 things wrong/.test(r.lines[r.lines.length - 1])); assert.deepStrictEqual(await all(), beforeAll, 'the DELETE that was good was planned, not done: every user is still there');
  // a list that is put together from parts and goes wrong
  r = await S.check({ reads: [['the broken list', function () { return S.db.all('SELECT u.name FROM users u JOIN scores s ON s.uid = u.id WHERE s.stars > ?', [1]); }]] }); assert(!r.ok && r.failed.length === 1 && /^the broken list: .*stars/.test(r.failed[0]), r.failed.join('\n'));
  // a made level that no longer builds, and one written as a version this build cannot read
  await put('broken1', Object.assign({}, before, { name: 'Moon Base', sections: [{ kind: 'zipline', beats: 16 }] })); await put('future1', Object.assign({}, before, { v: 99, name: 'From Tomorrow' }));
  r = await S.check(); assert(!r.ok && r.failed.length === 2 && r.failed.some(function (f) { return /^the made level broken1 no longer builds/.test(f); }) && r.failed.some(function (f) { return /^the made level future1 no longer builds .*written as version 99/.test(f); }), r.failed.join('\n')); assert(r.lines.some(function (l) { return /^ok    2 of 4 made levels build/.test(l); }));
  await S.db.run("DELETE FROM levels WHERE id IN ('broken1', 'future1')"); assert((await S.check()).ok);
  await S.db.run('INSERT INTO franks (id, name, spec, uid, created) VALUES (?, ?, ?, ?, 1)', ['fbroken', 'X', '{not json', 'google:ann']); r = await S.check(); assert(!r.ok && /^the made Frank fbroken can no longer be read/.test(r.failed[0]), r.failed.join('\n')); await S.db.run('DELETE FROM franks WHERE id = ?', ['fbroken']);
  // a statement that removes or gives another name, outside the cleanup list
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), lines = src.split('\n').length;
  for (const x of ["await db.exec('DROP TABLE hearts');", "db.run('ALTER TABLE users DROP COLUMN coins')", "db.exec('ALTER TABLE users RENAME COLUMN name TO handle')", "db.exec('alter table users rename to players')"]) {
    r = await S.check({ sources: { 'server.js': src + '\n' + x + '\n' } });
    assert(!r.ok && r.failed.length === 1 && r.failed[0].indexOf('server.js line ' + (lines + 1) + ': a statement that removes a table or a column, or gives one another name, outside the cleanup list') === 0, x + ' -> ' + r.failed.join('\n'));
  }
  assert.strictEqual(await n('SELECT COUNT(*) AS n FROM hearts'), JSON.parse(beforeAll.hearts).length, 'and it was never run: the table is there'); assert(JSON.parse(beforeAll.hearts).length >= 1); assert.deepStrictEqual(await all(), beforeAll);
  r = await S.check({ sources: { 'server.js': src.replace('/* cleanup:end */', "'ALTER TABLE devices DROP COLUMN ua',\n/* cleanup:end */") } }); assert(r.ok, 'inside the cleanup list it may stand: ' + r.failed.join('\n'));
  assert(/cleanup:begin[\s\S]*cleanup:end/.test(src), 'the cleanup list is marked in server.js');
  console.log('OK check (in this process): passes on a good database and changes no row; names a wrong column in a read and in a write (planned, never done), a broken list, a made level that no longer builds or is of a version this build cannot read, a made Frank that cannot be read, and a DROP TABLE, a DROP COLUMN or a RENAME outside the cleanup list');

  // ---- node server.js --check, as the deploy runs it: another process, a database of its own, no port, no network ----
  const runCheck = function (f, more) { const o = cp.spawnSync(process.execPath, ['-r', path.join(__dirname, 'noport.cjs'), 'server.js', '--check'], { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, f.env, { SESSION_SECRET: 'x', NODE_NO_WARNINGS: '1', RESEND_API_KEY: 're_never_used', STRIPE_SECRET_KEY: 'sk_never_used', PORT: '1' }, more) }); return { code: o.status, out: o.stdout + o.stderr }; };
  const dump = async function (f) { const o = {}; for (const t of TABLES) o[t] = JSON.stringify(await f.all('SELECT * FROM ' + t + ' ORDER BY 1, 2')); return o; };
  let f = await D.fresh('check');
  try {
    r = runCheck(f); assert.strictEqual(r.code, 0, r.out); assert(/^ok    the schema is applied$/m.test(r.out) && /^ok    21 of 21 tables read, with every column$/m.test(r.out) && /CHECK PASSED\s*$/.test(r.out) && !/PORT WAS BOUND|NETWORK WAS ASKED/.test(r.out), r.out);
    assert.deepStrictEqual([Number((await f.all('SELECT COUNT(*) AS n FROM idem'))[0].n), Number((await f.all('SELECT COUNT(*) AS n FROM ads'))[0].n), (await f.all('SELECT ikey FROM runs')).length], [0, 0, 0], 'an empty database is given the schema (the same code a start uses), and not a row');
    await f.exec("INSERT INTO users (id, email, name, created, coins) VALUES ('google:zed', 'zed@example.com', 'Zed', 1, 40); INSERT INTO pending (session, uid, frank, created) VALUES ('cs_open', 'google:zed', -2, 1); INSERT INTO runs (did, uid, frank, pct, sec, secs, tokens, res, easy, at) VALUES ('device-zed-0000', 'google:zed', 0, 50, 'sewer', 70, 5, 'splat', 0, 1);" +
      " INSERT INTO levels (id, name, author, spec, created, plays, ip, uid, status, note) VALUES ('goodone', 'Tiny', 'anonymous', '" + JSON.stringify(before) + "', 1, 0, '', 'google:zed', 'public', ''); INSERT INTO email_links (hash, email, back, created, expires, used) VALUES ('h', 'zed@example.com', '/play', 1, 99999999999999, 0);");
    const rows = await dump(f); r = runCheck(f); assert.strictEqual(r.code, 0, r.out); assert(/^ok    1 of 1 made levels build$/m.test(r.out), r.out); assert.deepStrictEqual(await dump(f), rows, 'not a row is changed (the open checkout is still open: Stripe was not asked; the unspent sign-in link is still unspent)');
    await f.exec("INSERT INTO levels (id, name, author, spec, created, plays, ip, uid, status, note) VALUES ('badone', 'Gone', 'x', '" + JSON.stringify(Object.assign({}, before, { sections: [{ kind: 'teleport', beats: 16 }] })) + "', 2, 0, '', 'google:zed', 'link', '')");
    r = runCheck(f); assert.strictEqual(r.code, 1, r.out); assert(/^FAIL  the made level badone no longer builds /m.test(r.out) && /CHECK FAILED: 1 thing wrong/.test(r.out), r.out);
    if (!f.postgres) { r = runCheck(f, { FLY_APP_NAME: 'free-fall-frank' }); assert(r.code === 1 && /DATABASE_URL is not set on this machine/.test(r.out), 'on the machine, no DATABASE_URL is a failed check'); }
  } finally { await f.done(); }
  // a column this build reads is not in the database (a table made by something older, which CREATE TABLE IF NOT EXISTS leaves as it is)
  f = await D.fresh('check');
  try {
    await f.exec('CREATE TABLE scores (level TEXT, uid TEXT, name TEXT, score INTEGER, at BIGINT, PRIMARY KEY (level, uid))');
    r = runCheck(f); assert.strictEqual(r.code, 1, r.out); assert(/^FAIL  table scores \(level, uid, name, score, pct, at\): .*pct/m.test(r.out), r.out); assert(/^FAIL  a statement in levels\.js: .*pct[\s\S]*scores/m.test(r.out) && /^FAIL  a leaderboard: .*pct/m.test(r.out) && /CHECK FAILED: \d+ things wrong/.test(r.out), r.out);
    assert(!/PORT WAS BOUND|NETWORK WAS ASKED/.test(r.out)); assert.deepStrictEqual((await f.all('SELECT * FROM scores')), []);
  } finally { await f.done(); }
  // a database from before this release: the tables as the live build made them, with rows; the check adds what is new and loses nothing
  f = await D.fresh('check');
  try {
    await f.exec("CREATE TABLE runs (id " + (f.postgres ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT') + ", did TEXT, uid TEXT, frank INTEGER, pct INTEGER, sec TEXT, secs REAL, tokens INTEGER, res TEXT, easy INTEGER, at BIGINT); INSERT INTO runs (did, frank, pct, sec, secs, tokens, res, easy, at) VALUES ('device-old-0000', 0, 40, 'sewer', 30, 3, 'splat', 0, 1), ('device-old-0000', 0, 60, 'grid', 50, 9, 'saw', 0, 2);" +
      " CREATE TABLE levels (id TEXT PRIMARY KEY, name TEXT, author TEXT, spec TEXT, created BIGINT, plays INTEGER DEFAULT 0, ip TEXT); INSERT INTO levels (id, name, author, spec, created, plays, ip) VALUES ('veryold', 'Tiny', 'anonymous', '" + JSON.stringify(before) + "', 1, 4, '');");
    r = runCheck(f); assert.strictEqual(r.code, 0, r.out); const lv = (await f.all('SELECT * FROM levels'))[0], rn = await f.all('SELECT * FROM runs ORDER BY id');
    assert.deepStrictEqual([lv.id, Number(lv.plays), lv.status, lv.uid, rn.length, rn[0].ikey, Number(rn[1].pct)], ['veryold', 4, 'link', null, 2, null, 60], 'the old rows are all there, with the new columns empty (a level\'s status is "link", as a start gives it)');
    r = runCheck(f); assert.strictEqual(r.code, 0, 'and run again, it is the same: ' + r.out);
  } finally { await f.done(); }
  console.log('OK check (the command, on ' + (f.postgres ? 'Postgres' : 'SQLite') + '): exit 0 on an empty database (which it gives the schema, and no row), on one with rows (none changed) and on one made by the release before (new columns added, nothing lost); exit 1 naming the made level that no longer builds, and the table, the statement and the list that need a missing column; it bound no port and asked the network for nothing');

  console.log('OK safe');
  await T.done(); process.exit(0);
})().catch(function (e) { console.error(e); Promise.resolve(T && T.done()).catch(function () {}).then(function () { process.exit(1); }); });
