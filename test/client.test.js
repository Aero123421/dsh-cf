import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const SOURCE = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const stubReact = { createElement: () => {}, useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), Fragment: Symbol('fragment') };
async function load(react = stubReact, extra = {}) {
  let plugin;
  vm.runInNewContext(SOURCE, {
    window: { __ModuleLoader__: { load: item => { plugin = item.factory(() => react); } }, location: { hostname: '127.0.0.1' }, ...extra.window },
    crypto: { randomUUID }, Set, Map, Intl, Date, Promise, Object, Array, String, Number, JSON, Math, Error,
    ...extra.globals,
  });
  return plugin;
}
const ready = { stopping: false, hostReview: false, pendingWrite: false, authorized: true, accountId: 'a'.repeat(32), accountReady: true, mfa: 'independent', mfaMissing: [], zoneId: 'b'.repeat(32), zoneName: 'example.com', idpId: 'provider-1', hostname: 'dsh.example.com', ownerEmail: 'owner@example.com', pending: false, busy: false };

test('every language has the same keys, and no key is left without a use', async () => {
  const plugin = await load();
  const keys = Object.keys(plugin.COPY.en).sort();
  assert.deepEqual(Object.keys(plugin.COPY.ja).sort(), keys);
  assert.deepEqual(Object.keys(plugin.COPY.zh).sort(), keys);
  assert.equal(plugin.COPY.en.title, 'Cloudflare');
  assert.equal(plugin.translate('zh', 'missing-key'), 'missing-key');
  assert.equal(plugin.translate('en', 'retryIn', { time: 'in 5 seconds' }), 'Next attempt in 5 seconds.');
  // Keys built at run time: each family is checked against the values that build it.
  const families = {
    st_: ['online', 'starting', 'reconnecting', 'stopping', 'paused', 'offline', 'error', 'unconfigured', 'removing'],
    sd_: ['online', 'starting', 'reconnecting', 'stopping', 'paused', 'offline', 'error', 'removing'],
    step_: plugin.STEP_IDS, ev_: plugin.EVIDENCE, ss_: ['idle', 'working', 'waiting', 'done', 'error'],
    cn_: ['connected', 'starting', 'disconnected', 'error', 'stopped'], dl_: ['metadata', 'downloading', 'verified'],
    pi_: ['found', 'not-found', 'ambiguous'], pm_: ['clear-recorded', 'delete-unrecorded', 'clear-not-found'], pmd_: ['clear-recorded', 'delete-unrecorded', 'clear-not-found'],
    i_: [...new Set(Object.values(plugin.GUIDE)), 'cfDenied', 'cfMissing', 'cfRate', 'cfServer', 'cfOther', 'generic'],
  };
  const dynamic = new Set();
  for (const [prefix, values] of Object.entries(families)) for (const value of values) { dynamic.add(prefix + value); assert(keys.includes(prefix + value), `missing ${prefix}${value}`); }
  for (const key of keys) {
    if (dynamic.has(key)) continue;
    const uses = SOURCE.split(`'${key}'`).length - 1;
    assert(uses >= 2 || /^b_|^v_/.test(key) && uses >= 1, `unused copy key ${key}`);
  }
  for (const key of keys.filter(key => /^(?:st_|sd_|step_|ev_|ss_|cn_|dl_|pi_|pm_|pmd_|i_)/.test(key))) assert(dynamic.has(key), `dynamic key ${key} has no producer`);
});

test('the update panel, OAuth and the wide dialog are gone and no browser storage is used', () => {
  for (const word of ['UpdateController', 'UpdatePanel', 'oauth', 'OAuth', 'localStorage', 'sessionStorage', 'indexedDB', 'showModal', 'addLanguage({', 'openWide']) assert(!SOURCE.includes(word), word);
});

test('feature CSS uses theme tokens only: no literal colors and no theme selectors', () => {
  const css = SOURCE.slice(SOURCE.indexOf('const CSS = `'), SOURCE.indexOf('`;', SOURCE.indexOf('const CSS = `')));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /\b(?:rgb|rgba|hsl|hsla)\(/);
  assert.doesNotMatch(css, /data-theme|prefers-color-scheme|\.dark|\.light/);
  assert.match(css, /prefers-reduced-motion/);
});

