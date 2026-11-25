// Free Fall Frank: grid rules, the fixed levels and the run state. No DOM here, so node can test it.
(function (root) {
  'use strict';

  // The world is up to WIDE columns across; narrow sections use the middle NLO..NHI.
  const WIDE = 21, NLO = 5, NHI = 16, START_COL = 10;

  // rpb = rows fallen per beat; every = beats between gates, so each gate is reached on a beat.
  // mode: rotate = a tap tumbles Frank, slide = a tap slides him one column.
  // turn = a big fan blows the fall off course: the whole board is shown turned by that many degrees (45 = he
  //        falls down and to the right, -90 = straight to the left) until the stretch ends. Only the view turns:
  //        the rules and the controls stay exactly as they are.
  // The play is counting: every gate needs an exact number of taps one way (minTaps..maxTaps), tapped
  // not too early (post = chance of a block that an early tap lands on) and not too late (the gate).
  // blow / spring = chance a stretch has a blower or a spring; saws = swinging saws; portal = may hold a bonus room.
  const SECTIONS = [
    { key: 'street', name: 'ELM STREET', theme: 'street', style: 'intro', mode: 'rotate', beats: 4, rpb: 8, gatesAt: [3] },   // fast from the first moment; the hole in the street is row 24 (STREET_ROW in game.js)
    { key: 'manhole', name: 'THE MANHOLE', hint: 'COUNT YOUR TAPS', theme: 'shaft', style: 'boom', mode: 'rotate', beats: 24, rpb: 6, every: 2, minTaps: 1, maxTaps: 2, decoys: 0.15, loose: 0.15 },
    { key: 'shaft', name: 'THE SHAFT', hint: 'NOT TOO EARLY, NOT TOO LATE', theme: 'shaft2', style: 'boom2', mode: 'rotate', beats: 32, rpb: 8, every: 2, minTaps: 1, maxTaps: 2, decoys: 0.15, loose: 0.2, post: 0.5, saws: 1 },
    { key: 'sewer', name: 'THE SEWER', hint: 'TOO SLIMY TO TUMBLE: TAP TO SLIDE', theme: 'sewer', style: 'lazy', mode: 'slide', wide: true, beats: 40, rpb: 8, every: 2, minTaps: 2, maxTaps: 4, decoys: 0.1, loose: 0.15, post: 0.3, blow: 0.2, spring: 0.2, saws: 1, portal: true },
    { key: 'vents', name: 'THE VENTS', theme: 'vents', style: 'break', mode: 'rotate', maze: true, riff: true, doubles: true, wide: true, beats: 48, rpb: 10, every: 1, post: 0, thick: 0, blow: 0, spring: 0, saws: 0, portal: false, decoys: 0, loose: 0 },
    { key: 'grid', name: 'NEON GRID', hint: 'CROSS THE WHOLE GRID', theme: 'grid', style: 'trap', mode: 'rotate', wide: true, beats: 40, rpb: 10, every: 2, minTaps: 2, maxTaps: 4, thick: 0.4, decoys: 0.1, loose: 0.15, post: 0.4, blow: 0.2, spring: 0.25, saws: 2, portal: true },
    { key: 'storm', name: 'STORM DRAIN', theme: 'storm', style: 'break2', mode: 'rotate', maze: true, riff: true, doubles: true, wide: true, beats: 32, rpb: 10, every: 1, post: 0, thick: 0, blow: 0, spring: 0, saws: 0, portal: false, decoys: 0, loose: 0 },
    { key: 'core', name: 'THE CORE', hint: 'ALMOST AT THE BOTTOM', theme: 'core', style: 'boom3', mode: 'rotate', wide: true, beats: 40, rpb: 12, every: 2, minTaps: 2, maxTaps: 4, thick: 0.5, decoys: 0.05, loose: 0.1, post: 0.5, blow: 0.2, spring: 0.2, saws: 2, portal: true },
    { key: 'sky', name: 'DAYLIGHT?', theme: 'sky', style: 'outro', mode: 'rotate', wide: true, beats: 8, rpb: 4 },
  ];
  // tap patterns for the riff stretches: L and R are single taps, l and r doubles, - a beat with no tap
  const MOTIFS = ['LLRLR', 'LRLR', 'RRLRL', 'LL-RR', 'rL-R', 'RLRRL', 'lRLR', 'LR-rL', 'RRL-L', 'LRLl', 'RLLR', 'LRRLR-'];
  // a slide: a short stretch where Frank goes twice as fast
  const CHUTE = { key: 'chute', name: 'THE SLIDE', hint: 'HOLD ON', theme: 'chute', style: 'rush', mode: 'rotate', wide: true, beats: 8, rpb: 16, every: 4, minTaps: 0, maxTaps: 1, loose: 1 };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Frank's state: col = leftmost column, k = quarter turns clockwise (even = standing, odd = lying flat).
  // He is 1x3 standing and 3x1 flat; his feet line (bottom edge) is the row value B.
  function rotate(st, dir) {
    const vert = st.k % 2 === 0;
    const col = dir > 0 ? (vert ? st.col + 1 : st.col + 3) : (vert ? st.col - 3 : st.col - 1);
    return { col: col, k: (st.k + dir + 4) % 4 };
  }
  function slide(st, dir) { return { col: st.col + dir, k: st.k }; }
  function width(st) { return st.k % 2 === 0 ? 1 : 3; }
  function mid(st) { return st.col + (width(st) === 3 ? 1 : 0); }
  // standing, head up: where he cannot tumble (slime, wind, bonus rooms) he is set upright on the way in
  function upright(st) { return { col: mid(st), k: 0 }; }
  function outDist(st, s) { return Math.max(0, s.lo - st.col, st.col + width(st) - s.hi); }

  // Blocks that are not always there (a level's own stretches ask for them; L.dyn holds them by row):
  //   door:   shut and open in turn, `per` beats round, open for the first half from beat `off`
  //   lock:   a door that is shut until this run has picked up its key
  //   slider: a whole bar whose gap (w wide) steps one column sideways just before every beat, turning round at the walls
  // What is solid on that row at that beat, as a mask. run = the attempt (for keys); with none, locks count as open.
  function fold(x, lo, hi) { const n = hi - lo; if (n <= 0) return lo; let v = ((x - lo) % (2 * n) + 2 * n) % (2 * n); if (v > n) v = 2 * n - v; return lo + v; }
  function sliderAt(d, beat) { return fold(d.x0 + d.dir * (Math.floor(beat + 0.25) - d.k), d.lo, d.hi - d.w); }
  function doorShut(d, beat) { return (((beat - d.off) % d.per) + d.per) % d.per >= d.per / 2; }
  function dynMask(L, r, beat, run) {
    const list = L.dyn && L.dyn.get(r);
    let mask = 0;
    if (list) for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.kind === 'slider') { const x = sliderAt(d, beat); for (let c = d.lo; c < d.hi; c++) if (c < x || c >= x + d.w) mask |= 1 << c; }
      else if (d.kind === 'lock' ? !!run && !run.keys[d.key] : doorShut(d, beat)) for (let c = d.c0; c <= d.c1; c++) mask |= 1 << c;
    }
    return mask;
  }

  // bonus = inside a bonus room, where there is nothing but the far walls
  function blocked(L, st, B, mTop, mBot, bonus, run) {
    const w = width(st), h = 4 - w;
    if (bonus) return st.col < 0 || st.col + w > WIDE;
    const r0 = Math.floor(B - h + (mTop || 0) + 1e-6), r1 = Math.ceil(B - (mBot || 0) - 1e-6) - 1;
    for (let r = r0; r <= r1; r++) {
      const s = L.sectionAtRow(r);
      if (st.col < s.lo || st.col + w > s.hi) return true;
      const mask = (L.solids.get(r) || 0) | (L.dyn && L.dyn.has(r) ? dynMask(L, r, L.beatAtRow(B), run) : 0);
      if (!mask) continue;
      for (let c = st.col; c < st.col + w; c++) if (mask >> c & 1) return true;
    }
    return false;
  }

  // Things that move and must not be touched (L.foes), each a box in the world at a beat: x, y its top left in
  // columns and rows, w and h its size. None of them ever crosses the level's own solution; each one punishes a
  // move made the wrong way or at the wrong moment, and each shows itself (a) well before it can hurt (from la).
  //   bat:   paces the wide end of a gap, on the gate's own row
  //   fire:  comes up from below in one column and passes his feet at beat tb: tumble into that column only after it
  //   drip:  comes down from above in the column he is in, faster than he falls, reaching his head at tb: be gone by then
  //   wisp:  falls with him, circling a point beside his way (r columns round, once every `per` beats)
  function foeAt(L, f, beat) {
    if (f.kind === 'bat') { const u = (((beat - f.ph) / f.per) % 1 + 1) % 1, k = u < 0.5 ? u * 2 : 2 - u * 2; return { x: f.x0 + (f.x1 - f.x0) * k + 0.1, y: f.row + 0.1, w: 0.8, h: 0.8 }; }
    if (f.kind === 'fire') return { x: f.col + 0.1, y: f.y - 2 - (beat - f.tb) * f.v, w: 0.8, h: 2 };
    if (f.kind === 'drip') { const tip = Math.min(f.end, f.y - 3 + (beat - f.tb) * 2 * f.v); return { x: f.col + 0.1, y: tip - 2, w: 0.8, h: 2 }; }
    const th = 2 * Math.PI * (beat - f.ph) / f.per;                 // wisp
    return { x: f.cx - f.side * f.r * Math.cos(th) - 0.4, y: L.rowAt(beat) - 1.5 + f.r * Math.sin(th) - 0.4, w: 0.8, h: 0.8 };
  }

  // a saw swings side to side in time with the beat, level with Frank's feet
  function sawCol(saw, beat) { return Math.round(saw.base + saw.amp * Math.sin(2 * Math.PI * (beat - saw.ph) / saw.per)); }

  // Every Frank has his own level: its own seed, section order, tempo, key and colours.
  // What each Frank's world is like to play, in the order of franks.js:
  // mix = a bit of everything, tumble = no slime (the slimy stretch tumbles too), slide = slippery
  // (two of the tumbling stretches slide instead), wind = blown about (the slimy stretch is windy too).
  const TRAITS = ('mix slide tumble tumble mix tumble tumble mix slide tumble mix slide ' +
    'slide wind mix wind tumble wind slide wind wind mix tumble wind').split(' ');
  function specFor(i) {
    return { seed: 7 + i * 101, shuffle: i > 0, bpm: [100, 96, 104, 98, 108, 102][i % 6], tr: [0, -2, 3, -4, 2, 5, -1][i % 7],
      trait: TRAITS[i] || 'mix', hard: HARD[i] || 1, prog: i % 4, hook: (i >> 2) % 4, lead: i % 3 };
  }
  // How hard each Frank's level is, 1 (Frank's own) to 5, in the order of franks.js. A harder level falls
  // faster and has more of everything: posts, thick gates, blowers, springs and saws, fewer ways round,
  // and from 3 up stretches in the dark, from 4 up stretches where left and right are swapped.
  const HARD = [1, 1, 2, 3, 2, 3, 2, 3, 2, 4, 3, 2, 3, 5, 3, 4, 5, 3, 2, 3, 4, 4, 4, 5];
  function harder(s, d) {
    if (d <= 1 || !s.every) return s;
    const k = d - 1, o = Object.assign({}, s), gated = true;
    if (s.key !== 'chute' && s.key !== 'manhole' && !s.turn) o.rpb = Math.round(s.rpb * [1, 1, 1.1, 1.18, 1.25][k]);
    if (gated) o.post = Math.min(0.9, (s.post || 0.2) + 0.1 * k);
    if (s.blow) o.blow = s.blow + 0.04 * k;
    if (s.spring) o.spring = s.spring + 0.04 * k;
    if (gated && s.saws !== undefined) o.saws = s.saws + (d >= 5 ? 2 : d >= 3 ? 1 : 0);
    if (s.thick) o.thick = Math.min(0.9, s.thick + 0.1 * k);
    o.decoys = (s.decoys || 0) * (1 - 0.2 * k);
    if (s.key !== 'chute') o.loose = (s.loose || 0) * (1 - 0.2 * k);
    return o;
  }
  function traitOf(s, trait) {
    if (trait === 'slide' && (s.key === 'shaft' || s.key === 'grid')) return { mode: 'slide' };
    if (trait === 'tumble' && s.key === 'sewer') return { mode: 'rotate' };
    if (trait === 'wind' && s.key === 'sewer') return { turn: 45, style: 'break', rpb: 6, blow: 0.5, portal: false };
    return null;
  }

  // ---------- levels people make ----------
  // A made level is a name, a world (whose look and music it has: a Frank's number), a seed and a list of
  // stretches. Each stretch is one of five kinds with a few settings; the builder below lays it out, and because
  // it always walks a way through first, a made level can always be finished.
  //   patterns: a gate every beat; the taps follow `pattern` (L R single taps, l r double taps, - a beat off), round and round
  //   gates:    a gate every two beats, each needing `taps` [least, most] taps one way; posts, springs, blowers, saws, thick gates, a bonus room
  //   slide:    the same, but in slime: a tap slides him one column instead of tumbling him
  //   maze:     double taps down paths that fork and join
  //   drop:     eight beats of a fast, nearly empty fall
  const KINDS = ['patterns', 'gates', 'slide', 'maze', 'drop'];
  const LOOKS = ['shaft', 'shaft2', 'sewer', 'vents', 'grid', 'storm', 'core'];
  const MAX_BEATS = 280, MAX_STRETCHES = 16;
  // What is kept and built again by every later build has a version: a made level's design (v, stored with it on the
  // server and on a player's device) and a paid level's stretches (the v of /api/world's answer). One with no v is
  // version 1. A build reads the version it writes and the ones in READS; anything else (written by a later build,
  // met by an older page) is refused in a sentence, never built wrong. Kept designs that must go on building are in
  // test/fixtures (node test/fixtures.cjs).
  const MADE_V = 1, MADE_READS = [1], WORLD_V = 1, WORLD_READS = [1];
  function readable(v, reads, what) {
    if (v !== undefined && v !== null && reads.indexOf(v) < 0) throw new Error(what + ' is written as version ' + String(v).slice(0, 12) + ', which this game cannot build: it builds version ' + reads.join(' and '));
  }
  // Check what a maker sent and bring it to the one form that is stored and built. Throws an Error that says what is wrong.
  function customLevel(input) {
    input = input || {};
    const bad = function (m) { throw new Error(m); };
    readable(input.v, MADE_READS, 'this level');
    const num = function (v, lo, hi, def, what) { if (v === undefined || v === null) return def; v = +v; if (!(v >= lo && v <= hi)) bad(what + ' must be between ' + lo + ' and ' + hi); return v; };
    const name = String(input.name || '').replace(/[^\w .,!?'&:-]/g, '').trim().slice(0, 32);
    if (name.length < 2) bad('the level needs a name (letters, numbers and simple punctuation, 2 to 32 characters)');
    const author = String(input.author || '').replace(/[^\w .-]/g, '').trim().slice(0, 20) || 'anonymous';
    if (!Array.isArray(input.sections) || !input.sections.length) bad('sections must be a list of at least one stretch');
    if (input.sections.length > MAX_STRETCHES) bad('at most ' + MAX_STRETCHES + ' stretches');
    let total = 0;
    const sections = input.sections.map(function (s, i) {
      const at = 'sections[' + i + ']';
      if (!s || KINDS.indexOf(s.kind) < 0) bad(at + '.kind must be one of: ' + KINDS.join(', '));
      const o = { kind: s.kind };
      if (s.kind === 'drop') { o.beats = 8; total += 8; return o; }
      o.beats = Math.round(num(s.beats, 8, 64, 24, at + '.beats') / 4) * 4;
      o.speed = Math.round(num(s.speed, 5, 14, s.kind === 'patterns' ? 9 : 10, at + '.speed'));
      o.wide = s.kind === 'maze' ? true : s.wide !== false;
      if (s.look !== undefined) { if (LOOKS.indexOf(s.look) < 0) bad(at + '.look must be one of: ' + LOOKS.join(', ')); o.look = s.look; }
      if (s.kind === 'patterns') {
        o.pattern = String(s.pattern || 'LRLR');
        if (!/^[LRlr-]{1,64}$/.test(o.pattern) || !/[LRlr]/.test(o.pattern)) bad(at + '.pattern must be 1 to 64 of the letters L R l r and - with at least one tap');
        o.saws = Math.round(num(s.saws, 0, 2, 0, at + '.saws'));
      } else if (s.kind !== 'maze') {
        const t = Array.isArray(s.taps) ? s.taps : [s.kind === 'slide' ? 2 : 1, s.kind === 'slide' ? 4 : 3];
        o.taps = [Math.round(num(t[0], 0, 4, 1, at + '.taps[0]')), Math.round(num(t[1], 1, 6, 3, at + '.taps[1]'))];
        if (o.taps[0] > o.taps[1]) bad(at + '.taps must be [least, most]');
        o.posts = num(s.posts, 0, 0.9, 0.3, at + '.posts'); o.springs = num(s.springs, 0, 0.5, 0.15, at + '.springs'); o.blowers = num(s.blowers, 0, 0.5, 0.15, at + '.blowers');
        o.thick = num(s.thick, 0, 0.9, 0.2, at + '.thick'); o.saws = Math.round(num(s.saws, 0, 3, 1, at + '.saws')); o.bonus = !!s.bonus;
      }
      total += o.beats;
      return o;
    });
    if (total > MAX_BEATS) bad('the stretches add up to ' + total + ' beats; the most is ' + MAX_BEATS + ' (about three minutes)');
    if (total < 16) bad('the level is too short: at least 16 beats');
    let seed = input.seed;
    if (seed === undefined || seed === null) { seed = 0; for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) % 1000003; }
    return { v: MADE_V, name: name, author: author, world: Math.round(num(input.world, 0, 23, 0, 'world')), seed: Math.round(num(seed, 0, 99999999, 0, 'seed')), sections: sections };
  }
  // a made stretch as the builder's own kind of stretch
  function expand(o) {
    if (o.kind === 'drop') return CHUTE;
    if (o.kind === 'patterns') return { key: 'patterns', name: 'PATTERNS', theme: o.look || 'shaft2', style: 'boom2', mode: 'rotate', riff: true, doubles: true, every: 1, wide: o.wide, beats: o.beats, rpb: o.speed,
      pattern: o.pattern, post: 0, thick: 0, blow: 0, spring: 0, portal: false, decoys: 0.1, loose: 0.1, saws: o.saws };
    if (o.kind === 'maze') return { key: 'maze', name: 'MAZE', theme: o.look || 'vents', style: 'break', mode: 'rotate', maze: true, riff: true, doubles: true, every: 1, wide: true, beats: o.beats, rpb: o.speed,
      post: 0, thick: 0, blow: 0, spring: 0, saws: 0, portal: false, decoys: 0, loose: 0 };
    return { key: o.kind, name: o.kind.toUpperCase(), theme: o.look || (o.kind === 'slide' ? 'sewer' : 'grid'), style: o.kind === 'slide' ? 'lazy' : 'trap', mode: o.kind === 'slide' ? 'slide' : 'rotate', every: 2, wide: o.wide,
      beats: o.beats, rpb: o.speed, minTaps: o.taps[0], maxTaps: o.taps[1], thick: o.thick, decoys: 0.1, loose: 0.15, post: o.posts, blow: o.blowers, spring: o.springs, saws: o.saws, portal: o.bonus };
  }
  // the spec the builder takes for a made level
  function customSpec(lv) { readable(lv.v, MADE_READS, 'this level'); return Object.assign(specFor(lv.world), { shuffle: false, hard: 1, trait: 'mix', seed: lv.seed, custom: lv.sections }); }

  // ---------- how hard a level is: its rating ----------
  // Every level has a RATING, one of five tiers, shown on its card and wherever levels are listed. (It is not the
  // difficulty a player picks to play on, EASY to INSANE in game.js, which changes the speed and the score: so the
  // tiers have names of their own.) The game's own levels are rated by hand (RATED). A made level is rated from its
  // design by plain arithmetic, the same answer every time:
  //   each stretch but a drop scores   speed      (speed - 5) x 3.5                                    0 to 31.5
  //                                    taps       patterns: taps a beat x 12 (a double tap is two), + 4 if it has doubles
  //                                               gates: the mean of taps[least, most] x 4, + (most - least); slide: 0.8 of that; maze: 16
  //                                    hazards    gates and slide: posts x 10 + thick x 5 + springs x 10 + blowers x 10 + saws x 3; patterns: saws x 4
  //                                    narrow     + 4 when wide is false
  //   the level scores   half its hardest stretch + half the mean of its stretches (by their beats)
  //                      + its length: (beats - 48) / 232 x 12, from 0 to 12
  //   rounded to a whole number of points:   under 32 CHILL, under 42 TRICKY, under 54 TOUGH, under 66 BRUTAL, 66 and up DEMON
  const TIERS = ['CHILL', 'TRICKY', 'TOUGH', 'BRUTAL', 'DEMON'], TIER_AT = [32, 42, 54, 66];
  const RATED = { city: 2, rock: 5 };                               // ELM STREET is TRICKY (three minutes that start gentle); ROCK BOTTOM is a DEMON (five minutes of everything, and a boss)
  function tier(level, points) { level = Math.max(1, Math.min(TIERS.length, Math.round(level) || 1)); const o = { tier: TIERS[level - 1], level: level, of: TIERS.length }; if (points !== undefined) o.points = points; return o; }
  function stretchPoints(o) {
    if (!o || o.kind === 'drop') return 0;
    const n = function (v, def) { return typeof v === 'number' && isFinite(v) ? v : def; };
    let p = (n(o.speed, o.kind === 'patterns' ? 9 : 10) - 5) * 3.5;
    if (o.kind === 'patterns') {
      const pat = String(o.pattern || 'LRLR'), singles = (pat.match(/[LR]/g) || []).length, doubles = (pat.match(/[lr]/g) || []).length;
      p += (singles + 2 * doubles) / Math.max(1, pat.length) * 12 + (doubles ? 4 : 0) + n(o.saws, 0) * 4;
    } else if (o.kind === 'maze') p += 16;
    else {
      const t = Array.isArray(o.taps) ? o.taps : [1, 3], t0 = n(t[0], 1), t1 = n(t[1], 3);
      p += ((t0 + t1) / 2 * 4 + (t1 - t0)) * (o.kind === 'slide' ? 0.8 : 1);
      p += n(o.posts, 0.3) * 10 + n(o.thick, 0.2) * 5 + n(o.springs, 0.15) * 10 + n(o.blowers, 0.15) * 10 + n(o.saws, 1) * 3;
    }
    return p + (o.wide === false ? 4 : 0);
  }
  // a made level's rating, from its design (what customLevel gives back, or what a maker sent): { tier, level 1 to 5, of, points }
  function rate(lv) {
    const secs = (lv && Array.isArray(lv.sections) ? lv.sections : []).filter(function (s) { return s && KINDS.indexOf(s.kind) >= 0; });
    let most = 0, sum = 0, beats = 0, total = 0;
    secs.forEach(function (s) {
      const b = s.kind === 'drop' ? 8 : (typeof s.beats === 'number' && s.beats > 0 ? s.beats : 24);
      total += b;
      if (s.kind === 'drop') return;
      const p = stretchPoints(s);
      most = Math.max(most, p); sum += p * b; beats += b;
    });
    const points = Math.round(most * 0.5 + (beats ? sum / beats : 0) * 0.5 + Math.max(0, Math.min(12, (total - 48) / 232 * 12)));
    let level = 1;
    TIER_AT.forEach(function (at) { if (points >= at) level++; });
    return tier(level, points);
  }
  // a level's rating by what it is: one of the game's own (by its id), or a made one
  function ratingOf(lv) { return lv && RATED[lv.id] && !lv.sections ? tier(RATED[lv.id]) : rate(lv); }

  // A level is built by first walking a solution (taps on the beat grid, plus wind, blowers and
  // springs), then cutting each gate's hole where that walk passes through it. So a level is always
  // beatable, the taps land on the music's grid, and the walk (plan) doubles as the test bot.
  // Everything else (posts, tokens, saws, portals) is then placed around the walk without touching it.
  function buildLevel(spec) {
    spec = spec || specFor(0);
    // a layout that happens to have no way through is rare; the next seed along is used instead
    for (let n = 0; ; n++) {
      try { return build(spec, spec.seed + n * 1000); } catch (e) { if (n >= 30) throw e; }
    }
  }
  function build(spec, seed) {
    const rnd = mulberry32(seed);
    // Frank's own level is the classic run. Every other Frank gets his own build of everything: which stretches
    // and how many, how long each is, where the slides are, how far apart the gates sit, how fast he falls and
    // what the gates are like (bars = full rows, islands = short ledges, slabs = thick, sieve = full of holes).
    const byKey = {};
    SECTIONS.forEach(function (s) { byKey[s.key] = s; });
    let defs, look = { every: 2, speed: 1, style: 'bars' };
    if (spec.defs) defs = spec.defs;                                // one of the game's own later levels: every stretch is written out (the server keeps them)
    else if (spec.custom) defs = [SECTIONS[0]].concat(spec.custom.map(expand), [SECTIONS[8]]);   // a level somebody made: the street, their stretches, daylight
    else if (!spec.shuffle) {
      // Frank's own level: riffs. A gate every beat, one tap each (two on the fast ones), the taps following
      // short left/right patterns that fly by, with the slower stretches of springs, blowers and saws in between.
      const riff = function (s, o) { return Object.assign({}, s, { every: 1, riff: true, post: 0, thick: 0, blow: 0, spring: 0, portal: false, decoys: 0.1, loose: 0.1 }, o); };
      defs = [SECTIONS[0], riff(SECTIONS[1], { rpb: 8 }), riff(SECTIONS[2], { rpb: 9, doubles: true }), SECTIONS[3], CHUTE, SECTIONS[4],
        riff(SECTIONS[5], { key: 'riff', beats: 24, rpb: 10, doubles: true, saws: 1 }), SECTIONS[5], SECTIONS[6], CHUTE, SECTIONS[7], SECTIONS[8]];
    }
    else {
      const pool = ['shaft', 'sewer', 'vents', 'grid', 'storm'], lens = [24, 32, 40, 48];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      const n = 4 + Math.floor(rnd() * 3), mids = [], slideAfter = {};
      for (let i = 0; i < n; i++) mids.push(Object.assign({}, byKey[pool[i < pool.length ? i : Math.floor(rnd() * pool.length)]], { beats: lens[Math.floor(rnd() * 4)] }));
      const core = Object.assign({}, SECTIONS[7], { beats: [32, 40, 48][Math.floor(rnd() * 3)] });
      for (let c = Math.floor(rnd() * 3); c > 0; c--) slideAfter[Math.floor(rnd() * n)] = true;
      const total = function () { return 36 + core.beats + Object.keys(slideAfter).length * 8 + mids.reduce(function (a, s) { return a + s.beats; }, 0); };
      while (total() > 296) mids.reduce(function (a, s) { return s.beats > a.beats ? s : a; }).beats -= 8;   // keep it under the length of a track
      defs = [SECTIONS[0], SECTIONS[1]];
      mids.forEach(function (s, i) { defs.push(s); if (slideAfter[i]) defs.push(CHUTE); });
      defs.push(core, SECTIONS[8]);
      look = { every: [2, 2, 3, 4][Math.floor(rnd() * 4)], speed: 0.9 + rnd() * 0.3, style: ['bars', 'islands', 'slabs', 'sieve'][Math.floor(rnd() * 4)] };
    }
    const styled = function (s) {
      if (!s.every || s.key === 'manhole' || s.key === 'chute' || s.riff) return s;
      const o = Object.assign({}, s);
      if (!s.turn) o.rpb = Math.max(4, Math.round(s.rpb * look.speed));   // a turned board shows less of what is coming, so it keeps its pace
      o.every = look.every;
      if (look.every > 2) { o.minTaps = s.minTaps + (look.every > 3 ? 1 : 0); o.maxTaps = Math.min(6, s.maxTaps + look.every - 2); }
      if (look.style === 'islands') o.loose = 0.7;
      else if (look.style === 'slabs') { o.thick = Math.max(s.thick || 0, 0.7); o.loose = (s.loose || 0) * 0.3; }
      else if (look.style === 'sieve') o.decoys = 0.6;
      return o;
    };
    const sections = defs.map(function (s, i) {
      if (spec.defs) return Object.assign({}, s);                   // as written
      if (spec.custom) return Object.assign({}, s, s.key === 'chute' ? { wide: !!defs[i + 1].wide } : null);   // as its maker set it
      const o = harder(styled(Object.assign({}, s, s.key === 'chute' ? { wide: !!defs[i + 1].wide } : traitOf(s, spec.trait))), spec.hard || 1);
      // which way the fan blows, and how far round, is each Frank's own; a turned board has no bonus room
      if (o.turn) { o.portal = false; if (spec.shuffle) o.turn = (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.5 ? 45 : 90); }
      return o;
    });
    spec = Object.assign({}, spec, { look: look });
    let b = 0, r = 0;
    sections.forEach(function (s) {
      s.start = b; s.startRow = r;
      b += s.beats; r += s.beats * s.rpb;
      s.end = b; s.endRow = r;
      s.lo = s.wide ? 0 : NLO; s.hi = s.wide ? WIDE : NHI;
    });
    const L = { spec: spec, bpm: spec.bpm, sections: sections, totalBeats: b, totalRows: r, solids: new Map(), gates: [], winds: [], plan: [],
      springs: [], blowers: [], posts: {}, tokens: [], saws: [], portals: [], bonus: [],
      // what only a written-out level has: blocks that come and go, things that move, keys, warps, a boss's volleys,
      // the grudge's beats, hidden things, and the sounds its gates and foes make on the beat
      dyn: new Map(), foes: [], keys: [], warps: [], volleys: [], grudges: [], spins: [], spots: [], golds: [], rain: [], forks: [], secrets: [], sounds: [] };
    L.sectionIndexAt = function (beat) {
      for (let i = sections.length - 1; i > 0; i--) if (beat >= sections[i].start) return i;
      return 0;
    };
    L.sectionAt = function (beat) { return sections[L.sectionIndexAt(beat)]; };
    L.sectionAtRow = function (row) {
      for (let i = sections.length - 1; i > 0; i--) if (row >= sections[i].startRow) return sections[i];
      return sections[0];
    };
    L.rowAt = function (beat) {
      const s = L.sectionAt(beat);
      return s.startRow + (beat - s.start) * s.rpb;
    };
    L.beatAtRow = function (row) {
      const s = L.sectionAtRow(row);
      return s.start + (row - s.startRow) / s.rpb;
    };

    function genGated(s, next, st0) {
      let st = st0, prevClear = s.start, heading = rnd() < 0.5 ? -1 : 1, first = true;
      const evs = [], gates = [], bands = [], mv = s.mode === 'slide' ? slide : rotate, step = s.maxTaps > 2 ? 0.25 : 0.5;
      let motif = '', mi = 0, fork = null, drifted = false, scripted = false, gn = 0;
      const forks = [];                                             // maze: the runs that come back, where the other way round is open too
      // gates run right up to the end of a stretch and start again a beat into the next: no dead space in between
      for (let G = s.start + Math.min(s.every, 2); G <= s.end - 1; G += s.every) {
        if (s.riff) {
          // the next tap of the pattern: L, R, a double (l, r) or a beat off (-); a wall turns it round
          if (mi >= motif.length) {
            if (fork && fork.ok) forks.push(fork);
            fork = null; mi = 0;
            if (s.maze) {
              // A maze is made of runs: the same move one to three gates over (right, right, right), which draws a
              // path slanting down across the shaft, and then back again. The mirror image of each (left first,
              // then right) is opened as a second path: a fork that joins up again. Between forks he steps across.
              // Every gate of a maze is a double tap (r or l): two tumbles carry him four columns across and
              // stand him up again, so from gate to gate the path slants. How far a run can go is the room each side.
              const most = Math.min(3, Math.floor(Math.min(st.col - s.lo, s.hi - 1 - st.col) / 4));
              const inward = st.col + width(st) / 2 < (s.lo + s.hi) / 2 ? 1 : -1, ch = function (d) { return d > 0 ? 'r' : 'l'; };
              if (st.k % 2) motif = inward > 0 ? 'R' : 'L';         // lying flat: one tap stands him up, towards the middle
              else if (s.fork && !scripted) { scripted = true; motif = s.fork; fork = { ok: true, taps: [] }; drifted = true; }   // a written fork: two lanes that part and meet again
              else if (most >= 1 && !drifted) {
                // a fork: out one way and back again, with the mirror image open as the other path
                const n = most > 1 && rnd() < 0.7 ? most : 1 + Math.floor(rnd() * most), a = rnd() < 0.5 ? 1 : -1;
                motif = ch(a).repeat(n) + ch(-a).repeat(n);
                fork = { ok: true, taps: [] }; drifted = true;
              } else { motif = ch(most >= 1 && rnd() < 0.4 ? -inward : inward); drifted = false; }   // a step across, so the next fork is somewhere else
            } else motif = s.pattern || MOTIFS[Math.floor(rnd() * MOTIFS.length)];   // a made level's own pattern, round and round
          }
          const ch = motif[mi++];
          let n = ch === '-' ? 0 : (ch === 'l' || ch === 'r') && s.doubles ? 2 : 1, dir = ch === 'L' || ch === 'l' ? -1 : 1, cur = st;
          const want = dir;
          if (G > s.end - 10 && outDist(st, next)) { dir = st.col < next.lo ? 1 : -1; n = Math.max(1, n); }   // get inside for what comes next
          const go = function (d) { let c = st; for (let i = 0; i < n; i++) { c = mv(c, d); if (outDist(c, s)) return null; } return c; };
          const a = n ? go(dir) : st, bk = a || (n ? go(-dir) : null);
          if (!a && bk) { dir = -dir; if (s.maze) heading = -heading; }
          if (bk) cur = bk; else n = 0;
          if (fork) { if (dir !== want || (!n && ch !== '-')) fork.ok = false; for (let i = 0; i < n; i++) fork.taps.push({ beat: G - 0.5 + i * 0.25, dir: dir }); }
          for (let i = 0; i < n; i++) evs.push({ beat: G - 0.5 + i * 0.25, dir: dir, tap: true });
          gates.push({ beat: G, thick: 1, n: n, dir: dir, first: n ? G - 0.5 : 0, type: s.teeth ? 'tooth' : null });
          st = cur;
          continue;
        }
        // what this gate is, in a written-out level (kinds: taken in turn). A key's and a drip's one tap comes as
        // soon as there is room for it (early), not as late as it can.
        let slots = [], type = s.kinds ? s.kinds[gn++ % s.kinds.length] : null;
        const early = type === 'key' || type === 'drip';
        for (let t = G - 0.5; t >= prevClear + 0.05 && slots.length < 6; t -= early ? 0.25 : step) slots.unshift(t);
        const homing = G > s.end - 12, f = rnd();
        let kind = first ? null : f < (s.blow || 0) ? 'blow' : f < (s.blow || 0) + (s.spring || 0) ? 'spring' : null;
        first = false;
        if (rnd() < 0.12) heading = -heading;
        // keep heading one way across the level until a wall turns him round, so the route sweeps side to side
        const planGate = function (kind) {
          const sl = kind ? slots.filter(function (t) { return t >= G - 0.8; }) : slots;
          for (let tries = 0; tries < 50; tries++) {
            const dir = tries < 12 ? heading : rnd() < 0.5 ? -1 : 1, pre = [], taps = [];
            let cur = st, ok = true;
            if (kind === 'blow') {                                  // a blower shoves him two columns before he can tap
              const bd = tries % 2 ? -dir : dir;
              for (let i = 0; i < 2 && ok; i++) { cur = slide(cur, bd); if (outDist(cur, s)) ok = false; pre.push({ beat: G - 1.5 + i * 0.5, dir: bd }); }
            } else if (kind === 'spring') {                         // a spring flings him several columns
              const row = Math.ceil(L.rowAt(G - 1.3)), n = 3 + Math.floor(rnd() * 3), sd = tries % 2 ? -dir : dir;
              pre.push({ beat: L.beatAtRow(row) + 0.002, spring: true, dir: sd, n: n, row: row });
              cur = { col: cur.col + sd * n, k: cur.k };
              if (outDist(cur, s)) ok = false;
            }
            let n = tries >= 40 ? 0 : tries >= 25 ? 1 : s.minTaps + Math.floor(rnd() * (s.maxTaps - s.minTaps + 1));
            n = Math.min(n, early ? 1 : sl.length);
            for (let i = 0; i < n && ok; i++) {
              cur = mv(cur, dir);
              if (outDist(cur, s)) ok = false;
              taps.push({ beat: sl[early ? i : sl.length - n + i], dir: dir, tap: true });
            }
            if (!ok) { if (tries < 12 && !kind) heading = -heading; continue; }
            if (homing && tries < 40 && outDist(cur, next) > 0 && outDist(cur, next) >= outDist(st, next)) continue;
            if (n > 0) heading = dir;
            return { evs: pre.concat(taps), cur: cur, n: n, dir: dir, kind: kind };
          }
          return null;
        };
        // on a belt: it carries him a column twice before each gate (on the off-beats), and he taps with it or against it
        const planDrift = function () {
          for (let tries = 0; tries < 60; tries++) {
            const n = tries >= 50 ? 0 : Math.floor(rnd() * 3), dir = rnd() < 0.65 ? -s.drift : s.drift, list = [];
            let cur = st, ok = true;
            [G - 1.25, G - 1, G - 0.75, G - 0.5].forEach(function (t, i) {
              if (!ok || (i % 2 && n < (i === 1 ? 2 : 1))) return;
              cur = slide(cur, i % 2 ? dir : s.drift);
              if (outDist(cur, s)) ok = false;
              list.push(i % 2 ? { beat: t, dir: dir, tap: true } : { beat: t, dir: s.drift });
            });
            if (!ok || (homing && tries < 40 && outDist(cur, next) > 0 && outDist(cur, next) >= outDist(st, next))) continue;
            return { evs: list, cur: cur, n: n, dir: dir, kind: null };
          }
          return null;
        };
        const pick = (s.drift && planDrift()) || (kind && planGate(kind)) || planGate(null);
        if (!pick.n && (early || type === 'fire')) type = 'bar';     // nothing to tap there: an ordinary gate
        const thick = type ? 1 : s.thick && rnd() < s.thick ? 2 : 1, tapped = pick.evs.filter(function (e) { return e.tap; });
        if (type === 'warp') {                                       // the swirl on the gate's beat carries him to the same place on the other side of the shaft
          const to = s.lo + s.hi - width(pick.cur) - pick.cur.col, dx = to - pick.cur.col;
          if (Math.abs(dx) >= 5) { pick.evs.push({ beat: G + 0.002, warp: true, dx: dx, row: L.rowAt(G) }); pick.cur = { col: to, k: pick.cur.k }; } else type = 'bar';
        }
        pick.evs.forEach(function (e) { evs.push(e); });
        if (pick.kind === 'blow') bands.push({ r0: Math.floor(L.rowAt(G - 1.5)) - 2, r1: Math.ceil(L.rowAt(G - 1)) + 1, dir: pick.evs[0].dir });
        gates.push({ beat: G, thick: thick, n: pick.n, dir: pick.dir, kind: pick.kind, first: pick.n ? tapped[0].beat : 0, type: type });
        prevClear = G + (thick + 3) / s.rpb;
        st = pick.cur;
      }
      if (fork && fork.ok && mi >= motif.length) forks.push(fork);
      return outDist(st, next) ? null : { evs: evs, gates: gates, st: st, bands: bands, forks: forks };
    }

    // 1. walk the solution
    const init = { col: START_COL, k: 0 }, events = [], gateDefs = [], forkDefs = [];
    let st = init;
    sections.forEach(function (s, si) {
      const nx = sections[si + 1] || s, next = nx.door ? { lo: nx.door[0], hi: nx.door[1] } : nx;   // door: a stretch that has to be entered between two columns
      (s.gatesAt || []).forEach(function (g) { gateDefs.push({ beat: s.start + g, thick: 2, si: si, plain: true, n: 0, dir: 0 }); });
      if (!s.every) return;
      if (s.mode !== 'rotate') { events.push({ beat: s.start, upright: true }); st = upright(st); }
      let res = null;
      for (let a = 0; a < 400 && !res; a++) res = genGated(s, next, st);
      if (!res) throw new Error('no route through ' + s.name);
      res.evs.forEach(function (e) { events.push(e); });
      res.gates.forEach(function (g) { g.si = si; gateDefs.push(g); });
      res.bands.forEach(function (bd) { L.blowers.push(bd); });
      res.forks.forEach(function (f) { f.si = si; forkDefs.push(f); });
      st = res.st;
    });

    // 2. the states Frank is in, and when
    const segs = [];
    let cur = init, from = -8;
    events.forEach(function (ev) {
      segs.push({ st: cur, a: from, b: ev.beat });
      if (ev.spring) { L.springs.push({ row: ev.row, col: mid(cur), dir: ev.dir, n: ev.n }); cur = { col: cur.col + ev.dir * ev.n, k: cur.k }; }
      else if (ev.upright) cur = upright(cur);
      else if (ev.warp) { L.warps.push({ row: ev.row, col: mid(cur), dx: ev.dx, beat: ev.beat }); cur = { col: cur.col + ev.dx, k: cur.k }; }
      else cur = ev.tap && L.sectionAt(ev.beat).mode === 'rotate' ? rotate(cur, ev.dir) : slide(cur, ev.dir);
      from = ev.beat;
      if (ev.tap) L.plan.push({ beat: ev.beat, dir: ev.dir }); else if (!ev.spring && !ev.upright && !ev.warp) L.winds.push({ beat: ev.beat, dir: ev.dir });
    });
    segs.push({ st: cur, a: from, b: L.totalBeats + 8 });
    L.stateAt = function (beat) {
      // the state just before anything that happens exactly on this beat
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const md = lo + hi >> 1; if (beat <= segs[md].b) hi = md; else lo = md + 1; }
      return { col: segs[lo].st.col, k: segs[lo].st.k };
    };
    // 2b. the other way round each fork of a maze: the same taps mirrored. It ends where the walk does, so it is
    //     a real second path; it is kept as states too (L.alts), and everything below treats it as walked.
    L.alts = [];
    forkDefs.forEach(function (f) {
      const s = sections[f.si], mv = s.mode === 'slide' ? slide : rotate, list = [];
      let c = L.stateAt(f.taps[0].beat);
      for (let i = 0; i < f.taps.length - 1; i++) {
        c = mv(c, -f.taps[i].dir);
        if (outDist(c, s)) return;                                  // no room for it on that side: this run has one path
        list.push({ st: c, a: f.taps[i].beat, b: f.taps[i + 1].beat });
      }
      list.forEach(function (sg) { L.alts.push(sg); });
      L.forks.push({ si: f.si, taps: f.taps, segs: list });
    });
    const paths = segs.concat(L.alts);
    // does a path ever pass through this cell? (tol rows of slack for timing)
    function walked(row, col, tol) {
      for (let i = 0; i < paths.length; i++) {
        const sg = paths[i], w = width(sg.st);
        if (col >= sg.st.col && col < sg.st.col + w && row < L.rowAt(sg.b) + tol && row + 1 > L.rowAt(sg.a) - tol - (4 - w)) return true;
      }
      return false;
    }
    const isSolid = function (row, col) { return ((L.solids.get(row) || 0) >> col & 1) === 1; };

    // 3a. the gates only a written-out level has. Each is made from the hole the walk leaves (holeLo..holeHi):
    //     own = it has put its own blocks in (or has none), as = what the gate is, for the drawing and the sounds.
    const dynAdd = function (row, d) { if (!L.dyn.has(row)) L.dyn.set(row, []); L.dyn.get(row).push(d); };
    const bits = function (a, b) { let m = 0; for (let c = a; c <= b; c++) m |= 1 << c; return m; };
    let toothSide = 1;
    function special(g, s, row, masks, holeLo, holeHi) {
      const wd = holeHi - holeLo + 1, type = g.type;
      if (type === 'tooth') {
        // a tooth: out from one wall to a column short of him, the rest of the row open. It comes from the side he tumbled away from.
        toothSide = g.n ? -g.dir : -toothSide;
        let side = toothSide, m = side < 0 ? bits(s.lo, holeLo - 2) : bits(holeHi + 2, s.hi - 1);
        if (!m) { side = -side; m = side < 0 ? bits(s.lo, holeLo - 2) : bits(holeHi + 2, s.hi - 1); }
        if (m) L.solids.set(row, m);
        return { own: true, as: { type: 'tooth', side: side } };
      }
      if (type === 'slider') {
        const w = Math.min(s.hi - s.lo, wd + 2), dir = rnd() < 0.5 ? -1 : 1, k = Math.floor(g.beat + 0.25);
        dynAdd(row, { kind: 'slider', lo: s.lo, hi: s.hi, w: w, x0: Math.max(s.lo, Math.min(s.hi - w, holeLo - 1)), dir: dir, k: k });
        for (let j = k - 3; j <= k; j++) L.sounds.push({ beat: j - 0.25, s: 'step' });
        return { own: true, as: { type: 'slider', sdir: dir } };
      }
      if (type === 'volley') {                                       // no blocks at all: fire up every column but the three he is to be in
        L.volleys.push({ beat: g.beat, lo: Math.max(s.lo, holeLo - 1), hi: Math.min(s.hi - 1, holeHi + 1), si: g.si });
        L.sounds.push({ beat: g.beat - 2, s: 'charge' }, { beat: g.beat, s: 'volley' });
        return { own: true, as: { type: 'volley' } };
      }
      if (type === 'warp') {
        if (!L.warps.some(function (x) { return Math.abs(x.beat - g.beat) < 0.01; })) return null;
        // his lane ends in a floor under the swirl, and a wall stands between the two lanes down to the next gate
        const a = L.stateAt(g.beat), b = L.stateAt(g.beat + 0.01), right = b.col > a.col, x = right ? Math.floor((a.col + width(a) + b.col) / 2) : Math.floor((b.col + width(b) + a.col) / 2);
        L.solids.set(row + 1, right ? bits(s.lo, x) : bits(x, s.hi - 1));
        for (let r = row - 7; r < row + s.rpb * s.every - 2; r++) if (r !== row + 1 && !walked(r, x, 1)) L.solids.set(r, (L.solids.get(r) || 0) | 1 << x);
        L.sounds.push({ beat: g.beat, s: 'warp' });
        return { own: true, as: { type: 'warp' } };
      }
      if (type === 'door' || type === 'door1') {
        // doors swap on the beat, every two beats: his is open from a beat before he gets there to a beat after, the other one the other half
        dynAdd(row, { kind: 'door', c0: holeLo, c1: holeHi, per: 4, off: g.beat - 1 });
        const at = [];
        for (let c = s.lo; c + wd <= s.hi; c++) if (Math.abs(c - holeLo) >= wd + 3) at.push(c);
        if (type === 'door' && at.length) {
          const c = at[Math.floor(rnd() * at.length)];
          masks[0] &= ~bits(c, c + wd - 1);
          dynAdd(row, { kind: 'door', c0: c, c1: c + wd - 1, per: 4, off: g.beat + 1 });
        }
        [-3, -1, 1].forEach(function (d) { L.sounds.push({ beat: g.beat + d, s: 'door' }); });
        return { as: { type: 'door' } };
      }
      if (type === 'key') {
        // a lock in the hole, and its key where only an early tumble passes: tap late and the key has gone by
        const tb = g.first, before = L.stateAt(tb), after = s.mode === 'rotate' ? rotate(before, g.dir) : slide(before, g.dir), hA = 4 - width(after);
        const kr = Math.floor(L.rowAt(tb) + 0.5 * s.rpb) - hA, col = g.dir > 0 ? Math.max(after.col, before.col + width(before)) : Math.min(after.col + width(after) - 1, before.col - 1);
        if (col < s.lo || col >= s.hi || isSolid(kr, col)) return null;
        dynAdd(row, { kind: 'lock', c0: holeLo, c1: holeHi, key: L.keys.length });
        L.keys.push({ row: kr, col: col, gate: row, c: (holeLo + holeHi + 1) / 2 });
        return { as: { type: 'key' } };
      }
      if (type === 'bat') {
        // the gap is opened wide to one side and a bat paces that side: only the end it never reaches is safe
        const left = holeLo - s.lo, right = s.hi - 1 - holeHi, side = right >= left ? 1 : -1, n = Math.min(5, Math.max(left, right) - 1);
        if (n < 3) return null;
        masks[0] &= ~(side > 0 ? bits(holeHi + 1, holeHi + n) : bits(holeLo - n, holeLo - 1));
        L.foes.push({ kind: 'bat', row: row, x0: side > 0 ? holeHi + n : holeLo - n, x1: side > 0 ? holeHi + 2 : holeLo - 2, per: 2, ph: g.beat, a: g.beat - 4, la: g.beat - 1, b: g.beat + 1 });
        return { as: { type: 'bat' } };
      }
      return { as: { type: type } };                                 // fire, drip: an ordinary gate with something coming (6b)
    }

    // 3. cut the gates around the walk
    gateDefs.forEach(function (g) {
      const s = sections[g.si], row = L.rowAt(g.beat), tol = s.riff ? 0 : Math.max(0.8, 0.12 * s.rpb), pad = 0;
      let holeLo = WIDE, holeHi = 0, full = 0;
      for (let c = s.lo; c < s.hi; c++) full |= 1 << c;
      const masks = [];
      for (let t = 0; t < g.thick; t++) {
        let mask = full;
        paths.forEach(function (sg) {
          const w = width(sg.st), h = 4 - w;
          if (row + t < L.rowAt(sg.b) + tol && row + t + 1 > L.rowAt(sg.a) - tol - h) {
            for (let c = Math.max(s.lo, sg.st.col - pad); c < Math.min(s.hi, sg.st.col + w + pad); c++) {
              mask &= ~(1 << c);
              holeLo = Math.min(holeLo, c); holeHi = Math.max(holeHi, c);
            }
          }
        });
        masks.push(mask);
      }
      const decoy = !g.plain && rnd() < (s.decoys || 0), loose = !g.plain && rnd() < (s.loose || 0);
      const dw = rnd() < 0.5 ? 1 : 3, dc = s.lo + Math.floor(rnd() * (s.hi - s.lo - dw + 1));
      const made = g.type && g.type !== 'bar' && holeHi >= holeLo ? special(g, s, row, masks, holeLo, holeHi) : null;
      if (!made || !made.own) masks.forEach(function (mask, t) {
        if (decoy) for (let c = dc; c < dc + dw; c++) mask &= ~(1 << c);
        // an island: only the blocks near the hole stay
        if (loose) for (let c = s.lo; c < s.hi; c++) if (c < holeLo - 3 || c > holeHi + 3) mask &= ~(1 << c);
        if (mask) L.solids.set(row + t, mask);
      });
      L.gates.push(Object.assign({ row: row, thick: g.thick, si: g.si, beat: g.beat, n: g.n, dir: g.dir, hole: (holeLo + holeHi + 1) / 2, go: 0 }, made && made.as));
    });
    L.gates.sort(function (x, y) { return x.row - y.row; });

    // 3b. a maze's walls: between its gates, a wall runs down each side of every path, stepping across with it,
    //     so the paths read as slanting corridors. Half a beat of slack either way is left open for the timing.
    sections.forEach(function (s) {
      if (!s.maze) return;
      const tol = 0.5 * s.rpb, near = paths.filter(function (sg) { return sg.b > s.start - 2 && sg.a < s.end + 2; });
      const open = function (row, col) {
        for (let i = 0; i < near.length; i++) {
          const sg = near[i], w = width(sg.st);
          if (col >= sg.st.col && col < sg.st.col + w && row < L.rowAt(sg.b) + tol && row + 1 > L.rowAt(sg.a) - tol - (4 - w)) return true;
        }
        return false;
      };
      for (let row = s.startRow + 4; row < s.endRow - 4; row++) {
        if (L.solids.has(row)) continue;
        let mask = 0;
        for (let c = s.lo; c < s.hi; c++) if (!open(row, c) && ((c > s.lo && open(row, c - 1)) || (c < s.hi - 1 && open(row, c + 1)))) mask |= 1 << c;
        if (mask) L.solids.set(row, mask);
      }
    });

    // 4. posts: a block right where the first tap of a gate would put him, a little too early.
    //    Tap before he has dropped past it and he lands on it, so the taps have a "not yet" as well as a "too late".
    L.gates.forEach(function (g) {
      const s = sections[g.si];
      if (!g.n || !s.post || rnd() >= s.post) return;
      const def = gateDefs.filter(function (d) { return d.beat === g.beat; })[0], tb = def.first, tol = Math.max(0.8, 0.12 * s.rpb);
      if (def.kind) return;                                          // a blower or spring already sets the timing there
      const before = L.stateAt(tb), after = s.mode === 'rotate' ? rotate(before, g.dir) : slide(before, g.dir);
      const hA = 4 - width(after), row = Math.floor(L.rowAt(tb) - hA - tol - 1.5);
      const col = g.dir > 0 ? Math.max(after.col, before.col + width(before)) : Math.min(after.col + width(after) - 1, before.col - 1);
      if (col < s.lo || col >= s.hi || row < s.startRow + 2 || isSolid(row, col) || isSolid(row - 1, col) || isSolid(row + 1, col) || walked(row, col, tol)) return;
      L.solids.set(row, (L.solids.get(row) || 0) | 1 << col);
      L.posts[row + ':' + col] = true;
      g.go = L.beatAtRow(row + 1 + hA);                              // from this beat on, the first tap is safe
    });

    // 5. tokens along the walk: one in every gate's hole and one halfway to it, so they also show the way
    const seen = {};
    gateDefs.forEach(function (g) {
      if (g.plain) return;
      const s = sections[g.si];
      (s.riff ? [g.beat + 0.3] : [g.beat - s.every / 2 + 0.3, g.beat + 0.3]).forEach(function (tb) {   // riffs have a gate a beat: one token each
        const row = Math.floor(L.rowAt(tb) - 0.5), col = mid(L.stateAt(tb));
        if (seen[row + ':' + col] || isSolid(row, col)) return;
        seen[row + ':' + col] = true;
        L.tokens.push({ row: row, col: col });
      });
    });
    L.tokens.sort(function (x, y) { return x.row - y.row; });

    // 6. saws: they travel down beside Frank for a few beats, swinging in time. Each swings on one side
    //    of the walk, reaching right up to it at the inside of its swing: it never touches the walk, but it
    //    kills a move that way at the wrong moment.
    sections.forEach(function (s) {
      for (let k = 0; k < (s.saws || 0); k++) {
        for (let tries = 0; tries < 80; tries++) {
          const a = s.start + 2 + Math.floor(rnd() * (s.beats - 12)), e = a + 6, side = rnd() < 0.5 ? -1 : 1;
          if (L.saws.some(function (o) { return a < o.b + 2 && e > o.a - 2; })) continue;
          let edge = side > 0 ? -1 : WIDE;                           // the walk's furthest reach on that side
          for (let t = a - 0.2; t <= e + 0.2; t += 0.05) { const p = L.stateAt(t); edge = side > 0 ? Math.max(edge, p.col + width(p)) : Math.min(edge, p.col - 1); }
          const amp = 2 + Math.floor(rnd() * 2), saw = { a: a, b: e, base: edge + side * amp, amp: amp, per: rnd() < 0.5 ? 2 : 4, ph: Math.floor(rnd() * 8) / 2 };
          if (edge + side * 2 * amp < s.lo || edge + side * 2 * amp >= s.hi) continue;
          let near = 0;
          for (let t = a; t <= e; t += 0.05) { const c = sawCol(saw, t), p = L.stateAt(t); if (c === p.col - 1 || c === p.col + width(p)) near++; }
          if (near >= 3) { L.saws.push(saw); break; }
        }
      }
    });

    // 6b. what moves in a written-out level (foeAt, above). Fire and drips hang on a gate's first tap: fire comes up
    //     the column that tap takes him into, a little before the tap's own beat (tap sooner and he is in it); a drip
    //     comes down the column the tap takes him out of, half a beat after (tap later and it has him).
    const moveOf = function (s) { return s.mode === 'rotate' ? rotate : slide; };
    const newCol = function (before, after, dir) { return dir > 0 ? Math.max(after.col, before.col + width(before)) : Math.min(after.col + width(after) - 1, before.col - 1); };
    const addFire = function (s, tap, before, after, dir) {
      const tb = tap - 0.35, col = newCol(before, after, dir);
      if (col < s.lo || col >= s.hi || tb - 2 < s.start) return;
      L.foes.push({ kind: 'fire', col: col, tb: tb, y: L.rowAt(tb), v: s.rpb, a: tb - 2.3, la: tb - 0.3, b:tb + 0.6 });
      L.sounds.push({ beat: Math.round(tb * 4) / 4 - 2, s: 'fire' });
    };
    gateDefs.forEach(function (g) {
      const s = sections[g.si], fire = g.n > 0 && (g.type === 'fire' || (!!s.riff && !!s.fire && rnd() < s.fire)), drip = g.n > 0 && g.type === 'drip';
      if (!fire && !drip) return;
      const before = L.stateAt(g.first), after = moveOf(s)(before, g.dir);
      if (fire) return addFire(s, g.first, before, after, g.dir);
      const tb = g.first + 0.55;
      L.foes.push({ kind: 'drip', col: mid(before), tb: tb, y: L.rowAt(tb), v: s.rpb, end: L.rowAt(g.beat), a: tb - 2.2, la: tb - 0.1, b: tb + (g.beat - tb) / 2 + 0.25 });
      L.sounds.push({ beat: Math.round(tb * 4) / 4 - 1, s: 'drip' });
    });
    // wisps: like the saws, each keeps to one side of the walk and comes right up to it, but round and round
    sections.forEach(function (s) {
      for (let k = 0; k < (s.wisps || 0); k++) {
        for (let tries = 0; tries < 80; tries++) {
          const a = s.start + 3 + Math.floor(rnd() * (s.beats - 12)), e = a + 6, side = rnd() < 0.5 ? -1 : 1, r = 2;
          if (L.foes.some(function (o) { return o.kind === 'wisp' && a < o.b + 2 && e > o.a - 2; })) continue;
          let edge = side > 0 ? -1 : WIDE;
          for (let t = a - 1.7; t <= e + 0.2; t += 0.05) { const p = L.stateAt(t); edge = side > 0 ? Math.max(edge, p.col + width(p)) : Math.min(edge, p.col - 1); }
          if (edge + side * 2 * r < s.lo || edge + side * 2 * r >= s.hi) continue;
          L.foes.push({ kind: 'wisp', cx: edge + 0.5 + side * r, side: side, r: r, per: 2, ph: a, a: a - 2, la: a, b: e });
          break;
        }
      }
    });
    // a slide's two lanes: the walk keeps to the quiet one; the other one (the fork's mirror image) has twice the
    // tokens, and fire to wait for on each of its tumbles
    L.forks.forEach(function (f) {
      const s = sections[f.si];
      if (!s.lanes) return;
      f.segs.forEach(function (sg, i) {
        for (let t = sg.a + 0.2; t < sg.b - 0.05; t += 0.25) { const row = Math.floor(L.rowAt(t) - 0.5), col = mid(sg.st); if (!seen[row + ':' + col] && !isSolid(row, col)) { seen[row + ':' + col] = true; L.tokens.push({ row: row, col: col }); } }
        const tap = f.taps[i + 1];
        if (tap && tap.beat - f.taps[i].beat >= 0.9 && f.segs[i + 1]) addFire(s, tap.beat, sg.st, f.segs[i + 1].st, -tap.dir);
      });
      L.tokens.sort(function (x, y) { return x.row - y.row; });
    });

    // 7. portals: one tap more than a gate asks for, right before it, lands him in a portal instead of on the gate.
    //    Inside is a bonus room of tokens; it drops him back on the walk four gates later.
    let bonusTokens = 0;
    sections.forEach(function (s, si) {
      if (!s.portal) return;
      const mine = L.gates.filter(function (g) { return g.si === si && g.n > 0; });
      for (let tries = 0; tries < 12; tries++) {
        const g = mine[1 + Math.floor(rnd() * Math.max(1, mine.length - 7))];
        if (!g) return;
        const out = g.beat + 4 * s.every + 0.63;
        if (g.beat + 4 * s.every > s.end - 4) continue;
        const base = L.stateAt(g.beat - 0.2), alt = s.mode === 'rotate' ? rotate(base, g.dir) : slide(base, g.dir);
        const row = Math.floor(g.row) - 2, col = g.dir > 0 ? Math.max(alt.col, base.col + width(base)) : Math.min(alt.col + width(alt) - 1, base.col - 1);
        if (outDist(alt, s) || isSolid(row, col) || walked(row, col, 1.5)) continue;
        let clear = true;
        for (let B = L.rowAt(g.beat - 0.5); B <= row + 0.2 && clear; B += 0.25) if (blocked(L, alt, B)) clear = false;
        const from = L.beatAtRow(row), toks = [];
        L.saws.forEach(function (w) {                                    // no saw across the way in
          for (let t = g.beat - 0.6; t <= from + 0.1; t += 0.05) { const c = t >= w.a && t <= w.b ? sawCol(w, t) : -9; if (c >= alt.col && c < alt.col + width(alt)) clear = false; }
        });
        if (!clear) continue;
        for (let t = from + 1; t < out - 0.8; t += 0.25) {                // a lazy wave of tokens to slide along
          const c = Math.max(1, Math.min(WIDE - 2, Math.round(col + 3 * Math.sin((t - from - 1) * Math.PI / 4)))), rr = Math.floor(L.rowAt(t));
          toks.push({ row: rr, col: c });
          if (Math.round(t * 4) % 4 === 0) { toks.push({ row: rr, col: c - 1 }); toks.push({ row: rr, col: c + 1 }); }
        }
        L.portals.push({ row: row, col: col, bi: L.bonus.length, tapBeat: g.beat - 0.35, dir: g.dir });
        L.bonus.push({ from: from, to: out, tokens: toks });
        bonusTokens += toks.length;
        return;
      }
    });
    L.maxTokens = L.tokens.length + bonusTokens;

    // 8. the hard levels: stretches in the dark (fogs) and stretches where left and right are swapped (mirrors).
    //    Neither changes where anything is, only what the player sees or which side to tap.
    const d = spec.hard || 1;
    L.mirrors = []; L.fogs = [];
    const zones = function (list, len, count, gatedOnly) {
      const ok = sections.filter(function (s) { return s.every && s.key !== 'manhole' && s.key !== 'chute'; });
      for (let tries = 0; tries < 60 && list.length < count && ok.length; tries++) {
        const s = ok[Math.floor(rnd() * ok.length)], a = s.start + 2 * Math.floor(rnd() * (s.beats - len - 6) / 2) + 2.7, e = a + len;
        if (L.mirrors.concat(L.fogs).some(function (z) { return a < z.b + 3 && e > z.a - 3; })) continue;
        list.push({ a: a, b: e });
      }
    };
    zones(L.mirrors, 6, d >= 5 ? 3 : d >= 4 ? 2 : 0, true);
    zones(L.fogs, 8, d >= 5 ? 3 : d >= 3 ? 2 : 0, false);
    L.zoneAt = function (list, beat) { for (let i = 0; i < list.length; i++) if (beat >= list[i].a && beat < list[i].b) return list[i]; return null; };
    if (spec.defs) extras();
    return L;

    // 9. the rest of what a written-out level may ask for, stretch by stretch, and its hidden things (spec.secrets).
    //    A secret is { id, kind, sec (the stretch's key) }; what has to be done to find each is kept in L.secrets
    //    (how: taps to add to the solution, taps of it to turn round, or a portal to take), which is what the tests play.
    function extras() {
      const byKey = {}, quiet = function (a, b) { return !L.plan.some(function (p) { return p.beat > a && p.beat < b; }) && !L.winds.some(function (w) { return w.beat > a && w.beat < b; }); };
      const hurt = function (st, a, b) {                             // would anything that moves touch him there, then?
        for (let t = a; t <= b; t += 0.05) for (let i = 0; i < L.foes.length; i++) {
          const f = L.foes[i];
          if (t < f.a || t > f.b) continue;
          const q = foeAt(L, f, t), B2 = L.rowAt(t);
          if (q.x < st.col + width(st) + 0.3 && q.x + q.w > st.col - 0.3 && q.y < B2 + 0.5 && q.y + q.h > B2 - (4 - width(st)) - 0.5) return true;
        }
        return false;
      };
      const wave = function (from, out, col) {                       // a lazy wave of tokens to slide along, as in a bonus room
        const toks = [];
        for (let t = from + 1; t < out - 0.8; t += 0.25) {
          const c = Math.max(1, Math.min(WIDE - 2, Math.round(col + 3 * Math.sin((t - from - 1) * Math.PI / 4)))), rr = Math.floor(L.rowAt(t));
          toks.push({ row: rr, col: c });
          if (Math.round(t * 4) % 4 === 0) { toks.push({ row: rr, col: c - 1 }); toks.push({ row: rr, col: c + 1 }); }
        }
        return toks;
      };
      sections.forEach(function (s, si) {
        byKey[s.key] = si;
        (s.flips || []).forEach(function (z) { L.mirrors.push({ a: s.start + z[0] + 0.7, b: s.start + z[1] + 0.7, arch: true }); L.sounds.push({ beat: s.start + z[0], s: 'flip' }, { beat: s.start + z[1], s: 'flip' }); });
        if (s.grudge) L.grudges.push({ a: s.start + s.grudge[0], b: s.start + s.grudge[1] });
        if (s.trail) for (let t = s.start + 1; t < s.end - 1; t += 0.5) { const row = Math.floor(L.rowAt(t)), col = mid(L.stateAt(t)); if (!isSolid(row, col)) L.tokens.push({ row: row, col: col }); }
        if (s.wall) for (let r = s.endRow + 3; r < s.endRow + 12; r++) L.solids.set(r, bits(s.lo, s.hi - 1));   // the end of a taste: nothing gets past
      });
      (spec.secrets || []).forEach(function (sc) {
        const si = byKey[sc.sec], s = sections[si], mv = s && moveOf(s), put = function (how, more) { L.secrets.push(Object.assign({ id: sc.id, kind: sc.kind, si: si, how: how }, more)); };
        if (sc.kind === 'clear') return put({ win: sc.diff });          // for whoever gets to the bottom on that difficulty or harder (the game tells the server)
        if (!s) return;
        if (sc.kind === 'spin') {
          // four tumbles the same way with no gate asking for them, in a stretch with room: he is dizzy, and it rains tokens
          const t0 = s.start + 2, c = L.stateAt(t0), dir = c.col + 8 < s.hi - 1 ? 1 : -1, add = [];
          for (let i = 0; i < 8; i++) add.push({ beat: t0 + i * 0.5, dir: i < 4 ? dir : -dir });
          L.spins.push({ a: s.start, b: s.end, id: sc.id });
          for (let t = t0 + 4.5; t < s.end - 1; t += 0.25) L.rain.push({ row: Math.floor(L.rowAt(t)), col: mid(c) });
          return put({ add: add });
        }
        if (sc.kind === 'gold') {
          // golden tokens down the other way round one fork of a maze: all of them in one go
          const f = L.forks.filter(function (x) { return x.si === si && x.segs.length >= 3; })[0];
          if (!f) return;
          const cells = [];
          f.segs.forEach(function (sg) { if (sg.b - sg.a < 0.5) return; const row = Math.floor(L.rowAt(sg.a + 0.55) - 0.5), col = mid(sg.st); if (!isSolid(row, col)) cells.push({ row: row, col: col, g: L.golds.length }); });
          if (cells.length < 2) return;
          L.golds.push({ id: sc.id, cells: cells });
          return put({ flip: f.taps.map(function (p) { return p.beat; }) });
        }
        if (sc.kind === 'spot') {
          // something to brush against, one move off the way and one move back, where nothing else is going on
          for (let t = s.start + (sc.at || 4) + 0.25; t < s.end - 4; t += 0.25) for (let d = -1; d <= 1; d += 2) {
            const st0 = L.stateAt(t + 0.001), dt = mv(st0, d);
            if (!quiet(t - 0.3, t + 0.9) || outDist(dt, s) || (s.mode === 'rotate' && st0.k % 2) || hurt(dt, t - 0.1, t + 0.7) || hurt(st0, t + 0.4, t + 1)) continue;
            let clear = true;
            for (let B2 = L.rowAt(t) - 0.2; B2 <= L.rowAt(t + 0.6) && clear; B2 += 0.25) if (blocked(L, dt, B2)) clear = false;
            for (let B2 = L.rowAt(t + 0.4); B2 <= L.rowAt(t + 1) && clear; B2 += 0.25) if (blocked(L, st0, B2)) clear = false;
            const row = Math.floor(L.rowAt(t + 0.25)) - (width(dt) === 3 ? 1 : 2), col = d > 0 ? dt.col + width(dt) - 1 : dt.col;
            if (!clear || isSolid(row, col) || walked(row, col, 2)) continue;
            L.spots.push({ row: row, col: col, id: sc.id, art: sc.art, dir: d });
            return put({ add: [{ beat: t, dir: d }, { beat: t + 0.5, dir: -d }] });
          }
          return;
        }
        if (sc.kind === 'room' && sc.via === 'wall') {
          // a piece of the shaft's wall that is not there: tumble into it and he is in a room behind it
          for (let t = s.start + (sc.at || 4) + 0.75; t < s.end - 10; t += 1) for (let d = -1; d <= 1; d += 2) {
            const st0 = L.stateAt(t + 0.001), dt = mv(st0, d), out = Math.ceil(t) + 5.63;
            if (!(d < 0 ? dt.col < s.lo : dt.col + width(dt) > s.hi) || !quiet(t - 0.3, t + 0.3) || hurt(st0, t - 0.2, t + 0.1) || blocked(L, L.stateAt(out), L.rowAt(out))) continue;
            const toks = wave(t, out, mid(st0));
            L.portals.push({ wall: true, side: d, a: t - 0.3, b: t + 0.3, r0: Math.floor(L.rowAt(t - 0.3)) - 3, r1: Math.ceil(L.rowAt(t + 0.3)), row: Math.floor(L.rowAt(t)), col: d < 0 ? s.lo - 1 : s.hi, bi: L.bonus.length, tapBeat: t, dir: d, secret: sc.id });
            L.bonus.push({ from: t, to: out, tokens: toks, look: sc.look, name: sc.name });
            L.maxTokens += toks.length;
            return put({ add: [{ beat: t, dir: d }] });
          }
          return;
        }
        if (sc.kind === 'room') {
          // a block on a gate that is not one: one tap more than the gate asks for, right before it, and he is through it
          const mine = L.gates.filter(function (g) { return g.si === si && g.n > 0 && (!g.type || g.type === 'bar'); });
          for (let i = 1; i < mine.length; i++) {
            const g = mine[i], out = g.beat + 4 * s.every + 0.63;
            if (out > s.end - 2) break;
            const base = L.stateAt(g.beat - 0.2), alt = mv(base, g.dir), row = Math.floor(g.row) - 2, col = newCol(base, alt, g.dir);
            if (outDist(alt, s) || isSolid(row, col) || walked(row, col, 1.5) || hurt(alt, g.beat - 0.7, g.beat) || L.portals.some(function (p) { return Math.abs(p.tapBeat - g.beat) < 12; })) continue;
            let clear = true;
            for (let B2 = L.rowAt(g.beat - 0.5); B2 <= row + 0.2 && clear; B2 += 0.25) if (blocked(L, alt, B2)) clear = false;
            if (!clear) continue;
            const from = L.beatAtRow(row), toks = wave(from, out, col);
            L.portals.push({ fake: true, row: row, col: col, bi: L.bonus.length, tapBeat: g.beat - 0.35, dir: g.dir, secret: sc.id });
            L.bonus.push({ from: from, to: out, tokens: toks, look: sc.look, name: sc.name });
            L.maxTokens += toks.length;
            return put({ portal: L.portals.length - 1 });
          }
        }
      });
      L.tokens.sort(function (x, y) { return x.row - y.row; });
      L.sounds.sort(function (x, y) { return x.beat - y.beat; });
      L.maxTokens = L.tokens.length + L.rain.length + L.bonus.concat(L.golds).reduce(function (n, x) { return n + (x.tokens || x.cells).length; }, 0);
    }
  }

  // One attempt. The caller owns the clock and feeds beats in. Touching anything is death.
  function Run(level) { this.level = level; this.reset(0); }
  Run.prototype.reset = function (si) {
    const L = this.level, s = L.sections[si];
    this.checkpoint = si;
    this.beat = si ? s.start - 2 : 1;   // from the top he starts just above his skyline, not far up in the empty sky
    this.B = L.rowAt(this.beat);
    this.st = L.stateAt(this.beat);
    this.wi = 0; this.gi = 0; this.ti = 0;
    this.got = {}; this.count = 0;   // tokens picked up this attempt
    this.sprung = {}; this.entered = {}; this.bonus = null; this.bgot = {};
    this.taps = 0;                   // taps since the last gate
    // a written-out level: keys held, swirls taken, hidden things found this attempt, golden tokens, the tumbles of a
    // spin, the column the grudge has its eye on, and what a tap set off, to be told at the next step
    this.keys = {}; this.warped = {}; this.found = {}; this.ggot = {}; this.rgot = {}; this.spotted = {};
    this.spin = 0; this.spinDir = 0; this.dizzy = false; this.lockK = -1; this.lockCol = -9; this.pend = [];
    for (let i = 0; i < L.keys.length; i++) if (L.keys[i].row < this.B) this.keys[i] = true;   // starting part of the way down: the keys already behind him are his
    this.sec = L.sectionIndexAt(this.beat);
    while (this.wi < L.winds.length && L.winds[this.wi].beat < this.beat) this.wi++;
    while (this.gi < L.gates.length && L.gates[this.gi].row + L.gates[this.gi].thick <= this.B) this.gi++;
  };
  // Crossing into another stretch: slime stands him up.
  Run.prototype.cross = function (beat, out) {
    const L = this.level, now = L.sectionIndexAt(beat);
    if (now === this.sec) return;
    const s = L.sections[now];
    this.sec = now;
    if (this.bonus) return;
    if (s.mode !== 'rotate') { this.st = upright(this.st); out.push({ type: 'upright' }); }
  };
  Run.prototype.tap = function (dir, beat) {
    const L = this.level, sec = L.sectionAt(beat), mode = this.bonus ? 'slide' : sec.mode;
    this.cross(beat, []);
    this.st = mode === 'rotate' ? rotate(this.st, dir) : slide(this.st, dir);
    this.taps++;
    if (!this.bonus && L.portals.length) for (let i = 0; i < L.portals.length; i++) {   // a piece of wall that is not there: through it, into the room behind
      const p = L.portals[i];
      if (!p.wall || this.entered[i] || beat < p.a || beat > p.b || p.dir !== dir || !(dir < 0 ? this.st.col < sec.lo : this.st.col + width(this.st) > sec.hi)) continue;
      this.entered[i] = true; this.bonus = L.bonus[p.bi]; this.bgot = {};
      this.st = { col: Math.max(0, Math.min(WIDE - 1, mid(this.st))), k: 0 };
      this.pend.push({ type: 'upright' }, { type: 'bonus' });
      this.find(p.secret, this.pend);
      return { ok: true, mode: mode };
    }
    const z = !this.bonus && L.spins.length ? L.zoneAt(L.spins, beat) : null;
    if (z) {                                                        // the same way four times running, where nothing asks for it: dizzy
      this.spin = dir === this.spinDir ? this.spin + 1 : 1; this.spinDir = dir;
      if (this.spin >= 4) { this.dizzy = true; this.find(z.id, this.pend); }
    }
    return { ok: !blocked(L, this.st, L.rowAt(beat), 0, 0, !!this.bonus, this), mode: mode };
  };
  // a hidden thing found: told once an attempt
  Run.prototype.find = function (id, out) { if (id && !this.found[id]) { this.found[id] = true; out.push({ type: 'secret', id: id }); } };
  Run.prototype.advance = function (beat) {
    const L = this.level, out = [];
    this.beat = beat;
    this.B = L.rowAt(beat);
    this.cross(beat, out);
    if (this.pend.length) { for (let i = 0; i < this.pend.length; i++) out.push(this.pend[i]); this.pend = []; }
    if (this.bonus && beat >= this.bonus.to) {                      // the bonus room drops him back on the walk
      this.st = L.stateAt(this.bonus.to);
      while (this.wi < L.winds.length && L.winds[this.wi].beat < this.bonus.to) this.wi++;
      this.bonus = null; this.taps = 0;
      out.push({ type: 'bonusEnd' });
    }
    while (this.wi < L.winds.length && L.winds[this.wi].beat <= beat) {
      const w = L.winds[this.wi++];
      if (this.bonus) continue;
      this.st = slide(this.st, w.dir);
      out.push({ type: 'wind', dir: w.dir });
      if (blocked(L, this.st, this.B, 0, 0, false, this)) { out.push({ type: 'dead', how: 'bonk' }); return out; }
    }
    let w = width(this.st), h = 4 - w;
    const st = this.st, B = this.B, c0 = Math.round(st.col), on = function (k) { return k.col >= c0 && k.col < c0 + w && k.row < B && k.row + 1 > B - h; };
    if (!this.bonus) {
      for (let i = 0; i < L.warps.length; i++) if (!this.warped[i] && L.warps[i].row < B && L.warps[i].row + 1 > B - h && mid(st) === L.warps[i].col) {
        this.warped[i] = true;                                      // into the swirl dead centre, and out on the other side
        this.st = { col: st.col + L.warps[i].dx, k: st.k };
        out.push({ type: 'warp', dx: L.warps[i].dx });
        return out.concat(this.advance(beat));
      }
      for (let i = 0; i < L.springs.length; i++) if (!this.sprung[i] && on(L.springs[i])) {
        const sp = L.springs[i];
        this.sprung[i] = true;
        this.st = { col: st.col + sp.dir * sp.n, k: st.k };
        out.push({ type: 'spring', dir: sp.dir, n: sp.n });
        if (blocked(L, this.st, B)) { out.push({ type: 'dead', how: 'bonk' }); return out; }
        return out.concat(this.advance(beat));
      }
      for (let i = 0; i < L.portals.length; i++) if (!this.entered[i] && on(L.portals[i])) {
        this.entered[i] = true;
        this.bonus = L.bonus[L.portals[i].bi]; this.bgot = {};
        this.st = upright(this.st); out.push({ type: 'upright' });
        out.push({ type: 'bonus' });
        this.find(L.portals[i].secret, out);
      }
    }
    while (this.gi < L.gates.length && L.gates[this.gi].row + L.gates[this.gi].thick <= B - 1) { this.gi++; this.taps = 0; out.push({ type: 'gate' }); }
    if (this.bonus) {
      const tk = this.bonus.tokens;
      for (let i = 0; i < tk.length; i++) if (!this.bgot[i] && on(tk[i])) { this.bgot[i] = true; this.count++; out.push({ type: 'token', at: tk[i] }); }
    } else {
      while (this.ti < L.tokens.length && L.tokens[this.ti].row + 1 <= B - h) this.ti++;
      for (let i = this.ti; i < L.tokens.length && L.tokens[i].row < B; i++) {
        if (!this.got[i] && on(L.tokens[i])) { this.got[i] = true; this.count++; out.push({ type: 'token', at: L.tokens[i] }); }
      }
      for (let i = 0; i < L.keys.length; i++) if (!this.keys[i] && on(L.keys[i])) { this.keys[i] = true; out.push({ type: 'key', at: L.keys[i] }); }
      for (let i = 0; i < L.golds.length; i++) {                    // golden tokens: every one of a set, in one attempt
        const cells = L.golds[i].cells;
        let n = 0;
        for (let j = 0; j < cells.length; j++) { if (!this.ggot[i + ':' + j] && on(cells[j])) { this.ggot[i + ':' + j] = true; this.count++; out.push({ type: 'token', at: cells[j], gold: true }); } if (this.ggot[i + ':' + j]) n++; }
        if (n === cells.length && !this.found[L.golds[i].id]) { out.push({ type: 'gold' }); this.find(L.golds[i].id, out); }
      }
      if (this.dizzy) for (let i = 0; i < L.rain.length; i++) if (!this.rgot[i] && on(L.rain[i])) { this.rgot[i] = true; this.count++; out.push({ type: 'token', at: L.rain[i] }); }
      for (let i = 0; i < L.spots.length; i++) if (!this.spotted[i] && on(L.spots[i])) { this.spotted[i] = true; out.push({ type: 'spot', art: L.spots[i].art, at: L.spots[i] }); this.find(L.spots[i].id, out); }
    }
    const si = L.sectionIndexAt(beat);
    if (si > this.checkpoint) { this.checkpoint = si; out.push({ type: 'section', si: si }); }
    if (!this.bonus) for (let i = 0; i < L.saws.length; i++) {
      const c = beat >= L.saws[i].a && beat <= L.saws[i].b ? sawCol(L.saws[i], beat) : -9;
      if (c >= st.col && c < st.col + w) { out.push({ type: 'dead', how: 'zap' }); return out; }
    }
    if (!this.bonus) {
      // a volley: for a moment every column burns but the three it left him
      for (let i = 0; i < L.volleys.length; i++) { const v = L.volleys[i]; if (beat >= v.beat - 0.02 && beat <= v.beat + 0.2 && (st.col < v.lo || st.col + w - 1 > v.hi)) { out.push({ type: 'dead', how: 'burn' }); return out; } }
      // what moves: a little forgiving all round, like the blocks
      for (let i = 0; i < L.foes.length; i++) {
        const f = L.foes[i];
        if (beat < f.la || beat > f.b) continue;
        const q = foeAt(L, f, beat);
        if (q.x < st.col + w - 0.1 && q.x + q.w > st.col + 0.1 && q.y < B - 0.25 && q.y + q.h > B - h + 0.15) { out.push({ type: 'dead', how: f.kind }); return out; }
      }
      // the grudge: as each beat starts it marks the column he is in, and at the end of that beat it comes down that column
      if (L.grudges.length && L.zoneAt(L.grudges, beat)) {
        const k = Math.floor(beat);
        if (k !== this.lockK) { this.lockK = k; this.lockCol = mid(st); }
        else if (beat - k >= 0.9 && this.lockCol >= st.col && this.lockCol < st.col + w) { out.push({ type: 'dead', how: 'grab' }); return out; }
      }
    }
    // a forgiving hitbox for landing on a block
    if (blocked(L, this.st, B, 0.15, 0.25, !!this.bonus, this)) out.push({ type: 'dead', how: 'splat' });
    else if (beat >= L.totalBeats) out.push({ type: 'win' });
    return out;
  };

  const api = { WIDE: WIDE, START_COL: START_COL, buildLevel: buildLevel, specFor: specFor, Run: Run, sawCol: sawCol, customLevel: customLevel, customSpec: customSpec, KINDS: KINDS, LOOKS: LOOKS,
    MADE_V: MADE_V, MADE_READS: MADE_READS, WORLD_V: WORLD_V, WORLD_READS: WORLD_READS, readable: readable,
    TIERS: TIERS, TIER_AT: TIER_AT, RATED: RATED, rate: rate, ratingOf: ratingOf, tier: tier,
    dynMask: dynMask, doorShut: doorShut, sliderAt: sliderAt, foeAt: foeAt, width: width, mid: mid,
    // how many beats ahead the game shows what is coming (game.js draws to these, the tests hold them to the first
    // level's own warning): a saw before it bites; a door's lamp blinking before it swaps (it then stays as it is
    // for DOOR_OPEN more beats before he arrives); a boss's columns glowing; a grudge hanging over him; a swap of left and right
    TELL: { saw: 1.5, door: 1, doorOpen: 1, volley: 2, grudge: 2, flip: 2 } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FFFCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
