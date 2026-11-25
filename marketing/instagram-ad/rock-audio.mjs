// Renders ROCK BOTTOM's own music to a wav, offline. The track is not a recording: audio.js synthesizes it step by
// step from the level. So the game's real audio.js is loaded into a headless page whose AudioContext is an
// OfflineAudioContext, with the game's recorded drum kit (samples/*.wav, handed to its fetch), and it is driven the
// way game.js drives it: seek once, then update(beat) sixty times a second (the offline context is suspended at
// each of those moments), at insane (the level's bpm x 1.4, as the game sets it). Music only: the sound-effects
// switch is off, so what is heard is the song (and the finger snaps on the solution's taps, which are part of it).
//
// The piece is the level's beats ROCK.from .. the bottom, plus the ring-out, to the reel's length. The render
// starts a few bars earlier so that the echo and the reverb are already full where the piece begins.
//
//   node rock-audio.mjs        # writes <TMP>/rock.wav (32-bit float, 44.1 kHz stereo) and prints how loud it is
import fs from 'node:fs';
import path from 'node:path';
import { chromium, ROCK, SRC, TMP, WORLDS, L, BPM, SPB } from './rock-lib.mjs';

const RATE = 44100, LEAD = 8;                                       // beats rendered before the piece, then cut off
const from = ROCK.from - LEAD, secs = (LEAD + ROCK.dur) * SPB + 0.5;
const kit = {};
for (const f of fs.readdirSync(path.join(SRC, 'samples'))) if (f.endsWith('.wav')) kit[f] = fs.readFileSync(path.join(SRC, 'samples', f)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('error:', String(e)));
page.on('console', (m) => console.log('page:', m.text()));
await page.goto('about:blank');
await page.evaluate(({ kit, secs, RATE }) => {
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  window.fetch = (url) => { const k = kit[String(url).split('/').pop()]; return k ? Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(bytes(k)) }) : Promise.reject(new Error('not here')); };
  window.FFFTracks = {};
  window.__ctx = null;
  window.AudioContext = function () { return (window.__ctx = new OfflineAudioContext(2, Math.ceil(secs * RATE), RATE)); };
}, { kit, secs, RATE });
await page.addScriptTag({ path: path.join(SRC, 'core.js') });
await page.addScriptTag({ path: path.join(SRC, 'audio.js') });
const got = await page.evaluate(async ({ spec, bpm, from, secs }) => {
  const A = window.FFFAudio, Lv = window.FFFCore.buildLevel(spec);
  A.init();
  const ctx = window.__ctx;
  for (let i = 0; i < 200 && A.kit() < 11; i++) await new Promise((r) => setTimeout(r, 20));   // the kit decodes
  Lv.bpm = bpm;                                                     // insane: game.js sets the level's tempo the same way
  A.set('music', true); A.set('sfx', false);
  const beatAt = (t) => from + t * bpm / 60;
  let ticks = 0;
  A.seek(from, Lv, 100);
  A.update(from, Lv, false, 100);
  const tick = () => { ticks++; A.update(beatAt(ctx.currentTime), Lv, false, 100); const next = ctx.currentTime + 1 / 60; if (next < secs - 0.01) ctx.suspend(next).then(tick); ctx.resume(); };
  ctx.suspend(1 / 60).then(tick);
  const buf = await ctx.startRendering();
  const n = buf.length, a = buf.getChannelData(0), b = buf.getChannelData(1), out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[2 * i] = a[i]; out[2 * i + 1] = b[i]; }
  const u8 = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { kit: A.kit(), ticks, n, total: Lv.totalBeats, pcm: btoa(s) };
}, { spec: WORLDS.rock.full, bpm: BPM, from, secs });
await browser.close();

// cut off the lead-in, and look at what is there
const all = new Float32Array(new Uint8Array(Buffer.from(got.pcm, 'base64')).buffer), skip = Math.round(LEAD * SPB * RATE), len = Math.round(ROCK.dur * SPB * RATE);
const pcm = all.subarray(skip * 2, (skip + len) * 2);
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity).toFixed(1) + ' dBFS';
let peak = 0, sq = 0, over = 0;
for (let i = 0; i < pcm.length; i++) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; if (v >= 1) over++; sq += v * v; }
console.log(`rendered ${got.n / RATE}s in ${got.ticks} updates with ${got.kit} of 11 kit samples; the piece: beats ${ROCK.from}..${ROCK.from + ROCK.dur} of ${got.total}, ${(len / RATE).toFixed(2)} s at ${BPM} bpm`);
console.log(`peak ${peak.toFixed(3)} (${db(peak)}), RMS ${db(Math.sqrt(sq / pcm.length))}, samples at or over full scale: ${over}`);
// how loud each 4 beats of it is: the parts should be heard in it (drive, the wind-up, the finale, the outro, the ring-out)
const bar = Math.round(4 * SPB * RATE), rows = [];
for (let k = 0; k * bar < len; k++) { let q = 0, p = 0, m = Math.min(len, (k + 1) * bar); for (let i = k * bar * 2; i < m * 2; i++) { q += pcm[i] * pcm[i]; p = Math.max(p, Math.abs(pcm[i])); } rows.push(`${String(k * 4).padStart(3)} ${L.sectionAt(Math.min(L.totalBeats - 0.01, ROCK.from + k * 4)).style.padEnd(7)} rms ${db(Math.sqrt(q / ((m - k * bar) * 2))).padStart(11)} peak ${p.toFixed(2)}`); }
console.log(rows.join('\n'));
if (!(peak > 0.05)) throw new Error('the render is silent');

fs.mkdirSync(TMP, { recursive: true });
const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.writeFileSync(path.join(TMP, 'rock.wav'), Buffer.concat([h, data]));
console.log('wrote', path.join(TMP, 'rock.wav'));
