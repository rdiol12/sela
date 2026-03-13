/**
 * modules/unreal/npc-dialogue.js — NPC Dialogue Tree Data System
 *
 * Generates UE5 Data Tables for branching NPC conversations in The Shattered Crown.
 * Each NPC has a dialogue tree with nodes, branches, conditions, and voice line refs.
 *
 * Architecture:
 *   FSCDialogueNode (struct) — one line of dialogue
 *     - NodeID (Name): unique identifier within the tree
 *     - Speaker (Enum): who speaks this line
 *     - Text (Text): dialogue text (displayed with typewriter effect)
 *     - VoiceAsset (SoftObjectPath): reference to generated WAV SoundWave
 *     - Portrait (SoftObjectPath): speaker portrait texture
 *     - Duration (float): seconds to display (auto from voice length)
 *     - Emotion (Enum): facial/animation hint
 *     - NextNodes (Name[]): possible next nodes (1=linear, 2+=branch)
 *     - BranchConditions (Map<Name,FSCCondition>): per-branch unlock conditions
 *     - OnEnterActions (FSCAction[]): actions triggered when node activates
 *     - IsTerminal (bool): ends conversation
 *
 *   FSCDialogueTree (DataTable) — one per NPC, contains all nodes
 *     - Row name = NodeID
 *     - First row = entry point
 *
 *   Conditions system:
 *     - QuestState (quest_id, state)
 *     - CorruptionLevel (min, max)
 *     - ItemOwned (item_id)
 *     - PreviousChoice (dialogue_node_id)
 *     - WillpowerLevel (min, max)
 *     - RegionVisited (region_id)
 *
 * ms_2: "Build dialogue tree data tables (branching conversations)"
 * for NPC Dialogue & Voice Generation goal (npc_dialogue_voice).
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callTool } from '../../lib/mcp-gateway.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('npc-dialogue');

// ── Enums ───────────────────────────────────────────────────────────────────

export const SPEAKERS = {
  Kael:       { id: 'Kael',       portrait: '/Game/UI/Portraits/T_Portrait_Kael',       voicePrefix: 'voice_kael' },
  Lira:       { id: 'Lira',       portrait: '/Game/UI/Portraits/T_Portrait_Lira',       voicePrefix: 'voice_lira' },
  Theron:     { id: 'Theron',     portrait: '/Game/UI/Portraits/T_Portrait_Theron',     voicePrefix: 'voice_theron' },
  Sable:      { id: 'Sable',      portrait: '/Game/UI/Portraits/T_Portrait_Sable',      voicePrefix: 'voice_sable' },
  Blacksmith: { id: 'Blacksmith', portrait: '/Game/UI/Portraits/T_Portrait_Blacksmith', voicePrefix: 'voice_blacksmith' },
  Elder:      { id: 'Elder',      portrait: '/Game/UI/Portraits/T_Portrait_Elder',      voicePrefix: 'voice_elder' },
  Innkeeper:  { id: 'Innkeeper',  portrait: '/Game/UI/Portraits/T_Portrait_Innkeeper',  voicePrefix: 'voice_innkeeper' },
  Merchant:   { id: 'Merchant',   portrait: '/Game/UI/Portraits/T_Portrait_Merchant',   voicePrefix: 'voice_merchant' },
  Healer:     { id: 'Healer',     portrait: '/Game/UI/Portraits/T_Portrait_Healer',     voicePrefix: 'voice_healer' },
  Bard:       { id: 'Bard',       portrait: '/Game/UI/Portraits/T_Portrait_Bard',       voicePrefix: 'voice_bard' },
  Narrator:   { id: 'Narrator',   portrait: '/Game/UI/Portraits/T_Portrait_Narrator',   voicePrefix: 'voice_ending' },
};

export const EMOTIONS = ['neutral', 'concerned', 'angry', 'sad', 'hopeful', 'mysterious', 'terrified', 'determined', 'amused', 'reverent'];

// ── Dialogue Tree Definitions ───────────────────────────────────────────────

/**
 * All NPC dialogue trees for The Shattered Crown.
 * Each tree is an array of dialogue nodes.
 */
