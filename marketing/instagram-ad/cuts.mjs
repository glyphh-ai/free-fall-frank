// The ads, as cuts of the same reel: which gameplay clips to record, when each is in the phone, and what the
// headline says over it. Times in seg, heads, end and dur are in beats of the cut's own tempo (bpm).
//
//   clips: name, the game's URL switches, seconds played before the clip starts, clip length in seconds
//   set:   the game's settings while recording (diff 3 = insane, which plays everything 40% faster)
//   rate:  how much faster than recorded the track plays, to match
export const CUTS = {
  // the first ad: what the game is, at its normal speed
  classic: {
    out: 'free-fall-frank-ad.mp4', cover: 'cover.jpg', coverAt: 20.6, bpm: 100, rate: 1, set: {},
    clips: [
      ['start', 'bot&mute&frank=0', 0.2, 4.9],          // down the manhole and into the first patterns
      ['riff', 'bot&mute&frank=0&at=2', 1.5, 3.7],      // the fast left/right stretch
      ['maze', 'bot&mute&frank=0&at=5', 1.5, 3.7],      // the maze: paths that fork and join
      ['pick', 'mute&screen=select&frank=0', 0.2, 1.3], // the row of Franks
      ['grill', 'bot&mute&frank=1&at=3', 1.7, 1.3],     // other Franks in the same fall: Frankfurter in the slime,
      ['frost', 'bot&mute&frank=12&at=7', 1.7, 1.3],    // Frost Frank on the neon grid,
      ['lava', 'bot&mute&frank=13&at=10', 1.7, 1.3],    // Lava Frank near the bottom
      ['splat', 'mute&frank=0', 1.3, 1.9],              // nobody tapping: he lands on the first gate
    ],
    seg: [[0, 8, 'start'], [8, 14, 'riff'], [14, 20, 'maze'], [20, 22, 'pick'], [22, 24, 'grill'], [24, 26, 'frost'], [26, 28, 'lava'], [28, 31, 'splat']],
    heads: [
      [0, 8, 'Free Fall Frank', 'Meet Frank.<br>He keeps falling.'],
      [8, 14, 'Tap left. Tap right.', 'Tumble him<br>through the gaps.'],
      [14, 20, 'Then the maze', 'The paths fork.<br>Pick one. Fast.'],
      [20, 28, '24 Franks', 'Pick your Frank.<br>Unlock them all.'],
      [28, 31, 'One touch', 'And it’s back<br>to the top.'],
    ],
    end: 31, dur: 37, dead: 'splat',
  },
  // the second ad: nothing but play, at insane speed, cut fast: the opening, the patterns, the maze, a run of
  // Franks each in a different stretch of the fall, the bottom, and the splat
  insane: {
    out: 'free-fall-frank-insane.mp4', cover: 'cover-insane.jpg', coverAt: 3.2, bpm: 140, rate: 1.4, set: { diff: 3 }, badge: 'INSANE MODE',
    clips: [
      ['start', 'bot&mute&frank=0', 0.15, 3.5],
      ['riff', 'bot&mute&frank=0&at=2', 1.1, 3.5],
      ['maze', 'bot&mute&frank=0&at=5', 1.2, 3.5],
      ['pick', 'mute&screen=select&frank=0', 0.2, 0.9],
      ['slime', 'bot&mute&frank=1&at=3', 1.6, 0.9],     // Frankfurter sliding through the sewer
      ['saws', 'bot&mute&frank=12&at=7', 2.2, 0.9],     // Frost Frank on the neon grid
      ['maze2', 'bot&mute&frank=13&at=8', 1.6, 0.9],    // Lava Frank in the second maze
      ['slide', 'bot&mute&frank=5&at=9', 1.0, 0.9],     // down the fast slide
      ['core', 'bot&mute&frank=20&at=10', 1.4, 0.9],    // near the bottom
      ['deep', 'bot&mute&frank=0&at=10', 3.2, 2.7],     // Frank himself, the last stretch
      ['splat', 'mute&frank=0', 0.6, 1.8],
    ],
    seg: [[0, 8, 'start'], [8, 16, 'riff'], [16, 24, 'maze'], [24, 26, 'pick'], [26, 28, 'slime'], [28, 30, 'saws'], [30, 32, 'maze2'], [32, 34, 'slide'], [34, 36, 'core'], [36, 42, 'deep'], [42, 46, 'splat']],
    heads: [
      [0, 8, 'Insane mode', 'Frank falls.<br>40% faster.'],
      [8, 16, 'Left. Right. Left.', 'Keep up<br>with the beat.'],
      [16, 24, 'The maze', 'The paths fork.<br>Pick one. Now.'],
      [24, 36, '24 Franks', 'Swap your Frank.<br>Same fall.'],
      [36, 42, 'Slime. Saws. Springs.', 'It only gets<br>deeper.'],
      [42, 46, 'One touch', 'Back to<br>the top.'],
    ],
    end: 46, dur: 54, dead: 'splat',
  },
  // The third ad, for Reddit, wide: the Claude side. A chat on the left in which a player asks Claude for a level
  // and a Frank, with the connector's real tool names and the level's real numbers; on the right the game, playing
  // exactly what was asked for. `made` is the level and the Frank the chat asks for: the game is handed them when
  // recording (as its server would), and the numbers shown come from building that level with the game's own
  // builder (render.mjs). chat: [beat, who, text, typed over how many beats]; tool rows are [beat, 'tool', name, what it answered].
  claude: {
    out: 'free-fall-frank-claude.mp4', cover: 'cover-claude.jpg', coverAt: 14.5, page: 'claude.html', size: [1920, 1080], bpm: 96, rate: 1, set: {},
    track: '../../music/13.mp3', first: 0.023,
    made: {
      level: { id: 'lavarun', name: 'Lava Run', author: 'Chris', world: 13, sections: [{ kind: 'patterns', beats: 16, speed: 8, pattern: 'LR-LR-' }, { kind: 'patterns', beats: 16, speed: 9, pattern: 'LLRR' }, { kind: 'drop' },
        { kind: 'maze', beats: 24, speed: 10 }, { kind: 'gates', beats: 24, speed: 11, taps: [1, 3], posts: 0.4, saws: 2, bonus: true }, { kind: 'drop' }, { kind: 'patterns', beats: 24, speed: 12, pattern: 'LRLRllrr', look: 'core' }] },
      frank: { id: 'fpirate', name: 'PIRATE FRANK', head: '#e8b88a', torso: '#c0392b', legs: '#1b1b1b', hair: '#3d2a1c', hat: 'cowboy', extra: 'patch' },
    },
    clips: [
      ['city', 'bot&mute&frank=0', 0.2, 7.0],                              // the game as it is
      ['card', 'mute&level=lavarun', 0.5, 2.6, { still: true }],           // the new level on the main page
      ['lava', 'bot&mute&level=lavarun', 0.3, 5.1],                        // and played
      ['pirate', 'bot&mute&level=lavarun&frank=fpirate&at=4', 1.3, 6.4],   // the new Frank, in its maze
      ['finish', 'bot&mute&level=lavarun&frank=fpirate&at=7', 1.3, 5.1],   // and its brutal finish
    ],
    seg: [[0, 11, 'city'], [11, 15, 'card'], [15, 23, 'lava'], [23, 33, 'pirate'], [33, 41, 'finish']],
    heads: [
      [0, 6, 'Free Fall Frank + Claude', 'Players build the levels.<br>By asking Claude.'],
      [6, 17, 'Ask for a level', 'Describe it.<br>Claude builds it.'],
      [17, 27, 'Ask for a character', 'A Frank<br>of your own.'],
      [27, 41, 'Share it', 'A link. A leaderboard.<br>A public list.'],
    ],
    chat: [
      [2, 'you', 'Make me a Free Fall Frank level called Lava Run. About a minute, starts easy, a maze in the middle, brutal finish.', 4.5],
      [7.2, 'tool', 'how_levels_work', 'the rules, the five kinds of stretch, 24 worlds'],
      [8.4, 'tool', 'preview_level', '{stats}'],
      [9.8, 'tool', 'publish_level', 'saved, with a link and a leaderboard'],
      [11, 'claude', 'Lava Run is live: two pattern stretches to warm up, a drop, a maze, gates with saws, then a fast finish. Here is your link.', 3],
      [17, 'you', 'Now make me a Frank. A pirate: red shirt, eye patch, cowboy hat.', 2.6],
      [20.2, 'tool', 'create_frank', 'PIRATE FRANK, with a link'],
      [21.4, 'claude', 'Pirate Frank is yours. Open his link and he is in your Franks.', 2],
      [27, 'you', 'Put Lava Run on the public list.', 1.6],
      [29.2, 'tool', 'submit_level', 'waiting for review'],
      [30.4, 'claude', 'Sent. Once it is approved, every player can find it, and its leaderboard is already running.', 2.6],
    ],
    end: 41, dur: 50,
  },
};
// The fourth ad: nothing but the game, the whole height of a phone, and the game's own music, all of it fast:
// insane speed, cut quickly from one flashy stretch to the next (the riffs, the mazes, the slime, the saws, the
// slide), with the made level (Lava Run) and the made Frank (Pirate Frank) among them. Recorded at the reel's own
// shape (view: a 9:16 phone, 405 x 720 at 2.667 = 1080 x 1920). Two lines of words, kept at the BOTTOM so they
// never cover Frank, and a card at the end (full.html).
CUTS.full = {
  out: 'free-fall-frank-full.mp4', cover: 'cover-full.jpg', coverAt: 5, page: 'full.html', size: [1080, 1920], view: [405, 720, 8 / 3], bpm: 134.4, rate: 1.4, set: { diff: 3 },
  track: '../../music/13.mp3', first: 0.023, made: CUTS.claude.made, look: 'frank',
  clips: [
    ['start', 'bot&mute&frank=0', 0.15, 3.7],                              // down the manhole, into the first patterns
    ['riff', 'bot&mute&frank=0&at=2', 1.1, 3.7],                           // the fast left/right stretch
    ['maze', 'bot&mute&frank=0&at=5', 1.2, 3.7],                           // the maze
    ['lava', 'bot&mute&level=lavarun', 0.3, 2.8],                          // a level a player made
    ['pirate', 'bot&mute&level=lavarun&frank=fpirate&at=4', 1.3, 3.7],     // a Frank a player made, in its maze
    ['finish', 'bot&mute&level=lavarun&frank=fpirate&at=7', 1.3, 2.8],     // and its finish
    ['slime', 'bot&mute&frank=1&at=3', 1.6, 1.9],                          // Frankfurter sliding through the sewer
    ['saws', 'bot&mute&frank=12&at=7', 2.2, 1.9],                          // Frost Frank among the saws
    ['maze2', 'bot&mute&frank=13&at=8', 1.6, 1.9],                         // Lava Frank in the second maze
    ['slide', 'bot&mute&frank=5&at=9', 1.0, 1.9],                          // down the fast slide
    ['core', 'bot&mute&frank=20&at=10', 1.4, 1.9],                         // near the bottom
    ['deep', 'bot&mute&frank=0&at=10', 3.2, 2.8],                          // Frank himself, the last stretch
  ],
  seg: [[0, 8, 'start'], [8, 16, 'riff'], [16, 24, 'maze'], [24, 30, 'lava'], [30, 38, 'pirate'], [38, 44, 'finish'], [44, 48, 'slime'], [48, 52, 'saws'], [52, 56, 'maze2'], [56, 60, 'slide'], [60, 64, 'core'], [64, 70, 'deep']],
  lines: [[2, 15, 'PLAY ONLINE FREE'], [25, 43, 'BUILD YOUR OWN LEVELS AND FRANKS']],
  title: '<small>FREE FALL</small>FRANK', card: ['Play online free.', 'Build your own levels and Franks.'], url: 'freefallfrank.com',
  end: 70, dur: 79,
};
