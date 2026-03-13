/**
 * modules/audio-pipeline/signals.js — Audio pipeline signal detector.
 *
 * Zero-cost detector: reads audio-manifest.json, counts pending assets.
 * Fires when pending audio assets exist. Cooldown: 15 minutes.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('audio-signals');

const AUDIO_SIGNAL_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes — production grind mode
let _lastAudioSignalAt = 0;

export function detectAudioSignals(state) {
  const signals = [];
  try {
    const nowMs = Date.now();
    if (nowMs - _lastAudioSignalAt < AUDIO_SIGNAL_COOLDOWN_MS) return signals;

    const manifestPath = join(process.cwd(), 'workspace', 'shattered-crown', 'Assets', 'audio-manifest.json');
    if (!existsSync(manifestPath)) return signals;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    let total = 0, pending = 0, completed = 0, failed = 0;
    let nextAsset = null;
    let nextCategory = null;

    for (const [catId, cat] of Object.entries(manifest.categories || {})) {
      for (const asset of cat.assets || []) {
        total++;
        if (asset.status === 'completed') completed++;
        else if (asset.status === 'failed') failed++;
        else if (asset.status === 'pending') {
          pending++;
          if (!nextAsset) { nextAsset = asset; nextCategory = catId; }
        }
      }
    }

    if (pending === 0) return signals;

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const urgency = 'high'; // production grind — always escalate to Sonnet

    signals.push({
      type: 'audio_generation',
      urgency,
      summary: `Audio pipeline: ${completed}/${total} done (${pct}%) — next: "${nextAsset.name}" [${nextAsset.method}] in ${nextCategory}`,
      data: {
        total, completed, pending, failed,
        nextAssetId: nextAsset.id,
        nextAssetName: nextAsset.name,
        nextMethod: nextAsset.method,
        nextCategory,
        pct,
      },
    });

    _lastAudioSignalAt = nowMs;
  } catch (err) {
    log.warn({ err: err.message }, 'detectAudioSignals: failed');
  }
  return signals;
}
