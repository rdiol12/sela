import { kvGet, kvSet } from '../lib/db.js';

const raw = kvGet('hattrick-active-bids');
const state = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { items: [] };

console.log('Current state:', JSON.stringify(state, null, 2));

const danteIdx = state.items.findIndex(b => b.playerId === '503038650');

if (danteIdx !== -1) {
  const dante = state.items[danteIdx];
  state.lastResolvedBid = {
    playerName: dante.playerName,
    playerId: dante.playerId,
    outcome: 'lost',
    ourFinalBid: dante.bidAmount,
    finalPrice: 45000,
    winner: 'Tortoises United',
    resolvedAt: Date.now(),
    notes: 'PM=7/W=7 age 17 — lost to Tortoises United despite 45K bid'
  };
  state.items.splice(danteIdx, 1);
  state.updatedAt = Date.now();
  kvSet('hattrick-active-bids', JSON.stringify(state));
  console.log('✅ Dante Thomas marked as LOST. items cleared.');
} else {
  console.log('Dante Thomas not found in items — may already be resolved.');
}

const verify = kvGet('hattrick-active-bids');
const parsed = typeof verify === 'string' ? JSON.parse(verify) : verify;
console.log('Final state items:', parsed.items?.length, '| lastResolved:', parsed.lastResolvedBid?.playerName, parsed.lastResolvedBid?.outcome);