test('every code the host can report has localized guidance in every language', async () => {
  const plugin = await load();
  const codes = new Set();
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    if (name === 'client.js') continue;
    const text = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) codes.add(match[1]);
  }
  // Public-gate rejections never reach the settings page; the rest are environment names, HTTP verbs and signals.
  const notForSettings = /^(?:AUTH|AUTH_OWNER|AUTH_UNAVAILABLE|HOST|ORIGIN|PATH|BODY|UPGRADE|CNAME|DELETE|GET|HEAD|POST|PUT|DSH_|EADDRINUSE|EEXIST|ENOENT|EPERM|ESRCH|ERR_.*|HOME|LOCALAPPDATA|PROGRAMDATA|SYSTEMROOT|TEMP|TMP|TMPDIR|USERPROFILE|WINDIR|RS256|SIGINT|SIGKILL|SIGTERM)$/;
  const missing = [...codes].filter(code => !notForSettings.test(code) && !plugin.guideKey(code));
  assert.deepEqual(missing, []);
  for (const code of [...codes, 'CF_401', 'CF_403', 'CF_404', 'CF_429', 'CF_500', 'CF_502', 'AbortError', 'TimeoutError']) {
    const key = plugin.guideKey(code);
    if (!key) continue;
    for (const lang of ['en', 'ja', 'zh']) assert.equal(typeof plugin.COPY[lang]['i_' + key], 'string', `${code} ${lang}`);
  }
  assert.equal(plugin.guideKey('SOMETHING_NEW'), null);
  assert.equal(plugin.guideKey('__proto__'), null);
});

test('messages are localized, hide raw codes and never trust an unsafe code or an oversized host sentence', async () => {
  const plugin = await load();
  for (const lang of ['en', 'ja', 'zh']) {
    const t = (key, params) => plugin.translate(lang, key, params);
    const denied = plugin.describeError(t, { code: 'CF_403', hostMessage: 'SECRET raw body' });
    assert.equal(denied.text, t('i_cfDenied')); assert.equal(denied.code, 'CF_403'); assert(!denied.text.includes('CF_403') && !denied.text.includes('SECRET'));
    assert.equal(plugin.describeError(t, { code: 'SECRET/token', hostMessage: 'x' }).code, '');
    assert.equal(plugin.describeError(t, { code: 'SECRET/token' }).text, t('i_generic'));
    assert.equal(plugin.describeError(t, { code: 'DOWNLOAD_APPROVAL' }).text, t('i_download'));
    assert.equal(plugin.describeError(t, { code: 'NEW_CODE', hostMessage: 'Host sentence.' }).text, 'Host sentence.');
    assert.equal(plugin.describeError(t, { code: 'NEW_CODE', hostMessage: 'x'.repeat(401) }).text, t('i_generic'));
    assert.equal(plugin.describeError(t, new Error('network')).text, t('i_generic'));
    assert.equal(plugin.issueText(t, { code: 'WRITE_UNKNOWN', message: 'raw' }), t('i_writeUnknown'));
  }
  assert.equal(plugin.issueTone({ code: 'TUNNEL_DISCONNECTED' }, 'reconnecting'), 'info');
  assert.equal(plugin.issueTone({ code: 'DSH_UPSTREAM' }, 'online'), 'warn');
  assert.equal(plugin.issueTone({ code: 'UNPROTECTED' }, 'error'), 'error');
});

test('the issue action offers only what this page can do', async () => {
  const { issueAction } = await load();
  assert.equal(issueAction({ action: 'authorize' }, false), 'token');
  assert.equal(issueAction({ action: 'authorize' }, true), null);
  assert.equal(issueAction({ action: 'start' }, false), 'token');
  assert.equal(issueAction({ action: 'start' }, true), 'again');
  assert.equal(issueAction({ action: 'select-binary' }, false), 'again');
  assert.equal(issueAction({ action: 'confirm-host' }, false), 'host');
  assert.equal(issueAction({ action: 'resolve-write' }, false), 'pending');
  assert.equal(issueAction({ action: 'resume' }, false), 'resume');
  for (const action of ['close-other-dsh', 'inspect-state', undefined]) assert.equal(issueAction({ action }, true), null);
});

