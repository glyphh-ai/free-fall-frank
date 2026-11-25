// Captures the gameplay clips for the Instagram ad, frame by frame.
// The game's clock and its animation loop are replaced by ones this script steps by hand, so every clip is an exact
// 30 frames a second with the game's built-in solution playing (it never misses), at twice the phone's resolution.
//
//   node capture.mjs [cut] [out dir]     # cut: classic (default) or insane, see cuts.mjs; out: /tmp/ffad-<cut>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { CUTS } from './cuts.mjs';

const require = createRequire('/Users/timmetim/development/glyphh/web/package.json');
const { chromium } = require('playwright');

const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CUT = CUTS[process.argv[2] || 'classic'];
const OUT = process.argv[3] || '/tmp/ffad-' + (process.argv[2] || 'classic');
const FPS = 30;

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const meta = {};
for (const [name, q, pre, dur, how] of CUT.clips) {                 // how.still: a screen that is looked at, not played (no PLAY press)
  const dir = path.join(OUT, 'clips', name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: (CUT.view || [390])[0], height: (CUT.view || [0, 844])[1], deviceScaleFactor: (CUT.view || [0, 0, 2])[2] } });   // (a cut may be recorded at its own shape)
  page.on('pageerror', (e) => console.log(name, 'error:', String(e)));
  await page.addInitScript((set) => {
    ['fff.splash', 'fff.intro', 'fff.howto'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('fff.set', JSON.stringify(set));
    window.FFF_ME = { user: null, unlocked: Array.from({ length: 24 }, (_, i) => i), coins: 0 };
    // the hand-stepped clock
    let now = 1000; const waiting = [];
    performance.now = () => now;
    window.requestAnimationFrame = (f) => { waiting.push(f); return waiting.length; };
    window.__step = (ms, times) => { for (let i = 0; i < (times || 1); i++) { now += ms; waiting.splice(0).forEach((f) => f(now)); } };
  }, CUT.set);
  // a cut with a made level and Frank: the game is handed them the way its server would hand them over
  if (CUT.made) await page.addInitScript((m) => {
    Object.defineProperty(window, 'FFFAccount', { configurable: true, get() { return undefined; }, set(v) {
      v.api = (p) => p.indexOf('/api/level?') === 0 ? Promise.resolve(m.level) : p.indexOf('/api/frank?') === 0 ? Promise.resolve(m.frank) : Promise.reject(new Error('not here'));
      Object.defineProperty(window, 'FFFAccount', { value: v, writable: true });
    } });
  }, CUT.made);
  await page.goto(`file://${GAME}/index.html?${q}`);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__step(1000 / 60, 4));
  const picker = q.includes('screen=select');
  if (!picker && !(how && how.still)) await page.keyboard.press('Enter');
  await page.evaluate((n) => window.__step(1000 / 60, n), Math.round(pre * 60));
  const N = Math.round(dur * FPS), taps = [];
  let last = null, dead = -1;
  for (let f = 0; f < N; f++) {
    if (picker && f % 7 === 3) await page.keyboard.press('ArrowRight');   // flick along the row
    const s = await page.evaluate(() => { window.__step(1000 / 60, 2); const r = window.FFF.run(); return { st: window.FFF.state(), col: r.st.col, k: r.st.k }; });
    // a tap shows as Frank's place changing (which way it went)
    if (last && s.st === 'play' && last.st === 'play' && (s.col !== last.col || s.k !== last.k)) taps.push({ f, dir: s.col > last.col ? 1 : -1 });
    if (s.st === 'dead' && dead < 0) dead = f;
    last = s;
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  meta[name] = { frames: N, taps, dead };
  console.log(name, N, 'frames,', taps.length, 'taps', dead >= 0 ? 'dies at frame ' + dead : '');
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'clips.json'), JSON.stringify(meta));
