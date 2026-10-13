import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const run = args => { const r = spawnSync(process.execPath, args, { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };
for (const dir of ['src', 'test', 'scripts']) for (const name of await readdir(dir)) if (/\.m?js$/.test(name)) run(['--check', `${dir}/${name}`]);
run(['--test', ...((await readdir('test')).filter(x => x.endsWith('.test.js')).map(x => `test/${x}`))]);
