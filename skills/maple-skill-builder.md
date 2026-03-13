---
name: "MapleStory Skill Builder"
description: "Focused guide for creating skills in Cosmic v83. Skill XML structure, String entries, balance ranges."
keywords: ["skill", "spell", "ability", "attack", "buff", "passive", "maple skill"]
category: "gamedev"
---

# Skill Builder — Cosmic v83

## HARD RULES

1. Every skill needs: Skill.wz XML + String.wz entry + effect sprites + icon sprite
2. Skill IDs follow format `JJJNNNN` — JJJ = job ID, NNNN = skill number within job
3. Data-only skills (no sprites) are invisible in-game
4. Every skill must be in the correct job's skill book

## ID Registry

```
Sage line:
  600 (Sage)         — skills 6001000-6001004
  610 (Sage Adept)   — skills 6101000-6101005
  611 (Sage Master)  — skills 6111000-6111004
  612 (Archsage)     — skills 6121000-6121005

Necromancer line:
  700 (Necromancer)  — skills 7001000-7001004
  710 (Dark Acolyte) — skills 7101000-7101005
  711 (Soul Reaper)  — skills 7111000-7111004
  712 (Lich King)    — skills 7121000-7121005

Next job line:       800+
```

## Balance Ranges

| Tier | Mob Count | Damage % | MP Cost | Cooldown |
|------|-----------|----------|---------|----------|
| 1st job | 1-4 | 100-200% | 10-20 | 0-5s |
| 2nd job | 1-6 | 150-350% | 20-40 | 0-10s |
| 3rd job | 1-8 | 200-500% | 30-60 | 0-15s |
| 4th job | 1-15 | 300-800% | 40-80 | 0-30s |

## Skill.wz XML Structure

File: `wz/Skill.wz/{JOB_ID}.img.xml`

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="{JOB_ID}.img">
  <imgdir name="skill">
    <imgdir name="{SKILL_ID}">
      <int name="masterLevel" value="MAX_LEVEL"/>
      <imgdir name="common">
        <int name="maxLevel" value="MAX_LEVEL"/>
      </imgdir>
      <imgdir name="level">
        <imgdir name="1">
          <int name="damage" value="110"/>
          <int name="mpCon" value="12"/>
          <int name="mobCount" value="3"/>
          <int name="attackCount" value="1"/>
          <int name="range" value="250"/>
          <int name="time" value="0"/>
          <int name="cooltime" value="0"/>
        </imgdir>
        <!-- ... more levels ... -->
        <imgdir name="20">
          <int name="damage" value="200"/>
          <int name="mpCon" value="24"/>
          <int name="mobCount" value="4"/>
          <int name="attackCount" value="1"/>
          <int name="range" value="300"/>
          <int name="time" value="0"/>
          <int name="cooltime" value="0"/>
        </imgdir>
      </imgdir>
    </imgdir>
  </imgdir>
</imgdir>
```

### Buff skill level entry:
```xml
<imgdir name="1">
  <int name="mpCon" value="15"/>
  <int name="time" value="60"/>        <!-- duration in seconds -->
  <int name="pad" value="5"/>          <!-- attack boost -->
  <int name="pdd" value="10"/>         <!-- defense boost -->
  <int name="speed" value="5"/>        <!-- speed boost -->
</imgdir>
```

### Passive skill level entry:
```xml
<imgdir name="1">
  <int name="pad" value="2"/>          <!-- permanent attack boost -->
  <int name="mastery" value="15"/>     <!-- weapon mastery % -->
  <int name="acc" value="5"/>          <!-- accuracy boost -->
</imgdir>
```

## String.wz Entry

Add to `wz/String.wz/Skill.img.xml`:

```xml
<imgdir name="{JOB_ID}">
  <string name="bookName" value="Job Name"/>
  <imgdir name="{SKILL_ID}">
    <string name="name" value="Skill Name"/>
    <string name="desc" value="Skill description."/>
    <string name="h" value="Detailed skill description for tooltip."/>
  </imgdir>
</imgdir>
```

## Checklist

- [ ] Skill XML in `Skill.wz/{JOB_ID}.img.xml`
- [ ] All level entries present (1 through maxLevel)
- [ ] String.wz entry with name + desc + h
- [ ] Balance within tier ranges
- [ ] Effect sprite (or using existing effect)
- [ ] Icon sprite (or using existing icon)
- [ ] Added to WZ patcher injection list
- [ ] Added to `PatchSkillStrings()` in patcher
