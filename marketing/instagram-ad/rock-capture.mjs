// Captures the ROCK BOTTOM reel's clips, frame by frame, the way capture.mjs does: the game's clock and animation
// loop are stepped by hand, the game's own solution plays (the bot), at insane, at 1080 x 1920. Each frame is taken
// at an exact beat of the level (frame f of a clip = its first beat + f / 30 s), so nothing drifts off the music.
// The level is paid for: the page is handed all of it the way the game's tests are (window.FFF_WORLDS), and an
// owner (window.FFF_ME). Nothing is served and no port is opened: the page is a file.
//
//   node rock-capture.mjs [clip names...]       # all the clips of rock-cuts.mjs, or only the ones named
import fs from 'node:fs';
import path from 'node:path';
import { chromium, ROCK, SRC, TMP, C, WORLDS, L, BPM, SPB, FPS } from './rock-lib.mjs';

const only = process.argv.slice(2), metaFile = path.join(TMP, 'clips.json');
fs.mkdirSync(path.join(TMP, 'clips'), { recursive: true });
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
for (const [name, q, start, beats] of ROCK.clips) {
  if (only.length && !only.includes(name)) continue;
  const dir = path.join(TMP, 'clips', name);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: ROCK.view[0], height: ROCK.view[1] }, deviceScaleFactor: ROCK.view[2] });
  page.on('pageerror', (e) => console.log(name, 'error:', String(e)));
  await page.addInitScript(({ set, world }) => {
    ['fff.splash', 'fff.intro', 'fff.howto'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('fff.set', JSON.stringify(set));
    window.FFF_ME = { user: null, unlocked: Array.from({ length: 24 }, (_, i) => i), coins: 0, levels: { rock: { owned: true, price: 0, found: [], secrets: 8 } } };
    window.FFF_WORLDS = { rock: world };
    // the hand-stepped clock
    let now = 1000; const waiting = [];
    performance.now = () => now;
    window.requestAnimationFrame = (f) => { waiting.push(f); return waiting.length; };
    window.__step = (ms, times) => { for (let i = 0; i < (times || 1); i++) { now += ms; waiting.splice(0).forEach((f) => f(now)); } };
    // on to an exact beat of the level, in steps of a sixtieth of a second at most
    window.__to = (beat, bpm) => {
      const r = () => window.FFF.run();
      for (let n = 0; window.FFF.state() === 'play' && r().beat < beat - 1e-4 && n < 200000; n++) window.__step(Math.min(1000 / 60, Math.max((beat - r().beat) * 60000 / bpm, 0.05)), 1);
      return { st: window.FFF.state(), beat: r().beat, col: r().st.col, k: r().st.k };
    };
  }, { set: ROCK.set, world: { id: 'rock', name: 'ROCK BOTTOM', owned: true, taste: false, v: C.WORLD_V, spec: WORLDS.rock.full } });
  // from the top of the stretch the clip is in (the stretch before, when the clip opens on a stretch's first beat)
  const at = L.sectionIndexAt(Math.max(0, start - 0.5));
  await page.goto(`file://${SRC}/index.html?bot&mute&level=rock&at=${at}${q}`);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__step(1000 / 60, 4));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);                                   // the level is handed over
  await page.evaluate(() => window.__step(1000 / 60, 1));
  const N = Math.round(beats * SPB * FPS) + 2;
  let bad = '';
  for (let f = 0; f < N; f++) {
    const s = await page.evaluate(([b, bpm]) => window.__to(b, bpm), [start + f / FPS / SPB, BPM]);
    if (s.st !== 'play' && s.st !== 'win' && !bad) bad = s.st + ' at frame ' + f;
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  meta[name] = { frames: N, start, beats };
  console.log(name, N, 'frames from beat', start, '(' + L.sectionAt(start).name + ')', bad ? 'NOT PLAYING: ' + bad : '');
  await page.close();
}
await browser.close();
fs.writeFileSync(metaFile, JSON.stringify(meta));
