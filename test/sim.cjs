// Checks every Frank's level: the built-in solution wins (from the top and from every section), doing nothing
// loses, the solution picks up the tokens, tapping a gate's first tap too early dies on its post, and taking a
// portal goes through the bonus room and still wins.
const C = require('../core.js');
const FRANKS = 24;
let failed = false;
const fail = msg => { failed = true; console.log('FAIL ' + msg); };

// opts: bot (follow the solution), portal (index of a portal to take), early (gate whose first tap is made too early)
function play(level, si, opts, seed) {
  const run = new C.Run(level);
  run.reset(si);
  let beat = run.beat, pi = 0, j = seed, tookPortal = false, sawBonus = false;
  const portal = opts.portal === undefined ? null : level.portals[opts.portal];
  while (pi < level.plan.length && level.plan[pi].beat < beat) pi++;
  for (;;) {
    j = (j * 9301 + 49297) % 233280;
    beat += (1 / 60 + (j / 233280) * 0.02) * level.bpm / 60; // uneven frames
    if (opts.early && !opts.done && beat >= opts.early.at) { opts.done = true; if (!run.tap(opts.early.dir, beat).ok) return { res: 'bonk', beat: beat }; }
    if (opts.bot && !run.bonus && !opts.done) while (pi < level.plan.length && level.plan[pi].beat <= beat) {
      if (!run.tap(level.plan[pi].dir, level.plan[pi].beat).ok) return { res: 'bonk on tap at beat ' + level.plan[pi].beat + ' in ' + level.sectionAt(beat).name };
      pi++;
    }
    if (portal && !tookPortal && beat >= portal.tapBeat) { tookPortal = true; run.tap(portal.dir, beat); }
    for (const ev of run.advance(beat)) {
      if (ev.type === 'bonus') sawBonus = true;
      if (ev.type === 'bonusEnd') while (pi < level.plan.length && level.plan[pi].beat < beat) pi++;
      if (ev.type === 'dead') return { res: ev.how + ' at beat ' + beat.toFixed(2) + ' in ' + level.sectionAt(beat).name, beat: beat };
      if (ev.type === 'win') return { res: 'win', count: run.count, bonus: sawBonus };
    }
  }
}

const sum = { posts: 0, springs: 0, blowers: 0, saws: 0, portals: 0 };
for (let f = 0; f < FRANKS; f++) {
  let level;
  try { level = C.buildLevel(C.specFor(f)); } catch (e) { fail('frank ' + f + ': ' + e.message); continue; }
  level.sections.forEach((s, si) => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = play(level, si, { bot: true }, seed);
      if (r.res !== 'win') fail('frank ' + f + ' from ' + s.name + ' (seed ' + seed + '): ' + r.res);
    }
  });
  const full = play(level, 0, { bot: true }, 9);
  if (full.count < level.tokens.length * 0.8) fail('frank ' + f + ': the solution only picks up ' + full.count + ' of ' + level.tokens.length + ' tokens');
  if (play(level, 0, {}, 1).res === 'win') fail('frank ' + f + ': doing nothing wins');

  // too early: tap a posted gate's first tap before its "go" beat
  const posted = level.gates.filter(g => g.go);
  posted.slice(0, 6).forEach(g => {
    const r = play(level, 0, { bot: true, early: { at: g.go - 0.15, dir: g.dir } }, 3);
    if (r.res === 'win' || r.beat > g.beat - 0.05) fail('frank ' + f + ': tapping early at gate beat ' + g.beat + ' did not land him on the post (' + r.res + ')');
  });
  level.portals.forEach((p, i) => {
    const r = play(level, 0, { bot: true, portal: i }, 5);
    if (r.res !== 'win' || !r.bonus) fail('frank ' + f + ' portal ' + i + ': ' + r.res + (r.bonus ? '' : ' (never got into the bonus room)'));
  });

  sum.posts += posted.length; sum.springs += level.springs.length; sum.blowers += level.blowers.length; sum.saws += level.saws.length; sum.portals += level.portals.length;
  if (f < 3) console.log('frank ' + f + ': ' + level.sections.map(s => s.key).join(' > ') + '\n  gates ' + level.gates.length + ', taps ' + level.plan.length +
    ' (' + (level.plan.length / level.gates.length).toFixed(1) + ' per gate), ' + Math.round(level.totalBeats * 60 / level.bpm) + 's, tokens ' + full.count + '/' + level.tokens.length +
    ' (+' + (level.maxTokens - level.tokens.length) + ' in bonus rooms), posts ' + posted.length + ', springs ' + level.springs.length + ', blowers ' + level.blowers.length +
    ', saws ' + level.saws.length + ', portals ' + level.portals.length);
}
console.log('across all levels: ' + JSON.stringify(sum));
['posts', 'springs', 'blowers', 'saws', 'portals'].forEach(k => { if (sum[k] < FRANKS) fail('too few ' + k); });