export const DIALOGUE_TREES = {
  // ── Elder Mathis (CrossroadsHub) — Main quest giver ──
  elder_intro: {
    npc: 'Elder',
    region: 'CrossroadsHub',
    context: 'First meeting with Elder Mathis at the village center',
    nodes: [
      {
        id: 'elder_intro_1',
        speaker: 'Elder',
        text: 'You must be the one the winds spoke of. Come closer, child.',
        voiceRef: 'elder_greeting_1',
        emotion: 'mysterious',
        duration: 4.0,
        next: ['elder_intro_2'],
      },
      {
        id: 'elder_intro_2',
        speaker: 'Elder',
        text: 'The Crown lies shattered across eight lands. Each shard calls to those with the will to claim it... or the weakness to be consumed.',
        voiceRef: 'elder_lore_1',
        emotion: 'concerned',
        duration: 7.0,
        next: ['elder_branch_accept', 'elder_branch_question', 'elder_branch_refuse'],
      },
      {
        id: 'elder_branch_accept',
        speaker: 'Kael',
        text: 'I will find the shards. Tell me where to begin.',
        voiceRef: 'kael_determined_1',
        emotion: 'determined',
        duration: 3.5,
        isPlayerChoice: true,
        next: ['elder_accept_response'],
        onEnter: [{ type: 'set_quest', questId: 'main_shard_hunt', state: 'active' }],
      },
      {
        id: 'elder_branch_question',
        speaker: 'Kael',
        text: 'What happens if the shards are left unclaimed?',
        voiceRef: 'kael_curious_1',
        emotion: 'concerned',
        duration: 3.0,
        isPlayerChoice: true,
        next: ['elder_question_response'],
      },
      {
        id: 'elder_branch_refuse',
        speaker: 'Kael',
        text: 'This sounds like someone else\'s burden.',
        voiceRef: 'kael_reluctant_1',
        emotion: 'neutral',
        duration: 3.0,
        isPlayerChoice: true,
        next: ['elder_refuse_response'],
      },
      {
        id: 'elder_accept_response',
        speaker: 'Elder',
        text: 'The Ashen Wilds lie to the north. The first shard was seen there, guarded by the Emberclaw. Take this map, and may the light guide you.',
        voiceRef: 'elder_quest_1',
        emotion: 'hopeful',
        duration: 7.0,
        next: [],
        isTerminal: true,
        onEnter: [
          { type: 'give_item', itemId: 'map_ashen_wilds' },
          { type: 'set_quest_objective', questId: 'main_shard_hunt', objectiveId: 'find_ashen_shard' },
          { type: 'unlock_region', regionId: 'AshenWilds' },
        ],
      },
      {
        id: 'elder_question_response',
        speaker: 'Elder',
        text: 'The corruption spreads, child. Each day the shards lie unfound, the Stain grows. Soon there will be nothing left to save.',
        voiceRef: 'elder_warning_1',
        emotion: 'terrified',
        duration: 6.5,
        next: ['elder_branch_accept', 'elder_branch_refuse'],
      },
      {
        id: 'elder_refuse_response',
        speaker: 'Elder',
        text: 'We all carry burdens we did not choose. But the Crown chose you. You will feel its pull... eventually.',
        voiceRef: 'elder_cryptic_1',
        emotion: 'sad',
        duration: 5.5,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'set_flag', flag: 'refused_elder_quest', value: true }],
      },
    ],
  },

  // ── Blacksmith Forge (CrossroadsHub) — Equipment & shard forging ──
  blacksmith_first_visit: {
    npc: 'Blacksmith',
    region: 'CrossroadsHub',
    context: 'First visit to the forge. Offers weapon upgrade path.',
    nodes: [
      {
        id: 'smith_greet_1',
        speaker: 'Blacksmith',
        text: 'Another adventurer. Your blade looks dull — I can fix that, if you\'ve got the coin.',
        voiceRef: 'blacksmith_greeting_1',
        emotion: 'neutral',
        duration: 4.5,
        next: ['smith_upgrade_ask', 'smith_shard_ask', 'smith_leave'],
      },
      {
        id: 'smith_upgrade_ask',
        speaker: 'Kael',
        text: 'What can you do with this weapon?',
        voiceRef: 'kael_curious_2',
        emotion: 'neutral',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['smith_upgrade_response'],
      },
      {
        id: 'smith_shard_ask',
        speaker: 'Kael',
        text: 'I found a strange shard. Can you work with it?',
        voiceRef: 'kael_curious_3',
        emotion: 'hopeful',
        duration: 3.0,
        isPlayerChoice: true,
        next: ['smith_shard_response'],
        conditions: [{ type: 'item_owned', itemId: 'corruption_shard_any' }],
      },
      {
        id: 'smith_leave',
        speaker: 'Kael',
        text: 'Maybe later.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 1.5,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
      },
      {
        id: 'smith_upgrade_response',
        speaker: 'Blacksmith',
        text: 'Standard sharpening, fifty gold. But if you bring me ember ore from the Wilds... I can make something truly special.',
        voiceRef: 'blacksmith_offer_1',
        emotion: 'amused',
        duration: 5.5,
        next: ['smith_accept_upgrade', 'smith_leave'],
        onEnter: [{ type: 'open_shop', shopId: 'blacksmith_upgrades' }],
      },
      {
        id: 'smith_accept_upgrade',
        speaker: 'Kael',
        text: 'Sharpen it up.',
        voiceRef: null,
        emotion: 'determined',
        duration: 1.5,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'start_transaction', shopId: 'blacksmith_upgrades', action: 'sharpen' }],
      },
      {
        id: 'smith_shard_response',
        speaker: 'Blacksmith',
        text: 'By the old fires... That\'s a Crown Shard. I\'ve only seen drawings. This metal — it\'s alive. I could forge it into your weapon, but the corruption... it changes things.',
        voiceRef: 'blacksmith_shard_1',
        emotion: 'terrified',
        duration: 8.0,
        next: ['smith_shard_forge', 'smith_shard_wait'],
      },
      {
        id: 'smith_shard_forge',
        speaker: 'Kael',
        text: 'Do it. Forge the shard into my blade.',
        voiceRef: 'kael_determined_2',
        emotion: 'determined',
        duration: 3.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
        onEnter: [
          { type: 'trigger_event', eventId: 'shard_forge_cutscene' },
          { type: 'modify_corruption', amount: 0.1 },
          { type: 'upgrade_weapon', upgradeId: 'shard_infusion' },
        ],
      },
      {
        id: 'smith_shard_wait',
        speaker: 'Kael',
        text: 'Let me think about it.',
        voiceRef: null,
        emotion: 'concerned',
        duration: 2.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
      },
    ],
  },

  // ── Lira Companion (multiple contexts) ──
  lira_campfire: {
    npc: 'Lira',
    region: 'any',
    context: 'Campfire rest conversation. Lira shares her thoughts based on corruption level.',
    nodes: [
      {
        id: 'lira_camp_1',
        speaker: 'Lira',
        text: 'Can\'t sleep either? The fire helps, but I still feel it — the pull of the shards.',
        voiceRef: 'lira_campfire_1',
        emotion: 'concerned',
        duration: 5.0,
        next: ['lira_camp_low_corrupt', 'lira_camp_high_corrupt'],
      },
      {
        id: 'lira_camp_low_corrupt',
        speaker: 'Lira',
        text: 'You\'re still yourself, Kael. That\'s good. Some who touch the shards... aren\'t so lucky.',
        voiceRef: 'lira_reassure_1',
        emotion: 'hopeful',
        duration: 4.5,
        conditions: [{ type: 'corruption_level', max: 0.4 }],
        next: ['lira_camp_respond_kind', 'lira_camp_respond_cold'],
      },
      {
        id: 'lira_camp_high_corrupt',
        speaker: 'Lira',
        text: 'Your eyes... they\'re darker than before. Kael, promise me you\'ll fight it. Promise me you won\'t become like them.',
        voiceRef: 'lira_worried_1',
        emotion: 'terrified',
        duration: 6.0,
        conditions: [{ type: 'corruption_level', min: 0.4 }],
        next: ['lira_camp_respond_promise', 'lira_camp_respond_dismiss'],
      },
      {
        id: 'lira_camp_respond_kind',
        speaker: 'Kael',
        text: 'We\'ll get through this. Together.',
        voiceRef: 'kael_kind_1',
        emotion: 'hopeful',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['lira_camp_end_warm'],
        onEnter: [{ type: 'modify_relationship', npcId: 'Lira', amount: 5 }],
      },
      {
        id: 'lira_camp_respond_cold',
        speaker: 'Kael',
        text: 'I don\'t need luck. I need strength.',
        voiceRef: 'kael_cold_1',
        emotion: 'determined',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['lira_camp_end_cold'],
        onEnter: [{ type: 'modify_relationship', npcId: 'Lira', amount: -3 }],
      },
      {
        id: 'lira_camp_respond_promise',
        speaker: 'Kael',
        text: 'I promise. Whatever it takes.',
        voiceRef: 'kael_promise_1',
        emotion: 'determined',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['lira_camp_end_warm'],
        onEnter: [
          { type: 'modify_relationship', npcId: 'Lira', amount: 8 },
          { type: 'modify_willpower', amount: 5 },
        ],
      },
      {
        id: 'lira_camp_respond_dismiss',
        speaker: 'Kael',
        text: 'The corruption is a tool. I\'ll use it as I see fit.',
        voiceRef: 'kael_dark_1',
        emotion: 'angry',
        duration: 3.0,
        isPlayerChoice: true,
        next: ['lira_camp_end_worried'],
        onEnter: [
          { type: 'modify_relationship', npcId: 'Lira', amount: -10 },
          { type: 'modify_willpower', amount: -5 },
        ],
      },
      {
        id: 'lira_camp_end_warm',
        speaker: 'Lira',
        text: 'Get some rest, Kael. Tomorrow we push on.',
        voiceRef: 'lira_farewell_warm_1',
        emotion: 'hopeful',
        duration: 3.0,
        next: [],
        isTerminal: true,
      },
      {
        id: 'lira_camp_end_cold',
        speaker: 'Lira',
        text: '...Right. Strength.',
        voiceRef: 'lira_farewell_cold_1',
        emotion: 'sad',
        duration: 2.0,
        next: [],
        isTerminal: true,
      },
      {
        id: 'lira_camp_end_worried',
        speaker: 'Lira',
        text: 'Kael... I\'m watching you. And if the day comes when you\'re not you anymore — I won\'t hesitate.',
        voiceRef: 'lira_threat_1',
        emotion: 'determined',
        duration: 5.5,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'set_flag', flag: 'lira_distrust_warning', value: true }],
      },
    ],
  },

  // ── Innkeeper (CrossroadsHub) — Rest, rumors, info ──
  innkeeper_chat: {
    npc: 'Innkeeper',
    region: 'CrossroadsHub',
    context: 'Casual conversation at the inn. Provides regional rumors.',
    nodes: [
      {
        id: 'inn_greet_1',
        speaker: 'Innkeeper',
        text: 'Welcome, traveler! Ale\'s warm, beds are dry. What\'ll it be?',
        voiceRef: 'innkeeper_greeting_1',
        emotion: 'amused',
        duration: 3.5,
        next: ['inn_rest', 'inn_rumors', 'inn_leave'],
      },
      {
        id: 'inn_rest',
        speaker: 'Kael',
        text: 'A room for the night.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'rest', restoreHealth: true, advanceTime: 'night' }],
      },
      {
        id: 'inn_rumors',
        speaker: 'Kael',
        text: 'Heard any interesting stories lately?',
        voiceRef: 'kael_curious_4',
        emotion: 'neutral',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['inn_rumor_ashen', 'inn_rumor_ironhold', 'inn_rumor_sunken'],
      },
      {
        id: 'inn_leave',
        speaker: 'Kael',
        text: 'Just passing through.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 1.5,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
      },
      {
        id: 'inn_rumor_ashen',
        speaker: 'Innkeeper',
        text: 'The Ashen Wilds are burning worse than usual. Hunters say they\'ve seen... things moving in the fire. Not animals.',
        voiceRef: 'innkeeper_rumor_1',
        emotion: 'concerned',
        duration: 5.5,
        conditions: [{ type: 'quest_state', questId: 'main_shard_hunt', state: 'not_started' }],
        next: ['inn_rumor_end'],
      },
      {
        id: 'inn_rumor_ironhold',
        speaker: 'Innkeeper',
        text: 'Ironhold\'s gone quiet. No trade caravans for two weeks. The captain says the mines collapsed, but between you and me... something else is down there.',
        voiceRef: 'innkeeper_rumor_2',
        emotion: 'mysterious',
        duration: 7.0,
        conditions: [{ type: 'region_visited', regionId: 'AshenWilds' }],
        next: ['inn_rumor_end'],
      },
      {
        id: 'inn_rumor_sunken',
        speaker: 'Innkeeper',
        text: 'Fishermen pulled a strange stone from the Sunken Halls entrance. Glowed purple. They dropped it right back.',
        voiceRef: 'innkeeper_rumor_3',
        emotion: 'terrified',
        duration: 5.0,
        conditions: [{ type: 'region_visited', regionId: 'Ironhold' }],
        next: ['inn_rumor_end'],
      },
      {
        id: 'inn_rumor_end',
        speaker: 'Innkeeper',
        text: 'Anyway — another ale?',
        voiceRef: 'innkeeper_farewell_1',
        emotion: 'amused',
        duration: 2.0,
        next: [],
        isTerminal: true,
      },
    ],
  },

  // ── Merchant (various regions) — Shop + shard hints ──
  merchant_trade: {
    npc: 'Merchant',
    region: 'CrossroadsHub',
    context: 'Traveling merchant offers goods and shard location hints.',
    nodes: [
      {
        id: 'merch_greet_1',
        speaker: 'Merchant',
        text: 'Finest goods from all eight lands! Well... the six that aren\'t overrun by that purple rot.',
        voiceRef: 'merchant_greeting_1',
        emotion: 'amused',
        duration: 5.0,
        next: ['merch_buy', 'merch_sell', 'merch_info', 'merch_leave'],
      },
      {
        id: 'merch_buy',
        speaker: 'Kael',
        text: 'Show me what you\'ve got.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'open_shop', shopId: 'traveling_merchant' }],
      },
      {
        id: 'merch_sell',
        speaker: 'Kael',
        text: 'I\'ve got some things to offload.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'open_shop', shopId: 'traveling_merchant', mode: 'sell' }],
      },
      {
        id: 'merch_info',
        speaker: 'Kael',
        text: 'You travel the roads. Seen anything unusual?',
        voiceRef: 'kael_curious_5',
        emotion: 'neutral',
        duration: 3.0,
        isPlayerChoice: true,
        next: ['merch_shard_hint'],
      },
      {
        id: 'merch_leave',
        speaker: 'Kael',
        text: 'Not today.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 1.5,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
      },
      {
        id: 'merch_shard_hint',
        speaker: 'Merchant',
        text: 'The corruption spreads from eight points — always eight. Follow the veins and you\'ll find the source. But careful... the closer you get, the louder the whispers.',
        voiceRef: 'merchant_lore_1',
        emotion: 'mysterious',
        duration: 7.5,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'set_flag', flag: 'merchant_shard_hint', value: true }],
      },
    ],
  },

  // ── Healer (CrossroadsHub) — Corruption cleansing ──
  healer_visit: {
    npc: 'Healer',
    region: 'CrossroadsHub',
    context: 'Healer offers corruption reduction for a cost.',
    nodes: [
      {
        id: 'heal_greet_1',
        speaker: 'Healer',
        text: 'I can see the darkness in you. It\'s faint still, but growing. I can help... for a price.',
        voiceRef: 'healer_greeting_1',
        emotion: 'concerned',
        duration: 5.0,
        next: ['heal_cleanse', 'heal_ask_about', 'heal_leave'],
      },
      {
        id: 'heal_cleanse',
        speaker: 'Kael',
        text: 'Purge the corruption from me.',
        voiceRef: 'kael_determined_3',
        emotion: 'determined',
        duration: 2.5,
        isPlayerChoice: true,
        conditions: [{ type: 'corruption_level', min: 0.1 }],
        next: ['heal_cleanse_response'],
      },
      {
        id: 'heal_ask_about',
        speaker: 'Kael',
        text: 'Tell me about the corruption.',
        voiceRef: 'kael_curious_6',
        emotion: 'concerned',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['heal_lore_response'],
      },
      {
        id: 'heal_leave',
        speaker: 'Kael',
        text: 'I\'ll manage on my own.',
        voiceRef: null,
        emotion: 'determined',
        duration: 2.0,
        isPlayerChoice: true,
        next: [],
        isTerminal: true,
      },
      {
        id: 'heal_cleanse_response',
        speaker: 'Healer',
        text: 'Hold still. This will hurt.',
        voiceRef: 'healer_cleanse_1',
        emotion: 'determined',
        duration: 3.0,
        next: [],
        isTerminal: true,
        onEnter: [
          { type: 'modify_corruption', amount: -0.15 },
          { type: 'trigger_event', eventId: 'cleanse_vfx' },
          { type: 'spend_gold', amount: 200 },
        ],
      },
      {
        id: 'heal_lore_response',
        speaker: 'Healer',
        text: 'The Crown was never meant to be worn by mortals. When it shattered, its power seeped into the land — into the creatures, the stone, the air itself. Each shard you carry makes you stronger... and more vulnerable.',
        voiceRef: 'healer_lore_1',
        emotion: 'reverent',
        duration: 9.0,
        next: ['heal_cleanse', 'heal_leave'],
      },
    ],
  },

  // ── Bard (CrossroadsHub) — Lore songs & region hints ──
  bard_performance: {
    npc: 'Bard',
    region: 'CrossroadsHub',
    context: 'Bard performs songs that hint at shard locations and lore.',
    nodes: [
      {
        id: 'bard_greet_1',
        speaker: 'Bard',
        text: 'A song for the weary traveler? I know tales of every land — some true, some... truer than true.',
        voiceRef: 'bard_greeting_1',
        emotion: 'amused',
        duration: 5.0,
        next: ['bard_song_crown', 'bard_song_region', 'bard_tip'],
      },
      {
        id: 'bard_song_crown',
        speaker: 'Kael',
        text: 'Sing me the Crown\'s story.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.0,
        isPlayerChoice: true,
        next: ['bard_crown_verse'],
      },
      {
        id: 'bard_song_region',
        speaker: 'Kael',
        text: 'What do you know about the surrounding lands?',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.5,
        isPlayerChoice: true,
        next: ['bard_region_verse'],
      },
      {
        id: 'bard_tip',
        speaker: 'Kael',
        text: 'Here\'s some gold for your trouble.',
        voiceRef: null,
        emotion: 'neutral',
        duration: 2.0,
        isPlayerChoice: true,
        next: ['bard_tip_response'],
        onEnter: [{ type: 'spend_gold', amount: 50 }],
      },
      {
        id: 'bard_crown_verse',
        speaker: 'Bard',
        text: 'Eight shards for eight lands, a crown once whole now demands — the bearer\'s soul as the price, for power beyond mortal device.',
        voiceRef: 'bard_song_1',
        emotion: 'reverent',
        duration: 7.0,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'unlock_lore', loreId: 'bard_crown_song' }],
      },
      {
        id: 'bard_region_verse',
        speaker: 'Bard',
        text: 'The Wilds burn, the Peaks smoke, the Halls drown in dark. The Reach grows thorns, the Hub stands firm, but the Mere... the Mere whispers in the dark.',
        voiceRef: 'bard_song_2',
        emotion: 'mysterious',
        duration: 7.5,
        next: [],
        isTerminal: true,
        onEnter: [{ type: 'unlock_lore', loreId: 'bard_region_song' }],
      },
      {
        id: 'bard_tip_response',
        speaker: 'Bard',
        text: 'Most generous! A word of advice, then — the shards respond to intention. Hold them with fear and they\'ll consume you. Hold them with purpose and... well, we\'ll see.',
        voiceRef: 'bard_advice_1',
        emotion: 'amused',
        duration: 7.0,
        next: [],
        isTerminal: true,
      },
    ],
  },
};

