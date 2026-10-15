import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function load() {
  let plugin;
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: item => { plugin = item.factory(() => ({ createElement: () => {}, useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useSyncExternalStore: () => ({}) })); } } },
    crypto: { randomUUID },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Set,
  });
  return plugin;
}
const ready = { remote: false, stopping: false, hostReview: false, authorized: true, accountId: 'a'.repeat(32), accountReady: true, mfa: 'independent', mfaMissing: [], zoneId: 'b'.repeat(32), idpId: 'provider-1', hostname: 'mac.example.com', ownerEmail: 'owner@example.com', pending: false, busy: false };

test('settings copy follows locale and the English headline is English', async () => {
  const plugin = await load();
  const keys = Object.keys(plugin.COPY.en).sort();
  assert.deepEqual(Object.keys(plugin.COPY.ja).sort(), keys);
  assert.deepEqual(Object.keys(plugin.COPY.zh).sort(), keys);
  assert.equal(plugin.translate('en', 'headline'), plugin.COPY.en.headline);
  assert.match(plugin.COPY.en.headline, /DSH/);
  assert.equal(plugin.COPY.en.headline.includes('あなたのDSH'), false);
  assert.equal(plugin.COPY.ja.headline.includes('あなたのDSH'), true);
  assert.equal(plugin.translate('ja', 'phaseRechecking'), plugin.COPY.ja.phaseRechecking);
  assert.equal(plugin.translate('zh', 'missing-key'), 'missing-key');
  assert.equal(plugin.COPY.en.oauthWaitingTitle.includes('ブラウザ'), false);
});
test('a disabled connect button has one reason for each blocking condition', async () => {
  const { connectBlockers } = await load();
  assert.equal(connectBlockers(ready), null);
  const cases = [
    [{ remote: true }, 'remote'],
    [{ stopping: true }, 'stopping'],
    [{ hostReview: true }, 'host'],
    [{ authorized: false }, 'authorize'],
    [{ accountReady: false }, 'account'],
    [{ mfa: 'substitute' }, 'mfa-substitute'],
    [{ mfa: 'unknown' }, 'mfa-unknown'],
    [{ mfaMissing: ['biometrics'] }, 'mfa-missing'],
    [{ zoneId: '' }, 'zone'],
    [{ idpId: '' }, 'idp'],
    [{ hostname: 'http://mac.example.com' }, 'hostname'],
    [{ hostname: 'localhost' }, 'hostname'],
    [{ ownerEmail: 'not-an-email' }, 'email'],
    [{ pending: true }, 'busy'],
    [{ busy: true }, 'busy'],
  ];
  for (const [patch, reason] of cases) assert.equal(connectBlockers({ ...ready, ...patch }), reason, reason);
});
test('Access-only sign-in ignores optional WebAuthn blockers but keeps owner, authorization and busy checks', async () => {
  const { connectBlockers } = await load();
  for (const mfa of ['unknown', 'substitute', 'independent']) {
    assert.equal(connectBlockers({ ...ready, requireWebAuthn: false, mfa, mfaMissing: ['biometrics'] }), null);
  }
  for (const [patch, reason] of [[{ authorized: false }, 'authorize'], [{ ownerEmail: '' }, 'email'], [{ remote: true }, 'remote'], [{ busy: true }, 'busy']]) {
    assert.equal(connectBlockers({ ...ready, requireWebAuthn: false, ...patch }), reason);
  }
});
test('cancel is sent while the first mutation is pending and its late result is dropped', async () => {
  const { PanelSession } = await load();
  const calls = [];
  let release;
  const session = new PanelSession(async name => {
    calls.push(name);
    if (name === 'authorize') await new Promise(resolve => { release = resolve; });
    return { sequence: calls.length, phase: name === 'cancel' || name === 'status' ? 'stopped' : 'idle', oauth: { clientId: '', scopes: [], phase: 'idle', attempt: 0 } };
  });
  const seen = [];
  session.onStatus = status => seen.push(status);
  const pending = session.mutate('authorize', { token: 'secret-value' });
  const stopping = session.control('cancel');
  assert.equal(session.stopping, true);
  const ignored = session.mutate('account', {});
  const second = session.control('stop');
  release();
  assert.equal(JSON.stringify(await ignored), JSON.stringify({ ignored: true }));
  assert.equal(JSON.stringify(await second), JSON.stringify({ coalesced: true }));
  assert.equal(JSON.stringify(await pending), JSON.stringify({ dropped: true }));
  await stopping;
  assert.deepEqual(calls, ['authorize', 'cancel', 'status']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].phase, 'stopped');
  assert.equal(JSON.stringify(seen).includes('secret-value'), false);
  assert.equal(session.stopping, false);
  assert.equal(session.busy, false);
});
test('a public page and an in-progress authorization render their links', async () => {
  let plugin;
  const hooks = [];
  let index = 0;
  let effects = [];
  let rendering = false;
  let scheduled = false;
  let view = null;
  let Component = null;
  let props = null;
  function schedule() {
    if (rendering) { scheduled = true; return; }
    rendering = true;
    try {
      let rounds = 0;
      do {
        if (++rounds > 30) throw new Error('render loop');
        scheduled = false; index = 0; effects = [];
        view = Component(props);
        for (const effect of effects.splice(0)) effect();
      } while (scheduled);
    } finally { rendering = false; }
  }
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, raw, ...children) {
      const flat = children.flat(Infinity).filter(child => child != null && child !== false);
      if (type === React.Fragment) return flat;
      if (typeof type === 'function') return type({ ...(raw || {}), children: flat });
      return { type, props: raw || {}, children: flat };
    },
    useState(initial) {
      const slot = index++;
      if (hooks.length <= slot) hooks.push(typeof initial === 'function' ? initial() : initial);
      return [hooks[slot], value => {
        const next = typeof value === 'function' ? value(hooks[slot]) : value;
        if (Object.is(next, hooks[slot])) return;
        hooks[slot] = next; schedule();
      }];
    },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = hooks[slot];
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((dep, position) => !Object.is(dep, previous.deps[position]));
      hooks[slot] = { deps };
      if (changed) effects.push(effect);
    },
    useRef(initial) {
      const slot = index++;
      if (hooks.length <= slot) hooks.push({ current: initial });
      return hooks[slot];
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const slot = index++;
      if (hooks.length <= slot) hooks.push({ value: getSnapshot(), unsubscribe: subscribe(() => { hooks[slot].value = getSnapshot(); schedule(); }) });
      return hooks[slot].value;
    },
  };
  const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  const status = {
    sequence: 2, phase: 'rechecking', authorized: true, busy: false, hostReview: null, version: '0.1.0-alpha.5', autoConnect: false,
    instanceId: '11111111-1111-4111-8111-111111111111', error: null, pendingWrite: null, binary: null,
    accounts: [{ id: 'a'.repeat(32), name: 'Example' }],
    account: { accountId: 'a'.repeat(32), mfa: 'substitute', mfaMissing: [], zones: [{ id: 'b'.repeat(32), name: 'example.com' }], idps: [{ id: 'provider-1', name: 'Email' }], teamDomain: 'team.example.com', organizationRevision: 'rev' },
    setup: { accountId: 'a'.repeat(32), zoneId: 'b'.repeat(32), hostname: 'mac.example.com', ownerEmail: 'owner@example.com', idpId: 'provider-1' },
    publicUrl: 'https://mac.example.com/', enrollmentUrl: 'https://team.example.com/', verificationUrl: null,
    evidence: { unauthenticatedRejected: true, owner: true, http: false, api: false, websocket: false },
    reachability: { status: 'rechecking', channel: 'tunnel' }, lastVerifiedAt: '2026-10-15T03:00:00.000Z',
    oauth: { clientId: 'public-client', scopes: ['account:read'], phase: 'waiting', attempt: 4, expiresAt: Date.now() + 60_000, failure: null },
    steps: ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh'].map(id => ({ id, status: 'idle', message: '' })),
  };
  vm.runInNewContext(source, {
    window: { location: { hostname: '127.0.0.1' }, __ModuleLoader__: { load: item => { plugin = item.factory(() => React); } } },
    document: { hidden: true },
    crypto: { randomUUID },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { clipboard: { async writeText() {} } },
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    Set,
  });
  plugin.apply({
    get(name) {
      if (name === 'locale') return { register() {}, addLanguage() {}, bind: () => () => 'Cloudflare' };
      return { rpc: { async call(_path, method) {
        if (method === 'status') return { ok: true, value: status };
        if (method === 'oauth/attempt') return { ok: true, value: { phase: 'waiting', attempt: 4, authorizationUrl: 'http://127.0.0.1:8789/oauth-preview', redirectUri: 'http://127.0.0.1:8789/dsh-cf/oauth/callback', expiresAt: status.oauth.expiresAt } };
        if (String(method).startsWith('update-')) return { ok: true, value: { status: 'current', running: '0.1.0-alpha.5', channel: 'prerelease', profileKey: 'ab'.repeat(32) } };
        return { ok: true, value: {} };
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
    nodes.push(node);
    node.children?.forEach(walk);
  };
  walk(view);
  const text = nodes.filter(node => typeof node === 'string').join('\n');
  const connect = nodes.find(node => node?.props?.id === undefined && node?.type === 'button' && node?.props?.['aria-describedby'] === 'dcf-connect-reason');
  assert.equal(connect?.props?.disabled, true);
  assert.match(text, /identity-provider MFA/);
  assert.match(text, /being checked again/);
  assert.match(text, /Last confirmed/);
  assert.match(text, /○ Page/);
  assert.equal(text.includes('✓ Page'), false);
  const open = nodes.find(node => node?.type === 'a' && node?.props?.href === 'http://127.0.0.1:8789/oauth-preview');
  assert.equal(typeof open, 'object');
  assert.equal(nodes.some(node => node?.type === 'a' && String(node?.props?.href || '').includes('code_verifier')), false);
  const option = nodes.find(node => node?.type === 'label' && node.children?.includes(plugin.COPY.en.requireWebAuthn));
  const checkbox = option.children.find(node => node?.type === 'input');
  // A saved setup without a flag retains the original WebAuthn requirement.
  assert.equal(checkbox.props.checked, true);
  assert(nodes.some(node => node?.type === 'a' && node.props.href === status.enrollmentUrl));
  checkbox.props.onChange({ target: { checked: false } });
  const collect = () => { nodes.length = 0; walk(view); return nodes.filter(node => typeof node === 'string').join('\n'); };
  const optionalText = collect();
  assert.equal(optionalText.includes(plugin.COPY.en.mfaSubstitute), false);
  const save = nodes.find(node => node?.type === 'button' && node.children?.includes(plugin.COPY.en.saveConnect));
  assert.equal(save.props.disabled, false);
  // The saved mode, not the unsaved checkbox, controls enrollment instructions.
  assert(nodes.some(node => node?.type === 'a' && node.props.href === status.enrollmentUrl));
  status.setup.requireWebAuthn = false; status.sequence++;
  save.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const savedText = collect();
  assert.equal(nodes.some(node => node?.type === 'a' && node.props.href === status.enrollmentUrl), false);
  assert(savedText.includes(plugin.COPY.en.verifyAccessHint));

});
test('locale registration survives an already-registered language and exposes English by default', async () => {
  const plugin = await load();
  const registrations = [];
  const locale = {
    register: (...args) => registrations.push(args),
    addLanguage: input => registrations.push(['language', input]),
    bind: () => () => 'Cloudflare',
  };
  let meta;
  const ctx = {
    get: name => (name === 'locale' ? locale : { rpc: { async call() { return { ok: false }; } } }),
    effect() {},
    slots: { inject(_name, run) { run(); }, register(value) { meta = value; } },
  };
  plugin.apply(ctx);
  assert.equal(registrations[0][0], 'dsh-cf');
  assert.equal(registrations[0][1].en.headline, plugin.COPY.en.headline);
  assert.equal(registrations[0][1].zh.headline, plugin.COPY.zh.headline);
  assert.equal(JSON.stringify(registrations[1][1]), JSON.stringify({ id: 'ja', label: '日本語', fallback: 'en' }));
  assert.equal(registrations[2][1], 'ja');
  assert.equal(meta.locale, 'dsh-cf');
  assert.equal(meta.label(), 'Cloudflare');
  locale.register = () => { throw new Error('locale namespace "dsh-cf" already has locale "en"'); };
  locale.addLanguage = () => { throw new Error('locale "ja" is already registered'); };
  assert.doesNotThrow(() => plugin.apply(ctx));
});
