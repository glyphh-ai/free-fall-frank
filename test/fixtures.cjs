// node test/fixtures.cjs : LEVELS THAT WERE MADE, AND THE GAME'S OWN, MUST GO ON BUILDING (server.js, "SAFE BUILDS").
// A made level is kept on the server (and on a player's device) as a small design and built again, by core.js, every
// time someone opens it: by this build, and by every build after it. A paid level's stretches are handed out by the
// server and built by whichever build of the page asked. So:
//   test/fixtures/made    designs exactly as they were kept under the builds that wrote them. Each must still be
//                         read, build, be the SAME level it was (its gates, taps and tokens: its print), and be
//                         cleared by the level's own solution.
//   test/fixtures/worlds  the first level and ROCK BOTTOM (all of it, and its taste) as they are: the stretches as
//                         /api/world hands them out must still build and be cleared, and what this build would hand
//                         out must be the same level.
//   test/fixtures/deployed/core.js   the builder of the release that is live (deploy.sh keeps it): a page of that
//                         release, still open, must be able to build and clear what THIS server will hand it.
// A level that is no longer the level it was FAILS. If that is meant (a design was changed on purpose), say so with
//   node test/fixtures.cjs --accept [folder]    writes the prints and the worlds as they are now
//   node test/fixtures.cjs --capture [folder]   writes this build's own made designs (one of every kind of stretch
//                                               between them), never over one that is there
// THE RULE: a made fixture is never deleted or edited while its version is one core.js still reads (MADE_READS).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const C = require(process.env.FFF_CORE || '../core.js'), DIR = path.join(__dirname, 'fixtures'), MADE = path.join(DIR, 'made'), WORLD = path.join(DIR, 'worlds'), PREV = process.env.FFF_PREV || path.join(DIR, 'deployed', 'core.js');
const sha = function (s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); };
// what a built level is, to someone falling down it: where its walls and gates are, the taps of its way through, its tokens
function print(L) {
  const rows = Array.from(L.solids.entries()).sort(function (a, b) { return a[0] - b[0]; });
  return sha(JSON.stringify([L.totalBeats, L.totalRows, L.plan, rows, L.gates.map(function (g) { return [g.beat, g.row, g.n || 0, g.dir || 0, g.type || '']; }), L.tokens.map(function (k) { return [k.row, k.col]; }), L.maxTokens, L.sections.map(function (s) { return [s.key, s.start, s.end]; })]));
}
// the level's own solution, played from the top (as test/forks.cjs plays it): how it ends
function plays(L, Core) {
  const run = new (Core || C).Run(L), plan = L.plan;
  run.reset(0);
  let i = 0, how = '';
  while (i < plan.length && plan[i].beat < run.beat) i++;
  for (let beat = run.beat; beat < L.totalBeats + 1 && !how; beat += 0.01) {
    while (i < plan.length && plan[i].beat <= beat && !how) { if (!run.tap(plan[i].dir, plan[i].beat).ok) how = 'a tap at beat ' + plan[i].beat + ' hit something'; i++; }
    run.advance(beat).forEach(function (ev) { if (ev.type === 'dead') how = how || 'died (' + ev.how + ') at beat ' + beat.toFixed(2) + ' in ' + L.sectionAt(beat).key; if (ev.type === 'win') how = 'win'; });
  }
  return how || 'never reached the bottom';
}
const madeV = C.MADE_V || 0, tag = madeV ? 'v' + madeV : 'before-versions', on = new Date().toISOString().slice(0, 10), coreNow = sha(fs.readFileSync(require.resolve(process.env.FFF_CORE || '../core.js')));
const arg = function (name) { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1] && process.argv[at + 1][0] !== '-' ? process.argv[at + 1] : ''; };
// (the stretches as the server hands them out: through JSON, as /api/world sends them)
const WORLDS = function () { const W = require('../worlds.js'), out = { city: { spec: null, L: C.buildLevel(C.specFor(0)) } }; Object.keys(W).forEach(function (id) { ['full', 'taste'].forEach(function (k) { const spec = JSON.parse(JSON.stringify(W[id][k])); out[id + '-' + k] = { spec: spec, L: C.buildLevel(spec) }; }); }); return out; };

