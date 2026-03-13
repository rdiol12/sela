/**
 * modules/maplestory/bot-manager.js — AI-managed MapleStory bot population.
 *
 * Spawns and manages multiple MapleBot instances that connect to the Cosmic
 * server as real players. Each bot has a personality and behaviors controlled
 * by a simple AI script (no LLM needed for basic behavior — uses rule-based
 * patterns; optionally routes to Claude for dynamic chat).
 *
 * Features:
 *   - Spawn N bots with unique names/appearances
 *   - Bots roam between maps, chat periodically, respond to players
 *   - AI decides chat messages from personality + context
 *   - Bots react to player chat (greetings, questions, party invites)
 *   - Managed via agent tools: spawn_bots, list_bots, bot_chat, dismiss_bot
 */

import { MapleBot } from './bot-client.js';
import { getMapPortals } from './wz-xml.js';
import {
  autoDistributeSP, combatTick, canAdvanceJob, startJobAdvancement,
  bestPotionForLevel, getTrainingMap, getClassType, COMBAT_THRESHOLDS,
  COMBAT_ROTATIONS, checkGearUpgrades, buyAndEquipGear, WEAPON_SHOP_NPCS,
  getContextResponse, getProactiveChatLine, generateWhisperTopic,
  getAvailableQuests, shouldFormParty,
  // Phase 3
  TrainingTracker, ReputationTracker, findSellableJunk, shouldSellJunk,
  estimateNetWorth, checkBossReadiness, findBossParty, startBossRaid,
  isMapDangerous, assignPlatform, isMobInMyZone, BOSS_RAIDS,
  CUSTOM_NPCS, AUTO_QUESTS,
} from './bot-brain.js';
import { createLogger } from '../../lib/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const log = createLogger('maple:bots');

const STATE_DIR = join(process.cwd(), 'data', 'state');
const STATE_FILE = join(STATE_DIR, 'maple-bots.json');

// ── Valid character creation values (from Etc.wz/MakeCharInfo.img.xml) ───────
const VALID_MALE = {
  faces: [20000, 20001, 20002], hairs: [30000, 30020, 30030], hairColors: [0, 7, 3, 2],
  skins: [0, 1, 2, 3], tops: [1040002, 1040006, 1040010],
  bottoms: [1060002, 1060006], shoes: [1072001, 1072005, 1072037, 1072038],
  weapons: [1302000, 1322005, 1312004],
};
const VALID_FEMALE = {
  faces: [21000, 21001, 21002], hairs: [31000, 31040, 31050], hairColors: [0, 7, 3, 2],
  skins: [0, 1, 2, 3], tops: [1041002, 1041006, 1041010, 1041011],
  bottoms: [1061002, 1061008], shoes: [1072001, 1072005],
  weapons: [1302000, 1322005, 1312004],
};
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function pickValidAppearance(gender) {
  const v = gender === 0 ? VALID_MALE : VALID_FEMALE;
  return {
    face: pick(v.faces), hair: pick(v.hairs), hairColor: pick(v.hairColors),
    skinColor: pick(v.skins), top: pick(v.tops), bottom: pick(v.bottoms),
    shoes: pick(v.shoes), weapon: pick(v.weapons),
  };
}

// ── Bot Personalities ───────────────────────────────────────────────────────

