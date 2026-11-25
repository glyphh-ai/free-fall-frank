// What the ROCK BOTTOM reel's scripts share: where the game is read from, the level itself, and the browser.
//
// The game is read from a COPY (default /tmp/frank-video-src, or FRANK_SRC): a copy of this game's folder without
// node_modules and marketing, so that a capture is never taken from a file somebody is half way through editing.
//   rsync -a --exclude node_modules --exclude marketing --exclude landing /Users/timmetim/development/free-fall-frank/ /tmp/frank-video-src/
import { createRequire } from 'node:module';
import path from 'node:path';
export { ROCK } from './rock-cuts.mjs';
import { ROCK } from './rock-cuts.mjs';

const require = createRequire('/Users/timmetim/development/glyphh/web/package.json');
export const { chromium } = require('playwright');
export const DIR = path.dirname(new URL(import.meta.url).pathname);
export const SRC = process.env.FRANK_SRC || '/tmp/frank-video-src';
export const TMP = process.env.FRANK_TMP || '/tmp/frank-video/rock';       // clips, the wav, stills
const game = createRequire(SRC + '/');
export const C = game('./core.js'), WORLDS = game('./worlds.js');
export const L = C.buildLevel(WORLDS.rock.full);
export const BPM = ROCK.bpm * ROCK.speed, SPB = 60 / BPM, FPS = 30;
if (L.bpm !== ROCK.bpm) throw new Error('the level is written at ' + L.bpm + ' bpm, the cut says ' + ROCK.bpm);
