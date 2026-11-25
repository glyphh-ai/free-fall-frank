// The ROCK BOTTOM reel: nothing but that level, at insane speed, and its own music (the game's synth, rendered
// offline by rock-audio.mjs). Same shape and look as the `full` cut of cuts.mjs (a 9:16 phone, 405 x 720 at 2.667
// = 1080 x 1920, words at the BOTTOM only, a card at the end), with its own page (rock.html).
//
// All times are in beats. The level is written at 128 bpm and insane plays it 40% faster: 179.2 bpm.
//
// The music is ONE unbroken piece of the level's track: the level's beats `from` .. the bottom (620), then its
// ring-out. That is the last maze's final 16 beats (8 of its drive, then the 8-beat wind-up: riser and snare roll),
// the 48 beats of the finale (the loudest part, landing on a crash) and the 8 beats of the outro (bells), under the
// end card. The picture is cut to it on the bar: beat v of the video is beat from + v of the level's music.
//
//   clips: name, extra URL switches, the level's beat the clip starts on, how many beats it lasts
// Every clip starts on a bar of the level (a multiple of 4), so in every clip the gates land on the music's beats
// just as they do in the game. The last clip is the level's own last 8 beats before the bottom, exactly where the
// music is: there the picture and the track are the same moment of the game.
export const ROCK = {
  out: 'free-fall-frank-rock-bottom.mp4', cover: 'rock-bottom-cover.jpg', coverAt: 17, page: 'rock.html',
  size: [1080, 1920], view: [405, 720, 8 / 3], bpm: 128, speed: 1.4, set: { diff: 3 }, from: 548,
  clips: [
    ['jaws', '', 4, 8],            // THE JAWS: the spiked teeth, zigzag
    ['doors', '', 44, 4],          // THE BOILER ROOM: doors that swap on the beat
    ['slider', '', 144, 4],        // THE SLIDING SCALE: the gap that steps sideways
    ['lord', '', 284, 8],          // THE LANDLORD: the boss's volleys (on the music's drop)
    ['bats', '', 64, 4],           // THE BELFRY: bats in the gaps
    ['fire', '', 172, 4],          // THE FURNACE: fire coming up
    ['screw', '', 416, 8],         // THE CORKSCREW: the view turns right round
    ['cart', '', 520, 4],          // THE MINE CART: fire and stalactites, fast
    ['duck', '&secret=r7', 328, 4],// THE SHORTCUT: the swirl through the wall, and a secret: the rubber duck
    ['arch', '', 476, 4],          // THE WRONG WAY: the arch that swaps left and right
    ['grudge', '', 500, 4],        // THE GRUDGE: it grabs where he was
    ['finish', '', 604, 8],        // ROCK BOTTOM: everything at once, the last 8 beats to the bottom (in step with the track)
  ],
  // [from, to, clip] in beats of the video
  seg: [[0, 8, 'jaws'], [8, 12, 'doors'], [12, 16, 'slider'], [16, 24, 'lord'], [24, 28, 'bats'], [28, 32, 'fire'], [32, 40, 'screw'],
    [40, 44, 'cart'], [44, 48, 'duck'], [48, 52, 'arch'], [52, 56, 'grudge'], [56, 64, 'finish']],
  // the words: at the bottom, and never while something is down there (THE LANDLORD comes up from the bottom, and
  // the mine cart's warnings are marked on the bottom edge)
  lines: [[1, 12, 'ROCK BOTTOM'], [44.5, 55.5, 'NEW LEVEL']],
  title: '<small>FREE FALL FRANK</small>ROCK<br>BOTTOM', card: ['NEW LEVEL', ''], url: 'freefallfrank.com',
  end: 64, dur: 76,
};
