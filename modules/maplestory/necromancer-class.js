/**
 * modules/maplestory/necromancer-class.js — Necromancer custom class for Cosmic v83.
 *
 * Follows the same pattern as custom-class.js (Sage) but for the dark-magic Necromancer.
 *
 * Job IDs: 700 (Necromancer) → 710 (Dark Acolyte) → 711 (Soul Reaper) → 712 (Lich King)
 * Skill IDs: 7001000–7001004 / 7101000–7101005 / 7111000–7111004 / 7121000–7121005
 * Primary stat: INT. Secondary: LUK. Weapons: Wands, Staves.
 *
 * Deployment functions:
 *   deploySkillWz()         — writes 700/710/711/712.img.xml to wz/Skill.wz/
 *   deploySkillStrings()    — inserts Necromancer skill entries into Skill.img.xml
 *   deployAdvancementNpcs() — writes 4 job advancement NPC scripts
 *   deployTrainingMap()     — places advancement NPCs on hub, adds NPC String entries
 *   deployAll()             — runs all of the above in sequence
 *   getNecroDeployStatus()  — reports which pieces are present vs missing
 *
 * Wired into modules/maplestory/index.js as:
 *   maple_deploy_necromancer, maple_necromancer_status, maple_deploy_necro_training
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:necromancer');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SCRIPT_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'npc');
const MAP_DIR    = join(WZ_DIR, 'Map.wz', 'Map', 'Map9');

// ── Necromancer Class Definition ──────────────────────────────────────────────

export const NECROMANCER_CLASS = {
  name: 'Necromancer',
  lore: 'Masters of death and dark magic who summon undead minions and wield necrotic power.',
  primaryStat: 'INT',
  secondaryStat: 'LUK',
  weapons: ['wand', 'staff'],
  jobs: [
    { id: 700, name: 'Necromancer', advLevel: 10,  tier: 1 },
    { id: 710, name: 'Dark Acolyte', advLevel: 30,  tier: 2 },
    { id: 711, name: 'Soul Reaper',  advLevel: 60,  tier: 3 },
    { id: 712, name: 'Lich King',    advLevel: 100, tier: 4 },
  ],

  /**
   * Full skill tree — 22 skills across 4 tiers.
   * Skill IDs follow the 70X1YYY pattern (X=tier, YYY=index).
   */
  skills: {
    // ── Tier 1: Necromancer (700) — 5 skills ──────────────────────────────
    700: [
      {
        id: 7001000,
        name: 'Death Bolt',
        type: 'attack',
        maxLv: 20,
        desc: '[Master Level: 20]\\nLaunches a bolt of dark energy at enemies.\\nDeals dark-element damage.',
        notes: 'Single-target dark bolt. Main damage skill at 1st job. Scales to 2-target at high levels.',
      },
      {
        id: 7001001,
        name: 'Soul Siphon',
        type: 'passive',
        maxLv: 10,
        desc: '[Master Level: 10]\\nPassively drains life from enemies struck by your magic attacks, recovering a portion of damage dealt as HP.',
        notes: 'Life steal on all magic attacks. Makes Necromancer self-sustaining.',
      },
      {
        id: 7001002,
        name: 'Dark Pact',
        type: 'passive',
        maxLv: 15,
        desc: '[Master Level: 15]\\nA pact with the forces of death permanently increases your magic attack power.',
        notes: 'Core INT/MAD passive. Should be maxed first.',
      },
      {
        id: 7001003,
        name: 'Grave Embrace',
        type: 'passive',
        maxLv: 10,
        desc: '[Master Level: 10]\\nThe embrace of death expands your mana reserves, permanently increasing MaxMP.',
        notes: 'MaxMP boost. Allows more skill casts.',
      },
      {
        id: 7001004,
        name: 'Shadow Step',
        type: 'active',
        maxLv: 20,
        desc: '[Master Level: 20]\\nTeleport through the shadow realm, reappearing a short distance away.',
        notes: 'Dark-themed Teleport. Essential mobility. Functionally identical to Mage Teleport.',
      },
    ],

    // ── Tier 2: Dark Acolyte (710) — 6 skills ────────────────────────────
    710: [
      {
        id: 7101000,
        name: 'Bone Spear',
        type: 'attack',
        maxLv: 20,
        desc: '[Master Level: 20]\\nSummons sharpened bones from the earth to impale multiple enemies.\\nDeals dark-element damage.',
        notes: 'Multi-target piercing attack. Main 2nd-job training skill. Hits up to 4 enemies.',
      },
      {
        id: 7101001,
        name: 'Summon Skeleton',
        type: 'summon',
        maxLv: 20,
        desc: '[Master Level: 20]\\nRaises a skeleton warrior from the ground to fight by your side.\\nHigher levels increase skeleton count and strength.',
        notes: 'Signature Necromancer summon. Tanks and deals physical damage.',
      },
      {
        id: 7101002,
        name: 'Curse of Weakness',
        type: 'debuff',
        maxLv: 20,
        desc: '[Master Level: 20]\\nCurses nearby enemies, reducing their attack and defense power.',
        notes: 'AoE debuff. Defense-reducing curse improves party DPS.',
      },
      {
        id: 7101003,
        name: 'Dark Mastery',
        type: 'passive',
        maxLv: 20,
        desc: '[Master Level: 20]\\nDeepens your understanding of dark magic, increasing magic mastery and attack power.',
        notes: 'Core 2nd-job passive. Increases mastery % and MAD.',
      },
      {
        id: 7101004,
        name: 'Corpse Explosion',
        type: 'attack',
        maxLv: 20,
        desc: '[Master Level: 20]\\nDetonates fallen enemies in a violent explosion, dealing massive area damage.',
        notes: 'AoE burst. Most fun skill — punish clustered mobs.',
      },
      {
        id: 7101005,
        name: "Death's Embrace",
        type: 'buff',
        maxLv: 20,
        desc: "[Master Level: 20]\\nEnvelops yourself in death's power, boosting magic attack and MP regeneration.",
        notes: 'Self-buff. Increases MAD and MP regen for the duration.',
      },
    ],

    // ── Tier 3: Soul Reaper (711) — 5 skills ────────────────────────────
    711: [
      {
        id: 7111000,
        name: 'Soul Harvest',
        type: 'attack',
        maxLv: 30,
        desc: '[Master Level: 30]\\nReaps the souls of nearby enemies, dealing dark damage and recovering HP and MP.',
        notes: 'AoE attack with HP/MP drain. Keeps Necromancer alive in mobbing.',
      },
      {
        id: 7111001,
        name: 'Raise Undead Army',
        type: 'summon',
        maxLv: 30,
        desc: '[Master Level: 30]\\nRaises an army of undead minions to overwhelm your foes.\\nHigher levels summon more and stronger undead.',
        notes: 'Multi-summon. The flagship 3rd-job skill. Levels increase army size.',
      },
      {
        id: 7111002,
        name: 'Plague Cloud',
        type: 'attack',
        maxLv: 30,
        desc: '[Master Level: 30]\\nReleases a cloud of pestilence that poisons enemies over time.',
        notes: 'DoT AoE. Stacks with other damage skills.',
      },
      {
        id: 7111003,
        name: 'Soul Shield',
        type: 'buff',
        maxLv: 20,
        desc: '[Master Level: 20]\\nWraps the party in spectral armor, absorbing damage and boosting magic defense.',
        notes: 'Party magic defense buff. Makes Necromancer a viable support.',
      },
      {
        id: 7111004,
        name: 'Death Mark',
        type: 'debuff',
        maxLv: 20,
        desc: '[Master Level: 20]\\nMarks enemies for death, causing them to take increased damage from all sources.',
        notes: 'Boss debuff. Synergizes with all party damage.',
      },
    ],

    // ── Tier 4: Lich King (712) — 6 skills ──────────────────────────────
    712: [
      {
        id: 7121000,
        name: 'Necrotic Blast',
        type: 'attack',
        maxLv: 30,
        desc: '[Master Level: 30]\\nUnleashes a devastating blast of necrotic energy, annihilating groups of enemies.',
        notes: 'Main 4th-job AoE. Hits screen-wide. High damage, dark element.',
      },
      {
        id: 7121001,
        name: 'Summon Lich',
        type: 'summon',
        maxLv: 30,
        desc: '[Master Level: 30]\\nSummons a powerful Lich companion that fights with dark magic.\\nThe ultimate summoning skill of the Necromancer.',
        notes: 'Lich King signature skill. Summons a Lich that casts dark magic independently.',
      },
      {
        id: 7121002,
        name: "Death's Dominion",
        type: 'buff',
        maxLv: 30,
        desc: "[Master Level: 30]\\nEstablishes dominion over death itself, boosting the entire party's magic attack and providing an HP drain aura.",
        notes: 'Party MAD buff with HP drain aura. Necromancer party utility.',
      },
      {
        id: 7121003,
        name: 'Apocalypse',
        type: 'attack',
        maxLv: 30,
        desc: '[Master Level: 30]\\nThe ultimate spell of destruction — dark energy tears through the battlefield, devastating all enemies on screen.',
        notes: 'Hyper skill. Maximum cooldown, maximum damage. Clears the entire screen.',
      },
      {
        id: 7121004,
        name: 'Undying Will',
        type: 'passive',
        maxLv: 10,
        desc: "[Master Level: 10]\\nThe Lich King's will transcends death. Upon dying, there is a chance to revive with a portion of HP restored.",
        notes: 'Death-revive passive. % chance to auto-revive. Classic Lich King fantasy.',
      },
      {
        id: 7121005,
        name: 'Dark Crescendo',
        type: 'passive',
        maxLv: 30,
        desc: '[Master Level: 30]\\nEach consecutive attack builds dark power, stacking a damage bonus. Missing resets the stacks.',
        notes: 'Stacking damage passive. Rewards consistent attack patterns.',
      },
    ],
  },

  // ── NPC IDs for advancement ────────────────────────────────────────────
  npcIds: {
    1: 9990010,  // Dark Apprentice (1st job, Haunted House area)
    2: 9990011,  // Death Disciple (2nd job)
    3: 9990012,  // The Soul Reaper (3rd job)
    4: 9990013,  // The Ancient Lich (4th job)
  },
  npcMapIds: {
    1: 682000100,  // Haunted House (El Nath haunted area)
    2: 682000100,
    3: 682000200,
    4: 682000300,
  },
  npcNames: ['Mordecai the Gravedigger', 'Lady Vesper', 'The Bone Oracle', "Kael'Mortis the Eternal"],
};

