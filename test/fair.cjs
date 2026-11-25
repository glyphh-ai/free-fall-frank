// Is a paid level fair? Its limits are the first level's own, measured here and not written down anywhere:
//   the tap window: how long, around each tap of the solution, a tap still gets him through (found by moving that
//     one tap earlier and later until he dies). The shortest in the first level is the least any tap may have.
//   the gap: how much wider than Frank the way through each gate is, at the moment he goes through it.
//   the fall: how many rows a second he drops (what there is to read, and how long to read it), for the gated
//     stretches and for the slides.
//   the warning: how long before a thing can hurt it is on show (the first level's saws blink for C.TELL.saw beats).
// Times are in seconds, so a faster tempo has to give more beats. Hard and insane speed the first level and a
// paid level up by the same factor, so a limit kept at one difficulty is kept at all four; the figures are printed for each.
'use strict';
const C = require('../core.js'), WORLDS = require('../worlds.js');
const SPEEDS = { easy: 1, normal: 1, hard: 1.2, insane: 1.4 }, ONE_BPM = 100;   // the first level runs at its recording's tempo (music/tracks.js)
let failed = false;
const fail = function (m) { failed = true; console.log('FAIL ' + m); };
const ms = function (s) { return Math.round(s * 1000) + ' ms'; };

function clone(run) {
  const r = Object.assign(Object.create(C.Run.prototype), run);
  Object.keys(run).forEach(function (k) { const v = run[k]; if (Array.isArray(v)) r[k] = v.slice(); else if (v && typeof v === 'object' && k !== 'level' && k !== 'bonus' && k !== 'st') r[k] = Object.assign({}, v); });
  return r;
}
// every tap of the solution: the earliest and the latest beat it can be made at with the rest played as written
function windows(L) {
  const run = new C.Run(L), plan = L.plan, snaps = [], STEP = 0.02, FINE = 1 / 32, out = [];
  run.reset(0);
  let pi = 0, last = -1;
  while (pi < plan.length && plan[pi].beat < run.beat) pi++;
  for (let beat = run.beat; beat < L.totalBeats; beat += STEP) {
    while (pi < plan.length && plan[pi].beat <= beat) { run.tap(plan[pi].dir, plan[pi].beat); pi++; }
    run.advance(beat);
    if (pi < plan.length && last !== pi && plan[pi].beat - beat < 1.6) { last = pi; snaps[pi] = { run: clone(run), beat: beat }; }
  }
  const lives = function (i, at) {
    const sn = snaps[i];
    if (at <= sn.beat) return false;
    const r = clone(sn.run), end = Math.max(plan[i].beat, at) + 2.5;
    let j = i, done = false;
    for (let b = sn.beat; b < end && b < L.totalBeats; b += STEP) {
      if (!done && b >= at) { done = true; if (!r.tap(plan[i].dir, at).ok) return false; j = i + 1; }
      while (done && j < plan.length && plan[j].beat <= b) { if (!r.tap(plan[j].dir, plan[j].beat).ok) return false; j++; }
      if (!done && i + 1 < plan.length && plan[i + 1].beat <= b) return false;   // the taps keep their order
      const evs = r.advance(b);
      for (let k = 0; k < evs.length; k++) if (evs[k].type === 'dead') return false;
    }
    return true;
  };
  for (let i = 0; i < plan.length; i++) {
    if (!snaps[i]) continue;
    const p = plan[i].beat;
    let lo = p, hi = p;
    if (!lives(i, p)) { out.push({ beat: p, w: 0, sec: L.sectionAt(p).key }); continue; }
    while (lo - FINE > snaps[i].beat && lives(i, lo - FINE)) lo -= FINE;
    while (hi - p < 2 && lives(i, hi + FINE)) hi += FINE;
    out.push({ beat: p, w: hi - lo, sec: L.sectionAt(p).key });
  }
  return out;
}
// every gate: how many columns wider than Frank the open way he takes through it is, when he is in it
function gaps(L) {
  const out = [];
  L.gates.forEach(function (g) {
    if (g.type === 'warp' || g.type === 'volley') return;           // not gaps: a swirl he has to be dead centre of, and a boss's three dark columns (checked below)
    const s = L.sections[g.si], beat = g.beat + 0.2, st = L.stateAt(beat), w = C.width(st), mask = (L.solids.get(g.row) || 0) | C.dynMask(L, g.row, beat, null);
    let lo = st.col, hi = st.col + w - 1;
    while (lo - 1 >= s.lo && !(mask >> (lo - 1) & 1)) lo--;
    while (hi + 1 < s.hi && !(mask >> (hi + 1) & 1)) hi++;
    for (let c = st.col; c < st.col + w; c++) if (mask >> c & 1) out.push({ beat: g.beat, open: 0, spare: -1, sec: s.key });
    out.push({ beat: g.beat, open: hi - lo + 1, spare: hi - lo + 1 - w, sec: s.key });
  });
  return out;
}
const isSlide = function (s) { return s.theme === 'chute'; };
function falls(L, bpm) {
  let gated = 0, slide = 0;
  L.sections.forEach(function (s) { if (!s.every) return; const v = s.rpb * bpm / 60; if (isSlide(s)) slide = Math.max(slide, v); else gated = Math.max(gated, v); });
  return { gated: gated, slide: slide };
}
const least = function (list, k) { return list.reduce(function (m, x) { return x[k] < m[k] ? x : m; }); };