test('a disabled connect button has one reason for each blocking condition', async () => {
  const { connectBlockers } = await load();
  assert.equal(connectBlockers(ready), null);
  const cases = [
    [{ stopping: true }, 'stopping'], [{ hostReview: true }, 'host'], [{ pendingWrite: true }, 'unknown-write'], [{ authorized: false }, 'authorize'],
    [{ accountReady: false }, 'account'], [{ mfa: 'substitute', requireWebAuthn: true }, 'mfa-substitute'], [{ mfa: 'unknown', requireWebAuthn: true }, 'mfa-unknown'],
    [{ mfaMissing: ['biometrics'], requireWebAuthn: true }, 'mfa-missing'], [{ zoneId: '' }, 'zone'], [{ idpId: '' }, 'idp'],
    [{ hostname: 'http://dsh.example.com' }, 'hostname'], [{ hostname: 'localhost' }, 'hostname'], [{ hostname: 'a.b.example.com' }, 'hostname'],
    [{ hostname: 'example.com' }, 'hostname'], [{ hostname: 'dsh.example.net' }, 'hostname'], [{ ownerEmail: 'not-an-email' }, 'email'],
    [{ needApproval: true }, 'download'], [{ pending: true }, 'busy'], [{ busy: true }, 'busy'],
  ];
  for (const [patch, reason] of cases) assert.equal(connectBlockers({ ...ready, ...patch }), reason, reason);
  assert.equal(connectBlockers({ ...ready, needApproval: true, allowDownload: true }), null);
  assert.equal(connectBlockers({ ...ready, needApproval: true, cloudflaredPath: '/usr/bin/cloudflared' }), null);
  for (const mfa of ['unknown', 'substitute', 'independent']) assert.equal(connectBlockers({ ...ready, requireWebAuthn: false, mfa, mfaMissing: ['biometrics'] }), null);
  for (const [patch, reason] of [[{ authorized: false }, 'authorize'], [{ ownerEmail: '' }, 'email'], [{ busy: true }, 'busy']]) assert.equal(connectBlockers({ ...ready, requireWebAuthn: false, ...patch }), reason);
});

test('hostname validation names the rule that fails', async () => {
  const { hostnameIssue, emailOk } = await load();
  assert.equal(hostnameIssue('dsh.example.com', 'example.com'), '');
  assert.equal(hostnameIssue('DSH.example.com', 'example.com'), '');
  assert.equal(hostnameIssue('a.b.example.com', 'example.com'), 'depth');
  assert.equal(hostnameIssue('example.com', 'example.com'), 'apex');
  assert.equal(hostnameIssue('dsh.example.net', 'example.com'), 'zone');
  assert.equal(hostnameIssue('https://dsh.example.com', 'example.com'), 'format');
  assert.equal(hostnameIssue('dsh.example.com:443', 'example.com'), 'format');
  assert.equal(hostnameIssue('dsh.example.com', ''), '');
  assert.equal(emailOk('owner@example.com'), true);
  assert.equal(emailOk('a@b'), false); assert.equal(emailOk('a@b.c, d@e.f'), false);
});

test('only the recovery action that matches the inspection is offered', async () => {
  const { pendingModes } = await load();
  const modes = report => JSON.stringify(pendingModes(report));
  assert.equal(modes({ matches: [] }), '["clear-not-found"]');
  assert.equal(modes({ matches: [{ id: 'a', recorded: true }] }), '["clear-recorded"]');
  assert.equal(modes({ matches: [{ id: 'a', recorded: false }] }), '["delete-unrecorded"]');
  assert.equal(modes({ matches: [{ id: 'a', recorded: true }, { id: 'b', recorded: false }] }), '["delete-unrecorded"]');
  assert.equal(modes(null), '[]');
  assert.equal(modes({}), '[]');
});