// ── Skill WZ XML Generation ──────────────────────────────────────────────────

/**
 * Generate one level block for a skill entry.
 * Mirrors the stats that are already in the WZ files (as reference data).
 */
function buildSkillLevelXml(skillId, level, maxLevel, skillType) {
  const lines = [];
  lines.push(`        <imgdir name="${level}">`);

  if (skillType === 'attack') {
    const baseD  = 100 + Math.round((level / maxLevel) * 200);  // 100–300%
    const mpCon  = Math.round(8  + (level / maxLevel) * 22);    // 8–30
    const mobs   = level >= 10 ? 4 : (level >= 5 ? 2 : 1);
    const range  = 350 + level * 10;
    lines.push(`          <int name="damage" value="${baseD}"/>`);
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="attackCount" value="1"/>`);
    lines.push(`          <int name="mobCount" value="${mobs}"/>`);
    lines.push(`          <int name="range" value="${range}"/>`);
  } else if (skillType === 'summon') {
    const mpCon  = Math.round(20 + (level / maxLevel) * 40);
    const sumDmg = Math.round(80 + level * 5);
    const time   = Math.round(30 + level * 2);
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="summonDamage" value="${sumDmg}"/>`);
    lines.push(`          <int name="time" value="${time}"/>`);
  } else if (skillType === 'buff' || skillType === 'debuff') {
    const mpCon  = Math.round(18 + (level / maxLevel) * 22);
    const time   = Math.round(30 + level * 2);
    const x      = level * 3;
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="time" value="${time}"/>`);
    lines.push(`          <int name="x" value="${x}"/>`);
  } else if (skillType === 'passive') {
    const x = level * 3;
    const y = level * 2;
    lines.push(`          <int name="x" value="${x}"/>`);
    lines.push(`          <int name="y" value="${y}"/>`);
  } else {
    // active / teleport
    const mpCon = Math.round(12 + (level / maxLevel) * 13);
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="x" value="${level}"/>`);
  }

  lines.push(`        </imgdir>`);
  return lines.join('\n');
}

