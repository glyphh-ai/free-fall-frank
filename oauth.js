// Signing in to the connector. An MCP client (claude.ai, Claude Code) that is told 401 by /mcp looks up where to sign
// in (/.well-known/oauth-protected-resource, then /.well-known/oauth-authorization-server), registers itself
// (/oauth/register), sends the person to /oauth/authorize, where they sign in with Google or a link sent to their
// email (the game's own accounts) and say yes, and trades the code it gets back for a token (/oauth/token). OAuth 2.1: the authorization code grant
// with PKCE (S256) for public clients, and refresh tokens. What the connector then does is done as that player.
'use strict';
const crypto = require('crypto');

module.exports = function (d) {
  const db = d.db, SITE = d.site, env = d.env;
  const hash = function (s) { return crypto.createHash('sha256').update(String(s)).digest('base64url'); };
  const rand = function (n) { return crypto.randomBytes(n).toString('base64url'); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const send = function (res, code, obj, more) { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS, more)); res.end(JSON.stringify(obj)); };
  const ACCESS_DAYS = 30, REFRESH_DAYS = 365;
  const RESOURCE = { resource: SITE + '/mcp', authorization_servers: [SITE], bearer_methods_supported: ['header'], resource_name: 'Free Fall Frank' };
  const SERVER = {
    issuer: SITE, authorization_endpoint: SITE + '/oauth/authorize', token_endpoint: SITE + '/oauth/token', registration_endpoint: SITE + '/oauth/register',
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['play'],
  };
  // what /mcp answers when nobody is signed in: where to find out how
  const CHALLENGE = 'Bearer resource_metadata="' + SITE + '/.well-known/oauth-protected-resource"';

  // a redirect address a client may use: https anywhere, or http on this machine (Claude Code listens on localhost)
  function okRedirect(u) {
    try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1')) || /^[a-z][a-z0-9+.-]*:$/.test(x.protocol) && x.protocol !== 'javascript:' && x.protocol !== 'data:' && x.protocol !== 'http:'; }
    catch (e) { return false; }
  }
  async function clientOf(id) {
    const r = id && await db.get('SELECT * FROM oauth_clients WHERE id = ?', [String(id)]);
    return r ? { id: r.id, name: r.name, redirects: JSON.parse(r.redirects) } : null;
  }
  async function issue(uid, client) {
    const access = rand(32), refresh = rand(32), now = Date.now();
    await db.run('INSERT INTO oauth_tokens (hash, uid, client, kind, expires) VALUES (?, ?, ?, ?, ?)', [hash(access), uid, client, 'access', now + ACCESS_DAYS * 864e5]);
    await db.run('INSERT INTO oauth_tokens (hash, uid, client, kind, expires) VALUES (?, ?, ?, ?, ?)', [hash(refresh), uid, client, 'refresh', now + REFRESH_DAYS * 864e5]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_DAYS * 86400, refresh_token: refresh, scope: 'play' };
  }
  // the player a request's bearer token stands for, or null
  async function playerOf(req) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    if (!m) return null;
    const t = await db.get("SELECT uid, expires FROM oauth_tokens WHERE hash = ? AND kind = 'access'", [hash(m[1])]);
    return t && Number(t.expires) > Date.now() ? t.uid : null;
  }
  // the fields of a posted form (the token endpoint and the consent form) or of JSON
  function form(req) {
    return new Promise(function (resolve, reject) {
      let s = '';
      req.on('data', function (c) { s += c; if (s.length > 20000) reject(new Error('too big')); });
      req.on('end', function () {
        try { resolve(/json/.test(String(req.headers['content-type'] || '')) || s.trim()[0] === '{' ? JSON.parse(s || '{}') : Object.fromEntries(new URLSearchParams(s))); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }
  const PAGE = function (title, inner) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + '</title>' +
      '<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#15131f"><style>' +
      'html,body{margin:0;min-height:100%;background:linear-gradient(#2d1b70,#1a1147 55%,#0c0722) fixed;color:#f1eefc;font:17px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}' +
      'main{max-width:420px;margin:0 auto;padding:9vh 22px 40px;text-align:center}h1{font:700 30px/1.1 "Courier New",monospace;color:#ffd23f;text-shadow:3px 3px 0 #0a0812;margin:0 0 4px}' +
      'h1 small{display:block;color:#35e8ff;font-size:17px}.card{background:#1c1830;border:3px solid #0a0812;padding:20px 18px;margin:22px 0}p{margin:10px 0}.dim{color:#b9b4d0;font-size:14px}' +
      'button{font:700 17px "Courier New",monospace;color:#fff;background:#ff4fd8;border:3px solid #0a0812;padding:12px 18px;width:100%;cursor:pointer;margin-top:10px;box-shadow:inset 0 -6px 0 rgba(0,0,0,.28),inset 0 5px 0 rgba(255,255,255,.28)}' +
      'button.no{background:#3b3f8f}#g{display:flex;justify-content:center;min-height:44px;margin:14px 0}.err{color:#ff4f6d}' +
      'input[type=email]{font:17px -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#fff;background:#0c0722;border:3px solid #0a0812;padding:11px 12px;width:100%;box-sizing:border-box;text-align:center;border-radius:0;-webkit-appearance:none}' +
      'input[type=email]::placeholder{color:#999}a{color:#35e8ff}a.btn{display:block;font:700 17px "Courier New",monospace;color:#fff;background:#ff4fd8;border:3px solid #0a0812;padding:12px 18px;text-decoration:none;box-shadow:inset 0 -6px 0 rgba(0,0,0,.28),inset 0 5px 0 rgba(255,255,255,.28)}' +
      '[hidden]{display:none}</style></head><body><main><h1><small>FREE FALL</small>FRANK</h1>' + inner + '</main></body></html>';
  };
  // "Email me a sign-in link", for these pages: the address goes to /api/auth/link with the path the link returns to.
  // Should the link be opened in another tab of this same browser, this page sees it is signed in and carries on.
  const LINK_FORM = function (back, label) {
    return '<form id="lf"><input type="email" id="lm" placeholder="you@example.com" autocomplete="email" autocapitalize="off" spellcheck="false" required aria-label="Your email address"><button>' + esc(label) + '</button></form><p class="dim" id="ls" role="status"></p>' +
      '<script>(function () { var f = document.getElementById("lf"), s = document.getElementById("ls"), back = ' + JSON.stringify(String(back)).replace(/</g, '\\u003c') + ', sent = false;' +
      'f.onsubmit = function (e) { e.preventDefault(); var m = document.getElementById("lm").value.trim(); if (!m) return; s.className = "dim"; s.textContent = "Sending...";' +
      'fetch("/api/auth/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: m, back: back }) }).then(function (x) { return x.json(); }).then(function (j) {' +
      'if (!j.ok) { s.className = "err"; s.textContent = j.error ? j.error.charAt(0).toUpperCase() + j.error.slice(1) + "." : "That did not send. Try again."; return; }' +
      'sent = true; f.hidden = true; s.textContent = "Check your email: a sign-in link is on its way to " + m + ". It works for 15 minutes, on any device."; })' +
      '.catch(function () { s.className = "err"; s.textContent = "That did not send. Try again."; }); };' +
      'var look = function () { if (!sent || document.hidden) return; fetch("/api/me", { cache: "no-store" }).then(function (x) { return x.json(); }).then(function (j) { if (j.user) location.href = back; }).catch(function () {}); };' +
      'document.addEventListener("visibilitychange", look); window.addEventListener("focus", look); })();</script>';
  };
  // the fields of an authorization request, checked. Returns { ok, client, q } or { error }.
  async function asked(q) {
    const client = await clientOf(q.client_id);
    if (!client) return { error: 'This app is not known here. Remove the connector in Claude and add it again.' };
    if (client.redirects.indexOf(q.redirect_uri) < 0) return { error: 'This app asked to send you somewhere it did not register.' };
    if (q.response_type !== 'code' || !q.code_challenge || (q.code_challenge_method || 'S256') !== 'S256') return { error: 'This app asked in a way that is not supported (it needs the code flow with PKCE).' };
    return { ok: true, client: client };
  }
  const KEEP = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

  // Handles the sign-in paths. Returns false when the path is not one of them.
  async function handle(req, res, url, accountOf) {
    const p = url.pathname;
    if (p.indexOf('/.well-known/oauth-protected-resource') === 0 || p.indexOf('/.well-known/oauth-authorization-server') === 0 || p === '/.well-known/openid-configuration' || p.indexOf('/oauth/') === 0) {
      if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
    } else return false;
    await d.ready;
    if (p.indexOf('/.well-known/oauth-protected-resource') === 0) return send(res, 200, RESOURCE), true;
    if (p.indexOf('/.well-known/oauth-authorization-server') === 0 || p === '/.well-known/openid-configuration') return send(res, 200, SERVER), true;

    if (p === '/oauth/register' && req.method === 'POST') {             // an app introduces itself
      if (d.tooMany(req, 'oauthreg', 60, 36e5)) return send(res, 429, { error: 'too_many_requests' }), true;
      let b;
      try { b = await form(req); } catch (e) { return send(res, 400, { error: 'invalid_client_metadata' }), true; }
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
      if (!uris.length || !uris.every(okRedirect)) return send(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or http on localhost)' }), true;
      const id = 'c_' + rand(12), name = String(b.client_name || 'An app').replace(/[<>]/g, '').slice(0, 60);
      await db.run('INSERT INTO oauth_clients (id, name, redirects, created) VALUES (?, ?, ?, ?)', [id, name, JSON.stringify(uris), Date.now()]);
      return send(res, 201, { client_id: id, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: Math.floor(Date.now() / 1000) }), true;
    }

    if (p === '/oauth/authorize') {
      const html = function (code, body) { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); res.end(body); };
      const q = req.method === 'POST' ? await form(req) : Object.fromEntries(url.searchParams), ask = await asked(q);
      if (!ask.ok) return html(400, PAGE('Free Fall Frank', '<div class="card"><p class="err">' + esc(ask.error) + '</p></div>')), true;
      const acct = await accountOf(req), back = function (params) { const u = new URL(q.redirect_uri); Object.keys(params).forEach(function (k) { if (params[k]) u.searchParams.set(k, params[k]); }); res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store' }); res.end(); };
      // the yes and the no come back here as a form, with a mark only this server could have made for this player and this request
      const mark = acct ? crypto.createHmac('sha256', env.SESSION_SECRET || 'x').update('oauth|' + acct.id + '|' + KEEP.map(function (k) { return q[k] || ''; }).join('|')).digest('base64url') : '';
      if (req.method === 'POST') {
        if (!acct || q.mark !== mark) return html(400, PAGE('Free Fall Frank', '<div class="card"><p class="err">That did not come from this page. Go back to Claude and connect again.</p></div>')), true;
        if (q.answer !== 'yes') return back({ error: 'access_denied', state: q.state }), true;
        const code = rand(24);
        await db.run('INSERT INTO oauth_codes (code, client, uid, redirect, challenge, expires) VALUES (?, ?, ?, ?, ?, ?)', [hash(code), ask.client.id, acct.id, q.redirect_uri, q.code_challenge, Date.now() + 5 * 6e4]);
        return back({ code: code, state: q.state }), true;
      }
      const hidden = KEEP.map(function (k) { return q[k] ? '<input type="hidden" name="' + k + '" value="' + esc(q[k]) + '">' : ''; }).join('');
      if (!acct) {
        // not signed in to the game yet: Google's own button, then this same page again; or a link by email, which
        // comes back to this same request (the path it returns to is kept with the link)
        const email = d.linkOn && d.linkOn(), here = '/oauth/authorize?' + new URLSearchParams(KEEP.filter(function (k) { return q[k]; }).map(function (k) { return [k, q[k]]; }));
        return html(200, PAGE('Sign in to Free Fall Frank', '<div class="card"><p><b>' + esc(ask.client.name) + '</b> wants to build levels and Franks as you.</p><p class="dim">Sign in to say who you are. The levels you make are then yours, on any device.</p>' +
          (env.GOOGLE_CLIENT_ID ? '<div id="g"></div><p class="err" id="e"></p>' : email ? '' : '<p class="err">Sign-in is not set up.</p>') +
          (email ? (env.GOOGLE_CLIENT_ID ? '<p class="dim">or</p>' : '') + LINK_FORM(here, 'EMAIL ME A SIGN-IN LINK') : '') + '</div>' +
          (!env.GOOGLE_CLIENT_ID ? '' : '<script src="https://accounts.google.com/gsi/client" async defer></script><script>window.onload = function () {' +
          'if (!window.google) { document.getElementById("e").textContent = "Google sign-in did not load. Reload the page."; return; }' +
          'google.accounts.id.initialize({ client_id: ' + JSON.stringify(env.GOOGLE_CLIENT_ID || '') + ', callback: function (r) {' +
          'fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json", "X-Did": localStorage.getItem("fff.did") || "" }, body: JSON.stringify({ credential: r.credential }) })' +
          '.then(function (x) { return x.json(); }).then(function (j) { if (j.ok) location.reload(); else document.getElementById("e").textContent = "That sign-in did not work. Try again."; }); } });' +
          'google.accounts.id.renderButton(document.getElementById("g"), { theme: "filled_black", size: "large", shape: "rectangular", text: "continue_with", width: 260 }); };</script>'))), true;
      }
      return html(200, PAGE('Connect Free Fall Frank', '<div class="card"><p><b>' + esc(ask.client.name) + '</b> wants to build levels and Franks, play, and change your profile as</p><p><b>' + esc(acct.name || acct.email || 'you') + '</b><br><span class="dim">' + esc(acct.name ? acct.email || '' : '') + '</span></p>' +   // an account made by email has no name: its address is shown once
        '<form method="post" action="/oauth/authorize">' + hidden + '<input type="hidden" name="mark" value="' + mark + '"><button name="answer" value="yes">ALLOW</button><button class="no" name="answer" value="no">NO THANKS</button></form>' +
        '<p class="dim">It cannot pay for anything or see your sign-in.</p></div>')), true;
    }

    if (p === '/oauth/token' && req.method === 'POST') {
      if (d.tooMany(req, 'oauthtok', 300, 6e4)) return send(res, 429, { error: 'too_many_requests' }), true;
      let b;
      try { b = await form(req); } catch (e) { return send(res, 400, { error: 'invalid_request' }), true; }
      if (b.grant_type === 'authorization_code') {
        const c = b.code && await db.get('SELECT * FROM oauth_codes WHERE code = ?', [hash(b.code)]);
        if (c) await db.run('DELETE FROM oauth_codes WHERE code = ?', [c.code]);     // a code is good once
        const proof = b.code_verifier ? crypto.createHash('sha256').update(String(b.code_verifier)).digest('base64url') : '';
        if (!c || Number(c.expires) < Date.now() || c.client !== b.client_id || c.redirect !== b.redirect_uri || proof !== c.challenge) return send(res, 400, { error: 'invalid_grant' }), true;
        return send(res, 200, await issue(c.uid, c.client)), true;
      }
      if (b.grant_type === 'refresh_token') {
        const t = b.refresh_token && await db.get("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'", [hash(b.refresh_token)]);
        if (!t || Number(t.expires) < Date.now() || (b.client_id && t.client !== b.client_id)) return send(res, 400, { error: 'invalid_grant' }), true;
        await db.run('DELETE FROM oauth_tokens WHERE hash = ?', [t.hash]);          // each refresh token is used once, and replaced
        await db.run('DELETE FROM oauth_tokens WHERE expires < ?', [Date.now()]);
        return send(res, 200, await issue(t.uid, t.client)), true;
      }
      return send(res, 400, { error: 'unsupported_grant_type' }), true;
    }
    return send(res, 404, { error: 'not_found' }), true;
  }
  return { handle: handle, playerOf: playerOf, challenge: CHALLENGE, page: PAGE, form: form, linkForm: LINK_FORM };   // the page's look and the email form, for the sign-in link's own pages
};
