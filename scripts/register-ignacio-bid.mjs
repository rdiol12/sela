import { kvGet, kvSet } from '../lib/db.js';

const raw = kvGet('hattrick-active-bids');
const state = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { items: [] };

// Deadline: 07.03.2026 23:43 server (UTC+1) = 22:43 UTC
const deadlineMs = new Date('2026-03-07T22:43:00Z').getTime();

const newBid = {
  playerName: 'Ignacio Quemada Herreros',
  playerId: '497300928',
  position: 'Forward/Winger',
  skill: 'PM7/Stam9/Quick',
  age: 19,
  wage: 2150,
  bidAmount: 30000,
  currentHighestBid: 25000,
  deadlineMs,
  notes: 'Age 19, PM=7, Stamina=9, Scoring=6, Quick specialty. Plays קיצוני (winger) in matches. Low-risk bid, great value.',
  placedAt: Date.now(),
  updatedAt: Date.now()
};

// Remove any existing entry for this player (safety)
state.items = state.items.filter(b => b.playerId !== '497300928');
state.items.push(newBid);
state.updatedAt = Date.now();

kvSet('hattrick-active-bids', JSON.stringify(state));
console.log('✅ Ignacio Quemada tracked. Active bids:', state.items.length);
console.log('Deadline:', new Date(deadlineMs).toISOString(), '= 00:43 Israel (Mar 8)');
