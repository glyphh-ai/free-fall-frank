// node test/ui.cjs : WHAT IS ON THE SCREEN, in a real browser (a headless phone, the game opened as a file: no
// server, no port). The look of the game is judged by eye; this holds what must never go wrong with it:
//   every screen draws something (a screenshot of each is a real picture, many colours, not one flat fill);
//   NOTHING IS EVER WRITTEN OVER FRANK: on the win screen, paused, and at the wall a taste ends in, no sheet,
//   headline or button touches the part of the screen he is in;
//   the top of the first level is the city, with the logo (the file) on its billboard, and it costs little to draw;
//   every level's card shows its rating and the difficulty picker; picking one changes the level's speed and nothing else;
//   buttons are big enough for a thumb (44 px) and inside the screen, on a phone and on a small one.
// It needs Playwright (not a dependency of the game): PLAYWRIGHT_PATH, or NODE_PATH with it. Without it: skipped.
'use strict';
const assert = require('assert'), path = require('path');
let chromium;
try { chromium = require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium; } catch (e) { console.log('SKIPPED ui: Playwright is not here (set PLAYWRIGHT_PATH or NODE_PATH to look at the screens in a browser)'); process.exit(0); }
const ROOT = path.join(__dirname, '..'), W = require('../worlds.js'), sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
const ME = { user: null, unlocked: [], packs: [], coins: 12, hearts: {}, ads: [{ id: 'glyphh', text: 'GLYPHH', sub: 'MADE THIS GAME', url: 'https://glyphh.ai', color: '#ff4fd8' }], levels: { rock: { owned: false, price: 99, name: 'ROCK BOTTOM', found: [], secrets: 8 } } };
let browser, lab;
// how much of a picture a screenshot is: its different colours, counted on a grid of points (in a page of its own)
async function colours(buf) {
  return lab.evaluate(function (src) {
    return new Promise(function (ok) {
      const im = new Image(); im.onload = function () {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const seen = {}; for (let y = 4; y < im.height; y += Math.ceil(im.height / 60)) for (let x = 4; x < im.width; x += Math.ceil(im.width / 40)) { const d = g.getImageData(x, y, 1, 1).data; seen[(d[0] >> 3) + ',' + (d[1] >> 3) + ',' + (d[2] >> 3)] = 1; }
        ok(Object.keys(seen).length);
      }; im.src = src;
    });
  }, 'data:image/png;base64,' + buf.toString('base64'));
}
async function open(size, query, o) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', function (e) { errors.push(String(e.message || e)); });
  await page.addInitScript(function (a) { window.FFF_ME = a.me; if (a.world) window.FFF_WORLDS = { rock: a.world }; }, { me: ME, world: (o && o.world) || null });
  await page.goto('file://' + ROOT + '/index.html?' + query);
  await page.waitForFunction(function () { return !!(window.FFF && window.FFFAccount && window.FFFAccount.me.ready); });
  await sleep(350);
  return { page: page, ctx: ctx, errors: errors, size: size };
}
const until = async function (page, st, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (st.split('|').indexOf(await page.evaluate(function () { return window.FFF.state(); })) >= 0) return; await sleep(40); } throw new Error('the game never got to ' + st + ' (it is ' + await page.evaluate(function () { return window.FFF.state(); }) + ')'); };
const hitsOf = function (page) { return page.evaluate(function () { return window.FFF.hits(); }); };
const meets = function (a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; };
// a screen is a picture, and its buttons are in it and big enough
async function looked(s, what, min, o) {
  const n = await colours(await s.page.screenshot()), hs = await hitsOf(s.page);
  assert(n >= (min || 12), what + ' (' + s.size.join('x') + '): the screen is a picture, not a blank (' + n + ' colours)');
  hs.forEach(function (h) {
    assert(h.x >= -1 && h.y >= -1 && h.x + h.w <= s.size[0] + 1 && h.y + h.h <= s.size[1] + 1, what + ' (' + s.size.join('x') + '): the button ' + (h.label || '?') + ' is on the screen: ' + JSON.stringify(h));
    if (!(o && o.rows) || !/^LEVEL /.test(h.label)) assert(h.w >= 43.5 && h.h >= 43.5, what + ' (' + s.size.join('x') + '): the button ' + (h.label || '?') + ' is big enough for a thumb: ' + Math.round(h.w) + ' x ' + Math.round(h.h));
  });
  assert.deepStrictEqual(s.errors, [], what + ': nothing threw');
  return hs;
}
// nothing written or laid over the fall, and no button, touches where Frank is
async function clearOfFrank(s, what) {
  const g = await s.page.evaluate(function () { return { frank: window.FFF.frankBox(), inks: window.FFF.inks(), hits: window.FFF.hits() }; });
  assert(g.inks.length >= 1, what + ': the sheet says where it is');
  assert(g.frank.y >= 0 && g.frank.y + g.frank.h < s.size[1] * 0.6, what + ': Frank is in the upper part of the screen: ' + JSON.stringify(g.frank));
  g.inks.forEach(function (k) { assert(!meets(k, g.frank), what + ' (' + s.size.join('x') + '): something is written over Frank: ' + JSON.stringify(k) + ' meets ' + JSON.stringify(g.frank)); });
  g.hits.forEach(function (h) { assert(!meets(h, g.frank), what + ' (' + s.size.join('x') + '): the button ' + h.label + ' is over Frank'); });
  return g;
}
const tap = async function (page, label) { const h = (await hitsOf(page)).filter(function (x) { return x.label === label; })[0]; assert(h, 'there is a button ' + label); await page.mouse.click(h.x + h.w / 2, h.y + h.h / 2); await sleep(250); };

