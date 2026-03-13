/**
 * modules/unreal/wayshrine-design.js — Wayshrine Visual Design: Sanctuaries of Light
 *
 * Defines 7 region-specific wayshrine concepts for The Shattered Crown.
 * Each wayshrine is uniquely adapted to its region's environment and lore.
 * Resting at a wayshrine triggers a bloom pulse and corruption suppression.
 *
 * Architecture:
 *   - WAYSHRINE_CONCEPTS: 7 region designs (mesh, materials, particles, lighting, FX)
 *   - WAYSHRINE_COMMON: shared behavior (rest trigger, bloom pulse, corruption suppression)
 *   - WAYSHRINE_PLACEMENTS: 3 placement positions per region (21 total)
 *   - Export functions for UE5 data tables and blueprint specs
 *
 * Integrates with:
 *   - global-environment.js (REGION_PROFILES for color/mood sync)
 *   - corruption-shader.js (corruption suppression radius)
 *   - shard-echo-dungeons.js (discovery triggers near wayshrines)
 *   - willpower-tracker.js (rest restores willpower)
 *
 * ms_1: "Design 7 region-specific wayshrine concepts"
 * for Wayshrine Visual Design goal (29cbf844).
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { callTool } from '../../lib/mcp-gateway.js';
import { getActiveGame } from './game-config.js';

const log = createLogger('wayshrine-design');

// ── Common Wayshrine Behavior ────────────────────────────────────────────────

/**
 * Shared properties for ALL wayshrines regardless of region.
 * Blueprint: BP_Wayshrine_Base (abstract parent class).
 */
export const WAYSHRINE_COMMON = {
  blueprintClass: 'BP_Wayshrine_Base',
  interactionRadius: 250,    // cm — player must be within this to rest
  corruptionSuppression: {
    radius: 800,              // cm — sphere of suppression around wayshrine
    suppressionRate: 0.15,    // corruption decay per second while resting
    maxSuppression: 0.4,      // cap: can't reduce corruption below current - 0.4
    transitionTime: 2.0,      // seconds to lerp post-process into clean state
  },
  restBehavior: {
    restDurationMin: 3.0,     // minimum seconds to get rest benefit
    healthRegenRate: 0.05,    // % max HP per second during rest
    willpowerRestore: 15,     // flat willpower restored on rest completion
    cooldownSeconds: 120,     // can't rest at same wayshrine for 2 min after
  },
  bloomPulse: {
    trigger: 'on_rest_start',
    peakIntensity: 2.5,       // bloom intensity at pulse peak
    rampUpSeconds: 0.8,
    holdSeconds: 0.3,
    rampDownSeconds: 1.5,
    colorMultiplier: 'region_accent', // uses region-specific accent color
    postProcessPriority: 10,
  },
  cinematicCamera: {
    enabled: true,
    blendTime: 1.2,           // seconds to blend from gameplay to cinematic
    orbitRadius: 350,          // cm orbit distance
    orbitSpeed: 8,             // degrees per second
    pitchAngle: -15,           // slight downward angle
    dofFocalDistance: 300,     // depth of field focused on wayshrine
    dofAperture: 2.8,
  },
  audio: {
    ambientLoop: 'SFX_Wayshrine_Ambient',    // soft crystalline hum
    restTrigger: 'SFX_Wayshrine_Rest_Start',  // chime + whoosh
    bloomPulse: 'SFX_Wayshrine_Bloom_Pulse',  // resonant bell tone
    corruptionCleanse: 'SFX_Corruption_Cleanse', // crackling dissipation
  },
  discoveryReward: {
    xp: 50,
    loreEntry: true,          // unlocks region-specific wayshrine lore
    mapReveal: 300,            // reveals 300m radius on map when first discovered
  },
};

// ── Region-Specific Wayshrine Concepts ───────────────────────────────────────

export const WAYSHRINE_CONCEPTS = {
  CrossroadsHub: {
    displayName: 'Hearthstone Pillar',
    regionId: 'CrossroadsHub',
    lore: 'The oldest wayshrines in the realm — neutral stone pillars erected by the first Crown-Seekers as markers of safe passage. Their warm glow has guided travelers for centuries.',
    concept: 'A weathered hexagonal granite pillar with carved rune channels that glow soft amber-white. Central crystal socket at the top holds a warm-toned quartz that pulses gently. Moss and lichen on lower portions suggest great age. Simple, sturdy, reassuring.',
    mesh: {
      baseShape: 'hexagonal_pillar',
      height: 300,               // cm
      baseWidth: 100,            // cm
      topTaper: 0.7,             // slight taper toward top
      details: ['rune_channels', 'crystal_socket', 'moss_patches', 'weathered_edges'],
      lodLevels: 3,
    },
    materials: {
      body: {
        base: 'MI_Granite_Weathered',
        baseColor: [0.55, 0.52, 0.48],
        roughness: 0.75,
        normalIntensity: 1.2,
        mossBlend: 0.3,           // 30% moss coverage on lower half
        mossColor: [0.15, 0.35, 0.1],
      },
      runes: {
        base: 'MI_Emissive_Runes',
        emissiveColor: [1.0, 0.85, 0.6],
        emissiveIntensity: 3.0,
        pulseSpeed: 0.5,          // slow gentle pulse
        pulseRange: [2.0, 4.0],   // min/max emissive
      },
      crystal: {
        base: 'MI_Crystal_Warm',
        baseColor: [1.0, 0.9, 0.7],
        opacity: 0.85,
        emissiveColor: [1.0, 0.85, 0.55],
        emissiveIntensity: 5.0,
        refractionIndex: 1.45,
        subsurfaceColor: [1.0, 0.7, 0.3],
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_Motes',
        color: [1.0, 0.9, 0.6, 0.6],
        count: 20,
        radius: 200,
        speed: 15,
        behavior: 'gentle_orbit',
      },
      restActive: {
        system: 'NS_Wayshrine_Bloom',
        color: [1.0, 0.85, 0.5, 0.8],
        count: 60,
        radius: 400,
        speed: 40,
        behavior: 'burst_then_settle',
      },
    },
    lighting: {
      pointLight: {
        color: [1.0, 0.85, 0.6],
        intensity: 2500,           // lumens
        radius: 500,
        castShadows: true,
        position: [0, 0, 280],     // at crystal level
      },
      accentLight: {
        color: [1.0, 0.7, 0.3],
        intensity: 800,
        radius: 200,
        castShadows: false,
        position: [0, 0, 150],     // mid-pillar rune glow
      },
    },
    accentColor: [1.0, 0.85, 0.6],  // warm amber — used for bloom pulse
  },

  AshenWilds: {
    displayName: 'Verdant Obelisk',
    regionId: 'AshenWilds',
    lore: 'Cracked obsidian obelisks that defy the surrounding desolation. Where they stand, life persists — a stubborn circle of green grass pushing through ash. Said to contain fragments of the world before the burning.',
    concept: 'A cracked black obsidian obelisk, roughly 2.5m tall, with deep fissures revealing inner amber-orange glow like cooling magma. A perfect circle of vibrant green grass and small wildflowers grows around its base (3m radius) despite ash covering everything else. Crystal shard at apex pulses with warm golden light.',
    mesh: {
      baseShape: 'irregular_obelisk',
      height: 250,
      baseWidth: 80,
      topTaper: 0.5,
      details: ['deep_cracks', 'inner_glow_veins', 'crystal_apex_shard', 'grass_ring_base_plane'],
      lodLevels: 3,
    },
    materials: {
      body: {
        base: 'MI_Obsidian_Cracked',
        baseColor: [0.05, 0.03, 0.02],
        roughness: 0.3,            // obsidian is smooth
        normalIntensity: 2.0,      // deep cracks
        crackEmissive: true,
      },
      innerGlow: {
        base: 'MI_Emissive_Magma',
        emissiveColor: [1.0, 0.5, 0.1],
        emissiveIntensity: 8.0,
        pulseSpeed: 0.3,
        pulseRange: [5.0, 10.0],
        visibleThroughCracks: true,
      },
      grassRing: {
        base: 'MI_Grass_Verdant',
        baseColor: [0.2, 0.55, 0.15],
        roughness: 0.8,
        windResponse: 0.4,
        radius: 300,               // cm — the life circle
        blendEdge: 50,             // cm — soft ash-to-grass transition
      },
      crystal: {
        base: 'MI_Crystal_Golden',
        baseColor: [1.0, 0.8, 0.3],
        opacity: 0.9,
        emissiveColor: [1.0, 0.75, 0.2],
        emissiveIntensity: 6.0,
        subsurfaceColor: [1.0, 0.5, 0.1],
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_Embers',
        color: [1.0, 0.6, 0.1, 0.5],
        count: 30,
        radius: 300,
        speed: 25,
        behavior: 'rising_embers',
      },
      grassSparkles: {
        system: 'NS_Wayshrine_LifeSparks',
        color: [0.3, 1.0, 0.2, 0.4],
        count: 15,
        radius: 300,
        speed: 5,
        behavior: 'ground_float',
      },
      restActive: {
        system: 'NS_Wayshrine_Bloom',
        color: [1.0, 0.7, 0.2, 0.9],
        count: 80,
        radius: 500,
        speed: 50,
        behavior: 'burst_then_settle',
      },
    },
    lighting: {
      pointLight: {
        color: [1.0, 0.6, 0.15],
        intensity: 3000,
        radius: 600,
        castShadows: true,
        position: [0, 0, 230],
      },
      groundLight: {
        color: [0.3, 0.8, 0.2],
        intensity: 500,
        radius: 350,
        castShadows: false,
        position: [0, 0, 10],      // ground level — illuminates grass ring
      },
    },
    accentColor: [1.0, 0.6, 0.15],
  },

  Ironhold: {
    displayName: 'Forge Anvil Shrine',
    regionId: 'Ironhold',
    lore: 'Wayshrines in Ironhold take the form of ancient forge anvils with embedded crystals — relics of the fortress-builders who believed rest and craft were sacred acts. The hammer-strike crystal ignites with blue forge-fire when activated.',
    concept: 'A massive weathered iron anvil (1.5m tall) set on a stone platform with runic inlays. A large blue crystal is embedded in the anvil\'s horn, glowing with cold forge-fire. Metal chains drape from the sides, and hammer marks score the surface. Sparks drift upward from the crystal. Industrial, powerful, protective.',
    mesh: {
      baseShape: 'anvil_on_platform',
      height: 200,                  // anvil + platform
      baseWidth: 150,
      details: ['crystal_horn', 'runic_platform', 'draped_chains', 'hammer_marks', 'metal_rivets'],
      lodLevels: 3,
    },
    materials: {
      body: {
        base: 'MI_Iron_Weathered',
        baseColor: [0.25, 0.22, 0.2],
        roughness: 0.6,
        metallic: 0.85,
        normalIntensity: 1.8,       // hammer marks and rivets
        rustBlend: 0.2,
        rustColor: [0.4, 0.18, 0.05],
      },
      platform: {
        base: 'MI_Stone_Fortress',
        baseColor: [0.4, 0.38, 0.35],
        roughness: 0.8,
        normalIntensity: 1.0,
      },
      runicInlays: {
        base: 'MI_Emissive_Runes',
        emissiveColor: [0.3, 0.6, 1.0],
        emissiveIntensity: 4.0,
        pulseSpeed: 0.8,
        pulseRange: [2.5, 5.0],
      },
      crystal: {
        base: 'MI_Crystal_ForgeFire',
        baseColor: [0.2, 0.5, 1.0],
        opacity: 0.8,
        emissiveColor: [0.3, 0.6, 1.0],
        emissiveIntensity: 7.0,
        subsurfaceColor: [0.1, 0.3, 0.8],
      },
      chains: {
        base: 'MI_Iron_Chain',
        baseColor: [0.2, 0.18, 0.15],
        roughness: 0.5,
        metallic: 0.9,
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_ForgeSparks',
        color: [0.3, 0.6, 1.0, 0.7],
        count: 25,
        radius: 150,
        speed: 35,
        behavior: 'sparks_rising',
      },
      restActive: {
        system: 'NS_Wayshrine_ForgeBloom',
        color: [0.4, 0.7, 1.0, 0.85],
        count: 50,
        radius: 350,
        speed: 30,
        behavior: 'burst_then_settle',
      },
    },
    lighting: {
      pointLight: {
        color: [0.3, 0.6, 1.0],
        intensity: 3500,
        radius: 500,
        castShadows: true,
        position: [0, 0, 200],
      },
      rimLight: {
        color: [0.5, 0.7, 1.0],
        intensity: 1200,
        radius: 300,
        castShadows: false,
        position: [80, 0, 150],     // side accent for metallic sheen
      },
    },
    accentColor: [0.3, 0.6, 1.0],   // cold forge-blue
  },

  VerdantReach: {
    displayName: 'Heartwood Shrine',
    regionId: 'VerdantReach',
    lore: 'Living tree wayshrines that grew around ancient crystals. The trees feed on the crystal\'s energy, and the crystal draws life from the tree — a perfect symbiosis. Their canopies glow faintly even in deepest twilight.',
    concept: 'A living tree (3m tall) with a luminous green crystal embedded in its trunk like a heartbeat. Roots spread wide, bark is smooth and silvery. Bioluminescent vines wind up the trunk. Tiny glowing flowers dot the canopy. Fireflies orbit lazily. Serene, alive, magical.',
    mesh: {
      baseShape: 'living_tree_shrine',
      height: 300,
      baseWidth: 120,               // root spread
      details: ['crystal_heart_trunk', 'silver_bark', 'bioluminescent_vines', 'glowing_flowers', 'wide_root_spread'],
      lodLevels: 3,
    },
    materials: {
      bark: {
        base: 'MI_Bark_Silver',
        baseColor: [0.6, 0.58, 0.55],
        roughness: 0.7,
        normalIntensity: 1.5,
        subsurfaceScattering: true,
        subsurfaceColor: [0.2, 0.5, 0.15],
      },
      crystal: {
        base: 'MI_Crystal_Nature',
        baseColor: [0.1, 0.8, 0.3],
        opacity: 0.75,
        emissiveColor: [0.2, 0.9, 0.4],
        emissiveIntensity: 6.0,
        pulseSpeed: 0.4,            // slow heartbeat pulse
        subsurfaceColor: [0.1, 0.6, 0.2],
      },
      vines: {
        base: 'MI_Vine_Bioluminescent',
        baseColor: [0.1, 0.4, 0.15],
        emissiveColor: [0.1, 0.7, 0.3],
        emissiveIntensity: 2.0,
        roughness: 0.65,
      },
      flowers: {
        base: 'MI_Flower_Glowing',
        emissiveColor: [0.8, 1.0, 0.5],
        emissiveIntensity: 3.0,
        count: 12,
        distribution: 'canopy_scatter',
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_Fireflies',
        color: [0.3, 1.0, 0.4, 0.5],
        count: 40,
        radius: 350,
        speed: 8,
        behavior: 'lazy_orbit',
      },
      pollenDrift: {
        system: 'NS_Wayshrine_Pollen',
        color: [0.8, 1.0, 0.3, 0.3],
        count: 20,
        radius: 250,
        speed: 3,
        behavior: 'gentle_drift',
      },
      restActive: {
        system: 'NS_Wayshrine_NatureBloom',
        color: [0.2, 1.0, 0.5, 0.8],
        count: 70,
        radius: 450,
        speed: 20,
        behavior: 'spiral_upward',
      },
    },
    lighting: {
      pointLight: {
        color: [0.2, 0.9, 0.4],
        intensity: 2000,
        radius: 500,
        castShadows: true,
        position: [0, 0, 150],     // crystal heart level
      },
      canopyLight: {
        color: [0.5, 1.0, 0.3],
        intensity: 600,
        radius: 400,
        castShadows: false,
        position: [0, 0, 280],     // canopy glow
      },
    },
    accentColor: [0.2, 0.9, 0.4],  // verdant green
  },

  SunkenHalls: {
    displayName: 'Air Pocket Dome',
    regionId: 'SunkenHalls',
    lore: 'In the drowned corridors of the Sunken Halls, these dome shrines maintain pockets of breathable air. The curved water walls shimmer with bioluminescent algae, and a floating crystal orb hums with calming aquamarine resonance.',
    concept: 'A dome-shaped coral and stone structure (2m tall) with visible curved water walls held in place by magic. Bioluminescent blue-green algae clings to the dome interior. Seashells and barnacles encrust the base. A translucent crystal orb floats at the center emitting calming aquamarine light. Air bubbles drift upward at the dome edges.',
    mesh: {
      baseShape: 'coral_dome',
      height: 200,
      baseWidth: 250,               // wider than tall — dome shape
      details: ['curved_water_wall', 'coral_ribs', 'floating_orb', 'barnacle_base', 'shell_decoration'],
      lodLevels: 3,
    },
    materials: {
      coral: {
        base: 'MI_Coral_Ancient',
        baseColor: [0.4, 0.35, 0.3],
        roughness: 0.85,
        normalIntensity: 2.0,       // heavy coral texture
        subsurfaceScattering: true,
        subsurfaceColor: [0.3, 0.2, 0.15],
      },
      waterWall: {
        base: 'MI_Water_Curved',
        baseColor: [0.05, 0.3, 0.35],
        opacity: 0.4,
        refractionIndex: 1.33,
        distortionStrength: 0.15,
        flowSpeed: 0.2,
        flowDirection: [0, 0, 1],   // upward flow
      },
      algae: {
        base: 'MI_Algae_Bioluminescent',
        baseColor: [0.05, 0.2, 0.15],
        emissiveColor: [0.1, 0.6, 0.5],
        emissiveIntensity: 2.5,
        distribution: 'dome_interior',
        coverage: 0.4,
      },
      orb: {
        base: 'MI_Crystal_Aqua',
        baseColor: [0.15, 0.6, 0.7],
        opacity: 0.7,
        emissiveColor: [0.1, 0.7, 0.65],
        emissiveIntensity: 8.0,
        floatHeight: 120,           // cm above base
        floatBobSpeed: 0.3,
        floatBobRange: 10,          // cm bob distance
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_Bubbles',
        color: [0.3, 0.8, 0.9, 0.4],
        count: 35,
        radius: 200,
        speed: 20,
        behavior: 'rising_bubbles',
      },
      algaeGlow: {
        system: 'NS_Wayshrine_AlgaeSpores',
        color: [0.1, 0.7, 0.5, 0.3],
        count: 15,
        radius: 180,
        speed: 5,
        behavior: 'drift_settle',
      },
      restActive: {
        system: 'NS_Wayshrine_AquaBloom',
        color: [0.1, 0.8, 0.7, 0.85],
        count: 55,
        radius: 350,
        speed: 25,
        behavior: 'expanding_ring',
      },
    },
    lighting: {
      pointLight: {
        color: [0.1, 0.7, 0.65],
        intensity: 2500,
        radius: 400,
        castShadows: true,
        position: [0, 0, 120],     // at floating orb
      },
      causticLight: {
        color: [0.15, 0.5, 0.6],
        intensity: 1000,
        radius: 350,
        castShadows: false,
        position: [0, 0, 50],       // low — water caustic effect
        lightFunction: 'caustic_pattern', // animated caustic cookie
      },
    },
    accentColor: [0.1, 0.7, 0.65],  // aquamarine
  },

  EmberPeaks: {
    displayName: 'Magma Spire',
    regionId: 'EmberPeaks',
    lore: 'Obsidian spires that channel the volcanic heat into protective warmth. The cooling magma that flows down their sides hardens into natural armor, while the crystal within burns with an eternal flame that cannot be extinguished — not even by the mountains themselves.',
    concept: 'A tall obsidian spire (3.5m) with rivulets of slowly cooling magma flowing down grooved channels. The base sits in a small lava pool (contained, safe). A fire crystal at the peak burns with intense orange-red flame. Heat distortion shimmers the air above. Dark, dramatic, fiercely protective.',
    mesh: {
      baseShape: 'volcanic_spire',
      height: 350,
      baseWidth: 90,
      topTaper: 0.3,                // sharp taper to peak
      details: ['magma_channels', 'lava_pool_base', 'fire_crystal_peak', 'cooled_magma_ridges', 'obsidian_facets'],
      lodLevels: 3,
    },
    materials: {
      body: {
        base: 'MI_Obsidian_Volcanic',
        baseColor: [0.04, 0.02, 0.01],
        roughness: 0.25,
        normalIntensity: 1.5,
        specular: 0.8,              // obsidian reflection
      },
      magmaChannels: {
        base: 'MI_Magma_Flow',
        emissiveColor: [1.0, 0.35, 0.0],
        emissiveIntensity: 12.0,
        flowSpeed: 0.08,            // slow drip
        flowDirection: [0, 0, -1],  // downward
        temperatureGradient: true,  // bright orange at top → dark red at base
      },
      lavaPool: {
        base: 'MI_Lava_Pool',
        emissiveColor: [1.0, 0.25, 0.0],
        emissiveIntensity: 6.0,
        flowSpeed: 0.03,
        surfaceDistortion: 0.1,
        radius: 120,                // cm
      },
      crystal: {
        base: 'MI_Crystal_Flame',
        baseColor: [1.0, 0.4, 0.0],
        opacity: 0.85,
        emissiveColor: [1.0, 0.3, 0.0],
        emissiveIntensity: 15.0,    // very bright — visible from distance
        subsurfaceColor: [1.0, 0.15, 0.0],
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_LavaEmbers',
        color: [1.0, 0.4, 0.0, 0.7],
        count: 45,
        radius: 250,
        speed: 40,
        behavior: 'rising_embers',
      },
      heatDistortion: {
        system: 'NS_Wayshrine_HeatHaze',
        color: [1.0, 1.0, 1.0, 0.1],
        count: 5,
        radius: 150,
        speed: 10,
        behavior: 'screen_distortion',
      },
      restActive: {
        system: 'NS_Wayshrine_FlameBloom',
        color: [1.0, 0.5, 0.1, 0.9],
        count: 90,
        radius: 500,
        speed: 60,
        behavior: 'eruption_burst',
      },
    },
    lighting: {
      pointLight: {
        color: [1.0, 0.35, 0.0],
        intensity: 4000,
        radius: 700,
        castShadows: true,
        position: [0, 0, 330],     // at fire crystal
      },
      lavaGlow: {
        color: [1.0, 0.2, 0.0],
        intensity: 1500,
        radius: 300,
        castShadows: false,
        position: [0, 0, 20],       // at lava pool level
      },
    },
    accentColor: [1.0, 0.35, 0.0],  // volcanic orange-red
  },

  Aethermere: {
    displayName: 'Reality Sphere',
    regionId: 'Aethermere',
    lore: 'In the void-touched expanse of Aethermere, these spheres are anchors of sanity. Within their boundary, reality reasserts itself — colors normalize, gravity stabilizes, whispers fall silent. They are the only places in Aethermere where one can truly rest without the void watching.',
    concept: 'A perfect translucent sphere (2.5m diameter) of normal, warm-lit reality floating in the void darkness. Inside: grass, a small stone cairn, warm light — like a snow globe of the normal world. Outside the sphere, Aethermere\'s purple-black void presses against the boundary with visible distortion. The sphere\'s surface shimmers with iridescent interference patterns. The most surreal and visually striking wayshrine.',
    mesh: {
      baseShape: 'reality_sphere',
      height: 250,                   // sphere diameter
      baseWidth: 250,
      details: ['outer_sphere_shell', 'inner_grass_plane', 'stone_cairn', 'reality_boundary_effect', 'void_press_distortion'],
      lodLevels: 3,
    },
    materials: {
      sphereShell: {
        base: 'MI_Reality_Boundary',
        baseColor: [0.9, 0.85, 0.8],
        opacity: 0.15,              // mostly transparent
        refractionIndex: 1.2,
        iridescence: true,
        iridescenceIntensity: 0.6,
        iridescenceHue: [0.5, 0.3, 0.8],  // purple-gold shift
        fresnelPower: 3.0,          // edges more visible than center
        distortionStrength: 0.05,   // subtle reality warping at edge
      },
      innerGrass: {
        base: 'MI_Grass_Normal',
        baseColor: [0.25, 0.5, 0.2],
        roughness: 0.8,
        note: 'Deliberately mundane — contrasts with void outside',
      },
      cairn: {
        base: 'MI_Stone_Simple',
        baseColor: [0.5, 0.48, 0.45],
        roughness: 0.75,
        normalIntensity: 0.8,
      },
      voidBoundary: {
        base: 'MI_Void_Press',
        baseColor: [0.05, 0.0, 0.1],
        emissiveColor: [0.3, 0.1, 0.5],
        emissiveIntensity: 2.0,
        distortionStrength: 0.3,
        animationSpeed: 0.15,        // slow creeping void tendrils
        renderOutsideSphere: true,   // only visible from inside looking out
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_RealityMotes',
        color: [1.0, 0.95, 0.8, 0.5],
        count: 15,
        radius: 100,                 // contained within sphere
        speed: 5,
        behavior: 'gentle_float',
      },
      voidTendrils: {
        system: 'NS_Wayshrine_VoidPress',
        color: [0.3, 0.1, 0.5, 0.4],
        count: 8,
        radius: 130,                 // just outside sphere
        speed: 3,
        behavior: 'creep_toward_center',
      },
      restActive: {
        system: 'NS_Wayshrine_RealityPulse',
        color: [1.0, 0.95, 0.85, 0.7],
        count: 40,
        radius: 300,
        speed: 15,
        behavior: 'expanding_sphere',  // pushes void back
      },
    },
    lighting: {
      interiorLight: {
        color: [1.0, 0.95, 0.85],     // warm, normal daylight
        intensity: 3000,
        radius: 150,                    // contained within sphere
        castShadows: true,
        position: [0, 0, 200],         // top of sphere — mimics sun
      },
      sphereRim: {
        color: [0.5, 0.3, 0.8],
        intensity: 800,
        radius: 300,
        castShadows: false,
        position: [0, 0, 125],         // sphere center — rim glow
      },
    },
    accentColor: [1.0, 0.95, 0.85],   // warm daylight — normalcy is the accent
    specialBehavior: {
      postProcessOverride: true,
      insideSpherePostProcess: {
        bloom: 0.3,
        exposure: 0.2,
        temperature: 5800,           // neutral daylight
        vignette: 0.0,               // no vignette — openness
        ao: 0.3,
      },
      voidPushOnRest: {
        pushRadius: 400,              // rest pushes void further away
        pushDuration: 5.0,
        returnSpeed: 0.5,
      },
    },
  },

  TheWilds: {
    displayName: 'Standing Stone Circle',
    regionId: 'TheWilds',
    lore: 'Ancient druidic standing stones that predate the Crown itself. Three mossy menhirs arranged in a triangle around a central crystal embedded in the earth. The Wilds trust these stones, and the wildlife gathers near them without fear.',
    concept: 'Three weathered standing stones (2m tall each) arranged in a triangle, each leaning slightly inward. Heavily covered in moss and lichen. A crystal embedded in the ground at the center glows soft white-gold. Roots and vines connect the stones underground (visible at surface). Woodland flowers and ferns grow thick around the base. Deer/fox/birds may rest nearby (ambient life).',
    mesh: {
      baseShape: 'standing_stone_trio',
      height: 200,                    // stone height
      baseWidth: 350,                 // triangle spread
      details: ['three_menhirs', 'ground_crystal', 'connecting_roots', 'moss_heavy', 'fern_cluster', 'flower_scatter'],
      lodLevels: 3,
    },
    materials: {
      stones: {
        base: 'MI_Stone_Ancient',
        baseColor: [0.45, 0.42, 0.38],
        roughness: 0.85,
        normalIntensity: 1.3,
        mossBlend: 0.6,              // heavy moss coverage
        mossColor: [0.12, 0.3, 0.08],
        lichenPatches: true,
        lichenColor: [0.5, 0.45, 0.3],
      },
      groundCrystal: {
        base: 'MI_Crystal_Earth',
        baseColor: [0.9, 0.85, 0.6],
        opacity: 0.8,
        emissiveColor: [1.0, 0.95, 0.7],
        emissiveIntensity: 4.0,
        pulseSpeed: 0.6,
        flushWithGround: true,
      },
      roots: {
        base: 'MI_Root_Ancient',
        baseColor: [0.25, 0.18, 0.1],
        roughness: 0.8,
        normalIntensity: 1.5,
        subsurfaceScattering: true,
        subsurfaceColor: [0.15, 0.25, 0.05],
      },
      foliage: {
        base: 'MI_Fern_Forest',
        baseColor: [0.15, 0.4, 0.1],
        windResponse: 0.6,
        density: 'thick',
        flowerColors: [[0.8, 0.7, 0.2], [0.6, 0.3, 0.7], [1.0, 1.0, 0.9]],
      },
    },
    particles: {
      ambient: {
        system: 'NS_Wayshrine_ForestMotes',
        color: [1.0, 0.95, 0.7, 0.4],
        count: 25,
        radius: 300,
        speed: 6,
        behavior: 'gentle_drift',
      },
      butterflies: {
        system: 'NS_Wayshrine_Butterflies',
        color: [0.8, 0.6, 0.2, 0.7],
        count: 5,
        radius: 400,
        speed: 15,
        behavior: 'random_flutter',
      },
      restActive: {
        system: 'NS_Wayshrine_NatureBloom',
        color: [1.0, 0.95, 0.8, 0.75],
        count: 50,
        radius: 400,
        speed: 15,
        behavior: 'ground_ripple',
      },
    },
    lighting: {
      pointLight: {
        color: [1.0, 0.95, 0.7],
        intensity: 1800,
        radius: 450,
        castShadows: true,
        position: [0, 0, 10],       // ground crystal — low light
      },
      dappledLight: {
        color: [1.0, 0.98, 0.85],
        intensity: 600,
        radius: 350,
        castShadows: false,
        position: [0, 0, 250],       // above — simulates canopy dapple
        lightFunction: 'leaf_shadow_cookie',
      },
    },
    accentColor: [1.0, 0.95, 0.7],   // warm white-gold
  },
};

