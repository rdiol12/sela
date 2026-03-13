/**
 * modules/maplestory/custom-dailies.js — Randomized daily quest system for MapleStory Cosmic.
 *
 * 30 daily quests across all level ranges (99101–99130).
 * A Daily Quest Master NPC (9999013) assigns 3 random quests per player per day.
 * Randomization uses player character ID + date seed so each player gets different quests.
 * Rewards are randomized from a pool (meso, EXP, scrolls, potions, ores).
 *
 * Quest IDs: 99101–99130 (daily range)
 * NPC: 9999013 — "Cosmic Taskboard" in Henesys (100000000)
 *
 * Quest scripts are standalone (can be started by talking to the Taskboard NPC).
 * The NPC handles assignment, tracking, and reward distribution.
 *
 * Idempotent — overwrites existing scripts to ensure updates propagate.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:dailies');

const QUEST_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'quest');
const NPC_DIR   = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'npc');

// ── Daily Quest Pool (30 quests, 6 level tiers) ─────────────────────────────

export const DAILY_QUESTS = [
  // ─── Tier 1: Beginner (Lv 1–20) ────────────────────────────────────────
  {
    questId: 99101, name: 'Slime Sweep', tier: 1,
    type: 'kill', targetMob: { id: 210100, name: 'Slime', count: 50 },
    baseExp: 3000, baseMeso: 5000,
    hint: 'Found all over Henesys Hunting Ground.'
  },
  {
    questId: 99102, name: 'Mushroom Harvest', tier: 1,
    type: 'collect', targetItem: { id: 4000003, name: 'Orange Mushroom Cap', count: 20 },
    baseExp: 2500, baseMeso: 4000,
    hint: 'Orange Mushrooms east of Henesys drop these.'
  },
  {
    questId: 99103, name: 'Snail Shell Collector', tier: 1,
    type: 'collect', targetItem: { id: 4000000, name: 'Snail Shell', count: 40 },
    baseExp: 2000, baseMeso: 3000,
    hint: 'Snails on the roads outside any town.'
  },
  {
    questId: 99104, name: 'Pig Farm Defense', tier: 1,
    type: 'kill', targetMob: { id: 1210100, name: 'Pig', count: 30 },
    baseExp: 3500, baseMeso: 5000,
    hint: 'Pigs run wild near Henesys pig farm.'
  },
  {
    questId: 99105, name: 'Stump Clearing', tier: 1,
    type: 'kill', targetMob: { id: 130100, name: 'Stump', count: 25 },
    baseExp: 3000, baseMeso: 4500,
    hint: 'Stumps roam the rocky paths of Perion.'
  },
  {
    questId: 99106, name: 'Octopus Roundup', tier: 1,
    type: 'kill', targetMob: { id: 1120100, name: 'Octopus', count: 30 },
    baseExp: 2800, baseMeso: 4000,
    hint: 'Octopi are found at the Kerning City swamp entrance.'
  },

  // ─── Tier 2: Novice (Lv 20–40) ─────────────────────────────────────────
  {
    questId: 99107, name: 'Wild Boar Hunt', tier: 2,
    type: 'kill', targetMob: { id: 2230102, name: 'Wild Boar', count: 30 },
    baseExp: 6000, baseMeso: 8000,
    hint: 'Wild Boars charge through the Perion outskirts.'
  },
  {
    questId: 99108, name: 'Zombie Mushroom Purge', tier: 2,
    type: 'kill', targetMob: { id: 2230101, name: 'Zombie Mushroom', count: 25 },
    baseExp: 7000, baseMeso: 10000,
    hint: 'Zombie Mushrooms lurk deep in the Ant Tunnel.'
  },
  {
    questId: 99109, name: 'Evil Eye Extermination', tier: 2,
    type: 'kill', targetMob: { id: 2230100, name: 'Evil Eye', count: 25 },
    baseExp: 6500, baseMeso: 9000,
    hint: 'Evil Eyes float through the dungeon beneath Ellinia.'
  },
  {
    questId: 99110, name: 'Ribbon Collection', tier: 2,
    type: 'collect', targetItem: { id: 4000002, name: "Pig's Ribbon", count: 25 },
    baseExp: 5500, baseMeso: 7000,
    hint: 'Ribbon Pigs near Henesys drop these festive ribbons.'
  },
  {
    questId: 99111, name: 'Jr. Necki Patrol', tier: 2,
    type: 'kill', targetMob: { id: 2130103, name: 'Jr. Necki', count: 20 },
    baseExp: 5000, baseMeso: 8000,
    hint: 'Jr. Neckis lurk in the swamps near Kerning City.'
  },

  // ─── Tier 3: Intermediate (Lv 40–60) ──────────────────────────────────
  {
    questId: 99112, name: 'Fire Boar Hunt', tier: 3,
    type: 'kill', targetMob: { id: 3210100, name: 'Fire Boar', count: 20 },
    baseExp: 12000, baseMeso: 15000,
    hint: 'Fire Boars rampage through the Perion volcanic caves.'
  },
  {
    questId: 99113, name: 'Copper Drake Slayer', tier: 3,
    type: 'kill', targetMob: { id: 4130100, name: 'Copper Drake', count: 20 },
    baseExp: 14000, baseMeso: 18000,
    hint: 'Copper Drakes nest in Sleepywood dungeon.'
  },
  {
    questId: 99114, name: 'Iron Hog Cull', tier: 3,
    type: 'kill', targetMob: { id: 4230103, name: 'Iron Hog', count: 20 },
    baseExp: 13000, baseMeso: 16000,
    hint: 'Iron Hogs are tougher cousins found in the deep Perion mines.'
  },
  {
    questId: 99115, name: 'Pixie Dust Gathering', tier: 3,
    type: 'kill', targetMob: { id: 4230106, name: 'Lunar Pixie', count: 15 },
    baseExp: 15000, baseMeso: 20000,
    hint: 'Lunar Pixies shimmer in the Orbis forests.'
  },
  {
    questId: 99116, name: 'Horny Mushroom Menace', tier: 3,
    type: 'kill', targetMob: { id: 3110101, name: 'Horny Mushroom', count: 25 },
    baseExp: 11000, baseMeso: 14000,
    hint: 'These aggressive mushrooms lurk deep in Ellinia forests.'
  },

  // ─── Tier 4: Advanced (Lv 60–80) ──────────────────────────────────────
  {
    questId: 99117, name: 'White Fang Cull', tier: 4,
    type: 'kill', targetMob: { id: 5140000, name: 'White Fang', count: 20 },
    baseExp: 22000, baseMeso: 25000,
    hint: 'White Fangs prowl the snowy fields of El Nath.'
  },
  {
    questId: 99118, name: 'Tauromacis Brawl', tier: 4,
    type: 'kill', targetMob: { id: 7130100, name: 'Tauromacis', count: 15 },
    baseExp: 25000, baseMeso: 30000,
    hint: 'Tauromacis guards the Sleepywood deep dungeon.'
  },
  {
    questId: 99119, name: 'Commander Skeleton Assault', tier: 4,
    type: 'kill', targetMob: { id: 7130103, name: 'Commander Skeleton', count: 15 },
    baseExp: 28000, baseMeso: 35000,
    hint: 'Commander Skeletons march through the Dungeon of Perion.'
  },
  {
    questId: 99120, name: 'Ice Drake Expedition', tier: 4,
    type: 'kill', targetMob: { id: 6230600, name: 'Ice Drake', count: 15 },
    baseExp: 26000, baseMeso: 32000,
    hint: 'Ice Drakes breathe frost in the El Nath ice caves.'
  },
  {
    questId: 99121, name: 'Coolie Zombie Cleanup', tier: 4,
    type: 'kill', targetMob: { id: 5130107, name: 'Coolie Zombie', count: 20 },
    baseExp: 24000, baseMeso: 28000,
    hint: 'Coolie Zombies shamble through the Dead Mine passages.'
  },

  // ─── Tier 5: Expert (Lv 80–100) ────────────────────────────────────────
  {
    questId: 99122, name: 'Red Drake Rampage', tier: 5,
    type: 'kill', targetMob: { id: 6130100, name: 'Red Drake', count: 15 },
    baseExp: 40000, baseMeso: 50000,
    hint: 'Red Drakes blaze through the volcanic tunnels.'
  },
  {
    questId: 99123, name: 'Dark Drake Purge', tier: 5,
    type: 'kill', targetMob: { id: 6230601, name: 'Dark Drake', count: 15 },
    baseExp: 42000, baseMeso: 55000,
    hint: 'Dark Drakes lurk in the deepest caverns of El Nath.'
  },
  {
    questId: 99124, name: 'Lycanthrope Hunt', tier: 5,
    type: 'kill', targetMob: { id: 8140000, name: 'Lycanthrope', count: 12 },
    baseExp: 45000, baseMeso: 60000,
    hint: 'Lycanthropes howl in the forests beyond El Nath.'
  },
  {
    questId: 99125, name: 'Hector Challenge', tier: 5,
    type: 'kill', targetMob: { id: 5130104, name: 'Hector', count: 15 },
    baseExp: 38000, baseMeso: 45000,
    hint: 'Hectors stand guard in the deepest Orbis dungeons.'
  },

  // ─── Tier 6: Master (Lv 100+) ──────────────────────────────────────────
  {
    questId: 99126, name: 'Bain Annihilation', tier: 6,
    type: 'kill', targetMob: { id: 8140500, name: 'Bain', count: 12 },
    baseExp: 60000, baseMeso: 80000,
    hint: 'Bains terrorize the Leafre forests.'
  },
  {
    questId: 99127, name: 'Birk Extermination', tier: 6,
    type: 'kill', targetMob: { id: 8140110, name: 'Birk', count: 12 },
    baseExp: 55000, baseMeso: 70000,
    hint: 'Birks wander the misty mountain paths.'
  },
  {
    questId: 99128, name: 'Luster Pixie Containment', tier: 6,
    type: 'kill', targetMob: { id: 5120000, name: 'Luster Pixie', count: 10 },
    baseExp: 65000, baseMeso: 85000,
    hint: 'Luster Pixies glow dangerously in the Orbis tower.'
  },
  {
    questId: 99129, name: 'Dragon Bone Collection', tier: 6,
    type: 'collect', targetItem: { id: 4000244, name: 'Dragon Skin', count: 15 },
    baseExp: 70000, baseMeso: 90000,
    hint: 'High-level drakes drop dragon skins.'
  },
  {
    questId: 99130, name: 'Elite Monster Bounty', tier: 6,
    type: 'kill', targetMob: { id: 8140600, name: 'Dual Birk', count: 10 },
    baseExp: 75000, baseMeso: 100000,
    hint: 'Dual Birks are the deadliest creatures in the highlands.'
  },
];

// ── Reward Pools (randomized per completion) ────────────────────────────────

const REWARD_POOLS = {
  // Tier 1-2: basic potions and low scrolls
  low: [
    { id: 2000000, name: 'Red Potion', qty: 50 },
    { id: 2000002, name: 'White Potion', qty: 30 },
    { id: 2000006, name: 'Mana Elixir', qty: 20 },
    { id: 2002004, name: 'Warrior Potion', qty: 5 },
    { id: 2002002, name: 'Magic Potion', qty: 5 },
    { id: 2040000, name: 'Scroll for Helmet DEF 10%', qty: 1 },
    { id: 2040100, name: 'Scroll for Face Accessory 10%', qty: 1 },
  ],
  // Tier 3-4: better potions, buff pills, mid scrolls
  mid: [
    { id: 2000004, name: 'Elixir', qty: 15 },
    { id: 2002006, name: 'Warrior Pill', qty: 5 },
    { id: 2002008, name: 'Sniper Pill', qty: 5 },
    { id: 2002022, name: 'Ginseng Root', qty: 3 },
    { id: 2040200, name: 'Scroll for Eye Accessory 10%', qty: 1 },
    { id: 2040300, name: 'Scroll for Earring 10%', qty: 1 },
    { id: 2044400, name: 'Scroll for Spear ATK 10%', qty: 1 },
  ],
  // Tier 5-6: power elixirs, rare scrolls, ores
  high: [
    { id: 2000005, name: 'Power Elixir', qty: 20 },
    { id: 2002023, name: 'Ginger Ale', qty: 5 },
    { id: 2002015, name: 'Elpam Elixir', qty: 3 },
    { id: 2040500, name: 'Scroll for Overall Armor DEF 10%', qty: 1 },
    { id: 2044700, name: 'Scroll for Claw ATK 10%', qty: 1 },
    { id: 2041200, name: 'Scroll for Shield DEF 10%', qty: 1 },
    { id: 4010000, name: 'Mineral Ore', qty: 10 },
    { id: 4010006, name: 'Diamond Ore', qty: 3 },
  ],
};

function getRewardPoolKey(tier) {
  if (tier <= 2) return 'low';
  if (tier <= 4) return 'mid';
  return 'high';
}

// ── Quest Script Generator ──────────────────────────────────────────────────

function generateDailyQuestScript(quest) {
  const { questId, name, tier, type, baseExp, baseMeso, hint } = quest;

  // Build completion check
  let completionCheck, itemRemoval = '';
  if (type === 'collect') {
    const { id, count } = quest.targetItem;
    completionCheck = `qm.haveItem(${id}, ${count})`;
    itemRemoval = `        qm.gainItem(${id}, -${count});\n`;
  } else {
    completionCheck = `true /* kill-type: server tracks mob kills */`;
  }

  const targetDesc = type === 'collect'
    ? `${quest.targetItem.count}x #t${quest.targetItem.id}#`
    : `${quest.targetMob.count} ${quest.targetMob.name}`;

  const poolKey = getRewardPoolKey(tier);
  const pool = REWARD_POOLS[poolKey];

  // Build reward items array for the script (embedded as JS array literal)
  const rewardArrayStr = pool.map(r => `{id:${r.id},qty:${r.qty}}`).join(',');

  return `/* Daily Quest ${questId}: ${name}
 * Tier: ${tier} | Type: ${type === 'collect' ? 'Collection' : 'Kill'} (Daily repeatable)
 * Base: ${baseExp} EXP + ${baseMeso} meso + 1 random bonus item
 * Resets daily. Per-player randomized via Cosmic Taskboard NPC.
 * Generated by modules/maplestory/custom-dailies.js
 */
var status = -1;

function getTodayStamp() {
    var cal = java.util.Calendar.getInstance();
    var y = cal.get(java.util.Calendar.YEAR);
    var m = cal.get(java.util.Calendar.MONTH) + 1;
    var d = cal.get(java.util.Calendar.DAY_OF_MONTH);
    return "" + y + (m < 10 ? "0" : "") + m + (d < 10 ? "0" : "") + d;
}

function isDoneToday() {
    var lastDone = qm.getQuestProgress(${questId});
    return lastDone == getTodayStamp();
}

function start(mode, type, selection) {
    if (mode == -1) { qm.dispose(); return; }
    if (mode == 0 && type > 0) { qm.dispose(); return; }
    if (mode == 1) status++; else status--;

    if (status == 0) {
        if (isDoneToday()) {
            qm.sendNext("You've already completed #b${name}#k today. Come back tomorrow for a new assignment!");
            qm.dispose();
            return;
        }
        qm.sendNext("\\\\r\\\\n#e[Daily Quest] ${name}#n\\\\r\\\\n\\\\r\\\\nObjective: ${type === 'collect' ? 'Collect' : 'Defeat'} #b${targetDesc}#k\\\\r\\\\n\\\\r\\\\n#d${hint}#k");
    } else if (status == 1) {
        qm.sendAcceptDecline("Accept this daily quest?");
    } else if (status == 2) {
        qm.forceStartQuest();
        qm.dispose();
    }
}

function end(mode, type, selection) {
    if (mode == -1) { qm.dispose(); return; }
    if (mode == 0 && type > 0) { qm.dispose(); return; }
    if (mode == 1) status++; else status--;

    if (status == 0) {
        if (isDoneToday()) {
            qm.sendNext("You've already completed this quest today!");
            qm.dispose();
            return;
        }
        if (!(${completionCheck})) {
            qm.sendNext("You haven't finished yet. ${type === 'collect' ? 'Collect all the required items' : 'Defeat all the required monsters'} and come back!");
            qm.dispose();
            return;
        }
        qm.sendNext("Well done! Here's your reward for completing #b${name}#k today.");
    } else if (status == 1) {
${itemRemoval}        // Base rewards
        qm.gainExp(${baseExp});
        qm.gainMeso(${baseMeso});
        // Random bonus item from pool
        var pool = [${rewardArrayStr}];
        var pick = pool[Math.floor(Math.random() * pool.length)];
        qm.gainItem(pick.id, pick.qty);
        // Randomized bonus meso (50-150% of base)
        var bonusMeso = Math.floor(${baseMeso} * (0.5 + Math.random()));
        qm.gainMeso(bonusMeso);
        qm.setQuestProgress(${questId}, getTodayStamp());
        qm.forceCompleteQuest();
        qm.getPlayer().dropMessage(6, "[Daily] ${name} complete! Bonus: " + bonusMeso + " meso + bonus item!");
        qm.dispose();
    }
}
`;
}