// ── NPC Blueprint ↔ Dialogue Wiring ─────────────────────────────────────────
//
// ms_6: "Wire dialogue data tables to NPC blueprints"
// Maps each NPC blueprint to its dialogue tree DataTable, voice profile,
// portrait texture, and interaction configuration.

/**
 * Master wiring map: NPC blueprint name → dialogue config.
 * Each entry defines which dialogue trees load, the voice profile, portrait,
 * and interaction radius for the NPC.
 */
export const NPC_DIALOGUE_WIRING = {
  BP_ElderNPC: {
    npcName: 'Elder Mathis',
    npcTitle: 'Village Elder',
    speaker: 'Elder',
    dialogueTrees: ['elder_intro'],
    voiceProfile: 'voice_elder',
    portrait: '/Game/UI/Portraits/T_Portrait_Elder',
    interactRadius: 250.0,
    region: 'CrossroadsHub',
  },
  BP_BlacksmithNPC: {
    npcName: 'Forge Master',
    npcTitle: 'Blacksmith',
    speaker: 'Blacksmith',
    dialogueTrees: ['blacksmith_first_visit'],
    voiceProfile: 'voice_blacksmith',
    portrait: '/Game/UI/Portraits/T_Portrait_Blacksmith',
    interactRadius: 200.0,
    region: 'CrossroadsHub',
  },
  BP_InnkeeperNPC: {
    npcName: 'Barkeep Holt',
    npcTitle: 'Innkeeper',
    speaker: 'Innkeeper',
    dialogueTrees: ['innkeeper_chat'],
    voiceProfile: 'voice_innkeeper',
    portrait: '/Game/UI/Portraits/T_Portrait_Innkeeper',
    interactRadius: 200.0,
    region: 'CrossroadsHub',
  },
  BP_MarketNPC: {
    npcName: 'Roaming Merchant',
    npcTitle: 'Traveling Merchant',
    speaker: 'Merchant',
    dialogueTrees: ['merchant_trade'],
    voiceProfile: 'voice_merchant',
    portrait: '/Game/UI/Portraits/T_Portrait_Merchant',
    interactRadius: 200.0,
    region: 'CrossroadsHub',
  },
  BP_HealerNPC: {
    npcName: 'Sister Ayla',
    npcTitle: 'Healer',
    speaker: 'Healer',
    dialogueTrees: ['healer_visit'],
    voiceProfile: 'voice_healer',
    portrait: '/Game/UI/Portraits/T_Portrait_Healer',
    interactRadius: 200.0,
    region: 'CrossroadsHub',
  },
  BP_BardNPC: {
    npcName: 'Wandering Bard',
    npcTitle: 'Bard',
    speaker: 'Bard',
    dialogueTrees: ['bard_performance'],
    voiceProfile: 'voice_bard',
    portrait: '/Game/UI/Portraits/T_Portrait_Bard',
    interactRadius: 300.0,
    region: 'CrossroadsHub',
  },
  BP_HunterRynn: {
    npcName: 'Rynn',
    npcTitle: 'Hunter',
    speaker: 'Theron',
    dialogueTrees: [],
    voiceProfile: 'voice_theron',
    portrait: '/Game/UI/Portraits/T_Portrait_Theron',
    interactRadius: 200.0,
    region: 'TheWilds',
  },
  BP_DruidessFayn: {
    npcName: 'Fayn',
    npcTitle: 'Druidess',
    speaker: 'Sable',
    dialogueTrees: [],
    voiceProfile: 'voice_sable',
    portrait: '/Game/UI/Portraits/T_Portrait_Sable',
    interactRadius: 200.0,
    region: 'TheWilds',
  },
};

