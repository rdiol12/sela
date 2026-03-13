---
name: "MapleStory Agent Cycle"
description: "Autonomous execution cycle for all MapleStory Cosmic server work. Think → Plan → Execute → Validate. Covers maps, assets, skills, jobs, NPCs, and full server integration."
keywords: ["maplestory", "maple", "cosmic", "agent", "create", "map", "skill", "job", "npc", "monster", "asset", "build", "מייפל", "agent cycle"]
category: "gamedev"
---

# MapleStory Agent Cycle — Autonomous Execution Protocol

You are Sela, operating as a team of MapleStory specialists. When Ron asks you to create ANYTHING for the Cosmic v83 server, you follow this exact cycle. NO shortcuts. NO skipping phases.

## CRITICAL RULE: THINK BEFORE YOU ACT

**NEVER write XML, code, or generate assets before completing Phase 1 and Phase 2.**
**ALWAYS present the plan to Ron on WhatsApp and wait for approval before Phase 3.**

---

## Phase 0: CLASSIFY — What Am I Being Asked To Do?

Read the request and classify it:

| Type | Example Request | Specialists Needed |
|------|----------------|-------------------|
| MAP | "create a new training area" | World + Sprite + Server |
| MONSTER | "add a new boss mob" | Sprite + Server |
| NPC | "add a shop NPC" | Sprite + Server |
| SKILL | "create a new ice attack for Sage" | Combat + Sprite + Server |
| JOB | "add a new Necromancer class" | Class + Combat + Sprite + Server |
| REBALANCE | "make Arcane Bolt stronger" | Combat + Server |
| QUEST | "add a quest chain" | Server (scripts) |
| FULL ZONE | "create a whole new region" | ALL specialists |

Then follow the phase sequence below for that type.

---

## Phase 1: THINK — Context & Research (NO creation yet)

### For ANY type of work, answer these first:

```
1. WHAT exactly am I creating? (be specific)
2. WHY does it exist? (gameplay purpose, player need)
3. WHERE does it fit? (which region, which level range, which job)
4. WHAT ALREADY EXISTS that's similar? (search before creating)
5. WHAT CONNECTS to it? (portals, drops, prerequisites)
```

### Research using harepacker-mcp:

```
# ALWAYS init data source first
init_data_source(basePath: "C:/Users/rdiol/sela/workspace/v83-img-data")

# Search for similar existing content
search_by_name(query: "RELEVANT_KEYWORD")

# Browse what's available
list_images_in_category(category: "Map", subdirectory: "Back")
list_images_in_category(category: "Map", subdirectory: "Tile")
list_images_in_category(category: "Map", subdirectory: "Obj")
list_images_in_category(category: "Mob")
list_images_in_category(category: "Npc")

# Study existing content that's similar to what we're making
get_tree_structure(category: "Map", image: "Map/Map1/100000000.img", depth: 3)
```

### Check what custom content already exists:

```
Custom maps:     ~/sela/workspace/Cosmic/wz/Map.wz/Map/Map9/
Custom NPCs:     69 NPCs (IDs 9999001-9999073), .img files in ~/Desktop/cosmic-wz-patched/Npc/
Custom mobs:     2 mobs (990x range), .img files in ~/Desktop/cosmic-wz-patched/Mob/
Custom jobs:     Sage (600/610/611/612) + Necromancer (700/710/711/712)
Custom skills:   64 skills with LoRA effects (Skill.wz/600-712.img.xml)
NPC sprites:     ~/maple-lora/npc_b64_all.json (BGRA base64)
Skill effects:   ~/maple-lora/skill_effects_b64.json (icons+effects+hits)
Source of truth:  ~/sela/workspace/Cosmic-client/ (NEVER modify — extract only)
```

---

## Phase 2: PLAN — Design Document (present to Ron)

Write a brief design document. Format it for WhatsApp readability.

### Map Plan Template:
```
*New Map Plan*

*Name:* [map name]
*Purpose:* [training/town/boss/quest/transit]
*Level range:* [X-Y]
*Map ID:* [check Map9/ for next available]
*Connected to:* [parent map name + ID]
*Theme:* [tileset + background + objects]
*Layout:*
  - Ground level at y=200, width -600 to 600
  - Upper platform at y=0, width -200 to 200
  - [describe all platforms]
*Mobs:* [mob name, ID, count, level]
*NPCs:* [npc name, ID, purpose]
*Portals:* [from/to with map IDs]
*BGM:* [Sound.wz path]

Approve? (yes/no/changes)
```

