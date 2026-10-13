/* Uses the React instance supplied by DSH; no extra frontend bundle or server. */
window.__ModuleLoader__.load({
  id: 'dsh-cf',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const TITLES = { environment: '実行環境', authorization: 'Cloudflare 連携', access: 'アクセス保護', tunnel: 'Tunnel 接続', browser: '本人認証', dsh: 'DSH 実通信' };
    const STATES = { idle: '待機', working: '処理中', waiting: '確認待ち', done: '確認済み', error: '要確認' };
    const PHASES = { idle: '未接続', configuring: '設定中', 'waiting-browser': 'ブラウザでの確認待ち', ready: '接続確認済み', reconnecting: '再接続中', stopped: '停止中', error: '接続を停止しました' };
    const CSS = `
.dcf{--cf-line:var(--dsw-alias-border,#d9dfe5);--cf-soft:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));--cf-accent:var(--dsw-alias-accent,#bd4f16);container-type:inline-size;min-width:0;max-width:860px;padding:8px 4px 32px;font:inherit;line-height:1.6;color:inherit}
.dcf *{box-sizing:border-box}.dcf h2{font-size:23px;letter-spacing:-.5px;margin:0}.dcf h3{font-size:15px;margin:0 0 14px}.dcf p{margin:8px 0}.dcf small,.dcf .hint{opacity:.76;font-size:12px}.dcf .head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}.dcf .eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:4px}.dcf .badge{border:1px solid var(--cf-line);border-radius:30px;padding:5px 12px;font-size:12px;white-space:nowrap}.dcf .card{border:1px solid var(--cf-line);border-radius:14px;padding:20px;margin:14px 0;background:var(--cf-soft)}
.dcf .steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;list-style:none;padding:0;margin:20px 0}.dcf .step{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--cf-line);border-radius:11px;padding:14px;min-width:0}.dcf .step>div{min-width:0;overflow-wrap:anywhere}.dcf .step strong{font-size:12px;display:block}.dcf .step small{display:block}.dcf .icon{width:23px;height:23px;flex:0 0 23px;border:1px solid var(--cf-line);border-radius:50%;display:grid;place-items:center;font-size:12px}.dcf .working .icon{border:2px solid var(--cf-line);border-top-color:var(--cf-accent);animation:dcf-spin .85s linear infinite}.dcf .done .icon{background:var(--cf-accent);color:white;border-color:transparent;animation:dcf-pop .18s ease-out}.dcf .error .icon{border-style:dashed}.dcf .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.dcf label.field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;min-width:0}.dcf input:not([type=checkbox]),.dcf select,.dcf textarea{font:inherit;font-weight:400;color:inherit;background:transparent;border:1px solid var(--cf-line);border-radius:8px;padding:10px 12px;min-width:0;width:100%}.dcf textarea{min-height:74px;resize:vertical}.dcf input:focus-visible,.dcf select:focus-visible,.dcf textarea:focus-visible,.dcf button:focus-visible,.dcf a:focus-visible{outline:2px solid var(--cf-accent);outline-offset:3px}.dcf .actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:14px}.dcf button,.dcf a.button{font:inherit;font-size:12px;line-height:1.4;border:1px solid var(--cf-line);border-radius:8px;padding:10px 15px;background:transparent;color:inherit;cursor:pointer;text-decoration:none}.dcf button.primary,.dcf a.primary{background:var(--cf-accent);color:#fff;border-color:transparent;font-weight:600}.dcf button:disabled{opacity:.45;cursor:not-allowed}.dcf .notice{border-left:3px solid var(--cf-accent);padding:9px 14px;margin:12px 0;background:var(--cf-soft);font-size:12px;overflow-wrap:anywhere}.dcf .check{display:flex;gap:9px;align-items:flex-start;font-size:12px;margin:12px 0}.dcf .check input{margin-top:5px;flex-shrink:0}.dcf details{margin-top:14px}.dcf summary{font-size:12px;cursor:pointer}.dcf code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.dcf .url{display:block;font:14px ui-monospace,monospace;overflow-wrap:anywhere;margin:10px 0}.dcf .evidence{display:flex;flex-wrap:wrap;gap:8px;font-size:11px}.dcf .evidence span{border:1px solid var(--cf-line);padding:4px 9px;border-radius:20px}.dcf progress{width:100%;accent-color:var(--cf-accent)}.dcf .footer{font-size:11px;opacity:.65;margin-top:22px;border-top:1px solid var(--cf-line);padding-top:14px}
@keyframes dcf-spin{to{transform:rotate(360deg)}}@keyframes dcf-pop{from{transform:scale(.8)}to{transform:scale(1)}}@media(max-width:580px){.dcf .steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dcf .grid{grid-template-columns:1fr}.dcf .head{display:block}.dcf .badge{display:inline-block;margin-top:10px}.dcf .card{padding:15px}}@container (max-width:580px){.dcf .steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dcf .grid{grid-template-columns:1fr}.dcf .head{display:block}.dcf .badge{display:inline-block;margin-top:10px}.dcf .card{padding:15px}}@container (max-width:360px){.dcf .steps{grid-template-columns:minmax(0,1fr)}.dcf h2{font-size:19px}.dcf .card{padding:12px}.dcf .step{padding:10px;flex-direction:column;gap:6px}.dcf .badge{white-space:normal}.dcf button,.dcf a.button{padding:9px 11px}}@media(prefers-reduced-motion:reduce){.dcf *{animation:none!important;transition:none!important}}
`;
    function field(label, value, onChange, options = {}) {
      return h('label', { className: 'field' }, label, h(options.multiline ? 'textarea' : 'input', { value, onChange: e => onChange(e.target.value), autoComplete: 'off', spellCheck: false, ...options, multiline: undefined }));
    }
    function select(label, value, onChange, options, disabled = false) {
      return h('label', { className: 'field' }, label, h('select', { value, disabled, 'aria-label': label, onChange: e => onChange(e.target.value) }, h('option', { value: '' }, '選択してください'), options.map(x => h('option', { key: x.id, value: x.id }, x.name))));
    }
    function link(label, url, primary = false) {
      if (!url) return null;
      return h('a', { className: `button ${primary ? 'primary' : ''}`, href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
    }
    const UPDATE_COPY = {
      idle: '更新は未確認です。', checking: 'リリースを確認中…', available: '更新があります。', current: '選択した更新先に新しい版はありません。',
      'no-release': '公開リリースはありません。', 'channel-empty': '選択した更新先のリリースはありません。', incompatible: 'このリリースのDSH互換性を確認できません。',
      unavailable: 'この構成では自動更新できません。', installing: 'プラグインをインストール中…', unknown: '結果が不明です。導入を繰り返さず、結果を確認してください。',
      'restart-required': '導入版を使うにはDSHを再起動してください。', applied: '導入結果を確認しています。', confirmed: '実行版の反映を確認しました。', overridden: '上位の設定により更新が反映されませんでした。', failed: '更新に失敗しました。', cancelled: 'インストールは取り消されました。',
      UPDATE_MANAGER: 'この環境では画面から更新できません。手動更新先を確認してください。', UPDATE_READ_ONLY: 'この環境では更新を書き込めません。', UPDATE_SOURCE: '現在の導入経路は手動更新が必要です。', UPDATE_COMPATIBILITY: 'DSHの対応版を確認できません。', UPDATE_FETCH: 'リリースを取得できませんでした。', UPDATE_METADATA: 'リリース情報を確認できません。', UPDATE_BUSY: '別の処理が進行中です。', UPDATE_FAILURE: '更新記録・通信・導入を確認できません。手動更新先とDSHのプラグイン設定を確認してください。',
    };
    const UPDATE_STATUSES = Object.keys(UPDATE_COPY).filter(key => !key.startsWith('UPDATE_'));
    const UPDATE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    class UpdateController {
      constructor(connection) {
        this.connection = connection; this.view = { status: 'idle', running: '—', channel: 'prerelease' }; this.listeners = new Set(); this.generation = 0; this.busy = false; this.closed = false;
        this.operation = null; this.channel = null; this.profileKey = null;
      }
      subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
      getSnapshot = () => this.view;
      publish(view) { if (this.closed) return; this.view = view; for (const listener of this.listeners) listener(); }
      storageKey(kind) { return `dsh.cf.update.${this.profileKey}.${kind}`; }
      remember(id) { this.operation = id; if (!this.profileKey) return; try { id ? localStorage.setItem(this.storageKey('operation'), id) : localStorage.removeItem(this.storageKey('operation')); } catch {} }
      async call(method, payload = {}) {
        const generation = ++this.generation;
        try {
          const result = await this.connection.rpc.call('/dsh-cf', `update-${method}`, payload);
          if (!result?.ok) {
            if (method === 'install' && result?.error?.code === 'UPDATE_BUSY' && generation === this.generation) { this.remember(null); this.publish({ ...this.view, status: 'failed', reason: 'UPDATE_BUSY' }); return; }
            throw new Error('update-rpc');
          }
          const value = result.value;
          if (!value || !UPDATE_STATUSES.includes(value.status) || typeof value.running !== 'string' || !['stable', 'prerelease'].includes(value.channel) || (value.profileKey !== null && !/^[0-9a-f]{64}$/.test(value.profileKey || '')) || value.operation && !UPDATE_UUID.test(value.operation) || value.candidate && (typeof value.candidate.id !== 'string' || typeof value.candidate.version !== 'string' || typeof value.candidate.notes !== 'string' || !value.candidate.url?.startsWith('https://github.com/Aero123421/dsh-cf/releases/tag/v'))) throw new Error('update-wire');
          if (generation !== this.generation) return;
          if (value.profileKey !== this.profileKey) {
            const changedProfile = this.profileKey !== null;
            this.profileKey = value.profileKey; this.operation = null; this.channel = null;
            if (this.profileKey) try { const id = localStorage.getItem(this.storageKey('operation')); if (id && UPDATE_UUID.test(id)) this.operation = id; const channel = localStorage.getItem(this.storageKey('channel')); if (['stable', 'prerelease'].includes(channel)) this.channel = channel; } catch {}
            // Resolve identity before restoring an ID. An old profile's unknown
            // response is discarded and the current profile is queried afresh.
            if (changedProfile && payload.operationId) return await this.status();
          }
          if (method === 'install' && value.status === 'failed' && !value.operation) this.remember(null);
          if (value.operation) this.remember(value.operation);
          else if (method === 'status' && !payload.operationId && this.operation && value.status !== 'unavailable') return await this.call('status', { operationId: this.operation });
          this.channel ??= value.channel;
          this.publish(value.candidate && value.channel !== this.channel ? { ...value, status: 'idle', candidate: null, channel: this.channel } : { ...value, channel: this.channel });
        } catch { if (generation === this.generation) this.publish({ ...this.view, status: method === 'install' || this.operation ? 'unknown' : 'failed', reason: 'UPDATE_FAILURE' }); }
      }
      status() { return this.call('status'); }
      select(channel) { this.channel = channel; try { localStorage.setItem(this.storageKey('channel'), channel); } catch {} this.publish({ ...this.view, channel, status: 'idle', candidate: null }); }
      async check() { if (this.busy || !this.profileKey) return; this.busy = true; this.remember(null); this.publish({ ...this.view, status: 'checking' }); try { await this.call('check', { channel: this.channel ?? this.view.channel }); } finally { this.busy = false; } }
      async install() {
        if (this.busy || !this.profileKey || this.view.status !== 'available' || !this.view.candidate) return;
        this.busy = true; const operationId = crypto.randomUUID(); this.remember(operationId);
        const payload = { profileKey: this.profileKey, operationId, candidateId: this.view.candidate.id, channel: this.channel ?? this.view.channel };
        this.publish({ ...this.view, status: 'installing', operation: operationId });
        try { await this.call('install', payload); } finally { this.busy = false; }
      }
      dispose() { this.closed = true; ++this.generation; this.listeners.clear(); }
    }
    function UpdatePanel({ updates, remote, cloudBusy, authorized, version }) {
      const view = React.useSyncExternalStore(updates.subscribe, updates.getSnapshot);
      React.useEffect(() => {
        if (remote) return;
        void updates.status();
        const timer = setInterval(() => { if (!updates.busy) void updates.status(); }, 2000);
        return () => clearInterval(timer);
      }, [updates, remote]);
      const busy = !view.profileKey || ['checking', 'installing', 'unknown', 'restart-required'].includes(view.status);
      return h('section', { className: 'card dcf-plugin-update' }, h('h3', null, 'プラグインの更新'),
        h('p', null, `実行版: ${view.running === '—' ? version || '—' : view.running}${view.installed && view.installed !== view.running ? ` · 導入版: ${view.installed}` : ''}`),
        remote ? h('p', { className: 'notice' }, 'プラグインの更新は元の管理接続から操作してください。公開Tunnelでは実行できません。') : h(React.Fragment, null,
          select('更新先', view.channel, channel => updates.select(channel), [{ id: 'stable', name: '安定版' }, { id: 'prerelease', name: 'プレリリース（alpha等）' }], busy || cloudBusy),
          h('p', { role: 'status' }, UPDATE_COPY[view.status], view.reason ? ` · ${UPDATE_COPY[view.reason] || UPDATE_COPY.UPDATE_FAILURE}` : ''),
          view.checkedAt ? h('p', { className: 'hint' }, `確認日時: ${new Date(view.checkedAt).toLocaleString()}`) : null,
          view.candidate && view.status === 'available' ? h('div', null, h('p', null, `${view.running} → ${view.candidate.version} · DSH ${view.candidate.runtime}`), h('p', { style: { whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' } }, view.candidate.notes), h('p', { className: 'hint' }, '現在のGitHub配布経路を維持し、版固定を選択したリリースのタグに変更します。')) : null,
          h('div', { className: 'actions' }, h('button', { type: 'button', disabled: busy || cloudBusy || view.status === 'unavailable', onClick: () => void updates.check() }, '更新を確認'), view.status === 'available' ? h('button', { type: 'button', className: 'primary', disabled: cloudBusy, onClick: () => void updates.install() }, 'プラグインを更新する') : null, view.status === 'unknown' ? h('button', { type: 'button', onClick: () => void updates.status() }, '結果を確認') : null),
          view.status === 'restart-required' && authorized ? h('p', { className: 'notice' }, 'DSH再起動後はメモリー内のCloudflare API tokenの再入力が必要です。所有するTunnel・DNS・AccessのIDは保存されたままです。') : null),
        h('p', { className: 'hint' }, 'cloudflaredの取得・更新、TunnelやDNS/Accessの変更とは別の操作です。'), link('リリース・手動更新', 'https://github.com/Aero123421/dsh-cf/releases'));
    }
    function Panel({ connection, updates }) {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [connectionError, setConnectionError] = React.useState('');
      const [pending, setPending] = React.useState(false);
      const [token, setToken] = React.useState('');
      const [clientId, setClientId] = React.useState('');
      const [scopes, setScopes] = React.useState('');
      const [oauth, setOauth] = React.useState(null);
      const [callback, setCallback] = React.useState('');
      const [form, setForm] = React.useState({ accountId: '', zoneId: '', hostname: '', ownerEmail: '', idpId: '', cloudflaredPath: '', allowDownload: false });
      const [consent, setConsent] = React.useState(false);
      const [hostOk, setHostOk] = React.useState(false);
      const [deleteName, setDeleteName] = React.useState('');
      const [copied, setCopied] = React.useState(false);
      const mounted = React.useRef(true), seeded = React.useRef(false), busyRef = React.useRef(false);
      async function call(action, payload = {}) {
        const result = await connection.rpc.call('/dsh-cf', action, payload);
        if (!result?.ok) throw new Error(result?.error?.message || '処理に失敗しました。');
        return result.value;
      }
      const merge = value => {
        if (!mounted.current) return;
        setState(value);
        if (!seeded.current) {
          seeded.current = true;
          if (value.setup) setForm(f => ({ ...f, ...value.setup }));
          setClientId(value.oauth.clientId); setScopes(value.oauth.scopes.join(' '));
        }
      };
      React.useEffect(() => {
        mounted.current = true; let cancelled = false, timer;
        const refresh = async () => {
          try { const value = await call('status'); if (!cancelled) { merge(value); setConnectionError(''); } }
          catch { if (!cancelled) setConnectionError('DSHとの接続を確認しています。設定の再読込中は自動で復帰します。'); }
          finally { if (!cancelled) timer = setTimeout(refresh, document.hidden ? 10_000 : 2000); }
        };
        void refresh();
        return () => { cancelled = true; mounted.current = false; clearTimeout(timer); };
      }, [connection]);
      async function action(name, payload = {}, after) {
        if (busyRef.current) return;
        busyRef.current = true; setPending(true); setError('');
        try {
          const value = await call(name, payload);
          if (mounted.current) {
            after?.(value);
            try { const status = await call('status'); if (mounted.current) { merge(status); setConnectionError(''); } }
            catch { if (mounted.current) setConnectionError('DSHとの接続を確認しています。設定の再読込中は自動で復帰します。'); }
          }
        }
        catch (e) { if (mounted.current) setError(e.message || '処理に失敗しました。'); }
        finally { busyRef.current = false; if (mounted.current) setPending(false); }
      }
      const change = key => value => setForm(f => ({ ...f, [key]: value }));
      const remote = state?.setup?.hostname === window.location.hostname;
      const blocked = pending || state?.busy || remote;
      const button = (text, name, payload = {}, options = {}) => h('button', { type: 'button', disabled: blocked, onClick: () => action(name, payload), ...options, disabled: remote || (options.disabled ?? blocked) }, text);
      const account = state?.account?.accountId === form.accountId ? state.account : null;
      const ready = state?.phase === 'ready';
      const chooseAccount = accountId => {
        setForm(f => ({ ...f, accountId, zoneId: '', idpId: '' })); setConsent(false);
        if (accountId) void action('account', { accountId });
      };
      async function copyUrl() {
        try { await navigator.clipboard.writeText(state.publicUrl); setCopied(true); } catch { setError('リンクを選択してコピーしてください。'); }
      }
      return h('section', { className: 'dcf', 'aria-label': 'Cloudflare リモートアクセス' },
        h('style', null, CSS),
        h('div', { className: 'head' }, h('div', null, h('div', { className: 'eyebrow' }, 'DSH / CLOUDFLARE'), h('h2', null, 'あなたのDSHを、どこからでも。'), h('p', { className: 'hint' }, '所有者だけに公開。ポート開放・Workerデプロイは不要。')), h('span', { className: 'badge', role: 'status', 'aria-live': 'polite' }, PHASES[state?.phase] || '状態を取得中')),
        h('ol', { className: 'steps', 'aria-label': '接続の確認工程' }, (state?.steps || Object.keys(TITLES).map(id => ({ id, status: 'idle' }))).map((s, i) => h('li', { className: `step ${s.status}`, key: s.id, title: s.message }, h('span', { className: 'icon', 'aria-hidden': true }, s.status === 'done' ? '✓' : s.status === 'working' ? '' : s.status === 'error' ? '!' : i + 1), h('div', null, h('strong', null, TITLES[s.id]), h('small', null, STATES[s.status]))))),
        remote ? h('div', { className: 'notice' }, 'この公開接続では状態確認だけができます。Cloudflare設定の変更・停止は、元のローカルまたはSSH経由のDSH接続で行ってください。') : null,
        error ? h('div', { className: 'notice', role: 'alert' }, error) : null,
        connectionError ? h('div', { className: 'notice', role: 'status' }, connectionError) : null,
        state?.error ? h('div', { className: 'notice', role: 'alert' }, h('strong', null, state.error.code), h('p', null, state.error.message)) : null,
        state?.pendingWrite ? h('div', { className: 'notice' }, '前回のAPI作成結果が不明です。重複作成を防ぐため停止しています。READMEの「不明な書き込みの復旧」を確認してください。') : null,
        state?.hostReview ? h('div', { className: 'notice', role: 'alert' }, h('strong', null, 'このPCで使い続けるか確認してください'),
          h('p', null, 'この設定は、前回と違うホスト名またはユーザーで開かれました。macOSのネットワーク変更やコンテナの再作成でも起こります。別のPCへコピーした設定を同時に使うと、同じTunnelに2台のDSHがつながり、通信がどちらへ届くか分からなくなります。そのため確認するまで接続と自動接続を止めています。'),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: hostOk, disabled: blocked, onChange: e => setHostOk(e.target.checked) }), 'このTunnelを使っているDSHは、このPCのこのプロファイルだけです。'),
          h('div', { className: 'actions' }, button('このDSHで使い続ける', 'host/confirm', { approved: true }, { disabled: blocked || !hostOk, onClick: () => action('host/confirm', { approved: true }, () => setHostOk(false)) }))) : null,
        h('div', { className: 'card' }, h('h3', null, '1. Cloudflare と連携'),
          h('p', { className: 'hint' }, state?.authorized ? '管理用の認可を確認済み。この認可はメモリ内だけに保持します。' : '初回設定・削除のときだけ管理用の認可が必要です。'),
          h('div', { className: 'actions' }, h('button', { className: 'primary', type: 'button', disabled: blocked || !clientId || !scopes.trim(), onClick: () => action('oauth/start', { clientId, scopes: scopes.split(/\s+/).filter(Boolean) }, setOauth) }, 'Cloudflare で認可'), state?.authorized ? button('管理認可をこのDSHから忘れる', 'forget') : null),
          oauth ? h('div', { className: 'notice' }, h('strong', null, 'ブラウザで許可してください'), h('p', null, 'この操作はCloudflareの設定を作るための認可です。DSH利用時の本人認証とは別です。'), link('Cloudflare の認可画面を開く', oauth.authorizationUrl, true), h('p', { className: 'hint' }, 'コールバック: ', h('code', null, oauth.redirectUri)), button('認可をキャンセル', 'oauth/cancel', {}, { onClick: () => action('oauth/cancel', {}, () => setOauth(null)) }),
            h('details', null, h('summary', null, 'Ubuntuなど別のPCのDSHを設定している場合'), h('p', null, '認可後にlocalhostの画面が開けなければ、そのアドレス欄のURL全体をここに貼り付けます。元の信頼済みDSH接続から行い、URLを共有しないでください。'), field('認可後のコールバックURL（使い捨て）', callback, setCallback, { type: 'password' }), button('認可結果を受け取る', 'oauth/finish', { redirectUrl: callback }, { disabled: blocked || !callback, onClick: () => { const value = callback; setCallback(''); void action('oauth/finish', { redirectUrl: value }, () => setOauth(null)); } }))) : null,
          h('details', { open: !state?.authorized && !clientId }, h('summary', null, 'OAuth Client ID / APIトークンで設定'),
            h('p', { className: 'hint' }, '配布用OAuthクライアントは作者側の登録が必要です。未登録なら限定権限のAPIトークン、または自分の公開クライアントを使用できます。'),
            h('div', { className: 'grid' }, field('OAuth Client ID（公開情報）', clientId, setClientId), field('登録済みScope ID（空白区切り）', scopes, setScopes)),
            h('div', { style: { marginTop: 14 } }, field('Cloudflare APIトークン（保存しません）', token, setToken, { type: 'password' })),
            h('div', { className: 'actions' }, button('APIトークンで連携', 'authorize', {}, { disabled: blocked || !token.trim(), onClick: () => { const value = token; setToken(''); void action('authorize', { token: value }); } })),
            h('p', { className: 'hint' }, '必要権限はREADMEを参照。Global API KeyやCloudflareのパスワードは入力しないでください。'))),
        h('div', { className: 'card' }, h('h3', null, '2. このDSHの公開先を決める'),
          select('Cloudflare アカウント', form.accountId, chooseAccount, state?.accounts || [], blocked || !state?.authorized),
          form.accountId && !account ? h('div', { className: 'actions' }, button('このアカウントの設定を取得', 'account', { accountId: form.accountId }, { disabled: blocked || !state?.authorized })) : null,
          account ? h('div', null, h('div', { className: 'grid', style: { marginTop: 14 } }, select('DNSゾーン', form.zoneId, change('zoneId'), account.zones, blocked), select('本人確認に使うログイン方法', form.idpId, change('idpId'), account.idps, blocked)),
            account.mfaMissing.length ? h('div', { className: 'notice' }, h('strong', null, '組織設定への追加が必要です'), h('p', null, 'Accessの利用可能な認証器に、生体認証とセキュリティキーを追加します。既存の認証方法や、他アプリのMFA必須設定は変更しません。'), h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: consent, onChange: e => setConsent(e.target.checked) }), '組織全体で利用できる認証器が増えることを確認しました。'), button('この追加だけを許可', 'mfa/enable', { accountId: form.accountId, revision: account.organizationRevision, approved: true }, { disabled: blocked || !consent })) : h('p', { className: 'hint' }, '✓ WebAuthnを利用できるAccess設定を確認しました。')) : null,
          h('div', { className: 'grid', style: { marginTop: 14 } }, field('公開ホスト名', form.hostname, change('hostname'), { placeholder: 'mac.example.com', disabled: blocked }), field('アクセスを許可する本人のメール', form.ownerEmail, change('ownerEmail'), { type: 'email', placeholder: 'you@example.com', disabled: blocked })),
          h('p', { className: 'hint' }, 'DSHごとに別のURLを作ります。同じDSHをMac・iPad・スマホから使うときは同じURLです。'),
          h('details', null, h('summary', null, 'cloudflared の詳細'), field('実行ファイルの絶対パス（通常は自動検出）', form.cloudflaredPath, change('cloudflaredPath')), h('p', { className: 'hint' }, '既存のバイナリは再利用します。既存サービス・Tunnel・設定ファイルは変更しません。')),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: form.allowDownload, disabled: blocked, onChange: e => change('allowDownload')(e.target.checked) }), '未導入の場合だけ、検証済みの公式cloudflaredをプラグイン専用フォルダへ取得する。'),
          h('div', { className: 'actions' }, button('保護設定を作成して接続', 'start', form, { className: 'primary', disabled: blocked || !!state?.hostReview || !state?.authorized || !form.accountId || !form.zoneId || !form.idpId || !form.hostname || !form.ownerEmail }), state?.setup ? button('保存済みの設定で再接続', 'resume', {}, { disabled: blocked || !!state?.hostReview }) : null),
          state?.download ? h('div', { role: 'status' }, h('p', { className: 'hint' }, 'cloudflared: ', state.download.phase), state.download.total > 0 ? h('progress', { max: state.download.total, value: state.download.received || 0, 'aria-label': 'cloudflared ダウンロード' }) : null) : null),
        state?.publicUrl ? h('div', { className: 'card' }, h('h3', null, '3. ブラウザで本人認証・通信を確認'),
          h('p', { className: 'hint' }, 'Accessへのログイン＋WebAuthnの追加認証を使います。パスキー単独ログインではありません。登録済みの認証器はAccess側で管理されます。'),
          h('div', { className: 'actions' }, link('認証器の登録画面', state.enrollmentUrl), link('本人認証してDSHを確認', state.verificationUrl, true)),
          h('p', null, h('span', { className: 'url' }, state.publicUrl)),
          h('div', { className: 'evidence' }, [['unauthenticatedRejected', '未認証の拒否'], ['owner', '本人確認'], ['http', '画面'], ['api', 'API'], ['websocket', 'WebSocket']].map(([key, label]) => h('span', { key }, `${state.evidence[key] ? '✓' : '○'} ${label}`))),
          h('div', { className: 'actions' }, link(ready ? 'DSHを開く' : '公開URLを開く（確認中）', state.publicUrl, ready), h('button', { type: 'button', onClick: copyUrl }, copied ? 'コピー済み' : 'URLをコピー')),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: state.autoConnect, disabled: blocked || !!state.hostReview || (!ready && !state.autoConnect), onChange: e => action('autoconnect', { enabled: e.target.checked }) }), 'DSHの次回起動時に自動接続する（初回通信確認後に有効化できます）。')) : null,
        h('div', { className: 'actions' }, h('button', { type: 'button', disabled: pending || remote, onClick: () => action(state?.busy ? 'cancel' : 'stop') }, state?.busy ? '処理をキャンセル' : '公開接続を一時停止')),
        state?.setup ? h('details', null, h('summary', null, 'このDSHの公開設定を削除'), h('p', { className: 'hint' }, '専用DNS・Tunnel・Accessアプリだけを削除します。先に自動接続を無効にします。共有MFA設定と既存cloudflaredは残ります。'), field('削除する公開ホスト名を再入力', deleteName, setDeleteName), h('div', { className: 'actions' }, button('専用の公開設定を削除', 'remove', { confirmHostname: deleteName }, { disabled: blocked || !state.authorized || deleteName !== state.setup.hostname }))) : null,
        h('details', null, h('summary', null, '診断の詳細'), h('p', null, h('code', null, `Instance: ${state?.instanceId || '—'}`)), state?.binary ? h('p', null, h('code', null, `${state.binary.path} (${state.binary.version})`)) : null, state?.steps.map(s => h('p', { className: 'hint', key: s.id }, `${TITLES[s.id]}: ${s.message || STATES[s.status]}`))),
        h(UpdatePanel, { updates, remote: remote || !/^(?:localhost|\[?::1\]?|127\.\d+\.\d+\.\d+)$/.test(window.location.hostname), version: state?.version, cloudBusy: state?.busy || pending, authorized: state?.authorized }),
        h('div', { className: 'footer' }, 'dsh-cf · Developer preview · Cloudflareを信頼する所有者向けの接続です。Cloudflare側のMFA解除や失効を即座に検出する保証はありません。')
      );
    }
    function apply(ctx) {
      const connection = ctx.get('connection');
      const updates = new UpdateController(connection);
      ctx.effect(() => () => updates.dispose(), 'dsh-cf: updater client');
      function SettingsPanel() { return h(Panel, { connection, updates }); }
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-cf', order: 20, label: () => 'Cloudflare', locale: 'dsh-cf' }, SettingsPanel));
    }
    return { apply, inject: ['slots', 'connection', 'locale'], UpdateController };
  },
});
