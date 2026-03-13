/**
 * modules/maplestory/custom-quests.js — 5 custom quests for MapleStory Cosmic.
 *
 * Creates quest scripts in workspace/Cosmic/scripts/quest/ using the standard
 * OdinMS quest script API (qm object). Each quest uses item collection as its
 * completion mechanic, verified server-side via qm.haveItem().
 *
 * Quest IDs: 99001–99005 (custom range, well above all live quests ~20xxx)
 *
 *   99001  Mushroom Menace        Scout Raven (9999003)      Perion (102000000)
 *   99002  Potion Ingredients     Alchemist Luna (9999002)   Ellinia (101000000)
 *   99003  Lost Treasure Map      Captain Flint (9999008)    Lith Harbor (104000000)
 *   99004  Arena Challenge        Arena Master Rex (9999006) Henesys (100000000)
 *   99005  Blacksmith's Request   Blacksmith Taro (9999001)  Henesys (100000000)
 *
 * Idempotent — skips writing if script already exists.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:quests');

const QUEST_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'quest');

// ── Quest Definitions ─────────────────────────────────────────────────────────

/**
 * Each quest definition:
 *   questId        — unique ID (99001–99005)
 *   name           — quest display name
 *   npcId          — NPC that gives/completes the quest
 *   npcName        — NPC friendly name (for comments)
 *   map            — map ID where NPC resides
 *   requires       — [{ itemId, quantity, itemName }] items needed to complete
 *   rewards        — { exp, meso, items: [{ itemId, quantity }] }
 *   startDialogue  — string[] conversation pages shown before accept/decline
 *   acceptDialogue — string shown as accept/decline prompt
 *   endDialogue    — string shown when player has all items and turns in
 *   failDialogue   — string shown when player talks to end NPC but lacks items
 */
export const CUSTOM_QUESTS = [
  {
    questId: 99001,
    name: 'Mushroom Menace',
    npcId: 9999003,
    npcName: 'Scout Raven',
    map: 102000000, // Perion
    requires: [
      { itemId: 4000003, quantity: 30, itemName: 'Orange Mushroom Cap' },
    ],
    rewards: {
      exp: 5000,
      meso: 0,
      items: [{ itemId: 2002033, quantity: 3 }], // 3x Iron Shield Scroll
    },
    startDialogue: [
      "Traveller! I've been scouting Perion's outskirts, but those Orange Mushrooms are swarming every path. My reports keep getting interrupted by them!",
      'Could you help me out? Hunt those mushrooms and bring me #b30 #t4000003##k as proof. They\'re all over the cliffs east of here.',
    ],
    acceptDialogue: "Bring me 30 #t4000003# and I'll make it worth your while. So... do we have a deal?",
    endDialogue: "You actually did it! Thirty caps — the scouts will be able to move freely again. Take these Shield Scrolls; they're standard-issue ranger protection kits.",
    failDialogue: "You haven't collected all 30 #t4000003# yet. Keep hunting those Orange Mushrooms to the east!",
  },
  {
    questId: 99002,
    name: 'Potion Ingredients',
    npcId: 9999002,
    npcName: 'Alchemist Luna',
    map: 101000000, // Ellinia
    requires: [
      { itemId: 4000007, quantity: 20, itemName: 'Green Mushroom Spore' },
      { itemId: 4000001, quantity: 10, itemName: 'Blue Snail Shell' },
    ],
    rewards: {
      exp: 3000,
      meso: 0,
      items: [{ itemId: 2002031, quantity: 10 }], // 10x Elixir of Rage
    },
    startDialogue: [
      "Oh, wonderful timing! I'm working on a new brew — a formula that channels the raw energy of the forest into pure physical strength.",
      "But I've run short on ingredients. I need #b20 #t4000007##k from the mushrooms in the forest and #b10 #t4000001##k from the blue snails near the lower path.",
    ],
    acceptDialogue: 'Gather me 20 #t4000007# and 10 #t4000001#, and I\'ll give you a batch of the finished product. Deal?',
    endDialogue: "These are perfect! The calcium in the shells reacts with the spore enzymes to produce the activation compound. Here are 10 Elixirs of Rage — bottled strength, ready when you need it most!",
    failDialogue: "I still need the ingredients! Bring me 20 #t4000007# from the green mushrooms AND 10 #t4000001# from the blue snails.",
  },
  {
    questId: 99003,
    name: 'Lost Treasure Map',
    npcId: 9999008,
    npcName: 'Captain Flint',
    map: 104000000, // Lith Harbor
    requires: [
      { itemId: 4000016, quantity: 5, itemName: 'Jr. Necki Fur' },
    ],
    rewards: {
      exp: 4000,
      meso: 50000,
      items: [{ itemId: 2030021, quantity: 3 }], // 3x Return Scroll
    },
    startDialogue: [
      "Yar har! You look like someone who doesn't mind a bit of danger. I've heard tales of treasure buried somewhere in this region — old stories, but I believe every word!",
      "The Jr. Neckis are said to be cursed guardians of the treasure routes. Bring me #b5 #t4000016##k and I'll know you've properly searched the area. Then we'll talk reward.",
    ],
    acceptDialogue: "Prove yourself — bring me 5 #t4000016# from those cursed Neckis. Then I'll share the reward. Agreed?",
    endDialogue: "Five furs! You've done well, adventurer. The treasure may yet be found someday — but for now, take this gold and these scrolls. A captain always honours his word!",
    failDialogue: "I need 5 #t4000016# from the Jr. Neckis before I can trust you with the reward. Keep searching!",
  },
  {
    questId: 99004,
    name: 'Arena Challenge',
    npcId: 9999006,
    npcName: 'Arena Master Rex',
    map: 100000000, // Henesys
    requires: [
      { itemId: 4000006, quantity: 30, itemName: "Pig's Head" },
    ],
    rewards: {
      exp: 3000,
      meso: 0,
      items: [{ itemId: 2002035, quantity: 5 }], // 5x Lucky Clover
    },
    startDialogue: [
      "You! Yes, you — you look like you've got fire in your eyes. The Arena Master recognises potential when he sees it.",
      "Prove your fighting spirit. Hunt down the pigs near Henesys and bring me #b30 #t4000006##k. Not for me — for yourself. Combat experience is forged in the field, not in talk.",
    ],
    acceptDialogue: "Bring me 30 #t4000006# and I'll certify you as a proper Arena Challenger. Ready to prove yourself?",
    endDialogue: "Ha! Thirty heads — that's no small feat. You have the makings of a true fighter. Take these Lucky Clovers; fortune favours the bold, and the bold deserve a little luck!",
    failDialogue: "Not enough yet! I need 30 #t4000006# to certify your fighting spirit. The pigs near Henesys won't hunt themselves!",
  },
  {
    questId: 99005,
    name: "Blacksmith's Request",
    npcId: 9999001,
    npcName: 'Blacksmith Taro',
    map: 100000000, // Henesys
    requires: [
      { itemId: 4011000, quantity: 30, itemName: 'Steel Ore' },
    ],
    rewards: {
      exp: 5000,
      meso: 0,
      items: [{ itemId: 1302134, quantity: 1 }], // 1x Crystal Fang
    },
    startDialogue: [
      "Adventurer! Just the person I needed. I'm working on a masterpiece — a blade unlike anything in Henesys — but I've run out of Steel Ore.",
      "Bring me #b30 #t4011000##k. They can be found from harder monsters across the land. In return, I'll forge you the Crystal Fang — my finest work yet.",
    ],
    acceptDialogue: "Bring me 30 #t4011000# and I'll forge you the Crystal Fang. This is a once-in-a-lifetime offer. Deal?",
    endDialogue: "Magnificent! This steel is superb quality. *hammering sounds* There — the Crystal Fang. A blade that channels the power of ancient crystals. It's yours, adventurer. Use it well!",
    failDialogue: "You're short on materials! I need all 30 #t4011000# before I can start the forge. Bring them all at once.",
  },
];