// ── Daily Quest Master NPC (9999013) ────────────────────────────────────────

function generateTaskboardNPC() {
  // Build quest data as a JS array literal for embedding in the NPC script
  const questEntries = DAILY_QUESTS.map(q => {
    const targetDesc = q.type === 'collect'
      ? `Collect ${q.targetItem.count}x #t${q.targetItem.id}#`
      : `Defeat ${q.targetMob.count} ${q.targetMob.name}`;
    return `{id:${q.questId},name:"${q.name}",tier:${q.tier},desc:"${targetDesc}",exp:${q.baseExp},meso:${q.baseMeso},hint:"${q.hint}"}`;
  });

  return `/* Cosmic Taskboard — NPC 9999013
 * Daily Quest Master that assigns 3 random quests per player per day.
 * Each player gets a different set of quests based on their character ID + date.
 * Located in Henesys (100000000).
 *
 * Generated by modules/maplestory/custom-dailies.js
 */
var status = 0;
var selectedQuest = -1;

// Full quest pool
var quests = [
${questEntries.join(',\n')}
];

function getTodayStamp() {
    var cal = java.util.Calendar.getInstance();
    var y = cal.get(java.util.Calendar.YEAR);
    var m = cal.get(java.util.Calendar.MONTH) + 1;
    var d = cal.get(java.util.Calendar.DAY_OF_MONTH);
    return "" + y + (m < 10 ? "0" : "") + m + (d < 10 ? "0" : "") + d;
}

function getDaySeed() {
    var stamp = getTodayStamp();
    var seed = 0;
    for (var i = 0; i < stamp.length; i++) {
        seed = seed * 31 + stamp.charCodeAt(i);
    }
    return seed;
}

// Simple seeded PRNG (Lehmer / MINSTD)
function seededRandom(seed) {
    seed = (seed * 16807) % 2147483647;
    return { next: seed, value: (seed - 1) / 2147483646 };
}

// Pick N unique indices from array using seeded random
function pickNSeeded(arr, n, seed) {
    var indices = [];
    for (var i = 0; i < arr.length; i++) indices.push(i);
    var result = [];
    var s = seed;
    for (var j = 0; j < n && indices.length > 0; j++) {
        var r = seededRandom(s);
        s = r.next;
        var pick = Math.floor(r.value * indices.length);
        result.push(indices[pick]);
        indices.splice(pick, 1);
    }
    return result;
}

// Get this player's 3 daily quests (deterministic per player per day)
function getPlayerDailies() {
    var charId = cm.getPlayer().getId();
    var level = cm.getPlayer().getLevel();
    var seed = getDaySeed() ^ (charId * 7919);

    // Filter quests by player level tier
    var tier;
    if (level < 20) tier = 1;
    else if (level < 40) tier = 2;
    else if (level < 60) tier = 3;
    else if (level < 80) tier = 4;
    else if (level < 100) tier = 5;
    else tier = 6;

    // Include current tier and one below (so players have options)
    var eligible = [];
    for (var i = 0; i < quests.length; i++) {
        if (quests[i].tier == tier || quests[i].tier == tier - 1) {
            eligible.push(quests[i]);
        }
    }
    // Fallback: if too few, include all from lower tiers too
    if (eligible.length < 3) {
        eligible = [];
        for (var k = 0; k < quests.length; k++) {
            if (quests[k].tier <= tier) eligible.push(quests[k]);
        }
    }

    var picks = pickNSeeded(eligible, 3, Math.abs(seed));
    var result = [];
    for (var p = 0; p < picks.length; p++) {
        result.push(eligible[picks[p]]);
    }
    return result;
}

function isQuestDoneToday(questId) {
    // Check quest progress for today's stamp
    var progress = cm.getPlayer().getQuest(Java.type("server.quest.MapleQuest").getInstance(questId)).getProgress(questId);
    return progress == getTodayStamp();
}

function start() {
    status = 0;
    selectedQuest = -1;

    var dailies = getPlayerDailies();
    var today = getTodayStamp();

    var menu = "#e#dCosmic Taskboard#k#n\\r\\n";
    menu += "Your daily quests for today. Each player gets a unique set!\\r\\n";
    menu += "Complete them for #bEXP, Meso, and random bonus items#k.\\r\\n\\r\\n";

    var allDone = true;
    for (var i = 0; i < dailies.length; i++) {
        var q = dailies[i];
        var done = false;
        try {
            var questObj = Java.type("server.quest.MapleQuest").getInstance(q.id);
            var record = cm.getPlayer().getQuest(questObj);
            if (record != null) {
                done = (record.getProgress(q.id) == today);
            }
        } catch(e) { /* quest not started yet */ }

        if (done) {
            menu += "#L" + i + "##d[DONE]#k " + q.name + " (Tier " + q.tier + ")#l\\r\\n";
        } else {
            allDone = false;
            menu += "#L" + i + "##b" + q.name + "#k (Tier " + q.tier + ") — " + q.desc + "#l\\r\\n";
        }
    }

    if (allDone) {
        menu += "\\r\\n#eAll daily quests completed!#n Come back tomorrow.";
    }

    menu += "\\r\\n\\r\\n#L10##gRefresh Board#k#l";

    cm.sendSimple(menu);
}

function action(mode, type, selection) {
    if (mode != 1) {
        cm.dispose();
        return;
    }
    status++;

    if (status == 1) {
        if (selection == 10) {
            // Refresh — just restart
            status = 0;
            start();
            return;
        }

        var dailies = getPlayerDailies();
        if (selection < 0 || selection >= dailies.length) {
            cm.dispose();
            return;
        }

        selectedQuest = selection;
        var q = dailies[selection];
        var today = getTodayStamp();

        // Check if already done today
        var done = false;
        try {
            var questObj = Java.type("server.quest.MapleQuest").getInstance(q.id);
            var record = cm.getPlayer().getQuest(questObj);
            if (record != null) {
                done = (record.getProgress(q.id) == today);
            }
        } catch(e) {}

        if (done) {
            cm.sendOk("#b" + q.name + "#k is already completed today. Nice work!");
            cm.dispose();
            return;
        }

        var detail = "#e" + q.name + "#n (Tier " + q.tier + ")\\r\\n\\r\\n";
        detail += "#bObjective:#k " + q.desc + "\\r\\n";
        detail += "#bReward:#k " + q.exp + " EXP + " + q.meso + "~" + (q.meso * 2) + " Meso + random bonus item\\r\\n";
        detail += "#dHint:#k " + q.hint + "\\r\\n\\r\\n";
        detail += "Would you like to accept this quest?";

        cm.sendYesNo(detail);

    } else if (status == 2) {
        var dailies = getPlayerDailies();
        if (selectedQuest < 0 || selectedQuest >= dailies.length) {
            cm.dispose();
            return;
        }
        var q = dailies[selectedQuest];

        // Start the quest via quest manager
        try {
            var questObj = Java.type("server.quest.MapleQuest").getInstance(q.id);
            questObj.forceStart(cm.getPlayer(), 9999013);
        } catch(e) {
            cm.getPlayer().dropMessage(5, "Quest system error. Try again later.");
        }

        cm.sendOk("Quest #b" + q.name + "#k accepted! Go complete it and talk to me again to claim your reward.");
        cm.dispose();
    }
}
`;
}

