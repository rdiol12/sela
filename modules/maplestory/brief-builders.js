/**
 * modules/maplestory/brief-builders.js — Brief builders for MapleStory signals.
 *
 * Converts signals into detailed Claude prompts with tool instructions.
 */

// ── NPC Ideas (the agent picks one each cycle) ─────────────────────────────────
const NPC_IDEAS = [
  { id: '9999001', name: 'Blacksmith Taro', map: '100000000', desc: 'Henesys weapon merchant — sells beginner swords, bows, staffs. Dialogue about forging weapons.' },
  { id: '9999002', name: 'Alchemist Luna', map: '101000000', desc: 'Ellinia potion crafter — sells HP/MP potions, buffs. Dialogue about magical ingredients.' },
  { id: '9999003', name: 'Scout Raven', map: '102000000', desc: 'Perion bounty board NPC — gives info about strong mobs, hints at rare drops.' },
  { id: '9999004', name: 'Chef Momo', map: '103000000', desc: 'Kerning City food vendor — sells food buffs (ATK+5 for 3min, DEF+5 for 3min).' },
  { id: '9999005', name: 'Old Man Kazuki', map: '104000000', desc: 'Lith Harbor wisdom NPC — tells server lore, gives beginner tips, free starter kit on first talk.' },
  { id: '9999006', name: 'Arena Master Rex', map: '100000000', desc: 'Henesys training grounds NPC — warps to training maps, gives combat advice.' },
  { id: '9999007', name: 'Gem Trader Safi', map: '101000000', desc: 'Ellinia gem merchant — buys/sells ores and crafting crystals.' },
  { id: '9999008', name: 'Captain Flint', map: '104000000', desc: 'Lith Harbor ship captain — offers transport between towns for meso.' },
  { id: '9999009', name: 'Nurse Joy', map: '100000000', desc: 'Henesys healer NPC — free HP/MP restore, sells cure potions.' },
  { id: '9999010', name: 'Treasure Hunter Kai', map: '102000000', desc: 'Perion treasure NPC — exchanges special mob drops for rare equipment.' },
];

// ── Weapon Ideas ────────────────────────────────────────────────────────────────
const WEAPON_IDEAS = [
  { type: 'sword', name: 'Crystal Fang', stats: 'PAD 55, speed 5, reqLevel 25, reqSTR 80', desc: 'Warrior 1H sword with ice element look' },
  { type: 'staff', name: 'Phoenix Wand', stats: 'MAD 65, speed 6, reqLevel 25, reqINT 90', desc: 'Magician wand with fire particles' },
  { type: 'bow', name: 'Wind Piercer', stats: 'PAD 50, speed 4, reqLevel 25, reqDEX 85', desc: 'Bowman bow with fast attack speed' },
  { type: 'dagger', name: 'Shadow Fang', stats: 'PAD 48, speed 3, reqLevel 25, reqLUK 80', desc: 'Thief dagger, fastest attack speed' },
  { type: 'gun', name: 'Thunder Barrel', stats: 'PAD 52, speed 5, reqLevel 25, reqDEX 70', desc: 'Pirate gun with lightning visual' },
  { type: 'polearm', name: 'Earth Cleaver', stats: 'PAD 70, speed 7, reqLevel 30, reqSTR 100', desc: 'Warrior 2H polearm, high damage slow swing' },
  { type: 'claw', name: 'Venom Claw', stats: 'PAD 30, speed 2, reqLevel 25, reqLUK 75', desc: 'Thief throwing stars claw' },
  { type: 'knuckle', name: 'Iron Fist', stats: 'PAD 45, speed 4, reqLevel 25, reqSTR 60, reqDEX 60', desc: 'Pirate knuckle weapon' },
];

