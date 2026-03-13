const { getState, setState } = require('../lib/db.js');
const bids = getState('hattrick-active-bids') || [];
console.log('Current active bids:', JSON.stringify(bids));
const filtered = bids.filter(b => String(b.playerId) !== '487826941');
setState('hattrick-active-bids', filtered);
console.log('After cleanup:', JSON.stringify(filtered));
console.log('Removed Simon Bruchner (lost bid - sold to Niet het beste team on 06.03.2026)');