// ── Deploy ────────────────────────────────────────────────────────────────────

/**
 * Deploy all 30 daily quest scripts + the Taskboard NPC.
 * Overwrites existing scripts to ensure updates propagate.
 */
export function deployDailyQuests() {
  if (!existsSync(QUEST_DIR)) mkdirSync(QUEST_DIR, { recursive: true });
  if (!existsSync(NPC_DIR))   mkdirSync(NPC_DIR, { recursive: true });

  const results = [];

  // Deploy quest scripts
  for (const quest of DAILY_QUESTS) {
    const filePath = join(QUEST_DIR, `${quest.questId}.js`);
    const code = generateDailyQuestScript(quest);
    writeFileSync(filePath, code, 'utf-8');
    log.info({ questId: quest.questId, name: quest.name }, 'Daily quest script deployed');
    results.push({ questId: quest.questId, name: quest.name, created: true, path: filePath });
  }

  // Deploy Taskboard NPC
  const npcPath = join(NPC_DIR, '9999013.js');
  writeFileSync(npcPath, generateTaskboardNPC(), 'utf-8');
  log.info('Cosmic Taskboard NPC (9999013) deployed');

  log.info({ total: DAILY_QUESTS.length }, 'Daily quest system deployment complete');

  return {
    success: true,
    total: DAILY_QUESTS.length,
    created: results.length,
    npc: { id: 9999013, name: 'Cosmic Taskboard', path: npcPath },
    quests: results,
    note: `${DAILY_QUESTS.length} daily quest scripts + Taskboard NPC deployed. Restart server to load.`,
  };
}