// ── Item Ideas ──────────────────────────────────────────────────────────────────
const ITEM_IDEAS = [
  { name: 'Elixir of Rage', effect: 'ATK +10 for 180s', desc: 'Red potion that boosts physical attack' },
  { name: 'Mana Crystal', effect: 'MATK +10 for 180s', desc: 'Blue crystal that boosts magic attack' },
  { name: 'Iron Shield Scroll', effect: 'DEF +15 for 300s', desc: 'Scroll that buffs defense' },
  { name: 'Swift Boots Potion', effect: 'Speed +20 for 120s', desc: 'Green potion for speed boost' },
  { name: 'Lucky Clover', effect: 'Drop rate +20% for 300s', desc: 'Rare herb that increases drop rates' },
  { name: 'Giant\'s Meat', effect: 'MaxHP +500 for 600s', desc: 'Large meat that temporarily boosts max HP' },
  { name: 'Sage Tea', effect: 'MaxMP +300 for 600s', desc: 'Herbal tea that boosts max MP' },
  { name: 'Return Scroll', effect: 'Teleport to Henesys', desc: 'One-use scroll to warp home' },
];

// ── Quest Ideas ─────────────────────────────────────────────────────────────────
const QUEST_IDEAS = [
  { name: 'Mushroom Menace', desc: 'Kill 50 Orange Mushrooms, reward: 5000 exp + Crystal Fang sword' },
  { name: 'Potion Ingredients', desc: 'Collect 20 Slime Drops + 10 Mushroom Spores, reward: 10 Elixir of Rage' },
  { name: 'Lost Treasure Map', desc: 'Find the treasure map (rare drop from Jr. Necki), bring to Captain Flint, reward: 50000 meso' },
  { name: 'Arena Challenge', desc: 'Defeat 100 monsters in Henesys Hunting Ground, reward: Arena Champion title + Lucky Clover x5' },
  { name: 'The Blacksmith\'s Request', desc: 'Bring 30 Steel Ores to Blacksmith Taro, reward: custom weapon of your class' },
];

// ── Drop Table Ideas ────────────────────────────────────────────────────────────
const DROP_IDEAS = [
  { mob: 'Green Mushroom (1110100)', items: 'Mushroom Cap (etc), Red Potion, 500 meso' },
  { mob: 'Blue Snail (0100101)', items: 'Snail Shell (etc), Blue Potion, 200 meso' },
  { mob: 'Orange Mushroom (1210100)', items: 'Orange Mushroom Cap, Elixir of Rage, 1000 meso' },
  { mob: 'Pig (1210101)', items: 'Pig Ribbon, Iron Shield Scroll, 800 meso' },
  { mob: 'Ribbon Pig (1210102)', items: 'Ribbon, Swift Boots Potion, 1200 meso' },
  { mob: 'Jr. Necki (2130103)', items: 'Necki Skin, Lucky Clover (rare), Return Scroll' },
  { mob: 'Stumpy (3220000)', items: 'Tree Branch, Giant\'s Meat, Crystal Fang (very rare)' },
  { mob: 'Axe Stump (1140100)', items: 'Axe Handle, Sage Tea, 2000 meso' },
];

// ── Brief Builders ──────────────────────────────────────────────────────────────

export function buildMapleServerDownBrief(signal) {
  const { mysqlUp, cosmicUp, down } = signal.data;
  const steps = [];

  if (!mysqlUp) {
    steps.push(`1. Use the \`maple_start_mysql\` tool to start MySQL`);
    steps.push(`   - Then verify with \`maple_status\` tool`);
  }
  if (!cosmicUp) {
    steps.push(`${steps.length + 1}. Use the \`maple_start\` tool to start the Cosmic game server (it will start MySQL first if needed)`);
    steps.push(`   - Verify with \`maple_status\` tool`);
  }
  steps.push(`${steps.length + 1}. Check \`maple_logs\` for any crash/error messages that caused the downtime`);

  return {
    title: `MapleStory Server Down — ${down.join(' & ')}`,
    content: `MapleStory Cosmic v83 server is DOWN. Services not responding:
${down.map(s => `- ${s}`).join('\n')}

Status: MySQL=${mysqlUp ? 'UP' : 'DOWN'}, Cosmic=${cosmicUp ? 'UP' : 'DOWN'}

**Steps to fix:**
${steps.join('\n')}

**Important:** MySQL must be running before Cosmic. The \`maple_start\` tool handles this automatically.

**Available tools:** maple_start, maple_start_mysql, maple_stop, maple_restart, maple_status, maple_logs, maple_log_list, maple_players`,
    reasoning: `MapleStory server services are down: ${down.join(', ')}. Need to restart them using maple_start tool.`,
  };
}