const PERSONALITIES = [
  {
    name: 'StarBlade', gender: 0,
    type: 'warrior', greetings: ['Hey!', 'Sup?', "What's good?"],
    idle: ['Anyone wanna grind?', 'LF> party for PQ', 'This map is chill', 'Brb getting pots'],
    responses: { hi: 'Hey there!', party: "Sure let's go!", help: 'What do you need?', buy: "I'm broke lol" },
  },
  {
    name: 'MoonArrow', gender: 1,
    type: 'archer', greetings: ['Hiya~', 'Hello!', 'Hey everyone!'],
    idle: ['Anyone seen the boss spawn?', 'Need more arrows...', 'Love this BGM', 'Training hard today!'],
    responses: { hi: 'Hi hi!', party: "I'm down!", help: 'What happened?', buy: "Check the FM" },
  },
  {
    name: 'DarkPulse', gender: 0,
    type: 'mage', greetings: ['...', 'Yo.', 'Hmm.'],
    idle: ['Need more MP pots', 'This spot is mine btw', 'Grinding for 4th job', '@@@@@@'],
    responses: { hi: '.', party: 'Maybe later', help: 'Google it', buy: 'Not selling' },
  },
  {
    name: 'LuckyClover', gender: 1,
    type: 'thief', greetings: ['Heyyy', 'Ayo!', 'Wassuuup'],
    idle: ['Anyone got steelys?', 'LF fame plz', 'S> ilbi 20m', 'Jumping around~'],
    responses: { hi: 'Heyyy!', party: 'Omw!', help: 'Whats up?', buy: 'How much?' },
  },
  {
    name: 'ThunderFist', gender: 0,
    type: 'warrior', greetings: ['LETS GO', 'Hey warriors!', 'Ready to fight!'],
    idle: ['Need a shield scroll', 'My damage is getting better', 'Almost level up!', 'GG last boss'],
    responses: { hi: 'Hey bro!', party: "Let's wreck stuff!", help: 'Need backup?', buy: 'What you selling?' },
  },
  {
    name: 'PixieDust', gender: 1,
    type: 'mage', greetings: ['Hellooo~', 'Good morning!', 'Hi friends!'],
    idle: ['Buffing at Henesys!', 'Free heals here', 'Looking for guild', 'Crafting potions~'],
    responses: { hi: 'Hello! <3', party: 'Yay lets go!', help: 'I can heal!', buy: 'Free for friends~' },
  },
  {
    name: 'SilentEdge', gender: 0,
    type: 'thief', greetings: ['Mm.', '...yo', '*waves*'],
    idle: ['...', '*lurks*', 'Just passing through', 'Nice weather in Henesys'],
    responses: { hi: '*nods*', party: '...fine', help: '...what?', buy: 'Name your price' },
  },
  {
    name: 'BreezeWing', gender: 1,
    type: 'archer', greetings: ['Hey hey!', 'Hiiii', 'Good vibes only!'],
    idle: ['Wind is nice today', 'Anyone for Ludi PQ?', 'Love this game!', 'Hunting elites~'],
    responses: { hi: 'Hey lovely!', party: "Absolutely! Let's go!", help: 'How can I help?', buy: 'I might have some!' },
  },
  // ── Personalities 9–40 ──────────────────────────────────────────────────────
  {
    name: 'IronVault', gender: 0,
    type: 'warrior', greetings: ['Heya!', 'Yo what up', 'Lets go boys'],
    idle: ['Need better armor', 'Anyone selling work gloves?', 'Power stance is OP', 'Bossing later?'],
    responses: { hi: 'Hey man!', party: 'Count me in!', help: 'Need a tank?', buy: 'Show me whatcha got' },
  },
  {
    name: 'FrostNova', gender: 1,
    type: 'mage', greetings: ['Hello~', 'Hey there~', 'Hi everyone!'],
    idle: ['Ice/Lightning is the best', 'Need more MP pots tbh', 'Teleport is so fun', 'Almost 4th job!'],
    responses: { hi: 'Hiii~', party: "I'll bring the damage!", help: 'Need a mage?', buy: 'How much?' },
  },
  {
    name: 'PhantomStep', gender: 0,
    type: 'thief', greetings: ['Ayo', '...', 'Sup everyone'],
    idle: ['Need more stars', 'Flash Jump feels good', 'LF> ilbis', 'Steelys work fine too'],
    responses: { hi: 'Yo', party: 'Aight bet', help: 'What is it?', buy: 'Depends on price' },
  },
  {
    name: 'SunChaser', gender: 1,
    type: 'archer', greetings: ['Good day!', 'Hellooo!', 'Nice weather!'],
    idle: ['Arrow rain is satisfying', 'Hunting at leafre', 'Need better bow', 'Anyone wanna duo?'],
    responses: { hi: 'Hey!', party: "Sounds fun, let's do it!", help: 'What do you need?', buy: 'Let me check~' },
  },
  {
    name: 'CrimsonAxe', gender: 0,
    type: 'warrior', greetings: ['YOOO', 'Hey fighters!', "Let's crush it!"],
    idle: ['Need maple warrior 20', 'Rush is so broken lol', 'Farming for Zakum helm', 'Who wants to HT?'],
    responses: { hi: 'Hey bro!', party: 'LETS GOOOO!', help: 'Whats wrong?', buy: 'Whatcha selling?' },
  },
  {
    name: 'MysticRain', gender: 1,
    type: 'mage', greetings: ['Greetings!', 'Hello friends~', 'Hi there!'],
    idle: ['Meditation is underrated', 'Maple Warrior buff plz', 'Bishop life is healer life', 'Dispel is so useful'],
    responses: { hi: 'Hello!', party: "I'll heal!", help: 'I can resurrect!', buy: 'Not really selling sorry' },
  },
  {
    name: 'NightClaw', gender: 0,
    type: 'thief', greetings: ['...hey', 'Yea?', 'Mm.'],
    idle: ['Shadow partner is cool', 'Need better claws', 'Meso explosion time', 'CB life'],
    responses: { hi: '...hey', party: '...sure', help: 'What.', buy: 'What u got' },
  },
  {
    name: 'GaleForce', gender: 0,
    type: 'archer', greetings: ['Hey all!', 'Greetings!', 'Ready to hunt!'],
    idle: ['Strafe all day', 'Hurricane when?', 'Need more arrows again', 'BM or MM?'],
    responses: { hi: 'Hey!', party: "Sure thing!", help: 'Name it', buy: 'What are you selling?' },
  },
  {
    name: 'RubyHeart', gender: 1,
    type: 'warrior', greetings: ['Hiii!', 'Hey cuties!', 'Good vibes~'],
    idle: ['Pink bean when?', 'Aran looks cool', 'Paladin tank life', 'Anyone got onyx apples?'],
    responses: { hi: 'Hey sweetie!', party: 'Omg yes!!', help: 'What happened?', buy: 'Ooh lemme see!' },
  },
  {
    name: 'VoidWalker', gender: 0,
    type: 'mage', greetings: ['Hmm.', 'Hello.', '...greetings.'],
    idle: ['Dark magic is misunderstood', 'Genesis takes too long', 'Need Zakum runs', 'Cooldowns ugh'],
    responses: { hi: 'Greetings.', party: 'If I must.', help: 'Elaborate.', buy: 'State your price.' },
  },
  {
    name: 'QuickSilver', gender: 0,
    type: 'thief', greetings: ['Fast as lightning!', 'Zoom!', 'Catch me if u can'],
    idle: ['Haste buff anyone?', 'Triple throw op', 'NL is endgame class', 'Need more tobis'],
    responses: { hi: 'Yo fast!', party: 'Race u there!', help: 'Be quick about it', buy: 'Speed > everything' },
  },
  {
    name: 'CedarBow', gender: 1,
    type: 'archer', greetings: ['Hello!', 'Hi hi!', 'Nature is beautiful~'],
    idle: ['Loving the forest maps', 'Need silver arrows', 'Leafre is peaceful', 'Puppet saved my life lol'],
    responses: { hi: 'Hi there!', party: 'Would love to!', help: 'Tell me more~', buy: 'Maybe later~' },
  },
  {
    name: 'SteelGuard', gender: 0,
    type: 'warrior', greetings: ['Standing strong!', 'Hey team!', 'Locked in.'],
    idle: ['Power guard is clutch', 'Shield mastery ftw', 'HP washing is expensive', 'Need better helm'],
    responses: { hi: 'Hey soldier.', party: "I'll tank.", help: 'Formation?', buy: 'Need warrior gear only' },
  },
  {
    name: 'EmberGlow', gender: 1,
    type: 'mage', greetings: ['Hellooo!', 'Warm greetings~', 'Hi!'],
    idle: ['Fire poison is so cool', 'Poison mist is underrated', 'Meteor shower soon!', 'Orbis tower again...'],
    responses: { hi: 'Hi cutie!', party: "I'll dps!", help: 'Whats up?', buy: 'Selling cheap~' },
  },
  {
    name: 'GhostBlade', gender: 0,
    type: 'thief', greetings: ['...', 'Boo.', '*appears*'],
    idle: ['Dark sight is freedom', 'Assassinate hits hard', 'Smokescreen deploy', '*vanishes*'],
    responses: { hi: '...', party: 'Behind you.', help: 'Already on it.', buy: '*slides items over*' },
  },
  {
    name: 'HawkEye', gender: 0,
    type: 'archer', greetings: ['Target acquired', 'Hey!', 'In position.'],
    idle: ['Snipe is satisfying', 'Need sharpeye mule', 'Critical rate is everything', 'SE plz'],
    responses: { hi: 'Confirmed.', party: 'On your six.', help: 'Go ahead.', buy: 'Archer gear only' },
  },
  {
    name: 'BlossomDance', gender: 1,
    type: 'warrior', greetings: ['Hai hai!', 'Hey cuties~', 'Yaaay!'],
    idle: ['Aran is my fave', 'Combo master!', 'Combat step is fun', 'Pink warrior guild when?'],
    responses: { hi: 'Kyaaa hi!', party: 'Yesss!!', help: 'Tell me tell me!', buy: 'Ooh shiny!' },
  },
  {
    name: 'ArcaneVeil', gender: 1,
    type: 'mage', greetings: ['Salutations.', 'Hello.', 'Greetings traveler.'],
    idle: ['Magic guard saves lives', 'Infinity is broken', 'Bahamut is my pet now', 'Need more int gear'],
    responses: { hi: 'Well met.', party: 'I shall join.', help: 'Speak.', buy: 'I seek ancient tomes.' },
  },
  {
    name: 'RazorFang', gender: 0,
    type: 'thief', greetings: ['Tch.', 'What.', "Don't waste my time."],
    idle: ['Meso guard on', 'Band of thieves assemble', 'Dagger or claw?', 'Shadower supremacy'],
    responses: { hi: 'Tch.', party: 'Fine whatever.', help: 'Spit it out.', buy: 'How much. Fast.' },
  },
  {
    name: 'WindRider', gender: 1,
    type: 'archer', greetings: ['Wheee!', 'Hi everyone!', 'The wind is calling!'],
    idle: ['Jump shot is so cool', 'Need better xbow', 'Piercing arrow goes brrr', 'Marksman life!'],
    responses: { hi: 'Heya!', party: 'Adventure time!', help: 'How can I help?', buy: 'Lemme check my bag~' },
  },
  {
    name: 'OnyxKnight', gender: 0,
    type: 'warrior', greetings: ['For honor!', 'Stand ready.', 'Greetings warrior.'],
    idle: ['Brandish is amazing', 'Need better sword', 'Hero or Paladin?', 'Achilles passive OP'],
    responses: { hi: 'Well met.', party: 'To battle!', help: 'Speak friend.', buy: 'Warrior equipment only.' },
  },
  {
    name: 'CrystalMist', gender: 1,
    type: 'mage', greetings: ['Hi hi~', 'Sparkle sparkle!', 'Hewwo!'],
    idle: ['Angel Ray is pretty', 'Holy shield up', 'Mana bull OP', 'Buff me plz'],
    responses: { hi: 'Hiiiii!', party: "Let's gooo!", help: 'What happened? D:', buy: "I'm poor sry" },
  },
  {
    name: 'ShadowVex', gender: 0,
    type: 'thief', greetings: ['Yo.', '*leans on wall*', 'Mm.'],
    idle: ['Boomerang step spam', 'Need avenger stars', 'Dark flare is cool', 'DB or NL?'],
    responses: { hi: 'Yo.', party: 'Maybe.', help: 'What.', buy: 'Depends.' },
  },
  {
    name: 'FalconDive', gender: 0,
    type: 'archer', greetings: ['Ready!', 'Lets hunt!', 'On the prowl!'],
    idle: ['Dragon breath is fun', 'Need better arrows', 'Inferno is underrated', 'Phoenix summon!'],
    responses: { hi: 'Hey!', party: 'Im ready!', help: 'What is it?', buy: 'Archer stuff only' },
  },
  {
    name: 'CoralShell', gender: 1,
    type: 'warrior', greetings: ['Aloha~', 'Hey there!', 'Waves!'],
    idle: ['Aqua road is pretty', 'Swimming animations when', 'Nautilus is home', 'Page life'],
    responses: { hi: 'Hey hey~', party: 'Sure!!', help: 'Need a hand?', buy: 'What ya got?' },
  },
  {
    name: 'SparkWire', gender: 0,
    type: 'mage', greetings: ['Zap!', 'Hey!', 'Charged up!'],
    idle: ['Chain lightning go brr', 'Thunder spear is cool', 'CL mage best farmer', 'Need more int'],
    responses: { hi: 'Yo!', party: 'Ill shock em!', help: 'Whats up?', buy: 'Mage gear?' },
  },
  {
    name: 'DuskFang', gender: 0,
    type: 'thief', greetings: ['Evening.', '...hm.', 'The night is young.'],
    idle: ['Assassinate crits hard', 'Need dragon khanjar', 'Meso explosion farming', 'NW looks cool'],
    responses: { hi: 'Evening.', party: 'Lead the way.', help: 'I might know something.', buy: 'Perhaps.' },
  },
  {
    name: 'MapleStar', gender: 1,
    type: 'archer', greetings: ['OMG HI!', 'HIII!', 'Best day ever!'],
    idle: ['I love this game so much!!', 'Anyone wanna be friends?', 'Cutest bow ever!', 'Screenshot time!'],
    responses: { hi: 'OMG HIIII!', party: 'YES YES YES!', help: 'TELL ME!', buy: 'OOH WHAT IS IT!' },
  },
  {
    name: 'BoulderSmash', gender: 0,
    type: 'warrior', greetings: ['SMASH!', 'Hey!', 'Ready to brawl!'],
    idle: ['Earthquake skill when', 'Need more STR', 'Warrior grinding is slow ngl', 'Tanking Zakum arm'],
    responses: { hi: 'HEY!', party: 'LETS SMASH!', help: 'WHAT NEED?', buy: 'GOOD STUFF ONLY' },
  },
  {
    name: 'LunaVeil', gender: 1,
    type: 'mage', greetings: ['Good evening~', 'Hello there~', 'Moonlight blessings~'],
    idle: ['Elquines is so cute', 'Need arcane staff', 'IL mage supremacy', 'Blizzard is beautiful'],
    responses: { hi: 'Hello dear~', party: 'I would be delighted~', help: 'Of course~', buy: 'What might you have?' },
  },
  {
    name: 'ViperStrike', gender: 0,
    type: 'thief', greetings: ['Strike first.', 'Yo.', 'Ready.'],
    idle: ['Venom is ticking', 'Poison damage OP', 'Need more LUK scrolls', 'Shadow web hold em'],
    responses: { hi: 'Yo.', party: 'Lets go.', help: 'Talk.', buy: 'Whatcha got.' },
  },
  {
    name: 'ZephyrShot', gender: 1,
    type: 'archer', greetings: ['Hey~!', 'Hiii!', 'Over here!'],
    idle: ['Crossbow gang!', 'Snipe one-shots feel amazing', 'Need more bolts', 'MM is underrated'],
    responses: { hi: 'Hiya!', party: 'Im in!', help: 'Whats going on?', buy: 'Hmm maybe~' },
  },
  // ── Sage class personalities ──────────────────────────────────────────────
  {
    name: 'RuneWeaver', gender: 1,
    type: 'sage', greetings: ['Greetings.', 'The runes speak...', 'Hello, seeker.'],
    idle: ['Channeling arcane energy...', 'The elements obey', 'Studying ancient texts', 'Sage Hall has the best training'],
    responses: { hi: 'Well met!', party: 'The arcane flows stronger together.', help: 'What knowledge do you seek?', buy: 'Runic orbs are priceless.' },
  },
  {
    name: 'ArcaneFlux', gender: 0,
    type: 'sage', greetings: ['Yo!', 'Hey mages!', 'Arcane power!'],
    idle: ['Elemental Attunement is cracked', 'Need more INT gear', 'Archsage soon!', 'Mana Shield saves lives'],
    responses: { hi: 'Hey!', party: 'Lets blast em!', help: 'Cast first ask later', buy: 'Got any INT scrolls?' },
  },
  // ── Necromancer class personalities ──────────────────────────────────────
  {
    name: 'GraveWhisper', gender: 1,
    type: 'necromancer', greetings: ['...the dead are restless.', 'You dare approach?', 'Another soul wanders near.'],
    idle: ['Death Bolt hits different at night', 'My skeletons do all the work', 'Soul Siphon keeps me alive', 'The Necropolis calls...'],
    responses: { hi: 'The spirits acknowledge you.', party: 'Your life force will be useful.', help: 'What troubles the living?', buy: 'I deal in bones, not mesos.' },
  },
  {
    name: 'BoneReaper', gender: 0,
    type: 'necromancer', greetings: ['Death comes for all.', 'Yo!', 'Sup.'],
    idle: ['Lich King soon!!', 'Corpse explosion is SO satisfying', 'Need INT gear for Bone Spear', 'Anyone else farming Burial Vestibule?'],
    responses: { hi: 'Hey!', party: "Undead army's ready.", help: "What's up?", buy: 'Got any INT scrolls?' },
  },
  {
    name: 'SoulChaser', gender: 0,
    type: 'necromancer', greetings: ['Greetings from beyond.', 'Hmm.', 'Another adventurer.'],
    idle: ['Soul Harvest AoE is insane', 'Training at Necropolis beats everywhere', 'Plague Cloud DoT is underrated', 'Death Mark + party = EZ boss'],
    responses: { hi: 'Greetings.', party: 'The more souls the merrier.', help: 'State your purpose.', buy: 'Name your terms.' },
  },
];

