// Checks the server without opening a port: the device wallet, earning with tokens, sign-in only to pay, the pack
// checkout, play tracking, ad links, the admin dashboard, who gets the landing page or the game at "/", and signing in
// with a link sent by email. Google's keys, Stripe and Resend (the emails) are faked, so this runs offline and sends nothing.
// The database is a throwaway SQLite file, or with TEST_DATABASE_URL a schema of its own in that Postgres (test/db.cjs).
const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path'), { Readable, Writable } = require('stream');

process.env.SESSION_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.ADMIN_PASSWORD = 'open-sesame';
process.env.ADMIN_MCP_KEY = 'review-key-123';
process.env.ADMIN_EMAILS = 'support@glyphh.ai, boss@example.com';
process.env.RESEND_API_KEY = 're_test_fake';
delete process.env.EMAIL_FROM;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
function idToken(claims, key) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'k1' }) + '.' + enc(Object.assign({ iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 600 }, claims));
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key || privateKey).toString('base64url');
}

const sessions = {}, mails = [];     // mails: every email the server asked Resend to send, as it asked
let mailDown = false;
global.fetch = async function (url, opts) {
  const reply = (code, obj) => ({ ok: code < 300, status: code, json: async () => obj });
  if (url === 'https://api.resend.com/emails') { if (mailDown) return reply(500, { message: 'down' }); mails.push({ method: opts.method, headers: opts.headers, body: JSON.parse(opts.body) }); return reply(200, { id: 'email_' + mails.length }); }
  if (url === 'https://www.googleapis.com/oauth2/v3/certs') return reply(200, { keys: [jwk] });
  if (url === 'https://api.stripe.com/v1/checkout/sessions' && opts.method === 'POST') {
    const p = Object.fromEntries(opts.body);
    const s = { id: 'cs_test_' + Object.keys(sessions).length, url: 'https://checkout.stripe.test/pay', payment_status: 'unpaid', status: 'open', created: Math.floor(Date.now() / 1000), livemode: true,
      amount_total: +p['line_items[0][price_data][unit_amount]'], name: p['line_items[0][price_data][product_data][name]'], currency: 'usd', customer_details: { email: 'frank@example.com' },
      desc: p['line_items[0][price_data][product_data][description]'], success: p.success_url, cancel: p.cancel_url,
      metadata: { app: p['metadata[app]'], user: p['metadata[user]'], pack: p['metadata[pack]'], level: p['metadata[level]'] } };
    sessions[s.id] = s;
    return reply(200, s);
  }
  if (url.indexOf('https://api.stripe.com/v1/checkout/sessions?') === 0) return reply(200, { data: Object.values(sessions).concat([{ id: 'cs_other', metadata: { app: 'something-else' }, created: 1 }]), has_more: false });
  const m = /checkout\/sessions\/(.+)$/.exec(url);
  if (m) return sessions[m[1]] ? reply(200, sessions[m[1]]) : reply(404, { error: { message: 'no such session' } });
  throw new Error('unexpected fetch ' + url);
};

let handle, db, DB;                  // the server, loaded once its database is there (below)
function call(method, url, data, o) {
  o = o || {};
  return new Promise(resolve => {
    // o.form: the body is a posted form; o.raw: the answer is a page, not JSON
    const req = Readable.from(data ? [o.form ? new URLSearchParams(data).toString() : JSON.stringify(data)] : []);
    Object.assign(req, { method, url, headers: Object.assign({}, o.cookie ? { cookie: o.cookie } : {}, o.did ? { 'x-did': o.did } : {}, o.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, o.headers || {}) });
    const res = { headers: {}, writableEnded: false, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); },
      end(s) { this.writableEnded = true; resolve({ code: this.code, headers: this.headers, body: o.raw ? s || '' : s ? JSON.parse(s) : null, cookie: (this.headers['Set-Cookie'] || '').split(';')[0] }); } };
    handle(req, res);
  });
}
// a page or a file, which the server streams: the whole answer, with its size (o.cookie, o.headers as for call)
function file(url, o) {
  o = o || {};
  return new Promise(resolve => {
    const req = Object.assign(Readable.from([]), { method: 'GET', url, headers: Object.assign({}, o.cookie ? { cookie: o.cookie } : {}, o.headers || {}) }), parts = [];
    const res = new Writable({ write(c, e, cb) { parts.push(Buffer.from(c)); cb(); } });
    Object.assign(res, { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); } });
    res.on('finish', () => { const b = Buffer.concat(parts); resolve({ code: res.code, headers: res.headers, size: b.length, body: /html|javascript|json/.test(res.headers['Content-Type'] || '') ? b.toString() : '' }); });
    handle(req, res);
  });
}

let failed = false;
function check(name, ok, got) { if (!ok) failed = true; console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ' -> ' + JSON.stringify(got))); }
const DID = 'device-aaaa-1111', D = { did: DID };

