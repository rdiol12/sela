---
name: "MapleStory NPC Builder"
description: "Focused guide for creating NPCs in Cosmic v83. Covers WZ XML, sprites, scripts, String entries, and map placement."
keywords: ["npc", "shop", "merchant", "quest giver", "vendor", "maple npc"]
category: "gamedev"
---

# NPC Builder — Cosmic v83

## HARD RULES (violating these = client crash)

1. **NEVER add an NPC to a map unless `wz/Npc.wz/{ID}.img.xml` exists**
2. **NEVER use NPC IDs 9999056-9999059** — these have scripts but NO WZ sprite data
3. Canvas structure MUST be `<canvas name="0">` directly under `<imgdir name="stand">` — NOT `<imgdir name="0"><canvas name="image">`
4. Every NPC needs ALL of: WZ XML + sprite PNG + String.wz entry + script + map placement
5. Missing ANY one of these = crash or invisible NPC

## ID Registry (already used)

```
9990001-9990004  — Sage job instructors
9990010-9990014  — Necromancer job instructors
9999001-9999013  — General NPCs (guides, style, taskboard)
9999020-9999021  — Zone wardens (Frozen Caverns, Shadow Crypts)
9999030-9999047  — Job NPCs (crafters, coliseum, daily)
9999050-9999076  — Extended NPCs (all have sprites)
9999077+         — Newer NPCs (check if sprites exist)
```

## Full NPC Creation Pipeline

Creating a visible, working NPC requires **ALL** of these steps in order.
Skipping the sprite step = invisible NPC in-game.

### Step 1: Pick next available ID
Check `ls ~/sela/workspace/Cosmic/scripts/npc/9999*.js | tail -5` and pick the next unused ID.

### Step 2: Add sprite description to LoRA generator
Add the NPC to `NPC_DESCRIPTIONS` dict in `~/maple-lora/gen_all_npcs_unified.py`:
```python
"9999XXX": "short visual description, clothing, accessories, style keywords",
```

### Step 3: Generate sprite (LoRA pipeline)
```bash
cd ~/maple-lora && python gen_all_npcs_unified.py --only 9999XXX
```
This generates: LoRA image → crop → bg remove → ESRGAN upscale → 7 animation frames (3 stand + 4 move) → writes to `npc_b64_all.json`.
**Takes ~2-3 min per NPC on GPU.** Check output: `python -c "import json; d=json.load(open('npc_b64_all.json')); print('9999XXX' in d)"`

### Step 4: Create WZ XML
Create `~/sela/workspace/Cosmic/wz/Npc.wz/{ID}.img.xml` (see structure below).

### Step 5: Create String.wz entry
Add entry to `~/sela/workspace/Cosmic/wz/String.wz/Npc.img.xml` with name, func, desc, and speak lines.

### Step 6: Create NPC script
Write `~/sela/workspace/Cosmic/scripts/npc/{ID}.js` (Rhino-compatible JS — see rules below).

### Step 7: Place NPC in map(s)
Add NPC to target map's `<imgdir name="life">` section.

### Step 8: Build & Deploy
```bash
cd ~/maple-lora && python master_rebuild.py
```
This extracts vanilla WZ → injects ALL custom content (NPCs from npc_b64_all.json + mobs + skills + strings) → repacks → deploys to patcher dir.

### Step 9: Restart server
```bash
cd ~/sela/workspace/Cosmic && java -jar target/Cosmic.jar &
```
(Kill old server first if running)

### CRITICAL: Do NOT skip Step 3
Without sprite data in `npc_b64_all.json`, `master_rebuild.py` will create the .img file but with NO bitmap — the NPC will be invisible in-game. The `--only` flag generates just one NPC without regenerating all 69+.

## Correct NPC WZ XML Structure

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="{ID}.img">
  <imgdir name="info">
    <int name="speed" value="0"/>
  </imgdir>
  <imgdir name="stand">
    <canvas name="0" width="W" height="H" basedata="../../../maple-sprites/custom-npcs/{ID}/stand_0.png">
      <vector name="origin" x="HALF_W" y="H_MINUS_8"/>
      <int name="z" value="0"/>
      <int name="delay" value="200"/>
    </canvas>
  </imgdir>
