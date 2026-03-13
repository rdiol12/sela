---
name: "MapleStory Validator"
description: "Pre-commit validation checklist for all MapleStory content. Run BEFORE writing any files. Prevents crashes and broken content."
keywords: ["validate", "check", "verify", "maple validate", "pre-commit", "checklist"]
category: "gamedev"
---

# MapleStory Validator — Run BEFORE Every Change

## MANDATORY: Pre-Write Validation

Before writing ANY MapleStory file, run the relevant checks below.
If ANY check fails, FIX IT before writing. Never skip validation.

---

## NPC Validation

Before adding NPC `{ID}` to any map:

```
CHECK 1: Does wz/Npc.wz/{ID}.img.xml exist?
  → NO: Create it first (see maple-npc-builder)
  → YES: Continue

CHECK 2: Does the NPC XML have correct canvas structure?
  → Must be: <imgdir name="stand"><canvas name="0" ...>
  → NOT: <imgdir name="stand"><imgdir name="0"><canvas name="image">

CHECK 3: Does a sprite PNG exist?
  → Check: workspace/maple-sprites/custom-npcs/{ID}/stand_0.png
  → NO: Generate sprite first

CHECK 4: Does a String.wz entry exist?
  → Check: grep '{ID}' wz/String.wz/Npc.img.xml
  → NO: Add name entry

CHECK 5: Does a script exist?
  → Check: scripts/npc/{ID}.js
  → NO: Create script (see maple-script-builder)

CHECK 6: Is the NPC ID in the WZ patcher injection list?
  → Check: Program.cs Npc.wz section
  → NO: Add it

ALL 6 PASSED → Safe to add NPC to map
ANY FAILED → DO NOT add to map
```

## Map Validation

Before saving a map XML:

```
CHECK 1: Exactly 8 layers (0-7) present?
CHECK 2: hideMinimap=1 set? (for custom maps)
CHECK 3: Every <imgdir> tag properly closed?
CHECK 4: Foothold hierarchy correct? (foothold/LAYER/GROUP/ID)
CHECK 5: Disconnected platform footholds have prev=0, next=0?
CHECK 6: Spawn portal exists? (pt=0, pn="sp")
CHECK 7: All NPC IDs in life section have Npc.wz data?
  → For EACH NPC ID: verify wz/Npc.wz/{ID}.img.xml exists
  → REMOVE any NPC that doesn't have WZ data
CHECK 8: All mob IDs in life section exist in Mob.wz?
CHECK 9: Tileset names valid? (verify with harepacker-mcp search_by_name)
CHECK 10: Background names valid?
CHECK 11: String.wz map entry exists?
CHECK 12: No entries nested inside other entries in life section?
  → Each <imgdir> in life must be a DIRECT child, not nested

ALL PASSED → Safe to save
```

## Script Validation

Before saving a `.js` NPC/quest script:

```
CHECK 1: No backtick characters (`) anywhere?
CHECK 2: No bare newlines inside string literals?
  → Search for lines with unclosed " that continue on next line
CHECK 3: All newlines use \r\n concatenation?
CHECK 4: No arrow functions (=>)?
CHECK 5: No let/const? (use var only)
CHECK 6: No template literals?
CHECK 7: cm.dispose() called in every exit path?
CHECK 8: function start() and function action() both exist?
```

## Skill Validation

Before saving a skill:

```
CHECK 1: Skill XML exists in Skill.wz/{JOB_ID}.img.xml?
CHECK 2: All level entries present (1 through maxLevel)?
CHECK 3: String.wz entry has name + desc + h?
CHECK 4: Damage/MP within tier balance ranges?
CHECK 5: Skill ID format correct (JJJNNNN)?
CHECK 6: Added to WZ patcher?
```

## Map Life Section — Common Bugs to Catch

### BUG: NPC nested inside another NPC
```xml
<!-- WRONG: entry 3 is nested inside entry 2 -->
<imgdir name="2">
  <string name="type" value="n"/>
  <string name="id" value="1012000"/>
  ...
  <imgdir name="3">
    <string name="type" value="n"/>
    <string name="id" value="9999050"/>
    ...
  </imgdir>
</imgdir>

<!-- CORRECT: both are siblings -->
<imgdir name="2">
  <string name="type" value="n"/>
  <string name="id" value="1012000"/>
  ...
</imgdir>
<imgdir name="3">
  <string name="type" value="n"/>
  <string name="id" value="9999050"/>
  ...
</imgdir>
```

### BUG: NPC placed in wrong section (foothold, portal, etc.)
```
Life entries ONLY go inside <imgdir name="life">
Never inside foothold, portal, back, or layer sections
```

### BUG: NPC without WZ data on map
```
Client error: 0x80030002 (STG_E_FILENOTFOUND)
Cause: Map references NPC ID that doesn't exist in Npc.wz
Fix: Remove the NPC from the map, or create its WZ data first
```

### BUG: Duplicate entry numbers in life section
```
Every <imgdir name="N"> in the life section must have a unique N
Duplicates cause one entry to be silently ignored
```

## Quick Reference — What Each Content Type Needs

| Content | WZ XML | Sprite | String.wz | Script | Patcher | Map Placement |
|---------|--------|--------|-----------|--------|---------|---------------|
| NPC | Npc.wz/{ID}.img.xml | stand_0.png | Npc.img | scripts/npc/{ID}.js | Yes | life section |
| Mob | Mob.wz/{ID}.img.xml | 5 states | Mob.img | N/A | No (existing) | life section |
| Map | Map.wz/MapX/{ID}.img.xml | N/A | Map.img | N/A | Yes | portal in parent |
| Skill | Skill.wz/{JOB}.img.xml | effect+icon | Skill.img | N/A | Yes | N/A |
| Item | Item.wz/Etc/{ID}.img.xml | icon | Ins.img/Etc.img | N/A | Yes | drop table |
