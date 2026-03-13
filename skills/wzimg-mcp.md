---
name: "WzImg MCP (harepacker-mcp)"
description: "Guide to using the WzImg MCP server for reading, modifying, and packing MapleStory v83 WZ game data. The MCP operates on an extracted IMG filesystem."
keywords: ["wz", "wzimg", "harepacker", "mcp", "img", "npc", "mob", "sprite", "canvas", "pack", "extract", "bitmap", "v83"]
category: "gamedev"
---

# WzImg MCP (harepacker-mcp)

The WzImg MCP server gives you direct access to MapleStory v83 WZ game data in extracted IMG format.
**Data path**: `C:/Users/rdiol/sela/workspace/v83-img-data` (auto-initialized via WZIMGMCP_DATA_PATH env var).

## Key Concepts

- **Categories**: Top-level folders: Npc, Mob, Map, Skill, String, Character, Item, Etc, UI, Effect, etc.
- **Images**: `.img` files within categories (e.g., `Npc/9999001.img`, `String/Npc.img`)
- **Properties**: Nested tree inside each image — sub-properties, ints, strings, vectors, canvases
- **Canvas**: A bitmap image (sprite frame) with optional origin, delay, and child properties
- **Parsing**: Images must be parsed before reading/modifying properties. MCP auto-parses on access.

## Workflow: Creating/Modifying Game Content

### 1. Browse & Research
```
init_data_source(basePath: "C:/Users/rdiol/sela/workspace/v83-img-data")
list_categories()
list_images_in_category(category: "Npc")
search_by_name(category: "Npc", query: "9999*")
batch_search(pattern: "9999*", categories: "Npc,String")
```

### 2. Read Existing Data
```
parse_image(category: "Npc", image: "1012000.img")
get_tree_structure(category: "Npc", image: "1012000.img")
get_property(category: "Npc", image: "1012000.img", path: "stand/0")
get_canvas_info(category: "Npc", image: "1012000.img", path: "stand/0")
get_canvas_bitmap(category: "Npc", image: "1012000.img", path: "stand/0")  # returns base64 PNG
get_int(category: "Npc", image: "1012000.img", path: "info/face")
get_string(category: "String", image: "Npc.img", path: "1012000/name")
```

### 3. Modify Data
```
# Replace a canvas bitmap (existing canvas must exist at path)
set_canvas_bitmap(category: "Npc", image: "9999001.img", path: "stand/0", base64Png: "<base64>")

# Import a new canvas into a parent property
import_png(category: "Npc", image: "9999001.img", parentPath: "stand", name: "0", base64Png: "<base64>", originX: 40, originY: 92)

# Set property values
set_int(category: "Npc", image: "9999001.img", path: "info/face", value: 0)
set_string(category: "String", image: "Npc.img", path: "9999001/name", value: "Blacksmith Taro")
set_vector(category: "Npc", image: "9999001.img", path: "stand/0/origin", x: 40, y: 92)

# Add new properties
add_property(category: "Npc", image: "9999001.img", parentPath: "", name: "info", type: "sub")
add_property(category: "Npc", image: "9999001.img", parentPath: "info", name: "face", type: "int", value: 0)
add_property(category: "String", image: "Npc.img", parentPath: "", name: "9999001", type: "sub")

# Delete properties
delete_property(category: "Npc", image: "9999001.img", path: "stand/1")
```

### 4. Save Changes
```
save_image(category: "Npc", image: "9999001.img")   # saves .img file to disk
save_image(category: "String", image: "Npc.img")
```

### 5. Pack to WZ Binary
```
# Pack a single category
pack_to_wz(imgPath: "C:/Users/rdiol/sela/workspace/v83-img-data", outputDir: "C:/Users/rdiol/sela/workspace/v83-client-patched", category: "Npc")

# Pack all categories
pack_to_wz(imgPath: "C:/Users/rdiol/sela/workspace/v83-img-data", outputDir: "C:/Users/rdiol/sela/workspace/v83-client-patched")
```

## Important Rules

1. **Always save_image after modifications** — changes are in-memory until saved
2. **Canvas base64**: `set_canvas_bitmap` and `import_png` accept base64-encoded PNG data (no file paths)
3. **Clone approach for new NPCs**: To add a new NPC, copy an existing vanilla `.img` file (e.g., `1012000.img`) as the new ID, then modify canvases via MCP. Creating from scratch can crash the v83 client.
4. **String.wz entries required**: Every NPC/Mob/Map must have a name entry in `String/Npc.img` (or Mob.img, Map.img) or the client may crash.
5. **v83 canvas formats**: Only BGRA4444 (Format1) and BGRA8888 (Format2) are safe. The MCP handles format conversion automatically when you set a bitmap.
6. **Pack output goes to**: `C:/Users/rdiol/sela/workspace/v83-client-patched/` — this is served by the patch server.

## Patcher Pipeline

After packing WZ files:
1. Files land in `C:/Users/rdiol/sela/workspace/v83-client-patched/`
2. Patch server (PM2: "patch-server") serves them from that directory
3. Client auto-patches on launch via manifest at version 89
4. To regenerate manifest: `node server/gen-manifest.js` in `~/sela/workspace/maple-patcher/`

## Custom NPC IDs

All custom NPCs use IDs `9999001`-`9999055`. Their `.img` files are vanilla clones of `1012000.img` in `v83-img-data/Npc/`. Sprites are in `workspace/Cosmic/maple-sprites/custom-npcs/{npcId}/stand_0.png`, `stand_1.png`.

To patch a custom NPC with its real sprite:
1. `parse_image(category: "Npc", image: "9999001.img")`
2. `set_canvas_bitmap(category: "Npc", image: "9999001.img", path: "stand/0", base64Png: "<base64 of stand_0.png>")`
3. `set_canvas_bitmap(category: "Npc", image: "9999001.img", path: "stand/1", base64Png: "<base64 of stand_1.png>")`
4. `save_image(category: "Npc", image: "9999001.img")`
5. `pack_to_wz(imgPath: "C:/Users/rdiol/sela/workspace/v83-img-data", outputDir: "C:/Users/rdiol/sela/workspace/v83-client-patched", category: "Npc")`

## LoRA Sprite Generation

Use `maple_generate_sprite` tool to generate new sprites via the trained LoRA model (epoch 3):
- Params: `type` (npc/mob/item), `id`, `description`, `poses`, `width`, `height`
- Output: PNGs in `workspace/Cosmic/maple-sprites/custom-{type}s/{id}/`
- Then use `set_canvas_bitmap` to inject into WZ data
