import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import semver from 'semver';
import { CfError, demand, boundedJson } from './common.js';
import manifest from '../package.json' with { type: 'json' };

export const VERSION = manifest.version;
export const REPOSITORY = 'Aero123421/dsh-cf';
export const RELEASES = `https://github.com/${REPOSITORY}/releases`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = ['installing', 'unknown', 'applied', 'restart-required', 'overridden', 'failed', 'cancelled', 'confirmed'];
export function semanticVersion(value) {
  const match = typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  demand(match && !match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')), 'UPDATE_METADATA', 'リリース情報の版を確認できません。');
  return { numbers: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') };
}
export function compareVersions(left, right) {
  const a = semanticVersion(left), b = semanticVersion(right);
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1;
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i]; if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
/** Oldest and newest DSH this plugin will treat as the current series. */
const DSH_SERIES_FLOOR = '0.2.1-alpha.2';
const DSH_NEXT_SERIES = '0.3.0-0';

function boundedComparator(item, direction) {
  const exact = (item.operator === '' || item.operator === '=') && typeof item.semver?.version === 'string';
  if (exact) return true;
  if (direction === 'upper') return item.operator === '<' || item.operator === '<=';
  return item.operator === '>' || item.operator === '>=';
}

/** A peer range stays in the current 0.2 series when every alternative has a
 * lower and an upper comparator, nothing older than 0.2.1-alpha.2 matches,
 * and nothing from 0.3.0-0 upward matches. `<99`, `^0`, and `<0.3.0` have a
 * written cap and still reach the next series or the versions before this floor.
 */
function peerRangeInCurrentSeries(range) {
  let parsed;
  try { parsed = new semver.Range(range, { includePrerelease: true }); }
  catch { return false; }
  if (!parsed.set?.length) return false;
  const shaped = parsed.set.every(comparators =>
    comparators.some(item => boundedComparator(item, 'lower')) &&
    comparators.some(item => boundedComparator(item, 'upper')));
  if (!shaped) return false;
  const options = { includePrerelease: true };
  try {
    if (semver.intersects(range, `<${DSH_SERIES_FLOOR}`, options)) return false;
    if (semver.intersects(range, `>=${DSH_NEXT_SERIES}`, options)) return false;
  } catch { return false; }
  return true;
}

/** Whether one DSH peer range accepts the running host.
 * `semver.satisfies` includes prereleases. `workspace:` follows whatever is
 * linked. A range is also rejected when its cap is only formal (`<99`, `^0`)
 * or when it has no lower bound inside the current series.
 */
export function dshPeerSatisfies(version, range) {
  if (typeof version !== 'string' || semver.valid(version) === null || typeof range !== 'string') return false;
  const text = range.trim();
  if (text === '' || text.startsWith('workspace:') || !peerRangeInCurrentSeries(text)) return false;
  try { return semver.satisfies(version, text, { includePrerelease: true }); }
  catch { return false; }
}
function object(value) { demand(value && typeof value === 'object' && !Array.isArray(value), 'UPDATE_METADATA', 'リリース情報を確認できません。'); return value; }
function channelOf(channel) { demand(['stable', 'prerelease'].includes(channel), 'UPDATE_CHANNEL', '更新channelを選択してください。'); return channel; }
export function supportsSource(source) {
  return typeof source === 'string' && (/^github:Aero123421\/dsh-cf(?:#[A-Za-z0-9._/-]+)?$/.test(source) || /^(?:git\+)?https:\/\/github\.com\/Aero123421\/dsh-cf(?:\.git)?(?:#[A-Za-z0-9._/-]+)?$/.test(source));
}
export function releaseSpecs(tag) {
  return [`github:${REPOSITORY}#${tag}`, `git+https://github.com/${REPOSITORY}.git#${tag}`];
}
function alreadyInstalled(result) {
  return result?.application === 'failed' && result?.error?.code === 'already-installed';
}
export function runtimeVersion(profile) {
  try {
    if (!profile?.installAnchor) return null;
    const require = createRequire(profile.installAnchor);
    const value = require('@deepseek-ai/dsh-app-boot/package.json').version;
    semanticVersion(value); return value;
  } catch { return null; }
}
async function json(url, fetcher, signal, limit) {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers: { accept: 'application/vnd.github+json' } });
  demand(response.ok, 'UPDATE_FETCH', 'リリースの取得に失敗しました。通信状態と手動更新先を確認してください。');
  return boundedJson(response, limit);
}
export async function checkedCandidate(channel, runtime, fetcher = fetch, signal = new AbortController().signal, installedVersion) {
  channelOf(channel);
  const releases = await json(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`, fetcher, signal, 512 * 1024);
  demand(Array.isArray(releases), 'UPDATE_METADATA', 'リリース一覧を確認できません。');
  const selected = [], ids = new Set(), tags = new Set();
  for (const raw of releases) {
    const item = object(raw);
    demand(Number.isSafeInteger(item.id) && item.id > 0 && typeof item.draft === 'boolean' && typeof item.prerelease === 'boolean' && typeof item.tag_name === 'string' && item.tag_name.startsWith('v'), 'UPDATE_METADATA', 'リリース情報を確認できません。');
    if (item.draft) continue;
    const version = item.tag_name.slice(1), pre = !!semanticVersion(version).pre;
    demand(pre === item.prerelease && item.html_url === `${RELEASES}/tag/${item.tag_name}` && (typeof item.body === 'string' || item.body === null) && !ids.has(item.id) && !tags.has(item.tag_name), 'UPDATE_METADATA', 'リリース情報を確認できません。');
    ids.add(item.id); tags.add(item.tag_name);
    if ((channel === 'prerelease') === pre) selected.push({ id: `${item.id}:${item.tag_name}`, version, tag: item.tag_name, notes: (item.body || '').slice(0, 4000), url: item.html_url });
  }
  if (!selected.length) return { candidate: null, status: releases.length ? 'channel-empty' : 'no-release' };
  selected.sort((a, b) => compareVersions(b.version, a.version));
  const candidate = selected[0];
  if (installedVersion && compareVersions(candidate.version, installedVersion) <= 0) return { candidate: null, status: 'current' };
  const pkg = object(await json(`https://raw.githubusercontent.com/${REPOSITORY}/${candidate.tag}/package.json`, fetcher, signal, 64 * 1024));
  demand(pkg.name === 'dsh-cf' && pkg.version === candidate.version && object(object(pkg.dsh).bundle).patch === './cordis.patch.yml' && pkg.exports?.['.'] === './src/index.js' && pkg.exports?.['./client'] === './src/client.js', 'UPDATE_METADATA', '対象プラグインと版を確認できません。');
  const peers = object(pkg.peerDependencies), ranges = Object.entries(peers).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));
  demand(runtime && ranges.length && typeof peers['@deepseek-ai/dsh'] === 'string', 'UPDATE_COMPATIBILITY', '対応DSHの版を確認できません。手動更新先を確認してください。');
  // The whole range must sit inside >=0.2.1-alpha.2 <0.3.0-0. DSH boot still accepts wider ranges.
  for (const [, range] of ranges) demand(typeof range === 'string' && dshPeerSatisfies(runtime, range), 'UPDATE_COMPATIBILITY', 'このリリースは使用中のDSHに対応していません。');
  return { candidate: { ...candidate, runtime }, status: 'available' };
}
function safeResult(result) {
  return { application: result.application, bundle: result.bundle, version: result.version, stage: result.stage, ...(result.error ? { error: { code: result.error.code } } : {}), ...(result.packageResult ? { packageResult: { exitCode: result.packageResult.exitCode, timedOut: result.packageResult.timedOut } } : {}) };
}
export class Updates {
  constructor({ manager, profileDir, runtime, busy = () => false, fetcher = fetch, version = VERSION }) {
    Object.assign(this, { manager, profileDir, runtime, busy, fetcher, version });
    this.profileKey = typeof profileDir === 'string' ? createHash('sha256').update(`dsh-cf-updates:${profileDir}`).digest('hex') : null;
    this.channel = semanticVersion(version).pre ? 'prerelease' : 'stable';
    this.view = { status: 'idle', running: version, dshVersion: runtime, channel: this.channel, releases: RELEASES, profileKey: this.profileKey };
    this.operation = null; this.candidate = null; this.checkView = false; this.pending = null; this.pendingId = null; this.activeId = null; this.closed = false; this.abort = new AbortController();
  }
  dispose() { this.closed = true; this.abort.abort(); }
  get directory() { return this.profileDir && join(this.profileDir, '.dsh-cf-updates'); }
  fail(error, status = 'failed') { this.view = { ...this.view, status, reason: error instanceof CfError ? error.code : 'UPDATE_FAILURE' }; return this.view; }
  async bundle() {
    const manager = this.manager();
    demand(manager && this.profileDir && typeof manager.listBundles === 'function' && typeof manager.installBundle === 'function' && typeof manager.waitForInstall === 'function', 'UPDATE_MANAGER', 'この環境では画面から更新できません。手動更新先を確認してください。');
    const bundle = (await manager.listBundles()).find(item => item.name === 'dsh-cf');
    demand(bundle?.installed === true && typeof bundle.enabled === 'boolean' && !bundle.readOnlyReason && !bundle.error, 'UPDATE_READ_ONLY', 'この環境では更新を書き込めません。DSHのプラグイン設定を確認してください。');
    demand(supportsSource(bundle.source), 'UPDATE_SOURCE', 'この導入経路は元の配布元から手動更新してください。');
    semanticVersion(bundle.version);
    return { manager, bundle };
  }
  async save(admit = false, operation = this.operation) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory); demand(directory.isDirectory() && !directory.isSymbolicLink(), 'UPDATE_STORAGE', '更新記録を保存できません。');
    const write = async (name, value) => {
      const temporary = join(this.directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await rename(temporary, join(this.directory, name));
    };
    await write(`${operation.id}.json`, operation);
    // Only admission moves the pointer. A disposed old Host may still settle its
    // own receipt, but cannot replace the newer Host's active operation.
    if (admit) await write('latest.json', { id: operation.id });
  }
  async read(expectedId) {
    if (this.activeId || !this.profileDir) return true;
    try {
      const id = expectedId ?? object(JSON.parse(await readFile(join(this.directory, 'latest.json'), 'utf8'))).id;
      demand(typeof id === 'string' && UUID.test(id), 'UPDATE_STORAGE', '更新記録を確認できません。');
      const item = object(JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')));
      demand(item.id === id && typeof item.version === 'string' && ['stable', 'prerelease'].includes(item.channel) && PHASES.includes(item.phase), 'UPDATE_STORAGE', '更新記録を確認できません。');
      semanticVersion(item.version);
      if (item.result) demand(['applied', 'restart-required', 'overridden', 'failed', 'cancelled'].includes(item.result.application) && ['install', 'enable', 'remove'].includes(item.result.stage), 'UPDATE_STORAGE', '更新結果を確認できません。');
      this.operation = { id: item.id, version: item.version, channel: item.channel, phase: item.phase, ...(item.result ? { result: safeResult(item.result) } : {}) };
      return true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
  }
  result(result, bundle, operation = this.operation) {
    let status = result.application;
    if (['applied', 'restart-required'].includes(status) && (result.error || result.packageResult?.exitCode !== undefined && (result.packageResult.exitCode !== 0 || result.packageResult.timedOut))) status = 'failed';
    else if (['applied', 'restart-required'].includes(status)) {
      status = result.bundle === 'dsh-cf' && result.version === operation.version && bundle?.installed === true && !bundle.error && !bundle.readOnlyReason && bundle.version === operation.version ? this.version === operation.version ? 'confirmed' : 'restart-required' : 'unknown';
    }
    if (!PHASES.includes(status)) status = 'unknown';
    operation.phase = status;
    const view = { status, running: this.version, dshVersion: this.runtime, channel: operation.channel, operation: operation.id, installed: bundle?.version, releases: RELEASES, profileKey: this.profileKey, ...(result.error ? { reason: result.error.code } : {}), stage: result.stage };
    if (this.operation?.id === operation.id && (!this.activeId || this.activeId === operation.id)) this.view = view;
    return view;
  }
  async status(expectedId) {
    try {
      if (expectedId !== undefined) demand(typeof expectedId === 'string' && UUID.test(expectedId), 'UPDATE_REQUEST', '操作IDを確認できません。');
      const { manager, bundle } = await this.bundle(); const found = await this.read(expectedId);
      this.view = { ...this.view, installed: bundle.version };
      if (expectedId && (!found || this.operation?.id !== expectedId)) return { ...this.view, status: 'unknown', operation: expectedId };
      if (!this.operation) return this.view;
      if (!expectedId && this.checkView && this.operation.result && !['unknown', 'installing'].includes(this.operation.phase)) return this.view;
      if (this.activeId === this.operation.id) return { ...this.view, status: 'installing', operation: this.operation.id };
      const operation = this.operation;
      const result = operation.result ?? await manager.waitForInstall(operation.id);
      if (!result) { operation.phase = 'unknown'; const view = { ...this.view, status: 'unknown', operation: operation.id }; if (this.operation?.id === operation.id && !this.activeId) this.view = view; return view; }
      operation.result = safeResult(result); await this.save(false, operation);
      const installed = (await manager.listBundles()).find(item => item.name === 'dsh-cf');
      const view = this.result(result, installed, operation); await this.save(false, operation); return view;
    } catch (error) { return this.fail(error, 'unavailable'); }
  }
  check(channel) {
    if (this.pending) return Promise.reject(new CfError('UPDATE_BUSY', '別の更新操作が進行中です。'));
    channelOf(channel); this.channel = channel;
    this.pending = (async () => {
      try {
        const { bundle } = await this.bundle(); await this.read();
        demand(!this.closed, 'UPDATE_STOPPED', 'プラグインが停止中です。');
        if (this.operation && (!this.operation.result || ['unknown', 'installing'].includes(this.operation.phase))) return this.status();
        this.candidate = null;
        const selected = await checkedCandidate(channel, this.runtime, this.fetcher, this.abort.signal, bundle.version);
        this.candidate = selected.candidate; this.checkView = true;
        this.view = { status: selected.candidate ? compareVersions(selected.candidate.version, bundle.version) > 0 ? 'available' : 'current' : selected.status === 'current' && compareVersions(bundle.version, this.version) > 0 ? 'restart-required' : selected.status, running: this.version, dshVersion: this.runtime, installed: bundle.version, channel, candidate: selected.candidate, releases: RELEASES, profileKey: this.profileKey, checkedAt: new Date().toISOString() };
        return this.view;
      } catch (error) { this.checkView = true; return this.fail(error, error.code === 'UPDATE_COMPATIBILITY' ? 'incompatible' : 'failed'); }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  install(candidateId, operationId, channel, expectedProfileKey) {
    if (!this.profileKey || expectedProfileKey !== this.profileKey) return Promise.reject(new CfError('UPDATE_PROFILE', '接続先が変わりました。更新を再確認してください。'));
    if (this.pending) return this.pendingId === operationId && typeof operationId === 'string' ? this.pending : Promise.reject(new CfError('UPDATE_BUSY', '別の更新操作が進行中です。'));
    this.pendingId = operationId;
    this.pending = (async () => {
      let admitted = false, started = false;
      try {
        demand(typeof operationId === 'string' && UUID.test(operationId), 'UPDATE_REQUEST', '操作IDを確認できません。'); channelOf(channel);
        await this.read();
        if (this.operation?.id === operationId) return this.status(operationId);
        demand(!this.operation || (this.operation.result && !['unknown', 'installing'].includes(this.operation.phase)), 'UPDATE_UNKNOWN', '前の更新結果が不明です。導入を繰り返さず結果を確認してください。');
        demand(!this.closed && !this.busy(), 'UPDATE_BUSY', '別の処理が進行中です。');
        const { bundle, manager } = await this.bundle();
        const selected = await checkedCandidate(channel, this.runtime, this.fetcher, this.abort.signal, bundle.version), candidate = selected.candidate;
        demand(this.candidate && candidate && candidate.id === candidateId && candidate.id === this.candidate.id && channel === this.view.channel && compareVersions(candidate.version, bundle.version) > 0, 'UPDATE_CANDIDATE', '候補または導入版が変わりました。更新を再確認してください。');
        this.checkView = false; this.operation = { id: operationId, version: candidate.version, channel, phase: 'installing' }; admitted = true; this.activeId = operationId; this.view = { ...this.view, status: 'installing', operation: operationId }; await this.save(true);
        const latest = await this.bundle();
        demand(latest.manager === manager && latest.bundle.source === bundle.source && compareVersions(candidate.version, latest.bundle.version) > 0, 'UPDATE_CANDIDATE', '導入情報が変わりました。更新を再確認してください。');
        // No await between this lifetime/workflow guard and manager invocation.
        demand(!this.closed && !this.busy(), 'UPDATE_BUSY', '別の処理が進行中です。');
        started = true;
        const specs = releaseSpecs(candidate.tag);
        let enabled = latest.bundle.enabled, result;
        for (let index = 0; index < specs.length; index++) {
          result = await manager.installBundle(specs[index], { enabled, requestId: operationId });
          if (!alreadyInstalled(result) || this.closed) break;
          // DSH 0.2.1-alpha.3 with HMR returns already-installed before pnpm when the spec
          // matches the saved dependency, and changes no profile file. A different git URL of
          // the same tag does not match that string, so installBundle still runs pnpm.
          // Do not removeBundle here. The official Update runs in the plugin-manager UI, which
          // stays loaded; removeBundle with HMR reloads and stops this plugin before that call
          // returns, so the following install would not run.
          let current;
          try { current = await this.bundle(); }
          catch (error) {
            result = { application: 'failed', stage: 'install', error: { code: error instanceof CfError ? error.code : 'UPDATE_ALREADY_INSTALLED' } };
            break;
          }
          const order = compareVersions(current.bundle.version, candidate.version);
          if (order === 0) { result = { application: 'restart-required', stage: 'install', bundle: 'dsh-cf', version: current.bundle.version }; break; }
          if (order > 0) { result = { application: 'failed', stage: 'install', error: { code: 'UPDATE_CANDIDATE' } }; break; }
          if (index === specs.length - 1) { result = { application: 'failed', stage: 'install', error: { code: 'UPDATE_ALREADY_INSTALLED' } }; break; }
          if (this.closed) break;
          if (this.busy()) { result = { application: 'failed', stage: 'install', error: { code: 'UPDATE_BUSY' } }; break; }
          enabled = current.bundle.enabled;
        }
        this.operation.result = safeResult(result); await this.save(); const after = (await manager.listBundles()).find(item => item.name === 'dsh-cf');
        const view = this.result(result, after); await this.save(); return view;
      } catch (error) {
        if (admitted && this.operation?.id === operationId && !this.operation.result && !started) { this.operation.result = { application: 'failed', stage: 'install', error: { code: error instanceof CfError ? error.code : 'UPDATE_FAILURE' } }; this.operation.phase = 'failed'; await this.save().catch(() => {}); }
        const unresolved = this.operation && (!this.operation.result || ['unknown', 'installing'].includes(this.operation.phase));
        const view = this.fail(error, unresolved ? 'unknown' : 'failed');
        if (admitted || unresolved) this.view = { ...view, operation: this.operation.id };
        else { const { operation: _operation, ...rest } = view; this.view = rest; }
        return this.view;
      }
    })().finally(() => { this.pending = null; this.pendingId = null; this.activeId = null; });
    return this.pending;
  }
}