if (arg('--capture') !== null) {
  const out = arg('--capture') || MADE, wrote = [], L7 = C.LOOKS;
  const DESIGNS = [
    { name: 'Pattern Alley', author: 'Fixture', world: 3, sections: [{ kind: 'patterns', beats: 24, speed: 8, pattern: 'LLRR-lr', look: L7[0] }, { kind: 'patterns', beats: 32, speed: 11, wide: false, pattern: 'lr-LR', saws: 2, look: L7[1] }] },
    { name: 'Gate Works', author: 'Fixture', world: 0, seed: 4242, sections: [{ kind: 'gates', beats: 48, speed: 10, taps: [0, 4], posts: 0.5, springs: 0.3, blowers: 0.3, thick: 0.5, saws: 3, bonus: true, look: L7[4] }, { kind: 'gates', beats: 32, speed: 13, wide: false, taps: [1, 2], look: L7[5] }] },
    { name: 'Slime Run', author: 'Fixture', world: 11, sections: [{ kind: 'slide', beats: 32, speed: 9, taps: [2, 4], bonus: true, look: L7[2] }, { kind: 'drop' }, { kind: 'slide', beats: 24, speed: 12, wide: false, posts: 0.6, saws: 2 }] },
    { name: 'The Maze', author: 'Fixture', world: 23, sections: [{ kind: 'maze', beats: 32, speed: 9, look: L7[3] }, { kind: 'drop' }, { kind: 'maze', beats: 48, speed: 12, look: L7[6] }] },
    { name: 'Everything, twice!', author: 'A. Maker-Jones', world: 17, seed: 12345, sections: [{ kind: 'patterns', beats: 16 }, { kind: 'gates', beats: 24 }, { kind: 'slide', beats: 24 }, { kind: 'maze', beats: 24 }, { kind: 'drop' }, { kind: 'patterns', beats: 16, pattern: 'lr-LR' },
      { kind: 'gates', beats: 32, wide: false }, { kind: 'slide', beats: 16 }, { kind: 'drop' }, { kind: 'maze', beats: 32 }, { kind: 'gates', beats: 24, bonus: true }, { kind: 'patterns', beats: 16, saws: 1 }, { kind: 'gates', beats: 16 }, { kind: 'drop' }, { kind: 'slide', beats: 16 }] },
    { name: 'Tiny', sections: [{ kind: 'gates', beats: 16 }] },
  ];
  fs.mkdirSync(out, { recursive: true });
  DESIGNS.forEach(function (d) {
    const spec = C.customLevel(d), file = path.join(out, tag + '-' + spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '.json');
    if (fs.existsSync(file)) return;
    // (the design on one line, exactly the text the server keeps in levels.spec)
    fs.writeFileSync(file, '{\n  "what": ' + JSON.stringify('A made level as the server keeps it (the design core.js customLevel() gave back), written by --capture.') + ',\n  "captured": ' + JSON.stringify({ made_v: madeV, core_js: coreNow, on: on }) + ',\n  "print": ' + JSON.stringify(print(C.buildLevel(C.customSpec(spec)))) + ',\n  "spec": ' + JSON.stringify(spec) + '\n}\n');
    wrote.push(path.basename(file));
  });
  console.log(wrote.length ? 'captured into ' + out + ': ' + wrote.join(', ') : 'nothing new to capture in ' + out + ' (a fixture that is there is never written over)');
  process.exit(0);
}
if (arg('--accept') !== null) {
  const out = arg('--accept') || DIR, now = WORLDS();
  fs.mkdirSync(path.join(out, 'worlds'), { recursive: true }); fs.mkdirSync(path.join(out, 'made'), { recursive: true });
  Object.keys(now).forEach(function (k) { fs.writeFileSync(path.join(out, 'worlds', k + '.json'), '{\n  "what": ' + JSON.stringify(k === 'city' ? 'The first level, as core.js builds it (specFor(0)).' : 'A paid level\'s stretches as /api/world hands them out (' + k + ').') + ',\n  "captured": ' + JSON.stringify({ world_v: C.WORLD_V || 0, core_js: coreNow, on: on }) + ',\n  "print": ' + JSON.stringify(print(now[k].L)) + ',\n  "spec": ' + JSON.stringify(now[k].spec) + '\n}\n'); });
  fs.readdirSync(MADE).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) { const x = JSON.parse(fs.readFileSync(path.join(MADE, f), 'utf8')); x.print = print(C.buildLevel(C.customSpec(x.spec))); fs.writeFileSync(path.join(out, 'made', f), '{\n  "what": ' + JSON.stringify(x.what) + ',\n  "captured": ' + JSON.stringify(x.captured) + ',\n  "print": ' + JSON.stringify(x.print) + ',\n  "spec": ' + JSON.stringify(x.spec) + '\n}\n'); });
  console.log('accepted into ' + out + ': the levels as they are now are what they have to stay');
  process.exit(0);
}