### Skill Plan Template:
```
*New Skill Plan*

*Name:* [skill name]
*Job:* [job name + ID]
*Skill ID:* [JJJNNNN format]
*Type:* [attack/buff/passive/summon]
*Description:* [what it does]
*Balance:*
  - Lv1: [damage]%, [mobs] mobs, [MP] MP
  - Lv10: [damage]%, [mobs] mobs, [MP] MP
  - LvMAX: [damage]%, [mobs] mobs, [MP] MP
*Comparison:* [similar skill in another job, why this is balanced]
*Special effect:* [freeze/DoT/knockback/none]
*Needs new sprites:* [yes/no]

Approve? (yes/no/changes)
```

### Job Plan Template:
```
*New Job Plan*

*Job name:* [name]
*Job line:* [1st] → [2nd] → [3rd] → [4th]
*Job IDs:* [X00, X10, X11, X12]
*Primary stat:* [STR/DEX/INT/LUK]
*Secondary stat:* [STR/DEX/INT/LUK]
*Weapon:* [type]
*Identity:* [what makes it unique, 1-2 sentences]

*Skills per tier:*
  1st job (lv10): [list 3-4 skills with type]
  2nd job (lv30): [list 4-5 skills]
  3rd job (lv70): [list 5-6 skills]
  4th job (lv120): [list 5-7 skills]

*Advancement NPCs (each must be DISTINCT with unique personality):*
  1st job NPC: [unique name] — [personality in 1 sentence] — Location: [map]
    Requirements: Lv [X], [STAT] [Y]+
    Quest: [describe the questline — what player must do]
    Rewards: job change + starter weapon + starter skills

  2nd job NPC: [unique name] — [personality in 1 sentence] — Location: [map]
    Requirements: Lv [X], [STAT] [Y]+
    Quest: [multi-step: get letter from 1st NPC → travel to this NPC → combat/collection trial → return with proof]
    Rewards: job change + new skills

  3rd job NPC: [unique name] — [personality in 1 sentence] — Location: [map]
    Requirements: Lv [X], [STAT] [Y]+
    Quest: [sent to secret area → fight dark clone → bring back Dark Crystal]
    Rewards: job change + new skills

  4th job NPC: [unique name] — [personality in 1 sentence] — Location: [map]
    Requirements: Lv [X], [STAT] [Y]+
    Quest: [complex multi-step: collect 3+ proof items from trials/bosses → final test]
    Rewards: job change + new skills

*Gear Shop NPC:* [unique name] — [personality] — Location: [class town]
  Weapons: [1 per tier, name + type + level req]
  Armor: [hat, overall, shoes, gloves — name + level req + stats]

*CLASS HOME TOWN (MANDATORY — like Ellinia/Perion/Kerning City):*
  Town name: [themed name matching class fantasy]
  Town map ID: [Map9/ next available, town=1]
  Theme: [tileset + background — must feel unique to this class]
  Connected to: [Victoria Island or world map portal]
  Layout: [describe platforms, buildings, atmosphere]

  Training fields (connected maps branching from town):
    Lv 10-30 field: [name] — mobs: [class-themed mob, level range]
    Lv 30-60 field: [name] — mobs: [stronger class-themed mob]
    Lv 60-100 field: [name] — mobs: [advanced class-themed mob]
    Lv 100+ field: [name] — mobs: [elite class-themed mob]

*QUEST NPCs (MANDATORY — beyond advancement NPCs):*
  Class Lore NPC: [name] — [personality] — explains class history, philosophy, world role
    Quests: [2-3 lore quests that teach class backstory, reward EXP + lore items]

  Training Instructor NPC: [name] — [personality] — repeatable training quests per level range
    Quests: [kill X mobs / collect Y items — one per training field, scaling rewards]

  Skill Trainer NPC: [name] — [personality] — unlocks special/hidden skills through quest chains
    Quests: [multi-step chains that unlock bonus skills or skill books, 1 per job tier]

  Class Boss Quest NPC: [name] — [personality] — sends player to fight class-themed bosses
    Quests: [boss hunt quests per tier — unique class-themed bosses with themed drops]

  (Optional extra NPCs: potion brewer, mount trainer, class-specific crafter, etc.)

*Needs new sprites:* [yes/no, list what]

Approve? (yes/no/changes)
```

