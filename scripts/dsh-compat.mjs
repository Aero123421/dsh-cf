import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dshPeerSatisfies } from '../src/updates.js';
import manifest from '../package.json' with { type: 'json' };

const range = manifest.peerDependencies['@deepseek-ai/dsh'];
const semverPackage = {
  version: '7.8.5',
  integrity: 'sha512-Y7/KDsb8LjooZpwaqGyulO6DQlksgCncchHGk+sZIY4SBvUocMBEFH5Ur1fI4dV+Jvl0w6cjvucaIi40puRioA==',
  tarball: 'https://registry.npmjs.org/semver/-/semver-7.8.5.tgz',
};
const versions = ['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.10', '0.2.1', '0.2.2-alpha.1', '0.2.2', '0.2.9-rc.1', '0.3.0-0', '0.3.0-alpha.1', '0.3.0', '1.0.0', '0.2.1-alpha.2+build.1'];
const ranges = [range, '0.2.1-alpha.2', '>=0.2.0-rc.2 <0.3.0-0', '>=0.2.1-alpha.2 <0.3.0', '0.2.1-alpha.2 || >=0.2.1-alpha.3 <0.3.0-0', '>=0.2.1-alpha.2'];

function fail(message) { throw new Error(message); }
async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) fail(`GET ${url} returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function fetchJson(url) {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
}
function checkIntegrity(bytes, integrity) {
  const match = /^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match) fail(`unsupported integrity ${integrity}`);
  const digest = createHash(`sha${match[1]}`).update(bytes).digest('base64');
  if (digest !== match[2]) fail('tarball integrity did not match the registry');
}
async function unpack(bytes, directory) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'package.tgz');
  await writeFile(file, bytes);
  const extracted = spawnSync('tar', ['-xzf', file, '-C', directory], { stdio: 'inherit' });
  if (extracted.status !== 0) fail('tar could not extract the downloaded package');
}

const directory = await mkdtemp(join(tmpdir(), 'dsh-compat-'));
try {
  const [dsh, appBoot] = await Promise.all([
    fetchJson('https://registry.npmjs.org/@deepseek-ai%2fdsh'),
    fetchJson('https://registry.npmjs.org/@deepseek-ai%2fdsh-app-boot'),
  ]);
  const hosts = [
    ['@deepseek-ai/dsh', dsh['dist-tags']?.alpha],
    ['@deepseek-ai/dsh-app-boot', appBoot['dist-tags']?.alpha],
  ];
  for (const [name, version] of hosts) {
    if (typeof version !== 'string') fail(`${name} has no alpha dist-tag`);
    if (!dshPeerSatisfies(version, range)) fail(`${name}@${version} (dist-tag alpha) is outside peer range ${range}. DSH will skip this plugin at boot.`);
  }
  const bootVersion = hosts[1][1];
  const published = appBoot.versions?.[bootVersion];
  if (!published?.dist?.tarball || !published.dist.integrity) fail(`@deepseek-ai/dsh-app-boot@${bootVersion} has no tarball`);
  const bootBytes = await fetchBytes(published.dist.tarball);
  checkIntegrity(bootBytes, published.dist.integrity);
  await unpack(bootBytes, directory);
  const source = await readFile(join(directory, 'package/lib/index.js'), 'utf8');
  if (!/semver\.satisfies\(\s*runtimeVersion\s*,\s*requirement\s*,\s*\{\s*includePrerelease:\s*true\s*\}\s*\)/.test(source)
    || !/name\s*!==\s*['"]@deepseek-ai\/dsh['"]\s*&&\s*!name\.startsWith\(\s*['"]@deepseek-ai\/dsh-['"]\s*\)/.test(source)
    || !/requirement\.trim\(\)\s*===\s*['"]['"]/.test(source)) {
    fail(`@deepseek-ai/dsh-app-boot@${bootVersion} no longer evaluates dsh peers with semver.satisfies(runtime, range, { includePrerelease: true }). Re-read plugin-compatibility before keeping ${range}.`);
  }
  const semverBytes = await fetchBytes(semverPackage.tarball);
  checkIntegrity(semverBytes, semverPackage.integrity);
  const semverDir = join(directory, 'semver');
  await unpack(semverBytes, semverDir);
  const semver = createRequire(import.meta.url)(join(semverDir, 'package/index.js'));
  const hostSatisfies = (version, peer) => typeof peer === 'string' && peer.trim() !== '' && semver.satisfies(version, peer, { includePrerelease: true });
  for (const peer of ranges) for (const version of versions) {
    const expected = hostSatisfies(version, peer);
    const actual = dshPeerSatisfies(version, peer);
    if (actual !== expected) fail(`peer predicate drifted from semver@${semverPackage.version} includePrerelease for ${version} against ${peer}: updater ${actual}, semver ${expected}`);
  }
  console.log(`peer ${range} satisfies @deepseek-ai/dsh@${hosts[0][1]} and @deepseek-ai/dsh-app-boot@${bootVersion}; published compatibility check still uses includePrerelease`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