const WHY = '\n  If this was meant (the design was changed on purpose), say so: node test/fixtures.cjs --accept';
// ---- made levels, as they were kept ----
const files = fs.readdirSync(MADE).filter(function (f) { return /\.json$/.test(f); }).sort(), seen = { kinds: {}, looks: {}, v: {} }, kept = [];
files.forEach(function (f) {
  const x = JSON.parse(fs.readFileSync(path.join(MADE, f), 'utf8')), s = x.spec, v = s.v === undefined ? 'none' : s.v, say = function (m) { return f + ': ' + m; };
  assert.strictEqual(typeof x.what, 'string', say('says what it is')); assert(x.captured && x.captured.on, say('says when it was kept'));
  let L, again;
  try { L = C.buildLevel(C.customSpec(s)); again = C.customLevel(s); } catch (e) { assert.fail(say('NO LONGER BUILDS. core.js must go on reading what it kept (MADE_READS): ' + e.message)); }
  // read again (as the game reads the levels a player's device kept), it is the design that was kept
  assert.deepStrictEqual([again.name, again.author, again.world, again.seed, again.sections], [s.name, s.author, s.world, s.seed, s.sections], say('read again, it is the same design'));
  assert.strictEqual(L.sections.length, s.sections.length + 2, say('every stretch is laid, between the top and the bottom')); assert(L.plan.length > 0 && L.gates.length > 0 && L.totalBeats > 16 && L.maxTokens >= L.tokens.length, say('it has gates, taps and tokens'));
  assert.strictEqual(plays(L), 'win', say('its own solution clears it'));
  assert.strictEqual(print(L), x.print, say('IS NOT THE LEVEL IT WAS MADE AS: its gates, taps or tokens are laid differently by this core.js. Players made it, and their scores are on it.' + WHY));
  s.sections.forEach(function (q) { seen.kinds[q.kind] = 1; if (q.look) seen.looks[q.look] = 1; }); seen.v[v] = (seen.v[v] || 0) + 1; kept.push({ f: f, spec: s });
});
assert.deepStrictEqual(Object.keys(seen.kinds).sort(), C.KINDS.slice().sort(), 'a kept level with every kind of stretch'); assert.deepStrictEqual(Object.keys(seen.looks).sort(), C.LOOKS.slice().sort(), 'and every look');
C.MADE_READS.forEach(function (v) { assert(seen.v[v] >= 4, 'core.js reads version ' + v + ', so the levels kept as version ' + v + ' stay in test/fixtures/made (there are ' + (seen.v[v] || 0) + ')'); });
assert(seen.v.none >= 4, 'and the ones kept before designs had a version');
assert(C.MADE_READS.indexOf(C.MADE_V) >= 0 && C.WORLD_READS.indexOf(C.WORLD_V) >= 0 && C.MADE_READS.concat(C.WORLD_READS).every(function (v) { return v <= Math.max(C.MADE_V, C.WORLD_V); }), 'core.js reads the versions it writes, and nothing later');
assert.throws(function () { C.customSpec(Object.assign({}, kept[0].spec, { v: 99 })); }, /written as version 99, which this game cannot build: it builds version 1/, 'a design from a later game is refused in a sentence');
assert.throws(function () { C.customLevel(Object.assign({}, kept[0].spec, { v: 'constructor' })); }, /cannot build/);
console.log('OK fixtures, made: ' + files.length + ' made levels kept by earlier builds still build as the levels they were (every kind of stretch, every look; versions ' + Object.keys(seen.v).join(', ') + '), and each is cleared by its own solution');

