// Free Fall Frank server: serves the game, keeps each player's tokens and Franks, signs players in with Google,
// Apple or a link sent to their email when they pay, sells the pack through Stripe Checkout, records plays, and
// serves the admin dashboard.
// Config (environment): DATABASE_URL (Postgres; without it a local SQLite file is used, as the tests do),
// SESSION_SECRET, GOOGLE_CLIENT_ID, APPLE_SERVICE_ID, STRIPE_SECRET_KEY, ADMIN_PASSWORD, PUBLIC_URL, DATA_DIR, PORT,
// RESEND_API_KEY (sign-in links by email, sent through Resend: without it that way of signing in is not offered) and
// EMAIL_FROM (who those emails are from; "Free Fall Frank <support@glyphh.ai>" unless set).
//
// SAFE BUILDS: a deploy must never break someone who is playing. A fall is played in the browser, so a deploy does
// not stop it; these are what stands in the way of the rest. Deploy with ./deploy.sh, never by hand.
//   BUILD            names the client files this server serves. Every answer says it (X-Build), /api/me says it,
//                    every page is told its own (window.FFF_BUILD) and asks for its scripts by it (?v=), and the
//                    service worker's cache is named by it. net.js reloads an open page into a new build only at a
//                    moment that costs the player nothing.
//   THE RULE         the server stays compatible with the page of the release before: no route is taken away, no
//                    field of an answer is taken away or changes its type, nothing an old page sends is refused, in
//                    the release that stops using it. ROUTES and test/contract.json hold it (node test/contract.cjs).
//   Idempotency-Key  what the page's outbox sends (tokens, secrets, scores, runs, hearts, the profile) is sent again
//                    until it is answered: the first answer is kept for that player and key (table idem), and a
//                    repeat gets it without the work being done twice (once(), below).
//   THE SCHEMA ONLY GROWS  new tables and new columns that may be empty; nothing is removed or given another name
//                    outside CLEANUP, a release after it stopped being used.
//   GET /healthz     200 only when the database answers (fly.toml's check).
//   node server.js --check   what a deploy runs before the running machine is replaced (check(), at the bottom):
//                    the schema, every table and statement, every made level; no port, no email, no row changed.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const FRANKS = require('./franks.js'), CORE = require('./core.js');

const env = process.env;
const CHECK = require.main === module && process.argv.indexOf('--check') >= 0;   // run as the deploy's check: nothing is served, sent or changed
// where the client's files are read from: here, unless a test serves a copy it can change (CLIENT_DIR), as a deploy would
const ROOT = env.CLIENT_DIR || __dirname;
const FREE = [0, 1, 2];              // Franks anyone can play
const TOKEN_PRICE = 250;             // tokens picked up in the levels that earn one Frank instead of paying
// Packs: one payment unlocks every Frank in it. More packs can be added here later.
const PACKS = { classic: { name: 'All Franks', price: 99, from: 3, to: FRANKS.length - 1 } };
// The game's own later levels (worlds.js) are paid for: one payment, once, unlocks a level for that account for good.
// Its stretches never leave the server for anyone else: they get the taste (its first stretches, ending in a wall).
const WORLDS = require('./worlds.js');
const LEVEL_PRICE = 99;              // cents
const SECRET_TOKENS = 40;            // tokens for each hidden thing in a level, the first time a player finds it
const PAID = {};
Object.keys(WORLDS).forEach(function (id) { PAID[id] = { id: id, name: WORLDS[id].name, price: LEVEL_PRICE, n: WORLDS[id].n, secrets: WORLDS[id].secrets }; });
const worldNo = function (n) { return Object.keys(WORLDS).filter(function (id) { return WORLDS[id].n === n; })[0] || ''; };   // a run's or a wallet's "frank" number past the Franks is a level's
const tasteIds = function (id) { return WORLDS[id].taste.secrets.map(function (s) { return s.id; }); };
const LEVEL_IDS = ['city'].concat(Object.keys(WORLDS));   // the levels on the main page (game.js LEVELS), for hearts
const tokenCap = {};                // the most tokens one run of a Frank's level can hold
function capOf(frank) { return tokenCap[frank] || (tokenCap[frank] = CORE.buildLevel(CORE.specFor(frank)).maxTokens); }   // bonus rooms included
function capOfWorld(id, owned) { const k = id + (owned ? '' : ':taste'); return tokenCap[k] || (tokenCap[k] = CORE.buildLevel(WORLDS[id][owned ? 'full' : 'taste']).maxTokens); }
const PUBLIC_URL = env.PUBLIC_URL || 'https://free-fall-frank.fly.dev';
// the game answers on these names; a checkout returns the player to the one they came from
const HOSTS = ['freefallfrank.com', 'www.freefallfrank.com', 'free-fall-frank.fly.dev'];
function originOf(req) { const h = String(req.headers.host || '').toLowerCase(); return HOSTS.indexOf(h) >= 0 ? 'https://' + h : PUBLIC_URL; }
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/core.js': 'core.js', '/franks.js': 'franks.js', '/audio.js': 'audio.js',
  '/account.js': 'account.js', '/game.js': 'game.js', '/save.js': 'save.js', '/net.js': 'net.js', '/sw.js': 'sw.js', '/manifest.json': 'manifest.json',
  '/icon-180.png': 'icon-180.png', '/icon-512.png': 'icon-512.png', '/glyphh-logo.png': 'glyphh-logo.png', '/glyphh-spike.png': 'glyphh-spike.png', '/glyphh-logo-black.png': 'glyphh-logo-black.png', '/admin': 'admin.html', '/chart.min.js': 'chart.min.js', '/level': 'level.html', '/build': 'build.html',
};
// The icons: Frank's face on the game's dark ground, in every size a browser or a phone asks for. Every page the
// server sends names them in its head (the .ico, the 32 px PNG, the apple-touch-icon, the manifest, the theme
// colour); /favicon.ico and /apple-touch-icon.png are also what a browser asks for unprompted, so they may be kept a day.
const ICONS = ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-maskable-512.png'];
ICONS.forEach(function (f) { STATIC['/' + f] = f; });
const SAMPLES = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'snap', 'rim', 'scratch', 'hey', 'crash'].map(function (n) { return 'samples/' + n + '.wav'; });
SAMPLES.forEach(function (f) { STATIC['/' + f] = f; });
fs.readdirSync(path.join(ROOT, 'music')).forEach(function (f) { if (/\.(mp3|js)$/.test(f)) STATIC['/music/' + f] = 'music/' + f; });
// the Instagram ad, so it can be opened and saved from a phone
STATIC['/ad.mp4'] = 'marketing/instagram-ad/free-fall-frank-ad.mp4'; STATIC['/ad-cover.jpg'] = 'marketing/instagram-ad/cover.jpg';
STATIC['/ad4.mp4'] = 'marketing/instagram-ad/free-fall-frank-full.mp4'; STATIC['/ad4-cover.jpg'] = 'marketing/instagram-ad/cover-full.jpg';   // nothing but play, the whole phone
STATIC['/ad3.mp4'] ='marketing/instagram-ad/free-fall-frank-claude.mp4'; STATIC['/ad3-cover.jpg'] = 'marketing/instagram-ad/cover-claude.jpg';   // the Claude cut, wide, for Reddit
STATIC['/ad2.mp4'] ='marketing/instagram-ad/free-fall-frank-insane.mp4'; STATIC['/ad2-cover.jpg'] = 'marketing/instagram-ad/cover-insane.jpg';   // the insane-mode cut
// The landing page (landing.html, with its pictures and video in landing/). It is always at /about and the game is
// always at /play. "/" is the landing page only for someone new: any query string (an ad click, a level's or a
// Frank's link, back from Stripe), a session cookie or the game's own "played" cookie gets the game, as it always did.
STATIC['/about'] = 'landing.html'; STATIC['/play'] = 'index.html';
fs.readdirSync(path.join(ROOT, 'landing')).forEach(function (f) { if (/\.(jpg|png|mp4)$/.test(f)) STATIC['/landing/' + f] = 'landing/' + f; });
const PLAYED = 'played=1; Path=/; Max-Age=31536000; SameSite=Lax';   // set whenever the game is served
function isNew(req) { return req.url.indexOf('?') < 0 && !/(?:^|;\s*)(?:fff=[^;]|played=1)/.test(req.headers.cookie || ''); }
const TYPES = { mp4: 'video/mp4', jpg: 'image/jpeg', mp3: 'audio/mpeg', html: 'text/html; charset=utf-8', js: 'application/javascript; charset=utf-8', json: 'application/manifest+json', png: 'image/png', wav: 'audio/wav', ico: 'image/x-icon' };
// THE BUILD ID: a short hash of everything a browser is given to run or keep (the pages, the scripts, the service
// worker and what it keeps for offline play: the icons and the drum sounds), worked out when the server starts. It
// changes exactly when one of them changes, with nothing to pass in at build time. A browser that was loaded with
// another id is running the build before this one. (The music is left out: 55 MB that a build does not change.)
const PAGES = ['index.html', 'landing.html', 'admin.html', 'level.html', 'build.html'];
const SCRIPTS = ['core.js', 'franks.js', 'music/tracks.js', 'audio.js', 'save.js', 'net.js', 'account.js', 'game.js', 'chart.min.js'];
const CLIENT = PAGES.concat(SCRIPTS, ['sw.js', 'manifest.json', 'icon-180.png', 'icon-512.png', 'glyphh-logo.png', 'glyphh-spike.png', 'glyphh-logo-black.png'], ICONS, SAMPLES);   // (glyphh-logo-black.png: the logo on the billboard at the top of a level, game.js)
function buildOf(dir) { const h = crypto.createHash('sha256'); CLIENT.forEach(function (f) { h.update(f + '\n'); h.update(fs.readFileSync(path.join(dir, f))); h.update('\n'); }); return h.digest('hex').slice(0, 10); }
let BUILD = buildOf(ROOT), pages = {};
// Every route this server answers (":file" is a picture or the video of the landing page). THE RULE: a browser may
// be running the page of the release before, so nothing here is taken away or changes its meaning in the release
// that stops using it; test/contract.cjs holds this list, and the fields of the calls the game makes, against the
// snapshot in test/contract.json.
const ROUTES = Object.keys(STATIC).filter(function (p) { return p.indexOf('/landing/') !== 0; }).map(function (p) { return 'GET ' + p; }).concat(['GET /landing/:file', 'GET /healthz',
  'GET /api/me', 'GET /api/world', 'GET /api/store', 'GET /api/confirm', 'GET /api/level', 'GET /api/levels', 'GET /api/frank', 'GET /api/board', 'GET /api/profile',
  'POST /api/track', 'POST /api/tokens', 'POST /api/secret', 'POST /api/earn', 'POST /api/heart', 'POST /api/score', 'POST /api/profile', 'POST /api/level/submit', 'POST /api/checkout',
  'POST /api/auth/google', 'POST /api/auth/apple', 'POST /api/auth/link', 'POST /api/logout', 'POST /api/delete-account', 'GET /auth/link', 'POST /auth/link',
  'POST /api/admin/login', 'POST /api/admin/logout', 'GET /api/admin/data', 'GET /api/admin/player', 'GET /api/admin/payments', 'POST /api/admin/campaign', 'POST /api/admin/tool',
  'POST /mcp', 'GET /.well-known/oauth-protected-resource', 'GET /.well-known/oauth-authorization-server', 'POST /oauth/register', 'GET /oauth/authorize', 'POST /oauth/authorize', 'POST /oauth/token']);

