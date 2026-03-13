---
name: "MapleStory Map Building"
description: "Complete guide to building MapleStory maps with real visuals — backgrounds, tiles, objects. Uses harepacker-mcp to browse v83 assets."
keywords: ["maplestory", "maple", "map", "מפה", "מייפל", "tileset", "background", "wz", "harepacker", "create map", "new map", "build map", "level design"]
category: "gamedev"
---

# MapleStory Map Building — Complete Guide

How to create a REAL map with visuals, not just empty XML with coordinates.

## What Makes a Map Look Real

A blank XML with just footholds and portals renders as a **black void with invisible platforms**. A real map needs:

1. **Backgrounds** (`back` section) — sky, scenery, parallax layers
2. **Tiles** (`tile` in each layer) — ground, walls, edges that players walk on
3. **Objects** (`obj` in each layer) — trees, houses, signs, decorations
4. **Footholds** — collision lines players walk on (you already do this)
5. **Portals** — map connections (you already do this)
6. **Life** — NPCs and mob spawns (you already do this)

## Available Assets (v83)

You have 107 backgrounds, 102 tilesets, and 107 object sets. Use **harepacker-mcp** to browse them.

### Browse Assets with harepacker-mcp

```
# Initialize data source (do this first)
init_data_source(basePath: "C:/Users/rdiol/sela/workspace/v83-img-data")

# List available background sets
list_images_in_category(category: "Map", subdirectory: "Back")

# Browse a specific background (e.g. shineWood = Ellinia forest)
list_properties(category: "Map", image: "Back/shineWood.img")

# Preview a background image
get_canvas_bitmap(category: "Map", image: "Back/shineWood.img", path: "0")

# List tileset contents
list_properties(category: "Map", image: "Tile/grassySoil.img")

# Browse object set
list_properties(category: "Map", image: "Obj/houseSW.img")

# Preview an object
get_canvas_bitmap(category: "Map", image: "Obj/houseSW.img", path: "house11/basic/0/0")
```

### Common Theme Combos

| Theme | Background (bS) | Tileset (tS) | Objects (oS) |
|---|---|---|---|
| Ellinia Forest | shineWood | woodBridge, wetWood | houseSW, houseEL |
| Henesys Fields | grassySoil | grassySoil | houseGS, signboard |
| Kerning City | metroCity | graySubway | houseMC, shop |
| Perion Desert | dryRock | dryRock | houseDR, signboard |
| Sleepywood Cave | darkCave | darkCave | dungeon, dungeon2 |
| Ludi Tower | grayBrickTower | grayBrick1 | tower, houseTC |
| Aqua Road | aquaRoad | sandySeaFloor | acc5, acc6 |
| Leafre | dragonValley | dragonRoad | houseLF |
| El Nath Snow | snowyLightrock | snowyLightrock | houseSLR |
| Mu Lung | mureung | mureung | houseMR |
| Omega Sector | omegaSector | omegaSectorField | houseOS |
| Haunted | halloween | halloween1 | halloween |
| Toy Castle | toyCastle | blueToyCastle | houseTC |
| Ancient Forest | ancientForest | ancientForest | acc10 |
| Dungeon Dark | darkWood | darkWood | dungeon |

## Map XML Structure — Complete

