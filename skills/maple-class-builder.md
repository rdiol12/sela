---
name: "MapleStory Class Builder"
description: "High-level orchestrator for building a complete job class. References other maple-* builders for each component."
keywords: ["class", "job class", "new class", "full class", "class design", "maple class"]
category: "gamedev"
---

# Class Builder — Cosmic v83

## What This Guide Does

Building a full job class touches EVERY system. This guide is the **orchestrator** — it tells you WHAT to build and in WHAT ORDER, then points to the specific builder guide for HOW.

## Build Order (do NOT skip steps)

### Step 1: Design (present to Ron for approval)

Define the class identity before creating anything:

```
Job name:        [name]
Job line:        [1st] → [2nd] → [3rd] → [4th]
Job IDs:         [X00, X10, X11, X12]
Primary stat:    [STR/DEX/INT/LUK]
Weapon type:     [sword/staff/claw/gun/etc]
Fantasy theme:   [1-2 sentences — what makes it unique]
Town theme:      [tileset + background + atmosphere]
```

**WAIT for Ron's approval before proceeding.**

### Step 2: Skills (use maple-skill-builder)

Create skill XMLs for all 4 tiers:

| Tier | Count | Focus |
|------|-------|-------|
| 1st job (Lv10) | 3-5 skills | 1-2 attacks, 1-2 passives, 1 buff |
| 2nd job (Lv30) | 4-6 skills | 2-3 attacks, 1-2 passives, 1 buff/summon |
| 3rd job (Lv70) | 5-6 skills | 2-3 attacks, 1-2 passives, 1-2 utility |
| 4th job (Lv120) | 5-7 skills | 3-4 attacks, 1-2 passives, 1 ultimate |

Files to create:
- `wz/Skill.wz/{X00}.img.xml` through `{X12}.img.xml`
- String entries in `wz/String.wz/Skill.img.xml`

### Step 3: NPC Sprites (use maple-npc-builder)

Generate sprites for ALL class NPCs before creating scripts or placing on maps:

```
NPCs needed (minimum 10):
  4 × advancement NPCs (1 per tier)
  1 × gear shop NPC
  1 × lore NPC
  1 × training instructor
  1 × skill trainer
  1 × boss quest NPC
  1+ × optional extras
```

For EACH NPC:
1. Generate sprite PNG with `maple_generate_sprite`
2. Create `wz/Npc.wz/{ID}.img.xml` with correct canvas structure
3. Add String.wz entry
4. Add to WZ patcher injection list

**DO NOT proceed to map/script creation until ALL NPC sprites + WZ XMLs exist.**

### Step 4: Home Town Map (use maple-map-builder)

Create the class town:
- Set `town=1` in info section
- Use theme matching class fantasy
- Portal to Victoria Island or world map
- Place ALL class NPCs (only after Step 3 is complete)

### Step 5: Training Fields (use maple-map-builder)

Create 4 connected training maps branching from town:

| Field | Level | Mobs | Connected to |
|-------|-------|------|-------------|
| Field 1 | 10-30 | Class-themed weak mobs | Town |
| Field 2 | 30-60 | Class-themed medium mobs | Field 1 or Town |
| Field 3 | 60-100 | Class-themed strong mobs | Field 2 |
| Field 4 | 100+ | Class-themed elite mobs | Field 3 |

Each field needs bidirectional portals.

### Step 6: Advancement Scripts (use maple-script-builder + maple-quest-builder)

Create advancement NPC scripts:

| Tier | Script Pattern |
|------|---------------|
| 1st | Talk → level+stat check → `cm.changeJob(X00)` → give starter skills |
| 2nd | Check letter from 1st NPC → combat trial → proof item → `cm.changeJob(X10)` |
| 3rd | Warp to trial map → fight dark clone → bring Dark Crystal → `cm.changeJob(X11)` |
| 4th | Collect 3+ proof items from bosses → final test → `cm.changeJob(X12)` |

### Step 7: Quest NPC Scripts (use maple-quest-builder)

Create quest chains for the 4 quest NPCs:

| NPC | Quests |
|-----|--------|
| Lore NPC | 2-3 talk quests about class history, reward EXP + lore items |
| Training Instructor | 4 repeatable kill/collect quests (1 per training field) |
| Skill Trainer | 4 chain quests unlocking bonus skills (1 per tier) |
| Boss Quest NPC | 4 boss hunt quests (unique class-themed bosses per tier) |

### Step 8: Gear Shop (use maple-script-builder)

Create shop NPC script with:
- 4 weapons (1 per tier: Lv 10/30/70/120)
- 4 armor pieces (hat, overall, shoes, gloves)
- Themed dialogue

### Step 9: WZ Patcher Update

Add ALL new entries to the WZ patcher:
- All NPC WZ XMLs → `Npc.wz` injection list
- All map XMLs → `Map.wz` injection list
- All skill XMLs → `Skill.wz` injection list
- All NPC names → `PatchNpcStrings()`
- All map names → `PatchMapStrings()`
- All skill names → `PatchSkillStrings()`

### Step 10: Build & Test

```bash
# 1. Build server
cd ~/sela/workspace/Cosmic
taskkill //F //IM java.exe
./mvnw clean package -DskipTests

# 2. Build client WZ files
cd ~/sela/workspace/maple-patcher/wz-patcher
dotnet run -- patch

# 3. Regenerate manifest
cd ~/sela/workspace/maple-patcher/server
node generate-manifest.js

# 4. Start server
cd ~/sela/workspace/Cosmic
java -jar target/Cosmic.jar &

# 5. Tell Ron to test
```

## Validation Gate

Before marking the class as complete, ALL must be true:

- [ ] All 15-22 skills created with XML + String entries
- [ ] All 10+ NPCs have: WZ XML + sprite + String + script
- [ ] Home town map works (no crash, NPCs visible)
- [ ] All 4 training fields work with mob spawns
- [ ] All 4 advancement quests work (test with `@job 0` and level up)
- [ ] Gear shop opens and sells items
- [ ] All quest NPCs functional
- [ ] All portals bidirectional
- [ ] Client WZ files rebuilt and served via patcher
- [ ] Ron has tested and approved

## Common Mistakes

1. **Creating scripts before WZ data** → NPCs crash client
2. **Forgetting String.wz entries** → invisible names
3. **Non-bidirectional portals** → players get stuck
4. **Skills without sprites** → invisible in skill UI
5. **Training fields without mobs** → empty boring maps
6. **Generic NPC names** → "Instructor 1" instead of "Vex the Shadow Weaver"
7. **Skipping stat requirements** → unbalanced advancement
8. **Not updating WZ patcher** → client never gets the content
