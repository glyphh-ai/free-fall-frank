// Free Fall Frank: who the player is and which Franks they have.
// Three Franks are free for everyone. Any other is earned with tokens, or one payment unlocks the whole pack.
// Nobody has to sign up to play, collect tokens or earn Franks: the device has its own wallet. An account
// (Google, Apple or a link sent to her email) is only asked for at the moment of paying, and takes the device's wallet with it.
(function (root) {
  'use strict';
  const me = { ready: false, user: null, unlocked: [], packs: [], free: [0, 1, 2], pack: { id: 'classic', name: 'All Franks', price: 99, from: 3, to: 23 },
    price: 99, tokenPrice: 250, coins: 0, google: null, apple: null, link: false, store: false,
    levels: {}, secretTokens: 40 };                                 // levels: the paid ones (price, owned, the hidden things found), by id
  const listeners = [];
  let note = '', googleDrawn = false, wantBuy = '', sentTo = '', watching = 0;   // wantBuy: what she was on her way to pay for when asked to sign in ('pack', or a level's id)
  let busy = 0, paying = false, lastMe = 0;                         // a sign-in or a checkout on its way to the server; when /api/me was last asked
  const pay = function (what) { return what === 'pack' ? buy() : buyLevel(what); };
  const $ = function (id) { return document.getElementById(id); };

  // net.js is what speaks to the server: this device's own id (it owns the wallet until there is an account, and ties
  // plays together for the stats), the outbox, and the reads that are asked again while the machine wakes or restarts.
  // Inside Claude (the game as an MCP App) there is no server to call: the page's own bridge stands in for `api`.
  const Net = root.FFFNet, SV = root.FFFSave, did = Net.did, online = Net.online;

  // a read (asked again through a restart), or something done by hand at this moment (asked once)
  function call(path, data) { return data ? Net.post(path, data) : Net.read(path); }
  // what the game reports: a visit, and each attempt at a level (never anything personal). An attempt goes through
  // the outbox, so one made while the server was away is still counted, once.
  function track(what) {
    if (!online) return;
    if (what.t === 'run') { Net.send('run', Object.assign({ did: did }, what)); return; }
    try { fetch('/api/track', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ did: did }, what)) }).catch(function () {}); } catch (e) { /* never in the way of the game */ }
  }
  // Hearts: a player can heart a level, and every level shows how many players have. This device remembers its
  // own hearts so they show straight away and offline; the server keeps the count.
  function hearted(id) { return localStorage.getItem('fff.heart.' + id) === '1'; }
  function hearts(id) { const h = me.hearts && me.hearts[id]; return h ? h.n : hearted(id) ? 1 : 0; }
  function heart(id) {
    const on = !hearted(id);
    localStorage.setItem('fff.heart.' + id, on ? '1' : '0');
    if (me.hearts) { const h = me.hearts[id] = me.hearts[id] || { n: 0 }; h.n = Math.max(0, h.n + (on ? 1 : -1)); h.mine = on; }
    if (online) Net.send('heart', { level: id, on: on }, function (b) { return b.level === id; });   // (the last word on a level is the one that waits)
    return on;
  }
  // What the server says about this player. It is only ever added to what this browser has: a heart, a hidden thing
  // or tokens that are still waiting in the outbox are his already, whatever an answer from before they arrive says.
  function apply(d) {
    Object.assign(me, { offline: false }, d, { ready: true });
    if (d.hearts) Object.keys(d.hearts).forEach(function (id) { localStorage.setItem('fff.heart.' + id, d.hearts[id].mine ? '1' : '0'); });
    if (online && !me.offline) {
      Net.iam(d);                                                   // whose the outbox's things are from here on, and send what waits
      Net.mine('heart').forEach(function (x) { const h = me.hearts && me.hearts[x.b.level]; localStorage.setItem('fff.heart.' + x.b.level, x.b.on ? '1' : '0'); if (h && !!h.mine !== !!x.b.on) { h.n = Math.max(0, h.n + (x.b.on ? 1 : -1)); h.mine = !!x.b.on; } });
      Net.mine('secret').forEach(function (x) { const lv = me.levels[x.b.level]; if (lv && lv.found && lv.found.indexOf(x.b.id) < 0) lv.found.push(x.b.id); });
      if (!owed()) againN = 0;
    }
    moveStash();
    render();
    listeners.forEach(function (f) { f(me); });
    return me;
  }
  // Back from Stripe (/?paid=<checkout session>): the session is written down before anything else, and the server
  // is asked to confirm it until it has answered, through a restart, a reload or a closed tab. Asking twice is safe:
  // a checkout is granted once. (Had the answer never come at all, the server still asks Stripe about every checkout
  // an account left open, each time that account is looked up: /api/me.)
  const PAID = 'fff.paid';
  function owed() { let p = null; try { p = JSON.parse(SV.get(PAID) || 'null'); } catch (e) { p = null; } return p && p.id && p.at > Date.now() - 7 * 864e5 ? p : null; }
  function confirmPaid() {
    const p = owed();
    if (!p) return Promise.resolve();
    return Net.read('/api/confirm?session_id=' + encodeURIComponent(p.id)).then(function (r) { SV.put(PAID, ''); if (r.ok) api.justBought = r.level || true; }, function () { /* the server is away: asked again with the next look */ });
  }
  let againT = 0, againN = 0;
  function refresh() {
    if (root.FFF_ME) return Promise.resolve(apply(root.FFF_ME));       // test hook
    if (root.FFF_PANEL) return Promise.resolve(apply({ offline: true }));
    lastMe = Date.now(); clearTimeout(againT);
    // (asked again, less and less often, only while something waits on it: a checkout to confirm, or with no answer at all, what is in the outbox)
    const again = function () { if (againN < 12) againT = setTimeout(refresh, Math.min(300000, 4000 * Math.pow(2, againN++))); };   // (then it waits for her to come back to the tab)
    return confirmPaid().then(function () { return call('/api/me'); }).then(function (d) { apply(d); if (owed()) again(); return me; }).catch(function () {
      if (Net.mine().length || owed()) again();                     // no answer: he plays on as he is
      return apply({ offline: true });
    });
  }
  // open = can play, buy = has to be earned with tokens or bought with the pack
  function status(i) {
    if (me.free.indexOf(i) >= 0 || me.unlocked.indexOf(i) >= 0 || i >= 24) return 'open';   // past the game's own 24 are the Franks a player made: theirs
    return me.packs.indexOf(me.pack.id) >= 0 && i >= me.pack.from && i <= me.pack.to ? 'open' : 'buy';
  }
  function priceText() { return '$' + (me.pack.price / 100).toFixed(2); }

  // Tokens live in the wallet on the server (the device's, or the account's). What a fall picked up goes there
  // through the outbox: until the server has answered it waits in this browser, and counts as his all the while.
  function stash() { return Math.max(0, Math.floor(SV.num('fff.tokens'))); }   // tokens an earlier build kept back while offline
  function wallet() { return me.coins + stash() + (online ? Net.mine('tokens').reduce(function (a, x) { return a + (+x.b.count || 0); }, 0) : 0); }
  function bank(n, frank) {
    if (!(n > 0)) return Promise.resolve();
    if (!online) { me.coins += n; return Promise.resolve(); }
    return Net.send('tokens', { frank: frank, count: n }).catch(function () { /* refused: there is nothing to do about it */ });
  }
  function moveStash() {                                            // what an earlier build kept back goes into the outbox, as it sent it: 150 at a time
    let n = stash();
    if (!online || me.offline || !(n > 0)) return;
    localStorage.setItem('fff.tokens', 0);
    for (; n > 0; n -= 150) bank(Math.min(n, 150), 0);
  }
  Net.on('tokens', function (r) { if (typeof r.coins === 'number') me.coins = r.coins; });
  Net.on('secret', function (r, x) { const lv = me.levels[x.b.level]; if (lv && r.found) lv.found = r.found; if (typeof r.coins === 'number') me.coins = r.coins; });
  Net.on('who', function () { refresh(); });                        // the server says this is not who the page thought: ask
  function earn(i) {
    return call('/api/earn', { frank: i }).then(function (r) { if (!r.ok) throw new Error(r.error); return refresh(); });
  }

  function loadScript(src) {
    return new Promise(function (ok, bad) {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = bad;
      document.head.appendChild(s);
    });
  }
  // (busy: a sign-in is going to the server and back; the page does not reload itself under it)
  function signedIn(p) {
    busy++;
    return p.then(function (r) { if (!r.ok) throw new Error(); note = ''; return refresh(); })
      .then(function () { if (wantBuy && me.user) { const w = wantBuy; wantBuy = ''; pay(w).catch(function () {}); } })     // they signed in to pay: carry straight on
      .catch(function () { note = 'That sign-in did not work. Try again.'; render(); })
      .then(function () { busy--; });
  }
  function drawGoogle() {
    if (googleDrawn || !me.google) return;
    googleDrawn = true;
    loadScript('https://accounts.google.com/gsi/client').then(function () {
      root.google.accounts.id.initialize({ client_id: me.google, callback: function (r) { signedIn(call('/api/auth/google', { credential: r.credential })); } });
      root.google.accounts.id.renderButton($('acct-google'), { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', width: 260 });
    }).catch(function () { googleDrawn = false; });
  }
  function appleSignIn() {
    loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js').then(function () {
      root.AppleID.auth.init({ clientId: me.apple, scope: 'name email', redirectURI: location.origin + '/', usePopup: true });
      return root.AppleID.auth.signIn();
    }).then(function (r) {
      const n = r.user && r.user.name ? (r.user.name.firstName || '') + ' ' + (r.user.name.lastName || '') : '';
      signedIn(call('/api/auth/apple', { id_token: r.authorization.id_token, name: n.trim() }));
    }).catch(function () { /* closed the popup */ });
  }
  // A sign-in link by email. The link signs in whichever browser opens it (her phone's mail app, say); this page
  // is told nothing about it. But opened in this same browser, the sign-in is this page's too: while "check your
  // email" shows, the page looks every few seconds and carries on signed in (and on to paying, if that was why).
  function sendLink(e) {
    e.preventDefault();
    const mail = $('acct-email').value.trim();
    if (!mail) return;
    $('acct-link-go').disabled = true; note = ''; render();
    call('/api/auth/link', { email: mail, back: wantBuy === 'pack' ? '/?screen=select' : wantBuy ? '/?level=' + wantBuy : location.pathname + location.search }).then(function (r) {
      if (r.ok) { sentTo = mail; watch(); }
      else note = r.error ? r.error.charAt(0).toUpperCase() + r.error.slice(1) + '.' : 'That did not send. Try again.';   // the server's own words: too many, or not an address
    }).catch(function () { note = 'That did not send. Try again.'; })
      .then(function () { $('acct-link-go').disabled = false; render(); });
  }
  function watch() {
    const until = Date.now() + 15 * 6e4;
    clearInterval(watching);
    watching = setInterval(function () {
      if (!sentTo || Date.now() > until) { clearInterval(watching); return; }
      if (document.hidden) return;
      call('/api/me').then(function (d) {
        if (!d.user || !sentTo) return;
        const what = wantBuy;                                         // closing the sheet forgets it, and being signed in closes the sheet
        unsend(); apply(d);
        if (what) pay(what).catch(function () {});
      }).catch(function () {});
    }, 4000);
  }
  function unsend() { sentTo = ''; clearInterval(watching); }

  function render() {
    const el = $('acct');
    if (!el) return;
    const inn = !!me.user;
    const link = !!me.link && online, sent = !inn && link && !!sentTo;
    $('acct-out').hidden = inn || sent; $('acct-in').hidden = !inn; $('acct-sent').hidden = !sent;
    $('acct-note').textContent = note || (!inn && !me.google && !me.apple && !link ? 'Sign-in is not available right now.' : '');
    $('acct-apple').hidden = !me.apple;
    $('acct-link').hidden = !link; $('acct-link').querySelector('.or').hidden = !me.google && !me.apple;
    $('acct-sent-to').textContent = sentTo;
    if (inn) {
      $('acct-name').textContent = me.user.name || me.user.email || 'Signed in';
      $('acct-mail').textContent = me.user.name ? me.user.email : '';
      $('acct-count').textContent = me.packs.length ? 'All Franks unlocked' : (me.free.length + me.unlocked.length) + ' Franks unlocked';
    } else if (!el.hidden) drawGoogle();
  }
  function open(why) { note = ''; $('acct-why').textContent = why || 'An account keeps your Franks and tokens on every device. You only need one to pay.'; $('acct').hidden = false; render(); }
  function close() { $('acct').hidden = true; wantBuy = ''; unsend(); }

  // buy the pack: every Frank at once. This is the one moment an account is asked for.
  function buy() {
    if (!me.user) { wantBuy = 'pack'; open('Sign in to pay ' + priceText() + ' for every Frank. They are then yours on any device.'); return Promise.resolve(); }
    if (me.packs.indexOf(me.pack.id) >= 0) return Promise.resolve();   // signed back in on a new device: already theirs
    return checkout({ pack: me.pack.id });
  }
  // Stripe's checkout, and off to it. (paying: from the press until the page has left for Stripe, it is not reloaded.)
  function checkout(what) {
    paying = true;
    return call('/api/checkout', what).then(function (d) {
      if (!d.url) throw new Error(d.error || 'no checkout');
      location.href = d.url;
    }).catch(function (e) { paying = false; throw e; });
  }
  // buy a paid level, the same way: sign in if she has not, then Stripe's checkout. One payment, once.
  function levelPrice(id) { const lv = me.levels[id]; return lv ? '$' + (lv.price / 100).toFixed(2) : ''; }
  function buyLevel(id) {
    const lv = me.levels[id];
    if (!lv) return Promise.reject(new Error('no such level'));
    if (!me.user) { wantBuy = id; open('Sign in to pay ' + levelPrice(id) + ' for ' + lv.name + '. It is then yours on any device. A one-time purchase, not refundable.'); return Promise.resolve(); }
    if (lv.owned) return Promise.resolve();                           // signed back in on a new device: already theirs
    return checkout({ level: id });
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('acct-close').onclick = close;
    $('acct').onclick = function (e) { if (e.target === $('acct')) close(); };
    $('acct-apple').onclick = appleSignIn;
    $('acct-link').onsubmit = sendLink;
    $('acct-other').onclick = function () { unsend(); render(); };
    $('acct-signout').onclick = function () { call('/api/logout', {}).then(refresh); };
    $('acct-delete').onclick = function () {
      if (confirm('Delete your account and every Frank you unlocked? This cannot be undone.')) call('/api/delete-account', {}).then(refresh);
    };
  });

  // A call to the server for the game's own screens (made levels, leaderboards); it fails at once where there is no
  // server. What the game tells the server through here goes by the outbox: a hidden thing found, an attempt's score,
  // and the profile (only the last word on each of its fields waits). Where the game waits for the answer to carry on
  // (a new name going up on a board, the profile), the wait is given up after eight seconds; the thing still goes.
  const BOXED = { '/api/secret': 'secret', '/api/score': 'score', '/api/profile': 'profile' };
  function ask(path, data) {
    if (!online) return Promise.reject(new Error('offline'));
    const t = data && BOXED[path];
    if (t === 'profile') return Net.send(t, data, function (b) { return Object.keys(b).join() === Object.keys(data).join(); }, 8000);
    if (t) return Net.send(t, data, null, t === 'score' && !data.played ? 8000 : 0);
    // (a name or a Frank that has not reached the server yet is his already)
    if (path === '/api/profile') return call(path).then(function (p) { Net.mine('profile').forEach(function (x) { if (p && x.b.name) p.name = x.b.name; if (p && x.b.frank !== undefined) p.frank = String(x.b.frank); }); return p; });
    return call(path, data);
  }
  // when the page may not reload itself into a new build (net.js): a sign-in or a checkout is on its way, she is
  // waiting for an emailed link, the account sheet is open, or she is just back from paying and it is not confirmed yet
  Net.hold(function () { const p = owed(); return busy > 0 || paying || !!sentTo || api.isOpen() || (!!p && p.at > Date.now() - 6e5); });
  if (online) {
    root.addEventListener('pageshow', function (e) { if (e.persisted) paying = false; });   // back from Stripe by the back button: the page as it was
    // Back in the tab: send what waits, and outside a fall ask who this is again (at most once a minute), which is
    // also how a page that sat open through a deploy hears of the new build. Nothing is asked on a timer.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      againN = 0; Net.nudge();
      if (!Net.falling() && Date.now() - lastMe > 60000) refresh();
      Net.maybe();
    });
  }
  const api = { api: ask, signOut: function () { return call('/api/logout', {}).then(refresh); }, me: me, status: status, priceText: priceText, open: open, close: close, buy: buy, buyLevel: buyLevel, levelPrice: levelPrice, refresh: refresh, wallet: wallet, bank: bank, earn: earn, track: track, heart: heart, hearts: hearts, hearted: hearted,
    isOpen: function () { const el = $('acct'); return !!el && !el.hidden; },
    onChange: function (f) { listeners.push(f); }, justBought: false };
  root.FFFAccount = api;

  // a visit, with the ad link it came by: ?src=<code>, or the usual utm tags
  const q = new URLSearchParams(location.search), src = q.get('src') || q.get('utm_campaign') || q.get('utm_source') || '';
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { /* no referrer */ }
  if (!Net.reloaded) track({ t: 'visit', src: src, ref: ref === location.hostname ? '' : ref });   // (a page that reloaded itself into a new build is the same visit)

  // back from Stripe: /?paid=<checkout session>, kept until the server has confirmed it (confirmPaid, above)
  const paid = q.get('paid');
  if (root.FFF_ME) apply(root.FFF_ME);
  else {
    if (paid) { SV.put(PAID, JSON.stringify({ id: paid, at: Date.now() })); history.replaceState(null, '', location.pathname); }
    refresh();
  }
})(window);