export function buildMapleContentBrief(signal) {
  const d = signal.data;
  const { nextArea, npcCount, weaponCount, itemCount, dropCount, skillCount, questCount, eventCount, targets } = d;

  let instructions = '';

  switch (nextArea) {
    case 'npcs': {
      const idea = NPC_IDEAS[npcCount] || NPC_IDEAS[0];
      instructions = `## Create NPC: ${idea.name}
Map: ${idea.map} | NPC ID: ${idea.id}
Description: ${idea.desc}

**Steps:**
1. Use \`maple_write_npc\` with npcId "${idea.id}" — write a JavaScript NPC script using cm (NPCConversationManager)
   - Use \`cm.sendNext(text)\` for dialogue, \`cm.sendSimple(text)\` for choices
   - For shops: use \`cm.openShop(shopId)\` or \`cm.sendSimple\` with buy/sell options + \`cm.gainItem(id, qty)\` / \`cm.gainMeso(-cost)\`
   - For warps: use \`cm.warp(mapId)\`
   - Always call \`cm.dispose()\` at the end of each branch
2. Use \`maple_place_npc\` to place NPC on map ${idea.map}
3. Look up real item IDs with \`maple_search\` (type: "item", query: "red potion") to use correct IDs in the shop
4. **Generate sprite** using the LoRA pipeline — see Sprite Pipeline section below
5. After creating the NPC, update the progress tracker

## Sprite Pipeline (IMPORTANT — all new NPCs need unique sprites)

Custom NPC sprites use a full AI pipeline: LoRA → crop → bg remove → ESRGAN → animation frames → WZ import.

**To create sprites for a new NPC:**
1. \`maple_lora_pipeline\` — generates the sprite with full pipeline:
   - npcId: "${idea.id}"
   - description: "${idea.desc}"
   - Outputs to maple-lora/game_assets/npcs/${idea.id}_pipeline/:
     stand_0.png, stand_1.png, stand_2.png (idle bob), move_0-3.png (walk)
   - Requires CUDA GPU. Takes ~30s per NPC.

2. \`maple_import_sprites_wz\` — imports generated sprites into WZ binary:
   - npcIds: "${idea.id}" (or "*" for all pipeline NPCs)
   - Maps stand_0-2 → stand/0-2, move_0-3 → move/0-3 in the NPC .img
   - Uses stand_0 as fallback for eye/say frames
   - Auto-packs Npc.wz (Format1/BGRA4444 for v83 compat)
   - Auto-deploys to v83-client-patched/ patcher dir
   - Auto-regenerates patcher manifest

**Technical details:**
- Pixel format MUST be Format1 (BGRA4444) — Format257 (ARGB1555) breaks on v83 client
- WzImg-MCP server uses isPreBB=true to force Format1
- Background removal uses flood-fill from edges (scipy.ndimage.label)
- ESRGAN enhances quality without changing size (4x upscale → LANCZOS downscale)
- NPC .img files live at workspace/npc-rebuild/Npc/
- Packed Npc.wz goes to workspace/v83-client-patched/Npc.wz

**If GPU is unavailable**, skip the sprite step — NPC will use existing/vanilla sprite until next pipeline run.

**NPC Script Template (shop keeper):**
\`\`\`javascript
var status = 0;
function start() { status = -1; action(1, 0, 0); }
function action(mode, type, selection) {
    if (mode == -1) { cm.dispose(); return; }
    status++;
    if (status == 0) {
        cm.sendSimple("Welcome! I'm ${idea.name}.\\r\\n#L0#Browse my wares#l\\r\\n#L1#Tell me about yourself#l\\r\\n#L2#Goodbye#l");
    } else if (status == 1) {
        if (selection == 0) {
            cm.sendNext("Here are my finest goods...");
        } else if (selection == 1) {
            cm.sendNext("${idea.desc}");
        } else {
            cm.sendNext("Safe travels, adventurer!");
        }
        cm.dispose();
    }
}
\`\`\`

**Important:** Search for real item/equip IDs before using them. Use \`maple_search\` tool.`;
      break;
    }

    case 'weapons': {
      const idea = WEAPON_IDEAS[weaponCount] || WEAPON_IDEAS[0];
      instructions = `## Create Custom Weapon: ${idea.name}
Type: ${idea.type} | Stats: ${idea.stats}
Description: ${idea.desc}

**Steps:**
1. First, find a base weapon of the same type to use as template:
   \`maple_search\` type: "eqp", query: "${idea.type}"
2. Read the base weapon's data: \`maple_equip_data\` with the found equipId
3. Find an unused equipment ID in the 13xxxxx range (search for gaps)
4. Create the weapon by copying the base WZ XML and modifying stats with \`maple_wz_set\`
   - Set incPAD/incMAD, reqLevel, reqSTR/DEX/INT/LUK, tuc (upgrade slots), speed
5. Add the weapon to a shop NPC's inventory or as a mob drop
6. Update progress tracker`;
      break;
    }

    case 'items': {
      const idea = ITEM_IDEAS[itemCount] || ITEM_IDEAS[0];
      instructions = `## Create Custom Item: ${idea.name}
Effect: ${idea.effect}
Description: ${idea.desc}

**Steps:**
1. Find a similar existing consumable: \`maple_search\` type: "item", query: "potion"
2. Read its data with \`maple_item_data\` to understand the structure
3. Find an unused item ID in the 20xxxxx range
4. Create the item by modifying WZ data: \`maple_wz_set\` or \`maple_item_edit\`
   - Set spec properties (hp, mp, pad, mad, pdd, time for duration)
5. Add to a shop NPC or mob drop table
6. Update progress tracker`;
      break;
    }

    case 'drops': {
      const idea = DROP_IDEAS[dropCount] || DROP_IDEAS[0];
      instructions = `## Configure Drop Table: ${idea.mob}
Drops: ${idea.items}

**Steps:**
1. Find the mob ID: \`maple_search_mob\` query: (mob name from above)
2. Check current drops: \`maple_get_drops\` with mobId
3. Find item IDs: \`maple_search\` for each item name
4. Add drops using \`maple_add_drop\`:
   - Common drops: chance 300000-500000 (30-50%)
   - Uncommon: chance 50000-150000 (5-15%)
   - Rare: chance 5000-20000 (0.5-2%)
   - Very rare: chance 1000-5000 (0.1-0.5%)
   - Meso: use itemId 0, chance = amount
5. Update progress tracker`;
      break;
    }

    case 'skills': {
      instructions = `## Rebalance Skills
Modified so far: ${skillCount}/${targets.skillsModified}

**Steps:**
1. Pick a job class to rebalance. Prioritize: Warrior (100-112), Magician (200-232), Bowman (300-312), Thief (400-412), Pirate (500-512)
2. List job skills: \`maple_job_skills\` with jobId
3. Read a skill: \`maple_skill_data\` with skillId
4. Adjust damage/MP cost/duration for balance:
   - Buff skills: increase duration slightly, keep MP cost reasonable
   - Attack skills: ensure damage scales well per level
   - Use \`maple_skill_edit\` to modify level data
5. Focus on making 1st/2nd job skills feel impactful
6. Update progress tracker`;
      break;
    }

    case 'quests': {
      const idea = QUEST_IDEAS[questCount] || QUEST_IDEAS[0];
      instructions = `## Create Quest: ${idea.name}
Description: ${idea.desc}

**Steps:**
1. Choose quest ID in 90000-99999 range (custom quests)
2. Write quest script with \`maple_write_quest\`:
   - Define \`start()\` function — NPC gives quest, calls qm.forceStartQuest()
   - Define \`end()\` function — NPC checks requirements, gives rewards
   - Use qm.sendNext(), qm.sendAcceptDecline()
   - Check items: qm.haveItem(itemId, qty)
   - Give rewards: qm.gainExp(), qm.gainItem(), qm.gainMeso()
   - Call qm.forceCompleteQuest() on success
3. Link quest to an NPC (create or modify NPC script to offer the quest)
4. Update progress tracker`;
      break;
    }

    case 'events': {
      instructions = `## Create Custom Event
Events created: ${eventCount}/${targets.customEvents}

**Ideas:** 2x EXP Weekend, Boss Rush Event, Treasure Hunt, PQ Event

**Steps:**
1. Write event script with \`maple_write_event\`:
   - Define init(), setup(), playerEntry() etc.
   - Use em (EventManager) API
2. Configure schedule in server config if needed
3. Update progress tracker`;
      break;
    }
  }

  const progressSummary = [
    `NPCs: ${npcCount}/${targets.customNpcs}`,
    `Weapons: ${weaponCount}/${targets.customWeapons}`,
    `Items: ${itemCount}/${targets.customItems}`,
    `Drops: ${dropCount}/${targets.dropsConfigured}`,
    `Skills: ${skillCount}/${targets.skillsModified}`,
    `Quests: ${questCount}/${targets.customQuests}`,
    `Events: ${eventCount}/${targets.customEvents}`,
  ].join(' | ');

  return {
    title: `MapleStory Content — ${d.pct}% complete`,
    content: `MapleStory Cosmic v83 server content expansion: ${d.totalDone}/${d.totalTarget} tasks done.
Progress: ${progressSummary}

${instructions}

**After completing the task:**
Save progress by writing to the progress tracker file at data/state/maple-content-progress.json.
Add the created item to the appropriate array (npcsCreated, weaponsCreated, etc.) with: { id, name, description, createdAt }.

**Available tools:** maple_write_npc, maple_place_npc, maple_search, maple_search_mob, maple_mob_stats, maple_mob_edit, maple_add_drop, maple_get_drops, maple_skill_data, maple_skill_edit, maple_job_skills, maple_item_data, maple_item_edit, maple_equip_data, maple_wz_set, maple_wz_add, maple_write_quest, maple_write_event, maple_query, maple_map_info, maple_map_life, maple_lora_pipeline, maple_import_sprites_wz, maple_generate_sprite.`,
    reasoning: `MapleStory content expansion: ${d.totalTarget - d.totalDone} items remaining. Current area: ${nextArea}.`,
  };
}