test('the view and the primary action follow the host status', async () => {
  const { viewOf, statusOf, primaryAction } = await load();
  assert.equal(viewOf(null), 'loading');
  assert.equal(viewOf({ canManage: false, status: 'online', setup: null }), 'remote');
  assert.equal(viewOf({ canManage: true, status: 'error', setup: null }), 'unavailable');
  assert.equal(viewOf({ canManage: true, status: 'unconfigured', setup: null }), 'setup');
  assert.equal(viewOf({ canManage: true, status: 'error', setup: {} }), 'configured');
  assert.equal(statusOf({ status: 'online', operation: { kind: 'remove' } }), 'removing');
  assert.equal(statusOf({ status: 'weird' }), 'offline');
  const actions = { online: 'pause', reconnecting: 'pause', starting: 'pause', paused: 'resume', offline: 'resume', error: 'resume', stopping: null, removing: null, unconfigured: null };
  for (const [status, action] of Object.entries(actions)) assert.equal(primaryAction(status), action, status);
});

test('relative times use the language of the page', async () => {
  const { relative } = await load();
  assert.equal(relative(5000, 'en'), 'in 5 seconds');
  assert.equal(relative(-120000, 'en'), '2 minutes ago');
  assert.match(relative(3600000, 'ja'), /1\s*時間後/);
});

test('snapshots cross Host restarts but reject late replies from retired Hosts', async () => {
  const { SnapshotCursor } = await load(), cursor = new SnapshotCursor();
  assert.equal(cursor.accept({ generation: 'old', sequence: 90 }), 'accepted');
  assert.equal(cursor.accept({ generation: 'old', sequence: 89 }), null);
  assert.equal(cursor.accept({ generation: 'malformed', sequence: null }), null);
  assert.equal(cursor.accept({ generation: 'old', sequence: 91 }), 'accepted');
  assert.equal(cursor.accept({ generation: 'new', sequence: 0 }), 'replaced');
  assert.equal(cursor.accept({ generation: 'old', sequence: 100 }), null);
  assert.equal(cursor.accept({ generation: 'new', sequence: 1 }), 'accepted');
  assert.equal(cursor.accept({ sequence: 100 }), null);
});

test('cancel is sent while the first mutation is pending and its late result is dropped', async () => {
  const { PanelSession } = await load();
  const calls = [];
  let release;
  const session = new PanelSession(async name => {
    calls.push(name);
    if (name === 'authorize') await new Promise(resolve => { release = resolve; });
    return { sequence: calls.length, status: name === 'cancel' || name === 'status' ? 'offline' : 'starting' };
  });
  const seen = [];
  session.onStatus = status => seen.push(status);
  const pending = session.mutate('authorize', { token: 'secret-value' });
  const stopping = session.control('cancel');
  assert.equal(session.stopping, true);
  const ignored = session.mutate('account', {});
  const second = session.control('pause');
  release();
  assert.equal(JSON.stringify(await ignored), JSON.stringify({ ignored: true }));
  assert.equal(JSON.stringify(await second), JSON.stringify({ coalesced: true }));
  assert.equal(JSON.stringify(await pending), JSON.stringify({ dropped: true }));
  await stopping;
  assert.deepEqual(calls, ['authorize', 'cancel', 'status']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'offline');
  assert.equal(JSON.stringify(seen).includes('secret-value'), false);
  assert.equal(session.stopping, false);
  assert.equal(session.busy, false);
});

test('late mutation errors cannot repaint a new Host generation', async () => {
  const { PanelSession } = await load(); let reject;
  const session = new PanelSession(() => new Promise((_resolve, fail) => { reject = fail; }));
  const pending = session.mutate('start', {});
  ++session.epoch; session.busy = false;
  reject(new Error('old Host failure'));
  assert.equal((await pending).dropped, true);
});

