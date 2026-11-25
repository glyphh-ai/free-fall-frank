// test/db.cjs : the database a test file runs on. Without TEST_DATABASE_URL, a throwaway SQLite file (as always).
// With it (TEST_DATABASE_URL=postgres://... npm test), the real thing the machine runs on: a Postgres, in a schema
// of this test's own (fff_test_<name>_<pid>_<random>) that it makes first and drops when it is done, so nothing in
// "public", or in anything else in that database, is read or touched. server.js is told the schema by DB_SCHEMA.
//   const T = await require('./db.cjs').open('server');  S = require('../server.js');  ...  await T.done();
// open() must come before server.js is required: the server makes its tables as it loads.
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const URL_ = process.env.TEST_DATABASE_URL || '';
// a database for something run on its own (node server.js --check in another process): { env, exec(sql), all(sql), done() }
async function fresh(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fff-' + name + '-'));   // (on Postgres too: the server looks there for an old SQLite file to carry over, and must find none)
  if (!URL_) {
    let lite = null;
    const db = function () { return lite || (lite = new (require('node:sqlite').DatabaseSync)(path.join(dir, 'frank.db'))); }, shut = function () { if (lite) { lite.close(); lite = null; } };
    return { postgres: false, where: 'SQLite', env: { DATA_DIR: dir, DATABASE_URL: '', DB_SCHEMA: '' }, exec: async function (sql) { db().exec(sql); shut(); }, all: async function (sql) { const r = db().prepare(sql).all(); shut(); return r; }, done: async function () { shut(); fs.rmSync(dir, { recursive: true, force: true }); } };
  }
  const schema = 'fff_test_' + name.replace(/\W/g, '') + '_' + process.pid + '_' + crypto.randomBytes(3).toString('hex'), pg = require('pg');
  const one = async function (sql) { const c = new pg.Client({ connectionString: URL_ }); await c.connect(); try { await c.query('SET search_path TO ' + schema); return (await c.query(sql)).rows; } finally { await c.end(); } };
  const c = new pg.Client({ connectionString: URL_ }); await c.connect(); await c.query('CREATE SCHEMA ' + schema); await c.end();
  return { postgres: true, where: 'Postgres, schema ' + schema, schema: schema, env: { DATABASE_URL: URL_, DB_SCHEMA: schema, DATA_DIR: dir }, exec: one, all: one,
    done: async function () { const d = new pg.Client({ connectionString: URL_ }); await d.connect(); await d.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); await d.end(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
// the database of this process: sets what server.js reads, before it is required
async function open(name) {
  const f = await fresh(name);
  Object.keys(f.env).forEach(function (k) { if (f.env[k]) process.env[k] = f.env[k]; else delete process.env[k]; });
  if (f.postgres) console.log('(' + name + ': on ' + f.where + ')'); else f.done = async function () { /* the SQLite file is left in the temporary folder, as it always was */ };
  return f;
}
// How the newer tests ask the server, in the same process with no port (server.cjs has its own):
// caller(S)(method, url, body, headers) -> { status, json, text, body, heads }, and as(id), the headers of someone signed in.
const { Readable, Writable } = require('stream');
function caller(S) {
  return function (method, url, body, headers) {
    return new Promise(function (done) {
      const req = Readable.from(body ? [typeof body === 'string' ? body : JSON.stringify(body)] : []), parts = [];
      Object.assign(req, { method: method, url: url, headers: Object.assign({ host: 'freefallfrank.com' }, headers || {}) });
      const res = new Writable({ write: function (c, e, next) { parts.push(Buffer.from(c)); next(); } });
      Object.assign(res, { heads: {}, status: 200, setHeader: function (k, v) { this.heads[k.toLowerCase()] = v; }, writeHead: function (c, h) { this.status = c; Object.keys(h || {}).forEach(function (k) { res.heads[k.toLowerCase()] = h[k]; }); } });
      res.on('finish', function () { const buf = Buffer.concat(parts), text = buf.toString(); let j = null; try { j = JSON.parse(text); } catch (e) { j = null; } done({ status: res.status, json: j, text: text, body: buf, heads: res.heads }); });
      S.handle(req, res);
    });
  };
}
// someone signed in as that account (the server's own cookie), on a device of their own; dev(name): a device with no account
const as = function (id, secret) { const v = Buffer.from(id).toString('base64url') + '.' + (Date.now() + 864e5); return { 'x-did': 'device-' + id.replace(/\W/g, '') + '-aaaa', cookie: 'fff=' + v + '.' + crypto.createHmac('sha256', secret || 'test-secret').update(v).digest('base64url') }; };
const dev = function (name) { return { 'x-did': 'device-' + name + '-0000' }; };
// Stripe, Google and Resend as the tests see them: nothing leaves this process. sessions: Stripe's checkouts, by id.
function world(o) {
  o = o || {};
  const sessions = {}, mails = [], w = { sessions: sessions, mails: mails, down: false, asked: [] };
  // Google's word that someone is who they say: a key of the test's own, and idToken(claims) signed with it
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), jwk = Object.assign(pair.publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
  w.idToken = function (claims) {
    const enc = function (x) { return Buffer.from(JSON.stringify(x)).toString('base64url'); };
    const head = enc({ alg: 'RS256', kid: 'k1' }) + '.' + enc(Object.assign({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600 }, claims));
    return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), pair.privateKey).toString('base64url');
  };
  global.fetch = async function (url, opts) {
    const reply = function (code, obj) { return { ok: code < 300, status: code, json: async function () { return obj; } }; };
    url = String(url); w.asked.push(url);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return reply(200, { keys: [jwk] });
    if (url === 'https://api.resend.com/emails') { mails.push(JSON.parse(opts.body)); return reply(200, { id: 'email_' + mails.length }); }
    if (url.indexOf('https://api.stripe.com/') === 0 && w.down) return reply(503, { error: { message: 'stripe is away' } });
    if (url === 'https://api.stripe.com/v1/checkout/sessions' && opts.method === 'POST') {
      const p = Object.fromEntries(opts.body), s = { id: 'cs_test_' + Object.keys(sessions).length, url: 'https://checkout.stripe.test/pay/' + Object.keys(sessions).length, payment_status: 'unpaid', status: 'open', created: Math.floor(Date.now() / 1000), livemode: false,
        amount_total: +p['line_items[0][price_data][unit_amount]'], currency: 'usd', customer_details: { email: 'frank@example.com' }, success: p.success_url, metadata: { app: p['metadata[app]'], user: p['metadata[user]'], pack: p['metadata[pack]'], level: p['metadata[level]'] } };
      sessions[s.id] = s;
      return reply(200, s);
    }
    if (url.indexOf('https://api.stripe.com/v1/checkout/sessions?') === 0) return reply(200, { data: Object.values(sessions), has_more: false });
    const m = /^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/(.*)$/.exec(url);
    if (m) return sessions[m[1]] ? reply(200, sessions[m[1]]) : reply(404, { error: { message: 'no such session' } });
    throw new Error('THE NETWORK WAS ASKED FOR ' + url);
  };
  return w;
}
module.exports = { open: open, fresh: fresh, postgres: !!URL_, caller: caller, as: as, dev: dev, world: world };