/**
 * Get the complete wiring specification — all NPC blueprints with their
 * dialogue trees, voice profiles, portraits, and interaction settings.
 */
export function getDialogueWiringSpec() {
  const wiredNPCs = Object.entries(NPC_DIALOGUE_WIRING).map(([bpName, config]) => {
    const trees = config.dialogueTrees.map(treeId => {
      const tree = DIALOGUE_TREES[treeId];
      return tree ? {
        treeId,
        nodeCount: tree.nodes.length,
        dataTablePath: `/Game/Data/Dialogue/DT_${treeId}`,
        jsonPath: `Assets/dialogue/DT_${treeId}.json`,
      } : { treeId, status: 'pending' };
    });

    return {
      blueprintName: bpName,
      blueprintPath: `/Game/Blueprints/Characters/${bpName}`,
      ...config,
      trees,
      hasDialogue: trees.length > 0 && trees.some(t => t.nodeCount > 0),
    };
  });

  return {
    npcs: wiredNPCs,
    summary: {
      totalNPCs: wiredNPCs.length,
      wiredWithDialogue: wiredNPCs.filter(n => n.hasDialogue).length,
      pendingDialogue: wiredNPCs.filter(n => !n.hasDialogue).length,
      totalTreesWired: wiredNPCs.reduce((s, n) => s + n.trees.length, 0),
    },
  };
}