Here's the anatomy of a real map. Every section matters.

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<imgdir name="MAPID.img">

  <!-- MAP INFO -->
  <imgdir name="info">
    <string name="bgm" value="Bgm02/WhenTheMorningComes"/>
    <int name="returnMap" value="101000000"/>
    <int name="forcedReturn" value="999999999"/>
    <int name="fieldLimit" value="0"/>
    <float name="mobRate" value="1.0"/>
    <string name="mapMark" value="Ellinia"/>
    <int name="town" value="0"/>
    <!-- Viewport bounds -->
    <int name="VRTop" value="-400"/>
    <int name="VRBottom" value="600"/>
    <int name="VRLeft" value="-1200"/>
    <int name="VRRight" value="1200"/>
  </imgdir>

  <!-- BACKGROUNDS — parallax layers behind everything -->
  <imgdir name="back">
    <!-- Layer 0: far sky/gradient (type 3 = tiled both, type 2 = tiled horizontal) -->
    <imgdir name="0">
      <int name="x" value="0"/>
      <int name="y" value="0"/>
      <int name="rx" value="0"/>        <!-- parallax X speed (0=fixed, negative=slow) -->
      <int name="ry" value="0"/>        <!-- parallax Y speed -->
      <int name="cx" value="0"/>        <!-- tile spacing X (0=auto) -->
      <int name="cy" value="0"/>        <!-- tile spacing Y (0=auto) -->
      <int name="a" value="255"/>       <!-- alpha (0-255) -->
      <int name="type" value="3"/>      <!-- 0=normal,1=htile,2=vtile,3=hvtile,4=htile+scroll,5=vtile+scroll,6=hvtile+scroll -->
      <int name="front" value="0"/>     <!-- 0=behind tiles, 1=in front -->
      <int name="f" value="0"/>         <!-- flip horizontal -->
      <string name="bS" value="shineWood"/>  <!-- background set name (from Map/Back/) -->
      <int name="ani" value="0"/>       <!-- 0=static image, 1=animated -->
      <int name="no" value="0"/>        <!-- image index within the bS set -->
    </imgdir>
    <!-- Layer 1: trees/mid-ground (slower parallax) -->
    <imgdir name="1">
      <int name="x" value="0"/>
      <int name="y" value="-50"/>
      <int name="rx" value="-3"/>
      <int name="ry" value="-10"/>
      <int name="cx" value="0"/>
      <int name="cy" value="0"/>
      <int name="a" value="255"/>
      <int name="type" value="2"/>
      <int name="front" value="0"/>
      <int name="f" value="0"/>
      <string name="bS" value="shineWood"/>
      <int name="ani" value="0"/>
      <int name="no" value="1"/>
    </imgdir>
  </imgdir>

  <!-- LAYER 0 — each layer has its own tileset, tiles, and objects -->
  <imgdir name="0">
    <imgdir name="info">
      <string name="tS" value="grassySoil"/>  <!-- tileset for this layer (from Map/Tile/) -->
    </imgdir>
    <imgdir name="tile">
      <!-- Tiles snap to a grid. u = tile piece type, no = variant index -->
      <!-- Tile types: edU (edge up), edD (edge down), edL (edge left), edR (edge right) -->
      <!--            slLU (slope left-up), slRU (slope right-up), slLD, slRD -->
      <!--            bsc (basic ground fill), enH0/enH1 (horizontal end caps) -->
      <imgdir name="0">
        <int name="x" value="-600"/>
        <int name="y" value="200"/>
        <string name="u" value="enH0"/>    <!-- left end cap -->
        <int name="no" value="0"/>          <!-- variant number -->
        <int name="zM" value="0"/>          <!-- z-layer within this layer -->
      </imgdir>
      <imgdir name="1">
        <int name="x" value="-570"/>
        <int name="y" value="200"/>
        <string name="u" value="bsc"/>     <!-- basic ground fill -->
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
      <imgdir name="2">
        <int name="x" value="-540"/>
        <int name="y" value="200"/>
        <string name="u" value="bsc"/>
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
      <!-- ... repeat bsc tiles across the platform ... -->
      <imgdir name="N">
        <int name="x" value="600"/>
        <int name="y" value="200"/>
        <string name="u" value="enH1"/>    <!-- right end cap -->
        <int name="no" value="0"/>
        <int name="zM" value="0"/>
      </imgdir>
    </imgdir>
    <imgdir name="obj">
      <!-- Objects are decorative sprites from Map/Obj/{oS}.img -->
      <imgdir name="0">
        <int name="x" value="-200"/>
        <int name="y" value="200"/>       <!-- y = ground level the object sits on -->
        <int name="z" value="0"/>
        <int name="zM" value="0"/>
        <string name="oS" value="houseSW"/>      <!-- object set (from Map/Obj/) -->
        <string name="l0" value="house11"/>       <!-- category within set -->
        <string name="l1" value="basic"/>         <!-- sub-category -->
        <string name="l2" value="0"/>             <!-- specific object index -->
        <int name="f" value="0"/>                 <!-- flip horizontal -->
      </imgdir>
    </imgdir>
  </imgdir>

  <!-- FOOTHOLDS — collision lines players walk on -->
  <imgdir name="foothold">
    <imgdir name="0">        <!-- foothold group (usually matches layer) -->
      <imgdir name="0">      <!-- foothold chain -->
        <imgdir name="0">    <!-- individual segment -->
          <int name="x1" value="-600"/>
          <int name="y1" value="200"/>
          <int name="x2" value="600"/>
          <int name="y2" value="200"/>
          <int name="prev" value="0"/>
          <int name="next" value="0"/>
        </imgdir>
      </imgdir>
    </imgdir>
  </imgdir>

  <!-- LIFE — NPCs and Mobs -->
  <imgdir name="life">
    <imgdir name="0">
      <string name="type" value="n"/>      <!-- n=NPC, m=mob -->
      <string name="id" value="9999001"/>  <!-- NPC/mob ID -->
      <int name="x" value="0"/>
      <int name="y" value="200"/>
      <int name="fh" value="0"/>           <!-- foothold ID it stands on -->
      <int name="cy" value="200"/>
      <int name="rx0" value="-50"/>        <!-- patrol range left -->
      <int name="rx1" value="50"/>         <!-- patrol range right -->
    </imgdir>
  </imgdir>

  <!-- PORTALS -->
  <imgdir name="portal">
    <imgdir name="0">
      <string name="pn" value="sp"/>       <!-- sp = spawn point -->
      <int name="pt" value="0"/>            <!-- 0=spawn, 2=visible portal -->
      <int name="x" value="0"/>
      <int name="y" value="200"/>
      <int name="tm" value="999999999"/>
      <string name="tn" value=""/>
    </imgdir>
  </imgdir>

  <!-- REACTOR (optional, for interactive objects) -->
  <imgdir name="reactor"/>