/**
 * Build a complete Skill.wz img XML for one job tier.
 */
function buildSkillImgXml(jobId) {
  const job    = NECROMANCER_CLASS.jobs.find(j => j.id === jobId);
  const skills = NECROMANCER_CLASS.skills[jobId];
  if (!skills) throw new Error(`No skills defined for job ${jobId}`);

  const tierNames = { 700: 'Necromancer (1st Job)', 710: 'Dark Acolyte (2nd Job)', 711: 'Soul Reaper (3rd Job)', 712: 'Lich King (4th Job)' };

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(`<imgdir name="${jobId}.img">`);
  lines.push('  <imgdir name="info">');
  lines.push('    <canvas name="icon" width="26" height="30">');
  lines.push('      <vector name="origin" x="-4" y="30"/>');
  lines.push('    </canvas>');
  lines.push('  </imgdir>');
  lines.push('  <imgdir name="skill">');
  lines.push(`    <!-- ${'═'.repeat(65)} -->`);
  lines.push(`    <!-- ${tierNames[jobId].padEnd(64)}-->`);
  lines.push(`    <!-- Theme: Dark magic + undead summoning${' '.repeat(24)}-->`);
  lines.push(`    <!-- ${'═'.repeat(65)} -->`);

  for (const skill of skills) {
    lines.push('');
    lines.push(`    <!-- ${skill.name} (${skill.id}) - ${skill.notes || skill.desc.slice(0, 50)} -->`);
    lines.push(`    <imgdir name="${skill.id}">`);
    lines.push(`      <int name="masterLevel" value="${skill.maxLv}"/>`);
    lines.push(`      <int name="action" value="1"/>`);
    if (skill.type === 'attack' || skill.type === 'summon') {
      lines.push(`      <int name="elemAttr" value="4"/><!--  dark element -->`);
    }
    lines.push(`      <imgdir name="common">`);
    lines.push(`        <int name="maxLevel" value="${skill.maxLv}"/>`);
    lines.push(`      </imgdir>`);
    for (const iconName of ['icon', 'iconMouseOver', 'iconDisabled']) {
      lines.push(`      <canvas name="${iconName}" width="32" height="32">`);
      lines.push(`        <vector name="origin" x="0" y="32"/>`);
      lines.push(`        <int name="z" value="0"/>`);
      lines.push(`      </canvas>`);
    }
    lines.push(`      <imgdir name="level">`);
    for (let lv = 1; lv <= skill.maxLv; lv++) {
      lines.push(buildSkillLevelXml(skill.id, lv, skill.maxLv, skill.type));
    }
    lines.push(`      </imgdir>`);
    lines.push(`    </imgdir>`);
  }

  lines.push('  </imgdir>');
  lines.push('</imgdir>');
  return lines.join('\n');
}

