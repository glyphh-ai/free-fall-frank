// node test/rating.cjs : THE RATING OF A LEVEL (core.js rate): five tiers, worked out from a made level's design by
// plain arithmetic. This holds the rule to a table of designs (so a change to a number in it is seen and meant), to
// its own thresholds, and to being the same answer every time; and the game's own levels to the tiers they were given.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), C = require('../core.js');
assert.deepStrictEqual(C.TIERS, ['CHILL', 'TRICKY', 'TOUGH', 'BRUTAL', 'DEMON']); assert.deepStrictEqual(C.TIER_AT, [32, 42, 54, 66]);
const G = function (o) { return Object.assign({ kind: 'gates' }, o); }, P = function (o) { return Object.assign({ kind: 'patterns' }, o); }, DROP = { kind: 'drop' };
// [what it is, its stretches, the tier, the points]
const TABLE = [
  ['one gentle stretch of single taps', [P({ beats: 32, speed: 6, pattern: 'L-R-' })], 'CHILL', 10],
  ['the guide\'s easy start', [P({ beats: 16, speed: 8, pattern: 'LLRR' }), G({ beats: 24, taps: [1, 2], posts: 0 })], 'CHILL', 30],
  ['a maze at walking pace', [{ kind: 'maze', beats: 48, speed: 9 }], 'CHILL', 30],
  ['every setting left alone', [G({})], 'TRICKY', 38],
  ['easy, a breather, then harder', [P({ beats: 16, speed: 8, pattern: 'LLRR' }), DROP, G({ beats: 24, taps: [1, 2], bonus: true })], 'TRICKY', 32],
  ['four fast stretches', [G({ speed: 12, beats: 48 }), DROP, { kind: 'slide', speed: 12, beats: 48 }, { kind: 'maze', speed: 12, beats: 48 }, P({ speed: 12, beats: 48, pattern: 'lrLR' })], 'TOUGH', 53],
  ['fast, narrow, double taps and saws', [P({ speed: 12, beats: 64, pattern: 'lrlr', saws: 1, wide: false }), DROP, P({ speed: 11, beats: 64, pattern: 'lrLR', saws: 1 })], 'BRUTAL', 62],
  ['fast gates with posts and saws, then a narrow shaft', [G({ speed: 13, beats: 48, posts: 0.5, taps: [2, 4], saws: 2 }), DROP, G({ speed: 12, beats: 48, wide: false })], 'BRUTAL', 58],
  ['as fast as it goes, with everything on', [G({ speed: 14, beats: 64, posts: 0.6, taps: [2, 5], saws: 3 }), G({ speed: 14, beats: 64, posts: 0.9, taps: [3, 6], saws: 3, wide: false, thick: 0.9, springs: 0.5, blowers: 0.5 })], 'DEMON', 88],
];
TABLE.forEach(function (row) {
  const lv = C.customLevel({ name: 'Rated', sections: row[1] }), d = C.rate(lv);
  assert.deepStrictEqual([d.tier, d.points, d.level, d.of], [row[2], row[3], C.TIERS.indexOf(row[2]) + 1, 5], row[0] + ': ' + JSON.stringify(d));
  assert.deepStrictEqual(C.rate(lv), d, row[0] + ': the same answer every time'); assert.deepStrictEqual(C.rate(JSON.parse(JSON.stringify(lv))), d, row[0] + ': and from the design as it is kept');
  C.buildLevel(C.customSpec(lv));   // (and it is a level that builds)
});
// the thresholds themselves: a point under each is the tier below
const at = function (speed, pattern) { return C.rate({ sections: [{ kind: 'patterns', beats: 48, speed: speed, pattern: pattern }] }); };
const seen = {};
for (let speed = 5; speed <= 14; speed++) ['L---', 'L-R-', 'LRLR', 'lrLR', 'lrlr'].forEach(function (p) { const d = at(speed, p), want = 1 + C.TIER_AT.filter(function (a) { return d.points >= a; }).length; assert.strictEqual(d.level, want, speed + ' ' + p + ': ' + d.points + ' points is tier ' + want); seen[d.tier] = 1; });
assert(Object.keys(seen).length >= 4, 'the ladder of speeds and patterns climbs through the tiers: ' + Object.keys(seen).join(' '));
// harder settings never rate easier
let last = -1; for (let speed = 5; speed <= 14; speed++) { const p = C.rate({ sections: [G({ speed: speed })] }).points; assert(p > last, 'faster is more points'); last = p; }
assert(C.rate({ sections: [G({ posts: 0.9, saws: 3 })] }).points > C.rate({ sections: [G({ posts: 0, saws: 0 })] }).points && C.rate({ sections: [G({ wide: false })] }).points > C.rate({ sections: [G({})] }).points, 'more hazards and a narrow shaft are more points');
assert(C.rate({ sections: [G({ beats: 64 }), G({ beats: 64 }), G({ beats: 64 }), G({ beats: 64 })] }).points > C.rate({ sections: [G({ beats: 16 })] }).points, 'and so is a longer level');
// nothing senseless breaks it: it is asked about designs as they are kept, and about whatever a list holds
[null, {}, { sections: [] }, { sections: [null, { kind: 'loop' }, DROP] }].forEach(function (x) { const d = C.rate(x); assert(d.level >= 1 && d.level <= 5 && C.TIERS[d.level - 1] === d.tier, JSON.stringify(x)); });
// the game's own levels, rated by hand; and every level kept in test/fixtures/made has a rating
assert.deepStrictEqual([C.ratingOf({ id: 'city' }).tier, C.ratingOf({ id: 'rock' }).tier], ['TRICKY', 'DEMON']); assert(C.ratingOf({ id: 'rock' }).level > C.ratingOf({ id: 'city' }).level, 'ROCK BOTTOM is the hard one');
const made = path.join(__dirname, 'fixtures', 'made'), tiers = {};
fs.readdirSync(made).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) { const d = C.rate(JSON.parse(fs.readFileSync(path.join(made, f), 'utf8')).spec); assert(d.points > 0 && C.TIERS.indexOf(d.tier) === d.level - 1, f); tiers[d.tier] = (tiers[d.tier] || 0) + 1; });
console.log('OK rating: ' + TABLE.length + ' designs rate as the table says (CHILL to DEMON, by arithmetic, the same every time); the thresholds ' + C.TIER_AT.join(', ') + ' hold; faster, more hazards, narrower and longer never rate easier; ELM STREET is TRICKY and ROCK BOTTOM a DEMON; the kept levels: ' + Object.keys(tiers).map(function (k) { return tiers[k] + ' ' + k; }).join(', '));
