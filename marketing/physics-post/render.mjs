// Renders post.html to frank-physics-post.png (1080x1350, Instagram portrait).
import { createRequire } from 'node:module';
const require = createRequire('/Users/timmetim/development/glyphh/web/package.json');
const { chromium } = require('playwright');
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
await p.goto('file://' + dir + 'post.html');
await p.waitForTimeout(300);
await p.screenshot({ path: dir + 'frank-physics-post.png' });
await b.close();
