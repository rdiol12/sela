---
name: "MapleStory Map Builder"
description: "Focused guide for creating maps in Cosmic v83. XML structure, footholds, portals, life placement."
keywords: ["map", "portal", "town", "dungeon", "field", "foothold", "background", "tile", "maple map"]
category: "gamedev"
---

# Map Builder — Cosmic v83

## HARD RULES (violating these = client crash)

1. **ALWAYS define exactly 8 layers (0-7)** as top-level children, even if empty
2. **Foothold hierarchy**: `foothold/LAYER/GROUP/FH_ID` — LAYER must match a tile layer (use 0)
3. **Disconnected platforms**: footholds must have `prev=0` and `next=0` (standalone)
4. **Set `hideMinimap=1`** for custom maps (avoids null miniMap crash)
5. **Every `<imgdir>` tag MUST be properly closed** — unclosed tags corrupt the parse tree
6. **Use real v83 assets only** — non-existent tilesets/backgrounds = crash. Verify with `search_by_name`
7. **NEVER add an NPC to life section unless `wz/Npc.wz/{ID}.img.xml` exists**
8. **Copy a working map as template** — never write map XML from scratch

## Paths

```
Server maps:     ~/sela/workspace/Cosmic/wz/Map.wz/Map/
String entries:  ~/sela/workspace/Cosmic/wz/String.wz/Map.img.xml
Custom maps:     Map9/ (990100000+, 990200000+ used)
IMG data:        ~/sela/workspace/v83-img-data/Map/
```

## Map ID Registry

```
990100000-990100600  — Sage's Spire (7 maps)
990200000-990200500  — Shadow Crypts / Necromancer (6 maps)
211090000-211090002  — Frozen Caverns (3 maps)
261090000-261090003  — Shadow Crypts (4 maps)
101050000-101050002  — Sage Hall (3 maps)
910000050            — Coliseum entrance
920000000-920000001  — Coliseum arenas
777777777            — GM map
Next available:      990300000+
```

## Available Themes

| Theme | Tileset (tS) | Background (bS) | Good for |
|-------|-------------|-----------------|----------|
| Forest | grassySoil | grassySoil | Ellinia, nature areas |
| Dark cave | darkSoil | darkCave | Dungeons, crypts |
| Snow | snowySoil | snowyLightrock | El Nath, ice areas |
| Desert | desert | nightDesert | Perion, dry areas |
| Wood | woodMarble | woodCave | Indoor, buildings |
| Stone | stoneSoil | greyBricks | Castles, structures |
| Marble | woodMarble | shineWood | Towns, clean areas |

Use `search_by_name(query: "TILESET_NAME")` to verify asset exists before using.

## Minimal Working Map Template

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="MAPID.img">
  <imgdir name="info">
    <int name="version" value="10"/>
    <int name="cloud" value="0"/>
    <int name="town" value="0"/>
    <float name="mobRate" value="1.0"/>
    <string name="bgm" value="Bgm00/FloralLife"/>
    <int name="returnMap" value="PARENT_MAP_ID"/>
    <int name="forcedReturn" value="999999999"/>
    <int name="hideMinimap" value="1"/>
    <int name="moveLimit" value="0"/>
    <string name="mapMark" value="None"/>
    <int name="fieldLimit" value="0"/>
    <int name="VRTop" value="-400"/>
    <int name="VRLeft" value="-600"/>
    <int name="VRBottom" value="400"/>
    <int name="VRRight" value="600"/>
  </imgdir>
  <imgdir name="back">
    <imgdir name="0">
      <int name="no" value="0"/>
      <int name="x" value="0"/>
      <int name="y" value="0"/>
      <int name="rx" value="0"/>
      <int name="ry" value="0"/>
      <int name="type" value="0"/>
      <int name="cx" value="0"/>
      <int name="cy" value="0"/>
      <string name="bS" value="grassySoil"/>
      <int name="front" value="0"/>
      <int name="ani" value="0"/>
      <int name="f" value="0"/>
    </imgdir>
  </imgdir>
  <!-- Layer 0: main ground tiles -->
  <imgdir name="0">
    <imgdir name="info">
      <string name="tS" value="grassySoil"/>
    </imgdir>
    <imgdir name="tile">
      <imgdir name="0">
        <int name="x" value="-300"/>
        <int name="y" value="200"/>
        <string name="u" value="bsc"/>
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
      <imgdir name="1">
        <int name="x" value="0"/>
        <int name="y" value="200"/>
        <string name="u" value="bsc"/>
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
      <imgdir name="2">
        <int name="x" value="300"/>
        <int name="y" value="200"/>
        <string name="u" value="bsc"/>
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
    </imgdir>
    <imgdir name="obj"></imgdir>
  </imgdir>
  <!-- Layers 1-7: empty but required -->
  <imgdir name="1"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="2"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="3"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="4"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="5"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="6"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="7"><imgdir name="info"></imgdir><imgdir name="tile"></imgdir><imgdir name="obj"></imgdir></imgdir>
  <imgdir name="foothold">
    <imgdir name="0">
      <imgdir name="0">
        <imgdir name="1">
          <int name="x1" value="-500"/>
          <int name="y1" value="200"/>
          <int name="x2" value="500"/>
          <int name="y2" value="200"/>
          <int name="prev" value="0"/>
          <int name="next" value="0"/>
        </imgdir>
      </imgdir>
    </imgdir>
  </imgdir>
  <imgdir name="life">
    <!-- NPCs and mobs go here -->
  </imgdir>
  <imgdir name="portal">
    <imgdir name="0">
      <string name="pn" value="sp"/>
      <int name="pt" value="0"/>
      <int name="x" value="0"/>
      <int name="y" value="200"/>
      <int name="tm" value="999999999"/>
      <string name="tn" value=""/>
    </imgdir>
    <imgdir name="1">
      <string name="pn" value="exit00"/>
      <int name="pt" value="2"/>
      <int name="x" value="-500"/>
      <int name="y" value="200"/>
      <int name="tm" value="PARENT_MAP_ID"/>
      <string name="tn" value="arrive00"/>
    </imgdir>
  </imgdir>
  <imgdir name="reactor"></imgdir>