**IMPORTANT — Job Class Design Rules:**
- Every job class gets its OWN dedicated town — like Ellinia for mages, Perion for warriors
- The town is the class HOME BASE — all class NPCs live here, all class quests start here
- Training fields branch out from the town, with level-appropriate mobs themed to the class
- NPCs must feel like REAL characters (like Grendel the Really Old, Dark Lord, Athena Pierce)
- Each NPC has a distinct personality, speaking style, and role in the class lore
- Stat requirements must scale per tier (e.g. INT 20/60/150/280 for a mage-type)
- 1st job is simple (talk + advance), 2nd job has a letter + trial, 3rd job has a clone fight, 4th job is complex
- Beyond advancement NPCs, each class needs AT LEAST 4 more quest NPCs: lore NPC, training instructor, skill trainer, boss quest giver
- Quest NPCs give repeatable and chain quests throughout the leveling journey — not just at advancement
- Use cm.startQuest/completeQuest, cm.haveItem, party quest item flags for quest state
- Every NPC must check BOTH level AND primary stat before allowing advancement
- Advancement dialogue should have multiple pages of lore, not just "Are you ready?"

### Monster Plan Template:
```
*New Monster Plan*

*Name:* [name]
*Mob ID:* [check Mob.wz for unused ID in 9900000+ range]
*Level:* [X]
*HP:* [amount] | *MP:* [amount]
*EXP:* [amount]
*Attack:* [damage] | *Defense:* [amount]
*Speed:* [slow/medium/fast]
*Element:* [fire/ice/lightning/holy/dark/none]
*Boss:* [yes/no]
*Spawns in:* [map name + ID]
*Drops:* [item list with % chances]
*Needs new sprite:* [yes/no — if yes, describe appearance]
*States needed:* stand, move, hit1, die1, attack1

Approve? (yes/no/changes)
```

**WAIT FOR RON'S APPROVAL BEFORE PROCEEDING TO PHASE 3.**

---

## Phase 3: EXECUTE — Create the Content

### 3A: Create Assets (if new sprites needed)

**Check if existing v83 assets can be reused first!**

```
# Search for usable existing sprites
search_by_name(query: "forest mushroom")
get_canvas_bitmap(category: "Mob", image: "MOBID.img", path: "stand/0")
```

If new sprites ARE needed:
1. Describe what's needed (style: MapleStory pixel art, outlines, vibrant colors)
2. Use available sprite generation tools
3. Save to `~/sela/workspace/maple-sprites/`
4. Note: sprites need states (stand, move, hit, die, attack for mobs)

### 3B: Create WZ XML

#### For a MAP:
```
1. Create map XML at:
   ~/sela/workspace/Cosmic/wz/Map.wz/Map/Map9/MAPID.img.xml

2. Include ALL sections (refer to maplestory-map-building skill for templates):
   - info (bgm, returnMap, forcedReturn, fieldLimit, VR bounds, town)
   - back (2+ background layers with parallax)
   - layers (tiles + objects — use theme combos from map-building skill)
   - foothold (walkable surfaces matching tile positions)
   - life (mobs + NPCs on valid footholds)
   - portal (spawn + exits, bidirectional!)
   - reactor (if needed)

3. Add String.wz entry:
   Edit ~/sela/workspace/Cosmic/wz/String.wz/Map.img.xml
   Add: <imgdir name="MAPID"><string name="streetName" value="..."/><string name="mapName" value="..."/></imgdir>

4. Update PARENT map:
   Edit the parent map XML to add a portal TO this new map
   This is the step most often forgotten!
```

#### For a MONSTER:
```
1. Create mob XML at:
   ~/sela/workspace/Cosmic/wz/Mob.wz/MOBID.img.xml

   Structure:
   <imgdir name="MOBID.img">
     <imgdir name="info">
       <int name="level" value="X"/>
       <int name="maxHP" value="X"/>
       <int name="maxMP" value="X"/>
       <int name="speed" value="-30"/>     <!-- -50=slow, -30=medium, 0=fast -->
       <int name="PADamage" value="X"/>    <!-- physical attack -->
       <int name="PDDamage" value="X"/>    <!-- physical defense -->
       <int name="MADamage" value="0"/>
       <int name="MDDamage" value="0"/>
       <int name="exp" value="X"/>
       <int name="boss" value="0"/>
       <int name="undead" value="0"/>
       <string name="elemAttr" value=""/>  <!-- F1=weak fire, I1=weak ice, etc -->
     </imgdir>
     <!-- sprite states: stand, move, hit1, die1, attack1 -->
     <!-- each state: frames with canvas + origin + delay -->
   </imgdir>

2. Add String.wz/Mob.img.xml entry:
   <imgdir name="MOBID"><string name="name" value="Monster Name"/></imgdir>

3. Add to map spawns (life section of target map XML)
4. Add drop table (SQL or server drop data)
```

