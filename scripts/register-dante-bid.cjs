const { getState, setState } = require('../lib/db.js');

// Remove Simon Bruchner (lost bid on 06.03.2026)
const bids = getState('hattrick-active-bids') || [];
const filtered = bids.filter(b => String(b.playerId) !== '487826941');

// Add Dante Thomas
const deadline = new Date('2026-03-07T19:14:00');
const deadlineMs = deadline.getTime();

const newBid = {
  playerName: 'Dante Thomas',
  playerId: '503038650',
  position: 'Winger',
  skill: 'Playmaking=7, Winger=7',
  age: 17,
  wage: 2460,
  bidAmount: 30000,
  currentHighestBid: 25000,
  deadlineMs: deadlineMs,
  timestamp: Date.now()
};

filtered.push(newBid);
setState('hattrick-active-bids', filtered);

console.log('Active bids after update:', JSON.stringify(filtered, null, 2));
console.log('SUCCESS: Removed Simon Bruchner, Added Dante Thomas bid at 30,000 NIS');
