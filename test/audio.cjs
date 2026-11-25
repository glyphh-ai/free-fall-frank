// The music of a paid level, checked without ears. audio.js is run against a stand-in AudioContext that only keeps
// what it is told (every node, every connection, every value scheduled on every parameter), a whole level is played
// through it frame by frame, and then the books are gone over:
//   every frequency, gain and time is a finite number, nothing is scheduled in the past, no ramp aims at zero;
//   every sound that is started is also stopped (or ends by itself): nothing is left running at the bottom;
//   what the voices can add up to going into the compressor (each one's own envelope, through every gain on its
//     way, taken every 5 ms) never passes the headroom audio.js sets itself (FFFAudio.headroom);
//   the parts differ and the finale is the loudest of them; the tempo is faster than the first level's; gates,
//     taps and the level's own sounds sit on the beat grid; the music and the effects switches silence what they should.
// Nobody has heard any of it: this proves it is well formed, not that it is good.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const C = require('../core.js'), WORLDS = require('../worlds.js');
let failed = false;
const fail = function (m) { failed = true; console.log('FAIL ' + m); };

// one of the game's own recorded drum sounds (samples/*.wav, 16-bit): how long it is, and how loud it is in every
// 5 ms of it, so that a sample counts in the sums for what it really is
const wavs = {}, ENV = 0.005;
function wav(name) {
  if (wavs[name]) return wavs[name];
  const b = fs.readFileSync(path.join(__dirname, '../samples', name));
  let p = 12, ch = 1, rate = 44100, at = 0, len = 0;
  while (p < b.length - 8) { const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4); if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); } if (id === 'data') { at = p + 8; len = n; break; } p += 8 + n + (n % 2); }
  const frames = Math.floor(len / 2 / ch), env = new Float32Array(Math.ceil(frames / rate / ENV) + 1);
  for (let i = 0; i < frames; i++) { const v = Math.abs(b.readInt16LE(at + i * 2 * ch)) / 32768, k = Math.floor(i / rate / ENV); if (v > env[k]) env[k] = v; }
  return (wavs[name] = { duration: frames / rate, env: env });
}
function world(withSamples) {
  const bad = [], sources = [], ctx = { currentTime: 0, sampleRate: 44100, state: 'running' };
  const note = function (m) { if (bad.length < 12) bad.push(m); };
  const num = function (v, what) { if (typeof v !== 'number' || !isFinite(v)) note(what + ' is ' + v); };
  function Param(v, name) { this.value = v; this.ev = []; this.name = name; }
  Param.prototype.put = function (kind, v, t) {
    num(v, this.name + ' value'); num(t, this.name + ' time');
    if (t < ctx.currentTime - 1e-6) note(this.name + ' scheduled ' + (ctx.currentTime - t).toFixed(3) + 's in the past');
    if (kind === 'exp' && !(v > 0)) note(this.name + ' ramps exponentially to ' + v);
    let i = this.ev.length;
    while (i > 0 && this.ev[i - 1].t > t) i--;
    this.ev.splice(i, 0, { kind: kind, v: v, t: t });
  };
  Param.prototype.setValueAtTime = function (v, t) { this.put('set', v, t); };
  Param.prototype.linearRampToValueAtTime = function (v, t) { this.put('lin', v, t); };
  Param.prototype.exponentialRampToValueAtTime = function (v, t) { this.put('exp', v, t); };
  Param.prototype.cancelScheduledValues = function (t) { num(t, this.name + ' cancel time'); while (this.ev.length && this.ev[this.ev.length - 1].t >= t) this.ev.pop(); };
  Param.prototype.at = function (t) {
    const ev = this.ev;
    if (!ev.length || t < ev[0].t) return this.value;
    let lo = 0, hi = ev.length - 1;
    while (lo < hi) { const m = lo + hi + 1 >> 1; if (ev[m].t <= t) lo = m; else hi = m - 1; }
    const a = ev[lo], b = ev[lo + 1];
    if (!b || b.kind === 'set') return a.v;
    const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
    return b.kind === 'lin' ? a.v + (b.v - a.v) * u : a.v * Math.pow(b.v / Math.max(1e-6, a.v), u);
  };
  const node = function (kind, more) { return Object.assign({ kind: kind, out: [], connect: function (to) { if (!to || !(to.kind || to instanceof Param)) note(kind + ' connected to nothing'); this.out.push(to); return to; } }, more); };   // (to a node, or to a parameter: a wobble)
  const source = function (n) { n.id = sources.length; sources.push(n); n.start = function (t, off) { num(t, n.kind + ' start'); if (off !== undefined) num(off, 'offset'); if (t < ctx.currentTime - 1e-6) note(n.kind + ' started ' + (ctx.currentTime - t).toFixed(3) + 's in the past'); n.t0 = t; };
    n.stop = function (t) { num(t, n.kind + ' stop'); if (n.t0 !== undefined && t < n.t0) note(n.kind + ' stopped before it starts'); n.t1 = t; }; return n; };
  ctx.destination = node('destination');
  ctx.createOscillator = function () { return source(node('osc', { type: 'sine', frequency: new Param(440, 'frequency') })); };
  ctx.createBufferSource = function () { return source(node('buf', { buffer: null, playbackRate: new Param(1, 'rate') })); };
  ctx.createGain = function () { return node('gain', { gain: new Param(1, 'gain') }); };
  ctx.createBiquadFilter = function () { return node('filter', { type: 'lowpass', frequency: new Param(350, 'cutoff'), Q: new Param(1, 'Q') }); };
  ctx.createDynamicsCompressor = function () { return node('comp', { threshold: new Param(-24, 'threshold'), ratio: new Param(12, 'ratio') }); };
  ctx.createConvolver = function () { return node('verb', {}); };
  ctx.createDelay = function () { return node('delay', { delayTime: new Param(0, 'delay') }); };
  ctx.createWaveShaper = function () { return node('shaper', {}); };
  ctx.createBuffer = function (ch, len, rate) { const d = []; for (let i = 0; i < ch; i++) d.push(new Float32Array(len)); return { duration: len / rate, getChannelData: function (i) { return d[i]; } }; };
  ctx.decodeAudioData = function (b, ok) { ok(b.wav); };
  ctx.resume = function () {}; ctx.suspend = function () {};
  const win = { AudioContext: function () { return ctx; }, FFFTracks: {} };
  const box = { window: win, navigator: {}, performance: { now: function () { return ctx.currentTime * 1000; } }, Math: Math, Float32Array: Float32Array, Promise: Promise, Object: Object,
    fetch: function (url) { return withSamples ? Promise.resolve({ ok: true, arrayBuffer: function () { return Promise.resolve({ wav: wav(path.basename(url)) }); } }) : Promise.reject(new Error('no samples here')); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../audio.js'), 'utf8'), box);
  return { A: win.FFFAudio, ctx: ctx, bad: bad, sources: sources };
}
// every way from a sound to the compressor, as the gains on it (a wet send through the reverb or the echo counts
// at what is sent; the echo's own feedback loop is not followed round). shaped = it goes through the saturation.
function ways(src) {
  const out = [];
  (function walk(n, gains, seen, shaped) {
    if (n.kind === 'comp' || n.kind === 'destination') { out.push({ gains: gains, shaped: shaped }); return; }
    if (!n.kind || seen.indexOf(n) >= 0) return;                    // into a parameter (a wobble, not a sound), or round the echo again
    n.out.forEach(function (to) { walk(to, n.kind === 'gain' ? gains.concat([n.gain]) : gains, seen.concat([n]), shaped || n.kind === 'shaper'); });
  })(src, [], [], false);
  return out;
}
const endOf = function (s) { return s.t1 !== undefined ? s.t1 : s.kind === 'buf' && s.buffer ? s.t0 + s.buffer.duration / Math.max(0.05, s.playbackRate.at(s.t0)) : Infinity; };

// play a level right through; what = { speed, music, sfx, gold: [from, to] beats, room: [from, to] beats played as a hidden room }
async function playThrough(L, what, samples) {
  const w = world(samples), A = w.A, spb = 60 / (L.bpm * what.speed), lvl = Object.assign(Object.create(L), { bpm: L.bpm * what.speed });
  A.init();
  await new Promise(function (r) { setTimeout(r, 5); });           // the kit "loads" (or does not)
  A.set('music', what.music !== false); A.set('sfx', what.sfx !== false);
  w.ctx.currentTime = 1;
  let beat = 1;
  A.seek(beat, lvl, 100);
  if (what.gold) A.mood('gold', what.gold[1]);
  for (let f = 0; beat < L.totalBeats + 1; f++) {
    const dt = 1 / 60 + ((f * 7919) % 13) / 13 * 0.012;             // uneven frames
    w.ctx.currentTime += dt; beat += dt / spb;
    if (what.gold && beat < what.gold[0]) A.mood('', 0); else if (what.gold && beat < what.gold[1]) A.mood('gold', what.gold[1]);
    A.update(beat, lvl, !!what.room && beat >= what.room[0] && beat < what.room[1], 100);
  }
  w.end = w.ctx.currentTime; w.spb = spb; w.t0 = 1 - 1 * spb;       // t0: the time of beat 0
  return w;
}
// the most the voices add up to, and the mean of that for every style of stretch
function mix(w, L) {
  const STEP = 0.005, n = Math.ceil((w.end + 3) / STEP), sum = new Float64Array(n), by = {};
  w.sources.forEach(function (s) {
    if (s.t0 === undefined) return;
    const ws = ways(s), t1 = Math.min(endOf(s), w.end + 3), env = s.kind === 'buf' && s.buffer && s.buffer.env, rate = env ? s.playbackRate.at(s.t0 + 0.2) : 1;
    if (!ws.length) return;                                         // a wobble: it moves a parameter, it is not heard
    for (let i = Math.max(0, Math.ceil(s.t0 / STEP)); i * STEP < t1 && i < n; i++) {
      const t = i * STEP, own = env ? env[Math.floor((t - s.t0) * rate / ENV)] || 0 : 1;   // an oscillator and the noise are as loud as they can be; a recorded sample is as loud as it is
      let a = 0;
      for (let k = 0; k < ws.length; k++) { let g = own; for (let j = 0; j < ws[k].gains.length; j++) g *= Math.abs(ws[k].gains[j].at(t)); a += ws[k].shaped ? Math.min(g, 1) : g; }
      sum[i] += a;
    }
  });
  let peak = 0, at = 0;
  for (let i = 0; i < n; i++) {
    if (sum[i] > peak) { peak = sum[i]; at = i * STEP; }
    const beat = (i * STEP - w.t0) / w.spb;
    if (beat >= 0 && beat < L.totalBeats) { const st = L.sectionAt(beat).style, o = by[st] = by[st] || { s: 0, n: 0 }; o.s += sum[i]; o.n++; }
  }
  Object.keys(by).forEach(function (k) { by[k] = by[k].s / by[k].n; });
  return { peak: peak, at: at, beat: (at - w.t0) / w.spb, by: by };
}
function books(w, name) {
  const never = w.sources.filter(function (s) { return s.t0 === undefined; }).length, open = w.sources.filter(function (s) { return s.t0 !== undefined && endOf(s) > w.end + 3; }).length;
  let most = 0;
  const edges = [];
  w.sources.forEach(function (s) { if (s.t0 !== undefined && isFinite(endOf(s))) { edges.push([s.t0, 1], [endOf(s), -1]); } });
  edges.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  let live = 0;
  edges.forEach(function (e) { live += e[1]; most = Math.max(most, live); });
  if (w.bad.length) fail(name + ': ' + w.bad.join('; '));
  if (never) fail(name + ': ' + never + ' sounds were made and never started');
  if (open) fail(name + ': ' + open + ' sounds are never stopped');
  return { made: w.sources.length, ended: w.sources.length - never - open, most: most };
}

(async function () {
  for (const id of Object.keys(WORLDS)) {
    const L = C.buildLevel(WORLDS[id].full), ONE = C.buildLevel(C.specFor(0));
    if (!(L.bpm > 100)) fail(id + ': its tempo (' + L.bpm + ') is not faster than the first level\'s 100');
    // on the beat: a gate every whole beat or two, every tap of the solution and every sound of the level on the sixteenth grid
    const off = function (b, grid) { return Math.abs(b * grid - Math.round(b * grid)) > 1e-6; };
    if (L.gates.some(function (g) { return off(g.beat, 1); })) fail(id + ': a gate is off the beat');
    if (L.plan.some(function (p) { return off(p.beat, 4); })) fail(id + ': a tap of the solution is off the sixteenth grid');
    if (L.sounds.some(function (s) { return off(s.beat, 4); })) fail(id + ': one of the level\'s sounds is off the sixteenth grid');
    if (L.sections.some(function (s) { return off(s.start, 0.25); })) fail(id + ': a stretch does not start on a bar');
    const g0 = L.forks.length ? L.totalBeats * 0.3 : 0, plays = [
      ['normal, synthesized kit', { speed: 1, gold: [g0, g0 + 32], room: [150, 156] }, false],
      ['normal, sampled kit', { speed: 1, gold: [g0, g0 + 32], room: [150, 156] }, true],
      ['insane, sampled kit', { speed: 1.4 }, true],
    ];
    const head = world(false).A.headroom;
    for (const p of plays) {
      const w = await playThrough(L, p[1], p[2]), b = books(w, id + ' ' + p[0]), m = mix(w, L);
      if (!(m.peak <= head)) fail(id + ' ' + p[0] + ': the voices add up to ' + m.peak.toFixed(2) + ' at beat ' + m.beat.toFixed(2) + ' (' + L.sectionAt(Math.max(0, m.beat)).key + '), over the headroom of ' + head);
      console.log(id + ', ' + p[0] + ': ' + b.made + ' sounds made, ' + b.ended + ' ended, at most ' + b.most + ' at once; the most they add up to is ' + m.peak.toFixed(2) + ' of ' + head + ' (beat ' + m.beat.toFixed(1) + ', ' + L.sectionAt(Math.max(0, m.beat)).key + ')');
      if (p[1].speed === 1 && p[2]) {
        const by = m.by, order = ['break', 'pulse', 'drive', 'drive2', 'drop', 'finale'];
        console.log('  how loud each part is on average: ' + Object.keys(by).map(function (k) { return k + ' ' + by[k].toFixed(2); }).join(', '));
        for (let i = 1; i < order.length; i++) if (!(by[order[i]] > by[order[i - 1]])) fail(id + ': the part "' + order[i] + '" (' + by[order[i]].toFixed(2) + ') is not louder than "' + order[i - 1] + '" (' + by[order[i - 1]].toFixed(2) + ')');
        Object.keys(by).forEach(function (k) { if (k !== 'finale' && by[k] >= by.finale) fail(id + ': the finale is not the loudest part (' + k + ' is)'); });
      }
    }
    // the switches: no music with music off (the level's own sounds still play), nothing at all with both off
    const quiet = await playThrough(L, { speed: 1, music: false }, true), silent = await playThrough(L, { speed: 1, music: false, sfx: false }, true), full = await playThrough(L, { speed: 1 }, true);
    books(quiet, id + ' music off'); books(silent, id + ' all off');
    if (silent.sources.length) fail(id + ': ' + silent.sources.length + ' sounds with music and effects both off');
    if (!quiet.sources.length || quiet.sources.length > L.sounds.length * 4 || quiet.sources.length >= full.sources.length / 10) fail(id + ': with the music off there are ' + quiet.sources.length + ' sounds (the level has ' + L.sounds.length + ' of its own)');
    console.log(id + ': music off leaves ' + quiet.sources.length + ' sounds (the level\'s ' + L.sounds.length + ' gate and foe sounds), music and effects off leaves ' + silent.sources.length);
    // and the first level's own synthesized beat, as it was: the same books
    const one = await playThrough(ONE, { speed: 1 }, true), ob = books(one, 'the first level'), om = mix(one, ONE);
    console.log('the first level\'s synthesized beat, for comparison: ' + ob.made + ' sounds made, ' + ob.ended + ' ended; the most they add up to is ' + om.peak.toFixed(2));
  }
  console.log(failed ? 'FAILED' : 'OK: audio');
  process.exit(failed ? 1 : 0);
})();