/**
 * Write all 4 Necromancer Skill WZ XML files to wz/Skill.wz/.
 * Skips if file already exists (from prior deployment).
 */
export function deploySkillWz() {
  const results = [];
  for (const job of NECROMANCER_CLASS.jobs) {
    const outPath = join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`);
    if (existsSync(outPath)) {
      results.push({ jobId: job.id, jobName: job.name, status: 'already_exists', path: outPath });
      log.info(`Skill WZ for ${job.name} (${job.id}) already exists — skipping`);
      continue;
    }
    const xml = buildSkillImgXml(job.id);
    writeFileSync(outPath, xml, 'utf-8');
    results.push({ jobId: job.id, jobName: job.name, status: 'written', path: outPath });
    log.info({ jobId: job.id, jobName: job.name }, 'Necromancer Skill WZ written');
  }
  return results;
}

// ── Skill String Entries ─────────────────────────────────────────────────────

function buildNecroSkillStringEntries() {
  const lines = [];
  const tierNames = {
    700: 'Necromancer (Job 700) — 1st Job: Base Necromancer',
    710: 'Dark Acolyte (Job 710) — 2nd Job',
    711: 'Soul Reaper (Job 711) — 3rd Job',
    712: 'Lich King (Job 712) — 4th Job',
  };
  for (const job of NECROMANCER_CLASS.jobs) {
    lines.push(`  <!-- ${tierNames[job.id].padEnd(64)}-->`);
    for (const skill of NECROMANCER_CLASS.skills[job.id]) {
      lines.push(`  <imgdir name="${skill.id}">`);
      lines.push(`    <string name="name" value="${skill.name}"/>`);
      lines.push(`    <string name="desc" value="${skill.desc}"/>`);
      lines.push(`  </imgdir>`);
    }
  }
  return lines.join('\n');
}

/**
 * Append Necromancer skill string entries to wz/String.wz/Skill.img.xml.
 * Skips if entries already present.
 */
export function deploySkillStrings() {
  const skillStringPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (!existsSync(skillStringPath)) {
    return { status: 'file_not_found', path: skillStringPath };
  }

  let xml = readFileSync(skillStringPath, 'utf-8');

  // Check if Necromancer entries already exist
  if (xml.includes('7001000')) {
    log.info('Necromancer skill strings already present in Skill.img.xml — skipping');
    return { status: 'already_exists', path: skillStringPath };
  }

  // Insert before final closing tag
  const insertPoint = xml.lastIndexOf('</imgdir>');
  if (insertPoint === -1) {
    return { status: 'error', message: 'Could not find closing </imgdir> in Skill.img.xml' };
  }

  const newEntries = '\n' + buildNecroSkillStringEntries() + '\n';
  xml = xml.slice(0, insertPoint) + newEntries + xml.slice(insertPoint);
  writeFileSync(skillStringPath, xml, 'utf-8');

  const skillCount = Object.values(NECROMANCER_CLASS.skills).flat().length;
  log.info({ skillCount }, 'Necromancer skill strings written to Skill.img.xml');
  return { status: 'written', path: skillStringPath, skillCount };
}

// ── NPC Advancement Scripts ───────────────────────────────────────────────────

function buildNecroAdvancementScript(tier) {
  const job     = NECROMANCER_CLASS.jobs[tier - 1];
  const prevJob = NECROMANCER_CLASS.jobs[tier - 2];
  const npcName = NECROMANCER_CLASS.npcNames[tier - 1];
  const npcId   = NECROMANCER_CLASS.npcIds[tier];

  const skills    = NECROMANCER_CLASS.skills[job.id];
  const toTeach   = skills.filter(s => s.type === 'passive').slice(0, 2);
  const teachLines = toTeach.map(s => `        cm.teachSkill(${s.id}, 0, ${s.maxLv}, -1);`).join('\n');

  const jobCheck = tier === 1
    ? `cm.getJobId() == 0`
    : `cm.getJobId() == ${prevJob.id}`;

  const jobCheckFail = tier === 1
    ? `"You seek the power of death? You must be a Beginner of level ${job.advLevel} or higher."`
    : `"Only a ${prevJob.name} of level ${job.advLevel} or higher may advance further."`;

  const flavourText = [
    'The living fear what they cannot understand. You seek to understand — and to control.',
    'You have learned the first lessons of the dark arts. Now you embrace them fully.',
    'Death is not an ending. It is a resource. You have learned to harvest it.',
    'You stand at the pinnacle of necromantic power. The dead bow to your will.',
  ][tier - 1];

  return `/**
 * @NPC:     ${npcName} (${npcId})
 * @Purpose: Necromancer class ${tier}${['st','nd','rd','th'][tier-1]} job advancement
 * @Job:     ${tier === 1 ? 'BEGINNER(0)' : `${prevJob.name.toUpperCase()}(${prevJob.id})`} → ${job.name.toUpperCase()}(${job.id})
 * @Level:   ${job.advLevel}+
 * @Map:     ${NECROMANCER_CLASS.npcMapIds[tier]} (Haunted House area)
 */

var status;

function start() {
    status = -1;
    action(1, 0, 0);
}

function action(mode, type, selection) {
    if (mode == -1) {
        cm.dispose();
        return;
    }
    if (mode == 0 && status == 0) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 0) {
        if (cm.getLevel() < ${job.advLevel} || !(${jobCheck})) {
            cm.sendOk(${jobCheckFail});
            cm.dispose();
        } else {
            cm.sendYesNo("I am ${npcName}. ${flavourText}\\r\\n\\r\\nAre you ready to become a #b${job.name}#k?");
        }
    } else if (status == 1) {
        if (mode == 1) {
            cm.changeJobById(${job.id});
${teachLines}
            cm.sendOk("You are now a #b${job.name}#k.\\r\\nThe power of death flows through you.\\r\\nCheck your skill menu — new abilities await.");
        } else {
            cm.sendOk("Return when you are prepared.");
        }
        cm.dispose();
    }
}
`;
}

/**
 * Write all 4 Necromancer advancement NPC scripts to scripts/npc/.
 * Skips if already present.
 */
export function deployAdvancementNpcs() {
  const results = [];
  for (let tier = 1; tier <= 4; tier++) {
    const npcId   = NECROMANCER_CLASS.npcIds[tier];
    const outPath = join(SCRIPT_DIR, `${npcId}.js`);
    if (existsSync(outPath)) {
      results.push({ tier, npcId, status: 'already_exists', path: outPath });
      log.info({ npcId }, 'Necromancer NPC script already exists — skipping');
      continue;
    }
    const script = buildNecroAdvancementScript(tier);
    writeFileSync(outPath, script, 'utf-8');
    results.push({ tier, npcId, status: 'written', path: outPath });
    log.info({ tier, npcId }, 'Necromancer advancement NPC script written');
  }
  return results;
}

// ── Status Report ─────────────────────────────────────────────────────────────

export function getNecroDeployStatus() {
  const status = {
    skillWz:     {},
    skillStrings: false,
    npcScripts:  {},
    overall:     'incomplete',
  };

  // Skill WZ files
  let wzCount = 0;
  for (const job of NECROMANCER_CLASS.jobs) {
    const p = join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`);
    const e = existsSync(p);
    status.skillWz[job.id] = { exists: e, name: job.name };
    if (e) wzCount++;
  }

  // String WZ
  const skillStringPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (existsSync(skillStringPath)) {
    status.skillStrings = readFileSync(skillStringPath, 'utf-8').includes('7001000');
  }

  // NPC scripts
  let npcCount = 0;
  for (let tier = 1; tier <= 4; tier++) {
    const npcId = NECROMANCER_CLASS.npcIds[tier];
    const e = existsSync(join(SCRIPT_DIR, `${npcId}.js`));
    status.npcScripts[tier] = { npcId, exists: e, name: NECROMANCER_CLASS.npcNames[tier - 1] };
    if (e) npcCount++;
  }

  if (wzCount === 4 && status.skillStrings && npcCount === 4) {
    status.overall = 'complete';
  } else if (wzCount > 0 || status.skillStrings || npcCount > 0) {
    status.overall = 'partial';
  }

  return {
    class: NECROMANCER_CLASS.name,
    jobs: NECROMANCER_CLASS.jobs.map(j => ({ id: j.id, name: j.name, advLevel: j.advLevel })),
    totalSkills: Object.values(NECROMANCER_CLASS.skills).flat().length,
    ...status,
  };
}

