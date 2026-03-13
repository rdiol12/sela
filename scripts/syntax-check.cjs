/**
 * syntax-check.cjs — CommonJS syntax checker for lib/*.js files.
 * Called from auto-coder.js and buildMilestoneBrief.
 * Uses .cjs extension so it always runs as CommonJS regardless of package.json "type".
 */
const fs = require('fs');
const cp = require('child_process');
const p = require('path');

const root = process.env.PROJECT_ROOT || process.cwd();
const dir = p.join(root, 'lib');
let ok = true;

fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => {
  const r = cp.spawnSync(process.execPath, ['--check', p.join(dir, f)], { encoding: 'utf8' });
  if (r.status !== 0) {
    process.stderr.write(r.stderr || r.stdout || f + '\n');
    ok = false;
  }
});

if (ok) {
  console.log('SYNTAX_OK');
} else {
  process.exit(1);
}