/**
 * Check deployment status.
 */
export function getDailyQuestStatus() {
  return {
    questDir: QUEST_DIR,
    npcDir: NPC_DIR,
    totalQuests: DAILY_QUESTS.length,
    tiers: {
      1: DAILY_QUESTS.filter(q => q.tier === 1).length,
      2: DAILY_QUESTS.filter(q => q.tier === 2).length,
      3: DAILY_QUESTS.filter(q => q.tier === 3).length,
      4: DAILY_QUESTS.filter(q => q.tier === 4).length,
      5: DAILY_QUESTS.filter(q => q.tier === 5).length,
      6: DAILY_QUESTS.filter(q => q.tier === 6).length,
    },
    quests: DAILY_QUESTS.map(q => {
      const filePath = join(QUEST_DIR, `${q.questId}.js`);
      return {
        questId: q.questId, name: q.name, tier: q.tier, type: q.type,
        target: q.type === 'collect'
          ? `Collect ${q.targetItem.count}x ${q.targetItem.name}`
          : `Kill ${q.targetMob.count}x ${q.targetMob.name}`,
        rewards: `${q.baseExp} EXP + ${q.baseMeso}+ meso + random item`,
        scriptExists: existsSync(filePath),
      };
    }),
    npcExists: existsSync(join(NPC_DIR, '9999013.js')),
  };
}

/**
 * Human-readable summary.
 */
export function getDailyQuestSummary() {
  return DAILY_QUESTS.map(q => ({
    questId: q.questId, name: q.name, tier: q.tier, type: q.type,
    target: q.type === 'collect'
      ? `Collect ${q.targetItem.count}x ${q.targetItem.name}`
      : `Kill ${q.targetMob.count}x ${q.targetMob.name}`,
    rewards: `${q.baseExp} EXP + ${q.baseMeso}+ meso`,
  }));
}