test('locale registration keeps the base dictionaries, adds Japanese without defining a language, and tolerates duplicates', async () => {
  const plugin = await load();
  const registrations = [];
  const locale = { register: (...args) => registrations.push(args), addLanguage: () => assert.fail('the plugin must not define a language'), bind: () => () => 'Cloudflare' };
  let meta;
  const ctx = {
    get: name => (name === 'locale' ? locale : { rpc: { async call() { return { ok: false }; } } }),
    effect(fn) { return fn(); },
    slots: { inject(_name, run) { run(); }, register(value) { meta = value; } },
  };
  plugin.apply(ctx);
  assert.equal(registrations[0][0], 'dsh-cf');
  assert.equal(registrations[0][1].en.title, plugin.COPY.en.title);
  assert.equal(registrations[0][1].zh.title, plugin.COPY.zh.title);
  assert.equal(registrations[1][1], 'ja');
  assert.equal(registrations[1][2], plugin.COPY.ja);
  assert.equal(meta.locale, 'dsh-cf');
  assert.equal(meta.label(), 'Cloudflare');
  locale.register = () => { throw new Error('locale namespace "dsh-cf" already has locale "en"'); };
  assert.doesNotThrow(() => plugin.apply(ctx));
});

test('locale teardown removes owned registrations and reload uses the new dictionary', async () => {
  const plugin = await load(), effects = [], dictionaries = new Map();
  const locale = {
    register(ns, lang, dict) {
      const pairs = typeof lang === 'string' ? [[lang, dict]] : Object.entries(lang);
      for (const [id] of pairs) assert(!dictionaries.has(id));
      for (const [id, value] of pairs) dictionaries.set(id, value);
      return () => { for (const [id] of pairs) dictionaries.delete(id); };
    },
    bind: () => () => 'Cloudflare',
  };
  const ctx = { get: name => name === 'locale' ? locale : { rpc: {} }, effect(fn) { const off = fn(); effects.push(off); }, slots: { inject(_n, fn) { return fn(); }, register() {} } };
  plugin.apply(ctx); assert.equal(dictionaries.size, 3);
  for (const off of effects.splice(0).reverse()) off?.();
  assert.equal(dictionaries.size, 0);
  const fresh = await load(); fresh.COPY.en.title = 'new dictionary'; fresh.apply(ctx);
  assert.equal(dictionaries.get('en').title, 'new dictionary');
});