// ── Common maps bots roam between ───────────────────────────────────────────

const BOT_MAPS = [
  100000000,  // Henesys
  101000000,  // Ellinia
  102000000,  // Perion
  103000000,  // Kerning City
  104000000,  // Lith Harbor
  120000000,  // Nautilus
  200000000,  // Orbis
  211000000,  // El Nath
  220000000,  // Ludibrium
  240000000,  // Leafre
  101050000,  // Sage Hall (custom)
  990200000,  // Necropolis — Dark Apprentice hub (custom)
];

// ── Training maps by level range ────────────────────────────────────────────

const TRAINING_MAPS = [
  { minLv:  1, maxLv: 10, maps: [10000,     40000],       name: 'Maple Island' },
  { minLv: 10, maxLv: 15, maps: [100000000, 100020100],   name: 'Henesys / Pig Farm' },
  { minLv: 15, maxLv: 21, maps: [101010100, 101020000],   name: 'Ellinia / Slime Tree' },
  { minLv: 21, maxLv: 30, maps: [105040300, 105050100],   name: 'Sleepywood / Ant Tunnel' },
  { minLv: 30, maxLv: 40, maps: [103000000, 103030400],   name: 'Kerning City / Subway' },
  { minLv: 40, maxLv: 50, maps: [211000000, 211040200],   name: 'El Nath / Ice Valley' },
  { minLv: 50, maxLv: 60, maps: [220000000, 220050300],   name: 'Ludibrium / Clocktower' },
  { minLv: 60, maxLv: 70, maps: [220070301, 220070400],   name: 'Ludi Deep / Terrace' },
  { minLv: 70, maxLv: 85, maps: [240000000, 240020100],   name: 'Leafre / Forest' },
  { minLv: 85, maxLv: 100, maps: [240040400, 240040510],  name: 'Leafre / Dragon Forest' },
  { minLv: 100, maxLv: 120, maps: [270000100, 270010100], name: 'Temple of Time' },
  { minLv: 120, maxLv: 200, maps: [270020100, 270030100], name: 'Temple of Time / Road' },
];

// ── Potion shop NPCs (sell standard potions) ────────────────────────────────

const POTION_SHOP_NPCS = {
  100000000: 1001100,   // Henesys potion shop
  101000000: 1011100,   // Ellinia potion shop
  102000000: 1021100,   // Perion potion shop
  103000000: 1031100,   // Kerning potion shop
  200000000: 2010100,   // Orbis potion shop
  211000000: 2020100,   // El Nath potion shop
  220000000: 2040000,   // Ludibrium potion shop
  240000000: 2050100,   // Leafre potion shop
};

// ── Auto-AP stat targets per class type ─────────────────────────────────────
// Stat IDs: 0x40=STR, 0x80=DEX, 0x100=INT, 0x200=LUK

const AUTO_AP = {
  warrior:     0x40,   // STR
  archer:      0x80,   // DEX
  mage:        0x100,  // INT
  thief:       0x200,  // LUK
  sage:        0x100,  // INT (Sage primary stat)
  necromancer: 0x100,  // INT (Necromancer primary stat)
};

// ── Default buff skills per class (1st/2nd job basics) ──────────────────────

const CLASS_BUFFS = {
  warrior:     [1001003],          // Iron Body
  archer:      [3001004],          // Focus
  mage:        [2001002, 2001003], // Magic Guard, Magic Armor
  thief:       [4001003],          // Dark Sight
  sage:        [6001001, 6001002], // Mana Shield, Elemental Attunement
  necromancer: [7001001, 7001002], // Soul Siphon, Dark Pact
};

// ── Death respawn return maps (common; server overrides with WZ data) ───────

const DEFAULT_RESPAWN = 100000000; // Henesys is universal fallback

// ── Loot filter: junk items to ignore (etc drops worth nothing) ─────────────

const JUNK_ITEMS = new Set([
  4000000, // Snail Shell
  4000001, // Blue Snail Shell
  4000002, // Red Snail Shell
  4000003, // Leaf
  4000004, // Firewood
  4000005, // Squishy Liquid
  4000006, // Stiff Feather
  4000007, // Soft Feather
  4000008, // Pig Ribbon
  4000009, // Steel Ore (actually useful, keep commented as example)
  4000016, // Stirge Wing
  4000017, // Old Leather Belt
  4000021, // Mushroom Cap
  4000022, // Wooden Shoulder Pad
  4000023, // Serpent Tail
  4000024, // Solid Horn
  4000025, // Horny Mushroom Cap
  4000030, // Tree Branch
]);

// ── Valuable item ID ranges (equips, scrolls, etc) ─────────────────────────

function isValuableItem(itemId) {
  if (itemId >= 1000000 && itemId < 2000000) return true;  // Equips
  if (itemId >= 2000000 && itemId < 2010000) return true;  // Potions
  if (itemId >= 2040000 && itemId < 2050000) return true;  // Scrolls
  if (itemId >= 2070000 && itemId < 2080000) return true;  // Stars (throwing stars)
  if (itemId >= 4001000 && itemId < 4002000) return true;  // Quest items
  if (itemId >= 4030000 && itemId < 4040000) return true;  // Quest items 2
  if (itemId >= 4020000 && itemId < 4030000) return true;  // Refined ores
  return false;
}

// ── Fame cooldown (24 hours per target) ─────────────────────────────────────

const FAME_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Crowded map threshold ───────────────────────────────────────────────────

const CROWDED_PLAYER_THRESHOLD = 4; // CC if more than 4 players on map

// ── Bot Manager ─────────────────────────────────────────────────────────────

// ── Potion item IDs (common consumables) ────────────────────────────────────

const POTION_IDS = {
  RED_POTION:    2000000, // +50 HP
  ORANGE_POTION: 2000001, // +150 HP
  WHITE_POTION:  2000002, // +300 HP
  BLUE_POTION:   2000003, // +100 MP
  MANA_ELIXIR:   2000006, // +300 MP
  ELIXIR:        2000004, // +50% HP/MP
  POWER_ELIXIR:  2000005, // +100% HP/MP
};

// ── Combat chat lines per personality type ───────────────────────────────────

const COMBAT_CHAT = {
  warrior: ['Take that!', 'SLASH!', 'Ez mob', 'Come at me!', 'Almost dead...', 'GG ez'],
  archer:  ['Pew pew!', 'Headshot!', 'From downtown~', 'Stay back!', 'Need more arrows'],
  mage:    ['Fireball!', 'Freeze!', '@@@@', 'Magic go brrr', 'Out of MP again...'],
  thief:   ['Sneak attack!', '*backstab*', 'Too slow~', 'Crit!', 'Ninja vanish~'],
};

// ── Bot Manager ─────────────────────────────────────────────────────────────

// ── Jittered delay helper (Gaussian-ish distribution, more human) ────────────
function jitterDelay(base, spread) {
  // Box-Muller approximation: clustered around base, spread as stddev
  const u1 = Math.random() || 0.001;
  const u2 = Math.random();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(base * 0.3, base + gaussian * spread);
}

class BotManager {
  constructor() {
    this.bots = new Map();       // name → { bot, personality, timers, status, config }
    this.chatCallback = null;    // optional AI chat callback
    this._tickTimer = null;
  }

  /** Start the shared tick loop — 1 tick per second for all bots */
  _startTickLoop() {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(() => this._tickAll(), 1000);
  }

  _stopTickLoop() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  /** Single tick: iterate all bots, run any behaviors that are due */
  _tickAll() {
    const now = Date.now();
    for (const [name, entry] of this.bots) {
      if (entry.disposed || entry.status !== 'online') continue;
      const { bot, personality, schedule } = entry;
      if (!schedule) continue;

      for (const behavior of schedule) {
        if (now >= behavior.nextTick) {
          try { behavior.fn(entry, bot, personality, name); } catch (e) {
            log.warn({ bot: name, behavior: behavior.name, err: e.message }, 'Behavior tick error');
          }
          behavior.nextTick = now + behavior.interval();
        }
      }
    }
  }

