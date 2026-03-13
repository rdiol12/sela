/**
 * modules/asset-pipeline/region-materials.js — Master PBR Material Library per Region.
 *
 * ms_6: Defines 20+ universal materials + region-specific kits following
 * visual-style-guide.md §10.3. Each material has full PBR parameters:
 * baseColor, roughness, metallic, bumpStrength, noiseScale, emission.
 *
 * Used by pipeline.js buildAssetCode() to select region-appropriate materials
 * instead of generic type-based fallbacks.
 */

import { createLogger } from '../../lib/logger.js';

const log = createLogger('region-materials');

// ── Hex → [r, g, b] float conversion ─────────────────────────────────────────

function hexToFloat(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

// ── Universal Material Kit (shared across all regions) ────────────────────────
// From visual-style-guide.md §10.3: "Universal Kit (shared)"

export const UNIVERSAL_MATERIALS = {
  // Stone_Cobble — 3 variants
  Stone_Cobble_Clean: {
    name: 'Stone_Cobble_Clean',
    baseColor: hexToFloat('#8A8A7A'),
    roughness: 0.75, metallic: 0.0,
    bumpStrength: 0.35, noiseScale: 10.0,
    category: 'stone',
  },
  Stone_Cobble_Mossy: {
    name: 'Stone_Cobble_Mossy',
    baseColor: hexToFloat('#6A7A5A'),
    roughness: 0.85, metallic: 0.0,
    bumpStrength: 0.4, noiseScale: 8.0,
    category: 'stone',
  },
  Stone_Cobble_Cracked: {
    name: 'Stone_Cobble_Cracked',
    baseColor: hexToFloat('#7A7A6A'),
    roughness: 0.8, metallic: 0.0,
    bumpStrength: 0.5, noiseScale: 12.0,
    category: 'stone',
  },

  // Wood_Structural — 2 variants
  Wood_Oak: {
    name: 'Wood_Oak',
    baseColor: hexToFloat('#5A3A20'),
    roughness: 0.7, metallic: 0.0,
    bumpStrength: 0.3, noiseScale: 15.0,
    category: 'wood',
  },
  Wood_Birch: {
    name: 'Wood_Birch',
    baseColor: hexToFloat('#C8B89A'),
    roughness: 0.65, metallic: 0.0,
    bumpStrength: 0.25, noiseScale: 18.0,
    category: 'wood',
  },

  // Metal_Iron — 3 variants
  Metal_Iron_Forged: {
    name: 'Metal_Iron_Forged',
    baseColor: hexToFloat('#3A3A3A'),
    roughness: 0.35, metallic: 0.9,
    bumpStrength: 0.2, noiseScale: 6.0,
    category: 'metal',
  },
  Metal_Iron_Rusted: {
    name: 'Metal_Iron_Rusted',
    baseColor: hexToFloat('#6A3A1A'),
    roughness: 0.75, metallic: 0.5,
    bumpStrength: 0.45, noiseScale: 8.0,
    category: 'metal',
  },
  Metal_Iron_Corroded: {
    name: 'Metal_Iron_Corroded',
    baseColor: hexToFloat('#4A3A2A'),
    roughness: 0.85, metallic: 0.3,
    bumpStrength: 0.5, noiseScale: 10.0,
    category: 'metal',
  },

  // Fabric_Banner
  Fabric_Banner: {
    name: 'Fabric_Banner',
    baseColor: hexToFloat('#8A2020'),
    roughness: 0.9, metallic: 0.0,
    bumpStrength: 0.15, noiseScale: 20.0,
    category: 'fabric',
  },

  // Water_Surface
  Water_Surface: {
    name: 'Water_Surface',
    baseColor: hexToFloat('#1A4A6A'),
    roughness: 0.05, metallic: 0.0,
    bumpStrength: 0.1, noiseScale: 4.0,
    emission: { color: hexToFloat('#1A3A5A'), strength: 0.3 },
    category: 'water',
    special: { transmission: 0.6, ior: 1.33 },
  },
};

// ── Region-Specific Material Kits ─────────────────────────────────────────────
// From visual-style-guide.md §10.3 + §3 (Regional Color Specifications)

export const REGION_MATERIALS = {
  CrossroadsHub: {
    defaults: { roughness: 0.7, metallic: 0.0, bumpStrength: 0.3, noiseScale: 8.0 },
    materials: {
      Cobblestone_Warm: {
        name: 'Cobblestone_Warm', baseColor: hexToFloat('#D4A574'),
        roughness: 0.75, metallic: 0.0, bumpStrength: 0.35, noiseScale: 10.0,
        category: 'stone',
      },
      Worn_Wood: {
        name: 'Worn_Wood', baseColor: hexToFloat('#8B6F47'),
        roughness: 0.72, metallic: 0.0, bumpStrength: 0.3, noiseScale: 14.0,
        category: 'wood',
      },
      Canvas_Tent: {
        name: 'Canvas_Tent', baseColor: hexToFloat('#E8C07A'),
        roughness: 0.88, metallic: 0.0, bumpStrength: 0.12, noiseScale: 22.0,
        category: 'fabric',
      },
      Warm_Lantern_Glow: {
        name: 'Warm_Lantern_Glow', baseColor: hexToFloat('#FFD08A'),
        roughness: 0.3, metallic: 0.1,  bumpStrength: 0.1, noiseScale: 5.0,
        emission: { color: hexToFloat('#FFA040'), strength: 8.0 },
        category: 'emissive',
      },
      Market_Stall_Wood: {
        name: 'Market_Stall_Wood', baseColor: hexToFloat('#5C4A32'),
        roughness: 0.68, metallic: 0.0, bumpStrength: 0.28, noiseScale: 16.0,
        category: 'wood',
      },
    },
  },

  AshenWilds: {
    defaults: { roughness: 0.8, metallic: 0.0, bumpStrength: 0.4, noiseScale: 7.0 },
    materials: {
      Scorched_Bark: {
        name: 'Scorched_Bark', baseColor: hexToFloat('#2A3A2A'),
        roughness: 0.88, metallic: 0.0, bumpStrength: 0.55, noiseScale: 9.0,
        category: 'organic',
      },
      Ash_Stone: {
        name: 'Ash_Stone', baseColor: hexToFloat('#7A7A6A'),
        roughness: 0.8, metallic: 0.0, bumpStrength: 0.4, noiseScale: 8.0,
        category: 'stone',
      },
      Damp_Moss: {
        name: 'Damp_Moss', baseColor: hexToFloat('#4A5A4A'),
        roughness: 0.9, metallic: 0.0, bumpStrength: 0.35, noiseScale: 12.0,
        category: 'organic',
      },
      Ember_Glow: {
        name: 'Ember_Glow', baseColor: hexToFloat('#B8A060'),
        roughness: 0.3, metallic: 0.0, bumpStrength: 0.15, noiseScale: 5.0,
        emission: { color: hexToFloat('#FF6B2B'), strength: 4.0 },
        category: 'emissive',
      },
      Rusted_Iron_Wilds: {
        name: 'Rusted_Iron_Wilds', baseColor: hexToFloat('#5A3A1A'),
        roughness: 0.8, metallic: 0.4, bumpStrength: 0.45, noiseScale: 7.0,
        category: 'metal',
      },
    },
  },

  Ironhold: {
    defaults: { roughness: 0.4, metallic: 0.6, bumpStrength: 0.2, noiseScale: 6.0 },
    materials: {
      Metal_Steel_Polished: {
        name: 'Metal_Steel_Polished', baseColor: hexToFloat('#8A9AAA'),
        roughness: 0.15, metallic: 0.95, bumpStrength: 0.1, noiseScale: 4.0,
        category: 'metal',
      },
      Stone_Cut_Military: {
        name: 'Stone_Cut_Military', baseColor: hexToFloat('#4A6080'),
        roughness: 0.55, metallic: 0.0, bumpStrength: 0.25, noiseScale: 8.0,
        category: 'stone',
      },
      Polished_Brass: {
        name: 'Polished_Brass', baseColor: hexToFloat('#E0C060'),
        roughness: 0.2, metallic: 0.9, bumpStrength: 0.08, noiseScale: 3.0,
        category: 'metal',
      },
      Thick_Wool_Banner: {
        name: 'Thick_Wool_Banner', baseColor: hexToFloat('#1A2A3A'),
        roughness: 0.92, metallic: 0.0, bumpStrength: 0.18, noiseScale: 25.0,
        category: 'fabric',
      },
      Shield_Wall_Glow: {
        name: 'Shield_Wall_Glow', baseColor: hexToFloat('#60A0D0'),
        roughness: 0.1, metallic: 0.7, bumpStrength: 0.05, noiseScale: 3.0,
        emission: { color: hexToFloat('#60A0D0'), strength: 6.0 },
        category: 'emissive',
      },
    },
  },

  VerdantReach: {
    defaults: { roughness: 0.85, metallic: 0.0, bumpStrength: 0.5, noiseScale: 10.0 },
    materials: {
      Bark_Living: {
        name: 'Bark_Living', baseColor: hexToFloat('#3A5A2A'),
        roughness: 0.82, metallic: 0.0, bumpStrength: 0.55, noiseScale: 9.0,
        category: 'organic',
      },
      Moss_Thick: {
        name: 'Moss_Thick', baseColor: hexToFloat('#2A8040'),
        roughness: 0.95, metallic: 0.0, bumpStrength: 0.4, noiseScale: 14.0,
        category: 'organic',
      },
      Flower_Bed: {
        name: 'Flower_Bed', baseColor: hexToFloat('#90C060'),
        roughness: 0.88, metallic: 0.0, bumpStrength: 0.3, noiseScale: 16.0,
        category: 'organic',
      },
      Wet_Stone_Verdant: {
        name: 'Wet_Stone_Verdant', baseColor: hexToFloat('#4A6A4A'),
        roughness: 0.45, metallic: 0.0, bumpStrength: 0.35, noiseScale: 8.0,
        category: 'stone',
      },
      Vine_Glow: {
        name: 'Vine_Glow', baseColor: hexToFloat('#40D060'),
        roughness: 0.3, metallic: 0.0, bumpStrength: 0.1, noiseScale: 5.0,
        emission: { color: hexToFloat('#40D060'), strength: 5.0 },
        category: 'emissive',
      },
    },
  },

  SunkenHalls: {
    defaults: { roughness: 0.5, metallic: 0.0, bumpStrength: 0.3, noiseScale: 8.0 },
    materials: {
      Marble_Submerged: {
        name: 'Marble_Submerged', baseColor: hexToFloat('#1A3060'),
        roughness: 0.35, metallic: 0.0, bumpStrength: 0.2, noiseScale: 6.0,
        special: { transmission: 0.15 },
        category: 'stone',
      },
      Coral_Growth: {
        name: 'Coral_Growth', baseColor: hexToFloat('#40A0B0'),
        roughness: 0.6, metallic: 0.0, bumpStrength: 0.45, noiseScale: 12.0,
        category: 'organic',
      },
      Glass_Ancient: {
        name: 'Glass_Ancient', baseColor: hexToFloat('#80E0F0'),
        roughness: 0.08, metallic: 0.0, bumpStrength: 0.05, noiseScale: 3.0,
        special: { transmission: 0.8, ior: 1.45 },
        category: 'crystal',
      },
      Corroded_Bronze: {
        name: 'Corroded_Bronze', baseColor: hexToFloat('#3A6A5A'),
        roughness: 0.65, metallic: 0.6, bumpStrength: 0.4, noiseScale: 9.0,
        category: 'metal',
      },
      Bioluminescent_Algae: {
        name: 'Bioluminescent_Algae', baseColor: hexToFloat('#40B0E0'),
        roughness: 0.7, metallic: 0.0, bumpStrength: 0.2, noiseScale: 15.0,
        emission: { color: hexToFloat('#40B0E0'), strength: 6.0 },
        category: 'emissive',
      },
    },
  },

  EmberPeaks: {
    defaults: { roughness: 0.5, metallic: 0.1, bumpStrength: 0.35, noiseScale: 7.0 },
    materials: {
      Obsidian_Smooth: {
        name: 'Obsidian_Smooth', baseColor: hexToFloat('#1A1A2A'),
        roughness: 0.08, metallic: 0.0, bumpStrength: 0.05, noiseScale: 3.0,
        special: { transmission: 0.1 },
        category: 'stone',
      },
      Lava_Flow: {
        name: 'Lava_Flow', baseColor: hexToFloat('#B04020'),
        roughness: 0.9, metallic: 0.0, bumpStrength: 0.6, noiseScale: 5.0,
        emission: { color: hexToFloat('#FF6020'), strength: 12.0 },
        category: 'emissive',
      },
      Metal_Molten: {
        name: 'Metal_Molten', baseColor: hexToFloat('#E08040'),
        roughness: 0.2, metallic: 0.85, bumpStrength: 0.15, noiseScale: 4.0,
        emission: { color: hexToFloat('#FFD060'), strength: 8.0 },
        category: 'metal',
      },
      Pumice_Rock: {
        name: 'Pumice_Rock', baseColor: hexToFloat('#6A5A4A'),
        roughness: 0.92, metallic: 0.0, bumpStrength: 0.6, noiseScale: 14.0,
        category: 'stone',
      },
      Charcoal: {
        name: 'Charcoal', baseColor: hexToFloat('#1A1A1A'),
        roughness: 0.95, metallic: 0.0, bumpStrength: 0.5, noiseScale: 10.0,
        category: 'organic',
      },
    },
  },

  Aethermere: {
    defaults: { roughness: 0.4, metallic: 0.1, bumpStrength: 0.2, noiseScale: 6.0 },
    materials: {
      Marble_Shadow_Stained: {
        name: 'Marble_Shadow_Stained', baseColor: hexToFloat('#3A1A50'),
        roughness: 0.25, metallic: 0.0, bumpStrength: 0.15, noiseScale: 5.0,
        category: 'stone',
      },
      Gold_Tarnished: {
        name: 'Gold_Tarnished', baseColor: hexToFloat('#8A7A3A'),
        roughness: 0.35, metallic: 0.85, bumpStrength: 0.2, noiseScale: 6.0,
        category: 'metal',
      },
      Void_Surface: {
        name: 'Void_Surface', baseColor: hexToFloat('#1A0A2A'),
        roughness: 0.05, metallic: 0.0, bumpStrength: 0.1, noiseScale: 3.0,
        emission: { color: hexToFloat('#8040B0'), strength: 4.0 },
        special: { transmission: 0.3 },
        category: 'void',
      },
      Rotting_Velvet: {
        name: 'Rotting_Velvet', baseColor: hexToFloat('#6A4A80'),
        roughness: 0.88, metallic: 0.0, bumpStrength: 0.2, noiseScale: 20.0,
        category: 'fabric',
      },
      Crown_Gold: {
        name: 'Crown_Gold', baseColor: hexToFloat('#F0E0A0'),
        roughness: 0.12, metallic: 0.95, bumpStrength: 0.05, noiseScale: 3.0,
        category: 'metal',
      },
    },
  },

  TheWilds: {
    defaults: { roughness: 0.8, metallic: 0.0, bumpStrength: 0.45, noiseScale: 9.0 },
    materials: {
      Weathered_Stone: {
        name: 'Weathered_Stone', baseColor: hexToFloat('#6A7A6A'),
        roughness: 0.78, metallic: 0.0, bumpStrength: 0.45, noiseScale: 10.0,
        category: 'stone',
      },
      Forest_Bark: {
        name: 'Forest_Bark', baseColor: hexToFloat('#4A3A2A'),
        roughness: 0.85, metallic: 0.0, bumpStrength: 0.5, noiseScale: 12.0,
        category: 'organic',
      },
      Stream_Water: {
        name: 'Stream_Water', baseColor: hexToFloat('#3A6A7A'),
        roughness: 0.05, metallic: 0.0, bumpStrength: 0.08, noiseScale: 4.0,
        special: { transmission: 0.7, ior: 1.33 },
        category: 'water',
      },
      Standing_Stone_Ancient: {
        name: 'Standing_Stone_Ancient', baseColor: hexToFloat('#5A6A5A'),
        roughness: 0.7, metallic: 0.0, bumpStrength: 0.4, noiseScale: 8.0,
        emission: { color: hexToFloat('#80C0A0'), strength: 2.0 },
        category: 'stone',
      },
      Campfire_Ash: {
        name: 'Campfire_Ash', baseColor: hexToFloat('#3A3A3A'),
        roughness: 0.92, metallic: 0.0, bumpStrength: 0.3, noiseScale: 15.0,
        category: 'organic',
      },
    },
  },
};

// ── Material asset-type patterns ──────────────────────────────────────────────

const CATEGORY_PATTERNS = {
  stone:    /pillar|wall|stone|cobble|floor|tile|throne|altar|ruin|bridge|gate|tower|fortress|arch|statue|column|marble/i,
  organic:  /tree|moss|vine|mushroom|coral|bone|bark|root|fern|leaf|flower|bush|grass|wood|log|stump/i,
  metal:    /metal|iron|chain|sword|shield|anvil|forge|armor|gate|chest|lock|ingot|cart|pipe|bell|anchor/i,
  crystal:  /crystal|shard|gem|void|magic|glow|pearl|clam|geode/i,
  water:    /water|pool|stream|fountain|well|pond|swim|underwater/i,
  fabric:   /banner|tent|canvas|cloth|curtain|carpet|rope|net|velvet/i,
  emissive: /lamp|lantern|fire|lava|ember|torch|candle|orb|beacon|jellyfish/i,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the master PBR material profile for a specific asset in a region.
 * Returns the best matching material with all PBR parameters.
 *
 * @param {string} assetId - e.g. "sunk_broken_pillar"
 * @param {string} regionId - e.g. "SunkenHalls"
 * @returns {{ name, baseColor, roughness, metallic, bumpStrength, noiseScale, emission?, special? }}
 */
export function getMaterialForAsset(assetId, regionId) {
  const regionKit = REGION_MATERIALS[regionId];
  if (!regionKit) {
    log.warn({ regionId }, 'Unknown region — falling back to universal materials');
    return UNIVERSAL_MATERIALS.Stone_Cobble_Clean;
  }

  const id = assetId.toLowerCase();

  // 1. Try to match by asset category against region materials
  for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(id)) {
      // Find first region material matching this category
      const match = Object.values(regionKit.materials)
        .find(m => m.category === category);
      if (match) {
        log.debug({ assetId, regionId, material: match.name, category }, 'Material matched by category');
        return match;
      }

      // Fall back to universal material of same category
      const universal = Object.values(UNIVERSAL_MATERIALS)
        .find(m => m.category === category);
      if (universal) return universal;
    }
  }

  // 2. Return region defaults as a generic material
  const palette = regionKit.defaults;
  return {
    name: `${regionId}_Default`,
    baseColor: Object.values(regionKit.materials)[0]?.baseColor || [0.5, 0.5, 0.5],
    roughness: palette.roughness,
    metallic: palette.metallic,
    bumpStrength: palette.bumpStrength,
    noiseScale: palette.noiseScale,
    category: 'default',
  };
}

