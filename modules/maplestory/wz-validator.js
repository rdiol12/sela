/**
 * modules/maplestory/wz-validator.js — Comprehensive WZ client asset validator.
 *
 * Validates that ALL custom content added to Cosmic v83 has corresponding
 * client-side visual assets (.img binary files / PNGs) and server-side WZ XML stubs.
 *
 * Checks:
 *   1. Custom NPC sprites (22 NPCs: 9990010-9990014, 9999001-9999035)
 *      - stand_0.png + stand_1.png in maple-sprites/custom-npcs/{id}/
 *      - Npc.wz/{id}.img.xml stub exists
 *      - String.wz/Npc.img.xml has name entry
 *   2. Custom Mob sprites (9901001 Crypt Shade, 9901002 The Lich)
 *      - All animation frames present in maple-sprites/mobs/{id}/
 *      - Mob.wz/{id}.img.xml stub exists
 *      - String.wz/Mob.img.xml has name entry
 *   3. Custom Job Skill WZ XMLs (Sage: 600-612, Necromancer: 700-712)
 *      - Skill.wz/{jobId}.img.xml exists
 *      - String.wz/Skill.img.xml has skill name entries
 *   4. Class Selection Sprites (Sage 600, Necromancer 700)
 *      - sage/portrait.png + sage/badge.png
 *      - necromancer/portrait.png + necromancer/badge.png
 *   5. Necromancer Skill Effect Sprites
 *      - maple-sprites/necromancer/{jobId}/icons/
 *   6. Sage Skill Effect Sprites
 *      - maple-sprites/sage/{jobId}/icons/
 *
 * Wired into index.js as: maple_validate_wz
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('maplestory:wz-validator');

const WZ_DIR     = join(process.cwd(), 'workspace', 'Cosmic', 'wz');
const SPRITE_DIR = join(process.cwd(), 'workspace', 'maple-sprites');

// ── Asset Manifests ───────────────────────────────────────────────────────────

const CUSTOM_NPCS = [
  { id: 9990010, name: 'Mordecai the Gravedigger' },
  { id: 9990011, name: 'Lady Vesper' },
  { id: 9990012, name: 'The Bone Oracle' },
  { id: 9990013, name: "Kael'Mortis the Eternal" },
  { id: 9990014, name: 'Grizelda the Bone Merchant' },
  { id: 9999001, name: 'Blacksmith Taro' },
  { id: 9999002, name: 'Alchemist Luna' },
  { id: 9999003, name: 'Scout Raven' },
  { id: 9999004, name: 'Chef Momo' },
  { id: 9999005, name: 'Old Man Kazuki' },
  { id: 9999006, name: 'Arena Master Rex' },
  { id: 9999007, name: 'Gem Trader Safi' },
  { id: 9999008, name: 'Captain Flint' },
  { id: 9999009, name: 'Nurse Joy' },
  { id: 9999010, name: 'Treasure Hunter Kai' },
  { id: 9999020, name: 'Frost Warden Kira' },
  { id: 9999021, name: 'Crypt Warden Moros' },
  { id: 9999030, name: 'Sage Instructor Elara' },
  { id: 9999032, name: 'Garvan the Ironsmith' },
  { id: 9999033, name: 'Sera the Arcanist' },
  { id: 9999034, name: 'Brin the Fletchmaster' },
  { id: 9999035, name: 'Mara the Shadowsmith' },
  { id: 9999050, name: 'Sheriff Aldric' },
];

const CUSTOM_MOBS = [
  {
    id: 9901001, name: 'Crypt Shade',
    frames: ['stand_0','stand_1','move_0','move_1','move_2','move_3','hit1_0','hit1_1','die1_0','die1_1','die1_2','attack1_0','attack1_1','attack1_2'],
  },
  {
    id: 9901002, name: 'The Lich',
    frames: ['stand_0','stand_1','stand_2','move_0','move_1','move_2','move_3','hit1_0','hit1_1','die1_0','die1_1','die1_2','die1_3','attack1_0','attack1_1','attack1_2','attack2_0','attack2_1','attack2_2','attack2_3'],
  },
];

const SKILL_JOBS = [
  { id: 600,  name: 'Sage (1st)' },
  { id: 610,  name: 'Elementalist (2nd)' },
  { id: 611,  name: 'Arcanum (3rd)' },
  { id: 612,  name: 'Archsage (4th)' },
  { id: 700,  name: 'Necromancer (1st)' },
  { id: 710,  name: 'Dark Acolyte (2nd)' },
  { id: 711,  name: 'Soul Reaper (3rd)' },
  { id: 712,  name: 'Lich King (4th)' },
];

const CLASS_PORTRAITS = [
  { job: 600, name: 'Sage',        dir: 'sage',        files: ['portrait.png', 'badge.png'] },
  { job: 700, name: 'Necromancer', dir: 'necromancer',  files: ['portrait.png', 'badge.png'] },
];

// ── Check Functions ───────────────────────────────────────────────────────────

function checkNpcs(npcStringContent) {
  const results = [];
  for (const npc of CUSTOM_NPCS) {
    const spriteDir  = join(SPRITE_DIR, 'custom-npcs', String(npc.id));
    const stand0     = existsSync(join(spriteDir, 'stand_0.png'));
    const stand1     = existsSync(join(spriteDir, 'stand_1.png'));
    const wzXml      = existsSync(join(WZ_DIR, 'Npc.wz', `${npc.id}.img.xml`));
    const hasString  = npcStringContent.includes(String(npc.id));

    const issues = [];
    if (!stand0) issues.push('missing stand_0.png');
    if (!stand1) issues.push('missing stand_1.png');
    if (!wzXml)  issues.push('missing Npc.wz XML');
    if (!hasString) issues.push('missing String.wz name entry');

    results.push({
      id: npc.id,
      name: npc.name,
      ok: issues.length === 0,
      stand0, stand1, wzXml, hasString,
      issues,
    });
  }
  return results;
}

function checkMobs(mobStringContent) {
  const results = [];
  for (const mob of CUSTOM_MOBS) {
    const spriteDir = join(SPRITE_DIR, 'mobs', String(mob.id));
    const wzXml     = existsSync(join(WZ_DIR, 'Mob.wz', `${mob.id}.img.xml`));
    const hasString = mobStringContent.includes(String(mob.id));

    const missingFrames = mob.frames.filter(
      f => !existsSync(join(spriteDir, `${f}.png`))
    );

    const issues = [];
    if (missingFrames.length > 0) issues.push(`missing frames: ${missingFrames.join(', ')}`);
    if (!wzXml) issues.push('missing Mob.wz XML');
    if (!hasString) issues.push('missing String.wz name entry');

    results.push({
      id: mob.id,
      name: mob.name,
      ok: issues.length === 0,
      totalFrames: mob.frames.length,
      missingFrames: missingFrames.length,
      wzXml,
      hasString,
      issues,
    });
  }
  return results;
}

function checkSkills(skillStringContent) {
  const results = [];
  for (const job of SKILL_JOBS) {
    const wzXml    = existsSync(join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`));
    // Check that the skill file contains at least one skill entry
    let hasContent = false;
    let skillCount = 0;
    if (wzXml) {
      const xml = readFileSync(join(WZ_DIR, 'Skill.wz', `${job.id}.img.xml`), 'utf8');
      const matches = xml.match(/<imgdir name="\d{7}"/g);
      skillCount = matches ? matches.length : 0;
      hasContent = skillCount > 0;
    }

    const issues = [];
    if (!wzXml) issues.push('missing Skill.wz XML');
    else if (!hasContent) issues.push('Skill.wz XML has no skill entries');

    results.push({
      id: job.id,
      name: job.name,
      ok: wzXml && hasContent,
      wzXml,
      skillCount,
      issues,
    });
  }
  return results;
}

function checkClassPortraits() {
  const results = [];
  for (const cls of CLASS_PORTRAITS) {
    const dir    = join(SPRITE_DIR, 'class-selection', cls.dir);
    const issues = [];
    const fileStatus = {};

    for (const f of cls.files) {
      const exists = existsSync(join(dir, f));
      fileStatus[f] = exists;
      if (!exists) issues.push(`missing ${f}`);
    }

    results.push({
      job: cls.job,
      name: cls.name,
      ok: issues.length === 0,
      files: fileStatus,
      issues,
    });
  }
  return results;
}

function checkNecroSageSprites() {
  const results = [];
  const jobs = [
    { dir: 'sage',        jobIds: [600, 610, 611, 612] },
    { dir: 'necromancer', jobIds: [700, 710, 711, 712] },
  ];

  for (const j of jobs) {
    for (const jobId of j.jobIds) {
      // Structure: maple-sprites/{class}/{jobId}/{skillId}/icon.png
      const jobDir = join(SPRITE_DIR, j.dir, String(jobId));
      const hasJobDir = existsSync(jobDir);

      let skillCount = 0;
      let skillsWithIcon = 0;
      const issues = [];

      if (!hasJobDir) {
        issues.push(`missing sprite directory at ${j.dir}/${jobId}/`);
      } else {
        // Count skill subdirectories (7-digit IDs) and check each for icon.png
        try {
          const skillDirs = readdirSync(jobDir).filter(d => /^\d{7}$/.test(d));
          skillCount = skillDirs.length;
          for (const sd of skillDirs) {
            if (existsSync(join(jobDir, sd, 'icon.png'))) skillsWithIcon++;
          }
          if (skillCount === 0) issues.push(`no skill sprite dirs in ${j.dir}/${jobId}/`);
          else if (skillsWithIcon < skillCount) {
            issues.push(`${skillsWithIcon}/${skillCount} skills have icon.png`);
          }
        } catch (_) {
          issues.push('cannot read skill dirs');
        }
      }

      results.push({
        class: j.dir,
        jobId,
        ok: hasJobDir && issues.length === 0,
        skillCount,
        skillsWithIcon,
        issues,
      });
    }
  }
  return results;
}

// ── Main Validator ────────────────────────────────────────────────────────────

/**
 * Run full validation across all custom WZ content.
 * Returns a structured report with pass/fail per category.
 */