  async spawnBot(personalityIndex = -1) {
    const p = personalityIndex >= 0
      ? PERSONALITIES[personalityIndex % PERSONALITIES.length]
      : PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

    // Avoid duplicate names — append number suffix for duplicates
    let name = p.name;
    let suffix = 0;
    while (this.bots.has(name)) {
      suffix++;
      name = p.name.substring(0, 10) + suffix;
    }

    // Username must be ≤13 chars for MapleStory accounts table
    const username = `cb_${name.toLowerCase()}`.substring(0, 13);
    const password = 'cosmicbot2026';

    // Pick valid hair/face from MakeCharInfo
    const appearance = pickValidAppearance(p.gender);

    // Pre-create account via MySQL to avoid TOS/auto-register issues
    MapleBot.ensureAccountSync(username, password);

    const bot = new MapleBot({
      name,
      username,
      password,
      gender: p.gender,
      hair: appearance.hair,
      face: appearance.face,
      hairColor: appearance.hairColor,
      skinColor: appearance.skinColor,
      top: appearance.top,
      bottom: appearance.bottom,
      shoes: appearance.shoes,
      weapon: appearance.weapon,
    });

    const entry = {
      bot,
      personality: p,
      timers: [],
      status: 'connecting',
      lastChat: 0,
      config: {
        combat: true,       // auto-attack nearby mobs
        loot: true,         // auto-pickup drops
        autoPotion: true,   // auto-use pots when low HP
        potionThreshold: 0.4, // use pot below 40% HP
        attackDamage: 50,   // base damage claim (server validates)
        emote: true,        // random emotes
        autoAP: true,       // auto-distribute AP on level up
        autoTrain: true,    // auto-move to level-appropriate training map
        potionBuy: true,    // auto-buy potions from NPC shops
        autoGuild: false,   // join/create guild with other bots
        autoTrade: false,   // trade items with other bots
        autoBuddy: true,    // auto-add other bots as buddies
        autoBuff: true,     // auto-cast class buff skills
        megaphone: false,   // use megaphone (needs cash items)
        lootFilter: true,   // filter out junk loot
        autoFame: true,     // auto-fame other bots daily
        autoCC: true,       // auto-change channel if map crowded
        autoReconnect: true, // auto-reconnect on disconnect
        whisperReply: true, // auto-reply to whispers
        autoSP: true,       // auto-distribute SP via bot-brain builds
        autoJobAdvance: true, // auto-advance job when level requirement met
        autoGear: true,     // auto-buy+equip best weapon/armor for level
        autoParty: true,    // auto-form parties with other bots and players
        autoQuest: true,    // auto-accept/complete quests
        proactiveWhisper: true, // whisper nearby real players
      },
      combatStats: { kills: 0, itemsLooted: 0, potionsUsed: 0, deaths: 0 },
      fameHistory: new Map(),             // targetName → lastFameTimestamp
      conversationHistory: new Map(),     // playerId → [{ msg, from, time }] (last 10)
      chatCooldownPerPlayer: new Map(),   // playerId → lastResponseTime
      advancing: false,                   // true while job advancement in progress
      gearBuying: false,                  // true while shopping for gear
      whisperedPlayers: new Set(),        // players already whispered this session
      // Phase 3
      trainingTracker: new TrainingTracker(),   // adaptive training data
      reputation: new ReputationTracker(),      // per-player reputation scores
      platformIndex: 0,                         // assigned platform for coordinated grinding
      sellingJunk: false,                       // true while doing NPC sell run
      bossing: false,                           // true while in boss raid
      _nurseJoyVisiting: false,                 // true while talking to Nurse Joy
      _lastTaskboardVisit: 0,                   // timestamp of last Cosmic Taskboard visit
    };

    this.bots.set(name, entry);

    // Catch error events to prevent unhandled crash
    bot.on('error', (err) => {
      log.warn({ bot: name, err: err.message }, 'Bot error event');
    });

    try {
      await bot.connect();
      entry.status = 'online';
      log.info({ bot: name }, 'Bot is online');

      // Warp out of tutorial map to a random town after a short delay
      const TOWN_MAPS = [100000000, 101000000, 102000000, 103000000, 104000000, 120000000];
      setTimeout(() => {
        try {
          const townMap = TOWN_MAPS[Math.floor(Math.random() * TOWN_MAPS.length)];
          bot.changeMap(townMap);
          log.info({ bot: name, mapId: townMap }, 'Bot warped to town');
        } catch (e) { log.warn({ bot: name, err: e.message }, 'Failed to warp bot'); }
      }, 3000 + Math.random() * 5000);

      // Set up behaviors
      this._setupBehavior(name, entry);

      return { success: true, name, status: 'online' };
    } catch (err) {
      entry.status = 'error';
      log.error({ bot: name, err: err.message }, 'Bot failed to connect');
      this.bots.delete(name);
      return { success: false, name, error: err.message };
    }
  }

  async spawnBots(count = 3) {
    const results = [];
    for (let i = 0; i < count; i++) {
      // Stagger connections to avoid overwhelming the server DB pool (max 10 connections)
      if (i > 0) await new Promise(r => setTimeout(r, 4000));
      results.push(await this.spawnBot(i));
    }
    return results;
  }