/**
 * Get all materials for a region (universal + region-specific).
 * @param {string} regionId
 * @returns {Object} map of material name → profile
 */
export function getMaterialsForRegion(regionId) {
  const regionKit = REGION_MATERIALS[regionId];
  if (!regionKit) return { ...UNIVERSAL_MATERIALS };
  return { ...UNIVERSAL_MATERIALS, ...regionKit.materials };
}

/**
 * Get region defaults (roughness, metallic, etc.) for a given region.
 * @param {string} regionId
 * @returns {{ roughness, metallic, bumpStrength, noiseScale }}
 */
export function getRegionDefaults(regionId) {
  return REGION_MATERIALS[regionId]?.defaults || {
    roughness: 0.65, metallic: 0.0, bumpStrength: 0.3, noiseScale: 8.0,
  };
}

/**
 * Get the 4-material set (primary, secondary, accent, dark) with region-aware PBR parameters.
 * Used by buildAssetCode() to replace generic type-based parameters.
 *
 * @param {string} assetId
 * @param {string} regionId
 * @param {string[]} paletteHexColors - [primary, secondary, accent, dark] hex colors from manifest
 * @returns {{ primary, secondary, accent, dark }} — each with { roughness, metallic, bumpStrength }
 */
export function getAssetMaterialSet(assetId, regionId, paletteHexColors) {
  const masterMat = getMaterialForAsset(assetId, regionId);
  const regionDef = getRegionDefaults(regionId);

  return {
    primary: {
      roughness: masterMat.roughness,
      metallic: masterMat.metallic,
      bumpStrength: masterMat.bumpStrength,
      noiseScale: masterMat.noiseScale,
    },
    secondary: {
      roughness: Math.min(masterMat.roughness + 0.1, 0.95),
      metallic: Math.max(masterMat.metallic - 0.2, 0),
      bumpStrength: regionDef.bumpStrength,
      noiseScale: regionDef.noiseScale,
    },
    accent: {
      roughness: Math.max(masterMat.roughness - 0.2, 0.05),
      metallic: masterMat.category === 'metal' ? 0.7 : 0.1,
      bumpStrength: 0.15,
      noiseScale: 5.0,
    },
    dark: {
      roughness: 0.9,
      metallic: 0.0,
      bumpStrength: regionDef.bumpStrength,
      noiseScale: regionDef.noiseScale,
    },
    masterMaterial: masterMat.name,
    hasEmission: !!masterMat.emission,
    emission: masterMat.emission || null,
    special: masterMat.special || null,
  };
}