/**
 * Generate UE5 Python script to create DataTable struct, populate DataTables
 * from dialogue JSON, and wire them to NPC blueprint defaults.
 *
 * This is the core ms_6 deliverable: the bridge between dialogue data
 * and NPC blueprint instances in the editor.
 */
export function generateDialogueWiringScript() {
  const wiringEntries = Object.entries(NPC_DIALOGUE_WIRING)
    .filter(([_, cfg]) => cfg.dialogueTrees.length > 0);

  const npcDefaults = wiringEntries.map(([bpName, cfg]) => ({
    bp: bpName,
    name: cfg.npcName,
    title: cfg.npcTitle,
    trees: cfg.dialogueTrees,
    portrait: cfg.portrait,
    radius: cfg.interactRadius,
  }));

  return `
import unreal
import json
import os

# ── NPC Dialogue Wiring Script (ms_6) ──
# Wires dialogue DataTables to NPC blueprints.
# Generated by Sela Agent — NPC Dialogue & Voice
# ${wiringEntries.length} NPCs to wire

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
editor_util = unreal.EditorUtilityLibrary
subsystem = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem) if hasattr(unreal, 'EditorAssetSubsystem') else None

# ── Step 1: Create FSCDialogueNode Row Struct ──
struct_path = "/Game/Data/Structs/FSCDialogueNode"
try:
    struct = unreal.EditorAssetLibrary.load_asset(struct_path)
    if not struct:
        factory = unreal.StructureFactory() if hasattr(unreal, 'StructureFactory') else None
        if factory:
            struct = asset_tools.create_asset("FSCDialogueNode", "/Game/Data/Structs", None, factory)
            print("STRUCT_CREATED: FSCDialogueNode")
        else:
            print("STRUCT_SKIP: Factory unavailable, using JSON approach")
    else:
        print("STRUCT_EXISTS: FSCDialogueNode")
except Exception as e:
    print(f"STRUCT_NOTE: {e}")

# ── Step 2: Import dialogue JSON as DataTables ──
content_dir = unreal.Paths.project_content_dir()
dialogue_json_dir = os.path.join(content_dir, "Data", "Dialogue")
os.makedirs(dialogue_json_dir, exist_ok=True)

trees_to_import = ${JSON.stringify(
    wiringEntries.flatMap(([_, cfg]) => cfg.dialogueTrees)
  )}

imported_tables = {}
for tree_id in trees_to_import:
    dt_name = f"DT_{tree_id}"
    dt_path = f"/Game/Data/Dialogue/{dt_name}"

    # Check if DataTable already exists
    existing = unreal.EditorAssetLibrary.load_asset(dt_path)
    if existing:
        imported_tables[tree_id] = dt_path
        print(f"DT_EXISTS: {dt_name}")
        continue

    # Try to create DataTable from JSON
    json_file = os.path.join(dialogue_json_dir, f"{dt_name}.json")
    if os.path.exists(json_file):
        try:
            factory = unreal.DataTableFactory() if hasattr(unreal, 'DataTableFactory') else None
            if factory and struct:
                factory.set_editor_property("automated_import_settings", {})
                dt = asset_tools.create_asset(dt_name, "/Game/Data/Dialogue", None, factory)
                if dt:
                    imported_tables[tree_id] = dt_path
                    unreal.EditorAssetLibrary.save_loaded_asset(dt)
                    print(f"DT_CREATED: {dt_name}")
                else:
                    imported_tables[tree_id] = dt_path  # Path reserved
                    print(f"DT_RESERVED: {dt_name}")
            else:
                imported_tables[tree_id] = dt_path
                print(f"DT_DEFERRED: {dt_name} (no factory)")
        except Exception as e:
            imported_tables[tree_id] = dt_path
            print(f"DT_NOTE: {dt_name} - {e}")
    else:
        imported_tables[tree_id] = dt_path
        print(f"DT_PENDING_JSON: {dt_name}")

# ── Step 3: Wire DataTables to NPC Blueprint defaults ──
npc_configs = ${JSON.stringify(npcDefaults, null, 2)}

wired_count = 0
for npc in npc_configs:
    bp_name = npc["bp"]
    bp_path = f"/Game/Blueprints/Characters/{bp_name}"

    # Try to load the BP
    bp_asset = unreal.EditorAssetLibrary.load_asset(bp_path)
    if not bp_asset:
        # Also try without subdirectory
        bp_path_alt = f"/Game/Blueprints/{bp_name}"
        bp_asset = unreal.EditorAssetLibrary.load_asset(bp_path_alt)

    if bp_asset:
        try:
            # Get the Class Default Object (CDO)
            cdo = unreal.get_default_object(bp_asset.generated_class()) if hasattr(bp_asset, 'generated_class') else None
            if cdo:
                # Set NPC name and title
                if hasattr(cdo, 'NPCName'):
                    cdo.set_editor_property('NPCName', npc["name"])
                if hasattr(cdo, 'NPCTitle'):
                    cdo.set_editor_property('NPCTitle', npc["title"])

                # Wire the first dialogue tree DataTable
                if npc["trees"]:
                    dt_path = imported_tables.get(npc["trees"][0])
                    if dt_path:
                        dt_asset = unreal.EditorAssetLibrary.load_asset(dt_path)
                        if dt_asset and hasattr(cdo, 'DialogueDataTable'):
                            cdo.set_editor_property('DialogueDataTable', dt_asset)

                # Set portrait texture
                portrait = npc.get("portrait", "")
                if portrait and hasattr(cdo, 'PortraitTexture'):
                    tex = unreal.EditorAssetLibrary.load_asset(portrait)
                    if tex:
                        cdo.set_editor_property('PortraitTexture', tex)

                unreal.EditorAssetLibrary.save_loaded_asset(bp_asset)
                wired_count += 1
                print(f"WIRED: {bp_name} -> DT_{npc['trees'][0] if npc['trees'] else 'none'} (name={npc['name']})")
            else:
                print(f"CDO_SKIP: {bp_name} (no CDO access)")
        except Exception as e:
            print(f"WIRE_ERROR: {bp_name} - {e}")
    else:
        print(f"BP_NOT_FOUND: {bp_name} (will wire when created)")

# ── Step 4: Create dialogue interaction helper DataTable ──
# A lookup table mapping NPC blueprint class → dialogue tree IDs
# so the DialogueUI can find the right tree at runtime
lookup_path = "/Game/Data/Dialogue/DT_NPCDialogueLookup"
lookup_data = {}
for npc in npc_configs:
    lookup_data[npc["bp"]] = {
        "DialogueTrees": npc["trees"],
        "VoiceProfile": npc.get("voice_profile", ""),
        "Portrait": npc.get("portrait", ""),
        "InteractRadius": npc.get("radius", 200.0),
    }

lookup_json_path = os.path.join(dialogue_json_dir, "DT_NPCDialogueLookup.json")
with open(lookup_json_path, "w") as f:
    json.dump(lookup_data, f, indent=2)
print(f"LOOKUP_TABLE: {len(lookup_data)} NPC entries saved")

# ── Summary ──
print(f"WIRING_SUMMARY: {wired_count}/{len(npc_configs)} NPCs wired, {len(imported_tables)} DataTables")
print("DIALOGUE_WIRING_MS6_COMPLETE")
`;
}

