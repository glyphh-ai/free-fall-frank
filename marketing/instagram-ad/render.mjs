// Renders ad.html frame by frame (its clock is window.seek, so every frame is exact), then ffmpeg joins the frames
// with the game's own track into the cut's mp4 (1080 x 1920, 30 fps) and saves a cover image.
//
//   node render.mjs [cut] [clips dir] [track.mp3]      # cut: classic (default) or insane, see cuts.mjs
//   node render.mjs [cut] --stills                     # a few moments only, into the clips dir's stills/
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CUTS } from './cuts.mjs';

const require = createRequire('/Users/timmetim/development/glyphh/web/package.json');
const { chromium } = require('playwright');

const DIR = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2), rest = args.filter((a) => !a.startsWith('--'));
const NAME = rest[0] || 'classic', CUT = CUTS[NAME];
const CLIPS = rest[1] || '/tmp/ffad-' + NAME, TRACK = rest[2] || path.join(DIR, CUT.track || '../../music/0.mp3');
const FPS = 30, W = (CUT.size || [1080, 1920])[0], H = (CUT.size || [1080, 1920])[1];
const FIRST_BEAT = CUT.first === undefined ? 0.322 : CUT.first;   // where the track's first beat falls (music/tracks.js): the cuts sit on it
// A cut about a made level says what the game's own builder says of it: the numbers are worked out here, not typed in.
if (CUT.made && CUT.chat) {
  const C = createRequire(import.meta.url)('../../core.js'), L = C.buildLevel(C.customSpec(C.customLevel(CUT.made.level)));
  const stats = Math.round(L.totalBeats * 60 / CUT.bpm) + ' s · ' + L.gates.length + ' gates · ' + L.plan.length + ' taps · ' + L.maxTokens + ' coins';
  CUT.chat = CUT.chat.map((m) => m.map((x) => (x === '{stats}' ? stats : x)));
  console.log('the level:', stats);
}

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('error:', String(e)));
await page.addInitScript(`window.AD = ${JSON.stringify(CUT)}; window.CLIPS = ${fs.readFileSync(path.join(CLIPS, 'clips.json'), 'utf8')}; window.CLIPDIR = ${JSON.stringify(`file://${path.join(CLIPS, 'clips')}/`)};`);
await page.goto('file://' + path.join(DIR, CUT.page || 'ad.html'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const DUR = await page.evaluate(() => window.DUR);

if (args.includes('--stills')) {
  const out = path.join(CLIPS, 'stills'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const beat = 60 / CUT.bpm;
  // the middle of every clip, and the end card
  for (const t of CUT.seg.map((s) => (s[0] + s[1]) / 2 * beat).concat([(CUT.end + 5) * beat])) {
    await page.evaluate((x) => window.seek(x), t);
    await page.screenshot({ path: path.join(out, `${t.toFixed(1).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 80 });
  }
  await browser.close();
  process.exit(0);
}

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'ffad-frames-'));
const N = Math.round(FPS * DUR);
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.seek(t), f / FPS);
  await page.screenshot({ path: path.join(frames, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 97 });
  if (f % 150 === 0) console.log(`frame ${f}/${N}`);
}
await browser.close();

const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
// a cut that plays faster plays the track faster too, the way the game does (pitch and all)
const speed = CUT.rate === 1 ? '' : `aresample=44100,asetrate=${Math.round(44100 * CUT.rate)},aresample=44100,`;
ff(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-ss', String(FIRST_BEAT), '-t', String(DUR * CUT.rate + 0.5), '-i', TRACK,
  '-af', `${speed}afade=t=in:d=0.05,afade=t=out:st=${(DUR - 1).toFixed(2)}:d=1,loudnorm=I=-14:TP=-1.5`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-shortest', '-movflags', '+faststart',
  path.join(DIR, CUT.out)]);
ff(['-i', path.join(frames, `${String(Math.round(CUT.coverAt * FPS)).padStart(5, '0')}.jpg`), '-q:v', '2', path.join(DIR, CUT.cover)]);
fs.rmSync(frames, { recursive: true, force: true });
console.log('done:', CUT.out, N, 'frames,', DUR.toFixed(1), 's');
