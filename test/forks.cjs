// The other way round every fork of a maze is a real path: play Frank's level with each fork's taps mirrored
// (left where the solution goes right, and back) and he must still get to the bottom. The same for the paid
// levels (worlds.js), whose slides fork too (two lanes): there every fork is also taken on its own, one at a time.
'use strict';
const C = require('../core.js'), WORLDS = require('../worlds.js');
// play the level's solution with the taps at these beats turned round: how it ends
function mirrored(L, flip) {
  const plan = L.plan.map(function (p) { return { beat: p.beat, dir: flip.has(p.beat.toFixed(3)) ? -p.dir : p.dir }; });
  const run = new C.Run(L);
  run.reset(0);
  let i = 0, how = '';
  while (i < plan.length && plan[i].beat < run.beat) i++;
  for (let beat = run.beat; beat < L.totalBeats + 1 && !how; beat += 0.01) {
    while (i < plan.length && plan[i].beat <= beat && !how) { if (!run.tap(plan[i].dir, plan[i].beat).ok) how = 'a tap at beat ' + plan[i].beat + ' hit something'; i++; }
    run.advance(beat).forEach(function (ev) { if (ev.type === 'dead') how = how || 'died (' + ev.how + ') at beat ' + beat.toFixed(2) + ' in ' + L.sectionAt(beat).key; if (ev.type === 'win') how = 'win'; });
  }
  return how || 'never reached the bottom';
}
const L = C.buildLevel(C.specFor(0));
const flip = new Set();
L.alts.forEach(function (sg) { flip.add(sg.a.toFixed(3)); flip.add(sg.b.toFixed(3)); });
const how = mirrored(L, flip);
const mazes = L.sections.filter(function (s) { return s.maze; }).length;
if (how !== 'win' || !flip.size || !mazes) { console.log('FAIL:', how, 'forks taps:', flip.size, 'mazes:', mazes); process.exit(1); }
console.log('OK: ' + mazes + ' mazes, ' + flip.size + ' mirrored taps, the other way round every fork reaches the bottom');

Object.keys(WORLDS).forEach(function (id) {
  const L2 = C.buildLevel(WORLDS[id].full), all = new Set(), bad = [];
  L2.forks.forEach(function (f, n) {
    const one = new Set(f.taps.map(function (p) { return p.beat.toFixed(3); }));
    one.forEach(function (b) { all.add(b); });
    const r = mirrored(L2, one);
    if (r !== 'win') bad.push('fork ' + n + ' in ' + L2.sections[f.si].key + ': ' + r);
  });
  const r = mirrored(L2, all), mz = L2.sections.filter(function (s) { return s.maze && !s.lanes; }), lanes = L2.sections.filter(function (s) { return s.lanes; });
  if (r !== 'win') bad.push('every fork at once: ' + r);
  mz.concat(lanes).forEach(function (s) { if (!L2.forks.some(function (f) { return L2.sections[f.si] === s; })) bad.push(s.key + ' has no fork'); });
  if (bad.length || mz.length < 3 || !lanes.length) { console.log('FAIL ' + id + ':', bad.join('; ') || 'too few mazes or no two-lane slide', 'mazes:', mz.length); process.exit(1); }
  console.log('OK ' + id + ': ' + mz.length + ' mazes and ' + lanes.length + ' two-lane slide, ' + L2.forks.length + ' forks (' + all.size + ' mirrored taps): the other way round each fork alone, and all of them at once, reaches the bottom');
});