#### For a SKILL:
```
1. Edit or create skill XML at:
   ~/sela/workspace/Cosmic/wz/Skill.wz/JOB.img.xml

   Add skill node inside <imgdir name="skill">:
   <imgdir name="SKILLID">
     <int name="masterLevel" value="MAX"/>
     <int name="action" value="1"/>
     <imgdir name="common"><int name="maxLevel" value="MAX"/></imgdir>
     <imgdir name="level">
       <imgdir name="1">
         <int name="damage" value="X"/>
         <int name="mpCon" value="X"/>
         <int name="attackCount" value="X"/>
         <int name="mobCount" value="X"/>
         <int name="range" value="X"/>
         <!-- optional: time, cooltime, prop, dot, dotTime, x (buff value), mad, pad -->
       </imgdir>
       <!-- scale per level: damage +5-10%, mpCon +1, mobCount +1 every 5 levels -->
     </imgdir>
   </imgdir>

2. Add String.wz/Skill.img.xml entry:
   <imgdir name="SKILLID">
     <string name="name" value="Skill Name"/>
     <string name="desc" value="Description"/>
     <string name="h1" value="Damage: #damage%"/>
     <string name="h2" value="MP Cost: #mpCon"/>
   </imgdir>

3. If special mechanic needed: note that Java code change is required
   (StatEffect.java — needs compilation with mvn package)
```

#### For a JOB:
```
1. Edit Job.java:
   ~/sela/workspace/Cosmic/src/main/java/client/Job.java
   Add enum entries: JOB_1ST(ID), JOB_2ND(ID+10), JOB_3RD(ID+11), JOB_4TH(ID+12)

2. Create skill files:
   ~/sela/workspace/Cosmic/wz/Skill.wz/JOB_ID.img.xml (one per tier)

3. Create advancement NPC:
   ~/sela/workspace/Cosmic/scripts/npc/NPCID.js
   (check level + current job → changeJob → give starter items)

4. Add NPC to a map (life section)

5. Add all skill strings to String.wz/Skill.img.xml

6. Compile: cd ~/sela/workspace/Cosmic && mvn package
```

#### For an NPC:
```
1. Create/reuse NPC sprite (Npc.wz)
2. Create script: ~/sela/workspace/Cosmic/scripts/npc/NPCID.js
3. Add String.wz/Npc.img.xml entry
4. Add to map life section
```

#### For JOB ADVANCEMENT NPCs (MANDATORY for every new job class):
```
Each job class needs 4 advancement NPCs + 1 gear shop NPC. Follow vanilla patterns:

1ST JOB NPC (like Grendel, Dark Lord, Athena Pierce):
  - Check: cm.getJobId() == 0, cm.getLevel() >= 10, cm.getPlayer().getInt() >= 20
  - Multi-page lore dialogue introducing the class fantasy
  - On accept: cm.changeJobById(X00), cm.gainItem(starterWeapon), cm.teachSkill(...)
  - cm.resetStats() after job change

2ND JOB NPC (test instructor — separate NPC in a different map):
  - Player arrives with referral letter (item) from 1st NPC
  - Check: cm.getJobId() == X00, cm.getLevel() >= 30, cm.getPlayer().getInt() >= 60
  - Quest flow: no letter? → "Who sent you?" | has letter? → start trial
  - Trial: collect proof items OR enter test map → fight mobs → return with proof
  - Use cm.startQuest(questId) for tracking, cm.haveItem(proofItem) for completion
  - On complete: cm.changeJobById(X10), cm.gainItem(proofItem, -1)

3RD JOB NPC (mysterious/powerful figure in a hidden location):
  - Check: cm.getJobId() == X10, cm.getLevel() >= 70, cm.getPlayer().getInt() >= 150
  - Quest flow: sends player to secret passage → fight dark clone of NPC
  - Use party quest item flags: cm.getPlayer().gotPartyQuestItem("JB3")
  - On return with Dark Crystal: cm.changeJobById(X11)

4TH JOB NPC (legendary/ancient master at end-game location):
  - Check: cm.getJobId() == X11, cm.getLevel() >= 120, cm.getPlayer().getInt() >= 280
  - Complex quest: collect 3 Soul Fragments from boss trials
  - Multi-step dialogue with deep lore about the class's ultimate power
  - On complete: cm.changeJobById(X12), cm.teachSkill(ultimate skills)

GEAR SHOP NPC:
  - Themed shop with weapons per tier + full armor set
  - Multi-menu: browse weapons | browse armor | about the gear | leave
  - Each item has lore description, price, level requirement
  - Check mesos + inventory space before selling
```

### 3C: Create NPC Scripts (JavaScript)

