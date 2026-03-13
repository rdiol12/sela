import { listGoals } from './lib/goals.js';

const all = listGoals({});
const active = all.filter(g => g.status === 'active' || g.status === 'in_progress');

console.log('=== All goals with project field ===');
for (const g of active) {
  const pendingMs = (g.milestones || []).filter(m => m.status === 'pending').length;
  const totalMs = (g.milestones || []).length;
  console.log(`  ${g.id} | project="${g.project || '<NONE>'}" | ${g.status} | ms:${pendingMs}/${totalMs} pending | ${g.title}`);
}

console.log('\n=== Goals matching project="maplestory" ===');
const maple = active.filter(g => g.project === 'maplestory');
if (maple.length === 0) {
  console.log('  NONE FOUND!');
  console.log('\n  Goals with "maple" or "cosmic" in title:');
  const fuzzy = active.filter(g => {
    const t = (g.title || '').toLowerCase();
    return t.includes('maple') || t.includes('cosmic');
  });
  for (const g of fuzzy) {
    console.log(`    ${g.id} | project="${g.project || '<NONE>'}" | ${g.title}`);
  }
} else {
  for (const g of maple) {
    const pendingMs = (g.milestones || []).filter(m => m.status === 'pending').length;
    console.log(`  ${g.id} | ${g.title} | milestones pending: ${pendingMs}`);
  }
}