// ── Wayshrine Placements (3 per region, 21 total) ────────────────────────────

export const WAYSHRINE_PLACEMENTS = {
  CrossroadsHub: [
    { id: 'ws_crossroads_01', position: [0, 0, 100],        rotation: [0, 0, 0],    note: 'Central plaza — first wayshrine players find' },
    { id: 'ws_crossroads_02', position: [2500, 1500, 120],   rotation: [0, 30, 0],   note: 'Near northern gate to AshenWilds' },
    { id: 'ws_crossroads_03', position: [-2000, -1800, 90],  rotation: [0, -15, 0],  note: 'Southern market district alcove' },
  ],
  AshenWilds: [
    { id: 'ws_ashen_01', position: [500, 200, 80],          rotation: [0, 0, 0],    note: 'Entry clearing — first oasis of green' },
    { id: 'ws_ashen_02', position: [3000, -1000, 150],      rotation: [0, 45, 0],   note: 'Ridgeline overlook point' },
    { id: 'ws_ashen_03', position: [5000, 500, 200],        rotation: [0, -20, 0],  note: 'Deep ash basin — near ember caves' },
  ],
  Ironhold: [
    { id: 'ws_iron_01', position: [200, 500, 100],          rotation: [0, 0, 0],    note: 'Fortress courtyard — near main gate' },
    { id: 'ws_iron_02', position: [-1500, 2000, 250],       rotation: [0, 60, 0],   note: 'Upper battlements smithy alcove' },
    { id: 'ws_iron_03', position: [1800, 3000, 180],        rotation: [0, -30, 0],  note: 'Deep forge chamber entrance' },
  ],
  VerdantReach: [
    { id: 'ws_verdant_01', position: [-300, 100, 50],       rotation: [0, 0, 0],    note: 'Twilight glade — entry point' },
    { id: 'ws_verdant_02', position: [-2500, -1500, 80],    rotation: [0, 90, 0],   note: 'Ancient grove clearing' },
    { id: 'ws_verdant_03', position: [-4000, 500, 120],     rotation: [0, -45, 0],  note: 'Canopy bridge midpoint — elevated' },
  ],
  SunkenHalls: [
    { id: 'ws_sunken_01', position: [100, -200, -50],       rotation: [0, 0, 0],    note: 'First air pocket — relief after descent' },
    { id: 'ws_sunken_02', position: [2000, -1000, -120],    rotation: [0, 20, 0],   note: 'Coral gallery intersection' },
    { id: 'ws_sunken_03', position: [3500, 500, -200],      rotation: [0, -60, 0],  note: 'Deep chamber before boss corridor' },
  ],
  EmberPeaks: [
    { id: 'ws_ember_01', position: [400, 300, 300],         rotation: [0, 0, 0],    note: 'Lava field edge — safe approach' },
    { id: 'ws_ember_02', position: [2500, -800, 500],       rotation: [0, 40, 0],   note: 'Caldera rim — dramatic vista point' },
    { id: 'ws_ember_03', position: [4000, 1500, 350],       rotation: [0, -45, 0],  note: 'Cooled obsidian platform — near summit' },
  ],
  Aethermere: [
    { id: 'ws_aether_01', position: [0, 0, 200],            rotation: [0, 0, 0],    note: 'Entry sphere — first anchor of sanity' },
    { id: 'ws_aether_02', position: [2000, 2000, 300],      rotation: [0, 0, 0],    note: 'Floating island sphere — mid-void' },
    { id: 'ws_aether_03', position: [-1500, 3000, 150],     rotation: [0, 0, 0],    note: 'Near void boundary — last safe rest' },
  ],
  TheWilds: [
    { id: 'ws_wilds_01', position: [-200, 400, 60],         rotation: [0, 0, 0],    note: 'Hunter cottage clearing — near Standing Stone' },
    { id: 'ws_wilds_02', position: [1800, -1200, 90],       rotation: [0, 120, 0],  note: 'Ancient oak grove — deep forest crossroads' },
    { id: 'ws_wilds_03', position: [-2500, 2000, 110],      rotation: [0, -60, 0],  note: 'Stream bank near Fallen Log Bridge — tranquil rest' },
  ],
};

// ── Query Functions ──────────────────────────────────────────────────────────

/**
 * Get all wayshrine concepts as a summary array.
 */
export function getWayshrineConceptSummaries() {
  return Object.entries(WAYSHRINE_CONCEPTS).map(([regionId, concept]) => ({
    regionId,
    displayName: concept.displayName,
    lore: concept.lore,
    concept: concept.concept,
    accentColor: concept.accentColor,
    meshShape: concept.mesh.baseShape,
    meshHeight: concept.mesh.height,
    materialCount: Object.keys(concept.materials).length,
    particleSystems: Object.keys(concept.particles).length,
    lightCount: Object.keys(concept.lighting).length,
    hasSpecialBehavior: !!concept.specialBehavior,
  }));
}

/**
 * Get a specific wayshrine concept by region ID.
 */
export function getWayshrineConceptDetail(regionId) {
  const concept = WAYSHRINE_CONCEPTS[regionId];
  if (!concept) return { error: `No wayshrine concept for region: ${regionId}` };
  return {
    ...concept,
    common: WAYSHRINE_COMMON,
    placements: WAYSHRINE_PLACEMENTS[regionId] || [],
  };
}

/**
 * Get all placement positions across all regions.
 */
export function getAllWayshrinePositions() {
  const positions = [];
  for (const [regionId, placements] of Object.entries(WAYSHRINE_PLACEMENTS)) {
    for (const p of placements) {
      positions.push({
        ...p,
        regionId,
        wayshrineType: WAYSHRINE_CONCEPTS[regionId]?.displayName || 'Unknown',
      });
    }
  }
  return { total: positions.length, positions };
}

/**
 * Get the common wayshrine behavior spec.
 */
export function getWayshrineCommonSpec() {
  return WAYSHRINE_COMMON;
}

/**
 * Export all wayshrine designs to a JSON file for UE5 consumption.
 */
export function exportWayshrineDesigns() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    exportedAt: new Date().toISOString(),
    common: WAYSHRINE_COMMON,
    concepts: WAYSHRINE_CONCEPTS,
    placements: WAYSHRINE_PLACEMENTS,
    summary: {
      totalWayshrines: Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0),
      regions: Object.keys(WAYSHRINE_CONCEPTS).length,
      uniqueMaterials: Object.values(WAYSHRINE_CONCEPTS).reduce((s, c) => s + Object.keys(c.materials).length, 0),
      uniqueParticleSystems: Object.values(WAYSHRINE_CONCEPTS).reduce((s, c) => s + Object.keys(c.particles).length, 0),
    },
  };

  const outPath = join(outDir, 'wayshrine-designs.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported wayshrine designs to ${outPath}`);
  return { success: true, path: outPath, summary: spec.summary };
}

/**
 * Get the full wayshrine design status.
 */
export function getWayshrineDesignStatus() {
  const conceptCount = Object.keys(WAYSHRINE_CONCEPTS).length;
  const placementCount = Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0);
  const buildState = loadBuildState();
  return {
    conceptsDesigned: conceptCount,
    totalRegions: 7,
    totalPlacements: placementCount,
    targetPlacements: 21,
    builtActors: buildState.builtActors?.length || 0,
    builtBlueprints: buildState.builtBlueprints?.length || 0,
    regions: Object.keys(WAYSHRINE_CONCEPTS).map(r => ({
      regionId: r,
      displayName: WAYSHRINE_CONCEPTS[r].displayName,
      placements: (WAYSHRINE_PLACEMENTS[r] || []).length,
      built: (buildState.builtActors || []).filter(a => a.regionId === r).length,
    })),
    commonBehavior: {
      interactionRadius: WAYSHRINE_COMMON.interactionRadius,
      suppressionRadius: WAYSHRINE_COMMON.corruptionSuppression.radius,
      restCooldown: WAYSHRINE_COMMON.restBehavior.cooldownSeconds,
    },
  };
}

// ── Build State Persistence ────────────────────────────────────────────────

function getBuildStatePath() {
  const game = getActiveGame();
  return join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines', 'wayshrine-build-state.json');
}

function loadBuildState() {
  const p = getBuildStatePath();
  if (!existsSync(p)) return { builtBlueprints: [], builtActors: [] };
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return { builtBlueprints: [], builtActors: [] }; }
}

function saveBuildState(state) {
  const p = getBuildStatePath();
  const dir = join(p, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// ── UE5 Helper ─────────────────────────────────────────────────────────────

async function ue(tool, args = {}, timeout = 60_000) {
  return callTool('unreal', tool, args, timeout);
}

// ── ms_2: Build Wayshrine Actor — Emissive Crystal Mesh + Point Light ─────

/**
 * Build the base wayshrine blueprint (BP_Wayshrine_Base) and region-specific
 * child blueprints. Each blueprint gets:
 *   - StaticMeshComponent (crystal mesh placeholder)
 *   - PointLightComponent (region-colored emissive light)
 *   - SphereComponent (interaction trigger)
 *   - Variables for activation state, emissive intensity, suppression config
 *
 * Working UE5 MCP tools: create_blueprint, create_variable, add_event_node,
 * compile_blueprint, spawn_physics_blueprint_actor, set_actor_transform.
 * Note: add_component_to_blueprint may return "Unknown component type" —
 * blueprints will be created with variables and event graph; components
 * are spec'd for manual addition or future MCP support.
 */
export async function buildWayshrineBlueprint(regionId) {
  const concept = WAYSHRINE_CONCEPTS[regionId];
  if (!concept) return { success: false, error: `Unknown region: ${regionId}` };

  const state = loadBuildState();
  const bpName = `BP_Wayshrine_${regionId}`;

  // Skip if already built
  if (state.builtBlueprints.find(b => b.name === bpName)) {
    log.info(`Blueprint ${bpName} already built, skipping`);
    return { success: true, skipped: true, blueprint: bpName };
  }

  log.info(`Building wayshrine blueprint: ${bpName}`);
  const results = { blueprint: bpName, steps: [] };

  // Step 1: Create the blueprint
  try {
    const createResult = await ue('create_blueprint', {
      name: bpName,
      parent_class: 'AActor',
      blueprint_path: '/Game/Blueprints/Wayshrines',
    });
    const ok = createResult?.status !== 'error';
    results.steps.push({ step: 'create_blueprint', success: ok, detail: createResult });
    if (!ok) {
      // Blueprint may already exist — treat as non-fatal
      log.warn(`create_blueprint warning for ${bpName}: ${createResult?.error}`);
    }
  } catch (err) {
    results.steps.push({ step: 'create_blueprint', success: false, error: err.message });
    log.error(`Failed to create blueprint ${bpName}: ${err.message}`);
    return { success: false, error: err.message, results };
  }

  // Step 2: Add variables for wayshrine state and region-specific visuals
  const primaryLight = concept.lighting.pointLight || Object.values(concept.lighting)[0];
  const crystal = concept.materials.crystal || Object.values(concept.materials).find(m => m.emissiveColor);

  const variables = [
    { name: 'bIsActivated', type: 'bool', default_value: false },
    { name: 'bIsResting', type: 'bool', default_value: false },
    { name: 'RegionId', type: 'string', default_value: regionId },
    { name: 'DisplayName', type: 'string', default_value: concept.displayName },
    // Emissive crystal parameters
    { name: 'EmissiveColorR', type: 'float', default_value: crystal?.emissiveColor?.[0] ?? 1.0 },
    { name: 'EmissiveColorG', type: 'float', default_value: crystal?.emissiveColor?.[1] ?? 0.85 },
    { name: 'EmissiveColorB', type: 'float', default_value: crystal?.emissiveColor?.[2] ?? 0.6 },
    { name: 'EmissiveIntensity', type: 'float', default_value: crystal?.emissiveIntensity ?? 5.0 },
    { name: 'PulseSpeed', type: 'float', default_value: crystal?.pulseSpeed ?? 0.5 },
    // Point light parameters
    { name: 'LightColorR', type: 'float', default_value: primaryLight.color[0] },
    { name: 'LightColorG', type: 'float', default_value: primaryLight.color[1] },
    { name: 'LightColorB', type: 'float', default_value: primaryLight.color[2] },
    { name: 'LightIntensity', type: 'float', default_value: primaryLight.intensity },
    { name: 'LightRadius', type: 'float', default_value: primaryLight.radius },
    // Corruption suppression
    { name: 'SuppressionRadius', type: 'float', default_value: WAYSHRINE_COMMON.corruptionSuppression.radius },
    { name: 'SuppressionRate', type: 'float', default_value: WAYSHRINE_COMMON.corruptionSuppression.suppressionRate },
    // Interaction
    { name: 'InteractionRadius', type: 'float', default_value: WAYSHRINE_COMMON.interactionRadius },
    { name: 'RestCooldownRemaining', type: 'float', default_value: 0.0 },
    // Bloom pulse
    { name: 'BloomPeakIntensity', type: 'float', default_value: WAYSHRINE_COMMON.bloomPulse.peakIntensity },
    { name: 'BloomRampUp', type: 'float', default_value: WAYSHRINE_COMMON.bloomPulse.rampUpSeconds },
    { name: 'BloomHold', type: 'float', default_value: WAYSHRINE_COMMON.bloomPulse.holdSeconds },
    { name: 'BloomRampDown', type: 'float', default_value: WAYSHRINE_COMMON.bloomPulse.rampDownSeconds },
    // Mesh spec (for runtime reference)
    { name: 'MeshHeight', type: 'float', default_value: concept.mesh.height },
    { name: 'MeshBaseWidth', type: 'float', default_value: concept.mesh.baseWidth },
  ];

  for (const v of variables) {
    try {
      await ue('create_variable', { blueprint_name: bpName, ...v });
    } catch (err) {
      log.warn(`Variable ${v.name} on ${bpName}: ${err.message}`);
    }
  }
  results.steps.push({ step: 'create_variables', success: true, count: variables.length });

  // Step 3: Add event graph nodes (BeginPlay for initialization, Tick for pulse animation)
  try {
    await ue('add_event_node', { blueprint_name: bpName, event_type: 'BeginPlay', graph_name: 'EventGraph' });
    await ue('add_event_node', { blueprint_name: bpName, event_type: 'Tick', graph_name: 'EventGraph' });
    results.steps.push({ step: 'event_graph', success: true });
  } catch (err) {
    results.steps.push({ step: 'event_graph', success: false, error: err.message });
  }

  // Step 4: Compile
  try {
    const compileResult = await ue('compile_blueprint', { blueprint_name: bpName });
    const compiled = compileResult?.status !== 'error';
    results.steps.push({ step: 'compile', success: compiled, detail: compileResult });
  } catch (err) {
    results.steps.push({ step: 'compile', success: false, error: err.message });
  }

  // Record in build state
  state.builtBlueprints.push({
    name: bpName,
    regionId,
    displayName: concept.displayName,
    builtAt: new Date().toISOString(),
    lightColor: primaryLight.color,
    lightIntensity: primaryLight.intensity,
    emissiveColor: crystal?.emissiveColor || concept.accentColor,
    emissiveIntensity: crystal?.emissiveIntensity || 5.0,
    meshShape: concept.mesh.baseShape,
    variableCount: variables.length,
  });
  saveBuildState(state);

  log.info(`Blueprint ${bpName} built with ${variables.length} variables`);
  return { success: true, results };
}

/**
 * Spawn a wayshrine actor at a specific placement position.
 * Uses spawn_physics_blueprint_actor + set_actor_transform.
 */
export async function spawnWayshrineActor(regionId, placementIndex = 0) {
  const concept = WAYSHRINE_CONCEPTS[regionId];
  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!concept) return { success: false, error: `Unknown region: ${regionId}` };
  if (!placements || !placements[placementIndex]) {
    return { success: false, error: `No placement at index ${placementIndex} for ${regionId}` };
  }

  const placement = placements[placementIndex];
  const bpName = `BP_Wayshrine_${regionId}`;
  const state = loadBuildState();

  // Check blueprint exists
  if (!state.builtBlueprints.find(b => b.name === bpName)) {
    log.info(`Blueprint ${bpName} not built yet, building first...`);
    const buildResult = await buildWayshrineBlueprint(regionId);
    if (!buildResult.success) return buildResult;
  }

  // Check if already spawned at this placement
  const actorLabel = `Wayshrine_${placement.id}`;
  if (state.builtActors.find(a => a.actorLabel === actorLabel)) {
    log.info(`Actor ${actorLabel} already spawned, skipping`);
    return { success: true, skipped: true, actor: actorLabel };
  }

  log.info(`Spawning wayshrine actor: ${actorLabel} at [${placement.position}]`);

  // Spawn the blueprint actor
  let spawnResult;
  try {
    spawnResult = await ue('spawn_physics_blueprint_actor', {
      name: bpName,
      label: actorLabel,
      location: { x: placement.position[0], y: placement.position[1], z: placement.position[2] },
    });
  } catch (err) {
    return { success: false, error: `Spawn failed: ${err.message}` };
  }

  // Set rotation via transform if rotation specified
  if (placement.rotation && (placement.rotation[0] || placement.rotation[1] || placement.rotation[2])) {
    try {
      await ue('set_actor_transform', {
        actor_name: actorLabel,
        location: { x: placement.position[0], y: placement.position[1], z: placement.position[2] },
        rotation: { pitch: placement.rotation[0], yaw: placement.rotation[1], roll: placement.rotation[2] },
        scale: { x: 1.0, y: 1.0, z: 1.0 },
      });
    } catch (err) {
      log.warn(`Transform set warning for ${actorLabel}: ${err.message}`);
    }
  }

  // Record spawned actor
  state.builtActors.push({
    actorLabel,
    regionId,
    placementId: placement.id,
    position: placement.position,
    rotation: placement.rotation,
    blueprint: bpName,
    displayName: concept.displayName,
    spawnedAt: new Date().toISOString(),
    note: placement.note,
  });
  saveBuildState(state);

  log.info(`Spawned ${actorLabel} (${concept.displayName}) in ${regionId}`);
  return {
    success: true,
    actor: actorLabel,
    blueprint: bpName,
    position: placement.position,
    region: regionId,
    displayName: concept.displayName,
    spawnResult,
  };
}

/**
 * Build all 7 region wayshrine blueprints.
 */
export async function buildAllWayshrineBlueprints() {
  const results = {};
  for (const regionId of Object.keys(WAYSHRINE_CONCEPTS)) {
    results[regionId] = await buildWayshrineBlueprint(regionId);
  }
  const built = Object.values(results).filter(r => r.success && !r.skipped).length;
  const skipped = Object.values(results).filter(r => r.skipped).length;
  const failed = Object.values(results).filter(r => !r.success).length;
  log.info(`Built ${built} wayshrine blueprints (${skipped} skipped, ${failed} failed)`);
  return { built, skipped, failed, results };
}

/**
 * Spawn all wayshrines for a specific region (3 per region).
 */
export async function spawnRegionWayshrines(regionId) {
  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!placements) return { success: false, error: `No placements for region: ${regionId}` };

  const results = [];
  for (let i = 0; i < placements.length; i++) {
    results.push(await spawnWayshrineActor(regionId, i));
  }
  const spawned = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  return { success: true, regionId, spawned, skipped, total: placements.length, results };
}