export function buildMapleCreativeBrief(signal) {
  const d = signal.data;
  const recent = d.recentCreations || [];
  const recentList = recent.length
    ? recent.map(r => `- ${r.name || r.id} (${r.description || 'no desc'})`).join('\n')
    : '(none yet)';

  return {
    title: d.planComplete
      ? 'MapleStory Creative Cycle — Beyond the Plan'
      : 'MapleStory Creative Review & Improvement',
    content: `You are the autonomous game designer for a MapleStory Cosmic v83 private server.

**Current state:** ${d.npcScripts} NPC scripts, ${d.questScripts} quests, ${d.eventScripts} events, ${d.totalDone} custom content pieces total.

**Recent creations:**
${recentList}

## Your Mission This Cycle

Pick ONE of these activities (use your judgment on what's most impactful):

### 1. Review & Improve Existing Content
- Read an NPC script you created earlier (\`maple_read_npc\`) — is the dialogue interesting? Are prices balanced?
- Check drop rates (\`maple_get_drops\`) — are they fun? Not too grindy, not too easy?
- Look at skill balance (\`maple_skill_data\`) — are there dead skills nobody would use?
- Test a quest flow mentally — does it make sense? Are rewards proportional to difficulty?
- Fix anything that feels off.

### 2. Create Something New (Your Idea)
Think about what would make the server more fun. Ideas to spark creativity:
- A quest chain that tells a story across multiple NPCs and maps
- A hidden boss in an unexpected map with unique drops
- A town event (2x EXP, treasure hunt, PvP arena)
- An NPC that gives players a daily challenge for bonus rewards
- A new training area with FULL VISUALS — design the theme first, browse assets with harepacker-mcp, then build with back/tile/obj layers. Use \`maple_import_map_asset\` for custom sprites. NEVER create empty maps.
- A custom class — use \`maple_deploy_sage_class\` as reference for the pipeline
- New map connections (portals between maps)
- Fix existing custom maps that are missing visuals (use \`maple_list_custom_maps\` to find them)
- Economy fixes: adjust shop prices, add meso sinks, improve vendor inventories
- A party quest with stages, puzzles, and a boss at the end
- Create new custom weapons, armor, or accessories for underserved level ranges
- Add animated sprites for custom mobs/NPCs (\`maple_gen_monster\`, \`maple_gen_npc\`, \`maple_gen_animation\`)
- Generate LoRA sprites for NPCs: \`maple_lora_pipeline\` (generates stand+move frames) → \`maple_import_sprites_wz\` (imports to WZ + deploys to patcher)

### 3. Diagnose & Fix Issues
- Check server logs (\`maple_logs\`) for recurring errors
- Look for broken NPC scripts (read them, check for \`cm.dispose()\` calls)
- Verify server config is optimal (\`maple_config\` action: "read")
- Check if any maps have too many or too few mob spawns
- Look at level progression gaps — are there maps with no good training spots for certain level ranges?

## Guidelines
- Use real item/mob/map IDs — always \`maple_search\` first to find correct IDs
- After creating content, update the progress tracker at data/state/maple-content-progress.json
- If you create something that needs a server restart, call \`maple_restart\`
- Be creative! You're not following a checklist. Think about what makes a game FUN.
- If you have an idea that needs a tool you don't have, describe it in an action_taken tag so we can build it.

**Available tools:** maple_status, maple_start, maple_stop, maple_restart, maple_logs, maple_players, maple_query, maple_write_npc, maple_read_npc, maple_list_npcs, maple_place_npc, maple_write_quest, maple_write_event, maple_add_mob, maple_add_drop, maple_get_drops, maple_mob_stats, maple_mob_edit, maple_search_mob, maple_skill_data, maple_skill_edit, maple_job_skills, maple_item_data, maple_item_edit, maple_equip_data, maple_search, maple_map_info, maple_map_life, maple_map_portals, maple_search_map, maple_wz_set, maple_wz_add, maple_config, maple_gen_sprite, maple_gen_monster, maple_gen_npc, maple_gen_item, maple_gen_animation, maple_gen_animation_set, maple_import_sprite, maple_lora_pipeline, maple_import_sprites_wz, maple_generate_sprite, maple_deploy_sage_class, maple_deploy_weapons, maple_deploy_items, maple_deploy_drops, maple_deploy_quests, maple_deploy_events, maple_rebalance_skills, maple_spawn_bots, maple_create_linked_map, maple_list_custom_maps, maple_validate_map, maple_import_map_asset, maple_create_sidescroll_tileset, maple_create_map_object`,
    reasoning: d.planComplete
      ? 'Content plan complete. Agent enters creative mode — review, improve, and create new content autonomously.'
      : 'Creative review cycle alongside content plan. Agent reviews existing work and brainstorms improvements.',
  };
}

