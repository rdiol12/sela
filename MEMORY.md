# Bot Memory

Self-updating notes about the user's preferences, patterns, and learnings.
This file is injected into the system prompt. Update it when you discover
something worth remembering across conversations.

## User Preferences
- Prefers short, direct answers on WhatsApp
- Writes in both Hebrew and English (match his language)
- Timezone: Asia/Jerusalem (GMT+2)
- Quiet hours: 23:00–08:00 (don't send non-urgent messages)

## Communication Patterns
- "סבבה" / "אחלה" = acknowledgment, no response needed
- Frustration → skip pleasantries, go straight to fixing
- Technical questions → be precise, include file paths and line numbers

## Common Tasks
- Bot maintenance (crons, skills, plugins)
- Code fixes and feature development
- Checking system status and logs
- Hattrick team management (transfers, lineups, training)
- Project bug scanning (ProjGmar, SalaryApp)

## Active Projects (as of 2026-03-03)
- **Shattered Crown — UE5 Level Construction** (COMPLETED 100%): All 10/10 milestones done. 8 region levels built, 64 gameplay BPs defined (48 region-placed, 16 global systems), 48 world placements, 30 event dispatcher connections, 4-phase integration pipeline with resume capability. Tools: integrate_blueprints, integration_status, export_integration_spec.
- **Shattered Crown — Core Game Systems** (COMPLETED 100%): Player, Combat, NPCs, Quests — all 11/11 milestones done. 129 source files, 14 subsystems.
- **SalaryApp** (COMPLETED 100%): React Native/Expo shift management. 117 tests, CSV export, EAS build verified.
- **ProjGmar/SmartCart** (ABANDONED): React+Vite frontend, Express+PostgreSQL backend. Was functional but user removed goals.

## Hattrick Team State (as of 2026-03-08)
- Squad: 22 players. GK: Zlatko Finka (GK 8, age 23) — starting. Biberman backup.
- Key signings: Suttipong Thairung (CD 7, 17yo), Rafa Ribeiro Pidal (Def 8, 17yo), Daniele Gusmai (Scoring 8, 21yo).
- R13 result (Mar 7): Blodangels 1-2 Elitsur Sharon (LOSS, HOME). Central attack 2.75 (very poor). Formation 4-4-2.
- R14 vs Hapoel Tzafon (HOME, Mar 14 10:30) — LINEUP SET: 4-4-2 with Finka/Thairung/Ribeiro Pidal/Kagan defense.
- Transfer: Kłyszejko auction LOST to agawa at 610,000 NIS (our bid 566,100). Deadline passed 09:22 HT.
- **Training RED FLAG (Mar 8)**: Scoring focus at 90% intensity for **11 days** (Feb 25→Mar 8):
  - Mallet (RW): Scoring 2→2 **UNCHANGED**
  - Kassab (FK): Scoring 2 (not 3 as previously reported) **UNCHANGED** — Mar 7 agent-cycle snapshot had hallucinated values
  - Finding: **ZERO progress** over 11 days suggests training malfunction or skill cap
  - **RESOLUTION (Mar 8 13:15)**: Training focus switched from Scoring → **Defence (הגנה)** at 90% intensity to strengthen backline after R13 defensive weakness (central attack rating 2.75). Will monitor for progress over next week.

## MapleStory Map Building — CRITICAL
- The 3 Sage Hall maps (101050000-101050002) are BROKEN — they have NO visuals (no back/tile/obj layers). They render as black voids. Must be rebuilt with proper assets.
- NEVER create a map XML with just footholds+portals+life. A real map NEEDS: back (backgrounds), tile (ground textures), obj (decorations).
- Use skill "maplestory-map-building" for the complete guide. Use harepacker-mcp to browse v83 assets (107 backgrounds, 102 tilesets, 107 object sets).
- Always browse assets with harepacker-mcp FIRST to pick a visual theme before writing any map XML.

## Known Issues & Fixes
- WhatsApp 405 = session invalidated (phone logged out). Fix: `pm2 restart sela` then scan QR at `./qr.png`. Distinct from 408 = network timeout (self-recovers).
- WhatsApp 405 loop: FIXED (Cycle 272). waChannelSetSend moved to 'open' handler, totalAuthClearCount cap (max 3), 15s send timeout guard. Goal c2a155ea at 80%.
- Followup urgency inheritance: fixed Cycle 235 — signalKey() now uses goalId (not matchedGoal) for per-goal cooldowns.
- Hattrick post-match review signal loop: FIXED (Cycle 278). loadState() in agent-loop.js now reads from 'hattrick-cycle' kv_state to populate lastHattrickPostMatchReviewAt and lastHattrickTransferCheckAt. Previously those were never read despite being saved by hattrick-cycle.js.
- Timeout log inflation: a single Claude API timeout triggers ~20 resilience retry log entries. Actual unique timeout events are 3-4/day, not the apparent count in raw grep.
- Memory Guardian false positives: FIXED. getHeapStats() used heapUsed/heapTotal (V8 dynamic alloc ~55MB) → always 85-98%. Fixed to use RSS/PM2_limit (512MB). Real usage is ~14%. All 90%+ alerts were false positives.

## Lessons Learned
- Test files use plain Node.js (no Jest/Vitest) — run with: node test/run-all.js. All 27 suites pass.
- Proactive triggers (goal_progress, anomaly, idle_time) are in agent-loop.js lines 151-242, integrated at collectSignals().
- Skills autoDetect is wired in claude.js (registryAutoDetect at line 155) — Skills M3 was already done.
- Voice transcription: lib/transcribe.js wraps OpenAI Whisper via fetch+FormData. Requires OPENAI_API_KEY. Falls back gracefully if missing.
- Cycle cost control: Sonnet only for high/critical signals or code-keyword goal milestones. Haiku for all else.
- Hard Sonnet daily cap: IMPLEMENTED (Cycle 313). `dailySonnetCost` tracked in agent-loop.js state. Cap = $5/day (env: AGENT_LOOP_SONNET_DAILY_CAP). Alerts via Telegram, resets at midnight IL.
- **HARD DAILY COST CAP (Mar 9 2026)**: `runAgentCycle()` and `runProjectCycle()` now check `getTodayCost()` vs `DAILY_COST_LIMIT` env ($50 default) BEFORE running. Blocks ALL cycles when exceeded. Added after Mar 8 $109.60 spike (228 entries, 131 in 3-hour peak window). Previous system only alerted via Telegram but never blocked.
- Circuit breaker: ALREADY EXISTS in error-recovery.js (lines 27-67). 3 failures in 5min window → circuit opens for 10min. No code needed.
- Cost control goal (6d35a8d3): COMPLETED 100% in Cycle 313.
- Timeout log inflation: ~20 log lines per real timeout due to resilience.js retry loop — known, minor. Circuit breaker addresses runaway retries.
- Transfer watchlist stale signals: The signal system may report N targets even when the actual kv_state watchlist items=[] is empty. Always verify with kvGet('hattrick-transfer-watchlist') before acting.
- Telegram markdown errors are self-healing: messages retry without parse_mode automatically. No code fix needed.
- Memory pressure 90%+ was ALWAYS a false positive (see fix above). After the fix, real RSS is ~14% of PM2 limit. Memory Guardian now uses RSS/PM2_limit metric.
- "Invalid status transition" errors in goals.js are validation working correctly, not bugs. Happens when user modifies goals externally.
- Blueprint integration pipeline state persistence: data/state/blueprint-pipeline-state.json saves after each phase so long-running pipeline can resume if interrupted. clearPipelineState() on completion.
- AGENT_LOOP_SONNET_MODEL=opus in .env — all code cycles use Opus. Daily cost ~$100+ when active.
- TheWilds BPs (StandingStone, WildlifeAmbient, HunterRynn, DruidessFayn) are the only 4 completed BPs across all regions — other 60 still pending build in UE5.