Shop NPC template:
```javascript
var status = 0;
function start() { status = -1; action(1, 0, 0); }
function action(mode, type, selection) {
    if (mode == -1 || mode == 0) { cm.dispose(); return; }
    status++;
    if (status == 0) {
        cm.sendSimple("Welcome! What would you like?\r\n#L0#Buy items#l\r\n#L1#Sell items#l");
    } else if (status == 1) {
        if (selection == 0) {
            // Open shop by ID
            cm.openShop(SHOP_ID);
        } else {
            cm.sendOk("Come back anytime!");
        }
        cm.dispose();
    }
}
```

Quest NPC template:
```javascript
var status = 0;
function start() { status = -1; action(1, 0, 0); }
function action(mode, type, selection) {
    if (mode == -1 || mode == 0) { cm.dispose(); return; }
    status++;
    if (status == 0) {
        if (cm.haveItem(REQUIRED_ITEM_ID, REQUIRED_COUNT)) {
            cm.sendYesNo("You collected all the items! Want your reward?");
        } else {
            cm.sendOk("Bring me " + REQUIRED_COUNT + " of [item name].");
            cm.dispose();
        }
    } else if (status == 1) {
        cm.gainItem(REQUIRED_ITEM_ID, -REQUIRED_COUNT);  // take items
        cm.gainExp(REWARD_EXP);
        cm.gainItem(REWARD_ITEM_ID, REWARD_COUNT);
        cm.sendOk("Thank you! Here's your reward.");
        cm.dispose();
    }
}
```

---

## Phase 4: VALIDATE — Check Everything Works

### Automated Validation Checklist

Run through this for EVERY piece of content created:

```
MAP VALIDATION:
 □ File exists: wz/Map.wz/Map/Map9/MAPID.img.xml
 □ Has <info> with bgm, returnMap, forcedReturn, VR bounds
 □ Has <back> with at least 1 background layer
 □ Has at least 1 layer with tS (tileset) + tiles
 □ Has <foothold> with connected segments
 □ Has <portal> with spawn point (pt=0, pn="sp")
 □ Every exit portal has a matching portal in the target map
 □ Parent map has portal TO this map
 □ String.wz/Map.img.xml has entry for this map ID
 □ All life spawns have valid foothold references
 □ Tile y-positions match foothold y-positions
 □ VR bounds cover entire map area
 □ tS, bS, oS values are valid (exist in v83-img-data)

MONSTER VALIDATION:
 □ File exists: wz/Mob.wz/MOBID.img.xml
 □ Has <info> with level, maxHP, exp, speed, damage
 □ String.wz/Mob.img.xml has name entry
 □ Added to at least one map's <life> section
 □ Drop table configured
 □ Stats balanced for stated level (compare to vanilla mobs)

SKILL VALIDATION:
 □ Skill node exists in Skill.wz/JOB.img.xml
 □ Has masterLevel, maxLevel, level data
 □ All levels defined (1 through maxLevel, or at minimum 1,5,10,15,20)
 □ Damage scales smoothly (+5-10% per level)
 □ MP cost scales with power
 □ String.wz/Skill.img.xml has name + desc
 □ Not overpowered vs same-tier skills in other jobs
 □ mobCount doesn't exceed: 1st=4, 2nd=6, 3rd=8, 4th=15

JOB VALIDATION:
 □ Job.java has all tier enums
 □ Skill.wz has .img.xml for each tier
 □ All skills have String.wz entries
 □ 4 advancement NPCs exist (1 per tier), each with DISTINCT name + personality
 □ 1 gear shop NPC exists with weapons per tier + armor set
 □ Each advancement NPC checks BOTH level AND primary stat requirement
 □ 1st job NPC: simple talk + advance + starter weapon + resetStats
 □ 2nd job NPC: multi-step questline (letter → trial → proof → advance)
 □ 3rd job NPC: clone fight quest (secret passage → dark clone → Dark Crystal)
 □ 4th job NPC: complex quest (3+ proof items from trials → advance)
 □ All NPCs have multi-page lore dialogue (not just "Are you ready?")
 □ Quest tracking uses cm.startQuest/completeQuest + cm.haveItem
 □ All NPCs placed on appropriate maps with String.wz entries
 □ SP allocation won't break (total SP per tier matches skills)
 □ Job.java compiled (mvn package)
 □ CLASS HOME TOWN exists — town map with town=1 flag, unique theme matching class fantasy
 □ Town has unique tileset + background that reflects the class identity (dark/undead for necro, arcane/mystical for sage, etc.)
 □ Town connected to Victoria Island or world map via portal (bidirectional!)
 □ 4 training fields connected to town (Lv10-30, Lv30-60, Lv60-100, Lv100+)
 □ Each training field has class-themed mobs at appropriate levels
 □ Class Lore NPC exists in town — gives 2-3 lore quests about class history
 □ Training Instructor NPC exists — gives repeatable kill/collect quests per level range
 □ Skill Trainer NPC exists — gives quest chains that unlock special skills or skill books
 □ Class Boss Quest NPC exists — sends player to fight class-themed bosses per tier
 □ All quest NPCs have distinct names, personalities, and multi-page dialogue
 □ All town NPCs placed in the class town map's <life> section

NPC VALIDATION:
 □ Script exists: scripts/npc/NPCID.js
 □ Script has proper dispose() calls (no hanging dialogues)
 □ String.wz/Npc.img.xml has name
 □ Added to map <life> section
 □ Uses existing sprite ID OR new sprite added to Npc.wz
```

