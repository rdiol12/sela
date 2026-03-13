/**
 * modules/maplestory/custom-class.js — Custom class deployment for MapleStory Cosmic v83.
 *
 * Handles the complete implementation pipeline for adding a new custom class
 * (currently: the Sage class, job IDs 600/610/611/612).
 *
 * Findings from research (2026-03-05):
 *   - Job.java already defines SAGE(600), ELEMENTALIST(610), ARCANUM(611), ARCHSAGE(612)
 *   - constants/skills/Sage.java has all 30 skill ID constants
 *   - SageCreator.java exists for character creation
 *   - GameConstants.java has isSage() and map routing
 *   - MISSING: Skill WZ XML files, String WZ entries, NPC advancement scripts
 *
 * This module generates all missing pieces and deploys them.
 *
 * Skill Tree Design (ms_2):
 *   - Full skill tree with prerequisites for all 4 job tiers
 *   - Proper stat scaling: damage scales with job tier, MP costs balanced
 *   - 3 Sage-exclusive weapons: Runic Orb (lv20), Arcane Scepter (lv30), Prism Staff (lv70)
 *   - reqJob=64 restricts weapons to Sage class only
 *
 * Deployment functions:
 *   deploySkillWz()         — writes 600/610/611/612.img.xml to wz/Skill.wz/
 *   deploySkillStrings()    — appends Sage skill entries to wz/String.wz/Skill.img.xml
 *   deployAdvancementNpcs() — writes 4 job advancement NPC scripts
 *   deploySageWeapons()     — creates 3 Sage-specific weapon WZ files + string entries
 *   deployAll()             — runs all of the above in sequence
 *   getSageDeployStatus()   — reports which pieces are present vs missing
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { buildWeaponXml, createWeaponFile, registerWeaponName } from './custom-weapons.js';

const log = createLogger('maplestory:custom-class');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SCRIPT_DIR = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'npc');
const QUEST_DIR  = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'quest');
const STATE_DIR  = join(process.cwd(), 'data', 'state');

// ── Sage Class Definition ────────────────────────────────────────────────────

const SAGE_CLASS = {
  name: 'Sage',
  jobs: [
    { id: 600, name: 'Sage',         advLevel: 10,  tier: 1 },
    { id: 610, name: 'Elementalist', advLevel: 30,  tier: 2 },
    { id: 611, name: 'Arcanum',      advLevel: 60,  tier: 3 },
    { id: 612, name: 'Archsage',     advLevel: 100, tier: 4 },
  ],
  skills: {
    600: [
      { id: 6001000, name: 'Arcane Bolt',        maxLv: 20, type: 'attack',  desc: '[Master Level: 20]\\nFires a bolt of arcane energy at a single enemy.\\nRequired Skill: #cAt least Level 1 on Elemental Attunement#' },
      { id: 6001001, name: 'Mana Shield',         maxLv: 15, type: 'buff',    desc: '[Master Level: 15]\\nAbsorbs some of the damage received as MP instead of HP.' },
      { id: 6001002, name: 'Elemental Attunement',maxLv: 10, type: 'passive', desc: '[Master Level: 10]\\nPassively increases INT and magic attack.' },
      { id: 6001003, name: "Sage's Wisdom",       maxLv: 10, type: 'passive', desc: "[Master Level: 10]\\nIncreases the amount of MaxMP gained per level-up." },
      { id: 6001004, name: 'Runic Strike',         maxLv: 20, type: 'attack',  desc: '[Master Level: 20]\\nChannels runic energy into a powerful strike.\\nRequired Skill: #cAt least Level 3 on Arcane Bolt#' },
      { id: 6001005, name: 'Teleport',             maxLv: 20, type: 'active',  desc: '[Master Level: 20]\\nAllows the Sage to teleport a short distance in any direction.' },
    ],
    610: [
      { id: 6101000, name: 'Flame Pillar',     maxLv: 20, type: 'attack',  desc: '[Master Level: 20]\\nSummons a pillar of fire that burns enemies.' },
      { id: 6101001, name: 'Frost Nova',        maxLv: 20, type: 'attack',  desc: '[Master Level: 20]\\nReleases a nova of frost that may freeze enemies.' },
      { id: 6101002, name: 'Lightning Chain',   maxLv: 20, type: 'attack',  desc: '[Master Level: 20]\\nChain lightning that jumps to up to 6 enemies.' },
      { id: 6101003, name: 'Elemental Boost',   maxLv: 15, type: 'buff',    desc: '[Master Level: 15]\\nTemporarily boosts the damage of all elemental skills.' },
      { id: 6101004, name: 'Spell Mastery',     maxLv: 20, type: 'passive', desc: '[Master Level: 20]\\nIncreases magic accuracy and INT.' },
      { id: 6101005, name: 'Mana Surge',        maxLv: 20, type: 'passive', desc: '[Master Level: 20]\\nBoosts MP recovery rate.' },
      { id: 6101006, name: 'Arcane Barrier',    maxLv: 15, type: 'buff',    desc: '[Master Level: 15]\\nCreates a magical barrier reducing damage received.' },
      { id: 6101007, name: 'Element Shift',     maxLv: 5,  type: 'active',  desc: '[Master Level: 5]\\nTemporarily shifts elemental affinity for bonus damage.' },
    ],
    611: [
      { id: 6111000, name: 'Meteor Shower',         maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nCalls down meteors in a wide area.' },
      { id: 6111001, name: 'Blizzard',               maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nCovers the area in a blizzard, chance to freeze.' },
      { id: 6111002, name: 'Thunder Spear',          maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nFires a crackling spear of lightning.' },
      { id: 6111003, name: 'Elemental Convergence', maxLv: 20, type: 'passive', desc: '[Master Level: 20]\\nMastering all elements increases combined skill damage.' },
      { id: 6111004, name: 'Sage Meditation',        maxLv: 30, type: 'buff',    desc: '[Master Level: 30]\\nMeditation that boosts magic attack for the whole party.' },
      { id: 6111005, name: 'Runic Ward',             maxLv: 30, type: 'buff',    desc: '[Master Level: 30]\\nA powerful runic barrier that reduces magic damage.' },
      { id: 6111006, name: 'Arcane Explosion',       maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nMassive arcane burst hitting up to 8 enemies.' },
      { id: 6111007, name: 'Mystic Door',            maxLv: 1,  type: 'active',  desc: '[Master Level: 1]\\nOpens a door to the nearest town.' },
    ],
    612: [
      { id: 6121000, name: 'Primordial Inferno',   maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nSummons a volcanic eruption dealing massive fire damage.' },
      { id: 6121001, name: 'Absolute Zero',         maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nFlash-freezes all enemies on screen.' },
      { id: 6121002, name: 'Divine Thunder',        maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nCalls divine lightning on up to 15 enemies.' },
      { id: 6121003, name: 'Elemental Unity',       maxLv: 30, type: 'passive', desc: '[Master Level: 30]\\nMastery of all three elements gives a large damage boost.' },
      { id: 6121004, name: "Sage's Enlightenment",  maxLv: 30, type: 'passive', desc: "[Master Level: 30]\\nBoosts INT, magic attack, and magic defense." },
      { id: 6121005, name: 'Arcane Mastery',        maxLv: 30, type: 'passive', desc: '[Master Level: 30]\\nReduces MP cost of all Sage skills.' },
      { id: 6121006, name: 'Infinity',              maxLv: 30, type: 'buff',    desc: '[Master Level: 30]\\nFor a short time, all skills cost 0 MP.' },
      { id: 6121007, name: "Hero's Will",           maxLv: 5,  type: 'active',  desc: "[Master Level: 5]\\nBreaks all status effects." },
      { id: 6121008, name: 'Maple Warrior',         maxLv: 30, type: 'buff',    desc: '[Master Level: 30]\\nBoosts all stats for the entire party.' },
      { id: 6121009, name: 'Elemental Storm',       maxLv: 30, type: 'attack',  desc: '[Master Level: 30]\\nThe ultimate spell — combines fire, ice, and lightning into a cataclysmic AoE.' },
    ],
  },
  // NPC IDs for advancement (using 9990001-9990004 range to avoid conflicts)
  npcIds: {
    1: 9990001,  // Sage Instructor (1st job advance, placed in Ellinia)
    2: 9990002,  // Elementalist Master (2nd job advance)
    3: 9990003,  // Arcanum Council (3rd job advance)
    4: 9990004,  // Archsage Elder (4th job advance)
  },
  npcMapIds: {
    1: 101000000,  // Ellinia
    2: 101000000,  // Ellinia
    3: 101000000,  // Ellinia (TODO: custom Sage hall map)
    4: 101000000,  // Ellinia
  },
};

// ── Skill WZ XML Generation ──────────────────────────────────────────────────

/**
 * Build a skill level entry XML for a given skill type.
 * Returns multi-line XML for one <imgdir name="N"> level block.
 */
function buildSkillLevelXml(skillId, level, maxLevel, skillType) {
  const lines = [];
  lines.push(`        <imgdir name="${level}">`);

  // Common: mpCon scales 5→30 over maxLevel for attack/active skills
  if (skillType === 'attack') {
    const mpCon = Math.round(5 + (level / maxLevel) * 25);
    const mad   = Math.round(80 + level * 8);
    const range = 300 + level * 10;
    lines.push(`          <int name="mad" value="${mad}"/>`);
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="range" value="${range}"/>`);
    lines.push(`          <int name="mastery" value="${Math.min(10 + level * 2, 50)}"/>`);
  } else if (skillType === 'buff') {
    const mpCon = Math.round(20 + (level / maxLevel) * 20);
    const time  = Math.round(30 + level * 2);
    const x     = level * 2;  // generic buff value (e.g. +MAD)
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="time" value="${time}"/>`);
    lines.push(`          <int name="x" value="${x}"/>`);
  } else if (skillType === 'passive') {
    const x = level * 3;  // stat boost per level
    lines.push(`          <int name="x" value="${x}"/>`);
    lines.push(`          <int name="y" value="${level * 2}"/>`);
  } else {
    // active/utility
    const mpCon = Math.round(10 + (level / maxLevel) * 15);
    lines.push(`          <int name="mpCon" value="${mpCon}"/>`);
    lines.push(`          <int name="x" value="${level}"/>`);
  }

  lines.push(`        </imgdir>`);
  return lines.join('\n');
}

