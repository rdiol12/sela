import { kvGet, kvSet } from '../lib/db.js';

// Get current state
const raw = kvGet('hattrick-active-bids');
const state = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { items: [] };
console.log('Current state items:', JSON.stringify(state.items));

// Simon Bruchner is already resolved in lastResolvedBid - items is already empty.
// Add Dante Thomas to active bids
const deadlineMs = new Date('2026-03-07T19:14:00').getTime();
const newBid = {
  playerName: 'Dante Thomas',
  playerId: '503038650',
  position: 'Winger',
  skill: 'PM7/W7',
  age: 17,
  wage: 2460,
  bidAmount: 30000,
  currentHighestBid: 25000,
  deadlineMs,
  notes: 'Young winger age 17, PM=7 Winger=7, leading at 30K, deadline 19:14 today',
  placedAt: Date.now()
};

state.items = state.items || [];
// Remove any stale Dante Thomas entry if somehow exists
state.items = state.items.filter(b => b.playerId !== '503038650');
state.items.push(newBid);
state.updatedAt = Date.now();

kvSet('hattrick-active-bids', JSON.stringify(state));
console.log('Updated active bids:', JSON.stringify(state, null, 2));
console.log('SUCCESS: Dante Thomas registered as active bid at 30,000 NIS');