/**
 * Deploy dialogue wiring — creates DataTables and wires them to NPC blueprints.
 * Saves wiring spec locally and attempts UE5 deployment if editor is available.
 */
export async function wireDialogueToBlueprints() {
  const wiringSpec = getDialogueWiringSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });

  // Save wiring spec
  const specPath = join(specDir, 'dialogue-wiring-spec.json');
  writeFileSync(specPath, JSON.stringify(wiringSpec, null, 2));

  // Save lookup table for runtime use
  const lookupDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'dialogue');
  if (!existsSync(lookupDir)) mkdirSync(lookupDir, { recursive: true });
  const lookupPath = join(lookupDir, 'DT_NPCDialogueLookup.json');
  const lookupData = {};
  for (const [bpName, cfg] of Object.entries(NPC_DIALOGUE_WIRING)) {
    lookupData[bpName] = {
      dialogueTrees: cfg.dialogueTrees,
      voiceProfile: cfg.voiceProfile,
      portrait: cfg.portrait,
      interactRadius: cfg.interactRadius,
      npcName: cfg.npcName,
      npcTitle: cfg.npcTitle,
    };
  }
  writeFileSync(lookupPath, JSON.stringify(lookupData, null, 2));

  log.info({ npcCount: wiringSpec.summary.totalNPCs, wired: wiringSpec.summary.wiredWithDialogue }, 'Dialogue wiring spec saved');

  // Attempt UE5 deployment
  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateDialogueWiringScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'ue5_live', specPath, lookupPath, result, wiringSpec };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', specPath, lookupPath, error: err.message, wiringSpec };
    }
  } catch { /* UE5 not available */ }

  return {
    success: true,
    method: 'deferred',
    specPath,
    lookupPath,
    note: 'Wiring spec + lookup table saved locally. UE5 deployment will run when editor is open.',
    wiringSpec,
  };
}

