// Free Fall Frank: the beat is synthesized step by step from the level, so it is locked to the
// fall: gates land on beats, the solution's taps land on the 16th grid and get their own
// finger snap, and the track restarts cleanly from the top.
// Mix: drums and effects go straight out; keys, hook and bass sit on a bus that ducks under the
// kick; a reverb and a tempo echo give it room; the 808 runs through a little saturation.
(function (root) {
  'use strict';
  const TRACKS = root.FFFTracks || {}, bufs = {};
  let playing = null;
  // start a level's recording at the place that matches this beat, if it has one and it has loaded
  const on = { music: true, sfx: true };                            // the player's sound settings
  // A level played faster than its recording (the hard and insane settings) plays the recording faster to match.
  function startTrack(beat, i, L) {
    const buf = bufs[i], m = TRACKS[i];
    if (!on.music || !m || !buf || buf === 'loading') return;
    const at = m.first + beat * 60 / m.bpm, s = ac.createBufferSource(), g = ac.createGain(), rate = L && L.bpm ? L.bpm / m.bpm : 1;
    if (at >= buf.duration) return;
    s.buffer = buf; g.gain.value = 0.85; s.playbackRate.value = rate;
    s.connect(g); g.connect(ac.destination);
    if (recOut) g.connect(recOut);
    if (at >= 0) s.start(ac.currentTime, at); else s.start(ac.currentTime - at / rate, 0);
    playing = s; playingGain = g;
  }
  // Recording a clip: everything that is heard (the track and the effects) also goes to a stream the recorder takes.
  let master = null, recOut = null, playingGain = null;
  function recStream() {
    if (!ac || !ac.createMediaStreamDestination) return null;
    if (!recOut) { recOut = ac.createMediaStreamDestination(); master.connect(recOut); if (playing && playingGain) { try { playingGain.connect(recOut); } catch (e) { /* that track has ended */ } } }
    return recOut.stream;
  }
  let ac = null, out = null, music = null, duck = null, verb = null, echo = null, echoDelay = null, sat = null, noise = null;
  let nextStep = 0, cueI = 0;

  const hz = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
  // Am9 Am9 Fmaj9 E7, one bar each
  const MI = [0, 3, 7, 10, 14], MA = [0, 4, 7, 11, 14], DO = [0, 4, 7, 10, 13];
  // each Frank's level has its own chords (one bar each), its own hook and its own lead sound
  const PROGS = [
    [[45, MI], [45, MI], [41, MA], [40, DO]],        // Am Am F E: brooding
    [[45, MI], [43, MA], [41, MA], [43, DO]],        // Am G F G: rolling
    [[45, MI], [50, MI], [45, MI], [40, DO]],        // Am Dm Am E: old-school
    [[48, MA], [45, MI], [41, MA], [43, DO]],        // C Am F G: sunny
  ];
  // hooks: 16th step -> which note of the bar's chord
  const HOOKS = [{ 0: 2, 3: 1, 6: 0, 8: 2, 11: 3, 14: 1 }, { 0: 4, 2: 2, 4: 1, 8: 2, 12: 0 }, { 0: 0, 3: 2, 6: 4, 8: 3, 10: 2, 12: 1, 14: 2 }, { 1: 2, 4: 2, 7: 3, 9: 1, 12: 0, 15: 1 }];
  const PENT = [0, 3, 5, 7, 10, 12, 15];

  function init() {
    if (ac) { ac.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    // iPhones mute web sound when the ring switch is on silent unless the page says it is playing media
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    comp.connect(ac.destination); master = comp;
    const G = function (v, to) { const g = ac.createGain(); g.gain.value = v; g.connect(to); return g; };
    out = G(0.8, comp);
    duck = G(1, comp);
    music = G(0.9, duck);
    loadKit();
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // reverb: a short burst of fading noise as the room
    const len = Math.floor(ac.sampleRate * 1.3), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb = ac.createConvolver(); verb.buffer = ir; verb.connect(G(0.35, comp));
    // echo: dotted eighth, each repeat darker
    echoDelay = ac.createDelay(1.5); echoDelay.delayTime.value = 0.45;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    echoDelay.connect(lp); lp.connect(G(0.38, echoDelay)); lp.connect(G(0.3, comp));
    echo = echoDelay;
    sat = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.4);
    sat.curve = curve; sat.connect(G(0.6, comp));
  }

  // o: t, f, d(uration), type, v(olume), cut, f2 (glide to), a(ttack), to, verb, echo
  function tone(o) {
    const osc = ac.createOscillator(), g = ac.createGain(), t = o.t, d = o.d;
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.gl || d));
    if (o.a) { g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(o.v, t + o.a); } else g.gain.setValueAtTime(o.v, t);
    if (o.hold) g.gain.setValueAtTime(o.v, t + d * o.hold);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    let n = osc;
    if (o.cut) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.cut; osc.connect(fl); n = fl; }
    n.connect(g);
    g.connect(o.to || out);
    if (o.verb) { const s = ac.createGain(); s.gain.value = o.verb; g.connect(s); s.connect(verb); }
    if (o.echo) { const s = ac.createGain(); s.gain.value = o.echo; g.connect(s); s.connect(echo); }
    osc.start(t); osc.stop(t + d + 0.03);
  }
  function hiss(t, dur, vol, type, f, f2, rv, q) {
    const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise;
    fl.type = type; fl.frequency.setValueAtTime(f, t);
    if (q) fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    if (rv) { const sg = ac.createGain(); sg.gain.value = rv; g.connect(sg); sg.connect(verb); }
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  // a cartoon voice: a saw through three "ah" formants, with a wobble
  function voice(t, f0, f1, dur, vol) {
    const o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), g = ac.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    lfo.frequency.value = 7; lg.gain.setValueAtTime(2, t); lg.gain.linearRampToValueAtTime(25, t + dur);
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.06, dur / 3));
    g.gain.setValueAtTime(vol, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    [850, 1250, 2700].forEach(function (f, i) {
      const b = ac.createBiquadFilter();
      b.type = 'bandpass'; b.frequency.value = f; b.Q.value = 7;
      const bg = ac.createGain(); bg.gain.value = [1, 0.7, 0.25][i];
      o.connect(b); b.connect(bg); bg.connect(g);
    });
    g.connect(out);
    const s = ac.createGain(); s.gain.value = 0.25; g.connect(s); s.connect(verb);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  // ---------- the kit ----------
  // Recorded one-shots (samples/*.wav): a real kick, snare, clap, hats, 808, snap, scratch and shout. They are
  // fetched when sound starts; until they arrive, or where they cannot be fetched, the synthesized kit plays.
  const S = {}, KIT = ['kick', 'snare', 'clap', 'hat', 'openhat', 'bass', 'snap', 'rim', 'scratch', 'hey', 'crash'];
  function loadKit() {
    KIT.forEach(function (n) {
      fetch((root.FFF_BASE || '') + 'samples/' + n + '.wav').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (ok, bad) { ac.decodeAudioData(b, ok, bad); }); })
        .then(function (buf) { S[n] = buf; }).catch(function () {});
    });
  }
  // play a sample: rate re-pitches it, dur cuts it short, rv sends some to the reverb
  function smp(name, t, vol, o) {
    if (!S[name]) return false;
    o = o || {};
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = S[name];
    s.playbackRate.setValueAtTime((o.rate || 1) * (o.from || 1), t);
    if (o.from) s.playbackRate.exponentialRampToValueAtTime(o.rate || 1, t + 0.1);
    g.gain.setValueAtTime(vol, t);
    if (o.dur) { g.gain.setValueAtTime(vol, t + o.dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + o.dur); }
    s.connect(g); g.connect(o.to || out);
    if (o.rv) { const sg = ac.createGain(); sg.gain.value = o.rv; g.connect(sg); sg.connect(verb); }
    s.start(t);
    if (o.dur) s.stop(t + o.dur + 0.02);
    return true;
  }
  function kick(t, v) {
    if (!smp('kick', t, (v || 1) * 0.95)) { tone({ t: t, f: 165, f2: 44, gl: 0.11, d: 0.3, v: v || 1 }); hiss(t, 0.012, 0.25, 'highpass', 2500); }
    duck.gain.cancelScheduledValues(t); duck.gain.setValueAtTime(0.4, t); duck.gain.linearRampToValueAtTime(1, t + 0.2);
  }
  // the 808 sample is a C (midi 36): re-pitch it to the note, slide into it from an octave up
  function bass808(t, m, d, slide) {
    if (smp('bass', t, 0.85, { rate: Math.pow(2, (m - 36) / 12), from: slide ? 2 : 0, dur: Math.min(d, 1.1), to: sat })) return;
    tone({ t: t, f: hz(m) * (slide ? 2 : 1.25), f2: hz(m), gl: slide ? 0.12 : 0.03, d: d, v: 0.9, hold: 0.55, to: sat });
  }
  function snare(t, v) {
    if (smp('snare', t, 0.75 * v, { rv: 0.25 })) return;
    hiss(t, 0.17, 0.45 * v, 'bandpass', 2100, 0, 0.3, 0.8); hiss(t, 0.09, 0.2 * v, 'highpass', 5500);
    tone({ t: t, f: 230, f2: 150, d: 0.1, v: 0.35 * v, type: 'triangle' });
  }
  function clap(t, v) {
    if (smp('clap', t, 0.5 * (v || 1), { rv: 0.3 })) return;
    [0, 0.011, 0.024].forEach(function (d, i) { hiss(t + d, i === 2 ? 0.16 : 0.03, 0.32 * (v || 1), 'bandpass', 1500, 0, 0.35, 1.4); });
  }
  function hat(t, v, open) {
    if (smp(open ? 'openhat' : 'hat', t, v * (open ? 1.6 : 2.4))) return;
    hiss(t, open ? 0.22 : 0.04, v, 'bandpass', 9500, 0, 0, 1.3); hiss(t, open ? 0.15 : 0.02, v * 0.5, 'highpass', 11000);
  }
  function shout(t, v, rate) { if (!smp('hey', t, v * 2.2, { rate: rate, rv: 0.3 })) voice(t, 330 * rate, 290 * rate, 0.14, v); }
  function keys(t, rt, ch, d) {                                     // electric piano chord
    ch.forEach(function (n, i) {
      const f = hz(rt + 12 + n);
      tone({ t: t + i * 0.008, f: f, d: d, v: 0.085, to: music, verb: 0.35, a: 0.004 });
      tone({ t: t + i * 0.008, f: f * 2, d: d * 0.35, v: 0.028, to: music });
      tone({ t: t + i * 0.008, f: f * 1.004, d: d, v: 0.03, type: 'triangle', to: music });
    });
  }
  function pluck(t, m, v) {
    tone({ t: t, f: hz(m), d: 0.26, v: v, type: 'triangle', to: music, echo: 0.45, verb: 0.2 });
    tone({ t: t, f: hz(m), d: 0.1, v: v * 0.45, type: 'square', cut: 2400, to: music });
  }
  function bell(t, m, v) {
    tone({ t: t, f: hz(m), d: 0.7, v: v, to: music, echo: 0.4, verb: 0.3 });
    tone({ t: t, f: hz(m) * 2.76, d: 0.25, v: v * 0.3, to: music });
  }
  function scratch(t) { if (smp('scratch', t, 0.5)) return; hiss(t, 0.09, 0.3, 'bandpass', 900, 3200, 0, 3); hiss(t + 0.1, 0.12, 0.3, 'bandpass', 3200, 700, 0, 3); }

  // ---------- ROCK BOTTOM's track ----------
  // A level that names a song (spec.song) has its music written here, stretch by stretch: every stretch names its part
  // (style) and the steps below play it, so the gates stay on the beat exactly as they do in the first level. At 128:
  // four on the floor with everything else ducking under the kick (the pump), a bass on the off-beats, chord stabs, an
  // arp and a lead of three detuned saws. A stretch's last beats can wind up into the next (build): a riser and a
  // snare roll that doubles and doubles again, the kick held back for the last two beats so the next stretch lands
  // (the hardest landing is the boss's: drop). Every stretch ends in a fill and the next starts on a crash. The
  // mood 'gold' (every golden token of a set picked up) lifts it all a minor third and rings bells over it for eight bars.
  // Everything a song plays is turned down by SONG, set so that the most its voices can add up to going into the
  // compressor stays under HEADROOM (test/audio.cjs adds them up over a whole level).
  const HEADROOM = 2, SONG = 0.62;
  const SONGS = { rock: { chords: [[45, [0, 3, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [43, [0, 4, 7]]],     // Am F C G, a bar each
    hook: [{ 0: 76, 3: 76, 6: 74, 8: 72, 11: 69, 14: 72 }, { 0: 77, 3: 77, 6: 76, 8: 72, 11: 69, 14: 72 }, { 0: 79, 3: 79, 6: 76, 8: 72, 10: 74, 12: 76, 14: 79 }, { 0: 74, 3: 74, 6: 71, 8: 74, 11: 79, 14: 83 }] } };
  // how much of the band each part has: 0 a pulse, 1 kick bass and hats, 2 with claps stabs and the arp, 3 with the lead, 4 and 5 with everything
  const PARTS = { intro: 0, pulse: 1, drive: 2, drive2: 3, rush: 3, room: 2, chase: 3, drop: 4, finale: 5, break: -1, outro: -1 };
  let mood = '', moodEnd = 0, sndI = 0;
  function saws(t, m, d, v, cut, o) {
    [1, 1.007, 0.993].forEach(function (k, i) { tone(Object.assign({ t: t, f: hz(m) * k, d: d, v: (i ? 0.7 : 1) * v * SONG, type: 'sawtooth', cut: cut, to: music }, i ? null : o)); });
  }
  function songStep(step, t, L, bonus) {
    const beat = step / 4, sd = 15 / L.bpm, S = SONGS[L.spec.song];
    if (beat < 0) { if (step % 4 === 0) hat(t, 0.2 * SONG); return; }
    if (beat >= L.totalBeats || !S) return;
    const sec = L.sectionAt(beat), s16 = step % 16, bar = Math.floor(beat / 4), b4 = bar % 4, gold = mood === 'gold' && beat < moodEnd, sty = bonus ? 'room' : sec.style;
    const n = PARTS[sty] === undefined ? 2 : PARTS[sty], tr = gold ? 3 : 0, rt = S.chords[b4][0] + tr, ch = S.chords[b4][1], hn = S.hook[b4][s16], toEnd = sec.end - beat;
    const is = function (a) { return a.indexOf(s16) >= 0; }, K = function (v) { kick(t, v * SONG); }, vol = function (v) { return v * SONG; };
    const bass = function (m, d, v) { tone({ t: t, f: hz(m), d: d, v: vol(v), type: 'sawtooth', cut: 420, to: music, hold: 0.6 }); tone({ t: t, f: hz(m) * 1.012, d: d, v: vol(v * 0.7), type: 'sawtooth', cut: 420, to: music, hold: 0.6 }); };
    // where a stretch starts: a crash, and under the heavy ones a boom
    if (beat === sec.start && beat > 0 && !bonus) {
      if (!smp('crash', t, vol(0.5), { rv: 0.3 })) hiss(t, 1.2, vol(0.3), 'highpass', 2500, 0, 0.4);
      if (n >= 4) tone({ t: t, f: 70, f2: 30, gl: 0.5, d: 0.9, v: vol(0.8) });
    }
    // the wind-up into the next stretch
    if (!bonus && sec.build && toEnd <= sec.build) {
      const len = sec.build * 4 * sd, p = 1 - toEnd / sec.build, every = p < 0.5 ? 4 : p < 0.75 ? 2 : 1;
      if (toEnd === sec.build) { hiss(t, len, vol(0.22), 'bandpass', 300, 9000, 0.3, 2); tone({ t: t, f: 220, f2: 880, gl: len, d: len, v: vol(0.07), type: 'sawtooth', cut: 3000, to: music }); }
      if (step % every === 0) snare(t, vol(0.35 + 0.5 * p));
      if (toEnd > 2 && s16 % 4 === 0) K(0.9);
      if (s16 % 4 === 0) ch.forEach(function (c) { saws(t, rt + 12 + c + (p > 0.5 ? 12 : 0), sd * 1.5, 0.045, 1200 + 2400 * p); });
      return;
    }
    // the fill over a stretch's last beat
    if (!bonus && toEnd <= 1 && n >= 1) { snare(t, vol(0.5 + 0.12 * (s16 % 4))); tone({ t: t, f: 200 - (s16 % 4) * 28, f2: 80, d: 0.14, v: vol(0.35), type: 'triangle' }); }
    if (n < 0) {
      // the breather and the bottom: no drums to speak of. A pad, the hook on bells, a tick on the beat.
      if (s16 === 0) ch.forEach(function (c) { saws(t, rt + 12 + c, sd * 16, 0.035, 900, { a: 0.25, verb: 0.5 }); });
      if (hn) bell(t, hn + tr - (sty === 'outro' ? 12 : 0), vol(0.1));
      if (s16 % 4 === 0) hat(t, vol(0.06));
      if (sty === 'outro' && s16 === 0 && b4 % 2 === 0) K(0.7);
      return;
    }
    if (n === 0) {                                                  // the top: a pulse and a swell before anything lands
      if (s16 % 4 === 0) K(0.6);
      if (s16 % 2 === 0) hat(t, vol(0.1));
      if (s16 === 0) ch.forEach(function (c) { saws(t, rt + 12 + c, sd * 14, 0.04, 700, { a: 0.3, verb: 0.4 }); });
      return;
    }
    // drums: four on the floor (the chase breaks it up), claps on two and four, hats on the off-beats and quiet sixteenths
    if (sty === 'chase' ? is([0, 6, 10, 13]) : s16 % 4 === 0) K(n >= 4 ? 1 : 0.92);
    if (n >= 2 && is([4, 12])) { clap(t, vol(0.9)); if (n >= 3) snare(t, vol(0.7)); }
    if (s16 % 4 === 2) hat(t, vol(n >= 3 ? 0.2 : 0.14), n >= 3);
    else if (n >= 2) hat(t, vol(sty === 'chase' || n >= 5 ? 0.1 : 0.05));
    if (n >= 5 && s16 % 2 === 0) hiss(t, 0.09, vol(0.07), 'highpass', 8000);   // a ride over the finale
    if (n >= 4 && s16 === 0 && b4 === 0 && beat !== sec.start) { if (!smp('crash', t, vol(0.4), { rv: 0.3 })) hiss(t, 1, vol(0.25), 'highpass', 2500, 0, 0.4); }
    // bass: on the off-beats, where the kick has let go; the fast parts run it in sixteenths
    if (sty === 'rush' || sty === 'chase') bass(rt - 12 + (s16 % 2 ? 12 : 0), sd * 0.9, 0.26);
    else { if (s16 % 4 === 2) bass(rt - 12, sd * 1.8, 0.34); if (n >= 3 && s16 % 4 === 3) bass(rt, sd * 0.9, 0.22); if (n >= 4 && s16 % (n >= 5 ? 4 : 8) === 0) tone({ t: t, f: hz(rt - 12), d: sd * 3, v: vol(0.5), to: sat, hold: 0.5 }); }   // and a sub under the heavy parts: every beat of the finale
    if (sty === 'room') { bell(t, 81 + tr + [0, 4, 7, 12, 16, 12, 7, 4][s16 % 8], vol(0.08)); return; }   // a hidden room: bright and jingly over the same floor
    // stabs and the arp
    if (n >= 2 && is([0, 3, 6, 10, 14])) ch.forEach(function (c) { saws(t, rt + 12 + c, sd * 1.1, 0.05, 2400); if (n >= 5) saws(t, rt + 24 + c, sd * 1.1, 0.03, 3200); });
    if (n >= 2) tone({ t: t, f: hz(rt + 24 + ch[s16 % 3] + 12 * ((s16 >> 2) % 2) + (sty === 'rush' ? 12 : 0)), d: 0.08, v: vol(0.04), type: 'square', cut: 3400, to: music, echo: 0.3 });
    // the lead: the hook, an octave up and in fifths at the very end
    if (n >= 3 && hn) {
      saws(t, hn + tr, sd * (n >= 4 ? 1.6 : 2.6), 0.07, 2800, { echo: 0.35, verb: 0.2 });
      if (n >= 5) { saws(t, hn + tr + 12, sd * 1.6, 0.04, 3600); saws(t, hn + tr + 7, sd * 1.6, 0.03, 2800); }
    }
    if (n >= 4 && s16 === 14 && b4 % 2 === 1) shout(t, vol(0.2), n >= 5 ? 1.1 : 0.9);
    if (gold && s16 % 2 === 0) bell(t, 81 + tr + PENT[(s16 / 2 + bar) % 7], vol(0.08));
  }
  // What a written-out level's gates and foes sound like, each on its beat (L.sounds, from core.js): effects, so
  // they follow the sound-effects switch, not the music's.
  const cues = {
    door: function (t) { tone({ t: t, f: 180, f2: 90, d: 0.07, v: 0.3, type: 'square', cut: 900 }); hiss(t, 0.03, 0.12, 'highpass', 4000); },
    step: function (t) { tone({ t: t, f: 900, f2: 600, d: 0.04, v: 0.12, type: 'square' }); },
    charge: function (t, sd) { tone({ t: t, f: 110, f2: 440, gl: sd * 8, d: sd * 8, v: 0.12, type: 'sawtooth', cut: 1400 }); },
    volley: function (t) { hiss(t, 0.35, 0.4, 'lowpass', 5000, 300); tone({ t: t, f: 140, f2: 40, d: 0.4, v: 0.5 }); },
    warp: function (t) { [0, 7, 12].forEach(function (k, i) { tone({ t: t + i * 0.04, f: hz(76 + k), d: 0.2, v: 0.1, echo: 0.4 }); }); },
    fire: function (t) { hiss(t, 0.5, 0.1, 'bandpass', 400, 3000, 0, 2); },
    drip: function (t) { tone({ t: t, f: 1800, f2: 1200, d: 0.12, v: 0.1 }); },
    flip: function (t) { tone({ t: t, f: 520, d: 0.09, v: 0.12, type: 'square' }); tone({ t: t + 0.09, f: 390, d: 0.14, v: 0.12, type: 'square' }); },
  };

  function playStep(step, t, L, bonus) {
    if (L.spec.song) return songStep(step, t, L, bonus);
    const beat = step / 4, sd = 15 / L.bpm;
    if (beat < 0) { if (step % 4 === 0) hat(t, 0.2); return; }
    if (beat >= L.totalBeats) return;
    const sec = L.sectionAt(beat), sty = bonus ? 'bonus' : sec.style, s16 = step % 16, bar = Math.floor(beat / 4), b4 = bar % 4, pr = PROGS[L.spec.prog || 0][b4];
    const brk = sty === 'break' || sty === 'break2', trap = sty === 'trap', boom = sty.indexOf('boom') === 0;
    const tr = L.spec.tr + (sty === 'break' ? 5 : sty === 'break2' ? 7 : 0), rt = pr[0] + tr, ch = pr[1], hk = HOOKS[L.spec.hook || 0][s16];
    const hn = hk === undefined ? 0 : rt + 24 + ch[hk];              // the hook's note on this step, if it has one
    const lead = function (m, v) {
      if (L.spec.lead === 1) bell(t, m, v * 0.9);
      else if (L.spec.lead === 2) tone({ t: t, f: hz(m), d: 0.2, v: v * 0.7, type: 'square', cut: 2600, to: music, echo: 0.4, verb: 0.2, a: 0.005 });
      else pluck(t, m, v);
    };
    const is = function (a) { return a.indexOf(s16) >= 0; };
    if (sty === 'rush' || sty === 'bonus') {
      // the slide: four on the floor and everything rushing; the bonus room: the same, bright and jingly
      if (s16 % 4 === 0) kick(t, 0.95);
      if (is([4, 12])) { clap(t, 0.9); if (sty === 'rush') snare(t, 0.7); }
      hat(t, s16 % 4 === 2 ? 0.2 : 0.07, s16 % 4 === 2);
      if (s16 % 2 === 0) tone({ t: t, f: hz(rt - 12 + (s16 % 4 ? 12 : 0)), d: sd * 1.6, v: 0.3, type: 'sawtooth', cut: 520, to: music });
      if (sty === 'rush') {
        if (s16 % 8 === 0) keys(t, rt, ch, 0.3);
        if (s16 === 0 && b4 % 2 === 0) hiss(t, sd * 30, 0.16, 'bandpass', 300, 6000, 0.3, 2);
        tone({ t: t, f: hz(rt + 24 + ch[(s16 * 3) % 5]), d: 0.07, v: 0.045, type: 'square', cut: 4200, to: music, echo: 0.3 });
      } else bell(t, 81 + tr + [0, 4, 7, 12, 16, 12, 7, 4][s16 % 8], 0.07);
      return;
    }
    if (!brk && !trap && s16 % 2 === 1) t += sd * 0.24;             // swing
    if (beat === sec.start && beat > 0) { if (!smp('crash', t, 0.45, { rv: 0.3 })) hiss(t, 1.2, 0.3, 'highpass', 2500, 0, 0.4); scratch(t - sd * 2 > ac.currentTime ? t - sd * 2 : t); }
    if (boom || sty === 'lazy' || sty === 'intro') for (let i = 0; i < 2; i++) hiss(t + Math.random() * sd, 0.004, 0.05 + Math.random() * 0.05, 'highpass', 2500); // vinyl

    if (sty === 'intro' || sty === 'outro') {
      if (s16 % 4 === 2) hat(t, 0.1);
      if (s16 === 0) keys(t, rt, ch, 1.6);
      if (sty === 'outro' && hn) bell(t, hn, 0.1);
    } else if (boom) {                                             // boom bap
      if (is([0, 7, 10]) || (s16 === 15 && b4 === 3)) kick(t);
      if (s16 === 0) bass808(t, rt - 12, sd * 6); else if (s16 === 7) bass808(t, rt - 12, sd * 2.5); else if (s16 === 10) bass808(t, rt - 12 + (b4 === 3 ? 0 : ch[2] - 12), sd * 5, b4 === 1);
      if (is([4, 12])) { snare(t, 1); if (sty !== 'boom') clap(t, 0.7); }
      if (s16 % 2 === 0) hat(t, s16 % 4 === 2 ? 0.2 : 0.11, s16 === 14);
      else if (sty === 'boom3' || s16 === 11) hat(t, 0.06);
      if (s16 === 0) keys(t, rt, ch, 1.1); else if (s16 === 6 || (s16 === 11 && b4 % 2)) keys(t, rt, ch.slice(1), 0.5);
      if (sty !== 'boom' && hn) lead(hn + (sty === 'boom3' && bar % 8 > 3 ? 12 : 0), 0.11);
      if (sty !== 'boom' && s16 === 14 && b4 % 2 === 1) shout(t, 0.22, 1);                        // "hey"
      if (sty === 'boom3' && is([2, 9])) bell(t, 81 + tr + ch[(s16 + bar) % 4], 0.05);
    } else if (sty === 'lazy') {                                   // half-time and woozy
      if (is([0, 10])) kick(t);
      if (s16 === 0) bass808(t, rt - 12, sd * 9, true); else if (s16 === 10) bass808(t, rt - 12 + 7, sd * 4);
      if (s16 === 8) { snare(t, 1); clap(t, 0.8); }
      if (s16 % 4 === 2) hat(t, 0.16, s16 === 6);
      if (s16 === 0) keys(t, rt, ch, 2.2);
      if (hn && bar % 2 === 0) tone({ t: t, f: hz(hn - 12) * 1.04, f2: hz(hn - 12), gl: 0.08, d: 0.3, v: 0.16, type: 'triangle', to: music, echo: 0.5, verb: 0.3 });
      if (is([5, 13])) tone({ t: t, f: hz(rt + 31), f2: hz(rt + 19), d: 0.14, v: 0.12, type: 'sine', to: music, verb: 0.4 });  // drips
    } else if (trap) {                                             // trap: sliding 808s, hat rolls, bells
      if (is([0, 6, 11])) kick(t, 0.9);
      if (s16 === 0) bass808(t, rt - 12, sd * 5.5); else if (s16 === 6) bass808(t, rt, sd * 4.5, true); else if (s16 === 11) bass808(t, rt - 12 + ch[1], sd * 4.5);
      if (s16 === 8) { clap(t, 1); snare(t, 0.6); }
      if (s16 % 2 === 0) hat(t, s16 % 4 === 0 ? 0.16 : 0.1); else if (b4 === 2) hat(t, 0.07);
      if ((s16 === 6 || s16 === 14) && bar % 2) for (let i = 1; i < 4; i++) hat(t + sd * i / 4, 0.05 + i * 0.03);
      if (s16 === 15 && b4 === 3) snare(t, 0.55);
      if (hn) bell(t, hn + 12, 0.09);
      if (s16 === 0 && b4 === 0) keys(t, rt, ch, 3);
      if (s16 === 12 && b4 % 2 === 0) shout(t, 0.16, 0.8);
    } else {                                                       // the wind: a double-time breakbeat in another key
      if (is([0, 5, 10, 11])) kick(t, 0.9);
      if (is([4, 12])) snare(t, 1); else if (is([7, 9, 15])) snare(t, 0.3);
      hat(t, s16 % 2 ? 0.06 : 0.12, s16 === 2);
      if (s16 % 8 === 0) { tone({ t: t, f: hz(rt - 12), d: sd * 7.5, v: 0.26, type: 'sawtooth', cut: 240, to: music, hold: 0.8 }); tone({ t: t, f: hz(rt - 12) * 1.014, d: sd * 7.5, v: 0.26, type: 'sawtooth', cut: 240, to: music, hold: 0.8 }); }
      tone({ t: t, f: hz(rt + 24 + ch[s16 % 3] + 12 * ((s16 >> 2) % 2)), d: 0.09, v: 0.05, type: 'square', cut: 3600, to: music, echo: 0.3 });
      if (s16 % 8 === 0) keys(t, rt + 12, ch.slice(1, 4), 0.25);
      if (sty === 'break2' && s16 % 8 === 0) tone({ t: t, f: hz(rt + 31), f2: hz(rt + 36), d: sd * 6, v: 0.05, type: 'sawtooth', cut: 2400, to: music, verb: 0.4 });
      if (s16 === 0 && bar % 2 === 0) hiss(t, sd * 14, 0.1, 'bandpass', 400, 3000);
    }
  }

  // the finger snap that marks a tap of the level's own solution
  function cue(t, dir) {
    if (smp('snap', t, 0.6, { rate: dir > 0 ? 1.12 : 0.92, rv: 0.2 })) return;
    hiss(t, 0.035, 0.34, 'bandpass', dir > 0 ? 2700 : 1900, 0, 0.25, 2.2);
    tone({ t: t, f: dir > 0 ? 1500 : 1100, d: 0.02, v: 0.12 });
  }

  const sfx = {
    tap: function (t) { hiss(t, 0.02, 0.14, 'highpass', 5000); },
    slide: function (t, dir) { tone({ t: t, f: dir > 0 ? 300 : 260, f2: dir > 0 ? 180 : 160, d: 0.1, v: 0.2, type: 'triangle' }); },
    wind: function (t) { hiss(t, 0.22, 0.22, 'bandpass', 500, 2600); },
    gate: function (t) { hiss(t, 0.1, 0.05, 'bandpass', 2500, 5000); },
    token: function (t, n) { const m = 84 + PENT[n % 7]; tone({ t: t, f: hz(m), d: 0.14, v: 0.16, echo: 0.3 }); tone({ t: t + 0.05, f: hz(m + 7), d: 0.16, v: 0.12 }); },
    splat: function (t) { hiss(t, 0.4, 0.5, 'lowpass', 3000, 200); tone({ t: t, f: 300, f2: 40, d: 0.45, v: 0.3, type: 'sawtooth', cut: 1200 }); scratch(t + 0.05); },
    bonk: function (t) { tone({ t: t, f: 180, f2: 60, d: 0.25, v: 0.7 }); tone({ t: t + 0.05, f: 500, f2: 150, d: 0.35, v: 0.25, type: 'triangle' }); hiss(t, 0.1, 0.3, 'lowpass', 1500); },
    section: function (t) { tone({ t: t, f: 660, d: 0.1, v: 0.1, type: 'square' }); tone({ t: t + 0.1, f: 990, d: 0.18, v: 0.1, type: 'square', echo: 0.4 }); },
    win: function (t) { [0, 4, 7, 12, 16].forEach(function (n, i) { tone({ t: t + i * 0.09, f: hz(69 + n), d: 0.3, v: 0.14, type: 'square', echo: 0.4, verb: 0.3 }); }); },
    spring: function (t) { tone({ t: t, f: 180, f2: 720, gl: 0.12, d: 0.3, v: 0.3, type: 'triangle' }); tone({ t: t + 0.12, f: 720, f2: 360, d: 0.25, v: 0.2, type: 'triangle', echo: 0.4 }); },
    portal: function (t) { [0, 7, 12, 19, 24].forEach(function (n, i) { tone({ t: t + i * 0.05, f: hz(72 + n), d: 0.3, v: 0.12, echo: 0.5, verb: 0.4 }); }); hiss(t, 0.5, 0.15, 'bandpass', 500, 5000, 0.4, 3); },
    crash: function (t) { hiss(t, 0.5, 0.55, 'lowpass', 4000, 150); tone({ t: t, f: 220, f2: 40, d: 0.5, v: 0.35, type: 'sawtooth', cut: 900 }); },
    zap: function (t) { hiss(t, 0.35, 0.5, 'bandpass', 3500, 600, 0, 4); tone({ t: t, f: 900, f2: 90, d: 0.4, v: 0.3, type: 'sawtooth' }); },
    tick: function (t) { tone({ t: t, f: 1100, f2: 520, d: 0.07, v: 0.5, type: 'triangle' }); tone({ t: t, f: 2400, d: 0.03, v: 0.22, type: 'square' }); hiss(t, 0.03, 0.3, 'highpass', 4000); },
    ui: function (t) { tone({ t: t, f: 700, d: 0.05, v: 0.1, type: 'square' }); },
    putt: function (t) { tone({ t: t, f: 62, f2: 48, d: 0.07, v: 0.22, type: 'square', cut: 400 }); },
    // Frank's scream down the hole, over a slide whistle
    fall: function (t) { voice(t, 520, 190, 1.5, 0.5); tone({ t: t, f: 1700, f2: 260, d: 1.5, v: 0.12 }); },
    yelp: function (t) { voice(t, 480, 300, 0.35, 0.4); },
    // a written-out level's own: what he picks up and finds, and what gets him (named as core.js names the ways to die)
    key: function (t) { [0, 5, 12].forEach(function (n, i) { tone({ t: t + i * 0.045, f: hz(88 + n), d: 0.16, v: 0.13, echo: 0.3 }); }); },
    secret: function (t) { [0, 4, 7, 11, 16].forEach(function (n, i) { tone({ t: t + i * 0.06, f: hz(79 + n), d: 0.34, v: 0.12, type: 'triangle', echo: 0.5, verb: 0.4 }); }); },
    quack: function (t) { [0, 0.16].forEach(function (d) { tone({ t: t + d, f: 620, f2: 380, d: 0.11, v: 0.3, type: 'sawtooth', cut: 1800 }); }); },
    honk: function (t) { [0, 0.2].forEach(function (d) { tone({ t: t + d, f: 392, d: 0.14, v: 0.22, type: 'square', cut: 1600 }); tone({ t: t + d, f: 494, d: 0.14, v: 0.22, type: 'square', cut: 1600 }); }); },
    hey: function (t) { shout(t, 0.3, 1.2); },
    burn: function (t) { hiss(t, 0.5, 0.5, 'bandpass', 2500, 300, 0, 1.5); tone({ t: t, f: 260, f2: 50, d: 0.5, v: 0.3, type: 'sawtooth', cut: 1000 }); },
    grab: function (t) { tone({ t: t, f: 120, f2: 45, d: 0.35, v: 0.6 }); hiss(t, 0.2, 0.35, 'lowpass', 1200); voice(t + 0.05, 420, 240, 0.3, 0.35); },
  };
  sfx.fire = sfx.burn; sfx.drip = sfx.bonk; sfx.bat = sfx.zap; sfx.wisp = sfx.zap;

  root.FFFAudio = {
    init: init,
    // the game clock: audio time once sound is on, so the picture can never drift from the music
    time: function () { return ac ? ac.currentTime : performance.now() / 1000; },
    recStream: recStream,
    // Produced tracks (music/<frank>.mp3): where a level has one, it plays instead of the synthesized beat.
    // tracks.json holds each recording's measured tempo and the time of its first beat, so the level's beats
    // sit exactly on the recording's.
    trackPlaying: function () { return !!playing; },
    trackOf: function (i) { return TRACKS[i] || null; },
    load: function (i) {                                            // fetch and decode a level's track, once
      if (!ac || !TRACKS[i] || bufs[i]) return;
      Object.keys(bufs).forEach(function (k) { if (+k !== +i) delete bufs[k]; });   // one decoded track at a time: they are big
      bufs[i] = 'loading';
      fetch((root.FFF_BASE || '') + 'music/' + i + '.mp3').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (ok, bad) { ac.decodeAudioData(b, ok, bad); }); })
        .then(function (buf) { bufs[i] = buf; }).catch(function () { bufs[i] = null; });
    },
    stop: function () { if (playing) { try { playing.stop(); } catch (e) { /* not started */ } playing = null; } },
    seek: function (beat, L, i) {
      nextStep = Math.ceil(beat * 4 - 1e-6);
      cueI = 0; sndI = 0;
      while (cueI < L.plan.length && L.plan[cueI].beat < beat) cueI++;
      while (L.sounds && sndI < L.sounds.length && L.sounds[sndI].beat < beat) sndI++;
      if (!ac) return;
      echoDelay.delayTime.value = 45 / L.bpm;
      root.FFFAudio.stop();
      root.FFFAudio.load(i);
      startTrack(beat, i, L);
    },
    update: function (beat, L, bonus, who) {
      if (!ac) return;
      const now = ac.currentTime, spb = 60 / L.bpm;
      while (L.sounds && sndI < L.sounds.length && L.sounds[sndI].beat < beat + 0.3) {   // a written-out level's gates and foes, on their beats
        const t = now + (L.sounds[sndI].beat - beat) * spb;
        if (t > now - 0.03 && !bonus && on.sfx) cues[L.sounds[sndI].s](Math.max(t, now), 15 / L.bpm);
        sndI++;
      }
      if (!on.music) { nextStep = Math.ceil((beat + 0.3) * 4); while (cueI < L.plan.length && L.plan[cueI].beat < beat + 0.3) cueI++; return; }
      if (!playing) startTrack(beat, who, L);                         // it may have finished loading mid-run
      if (playing) nextStep = Math.ceil((beat + 0.3) * 4);          // the recording is the music
      while (nextStep / 4 < beat + 0.3) {
        const t = now + (nextStep / 4 - beat) * spb;
        if (t > now - 0.03) playStep(nextStep, Math.max(t, now), L, bonus);
        nextStep++;
      }
      while (cueI < L.plan.length && L.plan[cueI].beat < beat + 0.3) {
        const t = now + (L.plan[cueI].beat - beat) * spb;
        if (t > now - 0.03 && !bonus) cue(Math.max(t, now), L.plan[cueI].dir);
        cueI++;
      }
    },
    // a hair in the future, so a very short sound is not half over before it starts
    set: function (what, value) { on[what] = !!value; if (what === 'music' && !value) root.FFFAudio.stop(); },
    mood: function (m, until) { mood = m || ''; moodEnd = until || 0; },   // a song's mood ('gold') up to a beat; '' is none
    headroom: HEADROOM,
    sfx: function (name, arg) { if (ac && on.sfx) { if (ac.state !== 'running') ac.resume(); sfx[name](ac.currentTime + 0.012, arg); } },
    pause: function (on) { if (ac) { if (on) ac.suspend(); else ac.resume(); } },
    on: function () { return !!ac; },
    kit: function () { return Object.keys(S).length; },             // how many recorded samples have loaded
  };
})(window);