</imgdir>
```

## Foothold Rules

```
foothold/
  LAYER/        <- must be 0-7, matching a tile layer
    GROUP/      <- grouping number (usually 0)
      FH_ID/    <- unique foothold ID (1, 2, 3...)
        x1, y1  <- start point
        x2, y2  <- end point
        prev    <- previous foothold ID in chain (0 = chain start)
        next    <- next foothold ID in chain (0 = chain end)
```

**Chaining rules:**
- Connected platforms: chain footholds with prev/next IDs
- Isolated platforms: BOTH prev=0 AND next=0
- NEVER chain footholds across separate platforms (causes teleport bugs)

## Portal Types

| pt | Type | Usage |
|----|------|-------|
| 0  | Spawn point | `pn="sp"`, `tm=999999999` — where player appears |
| 2  | Visible portal | Shows portal animation, warps on enter |
| 7  | Scripted portal | Triggers script, invisible |

**Bidirectional rule:** Every portal TO another map needs a matching portal BACK.

## Life Section Rules

```xml
<!-- NPC entry -->
<imgdir name="ENTRY_NUM">
  <string name="type" value="n"/>
  <string name="id" value="NPC_ID"/>
  <int name="x" value="X"/>
  <int name="y" value="Y"/>
  <int name="fh" value="FOOTHOLD_ID"/>
  <int name="cy" value="FOOTHOLD_Y"/>
  <int name="rx0" value="X_MINUS_50"/>
  <int name="rx1" value="X_PLUS_50"/>
</imgdir>

<!-- Mob entry -->
<imgdir name="ENTRY_NUM">
  <string name="type" value="m"/>
  <string name="id" value="MOB_ID"/>
  <int name="x" value="X"/>
  <int name="y" value="Y"/>
  <int name="fh" value="FOOTHOLD_ID"/>
  <int name="cy" value="FOOTHOLD_Y"/>
  <int name="rx0" value="PATROL_LEFT"/>
  <int name="rx1" value="PATROL_RIGHT"/>
  <int name="mobTime" value="0"/>
</imgdir>
```

**Rules:**
- Entry numbers must be unique within the life section
- Entries must be DIRECT children of `<imgdir name="life">`, never nested
- `fh` must reference a valid foothold ID
- For NPCs: verify WZ data exists before adding (see maple-npc-builder)

## String.wz Entry

Add to `wz/String.wz/Map.img.xml`:

```xml
<imgdir name="MAPID">
  <string name="streetName" value="Area Name"/>
  <string name="mapName" value="Specific Map Name"/>
</imgdir>
```

## Checklist Before Saving

- [ ] 8 layers (0-7) present
- [ ] `hideMinimap=1` set for custom maps
- [ ] All `<imgdir>` tags properly closed
- [ ] Footholds use correct hierarchy (foothold/LAYER/GROUP/ID)
- [ ] Disconnected platform footholds have prev=0, next=0
- [ ] Spawn portal (pt=0, pn="sp") exists
- [ ] Exit portal has matching return portal in parent map
- [ ] All NPC IDs in life section have existing `Npc.wz/{ID}.img.xml`
- [ ] All mob IDs in life section exist in `Mob.wz/`
- [ ] String.wz entry added
- [ ] Tileset/background names verified against v83 data