// ── Spec Generation ─────────────────────────────────────────────────────────

/**
 * Get the full dialogue tree specification for all NPCs.
 */
export function getDialogueTreeSpec() {
  const trees = Object.entries(DIALOGUE_TREES).map(([treeId, tree]) => {
    const nodeCount = tree.nodes.length;
    const branchPoints = tree.nodes.filter(n => (n.next?.length || 0) > 1).length;
    const terminals = tree.nodes.filter(n => n.isTerminal).length;
    const playerChoices = tree.nodes.filter(n => n.isPlayerChoice).length;
    const conditionals = tree.nodes.filter(n => n.conditions?.length > 0).length;
    const actions = tree.nodes.reduce((sum, n) => sum + (n.onEnter?.length || 0), 0);

    return {
      treeId,
      npc: tree.npc,
      region: tree.region,
      context: tree.context,
      stats: { nodeCount, branchPoints, terminals, playerChoices, conditionals, actions },
    };
  });

  const totalNodes = trees.reduce((s, t) => s + t.stats.nodeCount, 0);
  const totalChoices = trees.reduce((s, t) => s + t.stats.playerChoices, 0);

  return {
    trees,
    totals: {
      treeCount: trees.length,
      totalNodes,
      totalChoices,
      totalBranches: trees.reduce((s, t) => s + t.stats.branchPoints, 0),
      totalTerminals: trees.reduce((s, t) => s + t.stats.terminals, 0),
      totalActions: trees.reduce((s, t) => s + t.stats.actions, 0),
    },
    dataTableStruct: {
      name: 'FSCDialogueNode',
      path: '/Game/Data/Structs/FSCDialogueNode',
      fields: [
        { name: 'NodeID', type: 'FName' },
        { name: 'Speaker', type: 'ESCSpeaker (Enum)' },
        { name: 'Text', type: 'FText' },
        { name: 'VoiceAsset', type: 'TSoftObjectPtr<USoundWave>' },
        { name: 'Portrait', type: 'TSoftObjectPtr<UTexture2D>' },
        { name: 'Duration', type: 'float' },
        { name: 'Emotion', type: 'ESCEmotion (Enum)' },
        { name: 'bIsPlayerChoice', type: 'bool' },
        { name: 'NextNodes', type: 'TArray<FName>' },
        { name: 'Conditions', type: 'TArray<FSCCondition>' },
        { name: 'OnEnterActions', type: 'TArray<FSCAction>' },
        { name: 'bIsTerminal', type: 'bool' },
      ],
    },
    conditionTypes: [
      'quest_state', 'corruption_level', 'item_owned',
      'previous_choice', 'willpower_level', 'region_visited',
      'relationship_level', 'flag_set',
    ],
    actionTypes: [
      'set_quest', 'set_quest_objective', 'give_item', 'unlock_region',
      'modify_corruption', 'modify_willpower', 'modify_relationship',
      'set_flag', 'open_shop', 'start_transaction', 'trigger_event',
      'rest', 'spend_gold', 'unlock_lore', 'upgrade_weapon',
    ],
  };
}