  dismissBot(name) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };

    // Mark as disposed to prevent ghost callbacks from firing
    entry.disposed = true;

    // Clear schedule (shared tick loop will skip disposed entries)
    entry.schedule = [];

    // Remove all event listeners to prevent memory leaks
    entry.bot.removeAllListeners();

    // Stop tick loop if no bots remain
    if (this.bots.size <= 1) this._stopTickLoop();

    entry.bot.disconnect();
    this.bots.delete(name);
    log.info({ bot: name }, 'Bot dismissed');
    return { success: true, name };
  }

  dismissAll() {
    const names = [...this.bots.keys()];
    for (const name of names) this.dismissBot(name);
    return { success: true, dismissed: names.length };
  }

  listBots() {
    return [...this.bots.entries()].map(([name, entry]) => ({
      name,
      status: entry.status,
      personality: entry.personality.type,
      jobId: entry.bot.jobId,
      classType: getClassType(entry.bot.jobId) || entry.personality.type,
      mapId: entry.bot.mapId,
      level: entry.bot.stats.level,
      hp: `${entry.bot.stats.hp}/${entry.bot.stats.maxHp}`,
      mp: `${entry.bot.stats.mp}/${entry.bot.stats.maxMp}`,
      ap: entry.bot.ap,
      sp: entry.bot.sp,
      meso: entry.bot.stats.meso,
      guild: entry.bot.guildName || 'none',
      buddies: entry.bot.buddyList.size,
      buffsActive: entry.bot.buffActive.size,
      playersNearby: entry.bot.playersNearby.size,
      monstersNearby: entry.bot.monstersNearby.size,
      kills: entry.combatStats.kills,
      deaths: entry.combatStats.deaths,
      looted: entry.combatStats.itemsLooted,
      advancing: entry.advancing,
      gearBuying: entry.gearBuying,
      party: entry.bot.partyId || 0,
      // Phase 3
      killRate: Math.round(entry.trainingTracker.getKillRate(entry.bot.mapId) * 10) / 10,
      netWorth: estimateNetWorth(entry.bot),
      friends: entry.reputation.getFriends(3).map(f => f.name),
      bossing: entry.bossing,
    }));
  }

  botChat(name, message) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    entry.bot.chat(message);
    return { success: true, name, message };
  }

  broadcastChat(message) {
    for (const [name, entry] of this.bots) {
      if (entry.status === 'online') {
        entry.bot.chat(message);
      }
    }
    return { success: true, botCount: this.bots.size };
  }

  /**
   * Configure a bot's behavior.
   * @param {string} name - bot name
   * @param {object} cfg - { combat, loot, autoPotion, emote }
   */
  configureBot(name, cfg) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    Object.assign(entry.config, cfg);
    return { success: true, name, config: entry.config };
  }

  // ── Behavior engine ───────────────────────────────────────────────────

  /** Get the best training map for a given level. */
  _getTrainingMap(level) {
    for (const tier of TRAINING_MAPS) {
      if (level >= tier.minLv && level <= tier.maxLv) {
        return tier.maps[Math.floor(Math.random() * tier.maps.length)];
      }
    }
    return 100000000; // fallback: Henesys
  }

  _setupBehavior(name, entry) {
    const { bot, personality } = entry;
    const mgr = this;
    const alive = () => entry.status === 'online' && !entry.disposed;

    // ── Loot filter setup ──
    if (entry.config.lootFilter) {
      bot.setLootFilter((itemId, isMeso) => {
        if (isMeso) return true;
        if (JUNK_ITEMS.has(itemId)) return false;
        return isValuableItem(itemId) || !JUNK_ITEMS.has(itemId);
      });
    }

    // ── Schedule-based behaviors (driven by shared tick loop) ──
    // Each behavior: { name, interval: () => ms, fn: (entry, bot, personality, name) => void }
    entry.schedule = [
      { name: 'chat', interval: () => jitterDelay(45000, 20000),
        fn(e, b, p) {
          if (Date.now() - e.lastChat < 20000) return;
          e.lastChat = Date.now();
          b.chat(p.idle[Math.floor(Math.random() * p.idle.length)]);
        }},
      { name: 'roam', interval: () => jitterDelay(300000, 90000),
        fn(e, b) {
          if (Math.random() < 0.6 || b.portals.size === 0) {
            b.moveTo(Math.floor(Math.random() * 800) - 400, Math.floor(Math.random() * 200));
          } else {
            const portal = b.getRandomPortal();
            if (portal) {
              log.info({ bot: b.name, portal: portal.name, target: portal.targetMap }, 'Bot using portal');
              b.usePortal(portal.name);
            }
          }
        }},
      { name: 'combat', interval: () => jitterDelay(3000, 800),
        fn(e, b, p, n) {
          if (!e.config.combat) return;
          // Phase 3: coordinated grinding — set platform filter
          const platform = assignPlatform(b.mapId, e.platformIndex);
          e._combatPlatform = platform;
          const acted = combatTick(b, e);
          if (acted && Math.random() < 0.10 && Date.now() - e.lastChat > 15000) {
            const lines = COMBAT_CHAT[p.type] || COMBAT_CHAT.warrior;
            b.chat(lines[Math.floor(Math.random() * lines.length)]);
            e.lastChat = Date.now();
          }
        }},
      { name: 'loot', interval: () => jitterDelay(4000, 1200),
        fn(e, b) {
          if (!e.config.loot) return;
          const drop = b.getNearestDrop(200);
          if (!drop) return;
          if (!b.shouldLoot(drop.itemId, drop.isMeso)) return;
          if (drop.dist > 50) b.moveTo(drop.x, drop.y);
          b.pickupItem(drop.oid);
          e.combatStats.itemsLooted++;
        }},
      { name: 'potion', interval: () => jitterDelay(5000, 1500),
        fn(e, b, p) {
          if (!e.config.autoPotion) return;
          const thresholds = COMBAT_THRESHOLDS[p.type] || COMBAT_THRESHOLDS.warrior;
          const { hp, maxHp, mp, maxMp } = b.stats;
          // HP potion — skip in Henesys (Nurse Joy provides free full heal)
          if (maxHp > 0 && hp / maxHp < thresholds.potHpRatio &&
              b.mapId !== CUSTOM_NPCS.nurseJoy.mapId) {
            const pot = bestPotionForLevel(b.stats.level, 'hp');
            b.useItem(1, pot.itemId);
            e.combatStats.potionsUsed++;
          }
          // MP potion (separate from HP)
          if (maxMp > 0 && mp / maxMp < thresholds.potMpRatio) {
            const pot = bestPotionForLevel(b.stats.level, 'mp');
            b.useItem(1, pot.itemId);
            e.combatStats.potionsUsed++;
          }
        }},
      { name: 'regen', interval: () => 10000,
        fn(e, b) { b.healOverTime(10, 5); }},
      { name: 'emote', interval: () => jitterDelay(120000, 40000),
        fn(e, b) {
          if (!e.config.emote) return;
          if (Math.random() < 0.3) b.emote(1 + Math.floor(Math.random() * 7));
        }},
      { name: 'buff', interval: () => jitterDelay(180000, 20000),
        fn(e, b) {
          if (!e.config.autoBuff) return;
          // Use brain's rotation buffs (job-aware) with fallback to CLASS_BUFFS
          const rotation = COMBAT_ROTATIONS[b.jobId];
          const buffs = rotation ? rotation.buffs : (CLASS_BUFFS[e.personality.type] || []);
          for (const skillId of buffs) {
            const skillLevel = b.skills.get(skillId) || 0;
            if (skillLevel > 0 && !b.buffActive.has(skillId)) {
              b.useSkill(skillId, skillLevel);
              return; // one buff per tick
            }
          }
        }},
      { name: 'train', interval: () => jitterDelay(600000, 150000),
        fn(e, b, p, n) {
          if (!e.config.autoTrain || e.advancing) return;
          const targetMap = getTrainingMap(b.stats.level);
          if (targetMap && targetMap !== b.mapId) {
            b.changeMap(targetMap);
            log.info({ bot: n, level: b.stats.level, targetMap }, 'Auto-training map change');
          }
        }},
      { name: 'potionBuy', interval: () => jitterDelay(360000, 60000),
        fn(e, b, p, n) {
          if (!e.config.potionBuy || b.inNpcChat || b.inShop) return;
          if (e.combatStats.potionsUsed < 10) return;
          const npcId = POTION_SHOP_NPCS[b.mapId];
          if (!npcId) return;
          const npc = b.getNearestNpc(200);
          if (!npc) return;
          b.talkToNpc(npc.oid);
          const pot = bestPotionForLevel(b.stats.level, 'hp');
          const onShop = ({ items }) => {
            const target = items.find(i => i.itemId === pot.itemId);
            if (target) {
              b.shopBuy(target.slot, pot.itemId, 50);
              e.combatStats.potionsUsed = 0;
              log.info({ bot: n, potion: pot.name }, 'Bought 50 potions');
            }
            setTimeout(() => b.shopLeave(), 1000);
            b.removeListener('shopOpen', onShop);
          };
          b.once('shopOpen', onShop);
          setTimeout(() => b.removeListener('shopOpen', onShop), 10000);
        }},
      { name: 'buddy', interval: () => jitterDelay(120000, 30000),
        fn(e, b, p, n) {
          if (!e.config.autoBuddy) return;
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n || otherEntry.status !== 'online') continue;
            const alreadyBuddy = [...b.buddyList.values()].some(bud => bud.name === otherName);
            if (!alreadyBuddy) { b.buddyAdd(otherName); break; }
          }
        }},
      { name: 'guild', interval: () => jitterDelay(600000, 150000),
        fn(e, b, p, n) {
          if (!e.config.autoGuild || b.guildId) return;
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n) continue;
            if (otherEntry.bot.guildId && otherEntry.status === 'online') {
              otherEntry.bot.guildInvite(n);
              log.info({ bot: n, guild: otherEntry.bot.guildName }, 'Requesting guild invite');
              return;
            }
          }
          if (mgr.bots.size >= 5 && b.stats.meso >= 50000) {
            b.guildCreate(`Guild${Math.floor(Math.random() * 999)}`);
          }
        }},
      { name: 'trade', interval: () => jitterDelay(900000, 300000),
        fn(e, b, p, n) {
          if (!e.config.autoTrade || b.inTrade) return;
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n || otherEntry.status !== 'online') continue;
            if (otherEntry.bot.mapId !== b.mapId || otherEntry.bot.inTrade) continue;
            b.tradeCreate();
            setTimeout(() => {
              if (e.disposed) return;
              b.tradeInvite(otherEntry.bot.charId);
              setTimeout(() => {
                if (e.disposed) return;
                const mesoAmount = Math.min(100, b.stats.meso);
                if (mesoAmount > 0) b.tradeSetMeso(mesoAmount);
                setTimeout(() => { if (!e.disposed) b.tradeConfirm(); }, 3000);
              }, 2000);
            }, 1500);
            break;
          }
        }},
      { name: 'megaphone', interval: () => jitterDelay(1800000, 600000),
        fn(e, b, p, n) {
          if (!e.config.megaphone) return;
          const msgs = [`${n}: Anyone wanna party?`, `${n}: Server is fun today!`, `${n}: LF guild!`, `${n}: Training at ${b.mapId}`];
          b.megaphone(msgs[Math.floor(Math.random() * msgs.length)]);
        }},
      { name: 'fame', interval: () => jitterDelay(400000, 150000),
        fn(e, b, p, n) {
          if (!e.config.autoFame || b.stats.level < 15) return;
          const now = Date.now();
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n || otherEntry.status !== 'online') continue;
            if (otherEntry.bot.mapId !== b.mapId) continue;
            const lastFamed = e.fameHistory.get(otherName) || 0;
            if (now - lastFamed < FAME_COOLDOWN_MS) continue;
            for (const [oid, pName] of b.playersNearby) {
              if (pName === otherName) {
                b.giveFame(oid, true);
                e.fameHistory.set(otherName, now);
                return;
              }
            }
          }
        }},
      { name: 'cc', interval: () => jitterDelay(150000, 40000),
        fn(e, b, p, n) {
          if (!e.config.autoCC) return;
          if (b.playersNearby.size > CROWDED_PLAYER_THRESHOLD) {
            const newChannel = Math.floor(Math.random() * 3);
            if (newChannel !== b.channelId) {
              b.changeChannel(newChannel);
              log.info({ bot: n, players: b.playersNearby.size, newChannel }, 'Auto-CC');
            }
          }
        }},
      { name: 'persist', interval: () => 300000,
        fn() { mgr._saveState(); }},

      // ── Phase 2: Social Intelligence & Self-Sufficiency ──

      { name: 'gearUpgrade', interval: () => jitterDelay(900000, 300000),
        fn(e, b, p, n) {
          if (!e.config.autoGear || e.gearBuying || e.advancing) return;
          const upgrades = checkGearUpgrades(b, p.type);
          if (!upgrades || upgrades.length === 0) return;
          // Find nearest town with weapon shop
          const shopMapId = Object.keys(WEAPON_SHOP_NPCS).map(Number)
            .sort((a, c) => Math.abs(a - b.mapId) - Math.abs(c - b.mapId))[0];
          if (!shopMapId) return;
          // Buy the first upgrade needed
          const upgrade = upgrades[0];
          e.gearBuying = true;
          log.info({ bot: n, item: upgrade.name, shopMap: shopMapId }, 'Going to buy gear');
          buyAndEquipGear(b, shopMapId, upgrade).then(success => {
            e.gearBuying = false;
            if (success) b.chat(`Got a new ${upgrade.name}!`);
          }).catch(() => { e.gearBuying = false; });
        }},

      { name: 'partyForm', interval: () => jitterDelay(120000, 30000),
        fn(e, b, p, n) {
          if (!e.config.autoParty || b.partyId) return;
          // Count bots on same map
          let botsOnMap = 0;
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n) continue;
            if (otherEntry.status === 'online' && otherEntry.bot.mapId === b.mapId) botsOnMap++;
          }
          if (!shouldFormParty(b, botsOnMap)) return;
          // Create party and invite nearby bots
          b.partyCreate();
          log.info({ bot: n, botsOnMap }, 'Created party');
          // Invite other bots on same map after a delay
          setTimeout(() => {
            if (e.disposed) return;
            for (const [otherName, otherEntry] of mgr.bots) {
              if (otherName === n || otherEntry.status !== 'online') continue;
              if (otherEntry.bot.mapId === b.mapId && !otherEntry.bot.partyId) {
                // Invite via chat (server will handle the party invite)
                b.chat(`${otherName} join my party!`);
              }
            }
          }, 2000);
        }},

      { name: 'guildManage', interval: () => jitterDelay(1200000, 300000),
        fn(e, b, p, n) {
          if (!e.config.autoGuild) return;
          // If bot has guild, invite other guildless bots
          if (b.guildId) {
            for (const [otherName, otherEntry] of mgr.bots) {
              if (otherName === n || otherEntry.status !== 'online') continue;
              if (!otherEntry.bot.guildId) {
                b.guildInvite(otherName);
                log.info({ bot: n, target: otherName, guild: b.guildName }, 'Guild invite sent');
                return; // one invite per tick
              }
            }
            return;
          }
          // If no guild and enough meso + enough online bots, create one
          if (mgr.bots.size >= 5 && b.stats.meso >= 50000) {
            const guildNames = ['Legends', 'Cosmos', 'Eclipse', 'Starfall', 'Abyss',
              'Phoenix', 'Horizon', 'Mythos', 'Nexus', 'Zenith'];
            const gName = guildNames[Math.floor(Math.random() * guildNames.length)] +
              Math.floor(Math.random() * 99);
            b.guildCreate(gName);
            b.chat(`Created guild ${gName}! Join us!`);
            log.info({ bot: n, guild: gName }, 'Created guild');
          }
        }},

      { name: 'questAuto', interval: () => jitterDelay(300000, 60000),
        fn(e, b, p, n) {
          if (!e.config.autoQuest || b.inNpcChat || e.advancing) return;
          // Init completed quests tracking
          if (!b._completedQuests) b._completedQuests = new Set();
          const quests = getAvailableQuests(b);
          if (quests.length === 0) return;
          const quest = quests[0];
          // Find the NPC on the map
          let npcOid = null;
          for (const [oid, npc] of b.npcsNearby) {
            if (npc.npcId === quest.npcId) { npcOid = oid; break; }
          }
          if (!npcOid) return;
          // Start quest
          b.questStart(quest.id, quest.npcId);
          b._completedQuests.add(quest.id);
          log.info({ bot: n, quest: quest.name, id: quest.id }, 'Started quest');
        }},

      { name: 'proactiveChat', interval: () => jitterDelay(90000, 30000),
        fn(e, b, p) {
          if (Date.now() - e.lastChat < 30000) return;
          // Only proactive chat when real players are around
          if (b.playersNearby.size === 0) return;
          const line = getProactiveChatLine(b, p.type);
          if (line) {
            b.chat(line);
            e.lastChat = Date.now();
          }
        }},

      { name: 'whisperDM', interval: () => jitterDelay(600000, 200000),
        fn(e, b, p, n) {
          if (!e.config.proactiveWhisper) return;
          if (b.playersNearby.size === 0) return;
          // Find a real player (not a bot) to whisper
          for (const [playerId, playerName] of b.playersNearby) {
            if (mgr.bots.has(playerName)) continue; // skip other bots
            if (e.whisperedPlayers.has(playerName)) continue; // already whispered
            const msg = generateWhisperTopic(b, p.type, playerName);
            b.whisper(playerName, msg);
            e.whisperedPlayers.add(playerName);
            log.info({ bot: n, target: playerName }, 'Proactive whisper sent');
            return; // one whisper per tick
          }
        }},

      // ── Phase 3: Advanced AI ──

      { name: 'adaptiveTrain', interval: () => jitterDelay(120000, 30000),
        fn(e, b, p, n) {
          if (!e.config.autoTrain || e.advancing || e.gearBuying || e.bossing) return;
          const tracker = e.trainingTracker;
          // Count real players (not bots) on this map
          let realPlayers = 0;
          for (const [, pName] of b.playersNearby) {
            if (!mgr.bots.has(pName)) realPlayers++;
          }
          const switchReason = tracker.shouldSwitch(b.mapId, realPlayers);
          if (switchReason) {
            // Try the best known map first, then fall back to brain default
            const bestMap = tracker.getBestMap(b.stats.level);
            if (bestMap && bestMap !== b.mapId) {
              log.info({ bot: n, from: b.mapId, to: bestMap, reason: switchReason.reason }, 'Adaptive training switch');
              b.changeMap(bestMap);
              if (switchReason.reason === 'dying_too_much') {
                b.chat('This map is too dangerous, moving on...');
                e.lastChat = Date.now();
              } else if (switchReason.reason === 'crowded') {
                b.chat('Too crowded here, finding a new spot');
                e.lastChat = Date.now();
              }
            }
          }
        }},

      { name: 'sellJunk', interval: () => jitterDelay(600000, 120000),
        fn(e, b, p, n) {
          if (e.sellingJunk || e.gearBuying || e.advancing || b.inShop) return;
          if (!shouldSellJunk(b)) return;
          const npcId = POTION_SHOP_NPCS[b.mapId];
          if (!npcId) return; // need to be in a town with NPC
          const npc = b.getNearestNpc(200);
          if (!npc) return;
          e.sellingJunk = true;
          b.talkToNpc(npc.oid);
          const onShop = () => {
            b.removeListener('shopOpen', onShop);
            const junk = findSellableJunk(b);
            let sold = 0;
            for (const item of junk) {
              b.shopSell(item.slot, item.itemId, item.quantity);
              sold++;
            }
            setTimeout(() => {
              b.shopLeave();
              e.sellingJunk = false;
              if (sold > 0) {
                log.info({ bot: n, sold, items: junk.length }, 'Sold junk to NPC');
                if (Math.random() < 0.3) { b.chat('Inventory cleaned up!'); e.lastChat = Date.now(); }
              }
            }, 1000);
          };
          b.once('shopOpen', onShop);
          setTimeout(() => { b.removeListener('shopOpen', onShop); e.sellingJunk = false; }, 10000);
        }},

      { name: 'coordGrind', interval: () => jitterDelay(60000, 15000),
        fn(e, b, p, n) {
          // Assign platforms so bots on the same map don't fight over mobs
          let myIndex = 0;
          for (const [otherName, otherEntry] of mgr.bots) {
            if (otherName === n) break;
            if (otherEntry.status === 'online' && otherEntry.bot.mapId === b.mapId) myIndex++;
          }
          e.platformIndex = myIndex;
        }},

      { name: 'reputationDecay', interval: () => 3600000, // hourly
        fn(e) {
          // Slowly decay reputation scores toward 0 (memories fade)
          for (const [playerName, rep] of e.reputation.players) {
            if (rep.score > 0) rep.score = Math.max(0, rep.score - 1);
            if (rep.score < 0) rep.score = Math.min(0, rep.score + 1);
            // Remove players not seen in 24h
            if (Date.now() - rep.lastSeen > 86400000) {
              e.reputation.players.delete(playerName);
            }
          }
        }},

      // ── ms_2: Nurse Joy free heal (NPC 9999009, Henesys) ──
      // When bot is in Henesys and HP < 50%, talk to Nurse Joy for a full HP/MP restore
      // instead of burning potions. Nurse Joy uses a 2-step sendNext dialogue.
      { name: 'nurseJoyHeal', interval: () => jitterDelay(15000, 5000),
        fn(e, b, p, n) {
          if (e._nurseJoyVisiting || b.inNpcChat || b.inShop) return;
          if (b.mapId !== CUSTOM_NPCS.nurseJoy.mapId) return;
          const { hp, maxHp } = b.stats;
          if (maxHp <= 0 || hp / maxHp >= 0.5) return;
          // Find Nurse Joy (NPC 9999009) nearby
          let npcOid = null;
          for (const [oid, npc] of b.npcsNearby) {
            if (npc.npcId === CUSTOM_NPCS.nurseJoy.npcId) { npcOid = oid; break; }
          }
          if (!npcOid) return;
          e._nurseJoyVisiting = true;
          b.talkToNpc(npcOid);
          // Nurse Joy: sendNext → sendNext → dispose (auto-heals on first sendNext reply)
          const onChat = () => {
            b.removeListener('npcChat', onChat);
            b.npcChat(1, 0, 0); // confirm Next to trigger heal
            setTimeout(() => {
              if (!e.disposed) {
                b.npcChat(1, 0, 0); // second confirm to close
                e._nurseJoyVisiting = false;
                log.info({ bot: n, hp: b.stats.hp, maxHp: b.stats.maxHp }, 'Nurse Joy heal received');
                if (Math.random() < 0.4) { b.chat('Thanks for the heal!'); e.lastChat = Date.now(); }
              }
            }, 1500);
          };
          b.once('npcChat', onChat);
          setTimeout(() => { b.removeListener('npcChat', onChat); e._nurseJoyVisiting = false; }, 10000);
        }},

      // ── ms_2: Daily Cosmic Taskboard visit (NPC 9999013, Henesys) ──
      // Once per 24h, when in Henesys, visit the Cosmic Taskboard to pick up
      // available daily quests from the pool (quest IDs 99101-99130).
      { name: 'dailyTaskboard', interval: () => jitterDelay(3600000, 600000),
        fn(e, b, p, n) {
          if (!e.config.autoQuest || b.inNpcChat || b.inShop || e.advancing) return;
          if (b.mapId !== CUSTOM_NPCS.taskboard.mapId) return;
          const now = Date.now();
          const DAY_MS = 86400000;
          if (now - e._lastTaskboardVisit < DAY_MS) return; // once per day
          // Find the Cosmic Taskboard NPC nearby
          let npcOid = null;
          for (const [oid, npc] of b.npcsNearby) {
            if (npc.npcId === CUSTOM_NPCS.taskboard.npcId) { npcOid = oid; break; }
          }
          if (!npcOid) return;
          e._lastTaskboardVisit = now;
          b.talkToNpc(npcOid);
          // Taskboard menu: select option 0 (View Today's Tasks) then option 0 (accept first)
          let step = 0;
          const onChat = () => {
            step++;
            if (step === 1) {
              b.npcChat(1, 0, 0); // select "View Today's Tasks"
            } else if (step === 2) {
              b.npcChat(1, 0, 0); // accept first available quest
              b.removeListener('npcChat', onChat);
              log.info({ bot: n }, 'Cosmic Taskboard daily quests accepted');
              if (Math.random() < 0.3) { b.chat('Got my daily tasks!'); e.lastChat = Date.now(); }
            }
          };
          b.on('npcChat', onChat);
          setTimeout(() => b.removeListener('npcChat', onChat), 12000);
        }},

      // ── Cosmic Event Awareness ─────────────────────────────────────────────
      // Bots react to server events (EXP weekends, gold rushes, boss blitzes).
      // Event state is broadcast via server mapMessage packets; bots listen and chat.
      { name: 'eventAwareness', interval: () => jitterDelay(300000, 120000), // 5min check
        fn(e, b, p, n) {
          if (b.inNpcChat || b.inShop) return;
          const now = Date.now();
          if (now - (e._lastEventChat || 0) < 180000) return; // 3min cooldown per bot
          // Check for active event flags set by mapMessage/serverMessage events
          const activeEvent = b._activeEvent; // set by mapMessage listener below
          if (!activeEvent) return;
          e._lastEventChat = now;
          const eventLines = {
            exp:  ['EXP event is live!! Time to grind!', '2x EXP is ON, lets gooo', 'Best time to level up fr', 'EXP weekend is the best'],
            meso: ['Gold rush event! Drop rates are cracked rn', 'Meso event is live, farming time~', 'Mesos everywhere today lol'],
            boss: ['Boss Blitz is up! Check all boss maps', 'Boss hunt event! Who wants to party?', 'Boss locations announced!! lets roll'],
          };
          const lines = eventLines[activeEvent] || [`${activeEvent} event is live!`];
          b.chat(lines[Math.floor(Math.random() * lines.length)]);
          log.debug({ bot: n, event: activeEvent }, 'Bot reacted to server event');
        }},
    ];

    // Initialize nextTick with staggered offsets so bots don't all tick at once
    const now = Date.now();
    for (const behavior of entry.schedule) {
      behavior.nextTick = now + Math.random() * behavior.interval();
    }

    // Start the shared tick loop if not already running
    this._startTickLoop();

    // ── Event: map changed → load portal data from WZ + adaptive tracking ──
    bot.on('mapChanged', (mapId) => {
      entry.status = 'online';
      entry.trainingTracker.enterMap(mapId);
      try {
        const wzPortals = getMapPortals(mapId);
        if (wzPortals && wzPortals.length > 0) {
          bot.portals.clear();
          for (const p of wzPortals) {
            bot.portals.set(p.pn, {
              x: parseInt(p.x) || 0,
              y: parseInt(p.y) || 0,
              targetMap: parseInt(p.tm) || 0,
              targetPortal: p.tn || '',
              type: parseInt(p.pt) || 0,
            });
          }
          log.debug({ bot: bot.name, mapId, portalCount: bot.portals.size }, 'Loaded portal data');
        }
      } catch (e) {
        log.warn({ bot: bot.name, err: e.message }, 'Failed to load portal data');
      }
    });

    // ── Event: server broadcast → detect active Cosmic events ──
    // mapMessage/broadcastMsg packets carry event names in the message text.
    bot.on('serverMessage', (msg) => {
      if (!msg || typeof msg !== 'string') return;
      const lower = msg.toLowerCase();
      if (lower.includes('exp') || lower.includes('experience')) {
        bot._activeEvent = 'exp';
        setTimeout(() => { if (bot._activeEvent === 'exp') bot._activeEvent = null; }, 3600000); // 1h
      } else if (lower.includes('gold') || lower.includes('meso') || lower.includes('drop rate')) {
        bot._activeEvent = 'meso';
        setTimeout(() => { if (bot._activeEvent === 'meso') bot._activeEvent = null; }, 3600000);
      } else if (lower.includes('boss') || lower.includes('blitz')) {
        bot._activeEvent = 'boss';
        setTimeout(() => { if (bot._activeEvent === 'boss') bot._activeEvent = null; }, 3600000);
      }
    });

    // ── Event: monster killed → count kill + adaptive tracking ──
    bot.on('monsterKill', ({ oid, mobId }) => {
      entry.combatStats.kills++;
      entry.trainingTracker.recordKill(bot.mapId);
      // 5% chance to celebrate a kill
      if (Math.random() < 0.05 && Date.now() - entry.lastChat > 10000) {
        bot.chat('Nice!');
        entry.lastChat = Date.now();
      }
    });

    // ── Event: damaged → react + death respawn + death learning ──
    bot.on('damaged', ({ damage, hp, damagefrom }) => {
      if (hp <= 0) {
        entry.status = 'dead';
        entry.combatStats.deaths++;
        entry.trainingTracker.recordDeath(bot.mapId);
        log.warn({ bot: name, damage, mapId: bot.mapId }, 'Bot died');
        if (Math.random() < 0.08) bot.chat('Nooo...');

        // Death respawn after 3-5 seconds
        setTimeout(() => {
          if (entry.status !== 'dead') return;
          // Respawn by changing to current map (server sends to return point)
          bot.changeMap(bot.mapId || DEFAULT_RESPAWN);
          entry.status = 'online';
          log.info({ bot: name, mapId: bot.mapId }, 'Bot respawned after death');
        }, 3000 + Math.random() * 2000);
      }
    });

    // ── Event: level up → auto-AP distribution + job advancement check ──
    bot.on('statsUpdate', (stats) => {
      if (!alive()) return;
      // Auto-AP: distribute 5 AP when level increases
      if (entry.config.autoAP && stats.level > (entry._lastLevel || 1)) {
        entry._lastLevel = stats.level;
        const statId = AUTO_AP[personality.type] || 0x40;
        for (let i = 0; i < 5; i++) {
          setTimeout(() => { if (!entry.disposed) bot.distributeAP(statId); }, i * 200);
        }
        log.info({ bot: name, level: stats.level, stat: personality.type }, 'Auto-AP distributed');

        // Job advancement check on level up
        if (entry.config.autoJobAdvance && !entry.advancing) {
          const adv = canAdvanceJob(bot, personality.type);
          if (adv) {
            entry.advancing = true;
            log.info({ bot: name, level: stats.level, advancement: adv.stage, targetJob: adv.jobId }, 'Triggering job advancement');
            startJobAdvancement(bot, personality.type).then(success => {
              entry.advancing = false;
              if (success) {
                bot.chat(`I advanced to ${adv.choice || adv.name}!`);
              }
            }).catch(() => { entry.advancing = false; });
          }
        }
      }
    });

    // ── Event: SP gained → auto-distribute SP via brain builds ──
    bot.on('spGained', ({ sp }) => {
      if (!alive() || !entry.config.autoSP) return;
      // Delay slightly to let server finish processing
      setTimeout(() => {
        if (entry.disposed) return;
        const distributed = autoDistributeSP(bot, sp);
        if (distributed > 0) {
          log.info({ bot: name, jobId: bot.jobId, spSpent: distributed, spRemaining: sp - distributed }, 'Auto-distributed SP');
        }
      }, 500);
    });

    // ── Event: job changed → announce + update combat rotation ──
    bot.on('jobChanged', ({ jobId, oldJobId }) => {
      if (!alive()) return;
      const classType = getClassType(jobId);
      log.info({ bot: name, oldJobId, newJobId: jobId, classType }, 'Job changed');
      // Distribute any pending SP for the new job (server grants SP on job change)
      if (entry.config.autoSP && bot.sp > 0) {
        setTimeout(() => {
          if (entry.disposed) return;
          autoDistributeSP(bot, bot.sp);
        }, 1000);
      }
    });

    // ── Event: party invite → auto-accept ──
    bot.on('partyInvite', ({ fromCharId, fromName }) => {
      if (Math.random() < 0.7) {
        setTimeout(() => {
          bot.chat(personality.responses.party);
          entry.lastChat = Date.now();
        }, 1000 + Math.random() * 2000);
      }
    });

    // ── Event: guild invite → auto-accept ──
    bot.on('guildInvite', ({ guildId, senderName }) => {
      if (entry.config.autoGuild && !bot.guildId) {
        setTimeout(() => {
          bot.guildJoin(guildId);
          bot.chat('Joined the guild!');
          entry.lastChat = Date.now();
        }, 1000 + Math.random() * 2000);
      }
    });

    // ── Event: trade invite → auto-accept ──
    bot.on('tradeInvite', ({ fromName }) => {
      if (entry.config.autoTrade && !bot.inTrade) {
        setTimeout(() => {
          bot.tradeAccept();
          // Auto-confirm after a short delay
          setTimeout(() => bot.tradeConfirm(), 3000 + Math.random() * 2000);
        }, 1000 + Math.random() * 1500);
      }
    });

    // ── Event: buddy request → auto-accept ──
    bot.on('buddyRequest', ({ charId, name: requesterName }) => {
      if (entry.config.autoBuddy) {
        bot.buddyAccept(charId);
      }
    });

    // ── Respond to player chat (with conversation tracking + reputation) ──
    bot.on('chat', ({ playerId, message }) => {
      if (!alive()) return;
      if (Date.now() - entry.lastChat < 5000) return;

      // Phase 3: reputation tracking
      const playerName = bot.playersNearby.get(playerId) || 'Unknown';
      if (playerName !== 'Unknown' && !mgr.bots.has(playerName)) {
        entry.reputation.seen(playerName);
        const lower_ = message.toLowerCase();
        if (lower_.includes('thanks') || lower_.includes('ty') || lower_.includes('nice') || lower_.includes('cool')) {
          entry.reputation.positive(playerName, 'friendly_chat');
        } else if (lower_.includes('noob') || lower_.includes('ks') || lower_.includes('gtfo') || lower_.includes('bot') || lower_.includes('reported')) {
          entry.reputation.negative(playerName, 'hostile_chat');
        }
        // Friends get priority responses (skip cooldown)
        if (entry.reputation.isFriend(playerName)) {
          // halve the cooldown for friends
        }
      }

      // Per-player cooldown: don't spam the same person (halved for friends)
      const cooldown = entry.reputation.isFriend(playerName) ? 15000 : 30000;
      const lastReply = entry.chatCooldownPerPlayer.get(playerId) || 0;
      if (Date.now() - lastReply < cooldown) return;

      // Track conversation history (rolling window of last 10 messages, 5min expiry)
      let history = entry.conversationHistory.get(playerId);
      if (!history) { history = []; entry.conversationHistory.set(playerId, history); }
      history.push({ msg: message, from: 'player', time: Date.now() });
      // Trim to last 10 and expire old entries
      const fiveMinAgo = Date.now() - 300000;
      while (history.length > 10 || (history.length && history[0].time < fiveMinAgo)) history.shift();

      const lower = message.toLowerCase();
      let response = null;

      // Phase 2: Try context-aware response first (job, training, stats, etc.)
      response = getContextResponse(bot, personality.type, message);

      // Check if player already said hi and we already greeted — vary response
      const alreadyGreeted = history.some(h => h.from === 'bot' && h.type === 'greeting');

      if (response) {
        // context response already set, skip keyword matching
      } else if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey')) {
        if (alreadyGreeted) {
          const followUps = ['Back again?', 'Sup again~', 'Hey hey~', 'Yo!', "What's up?"];
          response = followUps[Math.floor(Math.random() * followUps.length)];
        } else {
          response = personality.responses.hi;
        }
      } else if (lower.includes('party') || lower.includes('pq') || lower.includes('join')) {
        response = personality.responses.party;
      } else if (lower.includes('help') || lower.includes('how')) {
        response = personality.responses.help;
      } else if (lower.includes('buy') || lower.includes('sell') || lower.includes('trade')) {
        response = personality.responses.buy;
      } else if (lower.includes('guild')) {
        response = bot.guildId ? `I'm in ${bot.guildName}!` : 'Looking for guild too!';
      } else if (lower.includes('buff')) {
        response = (personality.type === 'mage' || personality.type === 'sage') ? 'I can buff! Come here~'
          : personality.type === 'necromancer' ? 'I have death auras... come closer.'
          : 'Need buffs!';
      } else if (lower.includes('level') || lower.includes('lvl')) {
        response = `Level ${bot.stats.level} ${personality.type}`;
      } else if (lower.includes('map') || lower.includes('where')) {
        response = `I'm at map ${bot.mapId}`;
      }

      if (response) {
        const isGreeting = lower.includes('hi') || lower.includes('hello') || lower.includes('hey');
        setTimeout(() => {
          if (entry.disposed) return;
          bot.chat(response);
          entry.lastChat = Date.now();
          entry.chatCooldownPerPlayer.set(playerId, Date.now());
          history.push({ msg: response, from: 'bot', time: Date.now(), type: isGreeting ? 'greeting' : 'reply' });
        }, 1000 + Math.random() * 2000);
      } else if (mgr.chatCallback) {
        // Fall back to AI chat when no keyword match
        const playerName = bot.playersNearby.get(playerId) || 'Unknown';
        Promise.resolve(mgr.chatCallback({
          botName: name, personality, playerName, message,
          mapId: bot.mapId, level: bot.stats.level,
          conversationHistory: history,
        })).then(aiReply => {
          if (aiReply && !entry.disposed) {
            const reply = String(aiReply).substring(0, 70);
            bot.chat(reply);
            entry.lastChat = Date.now();
            entry.chatCooldownPerPlayer.set(playerId, Date.now());
            history.push({ msg: reply, from: 'bot', time: Date.now(), type: 'ai' });
          }
        }).catch(() => {});
      }
    });

    // ── Greeting when a player spawns nearby (Phase 3: reputation-aware) ──
    bot.on('playerSpawn', ({ playerId, playerName }) => {
      if (!alive()) return;
      if (Date.now() - entry.lastChat < 10000) return;
      // Phase 3: always greet friends, skip hostile players
      const isFriend = !mgr.bots.has(playerName) && entry.reputation.isFriend(playerName);
      const isHostile = !mgr.bots.has(playerName) && entry.reputation.isHostile(playerName);
      if (isHostile) return; // don't engage with hostile players
      // Dynamic probability: eager in empty maps (40%), quiet in busy maps (5%), always for friends
      const greetProb = isFriend ? 0.9 : Math.max(0.05, 0.4 / Math.max(1, bot.playersNearby.size));
      if (Math.random() < greetProb) {
        const greeting = isFriend
          ? `${playerName}! Good to see you again!`
          : personality.greetings[Math.floor(Math.random() * personality.greetings.length)];
        setTimeout(() => {
          if (entry.disposed) return;
          bot.chat(greeting);
          entry.lastChat = Date.now();
        }, 2000 + Math.random() * 3000);
      }
    });

    // ── Event: whisper received → auto-reply (Phase 2: context-aware) ──
    bot.on('whisper', ({ senderName, message }) => {
      if (!entry.config.whisperReply) return;
      if (Date.now() - entry.lastChat < 3000) return;

      const lower = message.toLowerCase();
      // Try context-aware response first
      let reply = getContextResponse(bot, personality.type, message);

      if (!reply) {
        if (lower.includes('hi') || lower.includes('hello') || lower.includes('hey')) {
          reply = personality.responses.hi;
        } else if (lower.includes('party') || lower.includes('pq')) {
          reply = personality.responses.party;
        } else if (lower.includes('trade') || lower.includes('buy') || lower.includes('sell')) {
          reply = personality.responses.buy;
        } else if (lower.includes('where')) {
          reply = `I'm at map ${bot.mapId}`;
        } else if (lower.includes('level') || lower.includes('lvl')) {
          reply = `Level ${bot.stats.level} ${personality.type}`;
        } else {
          reply = personality.idle[Math.floor(Math.random() * personality.idle.length)];
        }
      }

      if (reply) {
        setTimeout(() => {
          bot.whisper(senderName, reply);
          entry.lastChat = Date.now();
        }, 1000 + Math.random() * 2000);
      }
    });

    // ── Event: reconnect status ──
    bot.on('reconnecting', ({ attempt, delay }) => {
      entry.status = 'reconnecting';
    });
    bot.on('reconnected', () => {
      entry.status = 'online';
      log.info({ bot: name }, 'Bot reconnected, resuming behaviors');
    });
    bot.on('reconnectFailed', () => {
      entry.status = 'disconnected';
      this._saveState(); // persist state before giving up
      log.warn({ bot: name }, 'Bot reconnect failed permanently');
    });

    // ── Handle disconnect/error ──
    bot.on('disconnect', () => {
      if (entry.status !== 'reconnecting') {
        entry.status = 'disconnected';
      }
      this._saveState(); // persist state on disconnect
      log.info({ bot: name }, 'Bot disconnected');
    });

    bot.on('error', (err) => {
      entry.status = 'error';
      log.error({ bot: name, err: err.message }, 'Bot error');
    });

    // Enable auto-reconnect if configured
    if (entry.config.autoReconnect) {
      bot.setAutoReconnect(true, 5);
    }

    // Track level for auto-AP detection
    entry._lastLevel = bot.stats.level;
  }

  /** Move a bot to a specific training map for its level. */
  trainBot(name) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    const targetMap = getTrainingMap(entry.bot.stats.level);
    entry.bot.changeMap(targetMap);
    return { success: true, name, targetMap, level: entry.bot.stats.level };
  }

  /** Make a bot use its class buff skills. */
  buffBot(name) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    const rotation = COMBAT_ROTATIONS[entry.bot.jobId];
    const buffs = rotation ? rotation.buffs : (CLASS_BUFFS[entry.personality.type] || []);
    for (const skillId of buffs) {
      const lvl = entry.bot.skills.get(skillId) || 1;
      entry.bot.useSkill(skillId, lvl);
    }
    return { success: true, name, buffsUsed: buffs.length };
  }

  /** Create a guild with a specific bot. */
  createGuild(botName, guildName) {
    const entry = this.bots.get(botName);
    if (!entry) return { success: false, error: 'Bot not found' };
    entry.bot.guildCreate(guildName);
    return { success: true, bot: botName, guildName };
  }

  /** Make all bots add each other as buddies. */
  addAllBuddies() {
    const names = [...this.bots.keys()];
    let count = 0;
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        const entryA = this.bots.get(a);
        if (entryA.status === 'online') {
          entryA.bot.buddyAdd(b);
          count++;
        }
      }
    }
    return { success: true, pairsSent: count };
  }

  /** Initiate a trade between two bots. */
  tradeBots(nameA, nameB) {
    const a = this.bots.get(nameA);
    const b = this.bots.get(nameB);
    if (!a || !b) return { success: false, error: 'Bot not found' };
    if (a.bot.mapId !== b.bot.mapId) return { success: false, error: 'Bots must be on same map' };
    a.bot.tradeCreate();
    setTimeout(() => a.bot.tradeInvite(b.bot.charId), 1500);
    return { success: true, from: nameA, to: nameB };
  }

  /** Send a megaphone message from a specific bot. */
  megaphoneBot(name, message) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    entry.bot.megaphone(message);
    return { success: true, name, message };
  }

  /** Send a whisper from a bot to a specific player. */
  whisperBot(name, targetName, message) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    entry.bot.whisper(targetName, message);
    return { success: true, from: name, to: targetName, message };
  }

  /** Give fame from one bot to another. */
  fameBot(fromName, toOid) {
    const entry = this.bots.get(fromName);
    if (!entry) return { success: false, error: 'Bot not found' };
    entry.bot.giveFame(toOid, true);
    return { success: true, from: fromName };
  }

  /** Force all bots to fame each other (where possible). */
  fameAll() {
    let count = 0;
    for (const [nameA, entryA] of this.bots) {
      if (entryA.status !== 'online') continue;
      if (entryA.bot.stats.level < 15) continue;
      for (const [nameB, entryB] of this.bots) {
        if (nameA === nameB) continue;
        if (entryB.bot.mapId !== entryA.bot.mapId) continue;
        // Find B's oid in A's playersNearby
        for (const [oid, pName] of entryA.bot.playersNearby) {
          if (pName === nameB) {
            const lastFamed = entryA.fameHistory?.get(nameB) || 0;
            if (Date.now() - lastFamed >= FAME_COOLDOWN_MS) {
              entryA.bot.giveFame(oid, true);
              if (!entryA.fameHistory) entryA.fameHistory = new Map();
              entryA.fameHistory.set(nameB, Date.now());
              count++;
            }
            break;
          }
        }
      }
    }
    return { success: true, famesSent: count };
  }

  /** Set loot filter for a specific bot.
   * @param {string} name - bot name
   * @param {string} mode - 'all'|'valuable'|'none'
   */
  setLootFilter(name, mode) {
    const entry = this.bots.get(name);
    if (!entry) return { success: false, error: 'Bot not found' };
    switch (mode) {
      case 'all':
        entry.bot.setLootFilter(null);
        break;
      case 'valuable':
        entry.bot.setLootFilter((itemId, isMeso) => {
          if (isMeso) return true;
          if (JUNK_ITEMS.has(itemId)) return false;
          return isValuableItem(itemId);
        });
        break;
      case 'none':
        entry.bot.setLootFilter(() => false);
        break;
      default:
        return { success: false, error: 'mode must be all|valuable|none' };
    }
    return { success: true, name, lootMode: mode };
  }

  // ── State persistence ───────────────────────────────────────────────────

  /** Save all bot states to disk. */
  _saveState() {
    try {
      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      const states = {};
      for (const [name, entry] of this.bots) {
        states[name] = {
          ...entry.bot.exportState(),
          personalityIndex: PERSONALITIES.findIndex(p => p.name === entry.personality.name),
          combatStats: entry.combatStats,
          config: entry.config,
          fameHistory: [...(entry.fameHistory || new Map()).entries()],
          // Phase 3 persistence
          trainingData: entry.trainingTracker.export(),
          reputationData: entry.reputation.export(),
        };
      }
      writeFileSync(STATE_FILE, JSON.stringify(states, null, 2));
      log.debug({ count: Object.keys(states).length }, 'Bot state saved');
    } catch (err) {
      log.error({ err: err.message }, 'Failed to save bot state');
    }
  }

  /** Load bot states from disk (call at startup to see what was saved). */
  loadSavedState() {
    try {
      if (!existsSync(STATE_FILE)) return null;
      const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      log.info({ count: Object.keys(data).length }, 'Loaded saved bot state');
      return data;
    } catch (err) {
      log.error({ err: err.message }, 'Failed to load bot state');
      return null;
    }
  }

  /** Restore bots from saved state. Spawns them with their previous config/stats. */
  async restoreBots() {
    const saved = this.loadSavedState();
    if (!saved) return { success: false, error: 'No saved state found' };

    const results = [];
    for (const [name, state] of Object.entries(saved)) {
      const pIdx = state.personalityIndex ?? -1;
      if (pIdx < 0) continue;

      // Spawn with saved personality
      const result = await this.spawnBot(pIdx);
      if (result.success) {
        const entry = this.bots.get(result.name);
        if (entry) {
          // Restore saved config
          if (state.config) Object.assign(entry.config, state.config);
          // Restore combat stats
          if (state.combatStats) Object.assign(entry.combatStats, state.combatStats);
          // Restore fame history
          if (state.fameHistory) {
            entry.fameHistory = new Map(state.fameHistory);
          }
          // Phase 3: restore training and reputation data
          if (state.trainingData) entry.trainingTracker.import(state.trainingData);
          if (state.reputationData) entry.reputation.import(state.reputationData);
          // Import saved state into bot
          entry.bot.importState(state);
        }
      }
      results.push(result);
    }
    return { success: true, restored: results.filter(r => r.success).length, results };
  }

  // Optional: set AI callback for dynamic chat
  setAIChatCallback(fn) {
    this.chatCallback = fn;
  }

  // ── Phase 3: Boss raid launcher ──

  /** Launch a boss raid with all eligible bots.
   * @param {string} bossId - 'zakum', 'horntail', 'pinkbean', 'papulatus'
   */
  async launchBossRaid(bossId) {
    const boss = BOSS_RAIDS[bossId];
    if (!boss) return { success: false, error: `Unknown boss: ${bossId}` };

    // Check readiness of all bots
    const ready = findBossParty(this.bots, bossId);
    if (ready.length < boss.minPartySize) {
      return { success: false, error: `Need ${boss.minPartySize}+ bots at lv${boss.recommendedLevel}, only ${ready.length} ready`, ready };
    }

    // Mark participating bots
    for (const p of ready.slice(0, 6)) {
      const entry = this.bots.get(p.name);
      if (entry) entry.bossing = true;
    }

    const result = await startBossRaid(this.bots, bossId);

    // Unmark after raid
    for (const p of ready.slice(0, 6)) {
      const entry = this.bots.get(p.name);
      if (entry) entry.bossing = false;
    }

    return result;
  }

  /** Check boss readiness for all bots.
   * @param {string} bossId
   */
  checkBossReady(bossId) {
    const results = [];
    for (const [name, entry] of this.bots) {
      if (entry.status !== 'online') continue;
      const check = checkBossReadiness(entry.bot, bossId);
      results.push({ name, ...check });
    }
    return results;
  }

  /** Get net worth summary for all bots. */
  getEconomy() {
    const summary = [];
    for (const [name, entry] of this.bots) {
      if (entry.status !== 'online') continue;
      summary.push({
        name,
        meso: entry.bot.stats.meso,
        netWorth: estimateNetWorth(entry.bot),
        friends: entry.reputation.getFriends(5),
        killRate: entry.trainingTracker.getKillRate(entry.bot.mapId),
      });
    }
    return summary;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

export const botManager = new BotManager();
export default botManager;
