---
name: "MapleStory Job Builder"
description: "Focused guide for creating new job classes in Cosmic v83. Job IDs, advancement flow, stat requirements, skill trees."
keywords: ["job", "class", "advancement", "progression", "tier", "necromancer", "sage", "maple job"]
category: "gamedev"
---

# Job Builder — Cosmic v83

## HARD RULES

1. A job is NOT done until it has: home town + 4 advancement NPCs + gear shop + quest NPCs + skills + sprites
2. Each advancement NPC must be a DISTINCT character with unique name and personality
3. Each advancement requires BOTH level AND stat minimum
4. Job IDs follow pattern: X00 (1st), X10 (2nd), X11 (3rd), X12 (4th)
5. Skill IDs follow pattern: JJJNNNN (JJJ = job ID, NNNN = skill number)
6. Every NPC must have WZ sprite data BEFORE being placed on any map
7. Every skill needs XML + String.wz entry + effect sprite + icon

## Job ID Registry

```
Existing jobs (vanilla v83):
  Beginner: 0
  Warriors: 100/110/111/112
  Mages:    200/210/211/212
  Archers:  300/310/311/312
  Thieves:  400/410/411/412
  Pirates:  500/510/511/512

Custom jobs:
  Sage:        600/610/611/612  — INT-based, arcane magic
  Necromancer: 700/710/711/712  — INT-based, dark magic

Next available: 800/810/811/812
```

## Job Creation Checklist

### 1. Core Identity
- [ ] Job name and fantasy theme defined
- [ ] Primary stat chosen (STR/DEX/INT/LUK)
- [ ] Secondary stat chosen
- [ ] Weapon type chosen
- [ ] Job IDs assigned (X00/X10/X11/X12)
- [ ] What makes it different from existing jobs?

### 2. Skills (see maple-skill-builder for XML format)
- [ ] 1st job: 3-5 skills (1-2 attacks, 1-2 passives, 1 buff)
- [ ] 2nd job: 4-6 skills (2-3 attacks, 1-2 passives, 1 buff/summon)
- [ ] 3rd job: 5-6 skills (2-3 attacks, 1-2 passives, 1-2 utility)
- [ ] 4th job: 5-7 skills (3-4 attacks, 1-2 passives, 1 ultimate)
- [ ] All skills in Skill.wz/{JOB_ID}.img.xml
- [ ] All skills in String.wz/Skill.img.xml
- [ ] All skills added to WZ patcher

### 3. Advancement NPCs (see maple-npc-builder for NPC format)

**Each tier gets ONE advancement NPC with:**
- Unique name (like "Grendel the Really Old", not "Mage Instructor")
- Personality and dialogue with lore
- Level + stat requirements
- Quest/trial before advancing

| Tier | Level | Stat Example | Quest Complexity |
|------|-------|-------------|-----------------|
| 1st | 10 | PRIMARY 20+ | Simple: talk → stat check → advance |
| 2nd | 30 | PRIMARY 60+ | Letter from 1st NPC → travel → combat trial → proof item → advance |
| 3rd | 70 | PRIMARY 150+ | Sent to secret area → fight dark clone → bring Dark Crystal → advance |
| 4th | 120 | PRIMARY 280+ | Collect 3+ proof items from trials/bosses → final test → advance |

**Script pattern for advancement check:**
```javascript
// In the NPC script (see maple-script-builder for full template)
if (cm.getLevel() >= 30 && cm.getStat("INT") >= 60) {
    // Allow advancement
    cm.changeJob(710); // 2nd job
} else {
    cm.sendOk("You need level 30 and 60 INT to advance.");
}
```

### 4. Home Town (see maple-map-builder for map format)
- [ ] Town map created (town=1 flag set)
- [ ] Theme matches class fantasy (unique tileset + background)
- [ ] Portal to/from Victoria Island or world map
- [ ] All class NPCs placed in town
- [ ] Training fields connected to town:
  - [ ] Lv 10-30 field with class-themed mobs
  - [ ] Lv 30-60 field
  - [ ] Lv 60-100 field
  - [ ] Lv 100+ field

### 5. Gear Shop NPC
- [ ] NPC with WZ data + script + String entry
- [ ] Weapons: 1 per tier (Lv 10/30/70/120)
- [ ] Armor set: hat, overall, shoes, gloves
- [ ] Themed dialogue matching class fantasy

### 6. Quest NPCs (4 minimum, beyond advancement)
- [ ] Class Lore NPC — teaches class backstory (2-3 lore quests)
- [ ] Training Instructor — repeatable kill/collect quests per level range
- [ ] Skill Trainer — unlocks special skills through quest chains
- [ ] Boss Quest NPC — class-themed boss hunt quests per tier

### 7. Integration
- [ ] All NPCs: WZ XML + sprite + String + script (use maple-validator)
- [ ] All maps: 8 layers + footholds + portals (use maple-validator)
- [ ] All skills: XML + String + sprites
- [ ] WZ patcher updated with all new entries
- [ ] Server compiled and tested
- [ ] Client WZ files rebuilt

## Town Theme Examples

| Job | Tileset | Background | Atmosphere |
|-----|---------|-----------|------------|
| Sage | woodMarble | shineWood | Floating libraries, arcane crystals, ethereal |
| Necromancer | darkSoil | darkCave | Bone architecture, eerie fog, haunted |
| Next job | ??? | ??? | Must feel unique — a warrior would feel out of place |

## File Locations

```
Skills:      wz/Skill.wz/{JOB_ID}.img.xml
NPC scripts: scripts/npc/{NPC_ID}.js
NPC WZ:      wz/Npc.wz/{NPC_ID}.img.xml
Town map:    wz/Map.wz/Map/Map9/{MAP_ID}.img.xml
Sprites:     workspace/maple-sprites/custom-npcs/{NPC_ID}/
Strings:     wz/String.wz/Skill.img.xml, Npc.img.xml, Map.img.xml
```