// ---- the game's own levels ----
const now = WORLDS(), wfiles = fs.readdirSync(WORLD).filter(function (f) { return /\.json$/.test(f); }).sort();
assert.deepStrictEqual(wfiles.map(function (f) { return f.replace('.json', ''); }), Object.keys(now).sort(), 'test/fixtures/worlds has the first level and every paid level, whole and as a taste (write a new one with --accept)');
wfiles.forEach(function (f) {
  const x = JSON.parse(fs.readFileSync(path.join(WORLD, f), 'utf8')), k = f.replace('.json', ''), say = function (m) { return f + ': ' + m; };
  if (x.spec) {
    let L;
    try { C.readable(x.captured.world_v || undefined, C.WORLD_READS, 'this level'); L = C.buildLevel(x.spec); } catch (e) { assert.fail(say('THE STRETCHES AS THEY WERE HANDED OUT NO LONGER BUILD: ' + e.message)); }
    assert.strictEqual(plays(L), 'win', say('as it was handed out, its own solution clears it')); assert.strictEqual(print(L), x.print, say('as it was handed out, this core.js lays it differently.' + WHY));
  }
  assert.strictEqual(plays(now[k].L), 'win', say('as it is now, its own solution clears it'));
  assert.strictEqual(print(now[k].L), x.print, say('IS NOT THE LEVEL IT WAS: ' + (k === 'city' ? 'the first level' : k) + ' is laid differently by this build.' + WHY));
});
console.log('OK fixtures, worlds: the first level and ' + (wfiles.length - 1) + ' handed-out sets of stretches (ROCK BOTTOM whole, and its taste) build as the levels they were, and are cleared');

// ---- a page of the release that is live, still open: its builder, what this server hands it ----
if (!fs.existsSync(PREV)) console.log('   (no core.js of the deployed release is kept yet in test/fixtures/deployed: ./deploy.sh keeps one after each deploy. Until then nothing here builds this release\'s levels with the builder of the one before.)');
else {
  const P = require(PREV), W = require('../worlds.js');
  Object.keys(W).forEach(function (id) { ['full', 'taste'].forEach(function (k) {
    let L;
    try { L = P.buildLevel(JSON.parse(JSON.stringify(W[id][k]))); } catch (e) { assert.fail(id + ' (' + k + '): THE PAGE OF THE RELEASE THAT IS LIVE CANNOT BUILD WHAT THIS SERVER HANDS IT: ' + e.message + '\n  Write the new stretches as a new version (core.js WORLD_V) and keep handing the old page what it can build, or wait a release.'); }
    assert.strictEqual(plays(L, P), 'win', id + ' (' + k + '): built by the page of the release that is live, its own solution clears it');
  }); });
  kept.forEach(function (x) { let L; try { L = P.buildLevel(P.customSpec(x.spec)); } catch (e) { assert.fail(x.f + ': the page of the release that is live cannot build this made level: ' + e.message); } assert.strictEqual(plays(L, P), 'win', x.f + ': built by the page of the release that is live, it is cleared'); });
  console.log('OK fixtures, the release before: its builder builds and clears what this server hands out (ROCK BOTTOM whole and as a taste, ' + kept.length + ' made levels)');
}
console.log('OK fixtures');
