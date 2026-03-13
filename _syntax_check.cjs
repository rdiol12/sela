const fs = require('fs');
const cp = require('child_process');
const path = require('path');

let ok = true;
const dir = path.join(process.cwd(), 'lib');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
for (const f of files) {
  const r = cp.spawnSync('node', ['--check', path.join(dir, f)], { encoding: 'utf8' });
  if (r.status > 0) {
    console.log('FAIL:', f);
    console.log(r.stderr);
    ok = false;
  }
}
if (ok) console.log('SYNTAX_OK');
else process.exit(1);