export function buildMapleMapWorkBrief(signal) {
  const { brokenMaps } = signal.data;
  const mapList = brokenMaps.map(m =>
    `- Map ${m.mapId} (${m.label}): ${!m.hasBack ? 'NO BACKGROUND' : 'has back'}, ${!m.hasTile ? 'NO TILES' : 'has tiles'}`
  ).join('\n');

  return {
    title: `MapleStory Map Visuals — ${brokenMaps.length} map(s) need fixing`,
    content: `Custom maps are missing visual layers and will appear as black voids in-game.

**Broken maps:**
${mapList}

## MANDATORY: Design Before Implementation

Before writing any map XML, you MUST:
1. **Write a design brief**: What is this map? Theme? Purpose?
2. **Pick visual assets**: Browse existing v83 assets with harepacker-mcp tools (maple_sprite, maple_wz_tree) to find matching backgrounds (bS), tilesets (tS), and objects (oS)
3. **Plan the layout**: List all platforms with coordinates, portal positions, mob spawn locations
4. **Only then** write the XML with proper back/tile/obj layers

Load the "maplestory-map-building" skill for the complete reference (theme combos, tile types, XML template).

## Quick Asset Reference

Common Ellinia theme: bS=shineWood, tS=woodBridge or wetWood, oS=houseSW
Common cave theme: bS=darkCave, tS=darkCave, oS=dungeon
Common field theme: bS=grassySoil, tS=grassySoil, oS=houseGS

## Required Sections in Every Map XML

1. \`<imgdir name="back">\` — at least 2 background layers with bS, parallax (rx/ry), type
2. \`<imgdir name="N"><imgdir name="info"><string name="tS" value="..."/>\` — tileset per layer
3. \`<imgdir name="tile">\` — ground tiles with u (bsc/edU/enH0/enH1), no, x, y
4. \`<imgdir name="obj">\` — decoration objects with oS, l0, l1, l2, x, y
5. \`<imgdir name="foothold">\` — collision lines matching tile positions
6. \`<imgdir name="portal">\` — at least one spawn point (pt=0)

## Custom Assets Pipeline (if existing v83 assets aren't enough)

1. Generate: maple_create_sidescroll_tileset, maple_create_map_object, maple_gen_sprite
2. Import: maple_import_map_asset (assetType: back/tile/obj, setName, subPath, pngPath)
3. Reference: use setName as bS/tS/oS in map XML

**Available tools:** maple_create_map, maple_create_linked_map, maple_validate_map, maple_list_custom_maps, maple_add_portal, maple_import_map_asset, maple_sprite, maple_wz_tree, maple_wz_search, maple_create_sidescroll_tileset, maple_create_map_object, maple_gen_sprite, maple_map_info, maple_search_map, maple_restart`,
    reasoning: `${brokenMaps.length} custom map(s) have no visual layers — players see black voids. Need to add back/tile/obj sections.`,
  };
}

