// Renders rock.html frame by frame (its clock is window.seek, so every frame is exact), then ffmpeg joins the
// frames with the level's own music (rock-audio.mjs's wav, one unbroken piece) into the mp4 (1080 x 1920, 30 fps,
// H.264 + AAC) and saves the cover. The music is already at -14 LUFS as the game mixes it: it is not re-levelled
// (that would flatten the wind-up and the landing), only kept under -1.5 dB and faded out over the last second.
//
//   node rock-render.mjs             # the mp4 and the cover, beside this file
//   node rock-render.mjs --stills    # a look first: every clip at three moments with its words on, and the end card, into <TMP>/stills/
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, ROCK, DIR, TMP, SPB, FPS } from './rock-lib.mjs';

const [W, H] = ROCK.size, WAV = path.join(TMP, 'rock.wav');
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('error:', String(e)));
await page.addInitScript(`window.AD = ${JSON.stringify(ROCK)}; window.CLIPS = ${fs.readFileSync(path.join(TMP, 'clips.json'), 'utf8')}; window.CLIPDIR = ${JSON.stringify(`file://${path.join(TMP, 'clips')}/`)};`);
await page.goto('file://' + path.join(DIR, ROCK.page));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
const DUR = await page.evaluate(() => window.DUR);
const shot = async (t, file, q) => { await page.evaluate((x) => window.seek(x), t); await page.screenshot({ path: file, type: 'jpeg', quality: q }); };

if (process.argv.includes('--stills')) {
  const out = path.join(TMP, 'stills'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  for (const [a, b, name] of ROCK.seg) for (const [k, p] of [0.3, 0.6, 0.9].entries()) await shot((a + (b - a) * p) * SPB, path.join(out, `${String(a).padStart(2, '0')}-${name}-${k}.jpg`), 80);
  for (const [k, d] of [1, 3, 6, 11].entries()) await shot((ROCK.end + d) * SPB, path.join(out, `${ROCK.end}-end-${k}.jpg`), 80);
  await browser.close();
  console.log('stills in', out);
  process.exit(0);
}

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'ffad-rock-'));
const N = Math.round(FPS * DUR);
for (let f = 0; f < N; f++) {
  await shot(f / FPS, path.join(frames, `${String(f).padStart(5, '0')}.jpg`), 97);
  if (f % 150 === 0) console.log(`frame ${f}/${N}`);
}
// the cover: a moment of the picture alone, no words and no cut's flash on it
await page.evaluate(() => { window.NOWORDS = true; document.getElementById('flash').style.display = 'none'; });
await shot(ROCK.coverAt * SPB + 0.3, path.join(frames, 'cover.jpg'), 97);
await browser.close();

const ff = (a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { stdio: 'inherit' });
ff(['-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', WAV,
  '-af', `afade=t=in:d=0.03,alimiter=limit=0.84:level=false,afade=t=out:st=${(DUR - 1).toFixed(2)}:d=1`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', DUR.toFixed(3), '-movflags', '+faststart',
  path.join(DIR, ROCK.out)]);
ff(['-i', path.join(frames, 'cover.jpg'), '-q:v', '2', path.join(DIR, ROCK.cover)]);
fs.rmSync(frames, { recursive: true, force: true });
console.log('done:', ROCK.out, N, 'frames,', DUR.toFixed(2), 's');
