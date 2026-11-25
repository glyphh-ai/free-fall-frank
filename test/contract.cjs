// node test/contract.cjs : THE SERVER STAYS COMPATIBLE WITH THE PAGE OF THE RELEASE BEFORE (server.js, "SAFE BUILDS").
// After a deploy, browsers go on running the page they loaded, for as long as a fall takes and longer.
// test/contract.json is what such a page relies on, written down: every route (method and path), and for every call
// the game makes what it sends, the status it gets and what it reads back, field by field, with its type. This test
// asks the server itself (handle, in this process: no port, a throwaway database, Stripe, Google and the emails
// stood in for):
//   - every route in the snapshot must still be answered by something;
//   - every request kept in the snapshot is sent again exactly as the old page sends it (by players made for the
//     purpose, so that each is sent once), and must get the status it got;
//   - every field the snapshot says comes back must still come back, with the same type.
// Anything gone, changed or refused FAILS. Something new (a route, a field, a call) passes, and is only said; it goes
// into the snapshot with  node test/contract.cjs --accept [file]  (which refuses while anything fails; deploy.sh does
// it once a release is live). To take something away for good, do it a release after the page stopped using it, and
// take it out of contract.json by hand in that change.
// The first snapshot was taken from the server that was live before there were builds (2026-11-18), by this same
// file: FFF_SERVER=<its server.js> FFF_ROUTES=<a snapshot to take the route list from>.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), D = require('./db.cjs');
const FILE = path.join(__dirname, 'contract.json'), accept = process.argv.indexOf('--accept'), out = accept >= 0 ? process.argv[accept + 1] || FILE : '';
process.env.SESSION_SECRET = 'test-secret'; process.env.ADMIN_PASSWORD = 'open-sesame'; process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.STRIPE_SECRET_KEY = 'sk_test_fake'; process.env.RESEND_API_KEY = 're_test_fake';
['APPLE_SERVICE_ID', 'ADMIN_EMAILS', 'ADMIN_MCP_KEY', 'PUBLIC_URL', 'EMAIL_FROM', 'CLIENT_DIR', 'FLY_APP_NAME'].forEach(function (k) { delete process.env[k]; });
// What THIS build's page sends (account.js, net.js, game.js), each as the game sends it. as: who sends it (a device
// with no account, one of four accounts, or nobody). new: only this build sends it so (a key, a version); the rest
// is also what the page before there were builds sends. ":level" a made level on the public list, ":level2" one that
// is not, ":frank" a made Frank, ":did" the sender's device, ":session" a checkout that account paid for, ":google" Google's word for a new player.
const RUN = { did: ':did', t: 'run', frank: 0, pct: 12, sec: 'manhole', secs: 21.4, tokens: 9, res: 'splat', easy: 0 };
const SHAPES = {
  'GET /api/me': [{ as: 'nobody' }, { as: 'device' }, { as: 'a1' }],
  'GET /api/world': [{ as: 'device', query: { id: 'rock' } }, { as: 'a1', query: { id: 'rock' } }, { as: 'device', query: { id: 'rock', v: 1 }, new: true }],
  'POST /api/track': [{ as: 'nobody', body: { did: ':did', t: 'visit', src: 'insta-dec', ref: 'instagram.com' } }, { as: 'nobody', body: RUN }, { as: 'nobody', body: Object.assign({}, RUN, { frank: 100, res: 'taste' }) }, { as: 'nobody', body: { did: ':did', t: 'ad', ad: 'glyphh', k: 'view' } }, { as: 'device', key: true, body: RUN, new: true }],
  'POST /api/tokens': [{ as: 'device', body: { frank: 0, count: 100000 } }, { as: 'a1', body: { frank: 100, count: 3 } }, { as: 'device', key: true, body: { frank: 0, count: 4 }, new: true }],
  'POST /api/earn': [{ as: 'device', body: { frank: 6 } }],
  'POST /api/heart': [{ as: 'device', body: { level: 'city', on: true } }, { as: 'a1', body: { level: ':level', on: false } }, { as: 'device', key: true, body: { level: 'rock', on: true }, new: true }],
  'POST /api/secret': [{ as: 'device', body: { level: 'rock', id: 'r1' } }, { as: 'a1', key: true, body: { level: 'rock', id: 'r1' }, new: true }],
  'POST /api/score': [{ as: 'device', body: { level: 'city', score: 1200, pct: 12, name: 'PLAYER 1234', played: true } }, { as: 'a1', body: { level: ':level', score: 900, pct: 9, name: 'Ann', played: true } }, { as: 'device', body: { level: 'city', score: 0, pct: 0, name: 'New Name' } },
    { as: 'device', key: true, body: { level: 'city', score: 1300, pct: 13, name: 'New Name', played: true }, new: true }],
  'GET /api/board': [{ as: 'device', query: { level: 'city' } }, { as: 'a1', query: { level: ':level' } }, { as: 'nobody', query: { level: 'rock' } }],
  'GET /api/levels': [{ as: 'device', query: { sort: 'top' } }, { as: 'device', query: { sort: 'new' } }, { as: 'device', query: { sort: 'top', q: 'alley', difficulty: 'TRICKY', page: 1, per: 9 }, new: true }],   // (searched, filtered by rating, a page at a time)
  'GET /api/level': [{ as: 'device', query: { id: ':level' } }, { as: 'a1', query: { id: ':level' } }],
  'GET /api/frank': [{ as: 'device', query: { id: ':frank' } }],
  'GET /api/profile': [{ as: 'device' }, { as: 'a1' }],
  'POST /api/profile': [{ as: 'device', body: { frank: '3' } }, { as: 'a1', body: { name: 'Ann B' } }, { as: 'device', body: { frank: ':frank' } }, { as: 'device', key: true, body: { name: 'Keyed' }, new: true }],
  'POST /api/level/submit': [{ as: 'owner', body: { id: ':level2' } }],
  'POST /api/auth/link': [{ as: 'device', body: { email: ':mail', back: '/?screen=select' } }],
  'POST /api/auth/google': [{ as: 'device2', body: { credential: ':google' } }],
  'GET /api/store': [{ as: 'device' }],
  'POST /api/checkout': [{ as: 'a1', body: { pack: 'classic' } }, { as: 'a2', body: { level: 'rock' } }],
  'GET /api/confirm': [{ as: 'a3', query: { session_id: ':session' } }],
  'POST /api/logout': [{ as: 'a1', body: {} }],
  'POST /api/delete-account': [{ as: 'a4', body: {} }],
};
const kind = function (v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; };
// every field of an answer, by its path ("user.name", "top[].rank"), with the kinds of thing seen there
function fields(v, at, into) {
  if (at) (into[at] = into[at] || {})[kind(v)] = 1;
  if (Array.isArray(v)) v.forEach(function (x) { fields(x, at + '[]', into); }); else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { fields(v[k], at ? at + '.' + k : k, into); });
  return into;
}
const flat = function (o) { const r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = Object.keys(o[k]).sort().join('|'); }); return r; };
let S, T, call;
(async function () {
  const W = D.world();
  T = await D.open('contract'); S = require(process.env.FFF_SERVER || '../server.js'); call = D.caller(S);
  await S.ready;
  const user = function (id, mail) { return S.db.run('INSERT INTO users (id, email, name, created, coins) VALUES (?, ?, ?, ?, 0)', [id, mail, id.split(':')[1] + ' Example', Date.now()]); };
  // something for every answer to hold: a made level (public, so the list has it) and a made Frank, by the player "owner"
  await user('google:owner', 'owner@example.com'); const owner = D.as('google:owner'), code = (await call('GET', '/api/profile', null, owner)).json.code;
  const tool = async function (name, args) { return (await call('POST', '/mcp?k=' + code, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args } })).json.result.structuredContent; };
  const level = (await tool('publish_level', { name: 'Contract Alley', author: 'Tester', world: 4, sections: [{ kind: 'patterns', beats: 16, speed: 8, pattern: 'LLRR' }, { kind: 'drop' }, { kind: 'gates', beats: 24, taps: [1, 2], bonus: true }] })).id;
  const level2 = (await tool('publish_level', { name: 'Contract Lane', author: 'Tester', sections: [{ kind: 'gates', beats: 16 }] })).id;
  const frank = (await tool('create_frank', { name: 'Bolt', head: '#ffd23f', torso: '#23d5d5', legs: '#3b3f8f', hair: '#ff7b00', hat: 'crown', extras: ['visor'] })).id;
  await S.db.run("UPDATE levels SET status = 'public' WHERE id = ?", [level]);
  assert(/^[a-z0-9]{7}$/.test(level) && /^f[a-z0-9]{6}$/.test(frank), level + ' ' + frank);
  const admin = { cookie: String((await call('POST', '/api/admin/login', { password: 'open-sesame' })).heads['set-cookie']).split(';')[0] }, pic = fs.readdirSync(path.join(__dirname, '..', 'landing')).filter(function (f) { return /\.jpg$/.test(f); })[0];
  // is there something behind this route? (anything but the server's own "not found", or a method it does not take)
  let spare = 0;
  async function answered(route) {
    const m = route.split(' ')[0], p = route.split(' ')[1].replace(':file', pic);
    let who = owner; if (p.indexOf('/api/admin/') === 0) who = admin; if (p === '/api/delete-account') { const id = 'google:spare' + (++spare); await user(id, ''); who = D.as(id); }
    const r = await call(m, p, m === 'GET' ? null : {}, Object.assign({}, who, /\.(mp3|mp4|wav)$/.test(p) ? { range: 'bytes=0-99' } : {}));
    return !(r.status === 405 || (r.status === 404 && (/^not found$/.test(r.text) || (r.json && /^not[ _]found$/.test(r.json.error || '')))));
  }
  // The players of one run through the calls: a device, a second device (who signs in), and four accounts, one of
  // which has been to Stripe and paid. Made anew for each run, so that every request is sent once by whoever sends it.
  let runs = 0, keys = 0;
  async function players() {
    const tag = 'c' + (++runs), who = { nobody: {}, device: { 'x-did': 'device-' + tag + '-0000' }, device2: { 'x-did': 'device-' + tag + '-2222' }, owner: owner }, fill = { ':level': level, ':level2': level2, ':frank': frank, ':did': 'device-' + tag + '-0000', ':mail': tag + '@example.com', ':google': W.idToken({ sub: tag + 'g', email: tag + 'g@example.com', name: 'Gee' }) };
    for (const a of ['a1', 'a2', 'a3', 'a4']) { await user('google:' + tag + a, tag + a + '@example.com'); who[a] = D.as('google:' + tag + a); }
    await call('POST', '/api/checkout', { level: 'rock' }, who.a3); const sid = Object.keys(W.sessions).pop(); W.sessions[sid].payment_status = 'paid'; fill[':session'] = sid;
    return { who: who, fill: function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v), function (k, x) { return typeof x === 'string' && fill[x] !== undefined ? fill[x] : x; }); } };
  }
  // every call of the game's, sent as it is written down: { route: { sends, query, body, answers } }, and what was refused
  async function shapesOf(calls, only) {
    const P = await players(), shapes = {}, bad = [];
    for (const route of Object.keys(calls)) {
      const req = { query: {}, body: {} }, res = {}, sends = [];
      for (const x of calls[route]) {
        if (only && !only(x)) continue;
        const q = P.fill(x.query), url = route.split(' ')[1] + (q ? '?' + new URLSearchParams(q) : ''), h = Object.assign({}, P.who[x.as], x.key ? { 'idempotency-key': 'contract-key-' + (++keys), 'x-as': P.who[x.as].cookie ? undefined : 'dev:' + P.who[x.as]['x-did'] } : {});
        Object.keys(h).forEach(function (k) { if (h[k] === undefined) delete h[k]; });
        fields(x.query || {}, '', req.query); fields(x.body || {}, '', req.body);
        const r = await call(route.split(' ')[0], url, x.body ? P.fill(x.body) : null, h);
        if (x.status !== undefined && r.status !== x.status) bad.push(route + ' as ' + x.as + ' with ' + JSON.stringify(x.query || x.body || {}) + ' answered ' + r.status + ' (it was ' + x.status + '): ' + r.text.slice(0, 160));
        else if (x.status === undefined && r.status !== 200) bad.push(route + ' as ' + x.as + ' with ' + JSON.stringify(x.query || x.body || {}) + ' answered ' + r.status + ': ' + r.text.slice(0, 160));
        if (r.status === 200) fields(r.json, '', res);
        sends.push(Object.assign({}, x, { status: r.status }));
      }
      if (sends.length) shapes[route] = { sends: sends, query: flat(req.query), body: flat(req.body), answers: flat(res) };
    }
    return { shapes: shapes, bad: bad };
  }
  // ---- what this build is ----
  const first = !S.ROUTES;   // (taking the first snapshot, from the server before there were builds: its routes are found out, and only what its page sends is sent)
  const routes = (S.ROUTES || JSON.parse(fs.readFileSync(process.env.FFF_ROUTES, 'utf8')).routes).slice().sort(), failed = [], added = [];
  const now = { note: 'What the page of the release before relies on. Written by: node test/contract.cjs --accept. Read test/contract.cjs before changing it by hand.', routes: [], calls: {} };
  for (const route of routes) { if (await answered(route)) now.routes.push(route); else if (!first) failed.push('server.js lists the route ' + route + ' in ROUTES, and nothing answers it'); }
  const old = !first && fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  if (!old && !out) failed.push('there is no test/contract.json: write the first one with --accept');
  // ---- held against what was written down: first the page of the release before, sent again as it was ----
  async function hold(old, failed, added) {
    for (const route of old.routes) if (!await answered(route)) failed.push('GONE: the route ' + route + ' (the page of the release before may still ask for it)');
    now.routes.forEach(function (r) { if (old.routes.indexOf(r) < 0) added.push('a new route: ' + r); });
    const sent = {}; Object.keys(old.calls).forEach(function (r) { sent[r] = old.calls[r].sends; });
    const s = await shapesOf(sent);
    s.bad.forEach(function (b) { failed.push('REFUSED: what the page of the release before sends is no longer taken as it was: ' + b); });
    for (const route of Object.keys(old.calls)) {
      const was = old.calls[route], is = (s.shapes[route] || { answers: {} }).answers;
      Object.keys(was.answers).forEach(function (k) { if (!(k in is)) failed.push('GONE: ' + route + ' no longer answers with "' + k + '" (' + was.answers[k] + ')'); else if (is[k] !== was.answers[k]) failed.push('CHANGED: ' + route + ' answers "' + k + '" as ' + is[k] + ', and it was ' + was.answers[k]); });
      Object.keys(is).forEach(function (k) { if (!(k in was.answers)) added.push(route + ' now answers with "' + k + '" (' + is[k] + ')'); });
    }
  }
  if (old) await hold(old, failed, added);
  // ---- then this build's own page ----
  const mine = await shapesOf(SHAPES, first ? function (x) { return !x.new; } : null); now.calls = mine.shapes;
  mine.bad.forEach(function (b) { failed.push('this build\'s own call: ' + b); });
  if (old) Object.keys(now.calls).forEach(function (r) {
    if (!old.calls[r]) { added.push('a new call written down: ' + r); return; }
    ['query', 'body'].forEach(function (part) { Object.keys(now.calls[r][part]).forEach(function (k) { if (!(k in old.calls[r][part])) added.push(r + ' is now sent "' + k + '"'); }); Object.keys(old.calls[r][part]).forEach(function (k) { if (!(k in now.calls[r][part])) added.push('this build\'s page no longer sends "' + k + '" to ' + r + ' (the server must go on taking it for a release)'); }); });
    if (now.calls[r].sends.length > old.calls[r].sends.length) added.push(r + ' is sent in ' + (now.calls[r].sends.length - old.calls[r].sends.length) + ' new way(s)');
  });
  // and the test itself is tested: a snapshot that relies on a route, a field, a type, a status and a request this
  // server does not have must be caught, each by name
  if (old && !failed.length) {
    const lie = JSON.parse(JSON.stringify(old)), caught = [];
    lie.routes.push('GET /api/friends'); lie.calls['GET /api/me'].answers.crowns = 'number'; lie.calls['GET /api/me'].answers.coins = 'string'; lie.calls['GET /api/board'].answers['top[].score'] = 'string';
    lie.calls['POST /api/tokens'].sends.push({ as: 'device', body: { frank: 0, count: 'lots' }, status: 200 }); lie.calls['POST /api/earn'].sends[0].status = 400;
    await hold(lie, caught, []);
    assert.deepStrictEqual(caught.map(function (c) { return c.replace(/( as device with ).*$/, '$1'); }).sort(), ['CHANGED: GET /api/board answers "top[].score" as number, and it was string', 'CHANGED: GET /api/me answers "coins" as number, and it was string', 'GONE: GET /api/me no longer answers with "crowns" (number)',
      'GONE: the route GET /api/friends (the page of the release before may still ask for it)', 'REFUSED: what the page of the release before sends is no longer taken as it was: POST /api/earn as device with ', 'REFUSED: what the page of the release before sends is no longer taken as it was: POST /api/tokens as device with '], 'a route, a field, a type, a status or a request that is gone is caught:\n' + caught.join('\n'));
  }
  if (failed.length) { console.error('CONTRACT BROKEN (' + failed.length + '):\n  ' + failed.join('\n  ') + '\nThe page of the release before would break on this server. Keep the route or the field for one more release (server.js, "SAFE BUILDS").'); await T.done(); process.exit(1); }
  if (out) { fs.writeFileSync(out, JSON.stringify(now, null, 1) + '\n'); console.log('OK contract: written to ' + out + ' (' + now.routes.length + ' routes, ' + Object.keys(now.calls).length + ' calls' + (added.length ? '; new: ' + added.join('; ') : '') + ')'); }
  else {
    if (added.length) console.log('   (new since the snapshot, not yet written into it: ' + added.join('; ') + '. They are written down with: node test/contract.cjs --accept)');
    const count = Object.keys(old.calls).reduce(function (a, r) { return a + Object.keys(old.calls[r].answers).length; }, 0), sends = Object.keys(old.calls).reduce(function (a, r) { return a + old.calls[r].sends.length; }, 0);
    assert(old.routes.length > 80 && Object.keys(old.calls).length >= 22 && count > 150 && sends >= 40, 'the snapshot holds the routes and the calls: ' + [old.routes.length, Object.keys(old.calls).length, count, sends]);
    console.log('OK contract: all ' + old.routes.length + ' routes in the snapshot are still answered, the ' + sends + ' requests of the ' + Object.keys(old.calls).length + ' calls the game makes are taken as the page of the release before sends them, and all ' + count + ' fields of their answers are there with the same types' + (added.length ? ' (' + added.length + ' new)' : ''));
  }
  assert(W.asked.every(function (u) { return /^https:\/\/(api\.stripe\.com|www\.googleapis\.com|api\.resend\.com)\//.test(u); }));
  await T.done(); process.exit(0);
})().catch(function (e) { console.error(e); Promise.resolve(T && T.done()).catch(function () {}).then(function () { process.exit(1); }); });