// ---------- the database ----------
// Postgres when DATABASE_URL is set, otherwise a SQLite file. Both are used through the same four calls, with
// "?" for values, and every query here is written in the SQL the two share.
const dataDir = env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const sqliteFile = path.join(dataDir, 'frank.db');
function openDb() {
  if (env.DATABASE_URL) {
    const pg = require('pg');
    pg.types.setTypeParser(20, Number); pg.types.setTypeParser(1700, Number);   // counts and sums come back as numbers
    // (DB_SCHEMA: the tests' own throwaway schema, when they run against a real Postgres; never set on the machine)
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5, options: /^\w+$/.test(env.DB_SCHEMA || '') ? '-c search_path=' + env.DB_SCHEMA : undefined });
    pool.on('error', function (e) { console.error('postgres:', e.message); });
    const num = function (sql) { let i = 0; return sql.replace(/\?/g, function () { return '$' + (++i); }); };
    const q = function (sql, p) { return pool.query(num(sql), p || []); };
    return { postgres: true, all: async function (s, p) { return (await q(s, p)).rows; }, get: async function (s, p) { return (await q(s, p)).rows[0] || null; },
      run: async function (s, p) { await q(s, p); }, exec: function (s) { return pool.query(s); },
      tx: async function (list) {
        const c = await pool.connect();
        try { await c.query('BEGIN'); for (const x of list) await c.query(num(x[0]), x[1] || []); await c.query('COMMIT'); }
        catch (e) { try { await c.query('ROLLBACK'); } catch (e2) { /* the connection is gone, and what it began with it */ } throw e; }
        finally { c.release(); }
      } };
  }
  const lite = new (require('node:sqlite').DatabaseSync)(sqliteFile);
  return { postgres: false, all: async function (s, p) { const st = lite.prepare(s); return st.all.apply(st, p || []); }, get: async function (s, p) { const st = lite.prepare(s); return st.get.apply(st, p || []) || null; },
    run: async function (s, p) { const st = lite.prepare(s); st.run.apply(st, p || []); }, exec: async function (s) { lite.exec(s); },
    tx: async function (list) {
      lite.exec('BEGIN');
      try { list.forEach(function (x) { const st = lite.prepare(x[0]); st.run.apply(st, x[1] || []); }); lite.exec('COMMIT'); } catch (e) { lite.exec('ROLLBACK'); throw e; }
    } };
}
// (tx: a list of [statement, values] done as one: all of them, or none)
const db = openDb();
// users: one row per account, and one per device that has no account yet (id "dev:<device id>"). uid = a users.id.
// idem: the answers given to what came with an Idempotency-Key, by player and key (once(), below).
// THE SCHEMA ONLY GROWS. The machine running the release before this one reads and writes this same database while
// the new one starts, and is what a rollback goes back to. So: a new table is added here (IF NOT EXISTS), a new column
// in ADDED (always one that may be empty), and nothing is taken away or given another name in the release that stops
// using it. What is no longer used goes in CLEANUP one release LATER, between its two marks, which is the only place
// such a statement may stand: --check refuses a build that has one anywhere else.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, created BIGINT, coins INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS unlocks (uid TEXT, frank INTEGER, session TEXT, created BIGINT, PRIMARY KEY (uid, frank));
  CREATE TABLE IF NOT EXISTS pending (session TEXT PRIMARY KEY, uid TEXT, frank INTEGER, created BIGINT);
  CREATE TABLE IF NOT EXISTS packs (uid TEXT, pack TEXT, session TEXT, created BIGINT, PRIMARY KEY (uid, pack));
  CREATE TABLE IF NOT EXISTS owned (uid TEXT, level TEXT, session TEXT, created BIGINT, PRIMARY KEY (uid, level));
  CREATE TABLE IF NOT EXISTS secrets (uid TEXT, level TEXT, secret TEXT, at BIGINT, PRIMARY KEY (uid, level, secret));
  CREATE TABLE IF NOT EXISTS purchases (session TEXT PRIMARY KEY, uid TEXT, kind TEXT, amount INTEGER, currency TEXT, email TEXT, live INTEGER, at BIGINT);
  CREATE TABLE IF NOT EXISTS devices (did TEXT PRIMARY KEY, first BIGINT, last BIGINT, src TEXT, ref TEXT, ua TEXT, uid TEXT, visits INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS runs (id ${db.postgres ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'}, did TEXT, uid TEXT, frank INTEGER, pct INTEGER, sec TEXT, secs REAL, tokens INTEGER, res TEXT, easy INTEGER, at BIGINT);
  CREATE INDEX IF NOT EXISTS runs_did ON runs (did);
  CREATE INDEX IF NOT EXISTS runs_frank ON runs (frank);
  CREATE TABLE IF NOT EXISTS levels (id TEXT PRIMARY KEY, name TEXT, author TEXT, spec TEXT, created BIGINT, plays INTEGER DEFAULT 0, ip TEXT, uid TEXT, status TEXT DEFAULT 'link', note TEXT);
  CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT, redirects TEXT, created BIGINT);
  CREATE TABLE IF NOT EXISTS oauth_codes (code TEXT PRIMARY KEY, client TEXT, uid TEXT, redirect TEXT, challenge TEXT, expires BIGINT);
  CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, uid TEXT, client TEXT, kind TEXT, expires BIGINT);
  CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, text TEXT, sub TEXT, url TEXT, color TEXT, live INTEGER DEFAULT 1, views BIGINT DEFAULT 0, clicks BIGINT DEFAULT 0);
  CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, name TEXT, frank TEXT, code TEXT UNIQUE, created BIGINT);
  CREATE TABLE IF NOT EXISTS franks (id TEXT PRIMARY KEY, name TEXT, spec TEXT, uid TEXT, created BIGINT);
  CREATE TABLE IF NOT EXISTS scores (level TEXT, uid TEXT, name TEXT, score INTEGER, pct INTEGER, at BIGINT, PRIMARY KEY (level, uid));
  CREATE INDEX IF NOT EXISTS scores_top ON scores (level, score);
  CREATE TABLE IF NOT EXISTS hearts (uid TEXT, level TEXT, created BIGINT, PRIMARY KEY (uid, level));
  CREATE TABLE IF NOT EXISTS campaigns (code TEXT PRIMARY KEY, note TEXT, created BIGINT, landings INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS email_links (hash TEXT PRIMARY KEY, email TEXT, back TEXT, created BIGINT, expires BIGINT, used BIGINT DEFAULT 0);
  CREATE INDEX IF NOT EXISTS email_links_email ON email_links (email);
  CREATE TABLE IF NOT EXISTS idem (uid TEXT, ikey TEXT, at BIGINT, code INTEGER, answer TEXT, PRIMARY KEY (uid, ikey));
  CREATE INDEX IF NOT EXISTS idem_at ON idem (at);
`;
// columns added since a table was first made: [table, column, type] (a new database has the first three from the
// start). runs.ikey: the Idempotency-Key a run was reported with, so that one sent twice is one run.
const ADDED = [['levels', 'uid', 'TEXT'], ['levels', 'status', "TEXT DEFAULT 'link'"], ['levels', 'note', 'TEXT'], ['runs', 'ikey', 'TEXT']];
const AFTER = 'CREATE UNIQUE INDEX IF NOT EXISTS runs_ikey ON runs (did, ikey) WHERE ikey IS NOT NULL;';   // (what needs an added column; only the runs that came with a key are in it)
const CLEANUP = [/* cleanup:begin (statements that remove what the release BEFORE this one stopped using; each is run once the schema is in place) */
/* cleanup:end */];
// The game used to keep everything in the SQLite file on its volume. The first time it starts on Postgres with
// that file still there and Postgres empty, every row is carried over and the file is set aside.
async function carryOver() {
  if (!db.postgres || !fs.existsSync(sqliteFile)) return;
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n || (await db.get('SELECT COUNT(*) AS n FROM devices')).n) return;
  const old = new (require('node:sqlite').DatabaseSync)(sqliteFile);
  const TABLES = ['users', 'unlocks', 'pending', 'packs', 'purchases', 'devices', 'runs', 'campaigns'];
  let moved = 0;
  try {
    for (const t of TABLES) {
      let rows = [];
      try { rows = old.prepare('SELECT * FROM ' + t).all(); } catch (e) { continue; }   // a table the old file never had
      for (const r of rows) {
        const keys = Object.keys(r).filter(function (k) { return !(t === 'runs' && k === 'id'); });
        await db.run('INSERT INTO ' + t + ' (' + keys.map(function (k) { return k === 'user' ? 'uid' : k; }).join(', ') + ') VALUES (' + keys.map(function () { return '?'; }).join(', ') + ') ON CONFLICT DO NOTHING',
          keys.map(function (k) { return typeof r[k] === 'bigint' ? Number(r[k]) : r[k]; }));
        moved++;
      }
    }
  } catch (e) {
    // all or nothing: a half-made copy is cleared, so the next start tries again from the untouched file
    await db.exec('TRUNCATE ' + TABLES.join(', '));
    throw e;
  }
  old.close();
  fs.renameSync(sqliteFile, sqliteFile + '.moved-to-postgres');
  console.log('carried ' + moved + ' rows from the SQLite file into Postgres');
}
// columns added to tables that were already there (ADDED)
async function addColumns() {
  for (const a of ADDED) {
    if (db.postgres) await db.exec('ALTER TABLE ' + a[0] + ' ADD COLUMN IF NOT EXISTS ' + a[1] + ' ' + a[2]);
    else if (!(await db.all('PRAGMA table_info(' + a[0] + ')')).some(function (c) { return c.name === a[1]; })) await db.exec('ALTER TABLE ' + a[0] + ' ADD COLUMN ' + a[1] + ' ' + a[2]);
  }
  await db.exec(AFTER);
  for (const s of CLEANUP) await db.exec(s);
}
const ready = Promise.resolve().then(function () { return db.exec(SCHEMA); }).then(addColumns).then(CHECK ? null : carryOver);   // (the check carries nothing over: it changes no row)
ready.catch(function () { /* said where it is awaited: every request, /healthz, --check, the start */ });

const clean = function (s, n) { return String(s == null ? '' : s).replace(/[^\w .:@/+()-]/g, '').slice(0, n); };
const codeOf = function (s) { s = String(s || '').toLowerCase(); return /^[a-z0-9_-]{1,40}$/.test(s) ? s : ''; };
const didOf = function (s) { s = String(s || ''); return /^[a-z0-9-]{8,40}$/i.test(s) ? s : ''; };

// ---------- who is asking: a signed-in account, or else the device ----------

function sign(v) { return crypto.createHmac('sha256', env.SESSION_SECRET).update(v).digest('base64url'); }
function sessionCookie(uid) {
  const v = Buffer.from(uid).toString('base64url') + '.' + (Date.now() + 365 * 864e5);
  return 'fff=' + v + '.' + sign(v) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000';
}
async function accountOf(req) {
  if (!env.SESSION_SECRET) return null;
  const m = /(?:^|;\s*)fff=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const p = m[1].split('.');
  if (p.length !== 3) return null;
  const want = Buffer.from(sign(p[0] + '.' + p[1])), got = Buffer.from(p[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got) || +p[1] < Date.now()) return null;
  return db.get('SELECT * FROM users WHERE id = ?', [Buffer.from(p[0], 'base64url').toString()]);
}
// No account is needed to play, collect tokens or earn Franks: until someone signs in (to pay), their device
// holds the wallet, as a "dev:" user. Signing in moves it all onto the account.
async function userOf(req, make) {
  const acct = await accountOf(req);
  if (acct) return acct;
  const did = didOf(req.headers['x-did']);
  if (!did) return null;
  const id = 'dev:' + did;
  if (make) await db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', [id, '', '', Date.now()]);
  return db.get('SELECT * FROM users WHERE id = ?', [id]);
}
const isAccount = function (u) { return !!u && u.id.indexOf('dev:') !== 0; };

// ---------- Google / Apple: verify the ID token the browser was given ----------

const jwks = {};
async function keysFrom(url) {
  if (!jwks[url] || jwks[url].at < Date.now() - 36e5) jwks[url] = { at: Date.now(), keys: (await (await fetch(url)).json()).keys };
  return jwks[url].keys;
}
async function verifyIdToken(token, url, issuers, audience) {
  const p = String(token || '').split('.');
  if (p.length !== 3 || !audience) throw new Error('bad token');
  const head = JSON.parse(Buffer.from(p[0], 'base64url')), body = JSON.parse(Buffer.from(p[1], 'base64url'));
  const jwk = (await keysFrom(url)).find(function (k) { return k.kid === head.kid; });
  if (!jwk || head.alg !== 'RS256') throw new Error('unknown key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(p[0] + '.' + p[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(p[2], 'base64url'));
  if (!ok || issuers.indexOf(body.iss) < 0 || body.aud !== audience || body.exp * 1000 < Date.now() || !body.sub) throw new Error('token refused');
  return body;
}
async function signIn(req, res, provider, claims, name) {
  let id = provider + ':' + claims.sub;
  name = name || claims.name || '';
  // An address Google vouches for is the same person as the account a sign-in link made for that address (see
  // "a sign-in link by email"): a Google account that is new here lands in that one instead of making a second.
  const mail = provider === 'google' && (claims.email_verified === true || claims.email_verified === 'true') ? String(claims.email || '').toLowerCase() : '';
  const made = mail && !await db.get('SELECT 1 AS x FROM users WHERE id = ?', [id]) && await db.get('SELECT id FROM users WHERE id = ?', ['email:' + mail]);
  if (made) { id = made.id; if (name) await db.run("UPDATE users SET name = ? WHERE id = ? AND name = ''", [name, id]); }
  else await db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', [id, claims.email_verified === false ? '' : claims.email || '', name, Date.now()]);   // only an address the provider vouches for is kept
  await enter(res, id, didOf(req.headers['x-did']));
}
// Signs this browser in to an account, however it proved who it is, and moves the device's things onto it.
async function enter(res, id, did) {
  // bring along what this device earned before it had an account
  const dev = did && await db.get('SELECT * FROM users WHERE id = ?', ['dev:' + did]);
  if (dev) {
    await db.run('UPDATE users SET coins = COALESCE(coins, 0) + ? WHERE id = ?', [dev.coins || 0, id]);
    await db.run('INSERT INTO unlocks (uid, frank, session, created) SELECT CAST(? AS TEXT), frank, session, created FROM unlocks WHERE uid = ? ON CONFLICT DO NOTHING', [id, dev.id]);
    await db.run('DELETE FROM unlocks WHERE uid = ?', [dev.id]);
    await db.run('INSERT INTO hearts (uid, level, created) SELECT CAST(? AS TEXT), level, created FROM hearts WHERE uid = ? ON CONFLICT DO NOTHING', [id, dev.id]);
    await db.run('DELETE FROM hearts WHERE uid = ?', [dev.id]);
    await db.run('INSERT INTO secrets (uid, level, secret, at) SELECT CAST(? AS TEXT), level, secret, at FROM secrets WHERE uid = ? ON CONFLICT DO NOTHING', [id, dev.id]);   // the hidden things it found
    await db.run('DELETE FROM secrets WHERE uid = ?', [dev.id]);
    await levels.moveTo(dev.id, id);                               // their levels, Franks, profile and scores too
    // and the answers its outbox was given: what the device still has waiting is sent as the account from here on (net.js)
    await db.run('INSERT INTO idem (uid, ikey, at, code, answer) SELECT CAST(? AS TEXT), ikey, at, code, answer FROM idem WHERE uid = ? ON CONFLICT DO NOTHING', [id, dev.id]);
    await db.run('DELETE FROM idem WHERE uid = ?', [dev.id]);
    await db.run('DELETE FROM users WHERE id = ?', [dev.id]);
  }
  if (did) { await db.run('UPDATE devices SET uid = ? WHERE did = ?', [id, did]); await db.run('UPDATE runs SET uid = ? WHERE did = ? AND uid IS NULL', [id, did]); }
  res.setHeader('Set-Cookie', sessionCookie(id));
}

// ---------- Stripe ----------

async function stripe(method, p, params) {
  const r = await fetch('https://api.stripe.com/v1' + p, {
    method: method, signal: AbortSignal.timeout(15000),             // an answer that never comes is no answer: it is asked again
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error('stripe: ' + (j.error && j.error.message || r.status)), { status: r.status });
  return j;
}
// Grant what this checkout bought if it really was paid by this user. Returns { level }, { pack } or { frank }, or null.
async function settle(sessionId, user) {
  const s = await stripe('GET', '/checkout/sessions/' + encodeURIComponent(sessionId)), m = s.metadata || {};
  if (m.app !== 'free-fall-frank' || m.user !== user.id) return null;
  if (s.payment_status !== 'paid') { if (s.status === 'expired') await db.run('DELETE FROM pending WHERE session = ?', [s.id]); return null; }
  const now = Date.now(), level = PAID[m.level] ? m.level : '', pack = !level && PACKS[m.pack] ? m.pack : '';
  // Paid for something this build does not know (a level or a pack sold by a later build, then a rollback): nothing
  // is granted in its place and the checkout stays open, so the build that knows it grants it (/api/me asks again).
  if (!level && !pack && !(/^\d{1,3}$/.test(String(m.frank)) && !m.level && !m.pack && +m.frank < FRANKS.length)) return null;
  if (level) {                                                      // a level: theirs for good, however often this is asked
    await db.run('INSERT INTO owned (uid, level, session, created) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [user.id, level, s.id, now]);
    await db.run('INSERT INTO purchases (session, uid, kind, amount, currency, email, live, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [s.id, user.id, 'level:' + level, s.amount_total || 0, s.currency || 'usd', (s.customer_details && s.customer_details.email) || user.email || '', s.livemode ? 1 : 0, now]);
    await db.run('DELETE FROM pending WHERE session = ?', [s.id]);
    return { level: level };
  }
  if (pack) await db.run('INSERT INTO packs (uid, pack, session, created) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [user.id, pack, s.id, now]);
  else await db.run('INSERT INTO unlocks (uid, frank, session, created) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [user.id, +m.frank, s.id, now]);
  await db.run('INSERT INTO purchases (session, uid, kind, amount, currency, email, live, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [s.id, user.id, pack ? 'pack:' + pack : 'frank:' + m.frank, s.amount_total || 0, s.currency || 'usd', (s.customer_details && s.customer_details.email) || user.email || '', s.livemode ? 1 : 0, now]);
  await db.run('DELETE FROM pending WHERE session = ?', [s.id]);
  return pack ? { pack: pack } : { frank: +m.frank };
}

// ---------- admin: one password, kept in ADMIN_PASSWORD ----------

const tries = {};                    // sign-in attempts and tracking calls per address, to slow down guessing and floods
function tooMany(req, kind, max, ms) { return tooManyOf(kind + ':' + (req.headers['fly-client-ip'] || 'local'), max, ms); }
function tooManyOf(k, max, ms) {                                    // the same count, for anything with a name (an email address)
  const now = Date.now(), t = tries[k] && tries[k].at > now - ms ? tries[k] : (tries[k] = { at: now, n: 0 });
  return ++t.n > max;
}
function adminCookie() { const exp = String(Date.now() + 7 * 864e5); return 'fffa=' + exp + '.' + sign('admin.' + exp) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800'; }
function isAdmin(req) {
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) return false;
  const m = /(?:^|;\s*)fffa=(\d+)\.([^;]+)/.exec(req.headers.cookie || '');
  if (!m || +m[1] < Date.now()) return false;
  const want = Buffer.from(sign('admin.' + m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const YES = function (cond) { return 'CASE WHEN ' + cond + ' THEN 1 ELSE 0 END'; };
async function adminData() {
  const now = Date.now(), one = async function (sql, p) { return Object.values(await db.get(sql, p))[0] || 0; };
  const overview = {
    players: await one('SELECT COUNT(*) AS n FROM devices'), players24: await one('SELECT COUNT(*) AS n FROM devices WHERE first > ?', [now - 864e5]), players7: await one('SELECT COUNT(*) AS n FROM devices WHERE first > ?', [now - 7 * 864e5]),
    active24: await one('SELECT COUNT(*) AS n FROM devices WHERE last > ?', [now - 864e5]),
    accounts: await one("SELECT COUNT(*) AS n FROM users WHERE id NOT LIKE 'dev:%'"),
    runs: await one('SELECT COUNT(*) AS n FROM runs'), runs24: await one('SELECT COUNT(*) AS n FROM runs WHERE at > ?', [now - 864e5]), secs: await one('SELECT COALESCE(SUM(secs), 0) AS n FROM runs'),
    buyers: await one('SELECT COUNT(DISTINCT uid) AS n FROM purchases WHERE live = 1'), revenue: await one('SELECT COALESCE(SUM(amount), 0) AS n FROM purchases WHERE live = 1'),
    earned: await one("SELECT COUNT(*) AS n FROM unlocks WHERE session = 'tokens'"),
  };
  // the last 14 days, one row per day (UTC), counted here from the rows themselves
  const days = {}, since = now - 14 * 864e5, dayOf = function (t) { return new Date(Number(t)).toISOString().slice(0, 10); };
  const bump = function (t, key, by) { const d = dayOf(t), o = days[d] = days[d] || { d: d, players: 0, runs: 0, secs: 0, signups: 0, revenue: 0, who: {} }; o[key] += by === undefined ? 1 : by; return o; };
  (await db.all('SELECT first FROM devices WHERE first > ?', [since])).forEach(function (r) { bump(r.first, 'players'); });
  (await db.all('SELECT at, did, secs FROM runs WHERE at > ?', [since])).forEach(function (r) { bump(r.at, 'runs').who[r.did] = 1; bump(r.at, 'secs', r.secs || 0); });
  (await db.all("SELECT created FROM users WHERE created > ? AND id NOT LIKE 'dev:%'", [since])).forEach(function (r) { bump(r.created, 'signups'); });
  (await db.all('SELECT at, amount FROM purchases WHERE at > ? AND live = 1', [since])).forEach(function (r) { bump(r.at, 'revenue', r.amount); });
  // every level: how much it is played and how far people get
  const deaths = {};
  (await db.all("SELECT frank, sec, COUNT(*) AS n FROM runs WHERE res != 'win' GROUP BY frank, sec ORDER BY n DESC")).forEach(function (r) { if (!deaths[r.frank]) deaths[r.frank] = r.sec + ' (' + r.n + ')'; });
  // what each thing for sale has sold (live payments only): the pack, and each paid level
  const sales = (await db.all('SELECT kind, COUNT(*) AS n, COUNT(DISTINCT uid) AS buyers, COALESCE(SUM(amount), 0) AS revenue FROM purchases WHERE live = 1 GROUP BY kind ORDER BY kind'))
    .map(function (r) { const k = String(r.kind).split(':'); return Object.assign(r, { name: k[0] === 'level' ? 'Level: ' + (PAID[k[1]] ? PAID[k[1]].name : k[1]) : k[0] === 'pack' ? (PACKS[k[1]] ? PACKS[k[1]].name : k[1]) : 'Frank ' + k[1] }); });
  const sold = {};
  sales.forEach(function (r) { sold[r.kind] = r; });
  // a paid level's plays without its owner's account are tastes: the wall is at the end of them (res "taste")
  const levels = (await db.all('SELECT frank, COUNT(*) AS plays, COUNT(DISTINCT did) AS players, ROUND(CAST(AVG(pct) AS REAL)) AS avg, MAX(pct) AS best, SUM(' + YES("res = 'win'") + ") AS clears, COUNT(DISTINCT CASE WHEN res = 'win' THEN did END) AS cleared, SUM(" + YES("res = 'taste'") + ') AS tastes, ROUND(SUM(secs)) AS secs FROM runs GROUP BY frank ORDER BY frank'))
    .map(function (r) { const w = worldNo(r.frank), s = w && sold['level:' + w]; return Object.assign(r, { name: nameOf(r.frank), dies: deaths[r.frank] || '' }, w ? { paid: true, purchases: s ? s.n : 0, revenue: s ? s.revenue : 0 } : null); });
  // the first level, stretch by stretch: how many players have ever got that far
  const L = CORE.buildLevel(CORE.specFor(0)), bests = (await db.all('SELECT MAX(pct) AS p FROM runs WHERE frank = 0 GROUP BY did')).map(function (r) { return r.p; });
  const funnel = L.sections.map(function (s, i) { const at = Math.floor(s.start / L.totalBeats * 100); return { n: i, key: s.key, at: at, players: bests.filter(function (p) { return p >= at; }).length }; });
  funnel.push({ n: L.sections.length, key: 'cleared', at: 100, players: bests.filter(function (p) { return p >= 100; }).length });
  const players = await db.all(`SELECT d.did, d.first, d.last, d.src, d.visits, d.uid, u.name, u.email,
      (SELECT COALESCE(w.coins, 0) FROM users w WHERE w.id = COALESCE(d.uid, 'dev:' || d.did)) AS coins,
      (SELECT COUNT(*) FROM runs r WHERE r.did = d.did) AS runs,
      (SELECT COALESCE(ROUND(SUM(r.secs)), 0) FROM runs r WHERE r.did = d.did) AS secs,
      (SELECT COALESCE(MAX(r.pct), 0) FROM runs r WHERE r.did = d.did) AS best,
      (SELECT COUNT(DISTINCT r.frank) FROM runs r WHERE r.did = d.did) AS levels,
      (SELECT COUNT(DISTINCT r.frank) FROM runs r WHERE r.did = d.did AND r.res = 'win') AS clears,
      (SELECT COUNT(*) FROM unlocks k WHERE k.uid = COALESCE(d.uid, 'dev:' || d.did)) AS franks,
      (SELECT COALESCE(SUM(p.amount), 0) FROM purchases p WHERE p.uid = d.uid AND p.live = 1) AS paid
    FROM devices d LEFT JOIN users u ON u.id = d.uid ORDER BY d.last DESC LIMIT 1000`);
  players.forEach(function (p) { p.coins = p.coins || 0; });
  const stats = await db.all(`SELECT COALESCE(d.src, '') AS src, COUNT(*) AS players,
      SUM(` + YES('(SELECT COUNT(*) FROM runs r WHERE r.did = d.did) > 0') + `) AS played,
      SUM(` + YES('(SELECT COUNT(*) FROM runs r WHERE r.did = d.did) >= 5') + `) AS stayed,
      SUM(` + YES('d.uid IS NOT NULL') + `) AS signed,
      SUM(` + YES('(SELECT COUNT(*) FROM purchases p WHERE p.uid = d.uid AND p.live = 1) > 0') + `) AS buyers,
      SUM((SELECT COALESCE(SUM(p.amount), 0) FROM purchases p WHERE p.uid = d.uid AND p.live = 1)) AS revenue,
      ROUND(SUM((SELECT COALESCE(SUM(r.secs), 0) FROM runs r WHERE r.did = d.did))) AS secs
    FROM devices d GROUP BY 1`);
  const bySrc = {};
  stats.forEach(function (s) { bySrc[s.src] = s; });
  const campaigns = (await db.all('SELECT * FROM campaigns ORDER BY created DESC')).map(function (c) { const s = bySrc[c.code] || {}; delete bySrc[c.code]; return Object.assign({ players: 0, played: 0, stayed: 0, signed: 0, buyers: 0, revenue: 0, secs: 0 }, s, c, { src: c.code }); });
  Object.keys(bySrc).forEach(function (k) { campaigns.push(Object.assign({ code: k, note: k ? '' : 'no link: came on their own', landings: null }, bySrc[k])); });
  return { now: now, site: PUBLIC_URL, database: db.postgres ? 'postgres' : 'sqlite', tokenPrice: TOKEN_PRICE, overview: overview,
    days: Object.keys(days).sort().reverse().map(function (d) { const o = days[d]; return { d: d, players: o.players, runs: o.runs, active: Object.keys(o.who).length, secs: Math.round(o.secs), signups: o.signups, revenue: o.revenue }; }),
    levels: levels, sales: sales, funnel: funnel, players: players, campaigns: campaigns };
}
function nameOf(frank) { const w = worldNo(frank); return w ? PAID[w].name : FRANKS[frank] ? FRANKS[frank].name : '?'; }   // a level by its number: a Frank's, or one of the paid ones
async function adminPlayer(did) {
  const d = await db.get('SELECT * FROM devices WHERE did = ?', [did]);
  if (!d) return null;
  const owner = d.uid || 'dev:' + did, named = function (r) { return Object.assign(r, { name: nameOf(r.frank) }); };
  return {
    device: d, account: d.uid ? await db.get('SELECT id, email, name, created, coins FROM users WHERE id = ?', [d.uid]) : null,
    coins: (await db.get('SELECT coins FROM users WHERE id = ?', [owner]) || {}).coins || 0,
    franks: (await db.all('SELECT frank, session, created FROM unlocks WHERE uid = ?', [owner])).map(named),
    packs: await db.all('SELECT pack, created FROM packs WHERE uid = ?', [owner]),
    owned: await db.all('SELECT level, created FROM owned WHERE uid = ?', [owner]), secrets: await db.all('SELECT level, secret, at FROM secrets WHERE uid = ?', [owner]),
    purchases: d.uid ? await db.all('SELECT * FROM purchases WHERE uid = ? ORDER BY at DESC', [d.uid]) : [],
    levels: (await db.all('SELECT frank, COUNT(*) AS plays, MAX(pct) AS best, ROUND(CAST(AVG(pct) AS REAL)) AS avg, SUM(' + YES("res = 'win'") + ') AS clears, ROUND(SUM(secs)) AS secs, MAX(at) AS last FROM runs WHERE did = ? GROUP BY frank ORDER BY frank', [did])).map(named),
    runs: await db.all('SELECT frank, pct, sec, secs, tokens, res, easy, at FROM runs WHERE did = ? ORDER BY at DESC LIMIT 100', [did]),
  };
}
// the game's checkouts as Stripe has them: paid, abandoned and expired, with Stripe's own fee where it is known
async function adminPayments() {
  const out = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const r = await stripe('GET', '/checkout/sessions?limit=100&expand[]=data.payment_intent.latest_charge.balance_transaction' + (after ? '&starting_after=' + after : ''));
    r.data.forEach(function (s) {
      const m = s.metadata || {};
      if (m.app !== 'free-fall-frank') return;
      const ch = s.payment_intent && s.payment_intent.latest_charge, bt = ch && ch.balance_transaction;
      out.push({ id: s.id, at: s.created * 1000, paid: s.payment_status === 'paid', state: s.payment_status === 'paid' ? 'paid' : s.status === 'expired' ? 'abandoned' : 'open', amount: s.amount_total || 0,
        email: (s.customer_details && s.customer_details.email) || s.customer_email || '', user: m.user || '', what: m.level ? 'Level: ' + (PAID[m.level] ? PAID[m.level].name : m.level) : m.pack ? (PACKS[m.pack] ? PACKS[m.pack].name : m.pack) : 'Frank ' + m.frank, live: !!s.livemode,
        fee: bt && typeof bt === 'object' ? bt.fee : null, net: bt && typeof bt === 'object' ? bt.net : null, refunded: ch && typeof ch === 'object' ? ch.amount_refunded || 0 : 0 });
    });
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return out;
}

// ---------- routes ----------

function json(res, code, obj) {
  if (res.keep) return res.keep(code, obj);                         // inside once(): the answer is written down before it is given
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// ONCE: what the page's outbox sends comes with an Idempotency-Key (net.js makes one for each thing and sends it
// again until it is answered: the machine may have been asleep, or restarting under a deploy). The first answer is
// kept for that player and key, and a repeat is given it without the work being done again. Two that arrive together
// wait on the one piece of work. An answer that says come back (401, 408, 429, ours going wrong) is not kept. The
// work is handed a stand-in for the answer: json() fills it, and note() gives the statement that writes the answer
// down, for work that has to keep it in the same breath as what it does (the tokens: db.tx). Notes are kept longer
// than the outbox keeps what it has not delivered (30 days), so a repeat never outlives its note.
// With no key (the page of the release before), each is done as it always was.
const IKEY = /^[A-Za-z0-9_-]{8,64}$/, ONCE = ['/api/tokens', '/api/secret', '/api/heart', '/api/score', '/api/profile'], NOTE_MS = 35 * 864e5, flying = {};
const NOTE = 'INSERT INTO idem (uid, ikey, at, code, answer) VALUES (?, ?, ?, ?, ?)';
let swept = 0;
async function once(req, res, uid, work) {
  const k = String(req.headers['idempotency-key'] || ''), id = uid + ' ' + k;
  if (req.method !== 'POST' || !uid || !IKEY.test(k)) return work(res);
  const first = async function () {
    const was = await db.get('SELECT code, answer FROM idem WHERE uid = ? AND ikey = ?', [uid, k]);
    if (was) return { code: was.code, body: JSON.parse(was.answer), again: true };
    const cap = { ikey: k, out: null, noted: false, setHeader: function () {}, keep: function (code, obj) { cap.out = { code: code, body: obj }; },
      note: function (code, obj) { cap.noted = true; return [NOTE, [uid, k, Date.now(), code, JSON.stringify(obj)]]; } };
    await work(cap);
    const out = cap.out || { code: 404, body: { error: 'not found' } };
    if (!cap.noted && out.code < 500 && [401, 408, 429].indexOf(out.code) < 0) await db.run(NOTE + ' ON CONFLICT DO NOTHING', cap.note(out.code, out.body)[1]);
    if (Date.now() - swept > 6e5) { swept = Date.now(); db.run('DELETE FROM idem WHERE at < ?', [swept - NOTE_MS]).catch(function (e) { console.error('idem:', e.message); }); }
    return out;
  };
  const mine = !flying[id], out = await (flying[id] || (flying[id] = first().finally(function () { delete flying[id]; })));
  if (out.again || !mine) res.setHeader('Idempotent-Replay', 'true');
  json(res, out.code, out.body);
}
function body(req, max) {
  return new Promise(function (resolve, reject) {
    let s = '';
    req.on('data', function (c) { s += c; if (s.length > (max || 20000)) reject(new Error('too big')); });
    req.on('end', function () { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
// each world's track (its tempo), read from the file the game loads
const TRACKS = (function () { const w = {}; try { new Function('window', fs.readFileSync(path.join(__dirname, 'music/tracks.js'), 'utf8'))(w); } catch (e) { /* no tracks: the levels' own tempo */ } return w.FFFTracks || {}; })();
// an ad link: /?src=<code>, with a note saying what it is for
async function setCampaign(code, note) {
  code = codeOf(code);
  if (!code) throw new Error('use letters, numbers, - and _ only');
  await db.run('INSERT INTO campaigns (code, note, created, landings) VALUES (?, ?, ?, 0) ON CONFLICT (code) DO UPDATE SET note = excluded.note', [code, clean(note, 120), Date.now()]);
  return { ok: true, link: PUBLIC_URL + '/?src=' + code };
}
// The admin is a person: whoever signs in as one of these addresses (ADMIN_EMAILS, comma separated), with Google
// or with a link sent to that address (opening it proves the mailbox is theirs, as Google's word does).
// In the connector that account gets the reviewer's tools; on /admin it needs no password.
const ADMINS = String(env.ADMIN_EMAILS || 'support@glyphh.ai').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
function isAdminUser(u) { return !!u && /^(google|email):/.test(String(u.id)) && ADMINS.indexOf(String(u.email || '').toLowerCase()) >= 0; }
async function isAdminUid(uid) { return isAdminUser(uid && await db.get('SELECT id, email FROM users WHERE id = ?', [uid])); }
// Who has a paid level: the account that bought it, and the admin (signed in as the admin, or with the admin password).
async function owns(user, id, req) {
  if (!PAID[id]) return false;
  if (isAdminUser(user) || (req && isAdmin(req))) return true;
  return isAccount(user) && !!await db.get('SELECT 1 AS x FROM owned WHERE uid = ? AND level = ?', [user.id, id]);
}
// the most a run of a paid level can score: all the way down, every token, cleared, at insane (game.js report)
const maxScore = function (id) { return (15000 + 10 * capOfWorld(id, true)) * 2; };

// ---------- a sign-in link by email ----------
// She types her address, a link is emailed to it (through Resend), and opening it and pressing the button there signs
// that browser in, whichever browser or device it is: whoever can read the mailbox is that address's account. Only
// the SHA-256 of a link's token is kept, a link works once and for 15 minutes, and no token or link is ever logged.
const LINK_MS = 15 * 6e4, LINK_LIVE = 3;                            // how long a link lasts, and how many unused ones an address may have
const linkOn = function () { return !!(env.RESEND_API_KEY && env.SESSION_SECRET); };
const sha = function (s) { return crypto.createHash('sha256').update(String(s)).digest('base64url'); };
const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
// an address as it is kept (lower case), or '' when it is not one
function emailOf(s) {
  s = String(s || '').trim().toLowerCase();
  return s.length <= 254 && s.indexOf('@') <= 64 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s) && s.indexOf('..') < 0 ? s : '';
}
// where a link returns to: a path on this site and nothing else (never another site's address); otherwise the game
function backOf(s) {
  s = String(s || '');
  if (!/^\/(?!\/)[\x21-\x7e]*$/.test(s) || s.indexOf('\\') >= 0 || s.length > 4000) return '/play';
  try { return new URL(s, 'https://x.invalid').origin === 'https://x.invalid' ? s : '/play'; } catch (e) { return '/play'; }
}
// The account an address proven by a link signs in to: the one a link made before, or the Google account with
// that same address (kept only when Google vouched for it), or else a new one, "email:<address>".
async function accountFor(email) {
  const id = 'email:' + email;
  const had = await db.get('SELECT id FROM users WHERE id = ?', [id]) || await db.get("SELECT id FROM users WHERE id LIKE 'google:%' AND LOWER(email) = ? ORDER BY created LIMIT 1", [email]);
  if (had) return had.id;
  await db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', [id, email, '', Date.now()]);
  return id;
}
// the email: plain, in tables with its styles inline (mail programs drop the rest), no pictures and nothing that tracks
function linkEmail(link) {
  const font = 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif', mono = "font-family:'Courier New',Courier,monospace", href = esc(link);
  return {
    subject: 'Your sign-in link for Free Fall Frank',
    text: 'FREE FALL FRANK\n\nFrank is waiting on the ledge. Open this link to sign in:\n\n' + link + '\n\nIt works once and expires in 15 minutes.\nIf you did not ask for this, ignore it: nobody gets in without the link.\n\nFree Fall Frank\nhttps://freefallfrank.com\n',
    html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Your sign-in link for Free Fall Frank</title></head>' +
      '<body style="margin:0;padding:0;background-color:#1a1147"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a1147" style="background-color:#1a1147"><tr><td align="center" style="padding:32px 14px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px">' +
      '<tr><td align="center" style="' + mono + ';font-weight:bold;font-size:15px;line-height:20px;color:#35e8ff;letter-spacing:1px">FREE FALL</td></tr>' +
      '<tr><td align="center" style="' + mono + ';font-weight:bold;font-size:34px;line-height:38px;color:#ffd23f;padding-bottom:20px">FRANK</td></tr>' +
      '<tr><td bgcolor="#1c1830" style="background-color:#1c1830;border:3px solid #0a0812;padding:26px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
      '<tr><td align="center" style="' + font + ';font-size:17px;line-height:25px;color:#f1eefc;padding-bottom:22px">Frank is waiting on the ledge. Press the button to sign in.</td></tr>' +
      '<tr><td align="center" style="padding-bottom:22px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ff4fd8" style="background-color:#ff4fd8;border:3px solid #0a0812">' +
      '<a href="' + href + '" style="display:inline-block;padding:15px 34px;' + mono + ';font-weight:bold;font-size:20px;line-height:24px;color:#ffffff;text-decoration:none">SIGN IN</a></td></tr></table></td></tr>' +
      '<tr><td align="center" style="' + font + ';font-size:14px;line-height:21px;color:#b9b4d0;padding-bottom:6px">Or copy this link into your browser:</td></tr>' +
      '<tr><td align="center" style="' + font + ';font-size:13px;line-height:19px;padding-bottom:20px;word-break:break-all"><a href="' + href + '" style="color:#35e8ff">' + href + '</a></td></tr>' +
      '<tr><td align="center" style="' + font + ';font-size:14px;line-height:21px;color:#b9b4d0">It works once and expires in 15 minutes.<br>If you did not ask for this, ignore it: nobody gets in without the link.</td></tr>' +
      '</table></td></tr>' +
      '<tr><td align="center" style="' + font + ';font-size:13px;line-height:19px;color:#b9b4d0;padding-top:18px">Free Fall Frank &middot; <a href="https://freefallfrank.com" style="color:#b9b4d0">freefallfrank.com</a></td></tr>' +
      '</table></td></tr></table></body></html>',
  };
}
async function sendLink(to, link) {
  const m = linkEmail(link);
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Free Fall Frank <support@glyphh.ai>', to: [to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!r.ok) throw new Error('resend said ' + r.status);
}
// POST /api/auth/link { email, back }: email her a link. The answer is the same whether or not the address has an account.
async function askLink(req, res) {
  if (!linkOn()) return json(res, 503, { error: 'email sign-in is not set up' });
  const b = await body(req), email = emailOf(b.email), now = Date.now();
  if (!email) return json(res, 400, { error: 'that does not look like an email address' });
  if (tooMany(req, 'link', 20, 36e5) || tooManyOf('linkto:' + email, 5, 36e5)) return json(res, 429, { error: 'too many links asked for, wait a while and try again' });
  await db.run('DELETE FROM email_links WHERE expires < ?', [now - 864e5]);
  if ((await db.get('SELECT COUNT(*) AS n FROM email_links WHERE email = ? AND used = 0 AND expires > ?', [email, now])).n >= LINK_LIVE) return json(res, 429, { error: 'links were just sent to that address: use the newest, or wait 15 minutes' });
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('INSERT INTO email_links (hash, email, back, created, expires, used) VALUES (?, ?, ?, ?, ?, 0)', [sha(token), email, backOf(b.back), now, now + LINK_MS]);
  try { await sendLink(email, originOf(req) + '/auth/link?token=' + token); }
  catch (e) {
    await db.run('DELETE FROM email_links WHERE hash = ?', [sha(token)]);
    console.error('email:', e.message);
    return json(res, 502, { error: 'the email could not be sent, try again' });
  }
  return json(res, 200, { ok: true });
}
// /auth/link, where an emailed link leads. Mail scanners and link previews fetch every address in an email, so
// opening the link (GET) only shows a page with a button; pressing it (POST) is what spends the link and signs in.
async function linkPage(req, res, url) {
  await ready;
  const post = req.method === 'POST', f = post ? await oauth.form(req) : {}, token = String(post ? f.token || '' : url.searchParams.get('token') || ''), now = Date.now();
  const html = function (code, title, inner) { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); res.end(oauth.page(title, inner)); };
  const row = /^[\w-]{43}$/.test(token) ? await db.get('SELECT * FROM email_links WHERE hash = ?', [sha(token)]) : null, back = row ? backOf(row.back) : '/play';
  // a link that is no good: say so, and offer a new one (or the way on, to someone who is signed in already)
  const sorry = async function (why) {
    const inn = await accountOf(req);
    html(400, 'Free Fall Frank', '<div class="card"><p><b>' + why + '</b></p>' + (inn ? '<p class="dim">You are signed in already.</p><p><a class="btn" href="' + esc(back) + '">CARRY ON</a></p>'
      : '<p class="dim">A sign-in link works once, for 15 minutes.' + (linkOn() ? ' Ask for a new one:</p>' + oauth.linkForm(back, 'EMAIL ME A NEW LINK') : '</p>') + '<p class="dim"><a href="/play">Back to the game</a></p>') + '</div>');
  };
  if (tooMany(req, 'linkuse', 120, 6e5)) return html(429, 'Free Fall Frank', '<div class="card"><p class="err">Too many tries. Wait ten minutes.</p></div>');
  if (!row) return sorry('That sign-in link is not one of ours.');
  if (row.used) return sorry('That sign-in link has been used.');
  if (Number(row.expires) <= now) return sorry('That sign-in link has run out.');
  if (!post) {
    return html(200, 'Sign in to Free Fall Frank', '<div class="card"><p>Sign in to Free Fall Frank as</p><p><b>' + esc(row.email) + '</b></p>' +
      '<form method="post" action="/auth/link"><input type="hidden" name="token" value="' + esc(token) + '"><input type="hidden" name="did" id="did"><button>SIGN IN</button></form>' +
      '<p class="dim">Did not ask for this? Close the page and nothing happens.</p></div>' +
      '<script>try { document.getElementById("did").value = localStorage.getItem("fff.did") || ""; } catch (e) { /* no device id: nothing to bring along */ }</script>');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') return sorry('That did not come from this page. Open the link in your email again.');   // another site may not press the button for her
  const got = await db.get('UPDATE email_links SET used = ? WHERE hash = ? AND used = 0 AND expires > ? RETURNING email', [now, row.hash, now]);   // a link is good once, however many presses race
  if (!got) return sorry('That sign-in link has been used.');
  await enter(res, await accountFor(got.email), didOf(f.did));
  res.writeHead(303, { Location: back, 'Cache-Control': 'no-store' });
  res.end();
}
const oauth = require('./oauth.js')({ db: db, ready: ready, tooMany: tooMany, site: 'https://freefallfrank.com', env: env, linkOn: linkOn });   // signing in to the connector
const levels = require('./levels.js')({ worldOf: function (id) { return PAID[id] ? { id: id, name: PAID[id].name, paid: true } : null; }, owns: owns, maxScore: maxScore, playerOf: oauth.playerOf, challenge: oauth.challenge, isAdminUid: isAdminUid, adminData: adminData, adminPlayer: adminPlayer, adminPayments: adminPayments, setCampaign: setCampaign, db: db, ready: ready, json: json, body: body, tooMany: tooMany, FRANKS: FRANKS, CORE: CORE, TRACKS: TRACKS, site: 'https://freefallfrank.com', adminKey: env.ADMIN_MCP_KEY });
const seeded = ready.then(function () { return CHECK ? null : levels.seedAds(); }).catch(function (e) { console.error('ads:', e.message); });   // the first sponsor is the game's maker (the check adds no row)
const int = function (v, lo, hi) { v = Math.round(+v); return v >= lo && v <= hi ? v : null; };

let storeCheck = null;
async function api(req, res, url) {
  await ready; await seeded;
  const route = req.method + ' ' + url.pathname;

  // ----- admin -----
  if (route === 'POST /api/admin/login') {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json(res, 503, { error: 'the admin password is not set' });
    if (tooMany(req, 'login', 10, 6e5)) return json(res, 429, { error: 'too many tries, wait ten minutes' });
    const given = Buffer.from(String((await body(req)).password || '')), want = Buffer.from(env.ADMIN_PASSWORD);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return json(res, 401, { error: 'wrong password' });
    res.setHeader('Set-Cookie', adminCookie());
    return json(res, 200, { ok: true });
  }
  if (url.pathname.indexOf('/api/admin/') === 0) {
    if (!isAdmin(req) && !isAdminUser(await accountOf(req))) return json(res, 401, { error: 'sign in' });   // the password, or signed in to the game as the admin
    if (route === 'GET /api/admin/data') return json(res, 200, await adminData());
    if (route === 'GET /api/admin/player') { const p = await adminPlayer(didOf(url.searchParams.get('did'))); return p ? json(res, 200, p) : json(res, 404, { error: 'no such player' }); }
    if (route === 'GET /api/admin/payments') { try { return json(res, 200, { payments: await adminPayments() }); } catch (e) { return json(res, 200, { payments: [], error: String(e.message).slice(0, 200) }); } }
    if (route === 'POST /api/admin/campaign') {
      const b = await body(req);
      try { return json(res, 200, await setCampaign(b.code, b.note)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // the reviewer's tools (levels to review, sponsors, and the rest), the same ones the connector has, for the admin page
    if (route === 'POST /api/admin/tool') {
      const b = await body(req);
      try { return json(res, 200, await levels.adminTool(String(b.name || ''), b.args || {}, req)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (route === 'POST /api/admin/logout') { res.setHeader('Set-Cookie', 'fffa=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'not found' });
  }

  // ----- what the game records: a visit (with the ad link it came from) and each attempt at a level -----
  // (a run that comes with a key, from the outbox, is one run however often it is sent: once(), and runs.ikey)
  if (route === 'POST /api/track') return once(req, res, didOf(req.headers['x-did']) && 'dev:' + didOf(req.headers['x-did']), async function (res) {
    if (tooMany(req, 'track', 300, 6e4)) return json(res, 429, {});
    const b = await body(req), did = didOf(b.did), now = Date.now(), acct = await accountOf(req), uid = acct ? acct.id : null;
    if (!did) return json(res, 400, {});
    const src = codeOf(b.src);
    // the link a player first arrived by stays with them for good
    await db.run('INSERT INTO devices (did, first, last, src, ref, ua, uid, visits) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT DO NOTHING', [did, now, now, src, clean(b.ref, 80), clean(req.headers['user-agent'], 160), uid]);
    await db.run('UPDATE devices SET last = ?, uid = COALESCE(?, uid) WHERE did = ?', [now, uid, did]);
    if (b.t === 'visit') {
      await db.run('UPDATE devices SET visits = visits + 1 WHERE did = ?', [did]);
      if (src) { await db.run('INSERT INTO campaigns (code, note, created, landings) VALUES (?, ?, ?, 0) ON CONFLICT DO NOTHING', [src, '', now]); await db.run('UPDATE campaigns SET landings = landings + 1 WHERE code = ?', [src]); }
    } else if (b.t === 'run') {
      const frank = worldNo(+b.frank) ? +b.frank : int(b.frank, 0, FRANKS.length - 1), pct = int(b.pct, 0, 100), secs = +b.secs;
      if (frank === null || pct === null || !(secs >= 0 && secs < 3600)) return json(res, 400, {});
      await db.run('INSERT INTO runs (did, uid, frank, pct, sec, secs, tokens, res, easy, at, ikey) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        [did, uid, frank, pct, clean(b.sec, 16), Math.round(secs * 10) / 10, int(b.tokens, 0, 5000) || 0, clean(b.res, 8), b.easy ? 1 : 0, now, res.ikey || null]);
    }
    else if (b.t === 'ad') await levels.adHit(b.ad, b.k);           // a run that showed a sponsor's signs, or a tap on its link
    return json(res, 200, { ok: true });
  });

  // ----- the game -----
  const user = await userOf(req, req.method === 'POST'), acct = isAccount(user) ? user : null;
  if (ONCE.indexOf(url.pathname) >= 0) {
    // what the outbox sends says whose it is (X-As): never one player's things as another's (another account has signed in since)
    const as = req.headers['idempotency-key'] && req.headers['x-as'];
    if (as && user && as !== user.id) return json(res, 409, { error: 'that was kept for somebody else', id: user.id });
    return once(req, res, user && user.id, function (res) { return game(req, res, url, route, user, acct); });
  }
  return game(req, res, url, route, user, acct);
}
async function game(req, res, url, route, user, acct) {
  if (await levels.routes(req, res, url, route, user, function () { return userOf(req, true); })) return;   // made levels and Franks, profiles, leaderboards
  if (route === 'GET /api/me') {
    if (acct && env.STRIPE_SECRET_KEY) {
      // a checkout that was paid but never came back to the game still counts
      const open = await db.all('SELECT session FROM pending WHERE uid = ?', [acct.id]);
      for (let i = 0; i < open.length; i++) { try { await settle(open[i].session, acct); } catch (e) { /* try again next time */ } }
    }
    const hearts = {}, mine = user ? (await db.all('SELECT level FROM hearts WHERE uid = ?', [user.id])).map(function (r) { return r.level; }) : [];
    LEVEL_IDS.forEach(function (id) { hearts[id] = { n: 0, mine: mine.indexOf(id) >= 0 }; });
    (await db.all('SELECT level, COUNT(*) AS n FROM hearts GROUP BY level')).forEach(function (r) { if (hearts[r.level]) hearts[r.level].n = r.n; });
    // the paid levels: what each costs, whether it is theirs, and which of its hidden things they have found (only how many there are is told)
    const paidLevels = {}, found = user ? await db.all('SELECT level, secret FROM secrets WHERE uid = ?', [user.id]) : [];
    for (const id of Object.keys(PAID)) paidLevels[id] = { name: PAID[id].name, price: PAID[id].price, owned: await owns(user, id, req), secrets: PAID[id].secrets.length, found: found.filter(function (r) { return r.level === id; }).map(function (r) { return r.secret; }) };
    return json(res, 200, {
      hearts: hearts, ads: await levels.adsLive(), levels: paidLevels, secretTokens: SECRET_TOKENS,
      build: BUILD, id: user ? user.id : null,                      // id: whose wallet this is (the account's, or the device's): what the outbox files things under
      user: acct ? { name: acct.name, email: acct.email } : null,
      unlocked: user ? (await db.all('SELECT frank FROM unlocks WHERE uid = ?', [user.id])).map(function (r) { return r.frank; }) : [],
      packs: acct ? (await db.all('SELECT pack FROM packs WHERE uid = ?', [acct.id])).map(function (r) { return r.pack; }) : [],
      free: FREE, pack: { id: 'classic', name: PACKS.classic.name, price: PACKS.classic.price, from: PACKS.classic.from, to: PACKS.classic.to },
      price: PACKS.classic.price, tokenPrice: TOKEN_PRICE, coins: user ? user.coins || 0 : 0,
      google: env.SESSION_SECRET && env.GOOGLE_CLIENT_ID || null, apple: env.SESSION_SECRET && env.APPLE_SERVICE_ID || null,
      link: linkOn(), store: !!env.STRIPE_SECRET_KEY,                // link: a sign-in link by email is on offer
    });
  }
  if (route === 'GET /api/world') {
    // A paid level's stretches, for the game to build: all of them for its owner (and the admin), the taste for anyone else.
    const id = String(url.searchParams.get('id') || ''), w = WORLDS[id];
    if (!w) return json(res, 404, { error: 'no such level' });
    const mine = await owns(user, id, req);
    // (v: the version these stretches are written in, CORE.WORLD_V; a page that cannot read it reloads into the build that can)
    return json(res, 200, { id: id, name: w.name, price: PAID[id].price, owned: mine, taste: !mine, v: CORE.WORLD_V, spec: mine ? w.full : w.taste });
  }
  if (route === 'POST /api/auth/link') return askLink(req, res);
  if (route === 'POST /api/auth/google' || route === 'POST /api/auth/apple') {
    if (!env.SESSION_SECRET) return json(res, 503, { error: 'sign-in is not set up' });
    const b = await body(req);
    let claims;
    try {
      claims = route.endsWith('google')
        ? await verifyIdToken(b.credential, 'https://www.googleapis.com/oauth2/v3/certs', ['https://accounts.google.com', 'accounts.google.com'], env.GOOGLE_CLIENT_ID)
        : await verifyIdToken(b.id_token, 'https://appleid.apple.com/auth/keys', ['https://appleid.apple.com'], env.APPLE_SERVICE_ID);
    } catch (e) { return json(res, 401, { error: 'sign-in failed' }); }
    await signIn(req, res, route.endsWith('google') ? 'google' : 'apple', claims, route.endsWith('google') ? '' : String(b.name || '').slice(0, 80));
    return json(res, 200, { ok: true });
  }
  if (route === 'GET /api/store') {
    // is the store's key accepted by Stripe, and is it a live one? Says yes or no, nothing else; asked at most every ten minutes.
    if (!storeCheck || storeCheck.at < Date.now() - 6e5) {
      storeCheck = { at: Date.now(), ok: false, live: false };
      try { const r = await stripe('GET', '/checkout/sessions?limit=1'); storeCheck.ok = true; storeCheck.live = r.data.length ? !!r.data[0].livemode : /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || ''); }
      catch (e) { storeCheck.error = String(e.message).slice(0, 120); }
    }
    return json(res, 200, { ok: storeCheck.ok, live: storeCheck.live, error: storeCheck.error });
  }
  if (route === 'POST /api/logout') {
    res.setHeader('Set-Cookie', 'fff=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (!user) return json(res, 401, { error: 'no player' });

  // hearts, tokens and earning a Frank with them need no account: the device will do
  if (route === 'POST /api/heart') {
    const b = await body(req);
    if (LEVEL_IDS.indexOf(b.level) < 0 && !await levels.levelOf(b.level)) return json(res, 400, { error: 'no such level' });
    if (b.on) await db.run('INSERT INTO hearts (uid, level, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [user.id, b.level, Date.now()]);
    else await db.run('DELETE FROM hearts WHERE uid = ? AND level = ?', [user.id, b.level]);
    return json(res, 200, { ok: true, n: (await db.get('SELECT COUNT(*) AS n FROM hearts WHERE level = ?', [b.level])).n });
  }
  if (route === 'POST /api/tokens') {
    // bank what a run picked up; one run can never hold more than its level does
    const b = await body(req);
    const world = worldNo(b.frank);                                 // a paid level's tokens: as many as the part of it this player can reach holds
    if (!Number.isInteger(b.frank) || b.frank < 0 || (b.frank >= FRANKS.length && !world) || !Number.isInteger(b.count) || b.count < 0) return json(res, 400, { error: 'bad tokens' });
    const add = Math.min(b.count, world ? capOfWorld(world, await owns(user, world, req)) : capOf(b.frank)), coins = (user.coins || 0) + add;
    // (with a key: the tokens and the note that they were banked are one thing, so a machine stopped between the two has done neither)
    const bank = ['UPDATE users SET coins = COALESCE(coins, 0) + ? WHERE id = ?', [add, user.id]];
    if (res.note) await db.tx([res.note(200, { coins: coins }), bank]); else await db.run(bank[0], bank[1]);
    return json(res, 200, { coins: coins });
  }
  if (route === 'POST /api/secret') {
    // a hidden thing found in a paid level: kept for the player (device or account), and worth tokens the first time.
    // Only one that is in the part of the level this player can reach counts.
    if (tooMany(req, 'secret', 60, 6e4)) return json(res, 429, {});
    const b = await body(req), id = String(b.level || ''), sid = String(b.id || '');
    if (!PAID[id] || (await owns(user, id, req) ? PAID[id].secrets : tasteIds(id)).indexOf(sid) < 0) return json(res, 400, { error: 'no such secret' });
    const first = !await db.get('SELECT 1 AS x FROM secrets WHERE uid = ? AND level = ? AND secret = ?', [user.id, id, sid]);
    // (the find and its tokens are one thing; found twice at the same moment, the second is refused whole and asked again)
    if (first) await db.tx([['INSERT INTO secrets (uid, level, secret, at) VALUES (?, ?, ?, ?)', [user.id, id, sid, Date.now()]], ['UPDATE users SET coins = COALESCE(coins, 0) + ? WHERE id = ?', [SECRET_TOKENS, user.id]]]);
    const found = (await db.all('SELECT secret FROM secrets WHERE uid = ? AND level = ?', [user.id, id])).map(function (r) { return r.secret; });
    return json(res, 200, { ok: true, first: first, tokens: first ? SECRET_TOKENS : 0, coins: (user.coins || 0) + (first ? SECRET_TOKENS : 0), found: found, secrets: PAID[id].secrets.length });
  }
  if (route === 'POST /api/earn') {
    const frank = (await body(req)).frank;
    if (!Number.isInteger(frank) || frank >= FRANKS.length || FREE.indexOf(frank) >= 0 || frank < 0) return json(res, 400, { error: 'that Frank cannot be earned' });
    if (await db.get('SELECT 1 AS x FROM unlocks WHERE uid = ? AND frank = ?', [user.id, frank])) return json(res, 400, { error: 'you already have him' });
    if ((user.coins || 0) < TOKEN_PRICE) return json(res, 400, { error: 'not enough tokens' });
    // (the Frank and the tokens he costs are one thing: a machine stopped between the two has taken no tokens for nothing)
    await db.tx([['INSERT INTO unlocks (uid, frank, session, created) VALUES (?, ?, ?, ?)', [user.id, frank, 'tokens', Date.now()]], ['UPDATE users SET coins = coins - ? WHERE id = ?', [TOKEN_PRICE, user.id]]]);
    return json(res, 200, { ok: true, coins: user.coins - TOKEN_PRICE });
  }

  // paying is the one thing that needs an account
  if (!acct) return json(res, 401, { error: 'sign in first' });
  if (route === 'POST /api/delete-account') {
    for (const t of ['unlocks', 'pending', 'packs', 'hearts', 'owned', 'secrets']) await db.run('DELETE FROM ' + t + ' WHERE uid = ?', [acct.id]);
    await db.run('DELETE FROM users WHERE id = ?', [acct.id]);
    if (acct.email) await db.run('DELETE FROM email_links WHERE email = ?', [String(acct.email).toLowerCase()]);   // and any sign-in link still out for it
    res.setHeader('Set-Cookie', 'fff=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (route === 'POST /api/checkout') {
    if (!env.STRIPE_SECRET_KEY) return json(res, 503, { error: 'the store is not set up' });
    const b = await body(req);
    if (b.level !== undefined) {
      // a paid level: one payment, once. The checkout comes back the same way the pack's does (/?paid=), and a cancelled one to the level's card.
      const lv = PAID[String(b.level)];
      if (!lv) return json(res, 400, { error: 'no such level' });
      if (await db.get('SELECT 1 AS x FROM owned WHERE uid = ? AND level = ?', [acct.id, lv.id])) return json(res, 400, { error: 'you already have it' });
      const p = {
        mode: 'payment',
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': String(lv.price),
        'line_items[0][price_data][product_data][name]': 'Free Fall Frank: ' + lv.name,
        'line_items[0][price_data][product_data][description]': 'The level ' + lv.name + ', yours for good. A one-time purchase, not refundable.',
        'metadata[app]': 'free-fall-frank', 'metadata[user]': acct.id, 'metadata[level]': lv.id,
        client_reference_id: acct.id,
        success_url: originOf(req) + '/?paid={CHECKOUT_SESSION_ID}',
        cancel_url: originOf(req) + '/?level=' + lv.id,
      };
      if (acct.email) p.customer_email = acct.email;
      const s = await stripe('POST', '/checkout/sessions', p);
      await db.run('INSERT INTO pending (session, uid, frank, created) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [s.id, acct.id, -2, Date.now()]);
      return json(res, 200, { url: s.url });
    }
    const id = String(b.pack || 'classic'), pack = PACKS[id];
    if (!pack) return json(res, 400, { error: 'no such pack' });
    if (await db.get('SELECT 1 AS x FROM packs WHERE uid = ? AND pack = ?', [acct.id, id])) return json(res, 400, { error: 'you already have it' });
    const params = {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(pack.price),
      'line_items[0][price_data][product_data][name]': 'Free Fall Frank: ' + pack.name,
      'line_items[0][price_data][product_data][description]': 'Every Frank and his level, ' + (pack.to - pack.from + 1) + ' in all, yours for good',
      'metadata[app]': 'free-fall-frank', 'metadata[user]': acct.id, 'metadata[pack]': id,
      client_reference_id: acct.id,
      success_url: originOf(req) + '/?paid={CHECKOUT_SESSION_ID}',
      cancel_url: originOf(req) + '/?screen=select',
    };
    if (acct.email) params.customer_email = acct.email;
    const s = await stripe('POST', '/checkout/sessions', params);
    await db.run('INSERT INTO pending (session, uid, frank, created) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [s.id, acct.id, -1, Date.now()]);
    return json(res, 200, { url: s.url });
  }
  if (route === 'GET /api/confirm') {
    // Asked on the way back from Stripe, and asked again until it is answered (a deploy may have been in the way):
    // however often, a checkout is granted once (settle). A checkout Stripe does not know is a plain no, not ours going wrong.
    let got = null;
    try { got = await settle(url.searchParams.get('session_id') || '', acct); } catch (e) { if (e.status !== 404) throw e; }
    return json(res, 200, Object.assign({ ok: !!got }, got || {}));
  }
  json(res, 404, { error: 'not found' });
}

// A page, as it is sent: told which build it is (window.FFF_BUILD, which net.js holds against the X-Build of every
// answer) and asking for each of its scripts by that build (?v=), so that a script can be kept by the browser for a
// year and still never be an older one than its page. The service worker is sent with the build written into it:
// its cache is named by it, so nobody has to remember to give it a new name, and its text changes exactly when the
// build does, which is how a browser knows there is a new worker.
function page(file) {
  if (pages[file]) return pages[file];
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return (pages[file] = file === 'sw.js' ? text.replace(/__BUILD__/g, BUILD)
    : text.replace(/(<script src=")(\/?[\w.\/-]+\.js)"/g, function (m, a, src) { return a + src + '?v=' + BUILD + '"'; }).replace('<head>', function () { return '<head>\n<script>window.FFF_BUILD = "' + BUILD + '";</script>'; }));
}
// for the tests, which change a copy of the client's files (CLIENT_DIR) and need what a deploy would then serve
function rebuild() { BUILD = buildOf(ROOT); pages = {}; return BUILD; }
function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Build', BUILD);   // on every answer: how a page that was loaded before a deploy finds out
  if (url.pathname === '/healthz') {                               // 200 only when the database answers
    ready.then(function () { return db.get('SELECT 1 AS ok'); }).then(function () { json(res, 200, { ok: true, build: BUILD }); },
      function (e) { console.error('healthz:', e.message); json(res, 503, { ok: false, error: 'the database did not answer' }); });
    return;
  }
  // one home: www goes to freefallfrank.com, so a player's sign-in and saved progress live in one place
  if (String(req.headers.host || '').toLowerCase() === 'www.freefallfrank.com') { res.writeHead(301, { Location: 'https://freefallfrank.com' + req.url }); res.end(); return; }
  if (url.pathname.indexOf('/.well-known/o') === 0 || url.pathname.indexOf('/oauth/') === 0) {   // signing in to the connector
    oauth.handle(req, res, url, accountOf).then(function (done) { if (!done) { res.writeHead(404); res.end('not found'); } })
      .catch(function (e) { console.error('oauth', e.message); if (!res.writableEnded) json(res, 500, { error: 'server_error' }); });
    return;
  }
  if (url.pathname === '/auth/link' && (req.method === 'GET' || req.method === 'POST')) {   // where an emailed sign-in link leads
    linkPage(req, res, url).catch(function (e) { console.error('link', e.message); if (!res.writableEnded) json(res, 500, { error: 'something broke' }); });
    return;
  }
  if (url.pathname === '/mcp') {                                   // the connector Claude builds levels through
    levels.mcp(req, res, url).catch(function (e) { console.error('mcp', e.message); if (!res.writableEnded) json(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'something broke' } }); });
    return;
  }
  if (url.pathname.indexOf('/api/') === 0) {
    api(req, res, url).catch(function (e) { console.error(req.method, url.pathname, e.message); if (!res.writableEnded) json(res, 500, { error: 'something broke' }); });
    return;
  }
  const file = url.pathname === '/' && isNew(req) ? 'landing.html' : STATIC[url.pathname];
  if (!file || req.method !== 'GET') { res.writeHead(404); res.end('not found'); return; }
  const full = path.join(ROOT, file), type = TYPES[file.split('.').pop()], m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  // How long each may be kept. A page (and the worker) is asked for afresh each time. A script asked for by this
  // build (?v=) may be kept for a year: its address changes when it does. Asked for with no build it is checked each
  // time; asked for by ANOTHER build (a page from before a deploy, still loading) it is given as it is now and must
  // not be kept, or new code would stay in a browser under an old build's address.
  const made = /\.html$/.test(file) || file === 'sw.js', v = SCRIPTS.indexOf(file) >= 0 ? url.searchParams.get('v') : null;
  const cache = file === 'admin.html' ? 'no-store' : file === 'favicon.ico' || file === 'apple-touch-icon.png' ? 'public, max-age=86400'   // asked for by every browser, unprompted: a day
    : /^landing\//.test(file) ? 'public, max-age=3600'   // the landing page's pictures and video may be kept an hour
    : v === BUILD ? 'public, max-age=31536000, immutable' : v !== null ? 'no-store' : 'no-cache';
  if (m && (m[1] || m[2]) && !made) {
    // part of a file: phones will not play a video unless it can be fetched in pieces
    const size = fs.statSync(full).size, from = m[1] ? +m[1] : Math.max(0, size - +m[2]), to = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (from > to || from >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); res.end(); return; }
    res.writeHead(206, Object.assign({ 'Content-Type': type, 'Content-Range': 'bytes ' + from + '-' + to + '/' + size, 'Content-Length': to - from + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': cache },
      /^(music|samples)\//.test(file) ? { 'Access-Control-Allow-Origin': '*' } : null));
    fs.createReadStream(full, { start: from, end: to }).pipe(res);
    return;
  }
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  if (url.pathname === '/') head.Vary = 'Cookie';                   // two pages share this address
  if (file === 'index.html') head['Set-Cookie'] = PLAYED;           // a player from here on: "/" is the game for them
  if (/^(music|samples)\//.test(file) || file === 'glyphh-logo-black.png') head['Access-Control-Allow-Origin'] = '*';   // the game played inside Claude fetches its sound, and the logo on its billboard, from here
  if (url.searchParams.has('dl')) head['Content-Disposition'] = 'attachment; filename="' + path.basename(file) + '"';   // ?dl saves the file instead of showing it
  res.writeHead(200, head);
  if (made) { res.end(page(file)); return; }
  fs.createReadStream(full).pipe(res);
}

// ---------- node server.js --check: what a deploy runs BEFORE the running machine is replaced ----------
// (fly.toml: [deploy] release_command, in a machine of its own with the app's secrets; anything but exit 0 stops the
// deploy and the release before keeps running.) The tests run on SQLite and the machine on Postgres, so this is where
// a build that passed its tests first meets the real database. It binds no port, sends no email and changes no row:
//   1. no statement that removes a table or a column, or gives one another name, outside CLEANUP (the schema only grows)
//   2. the schema is applied, by the same code a start uses (new tables, new columns that may be empty)
//   3. every table is read, with every column this build expects
//   4. every statement written whole in server.js, levels.js and oauth.js: a SELECT is run (with nothing for its ?s,
//      so it finds nothing), anything else is only planned (EXPLAIN), which finds a wrong column or word without doing it
//   5. the lists, whose statements are put together from parts, by calling what the game and the admin call
//   6. every made level (the newest 2,000) and the game's own levels are built in memory, as the game will build them,
//      and every made Frank is read
const WORDS = new RegExp('DR' + 'OP\\s+(TABLE|COLUMN)|\\bREN' + 'AME\\b', 'i'), SERVER_FILES = ['server.js', 'levels.js', 'oauth.js'], MOST_BUILT = 2000;
function statements(text) {
  const out = [], re = /\bdb\.(?:get|all|run)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*([,)+])/g; let m;
  while ((m = re.exec(text))) if (m[3] !== '+') out.push(m[2].replace(/\\(['"\\])/g, '$1'));   // (one that goes on with a + is put together from parts: 5)
  return out.filter(function (s, i) { return out.indexOf(s) === i; });
}
function tablesOf() {
  const t = {};
  SCHEMA.replace(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g, function (m, name, cols) { t[name] = cols.replace(/\([^)]*\)/g, '').split(',').map(function (c) { return c.trim().split(/\s+/)[0]; }).filter(function (c) { return c && c !== 'PRIMARY'; }); });
  ADDED.forEach(function (a) { if (t[a[0]].indexOf(a[1]) < 0) t[a[0]].push(a[1]); });
  return t;
}
// o (the tests'): sources { file: its text } in place of the files, statements [more to try], reads [[name, function]]
async function check(o) {
  o = o || {};
  const lines = [], failed = [], ok = function (s) { lines.push('ok    ' + s); }, no = function (s) { failed.push(s); lines.push('FAIL  ' + s); };
  const done = function () { lines.push(failed.length ? 'CHECK FAILED: ' + failed.length + ' thing' + (failed.length > 1 ? 's' : '') + ' wrong. Nothing was changed; do not deploy this build.' : 'CHECK PASSED'); return { ok: !failed.length, lines: lines, failed: failed }; };
  const sources = o.sources || Object.fromEntries(SERVER_FILES.map(function (f) { return [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]; }));
  lines.push('checking build ' + BUILD + ' against ' + (db.postgres ? 'Postgres' + (env.DB_SCHEMA ? ' (schema ' + env.DB_SCHEMA + ')' : '') : 'a SQLite file under ' + dataDir));
  if (!db.postgres && env.FLY_APP_NAME) no('DATABASE_URL is not set on this machine: everything players keep would be in a file that is thrown away');
  // 1
  let words = 0;
  Object.keys(sources).forEach(function (f) {
    const at = sources[f].replace(/cleanup:begin[\s\S]*?cleanup:end/g, function (m) { return m.replace(/[^\n]/g, ''); }).split('\n').map(function (l, i) { return WORDS.test(l) ? i + 1 : 0; }).filter(Boolean);
    if (at.length) { words++; no(f + ' line ' + at.join(', ') + ': a statement that removes a table or a column, or gives one another name, outside the cleanup list. The release before this one still uses the database: nothing goes in the release that stops using it (server.js, "THE SCHEMA ONLY GROWS").'); }
  });
  if (!words) ok('the schema only grows: nothing is removed or given another name outside the cleanup list (' + CLEANUP.length + ' in it)');
  // 2
  try { await ready; ok('the schema is applied'); } catch (e) { no('the schema could not be applied: ' + e.message); return done(); }
  // 3
  const tables = tablesOf(); let n = 0;
  for (const t of Object.keys(tables)) { try { await db.all('SELECT ' + tables[t].join(', ') + ' FROM ' + t + ' LIMIT 1'); n++; } catch (e) { no('table ' + t + ' (' + tables[t].join(', ') + '): ' + e.message); } }
  ok(n + ' of ' + Object.keys(tables).length + ' tables read, with every column');
  // 4
  const probe = async function (where, sql) {
    if (WORDS.test(sql)) return false;   // (said in 1; never even planned)
    try { await db.all(/^\s*SELECT\b/i.test(sql) ? sql : 'EXPLAIN ' + sql, new Array((sql.match(/\?/g) || []).length).fill(null)); return true; } catch (e) { no('a statement in ' + where + ': ' + e.message + '\n        ' + sql); return false; }
  };
  for (const f of Object.keys(sources)) { const all = statements(sources[f]); let good = 0; for (const s of all) if (await probe(f, s)) good++; ok(f + ': ' + good + ' of ' + all.length + ' statements'); }
  for (const s of o.statements || []) await probe('the test', s);
  // 5
  const reads = [['the admin\'s numbers', adminData], ['the admin\'s player', function () { return adminPlayer('check-aaaa-0000'); }]].concat(levels.selfCheck(), o.reads || []);
  n = 0;
  for (const r of reads) { try { await r[1](); n++; } catch (e) { no(r[0] + ': ' + e.message); } }
  ok(n + ' of ' + reads.length + ' lists and reads');
  // 6
  try {
    const total = (await db.get('SELECT COUNT(*) AS n FROM levels')).n, rows = await db.all('SELECT id, spec FROM levels ORDER BY created DESC LIMIT ' + MOST_BUILT); let broken = 0;
    rows.forEach(function (r) { try { const L = CORE.buildLevel(CORE.customSpec(JSON.parse(r.spec))); if (!(L.plan.length > 0 && L.totalBeats > 0)) throw new Error('it has no way down'); } catch (e) { if (++broken <= 20) no('the made level ' + r.id + ' no longer builds (core.js must still read what it kept): ' + String(e.message).slice(0, 300)); } });
    if (broken > 20) no('and ' + (broken - 20) + ' more made levels that no longer build');
    ok((rows.length - broken) + ' of ' + rows.length + ' made levels build' + (total > rows.length ? ' (the newest ' + rows.length + ' of ' + total + ')' : ''));
    const franks = await db.all('SELECT id, spec FROM franks ORDER BY created DESC LIMIT ' + MOST_BUILT); broken = 0;
    franks.forEach(function (r) { try { const f = JSON.parse(r.spec); if (!f || !f.name || !/^#[0-9a-f]{6}$/.test(f.head)) throw new Error('it has no name or no colours'); } catch (e) { if (++broken <= 20) no('the made Frank ' + r.id + ' can no longer be read: ' + String(e.message).slice(0, 200)); } });
    ok((franks.length - broken) + ' of ' + franks.length + ' made Franks read');
  } catch (e) { no('the made levels could not be read: ' + e.message); }
  try {
    CORE.buildLevel(CORE.specFor(0));
    Object.keys(WORLDS).forEach(function (id) { ['full', 'taste'].forEach(function (k) { if (!(CORE.buildLevel(WORLDS[id][k]).plan.length > 0)) throw new Error(id + ' (' + k + ') has no way down'); }); });
    ok('the game\'s own levels build: the first, and ' + Object.keys(WORLDS).join(', ') + ' (all of it, and its taste)');
  } catch (e) { no('one of the game\'s own levels no longer builds: ' + e.message); }
  return done();
}

module.exports = { handle: handle, sessionCookie: sessionCookie, db: db, ready: ready, check: check, buildOf: buildOf, rebuild: rebuild, build: function () { return BUILD; }, ROUTES: ROUTES, CLIENT: CLIENT, PAGES: PAGES, SCRIPTS: SCRIPTS };
if (CHECK) check().then(function (r) { console.log(r.lines.join('\n')); process.exit(r.ok ? 0 : 1); }, function (e) { console.error('CHECK FAILED: ' + e.message); process.exit(1); });
else if (require.main === module) {
  // a database that cannot be reached or made ready is not served from: the machine stops, and is started again
  ready.then(function () { http.createServer(handle).listen(+env.PORT || 8080, function () { console.log('free fall frank is up, build ' + BUILD + ', on ' + (db.postgres ? 'postgres' : 'sqlite')); }); })
    .catch(function (e) { console.error('could not start:', e.message); process.exit(1); });
}
