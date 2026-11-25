// What players make and own: levels, their own Franks, a profile, and the leaderboards. Here are the store behind
// them, the game's own calls (/api/level, /api/levels, /api/score, /api/board, /api/profile, /api/frank), and the MCP
// connector at /mcp through which Claude (or any MCP client) builds a level or a Frank for somebody and hands back a
// link to play and share.
//
// Who is asking through the connector: the player who signed in when they added it (oauth.js: /mcp answers 401 until
// then), so what is made is theirs. A player's own connector address (/mcp?k=<code>, on their profile in the game)
// is the same thing without the sign-in, for a device that has no account. The reviewer is whoever signs in with the
// admin's Google account (server.js ADMINS): the same connector then also has the admin_ tools. (An address that
// carries the admin key, /mcp?admin=<key>, is the reviewer too: for scripts.)
//
// A made level is playable by its link at once. To get onto the public list in the game its maker submits it, and it
// is listed once a reviewer approves it. Making, sharing and listing are all free.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');

module.exports = function (d) {
  const db = d.db, json = d.json, body = d.body, tooMany = d.tooMany, FRANKS = d.FRANKS, CORE = d.CORE, TRACKS = d.TRACKS, SITE = d.site;
  const BUILT_IN = { city: { id: 'city', name: 'ELM STREET', author: 'Frank', world: 0 } };
  const HATS = ['none', 'tuft', 'afro', 'antenna', 'band', 'beanie', 'chef', 'cowboy', 'crown', 'flat', 'helmet', 'mohawk', 'tophat', 'wizard'];
  const EXTRAS = ['bolts', 'bowtie', 'bun', 'flies', 'ghost', 'grain', 'mustard', 'nose', 'patch', 'tie', 'visor'];
  const idOk = function (s) { return typeof s === 'string' && /^[a-z0-9]{4,12}$/.test(s); };
  const cleanName = function (s) { return String(s || '').replace(/[^\w .-]/g, '').trim().slice(0, 16); };
  const newId = async function (table) {
    for (let i = 0; i < 6; i++) { const c = crypto.randomBytes(5).toString('hex').slice(0, 7); if (!await db.get('SELECT 1 AS x FROM ' + table + ' WHERE id = ?', [c])) return c; }
    throw new Error('could not make an id');
  };

  // ---------- players ----------
  // a player's profile, made the first time it is asked for: the name on the leaderboards, the Frank they play as, and their code
  async function profileOf(uid) {
    let p = await db.get('SELECT * FROM profiles WHERE uid = ?', [uid]);
    if (!p) {
      await db.run('INSERT INTO profiles (uid, name, frank, code, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [uid, '', '', crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x'), Date.now()]);
      p = await db.get('SELECT * FROM profiles WHERE uid = ?', [uid]);
    }
    return p;
  }
  async function paid(uid) { return !!await db.get("SELECT 1 AS x FROM packs WHERE uid = ? AND pack = 'classic'", [uid]); }
  async function byCode(code) {
    code = String(code || '').trim().toLowerCase();
    if (!/^[a-z0-9]{8,16}$/.test(code)) return null;
    const p = await db.get('SELECT uid FROM profiles WHERE code = ?', [code]);
    return p ? p.uid : null;
  }
  async function profileView(uid) {
    const p = await profileOf(uid);
    const levels = (await db.all('SELECT id, name, status, note, plays, spec FROM levels WHERE uid = ? ORDER BY created DESC LIMIT 40', [uid]))
      .map(function (r) { return { id: r.id, name: r.name, status: r.status || 'link', note: r.note || '', plays: r.plays, play_url: SITE + '/?level=' + r.id, difficulty: rated(r.spec) }; });
    const franks = (await db.all('SELECT id, name FROM franks WHERE uid = ? ORDER BY created DESC LIMIT 40', [uid])).map(function (r) { return { id: r.id, name: r.name, link: SITE + '/?frank=' + r.id }; });
    return { name: p.name || '', frank: p.frank || '', code: p.code, connector: SITE + '/mcp?k=' + p.code, has_pack: await paid(uid), levels: levels, franks: franks };
  }
  // change a profile: its name (which also renames the player on every leaderboard) and the Frank they play as
  async function setProfile(uid, b) {
    await profileOf(uid);
    if (b.name !== undefined) {
      const name = cleanName(b.name);
      if (name.length < 2) throw new Error('a name is 2 to 16 letters, numbers, spaces, dots or dashes');
      await db.run('UPDATE profiles SET name = ? WHERE uid = ?', [name, uid]);
      await db.run('UPDATE scores SET name = ? WHERE uid = ?', [name, uid]);
    }
    if (b.frank !== undefined) {
      const f = String(b.frank).toLowerCase();
      if (!(/^\d{1,2}$/.test(f) && +f < FRANKS.length) && !(idOk(f) && await db.get('SELECT 1 AS x FROM franks WHERE id = ?', [f]))) throw new Error('frank is a number 0 to ' + (FRANKS.length - 1) + ' or the id of a made Frank');
      await db.run('UPDATE profiles SET frank = ? WHERE uid = ?', [/^\d+$/.test(f) ? String(+f) : f, uid]);
    }
    return profileView(uid);
  }

  // ---------- made Franks ----------
  function frankOf(input) {
    input = input || {};
    const bad = function (m) { throw new Error(m); };
    const name = String(input.name || '').replace(/[^\w .'-]/g, '').trim().slice(0, 18).toUpperCase();
    if (name.length < 2) bad('the Frank needs a name, 2 to 18 characters');
    const col = function (k, def) { const v = input[k] === undefined ? def : String(input[k]).toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(v)) bad(k + ' must be a colour like #ff7b00'); return v; };
    const hat = input.hat === undefined ? 'tuft' : String(input.hat);
    if (HATS.indexOf(hat) < 0) bad('hat must be one of: ' + HATS.join(', '));
    const extras = (Array.isArray(input.extras) ? input.extras : []).map(String);
    extras.forEach(function (e) { if (EXTRAS.indexOf(e) < 0) bad('extras may hold: ' + EXTRAS.join(', ')); });
    return { name: name, head: col('head', '#ffd23f'), torso: col('torso', '#23d5d5'), legs: col('legs', '#3b3f8f'), hair: col('hair', '#ff7b00'), hat: hat, extra: extras.slice(0, 4).join(' ') };
  }
  async function makeFrank(input, uid) {
    const f = frankOf(input), id = 'f' + (await newId('franks')).slice(1);   // never all digits: a number names one of the game's own Franks
    await db.run('INSERT INTO franks (id, name, spec, uid, created) VALUES (?, ?, ?, ?, ?)', [id, f.name, JSON.stringify(f), uid || null, Date.now()]);
    return Object.assign({ id: id, link: SITE + '/?frank=' + id }, f);
  }
  async function madeFrank(id) {
    if (!idOk(id)) return null;
    const r = await db.get('SELECT id, spec FROM franks WHERE id = ?', [id]);
    return r ? Object.assign(JSON.parse(r.spec), { id: r.id }) : null;
  }

  // ---------- made levels ----------
  // what a level is like to play, from building it: used to answer its maker
  function describe(lv) {
    const L = CORE.buildLevel(CORE.customSpec(lv)), bpm = (TRACKS[lv.world] || {}).bpm || L.bpm;
    return {
      L: L,
      stats: { seconds: Math.round(L.totalBeats * 60 / bpm), beats: L.totalBeats, bpm: bpm, gates: L.gates.length, taps: L.plan.length, coins: L.maxTokens,
        springs: L.springs.length, blowers: L.blowers.length, saws: L.saws.length, posts: Object.keys(L.posts).length, bonus_rooms: L.portals.length, forks: L.alts.length,
        look_and_music: FRANKS[lv.world].name + ' (' + FRANKS[lv.world].world + ')' },
      stretches: L.sections.slice(1, -1).map(function (s, i) {
        const taps = L.plan.filter(function (p) { return p.beat >= s.start && p.beat < s.end; });
        return { n: i + 1, kind: s.key === 'chute' ? 'drop' : s.key, beats: s.beats, rows_per_beat: s.rpb, gates: L.gates.filter(function (g) { return g.beat >= s.start && g.beat < s.end; }).length,
          taps: taps.map(function (p) { return p.dir > 0 ? 'R' : 'L'; }).join('').slice(0, 80) };
      }),
    };
  }
  // a picture of part of a built level in letters: # wall or gate, o Frank on the way the level's own solution takes, . open, $ coin
  function drawn(L, rows) {
    const out = [];
    L.sections.slice(1, -1).forEach(function (s) {
      out.push('--- ' + (s.key === 'chute' ? 'drop' : s.key) + ' ---');
      const coins = {};
      L.tokens.forEach(function (k) { coins[k.row + ':' + k.col] = 1; });
      for (let r = s.startRow; r < Math.min(s.endRow, s.startRow + rows); r++) {
        const m = L.solids.get(r) || 0, st = L.stateAt(L.beatAtRow(r + 0.5)), w = st.k % 2 ? 3 : 1;
        let line = '';
        for (let c = 0; c < CORE.WIDE; c++) line += c < s.lo || c >= s.hi || (m >> c & 1) ? '#' : c >= st.col && c < st.col + w ? 'o' : coins[r + ':' + c] ? '$' : '.';
        out.push(line);
      }
    });
    return out.join('\n');
  }
  async function levelOf(id) {
    if (BUILT_IN[id]) return BUILT_IN[id];
    if (!idOk(id)) return null;
    const r = await db.get('SELECT * FROM levels WHERE id = ?', [id]);
    if (!r) return null;
    return Object.assign(JSON.parse(r.spec), { id: r.id, plays: r.plays, created: Number(r.created), status: r.status || 'link', owner: r.uid || null });
  }
  async function board(id, uid, n) {
    const top = (await db.all('SELECT name, score, pct, uid FROM scores WHERE level = ? ORDER BY score DESC, at ASC LIMIT ' + (n || 20), [id]))
      .map(function (r, i) { return { rank: i + 1, name: r.name || 'PLAYER', score: r.score, pct: r.pct, me: !!uid && r.uid === uid }; });
    let me = null;
    if (uid) {
      const mine = await db.get('SELECT name, score, pct FROM scores WHERE level = ? AND uid = ?', [id, uid]);
      if (mine) me = { name: mine.name, score: mine.score, pct: mine.pct, rank: 1 + (await db.get('SELECT COUNT(*) AS n FROM scores WHERE level = ? AND score > ?', [id, mine.score])).n };
    }
    return { level: id, players: (await db.get('SELECT COUNT(*) AS n FROM scores WHERE level = ?', [id])).n, top: top, me: me };
  }
  // an attempt's score onto a level's board: a player's best is kept, under their profile's name if they have one
  async function saveScore(lv, uid, score, pct, given, played) {
    const prof = await db.get('SELECT name FROM profiles WHERE uid = ?', [uid]);
    const name = (prof && prof.name) || cleanName(given) || 'PLAYER', now = Date.now(), had = await db.get('SELECT score FROM scores WHERE level = ? AND uid = ?', [lv.id, uid]);
    if (!had) await db.run('INSERT INTO scores (level, uid, name, score, pct, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', [lv.id, uid, name, score, pct, now]);
    else if (score > had.score) await db.run('UPDATE scores SET score = ?, pct = ?, name = ?, at = ? WHERE level = ? AND uid = ?', [score, pct, name, now, lv.id, uid]);
    else await db.run('UPDATE scores SET name = ? WHERE level = ? AND uid = ?', [name, lv.id, uid]);
    if (played && lv.id !== 'city' && !lv.paid) await db.run('UPDATE levels SET plays = plays + 1 WHERE id = ?', [lv.id]);
    return board(lv.id, uid, 25);
  }
  // a level's rating (core.js: CHILL to DEMON, from its design by plain arithmetic), from the design as it is kept; one that cannot be read is given none
  function rated(spec) { try { return CORE.rate(typeof spec === 'string' ? JSON.parse(spec) : spec); } catch (e) { return null; } }
  const listed = function (r) { const s = JSON.parse(r.spec); return { id: r.id, name: r.name, author: r.author, world: s.world, plays: r.plays, hearts: r.hearts, stretches: s.sections.length, play_url: SITE + '/?level=' + r.id, difficulty: CORE.rate(s) }; };
  // The public list: only levels a reviewer has approved, most played or newest first, PER to a page. It can be
  // searched (o.q: part of a level's name or its maker's) and filtered by rating (o.difficulty: 1 to 5, or a tier's
  // name). Asked with none of these it is what it always was: the first page. The rating is worked out from each
  // design, so the filter is done here, over the newest MOST of the list.
  const PER = 30, MOST = 600;
  async function listPage(sort, o) {
    o = o || {};
    const q = String(o.q || '').toLowerCase().replace(/[^\w .,!?'&:-]/g, '').trim().slice(0, 32), dn = String(o.difficulty || '').toUpperCase();
    const want = CORE.TIERS.indexOf(dn) >= 0 ? CORE.TIERS.indexOf(dn) + 1 : /^[1-5]$/.test(dn) ? +dn : 0;
    let rows = (await db.all("SELECT l.id, l.name, l.author, l.spec, l.plays, l.created, (SELECT COUNT(*) FROM hearts h WHERE h.level = l.id) AS hearts FROM levels l WHERE l.status = 'public' ORDER BY " +
      (sort === 'top' ? 'l.plays DESC, l.created DESC' : 'l.created DESC') + ' LIMIT ' + MOST)).map(listed);
    if (q) rows = rows.filter(function (r) { return (String(r.name) + ' ' + String(r.author)).toLowerCase().indexOf(q) >= 0; });
    if (want) rows = rows.filter(function (r) { return r.difficulty.level === want; });
    const per = Math.max(1, Math.min(PER, Math.round(+o.per) || PER)), pages = Math.max(1, Math.ceil(rows.length / per)), page = Math.max(1, Math.min(pages, Math.round(+o.page) || 1));   // (per: fewer to a page, for a small screen)
    return { levels: rows.slice((page - 1) * per, page * per), total: rows.length, page: page, pages: pages, per: per };
  }
  async function listLevels(sort) { return (await listPage(sort)).levels; }
  async function publish(input, req, uid) {
    const lv = CORE.customLevel(input), about = describe(lv);          // throws with the reason if it cannot be made
    const id = await newId('levels');
    await db.run("INSERT INTO levels (id, name, author, spec, created, plays, ip, uid, status, note) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'link', '')",
      [id, lv.name, lv.author, JSON.stringify(lv), Date.now(), String(req.headers['fly-client-ip'] || '').slice(0, 60), uid || null]);
    return { id: id, play_url: SITE + '/?level=' + id, name: lv.name, author: lv.author, status: 'link', difficulty: CORE.rate(lv), stats: about.stats, stretches: about.stretches };
  }
  // ask for a level to go on the public list: its maker only. Free; a reviewer has the last word. Returns { status } or throws.
  async function submit(id, uid) {
    const r = idOk(id) && await db.get('SELECT id, uid, status FROM levels WHERE id = ?', [id]);
    if (!r) throw new Error('no level with that id');
    if (!uid || r.uid !== uid) throw new Error('only the player who made a level can put it forward (it has to be made from your own connector address, the one on your profile in the game)');
    if (r.status === 'public') return { id: id, status: 'public' };
    await db.run("UPDATE levels SET status = 'pending', note = '' WHERE id = ?", [id]);
    return { id: id, status: 'pending' };
  }

  // ---------- sponsors ----------
  // An ad is a few words on a sign in the game's world (game.js drawAds), with a link under LEVEL CLEAR. The
  // reviewer sets them (admin_ad_set); the game is told the ones that are on, and counts runs that showed one and taps.
  async function adsLive() { return db.all('SELECT id, text, sub, url, color FROM ads WHERE live = 1 ORDER BY id'); }
  async function adHit(id, k) {
    if (!/^[a-z0-9_-]{1,24}$/.test(String(id))) return;
    await db.run('UPDATE ads SET ' + (k === 'click' ? 'clicks = clicks + 1' : 'views = views + 1') + ' WHERE id = ?', [id]);
  }
  async function adSet(a) {
    const id = String(a.id || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(id)) throw new Error('id is 1 to 24 of a-z, 0-9, - and _');
    const had = await db.get('SELECT * FROM ads WHERE id = ?', [id]) || {};
    const text = a.text === undefined ? had.text : String(a.text).toUpperCase().replace(/[^A-Z0-9 .!&'-]/g, '').trim();
    if (!text || text.length < 2 || text.length > 12) throw new Error('text is 2 to 12 letters, numbers or spaces: it has to fit on a sign');
    const sub = a.sub === undefined ? had.sub || '' : String(a.sub).toUpperCase().replace(/[^A-Z0-9 .!&'-]/g, '').trim().slice(0, 22);
    const url = a.url === undefined ? had.url || '' : String(a.url);
    if (url && !/^https:\/\/[\w.-]+(\/[^\s<>"]*)?$/.test(url)) throw new Error('url must start with https://');
    const color = a.color === undefined ? had.color || '#ff4fd8' : String(a.color).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('color is a colour like #ff4fd8');
    const live = a.live === undefined ? (had.live === undefined ? 1 : had.live) : a.live ? 1 : 0;
    await db.run('INSERT INTO ads (id, text, sub, url, color, live, views, clicks) VALUES (?, ?, ?, ?, ?, ?, 0, 0) ON CONFLICT (id) DO UPDATE SET text = excluded.text, sub = excluded.sub, url = excluded.url, color = excluded.color, live = excluded.live',
      [id, text, sub, url, color, live]);
    return db.get('SELECT * FROM ads WHERE id = ?', [id]);
  }
  // the game's maker is the sponsor until there is another
  async function seedAds() {
    if (!(await db.get('SELECT COUNT(*) AS n FROM ads')).n) await adSet({ id: 'glyphh', text: 'GLYPHH', sub: 'MADE THIS GAME', url: 'https://glyphh.ai', color: '#ff4fd8', live: true });
  }

  // ---------- the game's calls ----------
  async function routes(req, res, url, route, user, ensure) {
    if (route === 'GET /api/level') {
      const lv = await levelOf(url.searchParams.get('id'));
      if (!lv) return json(res, 404, { error: 'no such level' }), true;
      const hearts = (await db.get('SELECT COUNT(*) AS n FROM hearts WHERE level = ?', [lv.id])).n, mineLv = !!user && !!lv.owner && lv.owner === user.id;
      const out = Object.assign({ hearts: hearts, mine: !!user && !!await db.get('SELECT 1 AS x FROM hearts WHERE uid = ? AND level = ?', [user.id, lv.id]), yours: mineLv, difficulty: CORE.ratingOf(lv) }, lv);
      delete out.owner;
      return json(res, 200, out), true;
    }
    if (route === 'GET /api/levels') return json(res, 200, await listPage(url.searchParams.get('sort'), { q: url.searchParams.get('q'), difficulty: url.searchParams.get('difficulty'), page: url.searchParams.get('page'), per: url.searchParams.get('per') })), true;
    if (route === 'GET /api/frank') {
      const f = await madeFrank(url.searchParams.get('id'));
      return (f ? json(res, 200, f) : json(res, 404, { error: 'no such Frank' })), true;
    }
    // (the game's paid levels, d.worldOf, have boards too, here only: the connector's tools do not know them)
    if (route === 'GET /api/board') {
      const lv = d.worldOf(url.searchParams.get('level')) || await levelOf(url.searchParams.get('level'));
      if (!lv) return json(res, 404, { error: 'no such level' }), true;
      return json(res, 200, await board(lv.id, user && user.id, 25)), true;
    }
    if (route === 'POST /api/score') {
      if (!user) return json(res, 401, { error: 'no player' }), true;
      if (tooMany(req, 'score', 120, 6e4)) return json(res, 429, {}), true;
      const b = await body(req), lv = d.worldOf(b.level) || await levelOf(b.level), score = Math.round(+b.score), pct = Math.round(+b.pct);
      // the most a run can score: all the way down, every coin, at insane
      if (!lv || !(score >= 0 && score <= (lv.paid ? d.maxScore(lv.id) : 60000)) || !(pct >= 0 && pct <= 100)) return json(res, 400, { error: 'bad score' }), true;
      if (lv.paid && !await d.owns(user, lv.id, req)) return json(res, 403, { error: 'unlock the level to be on its board' }), true;   // a taste's scores are not kept
      return json(res, 200, await saveScore(lv, user.id, score, pct, b.name, b.played)), true;
    }
    if (route === 'GET /api/profile' || route === 'POST /api/profile') {
      const u = user || await ensure();
      if (!u) return json(res, 401, { error: 'no player' }), true;
      try { return json(res, 200, route[0] === 'P' ? await setProfile(u.id, await body(req)) : await profileView(u.id)), true; }
      catch (e) { return json(res, 400, { error: e.message }), true; }
    }
    if (route === 'POST /api/level/submit') {
      if (!user) return json(res, 401, { error: 'no player' }), true;
      try { return json(res, 200, await submit(String((await body(req)).id || ''), user.id)), true; }
      catch (e) { return json(res, e.pay ? 402 : 400, { error: e.message, pay: !!e.pay }), true; }
    }
    return false;
  }
  // signing in moves what a device made onto the account
  async function moveTo(from, to) {
    await db.run('UPDATE levels SET uid = ? WHERE uid = ?', [to, from]);
    await db.run('UPDATE franks SET uid = ? WHERE uid = ?', [to, from]);
    const had = await db.get('SELECT 1 AS x FROM profiles WHERE uid = ?', [to]);
    if (had) await db.run('DELETE FROM profiles WHERE uid = ?', [from]); else await db.run('UPDATE profiles SET uid = ? WHERE uid = ?', [to, from]);
    await db.run('DELETE FROM scores WHERE uid = ? AND level IN (SELECT level FROM scores WHERE uid = ?)', [from, to]);
    await db.run('UPDATE scores SET uid = ? WHERE uid = ?', [to, from]);
  }

  // ---------- the MCP connector ----------
  const CODE = { type: 'string', description: 'Leave this out: the connector already knows the player, who signed in when it was added. Never guess one.' };
  const SECTION = {
    type: 'object', required: ['kind'], additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: CORE.KINDS, description: 'patterns: a gate every beat, taps follow `pattern`. gates: a gate every two beats, count the taps. slide: like gates but in slime, a tap slides one column. maze: double taps down paths that fork and rejoin. drop: 8 beats of fast, nearly empty fall (a breather; takes no other settings).' },
      beats: { type: 'integer', minimum: 8, maximum: 64, description: 'How long the stretch is, in beats (rounded to a multiple of 4; a beat is about 0.6 s). Default 24.' },
      speed: { type: 'integer', minimum: 5, maximum: 14, description: 'Rows fallen per beat. 6 is gentle, 9 to 10 normal, 12 fast, 14 brutal.' },
      wide: { type: 'boolean', description: 'true (default): the full 21 columns. false: a narrow 11-column shaft.' },
      look: { type: 'string', enum: CORE.LOOKS, description: 'The colours of this stretch, from the level\'s world.' },
      pattern: { type: 'string', pattern: '^[LRlr-]{1,64}$', description: 'patterns only. One letter per beat, repeated to fill the stretch: L / R one tap left / right, l / r a quick double tap left / right, - a beat with no tap. Example: "LLRR-lr".' },
      taps: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: 'gates and slide only. [least, most] taps each gate needs, all one way. Default [1,3]; slide [2,4].' },
      posts: { type: 'number', minimum: 0, maximum: 0.9, description: 'gates and slide. Chance a gate has a post: a block that punishes tapping too early.' },
      springs: { type: 'number', minimum: 0, maximum: 0.5, description: 'gates and slide. Chance of a spring that flings Frank sideways before a gate.' },
      blowers: { type: 'number', minimum: 0, maximum: 0.5, description: 'gates and slide. Chance of a blower that shoves Frank two columns before a gate.' },
      thick: { type: 'number', minimum: 0, maximum: 0.9, description: 'gates and slide. Chance a gate is two rows thick.' },
      saws: { type: 'integer', minimum: 0, maximum: 3, description: 'How many swinging saws in the stretch (patterns: up to 2; gates and slide: up to 3).' },
      bonus: { type: 'boolean', description: 'gates and slide. true: the stretch may hide a portal to a bonus room full of coins.' },
    },
  };
  const LEVEL_PROPS = {
    name: { type: 'string', description: 'The level\'s name, 2 to 32 characters.' },
    author: { type: 'string', description: 'Who made it, as it should show in the game (up to 20 characters). Ask the person; never invent a real name.' },
    world: { type: 'integer', minimum: 0, maximum: 23, description: 'Which Frank\'s world the level looks and sounds like (its colours and its music track). how_levels_work lists them. Default 0, the city.' },
    seed: { type: 'integer', minimum: 0, maximum: 99999999, description: 'The same design with another seed lays its gates out differently. Leave out to derive it from the name.' },
    sections: { type: 'array', minItems: 1, maxItems: 16, items: SECTION, description: 'The stretches, top to bottom. Together at most 280 beats (about three minutes).' },
  };
  const obj = function (props, required) { return { type: 'object', required: required || [], additionalProperties: false, properties: props }; };
  const TOOLS = [
    { name: 'how_levels_work', description: 'Read this first. How Free Fall Frank plays, what a level is made of, every setting, the 24 worlds (looks and music), how a made Frank looks, and tips for a level that is fun.', inputSchema: obj({}) },
    { name: 'preview_level', description: 'Build a level without saving it, to see what it would be: how long it is, its gates, taps and coins, each stretch\'s taps, and (with map: true) a picture of the top of each stretch in letters. Use it to tune a level before publishing. Any level that builds can be finished: the builder walks a way through first.',
      inputSchema: obj(Object.assign({ map: { type: 'boolean', description: 'true: also draw the first 40 rows of each stretch (# wall or gate, o Frank on the solution\'s way, $ coin, . open).' } }, LEVEL_PROPS), ['name', 'sections']) },
    { name: 'publish_level', description: 'Save a level and get its link. Anyone who opens the link plays it in the browser, free, and it has its own leaderboard. It is not on the game\'s public list yet: submit_level asks for that. A published level cannot be changed (publish again for a new link), so preview first and publish when the person is happy with it.',
      inputSchema: obj(Object.assign({ player_code: CODE }, LEVEL_PROPS), ['name', 'sections']) },
    { name: 'submit_level', description: 'Put a level the player made forward for the game\'s public list (PLAY THEIR LEVELS). Free. It needs the player (their own connector address or player_code); a reviewer then approves or declines it. my_profile shows where each level stands.', inputSchema: obj({ id: { type: 'string', description: 'The level\'s id: the end of its link.' }, player_code: CODE }, ['id']) },
    { name: 'play_level', description: 'Open a level to play, right here in the chat where the host shows apps (the game itself, with its leaderboard): the game\'s own level ("city", the default) or a made level by its id. Use it when the person wants to play, try a level you just published, or see what the game is. Elsewhere it answers the link to play in a browser.',
      inputSchema: obj({ id: { type: 'string', description: '"city" (default) or a made level\'s id: the end of its link.' }, player_code: CODE }), _meta: { ui: { resourceUri: 'ui://free-fall-frank/play/2' } } },
    { name: 'record_score', description: 'Used by the game when it is played in the chat: puts a finished attempt on the level\'s leaderboard, under the player whose connector address this is. Not for making up scores.',
      inputSchema: obj({ level: { type: 'string' }, score: { type: 'integer', minimum: 0, maximum: 60000 }, pct: { type: 'integer', minimum: 0, maximum: 100 }, name: { type: 'string' }, played: { type: 'boolean' }, player_code: CODE }, ['level', 'score', 'pct']), _meta: { ui: { visibility: ['app'] } } },
    { name: 'get_level', description: 'A published level by its id (the end of its link): its design, what it is like to play, how often it was played and its leaderboard.', inputSchema: obj({ id: { type: 'string' } }, ['id']) },
    { name: 'list_levels', description: 'The public list: levels players made that a reviewer approved, newest first or most played first, each with its link and its difficulty rating. It can be searched by name or maker, filtered by rating, and read a page (30 levels) at a time: the answer says the total, the page and how many pages there are.',
      inputSchema: obj({ sort: { type: 'string', enum: ['new', 'top'] }, search: { type: 'string', description: 'Part of a level\'s name or its maker\'s name.' }, difficulty: { type: 'string', enum: CORE.TIERS, description: 'Only levels with this rating.' }, page: { type: 'integer', minimum: 1, description: 'Which page, from 1.' }, per: { type: 'integer', minimum: 1, maximum: 30, description: 'How many levels to a page (30 unless said).' } }) },
    { name: 'leaderboard', description: 'The best scores on a level: "city" for the game\'s own level, or a made level\'s id.', inputSchema: obj({ id: { type: 'string' } }, ['id']) },
    { name: 'create_frank', description: 'Make a Frank of the player\'s own to play as: his name, his colours, his hat and a few extras. It answers a link; opening it adds him to that player\'s Franks in the game. Free.',
      inputSchema: obj({ name: { type: 'string', description: '2 to 18 characters. By tradition it rhymes with or ends in FRANK, but it need not.' },
        head: { type: 'string', description: 'Skin colour, like #ffd23f.' }, torso: { type: 'string', description: 'Shirt colour, like #23d5d5.' }, legs: { type: 'string', description: 'Trouser colour, like #3b3f8f.' }, hair: { type: 'string', description: 'The colour of his hair or hat, like #ff7b00.' },
        hat: { type: 'string', enum: HATS, description: 'What is on his head. tuft is Frank\'s own three-spike hair.' },
        extras: { type: 'array', items: { type: 'string', enum: EXTRAS }, maxItems: 4, description: 'bun and mustard make a hot dog, ghost makes him see-through, bolts are a monster\'s neck bolts, flies buzz round him; tie, bowtie, nose (a clown\'s), patch (an eye patch), visor, grain (wood grain).' },
        player_code: CODE }, ['name']) },
    { name: 'my_profile', description: 'The player\'s profile: the name they go by on the leaderboards, the Frank they play as, and the levels and Franks they have made with where each level stands (link only, pending review, public, declined and why).', inputSchema: obj({ player_code: CODE }) },
    { name: 'update_profile', description: 'Change the player\'s profile: their name on the leaderboards (2 to 16 characters) and the Frank they play as (0 to 23, how_levels_work lists them, or the id of a Frank they made).', inputSchema: obj({ name: { type: 'string' }, frank: { type: 'string', description: 'A number 0 to 23 or a made Frank\'s id.' }, player_code: CODE }) },
  ];
  const ADMIN_TOOLS = [
    { name: 'admin_queue', description: 'Reviewer only. The levels waiting for review, oldest first, each with its design, what it is like to play, who made it and its link to try it.', inputSchema: obj({}) },
    { name: 'admin_review', description: 'Reviewer only. Approve a level onto the public list, or decline it with a short reason its maker will see. Also takes a level off the list again (decline a public one).', inputSchema: obj({ id: { type: 'string' }, decision: { type: 'string', enum: ['approve', 'decline'] }, note: { type: 'string', description: 'Why, in a sentence, for its maker (needed to decline).' } }, ['id', 'decision']) },
    { name: 'admin_levels', description: 'Reviewer only. Every made level, newest first, with its status (link, pending, public, declined), plays and maker.', inputSchema: obj({}) },
    { name: 'admin_stats', description: 'Admin only. How the game is doing: players, attempts, time played, accounts, buyers and revenue (all time and the last 24 hours), the last 14 days day by day, each level\'s plays and where players die, how far players get down the first level stretch by stretch, and every ad link with the players, signups and money it brought.', inputSchema: obj({}) },
    { name: 'admin_players', description: 'Admin only. The most recent players: when they came, from which ad link, how much they played, their best, their coins, what they paid. Then admin_player for one of them.', inputSchema: obj({ limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many, newest first. Default 40.' } }) },
    { name: 'admin_player', description: 'Admin only. One player by their device id (did, from admin_players): their account, Franks, purchases, how they do on each level and their last 100 attempts.', inputSchema: obj({ did: { type: 'string' } }, ['did']) },
    { name: 'admin_payments', description: 'Admin only. Every checkout the game started, straight from Stripe, newest first: paid, abandoned or open, the amount, Stripe\'s fee and what was kept.', inputSchema: obj({}) },
    { name: 'admin_campaign_set', description: 'Admin only. Make an ad link (or change its note): the link is freefallfrank.com/?src=<code>, and admin_stats then shows what it brought in.', inputSchema: obj({ code: { type: 'string', description: 'Letters, numbers, - and _, up to 40: e.g. reddit-claude.' }, note: { type: 'string', description: 'What the link is for.' } }, ['code']) },
    { name: 'admin_ads', description: 'Reviewer only. The sponsors: each ad\'s sign text, link, colour, whether it is on, how many runs showed it and how many taps it got.', inputSchema: obj({}) },
    { name: 'admin_ad_set', description: 'Reviewer only. Add or change a sponsor. In the game an ad is scenery: a lit billboard on the skyline at the top of every run and neon signs on the shaft walls, plus one tappable line under LEVEL CLEAR that opens its link. One sponsor a run, in turn. Give only what changes.',
      inputSchema: obj({ id: { type: 'string', description: 'A short name for the ad, a-z 0-9 - _.' }, text: { type: 'string', description: 'The sign: 2 to 12 characters, shown in capitals.' }, sub: { type: 'string', description: 'A second, smaller line on the billboard, up to 22 characters.' },
        url: { type: 'string', description: 'Where the tap goes, https://...' }, color: { type: 'string', description: 'The neon\'s colour, like #ff4fd8.' }, live: { type: 'boolean', description: 'false switches it off.' } }, ['id']) },
  ];
  const GUIDE = function () {
    return [
      'FREE FALL FRANK (' + SITE + ') is a free browser game. Frank is a 1 x 3 block who falls down a shaft in time to music. Tapping the left or right half of the screen tumbles him a quarter turn that way about his bottom corner: standing to lying flat moves him one column over (and makes him three wide), flat to standing moves him three. He must pass through the gap in every gate; touching anything sends him back to the top. The skill is counting taps and timing them: not too early (he is still in the last gate), not too late (the next gate).',
      '',
      'A LEVEL is a name, an author, a world and a list of stretches (sections), played top to bottom. Every level starts with a short drop down a manhole and ends in daylight; you design what is in between. A level can always be finished: the builder first walks a solution, then cuts every gate around it. You choose the shape and the difficulty; it places the gates.',
      '',
      'THE FIVE KINDS OF STRETCH',
      '- patterns: a gate every beat. You write the taps yourself in `pattern`, one letter per beat, repeated to fill the stretch: L or R a single tap, l or r a quick double tap (he crosses four columns and stands up again), - a beat off. "LRLR" is a zigzag, "LLRR" a wider one, "LL-RR-" breathes, "lrlr" is hard. If a tap would hit the wall the builder turns it round, so a long run one way bounces off the side.',
      '- gates: a gate every two beats; each needs between taps[0] and taps[1] taps, all one way. This is the counting game. posts punish early taps, springs and blowers move him before the gate, thick gates take longer to clear, saws swing across at his feet, bonus: true may hide a portal to a room of coins.',
      '- slide: the same settings as gates, but he is in slime: he stays upright and each tap slides him one column.',
      '- maze: double taps down walled paths that fork and join again; either way round a fork works.',
      '- drop: eight beats of fast, nearly empty fall. A breather, and a good break between hard stretches.',
      '',
      'SETTINGS: beats 8 to 64 per stretch (default 24; a beat is about 0.6 seconds), at most 280 beats and 16 stretches in a level. speed is rows fallen per beat: 6 gentle, 9 to 10 normal, 12 fast, 14 brutal. wide: false makes a narrow 11-column shaft instead of 21 columns. look picks the stretch\'s colours: ' + CORE.LOOKS.join(', ') + '. seed re-rolls the layout of the same design.',
      '',
      'WORLDS (world: the number): the level takes this Frank\'s colours and his music track. ' + FRANKS.map(function (f, i) { return i + ' ' + f.name + ' (' + f.world + ')'; }).join('; ') + '.',
      '',
      'A GOOD LEVEL: start easy (a patterns stretch at speed 8 with a simple pattern, or gates with taps [1,2] and no posts), build up, put a drop before the hardest part, and end on the hardest. One to two minutes (100 to 200 beats) is plenty. Vary the kinds. Ask the person what they want (a theme, how hard, how long, who it is for), preview it, tell them what it will be like in plain words, change it as they say, then publish and give them the link. Players can also pick Easy, Normal, Hard and Insane in the game\'s own settings, so do not make it brutal by default.',
      '',
      'THE RATING: every level shows how hard it is, one of five tiers: ' + CORE.TIERS.join(', ') + '. A made level is rated from its design, by arithmetic (the same answer every time): each stretch scores for its speed, its taps a beat, its hazards (posts, thick gates, springs, blowers, saws) and a narrow shaft; the level scores half its hardest stretch plus half the average, plus a little for its length. Under ' + CORE.TIER_AT[0] + ' points is ' + CORE.TIERS[0] + ', then ' + CORE.TIERS.slice(1).map(function (n, i) { return n + ' from ' + CORE.TIER_AT[i]; }).join(', ') + '. preview_level, publish_level, get_level and list_levels answer it as `difficulty` (tier, level 1 to 5, points): preview until the rating is what the person asked for.',
      '',
      'SHARING AND THE PUBLIC LIST: publish_level gives a link that works for anyone at once. The game also has a public list of players\' levels; a level gets on it when its maker puts it forward (submit_level, free) and a reviewer approves it.',
      '',
      'WHO THE PLAYER IS: the person signed in to Free Fall Frank when they added this connector, so everything made here is theirs: it shows on their profile in the game (signed in with the same account), and my_profile, update_profile and submit_level act for them.',
      '',
      'A MADE FRANK (create_frank) is a 1 x 3 pixel man: a head, a shirt (torso) and trousers (legs), each one colour, with something on his head (hat: ' + HATS.join(', ') + ') in the hair colour, and up to four extras (' + EXTRAS.join(', ') + '). Pick colours that stand out against a dark background.',
    ].join('\n');
  };
  async function callTool(name, a, req, who) {
    a = a || {};
    const uid = who.uid || await byCode(a.player_code);
    const need = function () { if (!uid) throw new Error('this needs to know who the player is: add the connector with their own address (in the game: settings, PROFILE), or ask them for the code on that page and pass it as player_code'); return uid; };
    if (name === 'how_levels_work') return { guide: GUIDE() };
    if (name === 'preview_level') {
      const lv = CORE.customLevel(a), about = describe(lv), out = { name: lv.name, author: lv.author, difficulty: CORE.rate(lv), stats: about.stats, stretches: about.stretches, note: 'Not saved. Call publish_level with the same design to get a link.' };
      if (a.map) out.map = drawn(about.L, 40);
      return out;
    }
    if (name === 'publish_level') {
      if (tooMany(req, 'publish', 30, 36e5)) throw new Error('that is a lot of levels in an hour: try again later');
      return Object.assign(await publish(a, req, uid), { note: 'Give the person the play_url: it opens the level in the browser, adds it to their levels and keeps a leaderboard for it. ' +
        (uid ? 'It is theirs: submit_level puts it forward for the public list.' : 'It was made without a player, so it belongs to nobody and cannot go on the public list; it works by its link all the same.') });
    }
    if (name === 'submit_level') {
      const out = await submit(String(a.id || '').toLowerCase(), need());
      return Object.assign(out, { note: out.status === 'pending' ? 'It is waiting for a reviewer. my_profile shows when it is public.' : 'It is already on the public list.' });
    }
    if (name === 'play_level') return playing(a, uid);
    if (name === 'record_score') {
      const lv = await levelOf(String(a.level || '').toLowerCase()), score = Math.round(+a.score), pct = Math.round(+a.pct);
      if (!lv || !(score >= 0 && score <= 60000) || !(pct >= 0 && pct <= 100)) throw new Error('bad score');
      if (!uid) return Object.assign(await board(lv.id, null, 25), { saved: false, note: 'Played without a player: add the connector with your own address (in the game: settings, PROFILE) to be on the leaderboard.' });
      if (tooMany(req, 'score', 120, 6e4)) throw new Error('too many scores, slow down');
      return Object.assign(await saveScore(lv, uid, score, pct, a.name, a.played), { saved: true });
    }
    if (name === 'get_level') {
      const lv = await levelOf(String(a.id || '').toLowerCase());
      if (!lv) throw new Error('no level with that id');
      if (lv.id === 'city') return { id: 'city', name: 'ELM STREET', note: 'The game\'s own level.', play_url: SITE + '/', difficulty: CORE.ratingOf(lv), leaderboard: await board('city', null, 10) };
      const about = describe(lv);
      return { id: lv.id, name: lv.name, author: lv.author, world: lv.world, seed: lv.seed, sections: lv.sections, status: lv.status, plays: lv.plays, play_url: SITE + '/?level=' + lv.id, difficulty: CORE.rate(lv), stats: about.stats, stretches: about.stretches, leaderboard: await board(lv.id, null, 10) };
    }
    if (name === 'list_levels') return listPage(a.sort, { q: a.search, difficulty: a.difficulty, page: a.page, per: a.per });
    if (name === 'leaderboard') {
      const lv = await levelOf(String(a.id || '').toLowerCase());
      if (!lv) throw new Error('no level with that id');
      return await board(lv.id, null, 20);
    }
    if (name === 'create_frank') {
      if (tooMany(req, 'frank', 40, 36e5)) throw new Error('that is a lot of Franks in an hour: try again later');
      return Object.assign(await makeFrank(a, uid), { note: 'Give the person the link: opening it adds him to their Franks in the game.' });
    }
    if (name === 'my_profile') return profileView(need());
    if (name === 'update_profile') {
      if (a.name === undefined && a.frank === undefined) throw new Error('say what to change: name, frank or both');
      return setProfile(need(), { name: a.name, frank: a.frank });
    }
    // the reviewer's tools
    if (!who.admin) throw new Error('no such tool');
    const rowOf = function (r) { const s = JSON.parse(r.spec); return { id: r.id, name: r.name, author: r.author, status: r.status || 'link', note: r.note || '', plays: r.plays, made: new Date(Number(r.created)).toISOString().slice(0, 10), maker: r.uid || 'nobody', play_url: SITE + '/?level=' + r.id, world: s.world, sections: s.sections }; };
    if (name === 'admin_queue') {
      const rows = await db.all("SELECT * FROM levels WHERE status = 'pending' ORDER BY created ASC LIMIT 25");
      return { waiting: rows.length, levels: rows.map(function (r) { const o = rowOf(r); try { const ab = describe(JSON.parse(r.spec)); o.stats = ab.stats; o.stretches = ab.stretches; } catch (e) { o.problem = e.message; } return o; }) };
    }
    if (name === 'admin_stats') { const s = await d.adminData(); return { site: s.site, overview: s.overview, days: s.days, levels: s.levels, first_level_funnel: s.funnel, ad_links: s.campaigns, note: 'Times are seconds, money is cents.' }; }
    if (name === 'admin_players') { const s = await d.adminData(); return { total: s.overview.players, players: s.players.slice(0, Math.max(1, Math.min(200, Math.round(+a.limit) || 40))) }; }
    if (name === 'admin_player') { const p = await d.adminPlayer(String(a.did || '')); if (!p) throw new Error('no such player'); return p; }
    if (name === 'admin_payments') return { payments: await d.adminPayments() };
    if (name === 'admin_campaign_set') return d.setCampaign(a.code, a.note);
    if (name === 'admin_ads') return { ads: (await db.all('SELECT * FROM ads ORDER BY id')).map(function (r) { return Object.assign(r, { live: !!r.live, views: Number(r.views), clicks: Number(r.clicks) }); }) };
    if (name === 'admin_ad_set') { const r = await adSet(a); return Object.assign(r, { live: !!r.live }); }
    if (name === 'admin_levels') return { levels: (await db.all('SELECT * FROM levels ORDER BY created DESC LIMIT 100')).map(function (r) { const o = rowOf(r); delete o.sections; return o; }) };
    if (name === 'admin_review') {
      const id = String(a.id || '').toLowerCase(), r = idOk(id) && await db.get('SELECT id, name, status FROM levels WHERE id = ?', [id]);
      if (!r) throw new Error('no level with that id');
      if (a.decision !== 'approve' && a.decision !== 'decline') throw new Error('decision is approve or decline');
      const note = String(a.note || '').replace(/[<>]/g, '').slice(0, 200);
      if (a.decision === 'decline' && note.length < 3) throw new Error('a declined level needs a note for its maker');
      const status = a.decision === 'approve' ? 'public' : 'declined';
      await db.run('UPDATE levels SET status = ?, note = ? WHERE id = ?', [status, a.decision === 'approve' ? '' : note, id]);
      return { id: id, name: r.name, was: r.status || 'link', status: status, note: note };
    }
    throw new Error('no such tool');
  }
  // ---------- the game inside Claude: an MCP App ----------
  // play_level answers with the level and points at this page; a host that shows MCP Apps (claude.ai, the desktop
  // app) opens it in the chat. It is the game itself, the same files, made into one page that needs nothing from
  // outside: its scripts inlined, a stand-in where the frame has no storage, and a bridge that sends what the game
  // would ask the server (leaderboards, scores, the profile, players' levels) through the connector's own tools.
  // The address carries a version: a changed page is a new address.
  const PANEL_URI = 'ui://free-fall-frank/play/2', PANEL_MIME = 'text/html;profile=mcp-app';
  const PANEL = { uri: PANEL_URI, name: 'play', title: 'Free Fall Frank', description: 'The game itself, playable in the chat: a level (the game\'s own or one a player made), its leaderboard and the player\'s Franks.', mimeType: PANEL_MIME };
  let panelPage = '';
  function panelHtml() {
    if (panelPage) return panelPage;
    const read = function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }, safe = function (s) { return s.replace(/<\/script/g, '<\\/script'); };
    let html = read('index.html');
    html = html.replace(/<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\n?/g, '').replace(/<img[^>]*>/g, '').replace(/<script>\s*if \('serviceWorker'[\s\S]*?<\/script>/, '');
    html = html.replace(/<script src="([^"]+)"><\/script>/g, function (m, src) { return '<script>' + safe(read(src)) + '</script>'; });
    const first = [
      '<style>html, body { position: static !important; height: 640px !important; } canvas { width: 100% !important; height: 640px !important; }</style>',
      '<script>(function () {',
      '  var seen = { "fff.splash": "1", "fff.intro": "1", "fff.howto": "1" }, ok = false;',
      '  try { Object.keys(seen).forEach(function (k) { window.localStorage.setItem(k, "1"); }); ok = true; } catch (e) {}',
      '  if (!ok) { var m = seen; try { Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } } }); } catch (e) {} }',
      '  window.FFF_PANEL = true; window.FFF_BASE = "' + SITE + '/";',
      '})();</script>',
    ].join('\n');
    const bridge = [
      '<script type="module">' + safe(read('mcp-app.js')) + '</script>',
      '<script type="module">',
      'const app = new window.McpApp({ name: "free-fall-frank", version: "1" }, {}, { autoResize: true });',
      'const tool = async (name, args) => { const r = await app.callServerTool({ name: name, arguments: args || {} }); if (!r || r.isError) throw new Error((r && r.content && r.content[0] && r.content[0].text) || "failed"); return r.structuredContent || {}; };',
      '// what the game would ask its server, asked through the connector instead',
      'window.FFFAccount.api = (path, data) => {',
      '  const q = new URLSearchParams(path.split("?")[1] || ""), p = path.split("?")[0];',
      '  if (p === "/api/board") return tool("leaderboard", { id: q.get("level") });',
      '  if (p === "/api/score") return tool("record_score", data);',
      '  if (p === "/api/levels") return tool("list_levels", Object.assign({ sort: q.get("sort") || "top" }, q.get("q") ? { search: q.get("q") } : {}, q.get("difficulty") ? { difficulty: q.get("difficulty") } : {}, q.get("page") ? { page: +q.get("page") } : {}, q.get("per") ? { per: +q.get("per") } : {}));',
      '  if (p === "/api/level") return tool("get_level", { id: q.get("id") });',
      '  if (p === "/api/level/submit") return tool("submit_level", data);',
      '  if (p === "/api/profile") return data ? tool("update_profile", data) : tool("my_profile", {});',
      '  return Promise.reject(new Error("not here"));',
      '};',
      'window.FFF_LINK = (url) => { app.openLink({ url: url }).catch(() => {}); };',
      'const open = (r) => { const s = r && r.structuredContent; if (s && window.FFF && window.FFF.open) window.FFF.open(s.level || null, s.frank || null, s.player || ""); };',
      'app.ontoolresult = open;',
      'app.connect().catch(() => {});',
      '</script>',
    ].join('\n');
    // (functions, so that a "$" in the scripts is not read as a replacement pattern)
    panelPage = html.replace('</head>', function () { return first + '\n</head>'; }).replace('</body>', function () { return bridge + '\n</body>'; });
    return panelPage;
  }
  // the page may fetch its music and sounds from the game's own site, and nothing else
  const panelContents = function () { return { uri: PANEL_URI, mimeType: PANEL_MIME, text: panelHtml(), _meta: { ui: { prefersBorder: true, csp: { connectDomains: [SITE], resourceDomains: [SITE] } } } }; };
  // what play_level hands the page: the level to open, and who is playing
  async function playing(a, uid) {
    const id = String(a.id || 'city').toLowerCase(), lv = await levelOf(id);
    if (!lv) throw new Error('no level with that id');
    const out = { id: lv.id, name: lv.name, play_url: SITE + '/' + (lv.id === 'city' ? '' : '?level=' + lv.id), level: lv.id === 'city' ? null : { id: lv.id, name: lv.name, author: lv.author, world: lv.world, seed: lv.seed, sections: lv.sections }, frank: null, player: '',
      note: 'The game is open in the chat where the host shows apps: tap the left and right halves (or the arrow keys) to tumble Frank through the gaps. Anywhere else, give the person the play_url.' };
    if (uid) { const p = await profileOf(uid); out.player = p.name || ''; if (p.frank && !/^\d+$/.test(p.frank)) out.frank = await madeFrank(p.frank); }
    return out;
  }

  // MCP 2026-07-28 has no initialize: each request says its version in _meta (and in a header), the server is asked
  // what it can do with server/discover, and results say how long they may be kept. The earlier revisions open with
  // initialize. Both are answered, without sessions.
  const MODERN = '2026-07-28', VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'], VKEY = 'io.modelcontextprotocol/protocolVersion';
  const SERVER = { name: 'free-fall-frank', title: 'Free Fall Frank', version: '1.2.0' }, CAPS = { tools: {}, resources: {} };
  const KEPT = ['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list', 'resources/read'];
  async function rpc(m, req, who) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m && m.id !== undefined ? m.id : null, error: { code: -32600, message: 'not a JSON-RPC request' } };
    if (m.id === undefined) return null;                             // a notification: nothing to answer
    const meta = m.params && m.params._meta, modern = req.headers['mcp-protocol-version'] === MODERN || !!(meta && meta[VKEY]);
    const ok = function (result) {
      if (modern) { result = Object.assign({}, result, { resultType: 'complete', _meta: Object.assign({}, result._meta, { 'io.modelcontextprotocol/serverInfo': SERVER }) }); if (KEPT.indexOf(m.method) >= 0) result = Object.assign({ ttlMs: 0, cacheScope: 'private' }, result); }
      return { jsonrpc: '2.0', id: m.id, result: result };
    };
    const tools = who.admin ? TOOLS.concat(ADMIN_TOOLS) : TOOLS;
    const says = 'Free Fall Frank is a free browser game (' + SITE + '). With these tools you design levels and Franks for it, and the person can play right here: each level gets a link anyone can open and its own leaderboard. Call how_levels_work first, ask the person what they want, preview_level until it is right, then publish_level; play_level opens a level in the chat to play. my_profile and update_profile are the player\'s own profile.' +
      (who.admin ? ' This address is the reviewer\'s: admin_queue lists the levels waiting to go on the public list and admin_review approves or declines them. Look at each level\'s name, author and design; decline anything offensive, broken or pointless, with a kind reason.' : '');
    if (m.method === 'initialize') {
      const want = m.params && m.params.protocolVersion;
      return ok({ protocolVersion: VERSIONS.indexOf(want) >= 0 ? want : VERSIONS[0], capabilities: CAPS, serverInfo: SERVER, instructions: says });
    }
    if (m.method === 'server/discover') return ok({ supportedVersions: [MODERN].concat(VERSIONS), capabilities: CAPS, instructions: says });
    if (m.method === 'ping') return ok({});
    if (m.method === 'tools/list') return ok({ tools: tools });
    if (m.method === 'tools/call') {
      const p = m.params || {};
      if (!tools.some(function (t) { return t.name === p.name; })) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'unknown tool: ' + p.name } };
      try { const out = await callTool(p.name, p.arguments, req, who); return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out }); }
      catch (e) { return ok({ content: [{ type: 'text', text: 'Could not do that: ' + e.message }], isError: true }); }
    }
    if (m.method === 'resources/list') return ok({ resources: [PANEL] });
    if (m.method === 'resources/templates/list') return ok({ resourceTemplates: [] });
    if (m.method === 'resources/read') {
      if (!m.params || m.params.uri !== PANEL_URI) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'there is no such resource' } };
      return ok({ contents: [panelContents()] });
    }
    if (m.method === 'prompts/list') return ok({ prompts: [] });
    return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found: ' + m.method } };
  }
  // Streamable HTTP, without sessions: every POST is answered on its own with plain JSON.
  async function mcp(req, res, url) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id', 'Cache-Control': 'no-store' };
    const send = function (code, o) { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(o === undefined ? '' : JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405, Object.assign({ Allow: 'POST, OPTIONS' }, cors)); return res.end(); }
    if (tooMany(req, 'mcp', 240, 6e4)) return send(429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'too many requests, slow down' } });
    await d.ready;
    // who this address speaks for: a player (k), the reviewer (admin), or nobody
    const who = { uid: null, admin: false }, key = url.searchParams.get('admin');
    if (key !== null) {
      const want = Buffer.from(String(d.adminKey || '')), got = Buffer.from(key);
      if (!want.length || want.length !== got.length || !crypto.timingSafeEqual(want, got) || tooMany(req, 'mcpadmin', 600, 6e4)) return send(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'that reviewer address is not right' } });
      who.admin = true;
    }
    if (url.searchParams.get('k')) who.uid = await byCode(url.searchParams.get('k'));
    // everybody else signs in (oauth.js): what they make is then theirs. No token: say where to get one.
    if (!who.admin && !who.uid) {
      who.uid = await d.playerOf(req);
      if (who.uid && await d.isAdminUid(who.uid)) who.admin = true;   // signed in as the admin's Google account: the reviewer's tools too
      if (!who.uid) { res.writeHead(401, Object.assign({ 'Content-Type': 'application/json', 'WWW-Authenticate': d.challenge }, cors)); return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'sign in to Free Fall Frank to use this connector' } })); }
    }
    let m;
    try { m = await body(req, 200000); } catch (e) { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'that is not JSON' } }); }
    if (Array.isArray(m)) {
      const out = (await Promise.all(m.map(function (x) { return rpc(x, req, who); }))).filter(Boolean);
      return out.length ? send(200, out) : (res.writeHead(202, cors), res.end());
    }
    const out = await rpc(m, req, who);
    if (!out) { res.writeHead(202, cors); return res.end(); }
    send(200, out);
  }
  // the admin page's way in to the reviewer's tools (server.js has already checked who is asking)
  async function adminTool(name, args, req) {
    if (!ADMIN_TOOLS.some(function (t) { return t.name === name; })) throw new Error('no such tool');
    return callTool(name, args, req, { uid: null, admin: true });
  }
  // for node server.js --check: what here is read by statements put together from parts, each as the game or the
  // reviewer asks for it. They only read.
  function selfCheck() {
    const admin = function (name) { return ['the reviewer\'s ' + name, function () { return callTool(name, {}, { headers: {} }, { uid: null, admin: true }); }]; };
    return [['the public levels, most played', function () { return listLevels('top'); }], ['the public levels, newest', function () { return listLevels('new'); }], ['a leaderboard', function () { return board('city', 'check', 5); }],
      ['a made level', function () { return levelOf('checkaaaa'); }], ['a made Frank', function () { return madeFrank('fcheckaa'); }], ['the sponsors', adsLive], admin('admin_queue'), admin('admin_ads'), admin('admin_levels')];
  }
  return { adminTool: adminTool, routes: routes, mcp: mcp, levelOf: levelOf, publish: publish, moveTo: moveTo, profileOf: profileOf, adsLive: adsLive, adHit: adHit, seedAds: seedAds, selfCheck: selfCheck };
};
