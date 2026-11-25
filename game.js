// Free Fall Frank: drawing, input, menus and the frame loop. The rules live in core.js.
// URL switches for testing: ?bot plays the built-in solution, ?mute runs without sound,
// ?at=3 starts at section 3, ?frank=5 picks a Frank, ?screen=select opens the Frank picker.
(function () {
  'use strict';
  const C = window.FFFCore, A = window.FFFAudio;
  const params = new URLSearchParams(location.search);
  const BOT = params.has('bot'), MUTE = params.has('mute'), AT = +params.get('at') || 0;

  const FRANKS = window.FFFFranks, Acct = window.FFFAccount;
  // Franks players made (through the connector) that this device has opened come after the game's own 24. A made
  // Frank is a look only: the name, the colours, the hat and the extras.
  const OWN = FRANKS.length;
  function madeFrank(m) { return Object.assign({}, FRANKS[0], { name: String(m.name), world: 'Made by a player', head: m.head, torso: m.torso, legs: m.legs, hair: m.hair, hat: m.hat, extra: m.extra || '', made: m.id }); }
  // (what this browser keeps is read through save.js: what cannot be read is set aside there, never thrown away)
  const SV = window.FFFSave;
  let savedFranks = SV.list('fff.franks');
  savedFranks.forEach(function (m) { FRANKS.push(madeFrank(m)); });
  // add a made Frank to this player's Franks (or find him there): his place in the row
  function keepFrank(m) {
    let at = FRANKS.findIndex(function (f) { return f.made === m.id; });
    if (at < 0) {
      FRANKS.push(madeFrank(m)); at = FRANKS.length - 1;
      savedFranks = savedFranks.filter(function (x) { return x.id !== m.id; }).concat([{ id: m.id, name: m.name, head: m.head, torso: m.torso, legs: m.legs, hair: m.hair, hat: m.hat, extra: m.extra }]).slice(-24);
      localStorage.setItem('fff.franks', JSON.stringify(savedFranks));
    }
    return at;
  }

  // A level is painted from its Frank's world (franks.js). Each stretch of the level is that world's
  // colours turned a little: [hue turn, background brightness, hue turn of the glow].
  const VARY = { shaft: [0, 1, 0], shaft2: [14, 1.15, 10], sewer: [-24, 0.9, -14], vents: [26, 1.1, 18], grid: [44, 1.2, 30], storm: [-40, 0.95, -24], core: [-12, 0.7, -8], chute: [70, 1.25, 40] };
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, n >> 8 & 255, n & 255]; }
  const hex2 = function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); };
  function shade(hex, f) {                                          // darker below 1, towards white above
    const c = rgb(hex);
    return '#' + c.map(function (v) { return hex2(f > 1 ? v + (255 - v) * (f - 1) : v * f); }).join('');
  }
  function hueRot(hex, deg) {                                       // rotate a colour around the wheel
    if (!deg) return hex;
    const c = rgb(hex), a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const m = [cs + (1 - cs) / 3, (1 - cs) / 3 - sn * 0.57735, (1 - cs) / 3 + sn * 0.57735];
    const o = [c[0] * m[0] + c[1] * m[1] + c[2] * m[2], c[0] * m[2] + c[1] * m[0] + c[2] * m[1], c[0] * m[1] + c[1] * m[2] + c[2] * m[0]];
    return '#' + o.map(hex2).join('');
  }
  // (one of the game's own later levels has a world of its own, lv.world, and its stretches say how each turns the colours: vary)
  const thCache = {};
  function themesFor(i, lv, sections) {
    if (!lv && thCache[i]) return thCache[i];
    const w = lv ? lv.world.w : FRANKS[i].w, out = lv ? {} : thCache[i] = {};
    const mk = function (bg, block, neon, pat, decor) {
      const n = rgb(neon), hud = n[0] * 0.3 + n[1] * 0.59 + n[2] * 0.11 < 70 ? '#ffffff' : neon;   // a dark glow would vanish in the HUD
      return { bg: bg, block: block, neon: neon, hud: hud, pat: pat, decor: decor, top: shade(block, 1.35), side: shade(block, 0.6), wall: shade(bg, 1.12), wallDark: shade(bg, 0.6) };
    };
    Object.keys(VARY).forEach(function (k) {
      const v = VARY[k];
      out[k] = mk(shade(hueRot(w.bg, v[0]), v[1]), hueRot(w.block, v[0]), hueRot(w.neon, v[2]), w.pat, w.decor);
    });
    out.street = mk(w.sky, w.ground, w.neon, w.pat, '');            // the top: his sky, the ground and the hole in it
    out.street.wall = w.sil; out.street.wallDark = shade(w.sil, 0.7); out.street.under = shade(w.bg, 0.6);
    out.sky = mk(w.bottom || (i ? shade(w.sky, 1.5) : '#58b8f0'), '#ffffff', '#ffffff', 'plain', '');   // the bottom: out into the open
    out.sky.wall = shade(out.sky.bg, 1.6); out.sky.wallDark = shade(out.sky.bg, 1.3);
    out.bonus = mk('#2a2100', '#b8961e', '#fff27a', 'gold', '');
    (sections || []).forEach(function (s) { if (s.vary) out[s.theme] = mk(shade(hueRot(w.bg, s.vary[0]), s.vary[1]), hueRot(w.block, s.vary[0]), hueRot(w.neon, s.vary[2]), w.pat, w.decor); });
    return out;
  }
  // what the stretches of his level are called, and the tip shown on the way in
  const TIPS = { manhole: 'COUNT YOUR TAPS', shaft: 'NOT TOO EARLY, NOT TOO LATE', sewer: 'KEEP TUMBLING', grid: 'GO WALL TO WALL', core: 'ALMOST AT THE BOTTOM', chute: 'HOLD ON' };
  function secName(s) { return WF.w.names[s.key] || s.name; }
  function secHint(s) {
    const w = WF.w;
    if (s.tip) return s.tip;
    if (s.mode === 'slide') return 'TOO ' + w.slick + ' TO TUMBLE: TAP TO SLIDE';
    if (s.mode === 'wind') return s.key === 'storm' ? 'THE ' + w.gust + ' KEEPS TURNING' : 'RIDE THE ' + w.gust + ' OR TAP AGAINST IT';
    return TIPS[s.key] || '';
  }
  function hash(a, b) {
    let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }

  const cv = document.getElementById('game');
  let ctx = cv.getContext('2d');                                    // what everything draws on: the screen, or for a moment the card a win is shared as
  let W = 0, H = 0, dpr = 1, cell = 32, FR = 7, vc = 12;
  let sat = 0, sab = 0;            // safe area (notch, home bar) the HUD has to stay out of

  const cache = {};
  const clampF = function (i) { return Math.max(0, Math.min(FRANKS.length - 1, i | 0)); };
  const PF = /^\d{1,2}$/.test(params.get('frank') || '') ? clampF(+params.get('frank')) : -1;   // ?frank=<number>; a made Frank's link carries his id instead
  const TO_SELECT = params.get('screen') === 'select';
  let who = PF >= 0 && !TO_SELECT ? PF : clampF(+(localStorage.getItem('fff.frank') || 0));
  let level, run, TH, tokRows, extras;
  // The levels, as the main page shows them: the game's own, then the ones people made that this player has
  // opened (kept on the device). Every Frank falls down every level: a Frank is only who you play as.
  // id = its name on the server (leaderboards, links); key = what this device files its bests under;
  // frank = whose world, track and coins it has (the order of franks.js); made = a made level's design (core.js).
  // paid = one of the game's own later levels: its stretches are fetched when it is played (all of them if this
  // player owns it, otherwise the taste), frank = its number in the stats and the wallet, world = its look (franks.js).
  const LEVELS = [{ id: 'city', key: 0, name: 'ELM STREET', sub: 'Down the manhole, under the city', frank: 0 }];
  if (!window.FFF_PANEL) LEVELS.push({ id: 'rock', key: 'rock', name: 'ROCK BOTTOM', sub: 'He fell out of the bottom of the world', frank: 100, world: FRANKS.worlds.rock, paid: true,
    pitch: ['ABOUT FIVE MINUTES STRAIGHT DOWN', 'Gates that bite, swap, slide and lock.', 'Bats, fire, a grudge, and THE LANDLORD.', 'Three mazes, four slides, eight secrets.'] });
  function madeLevel(m) { return { id: m.id, key: m.id, name: String(m.name).toUpperCase(), sub: 'by ' + m.author, frank: m.world, made: m }; }
  let saved = SV.list('fff.levels');
  saved.forEach(function (m) { try { C.customLevel(m); LEVELS.push(madeLevel(m)); } catch (e) { /* a level this version cannot build: left out */ } });
  // add a made level to this player's levels (or find it there): where it is in the row
  function keepLevel(m) {
    let at = LEVELS.findIndex(function (l) { return l.id === m.id; });
    if (at < 0) {
      LEVELS.push(madeLevel(m)); at = LEVELS.length - 1;
      saved = saved.filter(function (x) { return x.id !== m.id; }).concat([{ v: m.v, id: m.id, name: m.name, author: m.author, world: m.world, seed: m.seed, sections: m.sections }]).slice(-12);
      localStorage.setItem('fff.levels', JSON.stringify(saved));
    }
    return at;
  }
  let LV = LEVELS[0], LF = LV.frank, LK = LV.key, WF = FRANKS[0];   // the level being played, its world's number, its key, and its world (a Frank's, or the level's own)
  function setLevel(lv) { if (lv === LV) return; LV = lv; LF = lv.frank; LK = lv.key; WF = lv.world || FRANKS[lv.frank]; localStorage.setItem('fff.lv', lv.id); setFrank(who); }
  function scoreOf(i) { return SV.num('fff.top.' + i); }
  function setFrank(who2) {
    if (run) cashIn();
    who = who2;
    localStorage.setItem('fff.frank', who2);
    const i = LV.paid ? LK + (LV.tasting ? ':taste' : '') : LK;     // a paid level is two levels: the taste, and all of it
    if (!cache[i]) {
      const L = C.buildLevel(LV.spec || (LV.made ? C.customSpec(LV.made) : C.specFor(LF))), rows = new Map();
      if (A.trackOf(LF)) L.bpm = A.trackOf(LF).bpm;                // a level with a recorded track runs at the recording's tempo
      L.baseBpm = L.bpm;                                            // hard and insane play it faster than that
      L.tokens.forEach(function (k, n) { if (!rows.has(k.row)) rows.set(k.row, []); rows.get(k.row).push(n); });
      // what to draw on each row: gate labels, blower bands, springs, portals
      const ex = new Map(), at = function (r) { if (!ex.has(r)) ex.set(r, {}); return ex.get(r); };
      L.gates.forEach(function (g) { if (g.n) at(g.row).gate = g; if (g.type) at(g.row).tg = g; });
      // a written-out level's own things: keys, swirls, things to brush against, golden tokens, the rain, a wall that
      // is not there, the arches where left and right swap, and the row a slide's two lanes are named on
      L.keys.forEach(function (k, n) { at(k.row).key = n; });
      L.warps.forEach(function (w, n) { at(w.row).warp = n; });
      L.spots.forEach(function (sp, n) { at(sp.row).spot = n; });
      L.golds.forEach(function (g, n) { g.cells.forEach(function (k, j) { const e = at(k.row); (e.gold = e.gold || []).push([n, j]); }); });
      L.rain.forEach(function (k, n) { const e = at(k.row); (e.rain = e.rain || []).push(n); });
      L.portals.forEach(function (p, n) { if (p.wall) for (let r = p.r0; r <= p.r1; r++) at(r).crack = p; if (p.fake) at(p.row + 1).fake2 = n; });
      L.mirrors.forEach(function (z) { if (z.arch) { at(Math.floor(L.rowAt(z.a))).arch = 1; at(Math.floor(L.rowAt(z.b))).arch = -1; } });
      L.sections.forEach(function (s) { if (s.lanes) at(s.startRow + Math.round(s.rpb * 3.2)).lanes = s; });
      L.blowers.forEach(function (bd) { for (let r = bd.r0; r <= bd.r1; r++) at(r).blow = bd.dir; });
      L.springs.forEach(function (sp, n) { at(sp.row).spring = n; });
      L.portals.forEach(function (p, n) { at(p.row).portal = n; });
      L.bonus.forEach(function (bn) {
        bn.rows = new Map();
        bn.tokens.forEach(function (k, n) { if (!bn.rows.has(k.row)) bn.rows.set(k.row, []); bn.rows.get(k.row).push(n); });
      });
      cache[i] = { level: L, run: new C.Run(L), th: LV.world ? themesFor(LF, LV, L.sections) : themesFor(LF), tok: rows, ex: ex };
    }
    level = cache[i].level; run = cache[i].run; TH = cache[i].th; tokRows = cache[i].tok; extras = cache[i].ex;
    level.bpm = level.baseBpm * DIFFS[SET.diff].speed;
    run.reset(0); run.banked = false;
    camX = camTarget(); angle = run.st.k; anim = null; parts = [];
  }
  // how far this player has got, in percent (kept under a new name since the level became the one level, so
  // nothing recorded on the old levels, or by a clock that ran on while the phone slept, counts)
  function bestOf(i) { return SV.num('fff.far.' + i); }

  let state = 'title';             // title | select | play | paused | dead | win
  let t0 = 0, beat0 = 0;           // clock anchor: beat0 was the beat at clock time t0
  let angle = 0;                   // Frank's quarter turns, never wrapped, so he spins the way he was tapped
  let anim = null, botI = 0, botPlan = [], botPortal = -1, attempts = 1, deadUntil = 0, deadHow = '', shake = 0, pausedAt = 0, camX = 0;
  let banner = null, parts = [], flash = { dir: 0, t: -9 }, hits = [], ducked = false, spunAt = -1;   // ducked: he found the rubber duck, and wears it to the bottom; spunAt: when he went dizzy
  let selScroll = 0, selTarget = 0, selMid = -1, drag = null, note = null;
  // what is written or laid over the picture of the fall on this frame (a sheet, a headline): the tests hold these clear of Frank
  let inks = [];
  function ink(x, y, w, h) { inks.push({ x: x, y: y, w: w, h: h }); }

  const STREET_ROW = 24;                                            // the row of the street and the hole in it (core.js: the street's gate)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cell = Math.max(8, Math.floor(Math.min(W, H * 0.6) / 12));
    vc = W / cell;
    FR = Math.round(H / cell * 0.26);
    const cs = getComputedStyle(document.documentElement);
    sat = parseFloat(cs.getPropertyValue('--sat')) || 0;
    sab = parseFloat(cs.getPropertyValue('--sab')) || 0;
  }
  window.addEventListener('resize', resize);
  resize();

  function curBeat() { return beat0 + (A.time() - t0) * level.bpm / 60; }
  function pose() {
    const st = run.st, vert = st.k % 2 === 0;
    return { cx: st.col + (vert ? 0.5 : 1.5), cy: vert ? -1.5 : -0.5, left: st.col, right: st.col + (vert ? 1 : 3) };
  }
  // the level can be wider than the screen: follow Frank, but never show past the walls
  function camTarget() {
    const s = run.bonus ? { lo: 0, hi: C.WIDE } : level.sectionAt(run.beat);
    if (s.hi - s.lo + 1 <= vc) return (s.lo + s.hi) / 2 - vc / 2;
    return Math.max(s.lo - 0.5, Math.min(s.hi + 0.5 - vc, pose().cx - vc / 2));
  }

  // quick = a retry: skip the long drop from the sky and start right above the hole
  function start(si, quick) {
    if (state === 'play' || state === 'paused') report('quit');     // walked away from an attempt
    cashIn();
    run.reset(si); run.banked = false; run.logged = false; ducked = false; spunAt = -1; A.mood('');
    beat0 = quick && si === 0 ? 1.6 : run.beat; t0 = A.time();
    A.seek(beat0, level, LF);
    angle = run.st.k; anim = null; parts = [];
    camX = camTarget(); view.a = turnOf(run.beat);
    // what the test bot taps: the level's own solution, or (?secret=<id>) that with what it takes to find one hidden thing
    const sc = BOT && params.get('secret') && level.secrets.filter(function (s) { return s.id === params.get('secret'); })[0], how = sc ? sc.how : {};
    botPlan = level.plan.map(function (p) { return { beat: p.beat, dir: (how.flip || []).some(function (b) { return Math.abs(b - p.beat) < 0.001; }) ? -p.dir : p.dir }; }).concat(how.add || []).sort(function (a, b) { return a.beat - b.beat; });
    botPortal = params.has('portal') ? +params.get('portal') : how.portal === undefined ? -1 : how.portal;
    botI = 0;
    while (botI < botPlan.length && botPlan[botI].beat < run.beat) botI++;
    state = 'play';
    banner = null;
  }
  function begin(si) { A.pause(false); attempts = 1; start(si || 0); A.sfx('fall'); adTrack('view'); }

  // raw = the tap is already the way Frank should move (the test bot); a player's tap is swapped inside a mirror stretch
  // at = the exact beat of the tap, when the bot replays the level's own solution
  function doTap(dir, raw, at) {
    const bt = at === undefined ? curBeat() : at;
    if (!raw && !run.bonus && level.zoneAt(level.mirrors, bt)) dir = -dir;
    const old = pose(), res = run.tap(dir, bt), t = performance.now() / 1000;
    if (res.mode === 'rotate') {
      anim = { kind: 'rot', dir: dir, t: t, dur: 0.09, cx: old.cx, cy: old.cy, px: dir > 0 ? old.right : old.left, a: angle };
      angle += dir;
      A.sfx('tap');
    } else { anim = { kind: 'slide', dir: dir, t: t, dur: 0.1, cx: old.cx }; A.sfx('slide', dir); }
    if (!res.ok) die('bonk');
  }

  // put the tokens this attempt picked up into the wallet, once
  function cashIn() { if (run.count && !run.banked) { run.banked = true; Acct.bank(SET.easy ? Math.floor(run.count / 2) : run.count, LF); } }   // easy pays half

  function die(how) {
    report(how);
    state = 'dead'; deadHow = how;
    attempts++;
    deadUntil = performance.now() / 1000 + 0.4;
    shake = 1;
    const p = pose(), f = FRANKS[who];
    for (let i = 0; i < 20; i++) {
      parts.push({ x: p.cx, y: p.cy + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 14,
        c: [f.head, f.torso, f.legs, f.hair][i % 4], s: 0.2 + Math.random() * 0.25 });
    }
    cashIn();
    A.stop();
    A.sfx(how);
  }

  // Buttons here answer as the finger goes down, but a phone only lets a page open its share sheet, copy to the
  // clipboard or open another page as the finger comes up. So those wait for the lift: lifted(fn) runs fn then.
  let onLift = null;
  function lifted(fn) { onLift = fn; }

  // ---------- recording a clip ----------
  // The REC button beside pause films the game as it is played (the picture and the sound) for up to a minute. It
  // stops when pressed again, on a pause or at the end of the level; the clip is then offered on the pause or win
  // screen, to save to the device or hand to the share sheet (Instagram, TikTok, messages...).
  let rec = null, clip = null;
  function recStart() {
    if (rec) return;
    if (!cv.captureStream || !window.MediaRecorder) { toast('THIS BROWSER CANNOT RECORD'); return; }
    try {
      const stream = cv.captureStream(30), sound = A.recStream && A.recStream();
      if (sound) sound.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      // mp4 where the browser can (phones post it anywhere), else webm
      const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0];
      const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined), parts2 = [];
      mr.ondataavailable = function (e) { if (e.data && e.data.size) parts2.push(e.data); };
      mr.onstop = function () {
        const mt = (mr.mimeType || type || 'video/webm').split(';')[0];
        if (parts2.length) clip = new File(parts2, 'free-fall-frank.' + (/mp4/.test(mt) ? 'mp4' : 'webm'), { type: mt });
        stream.getVideoTracks().forEach(function (tr) { tr.stop(); });
      };
      mr.start(500);
      rec = { mr: mr, at: performance.now() }; clip = null;
    } catch (e) { rec = null; toast('THIS BROWSER CANNOT RECORD'); }
  }
  function recStop() { if (!rec) return; const mr = rec.mr; rec = null; try { mr.stop(); } catch (e) { /* already stopped */ } }
  function download(file, said) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); toast(said); }
  function saveClip() {
    if (!clip) return;
    // The clip opens over the game as a real video with real buttons under it: a phone hands its share sheet, or a
    // download, only to a press on an ordinary button, and whatever it refuses, the video itself can be held to save.
    const file = clip;
    lifted(function () { showClip(file); });                        // once the finger is up, so the press cannot land on what opens
  }
  function showClip(file) {
    const url = HOME + (LV.id === 'city' ? 'play' : '?level=' + LV.id), src = URL.createObjectURL(file), born = performance.now();
    let box = document.getElementById('clipbox');
    if (box) box.remove();
    box = document.createElement('div'); box.id = 'clipbox';
    box.style.cssText = 'position:fixed;inset:0;z-index:20;background:rgba(5,3,12,0.96);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;box-sizing:border-box;font:bold 15px "Courier New",monospace;color:#fff;text-align:center';
    const btn = 'font:bold 17px Courier New,monospace;color:#fff;text-align:center;border:3px solid #0a0812;padding:12px 10px;width:min(300px,80vw);box-sizing:border-box;cursor:pointer;text-decoration:none;display:block;box-shadow:inset 0 -6px 0 rgba(0,0,0,.28),inset 0 5px 0 rgba(255,255,255,.28);';
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    box.innerHTML = '<video controls playsinline loop muted autoplay style="max-width:92vw;max-height:52vh;border:3px solid #0a0812;background:#000"></video>' +
      '<div id="clipsay" style="color:#b9b4d0;font-size:13px;min-height:1.2em">' + (canShare ? '' : 'Hold the video to save it to your photos.') + '</div>' +
      (canShare ? '<button id="clipshare" style="' + btn + 'background:#ff4fd8">SHARE</button>' : '') +
      '<a id="clipsave" style="' + btn + 'background:#23a5a5">SAVE TO THIS DEVICE</a>' +
      '<button id="clipdone" style="' + btn + 'background:#3b3f8f">DONE</button>';
    document.body.appendChild(box);
    box.querySelector('video').src = src;
    const save = box.querySelector('#clipsave'), say = box.querySelector('#clipsay');
    save.href = src; save.download = file.name;
    const early = function (e) { if (performance.now() - born < 400) { e.preventDefault(); return true; } return false; };   // the tail of the press that opened this
    save.onclick = function (e) { if (early(e)) return; say.textContent = 'Saved to your downloads. On an iPhone: hold the video and choose Save to Photos.'; };
    if (canShare) box.querySelector('#clipshare').onclick = function (e) {
      if (early(e)) return;
      navigator.share({ files: [file], text: 'Free Fall Frank: ' + LV.name + '. ' + url }).catch(function (e) { if (!e || e.name !== 'AbortError') say.textContent = 'Sharing did not open. Hold the video and choose Save to Photos, or press SAVE.'; });
    };
    box.querySelector('#clipdone').onclick = function (e) { if (early(e)) return; box.remove(); URL.revokeObjectURL(src); };
  }
  function pause() {
    if (state !== 'play') return;
    recStop();
    state = 'paused'; pausedAt = performance.now() / 1000;
    A.pause(true);
  }
  function resume() {
    A.pause(false);
    if (!A.on()) t0 += performance.now() / 1000 - pausedAt;
    state = 'play';
  }
  function openSelect(at) { if (state === 'paused') report('quit'); A.pause(false); A.stop(); state = 'select'; selScroll = selTarget = typeof at === 'number' ? at : who; }
  // back to the main page and its level cards, from a pause or the end of a level
  function toLevels() { if (state === 'paused') report('quit'); A.pause(false); A.stop(); setFrank(who); lvTarget = lvScroll = Math.max(0, LEVELS.indexOf(LV)); state = 'title'; }
  function toast(s) { note = { s: s, t: performance.now() / 1000 }; }
  // play him if he is unlocked; otherwise offer the pack (every Frank for one payment)
  function buyPack() {
    if (Acct.me.user) toast('OPENING CHECKOUT...');
    Acct.buy().catch(function () { toast('THE STORE IS NOT AVAILABLE RIGHT NOW'); });
  }
  function pick(i) {
    if (Acct.status(i) === 'open') { setFrank(i); Acct.api('/api/profile', { frank: FRANKS[i].made || String(i) }).catch(function () {}); begin(0); } else buyPack();
  }
  // what the stats get about an attempt: which level, how far, how long, how it ended. Sent once per attempt.
  function report(res) {
    if (BOT || run.logged || run.beat <= beat0 + 0.5) return;
    run.logged = true;
    const sc = Math.round((Math.max(0, Math.min(100, Math.floor(run.beat / level.totalBeats * 100))) * 100 + run.count * 10 + (res === 'win' ? 5000 : 0)) * DIFFS[SET.diff].score);
    if (sc > scoreOf(LK) && !LV.tasting) localStorage.setItem('fff.top.' + LK, sc);
    if (res === 'win') makeWinCard(sc);
    // every attempt goes to the level's leaderboard, which keeps each player's best (a taste's scores are not kept)
    if (!LV.tasting) Acct.api('/api/score', { level: LV.id, score: sc, pct: Math.max(0, Math.min(100, Math.floor(run.beat / level.totalBeats * 100))), name: playerName(), played: true }).catch(function () {});
    Acct.track({ t: 'run', frank: LF, pct: Math.max(0, Math.min(100, Math.floor(run.beat / level.totalBeats * 100))), sec: level.sectionAt(run.beat).key,
      secs: Math.max(0, (run.beat - beat0) * 60 / level.bpm), tokens: run.count, res: res, easy: SET.easy ? 1 : 0 });
  }
  function play() { if (Acct.status(who) !== 'open') setFrank(0); begin(AT); }
  function playAt(i) { if (!LEVELS[i]) return; if (LEVELS[i].paid) return enter(LEVELS[i]); setLevel(LEVELS[i]); play(); }   // the level on that page of the main page
  // A paid level: the server says what this player may have of it (all of it, or the taste: its first stretches and
  // a wall) and that is what is built and played. (window.FFF_WORLDS stands in for the server in a test.)
  let entering = false, unlockLv = null;
  const ownedLv = function (lv) { return !!(Acct.me.levels[lv.id] || {}).owned; };
  function enter(lv) {
    if (entering) return;
    entering = true; toast('LOADING...');
    const had = window.FFF_WORLDS && window.FFF_WORLDS[lv.id];
    (had ? Promise.resolve(had) : Acct.api('/api/world?id=' + lv.id + '&v=' + C.WORLD_V)).then(function (d) {
      entering = false;
      if (!d || !d.spec) throw new Error('nothing');
      C.readable(d.v, C.WORLD_READS, 'this level');                 // written by a later build than this page: not built wrong, and the page reloads into that build when it can
      lv.spec = d.spec; lv.tasting = !d.owned;
      if (LV === lv) setFrank(who); else setLevel(lv);
      note = null; play();
    }).catch(function () { entering = false; toast('THAT LEVEL COULD NOT BE LOADED'); });
  }
  // the unlock sheet, from the level's card or at the wall a taste ends in; and paying (which asks her to sign in first)
  function openUnlock(lv) { unlockLv = lv; state = 'unlock'; }
  function buyLevel(lv) {
    if (ownedLv(lv)) { toLevels(); return; }
    if (Acct.me.user) toast('OPENING CHECKOUT...');
    Acct.buyLevel(lv.id).catch(function () { toast('THE STORE IS NOT AVAILABLE RIGHT NOW'); });
  }
  // a hidden thing found: the server keeps it for this player (and pays tokens the first time); the card shows how many
  function foundSecret(id, t) {
    const m = Acct.me.levels[LV.id];
    if (!m) return;
    const isNew = m.found.indexOf(id) < 0;
    if (isNew) m.found.push(id);
    secretNote = { s: (isNew ? 'SECRET FOUND!  ' : 'SECRET  ') + m.found.length + ' OF ' + m.secrets + (isNew ? '   +' + Acct.me.secretTokens : ''), t: t };
    A.sfx('secret');
    if (isNew && !BOT) Acct.api('/api/secret', { level: LV.id, id: id }).then(function (r) { if (r && r.found) { m.found = r.found; if (typeof r.coins === 'number') Acct.me.coins = r.coins; } }).catch(function () {});
  }
  let secretNote = null;

  // ---------- leaderboards, players' levels and sharing ----------
  // The name a player's scores go up under: their own choice, else their account's first name, else PLAYER and a number.
  function playerName() {
    const own = localStorage.getItem('fff.name'), u = Acct.me.user;
    if (own) return own;
    if (u && (u.name || u.email)) return String(u.name || u.email).split(/[ @]/)[0].slice(0, 16);
    let n = localStorage.getItem('fff.tag');
    if (!n) { n = String(1000 + Math.floor(Math.random() * 9000)); localStorage.setItem('fff.tag', n); }
    return 'PLAYER ' + n;
  }
  function rename() {
    const s = window.prompt('Your name on the leaderboards (2 to 16 letters):', playerName());
    if (s === null) return;
    const c = s.replace(/[^\w .-]/g, '').trim().slice(0, 16);
    if (c.length < 2) return;
    localStorage.setItem('fff.name', c);
    if (prof) prof.name = c;
    // the profile keeps it, and renames the player on every leaderboard
    Acct.api('/api/profile', { name: c }).then(function () { if (state === 'board' && list && list.kind === 'board') openBoard(list.lv); }).catch(function () {});
  }

  // ---------- the profile: your name, your Frank, your connector address, what you have made ----------
  let prof = null, profBack = 'title';
  function gotProfile(p) {
    if (!p || !p.code) return;
    prof = p;
    if (p.name) localStorage.setItem('fff.name', p.name);
  }
  function openProfile() {
    profBack = state === 'settings' ? setBack : state; state = 'profile';
    Acct.api('/api/profile').then(gotProfile).catch(function () { prof = prof || { offline: true, levels: [], franks: [] }; });
  }
  function copy(s, said) {
    lifted(function () {
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(function () { toast(said); }, function () { window.prompt('Copy this:', s); });
      else window.prompt('Copy this:', s);
    });
  }
  // put one of your levels forward for the public list (free; it is looked at before it is listed)
  function goPublic(lv) {
    Acct.api('/api/level/submit', { id: lv.id }).then(function (r) {
      if (r.status) { lv.status = r.status; toast(r.status === 'pending' ? 'SENT FOR REVIEW' : 'IT IS PUBLIC'); }
      else toast(String(r.error || 'COULD NOT DO THAT').toUpperCase().slice(0, 40));
    }).catch(function () { toast('NOT AVAILABLE RIGHT NOW'); });
  }
  function drawProfile(t) {
    titleBack(t);
    header('PROFILE', '', function () { state = profBack === 'paused' ? 'title' : profBack; });
    const w = Math.min(440, W - 24), x = W / 2 - w / 2, tight = H - sat - sab < 700, bh = tight ? 44 : 46, g = tight ? 8 : 12, half = (w - 28 - 8) / 2;
    let y = sat + 68;
    // who you are: your Frank on his plate, your name, and the two things to change
    panel(x, y, w, 78 + bh + 12, CYAN, { glow: 0.8 });
    ctx.fillStyle = 'rgba(6,3,18,0.75)'; cut(x + 12, y + 10, 58, 62, 7); ctx.fill(); ctx.fillStyle = CYAN; ctx.globalAlpha = 0.5; ctx.fillRect(x + 18, y + 64, 46, 3); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(x + 41, y + 40 - Math.abs(Math.sin(t * 4)) * 3); drawBody(13, FRANKS[who], t); ctx.restore();
    text(playerName().toUpperCase(), x + 82, y + 30, fit(playerName(), 22, (w - 96) * 1.5), '#fff', 'left');
    text('PLAYS AS ' + FRANKS[who].name, x + 82, y + 55, fit('PLAYS AS ' + FRANKS[who].name, 13, (w - 96) * 1.5), CYAN, 'left');
    button('CHANGE NAME', x + 14, y + 78, half, bh, rename, INDIGO, { size: 14 }); button('CHANGE FRANK', x + 22 + half, y + 78, half, bh, openSelect, INDIGO, { size: 14 });
    y += 78 + bh + 12 + g;
    // the account: who is signed in (with a way out), or the way in
    const acc = Acct.me.user, has = Acct.me.packs.length > 0;
    panel(x, y, w, 34 + bh + 12, acc ? LIME : AMBER, { glow: 0.6 });
    if (acc) {
      const who2 = String(acc.email || acc.name || 'SIGNED IN');
      icon('user', x + 24, y + 19, 14, LIME); text(who2, x + 40, y + 20, fit(who2, 13, (w - (has ? 170 : 60)) * 1.5), '#fff', 'left');
      if (has) { ctx.save(); chip('ALL FRANKS', x + w - 118, y + 8, 22, GOLD); ctx.restore(); }
      button('SIGN OUT', x + 14, y + 34, half, bh, function () { Acct.signOut(); }, SLATE, { size: 14 });
      button('DELETE ACCOUNT', x + 22 + half, y + 34, half, bh, function () { Acct.open(); }, RED, { ghost: true, size: 12, ink: '#ffb3c0' });
    } else {
      text('NOT SIGNED IN: THIS DEVICE ONLY', W / 2, y + 20, fit('NOT SIGNED IN: THIS DEVICE ONLY', 13, w - 30), SOFT);
      button('SIGN IN', x + 14, y + 34, w - 28, bh, function () { Acct.open('Sign in to keep your Franks, coins and levels on every device.'); }, TEAL, { icon: 'user' });
    }
    y += 34 + bh + 12 + g;
    // the connector: build levels and Franks with Claude
    panel(x, y, w, 56 + bh + 12, PINK, { glow: 0.6 });
    text('BUILD LEVELS AND FRANKS WITH CLAUDE', W / 2, y + 17, fit('BUILD LEVELS AND FRANKS WITH CLAUDE', 13, w - 30), '#ffb3ee');
    if (!prof) { text('LOADING...', W / 2, y + 56, 15, '#fff'); toastAt(t, sat + 84); return; }
    if (prof.offline) { text('NOT AVAILABLE RIGHT NOW', W / 2, y + 56, 15, '#fff'); toastAt(t, sat + 84); return; }
    text(prof.connector.replace('https://', ''), W / 2, y + 40, fit(prof.connector, 14, (w - 30) * 1.17), '#fff');
    button('COPY ADDRESS', x + 14, y + 56, half, bh, function () { copy(prof.connector, 'ADDRESS COPIED'); }, TEAL, { size: 14 }); button('HOW IT WORKS', x + 22 + half, y + 56, half, bh, openBuild, PINK, { size: 14 });
    y += 56 + bh + 12 + g + 8;
    // your levels, each with its rating, and where each stands with the public list
    const SAY = { link: 'GO PUBLIC', declined: 'DECLINED: TRY AGAIN', pending: 'IN REVIEW', public: 'PUBLIC' }, rh = 46, room = Math.max(0, Math.floor((H - sab - 12 - y - 20) / rh));
    text(prof.levels.length ? 'YOUR LEVELS' : 'NO LEVELS OF YOUR OWN YET', W / 2, y, 13, GOLD);
    prof.levels.slice(0, room).forEach(function (lv, i) {
      const ry = y + 16 + i * rh, open = lv.status === 'link' || lv.status === 'declined', d = lv.difficulty && lv.difficulty.level ? lv.difficulty : null;
      ctx.fillStyle = 'rgba(12,7,32,0.8)'; cut(x, ry, w, rh - 6, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; cut(x + 0.5, ry + 0.5, w - 1, rh - 7, 7); ctx.stroke();
      if (d) face(d.level, x + 22, ry + (rh - 6) / 2, 24);
      text(String(lv.name).toUpperCase(), x + (d ? 42 : 10), ry + (rh - 6) / 2 + 1, fit(lv.name, 14, (w - 220) * 1.6), '#fff', 'left');
      if (open) button(SAY[lv.status], x + w - 172, ry, 172, rh - 6, function () { goPublic(lv); }, AMBER, { size: 12 });
      else { icon(lv.status === 'public' ? 'check' : 'search', x + w - 16, ry + (rh - 6) / 2, 11, lv.status === 'public' ? LIME : SOFT); text(SAY[lv.status] || '', x + w - 30, ry + (rh - 6) / 2 + 1, 13, lv.status === 'public' ? LIME : SOFT, 'right'); }
    });
    toastAt(t, sat + 84);
  }

  // ---------- the card a win is shared as ----------
  // A picture of the win (the level, the score, your Frank) made as soon as a level is cleared, so the SHARE button
  // can hand it straight to the phone's share sheet (Instagram, Facebook, messages...) with the level's link.
  let winCard = null;
  function makeWinCard(score) {
    winCard = null;
    const off = document.createElement('canvas'), keep = ctx, cw = 1080, ch = 1350;
    off.width = cw; off.height = ch;
    ctx = off.getContext('2d');
    try {
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#2d1b70'); g.addColorStop(0.55, '#1a1147'); g.addColorStop(1, '#0c0722');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 14; i++) { const q = 120 + hash(i, 64) * 260; ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + hash(i, 65) * 0.04) + ')'; ctx.fillRect(hash(i, 61) * cw - q / 2, hash(i, 62) * ch - q / 2, q, q); }
      text('FREE FALL', cw / 2, 110, 84, '#35e8ff'); text('FRANK', cw / 2, 230, 150, '#ffd23f');
      text('I CLEARED', cw / 2, 390, 54, '#fff');
      text(LV.name, cw / 2, 480, Math.min(100, cw * 0.86 / (LV.name.length * 0.62)), '#ff4fd8');
      ctx.save(); ctx.translate(cw / 2, 760); ctx.rotate(-0.12); drawBody(120, FRANKS[who], 0.4); ctx.restore();
      const line = 'SCORE ' + Number(score).toLocaleString('en-US') + '   ' + DIFFS[SET.diff].name + '   TRY ' + attempts;
      text(line, cw / 2, 1050, Math.min(54, cw * 0.9 / (line.length * 0.62)), '#35e8ff');
      text('CAN YOU BEAT ME?', cw / 2, 1150, 64, '#fff');
      text('freefallfrank.com', cw / 2, 1250, 54, '#ffd23f');
    } finally { ctx = keep; }
    try { off.toBlob(function (b) { if (b) winCard = new File([b], 'free-fall-frank.png', { type: 'image/png' }); }, 'image/png'); } catch (e) { /* no picture: the link alone is shared */ }
  }
  function shareWin() {
    const url = HOME + (LV.id === 'city' ? 'play' : '?level=' + LV.id), msg = 'I cleared ' + LV.name + ' in Free Fall Frank. Can you beat me? ' + url;
    const card = winCard;
    lifted(function () {
      if (card && navigator.canShare && navigator.canShare({ files: [card] })) { navigator.share({ files: [card], text: msg }).catch(function (e) { if (!e || e.name !== 'AbortError') copyLink(url); }); return; }
      if (navigator.share) { navigator.share({ title: 'Free Fall Frank', text: msg, url: url }).catch(function (e) { if (!e || e.name !== 'AbortError') copyLink(url); }); return; }
      // a computer: save the picture to post, and open Facebook's share box on the link
      if (card) download(card, 'PICTURE SAVED: POST IT ANYWHERE');
      window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank', 'noopener');
    });
  }
  // One screen for both lists: a level's leaderboard, and the levels players have made. list.rows is null while it loads.
  let list = null, listBack = 'title';
  function openBoard(lv, renamed) {
    if (state !== 'board') listBack = state;
    list = { kind: 'board', lv: lv, rows: null, me: null, players: 0 }; state = 'board';
    // a new name goes up with the player's best as it stands
    const got = function (d) { if (list && list.lv === lv) { list.rows = d.top || []; list.me = d.me; list.players = d.players || 0; } };
    (renamed ? Acct.api('/api/score', { level: lv.id, score: 0, pct: 0, name: playerName() }) : Acct.api('/api/board?level=' + lv.id)).then(got).catch(function () { if (list) list.rows = []; list.fail = true; });
  }
  // The levels players made: most played or newest first, searched by a level's or a maker's name (list.q), filtered by
  // rating (list.tier, 1 to 5; 0 is all of them), a page at a time (as many as fit the screen: list.per).
  function openBrowse(sort) {
    listBack = 'title';
    list = { kind: 'browse', sort: sort === 'new' ? 'new' : 'top', q: '', tier: 0, page: 1, pages: 1, total: 0, per: 0, rows: null }; state = 'board';
    if (findEl) findEl.value = '';
  }
  function browse() {
    const mine = list; mine.rows = null; mine.fail = false; mine.asked = mine.per;
    Acct.api('/api/levels?sort=' + mine.sort + (mine.q ? '&q=' + encodeURIComponent(mine.q) : '') + (mine.tier ? '&difficulty=' + C.TIERS[mine.tier - 1] : '') + '&page=' + mine.page + '&per=' + mine.per).then(function (d) {
      if (list !== mine) return;
      mine.rows = d.levels || []; mine.total = d.total === undefined ? mine.rows.length : d.total; mine.pages = d.pages || 1; mine.page = d.page || 1;
    }).catch(function () { if (list === mine) { mine.rows = []; mine.fail = true; mine.total = 0; mine.pages = 1; } });
  }
  // the search box of that list is a real text field over the canvas (index.html #find): typing in it asks again, a moment after the last letter
  const findEl = document.getElementById('find');
  let findT = 0;
  if (findEl) {
    findEl.addEventListener('input', function () { clearTimeout(findT); findT = setTimeout(function () { if (list && list.kind === 'browse' && state === 'board') { list.q = findEl.value.trim().slice(0, 32); list.page = 1; browse(); } }, 350); });
    findEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') findEl.blur(); });
  }
  function findBox(on, x, y, w, h) {
    if (!findEl) return;
    if (!on) { if (!findEl.hidden) { findEl.blur(); findEl.hidden = true; } return; }
    const css = 'left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px;height:' + Math.round(h) + 'px';
    if (findEl.dataset.at !== css) { findEl.dataset.at = css; findEl.style.cssText = css; }
    findEl.hidden = false;
  }
  // the game's own address: where it is served from, or its home when it is played inside Claude
  const HOME = window.FFF_BASE || location.origin + '/';
  function openBuild() { if (window.FFF_LINK) window.FFF_LINK(HOME + 'build'); else window.location.href = 'build'; }
  // fetch a made level by its id, put it with this player's levels and show it on the main page
  function fetchLevel(id, then) {
    Acct.api('/api/level?id=' + encodeURIComponent(id)).then(function (m) {
      if (!m || !m.sections) throw new Error('gone');
      C.readable(m.v, C.MADE_READS, 'this level');
      const at = keepLevel(m);
      lvTarget = lvScroll = at;
      if (state === 'board') state = 'title';
      if (then) then(at);
    }).catch(function () { toast('THAT LEVEL COULD NOT BE LOADED'); if (state === 'board') state = 'title'; });
  }
  function shareLevel(lv) {
    const url = HOME + (lv.id === 'city' ? 'play' : '?level=' + lv.id), msg = 'Can you beat me on '   // (the bare address is the landing page for someone new: a shared link goes straight to the game) + lv.name + ' in Free Fall Frank?';
    lifted(function () {
      // the phone's share sheet; if there is none, or it refuses, the link is copied instead
      if (navigator.share) navigator.share({ title: 'Free Fall Frank: ' + lv.name, text: msg, url: url }).catch(function (e) { if (!e || e.name !== 'AbortError') copyLink(url); });
      else copyLink(url);
    });
  }
  // a link onto the clipboard, saying so; where even that is not allowed, shown to copy by hand
  function copyLink(url) {
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('LINK COPIED'); }, function () { window.prompt('Copy this link:', url); });
    else window.prompt('Copy this link:', url);
  }
  function drawList(t) {
    titleBack(t);
    const board = list.kind === 'board', w = Math.min(540, W - 24), x = W / 2 - w / 2, foot = H - sab - 12 - 48, MEDAL = [GOLD, '#d5dbe6', '#e0915a'];
    header(board ? list.lv.name : 'PLAYERS\' LEVELS', board ? 'LEADERBOARD' : 'MADE WITH CLAUDE', function () { state = listBack === 'board' ? 'title' : listBack; });
    const row = function (y, h, me) {
      ctx.fillStyle = me ? 'rgba(255,79,216,0.26)' : 'rgba(12,7,32,0.8)'; cut(x, y, w, h, 7); ctx.fill();
      ctx.strokeStyle = me ? PINK : 'rgba(255,255,255,0.1)'; ctx.lineWidth = me ? 2 : 1; cut(x + 0.5, y + 0.5, w - 1, h - 1, 7); ctx.stroke();
    };
    const empty = function (y, s) { text(s, W / 2, y, fit(s, 16, w), '#fff'); };
    if (board) {
      const top = sat + 70, last = foot - 34, rh = Math.max(30, Math.min(44, (last - top) / 12)), fits = Math.max(3, Math.floor((last - top) / rh));
      if (!list.rows) empty(top + 40, 'LOADING...');
      else if (!list.rows.length) empty(top + 40, list.fail ? 'NOT AVAILABLE RIGHT NOW' : 'NOBODY YET. BE THE FIRST!');
      else list.rows.slice(0, fits).forEach(function (r, i) {
        const y = top + i * rh, fs = Math.min(16, rh * 0.46), cy = y + (rh - 4) / 2 + 1;
        row(y, rh - 4, r.me);
        if (i < 3) { ctx.fillStyle = MEDAL[i]; cut(x + 8, cy - 11, 26, 22, 5); ctx.fill(); text(String(r.rank), x + 21, cy, 14, INK); ctx.fillStyle = INK; }
        else text(String(r.rank), x + 21, cy, fs * 0.9, SOFT);
        text(String(r.name).toUpperCase(), x + 44, cy, fit(String(r.name), fs, (w - 200) * 1.5), '#fff', 'left');
        text(r.pct + '%', x + w - 100, cy, fs * 0.8, r.pct >= 100 ? LIME : SOFT, 'right');
        text(Number(r.score).toLocaleString('en-US'), x + w - 10, cy, fs, CYAN, 'right');
      });
      const me = list.me, s = me ? 'YOU: #' + me.rank + ' OF ' + list.players + '   ' + Number(me.score).toLocaleString('en-US') : 'PLAY IT TO GET ON THE BOARD';
      text(s, W / 2, foot - 16, fit(s, 14, w), LIME);
      button(playerName().toUpperCase(), x, foot, w * 0.5 - 5, 48, rename, INDIGO, { ghost: true, icon: 'user', name: 'NAME' });
      button('PLAY', x + w * 0.5 + 5, foot, w * 0.5 - 5, 48, function () { const at = LEVELS.indexOf(list.lv); state = 'title'; playAt(at); }, PINK, { icon: 'play', hot: true });
      toastAt(t, sat + 84);
      return;
    }
    // the search box (a real text field, laid over this spot), and under it the ratings to filter by
    const sy = sat + 68, fy = sy + 48, fw = (w - 5 * 5) / 6, top = fy + 54, rh = 54, fits = Math.max(2, Math.floor((foot - 10 - top) / rh));
    ctx.fillStyle = INK; cut(x - 3, sy - 3, w + 6, 46, 9); ctx.fill(); ctx.fillStyle = 'rgba(16,10,40,0.96)'; cut(x, sy, w, 40, 8); ctx.fill(); ctx.strokeStyle = CYAN; ctx.lineWidth = 2; ctx.globalAlpha = 0.8; cut(x + 1, sy + 1, w - 2, 38, 8); ctx.stroke(); ctx.globalAlpha = 1;
    icon('search', x + 21, sy + 20, 15, CYAN);
    findBox(true, x + 38, sy + 2, w - 46, 36);
    button('ALL', x, fy, fw, 44, function () { list.tier = 0; list.page = 1; browse(); }, CYAN, { ghost: true, on: !list.tier, size: 13, name: 'RATING ALL' });
    C.TIERS.forEach(function (name, i) {
      const bx = x + (i + 1) * (fw + 5), on = list.tier === i + 1;
      button('', bx, fy, fw, 44, function () { list.tier = on ? 0 : i + 1; list.page = 1; browse(); }, TIER_COL[i], { ghost: true, on: on, name: 'RATING ' + name });
      ctx.globalAlpha = on || !list.tier ? 1 : 0.5; face(i + 1, bx + fw / 2, fy + 22, 26); ctx.globalAlpha = 1;
    });
    if (list.per !== fits) { list.per = fits; if (list.asked !== fits) { list.page = 1; browse(); } }
    if (!list.rows) empty(top + 40, 'LOADING...');
    else if (!list.rows.length) empty(top + 40, list.fail ? 'NOT AVAILABLE RIGHT NOW' : list.q || list.tier ? 'NO LEVEL LIKE THAT. TRY ANOTHER.' : 'NO LEVELS YET. BUILD THE FIRST!');
    else list.rows.slice(0, fits).forEach(function (r, i) {
      const y = top + i * rh, cy = y + (rh - 6) / 2, d = r.difficulty && r.difficulty.level ? r.difficulty : null, nm = String(r.name).toUpperCase(), by = 'by ' + r.author + (d ? '  ·  ' + d.tier : '');
      row(y, rh - 6, false);
      if (d) face(d.level, x + 26, cy, 30);
      text(nm, x + (d ? 52 : 12), cy - 9, fit(nm, 15, (w - 150) * 1.5), '#fff', 'left');
      text(by, x + (d ? 52 : 12), cy + 11, fit(by, 11, (w - 150) * 1.5), d ? TIER_COL[d.level - 1] : SOFT, 'left');
      text(Number(r.plays).toLocaleString('en-US'), x + w - 28, cy - 9, 14, CYAN, 'right'); icon('play', x + w - 16, cy - 9, 9, CYAN);
      text(String(r.hearts || 0), x + w - 28, cy + 11, 12, '#ff8fa3', 'right'); icon('heart', x + w - 16, cy + 11, 10, RED);
      hits.push({ x: x, y: y, w: w, h: rh - 6, fn: function () { fetchLevel(r.id); }, label: 'LEVEL ' + nm });
    });
    // along the bottom, in reach of a thumb: the order, the pages, and how to build one
    const sw = w * 0.34, pw = w * 0.36, bw = w - sw - pw - 16, px = x + sw + 8;
    button(list.sort === 'top' ? 'MOST PLAYED' : 'NEWEST', x, foot, sw, 48, function () { list.sort = list.sort === 'top' ? 'new' : 'top'; list.page = 1; browse(); }, INDIGO, { ghost: true, size: 13, name: 'SORT' });
    if (list.page > 1) ibtn('left', px, foot, 44, function () { list.page--; browse(); }, CYAN, { name: 'PAGE BACK' });
    if (list.page < list.pages) ibtn('right', px + pw - 44, foot, 44, function () { list.page++; browse(); }, CYAN, { name: 'PAGE ON' });
    text(list.page + ' / ' + list.pages, px + pw / 2, foot + 18, 14, '#fff'); text(list.total + (list.total === 1 ? ' LEVEL' : ' LEVELS'), px + pw / 2, foot + 35, 10, SOFT);
    button('BUILD', x + w - bw, foot, bw, 48, openBuild, PINK, { icon: 'build', size: 14, name: 'BUILD ONE' });
    toastAt(t, top + 20);
  }

  // ---------- input ----------

  function press(dir) {
    flash = { dir: dir, t: performance.now() / 1000 };
    if (state === 'play') doTap(dir);
  }
  cv.tabIndex = -1; cv.style.outline = 'none';
  // the press is cancelled just below, and with it the focus a click would bring: inside a frame (the game in Claude)
  // the keys then never reach the page, so take the focus by hand
  function takeKeys() { try { window.focus(); if (document.activeElement !== cv) cv.focus({ preventScroll: true }); } catch (e) {} }
  cv.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    takeKeys();
    if (!MUTE) { A.init(); A.load(LF); }                           // start fetching his level's track on the first touch
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (e.clientX >= h.x && e.clientX <= h.x + h.w && e.clientY >= h.y && e.clientY <= h.y + h.h) { A.sfx('ui'); pressed = { x: e.clientX, y: e.clientY, t: performance.now() / 1000 }; h.fn(); return; }
    }
    if (state === 'select') drag = { x: e.clientX, s: selScroll, moved: false };
    else if (state === 'title') drag = { x: e.clientX, s: lvScroll, lv: true };   // the level cards swipe sideways
    else press(e.clientX < W / 2 ? -1 : 1);
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (drag.lv) { lvScroll = Math.max(-0.3, Math.min(LEVELS.length + SOON - 0.7, drag.s - (e.clientX - drag.x) / (lvSpace || W))); return; }
    if (Math.abs(e.clientX - drag.x) > 8) drag.moved = true;
    const tm = performance.now() / 1000;
    if (drag.lt) drag.v = -(e.clientX - drag.lx) / selSpacing() / Math.max(0.008, tm - drag.lt);   // Franks per second
    drag.lx = e.clientX; drag.lt = tm;
    selScroll = Math.max(-0.4, Math.min(FRANKS.length - 0.6, drag.s - (e.clientX - drag.x) / selSpacing()));
  });
  function endDrag(e) {
    if (!drag) return;
    if (drag.lv) {                                                  // a swipe carries on to the next level; a tap on the level's card plays it
      const r = cardRect, tap = Math.abs(lvScroll - drag.s) < 0.02 && Math.abs(e.clientX - drag.x) < 8;
      lvTarget = Math.max(0, Math.min(LEVELS.length + SOON - 1, Math.round(lvScroll + (lvScroll - drag.s) * 0.8)));
      drag = null;
      if (tap && r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) { A.sfx('ui'); playAt(Math.round(lvScroll)); }
      return;
    }
    if (drag.moved) selTarget = Math.round(selScroll + (drag.v || 0) * 0.18);   // a flick carries on past a few Franks
    else {
      const off = (e.clientX - W / 2) / selSpacing();               // undo the spread the row is drawn with
      const i = Math.round(selScroll + (Math.abs(off) > 1.25 ? off / 1.25 : off * 0.8));
      if (i === Math.round(selScroll)) pick(i);
      else selTarget = i;
    }
    selTarget = Math.max(0, Math.min(FRANKS.length - 1, selTarget));
    drag = null;
  }
  cv.addEventListener('pointerup', endDrag);
  // iPhones only let sound start from the end of a touch, so wake the audio there too
  // (a finger's lift is its touchend: iPhones count that, not the pointerup before it, as the person's own press)
  ['pointerup', 'touchend', 'click'].forEach(function (n) {
    window.addEventListener(n, function (e) {
      if (!MUTE) A.init();
      if (onLift && !(n === 'pointerup' && e.pointerType === 'touch')) { const f = onLift; onLift = null; f(); }
    }, { passive: true });
  });
  // a trackpad swipe or a mouse wheel turns the row of Franks too
  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (state !== 'select') return;
    if (!MUTE) A.init();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    selScroll = Math.max(-0.4, Math.min(FRANKS.length - 0.6, selScroll + d / selSpacing() * 0.7));
    selTarget = Math.max(0, Math.min(FRANKS.length - 1, Math.round(selScroll)));
  }, { passive: false });
  // a tap in the hand: phones that vibrate do; iPhones do not, but they give a haptic tick when a switch is flipped
  function haptic() {
    if (!SET.buzz) return;
    if (navigator.vibrate) navigator.vibrate(5);
    else { const h = document.getElementById('hap'); if (h) h.click(); }
  }
  cv.addEventListener('pointercancel', function () { if (drag) { selTarget = Math.max(0, Math.min(FRANKS.length - 1, Math.round(selScroll))); drag = null; } });
  window.addEventListener('keydown', function (e) {
    if (Acct.isOpen() || document.getElementById('clipbox') || (e.target && e.target.tagName === 'INPUT')) return;   // (typing in the account sheet or the search box is not playing)
    if (/^(Arrow(Left|Right|Up|Down)| )$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();   // the game's keys never scroll the page (or the chat) around it
    if (e.repeat) return;
    if (!MUTE) A.init();
    if (state === 'intro') return;                                  // only its SKIP button leaves the story
    if (state === 'howto') { if (e.key === 'Enter' || e.key === ' ') howtoPlay(); return; }
    if (state === 'settings') { if (e.key === 'Escape') state = setBack; return; }
    if (state === 'board' || state === 'profile' || state === 'unlock') { if (e.key === 'Escape') state = 'title'; return; }
    if (state === 'wall') { if (e.key === 'Escape') toLevels(); else if (e.key === 'Enter' || e.key === ' ') begin(0); return; }
    if (state === 'title') {
      if ((e.key === 'Enter' || e.key === ' ') && lvTarget < LEVELS.length) playAt(lvTarget);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') lvTarget = Math.max(0, Math.min(LEVELS.length + SOON - 1, lvTarget + (e.key === 'ArrowLeft' ? -1 : 1)));
      return;
    }
    const dir = e.key === 'ArrowLeft' || e.key === 'a' ? -1 : e.key === 'ArrowRight' || e.key === 'd' ? 1 : 0;
    if (e.key === 'Escape' || e.key === 'p') { if (state === 'play') pause(); else if (state === 'paused') resume(); }
    else if (state === 'select') {
      if (dir) selTarget = Math.max(0, Math.min(FRANKS.length - 1, selTarget + dir));
      else if (e.key === 'Enter' || e.key === ' ') pick(selTarget);
    } else if (state === 'win' || state === 'paused') { if (e.key === 'Enter' || e.key === ' ') { if (state === 'paused') resume(); else begin(0); } }
    else if (dir || e.key === ' ') press(dir || 1);
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); });

  // ---------- drawing ----------

  function text(str, x, y, size, color, align) {
    ctx.font = 'bold ' + Math.round(size) + 'px "Courier New", monospace';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(str, x + Math.max(1, size * 0.08), y + Math.max(1, size * 0.08));
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }
  function fit(str, size, room) { return Math.min(size, (room || W * 0.92) / (str.length * 0.62)); }

  // ---------- the look of every screen: one neon arcade kit ----------
  // Dark glass panels with a cut corner and a lit edge, slab buttons that sink under the finger, words in neon for
  // the big moments, and icons drawn here in blocks (no emoji, no pictures). The type scale: 44 hero, 30 title,
  // 22 head, 15 body, 13 small, 11 tiny. Nothing on a dark ground is darker than #999.
  const FONT = '"Courier New", monospace', INK = '#0a0812', PINK = '#ff4fd8', CYAN = '#35e8ff', LIME = '#a6ff3d', SOFT = '#b9b4d0', TEAL = '#23a5a5', INDIGO = '#3b3f8f', AMBER = '#e0a100', SLATE = '#3a3550', RED = '#ff4f6d';
  const ease = function (x) { x = Math.max(0, Math.min(1, x)); return 1 - (1 - x) * (1 - x) * (1 - x); };
  const back = function (x) { x = Math.max(0, Math.min(1, x)); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };   // past its place and back
  // words in neon: a dark edge, a halo of their own colour, the letters bright
  // (A halo is the one costly thing to draw, so each piece of neon is drawn once, into a small picture of its own,
  // and that is what goes on the screen every frame after.)
  let neons = {}, neonN = 0;
  function neon(str, x, y, size, color, align, halo) {
    size = Math.round(size); halo = halo === undefined ? size * 0.5 : halo;
    const key = str + '|' + size + '|' + color + '|' + halo + '|' + dpr;
    let s = neons[key];
    if (!s) {
      if (neonN++ > 160) { neons = {}; neonN = 0; }
      const c = document.createElement('canvas'), g = c.getContext('2d'), font = 'bold ' + size + 'px ' + FONT;
      g.font = font;
      const tw = Math.ceil(g.measureText(str).width), pad = Math.ceil(halo * 1.6 + size * 0.3 + 4);
      c.width = Math.ceil((tw + pad * 2) * dpr); c.height = Math.ceil((size * 1.3 + pad * 2) * dpr);
      g.scale(dpr, dpr); g.font = font; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const cy = pad + size * 0.65;
      g.lineWidth = Math.max(3, size * 0.2); g.strokeStyle = 'rgba(8,4,20,0.92)'; g.strokeText(str, pad, cy + Math.max(1, size * 0.06));
      g.shadowColor = color; g.shadowBlur = halo * dpr; g.fillStyle = color; g.fillText(str, pad, cy);
      g.shadowBlur = 0; g.globalAlpha = 0.5; g.fillStyle = '#ffffff'; g.fillText(str, pad, cy - Math.max(1, size * 0.03));
      s = neons[key] = { c: c, tw: tw, pad: pad, cy: cy, w: c.width / dpr, h: c.height / dpr };
    }
    const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.c, x - s.pad - (align === 'left' ? 0 : align === 'right' ? s.tw : s.tw / 2), y - s.cy, s.w, s.h);
    ctx.imageSmoothingEnabled = smooth;
  }
  // a box with its top left and bottom right corners cut off
  function cut(x, y, w, h, c) { c = Math.max(0, Math.min(c, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath(); }
  // a pane of dark glass with an edge lit in col (o: cut, glow, edge, top, bot = its two shades)
  function panel(x, y, w, h, col, o) {
    o = o || {}; const c = o.cut === undefined ? 12 : o.cut;
    if (o.glow !== 0) { ctx.globalAlpha = 0.14 * (o.glow || 1); ctx.fillStyle = col; cut(x - 6, y - 6, w + 12, h + 12, c + 5); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = INK; cut(x - 3, y - 3, w + 6, h + 6, c + 2); ctx.fill();
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, o.top || 'rgba(38,26,84,0.96)'); g.addColorStop(1, o.bot || 'rgba(14,9,36,0.97)');
    ctx.fillStyle = g; cut(x, y, w, h, c); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = o.edge === undefined ? 0.85 : o.edge; cut(x + 1, y + 1, w - 2, h - 2, c); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + c + 2, y + 3, Math.max(0, w - c - 6), 2);
  }
  // A button: a slab of its colour standing proud of the screen; under the finger it sinks. o.ghost: dark glass with
  // the colour on its edge and words (the quieter choices); o.hot: it glows and breathes (the one thing to press);
  // o.icon: an icon before the words (or alone); o.name: what the tests know it by, when it has no words.
  let pressed = null;
  function button(label, x, y, w, h, fn, col, o) {
    o = o || {}; col = col || PINK;
    const now = performance.now() / 1000, dn = pressed && now - pressed.t < 0.16 && pressed.x >= x && pressed.x <= x + w && pressed.y >= y && pressed.y <= y + h, hex = col[0] === '#';
    const c = Math.min(10, h * 0.2), up = o.ghost || !hex ? 0 : Math.min(4, h * 0.09), yy = y + (dn ? up + 1 : 0);
    if (o.hot) { ctx.globalAlpha = 0.2 + 0.1 * Math.sin(now * 4.2); ctx.fillStyle = col; cut(x - 7, y - 7, w + 14, h + 14 + up, c + 6); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = INK; cut(x - 3, y - 3, w + 6, h + 6 + up, c + 2); ctx.fill();
    if (o.ghost || !hex) {
      ctx.fillStyle = hex ? 'rgba(20,13,46,0.92)' : col; cut(x, yy, w, h, c); ctx.fill();
      if (hex) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = dn ? 1 : 0.8; cut(x + 1, yy + 1, w - 2, h - 2, c); ctx.stroke(); ctx.globalAlpha = 1; if (o.on) { ctx.globalAlpha = 0.22; ctx.fillStyle = col; cut(x, yy, w, h, c); ctx.fill(); ctx.globalAlpha = 1; } }
    } else {
      if (!dn) { ctx.fillStyle = shade(col, 0.5); cut(x, y + up, w, h, c); ctx.fill(); }
      const g = ctx.createLinearGradient(0, yy, 0, yy + h); g.addColorStop(0, shade(col, 1.22)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, 0.8));
      ctx.fillStyle = g; cut(x, yy, w, h, c); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x + c + 1, yy + 2, Math.max(0, w - c - 5), 2);
    }
    if (dn) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; cut(x, yy, w, h, c); ctx.fill(); }
    const ink = o.ghost && hex ? (o.ink || '#fff') : '#fff', is = Math.min(h * 0.5, 24), room = w * 0.88 - (o.icon && label ? is + 8 : 0), fs = label ? fit(label, Math.min(o.size || h * 0.4, 24), room) : 0, tw = label ? label.length * fs * 0.6 : 0;
    const x0 = x + w / 2 - (tw + (o.icon && label ? is + 8 : 0)) / 2;   // where the icon and the words start, centred together
    if (o.icon) icon(o.icon, label ? x0 + is / 2 : x + w / 2, yy + h / 2, is, o.ghost && hex ? (o.ink || col) : '#fff');
    if (label) text(label, x0 + (o.icon ? is + 8 : 0) + tw / 2, yy + h * 0.5, fs, ink);
    hits.push({ x: x, y: y, w: w, h: h, fn: fn, label: o.name || label });
  }
  // the icons: each drawn in blocks about its centre, s across
  function icon(name, cx, cy, s, col) {
    const u = s / 12, R = function (x, y, w, h, c) { ctx.fillStyle = c || col; ctx.fillRect(Math.round(cx + x * u), Math.round(cy + y * u), Math.ceil(w * u), Math.ceil(h * u)); };
    const P = function (pts, c) { ctx.fillStyle = c || col; ctx.beginPath(); pts.forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](cx + p[0] * u, cy + p[1] * u); }); ctx.closePath(); ctx.fill(); };
    if (name === 'gear') { for (let i = 0; i < 3; i++) { R(-6, -4.5 + i * 4, 12, 1.4); R([-3, 2.5, -0.5][i], -6 + i * 4, 2.4, 4.4); } }
    else if (name === 'back') { P([[-6, 0], [0, -6], [0, -2.2], [6, -2.2], [6, 2.2], [0, 2.2], [0, 6]]); }
    else if (name === 'next') { P([[6, 0], [0, -6], [0, -2.2], [-6, -2.2], [-6, 2.2], [0, 2.2], [0, 6]]); }
    else if (name === 'left') { P([[-4.5, 0], [3.5, -6.5], [3.5, 6.5]]); }
    else if (name === 'right') { P([[4.5, 0], [-3.5, -6.5], [-3.5, 6.5]]); }
    else if (name === 'play') { P([[5.5, 0], [-4, -6], [-4, 6]]); }
    else if (name === 'pause') { R(-4.5, -5.5, 3.4, 11); R(1.1, -5.5, 3.4, 11); }
    else if (name === 'heart') { R(-5, -5, 4, 2); R(1, -5, 4, 2); R(-6, -3, 12, 4); R(-5, 1, 10, 2); R(-3, 3, 6, 2); R(-1, 5, 2, 1.6); }
    else if (name === 'trophy') { R(-4, -6, 8, 6); R(-6.4, -5, 2.4, 3.4); R(4, -5, 2.4, 3.4); R(-2.6, 0, 5.2, 1.6); R(-1, 1.6, 2, 2.6); R(-3.6, 4.2, 7.2, 1.8); }
    else if (name === 'share') { P([[0, -6.5], [4, -2.4], [1.2, -2.4], [1.2, 2], [-1.2, 2], [-1.2, -2.4], [-4, -2.4]]); R(-5.6, -0.6, 2, 6.6); R(3.6, -0.6, 2, 6.6); R(-5.6, 4.4, 11.2, 1.8); }
    else if (name === 'lock') { R(-3.4, -6, 6.8, 1.8); R(-3.4, -6, 1.8, 5); R(1.6, -6, 1.8, 5); R(-5, -1.4, 10, 7.4); R(-0.8, 0.8, 1.6, 3, INK); }
    else if (name === 'user') { R(-2.6, -6, 5.2, 5.2); R(-5.4, 0.6, 10.8, 5.4); }
    else if (name === 'note') { R(-3.6, -6, 7.6, 2); R(-3.6, -6, 1.8, 9); R(2.2, -6, 1.8, 8); R(-5.6, 1.6, 3.8, 3.4); R(0.2, 0.6, 3.8, 3.4); }
    else if (name === 'sfx') { R(-6, -2.2, 3, 4.4); P([[-3, -2.2], [1, -5.6], [1, 5.6], [-3, 2.2]]); R(2.6, -2.6, 1.4, 5.2); R(4.8, -4.6, 1.4, 9.2); }
    else if (name === 'buzz') { R(-2.8, -6, 5.6, 12); R(-1.6, -4.4, 3.2, 7, INK); R(-5.6, -3, 1.4, 6); R(4.2, -3, 1.4, 6); }
    else if (name === 'star') { ctx.fillStyle = col; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = u * (i % 2 ? 2.8 : 6.4); ctx[i ? 'lineTo' : 'moveTo'](cx + Math.sin(a) * r, cy - Math.cos(a) * r); } ctx.closePath(); ctx.fill(); }
    else if (name === 'check') { P([[-6, 0.4], [-3.6, -2], [-1.4, 0.4], [4, -5.4], [6.2, -3], [-1.4, 5]]); }
    else if (name === 'x') { P([[-5.6, -3.8], [-3.8, -5.6], [0, -1.8], [3.8, -5.6], [5.6, -3.8], [1.8, 0], [5.6, 3.8], [3.8, 5.6], [0, 1.8], [-3.8, 5.6], [-5.6, 3.8], [-1.8, 0]]); }
    else if (name === 'search') { ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, u * 1.8); ctx.beginPath(); ctx.arc(cx - u * 1.2, cy - u * 1.2, u * 3.6, 0, 7); ctx.stroke(); P([[1.2, 2.6], [2.6, 1.2], [6.4, 5], [5, 6.4]]); }
    else if (name === 'build') { R(-6, 1, 5.4, 5); R(0.6, 1, 5.4, 5); R(-2.7, -5.6, 5.4, 5); }
    else if (name === 'grid') { R(-6, -6, 5.2, 5.2); R(0.8, -6, 5.2, 5.2); R(-6, 0.8, 5.2, 5.2); R(0.8, 0.8, 5.2, 5.2); }
    else if (name === 'again') { ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, u * 1.9); ctx.beginPath(); ctx.arc(cx, cy, u * 4.4, -0.3, 4.4); ctx.stroke(); P([[1.4, -7], [6.6, -3.2], [0.6, -1.2]]); }
    else if (name === 'help') { R(-3.4, -6, 6.8, 2); R(1.6, -6, 1.8, 5); R(-0.9, -1, 4.3, 1.8); R(-0.9, -1, 1.8, 3.2); R(-0.9, 4, 1.8, 2); R(-3.4, -6, 1.8, 3); }
    else if (name === 'film') { R(-6, -4, 9, 8); P([[3, -1.4], [6.4, -4], [6.4, 4], [3, 1.4]]); }
    else if (name === 'coin') { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx, cy, u * 6.4, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, u * 5.2, 0, 7); ctx.fill(); R(-2.2, -3.2, 1.6, 3.4, 'rgba(255,255,255,0.5)'); }
    else if (name === 'up') { P([[0, -5], [6, 2.5], [-6, 2.5]]); }
  }
  // a square button that is only an icon
  function ibtn(name, x, y, s, fn, col, o) { button('', x, y, s, s, fn, col || INDIGO, Object.assign({ ghost: true, icon: name, name: name }, o || {})); }
  // a small label on a plate (NEW, a price, OWNED): returns its width
  function chip(label, x, y, h, col, ink) {
    const fs = Math.min(15, h * 0.56), w = Math.ceil(label.length * fs * 0.62 + h * 0.7);
    ctx.fillStyle = INK; cut(x - 2, y - 2, w + 4, h + 4, 6); ctx.fill(); ctx.fillStyle = col; cut(x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x + 6, y + 2, w - 9, 2);
    ctx.font = 'bold ' + Math.round(fs) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink || INK; ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    return w;
  }
  // a line that comes and goes (LOADING..., LINK COPIED): a plate of dark glass, never bare words over the picture
  function toastAt(t, cy, life) {
    if (!note || t - note.t > (life || 3.4)) return;
    const a = Math.min(1, (t - note.t) / 0.15, ((life || 3.4) - (t - note.t)) / 0.3), fs = fit(note.s, 14, W - 60), w = note.s.length * fs * 0.62 + 30, pop = back((t - note.t) / 0.25);
    ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(W / 2, cy); ctx.scale(pop, pop);
    panel(-w / 2, -16, w, 32, LIME, { cut: 8, glow: 1.4 }); text(note.s, 0, 1, fs, LIME);
    ctx.restore();
  }

  // ---------- how hard a level is: its rating (core.js: five tiers, each with a colour and a face) ----------
  const TIER_COL = ['#5dff8f', '#35e8ff', '#ffd23f', '#ff6a3c', '#d43dff'];
  function ratingOf(lv) { return lv.difficulty && lv.difficulty.level ? lv.difficulty : lv.made ? C.rate(lv.made) : lv.sections ? C.rate(lv) : C.tier(C.RATED[lv.id] || 1); }
  // the face of a tier: happier the easier, horns on the worst
  function face(level, cx, cy, s) {
    const col = TIER_COL[level - 1] || TIER_COL[0], u = s / 12, R = function (x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(cx + x * u, cy + y * u, w * u, h * u); };
    const T = function (a, b, c, col2) { ctx.fillStyle = col2; ctx.beginPath(); ctx.moveTo(cx + a[0] * u, cy + a[1] * u); ctx.lineTo(cx + b[0] * u, cy + b[1] * u); ctx.lineTo(cx + c[0] * u, cy + c[1] * u); ctx.closePath(); ctx.fill(); };
    if (level >= 5) { T([-6.6, -5], [-5.4, -9.6], [-2.2, -5.6], INK); T([6.6, -5], [5.4, -9.6], [2.2, -5.6], INK); T([-5.6, -5.4], [-5, -8], [-3.2, -5.6], '#ff3d5a'); T([5.6, -5.4], [5, -8], [3.2, -5.6], '#ff3d5a'); }
    R(-6.8, -6.8, 13.6, 13.6, INK); R(-6, -6, 12, 12, col); R(-6, -6, 12, 1.6, shade(col, 1.45)); R(-6, 4.2, 12, 1.8, shade(col, 0.68)); R(4.4, -6, 1.6, 12, shade(col, 0.78));
    const eye = level >= 5 ? '#ff3d5a' : '#ffffff';
    R(-4.2, -2.8, 3.2, 3.4, INK); R(1, -2.8, 3.2, 3.4, INK); R(-3.6, -2.2, 2, 2.2, eye); R(1.6, -2.2, 2, 2.2, eye);
    if (level < 5) { R(-2.8, -1.4, 1, 1.4, INK); R(2.4, -1.4, 1, 1.4, INK); }
    if (level >= 3) { T([-4.8, -4.6], [-0.6, -2.8], [-4.8, -(level >= 4 ? 2.2 : 3.2)], INK); T([4.8, -4.6], [0.6, -2.8], [4.8, -(level >= 4 ? 2.2 : 3.2)], INK); }
    if (level === 1) { R(-3, 1.6, 6, 1.4, INK); R(-3, 1.6, 1.2, -1.2, INK); R(1.8, 1.6, 1.2, -1.2, INK); R(-2, 3, 4, 1, INK); }          // a grin
    else if (level === 2) { R(-2.6, 2, 5.2, 1.4, INK); R(1.6, 1, 1.2, 1, INK); }                                                    // a smirk
    else if (level === 3) { R(-2.6, 2, 5.2, 1.4, INK); }                                                                              // a straight face
    else if (level === 4) { R(-3, 1.4, 6, 2.6, INK); R(-2.2, 1.4, 1.2, 1.1, '#fff'); R(-0.6, 1.4, 1.2, 1.1, '#fff'); R(1, 1.4, 1.2, 1.1, '#fff'); }   // gritted teeth
    else { R(-3.2, 1.2, 6.4, 3, INK); T([-2.6, 1.2], [-1.6, 3.4], [-0.6, 1.2], '#fff'); T([0.6, 1.2], [1.6, 3.4], [2.6, 1.2], '#fff'); }               // fangs
  }
  // a level's rating as a badge: the face, the tier's name, and five pips. Returns how wide it was. (o.plain: no plate)
  function rating(d, x, y, h, o) {
    const col = TIER_COL[d.level - 1], fs = Math.min(16, h * 0.42), w = Math.ceil(h + 10 + Math.max(d.tier.length * fs * 0.62, 5 * (h * 0.2 + 2)) + 10);
    if (!(o && o.plain)) { ctx.fillStyle = 'rgba(8,4,20,0.82)'; cut(x - 2, y - 2, w + 4, h + 4, 8); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.9; cut(x - 1, y - 1, w + 2, h + 2, 8); ctx.stroke(); ctx.globalAlpha = 1; }
    face(d.level, x + h / 2 + 2, y + h / 2, h * 0.74);
    text(d.tier, x + h + 8, y + h * 0.34, fs, col, 'left');
    for (let i = 0; i < d.of; i++) { ctx.fillStyle = i < d.level ? col : 'rgba(255,255,255,0.22)'; ctx.fillRect(x + h + 8 + i * (h * 0.2 + 2), y + h * 0.66, h * 0.2, Math.max(3, h * 0.14)); }
    return w;
  }

  // Frank, drawn around his centre with his head up; u = one cube
  function drawBody(u, f, t, floatie) {
    const R = function (c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x * u, y * u, w * u, h * u); };
    const ex = f.extra, o = Math.max(2, Math.round(u * 0.07)) / u;
    if (ex.indexOf('ghost') >= 0) ctx.globalAlpha *= 0.72;
    if (ex.indexOf('bun') >= 0) { R('#0a0812', -0.8, -1.42, 1.6, 2.84); R('#e0a85a', -0.74, -1.36, 0.3, 2.72); R('#e0a85a', 0.44, -1.36, 0.3, 2.72); }
    // arms flap in the fall
    R(f.head, -0.74, -0.42 + Math.sin(t * 19) * 0.12, 0.26, 0.17);
    R(f.head, 0.48, -0.42 + Math.cos(t * 17) * 0.12, 0.26, 0.17);
    const flap = function (i) { return Math.abs(Math.sin(t * 15 + i * 2)) * 0.12; };
    if (f.hat === 'tuft') for (let i = 0; i < 3; i++) R(f.hair, -0.4 + i * 0.3, -1.72 - flap(i), 0.18, 0.3);
    else if (f.hat === 'mohawk') for (let i = 0; i < 3; i++) R(f.hair, -0.3 + i * 0.2, -1.95 - flap(i) - (i === 1 ? 0.12 : 0), 0.2, 0.5);
    else if (f.hat === 'afro') { R('#0a0812', -0.82, -2.1, 1.64, 1.05); R(f.hair, -0.76, -2.04, 1.52, 0.6); R(f.hair, -0.76, -1.5, 0.24, 0.42); R(f.hair, 0.52, -1.5, 0.24, 0.42); }
    else if (f.hat === 'tophat') { R(f.hair, -0.4, -2.2, 0.8, 0.7); R('#c0392b', -0.4, -1.72, 0.8, 0.12); R(f.hair, -0.68, -1.6, 1.36, 0.13); }
    else if (f.hat === 'chef') { R('#0a0812', -0.6, -2.36, 1.2, 0.9); R(f.hair, -0.38, -2.1, 0.76, 0.62); R(f.hair, -0.54, -2.3, 1.08, 0.34); }
    else if (f.hat === 'cowboy') { R(f.hair, -0.42, -2.02, 0.84, 0.46); R(shade(f.hair, 0.7), -0.42, -1.72, 0.84, 0.1); R(f.hair, -0.88, -1.62, 1.76, 0.14); }
    else if (f.hat === 'wizard') { R(f.hair, -0.1, -2.56, 0.2, 0.3); R(f.hair, -0.25, -2.28, 0.5, 0.32); R(f.hair, -0.4, -1.98, 0.8, 0.38); R(f.hair, -0.64, -1.64, 1.28, 0.15); R('#ffd23f', -0.08, -2.0, 0.16, 0.16); }
    else if (f.hat === 'crown') { for (let i = 0; i < 3; i++) R(f.hair, -0.5 + i * 0.4, -1.96, 0.2, 0.26); R(f.hair, -0.5, -1.74, 1, 0.26); R('#ff4f6d', -0.08, -1.7, 0.16, 0.14); }
    else if (f.hat === 'antenna') { R('#5d6675', -0.04, -1.98, 0.08, 0.5); R(f.hair, -0.12, -2.12, 0.24, 0.2); }
    else if (f.hat === 'band') { R(f.hair, 0.5, -1.4 - flap(0), 0.34, 0.1); R(f.hair, 0.5, -1.26 - flap(1), 0.26, 0.1); }
    ctx.fillStyle = '#0a0812'; ctx.fillRect((-0.5 - o) * u, (-1.5 - o) * u, (1 + 2 * o) * u, (3 + 2 * o) * u);
    const cubes = [f.head, f.torso, f.legs];
    for (let i = 0; i < 3; i++) {
      const y = -1.5 + i;
      R(cubes[i], -0.5, y, 1, 1);
      R(shade(cubes[i], 1.4), -0.5, y, 1, 0.14);
      R(shade(cubes[i], 0.7), 0.36, y, 0.14, 1); R(shade(cubes[i], 0.7), -0.5, y + 0.9, 1, 0.1);
    }
    if (ex.indexOf('grain') >= 0) for (let i = 0; i < 5; i++) R('rgba(60,30,10,0.35)', -0.4 + (i % 2) * 0.2, -1.2 + i * 0.55, 0.6, 0.05);
    if (ex.indexOf('mustard') >= 0) for (let i = 0; i < 6; i++) R('#ffd23f', i % 2 ? -0.02 : -0.16, -0.5 + i * 0.3, 0.18, 0.3);
    if (f.hat === 'tuft' || f.hat === 'flat') R(f.hair, -0.5, -1.5, 1, f.hat === 'flat' ? 0.24 : 0.14);
    else if (f.hat === 'helmet') { R('#0a0812', -0.62, -1.68, 1.24, 0.5); R(f.hair, -0.58, -1.64, 1.16, 0.42); }
    else if (f.hat === 'beanie') { R(f.hair, -0.54, -1.66, 1.08, 0.36); R(f.torso, -0.14, -1.9, 0.28, 0.24); }
    else if (f.hat === 'band') R(f.hair, -0.52, -1.42, 1.04, 0.14);
    if (ex.indexOf('visor') >= 0) { R('#12233f', -0.4, -1.3, 0.8, 0.4); R('#7fe9ff', -0.3, -1.24, 0.22, 0.08); }
    else {
      const blank = ex.indexOf('blank') >= 0;
      if (!blank) { R('#fff', -0.34, -1.24, 0.26, 0.28); R('#fff', 0.04, -1.24, 0.26, 0.28); }
      R('#0a0812', -0.26, -1.1, 0.12, 0.14); R('#0a0812', 0.12, -1.1, 0.12, 0.14);
      if (ex.indexOf('patch') >= 0) { R('#0a0812', -0.38, -1.28, 0.34, 0.34); R('#0a0812', -0.5, -1.3, 1, 0.06); }
    }
    if (ex.indexOf('blank') < 0) R('#0a0812', -0.17, -0.84, 0.34, 0.16 + Math.abs(Math.sin(t * 9)) * 0.08);
    if (ex.indexOf('nose') >= 0) R('#ff3d3d', -0.12, -1.02, 0.24, 0.2);
    if (ex.indexOf('bolts') >= 0) { R('#9aa3ad', -0.68, -1.05, 0.18, 0.2); R('#9aa3ad', 0.5, -1.05, 0.18, 0.2); }
    if (ex.indexOf('tie') === 0) { R('#f4f4f4', -0.2, -0.5, 0.4, 0.3); R('#c0392b', -0.08, -0.46, 0.16, 0.7); }
    if (ex.indexOf('bowtie') >= 0) { R('#c0392b', -0.24, -0.46, 0.48, 0.18); R('#15151f', -0.06, -0.2, 0.12, 0.5); }
    if (ex.indexOf('flies') >= 0) for (let i = 0; i < 3; i++) R('#1b1b1b', Math.cos(t * 5 + i * 2.1) * 0.9 - 0.05, -1.3 + Math.sin(t * 7 + i * 2.1) * 0.6 + i * 0.4, 0.1, 0.1);
    if (floatie) {                                                  // the duck ring he rides through the slime
      R('#0a0812', -0.86, -0.16, 1.72, 0.5); R('#ff7ac8', -0.8, -0.1, 1.6, 0.38);
      R('#fff', -0.5, -0.1, 0.16, 0.38); R('#fff', 0.3, -0.1, 0.16, 0.38);
      R('#ffd23f', 0.72, -0.46, 0.34, 0.4); R('#ff7b00', 1.06, -0.3, 0.16, 0.12); R('#0a0812', 0.9, -0.38, 0.08, 0.08);
    }
  }

  // a level's token, centred on x,y; s = its radius
  function drawToken(f, x, y, s, t) {
    const sh = f.tokenShape, col = f.tokenColor, spin = sh === 'coin' || sh === 'ring' || sh === 'bill' ? Math.max(0.25, Math.abs(Math.cos(t * 4))) : 1;
    const path = function (k) {
      ctx.beginPath();
      if (sh === 'coin' || sh === 'ring') ctx.ellipse(x, y, s * k * spin, s * k, 0, 0, 7);
      else if (sh === 'bill') ctx.rect(x - s * 1.25 * k * spin, y - s * 0.75 * k, s * 2.5 * k * spin, s * 1.5 * k);
      else if (sh === 'gem') { ctx.moveTo(x, y - s * 1.15 * k); ctx.lineTo(x + s * 0.85 * k, y); ctx.lineTo(x, y + s * 1.15 * k); ctx.lineTo(x - s * 0.85 * k, y); }
      else if (sh === 'bolt') { [[0.3, -1.2], [-0.7, 0.15], [-0.05, 0.15], [-0.3, 1.2], [0.7, -0.2], [0.05, -0.2]].forEach(function (p, i) { ctx[i ? 'lineTo' : 'moveTo'](x + p[0] * s * k, y + p[1] * s * k); }); }
      else for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 + t * 2, r = s * k * (i % 2 ? 0.5 : 1.2); ctx[i ? 'lineTo' : 'moveTo'](x + Math.sin(a) * r, y - Math.cos(a) * r); }
      ctx.closePath();
    };
    ctx.fillStyle = '#0a0812'; path(1.28); ctx.fill();
    ctx.fillStyle = col; path(1); ctx.fill();
    ctx.fillStyle = sh === 'ring' ? '#0a0812' : 'rgba(255,255,255,0.45)';
    if (sh === 'ring') { ctx.beginPath(); ctx.ellipse(x, y, s * 0.4 * spin, s * 0.4, 0, 0, 7); ctx.fill(); }
    else ctx.fillRect(x - s * 0.3 * spin, y - s * 0.5, s * 0.25 * spin, s * 0.5);
  }

  function drawBlock(x, y, w, T, topFace) {
    ctx.fillStyle = T.block; ctx.fillRect(x, y, w, cell + 1);
    ctx.fillStyle = topFace ? T.neon : T.top; ctx.fillRect(x, y, w, Math.ceil(cell * 0.16));
    ctx.fillStyle = T.side;
    ctx.fillRect(x, y + Math.floor(cell * 0.8), w, Math.ceil(cell * 0.2) + 1);
    ctx.fillRect(x + w - 2, y, 2, cell);
    // what the world's blocks are made of
    const p = T.pat, dots = function (list, col, sw, sh) { ctx.fillStyle = col; list.forEach(function (q) { ctx.fillRect(x + w * q[0], y + cell * q[1], Math.max(2, w * sw), Math.max(2, cell * sh)); }); };
    if (p === 'wood') { ctx.fillStyle = T.side; ctx.fillRect(x + w * 0.1, y + cell * 0.36, w * 0.7, 2); ctx.fillRect(x + w * 0.3, y + cell * 0.58, w * 0.55, 2); }
    else if (p === 'metal') dots([[0.14, 0.28], [0.74, 0.28], [0.14, 0.6], [0.74, 0.6]], T.top, 0.1, 0.1);
    else if (p === 'ice') dots([[0.15, 0.26], [0.36, 0.26]], 'rgba(255,255,255,0.4)', 0.1, 0.36);
    else if (p === 'gold') { dots([[0.15, 0.3]], T.top, 0.6, 0.12); dots([[0.15, 0.6]], T.side, 0.6, 0.08); }
    else if (p === 'stone') { ctx.fillStyle = T.side; ctx.fillRect(x + w * 0.55, y + cell * 0.2, 2, cell * 0.28); ctx.fillRect(x + w * 0.3, y + cell * 0.46, w * 0.27, 2); }
    else if (p === 'neon') { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 3, y + Math.ceil(cell * 0.16), w - 7, cell * 0.62); }
    else if (p === 'stripes') dots([[0.08, 0.18], [0.4, 0.18], [0.72, 0.18]], 'rgba(255,255,255,0.3)', 0.14, 0.6);
    else if (p === 'food') dots([[0.2, 0.3], [0.6, 0.4], [0.35, 0.62]], 'rgba(255,235,180,0.75)', 0.12, 0.07);
  }

  // what is behind him at the very top: how many rows of silhouette stand on the ground in each column
  function silHeight(type, c, t) {
    const h = hash(c, 99);
    if (type === 'buildings') return 2 + Math.floor(h * 7);
    if (type === 'trees') return h < 0.55 ? 3 + Math.floor(h * 10) : 0;
    if (type === 'mountains') return 2 + Math.round(4 * Math.abs(Math.sin(c * 0.45)) + h * 2);
    if (type === 'tents') return Math.max(0, Math.round(5 - Math.abs(((c % 7) + 7) % 7 - 3) * 1.6));
    if (type === 'pillars') return ((c % 3) + 3) % 3 === 0 ? 9 : 2;
    if (type === 'waves') return 1 + (Math.sin(c * 0.9 + t * 2) > 0 ? 1 : 0);
    if (type === 'fence') return ((c % 4) + 4) % 4 === 3 ? 0 : 3;
    return 0;
  }

  // the pattern in the background of his world, one cell at a time (h = that cell's own random number)
  function drawDecor(d, x, y, w, h, r, c, t, T) {
    const up = y + cell * (1 - (t * 0.9 + h * 40) % 1), down = y + cell * ((t * 0.7 + h * 40) % 1), sway = x + cell * 0.4 + Math.sin(t * 2 + r) * cell * 0.2;
    const sq = function (col, a, px, py, s) { ctx.fillStyle = col; ctx.globalAlpha = a; ctx.fillRect(px, py, s, s); ctx.globalAlpha = 1; };
    if (d === 'embers') { if (h > 0.9) sq(T.neon, 0.6, sway, up, cell * 0.12); }
    else if (d === 'bubbles') { if (h > 0.9) sq(T.neon, 0.3, sway, up, cell * (0.15 + h % 0.01 * 15)); }
    else if (d === 'snow') { if (h > 0.86) sq('#ffffff', 0.7, sway, down, cell * 0.1); }
    else if (d === 'stars') { if (h > 0.92) sq('#ffffff', 0.35 + 0.35 * Math.sin(t * 4 + h * 99), x + cell * 0.45, y + cell * 0.45, Math.max(2, cell * 0.08)); }
    else if (d === 'gears') {
      if (h > 0.95) { ctx.save(); ctx.translate(x + cell / 2, y + cell / 2); ctx.rotate(t * (h > 0.975 ? 1 : -1)); ctx.fillStyle = 'rgba(255,255,255,0.09)'; const s = cell * 0.42; ctx.fillRect(-s, -s / 3, s * 2, s / 1.5); ctx.fillRect(-s / 3, -s, s / 1.5, s * 2); ctx.restore(); }
    } else if (d === 'camo') { if (h < 0.25) sq('#000000', 0.18, x, y, cell + 1); else if (h > 0.8) sq('#ffffff', 0.05, x, y, cell + 1); }
    else if (d === 'confetti') { if (h > 0.84) sq(['#ff4f6d', '#ffe93d', '#35e8ff', '#a6ff3d'][Math.floor(h * 400) % 4], 0.7, sway, down, cell * 0.12); }
    else if (d === 'bars') { if (c % 2 === 0) sq('#ffffff', 0.035, x + w * 0.35, y, w * 0.3 + 1); if (c % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(x + w * 0.35, y, w * 0.3, cell + 1); } }
    else if (d === 'planks') { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, y + cell - 2, w, 2); if (h > 0.9) sq('#000000', 0.25, x + cell * 0.4, y + cell * 0.35, cell * 0.14); }
    else if (d === 'void') sq('#000000', 0.2, x, y, 2);
    else if (d === 'lights') { if (h > 0.9) sq('hsl(' + Math.floor((h * 3600 + t * 120) % 360) + ',90%,60%)', 0.25 + 0.25 * Math.sin(t * 6 + h * 50), x + cell * 0.3, y + cell * 0.3, cell * 0.4); }
    else if (d === 'tiles') { if ((r + c) % 2 === 0) sq('#ffffff', 0.045, x, y, cell + 1); }
    else if (d === 'wisps') { if (h > 0.94) { ctx.fillStyle = 'rgba(190,225,255,0.16)'; ctx.fillRect(x + Math.sin(t + r) * cell, y + cell * 0.3, cell * 1.3, cell * 0.35); } }
    else if (h < 0.08) sq('#ffffff', 0.04, x, y, cell + 1);          // bricks
    else if (h > 0.985) sq(T.neon, 0.5, x + cell * 0.4, y + cell * 0.4, cell * 0.2);
  }

  // a bonus room: nothing but gold walls and tokens
  function drawBonusRow(r, y, t) {
    const T = TH[run.bonus.look] || TH.bonus;                       // a hidden room may have a look of its own
    ctx.fillStyle = T.bg; ctx.fillRect(view.x0, y, view.x1 - view.x0, cell + 1);
    for (let c = view.c0; c <= view.c1; c++) {
      const x = Math.round((c - camX) * cell), w = Math.round((c + 1 - camX) * cell) - x, h = hash(r, c);
      if (c < 0 || c >= C.WIDE) drawBlock(x, y, w, T, false);
      else if (h > 0.93) { ctx.fillStyle = T.neon; ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 6 + h * 90); ctx.fillRect(x + cell * 0.4, y + cell * 0.4, cell * 0.2, cell * 0.2); ctx.globalAlpha = 1; }
    }
    const tk = run.bonus.rows.get(r);
    if (tk) for (let i = 0; i < tk.length; i++) if (!run.bgot[tk[i]]) drawToken(WF, (run.bonus.tokens[tk[i]].col + 0.5 - camX) * cell, y + cell * 0.5, cell * 0.3, t + r);
  }

  // the tap-count helpers ("1>") are training wheels: first section of the very first level only
  function helping(g) { return LV.id === 'city' && g.si <= 1; }

  function drawRow(r, y, t, windNow) {
    if (run.bonus) return drawBonusRow(r, y, t);
    // under the street it is already the first stretch of the fall, so it looks like it
    let sec = level.sectionAtRow(r);
    if (sec.theme === 'street' && r >= STREET_ROW + 2) sec = level.sections[1];
    const T = TH[sec.theme], sky = sec.theme === 'sky', above = sec.theme === 'street' && r < STREET_ROW, world = WF.w;
    const city = above && cityTop();                                // over ELM STREET the city is already painted behind (CITY): nothing of a row is drawn over it (there is nothing solid up there)
    if (!city) { ctx.fillStyle = sec.theme === 'street' && !above ? T.under : T.bg; ctx.fillRect(view.x0, y, view.x1 - view.x0, cell + 1); }
    const mask = level.solids.get(r) || 0, up = level.solids.get(r - 1) || 0, exr = extras.get(r);
    for (let c = city ? view.c1 + 1 : view.c0; c <= view.c1; c++) {
      const x = Math.round((c - camX) * cell), w = Math.round((c + 1 - camX) * cell) - x, h = hash(r, c);
      if (c < sec.lo || c >= sec.hi) {                              // wall
        ctx.fillStyle = T.wall; ctx.fillRect(x, y, w, cell + 1);
        ctx.fillStyle = T.wallDark; ctx.fillRect(x, y + cell - 2, w, 2); ctx.fillRect(x + ((r & 1) ? 0 : w >> 1), y, 2, cell);
        if (above && world.silType === 'buildings' && h < 0.4) { ctx.fillStyle = h < 0.2 ? '#ffd23f' : '#35e8ff'; ctx.fillRect(x + cell * 0.3, y + cell * 0.3, cell * 0.4, cell * 0.4); }
        if (c === sec.lo - 1 || c === sec.hi) {
          ctx.fillStyle = T.neon; ctx.globalAlpha = r % 4 === 0 ? 0.9 : 0.4;
          ctx.fillRect(c === sec.hi ? x : x + w - 2, y, 2, cell + 1);
          ctx.globalAlpha = 1;
        }
        if (exr && exr.crack && c === exr.crack.col) {              // a piece of wall that is not there: cracked, with light behind it
          ctx.fillStyle = '#0a0812'; ctx.fillRect(x + w * (0.3 + 0.3 * hash(r, 77)), y, Math.max(2, w * 0.1), cell + 1); ctx.fillRect(x + w * 0.15, y + cell * hash(r, 78), w * 0.5, Math.max(2, cell * 0.08));
          ctx.fillStyle = '#fff27a'; ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 5 + r); ctx.fillRect(x + w * (0.34 + 0.3 * hash(r, 77)), y + cell * 0.2, Math.max(1, w * 0.04), cell * 0.6); ctx.globalAlpha = 1;
        }
        continue;
      }
      if (above) {
        if (STREET_ROW - r <= silHeight(world.silType, c, t)) {             // his world's skyline behind the ground
          ctx.fillStyle = world.sil; ctx.fillRect(x, y, w, cell + 1);
          if (world.silType === 'buildings' && h < 0.4) { ctx.fillStyle = h < 0.2 ? '#ffd23f' : '#35e8ff'; ctx.fillRect(x + cell * 0.3, y + cell * 0.3, cell * 0.4, cell * 0.4); }
        } else if (h > 0.95) { ctx.fillStyle = '#fff'; ctx.fillRect(x + cell * h * 0.5, y + cell * 0.4, 2, 2); }
      } else if (sky) {
        if (h < 0.1) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x, y + cell * 0.3, cell * 2, cell * 0.5); }
      } else if (sec.theme !== 'street') {
        drawDecor(T.decor, x, y, w, h, r, c, t, T);
        if (sec.mode === 'slide' && h > 0.9 && h < 0.96) {          // slime bubbles
          ctx.fillStyle = T.neon; ctx.globalAlpha = 0.35;
          const s = cell * (0.15 + h % 0.01 * 20);
          ctx.fillRect(x + cell * 0.4 + Math.sin(t * 3 + r) * cell * 0.25, y + (cell * (1 - (t * 0.8 + h * 50) % 1)), s, s);
          ctx.globalAlpha = 1;
        }
      }
      if (mask >> c & 1) {
        drawBlock(x, y, w, T, !(up >> c & 1));
        if (level.posts[r + ':' + c]) {                             // a post: hazard stripes, "not yet"
          ctx.fillStyle = LF ? T.neon : '#ffd23f'; ctx.fillRect(x, y, w, cell);
          ctx.fillStyle = '#0a0812';
          for (let i = 0; i < 4; i++) ctx.fillRect(x + (i * 2 + ((r & 1) ? 1 : 0)) * w / 8, y + (i % 2) * cell / 2, w / 8 + 1, cell / 2);
          ctx.fillRect(x, y + cell - 3, w, 3);
        }
        if (sec.theme === 'street' && r === STREET_ROW && (c === C.START_COL - 1 || c === C.START_COL + 1)) {
          ctx.fillStyle = T.neon; ctx.fillRect(x + (c < C.START_COL ? cell * 0.8 : 0), y, cell * 0.2, cell);
        }
      }
    }
    const ex = extras.get(r);
    if (ex) {
      if (ex.blow) {                                                // a blower: a fan on the wall and its draught
        ctx.fillStyle = T.neon; ctx.globalAlpha = 0.5;
        const span = sec.hi - sec.lo + 3;
        for (let i = 0; i < 2; i++) {
          let x = (hash(r, 9 + i) * span + ex.blow * t * 22) % span;
          if (x < 0) x += span;
          ctx.fillRect((sec.lo + x - 3 - camX) * cell, y + cell * (0.25 + i * 0.45), cell * 2.2, Math.max(2, cell * 0.1));
        }
        ctx.globalAlpha = 1;
        const fx = ((ex.blow > 0 ? sec.lo - 1 : sec.hi) - camX) * cell;
        ctx.fillStyle = '#0a0812'; ctx.fillRect(fx, y, cell, cell + 1);
        ctx.fillStyle = T.neon; ctx.fillRect(fx + cell * 0.15, y + cell * (0.2 + 0.3 * Math.abs(Math.sin(t * 20 + r))), cell * 0.7, cell * 0.2);
      }
      if (ex.gate && helping(ex.gate)) {                            // how many taps, and which way
        const g = ex.gate, s = (g.dir > 0 ? '' : '<') + g.n + (g.dir > 0 ? '>' : '');
        ctx.globalAlpha = 0.9; text(s, (g.hole - camX) * cell, y - cell * 0.9, cell * 0.95, T.neon); ctx.globalAlpha = 1;
      }
      if (ex.spring !== undefined && !run.sprung[ex.spring]) {      // a spring: flings him sideways
        const sp = level.springs[ex.spring], x = (sp.col - camX) * cell, sq = 0.5 + 0.1 * Math.sin(t * 10);
        ctx.fillStyle = '#0a0812'; ctx.fillRect(x - 2, y + cell * 0.1 - 2, cell + 4, cell * 0.8 + 4);
        ctx.fillStyle = '#ff4f6d'; ctx.fillRect(x, y + cell * 0.1, cell, cell * 0.25);
        ctx.fillStyle = '#c9ccd6'; for (let i = 0; i < 3; i++) ctx.fillRect(x + cell * (0.15 + (i % 2) * 0.1), y + cell * (0.35 + i * 0.18 * sq * 2), cell * 0.6, cell * 0.08);
        text(sp.dir > 0 ? '>>' : '<<', x + cell * (0.5 + sp.dir * 1.3), y + cell * 0.5, cell * 0.8, '#ff4f6d');
      }
      if (ex.portal !== undefined && !run.entered[ex.portal] && !level.portals[ex.portal].secret) {     // a portal to a bonus room (a hidden room's way in does not look like one)
        const p = level.portals[ex.portal], x = (p.col + 0.5 - camX) * cell, cy = y + cell * 0.5;
        for (let i = 3; i >= 0; i--) {
          ctx.save(); ctx.translate(x, cy); ctx.rotate(t * (2 + i) * (i % 2 ? 1 : -1));
          ctx.fillStyle = ['#0a0812', '#fff27a', '#ff3df2', '#35e8ff'][i]; const s = cell * (0.25 + i * 0.16);
          ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore();
        }
        text('BONUS', x, y - cell * 0.75, cell * 0.5, '#fff27a');
      }
    }
    if (level.spec.defs) rowExtras(r, y, t, sec, T, ex, mask);
    if (sec.mode === 'wind' && hash(r, 7) < 0.7) {                  // wind streaks
      ctx.fillStyle = T.neon; ctx.globalAlpha = 0.3;
      const len = 1 + hash(r, 8) * 2.5, span = sec.hi - sec.lo + len;
      let x = (hash(r, 9) * span + windNow * t * 16) % span;
      if (x < 0) x += span;
      ctx.fillRect((sec.lo + x - len - camX) * cell, y + cell * 0.45, len * cell, Math.max(2, cell * 0.08));
      ctx.globalAlpha = 1;
    }
    const tk = tokRows.get(r);
    if (tk) for (let i = 0; i < tk.length; i++) if (!run.got[tk[i]]) {
      drawToken(WF, (level.tokens[tk[i]].col + 0.5 - camX) * cell, y + cell * (0.5 + Math.sin(t * 4 + r) * 0.07), cell * 0.3, t + r);
    }
  }

  // ---------- what only a written-out level has (core.js: the gates and foes of spec.defs) ----------
  // Each thing is drawn so that what it does can be read before it is reached: red lamps and shutters shut, green
  // open; arrows the way a gap steps; a key and a padlock the same gold; bone spikes on what bites.
  const BONE = '#f4ecd8', GOLD = '#ffd23f', DARK = '#0a0812';
  function tri(x1, y1, x2, y2, x3, y3, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill(); }
  function swirl(x, cy, s, t, cols) {
    for (let i = cols.length - 1; i >= 0; i--) { ctx.save(); ctx.translate(x, cy); ctx.rotate(t * (2 + i) * (i % 2 ? 1 : -1)); ctx.fillStyle = cols[i]; const q = s * (0.25 + i * 0.16); ctx.fillRect(-q, -q, q * 2, q * 2); ctx.restore(); }
  }
  function keyArt(x, cy, u, col) {                                  // a key: ring, shaft and two teeth
    ctx.fillStyle = DARK; ctx.fillRect(x - u * 0.62, cy - u * 0.4, u * 1.3, u * 0.8);
    ctx.fillStyle = col; ctx.fillRect(x - u * 0.55, cy - u * 0.32, u * 0.5, u * 0.64); ctx.fillRect(x - u * 0.1, cy - u * 0.09, u * 0.7, u * 0.18); ctx.fillRect(x + u * 0.28, cy, u * 0.12, u * 0.28); ctx.fillRect(x + u * 0.48, cy, u * 0.12, u * 0.22);
    ctx.fillStyle = DARK; ctx.fillRect(x - u * 0.4, cy - u * 0.14, u * 0.2, u * 0.28);
  }
  function padlock(x, cy, u, col) {
    ctx.fillStyle = DARK; ctx.fillRect(x - u * 0.42, cy - u * 0.5, u * 0.84, u * 1);
    ctx.fillStyle = '#c9ccd6'; ctx.fillRect(x - u * 0.26, cy - u * 0.44, u * 0.52, u * 0.4); ctx.fillStyle = DARK; ctx.fillRect(x - u * 0.13, cy - u * 0.31, u * 0.26, u * 0.3);
    ctx.fillStyle = col; ctx.fillRect(x - u * 0.36, cy - u * 0.1, u * 0.72, u * 0.54); ctx.fillStyle = DARK; ctx.fillRect(x - u * 0.06, cy + u * 0.04, u * 0.12, u * 0.24);
  }
  function rowExtras(r, y, t, sec, T, ex, mask) {
    const beat = run.beat, X = function (c) { return Math.round((c - camX) * cell); };
    if (sec.drift && r % 2 === 0) {                                 // a belt: its arrows run the way it carries him, a column a beat
      ctx.globalAlpha = 0.22;
      const span = sec.hi - sec.lo;
      for (let i = 0; i < 3; i++) {
        let u = (hash(r, 30 + i) * span + sec.drift * beat) % span; if (u < 0) u += span;
        const x = X(sec.lo + u), d = sec.drift * cell * 0.3;
        tri(x, y + cell * 0.2, x + d, y + cell * 0.5, x, y + cell * 0.8, T.neon); tri(x + d * 1.3, y + cell * 0.2, x + d * 2.3, y + cell * 0.5, x + d * 1.3, y + cell * 0.8, T.neon);
      }
      ctx.globalAlpha = 1;
      [sec.lo - 1, sec.hi].forEach(function (c) { ctx.fillStyle = (r + Math.floor(beat * 2 * sec.drift)) % 4 === 0 ? T.neon : DARK; ctx.fillRect(X(c) + cell * 0.3, y + cell * 0.2, cell * 0.4, cell * 0.6); });   // rollers in the walls
    }
    const dy = level.dyn.get(r);
    if (dy) dy.forEach(function (d) {
      if (d.kind === 'slider') {
        // a bar with a gap that steps: arrows along it point the way the gap goes next, its edges are lit
        const x0 = C.sliderAt(d, beat);
        for (let c = d.lo; c < d.hi; c++) {
          if (c >= x0 && c < x0 + d.w) continue;
          const x = X(c), w = X(c + 1) - x, a = d.dir * w * 0.22;
          drawBlock(x, y, w, T, true);
          tri(x + w / 2 - a, y + cell * 0.28, x + w / 2 + a, y + cell * 0.5, x + w / 2 - a, y + cell * 0.72, DARK);
        }
        ctx.fillStyle = GOLD; ctx.fillRect(X(x0) - 3, y, 3, cell); ctx.fillRect(X(x0 + d.w), y, 3, cell);
        return;
      }
      const x = X(d.c0), w = X(d.c1 + 1) - x, lock = d.kind === 'lock', shut = lock ? !run.keys[d.key] : C.doorShut(d, beat);
      if (lock) {                                                   // a lock across the hole until he has its key
        if (!shut) return;
        ctx.fillStyle = DARK; ctx.fillRect(x, y + cell * 0.1, w, cell * 0.8);
        ctx.fillStyle = GOLD; for (let i = 0; i < 3; i++) ctx.fillRect(x, y + cell * (0.18 + i * 0.27), w, cell * 0.1);
        padlock(x + w / 2, y + cell * 0.5, cell * 0.9, GOLD);
        return;
      }
      // a door: a shutter with a red lamp when it is shut, a frame with a green lamp when it is open; the lamp
      // blinks through the half beat before it changes
      const ph = (((beat - d.off) % d.per) + d.per) % d.per, left = d.per / 2 - ph % (d.per / 2), blink = left < C.TELL.door && Math.sin(t * 40) > 0;
      ctx.fillStyle = DARK; ctx.fillRect(x - 3, y - 2, 3, cell + 4); ctx.fillRect(x + w, y - 2, 3, cell + 4);
      if (shut) {
        ctx.fillStyle = '#3a3f4d'; ctx.fillRect(x, y, w, cell);
        ctx.fillStyle = '#5d6675'; for (let i = 0; i < 4; i++) ctx.fillRect(x, y + cell * (0.06 + i * 0.25), w, cell * 0.12);
        ctx.fillStyle = DARK; ctx.fillRect(x, y + cell - 3, w, 3);
      }
      ctx.fillStyle = DARK; ctx.fillRect(x + w / 2 - cell * 0.22, y - cell * 0.5, cell * 0.44, cell * 0.44);
      ctx.fillStyle = blink ? '#ffffff' : shut ? '#ff3d5a' : '#5fff7a'; ctx.fillRect(x + w / 2 - cell * 0.14, y - cell * 0.42, cell * 0.28, cell * 0.28);
    });
    const above = extras.get(r - 1);
    if (above && above.tg && above.tg.type === 'tooth') {           // under a tooth: bone spikes along its underside (drawn with the row below it, which would paint over them)
      const m = level.solids.get(r - 1) || 0;
      for (let c = sec.lo; c < sec.hi; c++) if (m >> c & 1) { const x = X(c), w = X(c + 1) - x; tri(x + w * 0.15, y, x + w * 0.5, y + cell * 0.45, x + w * 0.85, y, BONE); }
    }
    if (!ex) return;
    if (ex.tg && ex.tg.type === 'tooth' && mask) {                  // a tooth: a long bone spike at its tip, pointing at the way through
      const side = ex.tg.side;
      let tip = -1;
      for (let c = sec.lo; c < sec.hi; c++) if (mask >> c & 1 && (side < 0 || tip < 0)) tip = c;
      if (tip >= 0) { const x = side < 0 ? X(tip + 1) : X(tip); tri(x, y + cell * 0.1, x - side * cell * 0.75, y + cell * 0.5, x, y + cell * 0.9, BONE); }
    }
    if (ex.tg && ex.tg.type === 'bat') { ctx.fillStyle = 'rgba(255,79,109,0.35)'; const f = level.foes.filter(function (q) { return q.kind === 'bat' && q.row === r; })[0]; if (f) ctx.fillRect(X(Math.min(f.x0, f.x1)), y + cell * 0.5 - 1, (Math.abs(f.x1 - f.x0) + 1) * cell, 3); }   // the bat's beat, end to end
    if (ex.key !== undefined && !run.keys[ex.key]) { const k = level.keys[ex.key]; keyArt(X(k.col) + cell / 2, y + cell * (0.5 + Math.sin(t * 5) * 0.08), cell * 0.9, GOLD); }
    if (ex.warp !== undefined) {                                    // a swirl, and where it comes out: the same colours, hollow
      const w = level.warps[ex.warp], cols = [DARK, '#7dffb0', '#ffffff'], x1 = X(w.col) + cell / 2, x2 = X(w.col + w.dx) + cell / 2;
      ctx.fillStyle = '#7dffb0'; ctx.globalAlpha = 0.25; for (let i = 0; i < 12; i++) ctx.fillRect(x1 + (x2 - x1) * ((i + (t * 2 % 1)) / 12), y + cell * 0.45, cell * 0.25, cell * 0.1); ctx.globalAlpha = 1;
      swirl(x1, y + cell / 2, cell * 1.1, t, cols); swirl(x2, y + cell / 2, cell * 0.7, -t, [DARK, '#7dffb0']);
    }
    if (ex.spot !== undefined) spotArt(level.spots[ex.spot], X(level.spots[ex.spot].col) + cell / 2, y + cell / 2, t, !!run.spotted[ex.spot]);
    if (ex.gold) ex.gold.forEach(function (q) { if (!run.ggot[q[0] + ':' + q[1]]) drawToken({ tokenShape: 'star', tokenColor: GOLD }, X(level.golds[q[0]].cells[q[1]].col) + cell / 2, y + cell * 0.5, cell * 0.36, t * 2 + r); });
    if (ex.rain && run.dizzy) ex.rain.forEach(function (n) { if (!run.rgot[n]) drawToken(WF, X(level.rain[n].col) + cell / 2, y + cell * 0.5, cell * 0.3, t + r); });
    if (ex.portal !== undefined && level.portals[ex.portal].fake && !run.entered[ex.portal]) {   // a block that is not one: it sits on the gate like any other, but it is cracked and it glints
      const p = level.portals[ex.portal], x = X(p.col), w = X(p.col + 1) - x;
      drawBlock(x, y, w, T, true);
      ctx.fillStyle = DARK; ctx.fillRect(x + w * 0.45, y + cell * 0.2, Math.max(2, w * 0.08), cell * 0.8); ctx.fillRect(x + w * 0.2, y + cell * 0.6, w * 0.5, Math.max(2, cell * 0.08));
      ctx.fillStyle = '#fff27a'; ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 6); ctx.fillRect(x + w * 0.62, y + cell * 0.3, w * 0.14, cell * 0.14); ctx.globalAlpha = 1;
    }
    if (ex.fake2 !== undefined && !run.entered[ex.fake2]) { const x = X(level.portals[ex.fake2].col), w = X(level.portals[ex.fake2].col + 1) - x; drawBlock(x, y, w, T, false); ctx.fillStyle = DARK; ctx.fillRect(x + w * 0.45, y, Math.max(2, w * 0.08), cell * 0.6); }   // its lower half, on the gate
    if (ex.arch) {                                                  // where left and right swap (and swap back): an arch right across the shaft
      const x0 = X(sec.lo), x1 = X(sec.hi), col = '#ff3df2';
      ctx.fillStyle = DARK; ctx.fillRect(x0, y - 3, x1 - x0, cell * 0.36 + 6);
      ctx.fillStyle = col; ctx.fillRect(x0, y, x1 - x0, cell * 0.36);
      for (let c = sec.lo; c < sec.hi; c += 2) { const x = X(c) + cell * (0.5 + 0.3 * Math.sin(t * 6)), d = (c / 2 % 2 ? 1 : -1) * ex.arch; tri(x - d * cell * 0.2, y + cell * 0.04, x + d * cell * 0.2, y + cell * 0.18, x - d * cell * 0.2, y + cell * 0.32, DARK); }
    }
    if (ex.lanes) {                                                 // a slide's two lanes, named where they part
      const f = level.forks.filter(function (q) { return level.sections[q.si] === ex.lanes; })[0], here = level.stateAt(level.beatAtRow(r));
      if (f && f.segs[3]) { text('RISKY + RICH', X(C.mid(f.segs[3].st)) + cell / 2, y, cell * 0.55, '#ff4f6d'); text('SAFE', X(C.mid(here)) + cell / 2, y, cell * 0.55, '#a6ff3d'); }
    }
  }
  // the things to brush against: the car he drove up in (the intro's), another Frank on his break, a rubber duck
  function spotArt(sp, x, cy, t, found) {
    const u = cell, R = function (c, rx, ry, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x + rx * u), Math.round(cy + ry * u), Math.ceil(w * u), Math.ceil(h * u)); };
    const bob = Math.sin(t * (found ? 14 : 3)) * 0.06;
    if (sp.art === 'car') {
      const d = sp.dir;                                             // parked on a pipe, lights towards him
      R(DARK, -1.15, 0.54, 2.3, 0.2); R('#8fa3ad', -1.1, 0.57, 2.2, 0.1);
      R(DARK, -0.95, -0.42 + bob, 1.9, 0.86); R('#ff4f6d', -0.88, -0.1 + bob, 1.76, 0.42); R('#e8452c', -0.5, -0.36 + bob, 1, 0.3); R('#7fe9ff', -0.4, -0.3 + bob, 0.8, 0.2);
      R(DARK, -0.7, 0.26 + bob, 0.36, 0.3); R(DARK, 0.34, 0.26 + bob, 0.36, 0.3); R(found && Math.sin(t * 20) > 0 ? '#ffffff' : GOLD, d > 0 ? -0.95 : 0.8, 0 + bob, 0.15, 0.16);
      return;
    }
    if (sp.art === 'duck') { R(DARK, -0.5, -0.5 + bob, 1, 0.98); R(GOLD, -0.42, -0.1 + bob, 0.84, 0.5); R(GOLD, -0.06, -0.42 + bob, 0.44, 0.4); R('#ff7b00', 0.36, -0.26 + bob, 0.2, 0.12); R(DARK, 0.16, -0.32 + bob, 0.08, 0.08); R('#e0a100', -0.3, 0.06 + bob, 0.4, 0.12); return; }
    // the cameo: a Frank who is not yours, on a ledge with his lunch; he waves once you have brushed past
    R(DARK, -0.6, 0.38, 1.2, 0.16); R(BONE, -0.55, 0.4, 1.1, 0.1);
    ctx.save(); ctx.translate(x, cy - u * 0.18); ctx.rotate(found ? Math.sin(t * 12) * 0.2 : 0); drawBody(u * 0.36, FRANKS[(who + 7) % OWN], found ? t : 0); ctx.restore();
    R('#e0a85a', 0.26, 0.1, 0.22, 0.16);
  }
  // What moves, drawn where core.js says it is. Before it can hurt, each shows where it is coming: a line down (or
  // up) its column and a "!" at the edge of the screen it comes from.
  function drawFoes(t, top, rows) {
    const beat = run.beat, B = run.B, X = function (c) { return (c - camX) * cell; }, Y = function (row) { return (row - B + FR) * cell; };
    const T = TH[level.sectionAt(beat).theme], yTop = Y(top), yBot = Y(top + rows);
    const lane = function (col, from, to, a) { ctx.fillStyle = '#ff4f6d'; ctx.globalAlpha = a; for (let yy = Math.min(from, to); yy < Math.max(from, to); yy += cell * 0.5) ctx.fillRect(X(col) + cell * 0.44, yy, cell * 0.12, cell * 0.25); ctx.globalAlpha = 1; };
    const warn = function (col, yy) { const x = X(col) + cell / 2; ctx.fillStyle = DARK; ctx.fillRect(x - cell * 0.42, yy - cell * 0.42, cell * 0.84, cell * 0.84); ctx.fillStyle = Math.sin(t * 22) > 0 ? '#ff4f6d' : GOLD; ctx.fillRect(x - cell * 0.34, yy - cell * 0.34, cell * 0.68, cell * 0.68); ctx.fillStyle = DARK; ctx.fillRect(x - cell * 0.06, yy - cell * 0.24, cell * 0.12, cell * 0.3); ctx.fillRect(x - cell * 0.06, yy + cell * 0.12, cell * 0.12, cell * 0.12); };
    for (let i = 0; i < level.foes.length; i++) {
      const f = level.foes[i];
      if (beat < f.a || beat > f.b) continue;
      const q = C.foeAt(level, f, beat), x = X(q.x - 0.1), y = Y(q.y), u = cell;
      const R = function (c, rx, ry, w, h) { ctx.fillStyle = c; ctx.fillRect(x + rx * u, y + ry * u, w * u, h * u); };
      if (f.kind === 'bat') {                                       // a bat: wings beating, red eyes
        const fl = Math.sin(t * 18) * 0.22;
        R(DARK, 0.1, 0.05, 0.8, 0.8); R('#4a2a6a', 0.18, 0.12, 0.64, 0.66); R('#4a2a6a', -0.35, 0.2 + fl, 0.5, 0.3); R('#4a2a6a', 0.85, 0.2 - fl, 0.5, 0.3); R('#2e1846', -0.35, 0.4 + fl, 0.5, 0.12); R('#2e1846', 0.85, 0.4 - fl, 0.5, 0.12);
        R('#ff3d5a', 0.28, 0.3, 0.14, 0.14); R('#ff3d5a', 0.58, 0.3, 0.14, 0.14); R(BONE, 0.38, 0.58, 0.08, 0.14); R(BONE, 0.54, 0.58, 0.08, 0.14);
      } else if (f.kind === 'fire') {                               // fire coming up: the line it climbs, a "!" at the bottom, then the ball and its tail
        const seen = y < yBot;
        lane(f.col, Y(B), Math.min(yBot, y), 0.25 + 0.3 * Math.min(1, (beat - f.a) / 1.5));
        if (!seen || beat < f.tb - 1) warn(f.col, H - sab - 64);
        R(DARK, 0.02, -0.06, 0.96, 2.1); R('#ff7b00', 0.1, 0, 0.8, 1.4); R(GOLD, 0.25, 0.12, 0.5, 0.8); R('#fff7cf', 0.38, 0.22, 0.24, 0.4);
        for (let k = 0; k < 3; k++) R(k % 2 ? '#ff7b00' : '#e8452c', 0.2 + 0.2 * k, 1.4 + ((t * 9 + k * 0.4) % 1) * 0.9, 0.2, 0.3);
      } else if (f.kind === 'drip') {                               // a stalactite coming down: the line it falls, a "!" at the top, then the spike
        lane(f.col, Math.max(yTop, y + 2 * u), Y(B - 3), 0.25 + 0.3 * Math.min(1, (beat - f.a) / 1.5));
        if (y + 2 * u < 0 || beat < f.tb - 0.9) warn(f.col, (FR - 4.4) * cell);
        R(DARK, 0.04, -0.05, 0.92, 1.3); R('#c9d6dc', 0.12, 0, 0.76, 1.1); R('#8fa3ad', 0.6, 0, 0.28, 1.1);
        tri(x + 0.04 * u, y + 1.2 * u, x + 0.5 * u, y + 2.1 * u, x + 0.96 * u, y + 1.2 * u, DARK); tri(x + 0.14 * u, y + 1.1 * u, x + 0.5 * u, y + 2 * u, x + 0.86 * u, y + 1.1 * u, '#c9d6dc');
      } else {                                                      // a wisp: a bright head and the ring it runs on; it blinks until it can hurt
        ctx.globalAlpha = beat < f.la ? 0.35 + 0.3 * Math.sin(t * 25) : 1;
        ctx.strokeStyle = 'rgba(125,255,176,0.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(f.cx), Y(B - 1.5), f.r * cell, 0, 7); ctx.stroke();
        R(DARK, 0.02, 0.02, 0.96, 0.96); R('#7dffb0', 0.12, 0.12, 0.76, 0.76); R('#ffffff', 0.3, 0.3, 0.4, 0.4);
        ctx.globalAlpha = 1;
      }
    }
    // a boss's volley: every column it will burn glows brighter through the two beats before, then burns; the three it leaves stay dark
    for (let i = 0; i < level.volleys.length; i++) {
      const v = level.volleys[i], d = v.beat - beat;
      if (d > 2 || d < -0.25) continue;
      const s = level.sections[v.si], hot = d <= 0, a = hot ? 0.85 : 0.1 + 0.3 * (1 - d / 2) * (0.7 + 0.3 * Math.sin(t * 16));
      for (let c = s.lo; c < s.hi; c++) {
        if (c >= v.lo && c <= v.hi) continue;
        ctx.fillStyle = hot ? GOLD : '#ff5a3c'; ctx.globalAlpha = a; ctx.fillRect(X(c) + 1, yTop, cell - 2, yBot - yTop);
        if (d < 0.5 && d > 0) { ctx.globalAlpha = 0.9; ctx.fillStyle = '#ff7b00'; ctx.fillRect(X(c) + cell * 0.2, yBot - (yBot - Y(B)) * (1 - d / 0.5), cell * 0.6, cell * 1.6); }
      }
      ctx.globalAlpha = 1;
      if (!hot) { ctx.fillStyle = '#5fff7a'; ctx.fillRect(X(v.lo), Y(B) + 2, 3, cell * 0.5); ctx.fillRect(X(v.hi + 1) - 3, Y(B) + 2, 3, cell * 0.5); ctx.fillRect(X(v.lo), Y(B) + cell * 0.5, (v.hi - v.lo + 1) * cell, 3); }   // where to stand
    }
    // the boss himself, at the bottom of the screen: THE LANDLORD, top hat and all. He comes up as his stretch starts and sinks when the rent is paid.
    level.sections.forEach(function (s) {
      if (!s.boss || beat < s.start - 1 || beat > s.end + 1.5) return;
      const mine = level.volleys.filter(function (v) { return level.sections[v.si] === s; }), left = mine.filter(function (v) { return v.beat > beat; }).length, next = mine.filter(function (v) { return v.beat > beat - 0.3; })[0];
      const up = Math.min(1, (beat - s.start + 1) / 2) * (left ? 1 : Math.max(0, 1 - (beat - mine[mine.length - 1].beat - 0.3) / 1.5)), u = cell;
      const bx = X((s.lo + s.hi) / 2 + Math.sin(beat * Math.PI / 4) * 3), by = Y(B) + (H / cell - FR - 4.6 * up + 1) * cell, open = next && next.beat - beat < 0.5;
      const R = function (c, rx, ry, w, h) { ctx.fillStyle = c; ctx.fillRect(bx + rx * u, by + ry * u, w * u, h * u); };
      R(DARK, -3.1, -1.9, 6.2, 6); R('#15151f', -1.6, -1.8, 3.2, 1.7); R('#c0392b', -1.6, -0.5, 3.2, 0.3); R('#15151f', -2.6, -0.1, 5.2, 0.4);   // the hat
      for (let k = 0; k < mine.length; k++) R(k < left ? GOLD : '#3a3550', -1.5 + k * (3 / mine.length), -0.44, 2.2 / mine.length, 0.18);       // rent still owed, on the hat band
      R('#8fa58a', -3, 0.3, 6, 3.6); R('#a9bfa3', -3, 0.3, 6, 0.3); R('#6d8068', 2.6, 0.3, 0.4, 3.6);
      R(DARK, -2.2, 0.8, 1.6, 0.3); R(DARK, 0.6, 0.8, 1.6, 0.3); R('#fff', -2, 1.2, 1.2, 0.9); R('#fff', 0.8, 1.2, 1.2, 0.9); R(left ? '#ff3d5a' : DARK, -1.6 + Math.sin(t * 3) * 0.2, 1.5, 0.5, 0.5); R(left ? '#ff3d5a' : DARK, 1.2 + Math.sin(t * 3) * 0.2, 1.5, 0.5, 0.5);
      ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.strokeRect(bx + 0.7 * u, by + 1.1 * u, 1.4 * u, 1.1 * u);                                   // his monocle
      R(DARK, -1.6, 2.6, 3.2, open ? 1.1 : 0.4); if (open) R('#ff7b00', -1.4, 2.75, 2.8, 0.8); else for (let k = 0; k < 4; k++) R(BONE, -1.4 + k * 0.75, 2.6, 0.4, 0.22);
    });
    // the grudge: a claw over the column it has marked, which it comes down at the end of every beat
    const gz = level.grudges.filter(function (z) { return beat >= z.a - 2 && beat < z.b; })[0];
    if (gz) {
      const on = beat >= gz.a, u = cell, k = beat - Math.floor(beat), col = on && run.lockCol > -9 ? run.lockCol : C.mid(run.st);
      const drop = !on ? 0 : k < 0.5 ? 0 : k < 0.9 ? (k - 0.5) / 0.4 * 0.8 : 0.8 + (k - 0.9) / 0.1 * 3.2, x = X(col), y = Y(B - 3) - (2.7 - drop) * u;
      const R = function (c, rx, ry, w, h) { ctx.fillStyle = c; ctx.fillRect(x + rx * u, y + ry * u, w * u, h * u); };
      ctx.globalAlpha = on ? 1 : 0.4 + 0.3 * Math.sin(t * 20);
      if (on) lane(col, y + 1.6 * u, Y(B), 0.5);
      R(DARK, -0.35, -0.1, 1.7, 1.5); R('#3a1030', -0.25, 0, 1.5, 1); R('#ff3d5a', 0, 0.3, 0.3, 0.25); R('#ff3d5a', 0.7, 0.3, 0.3, 0.25);
      for (let j = 0; j < 3; j++) tri(x + (-0.2 + j * 0.55) * u, y + u, x + (0.05 + j * 0.55) * u, y + 1.7 * u, x + (0.3 + j * 0.55) * u, y + u, BONE);
      R(DARK, 0.4, -1.6, 0.2, 1.6);
      ctx.globalAlpha = 1;
    }
  }

  function drawFrank(t, floatie) {
    const p = pose();
    let cx = p.cx, cy = p.cy, a = angle * Math.PI / 2;
    if (anim) {
      const u = (t - anim.t) / anim.dur;
      if (u >= 1) anim = null;
      else if (anim.kind === 'rot') {                               // swing around the bottom corner
        const th = anim.dir * Math.PI / 2 * u, dx = anim.cx - anim.px, dy = anim.cy;
        cx = anim.px + dx * Math.cos(th) - dy * Math.sin(th);
        cy = dx * Math.sin(th) + dy * Math.cos(th);
        a = anim.a * Math.PI / 2 + th;
      } else if (anim.kind === 'slide') {
        cx = anim.cx + (cx - anim.cx) * (1 - (1 - u) * (1 - u));
        a += Math.sin(u * Math.PI * 2) * 0.14 * anim.dir;
      } else if (anim.kind === 'up') {
        const e = 1 - (1 - u) * (1 - u);
        cx = anim.cx + (cx - anim.cx) * e; cy = anim.cy + (cy - anim.cy) * e;
        a = (anim.a + (angle - anim.a) * e) * Math.PI / 2;
      } else {                                                      // wind: overshoot and bounce back
        cx = anim.cx + (cx - anim.cx) * (1 - Math.cos(u * Math.PI * 2.5) * (1 - u));
        a += anim.dir * 0.3 * Math.sin(u * Math.PI * 3) * (1 - u);
      }
    }
    a += Math.sin(t * 7) * 0.03;
    ctx.save();
    ctx.translate((cx - camX) * cell, (FR + cy) * cell);
    ctx.rotate(a);
    drawBody(cell, FRANKS[who], t, floatie);
    ctx.restore();
  }

  // A big fan in the wall where the fall turns, and its draught right across the shaft. dir = the way it blows.
  function drawFan(sec, row, dir, t) {
    const T = TH[sec.theme], x = ((dir > 0 ? sec.lo - 1.7 : sec.hi + 1.7) - camX) * cell, y = (row - run.B + FR) * cell, r = cell * 1.6;
    ctx.fillStyle = '#0a0812'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = T.neon; ctx.fillRect(x - r, y - r, r * 2, 3); ctx.fillRect(x - r, y + r - 3, r * 2, 3); ctx.fillRect(x - r, y - r, 3, r * 2); ctx.fillRect(x + r - 3, y - r, 3, r * 2);
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * 16 * dir);
    ctx.fillStyle = '#c9ccd6';
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-r * 0.17, -r * 0.86, r * 0.34, r * 0.76); }
    ctx.fillStyle = T.neon; ctx.fillRect(-r * 0.2, -r * 0.2, r * 0.4, r * 0.4);
    ctx.restore();
    ctx.fillStyle = T.neon; ctx.globalAlpha = 0.6;
    const span = sec.hi - sec.lo + 3;
    for (let i = 0; i < 9; i++) {
      let u = (hash(row, 20 + i) * span + dir * t * 30) % span;
      if (u < 0) u += span;
      ctx.fillRect((sec.lo - 3 + u - camX) * cell, y + (i - 4) * cell * 0.6, Math.min(3, sec.hi - (sec.lo - 3 + u)) * cell, Math.max(3, cell * 0.14));
    }
    ctx.globalAlpha = 1;
  }

  // ---------- the city at the top of ELM STREET ----------
  // What he falls past before the manhole, and what lives behind the level's card: a night city in layers. The sky
  // (smog lit from below, stars, a huge low moon), far towers in the haze, nearer towers with lit windows and neon
  // signs, and in front the two megatowers that are the walls of the top, the building with the BILLBOARD on its
  // roof, a tower with a sign down its side and a hologram over it, and the street: lamps, a shop, cones round the
  // open manhole, rain. The still parts are painted once into a few canvases (q pixels to a cell, 40 at most) and
  // each frame draws those, sliding against each other as he falls (the further, the slower), plus the few small
  // things that move: lights blinking, traffic in the sky, the hologram, a flicker in the neon, rain, steam.
  // It is only a picture: nothing of the level is here, and nothing in the level moved for it.
  const LOGO = new Image();                                         // the logo on the billboard: the file, never the word
  if (window.FFF_BASE) LOGO.crossOrigin = 'anonymous';              // (inside Claude it comes from the game's own site)
  LOGO.src = (window.FFF_BASE || '') + 'glyphh-logo-black.png';
  const CITY = (function () {
    const C0 = -14, C1 = 35, ST = STREET_ROW, BREF = 11, BB = { x: 5.15, y: 13.9, w: 4.6, h: 1.8 }, MOON = { c: 11.5, r: 11.3, R: 4.1 };
    const LIT = ['#35e8ff', '#ffc94d', '#ff5fd0', '#e8f4ff'];
    let q = 0, far = null, mid = null, near = null, ground = null, moon = null, blinks = [];
    const mk = function (rows) { const c = document.createElement('canvas'); c.width = Math.ceil((C1 - C0) * q); c.height = Math.ceil(rows * q); return c; };
    // a brush for one canvas whose top row is r0: R(col, row, w, h, colour) in cells
    function brush(cv2, r0) {
      const g = cv2.getContext('2d');
      const R = function (c, r, w, h, col, a) { if (a !== undefined) g.globalAlpha = a; g.fillStyle = col; g.fillRect(Math.round((c - C0) * q), Math.round((r - r0) * q), Math.max(1, Math.round(w * q)), Math.max(1, Math.round(h * q))); if (a !== undefined) g.globalAlpha = 1; };
      R.g = g; R.x = function (c) { return (c - C0) * q; }; R.y = function (r) { return (r - r0) * q; };
      R.tri = function (p, col, a) { g.globalAlpha = a === undefined ? 1 : a; g.fillStyle = col; g.beginPath(); p.forEach(function (v, i) { g[i ? 'lineTo' : 'moveTo']((v[0] - C0) * q, (v[1] - r0) * q); }); g.closePath(); g.fill(); g.globalAlpha = 1; };
      R.line = function (c1, r1, c2, r2, wd, col) { g.strokeStyle = col; g.lineWidth = Math.max(1, wd * q); g.beginPath(); g.moveTo((c1 - C0) * q, (r1 - r0) * q); g.lineTo((c2 - C0) * q, (r2 - r0) * q); g.stroke(); };
      R.fade = function (c, r, w, h, from, to) { const gr = g.createLinearGradient(0, (r - r0) * q, 0, (r + h - r0) * q); gr.addColorStop(0, from); gr.addColorStop(1, to); g.fillStyle = gr; g.fillRect((c - C0) * q, (r - r0) * q, w * q, h * q); };
      return R;
    }
    // the signs of this city are in no language: a ring, a wedge, bars, a cross, a diamond, arrows, dots, a slash
    function glyph(R, k, c, r, s, col) {
      k = ((k % 8) + 8) % 8;
      if (k === 0) { R(c - s / 2, r - s / 2, s, s, col); R(c - s * 0.24, r - s * 0.24, s * 0.48, s * 0.48, '#0c0624'); }
      else if (k === 1) R.tri([[c, r - s / 2], [c + s / 2, r + s / 2], [c - s / 2, r + s / 2]], col);
      else if (k === 2) { for (let i = 0; i < 3; i++) R(c - s / 2, r - s / 2 + i * s * 0.38, s * (i === 1 ? 0.62 : 1), s * 0.22, col); }
      else if (k === 3) { R(c - s / 2, r - s * 0.13, s, s * 0.26, col); R(c - s * 0.13, r - s / 2, s * 0.26, s, col); }
      else if (k === 4) R.tri([[c, r - s / 2], [c + s / 2, r], [c, r + s / 2], [c - s / 2, r]], col);
      else if (k === 5) { R.tri([[c - s / 2, r - s / 2], [c, r], [c - s / 2, r + s / 2]], col); R.tri([[c, r - s / 2], [c + s / 2, r], [c, r + s / 2]], col); }
      else if (k === 6) { for (let i = 0; i < 4; i++) R(c - s / 2 + (i % 2) * s * 0.6, r - s / 2 + (i >> 1) * s * 0.6, s * 0.4, s * 0.4, col); }
      else { R(c - s / 2, r - s / 2, s, s * 0.2, col); R(c - s / 2, r + s * 0.3, s, s * 0.2, col); R.tri([[c + s * 0.2, r - s * 0.3], [c + s / 2, r - s * 0.3], [c - s * 0.2, r + s * 0.3], [c - s / 2, r + s * 0.3]], col); }
    }
    // a neon sign running down a wall: a dark box, a lit edge, a halo, and signs stacked in it
    function sign(R, c, r, w, n, col, seed) {
      const h = n * w * 0.98 + w * 0.3;
      R(c - w * 0.3, r - w * 0.3, w * 1.6, h + w * 0.6, col, 0.13); R(c - w * 0.12, r - w * 0.12, w * 1.24, h + w * 0.24, col, 0.2);
      R(c, r, w, h, '#0c0624'); R(c, r, w, 0.06, col); R(c, r + h - 0.06, w, 0.06, col); R(c, r, 0.06, h, col); R(c + w - 0.06, r, 0.06, h, col);
      for (let i = 0; i < n; i++) glyph(R, Math.floor(hash(seed, i + 1) * 8), c + w / 2, r + w * 0.65 + i * w * 0.98, w * 0.52, i % 2 ? (col === PINK ? CYAN : PINK) : col);
    }
    function windows(R, c, r, w, h, seed, tone, sw, sh, gx, gy, lit) {
      for (let y = r + gy * 0.6, j = 0; y + sh < r + h; y += gy, j++) for (let x = c + gx * 0.45, i = 0; x + sw < c + w - gx * 0.2; x += gx, i++) {
        const k = hash(seed * 31 + i, j + 400);
        if (k < lit) R(x, y, sw, sh, LIT[k < lit * 0.55 ? tone : Math.floor(k * 97) % 4], 0.92); else if (k < lit + 0.3) R(x, y, sw, sh, '#2a1d5e');
      }
    }
    function build(u) {
      q = Math.max(8, Math.min(40, Math.round(u))); blinks = [];
      // ---- far: thin towers in the haze ----
      far = mk(23); let R = brush(far, 4);
      for (let x = C0, i = 0; x < C1; i++) {
        const w = 0.7 + hash(i, 201) * 1.2, spire = hash(i, 203) > 0.86, ht = 5 + hash(i, 202) * 8 + (spire ? 5 : 0), top = ST + 1 - ht;
        R(x, top, w, ht + 3, '#33186b'); R(x + w - 0.1, top, 0.1, ht + 3, '#4a2590'); R(x, top, w, 0.08, '#5a2fa6');
        for (let y = top + 0.4, j = 0; y < ST; y += 0.42, j++) for (let k = 0; k < 3; k++) if (hash(i * 13 + k, j + 210) < 0.2) R(x + 0.14 + k * (w - 0.3) / 3, y, 0.1, 0.12, hash(i + k, j) < 0.5 ? '#ff9ad5' : '#8fe9ff', 0.7);
        if (spire) { R(x + w / 2 - 0.04, top - 1.6, 0.08, 1.6, '#33186b'); R(x + w / 2 - 0.2, top - 0.5, 0.4, 0.06, '#4a2590'); blinks.push({ c: x + w / 2, r: top - 1.66, p: 0.4, ph: hash(i, 204) * 6 }); }
        x += w + hash(i, 205) * 0.3;
      }
      R.fade(C0, 11, C1 - C0, 16, 'rgba(255,110,130,0)', 'rgba(255,120,110,0.42)');
      // ---- mid: towers with lit windows, tanks and aerials on their roofs, signs down their sides, a bridge between two ----
      mid = mk(30); R = brush(mid, -3);
      let prev = null;
      for (let x = C0 + 0.3, i = 0; x < C1; i++) {
        const w = 1.9 + hash(i, 221) * 1.9, gap = x + w > 9.6 && x < 13.2, ht = gap ? 3.2 + hash(i, 222) * 2 : 8 + hash(i, 222) * 10, top = ST + 1 - ht, tone = Math.floor(hash(i, 223) * 3);
        R(x, top, w, ht + 4, '#1c0e45'); R(x + w - 0.12, top, 0.12, ht + 4, '#3a2485'); R(x, top, w, 0.1, '#34207a'); R(x, top + 0.1, 0.07, ht + 4, '#130830');
        windows(R, x, top + 0.2, w, ht + 2, i + 1, tone, 0.2, 0.26, 0.42, 0.56, 0.36);
        if (hash(i, 224) > 0.5) { R(x + 0.3, top - 0.62, 0.7, 0.5, '#24135a'); R(x + 0.3, top - 0.62, 0.7, 0.07, '#3a2485'); R(x + 0.36, top - 0.12, 0.06, 0.12, '#130830'); R(x + 0.88, top - 0.12, 0.06, 0.12, '#130830'); }
        if (hash(i, 225) > 0.4 && !gap) { const ax = x + w * (0.55 + hash(i, 226) * 0.3), ah = 1 + hash(i, 227) * 1.6; R(ax, top - ah, 0.06, ah, '#24135a'); R(ax - 0.14, top - ah * 0.6, 0.34, 0.05, '#24135a'); blinks.push({ c: ax + 0.03, r: top - ah - 0.06, p: 0.7, ph: hash(i, 228) * 6 }); }
        if (hash(i, 229) > 0.45 && !gap && ht > 9) sign(R, x + (hash(i, 230) > 0.5 ? 0.2 : w - 0.85), top + 1 + hash(i, 231) * 2, 0.64, 3 + Math.floor(hash(i, 232) * 3), [PINK, CYAN, '#ffc94d'][Math.floor(hash(i, 233) * 3)], i + 50);
        if (prev && !gap && hash(i, 234) > 0.55 && x - prev.x1 > 0.15) { const by = Math.max(top, prev.top) + 2.4; R(prev.x1, by, x - prev.x1, 0.34, '#24135a'); R(prev.x1, by + 0.12, x - prev.x1, 0.08, '#35e8ff', 0.8); }
        prev = { x1: x + w, top: top }; x += w + 0.15 + hash(i, 235) * 0.8;
      }
      R.fade(C0, 16, C1 - C0, 11, 'rgba(200,50,160,0)', 'rgba(210,60,150,0.34)');
      // ---- near: the megatowers (the walls of the top), the billboard's building, the sign tower, the street's things ----
      near = mk(40); R = brush(near, -16);
      const BODY = '#150a36', EDGE = '#2f1d70', DARK2 = '#090417';
      // the billboard's building: a low block with a shop under it
      R(5, 17.2, 4.9, 6.8, BODY); R(9.78, 17.2, 0.12, 6.8, EDGE); R(4.9, 17.06, 5.1, 0.14, '#3d2a8a'); R(4.9, 17.2, 5.1, 0.07, DARK2);
      [17.85, 18.95, 20.02].forEach(function (y, j) { [5.45, 6.55, 7.65, 8.75].forEach(function (x, i) { const k = hash(i + 3, j + 440), on = k < 0.6; R(x - 0.04, y - 0.04, 0.7, 0.68, DARK2); R(x, y, 0.62, 0.6, on ? LIT[k < 0.3 ? 1 : k < 0.45 ? 0 : 2] : '#231650', on ? 0.95 : 1); if (on) { R(x, y, 0.62, 0.14, '#ffffff', 0.25); R(x + 0.29, y, 0.04, 0.6, DARK2, 0.6); } }); });
      R(9.0, 16.62, 0.66, 0.44, '#2a1a5c'); R(9.0, 16.62, 0.66, 0.07, '#4a35a0'); for (let i = 0; i < 3; i++) R(9.08 + i * 0.19, 16.76, 0.1, 0.24, DARK2);
      R(5.2, 20.86, 4.5, 0.44, DARK2); for (let i = 0; i < 3; i++) glyph(R, [5, 0, 2][i], 6.3 + i * 0.62, 21.08, 0.3, i === 1 ? CYAN : PINK); R(5.3, 20.9, 0.5, 0.06, PINK, 0.9); R(8.2, 21.2, 1.3, 0.06, CYAN, 0.9);
      for (let i = 0; i < 10; i++) R(5.2 + i * 0.45, 21.3, 0.45, 0.42, i % 2 ? '#ff4fd8' : '#2a0f4a'); R(5.2, 21.72, 4.5, 0.06, DARK2);
      R(5.41, 21.91, 2.68, 1.63, DARK2); R.fade(5.45, 21.95, 2.6, 1.55, '#ffd98a', '#ff9a3c'); R(5.45, 22.6, 2.6, 0.06, '#7a3a12'); R(5.45, 23.1, 2.6, 0.06, '#7a3a12');
      [[5.6, 22.2, 0.3, 0.4], [6.1, 22.3, 0.24, 0.3], [6.6, 22.14, 0.34, 0.46], [7.3, 22.26, 0.28, 0.34], [5.8, 22.78, 0.4, 0.32], [6.9, 22.74, 0.3, 0.36], [7.5, 22.8, 0.36, 0.3]].forEach(function (b) { R(b[0], b[1], b[2], b[3], '#5a2408', 0.8); });
      R(8.46, 21.91, 1.03, 2.09, DARK2); R(8.5, 21.95, 0.95, 2.05, '#0f0730'); R(8.62, 22.1, 0.7, 0.8, '#35e8ff', 0.55); R(9.26, 23.0, 0.08, 0.2, '#ffc94d');
      // the billboard, standing on that roof: two steel legs braced to each other and stayed back, a catwalk, the frame, the white face, three lamps over it
      const bx = BB.x, by = BB.y, bw = BB.w, bh = BB.h, roof = 17.06, STEEL = '#55459c', STEEL2 = '#2c2060';
      [5.75, 8.95].forEach(function (px) { R(px - 0.1, by + bh, 0.2, roof - by - bh, STEEL2); R(px - 0.1, by + bh, 0.07, roof - by - bh, STEEL); R(px - 0.22, roof - 0.1, 0.44, 0.1, STEEL); });
      R.line(5.75, by + bh + 0.1, 8.95, roof - 0.14, 0.06, STEEL2); R.line(8.95, by + bh + 0.1, 5.75, roof - 0.14, 0.06, STEEL2); R(5.75, by + bh + 0.62, 3.2, 0.07, STEEL2);
      R.line(5.75, by + bh + 0.2, 5.25, roof - 0.04, 0.05, STEEL2); R.line(8.95, by + bh + 0.2, 9.5, roof - 0.04, 0.05, STEEL2);
      R(bx - 0.16, by + bh + 0.06, bw + 0.32, 0.09, STEEL); for (let i = 0; i <= 8; i++) R(bx - 0.14 + i * (bw + 0.24) / 8, by + bh - 0.2, 0.04, 0.26, STEEL); R(bx - 0.16, by + bh - 0.22, bw + 0.32, 0.04, STEEL);
      R(bx - 0.16, by - 0.16, bw + 0.32, bh + 0.32, DARK2); R(bx - 0.1, by - 0.1, bw + 0.2, bh + 0.2, STEEL2); R(bx - 0.1, by - 0.1, bw + 0.2, 0.05, STEEL);
      R.fade(bx, by, bw, bh, '#ffffff', '#ddd6f6'); for (let i = 1; i < 4; i++) R(bx + i * bw / 4, by, 0.02, bh, '#c9c1ea');
      [0.18, 0.5, 0.82].forEach(function (f) { const lx = bx + bw * f; R(lx - 0.03, by - 0.5, 0.06, 0.36, STEEL); R(lx - 0.03, by - 0.5, 0.3, 0.05, STEEL); R(lx + 0.12, by - 0.5, 0.3, 0.12, STEEL2); R(lx + 0.15, by - 0.39, 0.24, 0.05, '#fff7cf'); R.tri([[lx + 0.27, by - 0.34], [lx + 0.9, by + 0.5], [lx - 0.36, by + 0.5]], '#fff2c2', 0.16); });
      // the sign tower, right of where he falls
      R(12.4, 8.6, 3.7, 15.4, '#130931'); R(12.4, 8.6, 0.12, 15.4, EDGE); R(12.3, 8.46, 3.8, 0.14, '#3d2a8a'); R(12.3, 8.6, 3.8, 0.07, DARK2);
      for (let j = 0; j < 11; j++) for (let i = 0; i < 3; i++) { const k = hash(i + 9, j + 460), y = 9.3 + j * 1.14; if (y > 21) continue; R(13.62 + i * 0.8, y, 0.5, 0.62, k < 0.5 ? LIT[k < 0.2 ? 0 : k < 0.36 ? 1 : 2] : '#231650', k < 0.5 ? 0.92 : 1); }
      sign(R, 12.62, 9.5, 0.7, 5, PINK, 7);
      R(15.5, 6.3, 0.08, 2.2, '#2a1a5c'); R(15.3, 7.1, 0.5, 0.06, '#2a1a5c'); blinks.push({ c: 15.54, r: 6.24, p: 1, ph: 1.3 }); R(13.4, 8.3, 0.7, 0.16, '#2a1a5c'); R(13.55, 8.22, 0.4, 0.08, CYAN, 0.9);
      R(13.16, 21.86, 1.38, 2.14, DARK2); R.fade(13.2, 21.9, 1.3, 2.1, '#2b7f9e', '#123a52'); R(13.82, 21.9, 0.05, 2.1, DARK2); R(13.1, 21.74, 1.5, 0.12, CYAN, 0.85);
      R(14.86, 22.5, 0.7, 1.5, DARK2); R(14.9, 22.54, 0.62, 1.42, '#3a1a5c'); R(14.96, 22.62, 0.5, 0.7, PINK, 0.8); R(14.96, 23.44, 0.5, 0.1, '#ffc94d'); R(14.96, 23.64, 0.3, 0.2, DARK2);
      // the megatowers either side: panels, windows in bands, ledges with a strip of neon under them, a pipe and a line of light down the inner edge
      [[C0, 5 - C0], [16, C1 - 16]].forEach(function (s, side) {
        R(s[0], -16, s[1], 40, '#0e0726');
        for (let r = -16; r < ST; r++) {
          R(s[0], r + 0.94, s[1], 0.06, '#070312');
          for (let c = Math.floor(s[0]); c < s[0] + s[1]; c++) {
            const k = hash(r + 60, c + 300);
            if ((r & 1) === 0) R(c + 0.94, r, 0.06, 1, '#070312');
            if (k < 0.3) { R(c + 0.22, r + 0.26, 0.56, 0.42, LIT[k < 0.13 ? 1 : k < 0.24 ? 0 : 2], 0.9); R(c + 0.22, r + 0.26, 0.56, 0.1, '#ffffff', 0.22); } else if (k < 0.56) R(c + 0.22, r + 0.26, 0.56, 0.42, '#1b1146');
          }
          if (((r % 6) + 6) % 6 === 2) { R(s[0], r, s[1], 0.18, '#24155c'); R(s[0], r + 0.18, s[1], 0.07, side ? CYAN : PINK, 0.75); }
        }
      });
      R(4.72, -16, 0.14, 40, '#2a1a66'); R(4.93, -16, 0.07, 40, CYAN, 0.85); R(16.14, -16, 0.14, 40, '#2a1a66'); R(16, -16, 0.07, 40, PINK, 0.85);
      for (let r = -14; r < ST; r += 4) { R(4.66, r, 0.26, 0.2, '#3d2a8a'); R(16.08, r + 2, 0.26, 0.2, '#3d2a8a'); }
      sign(R, 17.5, 3.2, 1.1, 7, CYAN, 21); sign(R, 1.4, 6.4, 1.1, 5, '#ffc94d', 33); sign(R, 21.2, 11, 0.9, 6, PINK, 44); sign(R, -3.4, 2.4, 1, 8, PINK, 55);
      // the street's things: two lamps and their light, a barrier and cones round the hole, the lid beside it
      [[6.2, 1], [14.75, -1]].forEach(function (l) {
        const x = l[0], d = l[1], hx = x + d * 0.86;
        R.tri([[hx, 20.76], [hx - 1.15, ST], [hx + 1.15, ST]], '#ffe9a8', 0.13); R.tri([[hx, 20.76], [hx - 0.5, ST], [hx + 0.5, ST]], '#fff7cf', 0.1);
        R(x - 0.05, 20.6, 0.1, 3.4, '#3a2f66'); R(x - 0.12, 23.8, 0.24, 0.2, '#3a2f66'); R(d > 0 ? x : x - 0.9, 20.6, 0.9, 0.08, '#3a2f66'); R(hx - 0.2, 20.6, 0.4, 0.14, '#4a3d80'); R(hx - 0.14, 20.74, 0.28, 0.07, '#fff7cf');
      });
      R(7.42, 23.3, 1.16, 0.3, DARK2); for (let i = 0; i < 5; i++) R(7.46 + i * 0.22, 23.34, 0.22, 0.22, i % 2 ? '#ffb000' : '#1a1030'); R(7.5, 23.6, 0.08, 0.4, '#3a2f66'); R(8.42, 23.6, 0.08, 0.4, '#3a2f66');
      [8.95, 12.3].forEach(function (x) { R(x - 0.24, 23.86, 0.48, 0.14, '#b34a00'); R(x - 0.16, 23.5, 0.32, 0.36, '#ff7b00'); R(x - 0.16, 23.6, 0.32, 0.1, '#f4f4f4'); R(x - 0.08, 23.24, 0.16, 0.26, '#ff7b00'); });
      R(11.3, 23.84, 1.0, 0.16, '#2e2850'); R(11.3, 23.84, 1.0, 0.05, '#6a62a0'); R(11.42, 23.76, 0.76, 0.08, '#3a3266');
      R.fade(5, 20.4, 11, 3.6, 'rgba(255,79,216,0)', 'rgba(255,79,216,0.12)');
      // ---- the street itself, for where the level is not there to draw it (the cards): its blocks, the hole, the shaft under it ----
      ground = mk(7); R = brush(ground, ST);
      const TS = themesFor(0).street, SH = themesFor(0).shaft;
      R(C0, 0, C1 - C0, 7, TS.under);
      for (let c = C0; c < C1; c++) for (let r = 0; r < 7; r++) {
        if (c < 5 || c >= 16) { R(c, ST + r, 1, 1, TS.wall); R(c, ST + r + 0.94, 1, 0.06, TS.wallDark); R(c + ((r & 1) ? 0 : 0.5), ST + r, 0.06, 1, TS.wallDark); }
        else if (r < 2 && c !== C.START_COL) { R(c, ST + r, 1, 1.03, TS.block); R(c, ST + r, 1, 0.16, r ? TS.top : TS.neon); R(c, ST + r + 0.8, 1, 0.2, TS.side); R(c + 0.94, ST + r, 0.06, 1, TS.side); }
        else if (r >= 2 && hash(r, c) < 0.08) R(c, ST + r, 1, 1, '#ffffff', 0.04);
      }
      R(C.START_COL - 0.2, ST, 0.2, 1, TS.neon); R(C.START_COL + 1, ST, 0.2, 1, TS.neon); R(4.94, ST, 0.06, 7, SH.neon, 0.5); R(16, ST, 0.06, 7, SH.neon, 0.5);
      // ---- the moon: low, huge, cut by bands of smog, with its glow ----
      const mr = Math.ceil(MOON.R * q), ms = Math.ceil(mr * 1.7);
      moon = document.createElement('canvas'); moon.width = moon.height = ms * 2;
      const g = moon.getContext('2d'), halo = g.createRadialGradient(ms, ms, mr * 0.9, ms, ms, ms);
      halo.addColorStop(0, 'rgba(255,170,190,0.34)'); halo.addColorStop(1, 'rgba(255,120,170,0)'); g.fillStyle = halo; g.fillRect(0, 0, ms * 2, ms * 2);
      const disc = g.createLinearGradient(0, ms - mr, 0, ms + mr); disc.addColorStop(0, '#fff3c4'); disc.addColorStop(0.45, '#ffc98a'); disc.addColorStop(1, '#ff5fa8');
      g.fillStyle = disc; g.beginPath(); g.arc(ms, ms, mr, 0, 7); g.fill();
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 6; i++) { const y = ms + mr * (0.08 + i * 0.16), h = Math.max(1, mr * (0.025 + i * 0.016)); g.fillRect(ms - mr, y, mr * 2, h); }
      g.globalCompositeOperation = 'source-over';
      [[-0.4, -0.45, 0.2], [0.25, -0.2, 0.13], [-0.1, 0.02, 0.09], [0.45, -0.55, 0.08]].forEach(function (k) { g.fillStyle = 'rgba(226,150,110,0.3)'; g.beginPath(); g.arc(ms + k[0] * mr, ms + k[1] * mr, k[2] * mr, 0, 7); g.fill(); });
    }
    // The picture, drawn so that column 0, row 0 of the level is at (ox, oy) with u pixels to a cell, clipped to cl.
    // B: how far down the fall is (the layers slide by it). o.ground: draw the street too (a card has no level under it).
    function draw(ox, oy, u, B, t, cl, o) {
      if (!near || Math.max(8, Math.min(40, Math.round(cell))) !== q) build(cell);   // painted once for the size the level is played at; a card draws it smaller
      const k = u / q, off = function (p) { return (B - BREF) * u * (1 - p); }, X = function (c) { return ox + c * u; }, Y = function (r, p) { return oy + r * u + (p === undefined ? 0 : off(p)); };
      const R = function (c, r, w, h, col, p) { ctx.fillStyle = col; ctx.fillRect(X(c), Y(r, p), w * u, h * u); };
      const blit = function (img, r0, p) { ctx.drawImage(img, Math.round(X(C0)), Math.round(Y(r0, p)), img.width * k, img.height * k); };
      ctx.save(); ctx.beginPath(); ctx.rect(cl.x, cl.y, cl.w, cl.h); ctx.clip();
      // (o.part: 'still' = only what never moves, 'live' = only what does: a card keeps the first as one picture, see card())
      const part = o && o.part;
      if (part !== 'live') {
      // the sky: night at the top, smog lit orange where the streets are
      const ya = Y(-4, 0.3), yb = Y(ST + 1, 0.3), sky = ctx.createLinearGradient(0, ya, 0, yb);
      sky.addColorStop(0, '#070419'); sky.addColorStop(0.36, '#1b0b4a'); sky.addColorStop(0.62, '#4f1670'); sky.addColorStop(0.82, '#b0306f'); sky.addColorStop(0.94, '#ff6f52'); sky.addColorStop(1, '#ffb45e');
      ctx.fillStyle = sky; ctx.fillRect(cl.x, cl.y, cl.w, cl.h);
      for (let i = 0; i < 46; i++) { const sx = X(C0 + hash(i, 311) * (C1 - C0)), sy = Y(-14 + hash(i, 312) * 22, 0.12); if (sy < cl.y || sy > cl.y + cl.h) continue; ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(t * (0.7 + hash(i, 313) * 2) + i)); ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, 2, 2); }
      ctx.globalAlpha = 1;
      ctx.drawImage(moon, X(MOON.c) - moon.width * k / 2, Y(MOON.r, 0.22) - moon.height * k / 2, moon.width * k, moon.height * k);
      blit(far, 4, 0.4);
      }
      // traffic in the sky, between the far towers and the near ones: a light, its tail
      for (let i = 0; i < (part ? 0 : 8); i++) {
        const d = i % 2 ? 1 : -1, span = C1 - C0 + 6, lane = [6.4, 7.6, 9.2, 10.5, 12.6, 14.2, 5.2, 16.2][i], sp = 2.2 + hash(i, 321) * 3;
        let c = (hash(i, 322) * span + t * sp * d) % span; if (c < 0) c += span; c += C0 - 3;
        ctx.globalAlpha = 0.3; R(c - d * 1.1, lane + 0.02, 1.1 * d, 0.05, i % 3 ? '#ff5fd0' : CYAN, 0.55);
        ctx.globalAlpha = 1; R(c - 0.26, lane - 0.03, 0.52, 0.13, '#12092e', 0.55); R(c + d * 0.2, lane, 0.1, 0.07, '#ffffff', 0.55); R(c - d * 0.28, lane, 0.08, 0.07, '#ff3d5a', 0.55);
      }
      if (part !== 'live') { blit(mid, -3, 0.7); blit(near, -16); if (o && o.ground) blit(ground, ST); }
      if (part === 'still') { ctx.restore(); return; }
      // lights on the masts, blinking
      for (let i = 0; i < blinks.length; i++) { const b = blinks[i], on = Math.sin(t * 2.6 + b.ph) > 0.2; if (!on) continue; ctx.globalAlpha = 0.35; R(b.c - 0.14, b.r - 0.14, 0.28, 0.28, '#ff3d5a', b.p); ctx.globalAlpha = 1; R(b.c - 0.06, b.r - 0.06, 0.12, 0.12, '#ff5a6e', b.p); }
      // the hologram over the sign tower: a pane of light with its own signs, thrown up from the roof
      const hx = 12.75, hy = 6.3, hw = 2.2, hh = 1.8, fl = 0.75 + 0.25 * Math.sin(t * 7) * Math.sin(t * 1.7);
      ctx.fillStyle = CYAN; ctx.globalAlpha = 0.07 * fl; ctx.beginPath(); ctx.moveTo(X(13.75), Y(8.3)); ctx.lineTo(X(hx), Y(hy + hh)); ctx.lineTo(X(hx + hw), Y(hy + hh)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.16 * fl; R(hx, hy, hw, hh, CYAN); ctx.globalAlpha = 0.8 * fl; R(hx, hy, hw, 0.05, CYAN); R(hx, hy + hh - 0.05, hw, 0.05, CYAN); R(hx, hy, 0.05, hh, CYAN); R(hx + hw - 0.05, hy, 0.05, hh, CYAN);
      R(hx + 0.28, hy + 0.34, 0.74, 0.74, '#bff6ff'); ctx.globalAlpha = 0.9 * fl; R(hx + 0.46, hy + 0.52, 0.38, 0.38, '#0c2a4a');
      for (let i = 0; i < 3; i++) R(hx + 1.2, hy + 0.36 + i * 0.3, 0.3 + 0.5 * Math.abs(Math.sin(t * 1.3 + i * 1.9)), 0.14, i === 1 ? '#ff9ad5' : '#bff6ff');
      R(hx + 0.28, hy + 1.3, 1.64, 0.1, '#bff6ff'); ctx.globalAlpha = 0.3 * fl; R(hx, hy + ((t * 0.5) % 1) * (hh - 0.12), hw, 0.12, '#ffffff');
      // a window where a television is on, and the barrier's lamp
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 13) * Math.sin(t * 3.1); R(6.55, 18.95, 0.62, 0.6, '#9fd8ff'); ctx.globalAlpha = 1;
      if (Math.sin(t * 6) > 0) { ctx.globalAlpha = 0.3; R(8.26, 23.0, 0.4, 0.4, '#ffb000'); ctx.globalAlpha = 1; R(8.38, 23.12, 0.16, 0.18, '#ffd23f'); } else R(8.38, 23.12, 0.16, 0.18, '#7a5200');
      // the neon of the sign tower stutters now and then
      if (hash(Math.floor(t * 9), 77) > 0.9) { ctx.globalAlpha = 0.55; R(12.62, 9.5, 0.7, 5.12, '#0c0624'); ctx.globalAlpha = 1; }
      // rain
      ctx.strokeStyle = 'rgba(180,205,255,0.26)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 44; i++) { const rx = cl.x + ((hash(i, 331) * cl.w - t * 34 * (1 + hash(i, 333))) % cl.w + cl.w) % cl.w, ry = cl.y + ((hash(i, 332) + t * (1.5 + hash(i, 333) * 0.9)) % 1) * cl.h; ctx.moveTo(rx, ry); ctx.lineTo(rx - 4, ry + 13); }
      ctx.stroke();
      ctx.restore();
    }
    // What goes over the street once the level's rows (or the card's street) are drawn: the wet road throwing the
    // lights back, and steam off the open manhole.
    function front(ox, oy, u, t) {
      const R = function (c, r, w, h, col) { ctx.fillStyle = col; ctx.fillRect(ox + c * u, oy + r * u, w * u, h * u); };
      [[7.06, '#ffe9a8'], [6.5, '#ffb347'], [12.97, PINK], [13.85, CYAN], [15.2, PINK], [8.9, CYAN], [5.6, PINK], [14.5, '#ffe9a8']].forEach(function (s, i) {
        const a = 0.13 + 0.06 * Math.sin(t * 2.2 + i * 1.7);
        ctx.globalAlpha = a; R(s[0] - 0.32, ST + 0.16, 0.64, 1.82, s[1]); ctx.globalAlpha = a * 1.5; R(s[0] - 0.1, ST + 0.16, 0.2, 1.5, s[1]);
      });
      for (let i = 0; i < 9; i++) { const c = 5.2 + hash(i, 341) * 10.4; if (c > 9.6 && c < 11.4) continue; ctx.globalAlpha = 0.25 + 0.3 * Math.abs(Math.sin(t * (1.5 + hash(i, 342) * 2) + i)); R(c, ST + 0.3 + hash(i, 343) * 1.5, 0.3 + hash(i, 344) * 0.3, 0.05, '#ffffff'); }
      for (let i = 0; i < 6; i++) { const a = ((t * 0.5 + i / 6) % 1), s = 0.2 + a * 0.5; ctx.globalAlpha = 0.16 * (1 - a); R(C.START_COL + 0.5 - s / 2 + Math.sin(t * 1.3 + i * 2) * 0.25 * a, ST - 0.1 - a * 2.1, s, s, '#d6dcff'); }
      ctx.globalAlpha = 1;
    }
    // The picture for a card or the back of a menu, where nothing scrolls: what never moves is drawn once into a
    // picture the size of the place it goes (kept while that place stays the same), and each frame is that one
    // picture and the few things that move over it.
    let stills = {}, stillN = 0;
    function card(x, y, w, h, ox, oy, u, t) {
      const key = [Math.round(w), Math.round(h), u.toFixed(2), Math.round(ox - x), Math.round(oy - y), dpr, cell].join();
      let c = stills[key];
      if (!c) {
        if (stillN++ > 5) { stills = {}; stillN = 0; }
        c = stills[key] = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
        const keep = ctx; ctx = c.getContext('2d');
        try { ctx.scale(dpr, dpr); ctx.imageSmoothingEnabled = u < cell; draw(ox - x, oy - y, u, BREF, 0, { x: 0, y: 0, w: w, h: h }, { ground: true, part: 'still' }); } finally { ctx = keep; }
      }
      ctx.drawImage(c, x, y, w, h);
      draw(ox, oy, u, BREF, t, { x: x, y: y, w: w, h: h }, { part: 'live' });
    }
    return { draw: draw, card: card, front: front, BB: BB, BREF: BREF };
  })();
  // is this level's top the city? (ELM STREET, and a made level in Frank's own world)
  function cityTop() { return WF === FRANKS[0] && !LV.world; }
  // What is on a billboard's face (x, y, w, h on the screen): the logo, drawn from its file on the lit white board;
  // another sponsor's few words on a dark board in their colour; with no sponsor at all, signs in no language.
  let logoAt = {};
  function boardFace(ad, x, y, w, h, t) {
    const flick = (0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 2.3)) * (hash(Math.floor(t * 11), 91) > 0.95 ? 0.35 : 1), col = ad && ad.id !== 'glyphh' ? ad.color || PINK : PINK, e = Math.max(2, h * 0.045);
    if (ad && ad.id === 'glyphh') {
      if (LOGO.complete && LOGO.naturalWidth) {
        const lw = Math.min(w * 0.9, h * 0.84 * LOGO.naturalWidth / LOGO.naturalHeight), lh = lw * LOGO.naturalHeight / LOGO.naturalWidth;
        // (the file is scaled once to each size a board has, and that small picture is what is drawn each frame)
        const key = Math.round(lw * dpr);
        let s = logoAt[key];
        if (!s) { if (Object.keys(logoAt).length > 6) logoAt = {}; s = logoAt[key] = document.createElement('canvas'); s.width = key; s.height = Math.max(1, Math.round(lh * dpr)); const g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(LOGO, 0, 0, s.width, s.height); }
        ctx.imageSmoothingEnabled = true; ctx.drawImage(s, x + (w - lw) / 2, y + (h - lh) / 2, lw, lh); ctx.imageSmoothingEnabled = false;
      }
    } else {
      ctx.fillStyle = '#15112a'; ctx.fillRect(x, y, w, h);
      if (ad) { ctx.globalAlpha = flick; text(ad.text, x + w / 2, y + h * (ad.sub ? 0.38 : 0.5), Math.min(h * 0.4, w * 0.9 / (ad.text.length * 0.62)), col); if (ad.sub) text(ad.sub, x + w / 2, y + h * 0.74, Math.min(h * 0.17, w * 0.92 / (ad.sub.length * 0.62)), '#fff'); ctx.globalAlpha = 1; }
      else for (let i = 0; i < 5; i++) { ctx.globalAlpha = flick; icon(['star', 'grid', 'up', 'build', 'play'][i], x + w * (0.14 + i * 0.18), y + h / 2, h * 0.42, i % 2 ? CYAN : PINK); ctx.globalAlpha = 1; }
    }
    // the tube of neon round the face, with its flicker, and the lamps' light on it
    ctx.globalAlpha = 0.16 * flick; ctx.fillStyle = col; ctx.fillRect(x - e * 4, y - e * 4, w + e * 8, h + e * 8);
    ctx.globalAlpha = flick; ctx.fillRect(x - e, y - e, w + e * 2, e); ctx.fillRect(x - e, y + h, w + e * 2, e); ctx.fillRect(x - e, y, e, h); ctx.fillRect(x + w, y, e, h);
    ctx.globalAlpha = 1;
  }
  // A billboard standing on the ground (where the top is not the city, which has its own on a roof): two braced steel
  // legs from the board down to gy, the frame, the face, lamps over it.
  function billboard(ad, x, y, w, h, gy, t) {
    const u = cell, steel = '#3d3560', dark = INK, R = function (rx, ry, rw, rh, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(rx), Math.round(ry), Math.ceil(rw), Math.ceil(rh)); };
    [0.2, 0.8].forEach(function (f) { const px = x + w * f; R(px - u * 0.13, y + h, u * 0.26, gy - y - h, dark); R(px - u * 0.09, y + h, u * 0.1, gy - y - h, steel); R(px - u * 0.3, gy - u * 0.14, u * 0.6, u * 0.14, dark); R(px - u * 0.26, gy - u * 0.12, u * 0.52, u * 0.06, steel); });
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, u * 0.08); ctx.beginPath();
    for (let k = 0, yy = y + h + u * 0.2; yy + u * 1.5 < gy; yy += u * 1.5, k++) { ctx.moveTo(x + w * (k % 2 ? 0.8 : 0.2), yy); ctx.lineTo(x + w * (k % 2 ? 0.2 : 0.8), yy + u * 1.5); ctx.moveTo(x + w * 0.2, yy + u * 1.5); ctx.lineTo(x + w * 0.8, yy + u * 1.5); }
    ctx.stroke();
    R(x - u * 0.2, y + h + u * 0.04, w + u * 0.4, u * 0.1, steel);
    R(x - u * 0.16, y - u * 0.16, w + u * 0.32, h + u * 0.32, dark); R(x - u * 0.1, y - u * 0.1, w + u * 0.2, h + u * 0.2, steel);
    const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ddd6f6'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    [0.18, 0.5, 0.82].forEach(function (f) { const lx = x + w * f; R(lx - 1, y - u * 0.5, Math.max(2, u * 0.06), u * 0.36, steel); R(lx - 1, y - u * 0.5, u * 0.3, Math.max(2, u * 0.05), steel); R(lx + u * 0.12, y - u * 0.5, u * 0.3, u * 0.12, dark); R(lx + u * 0.15, y - u * 0.39, u * 0.24, Math.max(2, u * 0.05), '#fff7cf'); });
    boardFace(ad, x, y, w, h, t);
  }

  // ---------- sponsors, in the world ----------
  // An ad here is part of the scenery: a lit billboard on the skyline he falls past at the top of every run, and
  // the name sprayed faintly on the back wall of the shaft on the way down. One sponsor a run, taken in turn from the
  // ones the server says are on (Acct.me.ads: a few words, a colour and a link). The only place one can be tapped
  // is the line under LEVEL CLEAR; a sign in the world is never in the way of the fall.
  // (the game's maker is the sponsor the server seeds; where the server cannot be asked, offline or in a test, the
  // board still carries the maker's logo: HOUSE. It is only ever the logo file: the word is never typed.)
  const HOUSE = { id: 'glyphh', text: '', sub: '', url: 'https://glyphh.ai', color: PINK };
  const isHouse = function (ad) { return !!ad && ad.id === 'glyphh'; };
  function sponsor() { const a = Acct.me.ads; return a && a.length ? a[(attempts + who) % a.length] : a ? null : HOUSE; }
  function adTrack(k) { const ad = sponsor(); if (ad && ad !== HOUSE && !BOT) Acct.track({ t: 'ad', ad: ad.id, k: k }); }
  function drawAds(top, rows, t) {
    const ad = sponsor(), yOf = function (r) { return Math.round((r - run.B + FR) * cell); }, X = function (c) { return (c - camX) * cell; };
    // the billboard. In the city it stands on a roof left of where he drops (CITY painted its legs, frame and lamps:
    // here is its face). Anywhere else it stands on the ground on two braced legs.
    if (cityTop()) { const b = CITY.BB; if (b.y + b.h > top && b.y < top + rows) boardFace(ad, X(b.x), yOf(b.y), b.w * cell, b.h * cell, t); }
    else if (ad && STREET_ROW > top && STREET_ROW - 9 < top + rows) billboard(ad, X(C.START_COL - 5.4), yOf(STREET_ROW - 7.4), cell * 4.6, cell * 1.8, yOf(STREET_ROW), t);
    if (!ad) return;
    // and the sponsor stencilled big and faint on the back wall of the shaft every so often, on the way down
    // (a sponsor only: the studio's own logo is on the billboard and nowhere on the wall, where it read as a smudge)
    const col = ad.color || PINK, logo = false;
    if (isHouse(ad)) return;
    for (let k = Math.floor(top / 72); k * 72 + 40 < top + rows + 3; k++) {
      const r = k * 72 + 40, s = level.sectionAtRow(r);
      if (r < STREET_ROW + 10 || s.theme === 'sky' || s.theme === 'street') continue;
      const cx = ((s.lo + s.hi) / 2 + ((k * 7) % 5 - 2) * (s.hi - s.lo > 12 ? 2 : 0.6) - camX) * cell;
      ctx.save(); ctx.translate(cx, yOf(r)); ctx.rotate((k % 2 ? 1 : -1) * 0.09);
      if (logo) { const lw = Math.min(cell * 7, (s.hi - s.lo) * cell * 0.7), lh = lw * LOGO.naturalHeight / LOGO.naturalWidth; ctx.globalAlpha = 0.1; ctx.imageSmoothingEnabled = true; ctx.drawImage(LOGO, -lw / 2, -lh / 2, lw, lh); ctx.imageSmoothingEnabled = false; }
      else {
        const size = Math.min(cell * 2.2, (s.hi - s.lo) * cell * 0.8 / (ad.text.length * 0.62));
        ctx.globalAlpha = 0.16; ctx.font = 'bold ' + Math.round(size) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = col; ctx.fillText(ad.text, 0, 0);
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  let fpos = { x: 0, y: 0 };                                        // where Frank is on screen, for the dark stretches
  // The board as it is shown: turned by a (radians) about the point under Frank's feet, a little smaller the
  // further round it is so that more of what is coming fits. x0..x1 and c0..c1 are what has to be drawn to fill the screen.
  const view = { a: 0, x0: 0, x1: 0, c0: 0, c1: 0 };
  // (loop: a slide that goes right round once, from a beat in to a beat before its end)
  function turnOf(beat) {
    const s = level.sectionAt(beat);
    if (run.bonus) return 0;
    if (s.loop) return 2 * Math.PI * Math.max(0, Math.min(1, (beat - s.start - 1) / (s.beats - 2)));
    return (s.turn || 0) * Math.PI / 180;
  }
  function drawWorld(t, dt) {
    const B = run.B, beat = run.beat, sec = level.sectionAt(beat);
    const tc = camTarget();
    camX += (tc - camX) * (state === 'play' ? 1 - Math.exp(-dt * 16) : 0);
    // the fan swings the board round fast, and swings it back at the end of the stretch
    const want = turnOf(beat);
    if (view.a - want > Math.PI) view.a -= 2 * Math.PI;             // right round is where it started: no unwinding
    if (state === 'play') { view.a += (want - view.a) * (1 - Math.exp(-dt * 10)); if (Math.abs(want - view.a) < 0.003) view.a = want; }
    const roll = spunAt >= 0 && t - spunAt < 0.9 ? 2 * Math.PI * (1 - Math.pow(1 - (t - spunAt) / 0.9, 2)) : 0;   // dizzy: once right round
    const a = view.a + roll, k = Math.min(Math.abs(a), Math.abs(2 * Math.PI - Math.abs(a))) / (Math.PI / 2), sc = 1 - 0.2 * Math.min(1, k), ca = Math.cos(a), sa = Math.sin(a);
    // (a loop turns about Frank himself, so he stays in the picture all the way round)
    const px = sec.loop && !run.bonus ? (pose().cx - camX) * cell : W / 2, py = FR * cell, ax = W / 2 - W * 0.28 * sa, ay = py + (H * 0.5 - py) * (1 - ca);
    const toScreen = function (x, y) { const dx = (x - px) * sc, dy = (y - py) * sc; return { x: ax + dx * ca + dy * sa, y: ay - dx * sa + dy * ca }; };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    [[0, 0], [W, 0], [0, H], [W, H]].forEach(function (q) {
      const dx = (q[0] - ax) / sc, dy = (q[1] - ay) / sc, x = px + dx * ca - dy * sa, y = py + dx * sa + dy * ca;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    });
    view.x0 = Math.floor(x0) - 1; view.x1 = Math.ceil(x1) + 1; view.c0 = Math.floor(camX + x0 / cell) - 1; view.c1 = Math.ceil(camX + x1 / cell);
    const pp = pose();
    fpos = toScreen((pp.cx - camX) * cell, (FR + pp.cy) * cell);
    ctx.save();
    if (a) { ctx.translate(ax, ay); ctx.rotate(-a); ctx.scale(sc, sc); ctx.translate(-px, -py); }
    if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake * cell * 0.6, (Math.random() - 0.5) * shake * cell * 0.6); shake = Math.max(0, shake - dt * 2.5); }
    const windNow = 0;
    const top = Math.floor(B - FR + y0 / cell) - 1, rows = Math.ceil((y1 - y0) / cell) + 3;
    const city = !run.bonus && top < STREET_ROW && cityTop(), cox = -camX * cell, coy = Math.round((FR - B) * cell);
    if (city) CITY.draw(cox, coy, cell, B, t, { x: view.x0, y: Math.round((top - B + FR) * cell), w: view.x1 - view.x0, h: Math.round((STREET_ROW - top) * cell) });
    for (let i = 0; i < rows; i++) drawRow(top + i, Math.round((top + i - B + FR) * cell), t, windNow);
    if (!run.bonus && top < STREET_ROW + 2 && cityTop()) CITY.front(cox, coy, cell, t);
    if (!run.bonus) drawAds(top, rows, t);
    if (!run.bonus) level.sections.forEach(function (s) {
      if (!s.turn) return;
      if (s.startRow + 2 > top - 4 && s.startRow + 2 < top + rows + 4) drawFan(s, s.startRow + 2, s.turn > 0 ? 1 : -1, t);
      if (s.endRow - 2 > top - 4 && s.endRow - 2 < top + rows + 4) drawFan(s, s.endRow - 2, s.turn > 0 ? -1 : 1, t);
    });
    if (!run.bonus) for (let i = 0; i < level.saws.length; i++) {   // saws swinging in time, level with his feet
      const sw = level.saws[i];
      if (beat < sw.a - 1.5 || beat > sw.b) continue;
      const live = beat >= sw.a, x = (sw.base + sw.amp * Math.sin(2 * Math.PI * (beat - sw.ph) / sw.per) + 0.5 - camX) * cell, y = (FR - 0.5) * cell, rad = cell * 0.48;
      ctx.globalAlpha = live ? 1 : 0.25 + 0.25 * Math.sin(t * 25);
      ctx.fillStyle = 'rgba(255,79,109,0.35)'; ctx.fillRect(((sw.base - sw.amp) - camX) * cell, y - 1, (sw.amp * 2 + 1) * cell, 3);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 14);
      // each world has its own thing swinging at him: a saw, a ball, a throwing star or a crate, in its colours
      const kind = LF % 4, hot = LF ? WF.w.neon : '#ff4f6d', pts = kind === 2 ? 8 : 16, inner = kind === 2 ? 0.35 : 0.6;
      ctx.fillStyle = '#0a0812'; ctx.beginPath(); ctx.arc(0, 0, rad * 0.95, 0, 7); ctx.fill();
      ctx.fillStyle = LF ? shade(WF.w.block, 1.5) : '#c9ccd6'; ctx.beginPath();
      if (kind === 1) ctx.arc(0, 0, rad * 0.88, 0, 7);
      else if (kind === 3) ctx.rect(-rad * 0.7, -rad * 0.7, rad * 1.4, rad * 1.4);
      else for (let k = 0; k < pts; k++) { const a = k * 2 * Math.PI / pts, rr = rad * (k % 2 ? inner : 1); ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hot;
      if (kind === 3) { ctx.fillRect(-rad * 0.7, -rad * 0.1, rad * 1.4, rad * 0.2); ctx.fillRect(-rad * 0.1, -rad * 0.7, rad * 0.2, rad * 1.4); }
      else ctx.fillRect(-rad * 0.22, -rad * 0.22, rad * 0.44, rad * 0.44);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (!run.bonus && level.spec.defs && state !== 'title') drawFoes(t, top, rows);
    if (state !== 'dead' && state !== 'title') drawFrank(t, (sec.mode === 'slide' && !run.bonus) || ducked);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.vy += 40 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.fillStyle = p.c; ctx.fillRect((p.x - camX) * cell, (FR + p.y) * cell, p.s * cell, p.s * cell);
    }
    ctx.restore();
  }


  function drawHud(t) {
    const beat = run.beat, sec = level.sectionAt(beat), T = TH[sec.theme];
    const prog = Math.max(0, Math.min(1, beat / level.totalBeats));
    // the top of the screen is one line: the coins, a plain progress bar with the percentage, and pause
    // (everything that is words keeps to the edges: the top line here, and the foot of the screen. Nothing is written where he is or where he is going.)
    const cs = String(run.count), bx = 44 + cs.length * 10, bw = W - bx - 164, by = sat + 22;
    drawToken(WF, 18, by + 5, 8, t);
    text(cs, 32, by + 6, 15, WF.tokenColor, 'left');
    ctx.fillStyle = 'rgba(6,3,18,0.75)'; cut(bx - 3, by - 3, bw + 6, 16, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, bw, 10);
    ctx.fillStyle = T.hud; ctx.fillRect(bx, by, bw * prog, 10); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(bx, by, bw * prog, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + bw * prog - 2, by - 2, 3, 14);
    text(Math.floor(prog * 100) + '%', bx + bw + 8, by + 6, 15, '#fff', 'left');
    // which attempt this is, for a moment as it starts: small, in the top line
    if (state === 'play' && beat - beat0 < 2.5) { ctx.globalAlpha = Math.min(1, (2.5 - (beat - beat0)) * 2); text('ATTEMPT ' + attempts, bx + bw / 2, by + 26, 13, '#fff'); ctx.globalAlpha = 1; }
    // pause
    ibtn('pause', W - 54, sat + 6, 44, pause, 'rgba(14,10,32,0.85)', { name: 'PAUSE' });
    // record: a red dot; while it films, a blinking square and the seconds. A minute at most.
    if ((state === 'play' || state === 'dead') && !BOT) {
      button('', W - 104, sat + 6, 44, 44, function () { if (!rec) recStart(); else if (state === 'play') pause(); else { recStop(); toast('CLIP READY: PAUSE TO SAVE IT'); } }, 'rgba(14,10,32,0.85)', { name: 'RECORD' });
      ctx.fillStyle = '#ff3d5a';
      if (!rec) { ctx.beginPath(); ctx.arc(W - 82, sat + 28, 9, 0, 7); ctx.fill(); }
      else {
        const secs = (performance.now() - rec.at) / 1000;
        if (Math.sin(t * 8) > -0.3) ctx.fillRect(W - 90, sat + 20, 16, 16);
        text(String(Math.floor(secs)), W - 82, sat + 60, 12, '#ff3d5a');
        if (secs > 60) { recStop(); toast('CLIP READY: PAUSE TO SAVE IT'); }
      }
    }
    if (state !== 'paused') toastAt(t, H - sab - 96, 3);
    // one small line under the bar, above his head: a hidden thing just found, else what a new kind of stretch asks of him (its first beats only)
    if (secretNote && t - secretNote.t < 3.2) text(secretNote.s, W / 2, sat + 62, fit(secretNote.s, 15), GOLD);
    else if (state === 'play' && run.bonus && run.bonus.name) text(run.bonus.name, W / 2, sat + 62, fit(run.bonus.name, 15), GOLD);
    else if (state === 'play' && sec.tip && !run.bonus && beat - sec.start < 6 && beat >= sec.start) { ctx.globalAlpha = Math.min(1, (6 - (beat - sec.start)) * 1.5); text(sec.tip, W / 2, sat + 62, fit(sec.tip, 14), '#fff'); ctx.globalAlpha = 1; }

    text(run.bonus || sec.mode === 'slide' ? '<  SLIDE  >' : '<  TUMBLE  >', W / 2, H - sab - 26, 16, 'rgba(255,255,255,0.55)');
    // the count: how many taps the next gate still needs, which way, and whether it is time yet
    const g = level.gates[run.gi];
    if (state === 'play' && !run.bonus && sec.mode !== 'wind' && g && g.n && helping(g) && g.row - run.B < H / cell) {
      const left = g.n - run.taps, wait = beat < g.go, arrows = left > 0 ? new Array(left + 1).join(g.dir > 0 ? '>' : '<') : '';
      const s = left > 0 ? (g.dir > 0 ? left + ' ' + arrows : arrows + ' ' + left) : left === 0 ? 'HOLD' : 'TOO MANY';
      ctx.globalAlpha = wait ? 0.4 : 1;
      text(s, W / 2, sat + 92, left > 0 ? 44 : 30, left < 0 ? '#ff4f6d' : left === 0 ? '#a6ff3d' : wait ? '#fff' : T.hud);
      ctx.globalAlpha = 1;
      if (wait && left > 0) text('NOT YET', W / 2, sat + 126, 14, '#ffd23f');
    }
    const mz = !run.bonus && level.zoneAt(level.mirrors, beat);      // left and right swapped
    if (mz) {
      ctx.fillStyle = '#ff3df2'; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 10);
      ctx.fillRect(0, 0, 6, H); ctx.fillRect(W - 6, 0, 6, H);
      ctx.globalAlpha = 1;
      text('>  SWAPPED  <', W / 2, sat + 92, 26, '#ff3df2');
    } else if (!run.bonus && level.zoneAt(level.mirrors, beat + (level.spec.defs ? C.TELL.flip : 1.5)) && Math.sin(t * 20) > 0) text('SWAP!', W / 2, sat + 92, 32, '#ff3df2');
    if (banner && t - banner.t < 2.4) {
      ctx.globalAlpha = Math.min(1, (2.4 - (t - banner.t)) * 2);
      neon(banner.name, W / 2, H - sab - 150, fit(banner.name, 32), T.hud, 'center', 10);
      if (banner.hint) text(banner.hint, W / 2, H - sab - 116, fit(banner.hint, 16), '#fff');
      ctx.globalAlpha = 1;
    }
    if (state === 'dead') {                                         // what got him: it slams in under where he was
      const how = deadHow === 'bonk' ? 'BONK' : deadHow === 'zap' ? 'SAWED' : deadHow === 'crash' ? 'CRASH' : DEATHS[deadHow] || 'SPLAT', dy = Math.max(under() + 40, H * 0.46), pop = back((0.4 - (deadUntil - t)) / 0.14);
      ctx.save(); ctx.translate(W / 2, dy); ctx.rotate(-0.05); ctx.scale(pop, pop); neon(how, 0, 0, fit(how, 60), RED); ctx.restore();
      text(SET.easy && run.checkpoint > 0 ? 'BACK A LITTLE' : 'BACK TO THE TOP', W / 2, dy + 48, 17, '#fff');
      if (run.count) text('+' + run.count + ' ' + WF.token + ' BANKED', W / 2, dy + 74, fit('+' + run.count + ' ' + WF.token + ' BANKED', 15), WF.tokenColor);
    }
  }

  const DEATHS = { burn: 'TOASTED', fire: 'TOASTED', drip: 'SPIKED', bat: 'BATTED', wisp: 'ZAPPED', grab: 'GRABBED' };   // what got him, in a written-out level
  // the wallet, top right: every level's tokens count the same
  function drawWallet(t, dy) {
    const s = String(Acct.wallet()), w = 44 + s.length * 11, x = W - 12 - w, y = sat + 14 + (dy || 0);
    ctx.fillStyle = 'rgba(8,4,20,0.8)'; cut(x, y, w, 36, 8); ctx.fill(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.globalAlpha = 0.75; cut(x + 1, y + 1, w - 2, 34, 8); ctx.stroke(); ctx.globalAlpha = 1;
    drawToken(FRANKS[0], x + 18, y + 18, 8, t);
    text(s, x + w - 10, y + 19, 18, GOLD, 'right');
  }
  // every menu's main button is the same height
  const BH = 56;
  function menuW() { return Math.min(320, W - 40); }
  // the top of every screen but the main page: the way back, what the screen is, and a smaller line over that
  // (side: how much room to leave each side of the words, when something wider than the back button is up there)
  function header(title, over, backFn, side) {
    ibtn('back', 12, sat + 10, 44, backFn, INDIGO, { name: 'BACK' });
    if (over) text(over, W / 2, sat + 16, 12, SOFT);
    neon(title, W / 2, sat + (over ? 42 : 32), fit(title, 28, W - 2 * (side || 68)), GOLD, 'center', 10);
  }
  // behind every menu: the scene of the level whose card is in front, alive and dimmed
  function backdrop(t, a) {
    const lv = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, Math.round(lvScroll)))] || LEVELS[0];
    levelArt(lv, 0, 0, W, H, t, true);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(7,4,22,' + Math.min(1, a + 0.12) + ')'); g.addColorStop(0.5, 'rgba(7,4,22,' + a + ')'); g.addColorStop(1, 'rgba(7,4,22,' + Math.min(1, a + 0.2) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // a small Frank on a button, standing at x, y
  function miniFrank(x, y, s, i) { ctx.save(); ctx.translate(x, y); drawBody(s, FRANKS[i], 0); ctx.restore(); }

  // ---------- settings: kept on this device ----------
  // The difficulties. Easy sends a fall back only to the start of the stretch (and pays half the coins); hard and
  // insane play the whole level faster, music and all, and score more for it.
  const DIFFS = [
    { name: 'EASY', speed: 1, score: 1, col: '#5fa83a', note: ['EASY: a fall sends you back to the start', 'of the stretch, and coins count half.'] },
    { name: 'NORMAL', speed: 1, score: 1, col: '#e0a100', note: ['NORMAL: a fall sends you back to the top.', ''] },
    { name: 'HARD', speed: 1.2, score: 1.5, col: '#e0562c', note: ['HARD: everything is a fifth faster.', 'Scores count one and a half times.'] },
    { name: 'INSANE', speed: 1.4, score: 2, col: '#c2185b', note: ['INSANE: everything is 40% faster.', 'Scores count double.'] },
  ];
  const SET = { music: true, sfx: true, buzz: true, easy: false, diff: -1 };
  Object.assign(SET, SV.settings());                               // what was kept, with the usual value for anything missing or senseless
  if (!DIFFS[SET.diff]) SET.diff = SET.easy ? 0 : 1;               // from before there were four
  SET.easy = SET.diff === 0;
  A.set('music', SET.music); A.set('sfx', SET.sfx);
  let setBack = 'title';
  function flip(k) {
    SET[k] = !SET[k];
    localStorage.setItem('fff.set', JSON.stringify(SET));
    if (k === 'music' || k === 'sfx') A.set(k, SET[k]);
  }
  // Pick the difficulty to play on. It changes the speed of the level, so an attempt that is under way ends there.
  function setDiff(i) {
    if (!DIFFS[i] || i === SET.diff) return;
    if (state === 'settings' && setBack === 'paused') { toLevels(); setBack = 'title'; state = 'settings'; }
    SET.diff = i; SET.easy = SET.diff === 0;
    localStorage.setItem('fff.set', JSON.stringify(SET));
    level.bpm = level.baseBpm * DIFFS[SET.diff].speed;
  }
  function openSettings() { setBack = state; state = 'settings'; }
  // THE DIFFICULTY PICKER: four buttons side by side, the one in use lit in its colour. It is on every level's card
  // (and in the settings): what it does to the fall, the coins and the score is said in one line under it.
  const MODE_SAYS = ['FALL BACK ONLY A LITTLE · COINS COUNT HALF', 'A FALL SENDS YOU BACK TO THE TOP', 'A FIFTH FASTER · SCORES COUNT x1.5', '40% FASTER · SCORES COUNT DOUBLE'];
  function modePicker(x, y, w, h) {
    const gap = 5, sw = (w - gap * 3) / 4;
    DIFFS.forEach(function (d, i) {
      const on = i === SET.diff;
      button(d.name, x + i * (sw + gap), y, sw, h, function () { setDiff(i); haptic(); }, on ? d.col : shade(d.col, 1.25), { ghost: !on, hot: on, size: 14, name: 'MODE ' + d.name, ink: '#e6e0ff' });
    });
  }
  // a row of the settings: an icon, what it is, and on the right how it stands
  function setRow(label, ic, x, y, w, h, fn, on) {
    button('', x, y, w, h, fn, on === false ? SLATE : on === true ? TEAL : INDIGO, { ghost: true, on: on === true, name: label });
    icon(ic, x + 26, y + h / 2, Math.min(22, h * 0.5), on === false ? '#9d97bd' : '#ffffff');
    text(label, x + 50, y + h / 2 + 1, fit(label, 16, (w - 130) * 1.5), on === false ? SOFT : '#ffffff', 'left');
    if (on === undefined) { icon('right', x + w - 22, y + h / 2, 12, SOFT); return; }
    const sx = x + w - 62, sy = y + h / 2 - 11;                       // the switch
    ctx.fillStyle = INK; cut(sx - 2, sy - 2, 52, 26, 6); ctx.fill(); ctx.fillStyle = on ? '#1f8f8f' : '#2a2540'; cut(sx, sy, 48, 22, 5); ctx.fill();
    ctx.fillStyle = on ? LIME : '#9d97bd'; ctx.fillRect(on ? sx + 28 : sx + 3, sy + 3, 17, 16);
    text(on ? 'ON' : 'OFF', on ? sx + 14 : sx + 34, sy + 12, 10, on ? '#ffffff' : SOFT);
  }
  function drawSettings(t) {
    backdrop(t, 0.8);
    header('SETTINGS', '', function () { state = setBack; });
    const w = Math.min(380, W - 28), x = W / 2 - w / 2, top = sat + 70, room = H - sab - 14 - top, k = Math.max(0.62, Math.min(1.16, room / 508)), rh = Math.round(48 * k), gap = Math.round(8 * k);
    const leave = function () { A.pause(false); A.stop(); };       // out of a paused game for good
    let y = top;
    setRow('MUSIC', 'note', x, y, w, rh, function () { flip('music'); }, !!SET.music); y += rh + gap;
    setRow('SOUND EFFECTS', 'sfx', x, y, w, rh, function () { flip('sfx'); }, !!SET.sfx); y += rh + gap;
    setRow('VIBRATION', 'buzz', x, y, w, rh, function () { flip('buzz'); haptic(); }, !!SET.buzz); y += rh + gap + 4;
    text('DIFFICULTY TO PLAY ON', x + 2, y + 7, 12, SOFT, 'left'); y += 18;
    modePicker(x, y, w, Math.max(40, rh - 2)); y += Math.max(40, rh - 2) + 8;
    text(MODE_SAYS[SET.diff], W / 2, y + 7, fit(MODE_SAYS[SET.diff], 12, w), DIFFS[SET.diff].col === '#c2185b' ? '#ff7ab0' : shade(DIFFS[SET.diff].col, 1.5)); y += 22 + gap;
    setRow('PROFILE', 'user', x, y, w, rh, openProfile); y += rh + gap;
    setRow('HOW TO PLAY', 'help', x, y, w, rh, function () { leave(); state = 'howto'; }); y += rh + gap;
    setRow('WATCH THE INTRO', 'film', x, y, w, rh, function () { leave(); introT = -1; introFell = false; state = 'intro'; }); y += rh + gap + 4;
    button('DONE', x, H - sab - 14 - Math.max(44, rh), w, Math.max(44, rh), function () { state = setBack; }, PINK, { icon: 'check' });   // at the foot of the screen, under a thumb
  }

  // The main page: the levels, one at a time, swiped sideways or stepped through with the arrows. A level has a
  // card (levelPage): its picture, alive, with its rating and a heart on it; its name; how well this player has
  // done on it (best fall and best score); the difficulty to play on; and PLAY. Behind the card is the same level's
  // scene, dimmed. It lays itself out for upright and wide screens, tall and short ones.
  let lvScroll = 0, lvTarget = 0;
  const SOON = 1;                                                   // one page after the levels: players' levels, and how to build one
  // a level's picture: the sky, the skyline, the street and the open manhole, with your Frank on his way in
  // (bare: the picture alone, as wide as it likes, with nobody falling: what is behind a menu)
  function levelArt(lv, x, y, w, ph, t, bare) {
    const wd = (lv.world || FRANKS[lv.frank]).w, u = bare ? Math.max(w / 14, ph / 22) : w / 14, gy = y + ph - u * 1.2;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, ph); ctx.clip();
    if (!lv.world && lv.frank === 0) {
      // ELM STREET: the city itself (CITY), small enough that the billboard, the moon and the street are all in the picture
      const cu = bare ? Math.max(cell, Math.min(w / 12, ph / 18)) : Math.max(6, Math.min(w / 11.7, ph / 13.4)), below = bare ? Math.max(2.5, ph / cu * 0.14) : Math.max(1.5, Math.min(2.6, ph / cu - 11.9));
      const ox = x + w / 2 - (C.START_COL + 0.5) * cu, oy = y + ph - (STREET_ROW + below) * cu, b = CITY.BB;
      CITY.card(x, y, w, ph, ox, oy, cu, t);
      CITY.front(ox, oy, cu, t);
      boardFace(sponsor(), ox + b.x * cu, oy + b.y * cu, b.w * cu, b.h * cu, t);
      if (!bare) { ctx.translate(x + w / 2, y - cu * 2 + (t * 0.5 % 1) * (ph + cu * 4)); ctx.rotate(Math.sin(t * 5) * 0.12); drawBody(cu * 0.95, FRANKS[who], t); }
      ctx.restore();
      return;
    }
    if (lv.world) {
      // one of the later levels: a strip of daylight and the crust of the world on top, and under it the dark he
      // drops into: teeth out of the walls, eyes, and the glow coming up
      const cy = y + ph * 0.24;
      ctx.fillStyle = wd.sky; ctx.fillRect(x, y, w, ph);
      for (let c = 0; c < 14; c++) { const bh = (1 + 2.2 * Math.abs(Math.sin(c * 0.9)) + hash(c, 41)) * u * 0.4; ctx.fillStyle = wd.sil; ctx.fillRect(x + c * u, cy - bh, u + 1, bh); }
      ctx.fillStyle = wd.bg; ctx.fillRect(x, cy, w, y + ph - cy);
      const glow = ctx.createLinearGradient(0, cy, 0, y + ph); glow.addColorStop(0, 'rgba(255,90,60,0)'); glow.addColorStop(1, 'rgba(255,90,60,0.4)');
      ctx.fillStyle = glow; ctx.fillRect(x, cy, w, y + ph - cy);
      for (let k = 0; k < 6; k++) {                                 // the teeth, from one wall and then the other
        const ty = cy + u * (1.9 + k * 1.7), len = u * (4.2 + hash(k, 43) * 2.6), left = k % 2 === 0, tx = left ? x : x + w - len;
        if (ty > y + ph) break;
        ctx.fillStyle = '#0a0812'; ctx.fillRect(tx - 2, ty - 2, len + 4, u * 0.8 + 4);
        ctx.fillStyle = wd.block; ctx.fillRect(tx, ty, len, u * 0.8); ctx.fillStyle = shade(wd.block, 1.35); ctx.fillRect(tx, ty, len, u * 0.14);
        tri(left ? tx + len : tx, ty, left ? tx + len + u * 0.7 : tx - u * 0.7, ty + u * 0.4, left ? tx + len : tx, ty + u * 0.8, BONE);
        for (let j = 0; j < len / u - 0.5; j++) tri(tx + j * u + u * 0.2, ty + u * 0.8, tx + j * u + u * 0.5, ty + u * 1.15, tx + j * u + u * 0.8, ty + u * 0.8, BONE);
      }
      for (let k = 0; k < 4; k++) {                                 // eyes in the dark
        const ex = x + w * (0.14 + hash(k, 44) * 0.72), ey = cy + (y + ph - cy) * (0.3 + hash(k, 45) * 0.6);
        if (Math.sin(t * 1.3 + k * 2) > -0.85) { ctx.fillStyle = '#ff3d5a'; ctx.fillRect(ex, ey, u * 0.22, u * 0.16); ctx.fillRect(ex + u * 0.4, ey, u * 0.22, u * 0.16); }
      }
      for (let k = 0; k < 12; k++) { ctx.fillStyle = wd.neon; ctx.globalAlpha = 0.6; ctx.fillRect(x + hash(k, 46) * w, y + ph - ((t * (14 + k) + hash(k, 47) * 200) % (ph - (cy - y))), 3, 3); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = wd.ground; ctx.fillRect(x, cy, w, u * 0.9); ctx.fillStyle = wd.neon; ctx.fillRect(x, cy, w, 3);
      ctx.fillStyle = '#000'; ctx.fillRect(x + w / 2 - u, cy, u * 2, u * 0.9);
      if (!bare) { ctx.translate(x + w / 2 + Math.sin(t * 2.2) * u * 1.2, y - u * 2 + (t * 0.55 % 1) * (ph + u * 4)); ctx.rotate(Math.sin(t * 5) * 0.12); drawBody(u * 0.85, FRANKS[who], t); }
      ctx.restore();
      return;
    }
    ctx.fillStyle = wd.sky; ctx.fillRect(x, y, w, ph);
    for (let c = 0; c < 14; c++) {
      const bh = (2 + Math.floor(hash(c, 41) * 5)) * u * 0.55;
      ctx.fillStyle = wd.sil; ctx.fillRect(x + c * u, gy - bh, u + 1, bh);
      for (let k = 0; k < bh / (u * 0.55) - 1; k++) if (hash(c, k + 50) < 0.4) { ctx.fillStyle = hash(c, k + 50) < 0.2 ? '#ffd23f' : '#35e8ff'; ctx.fillRect(x + c * u + u * 0.3, gy - bh + u * 0.15 + k * u * 0.55, u * 0.4, u * 0.3); }
    }
    ctx.fillStyle = wd.ground; ctx.fillRect(x, gy, w, u * 1.2);
    ctx.fillStyle = wd.neon; ctx.fillRect(x, gy, w, 3);
    ctx.fillStyle = '#000'; ctx.fillRect(x + w / 2 - u, gy, u * 2, u * 1.2);
    if (!bare) { ctx.translate(x + w / 2, y - u * 2 + (t * 0.55 % 1) * (ph + u * 4)); ctx.rotate(Math.sin(t * 5) * 0.12); drawBody(u * 0.85, FRANKS[who], t); }
    ctx.restore();
  }
  // a wide bar with its label over it and its value in the middle: how far he has got, his best score
  // a tile with a small label and a big value: how far he has got (with a bar along its foot), his best score
  function stat(label, value, x, y, w, h, col, frac) {
    ctx.fillStyle = 'rgba(6,3,18,0.78)'; cut(x, y, w, h, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1; cut(x + 0.5, y + 0.5, w - 1, h - 1, 7); ctx.stroke();
    const small = h < 44;
    text(label, x + 10, y + (small ? h / 2 : 13), small ? 10 : 11, SOFT, 'left');
    text(value, x + w - 10, y + (small ? h / 2 : h * 0.62) + 1, fit(value, small ? 17 : 21, (w - (small ? label.length * 7 + 26 : 20)) * 1.5), col, 'right');
    if (frac !== undefined) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(x + 8, y + h - 7, w - 20, 3);
      if (frac > 0) { ctx.fillStyle = col; ctx.fillRect(x + 8, y + h - 7, (w - 20) * Math.min(1, frac), 3); }
    }
  }
  // an arrow at the side of the card, to the level before or after
  function arrow(cx, cy, s, dir, fn) {
    const bw = Math.max(44, s * 1.6), bh = Math.max(64, s * 3);
    button('', cx - bw / 2, cy - bh / 2, bw, bh, fn, 'rgba(10,6,26,0.72)', { name: dir < 0 ? 'PREVIOUS LEVEL' : 'NEXT LEVEL' });
    icon(dir < 0 ? 'left' : 'right', cx, cy, s, '#ffffff');
  }
  // behind the main page: deep purple, with big faint squares drifting across
  function titleBack(t) { backdrop(t, 0.8); }
  // ONE LEVEL'S CARD. The picture of the level, alive, with its rating (the face), its heart, its tags (NEW, the
  // price, OWNED) and the leaderboard and share buttons on it; then its name, how well this player has done (BEST
  // FALL, BEST SCORE), THE DIFFICULTY TO PLAY ON, and PLAY (or, for a level still to buy, TRY FREE and UNLOCK).
  // geo is where things go on this screen (drawTitle works it out): upright the picture is on top; on a wide
  // screen it is the left of the card.
  let cardRect = null, cardAt = -1, cardT = 0, lvSpace = 0;         // where the picture of the card in front is (a tap on it plays); which card that is and since when; how far apart the cards are
  function levelPage(i, ox, geo, t) {
    const lv = LEVELS[i], front = Math.abs(i - lvScroll) < 0.4, x = geo.x + ox, y = geo.y, w = geo.cw, h = geo.ch, tight = geo.tight;
    const edge = lv ? (lv.world || FRANKS[lv.frank]).w.neon : GOLD, lit = rgb(edge)[0] * 0.3 + rgb(edge)[1] * 0.59 + rgb(edge)[2] * 0.11 < 110 ? '#ffffff' : edge;
    ctx.globalAlpha = front ? 1 : 0.6;
    panel(x, y, w, h, lit, { cut: 16, glow: front ? 1.3 : 0 });
    if (!lv) {                                                      // the page after the last level: more of them
      const bw = Math.min(320, w - 32), bh = Math.min(BH, h * 0.2), cy = y + h * (geo.wide ? 0.3 : 0.26);
      for (let k = 0; k < 3; k++) { const cx = x + w / 2 + (k - 1) * Math.min(70, w * 0.2), s = Math.min(40, h * 0.12) * (k === 1 ? 1.25 : 1); ctx.globalAlpha = (front ? 1 : 0.6) * (k === 1 ? 1 : 0.75); face([1, 3, 5][k], cx, cy - s * 0.6 + Math.sin(t * 2 + k * 2) * 3, s); }
      ctx.globalAlpha = front ? 1 : 0.6;
      neon('MORE LEVELS', x + w / 2, cy + Math.min(40, h * 0.12) + 14, fit('MORE LEVELS', Math.min(32, h * 0.13), w * 0.84), GOLD, 'center', 10);
      text('made by players, with Claude', x + w / 2, cy + Math.min(40, h * 0.12) + 42, fit('made by players, with Claude', 14, w * 0.86), SOFT);
      const y0 = geo.wide ? y + h * 0.6 : y + h * 0.56;
      if (front) {
        if (geo.wide) { button('PLAY THEIR LEVELS', x + w / 2 - bw - 8, y0, bw, bh, openBrowse, TEAL, { icon: 'grid' }); button('BUILD YOUR OWN', x + w / 2 + 8, y0, bw, bh, openBuild, PINK, { icon: 'build' }); }
        else { button('PLAY THEIR LEVELS', x + w / 2 - bw / 2, y0, bw, bh, openBrowse, TEAL, { icon: 'grid' }); button('BUILD YOUR OWN', x + w / 2 - bw / 2, y0 + bh + 14, bw, bh, openBuild, PINK, { icon: 'build' }); }
      }
      const sy = Math.min(y + h - 22, (geo.wide ? y0 + bh : y0 + bh * 2 + 14) + 34);
      const soon = 'MORE OF FRANK\'S OWN LEVELS COMING SOON', sfs = fit(soon, 12, w - 70);
      icon('lock', x + w / 2 - soon.length * sfs * 0.3 - 6, sy, 13, GOLD); text(soon, x + w / 2 + 10, sy + 1, sfs, GOLD);
      ctx.globalAlpha = 1;
      return;
    }
    // a paid level: NEW and its price on the picture until it is theirs; then OWNED, and how many of its hidden things they have found
    const pm = lv.paid ? Acct.me.levels[lv.id] || {} : null, mine = !!pm && !!pm.owned, sub = mine ? 'SECRETS ' + pm.found.length + ' OF ' + pm.secrets : lv.sub, on = Acct.hearted(lv.id);
    const unlockIt = function () { openUnlock(lv); }, playIt = function () { playAt(i); };
    const pw = geo.wide ? Math.min(h * 1.15, w * 0.46) : w, ax = x + 5, ay = y + 5, aw = pw - (geo.wide ? 5 : 10), ah = (geo.wide ? h : h - geo.info) - 10;
    // ---- the picture, and what is on it ----
    levelArt(lv, ax, ay, aw, ah, t);
    ctx.strokeStyle = 'rgba(8,4,20,0.9)'; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, aw, ah);
    if (front) cardRect = { x: ax, y: ay, w: aw, h: ah };
    const rh = tight ? 32 : 38;
    rating(ratingOf(lv), ax + 8, ay + 8, rh);
    const hs = String(Acct.hearts(lv.id)), hw = 46 + hs.length * 10;
    if (front) button('', ax + aw - hw - 8, ay + 8, hw, 44, function () { Acct.heart(lv.id); haptic(); }, on ? RED : '#8d86ad', { ghost: true, on: on, name: 'HEART' });
    icon('heart', ax + aw - hw + 10, ay + 30, 15, on ? RED : '#b9b4d0'); text(hs, ax + aw - 18, ay + 31, 15, on ? '#ff8fa3' : '#fff', 'right');
    if (pm) { const cy = ay + ah - 34, cw = chip(mine ? 'OWNED' : 'NEW', ax + 8, cy, 26, mine ? '#5fd17a' : GOLD); if (!mine) chip(Acct.levelPrice(lv.id), ax + 16 + cw, cy, 26, PINK, '#fff'); }
    if (front) { ibtn('trophy', ax + aw - 52, ay + ah - 52, 44, function () { openBoard(lv); }, AMBER, { name: 'TOP' }); ibtn('share', ax + aw - 102, ay + ah - 52, 44, function () { shareLevel(lv); }, CYAN, { name: 'SHARE' }); }
    // ---- its name, how he has done, the difficulty to play on, and PLAY ----
    const ix = geo.wide ? x + pw + 14 : x + 14, iw = geo.wide ? w - pw - 28 : w - 28, ih = geo.wide ? h - 20 : geo.info - 12, best = bestOf(lv.key), score = scoreOf(lv.key), up = ease((t - cardT) / 0.8);
    let cy = geo.wide ? y + 10 : y + h - geo.info + 2;
    const ns = fit(lv.name, tight ? 24 : 28, iw * 1.02);
    text(lv.name, ix + iw / 2, cy + ns * 0.62, ns, '#fff'); cy += ns * 1.2 + 2;
    if (!tight) { text(sub, ix + iw / 2, cy + 8, fit(sub, 13, iw), lit); cy += 24; } else cy += 4;
    const sh = tight ? 38 : 48, pb = Math.min(BH, tight ? 48 : BH), mhh = 44;
    stat(best >= 100 ? 'CLEARED' : 'BEST FALL', Math.round(best * (front ? up : 1)) + '%', ix, cy, iw / 2 - 4, sh, best >= 100 ? LIME : CYAN, best / 100 * (front ? up : 1));
    stat('BEST SCORE', Math.round(score * (front ? up : 1)).toLocaleString('en-US'), ix + iw / 2 + 4, cy, iw / 2 - 4, sh, GOLD);
    cy += sh + (tight ? 8 : 12);
    const by = geo.wide ? Math.max(cy + mhh + 30, y + h - pb - 16) : y + h - pb - 16;                // PLAY sits on the foot of the card
    if (!tight || by - cy > mhh + 24) { text('DIFFICULTY', ix + 2, cy + 6, 11, SOFT, 'left'); if (by - cy > mhh + 36) text(MODE_SAYS[SET.diff], ix + iw, cy + 6, fit(MODE_SAYS[SET.diff], 10, (iw - 84) * 1.02), '#d8d2f0', 'right'); cy += 16; }
    if (front) modePicker(ix, cy, iw, mhh);
    else DIFFS.forEach(function (d, k) { ctx.fillStyle = k === SET.diff ? d.col : 'rgba(20,13,46,0.9)'; cut(ix + k * (iw + 5) / 4, cy, (iw - 15) / 4, mhh, 8); ctx.fill(); });
    if (front && pm && !mine) { button('TRY FREE', ix, by, iw * 0.42, pb, playIt, TEAL, { icon: 'play' }); button('UNLOCK ' + Acct.levelPrice(lv.id), ix + iw * 0.42 + 10, by, iw * 0.58 - 10, pb, unlockIt, AMBER, { icon: 'lock', hot: true }); }
    else if (front) button('PLAY', ix, by, iw, pb, playIt, PINK, { icon: 'play', hot: true, size: 24 });
    ctx.globalAlpha = 1;
  }
  function drawTitle(t) {
    const wide = W > H * 1.15, n = LEVELS.length + SOON, u = Acct.me.user, at = Math.max(0, Math.min(n - 1, Math.round(lvScroll)));
    if (at !== cardAt) { cardAt = at; cardT = t; }
    backdrop(t, wide ? 0.76 : 0.66);
    ibtn('gear', 12, sat + 10, 44, openSettings, INDIGO, { name: 'SETTINGS' }); drawWallet(t);
    // the name of the game: two lines upright, one line on a wide screen
    let headB = sat + 76;
    if (wide) { neon('FREE FALL', W / 2 - 6, sat + 32, 20, CYAN, 'right', 6); neon('FRANK', W / 2 + 6, sat + 32, 30, GOLD, 'left', 12); headB = sat + 58; }
    else { neon('F R E E   F A L L', W / 2, sat + 19, 14, CYAN, 'center', 5); neon('FRANK', W / 2, sat + 50, 38, GOLD, 'center', 14); }
    // along the bottom: who you play as, and (no account is needed to play) the pack until it is bought, then the account
    const bh = wide ? Math.max(40, Math.min(50, H * 0.11)) : 50, bw = wide ? Math.min(220, W * 0.2) : Math.min(230, (W - 36) / 2), by = H - sab - 12 - bh;
    const lx = wide ? 16 : W / 2 - bw - 6, rx = wide ? W - 16 - bw : W / 2 + 6;
    button(bw > 150 ? '   FRANKS' : 'FRANKS', lx, by, bw, bh, openSelect, INDIGO);
    if (bw > 150) miniFrank(lx + 30, by + bh / 2 + 1, Math.min(12, bh * 0.23), who);
    if (Acct.me.packs.length || u) button(u ? (u.name || u.email || 'ACCOUNT').split(/[ @]/)[0].toUpperCase() : 'PROFILE', rx, by, bw, bh, openProfile, TEAL, { icon: 'user' });
    else if (window.FFF_PANEL) button('OPEN THE GAME', rx, by, bw, bh, function () { window.FFF_LINK(HOME); }, TEAL);   // inside Claude: the whole game is a tap away
    else button('ALL FRANKS ' + Acct.priceText(), rx, by, bw, bh, buyPack, AMBER);
    const dotY = wide ? by + bh / 2 : by - 15, foot = wide ? by - 12 : by - 28;
    for (let i = 0; i < n; i++) { const on = i === at, dx = W / 2 + (i - (n - 1) / 2) * 18; ctx.fillStyle = on ? CYAN : 'rgba(255,255,255,0.4)'; ctx.fillRect(dx - (on ? 7 : 3), dotY - 3, on ? 14 : 6, 6); }
    // the card in the middle, sized to the room there is: the picture takes what the rest leaves it
    const room = foot - headB - 4, tight = wide ? room < 330 : room < 500, info = tight ? 226 : 290;
    const ch = Math.min(room, wide ? 470 : 760), cw = wide ? Math.min(W - 150, 940) : Math.min(W - 28, 520);
    const geo = { wide: wide, tight: tight, cw: cw, ch: ch, info: info, x: W / 2 - cw / 2, y: headB + 4 + (room - ch) / 2 };
    lvSpace = wide ? W : cw + 14;
    if (!drag) lvScroll += (lvTarget - lvScroll) * 0.22;
    cardRect = null;
    for (let i = 0; i < n; i++) if (Math.abs(i - lvScroll) < 1.5 && i !== at) levelPage(i, (i - lvScroll) * lvSpace, geo, t);
    levelPage(at, (at - lvScroll) * lvSpace, geo, t);
    const as = wide ? 22 : 15, ay = wide ? geo.y + ch / 2 : geo.y + (ch - info) / 2;
    if (at > 0) arrow(wide ? Math.max(34, geo.x / 2) : 24, ay, as, -1, function () { lvTarget = Math.max(0, lvTarget - 1); });
    if (at < n - 1) arrow(wide ? W - Math.max(34, geo.x / 2) : W - 24, ay, as, 1, function () { lvTarget = Math.min(n - 1, lvTarget + 1); });
    toastAt(t, headB + 26);
  }

  // The unlock sheet: what the level is, what it costs, and that paying is once and final. At the wall a taste ends
  // in it keeps to the lower part of the screen, under Frank and the wall he has stopped above.
  function drawUnlock(t, wall) {
    const lv = wall ? LV : unlockLv, m = Acct.me.levels[lv.id] || {}, price = Acct.levelPrice(lv.id), w = Math.min(340, W - 44), x = W / 2 - w / 2;
    const lit = lv.world.w.neon, d = ratingOf(lv), pitch = lv.pitch || [];
    const need = 30 + 46 + 44 + pitch.length * 20 + 10 + BH + 30 + 12 + 50 + 16, top = wall ? Math.max(H * 0.4, (FR + 5.5) * cell) : Math.max(sat + 74, Math.min(sat + 130, (H - need) / 2)), room = H - sab - 10 - top, k = Math.max(0.6, Math.min(1, room / need)), bh = Math.round(BH * k);
    if (!wall) header('UNLOCK', '', function () { state = 'title'; });
    const pw = wall ? Math.min(W - 16, 440) : w + 28;
    panel(W / 2 - pw / 2, top, pw, Math.min(room, need * k + 6), lit, { cut: 16, glow: 1.4 }); ink(W / 2 - pw / 2, top, pw, Math.min(room, need * k + 6));
    let y = top + 22 * k;
    text(wall ? 'THAT WAS THE TASTE OF' : 'THE SECOND LEVEL', W / 2, y, fit('THAT WAS THE TASTE OF', 13), SOFT);
    neon(lv.name, W / 2, y + 32 * k, fit(lv.name, 34 * k, w), GOLD, 'center', 10);
    y += 58 * k;
    const rw = 34 + 14 + Math.max(d.tier.length * 9, 50); rating(d, W / 2 - rw / 2, y, Math.round(34 * k), { plain: true });
    y += 50 * k;
    pitch.forEach(function (s, i) { text(s, W / 2, y + i * 20 * k, fit(s, 14 * k, w + 10), i ? '#fff' : lit); });
    y += pitch.length * 20 * k + 6;
    button(m.owned ? 'PLAY IT' : 'UNLOCK ' + price, x, y, w, bh, m.owned ? function () { playAt(LEVELS.indexOf(lv)); } : function () { buyLevel(lv); }, AMBER, { icon: m.owned ? 'play' : 'lock', hot: true });
    text('One-time purchase. Not refundable.', W / 2, y + bh + 18 * k, fit('One-time purchase. Not refundable.', 13, w), '#fff');
    y += bh + 36 * k;
    const bw = w / 2 - 5, b2 = Math.max(40, Math.round(48 * k));
    if (wall) { button('TASTE IT AGAIN', x, y, bw, b2, function () { begin(0); }, TEAL, { icon: 'again' }); button('LEVELS', x + bw + 10, y, bw, b2, toLevels, INDIGO, { icon: 'grid' }); }
    else button('TRY IT FREE', x, y, w, b2, function () { state = 'title'; playAt(LEVELS.indexOf(lv)); }, TEAL, { icon: 'play' });
    toastAt(t, wall ? top - 22 : sat + 84);
  }

  // A sheet over a paused or a finished fall. It keeps to the part of the screen under Frank: `top` is the first row
  // of pixels it may use, and the picture is only dimmed from there down. (Nothing is ever written over him.)
  function under() { return Math.round(Math.max((FR + 2.5) * cell, H * 0.34)); }
  function shade2(top, a) {
    const g = ctx.createLinearGradient(0, top - 46, 0, top + 30); g.addColorStop(0, 'rgba(6,3,18,0)'); g.addColorStop(1, 'rgba(6,3,18,' + a + ')');
    ctx.fillStyle = g; ctx.fillRect(0, top - 46, W, 76); ctx.fillStyle = 'rgba(6,3,18,' + a + ')'; ctx.fillRect(0, top + 30, W, H - top - 30);
  }
  function drawPaused(t) {
    const top = under(), w = menuW(), x = W / 2 - w / 2, rows = clip ? 4 : 3, room = H - sab - 12 - top, k = Math.max(0.55, Math.min(1, room / (64 + rows * 58))), bh = Math.round(50 * k), g = Math.round(8 * k), half = (w - g) / 2;
    shade2(top, 0.86);
    neon('PAUSED', W / 2, top + 30 * k, fit('PAUSED', 38 * k), GOLD); ink(W / 2 - 110, top + 8 * k, 220, 44 * k);
    let y = top + 62 * k;
    if (clip) { button('SAVE THE CLIP', x, y, w, bh, saveClip, '#e0562c', { icon: 'film' }); y += bh + g; }
    button('RESUME', x, y, w, bh, resume, PINK, { icon: 'play', hot: true }); y += bh + g;
    button('RESTART', x, y, half, bh, function () { begin(0); }, TEAL, { icon: 'again' }); button('LEVELS', x + half + g, y, half, bh, toLevels, INDIGO, { icon: 'grid' }); y += bh + g;
    button('   FRANKS', x, y, half, bh, openSelect, INDIGO, { ghost: true, name: 'FRANKS' }); miniFrank(x + 26, y + bh / 2 + 1, Math.min(11, bh * 0.22), who);
    button('SETTINGS', x + half + g, y, half, bh, openSettings, INDIGO, { ghost: true, icon: 'gear' });
    toastAt(t, top - 24);
  }

  // THE WIN. A flash, then LEVEL CLEAR slams in under Frank (who stays in plain sight at the top), streamers go up
  // from the bottom corners, and a sheet slides up with the score counting, the tries, the coins, the difficulty it
  // was played on, and what to do next.
  let winAt = -9, winScore = 0;
  function drawWin(t) {
    const a = t - winAt, top = under(), w = Math.min(H - top < 330 ? 720 : 380, W - 24), x = W / 2 - w / 2;   // (a low, wide screen: a wide sheet)
    shade2(top, 0.8 * ease(a / 0.4));
    if (a < 0.3) { ctx.fillStyle = 'rgba(255,255,255,' + (0.45 * (1 - a / 0.3)) + ')'; ctx.fillRect(0, 0, W, H); }
    ctx.save(); ctx.beginPath(); ctx.rect(0, top - 20, W, H); ctx.clip();                    // streamers: never up where he is
    if (a < 3.2) for (let i = 0; i < 46; i++) {
      const side = i % 2, vx = (60 + hash(i, 71) * 260) * (side ? -1 : 1), vy = 520 + hash(i, 72) * 520, px = (side ? W : 0) + vx * a, py = H + 10 - vy * a + 420 * a * a, s = 5 + hash(i, 73) * 6;
      ctx.fillStyle = [PINK, CYAN, GOLD, LIME, '#ffffff'][i % 5]; ctx.globalAlpha = Math.max(0, 1 - a / 3.2);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a * (4 + hash(i, 74) * 6) * (side ? 1 : -1)); ctx.fillRect(-s / 2, -s / 4, s, s / 2); ctx.restore();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    const fs = fit('LEVEL CLEAR', Math.min(46, (H - top) * 0.13), W - 28), pop = back(a / 0.4);
    ctx.save(); ctx.translate(W / 2, top + fs * 0.7); ctx.scale(pop, pop); neon('LEVEL CLEAR', 0, 0, fs, GOLD); ctx.restore();
    ink(W / 2 - fs * 3.6, top + fs * 0.12, fs * 7.2, fs * 1.2);
    const ad = sponsor(), sy0 = Math.round(top + fs * 1.5 + 6), most = H - sab - 10 - sy0, strip = most < 240, roomy = most > 360, sh = strip ? Math.min(most, 150) : Math.min(most, (roomy ? 48 : 0) + 52 + 10 + 36 + (ad && ad.url && roomy ? 34 : 0) + 56 * 2 + 46 + 16 + 30);
    const sy = sy0 + (1 - ease((a - 0.2) / 0.5)) * (H - sy0 + 20);
    panel(x, sy, w, sh, CYAN, { cut: 16, glow: 1.4 }); ink(x, sy0, w, sh);
    const ix = x + 14, iw = w - 28, up = ease((a - 0.6) / 1.1), score = Math.round(winScore * up), g = 8;
    let y = sy + 14;
    if (roomy) {                                                    // his world's ending, on two lines
      const words = (FRANKS[who].name + ' ' + WF.w.win).split(' '), lines = ['', ''];
      words.forEach(function (wd) { const k = lines[0].length + wd.length < (FRANKS[who].name.length + WF.w.win.length) / 2 + 4 ? 0 : 1; lines[k] += (lines[k] ? ' ' : '') + wd; });
      lines.forEach(function (ln, k) { text(ln, W / 2, y + 8 + k * 20, fit(ln, 15, iw), '#fff'); });
      y += 48;
    }
    const pm = LV.paid && Acct.me.levels[LV.id], ss = pm ? (secretNote && t - secretNote.t < 6 ? secretNote.s : 'SECRETS ' + pm.found.length + ' OF ' + pm.secrets) : '';   // a paid level: its hidden things (one is for clearing it on insane)
    const th = strip ? 40 : 52, sw = strip ? iw * 0.5 : iw, tw = (sw - g * 2) / 3;
    stat('SCORE', score.toLocaleString('en-US'), ix, y, tw * 1.3, th, GOLD); stat('TRIES', String(attempts), ix + tw * 1.3 + g, y, tw * 0.7, th, CYAN); stat(WF.token.slice(0, 9), '+' + run.count, ix + tw * 2 + g * 2, y, tw, th, WF.tokenColor);
    const share = clip ? function (bx, by2, bw2, bh2) { button('SHARE THE CLIP', bx, by2, bw2, bh2, saveClip, PINK, { icon: 'film', hot: true }); } : function (bx, by2, bw2, bh2) { button('SHARE IT', bx, by2, bw2, bh2, shareWin, PINK, { icon: 'share', hot: true }); };   // filmed it: the clip, else the picture
    const again = function (bx, by2, bw2, bh2) { button('FALL AGAIN', bx, by2, bw2, bh2, function () { begin(0); }, TEAL, { icon: 'again' }); }, board = function (bx, by2, bw2, bh2) { button('LEADERBOARD', bx, by2, bw2, bh2, function () { openBoard(LV); }, AMBER, { icon: 'trophy' }); }, levels = function (bx, by2, bw2, bh2) { button('LEVELS', bx, by2, bw2, bh2, toLevels, INDIGO, { ghost: true, icon: 'grid' }); };
    if (strip) {                                                    // a low, wide screen: the numbers beside the buttons
      const bx = ix + sw + g, bw2 = (iw - sw - g * 2) / 2, bh2 = Math.max(34, Math.min(54, (sh - 28 - g) / 2));
      share(bx, y, bw2, bh2); again(bx + bw2 + g, y, bw2, bh2); board(bx, y + bh2 + g, bw2, bh2); levels(bx + bw2 + g, y + bh2 + g, bw2, bh2);
      text('ON ' + DIFFS[SET.diff].name + (ss ? '   ' + ss : ''), ix + sw / 2, y + th + 18, fit('ON ' + DIFFS[SET.diff].name + (ss ? '   ' + ss : ''), 12, sw), SOFT);
      return;
    }
    y += th + g + 2;
    // what it was played on, the level's rating, and on a paid level its hidden things
    const cw2 = chip('ON ' + DIFFS[SET.diff].name, ix, y, 26, DIFFS[SET.diff].col, '#fff'), d = ratingOf(LV);
    face(d.level, ix + cw2 + 26, y + 13, 22); text(d.tier, ix + cw2 + 44, y + 14, 13, TIER_COL[d.level - 1], 'left');
    if (ss) text(ss, ix + iw, y + 14, fit(ss, 12, (iw - cw2 - 130) * 1.02), GOLD, 'right');
    y += 26 + g + 2;
    // the run's sponsor: one quiet line, and the only ad that can be tapped. (The maker's is its logo, on a small lit plate.)
    const bh = Math.max(40, Math.min(56, (sy + sh - 14 - y - (ad && ad.url && roomy ? 34 : 0) - g * 2 + 8) / 3)), half = (iw - g) / 2;
    if (ad && ad.url && roomy) {
      const go = function () { adTrack('click'); lifted(function () { if (window.FFF_LINK) window.FFF_LINK(ad.url); else window.open(ad.url, '_blank', 'noopener'); }); };
      if (isHouse(ad)) {
        const lh = 22, lw = LOGO.complete && LOGO.naturalWidth ? lh * LOGO.naturalWidth / LOGO.naturalHeight : 66, tw2 = 62, x0 = W / 2 - (tw2 + lw + 34) / 2;
        text('MADE BY', x0 + tw2 / 2, y + 14, 12, SOFT);
        ctx.fillStyle = '#f4f1ff'; cut(x0 + tw2 + 4, y + 1, lw + 12, lh + 4, 5); ctx.fill();
        if (LOGO.complete && LOGO.naturalWidth) { ctx.imageSmoothingEnabled = true; ctx.drawImage(LOGO, x0 + tw2 + 10, y + 3, lw, lh); ctx.imageSmoothingEnabled = false; }
        icon('right', x0 + tw2 + lw + 28, y + 14, 9, SOFT);
        hits.push({ x: x0 - 6, y: y - 8, w: tw2 + lw + 46, h: 44, fn: go, label: 'SPONSOR' });
      } else {
        const s = 'THIS FALL: ' + ad.text + (ad.sub ? '  ' + ad.sub : '') + '  >', fs2 = fit(s, 13, iw);
        text(s, W / 2, y + 14, fs2, ad.color || PINK);
        hits.push({ x: W / 2 - s.length * fs2 * 0.32, y: y - 8, w: s.length * fs2 * 0.64, h: 44, fn: go, label: 'SPONSOR' });
      }
      y += 34;
    }
    share(ix, y, iw, bh); y += bh + g;
    again(ix, y, half, bh); board(ix + half + g, y, half, bh); y += bh + g;
    levels(ix, y, iw, Math.min(bh, 46));
  }

  // the Frank picker: one long row of Franks on blocks, the middle one is yours
  function selSpacing() { return Math.max(60, Math.min(W * 0.2, 130)); }
  function drawSelect(t, dt) {
    if (!drag) selScroll += (selTarget - selScroll) * (1 - Math.exp(-dt * 12));
    const mid = Math.max(0, Math.min(FRANKS.length - 1, Math.round(selScroll))), f = FRANKS[mid], sp = selSpacing();
    if (mid !== selMid) { selMid = mid; A.sfx('tick'); haptic(); }   // click past each Frank: a tick and a tap in the hand
    // the row sticks on each Frank and jumps to the next, like a dial clicking round, instead of gliding
    const off = selScroll - Math.round(selScroll), sc = Math.round(selScroll) + Math.sign(off) * Math.pow(Math.abs(off) * 2, 2.6) / 2;
    const T = themesFor(mid).shaft;
    ctx.fillStyle = shade(T.bg, 0.8); ctx.fillRect(0, 0, W, H);
    const fy = H * 0.56;
    ctx.fillStyle = T.bg; ctx.fillRect(0, fy, W, H - fy);
    for (let i = 0; i < 14; i++) {                                 // a neon floor running off into the dark
      ctx.fillStyle = T.neon; ctx.globalAlpha = 0.12;
      ctx.fillRect(0, fy + i * i * 3, W, 2);
      ctx.fillRect(W / 2 + (i - 6.5) * sp * 0.9 - (((sc % 1) + 1) % 1) * sp * 0.9, fy, 2, H - fy);
    }
    ctx.globalAlpha = 1;
    const vg = ctx.createLinearGradient(0, 0, 0, fy); vg.addColorStop(0, 'rgba(6,3,18,0.7)'); vg.addColorStop(1, 'rgba(6,3,18,0)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, fy);
    ctx.fillStyle = T.neon; ctx.globalAlpha = 0.1 + 0.04 * Math.sin(t * 3); ctx.beginPath(); ctx.moveTo(W / 2 - sp * 0.3, 0); ctx.lineTo(W / 2 + sp * 0.3, 0); ctx.lineTo(W / 2 + sp * 1.1, fy); ctx.lineTo(W / 2 - sp * 1.1, fy); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;   // a spotlight on the one in the middle
    header('PICK YOUR FRANK', (mid + 1) + ' OF ' + FRANKS.length, function () { state = 'title'; setFrank(Acct.status(who) === 'open' ? who : 0); }, W > 520 ? 130 : 0);
    const order = [];
    for (let i = 0; i < FRANKS.length; i++) if (Math.abs(i - sc) < W / sp / 2 + 1.5) order.push(i);
    order.sort(function (a, b) { return Math.abs(b - sc) - Math.abs(a - sc); });
    order.forEach(function (i) {
      const d = i - sc, near = Math.max(0, 1 - Math.abs(d)), u = sp * (0.3 + 0.42 * near), x = W / 2 + d * sp * (1 + 0.25 * Math.min(1, Math.abs(d)));
      const hop = near > 0.5 ? Math.abs(Math.sin(t * 5)) * u * 0.35 * near : 0;
      ctx.globalAlpha = 0.5 + 0.5 * near;
      ctx.fillStyle = '#0a0812'; ctx.fillRect(x - u * 0.95, fy - 3, u * 1.9, u * 0.75);
      ctx.fillStyle = T.block; ctx.fillRect(x - u * 0.9, fy, u * 1.8, u * 0.7);
      ctx.fillStyle = near > 0.5 ? T.neon : T.top; ctx.fillRect(x - u * 0.9, fy, u * 1.8, u * 0.14);
      ctx.fillStyle = T.side; ctx.fillRect(x - u * 0.9, fy + u * 0.52, u * 1.8, u * 0.18);
      ctx.save();
      ctx.translate(x, fy - u * 1.5 - hop);
      ctx.rotate(near > 0.5 ? Math.sin(t * 5) * 0.08 : 0);
      drawBody(u, FRANKS[i], near > 0.5 ? t : i);
      ctx.restore();
      if (Acct.status(i) !== 'open') {                             // a padlock on the block
        const k = u * 0.2, ly = fy + u * 0.22;
        ctx.fillStyle = '#0a0812'; ctx.fillRect(x - k * 1.25, ly - k * 1.1, k * 2.5, k * 2.9);
        ctx.fillStyle = '#c9ccd6'; ctx.fillRect(x - k * 0.75, ly - k * 0.9, k * 1.5, k); ctx.fillStyle = '#0a0812'; ctx.fillRect(x - k * 0.35, ly - k * 0.5, k * 0.7, k * 0.6);
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(x - k, ly, k * 2, k * 1.55);
        ctx.fillStyle = '#0a0812'; ctx.fillRect(x - k * 0.18, ly + k * 0.45, k * 0.36, k * 0.6);
      }
      ctx.globalAlpha = 1;
    });
    const st = Acct.status(mid);
    const w = Math.min(320, W - 40), low = H - sab - 14, by = st === 'buy' ? low - 56 - 10 - 46 : low - 56, ny = Math.min(H * 0.72, by - 62);
    neon(f.name, W / 2, ny, fit(f.name, 32, W - 24), '#ffffff', 'center', 6);
    const line = st === 'buy' ? Acct.priceText() + ' UNLOCKS EVERY FRANK, FOR GOOD' : mid === who ? 'THIS IS YOU' : f.world.toUpperCase();
    text(line, W / 2, ny + 32, fit(line, 13), st === 'open' ? (mid === who ? LIME : SOFT) : GOLD);
    button(st === 'open' ? 'FALL' : 'ALL FRANKS ' + Acct.priceText(), W / 2 - w / 2, by, w, 56, function () { pick(mid); }, st === 'open' ? PINK : AMBER, { icon: st === 'open' ? 'play' : 'lock', hot: true });
    if (st === 'buy') {                                             // or earn just him with tokens
      const need = Acct.me.tokenPrice, have = Acct.wallet();
      button(have >= need ? 'OR HIM FOR ' + need + ' TOKENS' : 'OR EARN HIM: ' + have + ' / ' + need + ' TOKENS', W / 2 - w / 2, by + 66, w, 46, function () {
        if (have < need) return toast('PICK UP TOKENS IN ANY LEVEL');
        Acct.earn(mid).then(function () { toast(f.name + ' UNLOCKED!'); }).catch(function () { toast('THAT DID NOT WORK'); });
      }, have >= need ? TEAL : INDIGO, { ghost: have < need, size: 14 });
    }
    drawWallet(t, W > 520 ? 0 : 48);
    if (mid > 0) arrow(24, fy - 110, 15, -1, function () { selTarget = Math.max(0, mid - 1); });
    if (mid < FRANKS.length - 1) arrow(W - 24, fy - 110, 15, 1, function () { selTarget = Math.min(FRANKS.length - 1, mid + 1); });
    toastAt(t, sat + 134);
  }

  // ---------- the intro: shown once, after the splash ----------
  // Meet Frank. He is a normal guy (he drives up in his car). But Frank has a problem: he keeps, well, falling down.
  let introT = -1, introPutt = 0, introFell = false, introTaps = 0;
  function endIntro() { localStorage.setItem('fff.intro', '1'); state = localStorage.getItem('fff.howto') ? 'title' : 'howto'; }
  function howtoPlay() { localStorage.setItem('fff.howto', '1'); state = 'title'; play(); }

  // ---------- how to play: the screen after the intro, once; its button starts the game ----------
  function drawHowto(t) {
    backdrop(t, 0.86);
    neon('HOW TO PLAY', W / 2, sat + 50, fit('HOW TO PLAY', 36), GOLD, 'center', 12);
    const top = sat + 96, bottom = H - sab - BH - 44, ph = (bottom - top) / 4, pw = Math.min(120, W * 0.3), px = Math.max(14, W / 2 - 180), u = Math.min(ph * 0.2, 22);
    const R = function (c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };
    const panel = function (k, head, sub, pic) {
      const y = top + k * ph, cx = px + pw / 2, cy = y + ph / 2 - 4, tx = px + pw + 16, room = W - tx - 12;
      R('#0a0812', px - 3, y + 3, pw + 6, ph - 14); R('#1f1a33', px, y + 6, pw, ph - 20);
      ctx.save(); ctx.beginPath(); ctx.rect(px, y + 6, pw, ph - 20); ctx.clip(); pic(cx, cy); ctx.restore();
      text(head, tx, cy - 12, fit(head, 21, room), '#35e8ff', 'left');
      text(sub, tx, cy + 14, fit(sub, 14, room), '#fff', 'left');
    };
    const frank = function (x, y, s, rot, who2, floatie) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); drawBody(s, FRANKS[who2 || 0], t, floatie); ctx.restore(); };
    panel(0, 'TAP LEFT OR RIGHT', 'Frank tumbles that way', function (cx, cy) {
      const side = Math.floor(t * 1.2) % 2;                           // the two halves of the screen take turns lighting up
      R(side ? '#1f1a33' : '#3b3f8f', px, cy - ph, pw / 2, ph * 2); R(side ? '#3b3f8f' : '#1f1a33', cx, cy - ph, pw / 2, ph * 2);
      text('<', px + pw * 0.17, cy, u * 1.6, '#fff'); text('>', px + pw * 0.83, cy, u * 1.6, '#fff');
      frank(cx, cy, u * 0.8, (side ? 1 : -1) * Math.min(1, (t * 1.2 % 1) * 3) * Math.PI / 2);
    });
    panel(1, 'FIT THROUGH THE GAPS', 'touch anything: back to the top', function (cx, cy) {
      const gy = cy + u * 1.3, drop = (t * 0.7 % 1) * u * 2.4;
      R('#454066', px, gy, pw / 2 - u * 0.8, u); R('#454066', cx + u * 0.8, gy, pw / 2, u);
      R('#35e8ff', px, gy, pw / 2 - u * 0.8, u * 0.18); R('#35e8ff', cx + u * 0.8, gy, pw / 2, u * 0.18);
      frank(cx, cy - u * 1.6 + drop, u * 0.75, 0);
    });
    panel(2, 'SLIME: HE SLIDES', 'fans turn the fall: taps stay the same', function (cx, cy) {
      frank(cx - pw * 0.23 + Math.sin(t * 3) * u * 0.4, cy, u * 0.7, 0, 0, true);
      frank(cx + pw * 0.22 + (t * 0.8 % 1 - 0.5) * u * 1.6, cy + (t * 0.8 % 1 - 0.5) * u * 1.6, u * 0.62, -Math.PI / 4);
    });
    panel(3, 'GRAB THE TOKENS', 'they earn you new Franks', function (cx, cy) {
      for (let i = 0; i < 3; i++) drawToken(FRANKS[0], cx - pw * 0.3 + i * u * 1.1, cy + Math.sin(t * 4 + i) * u * 0.2, u * 0.42, t + i);
      frank(cx + pw * 0.3, cy, u * 0.62, Math.sin(t * 4) * 0.1, 1 + Math.floor(t / 1.5) % (FRANKS.length - 1));
    });
    const w = menuW();
    button('PLAY', W / 2 - w / 2, H - sab - BH - 22, w, BH, howtoPlay, PINK, { icon: 'play', hot: true });
  }
  function drawIntro(t, dt) {
    const splash = document.getElementById('splash');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (introT < 0) { if (splash && !splash.hidden) return; introT = 0; introTaps = 0; introFell = false; }
    introT += dt;
    const T = introT, u = Math.min(W * 0.075, H * 0.045), road = Math.round(H * 0.66), f = FRANKS[0];
    const ease = function (x) { x = Math.max(0, Math.min(1, x)); return 1 - (1 - x) * (1 - x); };
    const R = function (c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h)); };
    // The story, by the second: he drives up (0.4 to 3), hops out (3.3), hops off through the park while it goes
    // by (3.65 to 7.6), steps out over the open manhole and hangs there a moment (7.6 to 8), then drops: the
    // picture follows him down into the dark, tumbling through a few gates the way the game plays (8 to 11).
    const driving = T > 0.4 && T < 3, OUT = 3.3, D = u * 18, hop = Math.max(0, Math.min(1, (T - 3.65) / 3.95)), cam = hop * D;
    const d = Math.max(0, T - 8), TV = 15 * u, PULL = 46 * u, fallen = function (s) { s = Math.max(0, s); return s < TV / PULL ? 0.5 * PULL * s * s : 0.5 * TV * TV / PULL + TV * (s - TV / PULL); };
    const stand = road - u * 1.95, drop = fallen(d);
    // the picture lets him drop into the hole first, then catches up and settles with him a third of the way down the screen
    const camY = fallen(d - 0.15) + (stand - H * 0.34) * ease((d - 0.3) / 1.2) * (d > 0.3 ? 1 : 0);
    const S = TH.shaft, yg = road + u * 1.3, yc = yg + u * 3, bottom = camY + H + u, cellWas = cell;
    const hx = W * 0.5 + D - cam;                                   // the open manhole, at the far end of the path
    ctx.save(); ctx.translate(0, -Math.round(camY));
    // dusk over the park: the sky, the moon, stars, slow clouds and the city far off
    R('#1c1340', 0, 0, W, road); R('#33205c', 0, road * 0.45, W, road * 0.3); R('#53306f', 0, road * 0.72, W, road * 0.28);
    const mx = W * 0.78, my = road * 0.22;
    R('rgba(255,242,170,0.08)', mx - u * 2.3, my - u * 2.3, u * 4.6, u * 4.6); R('rgba(255,242,170,0.12)', mx - u * 1.6, my - u * 1.6, u * 3.2, u * 3.2);
    R('#fff2aa', mx - u, my - u, u * 2, u * 2); R('#e6d488', mx - u * 0.55, my - u * 0.45, u * 0.5, u * 0.5); R('#e6d488', mx + u * 0.2, my + u * 0.3, u * 0.35, u * 0.35);
    for (let i = 0; i < 46; i++) { ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(T * (0.6 + hash(i, 3) * 2) + i)); R('#ffffff', hash(i, 1) * W, hash(i, 2) * road * 0.6, 2, 2); }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 3; i++) {
      const x = (hash(i, 11) * (W + u * 8) + T * u * (0.25 + i * 0.1)) % (W + u * 8) - u * 6, y = road * (0.1 + i * 0.13);
      R('rgba(190,170,230,0.16)', x, y, u * 5, u * 0.7); R('rgba(190,170,230,0.16)', x + u, y - u * 0.5, u * 2.6, u * 0.5);
    }
    for (let c = -2; c * u * 1.3 - cam * 0.12 < W; c++) {
      const bh = (2 + Math.floor(hash(c, 99) * 6)) * u * 0.6, bx = c * u * 1.3 - cam * 0.12;
      R('#1d1338', bx, road - bh, u * 1.3 + 1, bh);
      for (let k = 0; k < bh / (u * 0.6) - 1; k++) if (hash(c, k) < 0.32) R(hash(c, k) < 0.2 ? '#ffd23f' : '#35e8ff', bx + u * 0.45, road - bh + u * 0.2 + k * u * 0.6, u * 0.3, u * 0.25);
    }
    for (let i = -1; i * u * 3.2 - cam * 0.4 < W + u * 3; i++) {   // the trees at the back of the park, dark and slow
      const x = i * u * 3.2 + hash(i, 15) * u * 1.5 - cam * 0.4, h = u * (2.2 + hash(i, 16) * 1.6);
      R('#241a33', x - u * 0.15, road - h, u * 0.3, h); R('#0d3323', x - u * 1.1, road - h - u, u * 2.2, u * 1.6); R('#0d3323', x - u * 0.7, road - h - u * 1.6, u * 1.4, u * 0.8);
    }
    R('#17502f', 0, road - u * 0.9, W, u * 0.9); R('#1f6b3f', 0, road - u * 0.9, W, u * 0.12);   // the lawn
    for (let i = -1; i * u * 5 - cam * 0.7 < W + u * 3; i++) {     // the trees he passes
      const x = i * u * 5 + hash(i, 5) * u * 2 - cam * 0.7, h = u * (3 + hash(i, 6) * 2);
      R('#3d2a1c', x - u * 0.25, road - u * 0.4 - h, u * 0.5, h); R('#2c1e13', x + u * 0.1, road - u * 0.4 - h, u * 0.15, h);
      R('#12452c', x - u * 1.5, road - h - u * 1.7, u * 3, u * 2.1); R('#1b6b40', x - u * 1.1, road - h - u * 2.4, u * 2.2, u * 1.3); R('#27915a', x - u * 0.8, road - h - u * 2.2, u * 1, u * 0.35);
      R('#27915a', x - u * 1.2, road - h - u * 1.4, u * 0.7, u * 0.25);
    }
    for (let i = 0; i < 16; i++) {                                  // bushes and flowers along the back of the path
      const x = hash(i, 7) * (W + D + u * 4) - u * 2 - cam;
      if (i % 2) { R('#145c36', x, road - u * 0.7, u * 1.4, u * 0.7); R('#1f8a4f', x + u * 0.15, road - u * 0.9, u * 0.95, u * 0.3); }
      else { R('#1f8a4f', x, road - u * 0.42, u * 0.1, u * 0.42); R(['#ff4fd8', '#ffd23f', '#f4f4f4', '#35e8ff'][i % 8 / 2], x - u * 0.1, road - u * 0.6, u * 0.3, u * 0.25); }
    }
    [W * 0.42 + D * 0.24, W * 0.3 + D * 0.72].forEach(function (wx) {   // lamps, with their light on the path
      const lx = wx - cam;
      ctx.fillStyle = 'rgba(255,214,90,0.10)'; ctx.beginPath(); ctx.moveTo(lx + u * 0.1, road - u * 4.5); ctx.lineTo(lx - u * 2.4, road); ctx.lineTo(lx + u * 2.6, road); ctx.closePath(); ctx.fill();
      R('#2e2e3d', lx, road - u * 4.4, u * 0.22, u * 4.4); R('#2e2e3d', lx - u * 0.2, road - u * 0.25, u * 0.62, u * 0.25);
      R('#ffd23f', lx - u * 0.3, road - u * 4.85, u * 0.82, u * 0.5); R('#fff7cf', lx - u * 0.1, road - u * 4.7, u * 0.42, u * 0.22);
    });
    const bnx = W * 0.5 + D * 0.44 - cam;                           // a bench
    R('#0a0812', bnx - 2, road - u * 1.3 - 2, u * 3 + 4, u * 0.3 + 4); R('#8a5a34', bnx, road - u * 1.3, u * 3, u * 0.3); R('#8a5a34', bnx, road - u * 0.75, u * 3, u * 0.22);
    R('#3d2a1c', bnx + u * 0.2, road - u * 0.75, u * 0.22, u * 0.75); R('#3d2a1c', bnx + u * 2.58, road - u * 0.75, u * 0.22, u * 0.75);
    for (let i = 0; i < 12; i++) {                                  // fireflies
      ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(T * 2 + i * 1.7));
      R('#e9ff8a', hash(i, 21) * (W + D) - cam * 0.9 + Math.sin(T * 0.7 + i) * u, road - u * (1.2 + hash(i, 22) * 4) + Math.cos(T * 0.9 + i * 2) * u * 0.4, 3, 3);
    }
    ctx.globalAlpha = 1;
    // the path
    R('#8c8577', 0, road, W, u * 1.3); R('#b3ab99', 0, road, W, u * 0.2); R('#5d584e', 0, road + u * 1.1, W, u * 0.2);
    for (let i = -1; i * u * 1.7 - cam % (u * 1.7) < W; i++) R('#6f695d', i * u * 1.7 - cam % (u * 1.7), road + u * 0.2, u * 0.08, u * 0.9);
    // Under the path it is the game's own dark: earth, then brick, and under the manhole a pipe down into the shaft.
    R('#17121f', 0, yg, W, u * 3);
    for (let i = 0; i < 36; i++) R('#2a2136', hash(i, 31) * (W + D) - cam, yg + u * 0.3 + hash(i, 32) * u * 2.3, u * (0.3 + hash(i, 33) * 0.5), u * 0.22);
    R(S.bg, 0, yc, W, bottom - yc);
    for (let i = 0; i < 70; i++) R('rgba(255,255,255,0.035)', hx - u * 6 + Math.floor(hash(i, 41) * 12) * u, yc + Math.floor(hash(i, 42) * 64) * u, u, u);
    cell = Math.ceil(u);
    const r0 = Math.max(0, Math.floor((camY - yc) / u)), r1 = Math.ceil((camY + H - yc) / u);
    [[0, hx - u * 6], [hx + u * 6, W]].forEach(function (wl, side) {   // the shaft's brick walls, as far as the screen goes
      if (wl[1] <= wl[0]) return;
      R(S.wall, wl[0], yc - u, wl[1] - wl[0], bottom - yc + u);
      for (let r = r0 - 1; r <= r1; r++) {
        R(S.wallDark, wl[0], yc + r * u + u - 2, wl[1] - wl[0], 2);
        for (let x = (side ? wl[0] : wl[1] - u * 2) + ((r & 1) ? u : 0); x > wl[0] - u && x < wl[1]; x += side ? u * 2 : -u * 2) R(S.wallDark, x, yc + r * u, 2, u);
      }
      ctx.globalAlpha = 0.7; R(S.neon, side ? wl[0] : wl[1] - 2, yc, 2, bottom - yc); ctx.globalAlpha = 1;
    });
    for (let c = -6; c < 6; c++) if (c < -1 || c > 0) drawBlock(Math.round(hx + c * u), Math.round(yc - u), Math.ceil(u), S, false);   // its roof
    // the manhole: the hole in the path, the pipe under it with its rungs, the lid and two cones
    R('#000000', hx - u, road, u * 2, yc - road); R('#ffb000', hx - u * 1.15, road, u * 0.15, u * 1.3); R('#ffb000', hx + u, road, u * 0.15, u * 1.3);
    R('#2e2e3d', hx - u * 1.25, yg, u * 0.25, u * 3); R('#2e2e3d', hx + u, yg, u * 0.25, u * 3);
    for (let k = 0; k < 4; k++) R('#63637a', hx - u, yg + u * (0.3 + k * 0.7), u * 0.55, u * 0.1);
    R('#2e2e3d', hx + u * 1.5, road - u * 0.3, u * 1.7, u * 0.3); R('#63637a', hx + u * 1.5, road - u * 0.3, u * 1.7, u * 0.08);
    [hx - u * 2.6, hx + u * 3.7].forEach(function (x) {
      R('#0a0812', x - u * 0.42, road - u * 0.2, u * 0.84, u * 0.2); R('#ff7b00', x - u * 0.3, road - u * 0.55, u * 0.6, u * 0.4); R('#f4f4f4', x - u * 0.22, road - u * 0.75, u * 0.44, u * 0.2); R('#ff7b00', x - u * 0.13, road - u * 1.05, u * 0.26, u * 0.32);
    });
    // The gates down the shaft, each with its gap a little to one side, and a coin in every gap. He tumbles a
    // quarter turn towards each gap just above it, as a player would tap him.
    const GAPS = [0, 2.6, 0, -2.6, 0, 2.6, 0], gateY = function (k) { return yc + u * (6 + k * 7); };
    let ox = 0, turns = 0, begun = 0;
    GAPS.forEach(function (g, k) {
      const y = gateY(k);
      for (let c = -6; c < 6; c++) if (Math.abs((c + 0.5) - g) > 2.6) drawBlock(Math.round(hx + c * u), Math.round(y), Math.ceil(u), S, true);
      if (stand + drop < y - u * 0.5) drawToken(FRANKS[0], hx + g * u, y + u * 0.5 + Math.sin(T * 4 + k) * u * 0.08, u * 0.34, T + k);
      if (!k) return;
      const p = ease((stand + drop - (y - u * 6)) / (u * 1.5)), way = g - GAPS[k - 1];
      if (p > 0) begun = k;
      ox += way * p; turns += Math.sign(way) * p;
    });
    cell = cellWas;
    if (begun > introTaps) { introTaps = begun; A.sfx('tap'); }
    // the car
    const carX = (T < 0.4 ? -u * 7 : -u * 7 + ease((T - 0.4) / 2.6) * (W * 0.06 + u * 7)) - cam, bob = driving ? Math.abs(Math.sin(T * 22)) * u * 0.06 : 0, cy = road - bob;
    if (T > 0.4) {
      if (T < 3.3) { ctx.fillStyle = 'rgba(255,230,140,0.13)'; ctx.beginPath(); ctx.moveTo(carX + u * 5, cy - u * 1.25); ctx.lineTo(carX + u * 11, cy - u * 2.5); ctx.lineTo(carX + u * 11, cy); ctx.closePath(); ctx.fill(); }
      if (driving) for (let i = 0; i < 3; i++) R('rgba(255,255,255,' + (0.25 - i * 0.07) + ')', carX - u * (0.6 + i * 0.7) - (T * 60 % 10), cy - u * (0.7 + i * 0.25), u * 0.4, u * 0.4);
      R('#0a0812', carX - 3, cy - u * 1.75 - 3, u * 5 + 6, u * 1.3 + 6); R('#0a0812', carX + u * 1.1 - 3, cy - u * 2.75 - 3, u * 2.6 + 6, u * 1.1 + 3);
      R('#e8452c', carX + u * 1.1, cy - u * 2.75, u * 2.6, u * 1.1); R('#7fe9ff', carX + u * 1.4, cy - u * 2.55, u * 2, u * 0.75);
      if (T < OUT) { R(f.head, carX + u * 2.3, cy - u * 2.45, u * 0.8, u * 0.65); R(f.hair, carX + u * 2.3, cy - u * 2.5, u * 0.8, u * 0.14); R('#0a0812', carX + u * 2.75, cy - u * 2.2, u * 0.12, u * 0.14); }
      R('#ff4f6d', carX, cy - u * 1.75, u * 5, u * 1.3); R('#ff8fa3', carX, cy - u * 1.75, u * 5, u * 0.2); R('#b3273f', carX, cy - u * 0.75, u * 5, u * 0.3);
      R('#ffd23f', carX + u * 4.75, cy - u * 1.4, u * 0.25, u * 0.35); R('#f4f4f4', carX + u * 0.1, cy - u * 1.35, u * 0.2, u * 0.3);
      [0.6, 3.5].forEach(function (wx) {
        R('#0a0812', carX + u * wx, road - u * 0.85, u * 0.95, u * 0.95);
        const sp = driving ? T * 18 : 0; R('#9aa3ad', carX + u * (wx + 0.33) + Math.cos(sp) * u * 0.15, road - u * 0.52 + Math.sin(sp) * u * 0.15, u * 0.3, u * 0.3);
      });
      if (driving && T - introPutt > 0.12) { introPutt = T; A.sfx('putt'); }
    }
    // Frank himself
    let fx = carX + u * 5.8 + (hx - carX - u * 5.8) * hop, fy = stand, rot = Math.sin(T * 4) * 0.05;
    if (T < 3.65) {                                                 // out of the car in one jump
      const p = Math.max(0, Math.min(1, (T - OUT) / 0.35));
      fx = carX + u * (2.7 + 3.1 * p); fy = stand - u * (1 - p) - Math.sin(p * Math.PI) * u * 1.2; rot = (1 - p) * -0.3;
    } else if (T < 7.6) {                                           // hopping along, whistling
      const up = Math.abs(Math.sin(T * 9));
      fy -= up * u * 0.45; rot = Math.sin(T * 9) * 0.08;
      if (up < 0.3) R('rgba(255,255,255,0.22)', fx - u * (0.7 + up), road - u * 0.16, u * 0.3, u * 0.16);
      for (let n = 0; n < 5; n++) {
        const age = T - 3.9 - n * 0.75;
        if (age <= 0 || age >= 1.2) continue;
        const x = fx + u * (0.9 + age * 0.5) + Math.sin(age * 6) * u * 0.2, y = stand - u * (2.1 + age * 1.6);
        ctx.globalAlpha = 1 - age / 1.2;
        R('#ffffff', x, y, u * 0.28, u * 0.22); R('#ffffff', x + u * 0.22, y - u * 0.6, u * 0.07, u * 0.65); R('#ffffff', x + u * 0.22, y - u * 0.6, u * 0.3, u * 0.1);
        ctx.globalAlpha = 1;
      }
    } else if (T < 8) {                                             // over the hole, and for a moment nothing happens
      fx = hx; fy = stand - Math.abs(Math.sin(T * 30)) * u * 0.12; rot = Math.sin(T * 40) * 0.06;
      text('!', hx, stand - u * 2.8, u * 1.6, '#ff4f6d');
    } else {                                                        // down he goes: straight through the pipe, then tumbling from gap to gap
      fx = hx + ox * u; fy = stand + drop; rot = turns * Math.PI / 2 + Math.sin(T * 7) * 0.04;
      if (!introFell) { introFell = true; A.sfx('fall'); }
    }
    if (T > OUT) { ctx.save(); ctx.translate(fx, fy); ctx.rotate(rot); drawBody(u * 1.3, f, t); ctx.restore(); }
    if (T >= 8 && fy < yc + u * 2) { R('#8c8577', hx - u * 3, road, u * 1.85, u * 1.3); R('#8c8577', hx + u * 1.15, road, u * 0.35, u * 1.3); R('#b3ab99', hx - u * 3, road, u * 1.85, u * 0.2); }   // he goes in behind the edge of the path
    ctx.restore();
    if (d > 2.75) R('rgba(0,0,0,' + Math.min(1, (d - 2.75) / 0.35) + ')', 0, 0, W, H);
    // the story
    const line = function (s, k, col, size) { text(s, W / 2, H * 0.17 + k * 42, fit(s, size || 30), col || '#fff'); };
    if (T < 2.5) line('MEET FRANK.', 0, '#ffd23f', 40);
    else if (T < 5.5) { line('HE IS A', 0); line('NORMAL GUY.', 1); }
    else if (T < 8) { line('BUT FRANK HAS', 0); line('A PROBLEM...', 1, '#ff4fd8'); }
    else { line('HE KEEPS... WELL...', 0); if (T > 8.5) line('FALLING DOWN!', 1, '#35e8ff', 38); }
    if (T > 6.9 && T < 8.3 && Math.sin(T * 24) > -0.4) text('WATCH OUT, FRANK!', W / 2, H * 0.36, fit('WATCH OUT, FRANK!!', 34), '#ff4f6d');
    button('SKIP', W - 112, H - sab - 64, 96, 44, endIntro, 'rgba(59,63,143,0.9)');   // the only way out before the end
    if (T > 11.15) endIntro();
  }

  function draw(t, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    hits = [];
    if (state === 'intro') { drawIntro(t, dt); return; }
    if (state === 'howto') { drawHowto(t); return; }
    inks = [];
    if (state !== 'board' || !list || list.kind !== 'browse') findBox(false);
    if (state === 'settings') { drawSettings(t); return; }
    if (state === 'select') { drawSelect(t, dt); return; }
    if (state === 'board') { drawList(t); return; }
    if (state === 'profile') { drawProfile(t); return; }
    if (state === 'unlock') { titleBack(t); drawUnlock(t, false); return; }
    if (state === 'title') { drawTitle(t); return; }                // (the level's picture is behind its card: the level itself is not drawn)
    drawWorld(t, dt);
    const fog = !run.bonus && state !== 'title' && level.zoneAt(level.fogs, run.beat);
    if (fog) {                                                      // a stretch in the dark: only what is near Frank shows
      const k = Math.max(0, Math.min(1, (run.beat - fog.a) / 0.6, (fog.b - run.beat) / 0.6)), x = fpos.x, y = fpos.y;
      const g = ctx.createRadialGradient(x, y, cell * 3.5, x, y, cell * 9.5);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + (0.97 * k) + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const fa = 0.1 * (1 - (t - flash.t) / 0.15);                    // tap feedback
    if (fa > 0 && state === 'play' && !flash.dir) { ctx.fillStyle = 'rgba(255,255,255,' + fa + ')'; ctx.fillRect(0, 0, W, H); }   // portals only; taps do not light the screen
    if (state === 'wall') drawUnlock(t, true);
    else {
      if (state !== 'win') drawHud(t);
      if (state === 'paused') drawPaused(t);
      else if (state === 'win') drawWin(t);
    }
  }

  let last = performance.now() / 1000;
  function frame() {
    requestAnimationFrame(frame);
    const t = performance.now() / 1000, dt = Math.min(0.05, t - last);
    last = t;
    if (state === 'play') {
      let beat = curBeat();
      // The clock ran on while the page was asleep (a locked phone, another tab): nobody played those beats, so
      // they do not count. Pick up where he was, paused.
      if (beat - run.beat > 2) { beat = beat0 = run.beat; t0 = A.time(); A.seek(beat0, level, LF); pause(); }
      if (BOT && !run.bonus) {
        while (botI < botPlan.length && botPlan[botI].beat < run.beat - 0.5) botI++;              // back from a bonus room
        while (state === 'play' && !run.bonus && botI < botPlan.length && botPlan[botI].beat <= beat) { doTap(botPlan[botI].dir, true, botPlan[botI].beat); botI++; }
        const pt = level.portals[botPortal];                                                      // ?portal=0: the bot takes that portal
        if (pt && !run.bonus && !run.entered[botPortal] && !pt.tried && beat >= pt.tapBeat && state === 'play') { pt.tried = true; doTap(pt.dir, true); }
      }
      const old = pose(), evs = state === 'play' ? run.advance(beat) : [];
      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i];
        if (ev.type === 'wind') { anim = { kind: 'wind', dir: ev.dir, t: t, dur: 0.28, cx: old.cx }; A.sfx('wind'); }
        else if (ev.type === 'upright') {                           // stood up, head first, on the way into slime, wind or a bonus room
          anim = { kind: 'up', t: t, dur: 0.1, cx: old.cx, cy: old.cy, a: angle };
          angle = Math.round(angle / 4) * 4;
        }
        else if (ev.type === 'spring') { anim = { kind: 'wind', dir: ev.dir, t: t, dur: 0.34, cx: old.cx }; A.sfx('spring'); }
        else if (ev.type === 'bonus') { if (!run.bonus.name) banner = { name: 'BONUS ROOM', hint: 'GRAB THE ' + WF.token, t: t }; flash = { dir: 0, t: t }; A.sfx('portal'); }   // (a hidden room's name goes in the small line at the top)
        // a written-out level's own goings-on
        else if (ev.type === 'key') { A.sfx('key'); for (let j = 0; j < 8; j++) parts.push({ x: ev.at.col + 0.5, y: ev.at.row - run.B, vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 6, c: GOLD, s: 0.16 }); }
        else if (ev.type === 'warp') { anim = null; flash = { dir: 0, t: t }; A.sfx('portal'); }
        else if (ev.type === 'spot') { if (ev.art === 'duck') { ducked = true; A.sfx('quack'); } else if (ev.art === 'car') A.sfx('honk'); else A.sfx('hey'); }
        else if (ev.type === 'gold') A.mood('gold', beat + 32);      // every golden token: the music goes golden for eight bars
        else if (ev.type === 'secret') { foundSecret(ev.id, t); if (run.dizzy && spunAt < 0) spunAt = t; }   // dizzy: the whole board goes round once
        else if (ev.type === 'bonusEnd') { angle = run.st.k; anim = null; flash = { dir: 0, t: t }; A.sfx('portal'); }
        else if (ev.type === 'gate') A.sfx('gate');
        else if (ev.type === 'token') { A.sfx('token', run.count); const k = ev.at; for (let j = 0; j < 5; j++) parts.push({ x: k.col + 0.5, y: k.row - run.B, vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 6, c: WF.tokenColor, s: 0.14 }); }
        else if (ev.type === 'section') { if (turnOf(beat) !== view.a) { A.sfx('wind'); shake = Math.max(shake, 0.35); } }   // no name card, no pause: only the fan, where the fall turns
        else if (ev.type === 'dead') die(ev.how);
        else if (ev.type === 'win' && LV.tasting) { report('taste'); state = 'wall'; cashIn(); A.stop(); A.sfx('bonk'); recStop(); }   // the end of a taste: the wall, and the way to the rest
        else if (ev.type === 'win') { const sc = level.secrets.filter(function (s) { return s.kind === 'clear' && SET.diff >= s.how.win; })[0]; if (sc) foundSecret(sc.id, t);
          winScore = Math.round((100 * 100 + run.count * 10 + 5000) * DIFFS[SET.diff].score);   // (what report() works out for a win)
          report('win'); state = 'win'; winAt = t; cashIn(); A.sfx('win'); setTimeout(recStop, 1500); if (!BOT) localStorage.setItem('fff.far.' + LK, 100); }
      }
      const pct = Math.min(99, Math.floor(beat / level.totalBeats * 100));
      if (!BOT && !LV.tasting && pct > bestOf(LK)) localStorage.setItem('fff.far.' + LK, pct);
      if (state === 'play') A.update(beat, level, !!run.bonus, LF);
    } else if (state === 'dead' && t > deadUntil) { start(SET.easy ? Math.max(AT, run.checkpoint) : AT, true); A.sfx('yelp'); }   // back to the top at once (easy: to the start of the stretch)
    draw(t, dt);
  }

  setFrank(who);
  // the main page opens on the level a link asks for (?level=<id>, fetched if this player has not had it yet),
  // else on the one played last
  const wantLv = params.get('level'), hadLv = LEVELS.findIndex(function (l) { return l.id === (wantLv || localStorage.getItem('fff.lv')); });
  if (hadLv >= 0) lvTarget = lvScroll = hadLv;
  // the page reloaded itself into a new build (net.js): he is put back on the card, or the Frank, he was on
  const BACK = window.FFFNet && window.FFFNet.back, backLv = BACK ? LEVELS.findIndex(function (l) { return l.id === BACK.lv; }) : -1;
  if (backLv >= 0) lvTarget = lvScroll = backLv;
  else if (wantLv && /^[a-z0-9]{4,12}$/.test(wantLv)) fetchLevel(wantLv);
  // A made Frank's link (?frank=<id>) adds him to this player's Franks and puts him on. And the profile, which the
  // connector can change too, says the name and the Frank to play as.
  const useFrank = function (f) {
    if (/^\d{1,2}$/.test(f)) { if (+f !== who && +f < OWN && Acct.status(+f) === 'open' && state !== 'play') setFrank(+f); return; }
    const at = FRANKS.findIndex(function (x) { return x.made === f; });
    if (at >= 0) { if (at !== who && state !== 'play') setFrank(at); return; }
    if (/^[a-z0-9]{4,12}$/.test(f)) Acct.api('/api/frank?id=' + f).then(function (m) { if (m && m.id) { const i = keepFrank(m); if (state !== 'play') setFrank(i); toast(m.name + ' IS YOURS'); } }).catch(function () {});
  };
  const wantFrank = params.get('frank');
  if (wantFrank && PF < 0) { useFrank(wantFrank.toLowerCase()); Acct.api('/api/profile', { frank: wantFrank.toLowerCase() }).catch(function () {}); }
  else if (PF < 0) Acct.api('/api/profile').then(function (p) { gotProfile(p); if (p && p.frank && state === 'title') useFrank(String(p.frank)); }).catch(function () {});
  if (BACK && BACK.state === 'select') openSelect(clampF(+BACK.sel || 0));
  else if (TO_SELECT) openSelect(PF >= 0 ? PF : who);
  else if (!BOT && !MUTE && !localStorage.getItem('fff.intro')) state = 'intro';   // the story, once, after the splash
  else if (!BOT && !MUTE && !localStorage.getItem('fff.howto')) state = 'howto';   // then how to play, once
  Acct.onChange(function () {
    const bought = Acct.justBought, lvB = bought && LEVELS.filter(function (l) { return l.id === bought; })[0];
    if (lvB) { Acct.justBought = false; lvB.tasting = false; lvTarget = lvScroll = LEVELS.indexOf(lvB); state = 'title'; toast(lvB.name + ' UNLOCKED!'); return; }   // back from paying for a level: its card, now theirs
    if ((state === 'wall' || state === 'unlock') && ownedLv(state === 'wall' ? LV : unlockLv)) { const at = LEVELS.indexOf(state === 'wall' ? LV : unlockLv); if (state === 'wall') toLevels(); state = 'title'; lvTarget = lvScroll = at; }   // signed in, and it was theirs already
    if (Acct.justBought) { Acct.justBought = false; openSelect(Math.max(who, 3)); toast('EVERY FRANK UNLOCKED!'); return; }
    if (Acct.me.user && Acct.isOpen()) Acct.close();
    if (state === 'title' && Acct.status(who) !== 'open') setFrank(0);
  });
  // inside Claude: the page is handed the level to open (a made one, or none for the game's own), the player's
  // made Frank and their name, each time play_level is called
  function openIn(m, f, name) {
    if (state === 'play' || state === 'paused' || state === 'dead') toLevels();
    if (name) localStorage.setItem('fff.name', name);
    if (f && f.id) setFrank(keepFrank(f));
    lvTarget = lvScroll = m && m.sections ? keepLevel(m) : 0;
    state = 'title';
  }
  // (busy, where: for net.js, which reloads the page into a new build only when that costs him nothing, and puts him back where he was)
  // (for the tests: hits = every button on the screen, each by its name; inks = what is written or laid over the fall
  // on this frame; frankBox = the part of the screen Frank is in, his whole turn's reach with a margin)
  const frankBox = function () { const r = cell * 2.1; return { x: fpos.x - r, y: fpos.y - r, w: r * 2, h: r * 2 }; };
  window.FFF = { open: openIn, state: function () { return state; }, busy: function () { return entering || !!drag || (!!findEl && document.activeElement === findEl); }, inks: function () { return inks.slice(); }, frankBox: frankBox, cost: function (n) { const a = performance.now(); for (let i = 0; i < n; i++) draw(performance.now() / 1000, 0); return (performance.now() - a) / n; }, logo: function () { return LOGO.complete && LOGO.naturalWidth > 0; }, rating: function (id) { const lv = LEVELS.filter(function (l) { return l.id === id; })[0]; return lv ? ratingOf(lv) : null; }, diff: function () { return SET.diff; }, where: function () { return { state: state, lv: (LEVELS[Math.round(lvTarget)] || {}).id || '', sel: Math.round(selTarget) }; }, run: function () { return run; }, level: function () { return level; }, frank: function () { return who; }, card: makeWinCard, hits: function () { return hits.map(function (h) { return { x: h.x, y: h.y, w: h.w, h: h.h, label: h.label || '' }; }); } };
  frame();
})();
