# Sela

A fully autonomous AI agent that lives in your WhatsApp. Built with [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp connectivity and Claude for intelligence. Sela doesn't just respond to messages — it proactively manages goals, writes code, generates 3D game assets, manages servers, runs a football team, monitors its own health, learns from outcomes, and adapts its behavior over time.

Single-user, always-on. Designed to run your life from your phone.

---

## Architecture Overview

Sela is a **signal-driven autonomous agent** with two independent processing paths, a module system for domain-specific capabilities, and a multi-server MCP backbone connecting to external tools.

```
                         +-------------------------------+
                         |       WhatsApp (Baileys)       |
                         +---------------+---------------+
                                         | incoming message
                                         v
                         +-------------------------------+
                         |   Debounce (2s) + Media        |
                         +---------------+---------------+
                                         |
                         +---------------v---------------+
                         |       Router (tier 0-3)        |
                         +-------+--------------+--------+
                                 |              |
                        NLU match|              | No match
                                 v              v
                    +-------------+    +--------------------+
                    | 18 intents  |    | Claude CLI          |
                    | (instant,   |    | + Vestige memory    |
                    |  zero LLM)  |    | + Skills + Tools    |
                    +-------------+    | + Trust Engine      |
                                       +--------------------+

 +----------------------------------------------------------------+
 |                  Agent Loop (every 10 min)                       |
 |                                                                  |
 |  1. Signal Collection --> 23+ detectors (core + modules)         |
 |  2. Cooldown Filter ----> per-signal-type dedup                  |
 |  3. pickSignals() ------> top 2, max 1 Sonnet, age escalation   |
 |  4. Prompt Assembly -----> briefs + memory + context + modules   |
 |  5. Claude Reasoning ----> Haiku (routine) / Sonnet (code/ops)  |
 |  6. Parse & Execute -----> goals, messages, tools, chains        |
 |  7. Writeback -----------> state timestamps, action log          |
 |  8. Decision Tracking ---> log decisions, link outcomes, learn   |
 +----------------------------------------------------------------+
                  |
 +----------------------------------------------------------------+
 |  Project Cycles (per-project, independent)                      |
 |                                                                  |
 |  Each project can run its own agent cycle with custom interval,  |
 |  model, MCP config, and signal detectors. Toggled on/off from   |
 |  the dashboard. Module-defined or user-created via KV store.    |
 +----------------------------------------------------------------+
                  |
 +----------------------------------------------------------------+
 |              MCP Gateway (7+ servers)                            |
 |                                                                  |
 |  Vestige --- semantic memory + fact ingestion                    |
 |  QMD ------- GPU-accelerated code search (BM25 + vector)        |
 |  Blender --- 3D asset generation + rendering                     |
 |  Unreal ---- UE5 Editor automation (TCP bridge)                  |
 |  VFX ------- video processing (ffmpeg)                           |
 |  Hattrick -- football team management (browser automation)       |
 |  Scrapling - web scraping                                        |
 +----------------------------------------------------------------+
```

### Two Processing Paths

**Reactive path** — A WhatsApp message arrives, gets debounced (2 seconds), routed through the NLU classifier (18 intents, Hebrew + English, zero LLM cost). If matched, handled instantly. Otherwise, forwarded to Claude with conversation history, memory context, and available tools.

**Proactive path** — The agent loop runs independently every 10 minutes. It scans 23+ signal detectors, filters through cooldowns, picks the top 2 most urgent signals, builds a context-rich prompt, and lets Claude decide what to do. The agent can send messages, advance goals, write code, generate 3D assets, trigger tools, create workflows, and learn from outcomes — all without any user input.

---

## The Signal System

The core of Sela's autonomy. Signals are **zero-cost detectors** — pure JavaScript checks against local state. No LLM calls until signals are collected and a cycle is triggered.

### Signal Flow

```
collectSignals() --> core detectors + module detectors produce raw signals
     |
     v
filterCooldowns() --> dedup by signal key (type + goal/cron/topic)
     |                  low=3h, medium=1h, high/critical=0
     v
pickSignals() --> max 2 per cycle, max 1 Sonnet-tier
     |              age-based escalation: 4+ days overdue -> low->medium
     v
buildAgentPrompt() --> assembles context block:
     |   - date/time + quiet hours flag
     |   - signal summaries with urgency tags
     |   - active goals + milestone briefs
     |   - module context providers (weekly plans, etc.)
     |   - learning context + reasoning journal
     |   - error analytics (if error_spike)
     |   - available tools list
     v
Claude (Haiku or Sonnet) --> reasons, decides, acts
     |
     v
parseAgentResponse() --> extracts structured tags:
     <wa_message>    -> send WhatsApp message
     <action_taken>  -> log what was done
     <goal_update>   -> advance a milestone
     <goal_create>   -> create new goal
     <tool_call>     -> invoke registered tool
     <followup>      -> schedule a check-in
     <reflection>    -> self-assessment
     <hypothesis>    -> reasoning journal entry
```

### Core Signal Types

| Signal | Urgency | Trigger |
|--------|---------|---------|
| `followup` | medium-high | Scheduled follow-up due |
| `goal_work` | medium | Active goal hasn't been worked on |
| `stale_goal` | low | Goal idle >7 days |
| `idle_conversation` | low | No messages in active thread |
| `cron_due` | medium | Cron job ready to fire |
| `error_spike` | high | 10+ errors/hour (2x spike vs baseline) |
| `anomaly` | high | 3+ agent cycle errors in 1 hour |
| `chain_opportunity` | medium | 3+ signals relate to same goal |
| `self_improvement` | low | Recurring error pattern (5+ times) |
| `pattern_observed` | low | Topic mentioned on 3+ different days |
| `plan_stuck` | medium | Workflow step stalled >2 hours |
| `user_disengaged` | high | Correlated: stale goals + conversation gap |

Modules register additional signal types (see module sections below).

---

## The Agent Loop

The main brain. Runs every 10 minutes (configurable), operates completely independently from WhatsApp message handling.

### Cycle Anatomy

1. **Signal collection** — All core detectors + module detectors run. Pure JS, no API calls.
2. **Cooldown filtering** — Each signal gets a unique key. Same key fired recently? Suppressed.
3. **Signal picking** — `pickSignals()` selects top 2 by urgency. Max 1 Sonnet-tier. Overdue signals get escalated.
4. **Prompt assembly** — Context block with module providers, recent actions, milestone briefs, learning context, reasoning journal, error analytics.
5. **Claude reasoning** — Haiku for routine, Sonnet for code and high-urgency signals.
6. **Response parsing** — Extracts structured XML tags. Each tag triggers specific actions.
7. **State writeback** — Updates timestamps, records actions, links decision outcomes.

### Model Selection

| Condition | Model | Why |
|-----------|-------|-----|
| High/critical urgency signal | Sonnet | Better reasoning for complex decisions |
| Goal work involves code keywords | Sonnet | Code generation quality |
| Signal type in module's `sonnetSignalTypes` | Sonnet | Module-declared complex work |
| Everything else | Haiku | 10x cheaper, fast enough for routine |

### Quiet Hours (23:00-08:00 Israel time)

- No WhatsApp messages sent
- Agent loop interval extends to 60 minutes
- **Exception**: Module urgent work bypasses quiet hours
- **Exception**: Critical signals keep 10-minute interval

### Project Cycles

Each project can run its own independent agent cycle, separate from the main loop. Project cycles have their own:
- Interval (default 10 min, configurable per project)
- Model (Sonnet/Haiku/Opus)
- MCP config (project-specific servers)
- Signal detectors (module-defined)
- **Prompt injection** — config-driven per-cycle context (see below)

Projects can be toggled on/off from the dashboard projects page. Module-defined projects (like MapleStory, Hattrick) come with built-in signal detectors and brief builders. User-created projects get a generic cycle that checks goals and milestones.

**Full isolation:** Independent-project goals, signals, and context are excluded from the main loop. Each project only sees its own goals, milestones, and prompt context. No cross-contamination.

### Project Cycle Injector (`project-cycle-injector.js`)

Config-driven prompt injection that gives each project cycle exactly the context it needs — no more, no less. New projects just add a JSON config in `data/project-injections/`.

**Per-goal phase tracking:**
```
thinking → planning → executing → validating → reporting → done
```
Auto-detects phase transitions from parsed agent output (tool calls, actions taken, messages sent). Each phase gets tailored instructions.

**Cycle memory:** Records what happened last cycle per goal. Injects "last cycle (Nmin ago): did X" so the agent doesn't repeat work.

**Smart context injection:**
1. Hard rules (always injected)
2. Chain plan templates (for automated workflows)
3. Per-goal briefs with phase state + next milestone
4. Doc sections — only the ones relevant to current goal work types
5. Protocol phases — matched to current goal phase (thinking gets research docs, executing gets build docs)

**Config example** (`data/project-injections/maplestory.json`):
```json
{
  "rules": ["Never delete existing content", "Always validate XML"],
  "workTypes": {
    "map_creation": { "keywords": "map|zone|area|dungeon", "sections": ["maps", "portals"] },
    "npc_scripting": { "keywords": "npc|quest|dialog", "sections": ["npcs", "quests"] }
  },
  "sectionDetectors": { "maps": "map|zone", "npcs": "npc|merchant" },
  "contextFiles": [{ "path": "docs/council.md", "type": "sections" }],
  "chainTemplates": { "map": "research → design → create XML → deploy → validate" }
}
```

---

## Auto-Coder

The autonomous code implementation engine. When the agent loop detects a goal with code-related milestones, the auto-coder takes over:

1. **Milestone selection** — `pickMilestone()` finds the next pending milestone from the highest-priority active goal
2. **Brief generation** — `buildMilestoneBrief()` produces a concrete implementation prompt with file paths, patterns to follow, and integration requirements
3. **Implementation** — Sonnet writes the code via tool bridge (`file_read`, `file_write`, `shell_exec`)
4. **Verification** — `runTests()` runs the project's test suite to validate changes
5. **Commit** — `commitAndReport()` creates a git commit and sends a Telegram notification

---

## Module System

Optional modules extend the agent without modifying core code. Dynamically discovered at startup from `modules/*/index.js`.

### Module Manifest

```javascript
// modules/my-module/index.js
export default {
  name: 'my-module',
  detectSignals: (state) => [{ type: 'my_signal', urgency: 'low', summary: '...' }],
  briefBuilders: { my_signal: (signal) => ({ title: '...', content: '...' }) },
  contextProviders: [() => '## Context\n...'],
  sonnetSignalTypes: ['my_complex_signal'],
  stateKey: 'my-module-state',
  stateKeyMap: { my_signal: 'lastMySignalAt' },
  hasUrgentWork: () => false,
  projectProcess: {                    // independent agent cycle for this project
    project: 'my-project',
    mcpConfig: 'mcp-config-custom.json',
    model: 'sonnet',
    cycleInterval: 10 * 60_000,
  },
  apiRoutes: [...],
  dashboard: { path: '/my-module', title: 'My Module', icon: '...', html: '...' },
};
```

All fields optional. Modules plug into: signal detection, brief injection, context injection, model selection, state writeback, quiet hours bypass, message routing, and independent project cycles.

---

## Included Modules

### Hattrick — Football Team Management

Autonomous management for [Hattrick.org](https://hattrick.org), a browser-based football management game.

**What the agent does:**
- Weekly planning with formation optimization
- Pre-match and post-match analysis
- Transfer market scouting and bidding (with financial safety limits)
- Training optimization based on player skills and age
- Youth academy management
- Economy monitoring

**Signals:** 20+ detectors — `match_prep`, `post_match`, `transfer_watch`, `training_due`, `economy`, `transfer_deadline` (critical, bypasses quiet hours)

**Tools:** 12 Hattrick MCP tools for full team automation via browser

**Dashboard:** Full team overview page with match schedule, transfer market, training plan

---

### MapleStory — Private Server Management (Agent Test Bed)

Full autonomous management of a MapleStory Cosmic v83 private server. This module serves as a **test bed for agent autonomy** — the agent manages a live game server end-to-end: infrastructure, content creation, monitoring, and player experience.

**What the agent does:**
- **Server lifecycle** — Start, stop, restart MySQL and the Cosmic game server. Detect crashes via port monitoring and log scanning. Auto-restart on failure.
- **Content creation** — Create custom NPCs, weapons, items, quests, events, and drop tables. The agent works through a content plan (10 NPCs, 8 weapons, 8 items, 15 drop tables, 5 skills, 5 quests, 3 events) autonomously.
- **Log monitoring** — Reads server logs to detect errors, diagnose crashes, and understand server health beyond simple port checks.
- **Player tracking** — Queries MySQL for online players, accounts, characters.
- **WZ data editing** — Direct XML manipulation of game data (mobs, skills, maps, equipment, items).
- **Bot population** — Spawns and manages AI bots that connect as real players with personalities, combat AI, and social behaviors.
- **Sprite generation** — Creates mob/NPC/item sprites via ComfyUI integration.

**Signals:**
| Signal | Urgency | Trigger |
|--------|---------|---------|
| `maple_server_down` | high | MySQL or Cosmic port not responding |
| `maple_content_work` | medium | Content plan not yet complete |
| `maple_log_errors` | medium | 3+ errors in recent 100 log lines |

**Tools (30+):**

| Category | Tools |
|----------|-------|
| Server | `maple_status`, `maple_start`, `maple_stop`, `maple_restart`, `maple_start_mysql`, `maple_stop_mysql` |
| Monitoring | `maple_logs`, `maple_log_list`, `maple_players` |
| NPCs | `maple_list_npcs`, `maple_read_npc`, `maple_write_npc`, `maple_place_npc` |
| Content | `maple_write_quest`, `maple_write_event`, `maple_add_drop`, `maple_get_drops` |
| Game Data | `maple_search`, `maple_mob_stats`, `maple_mob_edit`, `maple_skill_data`, `maple_skill_edit`, `maple_item_data`, `maple_equip_data`, `maple_wz_set` |
| DB | `maple_query` |
| Sprites | `maple_generate_sprite`, `maple_import_sprite` |
| Bots | `maple_spawn_bots`, `maple_list_bots`, `maple_bot_chat`, `maple_dismiss_bot` |

**Why it's a test bed:** The MapleStory module exercises every aspect of agent autonomy — infrastructure management (start/stop/restart services), content creation (writing game scripts), monitoring (log scanning, player tracking), error recovery (auto-restart on crash), and long-running autonomous work plans (content targets). If the agent can run a game server, it can manage anything.

---

### Unreal Engine — UE5 Game Development (Agent Test Bed)

Autonomous UE5 game development for **The Shattered Crown**, a dark fantasy action-adventure. This module is the other **agent test bed** — the agent designs and builds an entire game: C++ systems, blueprints, levels, assets, audio, and game balance.

**What the agent does:**
- **C++ generation** — Writes Unreal Engine C++ source files (headers + implementations) for gameplay systems
- **Blueprint building** — Generates UE5 Blueprint JSON for visual scripting nodes, connections, and variables
- **Level design** — Creates UE5 level maps with actor placement, lighting, region streaming
- **Asset pipeline** — Generates 3D assets in Blender via MCP, exports to FBX for UE5 import
- **Audio pipeline** — Generates music, SFX, ambient audio, and voice lines for game regions
- **Game balance** — Combo system balancing, corruption mechanic tuning, difficulty scaling
- **NPC dialogue** — Branching dialogue trees with condition-based responses

**Game Systems (14 subsystems, 129+ source files):**

| System | Description |
|--------|-------------|
| GAS Combat | Melee + shard powers via Gameplay Ability System |
| Corruption | 5-tier corruption mechanic affecting player and world |
| Companion AI | Lira companion with follow, combat, and combo behaviors |
| Boss Encounters | Multi-phase boss fights with arena mechanics |
| Dialogue | Condition-based branching dialogue trees |
| Region System | 7 biome regions with streaming + difficulty scaling |
| Quest Manager | Quest tracking, objectives, rewards |
| Shard Skill Trees | Skill progression and crafting |
| Dynamic Difficulty | Adaptive difficulty based on player performance |
| Save/Load | Checkpoint + manual save with slot management |
| Build Pipeline | CI/CD with platform abstraction (Win64/PS5/XSX) |
| HUD + UI | CommonUI-based menus, HUD, inventory |
| Performance Budget | Frame time tracking, memory budgets, LOD management |
| 3D Asset Pipeline | 54 assets auto-generated via Blender MCP |

**Signals:**
| Signal | Urgency | Trigger |
|--------|---------|---------|
| `ue5_build_work` | medium | Pending C++ files or blueprints to generate |
| `ue5_level_build` | medium | Level designs not yet created |
| `ue5_asset_gap` | medium | Assets referenced but not generated |

**Tools (20+):** `ue5_write_cpp`, `ue5_write_header`, `ue5_blueprint`, `ue5_level_build`, `ue5_import_asset`, `ue5_game_config`, `generate_asset`, `asset_progress`, and more.

**Why it's a test bed:** Building a full game tests the agent's ability to maintain coherent, long-term creative work across dozens of interdependent systems. The agent must understand architecture, write compilable C++, design balanced gameplay, and coordinate assets across Blender, audio generation, and UE5 — all autonomously over weeks of cycles.

---

### Asset Pipeline

Autonomous 3D asset generation for game projects. Reads a declarative manifest, generates assets in Blender via MCP, and exports to FBX.

```
asset-manifest.json --> 54 assets across 9 regions
        |
        v
detectAssetGeneration() --> signal fires when pending assets exist
        |
        v
Agent calls <tool_call name="generate_asset">
        |
        v
generateOneAsset() --> asset-pipeline.js
        |
        +-- 1. Clear Blender scene
        +-- 2. Generate geometry (region palette, poly budget, PBR materials)
        +-- 3. Export to FBX (UE5-compatible: -Y forward, Z up)
        +-- 4. Update manifest status
```

### Audio Pipeline

Generates music, sound effects, ambient audio, and voice lines for game regions. Manages a queue of audio assets with per-type generation strategies.

---

## MCP Gateway

Multi-server Model Context Protocol gateway. Connects to any MCP-compatible server defined in `mcp-config.json`. Lazy connections (spawned on first use), per-server circuit breakers, automatic reconnection with exponential backoff.

### Connected Servers

| Server | Transport | Purpose |
|--------|-----------|---------|
| **Vestige** | stdio | Semantic memory — fact ingestion, search, dedup |
| **QMD** | stdio | GPU-accelerated codebase search (BM25 + vector + reranking) |
| **Blender** | stdio | 3D modeling — execute Python in Blender, render, export FBX |
| **Unreal** | stdio->TCP | UE5 Editor automation — actors, levels, blueprints (port 55557) |
| **VFX** | stdio | Video processing — trim, resize, concat, filters, chroma key |
| **Hattrick** | stdio | Football team management — browser automation for Hattrick.org |
| **Scrapling** | stdio | Web scraping with anti-detection |

Multiple MCP configs exist for different contexts:
- `mcp-config.json` — full config for WhatsApp message handling
- `mcp-config-core.json` — core servers only (for generic project cycles)
- `mcp-config-maple.json` — MapleStory-specific servers

---

## Project System

Sela can onboard and manage entire software projects:

1. **Brief decomposition** — Describe a project in plain text. Claude decomposes it into goals + milestones.
2. **Workspace creation** — Creates `workspace/<project>/` with QMD auto-indexing for code search.
3. **Autonomous implementation** — Auto-coder picks milestones and implements them.
4. **Progress tracking** — Goals + milestones tracked in SQLite with status, completion timestamps.
5. **Dynamic agent cycling** — Any project can be toggled on/off for autonomous agent cycles from the dashboard. Configure interval and model per project.

---

## Learning System

Three interconnected learning mechanisms:

### Learning Journal
- Structured entries: `{ action, context, outcome, lesson }`
- Weekly Haiku synthesis extracts actionable rules
- Rules ingested into Vestige for long-term memory

### Reasoning Journal
- Open hypotheses with evidence tracking
- Conclusions with confidence scores
- Auto-pruned after 7 days
- Gives the agent multi-cycle reasoning chains

### Agent Learning
- Reflection cycle: analyzes errors, costs, signal resolution
- Goal momentum tracking
- Pattern extraction from past cycles

---

## Communication Channels

### WhatsApp (Primary)
- Context-aware conversation in Hebrew + English
- Personality defined in `SOUL.md` (auto-rewritten weekly based on engagement)
- Per-conversation history with compression at 40 messages
- Media handling (images, voice, documents)
- Semantic memory via Vestige MCP
- User notes system for persistent personal context

### Telegram (Alerts + Commands)
- Real-time alerts: errors, agent actions, cost warnings, milestone completions
- Remote commands: `/status`, `/shutdown`, `/cron`, `/cost`, `/memory`, `/recap`, `/notes`, `/help`

### Web Dashboard
- Real-time WebSocket updates at `http://localhost:4242`
- Pages: status, agent loop monitor, project browser, goals board, cron manager, memory browser
- Per-project agent pages (`/agent/{project}`) with cycle history, event log, signal details
- Module pages (dynamically added by modules)
- Agent cycle toggle on each project card
- **Event log features:** Every event labeled `[main]` or `[project-name]`. Clickable prompts and "view reply" modals on all cycle events. CLI spawn shows source context (main loop / project / user msg)

---

## Core Systems

### Agent Core

| Module | What It Does |
|--------|-------------|
| `agent-loop.js` | Main brain. 10-min cycle: signals -> prompt -> Claude -> parse -> execute -> learn |
| `agent-brain.js` | Pattern recognition, trust-gated proposals, behavior adaptation |
| `agent-signals.js` | 23+ zero-cost signal detectors |
| `agent-learning.js` | Reflection cycle — errors, costs, signal resolution, goal momentum |
| `module-loader.js` | Dynamic module discovery and registry from `modules/*/index.js` |
| `auto-coder.js` | Autonomous milestone implementation: pick -> brief -> code -> test -> commit |
| `projects.js` | Project onboarding, workspace management, dynamic agent cycle config |

### Communication

| Module | What It Does |
|--------|-------------|
| `whatsapp.js` | Baileys socket — message routing, media, connection recovery |
| `claude.js` | Claude CLI orchestration — `chatOneShot()` for single prompts |
| `claude-persistent.js` | Persistent Claude processes (WhatsApp + agent loop). Sub-second responses |
| `telegram.js` | Two-way Telegram bot — alerts and remote commands |
| `bot-ipc.js` | HTTP + WebSocket server for dashboard and API |

### Intelligence

| Module | What It Does |
|--------|-------------|
| `nlu-router.js` | 18-intent classifier (Hebrew + English). Zero LLM cost |
| `prompt-assembler.js` | Three-tier dynamic prompt (minimal/standard/full) |
| `tool-bridge.js` | Tool registry with built-in tools + skill companion auto-discovery |
| `mcp-gateway.js` | Multi-server MCP gateway — 7+ servers, lazy connect, circuit breakers |
| `chain-planner.js` | Multi-step workflow decomposition — 5 templates + LLM fallback |

### Autonomy

| Module | What It Does |
|--------|-------------|
| `trust-engine.js` | Per-action trust scores. Four levels: always-ask -> auto-execute |
| `workflow-engine.js` | Stateful DAG execution with pause/resume and user input gates |
| `confidence-gate.js` | Gates actions through confidence thresholds |
| `behavior-adaptor.js` | Maps context signals to behavior modifiers |
| `mood-engine.js` | Rule-based mood estimation (zero LLM cost) |

### Memory & State

| Module | What It Does |
|--------|-------------|
| `goals.js` | Goal CRUD with milestones, priority sorting, deadline alerts |
| `crons.js` | Cron job scheduler with quiet-hour suppression |
| `memory-tiers.js` | T1/T2/T3 weighted memory with decay and spaced repetition |
| `memory-index.js` | Unified memory search (Vestige + tiers + goals + notes) |
| `memory-guardian.js` | 5-tier heap monitoring with graduated response up to auto-restart |
| `user-notes.js` | Persistent personal notes with bot context injection |
| `state.js` | Key-value state in SQLite |
| `history.js` | Conversation persistence with compression at 40 messages |

### Operations

| Module | What It Does |
|--------|-------------|
| `error-recovery.js` | Error classification + contextual retry. Circuit breaker (3 failures/5min) |
| `cost-analytics.js` | Per-call token cost tracking. Daily/weekly/monthly rollups |
| `watchdog.js` | Separate PM2 process. Health pings + zombie process detection (PowerShell) |
| `self-review.js` | Weekly SOUL.md rewrite based on engagement patterns |
| `proactive.js` | 30-min maintenance loop: self-review, knowledge extraction, trust decay |

---

## Tool Bridge

The agent can invoke tools via XML tags in its response:

```xml
<tool_call name="generate_asset"></tool_call>
<tool_call name="file_read">{"path": "lib/config.js"}</tool_call>
<tool_call name="maple_start"></tool_call>
```

### Built-in Tools

| Tool | Description |
|------|-------------|
| `file_read` | Read a file from the sela directory |
| `file_write` | Write a file to workspace (sandboxed) |
| `shell_exec` | Execute a shell command (sandboxed, 30s timeout) |
| `generate_asset` | Generate next pending 3D asset via Blender MCP |
| `asset_progress` | Get asset pipeline status |

Modules register additional tools at startup (30+ for MapleStory, 20+ for Unreal, 12 for Hattrick).

---

## Prerequisites

- **Node.js** 20+ (ES modules)
- **Claude CLI** — authenticated via OAuth (`~/.claude/.credentials.json`)
- **PM2** (recommended) — process management and auto-restart
- **Vestige MCP** (optional) — persistent semantic memory
- **QMD** (optional) — local document search with BM25 + vector embeddings
- **Blender** (optional) — 3D asset generation via blender-mcp
- **Unreal Engine 5** (optional) — game project automation via unreal-engine-mcp
- **MySQL** (optional) — required for MapleStory module

## Installation

```bash
git clone <repo-url> sela
cd sela
npm install
```

### Configuration

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your values:
   ```
   ALLOWED_PHONE=<your-phone-without-plus>
   TELEGRAM_BOT_TOKEN=<from-botfather>
   TELEGRAM_CHAT_ID=<your-chat-id>
   DASHBOARD_SECRET=<dashboard-password>
   CLAUDE_MODEL=sonnet
   ```

3. Configure MCP servers in `mcp-config.json`:
   ```json
   {
     "mcpServers": {
       "vestige": { "command": "vestige-mcp" },
       "qmd": { "command": "qmd", "args": ["mcp"] },
       "blender": { "command": "python", "args": ["-m", "blender_mcp.server"] },
       "vfx-mcp": { "command": "python", "args": ["workspace/vfx-mcp/main.py"] },
       "unreal": { "command": "python", "args": ["workspace/unreal-engine-mcp/src/server.py"] }
     }
   }
   ```

4. (Optional) Customize personality in `SOUL.md`.

### First Run

```bash
node index.js
```

Scan the QR code with WhatsApp to link the bot as a paired device.

### Running with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## Project Structure

```
sela/
+-- index.js                # Entry point -- boots all subsystems
+-- dashboard.js            # Web dashboard server (port 4242)
+-- SOUL.md                 # Bot personality (auto-rewritten weekly)
+-- ecosystem.config.cjs    # PM2 config (sela + watchdog + dashboard)
+-- mcp-config.json         # MCP server registry
+-- mcp-config-core.json    # Core-only MCP config (for project cycles)
+-- mcp-config-maple.json   # MapleStory-specific MCP config
+-- lib/                    # Core modules (70+)
|   +-- agent-loop.js       # Main agent brain
|   +-- agent-signals.js    # 23+ signal detectors
|   +-- auto-coder.js       # Autonomous code implementation
|   +-- mcp-gateway.js      # Multi-server MCP gateway
|   +-- projects.js         # Project management + dynamic agent cycles
|   +-- tool-bridge.js      # Tool registry
|   +-- watchdog.js         # Health monitoring + zombie detection
|   +-- dashboard-html/     # Dashboard page generators
|   +-- ...
+-- modules/                # Optional modules (auto-discovered)
|   +-- hattrick/           # Football team management
|   +-- maplestory/         # Game server management (test bed)
|   +-- unreal/             # UE5 game development (test bed)
|   +-- asset-pipeline/     # 3D asset generation
|   +-- audio-pipeline/     # Audio generation
+-- skills/                 # Skill documents + JS companions
+-- plugins/                # Dynamic plugins
+-- test/                   # Test suite (27 suites)
+-- scripts/                # Utility scripts
+-- data/                   # Runtime data (gitignored)
|   +-- sela.db             # SQLite (goals, kv_state, costs, errors)
|   +-- state/              # Module + agent state
+-- workspace/              # Project workspaces
|   +-- Cosmic/             # MapleStory Cosmic v83 server
|   +-- shattered-crown/    # UE5 game project
|   +-- vfx-mcp/            # VFX MCP server
|   +-- unreal-engine-mcp/  # Unreal MCP server
+-- auth/                   # WhatsApp auth state (gitignored)
+-- logs/                   # Pino log files (gitignored)
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Bot status, uptime, queue stats |
| `/crons` | List all cron jobs |
| `/run <name>` | Trigger a cron job |
| `/cost [today\|week\|month]` | Cost report |
| `/memory <query>` | Search Vestige memories |
| `/notes` | List user notes |
| `/recap` | Daily activity summary |
| `/shutdown` | Graceful shutdown |
| `/help` | All commands |

## Tests

```bash
node test/run-all.js
```

27 test suites covering NLU routing, queue concurrency, cost analytics, history, formatting, intent matching, workflow execution, goal management, module loading, and more.

## License

ISC
