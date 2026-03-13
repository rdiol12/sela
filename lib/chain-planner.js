/**
 * Chain Planner — Multi-step causal reasoning engine.
 *
 * Takes a goal + context and decomposes it into a workflow DAG compatible
 * with workflow-engine.js::createWorkflow(). Uses Haiku for cheap decomposition,
 * caches recurring chain templates to avoid repeat LLM calls.
 *
 * Chain templates are rule-based matching patterns:
 * - "meeting preparation" → check calendar → check files → draft → remind
 * - "deploy verification" → run tests → deploy → verify → notify
 *
 * For novel chains, uses a single Haiku one-shot to produce a step DAG.
 */

import { createLogger } from './logger.js';
import { chatOneShot } from './claude.js';
import { createWorkflow, startWorkflow } from './workflow-engine.js';
import { getState, setState } from './state.js';
import config from './config.js';

const log = createLogger('chain-planner');
const STATE_KEY = 'chain-planner';

// --- Built-in Chain Templates (rule-based, zero LLM cost) ---

const CHAIN_TEMPLATES = [
  {
    id: 'meeting_prep',
    triggers: /\b(meeting|appointment|call|zoom|teams)\b.*\b(prepare|prep|ready|slides|agenda)\b/i,
    name: 'Meeting Preparation',
    steps: [
      { id: 's1', type: 'tool', description: 'Check calendar for meeting details', config: { command: 'echo "Check google_calendar_list for upcoming meetings"' }, rollback: null },
      { id: 's2', type: 'claude', description: 'Check if related files/slides exist', config: { prompt: 'Search the workspace for any files related to this meeting. List what exists and what needs to be created.' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'claude', description: 'Draft outline or agenda', config: { prompt: 'Based on the meeting details and existing files, draft an outline or agenda. {{context.s1}} {{context.s2}}' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'delay', description: 'Wait until 2 hours before meeting', config: { durationMs: 7200_000 }, dependsOn: ['s3'], rollback: null },
      { id: 's5', type: 'claude', description: 'Send reminder with prep summary', config: { prompt: 'Send the user a WhatsApp reminder about the upcoming meeting with the prepared materials summary.' }, dependsOn: ['s4'], rollback: null },
    ],
  },
  {
    id: 'code_review',
    triggers: /\b(review|pr|pull request|code review)\b.*\b(check|look|examine|verify)\b/i,
    name: 'Code Review Chain',
    steps: [
      { id: 's1', type: 'tool', description: 'List open PRs', config: { command: 'gh pr list --limit 5 --json number,title,author' }, rollback: null },
      { id: 's2', type: 'claude', description: 'Analyze PR changes', config: { prompt: 'Review the open PRs and summarize key changes, potential issues, and recommendations. {{context.s1}}' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'claude', description: 'Report findings to the user', config: { prompt: 'Send the user a concise code review summary via WhatsApp. {{context.s2}}' }, dependsOn: ['s2'], rollback: null },
    ],
  },
  {
    id: 'daily_planning',
    triggers: /\b(plan|schedule|organize)\b.*\b(day|today|morning|tasks)\b/i,
    name: 'Daily Planning',
    steps: [
      { id: 's1', type: 'tool', description: 'Check today\'s calendar', config: { command: 'echo "Use google_calendar_list with days=1"' }, rollback: null },
      { id: 's2', type: 'claude', description: 'Review active goals and priorities', config: { prompt: 'List active goals sorted by priority. Identify what should be worked on today. {{context.s1}}' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'claude', description: 'Create daily plan', config: { prompt: 'Create a prioritized daily plan combining calendar events and goal milestones. Send to the user via WhatsApp. {{context.s2}}' }, dependsOn: ['s2'], rollback: null },
    ],
  },
  {
    id: 'email_digest',
    triggers: /\b(email|inbox|mail)\b.*\b(check|digest|summary|important)\b/i,
    name: 'Email Digest',
    steps: [
      { id: 's1', type: 'tool', description: 'Fetch recent emails', config: { command: 'echo "Use gmail_list with maxResults=20"' }, rollback: null },
      { id: 's2', type: 'claude', description: 'Categorize and summarize emails', config: { prompt: 'Categorize recent emails by urgency/importance. Summarize key items. {{context.s1}}' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'claude', description: 'Report to the user', config: { prompt: 'Send the user a WhatsApp message with the email digest. Highlight action items. {{context.s2}}' }, dependsOn: ['s2'], rollback: null },
    ],
  },
  {
    id: 'health_check',
    triggers: /\b(health|status|system|monitor)\b.*\b(check|verify|audit|review)\b/i,
    name: 'System Health Check',
    steps: [
      { id: 's1', type: 'tool', description: 'Run health monitor', config: { command: 'node -e "import(\'./skills/health-monitor.js\').then(m => m.run().then(r => console.log(JSON.stringify(r))))"', cwd: config.dataDir + '/..' }, rollback: null },
      { id: 's2', type: 'claude', description: 'Analyze health results', config: { prompt: 'Analyze the system health results and identify any issues. {{context.s1}}' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'conditional', description: 'Check if issues found', config: { condition: 'context.s2?.reply?.includes("issue") || context.s2?.reply?.includes("degraded") || context.s2?.reply?.includes("critical")', skipOnFalse: ['s4'] }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'Alert the user about issues', config: { prompt: 'Send the user a WhatsApp alert about the system issues found. {{context.s2}}' }, dependsOn: ['s3'], rollback: null },
    ],
  },

  // --- MapleStory Cosmic v83 Chain Templates ---

  {
    id: 'maple_create_map',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(map|area|dungeon|town|field|מפה)\b/i,
    name: 'MapleStory — Create New Map',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK: Research existing maps and assets', config: { prompt: `You are Sela executing the MapleStory Agent Cycle (read skill: maplestory-agent-cycle).

PHASE 1 — THINK. Answer these questions:
1. What map am I creating? (purpose, theme, level range)
2. Where does it connect? (parent map, portal chain)
3. What already exists? Use harepacker-mcp:
   - init_data_source(basePath: "C:/Users/rdiol/sela/workspace/v83-img-data")
   - Search for similar maps and available tilesets/backgrounds
4. Check ~/sela/workspace/Cosmic/wz/Map.wz/Map/Map9/ for the next available map ID
5. Check CUSTOM-CONTENT.md for existing custom content

Goal context: {{goal}}

Output a structured research summary. Do NOT create any files yet.` }, rollback: null },
      { id: 's2', type: 'claude', description: 'PLAN: Design the map and present to Ron', config: { prompt: `Based on the research from Phase 1:
{{context.s1}}

PHASE 2 — PLAN. Create a map design document using this format:

*New Map Plan*
*Name:* [name]
*Purpose:* [training/town/boss/quest/transit]
*Level range:* [X-Y]
*Map ID:* [next available in Map9/]
*Connected to:* [parent map name + ID]
*Theme:* bS=[background set], tS=[tileset], oS=[object set]
*Layout:* [describe all platforms with x,y coordinates]
*Mobs:* [mob name, ID, count, level — use existing mob IDs from v83]
*NPCs:* [if any]
*Portals:* [list all portals with target map IDs]
*BGM:* [Sound.wz path]

Browse assets with harepacker-mcp to pick the best visuals. Preview them with get_canvas_bitmap.

Send the plan to Ron on WhatsApp and ask for approval.
Goal context: {{goal}}` }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'wait_input', description: 'Wait for Ron to approve the map plan', config: { prompt: 'Waiting for approval on the map plan...' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'EXECUTE: Create the map XML with full visuals', config: { prompt: `Ron approved. Now EXECUTE.
Previous plan: {{context.s2}}

PHASE 3 — CREATE. Follow the maplestory-map-building skill EXACTLY:
1. Create the map XML at ~/sela/workspace/Cosmic/wz/Map.wz/Map/Map9/[MAPID].img.xml
   - Include ALL sections: info, back (2+ layers), layer 0 with tS + tiles + objects, foothold, life, portal
   - Use real tileset piece names (bsc, enH0, enH1, edU, edD etc.) at correct spacing
   - Footholds must match tile y-positions
   - VR bounds must cover entire map
2. Add String.wz entry: edit ~/sela/workspace/Cosmic/wz/String.wz/Map.img.xml
3. Update the PARENT map XML to add a portal TO this new map
4. If mobs are placed, verify mob IDs exist in Mob.wz

Do NOT skip any section. A map without backgrounds/tiles is a black void.` }, dependsOn: ['s3'], rollback: 'Delete the created map XML file and revert String.wz changes' },
      { id: 's5', type: 'claude', description: 'VALIDATE: Check all connections and completeness', config: { prompt: `PHASE 4 — VALIDATE. Check everything:

Read back the files you just created/modified and verify:
□ Map XML has: info, back, layer with tiles+objects, foothold, life, portal
□ Back section has at least 1 background layer with valid bS name
□ Tiles reference valid tS name and use correct u values
□ Footholds y-values match tile y-values
□ Portal spawn point (pt=0, pn="sp") exists
□ Exit portals have matching portals in target maps
□ Parent map was updated with portal to new map
□ String.wz has mapName + streetName for the map ID
□ All mob/NPC IDs in life section exist
□ VR bounds cover the full map area

If anything is wrong, FIX IT NOW. Then report results to Ron.

Previous context: {{context.s4}}` }, dependsOn: ['s4'], rollback: null },
      { id: 's6', type: 'claude', description: 'REPORT: Summary to Ron', config: { prompt: `PHASE 6 — REPORT. Send Ron a WhatsApp summary:

*MapleStory Update Complete*
- What was created (map name, ID, theme)
- Files changed (list all)
- Server: restart needed to load
- Client: [no update needed if using existing v83 assets]
- Test: @goto [MAPID]
- What connects to what

Context: {{context.s5}}` }, dependsOn: ['s5'], rollback: null },
    ],
  },

  {
    id: 'maple_create_monster',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(mob|monster|boss|creature|מפלצת)\b/i,
    name: 'MapleStory — Create New Monster',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK: Research monster design', config: { prompt: `MapleStory Agent Cycle — PHASE 1 THINK.
Creating a new monster. Research:
1. What level range? Check existing mobs at that level for stat comparison
2. What map will it spawn in? Does the map exist?
3. What should it drop? Check CUSTOM-CONTENT.md for existing items
4. Does a similar mob already exist we could reskin?
5. Check ~/sela/workspace/Cosmic/wz/Mob.wz/ for next available mob ID (9900000+ range)
6. Use harepacker-mcp to browse existing mob sprites for reference

Goal: {{goal}}
Output research summary. Do NOT create files yet.` }, rollback: null },
      { id: 's2', type: 'claude', description: 'PLAN: Design the monster', config: { prompt: `PHASE 2 — PLAN. Based on research: {{context.s1}}

Create monster plan:
*Name:* | *Mob ID:* | *Level:*
*HP/MP/EXP:* | *Attack/Defense:*
*Speed:* | *Element:* | *Boss:*
*Spawns in:* [map + ID]
*Drops:* [items with % chances]
*Sprite:* [reuse existing mob sprite ID, or describe new one needed]
*States:* stand, move, hit1, die1, attack1

Compare stats to vanilla mobs at same level for balance.
Send plan to Ron on WhatsApp for approval.` }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'wait_input', description: 'Wait for Ron approval', config: { prompt: 'Waiting for monster plan approval...' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'EXECUTE: Create mob WZ + spawns + drops', config: { prompt: `Ron approved. EXECUTE.
Plan: {{context.s2}}

1. Create ~/sela/workspace/Cosmic/wz/Mob.wz/[MOBID].img.xml with info node (level, maxHP, maxMP, speed, PADamage, PDDamage, exp, boss, undead, elemAttr)
2. Add name to ~/sela/workspace/Cosmic/wz/String.wz/Mob.img.xml
3. Add mob spawn to target map's <life> section (type="m", correct fh, rx0, rx1)
4. Configure drop table
5. If using existing sprite: reference that mob's sprite ID. If new sprite needed: note it for Phase 5.` }, dependsOn: ['s3'], rollback: 'Delete mob XML, revert String.wz and map life changes' },
      { id: 's5', type: 'claude', description: 'VALIDATE + REPORT', config: { prompt: `VALIDATE then REPORT.
Verify: mob XML has all info fields, String.wz entry exists, mob spawned on valid foothold in map, drop table configured, stats balanced vs same-level vanilla mobs.
Fix any issues. Then send summary to Ron on WhatsApp.
Context: {{context.s4}}` }, dependsOn: ['s4'], rollback: null },
    ],
  },

  {
    id: 'maple_create_skill',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(skill|ability|spell|attack|buff|כישור)\b/i,
    name: 'MapleStory — Create New Skill',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK: Research skill design', config: { prompt: `MapleStory Agent Cycle — PHASE 1 THINK.
Creating a new skill. Research:
1. Which job? Check existing skills for that job in Skill.wz/[JOB].img.xml
2. What type? (attack/buff/passive/summon)
3. What gap does it fill in the job's kit?
4. Compare to similar skills in other jobs for balance
5. Check skill ID format: JOB_ID * 10000 + sequence (e.g. 6001003 for Sage)
6. Read current Sage skills: 600.img.xml, 610.img.xml, 611.img.xml, 612.img.xml

Damage reference per tier:
  1st job: 100-200%, 1-3 mobs, 8-15 MP
  2nd job: 150-350%, 3-6 mobs, 15-30 MP
  3rd job: 250-500%, 4-8 mobs, 25-50 MP
  4th job: 400-800%, 6-15 mobs, 40-80 MP

Goal: {{goal}}
Output research. Do NOT create yet.` }, rollback: null },
      { id: 's2', type: 'claude', description: 'PLAN: Design the skill', config: { prompt: `PHASE 2 — PLAN. Based on: {{context.s1}}

*New Skill Plan*
*Name:* | *Job:* | *Skill ID:*
*Type:* [attack/buff/passive/summon]
*Description:* [what it does]
*Scaling:* Lv1 → Lv10 → LvMAX (damage, MP, mobs)
*Comparison:* [equivalent skill in another job]
*Special:* [freeze/DoT/knockback/none]
*Needs new sprites:* [yes/no]

Send to Ron for approval.` }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'wait_input', description: 'Wait for Ron approval', config: { prompt: 'Waiting for skill plan approval...' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'EXECUTE: Create skill in WZ', config: { prompt: `Ron approved. EXECUTE.
Plan: {{context.s2}}

1. Edit ~/sela/workspace/Cosmic/wz/Skill.wz/[JOB].img.xml — add skill node inside <imgdir name="skill">
   Include: masterLevel, action, common/maxLevel, and ALL levels with damage/mpCon/attackCount/mobCount/range
   Scale smoothly: +5-10% damage per level, +1 MP every 2-3 levels, +1 mob every 5 levels
2. Add to ~/sela/workspace/Cosmic/wz/String.wz/Skill.img.xml (name + desc + h1/h2/h3)
3. If special mechanic: note Java changes needed in StatEffect.java (needs compilation)` }, dependsOn: ['s3'], rollback: 'Remove skill node from Skill.wz and String.wz entry' },
      { id: 's5', type: 'claude', description: 'VALIDATE + REPORT', config: { prompt: `VALIDATE: Read back skill XML, verify all levels defined, damage scales smoothly, MP cost reasonable, mob count within tier limits, String.wz entry exists.
REPORT to Ron: skill name, ID, stats summary, test command (@giveskill [ID] [LEVEL]).
Context: {{context.s4}}` }, dependsOn: ['s4'], rollback: null },
    ],
  },

  {
    id: 'maple_create_job',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(job|class|profession|advancement|ג'וב|מקצוע)\b/i,
    name: 'MapleStory — Create New Job Class',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK: Research job design space', config: { prompt: `MapleStory Agent Cycle — PHASE 1 THINK.
Creating a new job class. This is the biggest task — needs careful planning.

Research:
1. Read existing jobs in ~/sela/workspace/Cosmic/src/main/java/client/Job.java
2. What jobs exist? Standard (100-522), Sage (600-612), Cygnus (1000-1512), GM (800-910)
3. Next available job line: 700 range
4. What archetype? (must be DIFFERENT from existing jobs)
5. What weapon type? (can it use existing types?)
6. Read Sage skills (600-612.img.xml) as reference for custom job structure
7. Plan ~20 skills across 4 tiers

Goal: {{goal}}
Output thorough research. This requires careful thought.` }, rollback: null },
      { id: 's2', type: 'claude', description: 'PLAN: Full job design document', config: { prompt: `PHASE 2 — PLAN the complete job. Based on: {{context.s1}}

*New Job Plan*
*Name:* [1st] → [2nd] → [3rd] → [4th]
*IDs:* X00, X10, X11, X12
*Stat:* [STR/DEX/INT/LUK] | *Weapon:* [type]
*Identity:* [unique hook, 2 sentences]

*1st Job (lv10) — 3-4 skills:*
  - [skill name]: [type], [brief desc]

*2nd Job (lv30) — 4-5 skills:*
  - [skill name]: [type], [brief desc]

*3rd Job (lv70) — 5-6 skills:*
  - [skill name]: [type], [brief desc]

*4th Job (lv120) — 5-7 skills:*
  - [skill name]: [type], [brief desc]

*Advancement NPC:* [name, location]
*New sprites needed:* [list]

Send to Ron for approval. This is a BIG commitment — get it right.` }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'wait_input', description: 'Wait for Ron approval on full job design', config: { prompt: 'Waiting for job class approval — this is a big one...' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'EXECUTE PART 1: Job.java + Skill WZ files', config: { prompt: `Ron approved. EXECUTE PART 1 — Core job data.
Plan: {{context.s2}}

1. Edit ~/sela/workspace/Cosmic/src/main/java/client/Job.java
   - Add enum entries for all 4 tiers
   - Follow existing pattern (e.g. SAGE(600), ELEMENTALIST(610), etc.)

2. Create Skill.wz files for each tier:
   - ~/sela/workspace/Cosmic/wz/Skill.wz/[JOB1ST].img.xml
   - ~/sela/workspace/Cosmic/wz/Skill.wz/[JOB2ND].img.xml
   - ~/sela/workspace/Cosmic/wz/Skill.wz/[JOB3RD].img.xml
   - ~/sela/workspace/Cosmic/wz/Skill.wz/[JOB4TH].img.xml
   Each with full skill definitions and ALL level data.

3. Add ALL skill names to ~/sela/workspace/Cosmic/wz/String.wz/Skill.img.xml` }, dependsOn: ['s3'], rollback: 'Revert Job.java, delete skill WZ files, revert String.wz' },
      { id: 's5', type: 'claude', description: 'EXECUTE PART 2: NPC script + map placement', config: { prompt: `EXECUTE PART 2 — Job advancement system.
Context: {{context.s4}}

1. Create advancement NPC script at ~/sela/workspace/Cosmic/scripts/npc/[NPCID].js
   - Check level + current job for each tier
   - Use cm.changeJob() with correct job IDs
   - Give starter equipment if appropriate

2. Add NPC to appropriate map (edit map XML life section)
3. Add NPC name to String.wz/Npc.img.xml

4. Note: Java compilation needed! Run: cd ~/sela/workspace/Cosmic && mvn package` }, dependsOn: ['s4'], rollback: 'Delete NPC script, revert map changes' },
      { id: 's6', type: 'claude', description: 'VALIDATE: Full job validation', config: { prompt: `PHASE 4 — VALIDATE entire job.

Check:
□ Job.java has all 4 tier enums
□ Each tier has a Skill.wz .img.xml file
□ Every skill has full level data (1 through maxLevel)
□ All skills listed in String.wz/Skill.img.xml
□ NPC script handles all 4 advancement tiers
□ NPC placed on a map with valid foothold
□ NPC name in String.wz/Npc.img.xml
□ Damage balanced per tier (compare to Sage and standard mage)
□ Total SP per tier doesn't exceed available skill points

Fix any issues found. Context: {{context.s5}}` }, dependsOn: ['s5'], rollback: null },
      { id: 's7', type: 'claude', description: 'REPORT: Full summary to Ron', config: { prompt: `REPORT to Ron on WhatsApp:

*New Job Class Created!*
- Job line: [names and IDs]
- Skills: [count] total across 4 tiers
- Advancement NPC: [name] in [map]
- Files: [list all created/modified]
- Server: needs mvn package + restart
- Client: needs Skill.wz repack if new effect sprites
- Test: @setjob [ID], @giveskill [SKILLID] [LEVEL]

Context: {{context.s6}}` }, dependsOn: ['s6'], rollback: null },
    ],
  },

  {
    id: 'maple_create_npc',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(npc|shop|vendor|merchant|quest\s*giver)\b/i,
    name: 'MapleStory — Create New NPC',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK + PLAN: NPC design', config: { prompt: `MapleStory Agent Cycle — THINK then PLAN.

1. What does this NPC do? (shop/quest/info/warp/advancement)
2. Where should it be? (which map, makes sense for the role?)
3. Check existing NPCs: scripts/npc/9999001-9999031.js — next available: 9999032+
4. Can we reuse an existing NPC sprite ID? Browse Npc.wz with harepacker-mcp
5. If shop: what items? If quest: what objective/reward?

Create plan, send to Ron for approval.
Goal: {{goal}}` }, rollback: null },
      { id: 's2', type: 'wait_input', description: 'Wait for Ron approval', config: { prompt: 'Waiting for NPC plan approval...' }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'claude', description: 'EXECUTE: Create NPC script + place on map', config: { prompt: `Ron approved. EXECUTE.
Plan: {{context.s1}}

1. Create ~/sela/workspace/Cosmic/scripts/npc/[NPCID].js
   - Shop NPC: use cm.openShop(SHOPID)
   - Quest NPC: check items with cm.haveItem(), give rewards with cm.gainItem()/cm.gainExp()
   - Info NPC: cm.sendOk() with formatted text
   - ALWAYS include cm.dispose() on every exit path!

2. Add NPC name to ~/sela/workspace/Cosmic/wz/String.wz/Npc.img.xml
3. Add NPC to map life section (type="n", valid foothold)
4. Update CUSTOM-CONTENT.md with new NPC info` }, dependsOn: ['s2'], rollback: 'Delete NPC script, revert String.wz and map changes' },
      { id: 's4', type: 'claude', description: 'VALIDATE + REPORT', config: { prompt: `VALIDATE: Script exists with dispose() calls, String.wz has name, NPC on valid foothold in map, script logic correct.
REPORT to Ron: NPC name, ID, location, purpose, test instructions.
Context: {{context.s3}}` }, dependsOn: ['s3'], rollback: null },
    ],
  },

  {
    id: 'maple_create_zone',
    triggers: /\b(maple|cosmic|maplestory|מייפל)\b.*\b(region|zone|world|continent|full\s*zone|multiple\s*maps|whole\s*area)\b/i,
    name: 'MapleStory — Create Full Zone (Multi-Map Region)',
    steps: [
      { id: 's1', type: 'claude', description: 'THINK: Research and scope the zone', config: { prompt: `MapleStory Agent Cycle — Creating a FULL ZONE. This is the biggest operation.

PHASE 1 — THINK:
1. What is this zone's theme and story?
2. How many maps? (typical zone: 1 town + 3-5 field/dungeon maps + 1 boss)
3. What level range? (should fill a gap in current content)
4. What tileset/background theme? Browse with harepacker-mcp
5. What monsters populate it? (2-4 unique mobs + 1 boss)
6. What NPCs are needed? (shops, quests, warps)
7. Map connection graph: town → field1 → field2 → dungeon1 → dungeon2 → boss
8. Check Map9/ for contiguous available map IDs

Goal: {{goal}}
This needs a LOT of thought. Output complete research.` }, rollback: null },
      { id: 's2', type: 'claude', description: 'PLAN: Full zone blueprint', config: { prompt: `PHASE 2 — Full zone plan. Based on: {{context.s1}}

Create a complete zone blueprint:

*Zone:* [name]
*Theme:* [description] | *Level:* [X-Y]
*Map IDs:* [list all, contiguous range]

*Map Graph:*
[Town] ←→ [Field 1] ←→ [Field 2] ←→ [Dungeon 1] ←→ [Dungeon 2] ←→ [Boss Room]

For EACH map:
- Name, ID, purpose
- Tileset (tS) + Background (bS) + Objects (oS)
- Mobs (name, ID, level, count)
- NPCs (name, ID, role)
- Portals (connections)

*Monster roster:* [list all new/existing mobs]
*NPC roster:* [list all NPCs with roles]
*Connection to existing world:* [which existing map connects to this zone's entrance]

Send to Ron for approval. This is a BIG plan.` }, dependsOn: ['s1'], rollback: null },
      { id: 's3', type: 'wait_input', description: 'Wait for Ron approval on zone plan', config: { prompt: 'Waiting for full zone approval — take your time, this is big...' }, dependsOn: ['s2'], rollback: null },
      { id: 's4', type: 'claude', description: 'EXECUTE: Create all maps one by one', config: { prompt: `Ron approved the zone. EXECUTE — create ALL maps.
Plan: {{context.s2}}

Create each map XML following maplestory-map-building skill:
- Full visuals (back, tiles, objects) — NO black voids!
- Proper footholds matching tiles
- Life spawns on valid footholds
- Portals connecting the chain (BIDIRECTIONAL — update both maps!)
- String.wz entries for every map

Work through maps in order: town first, then fields, dungeons, boss room.
Connect the zone entrance to the existing world (update the parent map too).` }, dependsOn: ['s3'], rollback: 'Delete all created map XMLs, revert String.wz and parent map' },
      { id: 's5', type: 'claude', description: 'EXECUTE: Create monsters, NPCs, scripts', config: { prompt: `Now create all supporting content.
Context: {{context.s4}}

1. Monster XMLs in Mob.wz/ (if new mobs)
2. NPC scripts in scripts/npc/
3. String.wz entries for all mobs and NPCs
4. Drop tables for monsters
5. Quest scripts if quests were planned
6. Update CUSTOM-CONTENT.md with everything new` }, dependsOn: ['s4'], rollback: 'Delete mob XMLs, NPC scripts, revert String.wz' },
      { id: 's6', type: 'claude', description: 'VALIDATE: Check entire zone', config: { prompt: `VALIDATE the entire zone:
Context: {{context.s5}}

For EACH map:
□ Has full visuals (back + tiles + objects)
□ Footholds match tiles
□ Portals are bidirectional (check BOTH maps for each connection)
□ Life spawns on valid footholds
□ String.wz has map name

For the zone:
□ Portal chain is complete (can walk from entrance to boss and back)
□ All mob IDs exist in Mob.wz
□ All NPC scripts have dispose() calls
□ Level progression makes sense (easier mobs near town, harder near boss)
□ The existing parent map has a portal TO the zone entrance

Fix ALL issues found.` }, dependsOn: ['s5'], rollback: null },
      { id: 's7', type: 'claude', description: 'REPORT: Full zone summary', config: { prompt: `REPORT to Ron:

*New Zone Created!*
*[Zone Name]* — Level [X]-[Y]

*Maps:* [count] maps created
[list each: name, ID, purpose]

*Monsters:* [count]
[list each: name, ID, level]

*NPCs:* [count]
[list each: name, ID, role]

*Portal chain:*
[entrance] → [map1] → [map2] → ... → [boss]

*Files created:* [count] files
*Server:* restart to load
*Client:* [update status]
*Entry point:* @goto [first map ID]

Context: {{context.s6}}` }, dependsOn: ['s6'], rollback: null },
    ],
  },
];

/**
 * Match a goal description against chain templates.
 * Returns the first matching template or null.
 */
function matchTemplate(goalText) {
  for (const template of CHAIN_TEMPLATES) {
    if (template.triggers.test(goalText)) {
      return template;
    }
  }
  return null;
}

/**
 * Use Haiku to decompose a novel goal into workflow steps.
 * Returns steps array compatible with workflow-engine.
 */
async function decomposeWithLLM(goal, context = '') {
  const prompt = `You are a task decomposition engine. Break this goal into 3-6 sequential steps for an autonomous agent.

Goal: ${goal}
${context ? `Context: ${context}` : ''}

Return ONLY a JSON array of steps. Each step: { "id": "s1", "type": "claude"|"tool"|"delay"|"conditional", "description": "what to do", "config": { "prompt": "..." or "command": "..." }, "dependsOn": ["s0"], "rollback": "how to undo this step or null" }

Rules:
- Step IDs: s1, s2, s3, etc.
- First step has no dependencies. Others depend on previous step(s).
- Use "tool" type for commands, "claude" for reasoning/writing.
- Keep descriptions actionable and specific.
- Include rollback instructions for reversible steps (null for read-only steps).`;

  try {
    const { reply } = await chatOneShot(prompt, null, 'haiku');
    // Extract JSON array from response
    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.warn({ goal, reply: reply.slice(0, 200) }, 'LLM decomposition returned no JSON array');
      return null;
    }

    let steps;
    try { steps = JSON.parse(jsonMatch[0]); } catch { return null; }
    if (!Array.isArray(steps) || steps.length === 0) return null;

    // Normalize steps
    return steps.map((s, i) => ({
      id: s.id || `s${i + 1}`,
      type: s.type || 'claude',
      description: s.description || `Step ${i + 1}`,
      config: s.config || { prompt: s.description },
      dependsOn: s.dependsOn || (i > 0 ? [`s${i}`] : []),
      rollback: s.rollback || null,
      maxRetries: 1,
    }));
  } catch (err) {
    log.error({ err: err.message, goal }, 'LLM decomposition failed');
    return null;
  }
}

/**
 * Plan a chain from a goal description. Tries template match first, falls back to LLM.
 * @param {string} goal - Natural language goal description
 * @param {string} context - Additional context (signals, active goals, etc.)
 * @returns {object|null} Workflow-compatible plan { name, steps, source }
 */
export async function planChain(goal, context = '') {
  // 1. Try template match (zero LLM cost)
  const template = matchTemplate(goal);
  if (template) {
    log.info({ templateId: template.id, goal: goal.slice(0, 100) }, 'Chain matched template');
    return {
      name: template.name,
      steps: template.steps.map(s => ({ ...s })), // deep copy
      source: `template:${template.id}`,
    };
  }

  // 2. Check cached templates (from previous LLM decompositions)
  const state = getState(STATE_KEY);
  const cachedTemplates = state.cachedTemplates || [];
  for (const ct of cachedTemplates) {
    if (ct.trigger && new RegExp(ct.trigger, 'i').test(goal)) {
      log.info({ cached: ct.name, goal: goal.slice(0, 100) }, 'Chain matched cached template');
      // Refresh hit count
      ct.hits = (ct.hits || 0) + 1;
      ct.lastUsed = Date.now();
      setState(STATE_KEY, { cachedTemplates });
      return {
        name: ct.name,
        steps: ct.steps.map(s => ({ ...s })),
        source: `cached:${ct.name}`,
      };
    }
  }

  // 3. Fall back to LLM decomposition
  const steps = await decomposeWithLLM(goal, context);
  if (!steps) return null;

  const plan = {
    name: goal.slice(0, 60),
    steps,
    source: 'llm',
  };

  // Cache this decomposition for future reuse (extract keywords as trigger)
  try {
    const keywords = goal.toLowerCase().match(/\b\w{4,}\b/g);
    if (keywords && keywords.length >= 2) {
      const trigger = keywords.slice(0, 4).join('.*');
      cachedTemplates.push({
        name: plan.name,
        trigger,
        steps,
        hits: 1,
        lastUsed: Date.now(),
        createdAt: Date.now(),
      });
      // Keep max 20 cached templates, evict least-used
      if (cachedTemplates.length > 20) {
        cachedTemplates.sort((a, b) => b.hits - a.hits);
        cachedTemplates.length = 20;
      }
      setState(STATE_KEY, { cachedTemplates });
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Failed to cache chain template');
  }

  return plan;
}

/**
 * Create and start a workflow from a chain plan.
 * @param {object} plan - { name, steps, source }
 * @param {object} opts - Workflow options (trigger, context, notifyPolicy)
 * @returns {object} The created workflow
 */
export function executeChain(plan, opts = {}) {
  if (!plan || !plan.steps || plan.steps.length === 0) {
    throw new Error('Invalid chain plan: no steps');
  }

  const wf = createWorkflow(plan.name, plan.steps, {
    trigger: { type: 'chain', source: plan.source || 'unknown' },
    context: opts.context || {},
    notifyPolicy: opts.notifyPolicy || 'summary',
    ...opts,
  });

  startWorkflow(wf.id);

  // Track chain creation
  const state = getState(STATE_KEY);
  const history = state.chainHistory || [];
  history.push({
    workflowId: wf.id,
    name: plan.name,
    source: plan.source,
    stepCount: plan.steps.length,
    createdAt: Date.now(),
  });
  if (history.length > 50) history.splice(0, history.length - 50);
  setState(STATE_KEY, { chainHistory: history });

  log.info({ wfId: wf.id, name: plan.name, steps: plan.steps.length, source: plan.source }, 'Chain started');
  return wf;
}

/**
 * Get chain planner statistics.
 */
export function getChainStats() {
  const state = getState(STATE_KEY);
  return {
    cachedTemplates: (state.cachedTemplates || []).length,
    builtInTemplates: CHAIN_TEMPLATES.length,
    totalChains: (state.chainHistory || []).length,
    recentChains: (state.chainHistory || []).slice(-5),
  };
}
