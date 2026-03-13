/**
 * modules/unreal/signals.js — UE5 project signal detector.
 *
 * Zero-cost detectors:
 *  1. unreal_asset_import — FBX/audio files waiting to be imported into UE5
 *  2. unreal_compile_check — Recent C++ source changes need compilation
 *  3. unreal_level_build — Regions ready for level construction via MCP
 *  4. unreal_blueprint_build — Blueprints pending construction
 *
 * Cooldown: 60 minutes (UE5 operations are heavy).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';
import { getActiveGame } from './game-config.js';

const log = createLogger('unreal-signals');

const UE5_SIGNAL_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes
let _lastUe5SignalAt = 0;

export function detectUnrealSignals(state) {
  const signals = [];
  try {
    const nowMs = Date.now();
    if (nowMs - _lastUe5SignalAt < UE5_SIGNAL_COOLDOWN_MS) return signals;

    const game = getActiveGame();
    const SOURCE_DIR = join(game.basePath, 'Source');
    const REGION_MANIFEST_PATH = game.regionManifestPath;
    const ASSET_MANIFEST_PATH = game.assetManifestPath;
    const meshesDir = game.meshesPath;
    const audioDir = game.audioPath;

    // ── Count source files & recent changes ───────────────────────────────

    let sourceFiles = 0;
    let recentChanges = 0;
    const oneDayAgo = nowMs - 24 * 3600_000;

    if (existsSync(SOURCE_DIR)) {
      try {
        const walkDir = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walkDir(full);
            else if (entry.name.endsWith('.cpp') || entry.name.endsWith('.h')) {
              sourceFiles++;
              try {
                if (statSync(full).mtimeMs > oneDayAgo) recentChanges++;
              } catch {}
            }
          }
        };
        walkDir(SOURCE_DIR);
      } catch {}
    }

    // ── Check pending FBX imports ─────────────────────────────────────────

    let pendingImports = 0;
    if (existsSync(meshesDir)) {
      try {
        const countFbx = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) countFbx(join(dir, entry.name));
            else if (entry.name.endsWith('.fbx')) pendingImports++;
          }
        };
        countFbx(meshesDir);
      } catch {}
    }

    // ── Check pending audio imports ───────────────────────────────────────

    let pendingAudioImports = 0;
    if (existsSync(audioDir)) {
      try {
        const countAudio = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) countAudio(join(dir, entry.name));
            else if (/\.(wav|mp3|ogg)$/.test(entry.name)) pendingAudioImports++;
          }
        };
        countAudio(audioDir);
      } catch {}
    }

    // ── Check region level build progress ─────────────────────────────────

    let levelPending = 0, levelCompleted = 0, levelTotal = 0;
    let assetsReadyCount = 0;
    let nextRegion = null;

    if (existsSync(REGION_MANIFEST_PATH)) {
      try {
        const regionManifest = JSON.parse(readFileSync(REGION_MANIFEST_PATH, 'utf-8'));

        // Read asset manifest once for checking readiness
        let assetManifest = null;
        if (existsSync(ASSET_MANIFEST_PATH)) {
          try { assetManifest = JSON.parse(readFileSync(ASSET_MANIFEST_PATH, 'utf-8')); } catch {}
        }

        for (const [id, region] of Object.entries(regionManifest.regions || {})) {
          levelTotal++;
          if (region.status === 'completed') levelCompleted++;
          else {
            levelPending++;
            if (!nextRegion) nextRegion = { id, theme: region.theme, levelName: region.levelName };
          }

          // Check if assets for this region are ready
          if (assetManifest) {
            const assetRegion = assetManifest.regions?.[id];
            if (assetRegion) {
              const allDone = (assetRegion.assets || []).every(a => a.status === 'completed');
              if (allDone) assetsReadyCount++;
            }
          }
        }
      } catch {}
    }

    // ── Check Blueprint progress ──────────────────────────────────────────

    let bpTotal = 0, bpCompleted = 0, bpPending = 0;
    if (existsSync(REGION_MANIFEST_PATH)) {
      try {
        const regionManifest = JSON.parse(readFileSync(REGION_MANIFEST_PATH, 'utf-8'));
        for (const region of Object.values(regionManifest.regions || {})) {
          for (const bp of region.blueprints || []) {
            bpTotal++;
            if (bp.status === 'completed') bpCompleted++;
            else if (bp.status !== 'failed') bpPending++;
          }
        }
      } catch {}
    }

    // ── Emit signals ──────────────────────────────────────────────────────

    let emitted = false;

    // Asset import signal
    if (pendingImports > 0 || pendingAudioImports > 0) {
      signals.push({
        type: 'unreal_asset_import',
        urgency: 'low',
        summary: `UE5: ${pendingImports} meshes and ${pendingAudioImports} audio files ready for import`,
        data: { sourceFiles, recentChanges, pendingImports, pendingAudioImports },
      });
      emitted = true;
    }

    // Compile check signal
    if (recentChanges > 5) {
      signals.push({
        type: 'unreal_compile_check',
        urgency: 'low',
        summary: `UE5: ${recentChanges} source files changed recently — may need compilation check`,
        data: { sourceFiles, recentChanges },
      });
      emitted = true;
    }

    // Level build signal — only fire when there are pending regions
    if (levelPending > 0) {
      signals.push({
        type: 'unreal_level_build',
        urgency: levelPending >= levelTotal ? 'medium' : 'low',
        summary: `UE5 level build: ${levelCompleted}/${levelTotal} regions done — next: ${nextRegion?.id || 'none'}`,
        data: {
          total: levelTotal,
          completed: levelCompleted,
          pending: levelPending,
          assetsReady: assetsReadyCount,
          nextRegion,
        },
      });
      emitted = true;
    }

    // Blueprint build signal — only fire when there are pending BPs
    if (bpPending > 0) {
      signals.push({
        type: 'unreal_blueprint_build',
        urgency: 'low',
        summary: `UE5 Blueprints: ${bpCompleted}/${bpTotal} built — ${bpPending} pending`,
        data: {
          total: bpTotal,
          completed: bpCompleted,
          pending: bpPending,
        },
      });
      emitted = true;
    }

    if (emitted) _lastUe5SignalAt = nowMs;
  } catch (err) {
    log.warn({ err: err.message }, 'detectUnrealSignals: failed');
  }
  return signals;
}