(async () => {
  DB = await require('./db.cjs').open('server'); ({ handle, db } = require('../server.js'));
  let r = await call('GET', '/api/me', null, D);
  check('a new player: no account, three free Franks, a pack on offer', r.body.user === null && r.body.free.join() === '0,1,2' && r.body.pack.price === 99 && r.body.coins === 0, r.body);

  // no account: the device has the wallet
  r = await call('POST', '/api/tokens', { frank: 0, count: 100000 }, D);
  const CORE = require('../core.js'), cap = CORE.buildLevel(CORE.specFor(0)).maxTokens;
  check('tokens bank to the device, capped at what the level holds', r.code === 200 && r.body.coins === cap && cap > 250, r.body);
  r = await call('POST', '/api/earn', { frank: 1 }, D);
  check('a free Frank cannot be "earned"', r.code === 400, r);
  r = await call('POST', '/api/earn', { frank: 6 }, D);
  check('250 tokens earn a Frank with no account', r.code === 200 && r.body.coins === cap - 250, r.body);
  r = await call('GET', '/api/me', null, D);
  check('the device now has that Frank', r.body.user === null && r.body.unlocked.join() === '6' && r.body.coins === cap - 250, r.body);
  r = await call('POST', '/api/tokens', { frank: 0, count: 5 });
  check('no device id, no wallet', r.code === 401, r);
  // hearts: a device hearts a level once, and can take it back
  r = await call('POST', '/api/heart', { level: 'city', on: true }, D);
  await call('POST', '/api/heart', { level: 'city', on: true }, D);
  r = await call('GET', '/api/me', null, D);
  check('a heart counts once and shows as mine', r.body.hearts.city.n === 1 && r.body.hearts.city.mine === true, r.body.hearts);
  r = await call('POST', '/api/heart', { level: 'nowhere', on: true }, D);
  check('no hearts for a level that is not there', r.code === 400, r);
  r = await call('POST', '/api/heart', { level: 'city', on: false }, D);
  check('a heart can be taken back', r.body.n === 0, r.body);
  await call('POST', '/api/heart', { level: 'city', on: true }, D);
  r = await call('POST', '/api/checkout', { pack: 'classic' }, D);
  check('paying needs an account', r.code === 401, r);

  // signing in, which only happens to pay
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u1' }, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey) }, D);
  check('token signed by someone else is refused', r.code === 401, r);
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u1', aud: 'another-app' }) }, D);
  check('token for another app is refused', r.code === 401, r);
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u1', email: 'frank@example.com', name: 'Frank Faller' }) }, D);
  check('good token signs in', r.code === 200 && r.cookie.indexOf('fff=') === 0, r);
  const A = { cookie: r.cookie, did: DID };
  r = await call('GET', '/api/me', null, A);
  check('the account took the device\'s tokens and Frank with it', r.body.user && r.body.user.name === 'Frank Faller' && r.body.unlocked.join() === '6' && r.body.coins === cap - 250, r.body);
  r = await call('GET', '/api/me', null, { cookie: A.cookie.slice(0, -3) + 'abc' });
  check('tampered cookie is signed out', r.body.user === null, r.body);

  r = await call('POST', '/api/checkout', { pack: 'nope' }, A);
  check('an unknown pack is not for sale', r.code === 400, r);
  r = await call('POST', '/api/checkout', { pack: 'classic' }, A);
  const sid = Object.keys(sessions)[0];
  check('checkout for the whole pack at 99 cents', r.code === 200 && !!r.body.url && sessions[sid].amount_total === 99 && /All Franks/.test(sessions[sid].name), r);
  r = await call('GET', '/api/confirm?session_id=' + sid, null, A);
  check('unpaid checkout unlocks nothing', r.body.ok === false, r.body);
  sessions[sid].payment_status = 'paid';
  const other = (await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u2' }) }, { did: 'device-bbbb-2222' })).cookie;
  r = await call('GET', '/api/confirm?session_id=' + sid, null, { cookie: other });
  check('someone else cannot claim the paid checkout', r.body.ok === false, r.body);
  r = await call('GET', '/api/me', null, A);
  check('a paid checkout that never came back still unlocks the pack', r.body.packs.join() === 'classic', r.body);
  r = await call('POST', '/api/checkout', { pack: 'classic' }, A);
  check('cannot buy the pack twice', r.code === 400, r);

  // what the game reports
  await call('POST', '/api/track', { did: DID, t: 'visit', src: 'TikTok-Nov', ref: 'tiktok.com' });
  await call('POST', '/api/track', { did: 'device-cccc-3333', t: 'visit', src: 'tiktok-nov' });
  await call('POST', '/api/track', { did: 'device-dddd-4444', t: 'visit', src: '<script>' });
  await call('POST', '/api/track', { did: DID, t: 'run', frank: 0, pct: 12, sec: 'manhole', secs: 21.4, tokens: 9, res: 'splat' }, A);
  await call('POST', '/api/track', { did: DID, t: 'run', frank: 0, pct: 100, sec: 'sky', secs: 185, tokens: 240, res: 'win' }, A);
  r = await call('POST', '/api/track', { did: DID, t: 'run', frank: 99, pct: 500, secs: -1 });
  check('a nonsense run is refused', r.code === 400, r);
  r = await call('POST', '/api/track', { did: 'x', t: 'visit' });
  check('a bad device id is refused', r.code === 400, r);

  // admin
  r = await call('GET', '/api/admin/data');
  check('admin data is closed without the password', r.code === 401, r);
  r = await call('POST', '/api/admin/login', { password: 'guess' });
  check('wrong admin password is refused', r.code === 401, r);
  r = await call('POST', '/api/admin/login', { password: 'open-sesame' });
  check('right admin password signs in', r.code === 200 && r.cookie.indexOf('fffa=') === 0, r);
  const ADM = { cookie: r.cookie };
  r = await call('GET', '/api/admin/data', null, { cookie: 'fffa=99999999999999.forged' });
  check('a forged admin cookie is refused', r.code === 401, r);
  r = await call('POST', '/api/admin/campaign', { code: 'insta-dec', note: 'Instagram reel' }, ADM);
  check('an ad link can be made', r.code === 200 && /\?src=insta-dec$/.test(r.body.link), r.body);
  r = await call('GET', '/api/admin/data', null, ADM);
  const o = r.body.overview, tk = r.body.campaigns.find(c => c.code === 'tiktok-nov'), lvl = r.body.levels[0], me = r.body.players.find(p => p.did === DID);
  check('overview counts players, runs, accounts and money', o.players === 3 && o.runs === 2 && o.accounts === 2 && o.buyers === 1 && o.revenue === 99 && o.earned === 1, o);
  check('the ad link is credited with its players, plays and sale', tk && tk.landings === 2 && tk.players === 2 && tk.played === 1 && tk.buyers === 1 && tk.revenue === 99, tk);
  check('a link with a bad code is counted as no link', r.body.campaigns.some(c => c.code === '' && c.players === 1) && !r.body.campaigns.some(c => /</.test(c.code)), r.body.campaigns);
  check('the level shows attempts, clears and where runs end', lvl.frank === 0 && lvl.plays === 2 && lvl.clears === 1 && lvl.best === 100 && /manhole/.test(lvl.dies), lvl);
  check('the player row has runs, time, source and payment', me && me.runs === 2 && me.secs === 206 && me.src === 'tiktok-nov' && me.paid === 99 && me.name === 'Frank Faller', me);
  check('the first-level funnel has a row per stretch', r.body.funnel.length > 8 && r.body.funnel[0].players === 1 && r.body.funnel[r.body.funnel.length - 1].players === 1, r.body.funnel);
  r = await call('GET', '/api/admin/player?did=' + DID, null, ADM);
  check('one player\'s detail', r.code === 200 && r.body.runs.length === 2 && r.body.packs.length === 1 && r.body.purchases.length === 1 && r.body.levels[0].plays === 2, r.body);
  r = await call('GET', '/api/admin/payments', null, ADM);
  check('payments come from Stripe, this game\'s only', r.body.payments.length === 1 && r.body.payments[0].paid && r.body.payments[0].amount === 99, r.body);

  r = await call('POST', '/api/delete-account', {}, A);
  r = await call('GET', '/api/me', null, { cookie: A.cookie });
  check('deleted account is gone', r.body.user === null, r.body);

  // the landing page and the game share "/": someone new gets the landing page; an ad click (any query string),
  // a signed-in player and anyone who has played get the game. /play is always the game, /about always the page.
  const isGame = p => p.code === 200 && /<canvas id="game">/.test(p.body), isLanding = p => p.code === 200 && /id="pricing"/.test(p.body) && !/<canvas id="game">/.test(p.body);
  let p = await file('/');
  check('/ for someone new is the landing page, and does not mark them a player', isLanding(p) && !p.headers['Set-Cookie'] && p.headers.Vary === 'Cookie' && /text\/html/.test(p.headers['Content-Type']), p.headers);
  p = await file('/?fbclid=x');
  check('/ from an ad click (a query string) is the game, and marks them a player', isGame(p) && /^played=1; .*Max-Age=31536000/.test(p.headers['Set-Cookie']), p.headers);
  for (const q of ['/?utm_source=ig&utm_campaign=nov', '/?src=insta-dec', '/?level=abc1234', '/?frank=fpirate', '/?paid=cs_test_0', '/?screen=select', '/?'])
    check('/ with ' + q.slice(1) + ' is the game', isGame(await file(q)), q);
  check('/ with a session cookie is the game', isGame(await file('/', { cookie: A.cookie })), A.cookie);
  check('/ with the played cookie is the game', isGame(await file('/', { cookie: 'other=1; played=1' })));
  check('/ with some other cookie is still the landing page', isLanding(await file('/', { cookie: 'displayed=1; _ga=GA1.1' })));
  p = await file('/play');
  check('/play is always the game', isGame(p) && /^played=1/.test(p.headers['Set-Cookie']) && isGame(await file('/play?src=insta-dec')) && isGame(await file('/index.html')), p.headers);
  p = await file('/about');
  check('/about is always the landing page', isLanding(p) && isLanding(await file('/about', { cookie: 'played=1; ' + A.cookie })) && isLanding(await file('/about?src=insta-dec')), p.headers);
  // what the page says of the store is what the server sells
  r = await call('GET', '/api/me', null, D);
  const priced = '$' + (r.body.pack.price / 100).toFixed(2), others = r.body.pack.to - r.body.pack.from + 1;
  check('the landing page states the server\'s price, token price and counts', p.body.indexOf('id="p-pack">' + priced) > 0 && p.body.indexOf(r.body.tokenPrice + ' tokens') > 0 && p.body.indexOf('the ' + others + ' that are not free') > 0
    && p.body.indexOf('FREE = [' + r.body.free.join(', ') + ']') > 0 && p.body.indexOf(others + r.body.free.length + ' FRANKS') > 0, [priced, others]);
  const lvPrice = '$' + (r.body.levels.rock.price / 100).toFixed(2);
  check('the landing page has the second level: the server\'s price for it, its free taste, and that it is not refundable', p.body.indexOf('id="p-level">' + lvPrice) > 0 && p.body.indexOf('id="p-level-2">' + lvPrice) > 0 && /id="rock"/.test(p.body) && /ROCK BOTTOM/.test(p.body)
    && /free taste/i.test(p.body) && (p.body.match(/not refundable/gi) || []).length >= 2 && /Can I get a refund\?/.test(p.body) && /href="\/play\?level=rock"/.test(p.body) && /\/landing\/rock-teeth\.jpg/.test(p.body) && /\/landing\/rock-landlord\.jpg/.test(p.body)
    && p.body.indexOf(r.body.levels.rock.secrets === 8 ? 'Eight secrets' : '#') > 0 && !/\d[\d,]* players|reviews?\b|rated/i.test(p.body.slice(p.body.indexOf('id="rock"'), p.body.indexOf('id="pricing"'))), lvPrice);
  check('the landing page: contact is support@glyphh.ai, made by is the logo file', /mailto:support@glyphh\.ai/.test(p.body) && /<img src="\/glyphh-logo\.png"[^>]* alt="Glyphh">/.test(p.body) && !/presents/i.test(p.body));
  // every picture and video the page asks for is served, and the video in pieces (phones will not play it otherwise)
  const assets = Array.from(new Set((p.body.match(/\/landing\/[\w-]+\.(?:jpg|png|mp4)/g) || []))), served = [];
  for (const a of assets) { const f = await file(a); if (f.code === 200 && f.size > 1000 && /^(image\/jpeg|image\/png|video\/mp4)$/.test(f.headers['Content-Type']) && /max-age/.test(f.headers['Cache-Control'])) served.push(a); }
  check('the landing page\'s ' + assets.length + ' pictures and video are all served', assets.length >= 10 && served.length === assets.length, assets.filter(a => served.indexOf(a) < 0));
  p = await file('/landing/hero.mp4', { headers: { range: 'bytes=0-99' } });
  check('the hero video can be fetched in pieces', p.code === 206 && p.size === 100 && /^bytes 0-99\//.test(p.headers['Content-Range']), p.headers);
  for (const u of ['/admin', '/build', '/level', '/sw.js', '/manifest.json', '/ad.mp4', '/ad2.mp4', '/ad3.mp4', '/ad4.mp4', '/ad4-cover.jpg', '/glyphh-logo.png', '/game.js'])
    check(u + ' is still served', (await file(u)).code === 200, u);
  p = await file('/sw.js');
  check('the service worker never keeps "/", and falls back to the game kept as /play', /PAGE = 'play'/.test(p.body) && !/'\.\/'/.test(p.body) && /if \(!home && mine\(res\)\)/.test(p.body) && /home \? PAGE/.test(p.body), p.body.slice(0, 300));
  check('an installed game opens on /play', JSON.parse((await file('/manifest.json')).body).start_url === 'play');
  check('a page that is not there is not found', (await file('/nope')).code === 404);

  // the MCP connector: Claude reads how levels work, previews one, publishes it; the game then loads it and keeps its leaderboard
  // Signing in to the connector: /mcp says 401 and where to go; the app registers, the player signs in to the game
  // and allows it, and the code that comes back is traded for a token. Then the connector acts as that player.
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  check('the connector asks for a sign-in, and says where', r.code === 401 && /resource_metadata="https:\/\/freefallfrank\.com\/\.well-known\/oauth-protected-resource"/.test(r.headers['WWW-Authenticate']), r);
  r = await call('GET', '/.well-known/oauth-protected-resource/mcp');
  check('oauth: the resource names its authorization server', r.body.resource === 'https://freefallfrank.com/mcp' && r.body.authorization_servers[0] === 'https://freefallfrank.com', r.body);
  r = await call('GET', '/.well-known/oauth-authorization-server');
  check('oauth: the server says how to sign in', /\/oauth\/authorize$/.test(r.body.authorization_endpoint) && /\/oauth\/register$/.test(r.body.registration_endpoint) && r.body.code_challenge_methods_supported[0] === 'S256', r.body);
  r = await call('POST', '/oauth/register', { client_name: 'Claude', redirect_uris: ['http://evil.example.com/cb'] });
  check('oauth: an app may not register a plain http address', r.code === 400, r);
  r = await call('POST', '/oauth/register', { client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
  const cid = r.body.client_id, verifier = 'v'.repeat(50), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  check('oauth: an app registers itself', r.code === 201 && /^c_/.test(cid), r.body);
  const ask = { response_type: 'code', client_id: cid, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'st8' };
  r = await call('GET', '/oauth/authorize?' + new URLSearchParams(ask), null, { raw: true });
  check('oauth: someone not signed in is shown the sign-in', r.code === 200 && /accounts\.google\.com\/gsi\/client/.test(r.body) && !/name="mark"/.test(r.body), r.body.slice(0, 200));
  r = await call('GET', '/oauth/authorize?' + new URLSearchParams(Object.assign({}, ask, { redirect_uri: 'https://elsewhere.example/cb' })), null, { raw: true });
  check('oauth: an address the app did not register is refused', r.code === 400, r.body.slice(0, 200));
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u3', email: 'tess@example.com', name: 'Tess Ter' }) }, { did: 'device-tess-0004' });
  const T = { cookie: r.cookie };
  r = await call('GET', '/oauth/authorize?' + new URLSearchParams(ask), null, { raw: true, cookie: T.cookie });
  const mark = (/name="mark" value="([^"]+)"/.exec(r.body) || [])[1];
  check('oauth: signed in, they are asked to allow the app, by name', r.code === 200 && /Tess Ter/.test(r.body) && /<b>Claude<\/b>/.test(r.body) && !!mark, r.body.slice(r.body.indexOf('<main>'), r.body.indexOf('<main>') + 500));
  r = await call('POST', '/oauth/authorize', Object.assign({ answer: 'yes', mark: 'forged' }, ask), { raw: true, form: true, cookie: T.cookie });
  check('oauth: a yes that did not come from that page is refused', r.code === 400, r.code);
  r = await call('POST', '/oauth/authorize', Object.assign({ answer: 'yes', mark: mark }, ask), { raw: true, form: true, cookie: T.cookie });
  const back = new URL(r.headers.Location || 'http://x');
  check('oauth: allowing sends them back to the app with a code', r.code === 302 && back.origin === 'https://claude.ai' && back.searchParams.get('state') === 'st8' && !!back.searchParams.get('code'), r.headers);
  const grant = { grant_type: 'authorization_code', code: back.searchParams.get('code'), client_id: cid, redirect_uri: ask.redirect_uri };
  r = await call('POST', '/oauth/token', Object.assign({ code_verifier: 'not-the-verifier' }, grant), { form: true });
  check('oauth: the wrong proof gets no token (and spends the code)', r.code === 400 && r.body.error === 'invalid_grant', r.body);
  r = await call('POST', '/oauth/authorize', Object.assign({ answer: 'yes', mark: mark }, ask), { raw: true, form: true, cookie: T.cookie });
  r = await call('POST', '/oauth/token', Object.assign({}, grant, { code: new URL(r.headers.Location).searchParams.get('code'), code_verifier: verifier }), { form: true });
  let TOKEN = r.body.access_token;
  check('oauth: the code and its proof are traded for a token', r.code === 200 && r.body.token_type === 'Bearer' && !!TOKEN && !!r.body.refresh_token, r.body);
  r = await call('POST', '/oauth/token', { grant_type: 'refresh_token', refresh_token: r.body.refresh_token, client_id: cid }, { form: true });
  check('oauth: a refresh token gets a new one', r.code === 200 && !!r.body.access_token && r.body.access_token !== TOKEN, r.body);
  TOKEN = r.body.access_token;
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { headers: { authorization: 'Bearer nope' } });
  check('a made-up token is not a sign-in', r.code === 401, r.code);
  const AUTH = { headers: { authorization: 'Bearer ' + TOKEN } };
  const mcp = (method, params, id) => call('POST', '/mcp', { jsonrpc: '2.0', id: id === undefined ? 1 : id, method: method, params: params }, AUTH);
  const tool = async (name, args) => { const x = await mcp('tools/call', { name: name, arguments: args }); return x.body.result; };
  r = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check('mcp: initialize answers with tools', r.code === 200 && r.body.result.protocolVersion === '2025-06-18' && !!r.body.result.capabilities.tools && r.body.result.serverInfo.name === 'free-fall-frank', r.body);
  r = await call('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, AUTH);
  check('mcp: a notification is taken with no answer', r.code === 202 && r.body === null, r);
  r = await mcp('tools/list');
  check('mcp: twelve tools, each with a schema, none of them the reviewer\'s', r.body.result.tools.length === 12 &&r.body.result.tools.every(t => t.inputSchema && t.description && !/^admin/.test(t.name)), r.body.result.tools.map(t => t.name));
  r = await tool('how_levels_work', {});
  check('mcp: the guide names the kinds and the worlds', /patterns/.test(r.structuredContent.guide) && /23 /.test(r.structuredContent.guide), r);
  const design = { name: 'Zig Zag Alley', author: 'Tester', world: 4, sections: [{ kind: 'patterns', beats: 16, speed: 8, pattern: 'LLRR' }, { kind: 'drop' }, { kind: 'maze', beats: 16 }, { kind: 'gates', beats: 24, taps: [1, 2], posts: 0.5, bonus: true }] };
  r = await tool('preview_level', Object.assign({ map: true }, design));
  check('mcp: a preview says what the level is like and draws it', !r.isError && r.structuredContent.stats.gates > 20 && r.structuredContent.stretches.length === 4 && /^LLRR/.test(r.structuredContent.stretches[0].taps) && /#/.test(r.structuredContent.map), r);
  r = await tool('preview_level', { name: 'Bad', sections: [{ kind: 'loop' }] });
  check('mcp: a design that cannot be made is refused with the reason', r.isError && /kind must be one of/.test(r.content[0].text), r);
  r = await tool('publish_level', design);
  const made = r.structuredContent;
  check('mcp: publishing gives an id and a link', !r.isError && /^[a-z0-9]{7}$/.test(made.id) && made.play_url === 'https://freefallfrank.com/?level=' + made.id, r);
  r = await call('GET', '/api/level?id=' + made.id, null, D);
  check('the game can load the made level', r.code === 200 && r.body.name === 'Zig Zag Alley' && r.body.world === 4 && r.body.sections.length === 4 && r.body.sections[0].pattern === 'LLRR', r.body);
  check('and build it, the same as the connector did', CORE.buildLevel(CORE.customSpec(r.body)).gates.length === made.stats.gates, made.stats);
  r = await call('GET', '/api/level?id=nothere1', null, D);
  check('a level that is not there is a 404', r.code === 404, r);
  // leaderboards: a player's best counts once, the board is ordered, and it says where you are
  r = await call('POST', '/api/score', { level: made.id, score: 1200, pct: 12, name: 'Ann', played: true }, D);
  r = await call('POST', '/api/score', { level: made.id, score: 900, pct: 9, name: 'Ann', played: true }, D);
  const D2 = { did: 'device-two-0002' };
  r = await call('POST', '/api/score', { level: made.id, score: 4100, pct: 41, name: 'Bo <b>', played: true }, D2);
  check('the board is best first, one row a player, names cleaned', r.body.top.length === 2 && r.body.top[0].name === 'Bo b' && r.body.top[0].score === 4100 && r.body.top[1].score === 1200 && r.body.me.rank === 1, r.body);
  r = await call('GET', '/api/board?level=' + made.id, null, D);
  check('it tells a player their own place', r.body.me && r.body.me.rank === 2 && r.body.players === 2 && r.body.top[1].me === true, r.body);
  r = await call('POST', '/api/score', { level: 'city', score: 99999999, pct: 100, name: 'Cheat' }, D);
  check('an impossible score is refused', r.code === 400, r);
  r = await call('POST', '/api/score', { level: 'city', score: 5000, pct: 50, name: 'Ann' }, D);
  check('the game\'s own level has a board too', r.code === 200 && r.body.top[0].score === 5000, r.body);
  r = await call('POST', '/api/heart', { level: made.id, on: true }, D);
  r = await call('GET', '/api/level?id=' + made.id, null, D);
  check('a made level can be hearted, and counts its plays', r.body.hearts === 1 && r.body.mine === true && r.body.plays === 3, r.body);
  r = await tool('get_level', { id: made.id });
  check('mcp: get_level shows the design and its leaderboard', r.structuredContent.sections.length === 4 && r.structuredContent.leaderboard.top[0].name === 'Bo b', r);
  r = await tool('list_levels', { sort: 'top' });
  check('a made level is not on the public list until it is reviewed', r.structuredContent.levels.length === 0, r);

  // a player's profile, and their own connector address: what is made through it is theirs
  const P = { did: 'device-maker-0003' };
  r = await call('GET', '/api/profile', null, P);
  const code = r.body.code;
  check('a profile has a code and a connector address of its own', r.code === 200 && /^[a-z0-9]{8,16}$/.test(code) && r.body.connector === 'https://freefallfrank.com/mcp?k=' + code && r.body.has_pack === false, r.body);
  const mine = async (name, args) => (await call('POST', '/mcp?k=' + code, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: name, arguments: args } })).body.result;
  r = await tool('my_profile', {});
  check('mcp: signed in, the connector knows whose profile it is, and what they made', !r.isError && r.structuredContent.code !== code && r.structuredContent.levels.length === 1 && r.structuredContent.levels[0].id === made.id, r);
  await call('POST', '/api/score', { level: 'city', score: 700, pct: 7, name: 'Old Name' }, P);
  r = await mine('update_profile', { name: 'Maker Mo', frank: '5' });
  check('mcp: update_profile changes the name and the Frank', !r.isError && r.structuredContent.name === 'Maker Mo' && r.structuredContent.frank === '5', r);
  r = await call('GET', '/api/board?level=city', null, P);
  check('and the new name is on the leaderboards', r.body.me.name === 'Maker Mo', r.body);
  r = await call('POST', '/api/profile', { name: 'x' }, P);
  check('a name too short is refused', r.code === 400, r);
  r = await call('POST', '/api/profile', { name: 'Mo In App' }, P);
  check('the app changes the profile too', r.code === 200 && r.body.name === 'Mo In App', r.body);
  // a Frank of their own
  r = await mine('create_frank', { name: 'Shrek Frank', head: '#8fd16a', torso: '#7a5230', legs: '#3d2a1c', hair: '#8fd16a', hat: 'antenna', extras: ['patch'] });
  const fr = r.structuredContent;
  check('mcp: create_frank makes a Frank with a link', !r.isError && fr.name === 'SHREK FRANK' && fr.link === 'https://freefallfrank.com/?frank=' + fr.id, r);
  r = await mine('create_frank', { name: 'Bad', hat: 'sombrero' });
  check('mcp: a hat that does not exist is refused', r.isError && /hat must be one of/.test(r.content[0].text), r);
  r = await call('GET', '/api/frank?id=' + fr.id, null, D);
  check('the game can load a made Frank', r.code === 200 && r.body.hat === 'antenna' && r.body.extra === 'patch' && r.body.torso === '#7a5230', r.body);
  r = await mine('update_profile', { frank: fr.id });
  check('a made Frank can be the profile\'s Frank', !r.isError && r.structuredContent.frank === fr.id && r.structuredContent.franks.length === 1, r);
  // the public list: the maker's own level, the pack, then a reviewer
  r = await mine('submit_level', { id: made.id });
  check('somebody else\'s level cannot be put forward', r.isError && /only the player who made/.test(r.content[0].text), r);
  r = await mine('publish_level', Object.assign({}, design, { name: 'Mo\'s Maze' }));
  const own = r.structuredContent;
  check('a level published from a player\'s address is theirs', !r.isError && /It is theirs/.test(own.note), r);
  r = await call('POST', '/api/level/submit', { id: own.id }, { did: 'device-two-0002' });
  check('somebody else cannot put it forward', r.code === 400, r);
  r = await mine('submit_level', { id: own.id });
  check('its maker can, free, and it waits for review', !r.isError && r.structuredContent.status === 'pending', r);
  r = await call('GET', '/api/levels', null, D);
  check('still not listed while it waits', r.body.levels.length === 0, r.body);
  r = await call('POST', '/mcp?admin=nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  check('a wrong reviewer address is refused', r.code === 401, r);
  r = await tool('admin_queue', {});
  check('the reviewer\'s tools are not there for anyone else', r === undefined || r.isError, r);
  const admin = async (name, args) => (await call('POST', '/mcp?admin=review-key-123', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: name, arguments: args } })).body.result;
  r = await call('POST', '/mcp?admin=review-key-123', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  check('the reviewer\'s address has the review tools', r.body.result.tools.length === 22 && r.body.result.tools.some(t => t.name === 'admin_review'), r.body.result.tools.map(t => t.name));
  r = await admin('admin_queue', {});
  check('mcp: the queue shows the level that waits, with its design', r.structuredContent.waiting === 1 && r.structuredContent.levels[0].id === own.id && r.structuredContent.levels[0].sections.length === 4 && r.structuredContent.levels[0].stats.gates > 0, r);
  r = await admin('admin_review', { id: own.id, decision: 'decline' });
  check('mcp: declining needs a reason', r.isError && /needs a note/.test(r.content[0].text), r);
  r = await admin('admin_review', { id: own.id, decision: 'decline', note: 'The name is not okay' });
  r = await mine('my_profile', {});
  check('the maker sees it was declined, and why', r.structuredContent.levels[0].status === 'declined' && r.structuredContent.levels[0].note === 'The name is not okay', r);
  r = await mine('submit_level', { id: own.id });
  r = await admin('admin_review', { id: own.id, decision: 'approve' });
  check('mcp: approving makes it public', r.structuredContent.status === 'public' && r.structuredContent.was === 'pending', r);
  r = await tool('list_levels', { sort: 'top' });
  check('mcp: list_levels lists it with its link', r.structuredContent.levels.length === 1 && r.structuredContent.levels[0].id === own.id && /\?level=/.test(r.structuredContent.levels[0].play_url), r);
  r = await call('GET', '/api/levels', null, D);
  check('the game lists the approved level', r.body.levels.length === 1 && r.body.levels[0].name === 'Mo\'s Maze', r.body);
  // THE RATING (core.js rate): an added field wherever a level is answered, and the public list searched, filtered by it and paged
  const RC = require('../core.js'), isD = d => !!d && RC.TIERS.indexOf(d.tier) === d.level - 1 && d.of === 5 && Number.isInteger(d.points);
  r = await tool('preview_level', design);
  check('rating: preview_level answers the difficulty its design works out to', isD(r.structuredContent.difficulty) && r.structuredContent.difficulty.tier === RC.rate(RC.customLevel(design)).tier && !!r.structuredContent.stats, r.structuredContent.difficulty);
  r = await tool('get_level', { id: own.id });
  const ownD = r.structuredContent.difficulty;
  check('rating: get_level answers it beside everything it answered before', isD(ownD) && Array.isArray(r.structuredContent.sections) && !!r.structuredContent.stats && !!r.structuredContent.leaderboard, r.structuredContent);
  r = await tool('get_level', { id: 'city' });
  check('rating: the game\'s own first level is TRICKY, two of five', r.structuredContent.difficulty.tier === 'TRICKY' && r.structuredContent.difficulty.level === 2 && r.structuredContent.name === 'ELM STREET', r.structuredContent);
  r = await tool('list_levels', { sort: 'top' });
  check('rating: list_levels rates each level and says the total and the pages', isD(r.structuredContent.levels[0].difficulty) && r.structuredContent.levels[0].difficulty.tier === ownD.tier && r.structuredContent.total === 1 && r.structuredContent.page === 1 && r.structuredContent.pages === 1 && r.structuredContent.per === 30, r.structuredContent);
  const otherTier = RC.TIERS.filter(x => x !== ownD.tier)[0], count = async a => (await tool('list_levels', a)).structuredContent.levels.length;
  check('rating: list_levels filters by rating and searches by name and maker', await count({ difficulty: ownD.tier }) === 1 && await count({ difficulty: otherTier }) === 0 && await count({ search: 'maze' }) === 1 && await count({ search: 'MO\'S' }) === 1 && await count({ search: 'zzzz' }) === 0 && await count({ search: 'maze', difficulty: otherTier }) === 0);
  r = await call('GET', '/api/levels?sort=new&q=maze&difficulty=' + ownD.level + '&page=9&per=1', null, D);
  check('rating: the game\'s list takes the same (a page past the end is the last page)', r.body.levels.length === 1 && isD(r.body.levels[0].difficulty) && r.body.page === 1 && r.body.pages === 1 && r.body.per === 1 && r.body.total === 1, r.body);
  check('rating: and a filter nothing fits is an empty page, not an error', (await call('GET', '/api/levels?difficulty=' + otherTier, null, D)).body.total === 0);
  r = await call('GET', '/api/level?id=' + own.id, null, D);
  check('rating: the level\'s own answer has it', isD(r.body.difficulty) && r.body.difficulty.tier === ownD.tier && Array.isArray(r.body.sections), r.body.difficulty);
  r = await call('GET', '/api/level?id=' + own.id, null, P);
  check('the game knows a level is yours', r.body.yours === true && r.body.status === 'public' && r.body.owner === undefined, r.body);

  // sponsors: the game's maker to begin with; the reviewer adds and changes them; the game counts runs and taps
  r = await call('GET', '/api/me', null, D);
  check('the game is told the sponsor', r.body.ads.length === 1 && r.body.ads[0].text === 'GLYPHH' && r.body.ads[0].url === 'https://glyphh.ai' && r.body.ads[0].views === undefined, r.body.ads);
  await call('POST', '/api/track', { did: D.did, t: 'ad', ad: 'glyphh', k: 'view' });
  await call('POST', '/api/track', { did: D.did, t: 'ad', ad: 'glyphh', k: 'view' });
  await call('POST', '/api/track', { did: D.did, t: 'ad', ad: 'glyphh', k: 'click' });
  r = await admin('admin_ads', {});
  check('mcp: the reviewer sees each ad with its runs and taps', r.structuredContent.ads[0].views === 2 && r.structuredContent.ads[0].clicks === 1 && r.structuredContent.ads[0].live === true, r);
  r = await admin('admin_ad_set', { id: 'soda', text: 'Fizz Cola', sub: 'drink it falling', url: 'https://example.com/fizz', color: '#35E8FF' });
  check('mcp: the reviewer adds a sponsor', !r.isError && r.structuredContent.text === 'FIZZ COLA' && r.structuredContent.color === '#35e8ff' && r.structuredContent.live === true, r);
  r = await admin('admin_ad_set', { id: 'bad', text: 'THIS ONE IS FAR TOO LONG FOR A SIGN' });
  check('mcp: a sign has to fit', r.isError && /fit on a sign/.test(r.content[0].text), r);
  r = await admin('admin_ad_set', { id: 'glyphh', live: false });
  r = await call('GET', '/api/me', null, D);
  check('an ad switched off is gone from the game, a new one is in', r.body.ads.length === 1 && r.body.ads[0].id === 'soda', r.body.ads);
  r = await tool('admin_ad_set', { id: 'x', text: 'NOPE' });
  check('nobody else can set an ad', r === undefined || r.isError, r);

  // the admin is a person: signed in with Google as support@glyphh.ai, the same connector has the reviewer's tools
  const signedIn = async (claims) => {                               // sign in to the game, allow the app, trade the code: that player's token and cookie
    const c = (await call('POST', '/api/auth/google', { credential: idToken(claims) }, { did: 'device-' + claims.sub + '-0000' })).cookie;
    const pg = await call('GET', '/oauth/authorize?' + new URLSearchParams(ask), null, { raw: true, cookie: c });
    const yes = await call('POST', '/oauth/authorize', Object.assign({ answer: 'yes', mark: (/name="mark" value="([^"]+)"/.exec(pg.body) || [])[1] }, ask), { raw: true, form: true, cookie: c });
    const tk = await call('POST', '/oauth/token', Object.assign({}, grant, { code: new URL(yes.headers.Location).searchParams.get('code'), code_verifier: verifier }), { form: true });
    return { cookie: c, auth: { headers: { authorization: 'Bearer ' + tk.body.access_token } } };
  };
  const boss = await signedIn({ sub: 'u9', email: 'Support@Glyphh.ai', email_verified: true, name: 'Glyphh Support' });
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, boss.auth);
  check('signed in as support@glyphh.ai, the connector has the review tools', r.body.result.tools.length === 22 && r.body.result.tools.some(t => t.name === 'admin_queue'), r.body.result.tools.map(t => t.name));
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'admin_levels', arguments: {} } }, boss.auth);
  check('and they work', !r.body.result.isError && r.body.result.structuredContent.levels.length === 2, r.body);
  r = await call('GET', '/api/admin/data', null, { cookie: boss.cookie });
  check('the same account opens the admin dashboard with no password', r.code === 200 && !!r.body.overview, r.code);
  const bossTool = async (name, args) => (await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: name, arguments: args } }, boss.auth)).body.result;
  r = await bossTool('admin_stats', {});
  check('mcp: the admin reads the game\'s numbers', !r.isError && r.structuredContent.overview.players > 0 && Array.isArray(r.structuredContent.days) && r.structuredContent.first_level_funnel.length > 5 && r.structuredContent.ad_links.length > 0, r);
  r = await bossTool('admin_players', { limit: 2 });
  const someone = r.structuredContent.players[0];
  check('mcp: and the players', r.structuredContent.players.length === 2 && !!someone.did, r);
  r = await bossTool('admin_player', { did: someone.did });
  check('mcp: and one of them', !r.isError && r.structuredContent.device.did === someone.did && Array.isArray(r.structuredContent.runs), r);
  r = await bossTool('admin_campaign_set', { code: 'Reddit-Claude', note: 'the Claude video' });
  check('mcp: and makes an ad link', /\/\?src=reddit-claude$/.test(r.structuredContent.link), r);
  r = await bossTool('admin_payments', {});
  check('mcp: and sees the payments', Array.isArray(r.structuredContent.payments), r);
  r = await call('POST', '/api/admin/tool', { name: 'admin_levels', args: {} }, { cookie: boss.cookie });
  check('the admin page uses the same tools', r.code === 200 && r.body.levels.length === 2, r.body);
  r = await call('POST', '/api/admin/tool', { name: 'publish_level', args: {} }, { cookie: boss.cookie });
  check('but only the admin ones', r.code === 400, r);
  r = await call('POST', '/api/admin/tool', { name: 'admin_levels', args: {} }, T);
  check('and only for the admin', r.code === 401, r.code);
  const fake = await signedIn({ sub: 'u10', email: 'support@glyphh.ai', email_verified: false, name: 'Not Support' });
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, fake.auth);
  check('an address Google does not vouch for is not the admin', r.body.result.tools.length === 12, r.body.result.tools.length);
  r = await call('GET', '/api/admin/data', null, { cookie: fake.cookie });
  check('nor on the dashboard', r.code === 401, r.code);

  // the game inside Claude: play_level points at a page, the page is the whole game in one file, and it scores through the connector
  r = await mcp('tools/list');
  const pl = r.body.result.tools.find(t => t.name === 'play_level');
  check('mcp: play_level names the page that plays it', pl && pl._meta.ui.resourceUri === 'ui://free-fall-frank/play/2', pl);
  r = await mcp('resources/list');
  check('mcp: the page is listed as an MCP App', r.body.result.resources[0].uri === 'ui://free-fall-frank/play/2' && r.body.result.resources[0].mimeType === 'text/html;profile=mcp-app', r.body);
  r = await mcp('resources/read', { uri: 'ui://free-fall-frank/play/2' });
  const page = r.body.result.contents[0];
  check('mcp: the page is the game in one file, with nothing to fetch to start', page.mimeType === 'text/html;profile=mcp-app' && /FFFCore/.test(page.text) && /McpApp/.test(page.text) && !/<script src=/.test(page.text) && !/serviceWorker/.test(page.text) && /FFF_PANEL = true/.test(page.text), page.text.length);
  check('and may reach only the game\'s own site', page._meta.ui.csp.connectDomains.join() === 'https://freefallfrank.com' && page._meta.ui.csp.resourceDomains.join() === 'https://freefallfrank.com', page._meta);
  const modern = (method, params) => call('POST', '/mcp', { jsonrpc: '2.0', id: 5, method: method, params: Object.assign({ _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } }, params) }, { headers: { 'mcp-protocol-version': '2026-07-28', authorization: 'Bearer ' + TOKEN } });
  r = await modern('server/discover', {});
  check('mcp 2026-07-28: server/discover says what is supported', r.body.result.supportedVersions[0] === '2026-07-28' && !!r.body.result.capabilities.resources && r.body.result.resultType === 'complete', r.body);
  r = await modern('resources/read', { uri: 'ui://free-fall-frank/play/2' });
  check('mcp 2026-07-28: a read says how long it may be kept', r.body.result.ttlMs === 0 && r.body.result.cacheScope === 'private' && r.body.result.contents.length === 1 && r.body.result._meta['io.modelcontextprotocol/serverInfo'].name === 'free-fall-frank', Object.keys(r.body.result));
  r = await modern('tools/list', {});
  check('mcp 2026-07-28: so does the list of tools', r.body.result.ttlMs === 0 && r.body.result.tools.length === 12, Object.keys(r.body.result));
  r = await tool('play_level', {});
  check('mcp: play_level with no id opens the game\'s own level', !r.isError && r.structuredContent.id === 'city' && r.structuredContent.level === null && r.structuredContent.play_url === 'https://freefallfrank.com/', r);
  r = await mine('play_level', { id: own.id });
  check('mcp: play_level hands the page the level, the player\'s name and their made Frank', r.structuredContent.level.sections.length === 4 && r.structuredContent.player === 'Mo In App' && r.structuredContent.frank.id === fr.id, r);
  r = await tool('record_score', { level: own.id, score: 100, pct: 1 });
  check('mcp: a score played in the chat is kept for whoever is signed in', r.structuredContent.saved === true && r.structuredContent.players === 1 && r.structuredContent.me.name === 'PLAYER', r);
  r = await mine('record_score', { level: own.id, score: 3000, pct: 30, played: true });
  check('mcp: a score played in the chat goes on the board under the player', r.structuredContent.saved === true && r.structuredContent.top[0].name === 'Mo In App' && r.structuredContent.me.rank === 1, r);

  // ----- a sign-in link by email: she asks, the email goes out (to the fake Resend above), she opens the link and presses the button -----
  const sha = s => crypto.createHash('sha256').update(String(s)).digest('base64url');
  const uidOf = cookie => Buffer.from(cookie.slice(4).split('.')[0], 'base64url').toString();   // whose session a cookie is
  let ips = 0;
  const askLink = (email, o) => call('POST', '/api/auth/link', Object.assign({ email: email }, o && o.back ? { back: o.back } : {}), { headers: { 'fly-client-ip': (o && o.ip) || '10.1.0.' + (++ips) } });
  const linkIn = m => (/https:\/\/[^\s"<]+\/auth\/link\?token=[\w-]+/.exec(m.body.text) || [])[0], tokenOf = link => new URL(link).searchParams.get('token');
  const press = (token, o) => call('POST', '/auth/link', Object.assign({ token: token }, o && o.did ? { did: o.did } : {}), Object.assign({ raw: true, form: true }, o && o.headers ? { headers: o.headers } : {}, o && o.cookie ? { cookie: o.cookie } : {}));
  const viaLink = async (email, o) => { const n = mails.length; await askLink(email, o); const token = tokenOf(linkIn(mails[n])), p = await press(token, o); return { cookie: p.cookie, to: p.headers.Location, token: token, code: p.code }; };
  const adminOpen = async cookie => (await call('GET', '/api/admin/data', null, { cookie: cookie })).code;

  r = await call('GET', '/api/me', null, D);
  check('link: the game is told a sign-in link by email is on offer', r.body.link === true, r.body.link);
  r = await askLink('  Nell@Example.com ');
  const mail = mails[mails.length - 1], link = linkIn(mail), token = tokenOf(link);
  check('link: asking answers ok and nothing more', r.code === 200 && JSON.stringify(r.body) === '{"ok":true}', r);
  check('link: one email went to Resend, to her, from the game, with the key', mails.length === 1 && mail.method === 'POST' && mail.headers.Authorization === 'Bearer re_test_fake' && mail.body.to.join() === 'nell@example.com' && mail.body.from === 'Free Fall Frank <support@glyphh.ai>' && Object.keys(mail.body).sort().join() === 'from,html,subject,text,to', mail);
  check('link: the email has a subject, the link in both parts, the 15 minutes and the "ignore it"', mail.body.subject === 'Your sign-in link for Free Fall Frank' && !!link && /^https:\/\/free-fall-frank\.fly\.dev\/auth\/link\?token=[\w-]{43}$/.test(link) && mail.body.html.split(link).length === 4   /* the button, and the raw link (shown, and linked) */
    && /expires in 15 minutes/.test(mail.body.text) && /expires in 15 minutes/.test(mail.body.html) && /did not ask for this, ignore it/.test(mail.body.text) && /did not ask for this, ignore it/.test(mail.body.html), mail.body.text);
  check('link: the email has no pictures, no scripts and nothing fetched from elsewhere', !/<img|<script|<link|url\(|src=/i.test(mail.body.html) && (mail.body.html.match(/href="([^"]+)"/g) || []).every(h => h.indexOf(link) > 0 || h === 'href="https://freefallfrank.com"'), mail.body.html.match(/href="([^"]+)"/g));
  let rows = await db.all('SELECT * FROM email_links');
  check('link: only the token\'s SHA-256 is kept, with the address, 15 minutes and where to return', rows.length === 1 && rows[0].hash === sha(token) && JSON.stringify(rows[0]).indexOf(token) < 0 && rows[0].email === 'nell@example.com' && Number(rows[0].expires) - Number(rows[0].created) === 15 * 60000 && rows[0].back === '/play' && Number(rows[0].used) === 0, rows);
  check('link: no account is made until the link is used', !await db.get('SELECT 1 AS x FROM users WHERE id = ?', ['email:nell@example.com']));
  // opening the link (a mail scanner, a preview, or her) only shows the page with the button
  r = await call('GET', '/auth/link?token=' + token, null, { raw: true });
  await call('GET', '/auth/link?token=' + token, null, { raw: true });
  check('link: opening it shows a page with a SIGN IN button, in the game\'s look, and signs nobody in', r.code === 200 && /<form method="post" action="\/auth\/link">/.test(r.body) && /name="token" value="/.test(r.body) && /<button>SIGN IN<\/button>/.test(r.body) && /nell@example\.com/.test(r.body) && /FREE FALL<\/small>FRANK/.test(r.body)
    && !r.headers['Set-Cookie'] && r.headers['Cache-Control'] === 'no-store' && r.headers['Referrer-Policy'] === 'no-referrer', r.headers);
  check('link: opening it, twice, does not spend it', Number((await db.get('SELECT used FROM email_links WHERE hash = ?', [sha(token)])).used) === 0);
  r = await press(token.slice(0, -4) + 'AAAA');
  check('link: a wrong token is refused, with a friendly page and a way to ask again', r.code === 400 && !r.headers['Set-Cookie'] && /not one of ours/.test(r.body) && /EMAIL ME A NEW LINK/.test(r.body) && /href="\/play"/.test(r.body), r.body.slice(0, 200));
  r = await call('GET', '/auth/link?token=nope', null, { raw: true });
  check('link: and so is no token at all', r.code === 400 && /not one of ours/.test(r.body) && (await call('GET', '/auth/link', null, { raw: true })).code === 400, r.code);
  r = await press(token, { headers: { 'sec-fetch-site': 'cross-site' } });
  check('link: another site cannot press the button for her (and that does not spend it)', r.code === 400 && !r.headers['Set-Cookie'] && Number((await db.get('SELECT used FROM email_links WHERE hash = ?', [sha(token)])).used) === 0, r.code);
  // a device that played before signing in: what it earned moves to the account, as with Google
  const ND = { did: 'device-nell-0005' };
  await call('POST', '/api/tokens', { frank: 0, count: 100000 }, ND);
  await call('POST', '/api/earn', { frank: 7 }, ND);
  await call('POST', '/api/heart', { level: 'city', on: true }, ND);
  await call('POST', '/api/score', { level: 'city', score: 800, pct: 8, name: 'Nell', played: true }, ND);
  const gset = (await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u20', email: 'attrs@example.com' }) }, {})).headers['Set-Cookie'];
  r = await press(token, ND);
  const N = { cookie: r.cookie, did: ND.did };
  check('link: pressing the button signs her in and sends her into the game', r.code === 303 && r.headers.Location === '/play' && r.cookie.indexOf('fff=') === 0 && r.headers['Cache-Control'] === 'no-store', r.headers);
  check('link: with the same session cookie Google\'s sign-in sets', r.headers['Set-Cookie'].replace(/^fff=[^;]+/, '') === gset.replace(/^fff=[^;]+/, '') && /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000$/.test(r.headers['Set-Cookie']), r.headers['Set-Cookie'].replace(/^fff=[^;]+/, ''));
  r = await call('GET', '/api/me', null, N);
  check('link: /api/me is that account, a new one named for the address', uidOf(N.cookie) === 'email:nell@example.com' && r.body.user && r.body.user.email === 'nell@example.com' && r.body.user.name === '', r.body.user);
  check('link: the device\'s tokens, Frank and heart moved to the account', r.body.coins === cap - 250 && r.body.unlocked.join() === '7' && r.body.hearts.city.mine === true && !await db.get('SELECT 1 AS x FROM users WHERE id = ?', ['dev:' + ND.did]), r.body);
  r = await call('GET', '/api/board?level=city', null, { cookie: N.cookie });
  check('link: and its score on the board', r.body.me && r.body.me.name === 'Nell' && r.body.me.score === 800, r.body.me);
  r = await press(token);
  check('link: a link works once', r.code === 400 && !r.headers['Set-Cookie'] && /has been used/.test(r.body) && /EMAIL ME A NEW LINK/.test(r.body), r.body.slice(0, 200));
  r = await call('GET', '/auth/link?token=' + token, null, { raw: true });
  check('link: opening a used link says so', r.code === 400 && /has been used/.test(r.body) && !/<button>SIGN IN/.test(r.body), r.code);
  r = await call('GET', '/auth/link?token=' + token, null, { raw: true, cookie: N.cookie });
  check('link: and to someone signed in already, shows the way on', r.code === 400 && /signed in already/.test(r.body) && /href="\/play">CARRY ON/.test(r.body) && !/EMAIL ME A NEW LINK/.test(r.body), r.body.slice(0, 200));
  // a link that ran out
  await askLink('nell@example.com');
  const late = tokenOf(linkIn(mails[mails.length - 1]));
  await db.run('UPDATE email_links SET expires = ? WHERE hash = ?', [Date.now() - 1000, sha(late)]);
  r = await call('GET', '/auth/link?token=' + late, null, { raw: true });
  const pressed = await press(late);
  check('link: after 15 minutes it is refused, opened or pressed', r.code === 400 && /has run out/.test(r.body) && pressed.code === 400 && !pressed.headers['Set-Cookie'] && /has run out/.test(pressed.body), [r.code, pressed.code]);
  r = await viaLink('nell@example.com');
  check('link: a second link signs her in to the same account', r.code === 303 && uidOf(r.cookie) === 'email:nell@example.com' && (await db.all("SELECT id FROM users WHERE email = 'nell@example.com'")).length === 1, r);

  // nothing is given away about who has an account, and nonsense is not an address
  const known = await askLink('tess@example.com'), unknown = await askLink('nobody-here@example.com');
  check('link: the answer is the same for an address with an account and one without', known.code === 200 && unknown.code === 200 && JSON.stringify(known.body) === JSON.stringify(unknown.body) && JSON.stringify(known.headers) === JSON.stringify(unknown.headers) && mails.slice(-2).map(m => m.body.to[0]).join() === 'tess@example.com,nobody-here@example.com', [known, unknown]);
  let n = mails.length;
  for (const bad of ['', 'frank', 'frank@', '@example.com', 'frank@example', 'fr ank@example.com', 'frank@example.com\nbcc: x@y.z', 'a@b.c, d@e.f', 'frank@@example.com', 'x'.repeat(250) + '@example.com', { a: 1 }])
    check('link: ' + JSON.stringify(bad).slice(0, 30) + ' is not an address', (await askLink(bad)).code === 400, bad);
  check('link: and nothing was sent for those', mails.length === n);

  // where the link returns to: a path on this site, never another site
  r = await viaLink('ret@example.com', { back: '/?level=abc1234' });
  check('link: the path she asked from is where she lands', r.code === 303 && r.to === '/?level=abc1234', r.to);
  for (const evil of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', '/play\r\nSet-Cookie: x=1', 'play', '/' + 'a'.repeat(5000)]) {
    r = await viaLink('ret' + (++ips) + '@example.com', { back: evil });
    check('link: a return to ' + JSON.stringify(evil).slice(0, 28) + ' is refused: the game instead', r.code === 303 && r.to === '/play', r.to);
  }

  // limits: unused links per address, links per address an hour, links per IP an hour
  for (let i = 0; i < 3; i++) r = await askLink('lim@example.com');
  n = mails.length;
  const fourth = await askLink('lim@example.com');
  check('link: an address may have three unused links, no more', r.code === 200 && fourth.code === 429 && /wait 15 minutes/.test(fourth.body.error) && mails.length === n, fourth);
  await db.run('UPDATE email_links SET used = 1 WHERE email = ?', ['lim@example.com']);
  r = await askLink('lim@example.com');                                    // the fifth asked this hour (the fourth counted too)
  const sixth = await askLink('lim@example.com');
  check('link: and five asked for in an hour, whatever became of them', r.code === 200 && sixth.code === 429 && /too many/.test(sixth.body.error), [r.code, sixth]);
  for (let i = 0; i < 20; i++) r = await askLink('ip' + i + '@example.com', { ip: '10.9.9.9' });
  n = mails.length;
  const flood = await askLink('ip20@example.com', { ip: '10.9.9.9' });
  check('link: one IP address may ask for twenty an hour', r.code === 200 && flood.code === 429 && mails.length === n && (await askLink('ip20@example.com', { ip: '10.9.9.10' })).code === 200, [r.code, flood]);
  mailDown = true;
  r = await askLink('down@example.com');
  mailDown = false;
  check('link: when the email cannot be sent she is told, and no link is left behind', r.code === 502 && /could not be sent/.test(r.body.error) && !await db.get('SELECT 1 AS x FROM email_links WHERE email = ?', ['down@example.com']), r);

  // one person, one account: a link and Google with the same address Google vouches for, in both orders
  const AG = (await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u21', email: 'Ann@Example.com', email_verified: true, name: 'Ann G' }) }, { did: 'device-anng-0006' })).cookie;
  await call('POST', '/api/tokens', { frank: 0, count: 40 }, { cookie: AG });
  r = await viaLink('ann@example.com');
  const viaMail = await call('GET', '/api/me', null, { cookie: r.cookie });
  check('link: Google first, then a link: the link signs in to the Google account, no second one', uidOf(r.cookie) === 'google:u21' && viaMail.body.user.name === 'Ann G' && viaMail.body.coins === 40 && !await db.get('SELECT 1 AS x FROM users WHERE id = ?', ['email:ann@example.com'])
    && (await db.all("SELECT id FROM users WHERE LOWER(email) = 'ann@example.com'")).length === 1, [uidOf(r.cookie), viaMail.body]);
  const BL = (await viaLink('bo@example.com')).cookie;
  await call('POST', '/api/tokens', { frank: 0, count: 30 }, { cookie: BL });
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u22', email: 'Bo@Example.com', email_verified: true, name: 'Bo G' }) }, { did: 'device-bogg-0007' });
  const viaGoogle = await call('GET', '/api/me', null, { cookie: r.cookie });
  check('link: a link first, then Google: Google lands in the account the link made, no second one', r.code === 200 && uidOf(r.cookie) === 'email:bo@example.com' && viaGoogle.body.coins === 30 && viaGoogle.body.user.email === 'bo@example.com' && viaGoogle.body.user.name === 'Bo G'
    && !await db.get('SELECT 1 AS x FROM users WHERE id = ?', ['google:u22']) && (await db.all("SELECT id FROM users WHERE LOWER(email) = 'bo@example.com'")).length === 1, [uidOf(r.cookie), viaGoogle.body]);
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u22', email: 'Bo@Example.com', email_verified: true }) }, {});
  check('link: and again the next time Google signs her in', uidOf(r.cookie) === 'email:bo@example.com', uidOf(r.cookie));
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u23', email: 'bo@example.com', email_verified: false, name: 'Not Bo' }) }, {});
  check('link: an address Google does not vouch for gets no one else\'s account', uidOf(r.cookie) === 'google:u23' && (await call('GET', '/api/me', null, { cookie: r.cookie })).body.coins === 0, uidOf(r.cookie));
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u1b', email: 'nell@example.com' }) }, {});
  check('link: nor one whose token does not say it is verified', uidOf(r.cookie) === 'google:u1b', uidOf(r.cookie));
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'u3', email: 'bo@example.com', email_verified: true }) }, {});
  check('link: a Google account that was here before stays its own', uidOf(r.cookie) === 'google:u3' && (await call('GET', '/api/me', null, { cookie: r.cookie })).body.user.name === 'Tess Ter', uidOf(r.cookie));

  // the admin is whoever proves an admin address: a link proves the mailbox as Google's word does
  r = await viaLink('Boss@Example.com');
  check('link: an admin address proven by a link opens the admin dashboard', uidOf(r.cookie) === 'email:boss@example.com' && await adminOpen(r.cookie) === 200, uidOf(r.cookie));
  check('link: any other address proven by a link does not', await adminOpen(N.cookie) === 401 && await adminOpen(BL) === 401);
  r = await viaLink('support@glyphh.ai');
  check('link: support@glyphh.ai by link is the same admin account Google signs in', uidOf(r.cookie) === 'google:u9' && await adminOpen(r.cookie) === 200, uidOf(r.cookie));

  // connecting Claude with an account made by email: the sign-in page offers the link, and the link comes back to consent
  r = await call('GET', '/oauth/authorize?' + new URLSearchParams(ask), null, { raw: true });
  const here = JSON.parse((/back = ("(?:[^"\\]|\\.)*")/.exec(r.body) || [])[1] || '""');
  check('oauth: the sign-in page offers a link by email under Google, returning to this same request', /id="g"/.test(r.body) && r.body.indexOf('id="g"') < r.body.indexOf('EMAIL ME A SIGN-IN LINK') && /^\/oauth\/authorize\?/.test(here) && new URLSearchParams(here.split('?')[1]).get('state') === 'st8'
    && new URLSearchParams(here.split('?')[1]).get('code_challenge') === challenge, here);
  r = await viaLink('claude-fan@example.com', { back: here });
  check('oauth: the link signs her in and sends her back to the request', r.code === 303 && r.to === here, r.to);
  const CF = r.cookie;
  r = await call('GET', r.to, null, { raw: true, cookie: CF });
  const mark2 = (/name="mark" value="([^"]+)"/.exec(r.body) || [])[1];
  check('oauth: where she is asked to allow the app, as the address she proved', r.code === 200 && !!mark2 && /claude-fan@example\.com/.test(r.body) && /<button name="answer" value="yes">ALLOW/.test(r.body), r.body.slice(r.body.indexOf('<main>'), r.body.indexOf('<main>') + 400));
  r = await call('POST', '/oauth/authorize', Object.assign({ answer: 'yes', mark: mark2 }, ask), { raw: true, form: true, cookie: CF });
  r = await call('POST', '/oauth/token', Object.assign({}, grant, { code: new URL(r.headers.Location).searchParams.get('code'), code_verifier: verifier }), { form: true });
  const CFA = { headers: { authorization: 'Bearer ' + r.body.access_token } };
  check('oauth: allowing gives the app a token', r.code === 200 && !!r.body.access_token, r.body);
  r = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'publish_level', arguments: Object.assign({}, design, { name: 'By Mail' }) } }, CFA);
  const byMail = r.body.result.structuredContent;
  check('oauth: and the connector then builds as that player', !r.body.result.isError && (await db.get('SELECT uid FROM levels WHERE id = ?', [byMail.id])).uid === 'email:claude-fan@example.com', r.body.result);

  // without RESEND_API_KEY there is no such way to sign in
  delete process.env.RESEND_API_KEY;
  n = mails.length;
  r = await call('GET', '/api/me', null, D);
  check('link: without the key the game is told it is not on offer', r.body.link === false, r.body.link);
  r = await askLink('nell@example.com');
  check('link: and asking says email sign-in is off, and sends nothing', r.code === 503 && /not set up/.test(r.body.error) && mails.length === n, r);
  r = await call('GET', '/oauth/authorize?' + new URLSearchParams(ask), null, { raw: true });
  check('oauth: and the sign-in page is Google alone', r.code === 200 && /id="g"/.test(r.body) && !/EMAIL ME/.test(r.body) && !/auth\/link/.test(r.body), r.body.length);
  r = await call('GET', '/auth/link?token=' + token, null, { raw: true });
  check('link: and a bad link\'s page does not offer a new one', r.code === 400 && !/EMAIL ME/.test(r.body) && /href="\/play"/.test(r.body), r.code);
  process.env.RESEND_API_KEY = 're_test_fake';

  r = await call('POST', '/api/delete-account', {}, N);
  check('link: an account made by email can be deleted', r.code === 200 && !await db.get('SELECT 1 AS x FROM users WHERE id = ?', ['email:nell@example.com']) && !await db.get('SELECT 1 AS x FROM email_links WHERE email = ?', ['nell@example.com']), r);
  p = await file('/sw.js');
  check('the service worker leaves an emailed link\'s page alone', /indexOf\('\/auth\/'\) === 0/.test(p.body));
  p = await file('/play');
  check('the game\'s sign-in has the email option under Google\'s button', p.body.indexOf('id="acct-google"') > 0 && p.body.indexOf('id="acct-google"') < p.body.indexOf('id="acct-link"') && /Email me a sign-in link/.test(p.body) && /id="acct-sent"/.test(p.body));

  // ---------- the paid level: ROCK BOTTOM, 99 cents, once ----------
  // Its stretches stay on the server for anyone who has not paid: they get the taste. Paying is the pack's way
  // (an account, Stripe Checkout, confirmed on return or by /api/me), its board takes owners' scores only, and its
  // hidden things are kept per player and pay tokens once.
  const WORLDS = require('../worlds.js'), fullL = CORE.buildLevel(WORLDS.rock.full), tasteL = CORE.buildLevel(WORLDS.rock.taste);
  const DL = { did: 'device-rock-0001' }, tasteSecret = WORLDS.rock.taste.secrets[0].id, deepSecret = WORLDS.rock.secrets.filter(s => WORLDS.rock.taste.secrets.every(x => x.id !== s))[0];
  r = await call('GET', '/api/me', null, DL);
  let lv = r.body.levels && r.body.levels.rock;
  check('level: /api/me offers it at 99 cents, not owned, and says only how many hidden things there are', !!lv && lv.price === 99 && lv.owned === false && lv.secrets >= 8 && lv.found.length === 0 && r.body.secretTokens === 40 && !/"kind"|"sec"|spot|cameo/.test(JSON.stringify(r.body.levels)), r.body.levels);
  check('level: nothing changed for the free Franks and the pack', r.body.free.join() === '0,1,2' && r.body.pack.id === 'classic' && r.body.pack.price === 99 && r.body.pack.from === 3 && r.body.pack.to === 23 && r.body.tokenPrice === 250 && r.body.packs.length === 0, r.body);
  r = await call('GET', '/api/world?id=rock', null, DL);
  const tasteKeys = r.body.spec ? r.body.spec.defs.map(d => d.key) : [];
  check('level: an unpaid player is served the taste only: its first stretches and a wall', r.code === 200 && r.body.taste === true && r.body.owned === false && r.body.price === 99 && tasteKeys.length === 4 && tasteKeys[3] === 'wall' && r.body.spec.defs[3].wall === true
    && JSON.stringify(r.body).length < JSON.stringify(WORLDS.rock.full).length / 3 && !/lord|grudge|furnace|belfry/.test(JSON.stringify(r.body)), tasteKeys);
  const tasteSecs = CORE.buildLevel(r.body.spec).totalBeats * 60 / r.body.spec.bpm;
  check('level: the taste builds, and is 20 to 30 seconds', tasteSecs >= 20 && tasteSecs <= 30.5 && CORE.buildLevel(r.body.spec).totalBeats < fullL.totalBeats / 5, tasteSecs);
  r = await call('GET', '/api/world?id=rock');
  check('level: with no device and no account, still the taste', r.code === 200 && r.body.taste === true && r.body.spec.defs.length === 4, r.body.taste);
  check('level: no such level', (await call('GET', '/api/world?id=nope', null, DL)).code === 404 && (await call('GET', '/api/world', null, DL)).code === 404);
  check('level: its stretches are not a file anyone can fetch', (await file('/worlds.js')).code === 404 && (await file('/worlds.js?x=1')).code === 404);
  r = await call('POST', '/api/score', { level: 'rock', score: 4000, pct: 9, name: 'Sneak', played: true }, DL);
  check('level: a score from someone who has not paid is refused', r.code === 403, r);
  r = await call('GET', '/api/board?level=rock', null, DL);
  check('level: its board can be looked at, and is empty', r.code === 200 && r.body.level === 'rock' && r.body.players === 0, r.body);
  r = await call('POST', '/api/secret', { level: 'rock', id: tasteSecret }, DL);
  check('level: a hidden thing in the taste is kept for the device and pays 40 tokens', r.code === 200 && r.body.first === true && r.body.tokens === 40 && r.body.coins === 40 && r.body.found.join() === tasteSecret && r.body.secrets === lv.secrets, r.body);
  r = await call('POST', '/api/secret', { level: 'rock', id: tasteSecret }, DL);
  check('level: found again, it pays nothing', r.code === 200 && r.body.first === false && r.body.tokens === 0 && r.body.coins === 40 && r.body.found.length === 1, r.body);
  check('level: a hidden thing past the wall, or made up, is refused to someone who has not paid', (await call('POST', '/api/secret', { level: 'rock', id: deepSecret }, DL)).code === 400 && (await call('POST', '/api/secret', { level: 'rock', id: 'zz' }, DL)).code === 400
    && (await call('POST', '/api/secret', { level: 'city', id: tasteSecret }, DL)).code === 400 && (await call('POST', '/api/secret', { level: 'rock', id: tasteSecret })).code === 401);
  r = await call('POST', '/api/tokens', { frank: 100, count: 100000 }, DL);
  check('level: tokens from the taste are capped at what the taste holds', r.code === 200 && r.body.coins === 40 + tasteL.maxTokens && tasteL.maxTokens < fullL.maxTokens / 4, r.body);
  check('level: no tokens for a level number that is not one', (await call('POST', '/api/tokens', { frank: 101, count: 5 }, DL)).code === 400 && (await call('POST', '/api/tokens', { frank: 24, count: 5 }, DL)).code === 400);
  r = await call('POST', '/api/checkout', { level: 'rock' }, DL);
  check('level: paying needs an account', r.code === 401, r);
  r = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'rocky', email: 'rocky@example.com', name: 'Rocky Faller' }) }, DL);
  const R = { cookie: r.cookie, did: DL.did };
  r = await call('GET', '/api/me', null, R);
  check('level: signing in brings the device\'s hidden things and tokens along, and owns nothing yet', r.body.user && r.body.levels.rock.owned === false && r.body.levels.rock.found.join() === tasteSecret && r.body.coins === 40 + tasteL.maxTokens, r.body.levels);
  check('level: an unknown level is not for sale', (await call('POST', '/api/checkout', { level: 'nope' }, R)).code === 400);
  const before = Object.keys(sessions).length;
  r = await call('POST', '/api/checkout', { level: 'rock' }, R);
  const lsid = Object.keys(sessions)[before], ls = sessions[lsid] || {};
  check('level: checkout makes a 99 cent, one-time Stripe session for this level and this account', r.code === 200 && r.body.url === ls.url && Object.keys(sessions).length === before + 1 && ls.amount_total === 99 && /ROCK BOTTOM/.test(ls.name)
    && ls.metadata.app === 'free-fall-frank' && ls.metadata.level === 'rock' && ls.metadata.user === 'google:rocky' && ls.metadata.pack === undefined && /\/\?paid=\{CHECKOUT_SESSION_ID\}$/.test(ls.success) && /\/\?level=rock$/.test(ls.cancel), ls);
  check('level: the checkout says it is one-time and not refundable', /one-time/i.test(ls.desc) && /not refundable/i.test(ls.desc), ls.desc);
  r = await call('GET', '/api/confirm?session_id=' + lsid, null, R);
  check('level: an unpaid checkout unlocks nothing', r.body.ok === false && (await call('GET', '/api/world?id=rock', null, R)).body.taste === true, r.body);
  ls.payment_status = 'paid';
  r = await call('GET', '/api/confirm?session_id=' + lsid, null, { cookie: other });
  check('level: someone else cannot claim the paid checkout', r.body.ok === false && (await call('GET', '/api/world?id=rock', null, { cookie: other })).body.taste === true, r.body);
  r = await call('GET', '/api/confirm?session_id=' + lsid, null, R);
  check('level: confirming the paid checkout unlocks the level', r.code === 200 && r.body.ok === true && r.body.level === 'rock', r.body);
  r = await call('GET', '/api/confirm?session_id=' + lsid, null, R);
  await call('GET', '/api/me', null, R);
  const ownedRows = await db.all('SELECT * FROM owned WHERE uid = ?', ['google:rocky']), boughtRows = await db.all('SELECT * FROM purchases WHERE uid = ?', ['google:rocky']);
  check('level: confirmed again (and again by /api/me), it is unlocked once and paid for once', r.body.ok === true && ownedRows.length === 1 && ownedRows[0].level === 'rock' && ownedRows[0].session === lsid && boughtRows.length === 1 && boughtRows[0].kind === 'level:rock'
    && boughtRows[0].amount === 99 && !(await db.get('SELECT 1 AS x FROM pending WHERE session = ?', [lsid])), [ownedRows, boughtRows]);
  r = await call('GET', '/api/world?id=rock', null, R);
  check('level: its owner is served all of it', r.code === 200 && r.body.owned === true && r.body.taste === false && r.body.spec.defs.length === WORLDS.rock.full.defs.length && r.body.spec.secrets.length === lv.secrets && CORE.buildLevel(r.body.spec).totalBeats === fullL.totalBeats, r.body.spec && r.body.spec.defs.length);
  r = await call('GET', '/api/me', null, R);
  check('level: /api/me says it is theirs, and the pack is still not', r.body.levels.rock.owned === true && r.body.packs.length === 0 && r.body.unlocked.length === 0, r.body);
  check('level: it cannot be bought twice', (await call('POST', '/api/checkout', { level: 'rock' }, R)).code === 400 && Object.keys(sessions).length === before + 1);
  check('level: the same account on another device has it too', (await call('GET', '/api/world?id=rock', null, { cookie: R.cookie, did: 'device-rock-0002' })).body.owned === true);
  r = await call('POST', '/api/score', { level: 'rock', score: 31000, pct: 100, name: 'Rocky', played: true }, R);
  check('level: its owner\'s score goes on its board', r.code === 200 && r.body.level === 'rock' && r.body.players === 1 && r.body.top[0].score === 31000 && r.body.me.rank === 1, r.body);
  check('level: a score no run could make is refused', (await call('POST', '/api/score', { level: 'rock', score: (15000 + 10 * fullL.maxTokens) * 2 + 1, pct: 100 }, R)).code === 400 && (await call('POST', '/api/score', { level: 'rock', score: (15000 + 10 * fullL.maxTokens) * 2, pct: 100 }, R)).code === 200);
  check('level: and still nobody else\'s', (await call('POST', '/api/score', { level: 'rock', score: 50, pct: 1 }, { did: 'device-rock-0003' })).code === 403 && (await call('POST', '/api/score', { level: 'rock', score: 50, pct: 1 }, { cookie: other })).code === 403
    && (await call('GET', '/api/board?level=rock')).body.players === 1);
  r = await call('POST', '/api/secret', { level: 'rock', id: deepSecret }, R);
  check('level: its owner\'s hidden things past the wall count', r.code === 200 && r.body.first === true && r.body.found.length === 2 && r.body.coins === 80 + tasteL.maxTokens, r.body);
  r = await call('POST', '/api/tokens', { frank: 100, count: 100000 }, R);
  check('level: its owner\'s tokens are capped at what the whole level holds', r.code === 200 && r.body.coins === 80 + tasteL.maxTokens + fullL.maxTokens, r.body);
  // the first level, the made levels and the connector know nothing of it
  r = await call('POST', '/api/score', { level: 'city', score: 1234, pct: 20, name: 'Dev', played: true }, { did: 'device-rock-0003' });
  check('level: the first level\'s board still takes anyone\'s score', r.code === 200 && r.body.level === 'city' && r.body.me.score === 1234 && (await call('POST', '/api/score', { level: 'city', score: 60001, pct: 100 }, { did: 'device-rock-0003' })).code === 400, r.body);
  check('level: it is not a made level, and has no page among them', (await call('GET', '/api/level?id=rock', null, DL)).code === 404 && !(await call('GET', '/api/levels?sort=top')).body.levels.some(l => l.id === 'rock'));
  r = await call('POST', '/api/heart', { level: 'rock', on: true }, R);
  check('level: it can be given a heart', r.code === 200 && r.body.n === 1 && (await call('GET', '/api/me', null, R)).body.hearts.rock.mine === true, r.body);
  // the admin: the plays, clears and sales of each level
  await call('POST', '/api/track', { did: DL.did, t: 'run', frank: 100, pct: 100, sec: 'wall', secs: 29, tokens: 50, res: 'taste' }, R);
  await call('POST', '/api/track', { did: DL.did, t: 'run', frank: 100, pct: 100, sec: 'bottom', secs: 291, tokens: 570, res: 'win' }, R);
  await call('POST', '/api/track', { did: DL.did, t: 'run', frank: 100, pct: 41, sec: 'lord', secs: 120, tokens: 200, res: 'burn' }, R);
  check('level: a run of a level number that is not one is refused', (await call('POST', '/api/track', { did: DL.did, t: 'run', frank: 101, pct: 5, secs: 3 })).code === 400);
  r = await call('GET', '/api/admin/data', null, ADM);
  const rockRow = r.body.levels.find(l => l.frank === 100), cityRow = r.body.levels.find(l => l.frank === 0), sale = (r.body.sales || []).find(s => s.kind === 'level:rock'), packSale = (r.body.sales || []).find(s => s.kind === 'pack:classic');
  check('level: the admin sees its plays, tastes, clears and purchases', !!rockRow && rockRow.name === 'ROCK BOTTOM' && rockRow.plays === 3 && rockRow.clears === 1 && rockRow.tastes === 1 && rockRow.paid === true && rockRow.purchases === 1 && rockRow.revenue === 99 && /lord/.test(rockRow.dies), rockRow);
  check('level: the admin\'s sales list has it beside the pack, and the money adds up', !!sale && sale.n === 1 && sale.buyers === 1 && sale.revenue === 99 && /ROCK BOTTOM/.test(sale.name) && !!packSale && packSale.revenue === 99 && r.body.overview.revenue === 198 && cityRow.name === 'FRANK' && cityRow.paid === undefined, r.body.sales);
  r = await call('GET', '/api/admin/payments', null, ADM);
  check('level: the admin\'s payments name it', r.body.payments.some(x => x.id === lsid && x.paid && x.amount === 99 && x.what === 'Level: ROCK BOTTOM'), r.body.payments);
  r = await call('GET', '/api/admin/player?did=' + DL.did, null, ADM);
  check('level: a player\'s detail shows the level, their purchase and what they found', r.code === 200 && r.body.owned.length === 1 && r.body.owned[0].level === 'rock' && r.body.secrets.length === 2 && r.body.purchases.some(x => x.kind === 'level:rock') && r.body.levels.some(l => l.frank === 100 && l.name === 'ROCK BOTTOM'), r.body);
  // the admin gets everything without paying: signed in as the admin's address, or with the admin password
  const adm = await call('POST', '/api/auth/google', { credential: idToken({ sub: 'rock-admin', email: 'support@glyphh.ai', email_verified: true, name: 'Support' }) }, { did: 'device-rock-0009' });
  r = await call('GET', '/api/world?id=rock', null, { cookie: adm.cookie });
  check('level: the admin is served all of it without paying', r.body.owned === true && r.body.spec.defs.length === WORLDS.rock.full.defs.length && (await call('GET', '/api/world?id=rock', null, ADM)).body.owned === true
    && (await call('POST', '/api/score', { level: 'rock', score: 10, pct: 1, name: 'Admin' }, { cookie: adm.cookie })).code === 200 && !(await db.get('SELECT 1 AS x FROM owned WHERE uid = ?', ['google:rock-admin'])), r.body.owned);
  // no store: refused cleanly
  const key = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  r = await call('POST', '/api/checkout', { level: 'rock' }, { cookie: other });
  const offMe = (await call('GET', '/api/me', null, { cookie: other })).body;
  process.env.STRIPE_SECRET_KEY = key;
  check('level: with no Stripe key the checkout is refused cleanly and nothing is made', r.code === 503 && /store/.test(r.body.error) && Object.keys(sessions).length === before + 1 && offMe.store === false && offMe.levels.rock.owned === false, r);
  // deleting the account takes the level and what was found with it
  await call('POST', '/api/delete-account', {}, R);
  check('level: a deleted account\'s level and hidden things are gone', !(await db.get('SELECT 1 AS x FROM owned WHERE uid = ?', ['google:rocky'])) && !(await db.get('SELECT 1 AS x FROM secrets WHERE uid = ?', ['google:rocky'])) && (await call('GET', '/api/world?id=rock', null, DL)).body.taste === true);
  // what ships: the new file is in the image, the old client files are still what the worker keeps, and its cache has a new name
  const docker = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8'), sw = (await file('/sw.js')).body, shipped = docker.split('\n').filter(l => /^COPY /.test(l)).join(' ');
  check('level: the image has every file the server needs', ['server.js', 'levels.js', 'oauth.js', 'worlds.js', 'core.js', 'franks.js', 'audio.js', 'account.js', 'game.js', 'index.html', 'landing.html', 'admin.html', 'sw.js'].every(f => shipped.indexOf(' ' + f + ' ') > 0), shipped);
  check('level: the service worker\'s cache is named by the build and never keeps the level\'s data', /const BUILD = '[0-9a-f]{10}', CACHE = 'fff-' \+ BUILD/.test(sw) && !/worlds/.test(sw) && /indexOf\('\/api\/'\) === 0/.test(sw), sw.slice(0, 200));
  p = await file('/play?level=rock');
  check('level: a link to it is the game (which opens on its card)', p.code === 200 && /id="game"/.test(p.body) && /played=1/.test(String(p.headers['Set-Cookie'])), p.code);

  console.log(failed ? 'FAILED' : 'OK server');
  await DB.done();
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); Promise.resolve(DB && DB.done()).catch(function () {}).then(function () { process.exit(1); }); });