export function buildMapleWzStaleBrief(signal) {
  const d = signal.data;
  const fileList = d.files ? d.files.join(', ') : 'unknown';
  return {
    title: 'MapleStory WZ Compilation Needed',
    content: `Client WZ files are out of date: ${d.reason}.
${d.files ? `\n**Modified files:** ${fileList}\n` : ''}
The server has custom content (maps, NPCs, skills) that hasn't been compiled into client WZ format yet. Ron can't see these changes in his game client until we compile and upload.

**Steps:**
1. Run \`maple_compile_wz\` to compile all custom XMLs into patched .wz files
2. Run \`maple_upload_wz\` to send the patched files to Ron via Telegram
3. Files too large for Telegram (>50MB) will show the local path instead

**Available tools:** maple_compile_wz, maple_upload_wz`,
    reasoning: `Client WZ files stale (${d.reason}). Need to compile and upload so Ron's client shows the latest content.`,
  };
}

export function buildMapleLogErrorsBrief(signal) {
  const { errorCount, samples } = signal.data;
  return {
    title: `MapleStory Server Errors — ${errorCount} recent errors detected`,
    content: `The MapleStory Cosmic server log contains ${errorCount} recent error entries.

**Sample errors (last ${samples.length}):**
${samples.map(s => '> ' + s.trim()).join('\n')}

**Steps:**
1. Use \`maple_logs\` to read the full recent log and understand the context
2. Check \`maple_status\` to see if the server is still running
3. If server crashed, use \`maple_start\` or \`maple_restart\` to bring it back
4. If errors are config-related, check \`maple_logs\` for the specific config issue
5. If errors are recurring, investigate root cause (memory, DB connection, corrupted data)

**Available tools:** maple_status, maple_start, maple_restart, maple_stop, maple_logs, maple_log_list, maple_players, maple_query`,
    reasoning: `MapleStory server showing ${errorCount} errors in recent log. May indicate instability or impending crash.`,
  };
}