// ---------- the paid levels (worlds.js): written out stretch by stretch ----------
// A simulated player clears each on every difficulty (easy and normal at the level's tempo, hard a fifth faster,
// insane 40% faster: the same frames, so more of the level goes by in each), from the top and from every stretch
// (easy restarts there); doing nothing loses; every hidden thing is found by playing what the level says finds it;
// and the taste, which is what anyone may play, ends at its wall.
const WORLDS = require('../worlds.js'), DIFFS = { easy: 1, normal: 1, hard: 1.2, insane: 1.4 };
// opts.add: taps to play as well as the solution's; opts.flip: beats of the solution's taps to turn round; opts.portal as above; opts.none: no taps at all
function play2(level, si, opts, seed, speed) {
  const run = new C.Run(level);
  run.reset(si);
  const flip = new Set((opts.flip || []).map(b => b.toFixed(3))), found = {};
  const plan = opts.none ? [] : level.plan.map(p => ({ beat: p.beat, dir: flip.has(p.beat.toFixed(3)) ? -p.dir : p.dir })).concat(opts.add || []).sort((a, b) => a.beat - b.beat);
  const portal = opts.portal === undefined ? null : level.portals[opts.portal];
  let beat = run.beat, pi = 0, j = seed, took = false;
  while (pi < plan.length && plan[pi].beat < beat) pi++;
  for (;;) {
    j = (j * 9301 + 49297) % 233280;
    beat += (1 / 60 + (j / 233280) * 0.02) * level.bpm * speed / 60; // uneven frames, at the difficulty's speed
    if (!run.bonus) while (pi < plan.length && plan[pi].beat <= beat) { if (!run.tap(plan[pi].dir, plan[pi].beat).ok) return { res: 'bonk on tap at beat ' + plan[pi].beat + ' in ' + level.sectionAt(beat).name, found }; pi++; }
    if (portal && !took && beat >= portal.tapBeat) { took = true; run.tap(portal.dir, beat); }
    for (const ev of run.advance(beat)) {
      if (ev.type === 'secret') found[ev.id] = true;
      if (ev.type === 'bonusEnd') while (pi < plan.length && plan[pi].beat < beat) pi++;
      if (ev.type === 'dead') return { res: ev.how + ' at beat ' + beat.toFixed(2) + ' in ' + level.sectionAt(beat).name, found, count: run.count };
      if (ev.type === 'win') return { res: 'win', count: run.count, found };
    }
  }
}
Object.keys(WORLDS).forEach(id => {
  const W = WORLDS[id], level = C.buildLevel(W.full), taste = C.buildLevel(W.taste), again = C.buildLevel(W.full);
  if (JSON.stringify(level.plan) !== JSON.stringify(again.plan) || JSON.stringify([...level.solids]) !== JSON.stringify([...again.solids])) fail(id + ': built twice, it is not the same level');
  Object.keys(DIFFS).forEach(d => {
    let wins = 0, runs = 0;
    for (let seed = 1; seed <= 3; seed++) { runs++; const r = play2(level, 0, {}, seed, DIFFS[d]); if (r.res === 'win') wins++; else fail(id + ' on ' + d + ' (seed ' + seed + '): ' + r.res); }
    level.sections.forEach((s, si) => { if (!si) return; runs++; const r = play2(level, si, {}, 2, DIFFS[d]); if (r.res === 'win') wins++; else fail(id + ' on ' + d + ' from ' + s.name + ': ' + r.res); });
    const t = play2(taste, 0, {}, 1, DIFFS[d]);
    if (t.res !== 'win') fail(id + ' taste on ' + d + ': ' + t.res);
    console.log(id + ' on ' + d + ' (x' + DIFFS[d] + ', ' + Math.round(level.bpm * DIFFS[d]) + ' bpm, ' + Math.round(level.totalBeats * 60 / level.bpm / DIFFS[d]) + 's): cleared ' + wins + ' of ' + runs + ' runs (3 from the top, one from each of ' + (level.sections.length - 1) + ' stretches); taste ' + t.res);
  });
  const full = play2(level, 0, {}, 9, 1);
  if (full.count < level.tokens.length * 0.8) fail(id + ': the solution only picks up ' + full.count + ' of ' + level.tokens.length + ' tokens');
  if (play2(level, 0, { none: true }, 1, 1).res === 'win') fail(id + ': doing nothing wins');
  if (Object.keys(full.found).length) fail(id + ': the plain solution stumbles on hidden things: ' + Object.keys(full.found));
  // every hidden thing the level was asked for is in it, and what the level says finds it does (on normal and on insane)
  if (level.secrets.length !== W.secrets.length || level.secrets.length < 8) fail(id + ': ' + level.secrets.length + ' of ' + W.secrets.length + ' hidden things were placed');
  level.secrets.forEach(s => {
    if (s.how.win !== undefined) { if (!(s.how.win >= 0 && s.how.win <= 3)) fail(id + ' secret ' + s.id + ': no such difficulty'); return; }   // given for clearing it on that difficulty: game.js
    [1, 1.4].forEach(sp => { const r = play2(level, 0, s.how, 2, sp); if (r.res !== 'win' || !r.found[s.id] || Object.keys(r.found).length !== 1) fail(id + ' secret ' + s.id + ' (' + s.kind + ') at x' + sp + ': ' + r.res + ', found ' + (Object.keys(r.found).join() || 'nothing')); });
  });
  const tasteFound = taste.secrets.filter(s => s.how.win === undefined).map(s => { const r = play2(taste, 0, s.how, 2, 1); return r.res === 'win' && r.found[s.id]; });
  if (tasteFound.some(x => !x)) fail(id + ': a hidden thing in the taste cannot be found');
  const kinds = {}, foes = {};
  level.gates.forEach(g => { if (g.type) kinds[g.type] = (kinds[g.type] || 0) + 1; });
  level.foes.forEach(f => { foes[f.kind] = (foes[f.kind] || 0) + 1; });
  ['tooth', 'door', 'slider', 'key', 'warp', 'bat', 'fire', 'drip', 'volley'].forEach(k => { if (!kinds[k]) fail(id + ': no ' + k + ' gates'); });
  ['bat', 'fire', 'drip', 'wisp'].forEach(k => { if (!foes[k]) fail(id + ': no ' + k); });
  if (!level.winds.length || !level.grudges.length || !level.mirrors.length || !level.volleys.length) fail(id + ': a belt, a grudge, a swap or a boss is missing');
  if (level.sections.filter(s => s.maze && !s.lanes).length < 3) fail(id + ': fewer than three mazes');
  console.log(id + ': ' + level.sections.length + ' stretches, ' + level.totalBeats + ' beats, ' + Math.round(level.totalBeats * 60 / level.bpm) + 's at ' + level.bpm + ' bpm, gates ' + level.gates.length + ' ' + JSON.stringify(kinds) +
    ', taps ' + level.plan.length + ', tokens ' + full.count + '/' + level.tokens.length + ' (most ' + level.maxTokens + '), foes ' + JSON.stringify(foes) + ', volleys ' + level.volleys.length + ', keys ' + level.keys.length +
    ', swirls ' + level.warps.length + ', forks ' + level.forks.length + ', hidden things found by play ' + level.secrets.filter(s => s.how.win === undefined).length + ' + 1 for clearing it on insane; taste ' + taste.totalBeats + ' beats (' + Math.round(taste.totalBeats * 60 / taste.bpm) + 's)');
});
console.log(failed ? 'FAILED' : 'OK: ' + FRANKS + ' levels');
process.exit(failed ? 1 : 0);