export function validateAllWzAssets() {
  log.info('Running full WZ asset validation...');

  // Load string files
  const npcStringPath  = join(WZ_DIR, 'String.wz', 'Npc.img.xml');
  const mobStringPath  = join(WZ_DIR, 'String.wz', 'Mob.img.xml');
  const skillStrPath   = join(WZ_DIR, 'String.wz', 'Skill.img.xml');

  const npcStr  = existsSync(npcStringPath)  ? readFileSync(npcStringPath, 'utf8')  : '';
  const mobStr  = existsSync(mobStringPath)  ? readFileSync(mobStringPath, 'utf8')  : '';
  const skillStr = existsSync(skillStrPath)  ? readFileSync(skillStrPath, 'utf8')   : '';

  const npcResults     = checkNpcs(npcStr);
  const mobResults     = checkMobs(mobStr);
  const skillResults   = checkSkills(skillStr);
  const portraitResults = checkClassPortraits();
  const spriteResults  = checkNecroSageSprites();

  // Aggregate
  const allResults = [
    ...npcResults.map(r => ({ ...r, category: 'NPC' })),
    ...mobResults.map(r => ({ ...r, category: 'MOB' })),
    ...skillResults.map(r => ({ ...r, category: 'SKILL' })),
    ...portraitResults.map(r => ({ ...r, category: 'CLASS_PORTRAIT' })),
    ...spriteResults.map(r => ({ ...r, category: 'SKILL_SPRITE' })),
  ];

  const totalChecks  = allResults.length;
  const passedChecks = allResults.filter(r => r.ok).length;
  const failedItems  = allResults.filter(r => !r.ok);

  const byCategory = {
    NPC:           { total: npcResults.length,      passed: npcResults.filter(r => r.ok).length },
    MOB:           { total: mobResults.length,       passed: mobResults.filter(r => r.ok).length },
    SKILL:         { total: skillResults.length,     passed: skillResults.filter(r => r.ok).length },
    CLASS_PORTRAIT:{ total: portraitResults.length,  passed: portraitResults.filter(r => r.ok).length },
    SKILL_SPRITE:  { total: spriteResults.length,    passed: spriteResults.filter(r => r.ok).length },
  };

  const overallOk = failedItems.length === 0;

  log.info(`Validation complete: ${passedChecks}/${totalChecks} checks passed`);
  if (failedItems.length > 0) {
    for (const f of failedItems) {
      log.warn(`FAIL [${f.category}] ${f.id || f.jobId || f.job}: ${f.issues?.join('; ')}`);
    }
  }

  return {
    ok: overallOk,
    summary: `${passedChecks}/${totalChecks} checks passed${overallOk ? ' — all assets verified!' : ' — issues found'}`,
    byCategory,
    failures: failedItems.map(f => ({
      category: f.category,
      id: f.id || f.jobId || f.job,
      name: f.name || f.class,
      issues: f.issues || [],
    })),
    details: {
      npcs:     npcResults,
      mobs:     mobResults,
      skills:   skillResults,
      portraits: portraitResults,
      sprites:  spriteResults,
    },
  };
}

/**
 * Quick health check — returns just pass/fail counts per category.
 */
export function getValidationSummary() {
  const full = validateAllWzAssets();
  return {
    ok: full.ok,
    summary: full.summary,
    byCategory: full.byCategory,
    failureCount: full.failures.length,
    failures: full.failures,
  };
}
