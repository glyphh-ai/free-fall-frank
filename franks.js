// Every Frank: name, his level, head, torso, legs, hair/hat colour, hat, extras, and the tokens his level drops
// (name, shape, colour). Tokens from every level go into one wallet and earn new Franks.
// Shared by the game (drawing, picker) and the server (what is for sale). The order is the Frank's id: never reorder.
(function (root) {
  'use strict';
  const FRANKS = [
    ['FRANK', 'Elm Street Sewers', '#ffd23f', '#23d5d5', '#3b3f8f', '#ff7b00', 'tuft', '', 'COINS', 'coin', '#ffd23f'],
    ['FRANKFURTER', 'The Grill Pit', '#d9482b', '#d9482b', '#c23d22', '#f2c14e', 'none', 'bun mustard', 'MUSTARD', 'gem', '#ffd23f'],
    ['FRANKENFRANK', 'The Lab Drain', '#8fd16a', '#4a4a5e', '#2e2e3d', '#1b1b1b', 'flat', 'bolts', 'SPARKS', 'bolt', '#b6ff5c'],
    ['TANK FRANK', 'Boot Camp Bunker', '#e8c39e', '#5d7a3a', '#3f5527', '#4b6130', 'helmet', '', 'MEDALS', 'star', '#f2c14e'],
    ['PRANK FRANK', 'The Funhouse', '#fff3e0', '#ff4fd8', '#ffd23f', '#35e8ff', 'afro', 'nose', 'BALLOONS', 'coin', '#ff3d3d'],
    ['BANK FRANK', 'The Vault', '#f1c9a5', '#2b2b3a', '#1c1c28', '#15151f', 'tophat', 'tie', 'BILLS', 'bill', '#5fd17a'],
    ['PLANK FRANK', 'The Lumber Chute', '#c98d4f', '#b57a3c', '#a06a30', '#6d4420', 'none', 'grain', 'ACORNS', 'gem', '#c98d4f'],
    ['BLANK FRANK', 'The White Void', '#f4f4f4', '#e6e6e6', '#d8d8d8', '#ffffff', 'none', 'blank', 'DOTS', 'coin', '#ffffff'],
    ['STANK FRANK', 'The Dumpster Deep', '#a8b545', '#7a6a3a', '#5a4d28', '#5d8a2a', 'tuft', 'flies', 'BOTTLE CAPS', 'ring', '#b8c0cc'],
    ['CRANK FRANK', 'The Gearworks', '#b8c0cc', '#8791a1', '#5d6675', '#ff4f6d', 'antenna', 'visor', 'GEARS', 'star', '#b8c0cc'],
    ['SWANK FRANK', 'The Penthouse Lift', '#f1c9a5', '#f4f4f4', '#15151f', '#3a2a1a', 'flat', 'bowtie', 'DIAMONDS', 'gem', '#7fe9ff'],
    ['DANK FRANK', 'The Swamp Pipe', '#6fbf73', '#3f8f5a', '#2a6a45', '#a6ff3d', 'tuft', '', 'LILY PADS', 'coin', '#a6ff3d'],
    ['FROST FRANK', 'The Ice Shaft', '#cfeeff', '#5aa9e6', '#2f6fb0', '#ffffff', 'beanie', '', 'SNOWFLAKES', 'star', '#ffffff'],
    ['LAVA FRANK', 'The Volcano Vent', '#ffb347', '#e8452c', '#8a1f14', '#ffe93d', 'mohawk', '', 'EMBERS', 'gem', '#ff7b00'],
    ['DISCO FRANK', 'Club Down Under', '#c68642', '#b13dff', '#ffffff', '#2a1a12', 'afro', '', 'RECORDS', 'ring', '#ff3df2'],
    ['ASTRO FRANK', 'The Airlock', '#f4f4f4', '#e0e4ea', '#c3c9d3', '#ff7b00', 'helmet', 'visor', 'STARS', 'star', '#ffe93d'],
    ['NINJA FRANK', 'The Dojo Well', '#22222c', '#22222c', '#17171f', '#ff3d3d', 'band', '', 'THROWING STARS', 'star', '#c9ccd6'],
    ['PIRATE FRANK', 'The Bilge', '#e8b88a', '#f4f4f4', '#3a2a5a', '#d9302b', 'band', 'patch', 'DOUBLOONS', 'coin', '#f2c14e'],
    ['CHEF FRANK', 'The Dumbwaiter', '#f1c9a5', '#ffffff', '#44444f', '#ffffff', 'chef', '', 'DONUTS', 'ring', '#ff7ac8'],
    ['COWBOY FRANK', 'The Mine Shaft', '#e8b88a', '#c0572f', '#3b5a9a', '#7a4a22', 'cowboy', '', 'NUGGETS', 'gem', '#f2c14e'],
    ['WIZARD FRANK', 'The Bottomless Tower', '#f1c9a5', '#6a2a9c', '#4a1a7a', '#7a35b0', 'wizard', '', 'SPELLS', 'bolt', '#c77dff'],
    ['KING FRANK', 'The Royal Oubliette', '#f1c9a5', '#c0392b', '#6a1b1b', '#ffd23f', 'crown', '', 'RUBIES', 'gem', '#ff3d5a'],
    ['PUNK FRANK', 'The Subway', '#f1c9a5', '#1b1b1b', '#3a3a8a', '#ff3df2', 'mohawk', '', 'TICKETS', 'bill', '#ff3df2'],
    ['GHOST FRANK', 'The Other Side', '#f4f8ff', '#e6eeff', '#d0dcff', '#ffffff', 'none', 'ghost', 'SOULS', 'ring', '#bfe3ff'],
  ].map(function (f) {
    return { name: f[0], world: f[1], head: f[2], torso: f[3], legs: f[4], hair: f[5], hat: f[6], extra: f[7], token: f[8], tokenShape: f[9], tokenColor: f[10] };
  });

  // Each Frank's world, in the same order. His level is built from it: its colours, what is behind him at the
  // top (sky, silhouette, ground), the pattern in the background (decor), what the blocks are made of, the word
  // for why he cannot tumble (slick) and for what blows him about (gust), the name of every stretch of the
  // level, and what happens to him at the bottom.
  // names: top | hole | shaft | sewer | vents | grid | storm | core | slide | bottom
  const WORLDS = [
    ['#15131f', '#454066', '#35e8ff', '#2a1a4a', '#160d2e', '#4a4a5e', 'buildings', 'bricks', 'plain', 'SLIMY', 'WIND',
      'ELM STREET|THE MANHOLE|THE SHAFT|THE SEWER|THE VENTS|NEON GRID|STORM DRAIN|THE CORE|THE SLIDE|DAYLIGHT?', 'fell out of the bottom of the world. Typical.'],
    ['#2a0f08', '#8a3b1c', '#ffb000', '#f29d52', '#7a3b1e', '#3d7a2e', 'fence', 'embers', 'food', 'GREASY', 'SMOKE',
      'THE COOKOUT|THE GRILL GRATE|THE CHIMNEY|THE GREASE TRAP|THE EXTRACTOR FAN|THE HOT COALS|THE SMOKER|THE FIRE PIT|KETCHUP SLIDE|THE BUN?', 'landed in a bun. Lunch is served.'],
    ['#0f1a12', '#3f5a45', '#b6ff5c', '#1b1030', '#0c0818', '#3a3a44', 'pillars', 'gears', 'metal', 'GOOEY', 'STATIC',
      'THE CASTLE LAB|THE DRAIN|THE WIRING|THE SPECIMEN TANK|THE TESLA COILS|THE CIRCUIT|THE LIGHTNING ROD|THE REACTOR|THE CHUTE OF DOOM|IT IS ALIVE?', 'is alive. Sadly, so is the villager mob.'],
    ['#141a0e', '#55683a', '#d9e04a', '#8fb0c9', '#3f5527', '#6b5a3a', 'tents', 'camo', 'metal', 'MUDDY', 'ROTOR WASH',
      'BOOT CAMP|THE FOXHOLE|THE TRENCH|THE MUD PIT|THE ROTOR WASH|THE MINEFIELD|THE AIR RAID|THE BUNKER|THE ZIP LINE|AT EASE?', 'forgot his parachute. Drop and give me twenty.'],
    ['#2a0a2e', '#c0399a', '#ffe93d', '#3a1458', '#ff4f6d', '#ffd23f', 'tents', 'confetti', 'stripes', 'SOAPY', 'WHOOPEE',
      'THE BIG TOP|THE TRAPDOOR|THE HALL OF MIRRORS|THE BALL PIT|THE WHOOPEE WIND|THE FUNHOUSE|THE PIE STORM|THE CLOWN CAR|THE HELTER SKELTER|TA-DA?', 'landed on a whoopee cushion. The crowd goes mild.'],
    ['#0e1418', '#3c4a52', '#5fd17a', '#1c2a3a', '#0c141c', '#55606a', 'buildings', 'bars', 'gold', 'POLISHED', 'AIR CON',
      'WALL STREET|THE NIGHT DEPOSIT|THE ELEVATOR SHAFT|THE COIN CHUTE|THE AIR CON|THE LASER GRID|THE PAPER STORM|THE VAULT|THE GOLDEN PARACHUTE|THE CAYMANS?', 'hit rock bottom. The market follows.'],
    ['#1f140a', '#8a5a2e', '#ffb347', '#9fd0e8', '#2f5a2a', '#6d4420', 'trees', 'planks', 'wood', 'SAPPY', 'SAWDUST',
      'THE TREE LINE|THE KNOTHOLE|THE TRUNK|THE SAP RUN|THE SAWDUST BLOWER|THE LUMBER YARD|THE WOOD CHIPPER|THE HEARTWOOD|THE LOG FLUME|FIREWOOD?', 'is now a coffee table.'],
    ['#d6d6dc', '#9a9aa6', '#15151f', '#f4f4f6', '#c9c9d2', '#9a9aa6', 'none', 'void', 'plain', 'BLANK', 'DRAFT',
      'PAGE ONE|THE MARGIN|THE COLUMN|THE WHITE-OUT|THE DRAFT|THE GRID PAPER|THE SHREDDER|THE FINE PRINT|THE SCROLL|THE END?', 'fell off the page.'],
    ['#161a0a', '#5a5a2a', '#a8d545', '#3a3a2a', '#1b1b12', '#44443a', 'buildings', 'bubbles', 'stone', 'SLIMY', 'STINK',
      'THE BACK ALLEY|THE DUMPSTER|THE GARBAGE CHUTE|THE BIN JUICE|THE FART CLOUD|THE RECYCLING|THE STINK STORM|THE LANDFILL|THE TRASH SLIDE|FRESH AIR?', 'reached the bottom of the bin. He smells the same.'],
    ['#14161c', '#5d6675', '#ff4f6d', '#2a2e3a', '#14161c', '#5d6675', 'pillars', 'gears', 'metal', 'OILY', 'STEAM',
      'THE FACTORY FLOOR|THE HATCH|THE PISTON SHAFT|THE OIL SUMP|THE TURBINE|THE GEAR TRAIN|THE STEAM BURST|THE MAINSPRING|THE CONVEYOR|SCRAP HEAP?', 'needs a service. And a hug.'],
    ['#120e1c', '#3a2a5a', '#f2c14e', '#0a0a22', '#1c1c3a', '#c9a24a', 'buildings', 'lights', 'gold', 'BUBBLY', 'DRAFT',
      'THE PENTHOUSE|THE LAUNDRY CHUTE|THE LIFT SHAFT|THE CHAMPAGNE FLUTE|THE REVOLVING DOOR|THE BALLROOM|THE CONFETTI CANNON|THE WINE CELLAR|THE BANISTER|THE LOBBY?', 'arrived fashionably late. And flat.'],
    ['#0b1a10', '#2f6b3f', '#a6ff3d', '#35523a', '#12281a', '#3f5a2a', 'trees', 'bubbles', 'stone', 'SWAMPY', 'SWAMP GAS',
      'THE BAYOU|THE GATOR HOLE|THE ROOT TANGLE|THE BOG|THE SWAMP GAS|THE LILY MAZE|THE MONSOON|THE MUD KING|THE MUDSLIDE|DRY LAND?', 'found dry land. The gator found Frank.'],
    ['#0c1c30', '#5aa9e6', '#e6f6ff', '#bfe6ff', '#ffffff', '#e6f6ff', 'mountains', 'snow', 'ice', 'ICY', 'BLIZZARD',
      'THE GLACIER|THE CREVASSE|THE ICE SHAFT|THE SLIP N SLIDE|THE BLIZZARD|THE ICE CUBES|THE WHITEOUT|THE PERMAFROST|THE LUGE|THE IGLOO?', 'is chilling at the bottom.'],
    ['#200806', '#6a1f14', '#ff7b00', '#3a0e0a', '#1a0504', '#3a2a28', 'mountains', 'embers', 'stone', 'MOLTEN', 'UPDRAFT',
      'THE CRATER RIM|THE FUMAROLE|THE LAVA TUBE|THE MAGMA FLOW|THE UPDRAFT|THE OBSIDIAN MAZE|THE ASH CLOUD|THE MAGMA CHAMBER|THE LAVA SLIDE|THE OTHER SIDE?', 'came out the other side. Well done.'],
    ['#16062a', '#6a2a9c', '#ff3df2', '#0e0620', '#2a0a4a', '#b13dff', 'buildings', 'lights', 'neon', 'FOAMY', 'SMOKE MACHINE',
      'THE VELVET ROPE|THE COAT CHECK|THE STAIRWELL|THE FOAM PARTY|THE SMOKE MACHINE|THE DANCE FLOOR|THE GLITTER CANNON|THE BASS BIN|THE CONGA LINE|LAST ORDERS?', 'dropped the beat. And himself.'],
    ['#05060f', '#3a4466', '#7fe9ff', '#05060f', '#1c2233', '#c3c9d3', 'stars', 'stars', 'metal', 'WEIGHTLESS', 'SOLAR WIND',
      'THE LAUNCH PAD|THE AIRLOCK|THE FUEL LINE|THE COOLANT LOOP|THE SOLAR WIND|THE ASTEROID BELT|THE ION STORM|THE REACTOR CORE|THE GRAVITY WELL|THE MOON?', 'has landed. One small splat for man.'],
    ['#0e0e14', '#3a3a4a', '#ff3d3d', '#2a1030', '#0e0e14', '#3a2a2a', 'pillars', 'planks', 'wood', 'SILKY', 'DIVINE WIND',
      'THE ROOFTOPS|THE WELL|THE BAMBOO SHAFT|THE KOI POND|THE DIVINE WIND|THE PAPER WALLS|THE SHURIKEN STORM|THE SHADOW ROOM|THE WATERFALL|ENLIGHTENMENT?', 'landed without a sound. Mostly.'],
    ['#0a1a24', '#6d4a2a', '#ffd23f', '#5ab0d9', '#1f5f8a', '#6d4a2a', 'waves', 'planks', 'wood', 'SLOPPY', 'TRADE WIND',
      'THE CROWS NEST|THE HATCH|THE MAST|THE BILGE|THE TRADE WINDS|THE CARGO HOLD|THE SQUALL|DAVY JONES LOCKER|THE PLANK|LAND HO?', 'walked the plank the long way.'],
    ['#1a1414', '#8a8f99', '#ff7ac8', '#e8e2d6', '#c9c2b4', '#f4f4f4', 'none', 'tiles', 'metal', 'BUTTERY', 'STEAM',
      'THE PASS|THE DUMBWAITER|THE FLUE|THE GRAVY BOAT|THE EXTRACTOR HOOD|THE SPICE RACK|THE FLOUR STORM|THE DEEP FRYER|THE PASTA CHUTE|SERVICE?', 'is served. Table four.'],
    ['#1f1208', '#7a4a22', '#f2c14e', '#f2a65a', '#a0522d', '#c98d4f', 'mountains', 'planks', 'stone', 'DUSTY', 'DUST DEVIL',
      'THE HIGH PLAINS|THE WELL|THE MINE SHAFT|THE SLUICE|THE DUST DEVIL|THE GOLD SEAM|THE STAMPEDE|THE MOTHER LODE|THE MINE CART|SUNDOWN?', 'struck gold. Face first.'],
    ['#120a24', '#4a2a7a', '#c77dff', '#1a0e3a', '#0c0620', '#4a2a7a', 'pillars', 'stars', 'stone', 'ENCHANTED', 'SPELL WIND',
      'THE TOWER TOP|THE TRAPDOOR|THE SPIRAL STAIR|THE POTION SPILL|THE SPELL WIND|THE RUNE MAZE|THE HEX STORM|THE CRYSTAL CAVE|THE BROOM RIDE|THE BOTTOM?', 'found the bottom of the bottomless tower. Awkward.'],
    ['#1a0a0e', '#6a2a2a', '#ffd23f', '#3a2a5a', '#2a2a33', '#55555f', 'pillars', 'bricks', 'stone', 'ROYAL', 'DRAFT',
      'THE THRONE ROOM|THE TRAPDOOR|THE TOWER STAIR|THE MOAT|THE BANNERS|THE CHESSBOARD|THE SIEGE|THE OUBLIETTE|THE DRAWBRIDGE|THE PEASANTS?', 'has been overthrown. By gravity.'],
    ['#101014', '#3a3a44', '#ff3df2', '#1a1a22', '#0a0a0e', '#44444f', 'buildings', 'tiles', 'neon', 'STICKY', 'FEEDBACK',
      'THE STAGE DIVE|THE GRATE|THE STAIRWELL|THE BEER SPILL|THE SPEAKER STACK|THE MOSH PIT|THE FEEDBACK|THE THIRD RAIL|THE ESCALATOR|LAST TRAIN?', 'stage dived. Nobody caught him.'],
    ['#0a0e1a', '#3a4a6a', '#bfe3ff', '#141a2e', '#0a0e1a', '#2a3344', 'trees', 'wisps', 'stone', 'GHOSTLY', 'COLD DRAFT',
      'THE GRAVEYARD|THE OPEN GRAVE|THE CATACOMB|THE ECTOPLASM|THE COLD DRAFT|THE HAUNTED HALL|THE POLTERGEIST|THE UNDERWORLD|THE RIVER STYX|THE LIGHT?', 'went towards the light. It was a train.'],
  ];
  const KEYS = ['street', 'manhole', 'shaft', 'sewer', 'vents', 'grid', 'storm', 'core', 'chute', 'sky'];
  FRANKS.forEach(function (f, i) {
    const w = WORLDS[i], names = {};
    w[11].split('|').forEach(function (n, k) { names[KEYS[k]] = n; });
    f.w = { bg: w[0], block: w[1], neon: w[2], sky: w[3], sil: w[4], ground: w[5], silType: w[6], decor: w[7], pat: w[8], slick: w[9], gust: w[10], names: names, win: w[12] };
  });

  // The worlds of the game's own later levels, which are nobody's Frank: any Frank falls down them. Each is set out
  // like a Frank's (its tokens, its colours, the top and the ending); its stretches and their names come from the
  // server with the level itself. Kept beside the Franks, never among them: their order and their number stay.
  FRANKS.worlds = {
    rock: { name: 'ROCK BOTTOM', world: 'Under the bottom of the world', token: 'CRYSTALS', tokenShape: 'gem', tokenColor: '#7fe9ff',
      w: { bg: '#07141a', block: '#215463', neon: '#ff5a3c', sky: '#58b8f0', sil: '#3f8fb0', ground: '#3d4f5a', silType: 'mountains', decor: 'embers', pat: 'stone', slick: 'HOT', gust: 'DRAFT', names: {}, bottom: '#1b0d2a',
        win: 'hit rock bottom. Then the floor gave way.' } },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FRANKS;
  else root.FFFFranks = FRANKS;
})(typeof window !== 'undefined' ? window : globalThis);