</imgdir>
```

## Tile Types Reference

The `u` value in tiles determines which piece of the tileset to draw:

| u value | Meaning | Use for |
|---|---|---|
| `bsc` | Basic fill | Main ground surface (repeat across platform) |
| `edU` | Edge Up | Top edge of a platform |
| `edD` | Edge Down | Bottom/underside of a platform |
| `edL` | Edge Left | Left wall |
| `edR` | Edge Right | Right wall |
| `enH0` | End cap left | Left end of a horizontal platform |
| `enH1` | End cap right | Right end of a horizontal platform |
| `enV0` | End cap top | Top of a vertical wall |
| `enV1` | End cap bottom | Bottom of a vertical wall |
| `slLU` | Slope left-up | Slope going up to the left |
| `slRU` | Slope right-up | Slope going up to the right |
| `slLD` | Slope left-down | Slope going down to the left |
| `slRD` | Slope right-down | Slope going down to the right |

Tile `no` is the variant index (0, 1, 2...) within that type — use harepacker-mcp to see how many variants exist.

Tile spacing is typically 30px per tile unit. Standard ground at y=200, platforms at higher y values (lower y = higher on screen).

## Background Types Reference

The `type` value controls scrolling behavior:

| type | Name | Behavior |
|---|---|---|
| 0 | Normal | Fixed position, no tiling |
| 1 | Horizontal tile | Tiles horizontally |
| 2 | Vertical tile | Tiles vertically |
| 3 | Both tile | Tiles both directions (use for sky fills) |
| 4 | Horizontal scroll | Scrolls horizontally (clouds, etc) |
| 5 | Vertical scroll | Scrolls vertically |
| 6 | Both scroll | Scrolls both directions |

`rx`/`ry` = parallax speed. 0 = moves with camera. Negative = moves slower (farther away feel). -10 is typical for mid-ground.

## Step-by-Step: Build a Complete Map

### 1. Pick a theme
Decide what the map should look like. Use the theme combos table above, or browse assets with harepacker-mcp.

### 2. Browse assets to find specific pieces
```
# Preview background options
get_canvas_bitmap(category: "Map", image: "Back/shineWood.img", path: "0")
get_canvas_bitmap(category: "Map", image: "Back/shineWood.img", path: "1")

# Preview tileset pieces
get_tree_structure(category: "Map", image: "Tile/grassySoil.img", depth: 2)
get_canvas_bitmap(category: "Map", image: "Tile/grassySoil.img", path: "bsc/0")
get_canvas_bitmap(category: "Map", image: "Tile/grassySoil.img", path: "edU/0")

# Preview objects
get_tree_structure(category: "Map", image: "Obj/houseSW.img", depth: 2)
get_canvas_bitmap(category: "Map", image: "Obj/houseSW.img", path: "house11/basic/0/0")
```

### 3. Design the layout
Plan platforms, heights, and connections on paper:
- Ground level: y=200 typically
- Upper platforms: y=0, y=-200, etc (lower y = higher)
- Map width: -600 to 600 for small, -1200 to 1200 for medium, -2000 to 2000 for large

### 4. Write the complete XML
Use the full template above. MUST include:
- `back` section with at least 2 background layers (sky + mid-ground)
- At least one layer with `info/tS`, `tile` entries, and `obj` entries
- `foothold` matching every walkable surface
- `portal` with at least one spawn point (pt=0)
- `info` with VR bounds that cover the entire map area

### 5. Register the map name
Add entry to `String.wz/Map.img.xml`:
```xml
<imgdir name="MAPID">
  <string name="streetName" value="Sage Hall"/>
  <string name="mapName" value="Training Grounds"/>
