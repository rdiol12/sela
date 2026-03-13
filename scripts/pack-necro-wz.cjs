/**
 * pack-necro-wz.cjs
 * Packs Necromancer skill icons into WZ img format using harepacker-mcp.
 *
 * Usage: node scripts/pack-necro-wz.cjs [--dry-run]
 *
 * Skill mapping:
 *   700.img → 7001000-7001004 (Necromancer, 1st job)
 *   710.img → 7101000-7101005 (Dark Acolyte, 2nd job)
 *   711.img → 7111000-7111004 (Soul Reaper, 3rd job)
 *   712.img → 7121000-7121005 (Lich King, 4th job)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ICONS_PATH = path.join(__dirname, '../workspace/maple-sprites/necromancer/icons_b64.json');
const V83_IMG_DATA = 'C:/Users/rdiol/sela/workspace/v83-img-data';

// Skill layout per job image
const JOB_SKILLS = {
  '700.img': ['7001000', '7001001', '7001002', '7001003', '7001004'],
  '710.img': ['7101000', '7101001', '7101002', '7101003', '7101004', '7101005'],
  '711.img': ['7111000', '7111001', '7111002', '7111003', '7111004'],
  '712.img': ['7121000', '7121001', '7121002', '7121003', '7121004', '7121005'],
};

const SKILL_NAMES = {
  '7001000': 'Death Bolt',
  '7001001': 'Bone Armor',
  '7001002': 'Soul Link',
  '7001003': 'Dark Resonance',
  '7001004': 'Shadow Step',
  '7101000': 'Bone Spear',
  '7101001': 'Summon Skeleton',
  '7101002': 'Soul Drain',
  '7101003': 'Undead Fortitude',
  '7101004': 'Corpse Explosion',
  '7101005': 'Necrotic Mastery',
  '7111000': 'Soul Harvest',
  '7111001': 'Phantom Army',
  '7111002': 'Plague Cloud',
  '7111003': 'Death Shroud',
  '7111004': 'Bone Fortress',
  '7121000': 'Necrotic Blast',
  '7121001': 'Death Nova',
  '7121002': 'Lich Form',
  '7121003': 'Apocalypse',
  '7121004': 'Soul Absorption',
  '7121005': 'Dark Mastery',
};

/**
 * Main packing function — injects icons into WZ img files via harepacker-mcp
 * Called by the maple pipeline or standalone via CLI.
 *
 * @param {object} mcpClient - Optional MCP client (if null, prints instructions only)
 * @returns {object} result summary
 */