// ── Training Map & NPC Placement ─────────────────────────────────────────────

/**
 * NPC placement config for the Shadow Crypts hub (990200000).
 * Advancement NPCs line up along the ground floor at y=100.
 * Gear shop (Grizelda) stands near the entrance on the right.
 */
const NECRO_NPC_PLACEMENTS = [
  { id: 9990010, name: 'Mordecai the Gravedigger', x: -450, y: 100, f: 0, fh: 0, desc: '1st job advancement + 2nd job referral' },
  { id: 9990011, name: 'Lady Vesper',               x: -200, y: 100, f: 1, fh: 0, desc: '2nd job advancement (Dark Acolyte)' },
  { id: 9990012, name: 'The Bone Oracle',           x:  100, y: 100, f: 0, fh: 0, desc: '3rd job advancement (Soul Reaper)' },
  { id: 9990013, name: "Kael'Mortis the Eternal",   x:  350, y: 100, f: 1, fh: 0, desc: '4th job advancement (Lich King)' },
  { id: 9990014, name: 'Grizelda the Bone Merchant', x: 560, y: 100, f: 0, fh: 0, desc: 'gear shop' },
];

/**
 * Build a life entry XML block for a single NPC.
 */
function buildNpcLifeEntry(index, { id, x, y, f, fh }) {
  return `    <imgdir name="${index}">
      <string name="type" value="n"/>
      <string name="id" value="${id}"/>
      <int name="x" value="${x}"/>
      <int name="y" value="${y}"/>
      <int name="f" value="${f}"/>
      <int name="fh" value="${fh}"/>
      <int name="cy" value="${y}"/>
      <int name="rx0" value="${x - 50}"/>
      <int name="rx1" value="${x + 50}"/>
    </imgdir>`;
}