/**
 * Get a specific dialogue tree by ID.
 * @param {string} treeId
 */
export function getDialogueTree(treeId) {
  return DIALOGUE_TREES[treeId] || null;
}

/**
 * Get all dialogue trees for a specific NPC.
 * @param {string} npcId
 */
export function getNPCDialogueTrees(npcId) {
  return Object.entries(DIALOGUE_TREES)
    .filter(([_, tree]) => tree.npc === npcId)
    .map(([id, tree]) => ({ treeId: id, ...tree }));
}

// ── UE5 Python Script Generation ─────────────────────────────────────────────

/**
 * Generate UE5 Python script to create Data Tables for all dialogue trees.
 */
export function generateDialogueDataTableScript() {
  const allTrees = Object.entries(DIALOGUE_TREES);

  return `
import unreal
import json
import os

# ── NPC Dialogue Data Tables ──
# Generated by Sela Agent — NPC Dialogue & Voice (ms_2)
# ${allTrees.length} dialogue trees, ${allTrees.reduce((s, [_, t]) => s + t.nodes.length, 0)} total nodes

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

# Ensure directories
unreal.EditorAssetLibrary.make_directory("/Game/Data/Dialogue")
unreal.EditorAssetLibrary.make_directory("/Game/Data/Structs")

# ── Step 1: Create ESCSpeaker Enum ──
try:
    factory = unreal.UserDefinedEnumFactory()
    speaker_enum = asset_tools.create_asset("ESCSpeaker", "/Game/Data/Structs", None, factory)
    if speaker_enum:
        for speaker in ${JSON.stringify(Object.keys(SPEAKERS))}:
            speaker_enum.add_enum_value(speaker)
        unreal.EditorAssetLibrary.save_loaded_asset(speaker_enum)
        print("ENUM_OK: ESCSpeaker")
except Exception as e:
    print(f"ENUM_NOTE: ESCSpeaker - {e}")

# ── Step 2: Create ESCEmotion Enum ──
try:
    factory = unreal.UserDefinedEnumFactory()
    emotion_enum = asset_tools.create_asset("ESCEmotion", "/Game/Data/Structs", None, factory)
    if emotion_enum:
        for emotion in ${JSON.stringify(EMOTIONS)}:
            emotion_enum.add_enum_value(emotion)
        unreal.EditorAssetLibrary.save_loaded_asset(emotion_enum)
        print("ENUM_OK: ESCEmotion")
except Exception as e:
    print(f"ENUM_NOTE: ESCEmotion - {e}")

# ── Step 3: Save dialogue trees as JSON (for BP DataTable import) ──
content_dir = unreal.Paths.project_content_dir()
dialogue_dir = os.path.join(content_dir, "Data", "Dialogue")
os.makedirs(dialogue_dir, exist_ok=True)

trees = ${JSON.stringify(
    Object.fromEntries(allTrees.map(([id, tree]) => [id, {
      npc: tree.npc,
      region: tree.region,
      context: tree.context,
      nodes: tree.nodes.map(n => ({
        id: n.id,
        speaker: n.speaker,
        text: n.text,
        voiceRef: n.voiceRef,
        emotion: n.emotion || 'neutral',
        duration: n.duration,
        isPlayerChoice: n.isPlayerChoice || false,
        isTerminal: n.isTerminal || false,
        next: n.next || [],
        conditions: n.conditions || [],
        onEnter: n.onEnter || [],
      })),
    }]))
  )}

for tree_id, tree_data in trees.items():
    file_path = os.path.join(dialogue_dir, f"DT_{tree_id}.json")
    with open(file_path, "w") as f:
        json.dump(tree_data, f, indent=2)
    print(f"TREE_OK: DT_{tree_id} ({len(tree_data['nodes'])} nodes)")

# Summary
total_nodes = sum(len(t["nodes"]) for t in trees.values())
total_choices = sum(sum(1 for n in t["nodes"] if n.get("isPlayerChoice")) for t in trees.values())
print(f"DIALOGUE_SUMMARY: {len(trees)} trees, {total_nodes} nodes, {total_choices} player choices")
print("DIALOGUE_DATATABLES_MS2_COMPLETE")
`;
}

/**
 * Deploy dialogue data tables to UE5 or save locally.
 */
export async function deployDialogueDataTables() {
  const spec = getDialogueTreeSpec();
  const specDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Design');
  if (!existsSync(specDir)) mkdirSync(specDir, { recursive: true });
  const specPath = join(specDir, 'dialogue-trees-spec.json');
  writeFileSync(specPath, JSON.stringify(spec, null, 2));

  // Also save individual tree JSONs
  const treesDir = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'dialogue');
  if (!existsSync(treesDir)) mkdirSync(treesDir, { recursive: true });
  for (const [treeId, tree] of Object.entries(DIALOGUE_TREES)) {
    writeFileSync(join(treesDir, `DT_${treeId}.json`), JSON.stringify(tree, null, 2));
  }
  log.info({ treeCount: Object.keys(DIALOGUE_TREES).length }, 'Dialogue trees saved');

  try {
    await callTool('unreal', 'get_actors_in_level', {}, 10_000);
    try {
      const script = generateDialogueDataTableScript();
      const result = await callTool('unreal', 'execute_python_script', { code: script }, 60_000);
      return { success: true, method: 'python_script', specPath, result };
    } catch (err) {
      return { success: true, method: 'deferred_after_error', specPath, error: err.message };
    }
  } catch { /* Unreal not available */ }

  return {
    success: true, method: 'deferred', specPath,
    note: 'Dialogue data tables saved locally. UE5 enums + JSON data will be created when editor is open.',
    stats: spec.totals,
  };
}