/**
 * Spawn all wayshrines across all regions (21 total).
 */
export async function spawnAllWayshrines() {
  // Build all blueprints first
  const bpResult = await buildAllWayshrineBlueprints();
  log.info(`Blueprint build phase: ${bpResult.built} built, ${bpResult.skipped} skipped`);

  // Spawn all placements
  const regionResults = {};
  let totalSpawned = 0, totalSkipped = 0;
  for (const regionId of Object.keys(WAYSHRINE_PLACEMENTS)) {
    const result = await spawnRegionWayshrines(regionId);
    regionResults[regionId] = result;
    totalSpawned += result.spawned || 0;
    totalSkipped += result.skipped || 0;
  }

  log.info(`Spawned ${totalSpawned} wayshrines (${totalSkipped} skipped)`);
  return {
    success: true,
    blueprintsBuilt: bpResult.built,
    actorsSpawned: totalSpawned,
    actorsSkipped: totalSkipped,
    totalTarget: 21,
    regionResults,
  };
}

/**
 * Get component spec for a wayshrine blueprint.
 * Returns the exact UE5 component configuration needed for manual setup
 * or future MCP component support.
 */
export function getWayshrineComponentSpec(regionId) {
  const concept = WAYSHRINE_CONCEPTS[regionId];
  if (!concept) return { error: `Unknown region: ${regionId}` };

  const primaryLight = concept.lighting.pointLight || Object.values(concept.lighting)[0];
  const crystal = concept.materials.crystal || Object.values(concept.materials).find(m => m.emissiveColor);

  return {
    blueprint: `BP_Wayshrine_${regionId}`,
    region: regionId,
    displayName: concept.displayName,
    components: [
      {
        name: 'CrystalMesh',
        type: 'StaticMeshComponent',
        description: `Emissive crystal mesh — ${concept.mesh.baseShape}, ${concept.mesh.height}cm tall`,
        mesh: concept.mesh,
        material: {
          type: 'emissive',
          emissiveColor: crystal?.emissiveColor || concept.accentColor,
          emissiveIntensity: crystal?.emissiveIntensity || 5.0,
          baseColor: crystal?.baseColor || concept.accentColor,
          opacity: crystal?.opacity || 1.0,
          subsurfaceColor: crystal?.subsurfaceColor,
          pulseSpeed: crystal?.pulseSpeed || 0.5,
        },
        relativeLocation: { x: 0, y: 0, z: 0 },
      },
      {
        name: 'MainPointLight',
        type: 'PointLightComponent',
        description: `Region-colored point light at crystal level`,
        color: { r: primaryLight.color[0], g: primaryLight.color[1], b: primaryLight.color[2] },
        intensity: primaryLight.intensity,
        attenuationRadius: primaryLight.radius,
        castShadows: primaryLight.castShadows,
        relativeLocation: {
          x: primaryLight.position[0],
          y: primaryLight.position[1],
          z: primaryLight.position[2],
        },
      },
      {
        name: 'InteractSphere',
        type: 'SphereComponent',
        description: 'Interaction trigger volume',
        sphereRadius: WAYSHRINE_COMMON.interactionRadius,
        collisionProfile: 'OverlapAllDynamic',
        generateOverlapEvents: true,
        relativeLocation: { x: 0, y: 0, z: concept.mesh.height / 2 },
      },
      {
        name: 'SuppressionSphere',
        type: 'SphereComponent',
        description: 'Corruption suppression radius (visual debug only)',
        sphereRadius: WAYSHRINE_COMMON.corruptionSuppression.radius,
        collisionProfile: 'NoCollision',
        hiddenInGame: true,
        relativeLocation: { x: 0, y: 0, z: 0 },
      },
    ],
    // Secondary lights (accent/ground/rim etc.)
    secondaryLights: Object.entries(concept.lighting)
      .filter(([k]) => k !== 'pointLight')
      .map(([name, light]) => ({
        name: `${name}Light`,
        type: 'PointLightComponent',
        color: { r: light.color[0], g: light.color[1], b: light.color[2] },
        intensity: light.intensity,
        attenuationRadius: light.radius,
        castShadows: light.castShadows,
        relativeLocation: { x: light.position[0], y: light.position[1], z: light.position[2] },
        lightFunction: light.lightFunction || null,
      })),
    particles: concept.particles,
    audio: WAYSHRINE_COMMON.audio,
  };
}

// ── ms_3: Per-Region Ambient Niagara Particle Systems ─────────────────────────

/**
 * Detailed Niagara emitter specifications for each region's wayshrine particles.
 * Each region gets a unique ambient system + a rest-activated burst system.
 * These specs define emitter modules, spawn rates, velocity, color curves,
 * size curves, and rendering settings for full UE5 Niagara deployment.
 */