// ---- the first level: the limits ----
const L1 = C.buildLevel(C.specFor(0)), w1 = windows(L1), g1 = gaps(L1), f1 = falls(L1, ONE_BPM);
const LIMIT = { window: least(w1, 'w').w * 60 / ONE_BPM, spare: least(g1, 'spare').spare, open: least(g1, 'open').open, gated: f1.gated, slide: f1.slide, tell: C.TELL.saw * 60 / ONE_BPM };
console.log('the first level, at ' + ONE_BPM + ' bpm (' + w1.length + ' taps, ' + g1.length + ' gates): shortest tap window ' + least(w1, 'w').w.toFixed(3) + ' beats, narrowest gap ' + LIMIT.open + ' column(s), ' + LIMIT.spare +
  ' wider than Frank, fastest gated fall ' + LIMIT.gated.toFixed(1) + ' rows/s, fastest slide ' + LIMIT.slide.toFixed(1) + ' rows/s, a saw warns ' + C.TELL.saw + ' beats ahead');
Object.keys(SPEEDS).forEach(function (d) {
  console.log('  limits on ' + d + ' (x' + SPEEDS[d] + '): tap window >= ' + ms(LIMIT.window / SPEEDS[d]) + ', gap >= ' + LIMIT.open + ' column(s) and >= Frank + ' + LIMIT.spare + ', fall <= ' + (LIMIT.gated * SPEEDS[d]).toFixed(1) +
    ' rows/s gated and <= ' + (LIMIT.slide * SPEEDS[d]).toFixed(1) + ' in a slide, warning >= ' + ms(LIMIT.tell / SPEEDS[d]));
});
if (least(w1, 'w').w <= 0) fail('the first level has a tap with no window');

// ---- the paid levels, held to them ----
Object.keys(WORLDS).forEach(function (id) {
  const L = C.buildLevel(WORLDS[id].full), spb = 60 / L.bpm, w = windows(L), g = gaps(L), f = falls(L, L.bpm);
  const lw = least(w, 'w'), ls = least(g, 'spare'), lo = least(g, 'open');
  w.forEach(function (x) { if (x.w * spb < LIMIT.window - 1e-9) fail(id + ': the tap at beat ' + x.beat + ' (' + x.sec + ') has a window of ' + ms(x.w * spb) + ', under ' + ms(LIMIT.window)); });
  g.forEach(function (x) { if (x.spare < LIMIT.spare || x.open < LIMIT.open) fail(id + ': the gate at beat ' + x.beat + ' (' + x.sec + ') leaves ' + x.open + ' column(s), ' + x.spare + ' wider than Frank'); });
  L.sections.forEach(function (s) { if (s.every && s.rpb / spb > (isSlide(s) ? LIMIT.slide : LIMIT.gated) + 1e-9) fail(id + ': ' + s.key + ' falls ' + (s.rpb / spb).toFixed(1) + ' rows/s'); });
  // warnings: what moves is on show (a to la) at least as long as a saw; doors, a boss's volley, the grudge and a swap by what game.js draws (C.TELL)
  const tells = { 'door (lamp blinking, then open)': C.TELL.door + C.TELL.doorOpen, volley: C.TELL.volley, grudge: C.TELL.grudge, 'swap of left and right': C.TELL.flip };
  if (L.saws.length) tells.saw = C.TELL.saw;                        // (a saw's warning is so many beats whatever the tempo: at a faster one it would be too short)
  L.foes.forEach(function (x) { tells[x.kind] = Math.min(tells[x.kind] === undefined ? 99 : tells[x.kind], x.la - x.a); });
  Object.keys(tells).forEach(function (k) { if (tells[k] * spb < LIMIT.tell - 1e-9) fail(id + ': ' + k + ' is on show ' + ms(tells[k] * spb) + ' before it can hurt, under ' + ms(LIMIT.tell)); });
  // a boss's volley leaves three columns, and the level's own way is in them
  L.volleys.forEach(function (v) { const st = L.stateAt(v.beat + 0.1); if (v.hi - v.lo + 1 < 3 || st.col < v.lo || st.col + C.width(st) - 1 > v.hi) fail(id + ': the volley at beat ' + v.beat + ' leaves no room'); });
  console.log(id + ', at ' + L.bpm + ' bpm (' + w.length + ' taps, ' + g.length + ' gates): shortest tap window ' + lw.w.toFixed(3) + ' beats (beat ' + lw.beat + ', ' + lw.sec + '), narrowest gap ' + lo.open + ' column(s), ' + ls.spare +
    ' wider than Frank, fastest gated fall ' + f.gated.toFixed(1) + ' rows/s, fastest slide ' + f.slide.toFixed(1) + ' rows/s, shortest warning ' + Math.min.apply(null, Object.keys(tells).map(function (k) { return tells[k]; })).toFixed(2) + ' beats');
  Object.keys(SPEEDS).forEach(function (d) {
    console.log('  on ' + d + ': shortest tap window ' + ms(lw.w * spb / SPEEDS[d]) + ' (limit ' + ms(LIMIT.window / SPEEDS[d]) + '), fall ' + (f.gated * SPEEDS[d]).toFixed(1) + ' / ' + (f.slide * SPEEDS[d]).toFixed(1) + ' rows/s (limit ' +
      (LIMIT.gated * SPEEDS[d]).toFixed(1) + ' / ' + (LIMIT.slide * SPEEDS[d]).toFixed(1) + '), shortest warning ' + ms(Math.min.apply(null, Object.keys(tells).map(function (k) { return tells[k]; })) * spb / SPEEDS[d]) + ' (limit ' + ms(LIMIT.tell / SPEEDS[d]) + ')');
  });
  const by = {};
  w.forEach(function (x) { by[x.sec] = Math.min(by[x.sec] === undefined ? 99 : by[x.sec], x.w); });
  console.log('  shortest window by stretch, in ms on normal: ' + Object.keys(by).map(function (k) { return k + ' ' + Math.round(by[k] * spb * 1000); }).join(', '));
});
console.log(failed ? 'FAILED' : 'OK: fair');
process.exit(failed ? 1 : 0);