// ── Quest Script Generator ────────────────────────────────────────────────────

/**
 * Escape double-quotes in a dialogue string for embedding in JS string literals.
 */
function esc(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate a proper if–else if chain for start() dialogue pages.
 * Produces correct, executable JavaScript (not `if (false)` nonsense).
 */
function buildStartBody(quest) {
  const { questId, startDialogue, acceptDialogue } = quest;

  const blocks = [];

  // Dialogue pages
  startDialogue.forEach((line, i) => {
    const method = i === 0 ? 'qm.sendNext' : 'qm.sendNextPrev';
    blocks.push({ status: i, code: `${method}("${esc(line)}");` });
  });

  // Accept/decline prompt
  blocks.push({
    status: startDialogue.length,
    code: `qm.sendAcceptDecline("${esc(acceptDialogue)}");`,
  });

  // Force start + dispose
  blocks.push({
    status: startDialogue.length + 1,
    code: `qm.forceStartQuest();\n            qm.dispose();`,
  });

  // Build if–else if chain
  return blocks.map((b, i) => {
    const kw = i === 0 ? 'if' : '} else if';
    return `        ${kw} (status == ${b.status}) {\n            ${b.code}`;
  }).join('\n') + '\n        }';
}

/**
 * Generate the end() body: item checks, reward delivery, quest completion.
 */
function buildEndBody(quest) {
  const { questId, requires, rewards, endDialogue, failDialogue } = quest;

  // Item checks (status == 0)
  const itemChecks = requires.map(r =>
    `        if (!qm.haveItem(${r.itemId}, ${r.quantity})) {\n            qm.sendNext("${esc(failDialogue)}");\n            qm.dispose();\n            return;\n        }`
  ).join('\n');

  // Item removals
  const removals = requires.map(r => `            qm.gainItem(${r.itemId}, -${r.quantity});`).join('\n');

  // Rewards
  const rewardLines = [];
  if (rewards.exp > 0)  rewardLines.push(`            qm.gainExp(${rewards.exp});`);
  if (rewards.meso > 0) rewardLines.push(`            qm.gainMeso(${rewards.meso});`);
  for (const item of rewards.items) {
    rewardLines.push(`            qm.gainItem(${item.itemId}, ${item.quantity});`);
  }

  return `        if (status == 0) {
${itemChecks}
            qm.sendNext("${esc(endDialogue)}");
        } else if (status == 1) {
            if (qm.isQuestCompleted(${questId})) {
                qm.dropMessage(1, "You have already completed this quest.");
                qm.dispose();
                return;
            }
${removals}
${rewardLines.join('\n')}
            qm.forceCompleteQuest();
            qm.dispose();
        }`;
}

/**
 * Produce a complete, syntactically correct OdinMS quest script for one quest.
 */
function generateQuestScript(quest) {
  const { questId, name, npcName, map, requires, rewards } = quest;

  const requiresList = requires.map(r => ` *   ${r.quantity}x ${r.itemName} (${r.itemId})`).join('\n');
  const rewardDesc = [
    rewards.exp > 0 ? ` *   ${rewards.exp} EXP` : null,
    rewards.meso > 0 ? ` *   ${rewards.meso} meso` : null,
    ...rewards.items.map(i => ` *   ${i.quantity}x item ${i.itemId}`),
  ].filter(Boolean).join('\n');

  return `/* Quest ${questId}: ${name}
 * NPC: ${npcName} (map ${map})
 * Requires:
${requiresList}
 * Rewards:
${rewardDesc}
 *
 * Generated by modules/maplestory/custom-quests.js
 */
var status = -1;

function start(mode, type, selection) {
    if (mode == -1) {
        qm.dispose();
        return;
    }
    if (mode == 0 && type > 0) {
        qm.dispose();
        return;
    }
    if (mode == 1) {
        status++;
    } else {
        status--;
    }
${buildStartBody(quest)}
}

function end(mode, type, selection) {
    if (mode == -1) {
        qm.dispose();
        return;
    }
    if (mode == 0 && type > 0) {
        qm.dispose();
        return;
    }
    if (mode == 1) {
        status++;
    } else {
        status--;
    }

${buildEndBody(quest)}
}
`;
}

// ── Deploy ────────────────────────────────────────────────────────────────────

/**
 * Deploy all 5 custom quest scripts to workspace/Cosmic/scripts/quest/.
 * Creates the directory if missing. Idempotent — skips if file already exists.
 */
export function deployCustomQuests() {
  if (!existsSync(QUEST_DIR)) {
    mkdirSync(QUEST_DIR, { recursive: true });
    log.info({ dir: QUEST_DIR }, 'Created quest scripts directory');
  }

  const results = [];

  for (const quest of CUSTOM_QUESTS) {
    const filePath = join(QUEST_DIR, `${quest.questId}.js`);

    if (existsSync(filePath)) {
      log.debug({ questId: quest.questId, name: quest.name }, 'Quest script already exists, skipping');
      results.push({ questId: quest.questId, name: quest.name, created: false, path: filePath });
      continue;
    }

    const code = generateQuestScript(quest);
    writeFileSync(filePath, code, 'utf-8');

    log.info({ questId: quest.questId, name: quest.name, npcId: quest.npcId }, 'Quest script deployed');
    results.push({ questId: quest.questId, name: quest.name, created: true, path: filePath });
  }

  const created = results.filter(r => r.created).length;

  log.info({ created, total: CUSTOM_QUESTS.length }, 'Custom quests deployment complete');

  return {
    success: true,
    total: CUSTOM_QUESTS.length,
    created,
    skipped: CUSTOM_QUESTS.length - created,
    quests: results,
    note: created > 0
      ? 'Quest scripts written. Server restart required to load them in-game.'
      : 'All quest scripts already deployed.',
  };
}

/**
 * Check deployment status of all custom quests.
 */
export function getCustomQuestStatus() {
  return {
    questDir: QUEST_DIR,
    quests: CUSTOM_QUESTS.map(quest => {
      const filePath = join(QUEST_DIR, `${quest.questId}.js`);
      return {
        questId: quest.questId,
        name: quest.name,
        npcId: quest.npcId,
        npcName: quest.npcName,
        map: quest.map,
        scriptExists: existsSync(filePath),
        requires: quest.requires,
        rewards: quest.rewards,
      };
    }),
  };
}

/**
 * Get a human-readable summary of all custom quests.
 */
export function getCustomQuestSummary() {
  return CUSTOM_QUESTS.map(q => ({
    questId: q.questId,
    name: q.name,
    npc: `${q.npcName} (${q.npcId}) @ map ${q.map}`,
    requires: q.requires.map(r => `${r.quantity}x ${r.itemName}`).join(', '),
    rewards: [
      q.rewards.exp > 0 ? `${q.rewards.exp} EXP` : null,
      q.rewards.meso > 0 ? `${q.rewards.meso} meso` : null,
      ...q.rewards.items.map(i => `${i.quantity}x item ${i.itemId}`),
    ].filter(Boolean).join(', '),
  }));
}
