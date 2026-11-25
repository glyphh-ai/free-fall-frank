// Free Fall Frank: the game's own later levels, every stretch written out for core.js to build (spec.defs).
// This file stays on the server. A level here is paid for: the server hands its stretches only to an account that
// owns it (or the admin), and anyone else the taste: its first `taste` stretches, ending in a wall (server.js /api/world).
// What its look is called and painted with is in franks.js (FRANKS.worlds), which everyone gets.
//
// A stretch is what core.js's own SECTIONS are (rpb rows a beat, a gate every `every` beats, mode, taps) plus:
//   teeth: each gate of a pattern stretch is a tooth out of one wall        kinds: what each gate is, taken in turn
//     door1 a door that opens and shuts on the beat    door two doors that swap    slider a gap that steps sideways
//     key a lock, and a key only an early tumble reaches    warp a swirl to the other side    bat a wide gap, guarded
//     fire comes up where his tumble lands him    drip comes down where he was    volley a boss's fire    bar a plain gate
//   drift: a belt carrying him that way    wisps: how many circle beside him    grudge: [from, to] beats it hunts him
//   flips: [[from, to]] beats left and right are swapped    fork + lanes: a slide in two lanes    loop: the view turns right round
//   door: [lo, hi] columns the stretch has to be entered between    trail: tokens down an empty stretch
//   vary: the stretch's colours, as [hue turn, brightness, glow's hue turn] of the world's own    tip: one line, shown small at the top
// style is the music's part for the stretch (audio.js, the song named by spec.song); build: its last beats wind up into the next.
'use strict';

const OFF = { post: 0, thick: 0, blow: 0, spring: 0, portal: false, decoys: 0, loose: 0, saws: 0 };
const riff = function (o) { return Object.assign({ mode: 'rotate', riff: true, doubles: true, every: 1 }, OFF, o); };
const gated = function (o) { return Object.assign({ mode: 'rotate', every: 2, minTaps: 1, maxTaps: 2 }, OFF, o); };
const slide = function (o) { return Object.assign({ key: 'chute', name: 'THE LAUNDRY CHUTE', tip: 'HOLD ON', theme: 'chute', style: 'rush', mode: 'rotate', wide: true, beats: 8, rpb: 12, every: 4, minTaps: 0, maxTaps: 1 }, OFF, { loose: 1 }, o); };