/**
 * Generate Blender Python code for creating a master PBR material with region-aware parameters.
 * Returns a string of Python code that creates the material using make_pbr().
 *
 * @param {string} materialName
 * @param {object} profile - material profile from this library
 * @returns {string} Python code
 */
export function generateMaterialPython(materialName, profile) {
  const [r, g, b] = profile.baseColor;
  let code = `make_pbr("${materialName}", (${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}), `;
  code += `roughness=${profile.roughness}, metallic=${profile.metallic}, `;
  code += `bump_strength=${profile.bumpStrength}, noise_scale=${profile.noiseScale})`;

  if (profile.emission) {
    const [er, eg, eb] = profile.emission.color;
    code += `\n# Emission overlay for ${materialName}`;
    code += `\n# emission_color=(${er.toFixed(3)}, ${eg.toFixed(3)}, ${eb.toFixed(3)}), strength=${profile.emission.strength}`;
  }

  return code;
}

/**
 * Get a summary of all regions and their material counts for status reporting.
 */
export function getMaterialLibraryStatus() {
  const universalCount = Object.keys(UNIVERSAL_MATERIALS).length;
  const regionCounts = {};
  let totalRegion = 0;
  for (const [regionId, kit] of Object.entries(REGION_MATERIALS)) {
    const count = Object.keys(kit.materials).length;
    regionCounts[regionId] = count;
    totalRegion += count;
  }
  return {
    universal: universalCount,
    regionSpecific: regionCounts,
    totalRegionMaterials: totalRegion,
    totalMaterials: universalCount + totalRegion,
    regions: Object.keys(REGION_MATERIALS),
  };
}