### Use harepacker-mcp to verify:
```
# Verify the map loads correctly
get_tree_structure(category: "Map", image: "Map/Map9/MAPID.img", depth: 2)

# Verify mob data
get_property_value(category: "Mob", image: "MOBID.img", path: "info/level")
get_property_value(category: "Mob", image: "MOBID.img", path: "info/maxHP")

# Verify skill data
get_property_value(category: "Skill", image: "JOB.img", path: "skill/SKILLID/level/1/damage")
```

---

## Phase 5: INTEGRATE — Deploy to Server & Client

### Server-Side (always needed):
```
# All WZ XML changes are read on server startup — just restart
# If Java code was changed (Job.java, StatEffect.java):
cd ~/sela/workspace/Cosmic && ./mvnw clean package -DskipTests
# Must stop server first (JAR locked while running)
```

### Client-Side — WZ Build & Deploy Pipeline:

**CRITICAL**: The client reads binary .wz files, NOT the server XMLs. Any visual change
(NPCs, mobs, skills, maps) requires rebuilding WZ files for the client.

**Source of truth**: `~/sela/workspace/Cosmic-client/` — clean, unmodified original WZ files.
**NEVER modify these.** Always extract from them, add custom content on top, then repack.

**Master rebuild script**: `~/maple-lora/master_rebuild.py`
Run this whenever you add or change ANY custom WZ content:
```
cd ~/maple-lora && python master_rebuild.py
```

**What it does (8 steps)**:
1. Copies Npc.wz, Mob.wz, String.wz, Skill.wz from source of truth to temp dir
2. Extracts to .img format via WzImg MCP `extract_to_img` (wzPath = DIRECTORY, not file)
3. Copies custom mob .img files (990x IDs from ~/Desktop/cosmic-wz-patched/Mob/)
4. Copies custom NPC .img files (999x IDs from ~/Desktop/cosmic-wz-patched/Npc/)
5. Imports LoRA NPC sprites via `set_canvas_bitmap` (BGRA base64 from npc_b64_all.json)
6. Builds custom Skill .img files:
   - Copies mage .img as template (200→600, 210→610, 211→611, 212→612, etc.)
   - Renames skill IDs via `rename_property` (preserves all child nodes)
   - Imports custom skill effects from skill_effects_b64.json (icons + effect frames + hit frames)
7. Adds String.wz entries for all custom NPCs, mobs, and skills
8. Repacks modified WZ via `pack_to_wz`, copies unchanged WZ from source of truth
9. Deploys ALL 12 .wz files to patcher dir: ~/sela/workspace/v83-client-patched/
10. Regenerates patcher manifest (SHA256 hashes)

**WzImg MCP server**: ~/sela/workspace/WzImg-MCP-Server/WzImgMCP/bin/Debug/net8.0-windows/WzImgMCP.exe
**Communication protocol**: NDJSON (json.dumps(msg) + "\n"), NOT LSP Content-Length headers

**IMPORTANT GOTCHAS**:
- `extract_to_img` wzPath must be a DIRECTORY containing .wz files, NOT a single .wz file path
- `copy_property` does NOT work across different .img files — use file copy + `rename_property`
- Canvas bitmap data must be BGRA format (swap R↔B from RGBA)
- After modifying, call `save_image` before repacking
- Kill leftover python processes after LoRA runs: `taskkill //IM python.exe //F`
- The patcher server must be running on port 3500 for clients to download updates
- If client says "missing files", rebuild ALL from source of truth (not just the changed ones)

**WHEN TO RUN master_rebuild.py**:
- After adding/modifying custom NPC .img files or sprites
- After adding/modifying custom mob .img files
- After adding/modifying custom skill data (effects, icons, IDs)
- After changing String.wz entries (NPC names, skill names, mob names)
- After ANY change that affects client-side WZ content