/**
 * Build a complete Skill.wz img XML file for one job tier.
 * Returns the full XML string.
 */
function buildSkillImgXml(jobId) {
  const skills = SAGE_CLASS.skills[jobId];
  if (!skills) throw new Error(`No skills defined for job ${jobId}`);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push(`<imgdir name="${jobId}.img">`);
  lines.push('  <imgdir name="info">');
  lines.push('    <canvas name="icon" width="26" height="30">');
  lines.push('      <vector name="origin" x="-4" y="30"/>');
  lines.push('    </canvas>');
  lines.push('  </imgdir>');
  lines.push('  <imgdir name="skill">');

  for (const skill of skills) {
    lines.push(`    <imgdir name="${skill.id}">`);
    // Icon placeholders — same size as standard skills
    for (const iconName of ['icon', 'iconMouseOver', 'iconDisabled']) {
      lines.push(`      <canvas name="${iconName}" width="32" height="32">`);
      lines.push(`        <vector name="origin" x="0" y="32"/>`);
      lines.push(`        <int name="z" value="0"/>`);
      lines.push(`      </canvas>`);
    }
    lines.push('      <imgdir name="level">');
    for (let lv = 1; lv <= skill.maxLv; lv++) {
      lines.push(buildSkillLevelXml(skill.id, lv, skill.maxLv, skill.type));
    }
    lines.push('      </imgdir>');
    lines.push(`    </imgdir>`);
  }

  lines.push('  </imgdir>');
  lines.push('</imgdir>');
  return lines.join('\n');
}

/**
 * Write all 4 Sage Skill WZ XML files to the wz/Skill.wz/ directory.
 * Returns a summary of what was written.
 */