</imgdir>
```

### 6. Restart server
The Cosmic server reads WZ XML on startup. Restart to load the new map.

## Common Mistakes to Avoid

- **No back section** = black void background (what you did before)
- **No tiles** = invisible ground (players walk on nothing)
- **No objects** = empty barren look
- **VR bounds too small** = camera clips, can't see edges of map
- **Footholds don't match tile positions** = players fall through visible ground
- **Wrong tS/bS/oS names** = missing textures (check exact names with harepacker-mcp)
- **Tiles not aligned** = gaps in ground, ugly seams

## Using harepacker-mcp to Copy from Existing Maps

The easiest way to build a good map: clone parts from a real map.

```
# Load a real map to study its structure
init_data_source(basePath: "C:/Users/rdiol/sela/workspace/v83-img-data")

# See the full structure of Ellinia town
get_tree_structure(category: "Map", image: "Map/Map1/101000000.img", depth: 3)

# Get the back section to copy its background setup
list_properties(category: "Map", image: "Map/Map1/101000000.img", path: "back")

# Get layer 0 tiles
list_properties(category: "Map", image: "Map/Map1/101000000.img", path: "0/tile")

# Get layer 0 objects
list_properties(category: "Map", image: "Map/Map1/101000000.img", path: "0/obj")
```

Then adapt positions and IDs for your custom map.

## MANDATORY: Design Before Implementation

**NEVER start writing map XML without a design document first.** Before touching any XML:

1. **Write a brief** (2-3 sentences): What is this map? What's its purpose? (town, training, boss, quest area?)
2. **Pick visual theme**: Which bS/tS/oS sets? Browse with harepacker-mcp to preview.
3. **Sketch layout**: List all platforms with x-ranges and y-heights. Where are portals? Where do mobs spawn?
4. **List assets needed**: Existing v83 assets? Or custom sprites needed?
5. **Only then** write the XML.

Post the design brief in WhatsApp before building so Ron can approve it.

## Creating Custom Map Assets (New Sprites)

When existing v83 assets aren't enough, generate new ones:

### Generate with PixelLab (remote API)
```
# Side-scroller tileset (ground + transition)
maple_create_sidescroll_tileset({ lower: "mossy stone bricks", transition: "crystal growth" })

# Map decoration objects
maple_create_map_object({ description: "glowing crystal formation, blue, magical" })
maple_create_map_object({ description: "ancient stone pillar with runes" })

# Full character/NPC
maple_create_character({ description: "old sage with long beard and staff", n_directions: 4 })
```

### Generate with ComfyUI (local GPU, free)
```
# Monster sprites
maple_gen_monster({ name: "crystal golem, large, glowing blue eyes" })

# NPC sprites
maple_gen_npc({ name: "Sage Elder", description: "old wizard with white beard and wooden staff" })

# Item icons
maple_gen_item({ name: "crystal shard, magical blue gem" })
```

### Import Generated Assets into WZ
After generating PNGs, import them so map XML can reference them:

```
# Import a custom background
maple_import_map_asset({
  assetType: "back",
  setName: "sageForest",      # creates Map/Back/sageForest.img
  subPath: "0",                # background image index
  pngPath: "/absolute/path/to/sky_background.png"
})

# Import a custom tileset piece
maple_import_map_asset({
  assetType: "tile",
  setName: "sageStone",       # creates Map/Tile/sageStone.img
  subPath: "bsc/0",           # basic ground fill, variant 0
  pngPath: "/absolute/path/to/ground_tile.png"
})
maple_import_map_asset({
  assetType: "tile",
  setName: "sageStone",
  subPath: "enH0/0",          # left end cap
  pngPath: "/absolute/path/to/ground_left_cap.png"
})
maple_import_map_asset({
  assetType: "tile",
  setName: "sageStone",
  subPath: "enH1/0",          # right end cap
  pngPath: "/absolute/path/to/ground_right_cap.png"
})

# Import a custom object
maple_import_map_asset({
  assetType: "obj",
  setName: "sageDecor",       # creates Map/Obj/sageDecor.img
  subPath: "crystal/big/0/0", # category/subcategory/variant/frame
  pngPath: "/absolute/path/to/crystal.png"
})
```

Then reference in map XML:
```xml
<string name="bS" value="sageForest"/>   <!-- in back section -->
<string name="tS" value="sageStone"/>    <!-- in layer info -->
<string name="oS" value="sageDecor"/>    <!-- in obj section -->
```

### Full Custom Map Pipeline
1. **Design** the map (brief + layout + asset list)
2. **Generate** custom sprites with PixelLab/ComfyUI
3. **Import** PNGs into WZ with `maple_import_map_asset`
4. **Build** the map XML referencing custom + existing assets
5. **Register** map name in String.wz
6. **Restart** server