(async function () {
  browser = await chromium.launch(); lab = await (await browser.newContext()).newPage();
  let s, hs, g;
  for (const size of [[390, 844], [360, 640]]) {
    // ---- the main page: the card, its rating, the difficulty picker ----
    s = await open(size, 'mute'); hs = await looked(s, 'the main page', 40);
    const names = hs.map(function (h) { return h.label; });
    ['PLAY', 'MODE EASY', 'MODE NORMAL', 'MODE HARD', 'MODE INSANE', 'HEART', 'TOP', 'SHARE', 'SETTINGS', 'NEXT LEVEL'].forEach(function (n) { assert(names.indexOf(n) >= 0, 'the main page (' + size.join('x') + ') has ' + n + ': ' + names.join(', ')); });
    assert.deepStrictEqual(await s.page.evaluate(function () { return [window.FFF.rating('city').tier, window.FFF.rating('rock').tier, window.FFF.rating('rock').level]; }), ['TRICKY', 'DEMON', 5], 'the two levels\' ratings');
    assert(await s.page.evaluate(function () { return window.FFF.logo(); }), 'the logo file is loaded');
    // the picker: HARD is a fifth faster, NORMAL is the level's own tempo again; what is kept is the setting, as it always was
    const bpm = function () { return s.page.evaluate(function () { return [window.FFF.diff(), window.FFF.level().bpm / window.FFF.level().baseBpm, JSON.parse(localStorage.getItem('fff.set') || '{}').diff]; }); };
    assert.deepStrictEqual((await bpm()).slice(0, 2), [1, 1]); await tap(s.page, 'MODE HARD'); assert.deepStrictEqual(await bpm(), [2, 1.2, 2], 'HARD from the card'); await tap(s.page, 'MODE INSANE'); assert.deepStrictEqual(await bpm(), [3, 1.4, 3]);
    await tap(s.page, 'MODE EASY'); assert.deepStrictEqual(await bpm(), [0, 1, 0]); await tap(s.page, 'MODE NORMAL'); assert.deepStrictEqual(await bpm(), [1, 1, 1]);
    assert.strictEqual(await s.page.evaluate(function () { return window.FFF.state(); }), 'title', 'picking a difficulty does not start the level');
    await s.page.keyboard.press('ArrowRight'); await sleep(700); hs = await looked(s, 'ROCK BOTTOM\'s card', 30);
    assert(hs.some(function (h) { return h.label === 'TRY FREE'; }) && hs.some(function (h) { return h.label === 'UNLOCK $0.99'; }), 'a level to buy: TRY FREE and UNLOCK with its price');
    await tap(s.page, 'UNLOCK $0.99'); await until(s.page, 'unlock', 2000); await looked(s, 'the unlock sheet', 12);
    await s.page.keyboard.press('Escape'); await s.page.keyboard.press('ArrowRight'); await sleep(700); await looked(s, 'the page of more levels', 12);
    await tap(s.page, 'PLAY THEIR LEVELS'); await until(s.page, 'board', 2000); await sleep(300); hs = await looked(s, 'the players\' levels', 10, { rows: true });
    ['RATING ALL', 'RATING CHILL', 'RATING DEMON', 'SORT', 'BUILD ONE', 'BACK'].forEach(function (n) { assert(hs.some(function (h) { return h.label === n; }), 'the list has ' + n); });
    assert(await s.page.evaluate(function () { const f = document.getElementById('find'); return !f.hidden && f.getBoundingClientRect().height >= 30; }), 'and its search box');
    await s.page.focus('#find'); assert.strictEqual(await s.page.evaluate(function () { return window.FFF.busy(); }), true, 'typing in the search box holds the page (no reload under it)');
    await tap(s.page, 'BACK'); assert(await s.page.evaluate(function () { return document.getElementById('find').hidden && !window.FFF.busy(); }), 'the search box goes with the list');
    await tap(s.page, 'SETTINGS'); await until(s.page, 'settings', 2000); hs = await looked(s, 'the settings', 12);
    assert(hs.some(function (h) { return h.label === 'MODE INSANE'; }) && hs.some(function (h) { return h.label === 'DONE'; }));
    await s.ctx.close();
    s = await open(size, 'mute&screen=select'); await looked(s, 'the Frank picker', 20); await s.ctx.close();

    // ---- the top of the first level: the city, and what it costs ----
    s = await open(size, 'bot&mute'); await s.page.keyboard.press('Enter'); await until(s.page, 'play', 3000); await sleep(350);
    assert((await colours(await s.page.screenshot())) >= 60, 'the top of the first level is a city of many colours, not a flat sky');
    const cost = await s.page.evaluate(function () { return window.FFF.cost(120); });
    assert(cost < 6, 'a frame of the top of the level is drawn in ' + cost.toFixed(2) + ' ms of script (a frame has 16)');
    // ---- paused: the sheet is under him ----
    await sleep(2500); await s.page.keyboard.press('Escape'); await until(s.page, 'paused', 2000); await sleep(200);
    await looked(s, 'paused', 12); await clearOfFrank(s, 'paused'); await s.ctx.close();

    // ---- THE WIN: LEVEL CLEAR and its sheet never over Frank, from the first frame to the settled screen ----
    s = await open(size, 'bot&mute&at=11'); await s.page.keyboard.press('Enter'); await until(s.page, 'win', 40000);
    for (let i = 0; i < 6; i++) { g = await clearOfFrank(s, 'the win screen, ' + (i * 0.3).toFixed(1) + ' s in'); await sleep(300); }
    await sleep(900); hs = await looked(s, 'the win screen', 25); g = await clearOfFrank(s, 'the win screen, settled');
    ['SHARE IT', 'FALL AGAIN', 'LEADERBOARD', 'LEVELS'].forEach(function (n) { assert(hs.some(function (h) { return h.label === n; }), 'the win screen has ' + n); });
    assert(g.inks.some(function (k) { return k.h > 150; }) && g.inks.every(function (k) { return k.y >= g.frank.y + g.frank.h - 1; }), 'the headline and the sheet are both below him');
    // (and he is really there, in the clear: the part of the screenshot he is in is a picture of him, several colours)
    const shot = await s.page.screenshot({ clip: { x: Math.max(0, g.frank.x), y: Math.max(0, g.frank.y), width: Math.min(g.frank.w, size[0]), height: g.frank.h } });
    assert((await colours(shot)) >= 6, 'Frank is in plain sight on the win screen');
    await s.ctx.close();
  }
  // ---- the wall a taste ends in: its sheet keeps under him too ----
  s = await open([390, 844], 'bot&mute&at=3', { world: { spec: JSON.parse(JSON.stringify(W.rock.taste)), owned: false, v: 1 } });
  await s.page.keyboard.press('ArrowRight'); await sleep(600); await s.page.keyboard.press('Enter'); await until(s.page, 'wall', 90000); await sleep(300);
  await looked(s, 'the wall', 12); await clearOfFrank(s, 'the wall at the end of the taste'); await s.ctx.close();
  await browser.close();
  console.log('OK ui: on a phone and a small phone every screen is a picture with its buttons on it and thumb-sized; each card has its rating (ELM STREET TRICKY, ROCK BOTTOM DEMON) and the difficulty picker, which changes the speed and nothing else; the list of players\' levels has its search box (held against a reload while typed in) and its rating filter; the top of the first level is the city with the logo file on its billboard; and nothing is written over Frank paused, at the wall, or on the win screen from its first frame');
  process.exit(0);
})().catch(function (e) { console.error(e); Promise.resolve(browser && browser.close()).catch(function () {}).then(function () { process.exit(1); }); });
