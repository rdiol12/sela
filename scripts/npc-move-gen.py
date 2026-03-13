#!/usr/bin/env python3
"""
Generate NPC move animations with clear vertical bobbing.
3 frames: neutral → up 4px → up 2px (creates a bouncy loop)
"""
import subprocess
import sys
import os
import json
from PIL import Image, ImageFilter

DESKTOP = os.path.expanduser("~/Desktop")
NPC_DIR = os.path.join(DESKTOP, "cosmic-wz-patched", "Npc")
OUT_DIR = os.path.join(DESKTOP, "npc-move-frames")
os.makedirs(OUT_DIR, exist_ok=True)

# All custom NPCs
NPC_LIST = [
    9999001,9999002,9999003,9999004,9999005,9999006,9999007,9999008,9999009,9999010,
    9999011,9999012,9999013,9999020,9999021,9999030,9999031,9999032,9999033,9999034,
    9999035,9999036,9999037,9999038,9999039,9999040,9999041,9999042,9999043,9999044,
    9999045,9999046,9999047,9999050,9999051,9999052,9999053,9999054,9999055,9999060,
    9999061,9999063,
]

def create_move_frames(stand_path, npc_id):
    """Create 3 move frames from stand sprite with clear bobbing."""
    img = Image.open(stand_path).convert("RGBA")
    w, h = img.size

    # Add padding to allow bob movement (8px top + 4px bottom)
    PAD_TOP = 8
    PAD_BOT = 4
    canvas_h = h + PAD_TOP + PAD_BOT

    frames = []

    # Frame 0: neutral (centered in canvas)
    f0 = Image.new("RGBA", (w, canvas_h), (0, 0, 0, 0))
    f0.paste(img, (0, PAD_TOP))
    frames.append(f0)

    # Frame 1: bob UP 4px (sprite moves up, gap at bottom)
    f1 = Image.new("RGBA", (w, canvas_h), (0, 0, 0, 0))
    f1.paste(img, (0, PAD_TOP - 4))
    # Slight squash at top — stretch bottom 2px to simulate squash
    frames.append(f1)

    # Frame 2: bob UP 2px (halfway back — easing effect)
    f2 = Image.new("RGBA", (w, canvas_h), (0, 0, 0, 0))
    f2.paste(img, (0, PAD_TOP - 2))
    frames.append(f2)

    paths = []
    for i, frame in enumerate(frames):
        out_path = os.path.join(OUT_DIR, f"npc_{npc_id}_move{i}.png")
        frame.save(out_path)
        paths.append(out_path)
        print(f"  ✓ move{i} → {os.path.basename(out_path)} ({w}x{canvas_h})")

    return paths, (w, canvas_h)

def main():
    print(f"Processing {len(NPC_LIST)} NPCs...")
    results = {}

    for npc_id in NPC_LIST:
        img_file = os.path.join(NPC_DIR, f"{npc_id}.img")
        if not os.path.exists(img_file):
            print(f"[SKIP] {npc_id}.img not found")
            continue

        # Export stand frame via harepacker MCP (already initialized)
        # We'll use the already-exported stand frame if available,
        # or call the MCP export via node
        stand_path = os.path.join(DESKTOP, f"npc_stand_{npc_id}.png")

        # Export via harepacker MCP node script
        result = subprocess.run([
            "node", "--input-type=module", "-e",
            f"""
import {{ callTool }} from '/c/Users/rdiol/sela/lib/mcp-gateway.js';
const r = await callTool('harepacker-mcp', 'export_png', {{
  category: 'npc', image: '{npc_id}', path: 'stand/0',
  outputPath: String.raw`{stand_path}`
}});
console.log(JSON.stringify(r));
"""
        ], capture_output=True, text=True, cwd="/c/Users/rdiol/sela", timeout=30)

        if not os.path.exists(stand_path):
            print(f"[FAIL] {npc_id}: could not export stand frame")
            print(f"  stderr: {result.stderr[:200]}")
            continue

        print(f"\n[{npc_id}]")
        paths, size = create_move_frames(stand_path, npc_id)
        results[npc_id] = {"paths": paths, "size": list(size)}

        # Cleanup stand temp
        os.remove(stand_path)

    # Save results manifest
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n✅ Done! {len(results)}/{len(NPC_LIST)} NPCs processed")
    print(f"Frames at: {OUT_DIR}")
    print(f"Manifest: {manifest_path}")

if __name__ == "__main__":
    main()