</imgdir>
```

### WRONG (causes crash):
```xml
<!-- DO NOT DO THIS -->
<imgdir name="stand">
  <imgdir name="0">
    <canvas name="image" .../>  <!-- WRONG: nested imgdir + wrong canvas name -->
  </imgdir>
</imgdir>
```

## NPC Script Rules (Rhino JS Engine)

```javascript
// CORRECT: use string concatenation, not template literals
var msg = "Line 1\r\n" +
          "Line 2\r\n" +
          "Line 3";

// WRONG: bare newlines in strings crash Rhino
var msg = "Line 1
Line 2";   // <-- CRASH

// WRONG: template literals don't work in Rhino
var msg = `Line 1
Line 2`;   // <-- CRASH
```

**Script template:**
```javascript
var status = 0;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        cm.sendOk("Hello! I am #b{NPC_NAME}#k.\r\n\r\nHow can I help you?");
    }
    cm.dispose();
}
```

## String.wz Entry with Speak Lines (REQUIRED for idle chat bubbles)

Every NPC MUST have `n0`/`n1`/`n2` (normal idle), `f0`/`f1`/`f2` (finger/point), and `w0`/`w1`/`w2` (wink) speak lines.
Without these, the NPC will never show idle chat bubbles. The lines should match the NPC's personality/role.

```xml
<imgdir name="{ID}">
  <string name="name" value="{NPC_NAME}"/>
  <string name="func" value="{NPC_FUNCTION}"/>
  <string name="desc" value="{NPC_DESCRIPTION}"/>
  <!-- Normal idle lines -->
  <string name="n0" value="Hey there, adventurer!"/>
  <string name="n1" value="Looking for something?"/>
  <string name="n2" value="What brings you here?"/>
  <!-- Finger/point lines -->
  <string name="f0" value="Come closer, I can help."/>
  <string name="f1" value="Don't be shy, take a look!"/>
  <string name="f2" value="I'm {NPC_NAME}, at your service."/>
  <!-- Wink lines -->
  <string name="w0" value="Nice weather today!"/>
  <string name="w1" value="Be careful out there!"/>
  <string name="w2" value="Good luck on your journey!"/>
</imgdir>
```

**Note:** `master_rebuild.py` will auto-generate speak lines from name/func if missing, but it's better to write thematic lines yourself. If `n0` exists in the XML, the auto-generator skips that NPC.

## Map Placement Template

Add inside the `<imgdir name="life">` section of the target map:

```xml
    <imgdir name="NEXT_ENTRY_NUMBER">
      <string name="type" value="n"/>
      <string name="id" value="{NPC_ID}"/>
      <int name="x" value="X_POS"/>
      <int name="y" value="Y_POS"/>
      <int name="fh" value="FOOTHOLD_ID"/>
      <int name="cy" value="FOOTHOLD_Y"/>
      <int name="rx0" value="X_MINUS_50"/>
      <int name="rx1" value="X_PLUS_50"/>
    </imgdir>
```

**Rules:**
- Entry number must be unique within the life section
- `fh` must be a valid foothold ID from the map's foothold section
- `cy` should match the foothold's Y coordinate
- `rx0`/`rx1` define the NPC's patrol range (usually x-50 to x+50)
- The entry must be a DIRECT CHILD of `<imgdir name="life">`, never nested inside another entry

## Validation Before Saving

Before writing ANY NPC to a map, verify:

```bash
# 1. WZ XML exists
ls workspace/Cosmic/wz/Npc.wz/{ID}.img.xml

# 2. Sprite exists
ls workspace/maple-sprites/custom-npcs/{ID}/stand_0.png

# 3. Script exists
ls workspace/Cosmic/scripts/npc/{ID}.js

# 4. String entry exists (grep for the ID)
grep '{ID}' workspace/Cosmic/wz/String.wz/Npc.img.xml
```

If ANY check fails, DO NOT add the NPC to the map. Create the missing files first.