**WHEN YOU DON'T NEED IT**:
- NPC scripts only (scripts/npc/*.js) → server restart only
- Quest/event scripts only → server restart only
- Server-side Skill.wz XML changes only → server restart only (but client won't see new icons/effects)
- Drop table changes → server restart only
- Config.yaml changes → server restart only

### Adding NEW Custom Content to the Pipeline:

When you create NEW custom NPCs, mobs, or skills, you need to:

1. **NPC**: Create .img file (or copy existing template), place in ~/Desktop/cosmic-wz-patched/Npc/
   - Generate sprite with LoRA if needed: update gen_all_sprites.py, run it
   - Add NPC to server String.wz XML: ~/sela/workspace/Cosmic/wz/String.wz/Npc.img.xml
   - The master_rebuild.py will auto-pick up any 999x .img files and sprite data

2. **Mob**: Create .img file, place in ~/Desktop/cosmic-wz-patched/Mob/
   - Add mob to server String.wz XML
   - Update master_rebuild.py if using a different ID prefix than 990x

3. **Skill**:
   - Server side: create/edit Skill.wz/{JOBID}.img.xml (MUST have `level` node or server NPEs)
   - Client side: master_rebuild.py handles it (copies mage template, renames IDs, imports effects)
   - For NEW skills beyond the existing 64: add to SKILL_JOBS mapping in master_rebuild.py
   - Generate effect sprites: update gen_skill_effects.py SKILLS dict, run it

4. **Map**: Edit Map.wz XMLs in Cosmic/wz/ (server side). Map.wz is copied unchanged from source of truth to patcher — if you need custom map changes in the CLIENT, add Map.wz to the modify_wz list in master_rebuild.py.

5. **After all changes**: Run `cd ~/maple-lora && python master_rebuild.py`

### Asset & Data Locations:
```
Source of truth:     ~/sela/workspace/Cosmic-client/  (12 original .wz files — NEVER modify)
Server WZ XMLs:     ~/sela/workspace/Cosmic/wz/       (server reads these on startup)
Custom NPC .img:    ~/Desktop/cosmic-wz-patched/Npc/   (999x .img files)
Custom Mob .img:    ~/Desktop/cosmic-wz-patched/Mob/   (990x .img files)
NPC sprites b64:    ~/maple-lora/npc_b64_all.json      (69 NPCs, BGRA base64)
Skill effects b64:  ~/maple-lora/skill_effects_b64.json (64 skills, icons+effects+hits)
LoRA models:        ~/Desktop/models/anythingV5.safetensors + maplestory_sprite_lora
Patcher output:     ~/sela/workspace/v83-client-patched/ (ALL 12 .wz files served here)
Manifest gen:       ~/sela/workspace/maple-patcher/server/generate-manifest.js
NPC scripts:        ~/sela/workspace/Cosmic/scripts/npc/ (*.js)
```

### Test Commands:
```
@goto MAPID              — teleport to map
@spawn MOBID 5           — spawn 5 of a monster
@npc NPCID               — open NPC dialog
@setjob JOBID            — change to job
@giveskill SKILLID LEVEL — give skill at level
@item ITEMID             — give item
@cleardrops              — clean map
@killall                 — kill all mobs
```

---

## Phase 6: REPORT — Tell Ron What Was Done

After completing all phases, send a summary to Ron:

```
*MapleStory Update Complete*

*Created:*
- [list everything created with IDs]

*Files changed:*
- [list all files modified/created]

*Server:* [restart needed / compiled and ready]
*Client:* [WZ compiled and deployed to patcher / no update needed]

*Test:* Use @goto MAPID to check it out

*What connects to what:*
- [map] ↔ [parent map] via portal
- [mob] spawns in [map], drops [items]
- [NPC] in [map], script: [purpose]
```

---

## ID Registry — What's Already Used

Keep this updated when creating new content:

```
MAPS (Map9/):
  900000000          — [check current purpose]
  910000000-910000018 — [check current purposes]
  Next available: check ls Map9/ and use next unused ID

NPCs:
  9999001-9999013   — Custom NPCs (see CUSTOM-CONTENT.md)
  9999020-9999021   — Additional NPCs
  9999030-9999031   — Additional NPCs
  Next available: 9999032+

ITEMS:
  2002031-2002037   — Custom consumables
  2030021           — Custom scroll
  1302134, 1382081, 1452086, 1332100, 1492049, 1442104, 1472101, 1482047 — Custom weapons
  Next: check CUSTOM-CONTENT.md

SKILLS (Sage line — 32 skills, all have custom LoRA effects):
  6001000-6001005   — Sage 1st job (Arcane Bolt, Mana Shield, Elemental Attunement, Sage's Wisdom, Runic Strike, Teleport)
  6101000-6101007   — Elementalist 2nd job (Flame Pillar, Frost Nova, Lightning Chain, Elemental Boost, Spell Mastery, Mana Surge, Arcane Barrier, Element Shift)
  6111000-6111007   — Arcanum 3rd job (Meteor Shower, Blizzard, Thunder Spear, Elemental Convergence, Sage Meditation, Runic Ward, Arcane Explosion, Mystic Door)
  6121000-6121009   — Archsage 4th job (Primordial Inferno, Absolute Zero, Divine Thunder, Elemental Unity, Sage's Enlightenment, Arcane Mastery, Infinity, Hero's Will, Maple Warrior, Elemental Storm)

SKILLS (Necromancer line — 32 skills, all have custom LoRA effects):
  7001000-7001005   — Necromancer 1st job (Dark Bolt, Soul Drain, Dark Aura, Bone Shield, Shadow Strike, Teleport)
  7101000-7101007   — Dark Acolyte 2nd job (Plague Touch, Corpse Explosion, Summon Skeleton, Dark Mastery, Life Tap, Necrotic Boost, Fear, Curse of Weakness)
  7111000-7111007   — Soul Reaper 3rd job (Death Coil, Army of the Dead, Soul Harvest, Blight, Dark Meditation, Bone Armor, Necrotic Explosion, Death Gate)
  7121000-7121009   — Lich King 4th job (Doom, Raise Lich, Soul Shatter, Plague Lord, Dark Pact, Necro Mastery, Undying Will, Hero's Will, Maple Warrior, Death's Embrace)

JOBS:
  600 Sage → 610 Elementalist → 611 Arcanum → 612 Archsage
  700 Necromancer → 710 Dark Acolyte → 711 Soul Reaper → 712 Lich King
  Next available job line: 800

NECROMANCER NPCs:
  9990010 — Mordecai the Gravedigger (1st job advancement)
  9990011 — Lady Vesper / Death Disciple (2nd job advancement)
  9990012 — The Bone Oracle / Soul Reaper (3rd job advancement)
  9990013 — Kael'Mortis the Eternal / Ancient Lich (4th job advancement)
  9990014 — Grizelda the Bone Merchant (gear shop)

CUSTOM CONTENT TOTALS:
  69 custom NPCs (9999001-9999073 range, all with LoRA sprites)
  2 custom mobs (990x range)
  64 custom skill effects (icons + effect frames + hit frames, all LoRA-generated)
  All String.wz entries added for NPCs, mobs, and skills

QUESTS:
  99001-99005       — Custom quests
  Next: 99006+

QUEST ITEMS (for job advancement questlines):
  Use 4032XXX range for custom quest proof items
  Each job class needs: referral letter, trial proof items, dark crystal, soul fragments
```

---

## Decision Shortcuts

**"I need a quick map"** → Skip art, use existing v83 tileset. Focus on footholds + portals + spawns. Still do Phase 1-2 but keep plan brief.

**"I need a whole new region"** → Full cycle. Design all maps first as a connected graph before creating any. Plan portal chains. Pick one consistent theme.

**"Just rebalance a skill"** → Edit Skill.wz level values directly. No sprites, no compilation. Phase 2 = just state the change. Restart server.

**"Copy an existing map but modify it"** → Use harepacker-mcp to read the source map structure, then clone and modify. Fastest path to a good-looking map.

**"New custom mob with new sprite"** → Longest pipeline. Need sprite generation → WZ integration → stats → spawns → drops. Budget extra time.

---

## Triggering the Automated Cycle

When a MapleStory goal is set or Ron asks for maple content, OUTPUT a chain_plan tag to trigger the workflow engine:

**For a new map:**
```
<chain_plan>create new maplestory map: [description from Ron's request]</chain_plan>
```

**For a new monster:**
```
<chain_plan>create new maplestory monster: [description]</chain_plan>
```

**For a new skill:**
```
<chain_plan>create new maplestory skill: [description]</chain_plan>
```

**For a new job class:**
```
<chain_plan>create new maplestory job class: [description]</chain_plan>
```

**For a new NPC:**
```
<chain_plan>create new maplestory npc: [description]</chain_plan>
```

**For a full zone/region:**
```
<chain_plan>create new maplestory region zone: [description]</chain_plan>
```

The chain-planner has pre-built templates for each of these that automatically follow the THINK → PLAN → APPROVE → EXECUTE → VALIDATE → REPORT cycle. Each template includes a `wait_input` step that pauses for Ron's approval before creating anything.

**IMPORTANT:** Always use chain_plan for MapleStory work. Do NOT try to do everything in a single message. The workflow engine handles multi-step execution, progress updates, and rollback on failure.
