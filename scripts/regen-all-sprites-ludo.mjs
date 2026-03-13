/**
 * Regenerate ALL custom MapleStory sprites via Ludo AI generateWithStyle.
 * Uses original v83 sprites as style references for authentic MS look.
 * Sends each sprite to Telegram, then replaces existing files.
 *
 * Usage: node scripts/regen-all-sprites-ludo.mjs
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.LUDO_API_KEY;
const MCP_URL = 'https://mcp.ludo.ai/mcp';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const SPRITES_DIR = 'workspace/maple-sprites';
const STYLE_REFS_DIR = path.join(SPRITES_DIR, 'style-refs');
const OUTPUT_DIR = path.join(SPRITES_DIR, 'ludo-regen');

// Load style references
const npcRef = fs.readFileSync(path.join(STYLE_REFS_DIR, 'ref_npc.png')).toString('base64');
const mobRef = fs.readFileSync(path.join(STYLE_REFS_DIR, 'ref_mob.png')).toString('base64');
const bossRef = fs.readFileSync(path.join(STYLE_REFS_DIR, 'ref_boss.png')).toString('base64');

function getStyleRef(category) {
  if (category === 'boss') return bossRef;
  if (category === 'mob') return mobRef;
  return npcRef; // NPCs, items, weapons all use NPC style
}

// All custom content that needs sprites
const SPRITES = [
  // ── NPCs ──
  { name: 'npc_9999001_blacksmith_taro', category: 'npc', prompt: 'blacksmith NPC character, muscular male with short brown hair, wearing brown leather apron over white shirt, holding large hammer, standing idle pose, side view, transparent background, MapleStory style' },
  { name: 'npc_9999002_alchemist_luna', category: 'npc', prompt: 'female alchemist NPC, young woman with purple hair in ponytail, wearing blue mage robe with potion bottles hanging from belt, holding a glowing flask, standing idle pose, side view, transparent background, MapleStory style' },
  { name: 'npc_9999003_scout_raven', category: 'npc', prompt: 'male scout ranger NPC, wearing dark green hooded cloak, leather armor, carrying a quiver of arrows on back, alert stance, side view, transparent background, MapleStory style' },
  { name: 'npc_9999004_chef_momo', category: 'npc', prompt: 'cute round chef NPC, short chubby character wearing white chef hat and apron, holding a frying pan, happy expression, side view, transparent background, MapleStory style' },
  { name: 'npc_9999005_old_man_kazuki', category: 'npc', prompt: 'wise old man NPC with long white beard, wearing traditional blue robes, holding a wooden cane, gentle expression, side view, transparent background, MapleStory style' },
  { name: 'npc_9999006_arena_master_rex', category: 'npc', prompt: 'strong arena master NPC, tall muscular male with red headband, wearing gladiator armor with shoulder pads, arms crossed, confident pose, side view, transparent background, MapleStory style' },
  { name: 'npc_9999007_gem_trader_safi', category: 'npc', prompt: 'gem trader NPC, exotic female merchant with golden jewelry, wearing colorful silk robes, displaying sparkling gems in hands, side view, transparent background, MapleStory style' },
  { name: 'npc_9999008_captain_flint', category: 'npc', prompt: 'pirate captain NPC, rugged male with eye patch and tricorn hat, wearing long blue coat, holding a treasure map, standing on one leg, side view, transparent background, MapleStory style' },
  { name: 'npc_9999009_nurse_joy', category: 'npc', prompt: 'nurse healer NPC, young woman with pink hair in bun, wearing white nurse outfit with red cross, holding healing staff with glowing green light, gentle smile, side view, transparent background, MapleStory style' },
  { name: 'npc_9999010_treasure_hunter_kai', category: 'npc', prompt: 'treasure hunter NPC, adventurous male with spiky brown hair, wearing explorer outfit with goggles on forehead, carrying a large backpack, holding a compass, side view, transparent background, MapleStory style' },
  { name: 'npc_9999030_sage_instructor_elara', category: 'npc', prompt: 'wise female sage instructor NPC, elegant woman with silver hair flowing down, wearing ornate white and gold robes with magical runes, holding a glowing spell book, mystical aura around her, side view, transparent background, MapleStory style' },
  // Dungeon NPCs
  { name: 'npc_9999020_frost_warden_kira', category: 'npc', prompt: 'frost warden NPC, female warrior with ice-blue hair, wearing silver frost armor with ice crystal shoulder pads, holding a frost spear, cold mist around feet, side view, transparent background, MapleStory style' },
  { name: 'npc_9999021_crypt_warden_moros', category: 'npc', prompt: 'dark crypt warden NPC, hooded male figure in tattered black robes, skeletal hands visible, glowing purple eyes under hood, holding a dark lantern, eerie presence, side view, transparent background, MapleStory style' },
  // Necromancer NPCs
  { name: 'npc_9990010_dark_apprentice', category: 'npc', prompt: 'dark apprentice necromancer NPC, young mage in dark purple robes with skull motif, holding a bone wand, shadowy wisps around, side view, transparent background, MapleStory style' },
  { name: 'npc_9990011_death_disciple', category: 'npc', prompt: 'death disciple NPC, cloaked figure in dark gray robes with death rune markings, holding a scythe, ghostly green aura, side view, transparent background, MapleStory style' },
  { name: 'npc_9990012_soul_reaper', category: 'npc', prompt: 'soul reaper NPC, menacing armored warrior in black plate armor, wielding a giant dark sword, red glowing eyes, side view, transparent background, MapleStory style' },
  { name: 'npc_9990013_ancient_lich', category: 'npc', prompt: 'ancient lich NPC, skeletal undead mage in tattered royal robes, wearing a crown, holding a staff topped with a soul gem, floating slightly, side view, transparent background, MapleStory style' },
  { name: 'npc_9990014_grizelda', category: 'npc', prompt: 'necromancer quest NPC Grizelda, old witch woman with green skin, wearing torn black dress and pointed hat, holding a crystal ball with souls swirling inside, side view, transparent background, MapleStory style' },

  // ── Weapons ──
  { name: 'weapon_1302134_crystal_fang', category: 'npc', prompt: 'crystal sword weapon icon, one-handed sword with crystalline blue blade, ornate golden hilt with gem, glowing faintly, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1382081_phoenix_staff', category: 'npc', prompt: 'phoenix staff weapon icon, wooden staff topped with golden phoenix wings and a fire gem, orange glow, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1452086_wind_piercer', category: 'npc', prompt: 'wind piercer bow weapon icon, elegant longbow with green wind swirl design, white string, sharp arrowhead tips, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1332100_shadow_fang', category: 'npc', prompt: 'shadow fang dagger weapon icon, dark purple dagger with curved blade, shadow wisps emanating, silver edge, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1492049_thunder_barrel', category: 'npc', prompt: 'thunder barrel gun weapon icon, steampunk pistol with brass barrel and lightning bolt engravings, electric sparks, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1442104_earth_cleaver', category: 'npc', prompt: 'earth cleaver polearm weapon icon, massive brown and green polearm with stone blade, earthy vines wrapped around shaft, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1472101_venom_claw', category: 'npc', prompt: 'venom claw throwing star weapon icon, green poisonous claw-shaped throwing weapon, dripping with venom, sharp triple blades, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'weapon_1482047_iron_fist', category: 'npc', prompt: 'iron fist knuckle weapon icon, heavy metal gauntlet with spiked knuckles, silver and red design, battle-worn, item icon view, transparent background, MapleStory style pixel art' },

  // ── Items ──
  { name: 'item_2002031_elixir_of_rage', category: 'npc', prompt: 'rage elixir potion icon, small red potion bottle with angry face label, glowing red liquid, cork stopper, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002032_mana_crystal', category: 'npc', prompt: 'mana crystal icon, blue glowing crystal shard, faceted gem shape, magical sparkles around it, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002033_iron_shield_scroll', category: 'npc', prompt: 'iron shield scroll icon, rolled up parchment scroll with a shield emblem seal, brown paper with blue ribbon, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002034_swift_boots_potion', category: 'npc', prompt: 'swift boots potion icon, green speed potion bottle with wing symbol, glowing green liquid, small and round bottle, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002035_lucky_clover', category: 'npc', prompt: 'lucky four-leaf clover item icon, bright green four-leaf clover with golden sparkle, small and cute, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002036_giants_meat', category: 'npc', prompt: 'giant meat food icon, large cooked meat leg on bone, juicy and brown with steam rising, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2002037_sage_tea', category: 'npc', prompt: 'sage tea icon, elegant porcelain cup with green tea inside, steam rising, small leaf decoration, item icon view, transparent background, MapleStory style pixel art' },
  { name: 'item_2030021_return_scroll', category: 'npc', prompt: 'return scroll teleport icon, glowing white scroll with swirl portal symbol, blue magical energy around it, item icon view, transparent background, MapleStory style pixel art' },

  // ── Class portraits ──
  { name: 'class_sage_portrait', category: 'npc', prompt: 'sage mage class portrait, elegant robed mage character with silver hair, holding spell book, magical runes floating around, mystical blue and white color scheme, front-facing portrait, transparent background, MapleStory style' },
  { name: 'class_necromancer_portrait', category: 'npc', prompt: 'necromancer dark mage class portrait, hooded dark figure with glowing green eyes, holding skull staff, dark purple and black robes, undead energy swirling, front-facing portrait, transparent background, MapleStory style' },
];

// Ensure output directory
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function mcpCall(toolName, args) {
  const resp = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'ApiKey ' + API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  return resp.json();
}

async function sendToTelegram(filePath, caption) {
  const fileData = fs.readFileSync(filePath);
  const blob = new Blob([fileData], { type: 'image/png' });
  const form = new FormData();
  form.append('chat_id', TG_CHAT);
  form.append('caption', caption.substring(0, 200));
  form.append('photo', blob, path.basename(filePath));

  const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const data = await resp.json();
  if (!data.ok) console.error('  TG error:', data.description);
  return data.ok;
}

async function generateSprite(sprite) {
  const outPath = path.join(OUTPUT_DIR, `${sprite.name}.png`);

  // Skip if already generated in this run
  if (fs.existsSync(outPath)) {
    console.log(`  [SKIP] ${sprite.name} already exists`);
    return outPath;
  }

  const styleRef = getStyleRef(sprite.category);
  const result = await mcpCall('generateWithStyle', {
    requestBody: {
      style_image: 'data:image/png;base64,' + styleRef,
      prompt: sprite.prompt,
      image_type: 'sprite',
      n: 1,
      augment_prompt: false,
    },
  });

  if (result.result && result.result.content) {
    for (const item of result.result.content) {
      if (item.type === 'text') {
        const urlMatch = item.text.match(/https?:\/\/[^\s"<>]+\.(png|jpg|webp)/i);
        if (urlMatch) {
          const imgResp = await fetch(urlMatch[0]);
          const buf = Buffer.from(await imgResp.arrayBuffer());
          fs.writeFileSync(outPath, buf);
          console.log(`  [OK] ${sprite.name} (${buf.length} bytes)`);
          return outPath;
        }
      }
    }
  }
  console.log(`  [FAIL] ${sprite.name} — no image URL. Response: ${JSON.stringify(result).substring(0, 200)}`);
  return null;
}

// Main
console.log(`=== Ludo AI Sprite Regeneration ===`);
console.log(`Sprites to generate: ${SPRITES.length}`);
console.log(`Output: ${OUTPUT_DIR}`);
console.log(`Style refs: npc=${npcRef.length}B, mob=${mobRef.length}B, boss=${bossRef.length}B`);
console.log('');

const results = { ok: 0, fail: 0, skip: 0 };
const generated = [];

for (let i = 0; i < SPRITES.length; i++) {
  const sprite = SPRITES[i];
  console.log(`[${i + 1}/${SPRITES.length}] ${sprite.name}`);

  try {
    const outPath = await generateSprite(sprite);
    if (outPath) {
      generated.push({ ...sprite, path: outPath });
      results.ok++;
    } else {
      results.fail++;
    }
  } catch (err) {
    console.log(`  [ERROR] ${err.message}`);
    results.fail++;
  }

  // Rate limit: 2 seconds between calls
  if (i < SPRITES.length - 1) await new Promise(r => setTimeout(r, 2000));
}

console.log(`\n=== Generation Complete ===`);
console.log(`OK: ${results.ok}, Failed: ${results.fail}`);

// Send all to Telegram
console.log(`\n=== Sending to Telegram ===`);
for (let i = 0; i < generated.length; i++) {
  const s = generated[i];
  const caption = `${s.name.replace(/_/g, ' ')}`;
  console.log(`  [TG ${i + 1}/${generated.length}] ${s.name}`);
  try {
    await sendToTelegram(s.path, caption);
  } catch (err) {
    console.log(`  [TG ERROR] ${err.message}`);
  }
  // Telegram rate limit
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n=== Done! ${generated.length} sprites generated and sent. ===`);