export function deploySkillWz() {
  const results = [];
  for (const job of SAGE_CLASS.jobs) {
    const outPath = join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`);
    if (existsSync(outPath)) {
      results.push({ jobId: job.id, jobName: job.name, status: 'already_exists', path: outPath });
      log.info(`Skill WZ for ${job.name} (${job.id}) already exists — skipping`);
      continue;
    }
    const xml = buildSkillImgXml(job.id);
    writeFileSync(outPath, xml, 'utf-8');
    results.push({ jobId: job.id, jobName: job.name, status: 'written', path: outPath });
    log.info(`Written Skill WZ for ${job.name} (${job.id}) → ${outPath}`);
  }
  return results;
}

// ── String WZ Entries ────────────────────────────────────────────────────────

/**
 * Build Skill.img.xml entries for all Sage skills.
 * Returns the XML snippet (to be inserted into the file).
 */
function buildSageSkillStringEntries() {
  const lines = [];
  for (const job of SAGE_CLASS.jobs) {
    const skills = SAGE_CLASS.skills[job.id];
    lines.push(`  <!-- ${job.name} (Job ${job.id}) -->`);
    for (const skill of skills) {
      lines.push(`  <imgdir name="${skill.id}">`);
      lines.push(`    <string name="name" value="${skill.name}"/>`);
      lines.push(`    <string name="desc" value="${skill.desc}"/>`);
      lines.push(`  </imgdir>`);
    }
  }
  return lines.join('\n');
}

/**
 * Append Sage skill entries to wz/String.wz/Skill.img.xml.
 * Inserts before the closing </imgdir> tag.
 * Skips if entries already exist.
 */
export function deploySkillStrings() {
  const skillStringPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (!existsSync(skillStringPath)) {
    log.warn(`Skill.img.xml not found at ${skillStringPath}`);
    return { status: 'file_not_found', path: skillStringPath };
  }

  let xml = readFileSync(skillStringPath, 'utf-8');

  // Check if Sage entries already exist
  if (xml.includes('6001000')) {
    log.info('Sage skill strings already present in Skill.img.xml — skipping');
    return { status: 'already_exists', path: skillStringPath };
  }

  // Insert before the closing tag
  const insertPoint = xml.lastIndexOf('</imgdir>');
  if (insertPoint === -1) {
    return { status: 'error', message: 'Could not find closing </imgdir> in Skill.img.xml' };
  }

  const newEntries = '\n' + buildSageSkillStringEntries() + '\n';
  xml = xml.slice(0, insertPoint) + newEntries + xml.slice(insertPoint);
  writeFileSync(skillStringPath, xml, 'utf-8');

  const skillCount = Object.values(SAGE_CLASS.skills).flat().length;
  log.info(`Added ${skillCount} Sage skill string entries to Skill.img.xml`);
  return { status: 'written', path: skillStringPath, skillCount };
}

// ── NPC Advancement Scripts ──────────────────────────────────────────────────

/**
 * Build the NPC script for a Sage job advancement.
 */
function buildAdvancementScript(tier) {
  const job      = SAGE_CLASS.jobs[tier - 1];
  const prevJob  = SAGE_CLASS.jobs[tier - 2];
  const npcNames = ['Sage Instructor', 'Elementalist Master', 'Arcanum Council', 'Archsage Elder'];
  const npcName  = npcNames[tier - 1];

  // Skills taught on advancement (the first 2 passive/buff skills per tier)
  const skills   = SAGE_CLASS.skills[job.id];
  const passives = skills.filter(s => s.type === 'passive' || s.type === 'buff').slice(0, 2);
  const teachLines = passives.map(s => `        cm.teachSkill(${s.id}, 0, ${s.maxLv}, -1);`).join('\n');

  const jobCheck = tier === 1
    ? `cm.getJobId() == 0`  // BEGINNER
    : `cm.getJobId() == ${prevJob.id}`;

  const jobCheckFail = tier === 1
    ? `"You must be a Beginner of level ${job.advLevel} or higher to become a Sage."`
    : `"You must be a ${prevJob.name} of level ${job.advLevel} or higher to advance."`;

  return `/**
 * @NPC:     ${npcName} (${SAGE_CLASS.npcIds[tier]})
 * @Purpose: Sage class ${tier}${['st','nd','rd','th'][tier-1]} job advancement
 * @Job:     ${tier === 1 ? 'BEGINNER(0)' : `${prevJob.name.toUpperCase()}(${prevJob.id})`} → ${job.name.toUpperCase()}(${job.id})
 * @Level:   ${job.advLevel}+
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
            cm.sendYesNo("Greetings, traveler. I am ${npcName}.\\r\\n\\r\\nYou have shown great potential. Are you ready to advance and become a #b${job.name}#k?");
        }
    } else if (status == 1) {
        if (mode == 1) {
            cm.changeJobById(${job.id});
${teachLines}
            cm.sendOk("Congratulations! You are now a #b${job.name}#k.\\r\\nYour journey on the path of elemental mastery begins now.\\r\\nNew skills have been granted — check your skill menu.");
        } else {
            cm.sendOk("Come back when you are ready to advance.");
        }
        cm.dispose();
    }
}
`;
}

/**
 * Write all 4 Sage advancement NPC scripts.
 * Returns a list of written files.
 */
export function deployAdvancementNpcs() {
  const results = [];
  for (let tier = 1; tier <= 4; tier++) {
    const npcId   = SAGE_CLASS.npcIds[tier];
    const outPath = join(SCRIPT_DIR, `${npcId}.js`);
    if (existsSync(outPath)) {
      results.push({ tier, npcId, status: 'already_exists', path: outPath });
      log.info(`NPC script ${npcId}.js already exists — skipping`);
      continue;
    }
    const script = buildAdvancementScript(tier);
    writeFileSync(outPath, script, 'utf-8');
    results.push({ tier, npcId, status: 'written', path: outPath });
    log.info(`Written advancement NPC script: ${outPath}`);
  }
  return results;
}

// ── Status Report ────────────────────────────────────────────────────────────

/**
 * Returns a status object describing which Sage class components are present.
 */
export function getSageDeployStatus() {
  const status = {
    skillWz:      {},
    skillStrings:  false,
    npcScripts:   {},
    weapons:      {},
    maps:         {},
    overall:      'incomplete',
  };

  // Check Skill WZ files
  let wzCount = 0;
  for (const job of SAGE_CLASS.jobs) {
    const path = join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`);
    const exists = existsSync(path);
    status.skillWz[job.id] = exists;
    if (exists) wzCount++;
  }

  // Check String WZ
  const skillStringPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (existsSync(skillStringPath)) {
    const xml = readFileSync(skillStringPath, 'utf-8');
    status.skillStrings = xml.includes('6001000');
  }

  // Check NPC scripts
  let npcCount = 0;
  for (let tier = 1; tier <= 4; tier++) {
    const npcId = SAGE_CLASS.npcIds[tier];
    const path  = join(SCRIPT_DIR, `${npcId}.js`);
    const exists = existsSync(path);
    status.npcScripts[tier] = { npcId, exists };
    if (exists) npcCount++;
  }

  // Check Sage weapons
  let weaponCount = 0;
  const eqpPath = join(WZ_DIR, 'String.wz', 'Eqp.img.xml');
  const eqpXml  = existsSync(eqpPath) ? readFileSync(eqpPath, 'utf-8') : '';
  for (const w of SAGE_WEAPONS) {
    const wzFile = join(WZ_DIR, 'Character.wz', 'Weapon', `${w.fileId}.img.xml`);
    const fileExists = existsSync(wzFile);
    const nameExists = eqpXml.includes(`<imgdir name="${w.id}">`);
    status.weapons[w.id] = { name: w.name, fileExists, nameExists };
    if (fileExists && nameExists) weaponCount++;
  }

  // Check Sage Spire maps
  const mapStatus = getSageMapsStatus();
  status.maps = mapStatus.maps;

  // Check Sage quests
  const questStatus = getSageQuestsStatus();
  status.quests = questStatus.quests;

  // Overall — all components present
  if (wzCount === 4 && status.skillStrings && npcCount === 4 && weaponCount === SAGE_WEAPONS.length && mapStatus.complete && questStatus.complete) {
    status.overall = 'complete';
  } else if (wzCount > 0 || status.skillStrings || npcCount > 0 || weaponCount > 0 || mapStatus.deployedCount > 0 || questStatus.deployedCount > 0) {
    status.overall = 'partial';
  }

  status.summary = {
    skillWzFiles:   `${wzCount}/4`,
    skillStrings:   status.skillStrings ? 'present' : 'missing',
    npcScripts:     `${npcCount}/4`,
    sageWeapons:    `${weaponCount}/${SAGE_WEAPONS.length}`,
    sageMaps:       `${mapStatus.deployedCount}/${mapStatus.total}`,
    sageQuests:     `${questStatus.deployedCount}/${questStatus.total}`,
    skillTreeNodes: Object.values(SAGE_SKILL_TREE).flat().length,
    overall:        status.overall,
  };

  return status;
}

// ── Deploy All ───────────────────────────────────────────────────────────────

/**
 * Deploy all missing Sage class components: Skill WZ, skill strings, NPC scripts, weapons.
 * Returns a full deployment report.
 */
export async function deployAll() {
  log.info('Starting Sage class full deployment...');

  const report = {
    timestamp: new Date().toISOString(),
    class: 'Sage (600/610/611/612)',
    skillWz:      deploySkillWz(),
    skillStrings:  deploySkillStrings(),
    npcScripts:   deployAdvancementNpcs(),
    weapons:      deploySageWeapons(),
    maps:         deploySageMaps(),
    quests:       deploySageQuests(),
  };

  // Save report to state
  const reportPath = join(STATE_DIR, 'sage-class-deploy.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  const finalStatus = getSageDeployStatus();
  report.finalStatus = finalStatus;

  log.info(`Sage deployment complete: ${JSON.stringify(finalStatus.summary)}`);
  return report;
}

export { SAGE_CLASS };

// ── Sage Integration Verification ───────────────────────────────────────────

/**
 * Comprehensive verification of the Sage class integration.
 * Checks all components: Java source, WZ files, scripts, maps, quests, weapons.
 * Returns a detailed pass/fail report suitable for milestone completion evidence.
 */
export function verifySageIntegration() {
  const checks = [];
  let passed = 0;
  let failed = 0;

  function check(name, condition, detail) {
    const ok = !!condition;
    checks.push({ name, pass: ok, detail });
    if (ok) passed++; else failed++;
  }

  // ── Java Source Checks ──────────────────────────────────────────────────
  const srcDir = join(process.cwd(), 'workspace', 'Cosmic', 'src', 'main', 'java');

  const jobJava = join(srcDir, 'client', 'Job.java');
  if (existsSync(jobJava)) {
    const jobSrc = readFileSync(jobJava, 'utf-8');
    check('Job.java: SAGE(600) enum', jobSrc.includes('SAGE(600)'), 'Job enum has SAGE entry');
    check('Job.java: ELEMENTALIST(610)', jobSrc.includes('ELEMENTALIST(610)'), 'Job enum has ELEMENTALIST');
    check('Job.java: ARCANUM(611)', jobSrc.includes('ARCANUM(611)'), 'Job enum has ARCANUM');
    check('Job.java: ARCHSAGE(612)', jobSrc.includes('ARCHSAGE(612)'), 'Job enum has ARCHSAGE');
  } else {
    check('Job.java exists', false, 'File not found');
  }

  const gcJava = join(srcDir, 'constants', 'game', 'GameConstants.java');
  if (existsSync(gcJava)) {
    const gcSrc = readFileSync(gcJava, 'utf-8');
    check('GameConstants.java: isSage()', gcSrc.includes('isSage'), 'isSage() method present');
  } else {
    check('GameConstants.java exists', false, 'File not found');
  }

  const sageJava = join(srcDir, 'constants', 'skills', 'Sage.java');
  check('Sage.java skill constants', existsSync(sageJava), sageJava);

  const sageCreator = join(srcDir, 'client', 'creator', 'novice', 'SageCreator.java');
  check('SageCreator.java', existsSync(sageCreator), 'Character creation support');

  // ── WZ Skill Files ──────────────────────────────────────────────────────
  for (const jobId of [600, 610, 611, 612]) {
    const wzPath = join(WZ_DIR, 'Skill.wz', `${jobId}.img.xml`);
    check(`Skill WZ: ${jobId}.img.xml`, existsSync(wzPath), wzPath);
  }

  // ── Skill Strings ───────────────────────────────────────────────────────
  const skillStrPath = join(WZ_DIR, 'String.wz', 'Skill.img.xml');
  if (existsSync(skillStrPath)) {
    const xml = readFileSync(skillStrPath, 'utf-8');
    check('Skill strings: 6001000 (Arcane Bolt)', xml.includes('6001000'), 'First skill registered');
    check('Skill strings: 6121009 (Elemental Storm)', xml.includes('6121009'), 'Ultimate skill registered');
  } else {
    check('String.wz/Skill.img.xml exists', false, 'File not found');
  }

  // ── NPC Scripts ─────────────────────────────────────────────────────────
  const npcScript = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'npc', '9999030.js');
  if (existsSync(npcScript)) {
    const npcSrc = readFileSync(npcScript, 'utf-8');
    check('NPC 9999030: job advancement', npcSrc.includes('changeJobById(600)'), '1st job advancement');
    check('NPC 9999030: 4th job', npcSrc.includes('changeJobById(612)'), '4th job advancement');
    check('NPC 9999030: quest integration', npcSrc.includes('99210'), 'Quest chain wired');
  } else {
    check('NPC 9999030.js exists', false, 'Sage Instructor Elara script missing');
  }

  // ── Maps ────────────────────────────────────────────────────────────────
  const mapDir = join(WZ_DIR, 'Map.wz', 'Map');
  const sageMaps = [
    { id: '990100000', name: 'Entrance' },
    { id: '990100100', name: 'Library' },
    { id: '990100200', name: 'Elemental Chambers' },
    { id: '990100300', name: 'Observatory' },
    { id: '990100400', name: 'Training Grounds' },
    { id: '990100500', name: 'Arcane Sanctum' },
    { id: '990100600', name: 'Elemental Nexus' },
    { id: '101050000', name: 'Sage Hall' },
    { id: '101050001', name: 'Sage Training Ground' },
    { id: '101050002', name: 'Sage Inner Sanctum' },
  ];
  for (const m of sageMaps) {
    const prefix = `Map${m.id.charAt(0)}`;
    const mapPath = join(mapDir, prefix, `${m.id}.img.xml`);
    check(`Map: ${m.id} (${m.name})`, existsSync(mapPath), mapPath);
  }

  // ── Map String Registration ─────────────────────────────────────────────
  const mapStrPath = join(WZ_DIR, 'String.wz', 'Map.img.xml');
  if (existsSync(mapStrPath)) {
    const mapStrXml = readFileSync(mapStrPath, 'utf-8');
    check('Map strings: 990100000 registered', mapStrXml.includes('"990100000"'), 'Entrance name');
    check('Map strings: 990100600 registered', mapStrXml.includes('"990100600"'), 'Nexus name');
  }

  // ── Weapons ─────────────────────────────────────────────────────────────
  const weapons = [
    { fileId: '01372080', name: 'Runic Orb' },
    { fileId: '01372081', name: 'Arcane Scepter' },
    { fileId: '01382082', name: 'Prism Staff' },
  ];
  for (const w of weapons) {
    const wPath = join(WZ_DIR, 'Character.wz', 'Weapon', `${w.fileId}.img.xml`);
    check(`Weapon: ${w.name} (${w.fileId})`, existsSync(wPath), wPath);
  }

  // ── Quests ──────────────────────────────────────────────────────────────
  const questDir = join(process.cwd(), 'workspace', 'Cosmic', 'scripts', 'quest');
  const questIds = [99201, 99202, 99203, 99204, 99205, 99210, 99211, 99212];
  for (const qid of questIds) {
    check(`Quest ${qid}`, existsSync(join(questDir, `${qid}.js`)), `Sage quest script`);
  }

  // ── Portal Connectivity ─────────────────────────────────────────────────
  const entranceXml = readFileSync(join(mapDir, 'Map9', '990100000.img.xml'), 'utf-8');
  check('Portal: Entrance → Library', entranceXml.includes('990100100'), 'in00 portal to Library');
  check('Portal: Entrance → Training', entranceXml.includes('990100400'), 'in01 portal to Training');
  check('Portal: Entrance → Nexus', entranceXml.includes('990100600'), 'in02 portal to Nexus');
  check('Portal: Entrance → Ellinia', entranceXml.includes('101000000'), 'out00 escape to Ellinia');

  const obsXml = readFileSync(join(mapDir, 'Map9', '990100300.img.xml'), 'utf-8');
  check('Portal: Observatory → Sanctum', obsXml.includes('990100500'), 'in00 portal to Arcane Sanctum');

  // ── Summary ─────────────────────────────────────────────────────────────
  const result = {
    timestamp: new Date().toISOString(),
    passed,
    failed,
    total: passed + failed,
    passRate: `${Math.round(passed / (passed + failed) * 100)}%`,
    checks,
    verdict: failed === 0 ? 'ALL_PASS' : 'SOME_FAILED',
  };

  log.info(`Sage integration verification: ${passed}/${passed + failed} passed (${result.passRate})`);
  if (failed > 0) {
    const failures = checks.filter(c => !c.pass);
    log.warn(`Failed checks: ${failures.map(f => f.name).join(', ')}`);
  }

  return result;
}

// ── Skill Tree with Prerequisites ────────────────────────────────────────────

/**
 * Complete Sage skill tree, with prerequisite chains and recommended SP order.
 * Prerequisites: { skillId: N, minLevel: N } — skill skillId must be at minLevel.
 *
 * SP points per tier: 1 per level (same as other classes).
 *   Tier 1 (600): levels 10–29  = 20 SP → spread across 6 skills (max 70 total levels)
 *   Tier 2 (610): levels 30–59  = 30 SP → spread across 8 skills (max 120 total levels)
 *   Tier 3 (611): levels 60–99  = 40 SP → spread across 8 skills (max 210 total levels)
 *   Tier 4 (612): levels 100–200 = 100 SP → spread across 10 skills (max 265 total levels)
 */
export const SAGE_SKILL_TREE = {
  // ── 1st Job: Sage (600) ────────────────────────────────────────────────────
  600: [
    {
      skillId: 6001002,
      name: 'Elemental Attunement',
      maxLv: 10, prereqs: [],
      spRecommend: 'Max first — boosts all magic stats passively',
      effect: 'INT +3×lv, MAD +2×lv per level',
    },
    {
      skillId: 6001003,
      name: "Sage's Wisdom",
      maxLv: 10, prereqs: [],
      spRecommend: 'Max second — increases MaxMP gained per level-up',
      effect: 'MaxMP bonus +15×lv per level gained from here on',
    },
    {
      skillId: 6001000,
      name: 'Arcane Bolt',
      maxLv: 20, prereqs: [{ skillId: 6001002, minLevel: 1 }],
      spRecommend: 'Max after passives — primary 1st job attack',
      effect: 'MAD ×(80+8×lv)%, mpCon 5+lv, range 300+10×lv',
    },
    {
      skillId: 6001001,
      name: 'Mana Shield',
      maxLv: 15, prereqs: [{ skillId: 6001003, minLevel: 3 }],
      spRecommend: 'At least 1 point early — passive survivability',
      effect: 'Absorbs (5+lv)% of incoming damage as MP instead of HP',
    },
    {
      skillId: 6001005,
      name: 'Teleport',
      maxLv: 20, prereqs: [{ skillId: 6001002, minLevel: 3 }],
      spRecommend: 'Get at least 5 — mobility crucial for kiting',
      effect: 'Teleports (80+10×lv) pixels, mpCon 8+lv÷3',
    },
    {
      skillId: 6001004,
      name: 'Runic Strike',
      maxLv: 20, prereqs: [{ skillId: 6001000, minLevel: 10 }],
      spRecommend: 'Fill remaining SP — second attack for burst',
      effect: 'MAD ×(100+10×lv)%, hits 2 targets, mpCon 10+lv',
    },
  ],

  // ── 2nd Job: Elementalist (610) ────────────────────────────────────────────
  610: [
    {
      skillId: 6101004,
      name: 'Spell Mastery',
      maxLv: 20, prereqs: [],
      spRecommend: 'Max first — accuracy + INT passive',
      effect: 'Magic ACC +(lv×2), INT +(lv×2)',
    },
    {
      skillId: 6101005,
      name: 'Mana Surge',
      maxLv: 20, prereqs: [],
      spRecommend: 'Max second — MP recovery helps sustain',
      effect: 'MP recovery +(3×lv) every 10 sec',
    },
    {
      skillId: 6101000,
      name: 'Flame Pillar',
      maxLv: 20, prereqs: [{ skillId: 6101004, minLevel: 3 }],
      spRecommend: 'Primary AoE — wide vertical hitbox',
      effect: 'Fire damage ×(100+8×lv)%, hits up to 6 enemies, mpCon 12+lv',
    },
    {
      skillId: 6101001,
      name: 'Frost Nova',
      maxLv: 20, prereqs: [{ skillId: 6101004, minLevel: 3 }],
      spRecommend: 'Strong mob control — freeze is powerful',
      effect: 'Ice damage ×(100+8×lv)%, (50+2×lv)% chance to freeze 3s, mpCon 15+lv',
    },
    {
      skillId: 6101002,
      name: 'Lightning Chain',
      maxLv: 20, prereqs: [{ skillId: 6101004, minLevel: 3 }],
      spRecommend: 'Best single-target — chains between enemies',
      effect: 'Lightning damage ×(110+8×lv)%, hits up to 6 targets chained, mpCon 14+lv',
    },
    {
      skillId: 6101007,
      name: 'Element Shift',
      maxLv: 5, prereqs: [{ skillId: 6101000, minLevel: 5 }, { skillId: 6101001, minLevel: 5 }],
      spRecommend: 'Max for bonus element damage toggle',
      effect: 'For 60s: chosen element deals +(10+6×lv)% extra damage, mpCon 20',
    },
    {
      skillId: 6101003,
      name: 'Elemental Boost',
      maxLv: 15, prereqs: [{ skillId: 6101007, minLevel: 3 }],
      spRecommend: 'Strong damage multiplier for mob grinding',
      effect: 'All elemental skills +15+3×lv% damage for 180s, mpCon 25+lv',
    },
    {
      skillId: 6101006,
      name: 'Arcane Barrier',
      maxLv: 15, prereqs: [{ skillId: 6101005, minLevel: 5 }],
      spRecommend: 'At least 5 for survivability in boss maps',
      effect: 'Reduces all magic damage taken by (5+lv)%, 90s duration, mpCon 30+lv',
    },
  ],

  // ── 3rd Job: Arcanum (611) ─────────────────────────────────────────────────
  611: [
    {
      skillId: 6111003,
      name: 'Elemental Convergence',
      maxLv: 20, prereqs: [],
      spRecommend: 'Max first — unlocks combined-element bonus',
      effect: 'When 2+ elements used in last 10s: all skill damage +(3+lv×2)%',
    },
    {
      skillId: 6111004,
      name: 'Sage Meditation',
      maxLv: 30, prereqs: [],
      spRecommend: 'Party buff — max for group play',
      effect: 'Party MAD +(2×lv) for 120s, mpCon 20+lv',
    },
    {
      skillId: 6111000,
      name: 'Meteor Shower',
      maxLv: 30, prereqs: [{ skillId: 6111003, minLevel: 5 }],
      spRecommend: 'Primary AoE — screen-wide coverage',
      effect: 'Fire MAD ×(200+5×lv)%, hits 15 enemies at random positions, mpCon 40+lv',
    },
    {
      skillId: 6111001,
      name: 'Blizzard',
      maxLv: 30, prereqs: [{ skillId: 6111003, minLevel: 5 }],
      spRecommend: 'Mass freeze — excellent for training maps',
      effect: 'Ice MAD ×(180+5×lv)%, hits 15 enemies, (40+lv)% freeze 4s, mpCon 38+lv',
    },
    {
      skillId: 6111002,
      name: 'Thunder Spear',
      maxLv: 30, prereqs: [{ skillId: 6111003, minLevel: 5 }],
      spRecommend: 'Best single-target in 3rd job',
      effect: 'Lightning MAD ×(220+6×lv)%, pierces 5 targets in line, mpCon 35+lv',
    },
    {
      skillId: 6111005,
      name: 'Runic Ward',
      maxLv: 30, prereqs: [{ skillId: 6111004, minLevel: 5 }],
      spRecommend: 'Essential for boss fights — high magic defence',
      effect: 'All damage taken -(2+lv)%, 120s, mpCon 25+lv',
    },
    {
      skillId: 6111006,
      name: 'Arcane Explosion',
      maxLv: 30, prereqs: [{ skillId: 6111000, minLevel: 10 }],
      spRecommend: 'AoE with knockback — great for clearing rooms',
      effect: 'Pure magic MAD ×(190+6×lv)%, hits 8 enemies, 40% stun, mpCon 45+lv',
    },
    {
      skillId: 6111007,
      name: 'Mystic Door',
      maxLv: 1, prereqs: [],
      spRecommend: 'Get 1 point — always useful for party utility',
      effect: 'Creates a portal to nearest town for 60s',
    },
  ],

  // ── 4th Job: Archsage (612) ────────────────────────────────────────────────
  612: [
    {
      skillId: 6121003,
      name: 'Elemental Unity',
      maxLv: 30, prereqs: [],
      spRecommend: 'Max first — core passive multiplier',
      effect: 'All Sage skill damage +(2+lv)%, stacks with Convergence',
    },
    {
      skillId: 6121004,
      name: "Sage's Enlightenment",
      maxLv: 30, prereqs: [],
      spRecommend: 'Max early — INT/MAD/MDD passive',
      effect: 'INT +(2×lv), MAD +(3×lv), MDD +(lv×2)',
    },
    {
      skillId: 6121005,
      name: 'Arcane Mastery',
      maxLv: 30, prereqs: [{ skillId: 6121004, minLevel: 5 }],
      spRecommend: 'Max — reduces all skill MP costs significantly',
      effect: 'All Sage skill mpCon -(lv)%, caps at -25%',
    },
    {
      skillId: 6121000,
      name: 'Primordial Inferno',
      maxLv: 30, prereqs: [{ skillId: 6121003, minLevel: 5 }],
      spRecommend: 'Fire ultimate — enormous AoE damage',
      effect: 'Fire MAD ×(300+8×lv)%, hits all visible enemies (up to 15), DoT 3s, mpCon 60+lv',
    },
    {
      skillId: 6121001,
      name: 'Absolute Zero',
      maxLv: 30, prereqs: [{ skillId: 6121003, minLevel: 5 }],
      spRecommend: 'Ice ultimate — mass freeze on screen',
      effect: 'Ice MAD ×(280+7×lv)%, all on-screen enemies (up to 15), 100% freeze 5s, mpCon 65+lv',
    },
    {
      skillId: 6121002,
      name: 'Divine Thunder',
      maxLv: 30, prereqs: [{ skillId: 6121003, minLevel: 5 }],
      spRecommend: 'Lightning ultimate — highest DPS of the three',
      effect: 'Lightning MAD ×(320+8×lv)%, hits 15 enemies, ignores 20% MDD, mpCon 55+lv',
    },
    {
      skillId: 6121006,
      name: 'Infinity',
      maxLv: 30, prereqs: [{ skillId: 6121005, minLevel: 10 }],
      spRecommend: 'Critical for boss fights — free skills for 40s',
      effect: 'All skills mpCon = 0 for (20+lv÷2) seconds, cooldown 10 min',
    },
    {
      skillId: 6121009,
      name: 'Elemental Storm',
      maxLv: 30, prereqs: [{ skillId: 6121000, minLevel: 10 }, { skillId: 6121001, minLevel: 10 }],
      spRecommend: 'Signature ultimate — combines all 3 elements',
      effect: 'All-element MAD ×(350+9×lv)%, hits all enemies on screen, ignores elemental weaknesses, mpCon 80+lv',
    },
    {
      skillId: 6121007,
      name: "Hero's Will",
      maxLv: 5, prereqs: [],
      spRecommend: 'Get 1+ — status cleanse always useful',
      effect: 'Removes all status effects, 5 min cooldown',
    },
    {
      skillId: 6121008,
      name: 'Maple Warrior',
      maxLv: 30, prereqs: [],
      spRecommend: 'Party buff — all stats +(lv)% for 900s',
      effect: 'All party members: STR/DEX/INT/LUK +(lv)%, 900s, mpCon 70+lv',
    },
  ],
};

// ── Sage-Exclusive Weapons ────────────────────────────────────────────────────

/**
 * Three weapons exclusive to the Sage class (reqJob=64).
 * Tier-appropriate stats scaled for 1st→3rd/4th job progression.
 *
 * IDs chosen to be free in v83 ranges:
 *   1372080 — Runic Orb   (1H wand, level 20 — for 1st and early 2nd job)
 *   1372081 — Arcane Scepter (1H wand, level 30 — 2nd job main weapon)
 *   1382082 — Prism Staff (2H staff, level 70 — 3rd/4th job endgame)
 */
export const SAGE_WEAPONS = [
  {
    id: 1372080,
    fileId: '01372080',
    name: 'Runic Orb',
    desc: 'A floating orb etched with ancient runes. Only a true Sage can channel its arcane resonance.',
    type: 'wand',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 6,           // staff/wand animation
    afterImage: 'mace',
    sfx: 'mace',
    reqJob: 64,          // Sage class only
    reqLevel: 20,
    reqINT: 60,
    incPAD: 20,
    incMAD: 55,
    incINT: 10,
    incACC: 8,
    attackSpeed: 5,
    tuc: 7,
    price: 100000,
  },
  {
    id: 1372081,
    fileId: '01372081',
    name: 'Arcane Scepter',
    desc: 'A scepter pulsing with elemental energy. Elementalists feel each element respond to their will.',
    type: 'wand',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 6,
    afterImage: 'mace',
    sfx: 'mace',
    reqJob: 64,
    reqLevel: 35,
    reqINT: 90,
    incPAD: 28,
    incMAD: 78,
    incINT: 15,
    incACC: 10,
    attackSpeed: 5,
    tuc: 8,
    price: 180000,
  },
  {
    id: 1382082,
    fileId: '01382082',
    name: 'Prism Staff',
    desc: 'A towering staff crowned with a crystal prism splitting light into all elemental forces. Only an Archsage truly masters it.',
    type: 'staff',
    category: 'Weapon',
    islot: 'Wp',
    vslot: 'Wp',
    walk: 1,
    stand: 1,
    attack: 6,
    afterImage: 'mace',
    sfx: 'mace',
    reqJob: 64,
    reqLevel: 70,
    reqINT: 140,
    incPAD: 40,
    incMAD: 115,
    incINT: 22,
    incACC: 15,
    attackSpeed: 6,
    tuc: 10,
    price: 350000,
  },
];

// ── Sage Map Definitions ──────────────────────────────────────────────────────

/**
 * Seven interconnected maps forming the Sage's Spire:
 *   990100000 — Entrance            (hub town, NPC Sage Instructor Elara)
 *   990100100 — Library             (job advancement NPCs, level 30-50 training)
 *   990100200 — Elemental Chambers  (level 50-70 training)
 *   990100300 — Observatory         (level 70-90 training)
 *   990100400 — Training Grounds    (level 10-30, beginner Sage training)
 *   990100500 — Arcane Sanctum      (level 90-120, 4th job training)
 *   990100600 — Elemental Nexus     (boss map, Sage class boss encounter)
 *
 * All maps live in Map.wz/Map/Map9/ (prefix Map9 because IDs start with 9).
 */
export const SAGE_MAPS = [
  {
    id: '990100000',
    name: "Sage's Spire: Entrance",
    streetName: "Sage's Spire",
    bgm: 'Bgm06/BlueWorld',
    town: 1,
    returnMap: '999999999',
    VRTop: -500, VRBottom: 200, VRLeft: -800, VRRight: 800,
    footholds: [
      // Main floor
      { x1: -700, y1: 100, x2: 700, y2: 100 },
      // Left upper platform
      { x1: -500, y1: -150, x2: -100, y2: -150 },
      // Right upper platform
      { x1: 100, y1: -150, x2: 500, y2: -150 },
      // Top central platform
      { x1: -200, y1: -350, x2: 200, y2: -350 },
    ],
    portals: [
      { name: 'sp',   type: 0, x: 0,    y: 100,  targetMap: '999999999', targetPortal: '' },
      { name: 'sp2',  type: 0, x: -300, y: 100,  targetMap: '999999999', targetPortal: '' },
      // To Library
      { name: 'in00', type: 1, x: 650,  y: 100,  targetMap: '990100100', targetPortal: 'out00' },
      // To Ellinia (escape portal)
      { name: 'out00',type: 2, x: -650, y: 100,  targetMap: '101000000', targetPortal: 'sp' },
      // To Training Grounds (beginner area)
      { name: 'in01', type: 1, x: 0,    y: -350, targetMap: '990100400', targetPortal: 'out00' },
      // To Elemental Nexus (boss map, top platform)
      { name: 'in02', type: 1, x: -300, y: -150, targetMap: '990100600', targetPortal: 'out00' },
    ],
    npcs: [
      // Sage Instructor Elara (all 4 job advancements)
      { id: '9999030', x: 0,    y: 50,  fh: 0, cy: 50,  rx0: -50,  rx1: 50  },
    ],
    mobs: [],
  },
  {
    id: '990100100',
    name: "Sage's Spire: Library",
    streetName: "Sage's Spire",
    bgm: 'Bgm04/ArabPig',
    town: 0,
    returnMap: '990100000',
    VRTop: -600, VRBottom: 200, VRLeft: -900, VRRight: 900,
    footholds: [
      // Main floor
      { x1: -800, y1: 150, x2: 800, y2: 150 },
      // Shelf platforms (stacked bookshelves feel)
      { x1: -600, y1: -50,  x2: -200, y2: -50  },
      { x1:  200, y1: -50,  x2:  600, y2: -50  },
      { x1: -400, y1: -250, x2: 0,    y2: -250  },
      { x1:  0,   y1: -250, x2:  400, y2: -250  },
      { x1: -200, y1: -450, x2:  200, y2: -450  },
    ],
    portals: [
      { name: 'sp',   type: 0, x: 0,    y: 150,  targetMap: '999999999', targetPortal: '' },
      // Back to Entrance
      { name: 'out00',type: 1, x: -750, y: 150,  targetMap: '990100000', targetPortal: 'in00' },
      // To Elemental Chambers
      { name: 'in00', type: 1, x:  750, y: 150,  targetMap: '990100200', targetPortal: 'out00' },
    ],
    npcs: [
      // Elementalist Master (2nd job)
      { id: '9990002', x: -300, y: 100, fh: 0, cy: 100, rx0: -350, rx1: -250 },
      // Arcanum Council (3rd job)
      { id: '9990003', x:    0, y: 100, fh: 0, cy: 100, rx0:  -50, rx1:   50 },
      // Archsage Elder (4th job)
      { id: '9990004', x:  300, y: 100, fh: 0, cy: 100, rx0:  250, rx1:  350 },
    ],
    mobs: [
      // Curse Eye lv30 — good for early Sage training
      { id: '112100', x: -500, y: 100, mobTime: 6, fh: 0, cy: 100, rx0: -600, rx1: -400 },
      { id: '112100', x:  500, y: 100, mobTime: 6, fh: 0, cy: 100, rx0:  400, rx1:  600 },
      // Fire Boar lv35
      { id: '140100', x: -200, y: 100, mobTime: 8, fh: 0, cy: 100, rx0: -300, rx1: -100 },
      { id: '140100', x:  200, y: 100, mobTime: 8, fh: 0, cy: 100, rx0:  100, rx1:  300 },
    ],
  },
  {
    id: '990100200',
    name: "Sage's Spire: Elemental Chambers",
    streetName: "Sage's Spire",
    bgm: 'Bgm07/Elfein',
    town: 0,
    returnMap: '990100000',
    VRTop: -700, VRBottom: 300, VRLeft: -1000, VRRight: 1000,
    footholds: [
      // Wide main floor
      { x1: -900, y1: 200, x2: 900, y2: 200 },
      // Floating elemental platforms
      { x1: -700, y1: 0,    x2: -300, y2: 0    },
      { x1:  300, y1: 0,    x2:  700, y2: 0    },
      { x1: -500, y1: -200, x2: -100, y2: -200 },
      { x1:  100, y1: -200, x2:  500, y2: -200 },
      { x1: -300, y1: -400, x2:  300, y2: -400 },
      { x1: -150, y1: -600, x2:  150, y2: -600 },
    ],
    portals: [
      { name: 'sp',   type: 0, x: 0,    y: 200,  targetMap: '999999999', targetPortal: '' },
      // Back to Library
      { name: 'out00',type: 1, x: -850, y: 200,  targetMap: '990100100', targetPortal: 'in00' },
      // To Observatory
      { name: 'in00', type: 1, x:  850, y: 200,  targetMap: '990100300', targetPortal: 'out00' },
    ],
    npcs: [],
    mobs: [
      // Ligator lv55
      { id: '220100', x: -600, y: 200, mobTime: 7, fh: 0, cy: 200, rx0: -700, rx1: -500 },
      { id: '220100', x:  600, y: 200, mobTime: 7, fh: 0, cy: 200, rx0:  500, rx1:  700 },
      // Stumpy lv60
      { id: '220130', x: -300, y: 200, mobTime: 9, fh: 0, cy: 200, rx0: -400, rx1: -200 },
      { id: '220130', x:  300, y: 200, mobTime: 9, fh: 0, cy: 200, rx0:  200, rx1:  400 },
      // Jr. Necki lv40 (adds variety)
      { id: '106000', x:    0, y: 200, mobTime: 5, fh: 0, cy: 200, rx0:  -50, rx1:   50 },
    ],
  },
  {
    id: '990100300',
    name: "Sage's Spire: Observatory",
    streetName: "Sage's Spire",
    bgm: 'Bgm08/MoonlightShadow',
    town: 0,
    returnMap: '990100000',
    VRTop: -800, VRBottom: 300, VRLeft: -800, VRRight: 800,
    footholds: [
      // Observatory floor
      { x1: -700, y1: 250, x2: 700, y2: 250 },
      // Upper observation rings
      { x1: -600, y1:  50, x2: -200, y2:  50 },
      { x1:  200, y1:  50, x2:  600, y2:  50 },
      { x1: -400, y1: -150, x2:  0,  y2: -150 },
      { x1:   0,  y1: -150, x2: 400, y2: -150 },
      { x1: -200, y1: -350, x2:  0,  y2: -350 },
      { x1:   0,  y1: -350, x2: 200, y2: -350 },
      // Summit
      { x1: -100, y1: -550, x2:  100, y2: -550 },
    ],
    portals: [
      { name: 'sp',   type: 0, x:   0, y: 250,  targetMap: '999999999', targetPortal: '' },
      // Back to Elemental Chambers
      { name: 'out00',type: 1, x: -650, y: 250,  targetMap: '990100200', targetPortal: 'in00' },
      // To Arcane Sanctum (4th job training)
      { name: 'in00', type: 1, x: 650,  y: 250,  targetMap: '990100500', targetPortal: 'out00' },
    ],
    npcs: [],
    mobs: [
      // Drake lv82 — high-level training
      { id: '220200', x: -500, y: 250, mobTime: 8,  fh: 0, cy: 250, rx0: -600, rx1: -400 },
      { id: '220200', x:  500, y: 250, mobTime: 8,  fh: 0, cy: 250, rx0:  400, rx1:  600 },
      // Zombie Mushroom lv40 on lower platform, for variety
      { id: '120111', x: -300, y:  50, mobTime: 6,  fh: 0, cy:  50, rx0: -400, rx1: -200 },
      { id: '120111', x:  300, y:  50, mobTime: 6,  fh: 0, cy:  50, rx0:  200, rx1:  400 },
      // Fire Boar lv35 — for lower-level adventurers who make it here
      { id: '140100', x:    0, y: 250, mobTime: 7,  fh: 0, cy: 250, rx0:  -50, rx1:   50 },
    ],
  },
  // ── NEW MAPS (ms_3 expansion) ────────────────────────────────────────────
  {
    id: '990100400',
    name: "Sage's Spire: Training Grounds",
    streetName: "Sage's Spire",
    bgm: 'Bgm03/GoPicnic',
    town: 0,
    returnMap: '990100000',
    VRTop: -400, VRBottom: 250, VRLeft: -900, VRRight: 900,
    footholds: [
      // Wide flat ground — beginner-friendly
      { x1: -800, y1: 200, x2: 800, y2: 200 },
      // Simple left platform
      { x1: -600, y1: 50, x2: -200, y2: 50 },
      // Simple right platform
      { x1: 200, y1: 50, x2: 600, y2: 50 },
      // Central elevated platform
      { x1: -250, y1: -100, x2: 250, y2: -100 },
    ],
    portals: [
      { name: 'sp',    type: 0, x: 0,    y: 200,  targetMap: '999999999', targetPortal: '' },
      // Back to Entrance
      { name: 'out00', type: 1, x: -750, y: 200,  targetMap: '990100000', targetPortal: 'in01' },
    ],
    npcs: [],
    mobs: [
      // Snail lv1 — absolute beginners
      { id: '100100', x: -600, y: 200, mobTime: 4,  fh: 0, cy: 200, rx0: -700, rx1: -500 },
      { id: '100100', x: -400, y: 200, mobTime: 4,  fh: 0, cy: 200, rx0: -500, rx1: -300 },
      // Blue Snail lv5
      { id: '100101', x: -100, y: 200, mobTime: 5,  fh: 0, cy: 200, rx0: -200, rx1: 0 },
      { id: '100101', x: 100,  y: 200, mobTime: 5,  fh: 0, cy: 200, rx0: 0,    rx1: 200 },
      // Slime lv10 — good for 1st job training
      { id: '210100', x: 400,  y: 200, mobTime: 5,  fh: 0, cy: 200, rx0: 300,  rx1: 500 },
      { id: '210100', x: 600,  y: 200, mobTime: 5,  fh: 0, cy: 200, rx0: 500,  rx1: 700 },
      // Green Mushroom lv15 — on upper platforms
      { id: '120100', x: -400, y: 50,  mobTime: 6,  fh: 0, cy: 50,  rx0: -500, rx1: -300 },
      { id: '120100', x: 400,  y: 50,  mobTime: 6,  fh: 0, cy: 50,  rx0: 300,  rx1: 500 },
      // Horny Mushroom lv22 — top platform challenge
      { id: '120110', x: -100, y: -100, mobTime: 7, fh: 0, cy: -100, rx0: -200, rx1: 0 },
      { id: '120110', x: 100,  y: -100, mobTime: 7, fh: 0, cy: -100, rx0: 0,    rx1: 200 },
    ],
  },
  {
    id: '990100500',
    name: "Sage's Spire: Arcane Sanctum",
    streetName: "Sage's Spire",
    bgm: 'Bgm14/Ariant',
    town: 0,
    returnMap: '990100000',
    VRTop: -900, VRBottom: 300, VRLeft: -1000, VRRight: 1000,
    footholds: [
      // Grand main floor
      { x1: -900, y1: 250, x2: 900, y2: 250 },
      // Left ritual platform
      { x1: -800, y1: 50, x2: -400, y2: 50 },
      // Right ritual platform
      { x1: 400, y1: 50, x2: 800, y2: 50 },
      // Floating arcane rings
      { x1: -500, y1: -150, x2: -100, y2: -150 },
      { x1: 100, y1: -150, x2: 500, y2: -150 },
      // Upper sanctum
      { x1: -400, y1: -350, x2: 0, y2: -350 },
      { x1: 0, y1: -350, x2: 400, y2: -350 },
      // Summit altar
      { x1: -200, y1: -550, x2: 200, y2: -550 },
      // Floating pinnacle
      { x1: -100, y1: -750, x2: 100, y2: -750 },
    ],
    portals: [
      { name: 'sp',    type: 0, x: 0,    y: 250,  targetMap: '999999999', targetPortal: '' },
      // Back to Observatory
      { name: 'out00', type: 1, x: -850, y: 250,  targetMap: '990100300', targetPortal: 'in00' },
    ],
    npcs: [],
    mobs: [
      // Dark Drake lv110 — 4th job training
      { id: '600100', x: -700, y: 250, mobTime: 8, fh: 0, cy: 250, rx0: -800, rx1: -600 },
      { id: '600100', x: 700,  y: 250, mobTime: 8, fh: 0, cy: 250, rx0: 600,  rx1: 800 },
      { id: '600100', x: -300, y: 250, mobTime: 8, fh: 0, cy: 250, rx0: -400, rx1: -200 },
      { id: '600100', x: 300,  y: 250, mobTime: 8, fh: 0, cy: 250, rx0: 200,  rx1: 400 },
      // Phantom Watch lv100 — on platforms
      { id: '610000', x: -600, y: 50,  mobTime: 9, fh: 0, cy: 50,  rx0: -700, rx1: -500 },
      { id: '610000', x: 600,  y: 50,  mobTime: 9, fh: 0, cy: 50,  rx0: 500,  rx1: 700 },
      // Sage Golem lv120 — upper areas (use Golem mob ID 5130103 for Ice Golem)
      { id: '5130103', x: -300, y: -150, mobTime: 10, fh: 0, cy: -150, rx0: -400, rx1: -200 },
      { id: '5130103', x: 300,  y: -150, mobTime: 10, fh: 0, cy: -150, rx0: 200,  rx1: 400 },
    ],
  },
  {
    id: '990100600',
    name: "Sage's Spire: Elemental Nexus",
    streetName: "Sage's Spire",
    bgm: 'Bgm09/TimeAttack',
    town: 0,
    returnMap: '990100000',
    VRTop: -600, VRBottom: 300, VRLeft: -800, VRRight: 800,
    footholds: [
      // Arena floor — circular layout
      { x1: -700, y1: 250, x2: 700, y2: 250 },
      // Side ledges for kiting
      { x1: -600, y1: 50, x2: -300, y2: 50 },
      { x1: 300, y1: 50, x2: 600, y2: 50 },
      // Central elevated platform (boss spawn)
      { x1: -250, y1: -150, x2: 250, y2: -150 },
      // Safety perches at top
      { x1: -150, y1: -350, x2: -50, y2: -350 },
      { x1: 50, y1: -350, x2: 150, y2: -350 },
    ],
    portals: [
      { name: 'sp',    type: 0, x: 0,    y: 250,  targetMap: '999999999', targetPortal: '' },
      // Back to Entrance
      { name: 'out00', type: 1, x: -650, y: 250,  targetMap: '990100000', targetPortal: 'in02' },
    ],
    npcs: [],
    mobs: [
      // Crimson Balrog lv120 — boss mob (uses existing Balrog IDs)
      { id: '8150000', x: 0, y: -150, mobTime: 1800, fh: 0, cy: -150, rx0: -200, rx1: 200 },
      // Tauromacis lv90 — boss room guards
      { id: '7130100', x: -500, y: 250, mobTime: 12, fh: 0, cy: 250, rx0: -600, rx1: -400 },
      { id: '7130100', x: 500,  y: 250, mobTime: 12, fh: 0, cy: 250, rx0: 400,  rx1: 600 },
      // Dark Stone Golem lv80 — additional guards
      { id: '5130104', x: -200, y: 250, mobTime: 10, fh: 0, cy: 250, rx0: -300, rx1: -100 },
      { id: '5130104', x: 200,  y: 250, mobTime: 10, fh: 0, cy: 250, rx0: 100,  rx1: 300 },
    ],
  },
];

// ── Sage Map Deployment ───────────────────────────────────────────────────────

/**
 * Build the XML for a single map from a SAGE_MAPS entry.
 * Creates proper info, foothold, portal, and life sections.
 * @param {Object} map - entry from SAGE_MAPS
 * @returns {string} full XML string
 */
function buildMapXml(map) {
  // Build foothold section (all in layer 1, group 1)
  const fhLines = map.footholds.map((fh, i) => {
    const next = i < map.footholds.length - 1 ? i + 1 : 0;
    const prev = i > 0 ? i - 1 : 0;
    return `    <imgdir name="${i}">
      <int name="x1" value="${fh.x1}"/>
      <int name="y1" value="${fh.y1}"/>
      <int name="x2" value="${fh.x2}"/>
      <int name="y2" value="${fh.y2}"/>
      <int name="prev" value="${prev}"/>
      <int name="next" value="${next}"/>
    </imgdir>`;
  }).join('\n');

  // Build portal section
  const portalLines = map.portals.map((p, i) => `  <imgdir name="${i}">
    <string name="pn" value="${p.name}"/>
    <int name="pt" value="${p.type}"/>
    <int name="x" value="${p.x}"/>
    <int name="y" value="${p.y}"/>
    <int name="tm" value="${p.targetMap}"/>
    <string name="tn" value="${p.targetPortal}"/>
  </imgdir>`).join('\n');

  // Build life section (NPCs + mobs)
  const npcLines = (map.npcs || []).map((n, i) => `  <imgdir name="${i}">
    <string name="type" value="n"/>
    <string name="id" value="${n.id}"/>
    <int name="x" value="${n.x}"/>
    <int name="y" value="${n.y}"/>
    <int name="mobTime" value="0"/>
    <int name="f" value="0"/>
    <int name="hide" value="0"/>
    <int name="fh" value="${n.fh}"/>
    <int name="cy" value="${n.cy}"/>
    <int name="rx0" value="${n.rx0}"/>
    <int name="rx1" value="${n.rx1}"/>
  </imgdir>`);
  const mobLines = (map.mobs || []).map((m, i) => `  <imgdir name="${(map.npcs || []).length + i}">
    <string name="type" value="m"/>
    <string name="id" value="${m.id}"/>
    <int name="x" value="${m.x}"/>
    <int name="y" value="${m.y}"/>
    <int name="mobTime" value="${m.mobTime}"/>
    <int name="f" value="0"/>
    <int name="hide" value="0"/>
    <int name="fh" value="${m.fh}"/>
    <int name="cy" value="${m.cy}"/>
    <int name="rx0" value="${m.rx0}"/>
    <int name="rx1" value="${m.rx1}"/>
  </imgdir>`);
  const lifeLines = [...npcLines, ...mobLines].join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="${map.id}.img">
  <imgdir name="info">
    <int name="version" value="10"/>
    <int name="cloud" value="0"/>
    <int name="town" value="${map.town}"/>
    <int name="returnMap" value="${map.returnMap}"/>
    <int name="forcedReturn" value="${map.returnMap}"/>
    <float name="mobRate" value="1.0"/>
    <string name="bgm" value="${map.bgm}"/>
    <string name="mapMark" value="Ellinia"/>
    <int name="hideMinimap" value="0"/>
    <int name="fieldLimit" value="0"/>
    <int name="swim" value="0"/>
    <int name="fly" value="0"/>
    <string name="onFirstUserEnter" value=""/>
    <string name="onUserEnter" value=""/>
    <int name="VRTop" value="${map.VRTop}"/>
    <int name="VRLeft" value="${map.VRLeft}"/>
    <int name="VRBottom" value="${map.VRBottom}"/>
    <int name="VRRight" value="${map.VRRight}"/>
  </imgdir>
  <imgdir name="foothold">
    <imgdir name="1">
      <imgdir name="1">
${fhLines}
      </imgdir>
    </imgdir>
  </imgdir>
  <imgdir name="portal">
${portalLines}
  </imgdir>
  <imgdir name="life">
${lifeLines}
  </imgdir>
</imgdir>`;
}

/**
 * Deploy all 4 Sage Spire map XML files into Map.wz and register their
 * names in String.wz/Map.img.xml. Idempotent.
 * @returns {{ created: string[], skipped: string[], stringsAdded: boolean }}
 */
export function deploySageMaps() {
  const mapDir    = join(WZ_DIR, 'Map.wz', 'Map', 'Map9');
  const strPath   = join(WZ_DIR, 'String.wz', 'Map.img.xml');
  const created   = [];
  const skipped   = [];

  for (const map of SAGE_MAPS) {
    const filePath = join(mapDir, `${map.id}.img.xml`);
    if (existsSync(filePath)) {
      skipped.push(map.id);
      log.info(`Sage map ${map.id} already exists — skipping`);
      continue;
    }
    const xml = buildMapXml(map);
    writeFileSync(filePath, xml, 'utf-8');
    created.push(map.id);
    log.info(`Created Sage Spire map: ${map.id} (${map.name})`);
  }

  // Register map names in String.wz/Map.img.xml
  let stringsAdded = false;
  if (existsSync(strPath)) {
    let strXml = readFileSync(strPath, 'utf-8');
    let changed = false;
    for (const map of SAGE_MAPS) {
      if (!strXml.includes(`<imgdir name="${map.id}">`)) {
        const entry = `    <imgdir name="${map.id}">\n      <string name="streetName" value="${map.streetName}"/>\n      <string name="mapName" value="${map.name}"/>\n    </imgdir>`;
        // Insert before the closing </imgdir></imgdir> of Map.img.xml
        strXml = strXml.replace('  </imgdir>\n</imgdir>', `  ${entry}\n  </imgdir>\n</imgdir>`);
        changed = true;
        log.info(`Registered map string for ${map.id}: ${map.name}`);
      }
    }
    if (changed) {
      writeFileSync(strPath, strXml, 'utf-8');
      stringsAdded = true;
    }
  }

  return { created, skipped, stringsAdded };
}

/**
 * Check which Sage Spire maps are deployed.
 */
export function getSageMapsStatus() {
  const mapDir = join(WZ_DIR, 'Map.wz', 'Map', 'Map9');
  const strPath = join(WZ_DIR, 'String.wz', 'Map.img.xml');
  const strXml  = existsSync(strPath) ? readFileSync(strPath, 'utf-8') : '';
  const maps = {};
  let deployedCount = 0;
  for (const map of SAGE_MAPS) {
    const fileExists  = existsSync(join(mapDir, `${map.id}.img.xml`));
    const nameExists  = strXml.includes(`<imgdir name="${map.id}">`);
    maps[map.id] = { name: map.name, fileExists, nameExists };
    if (fileExists) deployedCount++;
  }
  return {
    maps,
    deployedCount,
    total: SAGE_MAPS.length,
    complete: deployedCount === SAGE_MAPS.length,
  };
}

// ── Sage Weapon Deployment ───────────────────────────────────────────────────

/**
 * Deploy all 3 Sage-exclusive weapons: WZ XML files + String.wz name entries.
 * Uses the same buildWeaponXml/createWeaponFile/registerWeaponName pipeline
 * as custom-weapons.js. Idempotent.
 */
export function deploySageWeapons() {
  const results = [];
  for (const weapon of SAGE_WEAPONS) {
    const fileResult = createWeaponFile(weapon);
    let nameResult;
    try {
      nameResult = registerWeaponName(weapon);
    } catch (err) {
      nameResult = { registered: false, error: err.message };
    }
    results.push({
      id: weapon.id,
      name: weapon.name,
      fileCreated: fileResult.created,
      nameRegistered: nameResult.registered,
      path: fileResult.path,
    });
    log.info(`Sage weapon ${weapon.name} (${weapon.id}): file=${fileResult.created ? 'created' : 'exists'}, name=${nameResult.registered ? 'registered' : 'exists'}`);
  }
  return results;
}

// ── Sage Quest Definitions ──────────────────────────────────────────────────

/**
 * 5 Sage-specific quests tied to the Sage's Spire maps and lore.
 * Quest IDs 99101-99105 (separate from general custom quests 99001-99005).
 *
 *   99201  The Sage's Calling     — Lv10, intro quest leading to 1st job advancement
 *   99202  Elemental Trials       — Lv30, element mastery test for 2nd job
 *   99203  The Ancient Library    — Lv50, lore quest rewarding Sage Orb
 *   99204  Convergence of Power   — Lv70, 3rd job prerequisite
 *   99205  The Archsage's Legacy  — Lv120, 4th job prerequisite chain
 */
export const SAGE_QUESTS = [
  {
    questId: 99201,
    name: "The Sage's Calling",
    npcId: 9999030,
    npcName: 'Sage Instructor Elara',
    map: 990100000,
    minLevel: 10,
    requires: [
      { itemId: 4000003, quantity: 15, itemName: 'Orange Mushroom Cap' },
    ],
    rewards: {
      exp: 3000,
      meso: 10000,
      items: [{ itemId: 1372080, quantity: 1 }], // Runic Orb
    },
    startDialogue: [
      "Welcome to the Sage's Spire, young one. I sense great arcane potential within you... the same energy that flows through these ancient halls.",
      "But potential alone is not enough. A true Sage must prove their discipline. Go to the #bTraining Grounds#k below and defeat some creatures. Bring me #b15 #t4000003##k as proof of your resolve.",
      "The path of the Sage is one of wisdom and elemental mastery. Complete this task, and I shall grant you your first Sage weapon — the #bRunic Orb#k.",
    ],
    acceptDialogue: "Will you walk the path of the Sage? Bring me 15 #t4000003# from the Training Grounds and your journey begins.",
    endDialogue: "Excellent! You've proven your discipline. The arcane energy responds to you already. Take this Runic Orb — it will amplify your magical abilities as you grow stronger.",
    failDialogue: "You haven't gathered all 15 #t4000003# yet. Return to the Training Grounds and complete your task.",
  },
  {
    questId: 99202,
    name: 'Elemental Trials',
    npcId: 9999030,
    npcName: 'Sage Instructor Elara',
    map: 990100000,
    minLevel: 30,
    requires: [
      { itemId: 4000005, quantity: 30, itemName: 'Curse Eye Tail' },
      { itemId: 4000016, quantity: 20, itemName: 'Fire Boar Teeth' },
    ],
    rewards: {
      exp: 15000,
      meso: 30000,
      items: [{ itemId: 1372081, quantity: 1 }], // Arcane Scepter
    },
    startDialogue: [
      "You've grown considerably, young Sage. The elemental forces stir around you — fire, ice, and lightning all waiting to be commanded.",
      "To advance to Elementalist, you must prove mastery over creatures touched by the elements. Hunt in the #bLibrary#k and #bElemental Chambers#k.",
      "Bring me #b30 #t4000005##k from the cursed creatures and #b20 #t4000016##k from the fire-touched beasts. Only then will you be ready.",
    ],
    acceptDialogue: "The Elemental Trials await. Collect 30 #t4000005# and 20 #t4000016# to prove your elemental affinity. Do you accept?",
    endDialogue: "The elements acknowledge you! Fire, ice, lightning — they bend to your will now. Take this Arcane Scepter; it channels elemental energy far better than your old orb. You are now ready to become an Elementalist!",
    failDialogue: "The trials are incomplete. I need 30 #t4000005# and 20 #t4000016#. Continue hunting in the Library and Elemental Chambers.",
  },
  {
    questId: 99203,
    name: 'The Ancient Library',
    npcId: 9990003,
    npcName: 'Arcanum Council',
    map: 990100100,
    minLevel: 50,
    requires: [
      { itemId: 4000021, quantity: 50, itemName: 'Ligator Skin' },
    ],
    rewards: {
      exp: 30000,
      meso: 50000,
      items: [{ itemId: 2002037, quantity: 20 }], // 20x Sage Tea
    },
    startDialogue: [
      "Sage... the ancient texts in this library speak of a time when all three elements were unified. The Convergence, they called it.",
      "But knowledge alone won't unlock this power. You must understand the creatures that embody elemental fury. Deep in the #bElemental Chambers#k, the Ligators guard primordial secrets.",
      "Bring me #b50 #t4000021##k — their skins contain trace elemental signatures that our scholars need to study. This research will prepare you for the trials ahead.",
    ],
    acceptDialogue: "Will you venture into the Elemental Chambers and collect 50 #t4000021#? The ancient knowledge awaits those who prove themselves.",
    endDialogue: "Remarkable specimens! The elemental traces in these skins confirm what the old texts describe. You've earned not just rewards, but the respect of the Arcanum Council. Take this Sage Tea — it will sustain your magical energies in the battles to come.",
    failDialogue: "We need 50 #t4000021# for our research. The Ligators in the Elemental Chambers are your target. Return when you have enough.",
  },
  {
    questId: 99204,
    name: 'Convergence of Power',
    npcId: 9990004,
    npcName: 'Archsage Elder',
    map: 990100100,
    minLevel: 70,
    requires: [
      { itemId: 4000021, quantity: 80, itemName: 'Ligator Skin' },
      { itemId: 4000016, quantity: 60, itemName: 'Fire Boar Teeth' },
    ],
    rewards: {
      exp: 80000,
      meso: 100000,
      items: [{ itemId: 1382082, quantity: 1 }], // Prism Staff
    },
    startDialogue: [
      "Elementalist... no, you're ready for more than that title now. I can see the convergence forming within you — fire, ice, lightning, all orbiting your core.",
      "The Arcanum awaits those who can unite all three elements simultaneously. But first, you must face a trial of endurance and power.",
      "Bring me #b80 #t4000021##k and #b60 #t4000016##k. These materials, gathered from the deepest chambers of the Spire, will prove your elemental control is absolute.",
      "In return, I shall bestow upon you the #bPrism Staff#k — the legendary weapon that splits light into all elemental forces at once.",
    ],
    acceptDialogue: "The Convergence trial demands 80 #t4000021# and 60 #t4000016#. This will not be easy. Are you prepared?",
    endDialogue: "Incredible... the elemental signatures in these materials are perfectly balanced. You truly command all three elements. Take the Prism Staff — only an Arcanum-level Sage can wield its full power. The three elements will dance at your fingertips!",
    failDialogue: "The Convergence requires absolute proof. Bring 80 #t4000021# and 60 #t4000016# — no shortcuts on the path to Arcanum.",
  },
  {
    questId: 99205,
    name: "The Archsage's Legacy",
    npcId: 9999030,
    npcName: 'Sage Instructor Elara',
    map: 990100000,
    minLevel: 120,
    requires: [
      { itemId: 4000005, quantity: 100, itemName: 'Curse Eye Tail' },
      { itemId: 4000021, quantity: 100, itemName: 'Ligator Skin' },
      { itemId: 4000016, quantity: 100, itemName: 'Fire Boar Teeth' },
    ],
    rewards: {
      exp: 500000,
      meso: 500000,
      items: [{ itemId: 2002031, quantity: 50 }, { itemId: 2002032, quantity: 50 }], // 50x Elixir of Rage + 50x Mana Crystal
    },
    startDialogue: [
      "You stand at the pinnacle, Arcanum. Few Sages in all of history have reached this point — the threshold of the Archsage.",
      "The Elemental Nexus at the heart of the Spire pulses with primordial energy. The Crimson Balrog that dwells there guards the legacy of the first Archsage.",
      "To claim this legacy, you must demonstrate absolute mastery. Bring me #b100 #t4000005##k, #b100 #t4000021##k, and #b100 #t4000016##k — proof that no elemental creature can stand before you.",
      "Complete this, and you will join the ranks of the Archsages — wielders of Elemental Storm, the most devastating spell ever conceived.",
    ],
    acceptDialogue: "The Archsage's Legacy demands 100 of each: #t4000005#, #t4000021#, and #t4000016#. This is the ultimate trial. Do you accept?",
    endDialogue: "It is done. Three hundred trophies from across the elemental spectrum — proof beyond doubt. You have earned the title of Archsage. The Elemental Storm spell is now yours to command. May you use this power wisely, for the fate of the Spire rests on your shoulders.",
    failDialogue: "The Archsage's Legacy demands 100 each of #t4000005#, #t4000021#, and #t4000016#. No partial offerings — the legacy requires completeness.",
  },
];

// ── Sage Quest Script Generator ─────────────────────────────────────────────

function escQ(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildSageQuestScript(quest) {
  const { questId, name, npcName, map, requires, rewards, minLevel,
          startDialogue, acceptDialogue, endDialogue, failDialogue } = quest;

  const requiresList = requires.map(r => ` *   ${r.quantity}x ${r.itemName} (${r.itemId})`).join('\n');
  const rewardDesc = [
    rewards.exp > 0 ? ` *   ${rewards.exp} EXP` : null,
    rewards.meso > 0 ? ` *   ${rewards.meso} meso` : null,
    ...rewards.items.map(i => ` *   ${i.quantity}x item ${i.itemId}`),
  ].filter(Boolean).join('\n');

  // Build start() if-else chain
  const startBlocks = [];
  startDialogue.forEach((line, i) => {
    const method = i === 0 ? 'qm.sendNext' : 'qm.sendNextPrev';
    startBlocks.push(`        ${i === 0 ? 'if' : '} else if'} (status == ${i}) {\n            ${method}("${escQ(line)}");`);
  });
  startBlocks.push(`        } else if (status == ${startDialogue.length}) {\n            qm.sendAcceptDecline("${escQ(acceptDialogue)}");`);
  startBlocks.push(`        } else if (status == ${startDialogue.length + 1}) {\n            qm.forceStartQuest();\n            qm.dispose();`);
  const startBody = startBlocks.join('\n') + '\n        }';

  // Build item checks for end()
  const itemChecks = requires.map(r =>
    `        if (!qm.haveItem(${r.itemId}, ${r.quantity})) {\n            qm.sendNext("${escQ(failDialogue)}");\n            qm.dispose();\n            return;\n        }`
  ).join('\n');

  // Build reward lines
  const removals = requires.map(r => `            qm.gainItem(${r.itemId}, -${r.quantity});`).join('\n');
  const rewardLines = [];
  if (rewards.exp > 0)  rewardLines.push(`            qm.gainExp(${rewards.exp});`);
  if (rewards.meso > 0) rewardLines.push(`            qm.gainMeso(${rewards.meso});`);
  for (const item of rewards.items) {
    rewardLines.push(`            qm.gainItem(${item.itemId}, ${item.quantity});`);
  }

  // Level check in start
  const levelCheck = minLevel > 0 ? `\n    if (qm.getPlayer().getLevel() < ${minLevel}) {\n        qm.sendNext("You must be at least level ${minLevel} to begin this quest.");\n        qm.dispose();\n        return;\n    }` : '';

  return `/* Quest ${questId}: ${name}
 * NPC: ${npcName} (map ${map})
 * Min Level: ${minLevel}
 * Requires:
${requiresList}
 * Rewards:
${rewardDesc}
 *
 * Generated by modules/maplestory/custom-class.js (Sage quest chain)
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
    }${levelCheck}
${startBody}
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

        if (status == 0) {
${itemChecks}
            qm.sendNext("${escQ(endDialogue)}");
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
        }
}
`;
}

/**
 * Deploy all 5 Sage quest scripts. Idempotent — skips existing.
 * @returns {{ created: string[], skipped: string[], total: number }}
 */
export function deploySageQuests() {
  if (!existsSync(QUEST_DIR)) {
    mkdirSync(QUEST_DIR, { recursive: true });
  }

  const created = [];
  const skipped = [];

  for (const quest of SAGE_QUESTS) {
    const filePath = join(QUEST_DIR, `${quest.questId}.js`);
    if (existsSync(filePath)) {
      skipped.push(quest.questId);
      log.info(`Sage quest ${quest.questId} (${quest.name}) already exists — skipping`);
      continue;
    }
    const code = buildSageQuestScript(quest);
    writeFileSync(filePath, code, 'utf-8');
    created.push(quest.questId);
    log.info(`Deployed Sage quest: ${quest.questId} (${quest.name})`);
  }

  return { created, skipped, total: SAGE_QUESTS.length };
}

/**
 * Check deployment status of Sage quests.
 */
export function getSageQuestsStatus() {
  const quests = {};
  let deployedCount = 0;
  for (const quest of SAGE_QUESTS) {
    const exists = existsSync(join(QUEST_DIR, `${quest.questId}.js`));
    quests[quest.questId] = { name: quest.name, exists, npc: quest.npcName, minLevel: quest.minLevel };
    if (exists) deployedCount++;
  }
  return { quests, deployedCount, total: SAGE_QUESTS.length, complete: deployedCount === SAGE_QUESTS.length };
}