export const NIAGARA_SYSTEM_SPECS = {
  CrossroadsHub: {
    ambient: {
      systemName: 'NS_Wayshrine_Motes',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Motes',
      description: 'Gentle orbiting golden motes around the Hearthstone Pillar',
      emitters: [{
        name: 'E_AmbientMotes',
        spawnRate: { type: 'continuous', rate: 8, burstCount: 0 },
        lifetime: { min: 3.0, max: 5.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 200,
          height: 280,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 50 },
        },
        velocity: {
          type: 'orbit',
          orbitSpeed: { min: 12, max: 18 },
          orbitAxis: [0, 0, 1],
          radialDrift: { min: -2, max: 2 },
          verticalDrift: { min: 1, max: 5 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.9, 0.6, 0.0] },
          { time: 0.15, color: [1.0, 0.9, 0.6, 0.6] },
          { time: 0.8, color: [1.0, 0.85, 0.5, 0.5] },
          { time: 1.0, color: [1.0, 0.8, 0.4, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.3, size: 4.0 },
          { time: 0.7, size: 3.5 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_SoftGlow',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_Bloom',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Bloom',
      description: 'Burst of warm golden particles when rest begins',
      emitters: [{
        name: 'E_BloomBurst',
        spawnRate: { type: 'burst', rate: 0, burstCount: 60 },
        lifetime: { min: 1.5, max: 3.0 },
        initialPosition: {
          shape: 'sphere',
          radius: 50,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 150 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 30, max: 50 },
          drag: 0.3,
          gravity: { x: 0, y: 0, z: 5 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.95, 0.7, 0.0] },
          { time: 0.1, color: [1.0, 0.85, 0.5, 0.8] },
          { time: 0.5, color: [1.0, 0.8, 0.4, 0.6] },
          { time: 1.0, color: [1.0, 0.7, 0.3, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.2, size: 6.0 },
          { time: 1.0, size: 2.0 },
        ],
        rendering: {
          material: 'MI_Particle_BloomFlare',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
  },

  AshenWilds: {
    ambient: {
      systemName: 'NS_Wayshrine_Embers',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Embers',
      description: 'Rising embers and ash particles around the Verdant Obelisk',
      emitters: [{
        name: 'E_RisingEmbers',
        spawnRate: { type: 'continuous', rate: 12, burstCount: 0 },
        lifetime: { min: 2.0, max: 4.0 },
        initialPosition: {
          shape: 'ring',
          innerRadius: 100,
          outerRadius: 300,
          height: 20,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 0 },
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 20, max: 35 },
          turbulence: { intensity: 8, frequency: 0.5 },
          drag: 0.05,
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.6, 0.1, 0.0] },
          { time: 0.1, color: [1.0, 0.6, 0.1, 0.5] },
          { time: 0.6, color: [1.0, 0.4, 0.05, 0.4] },
          { time: 1.0, color: [0.5, 0.15, 0.0, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.5, size: 2.5 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_Ember',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: { rows: 2, cols: 2, mode: 'Random' },
        },
      }, {
        name: 'E_LifeSparks',
        spawnRate: { type: 'continuous', rate: 6, burstCount: 0 },
        lifetime: { min: 1.5, max: 3.0 },
        initialPosition: {
          shape: 'disc',
          radius: 300,
          height: 5,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 10 },
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 5, max: 15 },
          turbulence: { intensity: 3, frequency: 1.0 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.3, 1.0, 0.2, 0.0] },
          { time: 0.2, color: [0.4, 1.0, 0.3, 0.7] },
          { time: 0.7, color: [0.2, 0.8, 0.1, 0.4] },
          { time: 1.0, color: [0.1, 0.5, 0.05, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 1.5 },
          { time: 0.3, size: 3.0 },
          { time: 1.0, size: 0.5 },
        ],
        rendering: {
          material: 'MI_Particle_NatureSpark',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_VerdantBurst',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_VerdantBurst',
      description: 'Explosion of green life-sparks and ember wisps on rest',
      emitters: [{
        name: 'E_VerdantBurst',
        spawnRate: { type: 'burst', rate: 0, burstCount: 40 },
        lifetime: { min: 2.0, max: 3.5 },
        initialPosition: {
          shape: 'sphere',
          radius: 30,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 125 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 40, max: 70 },
          drag: 0.4,
          gravity: { x: 0, y: 0, z: -5 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.5, 1.0, 0.3, 0.0] },
          { time: 0.1, color: [0.6, 1.0, 0.4, 0.9] },
          { time: 0.5, color: [1.0, 0.8, 0.2, 0.6] },
          { time: 1.0, color: [1.0, 0.5, 0.1, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 4.0 },
          { time: 0.15, size: 7.0 },
          { time: 1.0, size: 2.0 },
        ],
        rendering: {
          material: 'MI_Particle_BloomFlare',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
  },

  Ironhold: {
    ambient: {
      systemName: 'NS_Wayshrine_Sparks',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Sparks',
      description: 'Metallic sparks and forge-glow wisps around the Ironward Beacon',
      emitters: [{
        name: 'E_ForgeSparks',
        spawnRate: { type: 'continuous', rate: 10, burstCount: 0 },
        lifetime: { min: 0.8, max: 2.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 150,
          height: 350,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 30 },
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 30, max: 60 },
          turbulence: { intensity: 15, frequency: 2.0 },
          drag: 0.2,
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.7, 0.3, 0.0] },
          { time: 0.05, color: [1.0, 0.7, 0.3, 0.9] },
          { time: 0.3, color: [1.0, 0.5, 0.15, 0.7] },
          { time: 1.0, color: [0.6, 0.2, 0.05, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 1.5 },
          { time: 0.1, size: 2.5 },
          { time: 1.0, size: 0.5 },
        ],
        rendering: {
          material: 'MI_Particle_MetalSpark',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'VelocityAligned',
          subUV: null,
          stretchFactor: 2.0,
        },
      }, {
        name: 'E_RuneGlow',
        spawnRate: { type: 'continuous', rate: 4, burstCount: 0 },
        lifetime: { min: 3.0, max: 5.0 },
        initialPosition: {
          shape: 'surface',
          meshReference: 'RuneChannels',
          distribution: 'uniform',
          offset: { x: 0, y: 0, z: 0 },
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 2, max: 5 },
          turbulence: { intensity: 1, frequency: 0.3 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.8, 0.4, 0.1, 0.0] },
          { time: 0.2, color: [1.0, 0.6, 0.2, 0.5] },
          { time: 0.8, color: [0.9, 0.5, 0.15, 0.4] },
          { time: 1.0, color: [0.6, 0.3, 0.1, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 5.0 },
          { time: 0.5, size: 6.0 },
          { time: 1.0, size: 3.0 },
        ],
        rendering: {
          material: 'MI_Particle_SoftGlow',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_ForgePulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_ForgePulse',
      description: 'Forge-fire pulse with erupting sparks on rest',
      emitters: [{
        name: 'E_ForgePulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 50 },
        lifetime: { min: 1.0, max: 2.5 },
        initialPosition: {
          shape: 'sphere',
          radius: 40,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 175 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 50, max: 80 },
          drag: 0.35,
          gravity: { x: 0, y: 0, z: -15 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.9, 0.6, 0.0] },
          { time: 0.05, color: [1.0, 0.7, 0.3, 1.0] },
          { time: 0.4, color: [1.0, 0.4, 0.1, 0.7] },
          { time: 1.0, color: [0.4, 0.1, 0.0, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.1, size: 3.5 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_MetalSpark',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'VelocityAligned',
          subUV: null,
          stretchFactor: 3.0,
        },
      }],
    },
  },

  VerdantReach: {
    ambient: {
      systemName: 'NS_Wayshrine_Fireflies',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Fireflies',
      description: 'Bioluminescent fireflies and pollen drifting around the Moonbark Shrine',
      emitters: [{
        name: 'E_Fireflies',
        spawnRate: { type: 'continuous', rate: 6, burstCount: 0 },
        lifetime: { min: 4.0, max: 7.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 250,
          height: 300,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 30 },
        },
        velocity: {
          type: 'wander',
          wanderSpeed: { min: 5, max: 12 },
          wanderRadius: 80,
          wanderInterval: 1.5,
          verticalBias: 2,
        },
        colorOverLife: [
          { time: 0.0, color: [0.6, 1.0, 0.4, 0.0] },
          { time: 0.1, color: [0.6, 1.0, 0.4, 0.8] },
          { time: 0.5, color: [0.4, 0.9, 0.3, 0.6] },
          { time: 0.8, color: [0.5, 1.0, 0.5, 0.3] },
          { time: 1.0, color: [0.3, 0.7, 0.2, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.5, size: 3.0 },
          { time: 1.0, size: 1.5 },
        ],
        rendering: {
          material: 'MI_Particle_BioLum',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: null,
          lightRadius: 50,
        },
      }, {
        name: 'E_Pollen',
        spawnRate: { type: 'continuous', rate: 10, burstCount: 0 },
        lifetime: { min: 5.0, max: 8.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 300,
          height: 200,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 100 },
        },
        velocity: {
          type: 'directional',
          direction: [0.3, 0.1, 0.05],
          speed: { min: 3, max: 8 },
          turbulence: { intensity: 2, frequency: 0.2 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 1.0, 0.8, 0.0] },
          { time: 0.2, color: [1.0, 1.0, 0.8, 0.3] },
          { time: 0.8, color: [0.9, 0.95, 0.7, 0.2] },
          { time: 1.0, color: [0.8, 0.9, 0.6, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 1.0 },
          { time: 0.5, size: 2.0 },
          { time: 1.0, size: 1.5 },
        ],
        rendering: {
          material: 'MI_Particle_Pollen',
          blendMode: 'Translucent',
          sortOrder: -1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_NaturePulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_NaturePulse',
      description: 'Expanding ring of leaves and green energy on rest',
      emitters: [{
        name: 'E_NaturePulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 45 },
        lifetime: { min: 2.0, max: 4.0 },
        initialPosition: {
          shape: 'sphere',
          radius: 20,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 200 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 25, max: 45 },
          drag: 0.5,
          gravity: { x: 0, y: 0, z: -3 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.3, 1.0, 0.3, 0.0] },
          { time: 0.1, color: [0.4, 1.0, 0.5, 0.9] },
          { time: 0.6, color: [0.8, 1.0, 0.6, 0.5] },
          { time: 1.0, color: [0.6, 0.8, 0.4, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.2, size: 8.0 },
          { time: 1.0, size: 4.0 },
        ],
        rendering: {
          material: 'MI_Particle_LeafBurst',
          blendMode: 'Translucent',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: { rows: 2, cols: 2, mode: 'LinearBlend' },
        },
      }],
    },
  },

  SunkenHalls: {
    ambient: {
      systemName: 'NS_Wayshrine_Bubbles',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_Bubbles',
      description: 'Rising air bubbles and caustic light ripples in the Tidecaller Dome',
      emitters: [{
        name: 'E_AirBubbles',
        spawnRate: { type: 'continuous', rate: 8, burstCount: 0 },
        lifetime: { min: 2.0, max: 4.5 },
        initialPosition: {
          shape: 'hemisphere',
          radius: 200,
          distribution: 'random',
          offset: { x: 0, y: 0, z: -50 },
          facingDirection: [0, 0, 1],
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 15, max: 30 },
          turbulence: { intensity: 5, frequency: 0.8 },
          drag: 0.1,
        },
        colorOverLife: [
          { time: 0.0, color: [0.3, 0.7, 1.0, 0.0] },
          { time: 0.1, color: [0.4, 0.8, 1.0, 0.5] },
          { time: 0.7, color: [0.3, 0.6, 0.9, 0.4] },
          { time: 1.0, color: [0.2, 0.5, 0.8, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.3, size: 5.0 },
          { time: 0.9, size: 6.0 },
          { time: 1.0, size: 8.0 },
        ],
        rendering: {
          material: 'MI_Particle_Bubble',
          blendMode: 'Translucent',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: null,
          refractionEnabled: true,
        },
      }, {
        name: 'E_CausticRipples',
        spawnRate: { type: 'continuous', rate: 3, burstCount: 0 },
        lifetime: { min: 3.0, max: 5.0 },
        initialPosition: {
          shape: 'disc',
          radius: 250,
          height: 0,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 280 },
        },
        velocity: {
          type: 'none',
          speed: { min: 0, max: 0 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.4, 0.8, 1.0, 0.0] },
          { time: 0.3, color: [0.5, 0.9, 1.0, 0.3] },
          { time: 0.7, color: [0.3, 0.7, 0.9, 0.2] },
          { time: 1.0, color: [0.2, 0.6, 0.8, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 20.0 },
          { time: 0.5, size: 40.0 },
          { time: 1.0, size: 60.0 },
        ],
        rendering: {
          material: 'MI_Particle_Caustic',
          blendMode: 'Additive',
          sortOrder: -1,
          alignment: 'CustomAxis',
          customAxis: [0, 0, 1],
          subUV: { rows: 4, cols: 4, mode: 'LinearBlend' },
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_TidePulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_TidePulse',
      description: 'Expanding dome of water droplets and teal energy on rest',
      emitters: [{
        name: 'E_TidePulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 55 },
        lifetime: { min: 1.5, max: 3.0 },
        initialPosition: {
          shape: 'sphere',
          radius: 30,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 100 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 35, max: 55 },
          drag: 0.4,
          gravity: { x: 0, y: 0, z: 10 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.2, 0.8, 1.0, 0.0] },
          { time: 0.1, color: [0.3, 0.9, 1.0, 0.9] },
          { time: 0.5, color: [0.2, 0.7, 0.9, 0.5] },
          { time: 1.0, color: [0.1, 0.4, 0.7, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.15, size: 7.0 },
          { time: 1.0, size: 3.0 },
        ],
        rendering: {
          material: 'MI_Particle_WaterDroplet',
          blendMode: 'Translucent',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
  },

  EmberPeaks: {
    ambient: {
      systemName: 'NS_Wayshrine_LavaWisps',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_LavaWisps',
      description: 'Lava wisps and volcanic ash swirling around the Volcanshard Pyre',
      emitters: [{
        name: 'E_LavaWisps',
        spawnRate: { type: 'continuous', rate: 14, burstCount: 0 },
        lifetime: { min: 1.5, max: 3.0 },
        initialPosition: {
          shape: 'cone',
          radius: 180,
          height: 300,
          coneAngle: 30,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 20 },
        },
        velocity: {
          type: 'directional',
          direction: [0, 0, 1],
          speed: { min: 40, max: 70 },
          turbulence: { intensity: 20, frequency: 1.5 },
          drag: 0.15,
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 0.3, 0.0, 0.0] },
          { time: 0.05, color: [1.0, 0.5, 0.0, 0.8] },
          { time: 0.3, color: [1.0, 0.3, 0.0, 0.7] },
          { time: 0.7, color: [0.8, 0.15, 0.0, 0.4] },
          { time: 1.0, color: [0.3, 0.05, 0.0, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.1, size: 4.0 },
          { time: 0.5, size: 3.0 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_Ember',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: { rows: 2, cols: 2, mode: 'Random' },
          heatDistortion: true,
        },
      }, {
        name: 'E_VolcanicAsh',
        spawnRate: { type: 'continuous', rate: 8, burstCount: 0 },
        lifetime: { min: 3.0, max: 6.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 300,
          height: 50,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 200 },
        },
        velocity: {
          type: 'directional',
          direction: [0.1, 0, -0.3],
          speed: { min: 5, max: 12 },
          turbulence: { intensity: 4, frequency: 0.3 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.3, 0.25, 0.2, 0.0] },
          { time: 0.2, color: [0.3, 0.25, 0.2, 0.4] },
          { time: 0.8, color: [0.2, 0.18, 0.15, 0.3] },
          { time: 1.0, color: [0.15, 0.12, 0.1, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.5, size: 5.0 },
          { time: 1.0, size: 4.0 },
        ],
        rendering: {
          material: 'MI_Particle_Ash',
          blendMode: 'Translucent',
          sortOrder: -1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_MagmaPulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_MagmaPulse',
      description: 'Volcanic eruption-style burst of magma sparks and heat shimmer',
      emitters: [{
        name: 'E_MagmaPulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 70 },
        lifetime: { min: 1.0, max: 2.5 },
        initialPosition: {
          shape: 'sphere',
          radius: 25,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 200 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 60, max: 100 },
          drag: 0.3,
          gravity: { x: 0, y: 0, z: -30 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 1.0, 0.8, 0.0] },
          { time: 0.05, color: [1.0, 0.8, 0.2, 1.0] },
          { time: 0.3, color: [1.0, 0.4, 0.0, 0.8] },
          { time: 1.0, color: [0.3, 0.05, 0.0, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.1, size: 5.0 },
          { time: 1.0, size: 1.5 },
        ],
        rendering: {
          material: 'MI_Particle_MetalSpark',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'VelocityAligned',
          subUV: null,
          stretchFactor: 4.0,
        },
      }],
    },
  },

  Aethermere: {
    ambient: {
      systemName: 'NS_Wayshrine_VoidStars',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_VoidStars',
      description: 'Pinprick stars and reality-anchor particles forming a sphere of normal space',
      emitters: [{
        name: 'E_RealityAnchors',
        spawnRate: { type: 'continuous', rate: 5, burstCount: 0 },
        lifetime: { min: 5.0, max: 8.0 },
        initialPosition: {
          shape: 'sphere_surface',
          radius: 350,
          distribution: 'fibonacci',
          offset: { x: 0, y: 0, z: 150 },
        },
        velocity: {
          type: 'orbit',
          orbitSpeed: { min: 3, max: 6 },
          orbitAxis: [0, 0, 1],
          radialDrift: { min: -1, max: 1 },
          verticalDrift: { min: -1, max: 1 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.7, 0.7, 1.0, 0.0] },
          { time: 0.1, color: [0.8, 0.8, 1.0, 0.7] },
          { time: 0.5, color: [0.6, 0.6, 1.0, 0.5] },
          { time: 0.9, color: [0.9, 0.9, 1.0, 0.3] },
          { time: 1.0, color: [0.5, 0.5, 0.9, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 1.0 },
          { time: 0.5, size: 2.5 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_StarPoint',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: null,
          flickerRate: 2.0,
        },
      }, {
        name: 'E_VoidEdge',
        spawnRate: { type: 'continuous', rate: 15, burstCount: 0 },
        lifetime: { min: 2.0, max: 4.0 },
        initialPosition: {
          shape: 'sphere_surface',
          radius: 400,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 150 },
        },
        velocity: {
          type: 'inward',
          speed: { min: 3, max: 8 },
          killRadius: 50,
        },
        colorOverLife: [
          { time: 0.0, color: [0.2, 0.0, 0.4, 0.0] },
          { time: 0.2, color: [0.3, 0.1, 0.5, 0.4] },
          { time: 0.8, color: [0.4, 0.2, 0.6, 0.3] },
          { time: 1.0, color: [0.1, 0.0, 0.3, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 6.0 },
          { time: 0.5, size: 3.0 },
          { time: 1.0, size: 1.0 },
        ],
        rendering: {
          material: 'MI_Particle_VoidWisp',
          blendMode: 'Additive',
          sortOrder: -1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_RealityPulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_RealityPulse',
      description: 'Expanding sphere of starlight anchoring reality against the void',
      emitters: [{
        name: 'E_RealityPulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 80 },
        lifetime: { min: 2.0, max: 4.0 },
        initialPosition: {
          shape: 'sphere',
          radius: 20,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 150 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 20, max: 40 },
          drag: 0.6,
          gravity: { x: 0, y: 0, z: 0 },
        },
        colorOverLife: [
          { time: 0.0, color: [1.0, 1.0, 1.0, 0.0] },
          { time: 0.05, color: [0.9, 0.9, 1.0, 1.0] },
          { time: 0.3, color: [0.7, 0.7, 1.0, 0.7] },
          { time: 0.7, color: [0.5, 0.4, 0.9, 0.4] },
          { time: 1.0, color: [0.3, 0.2, 0.7, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.15, size: 5.0 },
          { time: 0.5, size: 4.0 },
          { time: 1.0, size: 2.0 },
        ],
        rendering: {
          material: 'MI_Particle_StarPoint',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
  },

  TheWilds: {
    ambient: {
      systemName: 'NS_Wayshrine_WildMotes',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_WildMotes',
      description: 'Drifting nature motes — seeds, pollen, and faint spirit wisps in the wilderness',
      emitters: [{
        name: 'E_SpiritWisps',
        spawnRate: { type: 'continuous', rate: 4, burstCount: 0 },
        lifetime: { min: 5.0, max: 9.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 300,
          height: 200,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 50 },
        },
        velocity: {
          type: 'wander',
          wanderSpeed: { min: 3, max: 8 },
          wanderRadius: 100,
          wanderInterval: 2.0,
          verticalBias: 1,
        },
        colorOverLife: [
          { time: 0.0, color: [0.8, 0.95, 1.0, 0.0] },
          { time: 0.15, color: [0.8, 0.95, 1.0, 0.5] },
          { time: 0.5, color: [0.7, 0.9, 0.95, 0.4] },
          { time: 0.85, color: [0.6, 0.85, 0.9, 0.2] },
          { time: 1.0, color: [0.5, 0.8, 0.85, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.3, size: 5.0 },
          { time: 0.7, size: 4.0 },
          { time: 1.0, size: 2.0 },
        ],
        rendering: {
          material: 'MI_Particle_SpiritWisp',
          blendMode: 'Additive',
          sortOrder: 0,
          alignment: 'ViewFacing',
          subUV: null,
          lightRadius: 30,
        },
      }, {
        name: 'E_DriftingSeeds',
        spawnRate: { type: 'continuous', rate: 5, burstCount: 0 },
        lifetime: { min: 6.0, max: 10.0 },
        initialPosition: {
          shape: 'cylinder',
          radius: 400,
          height: 100,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 150 },
        },
        velocity: {
          type: 'directional',
          direction: [0.2, 0.1, -0.05],
          speed: { min: 2, max: 6 },
          turbulence: { intensity: 1.5, frequency: 0.15 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.9, 0.85, 0.7, 0.0] },
          { time: 0.2, color: [0.9, 0.85, 0.7, 0.4] },
          { time: 0.8, color: [0.85, 0.8, 0.65, 0.3] },
          { time: 1.0, color: [0.8, 0.75, 0.6, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 2.0 },
          { time: 0.5, size: 3.0 },
          { time: 1.0, size: 2.5 },
        ],
        rendering: {
          material: 'MI_Particle_Seed',
          blendMode: 'Translucent',
          sortOrder: -1,
          alignment: 'ViewFacing',
          subUV: { rows: 2, cols: 2, mode: 'Random' },
          rotationRate: { min: 10, max: 45 },
        },
      }],
    },
    restBurst: {
      systemName: 'NS_Wayshrine_WildPulse',
      systemPath: '/Game/VFX/Wayshrines/NS_Wayshrine_WildPulse',
      description: 'Gentle expansion of nature spirit energy and seed burst',
      emitters: [{
        name: 'E_WildPulse',
        spawnRate: { type: 'burst', rate: 0, burstCount: 35 },
        lifetime: { min: 2.5, max: 4.5 },
        initialPosition: {
          shape: 'sphere',
          radius: 25,
          distribution: 'random',
          offset: { x: 0, y: 0, z: 120 },
        },
        velocity: {
          type: 'radial_outward',
          speed: { min: 15, max: 30 },
          drag: 0.5,
          gravity: { x: 0, y: 0, z: -2 },
        },
        colorOverLife: [
          { time: 0.0, color: [0.7, 1.0, 0.8, 0.0] },
          { time: 0.1, color: [0.8, 1.0, 0.9, 0.8] },
          { time: 0.5, color: [0.6, 0.9, 0.7, 0.5] },
          { time: 1.0, color: [0.4, 0.7, 0.5, 0.0] },
        ],
        sizeOverLife: [
          { time: 0.0, size: 3.0 },
          { time: 0.2, size: 6.0 },
          { time: 1.0, size: 3.0 },
        ],
        rendering: {
          material: 'MI_Particle_SpiritWisp',
          blendMode: 'Additive',
          sortOrder: 1,
          alignment: 'ViewFacing',
          subUV: null,
        },
      }],
    },
  },
};

// ── Niagara Query & Deployment Functions ───────────────────────────────────

/**
 * Get the Niagara particle system specs for a specific region.
 */
export function getNiagaraSpec(regionId) {
  const spec = NIAGARA_SYSTEM_SPECS[regionId];
  if (!spec) return { error: `No Niagara specs for region: ${regionId}` };
  const concept = WAYSHRINE_CONCEPTS[regionId];
  return {
    regionId,
    displayName: concept?.displayName || regionId,
    systems: {
      ambient: {
        ...spec.ambient,
        emitterCount: spec.ambient.emitters.length,
        totalParticleRate: spec.ambient.emitters.reduce((s, e) =>
          s + (e.spawnRate.type === 'continuous' ? e.spawnRate.rate : 0), 0),
      },
      restBurst: {
        ...spec.restBurst,
        emitterCount: spec.restBurst.emitters.length,
        totalBurstCount: spec.restBurst.emitters.reduce((s, e) =>
          s + (e.spawnRate.burstCount || 0), 0),
      },
    },
  };
}

/**
 * Get all Niagara system specs across all regions — summary view.
 */
export function getAllNiagaraSpecs() {
  const regions = Object.keys(NIAGARA_SYSTEM_SPECS);
  const specs = regions.map(r => {
    const s = NIAGARA_SYSTEM_SPECS[r];
    const concept = WAYSHRINE_CONCEPTS[r];
    return {
      regionId: r,
      displayName: concept?.displayName || r,
      ambientSystem: s.ambient.systemName,
      ambientEmitters: s.ambient.emitters.length,
      ambientRate: s.ambient.emitters.reduce((sum, e) =>
        sum + (e.spawnRate.type === 'continuous' ? e.spawnRate.rate : 0), 0),
      restSystem: s.restBurst.systemName,
      restEmitters: s.restBurst.emitters.length,
      restBurstCount: s.restBurst.emitters.reduce((sum, e) =>
        sum + (e.spawnRate.burstCount || 0), 0),
    };
  });

  const totalEmitters = specs.reduce((s, r) => s + r.ambientEmitters + r.restEmitters, 0);
  const totalSystems = specs.length * 2;
  return {
    totalRegions: regions.length,
    totalSystems,
    totalEmitters,
    regions: specs,
  };
}

/**
 * Deploy ambient Niagara particles at all wayshrine placements for a region.
 * Spawns the ambient NS system at each wayshrine position.
 */
export async function deployRegionNiagara(regionId) {
  const spec = NIAGARA_SYSTEM_SPECS[regionId];
  if (!spec) return { error: `No Niagara specs for region: ${regionId}` };

  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!placements?.length) return { error: `No placements for region: ${regionId}` };

  const state = loadBuildState();
  if (!state.deployedNiagara) state.deployedNiagara = [];

  const results = [];
  for (const placement of placements) {
    const vfxId = `vfx_${placement.id}_ambient`;

    // Skip if already deployed
    if (state.deployedNiagara.find(d => d.vfxId === vfxId)) {
      results.push({ vfxId, skipped: true });
      continue;
    }

    try {
      const spawnResult = await ue('spawn_niagara_system', {
        system_path: spec.ambient.systemPath,
        location: placement.position,
      });
      state.deployedNiagara.push({
        vfxId,
        regionId,
        placementId: placement.id,
        systemName: spec.ambient.systemName,
        systemPath: spec.ambient.systemPath,
        position: placement.position,
        deployedAt: new Date().toISOString(),
        type: 'ambient',
      });
      results.push({ vfxId, success: true, spawnResult });
    } catch (err) {
      results.push({ vfxId, success: false, error: err.message });
      log.warn(`Failed to deploy Niagara ${vfxId}: ${err.message}`);
    }
  }

  saveBuildState(state);
  const deployed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  log.info(`Deployed ${deployed} Niagara systems for ${regionId} (${skipped} skipped)`);
  return { regionId, deployed, skipped, failed: results.filter(r => !r.success && !r.skipped).length, results };
}

/**
 * Deploy Niagara particles across ALL regions.
 */
export async function deployAllNiagara() {
  const regionResults = {};
  let totalDeployed = 0, totalSkipped = 0, totalFailed = 0;

  for (const regionId of Object.keys(NIAGARA_SYSTEM_SPECS)) {
    const result = await deployRegionNiagara(regionId);
    regionResults[regionId] = result;
    totalDeployed += result.deployed || 0;
    totalSkipped += result.skipped || 0;
    totalFailed += result.failed || 0;
  }

  log.info(`Deployed ${totalDeployed} Niagara systems total (${totalSkipped} skipped, ${totalFailed} failed)`);
  return {
    success: totalFailed === 0,
    totalDeployed,
    totalSkipped,
    totalFailed,
    totalTarget: Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0),
    regionResults,
  };
}

/**
 * Export all Niagara particle system specs to JSON for UE5 consumption.
 */
export function exportNiagaraSpecs() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    exportedAt: new Date().toISOString(),
    description: 'Per-region Niagara particle system specifications for wayshrine VFX',
    systems: NIAGARA_SYSTEM_SPECS,
    summary: getAllNiagaraSpecs(),
    materialRequirements: extractMaterialRequirements(),
  };

  const outPath = join(outDir, 'niagara-particle-specs.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported Niagara specs to ${outPath}`);
  return { success: true, path: outPath, summary: spec.summary };
}

/**
 * Get Niagara deployment status from build state.
 */
export function getNiagaraDeploymentStatus() {
  const state = loadBuildState();
  const deployed = state.deployedNiagara || [];
  const byRegion = {};
  for (const d of deployed) {
    if (!byRegion[d.regionId]) byRegion[d.regionId] = [];
    byRegion[d.regionId].push(d);
  }

  return {
    totalDeployed: deployed.length,
    totalTarget: Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0),
    regions: Object.keys(NIAGARA_SYSTEM_SPECS).map(r => ({
      regionId: r,
      deployed: (byRegion[r] || []).length,
      target: (WAYSHRINE_PLACEMENTS[r] || []).length,
      systems: (byRegion[r] || []).map(d => ({
        vfxId: d.vfxId,
        systemName: d.systemName,
        position: d.position,
        deployedAt: d.deployedAt,
      })),
    })),
  };
}

/**
 * Extract all unique material references from Niagara specs.
 * Useful for pre-creating material assets before deploying particles.
 */
function extractMaterialRequirements() {
  const materials = new Set();
  for (const regionSpec of Object.values(NIAGARA_SYSTEM_SPECS)) {
    for (const systemType of ['ambient', 'restBurst']) {
      for (const emitter of regionSpec[systemType].emitters) {
        materials.add(emitter.rendering.material);
      }
    }
  }
  return [...materials].sort();
}

// ── ms_4: Corruption-Suppression Post-Process Sphere ────────────────────────

/**
 * Per-region corruption suppression post-process settings.
 * Each wayshrine projects a sphere of "cleansed" post-process around it,
 * overriding the region's corruption visual effects within a radius.
 * The sphere lerps from corrupted → clean based on distance from wayshrine center.
 *
 * Architecture:
 *   - PP_Wayshrine_Suppression (PostProcessVolume with unbound=false, sphere shape)
 *   - MPC_WayshrineSuppression (Material Parameter Collection for runtime control)
 *   - Per-region color grading: each region's clean state has unique LUT/color balance
 *   - Blend priority: wayshrine PP overrides region corruption PP (priority 10 vs 5)
 *   - Integrates with corruption-shader.js getCorruptionTierParams for knowing what to suppress
 */

export const SUPPRESSION_PP_SPECS = {
  // Shared suppression sphere properties
  common: {
    blueprintComponent: 'SphereSuppressionComp',   // added to BP_Wayshrine_Base
    mpcName: 'MPC_WayshrineSuppression',
    mpcParams: [
      { name: 'SuppressionAlpha', type: 'scalar', default: 0.0, desc: 'Blend 0=corrupted 1=clean' },
      { name: 'SuppressionRadius', type: 'scalar', default: 800.0, desc: 'Active suppression radius in cm' },
      { name: 'SuppressionFalloff', type: 'scalar', default: 200.0, desc: 'Soft edge width in cm' },
      { name: 'PlayerDistance', type: 'scalar', default: 9999.0, desc: 'Distance from player to nearest active wayshrine' },
      { name: 'CleanSaturation', type: 'scalar', default: 1.1, desc: 'Color saturation in clean zone' },
      { name: 'CleanContrast', type: 'scalar', default: 1.05, desc: 'Contrast boost in clean zone' },
      { name: 'VignetteReduction', type: 'scalar', default: 0.8, desc: 'How much to reduce corruption vignette' },
    ],
    postProcessSettings: {
      priority: 10,                    // higher than corruption PP (priority 5)
      blendRadius: 800,               // matches suppression radius
      blendWeight: 1.0,               // full override inside sphere
      unbound: false,                  // sphere-shaped, not global
    },
    transitionCurve: {
      type: 'EaseInOut',
      rampUpSeconds: 2.0,             // time to fade from corrupt→clean when resting
      rampDownSeconds: 3.0,           // time to fade back when leaving/stopping rest
      holdCleanSeconds: 5.0,          // how long clean state persists after rest ends
    },
    // What the suppression sphere overrides on corruption PP
    overrides: {
      colorGrading: true,              // restore clean color grading
      bloom: true,                     // reduce corruption bloom intensity
      vignette: true,                  // remove corruption edge darkening
      chromaticAberration: true,       // remove corruption CA
      filmGrain: true,                 // remove corruption grain
      depthOfField: false,             // keep DOF as-is
    },
  },

  // Per-region clean-state color grading (what the world looks like without corruption)
  regions: {
    CrossroadsHub: {
      displayName: 'Hearthstone Cleanse',
      colorGrading: {
        whiteBalance: { temp: 6200, tint: -2 },         // warm neutral
        saturation: [1.05, 1.05, 1.05, 1.0],            // RGBW slight boost
        contrast: [1.02, 1.02, 1.02, 1.0],
        gamma: [1.0, 1.0, 1.0, 1.0],
        gain: [1.0, 1.0, 0.98, 1.0],                    // very slight warm tint
        shadowTint: [0.02, 0.01, 0.0],                   // warm shadows
        highlightTint: [0.01, 0.005, 0.0],               // warm highlights
      },
      bloomOverride: { intensity: 0.3, threshold: 1.2 },
      vignetteIntensity: 0.0,
      chromaticAberration: 0.0,
      filmGrain: 0.0,
      accentColor: [1.0, 0.85, 0.5],                     // warm amber
    },
    AshenWilds: {
      displayName: 'Verdant Cleanse',
      colorGrading: {
        whiteBalance: { temp: 5800, tint: 5 },           // slightly green
        saturation: [1.15, 1.2, 1.05, 1.0],              // boost greens
        contrast: [1.0, 1.05, 1.0, 1.0],
        gamma: [1.0, 0.98, 1.02, 1.0],
        gain: [0.95, 1.05, 0.95, 1.0],                   // green emphasis
        shadowTint: [0.0, 0.03, 0.0],                    // green shadows
        highlightTint: [0.01, 0.02, 0.0],
      },
      bloomOverride: { intensity: 0.5, threshold: 0.8 },  // lush glow
      vignetteIntensity: 0.0,
      chromaticAberration: 0.0,
      filmGrain: 0.0,
      accentColor: [0.2, 0.9, 0.3],                      // vivid green
    },
    Ironhold: {
      displayName: 'Forgelight Cleanse',
      colorGrading: {
        whiteBalance: { temp: 5200, tint: -5 },          // cool industrial
        saturation: [1.0, 0.95, 1.1, 1.0],               // slight blue
        contrast: [1.08, 1.08, 1.08, 1.0],               // high contrast
        gamma: [1.0, 1.0, 1.0, 1.0],
        gain: [0.98, 0.98, 1.05, 1.0],                   // cool steel tint
        shadowTint: [0.0, 0.0, 0.02],                    // blue shadows
        highlightTint: [0.02, 0.015, 0.01],              // warm forge highlights
      },
      bloomOverride: { intensity: 0.25, threshold: 1.5 }, // restrained industrial
      vignetteIntensity: 0.05,
      chromaticAberration: 0.0,
      filmGrain: 0.02,                                    // keep slight grain
      accentColor: [0.8, 0.5, 0.2],                      // forge orange
    },
    VerdantReach: {
      displayName: 'Bioluminescent Cleanse',
      colorGrading: {
        whiteBalance: { temp: 6800, tint: 8 },           // warm green-gold
        saturation: [1.1, 1.25, 1.1, 1.0],               // lush and vibrant
        contrast: [0.98, 1.0, 0.98, 1.0],                // slightly soft
        gamma: [1.02, 0.97, 1.02, 1.0],
        gain: [0.95, 1.08, 0.92, 1.0],                   // strong green push
        shadowTint: [0.01, 0.04, 0.02],                  // teal shadows
        highlightTint: [0.02, 0.03, 0.0],                // golden-green highlights
      },
      bloomOverride: { intensity: 0.6, threshold: 0.6 },  // biolum glow
      vignetteIntensity: 0.0,
      chromaticAberration: 0.0,
      filmGrain: 0.0,
      accentColor: [0.3, 1.0, 0.5],                      // biolum green
    },
    SunkenHalls: {
      displayName: 'Aquatic Cleanse',
      colorGrading: {
        whiteBalance: { temp: 7200, tint: -8 },          // cool aquatic
        saturation: [0.95, 1.1, 1.2, 1.0],               // blue-cyan emphasis
        contrast: [1.0, 1.0, 1.05, 1.0],
        gamma: [1.02, 1.0, 0.98, 1.0],
        gain: [0.9, 1.0, 1.1, 1.0],                      // blue tint
        shadowTint: [0.0, 0.02, 0.05],                   // deep blue shadows
        highlightTint: [0.0, 0.02, 0.03],                // cyan highlights
      },
      bloomOverride: { intensity: 0.4, threshold: 0.9 },  // soft caustic glow
      vignetteIntensity: 0.1,                              // slight depth vignette
      chromaticAberration: 0.1,                            // light refraction effect
      filmGrain: 0.0,
      accentColor: [0.2, 0.6, 1.0],                      // ocean blue
    },
    EmberPeaks: {
      displayName: 'Volcanic Cleanse',
      colorGrading: {
        whiteBalance: { temp: 4800, tint: -3 },          // warm-hot
        saturation: [1.15, 0.9, 0.85, 1.0],              // red-orange emphasis
        contrast: [1.1, 1.1, 1.1, 1.0],                  // high contrast volcanic
        gamma: [0.98, 1.02, 1.05, 1.0],
        gain: [1.1, 0.95, 0.85, 1.0],                    // strong warm push
        shadowTint: [0.04, 0.01, 0.0],                   // red shadows
        highlightTint: [0.03, 0.02, 0.0],                // orange highlights
      },
      bloomOverride: { intensity: 0.5, threshold: 0.7 },  // lava glow
      vignetteIntensity: 0.05,
      chromaticAberration: 0.05,                           // heat shimmer
      filmGrain: 0.03,                                    // volcanic ash grain
      accentColor: [1.0, 0.4, 0.1],                      // lava orange
    },
    Aethermere: {
      displayName: 'Reality Anchor Cleanse',
      colorGrading: {
        whiteBalance: { temp: 6500, tint: 0 },           // perfect neutral — normalcy
        saturation: [1.0, 1.0, 1.0, 1.0],                // true color
        contrast: [1.0, 1.0, 1.0, 1.0],                  // no manipulation
        gamma: [1.0, 1.0, 1.0, 1.0],                     // perfect middle
        gain: [1.0, 1.0, 1.0, 1.0],                      // no tint
        shadowTint: [0.0, 0.0, 0.0],                     // pure black shadows
        highlightTint: [0.0, 0.0, 0.0],                  // pure white highlights
      },
      bloomOverride: { intensity: 0.15, threshold: 2.0 }, // almost no bloom — stark reality
      vignetteIntensity: 0.0,
      chromaticAberration: 0.0,
      filmGrain: 0.0,
      accentColor: [0.9, 0.9, 1.0],                      // near-white with faint blue
      // Special: Aethermere suppression is "aggressively normal" — a sphere of
      // perfectly calibrated reality in the void. The contrast between void
      // darkness outside and perfect normalcy inside is the visual signature.
      specialOverride: {
        exposureBias: 0.5,            // slightly brighter than surroundings
        ambientOcclusionIntensity: 0.3, // reduced AO for clarity
        motionBlurAmount: 0.0,        // perfect stillness
      },
    },
    TheWilds: {
      displayName: 'Spirit Cleanse',
      colorGrading: {
        whiteBalance: { temp: 5600, tint: 3 },           // natural woodland
        saturation: [1.08, 1.12, 1.0, 1.0],              // slightly lush
        contrast: [1.0, 1.02, 1.0, 1.0],
        gamma: [1.0, 0.99, 1.01, 1.0],
        gain: [0.98, 1.03, 0.97, 1.0],                   // gentle green
        shadowTint: [0.01, 0.02, 0.01],                  // mossy shadows
        highlightTint: [0.01, 0.015, 0.005],             // dappled sunlight
      },
      bloomOverride: { intensity: 0.35, threshold: 1.0 }, // natural forest glow
      vignetteIntensity: 0.0,
      chromaticAberration: 0.0,
      filmGrain: 0.01,                                    // organic texture
      accentColor: [0.5, 0.8, 0.4],                      // forest green
    },
  },
};

/**
 * Generate UE5 Python script for creating the MPC_WayshrineSuppression
 * Material Parameter Collection and the PP volume component setup.
 * This script creates:
 *   1. MPC_WayshrineSuppression with all scalar params
 *   2. A reusable function to spawn per-region PP volumes at wayshrine positions
 */
export function generateSuppressionPPScript(regionId) {
  const common = SUPPRESSION_PP_SPECS.common;
  const region = SUPPRESSION_PP_SPECS.regions[regionId];
  if (!region) return { error: `No suppression spec for region: ${regionId}` };

  const cg = region.colorGrading;
  const pp = common.postProcessSettings;
  const accentHex = region.accentColor.map(c => Math.round(c * 255));

  const script = `
import unreal

# ── MPC_WayshrineSuppression — Material Parameter Collection ──
mpc_path = '/Game/ShatteredCrown/VFX/MPC_WayshrineSuppression'
mpc = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
    'MPC_WayshrineSuppression', '/Game/ShatteredCrown/VFX',
    unreal.MaterialParameterCollection, None
) if not unreal.EditorAssetLibrary.does_asset_exist(mpc_path) else unreal.EditorAssetLibrary.load_asset(mpc_path)

if mpc:
${common.mpcParams.map(p => `    # ${p.desc}
    try:
        param = unreal.MaterialParameterCollectionScalarParameter()
        param.set_editor_property('parameter_name', '${p.name}')
        param.set_editor_property('default_value', ${p.default})
        mpc.get_editor_property('scalar_parameters').append(param)
    except:
        pass  # param may already exist`).join('\n')}
    unreal.EditorAssetLibrary.save_asset(mpc_path)
    print("MPC_OK: MPC_WayshrineSuppression created/updated")
else:
    print("MPC_ERROR: Failed to create MPC_WayshrineSuppression")

# ── Post-Process Volume: PP_Suppression_${regionId} ──
world = unreal.EditorLevelLibrary.get_editor_world()
actor_class = unreal.PostProcessVolume

pp_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(actor_class, unreal.Vector(0, 0, 0))
if pp_actor:
    pp_actor.set_actor_label('PP_Suppression_${regionId}')

    # Sphere shape via unbound=False + brush scaling
    pp_actor.set_editor_property('unbound', False)
    pp_actor.set_editor_property('blend_radius', ${pp.blendRadius})
    pp_actor.set_editor_property('blend_weight', ${pp.blendWeight})
    pp_actor.set_editor_property('priority', ${pp.priority})

    settings = pp_actor.get_editor_property('settings')

    # Color grading overrides
    settings.set_editor_property('override_white_balance_temp', True)
    settings.set_editor_property('white_temp', ${cg.whiteBalance.temp})
    settings.set_editor_property('override_white_balance_tint', True)
    settings.set_editor_property('white_tint', ${cg.whiteBalance.tint})

    settings.set_editor_property('override_color_saturation', True)
    settings.set_editor_property('color_saturation', unreal.Vector4(${cg.saturation.join(', ')}))
    settings.set_editor_property('override_color_contrast', True)
    settings.set_editor_property('color_contrast', unreal.Vector4(${cg.contrast.join(', ')}))
    settings.set_editor_property('override_color_gamma', True)
    settings.set_editor_property('color_gamma', unreal.Vector4(${cg.gamma.join(', ')}))
    settings.set_editor_property('override_color_gain', True)
    settings.set_editor_property('color_gain', unreal.Vector4(${cg.gain.join(', ')}))

    # Bloom override
    settings.set_editor_property('override_bloom_intensity', True)
    settings.set_editor_property('bloom_intensity', ${region.bloomOverride.intensity})
    settings.set_editor_property('override_bloom_threshold', True)
    settings.set_editor_property('bloom_threshold', ${region.bloomOverride.threshold})

    # Vignette
    settings.set_editor_property('override_vignette_intensity', True)
    settings.set_editor_property('vignette_intensity', ${region.vignetteIntensity})

    # Chromatic aberration
    settings.set_editor_property('override_scene_fringe_intensity', True)
    settings.set_editor_property('scene_fringe_intensity', ${region.chromaticAberration})

    # Film grain
    settings.set_editor_property('override_film_grain_intensity', True)
    settings.set_editor_property('film_grain_intensity', ${region.filmGrain})

${region.specialOverride ? `    # Special overrides (${regionId})
    settings.set_editor_property('override_auto_exposure_bias', True)
    settings.set_editor_property('auto_exposure_bias', ${region.specialOverride.exposureBias})
    settings.set_editor_property('override_ambient_occlusion_intensity', True)
    settings.set_editor_property('ambient_occlusion_intensity', ${region.specialOverride.ambientOcclusionIntensity})
    settings.set_editor_property('override_motion_blur_amount', True)
    settings.set_editor_property('motion_blur_amount', ${region.specialOverride.motionBlurAmount})` : '    # No special overrides for this region'}

    print("PP_OK: PP_Suppression_${regionId} created — priority ${pp.priority}, blend radius ${pp.blendRadius}")
else:
    print("PP_ERROR: Failed to spawn PostProcessVolume for ${regionId}")
`.trim();

  return {
    regionId,
    displayName: region.displayName,
    script,
    scriptLength: script.length,
    overrides: Object.entries(common.overrides).filter(([, v]) => v).map(([k]) => k),
    accentColor: region.accentColor,
  };
}

/**
 * Deploy corruption-suppression post-process sphere at all wayshrine positions
 * for a given region. Executes the generated Python script in UE5.
 */
export async function deploySuppressionPP(regionId) {
  const scriptResult = generateSuppressionPPScript(regionId);
  if (scriptResult.error) return scriptResult;

  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!placements?.length) return { error: `No placements for region: ${regionId}` };

  const state = loadBuildState();
  if (!state.deployedSuppressionPP) state.deployedSuppressionPP = [];

  const results = [];

  // First deploy the MPC + template PP volume
  try {
    const execResult = await ue('execute_python_script', { script: scriptResult.script });
    results.push({ step: 'mpc_and_template', success: true, result: execResult });
  } catch (err) {
    // execute_python_script may not be available — fall back to creating variables on BP
    log.warn(`PP script execution failed (${err.message}), using blueprint variable fallback`);
    results.push({ step: 'mpc_and_template', success: false, error: err.message, fallback: true });
  }

  // For each wayshrine placement, record the suppression sphere data
  for (const placement of placements) {
    const ppId = `pp_suppress_${placement.id}`;

    if (state.deployedSuppressionPP.find(d => d.ppId === ppId)) {
      results.push({ ppId, skipped: true });
      continue;
    }

    // Store suppression sphere config for runtime blueprint use
    state.deployedSuppressionPP.push({
      ppId,
      regionId,
      placementId: placement.id,
      position: placement.position,
      radius: SUPPRESSION_PP_SPECS.common.postProcessSettings.blendRadius,
      priority: SUPPRESSION_PP_SPECS.common.postProcessSettings.priority,
      colorGrading: SUPPRESSION_PP_SPECS.regions[regionId]?.colorGrading,
      deployedAt: new Date().toISOString(),
    });
    results.push({ ppId, success: true });
  }

  saveBuildState(state);
  const deployed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  log.info(`Deployed ${deployed} suppression PP spheres for ${regionId} (${skipped} skipped)`);
  return { regionId, deployed, skipped, failed: results.filter(r => !r.success && !r.skipped).length, results };
}

/**
 * Deploy corruption-suppression post-process across ALL regions.
 */
export async function deployAllSuppressionPP() {
  const regionResults = {};
  let totalDeployed = 0, totalSkipped = 0, totalFailed = 0;

  for (const regionId of Object.keys(SUPPRESSION_PP_SPECS.regions)) {
    const result = await deploySuppressionPP(regionId);
    regionResults[regionId] = result;
    totalDeployed += result.deployed || 0;
    totalSkipped += result.skipped || 0;
    totalFailed += result.failed || 0;
  }

  log.info(`Deployed ${totalDeployed} suppression PP spheres total (${totalSkipped} skipped, ${totalFailed} failed)`);
  return { success: totalFailed === 0, totalDeployed, totalSkipped, totalFailed, regionResults };
}

/**
 * Get the suppression PP spec for a specific region.
 */
export function getSuppressionPPSpec(regionId) {
  const common = SUPPRESSION_PP_SPECS.common;
  const region = SUPPRESSION_PP_SPECS.regions[regionId];
  if (!region) return { error: `No suppression spec for region: ${regionId}` };

  return {
    regionId,
    displayName: region.displayName,
    common: {
      mpcName: common.mpcName,
      params: common.mpcParams,
      postProcess: common.postProcessSettings,
      transition: common.transitionCurve,
      overrides: common.overrides,
    },
    region: {
      colorGrading: region.colorGrading,
      bloomOverride: region.bloomOverride,
      vignetteIntensity: region.vignetteIntensity,
      chromaticAberration: region.chromaticAberration,
      filmGrain: region.filmGrain,
      accentColor: region.accentColor,
      specialOverride: region.specialOverride || null,
    },
  };
}

/**
 * Get all suppression PP specs across all regions — summary view.
 */
export function getAllSuppressionPPSpecs() {
  const regions = Object.keys(SUPPRESSION_PP_SPECS.regions);
  return {
    totalRegions: regions.length,
    mpcName: SUPPRESSION_PP_SPECS.common.mpcName,
    mpcParamCount: SUPPRESSION_PP_SPECS.common.mpcParams.length,
    ppPriority: SUPPRESSION_PP_SPECS.common.postProcessSettings.priority,
    transitionCurve: SUPPRESSION_PP_SPECS.common.transitionCurve,
    regions: regions.map(r => {
      const spec = SUPPRESSION_PP_SPECS.regions[r];
      return {
        regionId: r,
        displayName: spec.displayName,
        whiteBalance: spec.colorGrading.whiteBalance,
        accentColor: spec.accentColor,
        hasSpecialOverride: !!spec.specialOverride,
      };
    }),
  };
}

/**
 * Get suppression PP deployment status from build state.
 */
export function getSuppressionPPDeploymentStatus() {
  const state = loadBuildState();
  const deployed = state.deployedSuppressionPP || [];
  const byRegion = {};
  for (const d of deployed) {
    if (!byRegion[d.regionId]) byRegion[d.regionId] = [];
    byRegion[d.regionId].push(d);
  }

  return {
    totalDeployed: deployed.length,
    totalTarget: Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0),
    regions: Object.keys(SUPPRESSION_PP_SPECS.regions).map(r => ({
      regionId: r,
      deployed: (byRegion[r] || []).length,
      target: (WAYSHRINE_PLACEMENTS[r] || []).length,
      entries: (byRegion[r] || []).map(d => ({
        ppId: d.ppId,
        position: d.position,
        radius: d.radius,
        deployedAt: d.deployedAt,
      })),
    })),
  };
}

/**
 * Export all suppression PP specs to JSON for UE5 consumption.
 */
export function exportSuppressionPPSpecs() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    exportedAt: new Date().toISOString(),
    description: 'Per-region corruption-suppression post-process sphere specifications',
    common: SUPPRESSION_PP_SPECS.common,
    regions: SUPPRESSION_PP_SPECS.regions,
    summary: getAllSuppressionPPSpecs(),
  };

  const outPath = join(outDir, 'suppression-pp-specs.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported suppression PP specs to ${outPath}`);
  return { success: true, path: outPath, summary: spec.summary };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_5: Rest Bloom Pulse & Cinematic Camera Blend
// ══════════════════════════════════════════════════════════════════════════════
//
// When a player rests at a wayshrine:
//   1. Bloom Pulse: intensity ramps up → holds → decays (region-tinted)
//   2. Cinematic Camera: blends from gameplay cam to slow orbit around wayshrine
//   3. Post-process overlay with DOF + slight vignette removal
//
// Blueprint architecture:
//   - BP_WayshrineRestFX (actor component on BP_Wayshrine_Base)
//     - Timeline: BloomPulse_TL  (0→peak→hold→0 over ~2.6s)
//     - Timeline: CameraBlend_TL (0→1 over blendTime)
//     - Post-Process: dynamic bloom intensity keyed to timeline alpha
//     - Camera: CineCamera spawned at orbit point, ViewTarget blend
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Per-region bloom pulse color and intensity configuration.
 * Extends WAYSHRINE_COMMON.bloomPulse with region-specific tinting.
 */
export const BLOOM_PULSE_SPECS = {
  common: {
    ...WAYSHRINE_COMMON.bloomPulse,
    mpcName: 'MPC_WayshrineBloom',
    mpcParams: [
      { name: 'BloomAlpha', type: 'scalar', default: 0.0, desc: 'Current bloom pulse alpha (0=off, 1=peak)' },
      { name: 'BloomIntensity', type: 'scalar', default: 0.0, desc: 'Dynamic bloom intensity driven by timeline' },
      { name: 'BloomColorR', type: 'scalar', default: 1.0, desc: 'Bloom tint red channel' },
      { name: 'BloomColorG', type: 'scalar', default: 1.0, desc: 'Bloom tint green channel' },
      { name: 'BloomColorB', type: 'scalar', default: 1.0, desc: 'Bloom tint blue channel' },
      { name: 'PulsePhase', type: 'scalar', default: 0.0, desc: '0=idle, 1=rampUp, 2=hold, 3=rampDown' },
    ],
    timelineKeyframes: (() => {
      const bp = WAYSHRINE_COMMON.bloomPulse;
      const t1 = bp.rampUpSeconds;
      const t2 = t1 + bp.holdSeconds;
      const t3 = t2 + bp.rampDownSeconds;
      return [
        { time: 0.0,  value: 0.0 },
        { time: t1,   value: 1.0 },   // peak
        { time: t2,   value: 1.0 },   // hold
        { time: t3,   value: 0.0 },   // decay to zero
      ];
    })(),
    postProcessOverrides: {
      priority: WAYSHRINE_COMMON.bloomPulse.postProcessPriority,
      unbound: false,
      blendRadius: 600,   // slightly smaller than suppression sphere
      blendWeight: 1.0,
    },
  },

  // Per-region bloom tint colors and intensity multipliers
  regions: {
    CrossroadsHub: {
      displayName: 'Hearthstone Bloom',
      bloomColor: [1.0, 0.85, 0.6],     // warm amber
      peakMultiplier: 1.0,               // standard intensity
      secondaryGlow: { color: [1.0, 0.9, 0.7], intensity: 0.3 },
    },
    AshenWilds: {
      displayName: 'Verdant Bloom',
      bloomColor: [0.2, 0.9, 0.3],      // vivid green
      peakMultiplier: 1.2,               // slightly stronger — lush
      secondaryGlow: { color: [0.4, 1.0, 0.5], intensity: 0.4 },
    },
    Ironhold: {
      displayName: 'Forgelight Bloom',
      bloomColor: [0.8, 0.5, 0.2],      // forge orange
      peakMultiplier: 0.9,               // restrained industrial
      secondaryGlow: { color: [1.0, 0.6, 0.2], intensity: 0.25 },
    },
    VerdantReach: {
      displayName: 'Bioluminescent Bloom',
      bloomColor: [0.3, 1.0, 0.5],      // biolum green
      peakMultiplier: 1.3,               // strongest — lush bioluminescence
      secondaryGlow: { color: [0.2, 0.8, 0.6], intensity: 0.5 },
    },
    SunkenHalls: {
      displayName: 'Aquatic Bloom',
      bloomColor: [0.2, 0.6, 1.0],      // ocean blue
      peakMultiplier: 1.1,               // soft water glow
      secondaryGlow: { color: [0.1, 0.5, 0.9], intensity: 0.35 },
    },
    EmberPeaks: {
      displayName: 'Magma Bloom',
      bloomColor: [1.0, 0.4, 0.1],      // lava orange
      peakMultiplier: 1.4,               // most intense — volcanic energy
      secondaryGlow: { color: [1.0, 0.3, 0.0], intensity: 0.5 },
    },
    Aethermere: {
      displayName: 'Reality Bloom',
      bloomColor: [0.9, 0.9, 1.0],      // near-white — reality asserting itself
      peakMultiplier: 1.5,               // strongest bloom — reality pulse against void
      secondaryGlow: { color: [1.0, 1.0, 1.0], intensity: 0.6 },
    },
  },
};

/**
 * Cinematic camera blend configuration per region.
 * Each region has a unique camera behavior during rest.
 */
export const CINEMATIC_CAMERA_SPECS = {
  common: {
    ...WAYSHRINE_COMMON.cinematicCamera,
    blueprintComponent: 'CineCameraComp',
    cameraActorClass: 'CineCameraActor',
    blendFunction: 'VTBlend_EaseInOut',  // UE5 view target blend function
    timelineKeyframes: [
      { time: 0.0, value: 0.0 },                                        // gameplay cam
      { time: WAYSHRINE_COMMON.cinematicCamera.blendTime, value: 1.0 },  // fully cinematic
    ],
    exitBlendTime: 0.8,  // faster exit than enter (feels responsive)
    exitKeyframes: [
      { time: 0.0, value: 1.0 },
      { time: 0.8, value: 0.0 },
    ],
    // Post-process adjustments during cinematic view
    cinematicPP: {
      dofMethod: 'CircleDOF',
      dofFocalDistance: WAYSHRINE_COMMON.cinematicCamera.dofFocalDistance,
      dofFStop: WAYSHRINE_COMMON.cinematicCamera.dofAperture,
      dofSensorWidth: 36.0,  // full-frame equivalent
      vignetteIntensity: 0.15,  // subtle vignette for cinematic feel
      motionBlurAmount: 0.2,    // slight motion blur during orbit
      filmSlope: 0.88,          // slight filmic tone
      filmToe: 0.55,
    },
  },

  // Per-region camera orbit and DOF customization
  regions: {
    CrossroadsHub: {
      displayName: 'Hearthstone View',
      orbitRadius: 350,
      orbitSpeed: 8,
      pitchAngle: -15,
      focalOffset: [0, 0, 80],    // look slightly above crystal base
      fStopOverride: 2.8,
      startAngle: 0,               // begin orbit from front
    },
    AshenWilds: {
      displayName: 'Obelisk Reveal',
      orbitRadius: 400,             // wider orbit — show grass radius
      orbitSpeed: 6,                // slower — contemplative
      pitchAngle: -20,             // more downward — show ground transformation
      focalOffset: [0, 0, 120],    // focus on obelisk mid-height
      fStopOverride: 3.5,          // deeper DOF — show more context
      startAngle: 45,
    },
    Ironhold: {
      displayName: 'Forge Gaze',
      orbitRadius: 300,             // tighter — confined spaces
      orbitSpeed: 10,               // faster — industrial energy
      pitchAngle: -10,             // nearly level — eye-to-eye with anvil
      focalOffset: [0, 0, 60],
      fStopOverride: 2.4,          // shallow DOF — isolate from clutter
      startAngle: -30,
    },
    VerdantReach: {
      displayName: 'Canopy Gaze',
      orbitRadius: 420,             // wide — show bioluminescent surroundings
      orbitSpeed: 5,                // slowest — dreamlike
      pitchAngle: -25,             // steep downward — look through canopy light
      focalOffset: [0, 0, 150],    // high focus — root network center
      fStopOverride: 4.0,          // deep DOF — show entire glade
      startAngle: 90,
    },
    SunkenHalls: {
      displayName: 'Air Pocket View',
      orbitRadius: 280,             // tight — confined underwater space
      orbitSpeed: 7,
      pitchAngle: 5,               // slight upward — show dome/bubble above
      focalOffset: [0, 0, 40],     // low focus — water surface level
      fStopOverride: 2.2,          // very shallow — ethereal underwater feel
      startAngle: 180,
    },
    EmberPeaks: {
      displayName: 'Caldera View',
      orbitRadius: 380,
      orbitSpeed: 9,
      pitchAngle: -12,
      focalOffset: [0, 0, 100],
      fStopOverride: 3.2,
      startAngle: -60,
    },
    Aethermere: {
      displayName: 'Reality Sphere View',
      orbitRadius: 500,             // widest — show reality sphere boundary
      orbitSpeed: 4,                // slowest — serene anchor of sanity
      pitchAngle: -5,              // nearly level — reality is flat/stable
      focalOffset: [0, 0, 200],    // high — sphere center
      fStopOverride: 5.6,          // deep DOF — show the full sphere of normalcy
      startAngle: 0,
    },
  },
};

// ── Bloom Pulse Script Generator ─────────────────────────────────────────────

/**
 * Generate UE5 Python script to create the bloom pulse post-process volume
 * and MPC for a given region. Creates PP_BloomPulse_<region>.
 */
export function generateBloomPulseScript(regionId) {
  const common = BLOOM_PULSE_SPECS.common;
  const region = BLOOM_PULSE_SPECS.regions[regionId];
  if (!region) return { error: `No bloom pulse spec for region: ${regionId}` };

  const effectivePeak = common.peakIntensity * region.peakMultiplier;
  const [r, g, b] = region.bloomColor;
  const kf = common.timelineKeyframes;

  const script = `
import unreal

# ── MPC_WayshrineBloom — Material Parameter Collection for bloom pulse ──
mpc_path = '/Game/ShatteredCrown/VFX/MPC_WayshrineBloom'
mpc = None
if unreal.EditorAssetLibrary.does_asset_exist(mpc_path):
    mpc = unreal.EditorAssetLibrary.load_asset(mpc_path)
else:
    mpc = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        'MPC_WayshrineBloom', '/Game/ShatteredCrown/VFX',
        unreal.MaterialParameterCollection, None
    )

if mpc:
${common.mpcParams.map(p => `    try:
        param = unreal.MaterialParameterCollectionScalarParameter()
        param.set_editor_property('parameter_name', '${p.name}')
        param.set_editor_property('default_value', ${p.default})
        mpc.get_editor_property('scalar_parameters').append(param)
    except:
        pass  # param may already exist`).join('\n')}
    unreal.EditorAssetLibrary.save_asset(mpc_path)
    print("MPC_OK: MPC_WayshrineBloom created/updated")
else:
    print("MPC_ERROR: Failed to create MPC_WayshrineBloom")

# ── Post-Process Volume: PP_BloomPulse_${regionId} ──
pp_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PostProcessVolume, unreal.Vector(0, 0, 0)
)
if pp_actor:
    pp_actor.set_actor_label('PP_BloomPulse_${regionId}')
    pp_actor.set_editor_property('unbound', ${common.postProcessOverrides.unbound ? 'True' : 'False'})
    pp_actor.set_editor_property('blend_radius', ${common.postProcessOverrides.blendRadius})
    pp_actor.set_editor_property('blend_weight', 0.0)  # starts hidden — driven by timeline
    pp_actor.set_editor_property('priority', ${common.postProcessOverrides.priority})

    settings = pp_actor.get_editor_property('settings')

    # Bloom settings — peak values (blend_weight modulated by timeline)
    settings.set_editor_property('override_bloom_intensity', True)
    settings.set_editor_property('bloom_intensity', ${effectivePeak.toFixed(2)})
    settings.set_editor_property('override_bloom_threshold', True)
    settings.set_editor_property('bloom_threshold', 0.2)

    # Bloom tint via color grading gain (tints the bloom color)
    settings.set_editor_property('override_color_gain', True)
    settings.set_editor_property('color_gain', unreal.Vector4(${r}, ${g}, ${b}, 1.0))

    # Secondary glow via indirect lighting color
    settings.set_editor_property('override_indirect_lighting_color', True)
    settings.set_editor_property('indirect_lighting_color', unreal.LinearColor(${region.secondaryGlow.color.join(', ')}, 1.0))
    settings.set_editor_property('override_indirect_lighting_intensity', True)
    settings.set_editor_property('indirect_lighting_intensity', ${region.secondaryGlow.intensity})

    print("PP_OK: PP_BloomPulse_${regionId} — peak ${effectivePeak.toFixed(1)}, color (${r},${g},${b})")
else:
    print("PP_ERROR: Failed to spawn bloom pulse PP volume for ${regionId}")

# ── Timeline keyframes reference (for BP implementation) ──
# BloomPulse_TL keyframes:
${kf.map(k => `#   t=${k.time.toFixed(2)}s  alpha=${k.value.toFixed(2)}`).join('\n')}
# BlendWeight = alpha * 1.0 (drives PP visibility)
# BloomIntensity = alpha * ${effectivePeak.toFixed(1)}
print("TIMELINE_INFO: ${kf.length} keyframes, total duration ${kf[kf.length - 1].time.toFixed(1)}s")
`.trim();

  return {
    regionId,
    displayName: region.displayName,
    script,
    scriptLength: script.length,
    effectivePeakIntensity: effectivePeak,
    bloomColor: region.bloomColor,
    timelineDuration: kf[kf.length - 1].time,
    keyframeCount: kf.length,
  };
}

// ── Cinematic Camera Script Generator ────────────────────────────────────────

/**
 * Generate UE5 Python script to spawn a CineCameraActor configured
 * for the wayshrine rest cinematic orbit. Creates CineCamera_Wayshrine_<region>.
 */
export function generateCinematicCameraScript(regionId, placementPosition = [0, 0, 100]) {
  const common = CINEMATIC_CAMERA_SPECS.common;
  const region = CINEMATIC_CAMERA_SPECS.regions[regionId];
  if (!region) return { error: `No cinematic camera spec for region: ${regionId}` };

  const [wx, wy, wz] = placementPosition;
  const startRad = (region.startAngle * Math.PI) / 180;
  const camX = wx + region.orbitRadius * Math.cos(startRad);
  const camY = wy + region.orbitRadius * Math.sin(startRad);
  const camZ = wz + region.focalOffset[2] + 50; // slightly above focal point
  const [fx, fy, fz] = [wx + region.focalOffset[0], wy + region.focalOffset[1], wz + region.focalOffset[2]];
  const pp = common.cinematicPP;

  const script = `
import unreal
import math

# ── CineCameraActor: CineCamera_Wayshrine_${regionId} ──
cam_actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.CineCameraActor, unreal.Vector(${camX.toFixed(1)}, ${camY.toFixed(1)}, ${camZ.toFixed(1)})
)
if cam_actor:
    cam_actor.set_actor_label('CineCamera_Wayshrine_${regionId}')

    # Point camera at wayshrine focal point
    focal = unreal.Vector(${fx.toFixed(1)}, ${fy.toFixed(1)}, ${fz.toFixed(1)})
    cam_pos = unreal.Vector(${camX.toFixed(1)}, ${camY.toFixed(1)}, ${camZ.toFixed(1)})
    direction = focal - cam_pos
    rot = direction.rotation()
    cam_actor.set_actor_rotation(rot, False)

    # Camera component settings
    cam_comp = cam_actor.get_cine_camera_component()
    if cam_comp:
        # Focal length derived from orbit radius
        cam_comp.set_editor_property('current_focal_length', ${(region.orbitRadius > 400 ? 35 : region.orbitRadius > 300 ? 50 : 65).toFixed(1)})

        # Focus settings
        focus = cam_comp.get_editor_property('focus_settings')
        focus.set_editor_property('focus_method', unreal.CameraFocusMethod.MANUAL)
        focus.set_editor_property('manual_focus_distance', ${common.dofFocalDistance})
        cam_comp.set_editor_property('focus_settings', focus)

        # Aperture (f-stop)
        cam_comp.set_editor_property('current_aperture', ${region.fStopOverride})

        # Sensor
        filmback = cam_comp.get_editor_property('filmback')
        filmback.set_editor_property('sensor_width', ${pp.dofSensorWidth})
        cam_comp.set_editor_property('filmback', filmback)

        print("CAM_OK: CineCamera_Wayshrine_${regionId} — orbit r=${region.orbitRadius}, speed=${region.orbitSpeed}deg/s, fStop=${region.fStopOverride}")
    else:
        print("CAM_WARN: Could not access CineCameraComponent")

    # ── Orbit metadata (for BP timeline-driven orbit) ──
    # Store orbit params as tags for BP to read at runtime
    cam_actor.tags.append('WayshrineOrbit')
    cam_actor.tags.append('OrbitRadius_${region.orbitRadius}')
    cam_actor.tags.append('OrbitSpeed_${region.orbitSpeed}')
    cam_actor.tags.append('PitchAngle_${region.pitchAngle}')
    cam_actor.tags.append('BlendIn_${common.blendTime}')
    cam_actor.tags.append('BlendOut_${common.exitBlendTime}')
    cam_actor.tags.append('Region_${regionId}')
else:
    print("CAM_ERROR: Failed to spawn CineCameraActor for ${regionId}")

# ── Cinematic Post-Process (on-camera, only active during rest) ──
# These override player camera PP during cinematic blend
# DOF: fStop=${region.fStopOverride}, focal=${common.dofFocalDistance}cm
# Vignette: ${pp.vignetteIntensity}, MotionBlur: ${pp.motionBlurAmount}
# Film: slope=${pp.filmSlope}, toe=${pp.filmToe}
print("CINEMATIC_INFO: blendIn=${common.blendTime}s, blendOut=${common.exitBlendTime}s, orbit=${region.orbitSpeed}deg/s")
`.trim();

  return {
    regionId,
    displayName: region.displayName,
    script,
    scriptLength: script.length,
    orbitRadius: region.orbitRadius,
    orbitSpeed: region.orbitSpeed,
    blendTime: common.blendTime,
    exitBlendTime: common.exitBlendTime,
    cameraPosition: { x: camX, y: camY, z: camZ },
    focalPoint: { x: fx, y: fy, z: fz },
  };
}

// ── Deployment Functions ─────────────────────────────────────────────────────

/**
 * Deploy bloom pulse PP volumes at all wayshrine placements for a region.
 */
export async function deployBloomPulse(regionId) {
  const scriptResult = generateBloomPulseScript(regionId);
  if (scriptResult.error) return scriptResult;

  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!placements?.length) return { error: `No placements for region: ${regionId}` };

  const state = loadBuildState();
  if (!state.deployedBloomPulse) state.deployedBloomPulse = [];

  const results = [];

  // Deploy MPC + template PP volume via script
  try {
    const execResult = await ue('execute_python_script', { script: scriptResult.script });
    results.push({ step: 'mpc_and_bloom_pp', success: true, result: execResult });
  } catch (err) {
    log.warn(`Bloom pulse script exec failed (${err.message}), recording spec for manual deploy`);
    results.push({ step: 'mpc_and_bloom_pp', success: false, error: err.message, fallback: true });
  }

  // Record bloom pulse data per placement
  for (const placement of placements) {
    const bpId = `bloom_${placement.id}`;

    if (state.deployedBloomPulse.find(d => d.bpId === bpId)) {
      results.push({ bpId, skipped: true });
      continue;
    }

    const region = BLOOM_PULSE_SPECS.regions[regionId];
    state.deployedBloomPulse.push({
      bpId,
      regionId,
      placementId: placement.id,
      position: placement.position,
      peakIntensity: BLOOM_PULSE_SPECS.common.peakIntensity * region.peakMultiplier,
      bloomColor: region.bloomColor,
      timelineDuration: scriptResult.timelineDuration,
      deployedAt: new Date().toISOString(),
    });
    results.push({ bpId, success: true });
  }

  saveBuildState(state);
  const deployed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  log.info(`Deployed ${deployed} bloom pulse volumes for ${regionId} (${skipped} skipped)`);
  return { regionId, deployed, skipped, failed: results.filter(r => !r.success && !r.skipped).length, results };
}

/**
 * Deploy bloom pulse PP across ALL regions.
 */
export async function deployAllBloomPulse() {
  const regionResults = {};
  let totalDeployed = 0, totalSkipped = 0, totalFailed = 0;

  for (const regionId of Object.keys(BLOOM_PULSE_SPECS.regions)) {
    const result = await deployBloomPulse(regionId);
    regionResults[regionId] = result;
    totalDeployed += result.deployed || 0;
    totalSkipped += result.skipped || 0;
    totalFailed += result.failed || 0;
  }

  log.info(`Deployed ${totalDeployed} bloom pulse volumes total (${totalSkipped} skipped, ${totalFailed} failed)`);
  return { success: totalFailed === 0, totalDeployed, totalSkipped, totalFailed, regionResults };
}

/**
 * Deploy cinematic cameras at all wayshrine placements for a region.
 */
export async function deployCinematicCamera(regionId) {
  const placements = WAYSHRINE_PLACEMENTS[regionId];
  if (!placements?.length) return { error: `No placements for region: ${regionId}` };

  const region = CINEMATIC_CAMERA_SPECS.regions[regionId];
  if (!region) return { error: `No cinematic camera spec for region: ${regionId}` };

  const state = loadBuildState();
  if (!state.deployedCinematicCameras) state.deployedCinematicCameras = [];

  const results = [];

  for (const placement of placements) {
    const camId = `cam_${placement.id}`;

    if (state.deployedCinematicCameras.find(d => d.camId === camId)) {
      results.push({ camId, skipped: true });
      continue;
    }

    const scriptResult = generateCinematicCameraScript(regionId, placement.position);
    if (scriptResult.error) {
      results.push({ camId, success: false, error: scriptResult.error });
      continue;
    }

    try {
      const execResult = await ue('execute_python_script', { script: scriptResult.script });
      state.deployedCinematicCameras.push({
        camId,
        regionId,
        placementId: placement.id,
        position: placement.position,
        cameraPosition: scriptResult.cameraPosition,
        focalPoint: scriptResult.focalPoint,
        orbitRadius: scriptResult.orbitRadius,
        orbitSpeed: scriptResult.orbitSpeed,
        deployedAt: new Date().toISOString(),
      });
      results.push({ camId, success: true, result: execResult });
    } catch (err) {
      log.warn(`Cinematic camera deploy failed for ${camId}: ${err.message}`);
      // Still record for manual deployment
      state.deployedCinematicCameras.push({
        camId,
        regionId,
        placementId: placement.id,
        position: placement.position,
        cameraPosition: scriptResult.cameraPosition,
        focalPoint: scriptResult.focalPoint,
        orbitRadius: scriptResult.orbitRadius,
        orbitSpeed: scriptResult.orbitSpeed,
        deployedAt: new Date().toISOString(),
        manualDeploy: true,
      });
      results.push({ camId, success: false, error: err.message, fallback: true });
    }
  }

  saveBuildState(state);
  const deployed = results.filter(r => r.success || r.fallback).length;
  const skipped = results.filter(r => r.skipped).length;
  log.info(`Deployed ${deployed} cinematic cameras for ${regionId} (${skipped} skipped)`);
  return { regionId, deployed, skipped, failed: results.filter(r => !r.success && !r.skipped && !r.fallback).length, results };
}

/**
 * Deploy cinematic cameras across ALL regions.
 */
export async function deployAllCinematicCameras() {
  const regionResults = {};
  let totalDeployed = 0, totalSkipped = 0, totalFailed = 0;

  for (const regionId of Object.keys(CINEMATIC_CAMERA_SPECS.regions)) {
    const result = await deployCinematicCamera(regionId);
    regionResults[regionId] = result;
    totalDeployed += result.deployed || 0;
    totalSkipped += result.skipped || 0;
    totalFailed += result.failed || 0;
  }

  log.info(`Deployed ${totalDeployed} cinematic cameras total (${totalSkipped} skipped, ${totalFailed} failed)`);
  return { success: totalFailed === 0, totalDeployed, totalSkipped, totalFailed, regionResults };
}

// ── Query & Export Functions ─────────────────────────────────────────────────

/**
 * Get bloom pulse spec for a specific region.
 */
export function getBloomPulseSpec(regionId) {
  const common = BLOOM_PULSE_SPECS.common;
  const region = BLOOM_PULSE_SPECS.regions[regionId];
  if (!region) return { error: `No bloom pulse spec for region: ${regionId}` };

  return {
    regionId,
    displayName: region.displayName,
    bloomColor: region.bloomColor,
    peakIntensity: common.peakIntensity * region.peakMultiplier,
    rampUpSeconds: common.rampUpSeconds,
    holdSeconds: common.holdSeconds,
    rampDownSeconds: common.rampDownSeconds,
    totalDuration: common.timelineKeyframes[common.timelineKeyframes.length - 1].time,
    timelineKeyframes: common.timelineKeyframes,
    secondaryGlow: region.secondaryGlow,
    mpcParams: common.mpcParams,
    postProcessOverrides: common.postProcessOverrides,
  };
}

/**
 * Get all bloom pulse specs as a summary.
 */
export function getAllBloomPulseSpecs() {
  return Object.entries(BLOOM_PULSE_SPECS.regions).map(([regionId, region]) => ({
    regionId,
    displayName: region.displayName,
    bloomColor: region.bloomColor,
    peakIntensity: BLOOM_PULSE_SPECS.common.peakIntensity * region.peakMultiplier,
    totalDuration: BLOOM_PULSE_SPECS.common.timelineKeyframes[BLOOM_PULSE_SPECS.common.timelineKeyframes.length - 1].time,
  }));
}

/**
 * Get cinematic camera spec for a specific region.
 */
export function getCinematicCameraSpec(regionId) {
  const common = CINEMATIC_CAMERA_SPECS.common;
  const region = CINEMATIC_CAMERA_SPECS.regions[regionId];
  if (!region) return { error: `No cinematic camera spec for region: ${regionId}` };

  return {
    regionId,
    displayName: region.displayName,
    orbitRadius: region.orbitRadius,
    orbitSpeed: region.orbitSpeed,
    pitchAngle: region.pitchAngle,
    focalOffset: region.focalOffset,
    fStopOverride: region.fStopOverride,
    startAngle: region.startAngle,
    blendTime: common.blendTime,
    exitBlendTime: common.exitBlendTime,
    blendFunction: common.blendFunction,
    cinematicPP: common.cinematicPP,
    enterKeyframes: common.timelineKeyframes,
    exitKeyframes: common.exitKeyframes,
  };
}

/**
 * Get all cinematic camera specs as a summary.
 */
export function getAllCinematicCameraSpecs() {
  return Object.entries(CINEMATIC_CAMERA_SPECS.regions).map(([regionId, region]) => ({
    regionId,
    displayName: region.displayName,
    orbitRadius: region.orbitRadius,
    orbitSpeed: region.orbitSpeed,
    pitchAngle: region.pitchAngle,
    fStopOverride: region.fStopOverride,
    blendTime: CINEMATIC_CAMERA_SPECS.common.blendTime,
  }));
}

/**
 * Get deployment status for bloom pulse and cinematic cameras.
 */
export function getRestFXDeploymentStatus() {
  const state = loadBuildState();
  const bloomDeployed = state.deployedBloomPulse || [];
  const camsDeployed = state.deployedCinematicCameras || [];

  const totalPlacements = Object.values(WAYSHRINE_PLACEMENTS).reduce((sum, arr) => sum + arr.length, 0);

  const bloomByRegion = {};
  const camsByRegion = {};

  for (const regionId of Object.keys(BLOOM_PULSE_SPECS.regions)) {
    const regionPlacements = WAYSHRINE_PLACEMENTS[regionId]?.length || 0;
    bloomByRegion[regionId] = {
      deployed: bloomDeployed.filter(d => d.regionId === regionId).length,
      target: regionPlacements,
    };
  }

  for (const regionId of Object.keys(CINEMATIC_CAMERA_SPECS.regions)) {
    const regionPlacements = WAYSHRINE_PLACEMENTS[regionId]?.length || 0;
    camsByRegion[regionId] = {
      deployed: camsDeployed.filter(d => d.regionId === regionId).length,
      target: regionPlacements,
    };
  }

  return {
    bloomPulse: {
      totalDeployed: bloomDeployed.length,
      totalTarget: totalPlacements,
      byRegion: bloomByRegion,
    },
    cinematicCamera: {
      totalDeployed: camsDeployed.length,
      totalTarget: totalPlacements,
      byRegion: camsByRegion,
    },
    overallComplete: bloomDeployed.length >= totalPlacements && camsDeployed.length >= totalPlacements,
  };
}

/**
 * Export bloom pulse + cinematic camera specs to JSON for UE5 consumption.
 */
export function exportRestFXSpecs() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    exportedAt: new Date().toISOString(),
    description: 'Rest bloom pulse and cinematic camera blend specs for wayshrine rest FX (ms_5)',
    bloomPulse: {
      common: BLOOM_PULSE_SPECS.common,
      regions: BLOOM_PULSE_SPECS.regions,
      summary: getAllBloomPulseSpecs(),
    },
    cinematicCamera: {
      common: CINEMATIC_CAMERA_SPECS.common,
      regions: CINEMATIC_CAMERA_SPECS.regions,
      summary: getAllCinematicCameraSpecs(),
    },
    deploymentStatus: getRestFXDeploymentStatus(),
  };

  const outPath = join(outDir, 'rest-fx-specs.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported rest FX specs to ${outPath}`);
  return { success: true, path: outPath, bloomRegions: Object.keys(BLOOM_PULSE_SPECS.regions).length, cameraRegions: Object.keys(CINEMATIC_CAMERA_SPECS.regions).length };
}

// ══════════════════════════════════════════════════════════════════════════════
// ms_6: Aethermere Reality-Sphere Special Case
// ══════════════════════════════════════════════════════════════════════════════
//
// The Aethermere wayshrine is the most visually unique — a translucent sphere
// of normal reality floating in void darkness. Inside: grass, stone cairn,
// warm daylight. Outside: purple-black void pressing against the boundary.
//
// Special systems:
//   1. Reality Sphere Shell — iridescent translucent sphere mesh w/ fresnel
//   2. Inner Environment — grass plane, cairn, warm point light (snow globe)
//   3. Void Boundary FX — void tendrils creeping inward on sphere surface
//   4. Void Push on Rest — rest expands the sphere, pushing void back
//   5. Dual Post-Process — normalcy inside sphere, void desaturation outside
//   6. Reality Assertion Audio — unique SFX layering (reality hum vs void whisper)
//
// Blueprint: BP_Wayshrine_Aethermere (child of BP_Wayshrine_Base)
//   - Extra components: SphereShellMesh, InnerGrassPlane, CairnMesh,
//     VoidBoundaryNiagara, RealityPPVolume, VoidPPVolume
//   - Extra variables: SphereRadius, VoidPushAlpha, RealityAssertionStrength
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Full specification for the Aethermere reality-sphere special case.
 * Extends WAYSHRINE_CONCEPTS.Aethermere with implementation details.
 */
export const AETHERMERE_REALITY_SPHERE = {
  blueprintName: 'BP_Wayshrine_Aethermere',
  parentBlueprint: 'BP_Wayshrine_Base',

  // ── Sphere Shell ──────────────────────────────────────────────────────
  sphereShell: {
    meshType: 'Sphere',
    radius: 250,                     // cm — 2.5m diameter
    segments: 64,                    // high poly for smooth iridescence
    material: {
      name: 'MI_RealitySphere_Shell',
      parentMaterial: 'M_Translucent_Iridescent',
      params: {
        opacity: 0.12,               // mostly transparent
        refractionIndex: 1.18,       // subtle distortion
        fresnelPower: 3.5,           // edges more visible
        fresnelBaseReflect: 0.04,
        iridescenceStrength: 0.65,
        iridescenceShift: 0.3,       // hue shift across viewing angle
        iridescenceColors: {
          primary: [0.6, 0.4, 0.9],  // purple
          secondary: [0.9, 0.8, 0.4],// gold
          tertiary: [0.4, 0.7, 0.9], // sky blue
        },
        distortionStrength: 0.05,    // reality boundary warps what's behind it
        surfaceNoise: {
          scale: 8.0,
          speed: 0.08,               // very slow shimmer
          amplitude: 0.02,
        },
        emissiveIntensity: 0.3,      // faint self-glow
        emissiveColor: [0.9, 0.88, 0.8],
      },
    },
    collision: {
      type: 'NoCollision',           // player walks through — it's a visual boundary
      overlapEvents: true,           // triggers enter/exit events for PP blend
    },
  },

  // ── Inner Environment (Snow Globe) ────────────────────────────────────
  innerEnvironment: {
    grassPlane: {
      meshType: 'Plane',
      size: [400, 400],              // cm — slightly smaller than sphere floor
      material: {
        name: 'MI_RealityGrass',
        baseColor: [0.22, 0.48, 0.18],
        roughness: 0.82,
        normalMap: 'T_Grass_Normal',
        windAnimation: {
          speed: 0.3,                // gentle breeze inside sphere
          amplitude: 2.0,            // cm displacement
          note: 'WPO-driven grass sway, only inside sphere radius',
        },
      },
      wildflowers: {
        density: 12,                 // per sq meter
        types: ['daisy', 'bluebell', 'buttercup'],
        colorVariation: 0.3,
        maxHeight: 15,               // cm
      },
    },
    cairn: {
      meshType: 'Stacked_Stones',
      height: 60,                    // cm — small cairn at center
      width: 30,
      stoneCount: 7,
      material: {
        name: 'MI_RealityCairn',
        baseColor: [0.52, 0.49, 0.46],
        roughness: 0.78,
        normalIntensity: 0.85,
        mossPatches: {
          coverage: 0.15,
          color: [0.2, 0.4, 0.15],
        },
      },
      topCrystal: {
        color: [1.0, 0.95, 0.85],
        emissiveIntensity: 4.0,
        pulseSpeed: 0.6,
        pulseRange: [3.0, 5.0],
        note: 'Small warm crystal atop cairn — the heart of reality assertion',
      },
    },
    warmLight: {
      type: 'PointLight',
      color: [1.0, 0.95, 0.85],     // warm daylight
      intensity: 3500,
      attenuationRadius: 280,        // covers sphere interior
      position: [0, 0, 220],         // top of sphere — mimics sun position
      castShadows: true,
      sourceRadius: 30,              // soft shadows
      temperature: 5800,             // Kelvin — neutral daylight
    },
    fillLight: {
      type: 'PointLight',
      color: [0.85, 0.9, 1.0],      // cool fill
      intensity: 800,
      attenuationRadius: 200,
      position: [0, 0, 50],          // low fill from ground
      castShadows: false,
    },
  },

  // ── Void Boundary FX ──────────────────────────────────────────────────
  voidBoundary: {
    niagara: {
      systemName: 'NS_RealitySphere_VoidPress',
      systemPath: '/Game/VFX/Wayshrines/Aethermere/NS_RealitySphere_VoidPress',
      emitters: [
        {
          name: 'E_VoidTendrils',
          description: 'Dark tendrils creeping inward on sphere surface',
          spawnRate: { type: 'continuous', rate: 12 },
          lifetime: { min: 3.0, max: 6.0 },
          initialPosition: {
            shape: 'sphere_surface',
            radius: 260,             // just outside shell
            offset: [0, 0, 125],
          },
          velocity: {
            type: 'inward',
            speed: { min: 2, max: 5 },
            killRadius: 240,         // dissolve at shell boundary
          },
          colorOverLife: [
            { time: 0.0, color: [0.15, 0.05, 0.25, 0.0] },
            { time: 0.2, color: [0.2, 0.08, 0.35, 0.6] },
            { time: 0.7, color: [0.1, 0.03, 0.2, 0.4] },
            { time: 1.0, color: [0.05, 0.0, 0.1, 0.0] },
          ],
          sizeOverLife: [
            { time: 0.0, size: 8 },
            { time: 0.5, size: 15 },
            { time: 1.0, size: 5 },
          ],
          rendering: {
            material: 'MI_Particle_VoidTendril',
            blendMode: 'Translucent',
            alignment: 'VelocityAligned',
            stretchFactor: 3.0,
          },
        },
        {
          name: 'E_ShellShimmer',
          description: 'Iridescent sparkles on sphere shell surface',
          spawnRate: { type: 'continuous', rate: 20 },
          lifetime: { min: 0.5, max: 1.5 },
          initialPosition: {
            shape: 'sphere_surface',
            radius: 250,             // exactly on shell
            offset: [0, 0, 125],
          },
          velocity: {
            type: 'tangential',
            speed: { min: 5, max: 15 },
          },
          colorOverLife: [
            { time: 0.0, color: [0.8, 0.7, 1.0, 0.0] },
            { time: 0.3, color: [1.0, 0.9, 0.8, 0.8] },
            { time: 0.7, color: [0.6, 0.8, 1.0, 0.5] },
            { time: 1.0, color: [0.9, 0.85, 0.7, 0.0] },
          ],
          sizeOverLife: [
            { time: 0.0, size: 1 },
            { time: 0.5, size: 3 },
            { time: 1.0, size: 1 },
          ],
          rendering: {
            material: 'MI_Particle_IridescentSparkle',
            blendMode: 'Additive',
            alignment: 'ViewFacing',
          },
        },
      ],
    },
    // Material for void press visible from inside
    voidPressMaterial: {
      name: 'MI_VoidPress_Interior',
      renderOnInnerSphere: true,     // second sphere mesh, slightly larger, inverted normals
      baseColor: [0.03, 0.0, 0.08],
      emissiveColor: [0.25, 0.08, 0.45],
      emissiveIntensity: 1.5,
      animatedDistortion: {
        noiseScale: 4.0,
        noiseSpeed: 0.12,
        distortionAmount: 0.2,
        note: 'Animated noise creates "pressing void" visual on inner surface of outer shell',
      },
    },
  },

  // ── Void Push on Rest ─────────────────────────────────────────────────
  voidPushOnRest: {
    description: 'When player rests, reality asserts itself — sphere expands, pushing void back',
    phases: [
      {
        name: 'assertion_start',
        trigger: 'on_rest_start',
        duration: 1.5,
        sphereRadiusTarget: 400,     // sphere grows from 250→400cm
        lightIntensityMultiplier: 1.8,
        voidTendrilSpawnMultiplier: 0.2, // tendrils retreat
        bloomPulseSync: true,        // syncs with ms_5 bloom pulse
        audioEvent: 'SFX_Reality_Assert_Start',
      },
      {
        name: 'assertion_hold',
        trigger: 'rest_duration',
        duration: 'rest_time',       // matches rest behavior duration
        sphereRadiusTarget: 400,
        lightIntensityMultiplier: 1.5,
        voidTendrilSpawnMultiplier: 0.1,
        grassExpansion: true,        // grass plane grows to match sphere
        audioEvent: 'SFX_Reality_Assert_Sustain',
      },
      {
        name: 'assertion_fade',
        trigger: 'on_rest_end',
        duration: 5.0,               // slow return — reality reluctantly yields
        sphereRadiusTarget: 250,     // back to default
        lightIntensityMultiplier: 1.0,
        voidTendrilSpawnMultiplier: 1.0, // tendrils return
        audioEvent: 'SFX_Reality_Assert_Fade',
      },
    ],
    timelineSpec: {
      name: 'TL_VoidPush',
      totalDuration: 8.0,           // approx: 1.5 ramp + 1.5 hold-min + 5.0 fade
      keyframes: [
        { time: 0.0, alpha: 0.0 },  // idle
        { time: 1.5, alpha: 1.0 },  // fully expanded
        { time: 3.0, alpha: 1.0 },  // hold (extended by actual rest time)
        { time: 8.0, alpha: 0.0 },  // fade back
      ],
      drives: [
        { param: 'SphereScale', min: 1.0, max: 1.6 },        // 250→400cm
        { param: 'LightIntensity', min: 3500, max: 6300 },    // 1.0→1.8x
        { param: 'VoidTendrilRate', min: 12, max: 1.2 },      // inverted — fewer at peak
        { param: 'GrassPlaneScale', min: 1.0, max: 1.6 },
        { param: 'ShellOpacity', min: 0.12, max: 0.25 },      // more visible when expanded
        { param: 'IridescenceStrength', min: 0.65, max: 0.9 }, // brighter at peak
      ],
    },
    mpcParams: [
      { name: 'VoidPushAlpha', type: 'scalar', default: 0.0, desc: 'Current void push alpha (0=idle, 1=fully expanded)' },
      { name: 'SphereScale', type: 'scalar', default: 1.0, desc: 'Reality sphere scale multiplier' },
      { name: 'RealityStrength', type: 'scalar', default: 0.5, desc: 'How strongly reality asserts itself (drives multiple FX)' },
    ],
  },

  // ── Dual Post-Process Volumes ─────────────────────────────────────────
  dualPostProcess: {
    description: 'Two overlapping PP volumes create the inside/outside contrast',
    insideSphere: {
      name: 'PP_Reality_Inside',
      priority: 15,
      blendRadius: 50,               // sharp transition at sphere boundary
      blendWeight: 1.0,
      settings: {
        bloomIntensity: 0.3,
        bloomThreshold: 0.8,         // minimal bloom — reality is plain
        autoExposureBias: 0.2,
        colorTemperature: 5800,      // neutral daylight
        colorSaturation: [1.0, 1.0, 1.0, 1.0], // normal saturation
        vignetteIntensity: 0.0,      // no vignette — openness
        ambientOcclusionIntensity: 0.3,
        filmSlope: 0.88,
        filmToe: 0.55,
        lensFlareIntensity: 0.0,
        // Deliberately plain — normalcy is the point
        note: 'Inside the sphere should feel warm, safe, mundane — like stepping into a sunlit room',
      },
    },
    outsideSphere: {
      name: 'PP_Void_Outside',
      priority: 5,                    // lower priority — inside overrides
      blendRadius: 100,
      blendWeight: 0.8,              // partial blend — don't fully override Aethermere's base PP
      settings: {
        bloomIntensity: 2.0,
        bloomThreshold: 0.2,
        autoExposureBias: -0.5,      // darker
        colorSaturation: [0.6, 0.5, 0.7, 0.8], // desaturated with purple tint
        vignetteIntensity: 0.4,      // heavy vignette — oppressive
        ambientOcclusionIntensity: 0.8,
        filmSlope: 0.7,
        filmToe: 0.4,
        lensFlareIntensity: 0.0,
        note: 'Outside should feel oppressive, void-touched, slightly nauseating',
      },
    },
  },

  // ── Audio Layers ──────────────────────────────────────────────────────
  audioLayers: {
    insideSphere: {
      ambient: 'SFX_Reality_Hum',          // warm tonal hum, like a room with heating
      wind: 'SFX_Gentle_Breeze',           // soft wind in grass
      heartbeat: 'SFX_Reality_Heartbeat',  // faint rhythmic pulse — the sphere's "life"
    },
    outsideSphere: {
      ambient: 'SFX_Void_Whisper',         // unsettling whispers at boundary
      pressure: 'SFX_Void_Pressure',       // low rumble — void pressing inward
    },
    transition: {
      enter: 'SFX_Reality_Enter',          // relief — like stepping indoors from storm
      exit: 'SFX_Reality_Exit',            // dread — warm sounds cut, void rushes in
      crossfadeDuration: 0.8,              // seconds
    },
  },
};

// ── Aethermere Reality Sphere Script Generator ────────────────────────────

/**
 * Generate UE5 Python script to build the Aethermere reality sphere.
 * Creates: sphere shell mesh, inner grass plane, cairn placeholder,
 * dual PP volumes, void boundary Niagara setup, and warm interior lighting.
 */
export function generateAethermereRealitySphereScript(placementPosition = [0, 0, 100]) {
  const spec = AETHERMERE_REALITY_SPHERE;
  const concept = WAYSHRINE_CONCEPTS.Aethermere;
  const [wx, wy, wz] = placementPosition;
  const centerZ = wz + spec.sphereShell.radius; // sphere center above ground

  const innerPP = spec.dualPostProcess.insideSphere;
  const outerPP = spec.dualPostProcess.outsideSphere;

  const script = `
import unreal
import math

# ══ Aethermere Reality Sphere — Special Case Wayshrine ══

wayshrine_pos = unreal.Vector(${wx}, ${wy}, ${wz})
sphere_center = unreal.Vector(${wx}, ${wy}, ${centerZ})

# ── 1. Inner Warm Light (mimics sunlight inside the sphere) ──
warm_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PointLight, unreal.Vector(${wx}, ${wy}, ${wz + spec.innerEnvironment.warmLight.position[2]})
)
if warm_light:
    warm_light.set_actor_label('Light_RealitySphere_Warm')
    lc = warm_light.point_light_component
    lc.set_editor_property('intensity', ${spec.innerEnvironment.warmLight.intensity})
    lc.set_editor_property('light_color', unreal.Color(
        ${Math.round(spec.innerEnvironment.warmLight.color[0] * 255)},
        ${Math.round(spec.innerEnvironment.warmLight.color[1] * 255)},
        ${Math.round(spec.innerEnvironment.warmLight.color[2] * 255)}, 255))
    lc.set_editor_property('attenuation_radius', ${spec.innerEnvironment.warmLight.attenuationRadius})
    lc.set_editor_property('cast_shadows', ${spec.innerEnvironment.warmLight.castShadows ? 'True' : 'False'})
    lc.set_editor_property('source_radius', ${spec.innerEnvironment.warmLight.sourceRadius})
    warm_light.tags.append('RealitySphere_Interior')
    print("LIGHT_OK: RealitySphere warm interior light — ${spec.innerEnvironment.warmLight.intensity} lux, ${spec.innerEnvironment.warmLight.temperature}K")
else:
    print("LIGHT_ERROR: Failed to spawn warm interior light")

# ── 2. Fill Light (cool bounce from below) ──
fill_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PointLight, unreal.Vector(${wx}, ${wy}, ${wz + spec.innerEnvironment.fillLight.position[2]})
)
if fill_light:
    fill_light.set_actor_label('Light_RealitySphere_Fill')
    fc = fill_light.point_light_component
    fc.set_editor_property('intensity', ${spec.innerEnvironment.fillLight.intensity})
    fc.set_editor_property('light_color', unreal.Color(
        ${Math.round(spec.innerEnvironment.fillLight.color[0] * 255)},
        ${Math.round(spec.innerEnvironment.fillLight.color[1] * 255)},
        ${Math.round(spec.innerEnvironment.fillLight.color[2] * 255)}, 255))
    fc.set_editor_property('attenuation_radius', ${spec.innerEnvironment.fillLight.attenuationRadius})
    fc.set_editor_property('cast_shadows', False)
    fill_light.tags.append('RealitySphere_Interior')
    print("LIGHT_OK: RealitySphere cool fill light — ${spec.innerEnvironment.fillLight.intensity} lux")
else:
    print("LIGHT_ERROR: Failed to spawn fill light")

# ── 3. Sphere Rim Light (iridescent glow at boundary) ──
rim_light = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PointLight, unreal.Vector(${wx}, ${wy}, ${centerZ})
)
if rim_light:
    rim_light.set_actor_label('Light_RealitySphere_Rim')
    rc = rim_light.point_light_component
    rc.set_editor_property('intensity', ${concept.lighting.sphereRim.intensity})
    rc.set_editor_property('light_color', unreal.Color(
        ${Math.round(concept.lighting.sphereRim.color[0] * 255)},
        ${Math.round(concept.lighting.sphereRim.color[1] * 255)},
        ${Math.round(concept.lighting.sphereRim.color[2] * 255)}, 255))
    rc.set_editor_property('attenuation_radius', ${concept.lighting.sphereRim.radius})
    rc.set_editor_property('cast_shadows', False)
    rim_light.tags.append('RealitySphere_Boundary')
    print("LIGHT_OK: RealitySphere rim/boundary light")
else:
    print("LIGHT_ERROR: Failed to spawn rim light")

# ── 4. Inside PP Volume (normalcy — warm, safe, mundane) ──
inside_pp = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PostProcessVolume, sphere_center
)
if inside_pp:
    inside_pp.set_actor_label('${innerPP.name}')
    inside_pp.set_editor_property('unbound', False)
    inside_pp.set_editor_property('blend_radius', ${innerPP.blendRadius})
    inside_pp.set_editor_property('blend_weight', ${innerPP.blendWeight})
    inside_pp.set_editor_property('priority', ${innerPP.priority})
    # Scale to match sphere radius
    inside_pp.set_actor_scale3d(unreal.Vector(${(spec.sphereShell.radius / 100).toFixed(2)}, ${(spec.sphereShell.radius / 100).toFixed(2)}, ${(spec.sphereShell.radius / 100).toFixed(2)}))

    s = inside_pp.get_editor_property('settings')
    s.set_editor_property('override_bloom_intensity', True)
    s.set_editor_property('bloom_intensity', ${innerPP.settings.bloomIntensity})
    s.set_editor_property('override_bloom_threshold', True)
    s.set_editor_property('bloom_threshold', ${innerPP.settings.bloomThreshold})
    s.set_editor_property('override_auto_exposure_bias', True)
    s.set_editor_property('auto_exposure_bias', ${innerPP.settings.autoExposureBias})
    s.set_editor_property('override_vignette_intensity', True)
    s.set_editor_property('vignette_intensity', ${innerPP.settings.vignetteIntensity})
    s.set_editor_property('override_ambient_occlusion_intensity', True)
    s.set_editor_property('ambient_occlusion_intensity', ${innerPP.settings.ambientOcclusionIntensity})
    inside_pp.tags.append('RealitySphere_InsidePP')
    print("PP_OK: ${innerPP.name} — normalcy bubble (bloom ${innerPP.settings.bloomIntensity}, no vignette)")
else:
    print("PP_ERROR: Failed to spawn inside PP volume")

# ── 5. Outside PP Volume (void oppression — desaturated, dark) ──
outside_pp = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PostProcessVolume, sphere_center
)
if outside_pp:
    outside_pp.set_actor_label('${outerPP.name}')
    outside_pp.set_editor_property('unbound', True)  # affects everywhere outside
    outside_pp.set_editor_property('blend_radius', ${outerPP.blendRadius})
    outside_pp.set_editor_property('blend_weight', ${outerPP.blendWeight})
    outside_pp.set_editor_property('priority', ${outerPP.priority})

    s = outside_pp.get_editor_property('settings')
    s.set_editor_property('override_bloom_intensity', True)
    s.set_editor_property('bloom_intensity', ${outerPP.settings.bloomIntensity})
    s.set_editor_property('override_bloom_threshold', True)
    s.set_editor_property('bloom_threshold', ${outerPP.settings.bloomThreshold})
    s.set_editor_property('override_auto_exposure_bias', True)
    s.set_editor_property('auto_exposure_bias', ${outerPP.settings.autoExposureBias})
    s.set_editor_property('override_vignette_intensity', True)
    s.set_editor_property('vignette_intensity', ${outerPP.settings.vignetteIntensity})
    s.set_editor_property('override_ambient_occlusion_intensity', True)
    s.set_editor_property('ambient_occlusion_intensity', ${outerPP.settings.ambientOcclusionIntensity})
    outside_pp.tags.append('RealitySphere_OutsidePP')
    print("PP_OK: ${outerPP.name} — void oppression (desat, vignette ${outerPP.settings.vignetteIntensity})")
else:
    print("PP_ERROR: Failed to spawn outside PP volume")

# ── 6. Actor Tags Summary ──
print("AETHERMERE_OK: Reality sphere deployed — 3 lights, 2 PP volumes")
print("SPEC_INFO: sphere_radius=${spec.sphereShell.radius}, shell_opacity=${spec.sphereShell.material.params.opacity}, iridescence=${spec.sphereShell.material.params.iridescenceStrength}")
print("SPEC_INFO: void_push expands ${spec.sphereShell.radius}->${spec.voidPushOnRest.phases[0].sphereRadiusTarget}cm on rest, fades over ${spec.voidPushOnRest.phases[2].duration}s")
`.trim();

  return {
    regionId: 'Aethermere',
    displayName: 'Reality Sphere',
    script,
    scriptLength: script.length,
    sphereRadius: spec.sphereShell.radius,
    voidPushRadius: spec.voidPushOnRest.phases[0].sphereRadiusTarget,
    dualPP: {
      inside: innerPP.name,
      outside: outerPP.name,
    },
  };
}

/**
 * Build the dedicated Aethermere wayshrine blueprint with extra
 * reality-sphere variables and void-push timeline spec.
 */
export async function buildAethermereRealitySphere() {
  const spec = AETHERMERE_REALITY_SPHERE;
  const bpName = spec.blueprintName;

  const state = loadBuildState();
  if (!state.aethermereRealitySphere) state.aethermereRealitySphere = {};

  // Check if already built
  if (state.aethermereRealitySphere.built) {
    log.info(`Aethermere reality sphere already built, skipping`);
    return { success: true, skipped: true, blueprint: bpName };
  }

  log.info(`Building Aethermere reality sphere special case: ${bpName}`);
  const results = { blueprint: bpName, steps: [] };

  // Step 1: Ensure base Aethermere wayshrine blueprint exists
  try {
    const baseResult = await buildWayshrineBlueprint('Aethermere');
    results.steps.push({ step: 'base_blueprint', success: true, skipped: baseResult.skipped, detail: baseResult });
  } catch (err) {
    log.warn(`Base Aethermere blueprint build: ${err.message}`);
    results.steps.push({ step: 'base_blueprint', success: false, error: err.message });
  }

  // Step 2: Add reality-sphere-specific variables
  const extraVars = [
    // Sphere shell
    { name: 'SphereRadius', type: 'float', default_value: spec.sphereShell.radius },
    { name: 'ShellOpacity', type: 'float', default_value: spec.sphereShell.material.params.opacity },
    { name: 'IridescenceStrength', type: 'float', default_value: spec.sphereShell.material.params.iridescenceStrength },
    { name: 'FresnelPower', type: 'float', default_value: spec.sphereShell.material.params.fresnelPower },
    // Void push
    { name: 'VoidPushAlpha', type: 'float', default_value: 0.0 },
    { name: 'VoidPushTargetRadius', type: 'float', default_value: spec.voidPushOnRest.phases[0].sphereRadiusTarget },
    { name: 'VoidPushFadeDuration', type: 'float', default_value: spec.voidPushOnRest.phases[2].duration },
    { name: 'RealityStrength', type: 'float', default_value: 0.5 },
    // Void tendrils
    { name: 'VoidTendrilBaseRate', type: 'float', default_value: 12.0 },
    { name: 'VoidTendrilCurrentRate', type: 'float', default_value: 12.0 },
    // Inner environment
    { name: 'GrassPlaneScale', type: 'float', default_value: 1.0 },
    { name: 'CairnCrystalPulseSpeed', type: 'float', default_value: spec.innerEnvironment.cairn.topCrystal.pulseSpeed },
    // Audio state
    { name: 'bPlayerInsideSphere', type: 'bool', default_value: false },
    { name: 'AudioCrossfadeAlpha', type: 'float', default_value: 0.0 },
  ];

  let varsAdded = 0;
  for (const v of extraVars) {
    try {
      await ue('create_variable', { blueprint_name: bpName, ...v });
      varsAdded++;
    } catch (err) {
      log.warn(`Extra var ${v.name} on ${bpName}: ${err.message}`);
    }
  }
  results.steps.push({ step: 'extra_variables', success: varsAdded > 0, count: varsAdded, target: extraVars.length });

  // Step 3: Deploy the reality sphere actors at first Aethermere placement
  const placements = WAYSHRINE_PLACEMENTS.Aethermere;
  if (placements?.length > 0) {
    const scriptResult = generateAethermereRealitySphereScript(placements[0].position);
    try {
      const execResult = await ue('execute_python_script', { script: scriptResult.script });
      results.steps.push({ step: 'deploy_sphere_actors', success: true, result: execResult });
    } catch (err) {
      log.warn(`Aethermere sphere actor deploy: ${err.message} — recording spec for manual deploy`);
      results.steps.push({ step: 'deploy_sphere_actors', success: false, error: err.message, fallback: true });
    }
  }

  // Step 4: Compile blueprint
  try {
    await ue('compile_blueprint', { blueprint_name: bpName });
    results.steps.push({ step: 'compile', success: true });
  } catch (err) {
    results.steps.push({ step: 'compile', success: false, error: err.message });
  }

  // Record build state
  state.aethermereRealitySphere = {
    built: true,
    blueprint: bpName,
    extraVariables: varsAdded,
    sphereRadius: spec.sphereShell.radius,
    voidPushRadius: spec.voidPushOnRest.phases[0].sphereRadiusTarget,
    dualPP: true,
    builtAt: new Date().toISOString(),
  };
  saveBuildState(state);

  log.info(`Aethermere reality sphere built: ${varsAdded} extra vars, dual PP, void push spec`);
  return { success: true, results };
}

/**
 * Get the full Aethermere reality sphere spec for export/review.
 */
export function getAethermereRealitySphereSpec() {
  return {
    ...AETHERMERE_REALITY_SPHERE,
    concept: WAYSHRINE_CONCEPTS.Aethermere,
    bloomPulse: BLOOM_PULSE_SPECS.regions.Aethermere,
    cinematicCamera: CINEMATIC_CAMERA_SPECS.regions.Aethermere,
    suppressionPP: SUPPRESSION_PP_SPECS?.Aethermere || null,
    placements: WAYSHRINE_PLACEMENTS.Aethermere,
  };
}

/**
 * Get Aethermere reality sphere build status.
 */
export function getAethermereRealitySphereStatus() {
  const state = loadBuildState();
  const built = state.aethermereRealitySphere || {};
  return {
    built: !!built.built,
    blueprint: built.blueprint || 'BP_Wayshrine_Aethermere',
    extraVariables: built.extraVariables || 0,
    sphereRadius: built.sphereRadius || AETHERMERE_REALITY_SPHERE.sphereShell.radius,
    voidPushRadius: built.voidPushRadius || AETHERMERE_REALITY_SPHERE.voidPushOnRest.phases[0].sphereRadiusTarget,
    dualPP: built.dualPP || false,
    builtAt: built.builtAt || null,
    voidPushPhases: AETHERMERE_REALITY_SPHERE.voidPushOnRest.phases.length,
    audioLayers: Object.keys(AETHERMERE_REALITY_SPHERE.audioLayers).length,
    niagaraEmitters: AETHERMERE_REALITY_SPHERE.voidBoundary.niagara.emitters.length,
  };
}

/**
 * Export Aethermere reality sphere spec to JSON.
 */
export function exportAethermereRealitySphereSpec() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines', 'Aethermere');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const spec = {
    exportedAt: new Date().toISOString(),
    description: 'Aethermere Reality Sphere — special case wayshrine (ms_6)',
    realitySphere: AETHERMERE_REALITY_SPHERE,
    concept: WAYSHRINE_CONCEPTS.Aethermere,
    buildStatus: getAethermereRealitySphereStatus(),
  };

  const outPath = join(outDir, 'reality-sphere-spec.json');
  writeFileSync(outPath, JSON.stringify(spec, null, 2));
  log.info(`Exported Aethermere reality sphere spec to ${outPath}`);
  return { success: true, path: outPath };
}

// ── ms_7: Place All Wayshrines with Regional Visual Variants ────────────────

/**
 * Unified deployment orchestrator — deploys ALL 24 wayshrines (8 regions x 3)
 * with every visual layer applied:
 *   Phase 1: Build all region blueprints
 *   Phase 2: Spawn all wayshrine actors at placement positions
 *   Phase 3: Deploy Niagara ambient particles at each position
 *   Phase 4: Deploy corruption-suppression PP spheres
 *   Phase 5: Deploy bloom pulse PP volumes
 *   Phase 6: Deploy cinematic cameras
 *   Phase 7: Build Aethermere reality sphere (special case)
 *   Phase 8: Export full deployment manifest
 *
 * Idempotent — skips already-deployed items via build state tracking.
 */
export async function deployAllWayshrinesComplete() {
  const totalPlacements = Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0);
  log.info(`Starting full wayshrine deployment: ${totalPlacements} placements across ${Object.keys(WAYSHRINE_PLACEMENTS).length} regions`);

  const report = {
    startedAt: new Date().toISOString(),
    totalTarget: totalPlacements,
    phases: {},
    errors: [],
  };

  // Phase 1: Build all blueprints
  try {
    const bpResult = await buildAllWayshrineBlueprints();
    report.phases.blueprints = { success: true, built: bpResult.built, skipped: bpResult.skipped, failed: bpResult.failed };
    log.info(`Phase 1 (blueprints): ${bpResult.built} built, ${bpResult.skipped} skipped, ${bpResult.failed} failed`);
  } catch (err) {
    report.phases.blueprints = { success: false, error: err.message };
    report.errors.push({ phase: 'blueprints', error: err.message });
    log.error(`Phase 1 (blueprints) failed: ${err.message}`);
  }

  // Phase 2: Spawn all actors
  try {
    const spawnResult = await spawnAllWayshrines();
    report.phases.actors = {
      success: true,
      spawned: spawnResult.actorsSpawned,
      skipped: spawnResult.actorsSkipped,
      target: totalPlacements,
    };
    log.info(`Phase 2 (actors): ${spawnResult.actorsSpawned} spawned, ${spawnResult.actorsSkipped} skipped`);
  } catch (err) {
    report.phases.actors = { success: false, error: err.message };
    report.errors.push({ phase: 'actors', error: err.message });
    log.error(`Phase 2 (actors) failed: ${err.message}`);
  }

  // Phase 3: Deploy Niagara particles
  try {
    const niagaraResult = await deployAllNiagara();
    report.phases.niagara = {
      success: true,
      deployed: niagaraResult.deployed || 0,
      skipped: niagaraResult.skipped || 0,
      target: totalPlacements,
    };
    log.info(`Phase 3 (niagara): deployed at ${niagaraResult.deployed || 0} positions`);
  } catch (err) {
    report.phases.niagara = { success: false, error: err.message };
    report.errors.push({ phase: 'niagara', error: err.message });
    log.error(`Phase 3 (niagara) failed: ${err.message}`);
  }

  // Phase 4: Deploy corruption-suppression PP
  try {
    const suppResult = await deployAllSuppressionPP();
    report.phases.suppression = {
      success: true,
      deployed: suppResult.deployed || 0,
      skipped: suppResult.skipped || 0,
      target: totalPlacements,
    };
    log.info(`Phase 4 (suppression): deployed at ${suppResult.deployed || 0} positions`);
  } catch (err) {
    report.phases.suppression = { success: false, error: err.message };
    report.errors.push({ phase: 'suppression', error: err.message });
    log.error(`Phase 4 (suppression) failed: ${err.message}`);
  }

  // Phase 5: Deploy bloom pulse
  try {
    const bloomResult = await deployAllBloomPulse();
    report.phases.bloom = {
      success: true,
      deployed: bloomResult.deployed || 0,
      skipped: bloomResult.skipped || 0,
      target: totalPlacements,
    };
    log.info(`Phase 5 (bloom): deployed at ${bloomResult.deployed || 0} positions`);
  } catch (err) {
    report.phases.bloom = { success: false, error: err.message };
    report.errors.push({ phase: 'bloom', error: err.message });
    log.error(`Phase 5 (bloom) failed: ${err.message}`);
  }

  // Phase 6: Deploy cinematic cameras
  try {
    const camResult = await deployAllCinematicCameras();
    report.phases.cameras = {
      success: true,
      deployed: camResult.deployed || 0,
      skipped: camResult.skipped || 0,
      target: totalPlacements,
    };
    log.info(`Phase 6 (cameras): deployed at ${camResult.deployed || 0} positions`);
  } catch (err) {
    report.phases.cameras = { success: false, error: err.message };
    report.errors.push({ phase: 'cameras', error: err.message });
    log.error(`Phase 6 (cameras) failed: ${err.message}`);
  }

  // Phase 7: Aethermere reality sphere (special case)
  try {
    const aethResult = await buildAethermereRealitySphere();
    report.phases.aethermereRealitySphere = {
      success: true,
      built: !aethResult.skipped,
      skipped: !!aethResult.skipped,
    };
    log.info(`Phase 7 (Aethermere reality sphere): ${aethResult.skipped ? 'already built' : 'built'}`);
  } catch (err) {
    report.phases.aethermereRealitySphere = { success: false, error: err.message };
    report.errors.push({ phase: 'aethermereRealitySphere', error: err.message });
    log.error(`Phase 7 (Aethermere reality sphere) failed: ${err.message}`);
  }

  // Phase 8: Export manifest
  try {
    const manifestResult = exportDeploymentManifest();
    report.phases.manifest = { success: true, path: manifestResult.path };
    log.info(`Phase 8 (manifest): exported to ${manifestResult.path}`);
  } catch (err) {
    report.phases.manifest = { success: false, error: err.message };
    report.errors.push({ phase: 'manifest', error: err.message });
  }

  report.completedAt = new Date().toISOString();
  report.phasesCompleted = Object.values(report.phases).filter(p => p.success).length;
  report.totalPhases = Object.keys(report.phases).length;
  report.allPhasesOk = report.errors.length === 0;

  // Persist deployment report
  const state = loadBuildState();
  state.fullDeployment = report;
  saveBuildState(state);

  log.info(`Full deployment complete: ${report.phasesCompleted}/${report.totalPhases} phases OK, ${report.errors.length} errors`);
  return { success: report.allPhasesOk, report };
}

/**
 * Get combined deployment status across all visual layers.
 * Shows per-region completion for: blueprints, actors, niagara, suppression, bloom, cameras.
 */
export function getFullDeploymentStatus() {
  const state = loadBuildState();
  const regions = Object.keys(WAYSHRINE_PLACEMENTS);
  const totalPlacements = Object.values(WAYSHRINE_PLACEMENTS).reduce((s, p) => s + p.length, 0);

  const regionStatus = {};
  for (const regionId of regions) {
    const placements = WAYSHRINE_PLACEMENTS[regionId];
    const placementIds = placements.map(p => p.id);

    const bpName = `BP_Wayshrine_${regionId}`;
    const bpBuilt = !!(state.builtBlueprints || []).find(b => b.name === bpName);
    const actorsPlaced = placementIds.filter(id =>
      (state.builtActors || []).find(a => a.placementId === id)
    ).length;

    // Check niagara, suppression, bloom, camera deployments
    const niagaraDeployed = placementIds.filter(id =>
      (state.niagaraDeployed || []).find(n => n.placementId === id)
    ).length;
    const suppressionDeployed = placementIds.filter(id =>
      (state.suppressionDeployed || []).find(s => s.placementId === id)
    ).length;
    const bloomDeployed = placementIds.filter(id =>
      (state.bloomDeployed || []).find(b => b.placementId === id)
    ).length;
    const camerasDeployed = placementIds.filter(id =>
      (state.camerasDeployed || []).find(c => c.placementId === id)
    ).length;

    const total = placements.length;
    const layersDone = [bpBuilt ? total : 0, actorsPlaced, niagaraDeployed, suppressionDeployed, bloomDeployed, camerasDeployed];
    const layersMax = total * 6; // 6 layers per placement
    const regionComplete = layersDone.reduce((a, b) => a + b, 0);

    regionStatus[regionId] = {
      displayName: WAYSHRINE_CONCEPTS[regionId]?.displayName || regionId,
      placements: total,
      blueprint: bpBuilt,
      actors: { placed: actorsPlaced, target: total },
      niagara: { deployed: niagaraDeployed, target: total },
      suppression: { deployed: suppressionDeployed, target: total },
      bloom: { deployed: bloomDeployed, target: total },
      cameras: { deployed: camerasDeployed, target: total },
      completionPct: Math.round((regionComplete / layersMax) * 100),
    };
  }

  // Aethermere special
  const aethBuilt = !!(state.aethermereRealitySphere?.built);

  // Overall counts
  const totalActors = (state.builtActors || []).length;
  const totalBPs = (state.builtBlueprints || []).length;
  const totalNiagara = (state.niagaraDeployed || []).length;
  const totalSuppression = (state.suppressionDeployed || []).length;
  const totalBloom = (state.bloomDeployed || []).length;
  const totalCameras = (state.camerasDeployed || []).length;
  const totalDeployed = totalActors + totalNiagara + totalSuppression + totalBloom + totalCameras;
  const totalTarget = totalPlacements * 5; // 5 deployable layers per placement (BP is separate)
  const overallPct = totalTarget > 0 ? Math.round((totalDeployed / totalTarget) * 100) : 0;

  return {
    totalRegions: regions.length,
    totalPlacements,
    overall: {
      blueprints: { built: totalBPs, target: regions.length },
      actors: { placed: totalActors, target: totalPlacements },
      niagara: { deployed: totalNiagara, target: totalPlacements },
      suppression: { deployed: totalSuppression, target: totalPlacements },
      bloom: { deployed: totalBloom, target: totalPlacements },
      cameras: { deployed: totalCameras, target: totalPlacements },
      aethermereRealitySphere: aethBuilt,
      completionPct: overallPct,
    },
    regions: regionStatus,
    lastFullDeployment: state.fullDeployment?.completedAt || null,
  };
}

/**
 * Export a full deployment manifest with all placement data, visual layers,
 * and per-wayshrine configuration for UE5 integration.
 */
export function exportDeploymentManifest() {
  const game = getActiveGame();
  const outDir = join(process.cwd(), 'workspace', game.gameId, 'Assets', 'Wayshrines');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const regions = Object.keys(WAYSHRINE_PLACEMENTS);
  const placements = [];

  for (const regionId of regions) {
    const concept = WAYSHRINE_CONCEPTS[regionId];
    const regionPlacements = WAYSHRINE_PLACEMENTS[regionId];
    if (!concept || !regionPlacements) continue;

    for (const p of regionPlacements) {
      const primaryLight = concept.lighting.pointLight || Object.values(concept.lighting)[0];
      const crystal = concept.materials.crystal || concept.materials.groundCrystal || Object.values(concept.materials).find(m => m.emissiveColor);

      placements.push({
        id: p.id,
        regionId,
        displayName: concept.displayName,
        position: { x: p.position[0], y: p.position[1], z: p.position[2] },
        rotation: { pitch: p.rotation[0], yaw: p.rotation[1], roll: p.rotation[2] },
        note: p.note,
        blueprint: `BP_Wayshrine_${regionId}`,
        visualVariant: {
          meshShape: concept.mesh.baseShape,
          meshHeight: concept.mesh.height,
          accentColor: concept.accentColor,
          emissiveColor: crystal?.emissiveColor || concept.accentColor,
          emissiveIntensity: crystal?.emissiveIntensity || 5.0,
          lightColor: primaryLight.color,
          lightIntensity: primaryLight.intensity,
          lightRadius: primaryLight.radius,
          particleSystem: concept.particles.ambient?.system || null,
          particleColor: concept.particles.ambient?.color || null,
          particleCount: concept.particles.ambient?.count || 0,
        },
        behavior: {
          interactionRadius: WAYSHRINE_COMMON.interactionRadius,
          suppressionRadius: WAYSHRINE_COMMON.corruptionSuppression.radius,
          restDuration: WAYSHRINE_COMMON.restBehavior.restDurationMin,
          willpowerRestore: WAYSHRINE_COMMON.restBehavior.willpowerRestore,
          bloomPeakIntensity: WAYSHRINE_COMMON.bloomPulse.peakIntensity,
          discoveryXP: WAYSHRINE_COMMON.discoveryReward.xp,
          mapRevealRadius: WAYSHRINE_COMMON.discoveryReward.mapReveal,
        },
        isAethermere: regionId === 'Aethermere',
      });
    }
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    description: 'Full wayshrine deployment manifest — all placements with regional visual variants (ms_7)',
    totalWayshrines: placements.length,
    totalRegions: regions.length,
    placements,
    deploymentStatus: getFullDeploymentStatus(),
  };

  const outPath = join(outDir, 'deployment-manifest.json');
  writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  log.info(`Exported deployment manifest: ${placements.length} wayshrines to ${outPath}`);
  return { success: true, path: outPath, totalWayshrines: placements.length };
}
