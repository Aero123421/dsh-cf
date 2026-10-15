import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dshPeerSatisfies } from '../src/updates.js';
import manifest from '../package.json' with { type: 'json' };

const peer = manifest.peerDependencies['@deepseek-ai/dsh'];
const installs = ['0.2.1-alpha.2', '0.2.1-alpha.3'];
const refused = ['*', 'x', '>=0', 'workspace:*', 'workspace:^', 'workspace:~', '>=0.2.1-alpha.2'];
const compared = [peer, '^0.2.1-alpha.2', '~0.2.1-alpha.2', '0.2.x', '0.2.1-alpha.2 - 0.3.0', '0.2.1-alpha.2', '~0.2.1', '', ' ', 'not a range'];

function fail(message) { throw new Error(message); }
function commandFailure(result, label) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`.trim().split('\n').filter(Boolean).slice(-12).join('\n');
  fail(`${label} failed${text ? `\n${text}` : ''}`);
}
function bootAccepts(evaluate, runtime, range) {
  try {
    const issue = evaluate({ name: manifest.name, version: manifest.version, peerDependencies: { '@deepseek-ai/dsh': range } }, {}, runtime);
    return issue === undefined;
  } catch { return false; }
}

const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-'));
try {
  for (const runtime of installs) {
    const root = join(directory, runtime);
    await mkdir(root, { recursive: true });
    const init = spawnSync('npm', ['init', '-y'], { cwd: root, encoding: 'utf8' });
    if (init.status !== 0) commandFailure(init, `npm init for app-boot ${runtime}`);
    // Separate trees: alpha.2 and alpha.3 pin different peers and cannot share one node_modules.
    const install = spawnSync('npm', ['install', '--silent', '--no-audit', '--no-fund', '--ignore-scripts', `boot@npm:@deepseek-ai/dsh-app-boot@${runtime}`], { cwd: root, encoding: 'utf8', timeout: 180_000 });
    if (install.status !== 0) commandFailure(install, `npm install of @deepseek-ai/dsh-app-boot@${runtime}`);
    const loaded = await import(pathToFileURL(join(root, 'node_modules/boot/lib/index.js')).href);
    const evaluate = loaded.evaluatePluginCompatibility;
    if (typeof evaluate !== 'function') fail(`@deepseek-ai/dsh-app-boot@${runtime} did not export evaluatePluginCompatibility`);
    if (!bootAccepts(evaluate, runtime, peer)) fail(`published app-boot ${runtime} rejected this plugin's peer ${peer}`);
    for (const older of ['0.2.1-alpha.1', '0.3.0-0', '0.3.0-alpha.1', '0.3.0']) {
      if (bootAccepts(evaluate, older, peer)) fail(`published app-boot ${runtime} accepted ${peer} for runtime ${older}`);
    }
    let acceptedByBoot = 0;
    for (const range of refused) {
      if (dshPeerSatisfies(runtime, range)) fail(`updater accepted unbounded or workspace range ${range} on ${runtime}`);
      if (bootAccepts(evaluate, runtime, range)) acceptedByBoot++;
    }
    if (acceptedByBoot === 0) fail(`published app-boot ${runtime} rejected every unbounded sample, so this script did not observe the real boot predicate`);
    for (const range of compared) {
      const expected = bootAccepts(evaluate, runtime, range);
      const actual = dshPeerSatisfies(runtime, range);
      if (actual !== expected) fail(`updater ${actual} disagreed with app-boot ${runtime} (${expected}) for bounded range ${JSON.stringify(range)}`);
    }
  }
  console.log(`peer ${peer} matches published evaluatePluginCompatibility on ${installs.join(' and ')}; the updater still refuses unbounded ranges and workspace specs`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