/**
 * Deploy the Necromancer training area:
 *   1. Place 5 advancement+shop NPCs into the Shadow Crypts hub (990200000) life section.
 *   2. Add NPC String.wz entries for all 5 NPCs (name + desc).
 *   3. Verify the training map (990200100 — Burial Vestibule) is connected.
 *
 * Safe to call multiple times: checks for NPC presence before injecting.
 */
export function deployTrainingMap() {
  const results = { npcStrings: [], npcPlacements: [], trainingMap: {}, errors: [] };

  // ── 1. Place NPCs on hub map ──────────────────────────────────────────────
  const hubPath = join(MAP_DIR, '990200000.img.xml');
  if (!existsSync(hubPath)) {
    results.errors.push('Hub map 990200000.img.xml not found');
  } else {
    let hubXml = readFileSync(hubPath, 'utf-8');
    const lifeIdx = hubXml.indexOf('<imgdir name="life">');
    if (lifeIdx === -1) {
      results.errors.push('No life section in 990200000');
    } else {
      // Find the next NPC index (count existing life entries under mob+npc)
      const existingIds = (hubXml.match(/<string name="id" value="(\d+)"/g) || []).map(m => m.match(/\d+/)[0]);
      let changed = false;
      let nextIdx = (hubXml.match(/<imgdir name="\d+">/g) || []).length;

      for (const npc of NECRO_NPC_PLACEMENTS) {
        if (existingIds.includes(String(npc.id))) {
          results.npcPlacements.push({ id: npc.id, name: npc.name, status: 'already_present' });
          continue;
        }
        const entry = buildNpcLifeEntry(nextIdx++, npc);
        // Insert before </imgdir> of the life section
        const lifeCloseIdx = hubXml.indexOf('</imgdir>', lifeIdx + 20);
        hubXml = hubXml.slice(0, lifeCloseIdx) + '\n' + entry + '\n  ' + hubXml.slice(lifeCloseIdx);
        results.npcPlacements.push({ id: npc.id, name: npc.name, status: 'placed' });
        changed = true;
      }

      if (changed) {
        writeFileSync(hubPath, hubXml, 'utf-8');
        log.info({ placed: results.npcPlacements.filter(p => p.status === 'placed').length }, 'NPCs placed on Shadow Crypts hub');
      }
    }
  }

  // ── 2. Add NPC String.wz entries ─────────────────────────────────────────
  const npcStringPath = join(WZ_DIR, 'String.wz', 'Npc.img.xml');
  if (existsSync(npcStringPath)) {
    let npcXml = readFileSync(npcStringPath, 'utf-8');
    let npcChanged = false;
    const npcData = [
      { id: 9990010, name: 'Dark Apprentice',           func: 'Job Advancement NPC' },
      { id: 9990011, name: 'Death Disciple',             func: 'Job Advancement NPC' },
      { id: 9990012, name: 'The Soul Reaper',            func: 'Job Advancement NPC' },
      { id: 9990013, name: 'The Ancient Lich',           func: 'Job Advancement NPC' },
      { id: 9990014, name: 'Grizelda the Bone Merchant', func: 'Necromancer Gear Shop' },
    ];

    for (const npc of npcData) {
      if (npcXml.includes(`name="${npc.id}"`)) {
        results.npcStrings.push({ id: npc.id, status: 'exists' });
        continue;
      }
      const entry = `\n    <imgdir name="${npc.id}">\n      <string name="name" value="${npc.name}"/>\n      <string name="func" value="${npc.func}"/>\n    </imgdir>`;
      // Insert before closing root tag
      const closeTag = npcXml.lastIndexOf('</imgdir>');
      npcXml = npcXml.slice(0, closeTag) + entry + '\n  ' + npcXml.slice(closeTag);
      results.npcStrings.push({ id: npc.id, name: npc.name, status: 'added' });
      npcChanged = true;
    }

    if (npcChanged) {
      writeFileSync(npcStringPath, npcXml, 'utf-8');
      log.info({ added: results.npcStrings.filter(s => s.status === 'added').length }, 'NPC String.wz entries added');
    }
  }

  // ── 3. Verify training map connectivity ───────────────────────────────────
  const trainingPath = join(MAP_DIR, '990200100.img.xml');
  const trainingExists = existsSync(trainingPath);
  results.trainingMap = {
    id: 990200100,
    name: 'Burial Vestibule',
    exists: trainingExists,
    status: trainingExists ? 'connected' : 'missing',
    connectedTo: 990200000,
  };

  if (trainingExists) {
    const tXml = readFileSync(trainingPath, 'utf-8');
    const mobCount = (tXml.match(/<string name="type" value="m"/g) || []).length;
    const hasPortalBack = tXml.includes('tm" value="990200000"');
    results.trainingMap.mobCount = mobCount;
    results.trainingMap.hasPortalBack = hasPortalBack;
  }

  log.info({ results }, 'Necromancer training map deployment complete');

  return {
    success: results.errors.length === 0,
    ...results,
    note: results.errors.length === 0
      ? 'Training area ready. NPCs placed on 990200000. Restart server to apply.'
      : `Errors: ${results.errors.join(', ')}`,
  };
}