const ROCK = [
  { key: 'top', name: 'THE TRAPDOOR', theme: 'street', style: 'intro', mode: 'rotate', beats: 4, rpb: 8, gatesAt: [3] },
  riff({ key: 'jaws', name: 'THE JAWS', tip: 'ZIGZAG BETWEEN THE TEETH', theme: 'jaws', vary: [0, 1, 0], style: 'pulse', teeth: true, pattern: 'lrlrLRlr', beats: 32, rpb: 8 }),
  gated({ key: 'boiler', name: 'THE BOILER ROOM', tip: 'THE DOORS SWAP ON THE BEAT', theme: 'boiler', vary: [24, 1.15, 16], style: 'drive', wide: true, beats: 24, rpb: 8,
    kinds: ['door1', 'door1', 'door', 'door', 'door', 'door', 'door', 'door', 'door', 'door', 'door'] }),
  // ---- the taste ends here ----
  gated({ key: 'belfry', name: 'THE BELFRY', tip: 'THE BAT KEEPS ITS END OF THE GAP', theme: 'belfry', vary: [-30, 0.9, -20], style: 'drive', wide: true, beats: 32, rpb: 8, maxTaps: 3, kinds: ['bar', 'bat'], post: 0.35, spring: 0.15 }),
  riff({ key: 'warren', name: 'THE WARREN', theme: 'warren', vary: [40, 1.1, 30], style: 'drive2', maze: true, wide: true, beats: 32, rpb: 9 }),
  slide({ build: 4 }),
  gated({ key: 'scale', name: 'THE SLIDING SCALE', tip: 'THE GAP STEPS SIDEWAYS: AIM AHEAD', theme: 'scale', vary: [70, 1.1, 50], style: 'drive', beats: 32, rpb: 8, kinds: ['slider'] }),
  gated({ key: 'furnace', name: 'THE FURNACE', tip: 'LET THE FIRE PASS, THEN GO', theme: 'furnace', vary: [-14, 0.8, -8], style: 'drive2', mode: 'slide', wide: true, beats: 32, rpb: 8, minTaps: 2, maxTaps: 4, kinds: ['bar', 'fire'], build: 8 }),
  gated({ key: 'locks', name: 'THE LOCKSMITH', tip: 'TUMBLE EARLY FOR THE KEY', theme: 'locks', vary: [100, 1.05, 80], style: 'drive', wide: true, beats: 32, rpb: 8, kinds: ['key', 'bar'] }),
  gated({ key: 'belt', name: 'THE CONVEYOR', tip: 'THE BELT CARRIES YOU: TAP AGAINST IT', theme: 'belt', vary: [150, 1, 120], style: 'drive2', mode: 'slide', wide: true, beats: 32, rpb: 8, drift: 1, build: 4 }),
  riff({ key: 'fork', name: 'THE FORK', tip: 'LEFT: RICH AND RISKY   RIGHT: SAFE', theme: 'chute', style: 'rush', maze: true, lanes: true, fork: 'rr-LR-LR-LR-ll', door: [9, 12], wide: true, beats: 16, rpb: 12, build: 8 }),
  gated({ key: 'lord', name: 'THE LANDLORD', tip: 'RENT IS DUE: STAND WHERE IT IS DARK', theme: 'lord', vary: [-60, 0.7, -40], style: 'drop', mode: 'slide', wide: true, beats: 32, rpb: 8, maxTaps: 4, kinds: ['volley'], boss: true }),
  { key: 'wait', name: 'THE WAITING ROOM', tip: 'BREATHE', theme: 'wait', vary: [180, 0.85, 150], style: 'break', mode: 'rotate', wide: true, beats: 16, rpb: 6, trail: true, build: 4 },
  gated({ key: 'short', name: 'THE SHORTCUT', tip: 'DEAD END: TAKE THE SWIRL', theme: 'short', vary: [210, 1.1, 180], style: 'drive', wide: true, beats: 24, rpb: 8, kinds: ['warp', 'bar'] }),
  gated({ key: 'drips', name: 'THE DRIPPING DARK', tip: 'IT FALLS WHERE YOU ARE: MOVE EARLY', theme: 'drips', vary: [-90, 0.85, -70], style: 'drive2', wide: true, beats: 32, rpb: 8, kinds: ['drip', 'bar'] }),
  riff({ key: 'well', name: 'THE WISP WELL', tip: 'KEEP CLEAR OF THE WISPS', theme: 'well', vary: [130, 0.95, 100], style: 'drive', wide: true, beats: 32, rpb: 8, wisps: 3, build: 4 }),
  slide({ key: 'screw', name: 'THE CORKSCREW', tip: 'ROUND YOU GO', beats: 16, loop: true }),
  riff({ key: 'cata', name: 'THE CATACOMBS', theme: 'cata', vary: [-120, 1, -90], style: 'drive2', maze: true, wide: true, beats: 40, rpb: 9 }),
  riff({ key: 'wrong', name: 'THE WRONG WAY', tip: 'THROUGH THE ARCH, LEFT IS RIGHT', theme: 'wrong', vary: [60, 0.9, 200], style: 'drive', teeth: true, pattern: 'lrLRlr', flips: [[8, 16]], beats: 24, rpb: 8 }),
  riff({ key: 'grudge', name: 'THE GRUDGE', tip: 'IT GRABS WHERE YOU WERE: KEEP MOVING', theme: 'grudge', vary: [-150, 0.75, -120], style: 'chase', wide: true, pattern: 'LLRLRRLR', grudge: [4, 20], beats: 24, rpb: 9 }),
  gated({ key: 'cart', name: 'THE MINE CART', tip: 'DODGE', theme: 'chute', style: 'rush', mode: 'slide', beats: 16, rpb: 12, maxTaps: 3, kinds: ['bar', 'fire', 'drip', 'fire'], build: 4 }),
  riff({ key: 'last', name: 'THE LAST MAZE', theme: 'last', vary: [20, 1.2, 240], style: 'drive2', maze: true, wide: true, beats: 32, rpb: 9, build: 8 }),
  gated({ key: 'rock', name: 'ROCK BOTTOM', tip: 'EVERYTHING AT ONCE', theme: 'rock', vary: [-10, 0.65, 0], style: 'finale', wide: true, beats: 48, rpb: 9, kinds: ['door', 'fire', 'key', 'bat', 'drip', 'slider', 'bar', 'warp'], post: 0.3 }),
  { key: 'bottom', name: 'THE STAIRS DOWN?', theme: 'sky', style: 'outro', mode: 'rotate', wide: true, beats: 8, rpb: 4 },
];
// the taste's last stretch: a short empty fall onto a wall that does not open
const WALL = { key: 'wall', name: 'THE REST IS LOCKED', theme: 'boiler', vary: [24, 1.15, 16], style: 'outro', mode: 'rotate', wide: true, beats: 4, rpb: 6, wall: true };

// The hidden things. kind: room (via a wall that is not there, or a block that is not one), spot (something to
// brush against), spin, gold (a set of golden tokens), clear (get to the bottom on that difficulty: 3 = insane).
// The ids are all the game and the server pass around: what each one is stays here.
const SECRETS = [
  { id: 'r1', kind: 'spot', sec: 'boiler', art: 'car', at: 6 },                    // a nod to level one: the car he drove up in, wedged in the pipes
  { id: 'r2', kind: 'spot', sec: 'belfry', art: 'cameo', at: 8 },                  // another Frank, on his lunch break
  { id: 'r3', kind: 'gold', sec: 'warren' },                                       // the golden tokens down the other way round the maze: the music changes
  { id: 'r4', kind: 'room', via: 'wall', sec: 'scale', look: 'bonus', name: 'THE BROOM CUPBOARD', at: 6 },
  { id: 'r5', kind: 'room', via: 'block', sec: 'locks', look: 'chute', name: 'THE SECRET SLIDE' },
  { id: 'r6', kind: 'spin', sec: 'wait' },                                         // something odd: spin four times in the waiting room
  { id: 'r7', kind: 'spot', sec: 'short', art: 'duck', at: 4 },                    // something silly: the rubber duck
  { id: 'r8', kind: 'clear', diff: 3 },                                            // for whoever clears it on insane
];

const spec = function (defs, secrets) { return { seed: 4242, bpm: 128, tr: 0, prog: 0, hook: 0, lead: 0, hard: 1, trait: 'mix', song: 'rock', defs: defs, secrets: secrets }; };
module.exports = {
  // n = the level's number where a Frank's number goes (runs, tokens): past the 24 Franks
  rock: {
    id: 'rock', n: 100, name: 'ROCK BOTTOM', secrets: SECRETS.map(function (s) { return s.id; }),
    full: spec(ROCK, SECRETS),
    taste: spec(ROCK.slice(0, 3).concat([WALL]), SECRETS.filter(function (s) { return ROCK.slice(0, 3).some(function (d) { return d.key === s.sec; }); })),
  },
};
