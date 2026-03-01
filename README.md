# Sela

A fully autonomous AI agent that lives in your WhatsApp. Built with [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp connectivity and Claude for intelligence. Sela doesn't just respond to messages — it proactively manages goals, writes code, generates 3D game assets, manages a football team, monitors its own health, learns from outcomes, and adapts its behavior based on context and trust.

Single-user, always-on. Designed to run your life from your phone.

---

## Architecture Overview

Sela is a **signal-driven autonomous agent** with two independent processing paths and a multi-server MCP backbone connecting to external tools (Blender, Unreal Engine, video processing, semantic memory, and more).

```
                         ┌──────────────────────────────┐
                         │       WhatsApp (Baileys)      │
                         └──────────┬───────────────────┘
                                    │ incoming message
                                    v
                         ┌──────────────────────┐
                         │   Debounce (2s)       │
                         │   + Media handling    │
                         └──────────┬───────────┘
                                    │
                         ┌──────────v───────────┐
                         │   Router (tier 0-3)   │
                         └───┬──────────────┬───┘
                             │              │
                    NLU match│              │ No match
                             v              v
                    ┌────────────┐  ┌───────────────────┐
                    │ 18 intents │  │ Claude CLI         │
                    │ (instant,  │  │ + Vestige memory   │
                    │  zero LLM) │  │ + QMD code search  │
                    └────────────┘  │ + Skills on demand │
                                    │ + Tool Bridge      │
                                    │ + Trust Engine     │
                                    └───────────────────┘

 ┌─────────────────────────────────────────────────────────────────┐
 │                  Agent Loop (every 10 min)                      │
 │                                                                 │
 │  1. Signal Collection ──> 23+ detectors (core + modules)        │
 │  2. Cooldown Filter ───> per-signal-type dedup                  │
 │  3. pickSignals() ─────> top 2, max 1 Sonnet, age escalation   │
 │  4. Prompt Assembly ───> briefs + memory + context + modules    │
 │  5. Claude Reasoning ──> Haiku (routine) / Sonnet/Opus (code)  │
 │  6. Parse & Execute ───> goals, messages, tools, chains, code   │
 │  7. Writeback ─────────> state timestamps, recent-actions log   │
 │  8. Decision Tracking ─> log decisions, link outcomes, learn    │
 └────────────────┬────────────────────────────────────────────────┘
                  │
                  v
 ┌─────────────────────────────────────────────────────────────────┐
 │              MCP Gateway (7 servers)                             │
 │                                                                 │
 │  Vestige ─── semantic memory + fact ingestion                   │
 │  QMD ─────── GPU-accelerated code search (BM25 + vector)        │
 │  Blender ─── 3D asset generation + rendering                    │
 │  Unreal ──── UE5 Editor automation (TCP bridge)                 │
 │  VFX ─────── video processing (ffmpeg)                          │
 │  Hattrick ── football team management (browser automation)      │
 │  Scrapling ─ web scraping                                       │
 └─────────────────────────────────────────────────────────────────┘
```

### Two Processing Paths

**Reactive path** — A WhatsApp message arrives, gets debounced (2 seconds), routed through the NLU classifier (18 intents, Hebrew + English, zero LLM cost). If matched, handled instantly. Otherwise, forwarded to Claude with conversation history, memory context, and available tools.

**Proactive path** — The agent loop runs independently every 10 minutes. It scans 23+ signal detectors, filters through cooldowns, picks the top 2 most urgent signals, builds a context-rich prompt, and lets Claude decide what to do. The agent can send messages, advance goals, write code, generate 3D assets, trigger tools, create workflows, and learn from outcomes — all without any user input.

---

## The Signal System

The core of Sela's autonomy. Signals are **zero-cost detectors** — pure JavaScript checks against local state. No LLM calls until signals are collected and a cycle is triggered.

### Signal Flow

```
collectSignals() ──> core detectors + module detectors produce raw signals
     │
     v
filterCooldowns() ──> dedup by signal key (type + goal/cron/topic)
     │                  low=3h, medium=1h, high/critical=0
     v
pickSignals() ──> max 2 per cycle, max 1 Sonnet-tier
     │              age-based escalation: 4+ days overdue → low→medium
     v
buildAgentPrompt() ──> assembles context block:
     │   - date/time + quiet hours flag
     │   - signal summaries with urgency tags
     │   - active goals + milestone briefs
     │   - module context providers (weekly plans, etc.)
     │   - learning context + reasoning journal
     │   - error analytics (if error_spike)
     │   - available tools list
     v
Claude (Haiku or Sonnet/Opus) ──> reasons, decides, acts
     │
     v
parseAgentResponse() ──> extracts structured tags:
     <wa_message>    → send WhatsApp message
     <action_taken>  → log what was done
     <goal_update>   → advance a milestone
     <goal_create>   → create new goal
     <tool_call>     → invoke registered tool
     <followup>      → schedule a check-in
     <reflection>    → self-assessment
     <hypothesis>    → reasoning journal entry
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
| `transfer_deadline` | critical | Hattrick auction expiring within 30 min |
| `asset_generation` | medium | Pending 3D assets in manifest |
| `chain_opportunity` | medium | 3+ signals relate to same goal |
| `self_improvement` | low | Recurring error pattern (5+ times) |
| `pattern_observed` | low | Topic mentioned on 3+ different days |
| `plan_stuck` | medium | Workflow step stalled >2 hours |
| `user_disengaged` | high | Correlated: stale goals + conversation gap |

Modules can register additional signal types via the module system.

---

## Auto-Coder

The autonomous code implementation engine. When the agent loop detects a goal with code-related milestones, the auto-coder takes over:

1. **Milestone selection** — `pickMilestone()` finds the next pending milestone from the highest-priority active goal
2. **Brief generation** — `buildMilestoneBrief()` produces a concrete implementation prompt with file paths, patterns to follow, and integration requirements
3. **Implementation** — Sonnet/Opus writes the code via tool bridge (`file_read`, `file_write`, `shell_exec`)
4. **Verification** — `runTests()` runs the project's test suite to validate changes
5. **Commit** — `commitAndReport()` creates a git commit and sends a Telegram notification

The auto-coder is responsible for implementing all Shattered Crown game systems, managing the asset pipeline code, and any other code-heavy goal milestones.

---

## Asset Pipeline

Autonomous 3D asset generation for game projects. Reads a declarative manifest, generates assets in Blender via MCP, and exports to FBX.

### How It Works

```
asset-manifest.json ──> 54 assets across 9 regions
        │
        v
detectAssetGeneration() ──> signal fires every 30 min when pending assets exist
        │
        v
Agent brain calls <tool_call name="generate_asset">
        │
        v
generateOneAsset() ──> asset-pipeline.js
        │
        ├── 1. Clear Blender scene
        ├── 2. Generate geometry (region palette, poly budget, PBR materials)
        ├── 3. Export to FBX (UE5-compatible: -Y forward, Z up)
        └── 4. Update manifest status
```

### Manifest Structure

Each asset specifies region, type (hero/prop/environment/foliage), description, color palette, and poly budget. The pipeline generates procedural Blender Python code tailored to the asset type — trees, rocks, shrines, chests, gates, mushrooms, and more.

### Tools

| Tool | Description |
|------|-------------|
| `generate_asset` | Generate next pending asset from manifest (calls Blender MCP) |
| `asset_progress` | Get pipeline status: total, completed, pending, failed, percent |

---

## MCP Gateway

Multi-server Model Context Protocol gateway. Connects to any MCP-compatible server defined in `mcp-config.json`. Lazy connections (spawned on first use), per-server circuit breakers, automatic reconnection with exponential backoff.

### Connected Servers

| Server | Transport | Purpose |
|--------|-----------|---------|
| **Vestige** | stdio | Semantic memory — fact ingestion, search, dedup |
| **QMD** | stdio | GPU-accelerated codebase search (BM25 + vector + reranking) |
| **Blender** | stdio | 3D modeling — execute Python in Blender, render, export FBX |
| **Unreal** | stdio→TCP | UE5 Editor automation — actors, levels, blueprints (port 55557) |
| **VFX** | stdio | Video processing — trim, resize, concat, filters, chroma key |
| **Hattrick** | stdio | Football team management — browser automation for Hattrick.org |
| **Scrapling** | stdio | Web scraping with anti-detection |

```javascript
// Call any MCP server tool
import { callTool } from './lib/mcp-gateway.js';

await callTool('blender', 'execute_blender_code', { code: 'import bpy; ...' });
await callTool('vestige', 'search', { query: 'user preferences' });
await callTool('qmd', 'search', { query: 'auth middleware', limit: 10 });
```

---

## The Agent Loop

The main brain. Runs every 10 minutes (configurable), operates completely independently from WhatsApp message handling.

### Cycle Anatomy

1. **Signal collection** — All core detectors + module detectors run. Pure JS, no API calls.
2. **Cooldown filtering** — Each signal gets a unique key. Same key fired recently? Suppressed.
3. **Signal picking** — `pickSignals()` selects top 2 by urgency. Max 1 Sonnet-tier. Overdue signals get escalated.
4. **Prompt assembly** — Context block with module providers, recent actions, milestone briefs, learning context, reasoning journal, error analytics.
5. **Claude reasoning** — Haiku for routine, Sonnet/Opus for code and high-urgency signals.
6. **Response parsing** — Extracts structured XML tags. Each tag triggers specific actions.
7. **State writeback** — Updates timestamps, records actions, links decision outcomes.

### Model Selection

| Condition | Model | Why |
|-----------|-------|-----|
| High/critical urgency signal | Sonnet/Opus | Better reasoning for complex decisions |
| Goal work involves code keywords | Sonnet/Opus | Code generation quality |
| Signal type in module's `sonnetSignalTypes` | Sonnet | Module-declared complex work |
| Everything else | Haiku | 10x cheaper, fast enough for routine |

### Quiet Hours (23:00-08:00)

- No WhatsApp messages sent
- Agent loop interval extends to 60 minutes
- **Exception**: Module urgent work bypasses quiet hours
- **Exception**: Critical signals keep 10-minute interval

---

## Module System

Optional modules extend the agent without modifying core code. Dynamically discovered at startup from `modules/*/index.js`.

### Module Manifest

```javascript
// modules/my-module/index.js
export default {
  name: 'my-module',
  detectSignals: (state) => [{ type: 'my_signal', urgency: 'low', summary: '...' }],
  briefBuilders: { my_signal: (signal) => '## Brief\n...' },
  contextProviders: [() => '## Context\n...'],
  sonnetSignalTypes: ['my_complex_signal'],
  stateKey: 'my-module-state',
  stateKeyMap: { my_signal: 'lastMySignalAt' },
  hasUrgentWork: () => false,
  apiRoutes: [{ method: 'GET', path: '/my-module', handler: (req, res, ctx) => {} }],
  dashboard: { path: '/my-module', title: 'My Module', icon: '&#128736;', html: '<html>...</html>' },
};
```

All fields optional. Modules plug into 7 integration points: signal detection, brief injection, context injection, model selection, state writeback, quiet hours bypass, and message routing.

### Included Module: Hattrick

Autonomous football team management for [Hattrick.org](https://hattrick.org):

- 20+ signal detectors (match prep, post-match analysis, transfer watch, training, economy)
- Weekly planning with formation optimization
- Transfer market scouting and bidding (with financial safety limits)
- Training optimization based on player skills and age
- Full dashboard page with team overview

---

## Project System

Sela can onboard and manage entire software projects:

1. **Brief decomposition** — Describe a project in plain text. Haiku decomposes it into goals + milestones.
2. **Workspace creation** — Creates `workspace/<project>/` with QMD auto-indexing for code search.
3. **Autonomous implementation** — Auto-coder picks milestones and implements them.
4. **Progress tracking** — Goals + milestones tracked in SQLite with status, completion timestamps.

### Active Project: The Shattered Crown

A UE5 dark fantasy action-adventure game. 129 source files, 14 subsystems:

| System | Description |
|--------|-------------|
| GAS Combat | Melee + shard powers via Gameplay Ability System |
| Corruption | 5-tier corruption mechanic affecting player/world |
| Companion AI | Lira companion with follow/combat/combo behaviors |
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

### Telegram (Alerts + Commands)
- Real-time alerts: errors, agent actions, cost warnings, milestone completions
- Remote commands: `/status`, `/shutdown`, `/cron`, `/cost`, `/memory`, `/recap`, `/notes`, `/help`

### Web Dashboard
- Real-time WebSocket updates at `http://localhost:4242`
- System status, agent loop monitor, cost analytics
- Cron manager, project browser, memory browser
- Module pages (dynamically added)

---

## Core Modules

### Agent Core

| Module | What It Does |
|--------|-------------|
| `agent-loop.js` | Main brain. 10-min cycle: signals → prompt → Claude → parse → execute → learn. |
| `agent-brain.js` | Pattern recognition, trust-gated proposals, behavior adaptation. |
| `agent-signals.js` | 23+ zero-cost signal detectors including asset generation and transfer deadlines. |
| `agent-learning.js` | Reflection cycle — errors, costs, signal resolution, goal momentum. |
| `module-loader.js` | Dynamic module discovery and registry from `modules/*/index.js`. |
| `auto-coder.js` | Autonomous milestone implementation: pick → brief → code → test → commit. |
| `asset-pipeline.js` | 3D asset generation: manifest → Blender MCP → FBX export → manifest update. |
| `projects.js` | Project onboarding: brief → goals + milestones → workspace + QMD indexing. |

### Communication

| Module | What It Does |
|--------|-------------|
| `whatsapp.js` | Baileys socket — message routing, media, connection recovery. |
| `claude.js` | Claude CLI orchestration — `chatOneShot()` for single prompts. |
| `claude-persistent.js` | Two persistent Claude processes (WhatsApp + agent loop). Sub-second responses. |
| `telegram.js` | Two-way Telegram bot — alerts and remote commands. |
| `bot-ipc.js` | HTTP + WebSocket server for dashboard and agent-loop triggers. |

### Intelligence

| Module | What It Does |
|--------|-------------|
| `nlu-router.js` | 18-intent classifier (Hebrew + English). Zero LLM cost. |
| `prompt-assembler.js` | Three-tier dynamic prompt (minimal/standard/full). |
| `tool-bridge.js` | Tool registry with 5 built-in tools + skill companion auto-discovery. |
| `mcp-gateway.js` | Multi-server MCP gateway — 7 servers, lazy connect, circuit breakers. |
| `chain-planner.js` | Multi-step workflow decomposition — 5 templates + LLM fallback. |

### Autonomy

| Module | What It Does |
|--------|-------------|
| `trust-engine.js` | Per-action trust scores. Four levels: always-ask → auto-execute. |
| `workflow-engine.js` | Stateful DAG execution with pause/resume and user input gates. |
| `confidence-gate.js` | Gates actions through confidence thresholds. |
| `behavior-adaptor.js` | Maps context signals to behavior modifiers. |

### Memory & State

| Module | What It Does |
|--------|-------------|
| `goals.js` | Goal CRUD with milestones, priority sorting, deadline alerts. |
| `crons.js` | Cron job scheduler with quiet-hour suppression. |
| `memory-tiers.js` | T1/T2/T3 weighted memory with decay and spaced repetition. |
| `memory-guardian.js` | 5-tier heap monitoring with graduated response up to auto-restart. |
| `state.js` | Key-value state in SQLite. |

### Operations

| Module | What It Does |
|--------|-------------|
| `error-recovery.js` | Error classification + contextual retry. Circuit breaker (3 failures/5min). |
| `cost-analytics.js` | Per-call token cost tracking. Daily/weekly/monthly rollups. |
| `watchdog.js` | Separate PM2 process. Health pings + zombie detection. |

---

## Tool Bridge

The agent brain can invoke tools via XML tags in its response:

```xml
<tool_call name="generate_asset"></tool_call>
<tool_call name="file_read">{"path": "lib/config.js"}</tool_call>
<tool_call name="shell_exec">{"command": "node test/run-all.js"}</tool_call>
```

### Registered Tools

| Tool | Rate Limit | Description |
|------|-----------|-------------|
| `file_read` | none | Read a file from the sela directory |
| `file_write` | none | Write a file to the workspace directory (sandboxed) |
| `shell_exec` | 2s | Execute a shell command (sandboxed, 30s timeout, no destructive ops) |
| `generate_asset` | 60s | Generate next pending 3D asset via Blender MCP |
| `asset_progress` | 5s | Get asset pipeline status report |

Skill companions in `skills/*.js` register additional tools at startup.

---

## Prerequisites

- **Node.js** 20+ (ES modules)
- **Claude CLI** — authenticated via OAuth (`~/.claude/.credentials.json`)
- **PM2** (recommended) — process management and auto-restart
- **Vestige MCP** (optional) — persistent semantic memory
- **QMD** (optional) — local document search with BM25 + vector embeddings
- **Blender** (optional) — 3D asset generation via blender-mcp
- **Unreal Engine 5** (optional) — game project automation via unreal-engine-mcp

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
   AGENT_LOOP_SONNET_MODEL=opus
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
├── index.js                # Entry point — boots all subsystems
├── dashboard.js            # Web dashboard server (port 4242)
├── SOUL.md                 # Bot personality (auto-rewritten weekly)
├── ecosystem.config.cjs    # PM2 config (sela + watchdog + dashboard)
├── mcp-config.json         # MCP server registry (7 servers)
├── lib/                    # Core modules (70+)
│   ├── agent-loop.js       # Main agent brain
│   ├── agent-signals.js    # 23+ signal detectors
│   ├── auto-coder.js       # Autonomous code implementation
│   ├── asset-pipeline.js   # 3D asset generation via Blender MCP
│   ├── mcp-gateway.js      # Multi-server MCP gateway
│   ├── projects.js         # Project decomposition + workspace mgmt
│   ├── tool-bridge.js      # Tool registry (5 built-in + skill companions)
│   └── ...
├── modules/                # Optional modules (auto-discovered)
│   └── hattrick/           # Football team management module
├── skills/                 # Skill documents + JS companions
├── plugins/                # Dynamic plugins
├── test/                   # Test suite (49 tests, 27 suites)
├── scripts/                # Utility scripts
├── data/                   # Runtime data (gitignored)
│   ├── sela.db             # SQLite (goals, kv_state, costs, errors)
│   ├── goals.json          # Goal tracking (synced with SQLite)
│   └── state/              # Module + agent state
├── workspace/              # Project workspaces
│   ├── shattered-crown/    # UE5 game (129 source files, 54 assets)
│   ├── vfx-mcp/            # VFX MCP server
│   └── unreal-engine-mcp/  # Unreal MCP server
├── auth/                   # WhatsApp auth state (gitignored)
└── logs/                   # Pino log files (gitignored)
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

49 tests across 27 suites covering NLU routing, queue concurrency, cost analytics, history, formatting, intent matching, workflow execution, goal management, module loading, and more.

## License

ISC