// ── In-Game Validation ───────────────────────────────────────────────────────

const CLIENT_IMG_DIR = join(process.cwd(), 'workspace', 'v83-img-data', 'Skill');
// Minimum binary img size indicating icons were injected (bare empty img ≈ 414 bytes)
const IMG_SIZE_THRESHOLD = 2000;

/**
 * Comprehensive validation of all Necromancer class components.
 *
 * Checks:
 *   A. Skill WZ XML files (server-side, 700–712.img.xml)
 *   B. Client WZ binary img files (v83-img-data/Skill/*.img) — icon injection
 *   C. Skill string entries in String.wz/Skill.img.xml (all 22 skills)
 *   D. NPC advancement scripts (9990010–9990013) and gear-shop script (9990014)
 *   E. NPC placement on hub map 990200000 (all 5 NPCs in life section)
 *   F. NPC String.wz entries (name/func for all 5 NPCs)
 *   G. Training map 990200100 exists, has mobs, and has a portal back to hub
 *
 * Returns a structured report with per-check pass/fail and an overall verdict.
 */
export function validateNecromancerClass() {
  const checks = [];
  const allSkillIds = Object.values(NECROMANCER_CLASS.skills).flat().map(s => String(s.id));

  function pass(label, detail = null) {
    checks.push({ check: label, result: 'PASS', detail });
  }
  function fail(label, detail = null) {
    checks.push({ check: label, result: 'FAIL', detail });
  }
  function warn(label, detail = null) {
    checks.push({ check: label, result: 'WARN', detail });
  }

  // ── A. Skill WZ XML files ────────────────────────────────────────────────
  for (const job of NECROMANCER_CLASS.jobs) {
    const wzPath = join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`);
    if (existsSync(wzPath)) {
      const xml = readFileSync(wzPath, 'utf-8');
      const skills = NECROMANCER_CLASS.skills[job.id];
      const missing = skills.filter(s => !xml.includes(`name="${s.id}"`));
      if (missing.length === 0) {
        pass(`Skill WZ: ${job.id}.img.xml`, `${skills.length}/${skills.length} skill entries`);
      } else {
        fail(`Skill WZ: ${job.id}.img.xml`, `Missing ${missing.length} skills: ${missing.map(s => s.id).join(', ')}`);
      }
    } else {
      fail(`Skill WZ: ${job.id}.img.xml`, 'File not found');
    }
  }

  // ── B. Client WZ binary img files (icon injection) ──────────────────────
  for (const job of NECROMANCER_CLASS.jobs) {
    const imgPath = join(CLIENT_IMG_DIR, `${job.id}.img`);
    if (existsSync(imgPath)) {
      const size = statSync(imgPath).size;
      if (size >= IMG_SIZE_THRESHOLD) {
        pass(`Client WZ: ${job.id}.img`, `${size} bytes — icons injected`);
      } else {
        fail(`Client WZ: ${job.id}.img`, `Only ${size} bytes — icons NOT injected (threshold ${IMG_SIZE_THRESHOLD})`);
      }
    } else {
      fail(`Client WZ: ${job.id}.img`, 'File not found in v83-img-data/Skill/');
    }
  }

  // ── C. Skill string entries ──────────────────────────────────────────────
  const skillStringPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (existsSync(skillStringPath)) {
    const xml = readFileSync(skillStringPath, 'utf-8');
    const missingStrings = allSkillIds.filter(id => !xml.includes(`name="${id}"`));
    if (missingStrings.length === 0) {
      pass('Skill strings: String.wz/Skill.img.xml', `All ${allSkillIds.length} skill entries present`);
    } else {
      fail('Skill strings: String.wz/Skill.img.xml', `Missing ${missingStrings.length}: ${missingStrings.join(', ')}`);
    }
  } else {
    fail('Skill strings: String.wz/Skill.img.xml', 'File not found');
  }

  // ── D. NPC advancement + shop scripts ───────────────────────────────────
  const npcScriptIds = [
    ...Object.values(NECROMANCER_CLASS.npcIds),
    9990014, // Grizelda gear shop
  ];
  const missingScripts = [];
  for (const npcId of npcScriptIds) {
    const scriptPath = join(SCRIPT_DIR, `${npcId}.js`);
    if (!existsSync(scriptPath)) missingScripts.push(npcId);
  }
  if (missingScripts.length === 0) {
    pass('NPC scripts', `All ${npcScriptIds.length} scripts present (9990010–9990014)`);
  } else {
    fail('NPC scripts', `Missing scripts: ${missingScripts.join(', ')}`);
  }

  // ── E. NPC placement on hub map 990200000 ────────────────────────────────
  const hubPath = join(MAP_DIR, '990200000.img.xml');
  if (existsSync(hubPath)) {
    const hubXml = readFileSync(hubPath, 'utf-8');
    const placed = NECRO_NPC_PLACEMENTS.filter(npc => hubXml.includes(`value="${npc.id}"`));
    const unplaced = NECRO_NPC_PLACEMENTS.filter(npc => !hubXml.includes(`value="${npc.id}"`));
    if (unplaced.length === 0) {
      pass('NPC placement: 990200000 hub', `All ${NECRO_NPC_PLACEMENTS.length} NPCs placed in life section`);
    } else {
      fail('NPC placement: 990200000 hub', `Missing: ${unplaced.map(n => `${n.id}(${n.name})`).join(', ')}`);
    }
    if (placed.length > 0 && placed.length < NECRO_NPC_PLACEMENTS.length) {
      warn('NPC placement: partial', `${placed.length}/${NECRO_NPC_PLACEMENTS.length} placed`);
    }
  } else {
    fail('NPC placement: 990200000 hub', 'Hub map file not found');
  }

  // ── F. NPC String.wz entries ─────────────────────────────────────────────
  const npcStringPath = join(WZ_DIR, 'String.wz', 'Npc.img.xml');
  if (existsSync(npcStringPath)) {
    const npcXml = readFileSync(npcStringPath, 'utf-8');
    const missingNpcStrings = NECRO_NPC_PLACEMENTS.filter(npc => !npcXml.includes(`name="${npc.id}"`));
    if (missingNpcStrings.length === 0) {
      pass('NPC strings: String.wz/Npc.img.xml', `All ${NECRO_NPC_PLACEMENTS.length} NPC name/func entries present`);
    } else {
      fail('NPC strings: String.wz/Npc.img.xml', `Missing: ${missingNpcStrings.map(n => n.id).join(', ')}`);
    }
  } else {
    fail('NPC strings: String.wz/Npc.img.xml', 'File not found');
  }

  // ── G. Training map 990200100 connectivity ───────────────────────────────
  const trainingPath = join(MAP_DIR, '990200100.img.xml');
  if (existsSync(trainingPath)) {
    const tXml = readFileSync(trainingPath, 'utf-8');
    const mobCount = (tXml.match(/<string name="type" value="m"/g) || []).length;
    const hasPortalBack = tXml.includes('tm" value="990200000"');

    if (mobCount > 0) {
      pass('Training map mobs: 990200100', `${mobCount} mob spawn${mobCount !== 1 ? 's' : ''}`);
    } else {
      fail('Training map mobs: 990200100', 'No mob spawns — players cannot train here');
    }

    if (hasPortalBack) {
      pass('Training map portal: back to hub', 'Portal to 990200000 present');
    } else {
      fail('Training map portal: back to hub', 'No return portal to hub 990200000 — map is a dead end');
    }
  } else {
    fail('Training map: 990200100.img.xml', 'Burial Vestibule map file not found');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed  = checks.filter(c => c.result === 'PASS').length;
  const failed  = checks.filter(c => c.result === 'FAIL').length;
  const warned  = checks.filter(c => c.result === 'WARN').length;
  const total   = checks.filter(c => c.result !== 'WARN').length; // warnings don't count against pass rate

  const verdict = failed === 0 ? 'READY' : (passed >= total * 0.7 ? 'PARTIAL' : 'NOT_READY');

  log.info({ passed, failed, warned, verdict }, 'Necromancer class validation complete');

  return {
    verdict,           // 'READY' | 'PARTIAL' | 'NOT_READY'
    passed,
    failed,
    warned,
    totalChecks: checks.length,
    checks,
    summary: failed === 0
      ? `All ${passed} checks passed. Necromancer class is fully deployed — restart server to go live.`
      : `${failed} check${failed !== 1 ? 's' : ''} failed. Resolve failures before testing in-game.`,
    nextSteps: failed === 0 ? [
      'Restart the Cosmic server (maple_restart or start-server.bat)',
      'Log in as a Beginner and talk to Dark Apprentice (NPC 9990010) on map 990200000',
      'Verify job advancement to Necromancer (job 700)',
      'Check skill menu — 5 Tier-1 skills should appear with icons',
    ] : checks.filter(c => c.result === 'FAIL').map(c => `FIX: ${c.check} — ${c.detail}`),
  };
}

// ── Master Deploy ─────────────────────────────────────────────────────────────

/**
 * Deploy all Necromancer class components.
 * Safe to call multiple times — skips already-present components.
 */
export function deployAll() {
  log.info('Starting Necromancer class deployment');
  const results = {
    skillWz:      deploySkillWz(),
    skillStrings: deploySkillStrings(),
    npcs:         deployAdvancementNpcs(),
    trainingMap:  deployTrainingMap(),
  };

  const status = getNecroDeployStatus();
  log.info({ overall: status.overall }, 'Necromancer class deployment complete');

  return {
    class: NECROMANCER_CLASS.name,
    results,
    status,
    note: status.overall === 'complete'
      ? 'All components deployed. Restart server to apply.'
      : 'Some components missing — check status for details.',
  };
}
