/**
 * modules/asset-pipeline/signals.js — 3D asset pipeline signal detector.
 *
 * Zero-cost detector: reads asset-manifest.json, counts pending assets.
 * Fires when pending 3D assets exist. Cooldown: 30 minutes.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('asset-signals');

const ASSET_SIGNAL_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes — production grind mode
let _lastAssetSignalAt = 0;

export function detectAssetSignals(state) {
  const signals = [];
  try {
    const nowMs = Date.now();
    if (nowMs - _lastAssetSignalAt < ASSET_SIGNAL_COOLDOWN_MS) return signals;

    const manifestPath = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'asset-manifest.json');
    if (!existsSync(manifestPath)) return signals;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    let total = 0, pending = 0, completed = 0, failed = 0, procedural = 0;
    let nextAsset = null;
    let nextRegion = null;

    for (const [regionId, region] of Object.entries(manifest.regions || {})) {
      for (const asset of region.assets || []) {
        total++;
        if (asset.status === 'completed' || asset.status === 'done') {
          completed++;
          if (!asset.generationMethod || asset.generationMethod === 'procedural') procedural++;
        } else if (asset.status === 'failed') {
          failed++;
          // Failed assets also count as needing work
          pending++;
          if (!nextAsset) { nextAsset = asset; nextRegion = regionId; }
        } else if (asset.status === 'pending') {
          pending++;
          if (!nextAsset) { nextAsset = asset; nextRegion = regionId; }
        }
      }
    }

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (pending > 0) {
      const urgency = 'high'; // production grind — always escalate to Sonnet
      signals.push({
        type: 'asset_generation',
        urgency,
        summary: `3D asset pipeline: ${completed}/${total} done (${pct}%) — next: "${nextAsset.name}" in ${nextRegion}`,
        data: {
          total, completed, pending, failed, procedural,
          nextAssetId: nextAsset.id,
          nextAssetName: nextAsset.name,
          nextRegion,
          pct,
        },
      });
      _lastAssetSignalAt = nowMs;
    } else if (procedural > 0) {
      // All assets generated but some are still low-quality procedural
      signals.push({
        type: 'asset_regeneration',
        urgency: 'low',
        summary: `Asset quality upgrade: ${procedural}/${completed} assets are procedural — AI regeneration available`,
        data: { total, completed, pending, failed, procedural, pct },
      });
      _lastAssetSignalAt = nowMs;
    }
  } catch (err) {
    log.warn({ err: err.message }, 'detectAssetSignals: failed');
  }
  return signals;
}