// ---- Rendering with a minimal React: components are pure, so every hook lives in Panel ----
async function mount(snapshot, { calls = [], onCall } = {}) {
  const hooks = [], pendingEffects = [];
  let index = 0, rendering = false, scheduled = false, view = null, Component = null, props = null;
  function schedule() {
    if (rendering) { scheduled = true; return; }
    rendering = true;
    try {
      let rounds = 0;
      do {
        if (++rounds > 40) throw new Error('render loop');
        scheduled = false; index = 0; pendingEffects.length = 0;
        view = Component(props);
        for (const effect of pendingEffects.splice(0)) effect();
      } while (scheduled);
    } finally { rendering = false; }
  }
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, raw, ...children) {
      const flat = children.flat(Infinity).filter(child => child != null && child !== false);
      if (type === React.Fragment) return flat;
      const kids = flat.length ? flat : [raw?.children].flat(Infinity).filter(child => child != null && child !== false);
      if (typeof type === 'function') return type({ ...(raw || {}), children: kids });
      return { type, props: raw || {}, children: kids };
    },
    useState(initial) {
      const slot = index++;
      if (hooks.length <= slot) hooks.push(typeof initial === 'function' ? initial() : initial);
      return [hooks[slot], value => { const next = typeof value === 'function' ? value(hooks[slot]) : value; if (Object.is(next, hooks[slot])) return; hooks[slot] = next; schedule(); }];
    },
    useEffect(effect, deps) {
      const slot = index++, previous = hooks[slot];
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((dep, position) => !Object.is(dep, previous.deps[position]));
      hooks[slot] = { deps };
      if (changed) pendingEffects.push(effect);
    },
    useRef(initial) { const slot = index++; if (hooks.length <= slot) hooks.push({ current: initial }); return hooks[slot]; },
  };
  const plugin = await load(React, { globals: { document: { hidden: true }, navigator: { clipboard: { async writeText() {} } }, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {} } });
  plugin.resetDraft();
  plugin.apply({
    get(name) {
      if (name === 'locale') return { register() {}, bind: () => () => 'Cloudflare' };
      return { rpc: { async call(_path, method, payload) {
        calls.push([method, payload]);
        if (method === 'status') return { ok: true, value: snapshot };
        return onCall ? onCall(method, payload) : { ok: true, value: {} };
      } } };
    },
    effect() {},
    slots: { inject(_name, run) { run(); }, register(_meta, component) { Component = component; } },
  });
  props = { t: (key, values) => plugin.translate('en', key, values) };
  schedule();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const nodes = [];
  const walk = node => {
    if (node == null || node === false || node === true) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'string' || typeof node === 'number') { nodes.push(String(node)); return; }
    nodes.push(node); node.children?.forEach(walk);
  };
  const collect = () => { nodes.length = 0; walk(view); return nodes; };
  collect();
  const text = () => collect().filter(node => typeof node === 'string').join('\n');
  const find = (type, match) => collect().filter(node => typeof node === 'object' && node.type === type && match(node));
  const button = label => find('button', node => node.children.join('').trim() === label)[0];
  return { plugin, text, find, button, collect, flush: async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); } };
}
const CONFIGURED = (patch = {}) => ({
  generation: 'g1', sequence: 1, version: '0.1.0', canManage: true, status: 'online', issue: null, busy: false, operation: null,
  progress: ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh'].map(id => ({ id, status: 'done', message: '' })),
  setup: { accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), hostname: 'dsh.example.com', ownerEmail: 'owner@example.com', idpId: 'provider-1', requireWebAuthn: false, teamDomain: 'team.cloudflareaccess.com' },
  resources: {}, autoConnect: false, paused: false, verified: false, lastVerifiedAt: null, lastConfigurationCheck: null, hostReview: null, pendingWrite: null,
  authorization: { active: false, until: null }, accounts: [], account: null, publicUrl: 'https://dsh.example.com/', enrollmentUrl: null,
  connector: { status: 'connected', binary: null, download: null }, evidence: {}, gatePort: 0, trustedHostLeft: null, ...patch,
});