async function packNecromancerSprites(mcpClient = null) {
  console.log('[pack-necro-wz] Starting Necromancer WZ sprite packing...');

  if (!fs.existsSync(ICONS_PATH)) {
    throw new Error(`Icons file not found: ${ICONS_PATH}`);
  }

  const icons = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf8'));
  const results = { packed: [], errors: [], total: 0, imgFiles: 0 };

  for (const [imgFile, skillIds] of Object.entries(JOB_SKILLS)) {
    console.log(`\n[pack-necro-wz] Processing ${imgFile} (${skillIds.length} skills)...`);
    results.imgFiles++;

    for (const skillId of skillIds) {
      const iconB64 = icons[skillId];
      if (!iconB64) {
        const err = `Missing icon for skill ${skillId} (${SKILL_NAMES[skillId]})`;
        console.error(`  [WARN] ${err}`);
        results.errors.push(err);
        continue;
      }

      if (mcpClient) {
        try {
          // Step 1: Add skill SubProperty under "skill" root if it doesn't exist
          await mcpClient.callTool('harepacker-mcp', 'add_property', {
            category: 'skill',
            image: imgFile,
            parentPath: 'skill',
            name: skillId,
            type: 'SubProperty',
          });

          // Step 2: Import icon PNG into skill/SKILLID/icon
          await mcpClient.callTool('harepacker-mcp', 'import_png', {
            category: 'skill',
            image: imgFile,
            parentPath: `skill/${skillId}`,
            name: 'icon',
            base64Png: iconB64,
            originX: 0,
            originY: 32,
          });

          // Step 3: Import iconMouseOver (slightly brighter version - reuse same icon for now)
          await mcpClient.callTool('harepacker-mcp', 'import_png', {
            category: 'skill',
            image: imgFile,
            parentPath: `skill/${skillId}`,
            name: 'iconMouseOver',
            base64Png: iconB64,
            originX: 0,
            originY: 32,
          });

          // Step 4: Import iconDisabled (darker version - reuse same icon for now)
          await mcpClient.callTool('harepacker-mcp', 'import_png', {
            category: 'skill',
            image: imgFile,
            parentPath: `skill/${skillId}`,
            name: 'iconDisabled',
            base64Png: iconB64,
            originX: 0,
            originY: 32,
          });

          console.log(`  [OK] ${skillId} (${SKILL_NAMES[skillId]}) — icons packed`);
          results.packed.push({ skillId, name: SKILL_NAMES[skillId], imgFile });
          results.total++;
        } catch (err) {
          console.error(`  [ERR] Failed to pack ${skillId}: ${err.message}`);
          results.errors.push(`${skillId}: ${err.message}`);
        }
      } else {
        // Dry run — just report what would happen
        console.log(`  [DRY-RUN] Would pack: ${skillId} (${SKILL_NAMES[skillId]}) → ${imgFile}`);
        results.packed.push({ skillId, name: SKILL_NAMES[skillId], imgFile, dryRun: true });
        results.total++;
      }
    }

    if (mcpClient) {
      // Save the image after all skills are added
      await mcpClient.callTool('harepacker-mcp', 'save_image', {
        category: 'skill',
        image: imgFile,
      });
      console.log(`  [SAVED] ${imgFile}`);
    }
  }

  return results;
}

/**
 * Get the WZ packing summary for reporting
 */
function getPackingPlan() {
  if (!fs.existsSync(ICONS_PATH)) {
    return { error: 'icons_b64.json not found', path: ICONS_PATH };
  }
  const icons = JSON.parse(fs.readFileSync(ICONS_PATH, 'utf8'));
  const plan = [];
  for (const [imgFile, skillIds] of Object.entries(JOB_SKILLS)) {
    const skillPlan = skillIds.map(id => ({
      id,
      name: SKILL_NAMES[id],
      hasIcon: !!icons[id],
    }));
    plan.push({ imgFile, skills: skillPlan, covered: skillPlan.filter(s => s.hasIcon).length });
  }
  return { plan, totalSkills: Object.keys(SKILL_NAMES).length, iconsAvailable: Object.keys(icons).length };
}

// CLI entry point
if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    console.log('[pack-necro-wz] DRY RUN MODE — no WZ files will be modified\n');
    const plan = getPackingPlan();
    console.log(`Packing plan: ${plan.iconsAvailable}/${plan.totalSkills} icons available`);
    for (const imgPlan of plan.plan) {
      console.log(`\n${imgPlan.imgFile} (${imgPlan.covered}/${imgPlan.skills.length} covered):`);
      for (const skill of imgPlan.skills) {
        console.log(`  ${skill.hasIcon ? '✓' : '✗'} ${skill.id} — ${skill.name}`);
      }
    }
    // Also run the async packing in dry-run mode
    packNecromancerSprites(null).then(r => {
      console.log(`\nDry run complete: ${r.total} skills would be packed across ${r.imgFiles} img files`);
    });
  } else {
    console.log('[pack-necro-wz] LIVE MODE — use harepacker-mcp API to pack sprites');
    console.log('NOTE: Live mode requires harepacker-mcp to be running.');
    console.log('Run with --dry-run to preview packing plan without modifying files.');
    const plan = getPackingPlan();
    console.log(`\nPacking plan: ${plan.iconsAvailable}/${plan.totalSkills} icons available`);
    for (const imgPlan of plan.plan) {
      console.log(`  ${imgPlan.imgFile}: ${imgPlan.covered}/${imgPlan.skills.length} skills have icons`);
    }
    process.exit(0);
  }
}

module.exports = { packNecromancerSprites, getPackingPlan, JOB_SKILLS, SKILL_NAMES };