test('a public viewer gets a read-only status card: no inputs, no management buttons, no sign-in prompts', async () => {
  const snapshot = { generation: 'g', sequence: 1, version: '0.1.0', canManage: false, status: 'online', issue: null, publicUrl: 'https://dsh.example.com/', verified: true, lastVerifiedAt: '2026-10-19T00:00:00.000Z', autoConnect: true, paused: false };
  const ui = await mount(snapshot);
  const text = ui.text();
  assert.match(text, /Online/); assert.match(text, /https:\/\/dsh\.example\.com\//); assert.match(text, /only shows the status/);
  assert.equal(ui.find('input', () => true).length + ui.find('select', () => true).length, 0);
  assert.deepEqual(ui.find('button', () => true).map(node => node.children.join('').trim()), ['Copy']);
  assert.doesNotMatch(text, /Resume|Pause|Delete the public|Open the URL and sign in/);
});

test('an online connection offers Pause and Open, and never the resume or sign-in prompts of a stopped one', async () => {
  const ui = await mount(CONFIGURED());
  assert(ui.button('Pause')); assert(ui.button('Open')); assert(!ui.button('Resume'));
  assert.match(ui.text(), /Publish automatically when DSH starts/);
  const auto = ui.find('button', node => node.props.role === 'switch' && node.props['aria-label'] === 'Publish automatically when DSH starts')[0];
  assert.equal(auto.props.disabled, true);
  assert.match(ui.text(), /Available after the external connection has been confirmed/);
});

test('a paused or failed connection offers Resume, hides Open, and does not ask to open the URL', async () => {
  for (const status of ['paused', 'offline', 'error']) {
    const ui = await mount(CONFIGURED({ status }));
    assert(ui.button('Resume'), status); assert(!ui.button('Open'), status); assert(!ui.button('Pause'), status);
    assert.doesNotMatch(ui.text(), /Open the URL and sign in/, status);
  }
});

test('auto-connect is available once the connection is verified, and the choice is sent to the host', async () => {
  const calls = [];
  const ui = await mount(CONFIGURED({ verified: true, lastVerifiedAt: '2026-10-19T00:00:00.000Z' }), { calls });
  const auto = ui.find('button', node => node.props.role === 'switch' && node.props['aria-label'] === 'Publish automatically when DSH starts')[0];
  assert.equal(auto.props.disabled, false);
  auto.props.onClick();
  await ui.flush();
  assert(calls.some(([method, payload]) => method === 'autoconnect' && payload.enabled === true));
  assert(calls.every(([, payload]) => payload.generation === undefined || payload.generation === 'g1'));
});

test('an issue is shown as localized guidance, with its code only in the details', async () => {
  const issue = { code: 'CF_403', message: 'Cloudflare refused the request (HTTP 403). Check the API token.', action: undefined };
  const ui = await mount(CONFIGURED({ status: 'error', issue }));
  assert.match(ui.text(), /Cloudflare refused the token/);
  assert.doesNotMatch(ui.text(), /CF_403|HTTP 403/);
  const reconnecting = await mount(CONFIGURED({ status: 'reconnecting', issue: { code: 'CONNECTOR_EXIT', message: 'x', action: 'resume', retryAt: new Date(Date.now() + 30_000).toISOString() } }));
  assert.match(reconnecting.text(), /Next attempt in \d+ seconds/);
  assert(reconnecting.button('Retry now'));
});

test('setup starts with the token step and keeps the unsaved form (never the token) for the next visit', async () => {
  const snapshot = CONFIGURED({ status: 'unconfigured', setup: null, publicUrl: null, authorization: { active: true, until: Date.now() + 3600000 }, accounts: [{ id: 'a'.repeat(32), name: 'Personal' }],
    account: { accountId: 'a'.repeat(32), zones: [{ id: 'b'.repeat(32), name: 'example.com' }], idps: [{ id: 'provider-1', name: 'One-time PIN' }], mfa: 'independent', mfaMissing: [], teamDomain: 'team.cloudflareaccess.com', organizationRevision: 'r' } });
  const ui = await mount(snapshot);
  assert.match(ui.text(), /1\. Connect to Cloudflare/); assert.match(ui.text(), /Connected to Personal/);
  const email = ui.find('input', node => node.props.id === 'dcf-email')[0];
  assert(email);
  assert.equal(ui.button('Connect')?.props.disabled, true);
  email.props.onChange({ target: { value: 'owner@example.com' } });
  await ui.flush();
  assert.equal(ui.plugin.DRAFT.form.ownerEmail, 'owner@example.com');
  assert.equal(ui.plugin.DRAFT.form.hostname, 'dsh.example.com');
  assert.equal(JSON.stringify(ui.plugin.DRAFT).includes('token'), false);
  assert.equal(ui.button('Connect')?.props.disabled, false);
});

test('an unknown write offers exactly the recovery action the inspection allows, behind a hostname confirmation', async () => {
  const report = { kind: 'access', at: 'x', marker: 'dsh-cf-1', hostname: 'dsh.example.com', status: 'found', matches: [{ id: 'app-1', recorded: false }] };
  const calls = [];
  const ui = await mount(CONFIGURED({ status: 'error', pendingWrite: { kind: 'access', at: 'x' }, authorization: { active: true, until: Date.now() + 3600000 }, issue: { code: 'WRITE_UNKNOWN', message: 'x', action: 'resolve-write' } }), {
    calls, onCall: method => (method === 'pending/inspect' ? { ok: true, value: report } : { ok: true, value: {} }) });
  assert.match(ui.text(), /result of a Cloudflare write is unknown/);
  ui.button('Check the result').props.onClick();
  await ui.flush();
  assert(calls.some(([method]) => method === 'pending/inspect'));
  assert(ui.button('Delete the unrecorded resource'));
  assert(!ui.button('Clear the record')); assert(!ui.button('Clear the record (nothing found)'));
});
