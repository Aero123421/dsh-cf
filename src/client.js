/* Classic script: DSH inserts this file with a script tag. Do not add import or export. */
window.__ModuleLoader__.load({
  id: 'dsh-cf',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    // The official settings plugins take the shared primitives from the same module table. Each export is feature-detected
    // so an older or reshaped table degrades to the plain fallbacks below instead of breaking the settings page.
    let UI = {};
    try { UI = require('@deepseek-ai/dsh-client-ui-primitives') || {}; } catch { UI = {}; }
    const has = name => UI[name] != null && (typeof UI[name] === 'function' || typeof UI[name] === 'object');

    // ---- Copy. One row per key: [en, ja, zh]. Keys with a prefix (st_, sd_, step_, ss_, ev_, dl_, b_, v_, i_, pm_, pmd_, pi_) are built at run time. ----
    const COPY = { en: {}, ja: {}, zh: {} };
    const T = (key, en, ja, zh) => { COPY.en[key] = en; COPY.ja[key] = ja; COPY.zh[key] = zh; };
    T('localeTag', 'en', 'ja', 'zh-CN');
    T('title', 'Cloudflare', 'Cloudflare', 'Cloudflare');
    T('intro', 'Open this DSH from your other devices through Cloudflare. Only the email address you allow can sign in.', 'このDSHを、Cloudflare経由で外から開きます。許可した本人のメールアドレスだけがログインできます。', '通过 Cloudflare 从外部打开这个 DSH。只有你允许的邮箱可以登录。');
    T('loading', 'Loading the status…', '状態を読み込み中…', '正在读取状态…');
    T('connLost', 'Cannot reach DSH. The page retries by itself, for example while DSH reloads its settings.', 'DSHに接続できません。設定の再読込中などは、自動で再試行します。', '无法连接到 DSH。重新加载设置期间等情况下会自动重试。');
    T('close', 'Close', '閉じる', '关闭');
    T('cancel', 'Cancel', 'キャンセル', '取消');
    T('copy', 'Copy', 'コピー', '复制');
    T('copied', 'Copied', 'コピーしました', '已复制');
    T('copyFailed', 'Could not copy. Select the address and copy it.', 'コピーできませんでした。アドレスを選択してコピーしてください。', '无法复制。请选中地址后复制。');
    T('open', 'Open', '開く', '打开');
    T('reload', 'Reload', '再読み込み', '重新读取');

    // Status words and one-line meaning. `removing` is derived from the running delete operation.
    T('st_online', 'Online', 'オンライン', '在线');
    T('st_starting', 'Connecting', '接続を準備中', '正在准备连接');
    T('st_reconnecting', 'Reconnecting', '再接続中', '正在重新连接');
    T('st_stopping', 'Stopping', '停止処理中', '正在停止');
    T('st_paused', 'Paused', '一時停止中', '已暂停');
    T('st_offline', 'Not connected', '未接続', '未连接');
    T('st_error', 'Error', 'エラー', '错误');
    T('st_unconfigured', 'Not set up', '未設定', '未设置');
    T('st_removing', 'Deleting', '削除中', '正在删除');
    T('sd_online', 'This DSH can be opened from outside. Closing the browser does not stop it.', '外部からこのDSHを開けます。ブラウザを閉じても公開は続きます。', '可以从外部打开这个 DSH。关闭浏览器不会停止公开。');
    T('sd_starting', 'Preparing the connection. The checks below run one after another.', '公開の準備をしています。下の確認を順に進めます。', '正在准备连接。下面的检查会依次进行。');
    T('sd_reconnecting', 'Waiting for cloudflared to connect again. The plugin retries by itself.', 'cloudflaredの再接続を待っています。自動で再試行します。', '正在等待 cloudflared 重新连接。插件会自动重试。');
    T('sd_stopping', 'Stopping the connection. Wait until this finishes.', '公開を止めています。完了するまで操作できません。', '正在停止公开。完成前无法操作。');
    T('sd_paused', 'Paused by you. DSH does not reconnect by itself after a restart.', '一時停止中です。DSHを再起動しても自動では再開しません。', '已由你暂停。重启 DSH 后也不会自动恢复。');
    T('sd_offline', 'The settings are saved, but this DSH is not published right now.', '設定は保存済みですが、今は公開していません。', '设置已保存，但目前没有公开。');
    T('sd_error', 'Stopped because of an error. Fix the cause below, then resume.', 'エラーで止まっています。下の原因を直してから再開してください。', '因错误而停止。请先按下面的提示排除原因，再恢复。');
    T('sd_removing', 'Deleting the public settings from Cloudflare.', 'Cloudflare上の公開設定を削除しています。', '正在删除 Cloudflare 上的公开设置。');
    T('retryIn', 'Next attempt {time}.', '次の試行: {time}', '下次尝试：{time}');
    T('pause', 'Pause', '一時停止', '暂停');
    T('resume', 'Resume', '再開', '恢复');
    T('resumeHint', 'Resume reconnects with the saved settings. It needs no Cloudflare token.', '「再開」は保存済みの設定で再接続します。Cloudflareのトークンは不要です。', '“恢复”使用已保存的设置重新连接，不需要 Cloudflare 令牌。');
    T('publicUrl', 'Public URL', '公開URL', '公开网址');
    T('firstOpen', 'Open the URL and sign in with the allowed email once. The first successful sign-in confirms the external connection.', 'この公開URLを開き、許可したメールでログインします。最初のログインに成功すると、外部からの通信が確認されます。', '打开这个网址并用允许的邮箱登录。首次登录成功后，外部连接就会被确认。');
    // Setup, step 1: Cloudflare access
    T('s1Title', '1. Connect to Cloudflare', '1. Cloudflareに接続', '1. 连接 Cloudflare');
    T('s1Intro', 'Paste an API token created in Cloudflare. It is never saved: it stays in memory and is discarded after one hour.', 'Cloudflareで作ったAPIトークンを貼り付けます。トークンは保存せず、メモリー上で1時間だけ使います。', '粘贴在 Cloudflare 创建的 API 令牌。令牌不会被保存，只在内存中保留一小时。');
    T('tokenLabel', 'API token', 'APIトークン', 'API 令牌');
    T('tokenHint', 'Do not enter a Global API Key or your Cloudflare password.', 'Global API KeyやCloudflareのパスワードは入力しないでください。', '请不要输入 Global API Key 或 Cloudflare 密码。');
    T('tokenConnect', 'Connect to Cloudflare', 'Cloudflareに接続', '连接 Cloudflare');
    T('tokenConnecting', 'Checking…', '確認中…', '正在确认…');
    T('tokenCreate', 'Create an API token', 'APIトークンを作成', '创建 API 令牌');
    T('tokenPerms', 'Required permissions', '必要な権限', '所需权限');
    T('authOk', 'Connected to {accounts}.', '{accounts}に接続しました。', '已连接到 {accounts}。');
    T('authUntil', 'Valid until {time} ({left}).', '有効期限: {time}（{left}）', '有效期至 {time}（{left}）');
    T('authForget', 'Forget token', 'トークンを破棄', '丢弃令牌');
    T('authForgetHint', 'Forgetting only discards the token in this DSH. It stays valid in Cloudflare; delete it there when you no longer need it.', '破棄するのはこのDSHが持つトークンだけです。Cloudflare側では有効なままなので、不要になったらCloudflareで削除してください。', '丢弃的只是这个 DSH 持有的令牌。它在 Cloudflare 一侧仍然有效，不再需要时请在 Cloudflare 删除。');
    T('authCardTitle', 'Cloudflare management token', 'Cloudflare管理用トークン', 'Cloudflare 管理令牌');
    T('authCardIntro', 'Connecting and reconnecting do not need it. Enter it only to change settings, delete the public settings, or recover from an unknown write.', '接続や再接続には不要です。設定の変更・公開設定の削除・書き込み結果の復旧のときだけ入力します。', '连接和重新连接不需要它。只有更改设置、删除公开设置、恢复未知写入结果时才需要输入。');
    T('authCardNone', 'No token entered.', 'トークンは入力されていません。', '尚未输入令牌。');
    T('authEnter', 'Enter a token', 'トークンを入力', '输入令牌');
    // Setup, step 2
    T('s2Title', '2. Where to publish', '2. 公開先', '2. 公开位置');
    T('s2Locked', 'Available after step 1.', '手順1を完了すると選べます。', '完成第 1 步后即可选择。');
    T('s2Loading', 'Reading the account settings…', 'アカウントの設定を読み込み中…', '正在读取账户设置…');
    T('accountLabel', 'Cloudflare account', 'Cloudflareアカウント', 'Cloudflare 账户');
    T('zoneLabel', 'Domain (DNS zone)', 'ドメイン（DNSゾーン）', '域名（DNS 区域）');
    T('idpLabel', 'Login method', 'ログイン方法', '登录方式');
    T('hostnameLabel', 'Public hostname', '公開ホスト名', '公开主机名');
    T('hostnameHint', 'One subdomain directly under the domain, for example dsh.example.com.', 'ドメイン直下の1階層のサブドメインです。例: dsh.example.com', '域名正下方的一级子域名，例如 dsh.example.com。');
    T('emailLabel', 'Your email address', '本人のメールアドレス', '你的邮箱');
    T('emailHint', 'Only this address can sign in.', 'このアドレスだけがログインできます。', '只有这个地址可以登录。');
    T('choose', 'Choose', '選択してください', '请选择');
    T('noZones', 'This account has no active domain. Add a domain in Cloudflare, then reload the account.', 'このアカウントに有効なドメインがありません。Cloudflareにドメインを追加してから、再読み込みしてください。', '这个账户没有可用的域名。请先在 Cloudflare 添加域名，然后重新读取。');
    T('v_hostFormat', 'Enter a hostname with a dot, without a URL, port or path.', 'URL・ポート・パスを含まない、ドットのあるホスト名を入力してください。', '请输入带点的主机名，不要包含网址、端口或路径。');
    T('v_hostDepth', 'Use exactly one label in front of {zone}, such as dsh.{zone}. Deeper names are not covered by Cloudflare’s free certificate.', '{zone}の直下1階層にしてください（例: dsh.{zone}）。2階層以上はCloudflareの無料証明書の対象外です。', '请在 {zone} 前只加一级，例如 dsh.{zone}。更深的名称不在 Cloudflare 免费证书范围内。');
    T('v_hostApex', 'Use a subdomain such as dsh.{zone}, not the domain itself.', 'ドメイン本体ではなく、dsh.{zone}のようなサブドメインにしてください。', '请使用 dsh.{zone} 这样的子域名，而不是域名本身。');
    T('v_hostZone', 'The hostname must end with .{zone}, the domain you chose.', '選んだドメイン（{zone}）の下のホスト名にしてください。', '主机名必须位于你选择的域名 {zone} 之下。');
    T('v_email', 'Enter one email address, such as you@example.com.', 'メールアドレスを1つ入力してください（例: you@example.com）。', '请输入一个邮箱地址，例如 you@example.com。');
    // Setup, step 3
    T('s3Title', '3. Connect', '3. 接続', '3. 连接');
    T('s3Intro', 'Creates a dedicated Tunnel, a DNS record and an Access application that admits only your email, then connects from this PC.', '専用のTunnel・DNSレコード・本人だけを許可するAccessアプリを作り、このPCから接続します。', '创建专用的 Tunnel、DNS 记录和只允许你的邮箱的 Access 应用，然后从这台电脑连接。');
    T('connect', 'Connect', '接続する', '连接');
    T('advanced', 'Advanced settings', '詳細設定', '高级设置');
    T('downloadLabel', 'Get the official cloudflared', '公式のcloudflaredを取得する', '获取官方 cloudflared');
    T('downloadNeed', 'It is downloaded from the official release and checked against its checksum before it runs.', '公式のリリースから取得し、チェックサムを確認してから実行します。', '将从官方发布处下载，校验通过后才会运行。');
    T('cfdPath', 'cloudflared executable (absolute path)', 'cloudflaredの実行ファイル（絶対パス）', 'cloudflared 可执行文件（绝对路径）');
    T('cfdPathHint', 'Detected automatically. Fill it in only to use a specific installed copy.', '通常は自動で検出します。特定のインストール済みバイナリを使うときだけ入力します。', '通常会自动检测。只有要使用指定的已安装副本时才需要填写。');
    T('webauthnTitle', 'Additional verification (WebAuthn)', '追加認証（WebAuthn）', '额外验证（WebAuthn）');
    T('webauthnDesc', 'After signing in, also confirm with Touch ID or a security key.', 'ログインに加えて、Touch IDやセキュリティキーでも確認します。', '登录后还要用 Touch ID 或安全密钥确认。');
    T('webauthnEnroll', 'Register an authenticator', '認証器を登録するページ', '注册验证器的页面');
    T('mfaTitle', 'One addition to the organization settings is needed', '組織設定への追加が必要です', '需要向组织设置追加一项');
    T('mfaBody', 'Allow biometrics and security keys as Access authenticators. Existing login methods and other apps’ MFA requirements stay as they are.', 'Accessで使える認証器に、生体認証とセキュリティキーを追加します。既存のログイン方法や、他のアプリのMFA設定は変更しません。', '把生物识别和安全密钥加入 Access 可用的验证器。现有登录方式以及其他应用的 MFA 设置保持不变。');
    T('mfaConsent', 'I understand this adds authenticators for the whole organization.', '組織全体で使える認証器が増えることを確認しました。', '我已确认这会增加整个组织可用的验证器。');
    T('mfaEnable', 'Add only these authenticators', 'この認証器だけを追加', '只添加这些验证器');
    T('mfaReady', 'Access can use WebAuthn.', 'AccessでWebAuthnを使えることを確認しました。', '已确认 Access 可以使用 WebAuthn。');
    T('mfaSubstitute', 'This organization lets identity-provider MFA replace the separate WebAuthn prompt. Turn off “Use identity provider MFA” in the Zero Trust Access settings, then reload. This plugin does not change that shared setting.', 'この組織では、ログイン元（IdP）のMFAが独立したWebAuthnの確認の代わりになります。Zero Trust Accessの設定で「アイデンティティプロバイダーのMFAを使用」をオフにしてから、再読み込みしてください。この共有設定はプラグインでは変更しません。', '这个组织允许身份提供商的 MFA 代替独立的 WebAuthn 验证。请在 Zero Trust Access 设置中关闭“使用身份提供商 MFA”，然后重新读取。插件不会修改这项共享设置。');
    T('mfaUnknown', 'Cloudflare’s answer did not show whether identity-provider MFA can replace WebAuthn. Reload the account. Nothing was changed.', 'IdPのMFAがWebAuthnの代わりになるかを、Cloudflareの応答から判断できませんでした。アカウントを再読み込みしてください。何も変更していません。', '无法从 Cloudflare 的响应判断身份提供商的 MFA 是否会代替 WebAuthn。请重新读取账户。没有做任何更改。');
    T('progressTitle', 'Connection progress', '接続の進行状況', '连接进度');
    T('progressHint', 'Cancelling keeps the saved settings.', 'キャンセルしても、保存済みの設定は残ります。', '取消不会删除已保存的设置。');
    T('step_environment', 'Environment', '実行環境', '运行环境');
    T('step_authorization', 'Cloudflare settings', 'Cloudflareの設定', 'Cloudflare 设置');
    T('step_access', 'Access protection', 'アクセス保護', '访问保护');
    T('step_tunnel', 'Tunnel connection', 'Tunnel接続', 'Tunnel 连接');
    T('step_browser', 'Your sign-in', '本人のログイン', '你的登录');
    T('step_dsh', 'Traffic to DSH', 'DSHへの実通信', '到 DSH 的实际通信');
    T('ss_idle', 'Waiting', '待機', '等待');
    T('ss_working', 'Working', '処理中', '处理中');
    T('ss_waiting', 'Needs your sign-in', 'ログイン待ち', '等待你登录');
    T('ss_done', 'Done', '完了', '完成');
    T('ss_error', 'Needs attention', '要確認', '需要处理');
    T('dl_metadata', 'Checking the official release', '公式リリースを確認中', '正在检查官方发布');
    T('dl_downloading', 'Downloading cloudflared', 'cloudflaredを取得中', '正在下载 cloudflared');
    T('dl_verified', 'Checksum verified', 'チェックサムを確認しました', '校验和已确认');
    T('b_host', 'Confirm first that this computer keeps using this profile.', 'このPCで使い続けることを、先に確認してください。', '请先确认继续在这台电脑上使用。');
    T('b_unknownWrite', 'Resolve the unknown Cloudflare write first.', '先に、結果が不明なCloudflareへの書き込みを解決してください。', '请先处理结果未知的 Cloudflare 写入。');
    T('b_authorize', 'Connect to Cloudflare in step 1 first.', '先に手順1でCloudflareに接続してください。', '请先在第 1 步连接 Cloudflare。');
    T('b_account', 'Wait until the account settings are loaded.', 'アカウントの設定の読み込みが終わるまでお待ちください。', '请等待账户设置读取完成。');
    T('b_mfaSubstitute', 'Identity-provider MFA can replace WebAuthn, so publishing stays off. See the notice above.', 'IdPのMFAがWebAuthnの代わりになるため、公開しません。上の案内を確認してください。', '身份提供商的 MFA 可以代替 WebAuthn，因此不会公开。请查看上面的说明。');
    T('b_mfaUnknown', 'It is unknown whether identity-provider MFA can replace WebAuthn. Reload the account.', 'IdPのMFAがWebAuthnの代わりになるか不明です。アカウントを再読み込みしてください。', '不确定身份提供商的 MFA 是否会代替 WebAuthn。请重新读取账户。');
    T('b_mfaMissing', 'Add biometrics and security keys to Access first (see the notice above).', '先にAccessへ生体認証とセキュリティキーを追加してください（上の案内）。', '请先在 Access 添加生物识别和安全密钥（见上面的说明）。');
    T('b_zone', 'Choose a domain.', 'ドメインを選んでください。', '请选择域名。');
    T('b_idp', 'Choose a login method.', 'ログイン方法を選んでください。', '请选择登录方式。');
    T('b_hostname', 'Fix the hostname first.', 'ホスト名を直してください。', '请先修正主机名。');
    T('b_email', 'Enter your email address first.', 'メールアドレスを入力してください。', '请先输入邮箱地址。');
    T('b_download', 'Allow the official cloudflared download to continue.', '先に、公式のcloudflaredの取得を許可してください。', '请先允许下载官方 cloudflared。');
    T('b_busy', 'Another operation is still running.', '別の処理が進行中です。', '另一个操作仍在进行。');
    T('b_stopping', 'Stopping. Wait until it finishes.', '停止処理中です。完了するまでお待ちください。', '正在停止，请等待完成。');
    // Configured view
    T('rowAuto', 'Publish automatically when DSH starts', 'DSH起動時に自動で公開', 'DSH 启动时自动公开');
    T('rowAutoDesc', 'Reconnects by itself whenever DSH starts. A paused connection stays paused.', 'DSHを起動したとき、自動で公開を再開します。一時停止中は再開しません。', 'DSH 启动时自动恢复公开。已暂停时不会恢复。');
    T('rowAutoVerify', 'Available after the external connection has been confirmed.', '外部からの通信を確認すると使えます。', '确认外部连接后即可使用。');
    T('rowAutoHost', 'Available after you confirm this computer.', 'このPCでの利用を確認すると使えます。', '确认这台电脑后即可使用。');
    T('rowAutoBusy', 'Wait for the running operation.', '実行中の処理が終わるまでお待ちください。', '请等待正在进行的操作完成。');
    T('rowVerified', 'External connection check', '外部からの通信を確認', '外部连接确认');
    T('verifiedYes', 'Confirmed {time} ({rel}). Real HTTP, API and WebSocket traffic from your sign-in was observed.', '最終確認: {time}（{rel}）。ログインした本人のHTTP・API・WebSocketの通信を観測しました。', '最后确认：{time}（{rel}）。已观察到你登录后的 HTTP、API 和 WebSocket 通信。');
    T('verifiedNo', 'Not confirmed yet. It is confirmed once you open the public URL and sign in.', 'まだ確認していません。公開URLを開いてログインすると確認されます。', '尚未确认。打开公开网址并登录后即会确认。');
    T('verifiedNoOffline', 'Not confirmed yet. Resume, then open the public URL and sign in.', 'まだ確認していません。再開してから、公開URLを開いてログインします。', '尚未确认。请先恢复，再打开公开网址并登录。');
    T('tagVerified', 'Confirmed', '確認済み', '已确认');
    T('tagUnverified', 'Not confirmed', '未確認', '未确认');
    T('modeNote', 'Changing this updates the Access application and reconnects.', '変更するとAccessアプリを更新し、接続し直します。', '更改后会更新 Access 应用并重新连接。');
    T('cardPublic', 'Public settings', '公開設定', '公开设置');
    T('lockedNote', 'The account, hostname, email and login method cannot be changed once Cloudflare resources exist. To change them, delete the public settings and set them up again.', 'アカウント・ホスト名・メール・ログイン方法は、Cloudflareに専用の資源を作った後は変更できません。変更するには、公開設定を削除して作り直します。', '一旦在 Cloudflare 创建了专用资源，就不能更改账户、主机名、邮箱和登录方式。要更改，请删除公开设置后重新设置。');
    T('hostTitle', 'Keep using this computer?', 'このPCで使い続けますか？', '继续在这台电脑上使用吗？');
    T('hostBody', 'This profile was opened with a different hostname or user than last time. If a copied profile runs on another computer too, two DSH processes attach to one Tunnel and traffic can arrive at either. Connecting and auto-connect stay off until you confirm.', 'この設定は、前回と違うホスト名またはユーザーで開かれました。コピーした設定を別のPCでも動かすと、同じTunnelに2台のDSHがつながり、通信がどちらに届くか分からなくなります。確認するまで、接続と自動接続は止めています。', '这个配置是用与上次不同的主机名或用户打开的。若复制的配置也在另一台电脑上运行，两个 DSH 会连到同一个 Tunnel，通信可能到达其中任意一个。确认之前，连接和自动连接都保持关闭。');
    T('hostCheck', 'Only this DSH profile on this computer uses this Tunnel.', 'このTunnelを使うDSHは、このPCのこのプロファイルだけです。', '使用这个 Tunnel 的 DSH 只有这台电脑上的这个配置。');
    T('hostConfirm', 'Keep using this computer', 'このPCで使い続ける', '继续使用这台电脑');
    T('pendTitle', 'The result of a Cloudflare write is unknown', 'Cloudflareへの書き込み結果が不明です', 'Cloudflare 写入结果未知');
    T('pendBody', 'The reply to a create request was lost, so it is unknown whether Cloudflare created the resource. Publishing is stopped, and the request is never resent automatically.', '作成の要求に対する応答が届かず、Cloudflareで作成されたか分かりません。公開を止めています。同じ要求は自動では再送しません。', '创建请求的响应丢失，不知道 Cloudflare 是否已创建该资源。公开已停止，也不会自动重发该请求。');
    T('pendInspect', 'Check the result', '結果を確認', '查看结果');
    T('pendInspectHint', 'Read-only. Nothing is changed.', '読み取り専用です。何も変更しません。', '只读，不会更改任何内容。');
    T('pendNeedToken', 'Checking needs the Cloudflare management token.', '結果の確認にはCloudflare管理用トークンが必要です。', '查看结果需要 Cloudflare 管理令牌。');
    T('pendEnterToken', 'Enter the token', 'トークンを入力する', '输入令牌');
    T('pendMatches', 'Matching resources', '見つかった資源', '找到的资源');
    T('pendRecorded', 'recorded', '記録済み', '已记录');
    T('pendUnrecorded', 'not recorded', '未記録', '未记录');
    T('pendGuide', 'Recovery guide', '復旧の手順', '恢复说明');
    T('pi_found', 'One matching resource was found. Check below whether this instance recorded it.', '一致する資源が1件見つかりました。このインスタンスが記録済みかどうかは、下の一覧で確認してください。', '找到 1 个匹配的资源。是否为这个实例已记录的，请看下面的列表。');
    T('pi_not-found', 'No matching resource was found. This does not prove that the write failed.', '一致する資源は見つかりませんでした。書き込みが失敗したとは限りません。', '没有找到匹配的资源。这并不能证明写入失败。');
    T('pi_ambiguous', 'The matches differ from what this instance recorded or there are several.', '一致した資源が複数ある、または記録したIDと異なります。', '匹配的资源有多个，或与这个实例记录的不同。');
    T('pm_clear-recorded', 'Clear the record', '記録を解除', '清除记录');
    T('pmd_clear-recorded', 'Every matching resource is one this instance already recorded. Only the unknown-write record is removed.', '見つかった資源はすべて、このインスタンスが記録済みのものです。結果不明の記録だけを消します。', '找到的资源都是这个实例已记录的。只会清除“结果未知”的记录。');
    T('pm_delete-unrecorded', 'Delete the unrecorded resource', '未記録の資源を削除', '删除未记录的资源');
    T('pmd_delete-unrecorded', 'Deletes only resources that carry this instance’s marker exactly and are not recorded, re-checking each one, then clears the record. Recorded resources are not touched.', 'このインスタンスのマーカーに完全一致し、記録されていない資源だけを1件ずつ確認して削除し、記録を消します。記録済みの資源には触れません。', '只删除与这个实例标记完全一致且未记录的资源（逐个重新确认），然后清除记录。已记录的资源不会被动。');
    T('pm_clear-not-found', 'Clear the record (nothing found)', '見つからないので記録を解除', '清除记录（未找到资源）');
    T('pmd_clear-not-found', 'No resource matched. If Cloudflare finishes the write after this check, a resource that is not recorded could remain. After clearing, look in the Cloudflare dashboard for resources named dsh-cf-….', '一致する資源はありませんでした。この確認の後でCloudflareが書き込みを完了すると、記録されない資源が残る可能性があります。解除した後、Cloudflareのダッシュボードでdsh-cf-…という名前の資源がないか確認してください。', '没有匹配的资源。如果 Cloudflare 在这次检查之后才完成写入，可能会留下未记录的资源。清除后，请在 Cloudflare 控制台查看是否有名为 dsh-cf-… 的资源。');
    T('pendDone', 'The record was cleared. You can resume now.', '記録を解除しました。「再開」で接続し直せます。', '记录已清除。现在可以恢复。');
    T('pendDeleted', 'Resources deleted: {count}.', '削除した資源: {count}件', '已删除的资源：{count} 个。');
    T('confirmPrompt', 'Type the hostname “{host}” to confirm', '確認のため、ホスト名「{host}」を入力してください', '为确认，请输入主机名“{host}”');
    T('confirmDo', 'Run', '実行する', '执行');
    T('detTitle', 'Details', '詳細', '详情');
    T('detEvidence', 'Observed traffic', '観測した通信', '已观察到的通信');
    T('ev_unauthenticatedRejected', 'Unauthenticated request rejected', '未ログインのアクセスを拒否', '拒绝未登录的访问');
    T('ev_owner', 'Your sign-in verified', '本人のログインを確認', '已确认你的登录');
    T('ev_http', 'Page loaded', '画面の読み込み', '页面加载');
    T('ev_api', 'API call', 'APIの呼び出し', 'API 调用');
    T('ev_websocket', 'WebSocket', 'WebSocket', 'WebSocket');
    T('detEvidenceNote', 'This list restarts with each connection. The “confirmed” state above is kept.', 'この一覧は接続のたびにやり直します。上の「確認済み」は保持されます。', '该列表在每次连接时重新开始。上面的“已确认”状态会保留。');
    T('detConnector', 'cloudflared', 'cloudflared', 'cloudflared');
    T('detConnectorState', 'Connector: {status}', 'コネクタ: {status}', '连接器：{status}');
    T('cn_connected', 'connected', '接続済み', '已连接');
    T('cn_starting', 'starting', '起動中', '启动中');
    T('cn_disconnected', 'disconnected', '切断中', '已断开');
    T('cn_error', 'stopped', '停止', '已停止');
    T('cn_stopped', 'not running', '動作していません', '未运行');
    T('detPort', 'Local gate port: {port}', 'ローカルのゲートのポート: {port}', '本地网关端口：{port}');
    T('detConfigCheck', 'Cloudflare configuration last checked: {time}', 'Cloudflare設定の最終確認: {time}', 'Cloudflare 配置最后检查：{time}');
    T('detNever', 'never', '未実施', '尚未进行');
    T('detLastError', 'Last error code: {code}', '直近のエラーコード: {code}', '最近的错误代码：{code}');
    T('detRefreshTitle', 'Fetch the connection token again', '接続トークンを取得し直す', '重新获取连接令牌');
    T('detRefreshBody', 'Fetches a new token for cloudflared from Cloudflare and reconnects with it. Use it only when the connection keeps failing with an authentication error. Needs the management token.', 'cloudflaredが使う接続用トークンをCloudflareから取り直し、それで再接続します。認証エラーで接続に失敗し続けるときだけ使います。管理用トークンが必要です。', '从 Cloudflare 重新获取 cloudflared 使用的连接令牌并用它重新连接。只在连接持续因认证错误失败时使用。需要管理令牌。');
    T('detRefresh', 'Fetch the token and reconnect', 'トークンを取得し直して再接続', '重新获取令牌并重新连接');
    T('detAgainTitle', 'Save the settings again and connect', '設定を保存し直して接続', '重新保存设置并连接');
    T('detAgainBody', 'Runs the full setup again with the same account, hostname and email, for example to choose another cloudflared. Needs the management token.', '同じアカウント・ホスト名・メールで設定をやり直します。別のcloudflaredを使うときなどに使います。管理用トークンが必要です。', '用相同的账户、主机名和邮箱重新执行完整设置，例如要换用另一个 cloudflared 时。需要管理令牌。');
    T('detAgain', 'Save and connect', '保存して接続', '保存并连接');
    T('detDocs', 'Troubleshooting guide', 'トラブル対処の手順', '故障排查说明');
    T('dzTitle', 'Delete the public settings', '公開設定の削除', '删除公开设置');
    T('dzBody', 'Deletes the dedicated DNS record, Tunnel and Access application made for this DSH. The shared additional-verification setting and an existing cloudflared stay. The public URL stops working.', 'このDSH用に作った専用のDNSレコード・Tunnel・Accessアプリを削除します。共有の追加認証の設定と、既存のcloudflaredは残ります。公開URLは使えなくなります。', '删除为这个 DSH 创建的专用 DNS 记录、Tunnel 和 Access 应用。共享的额外验证设置和已有的 cloudflared 会保留。公开网址将无法使用。');
    T('dzButton', 'Delete the public settings…', '公開設定を削除…', '删除公开设置…');
    T('delTitle', 'Delete the public settings?', '公開設定を削除しますか？', '删除公开设置？');
    T('delBody', 'Auto-publish is turned off first. Then the DNS record, Tunnel and Access application of this DSH are deleted from Cloudflare. This cannot be undone.', '先に自動公開をオフにし、このDSHのDNSレコード・Tunnel・Accessアプリを削除します。元に戻せません。', '会先关闭自动公开，然后删除这个 DSH 的 DNS 记录、Tunnel 和 Access 应用。此操作无法撤销。');
    T('delNeedToken', 'Deleting needs the Cloudflare management token.', '削除にはCloudflare管理用トークンが必要です。', '删除需要 Cloudflare 管理令牌。');
    T('delConfirm', 'Delete', '削除する', '删除');
    T('delDone', 'The public settings were deleted.', '公開設定を削除しました。', '公开设置已删除。');
    T('delDoneSub', 'The dedicated DNS record, Tunnel and Access application of {host} are gone. You can set it up again below.', '{host}の専用DNSレコード・Tunnel・Accessアプリを削除しました。下からもう一度設定できます。', '{host} 的专用 DNS 记录、Tunnel 和 Access 应用已删除。可以在下面重新设置。');
    T('hostLeft', 'DSH still lists {host} under its trusted hosts. DSH did not accept the automatic change, so remove it yourself in DSH’s settings.', 'DSHの信頼するホストに{host}が残っています。DSHが自動での変更を受け付けなかったため、DSHの設定から手動で外してください。', 'DSH 的受信任主机中仍保留着 {host}。DSH 没有接受自动更改，请在 DSH 的设置中手动移除。');
    T('modeOnTitle', 'Turn on additional verification', '追加認証をオンにする', '开启额外验证');
    T('modeOffTitle', 'Turn off additional verification', '追加認証をオフにする', '关闭额外验证');
    T('modeIntro', 'This updates the Access application in Cloudflare and rebuilds the connection. Before you confirm:', 'CloudflareのAccessアプリを更新し、接続を作り直します。確認する前に、次の点を確認してください。', '这会更新 Cloudflare 中的 Access 应用并重建连接。确认前请注意：');
    T('modeEff1', 'Auto-publish is turned off. You can turn it on again later.', '自動公開はオフになります。あとで、もう一度オンにできます。', '自动公开会被关闭，之后可以重新开启。');
    T('modeEff2', 'The external connection check starts over. Open the public URL and sign in again.', '外部からの通信の確認がやり直しになります。公開URLを開いて、ログインし直してください。', '外部连接确认将重新开始。请再次打开公开网址并登录。');
    T('modeEff3', 'It needs the Cloudflare management token.', 'Cloudflare管理用トークンが必要です。', '需要 Cloudflare 管理令牌。');
    T('modeOffNote', 'Without it, signing in with the allowed email is enough to open DSH.', 'オフにすると、許可したメールでのログインだけでDSHを開けます。', '关闭后，只要用允许的邮箱登录就能打开 DSH。');
    T('modeConfirm', 'Change and reconnect', '変更して接続し直す', '更改并重新连接');
    T('rmNote', 'This public page only shows the status. Change settings, pause or delete from the settings page opened on the computer that runs DSH.', 'この公開ページでは状態の確認だけができます。設定の変更・停止・削除は、DSHを動かしているPCで開いた設定画面から行います。', '这个公开页面只能查看状态。更改设置、暂停或删除，请在运行 DSH 的电脑上打开设置页面进行。');
    T('rmLast', 'External connection check', '外部からの通信を確認', '外部连接确认');
    T('rmNever', 'Not confirmed yet', 'まだ確認されていません', '尚未确认');
    T('unTitle', 'The Cloudflare plugin cannot start', 'Cloudflareプラグインを開始できません', 'Cloudflare 插件无法启动');
    // Guidance for every code the host can report. The host sends English text; these say what happened and the next safe step.
    T('i_authorize', 'The Cloudflare API token has not been entered or has expired. Enter it again in the token section.', 'Cloudflare APIトークンが未入力か、期限切れです。トークンの欄に入力し直してください。', 'Cloudflare API 令牌尚未输入或已过期。请在令牌栏重新输入。');
    T('i_apiToken', 'That is not an API token. Paste a token created in Cloudflare, not a Global API Key or a password.', 'APIトークンの形式ではありません。Cloudflareで作成したAPIトークンを貼り付けてください（Global API Keyやパスワードは使えません）。', '这不是 API 令牌。请粘贴在 Cloudflare 创建的令牌，不能使用 Global API Key 或密码。');
    T('i_superseded', 'A newer token entry replaced this request. Check the current state.', '新しいトークンの入力で、この要求は置き換えられました。現在の状態を確認してください。', '更新的令牌输入替换了这个请求。请确认当前状态。');
    T('i_cfDenied', 'Cloudflare refused the token. Check that it has the required permissions and covers this account and domain.', 'Cloudflareがトークンを受け付けませんでした。必要な権限があり、このアカウントとドメインを対象にしているか確認してください。', 'Cloudflare 拒绝了该令牌。请确认它具有所需权限，并覆盖这个账户和域名。');
    T('i_cfMissing', 'Cloudflare could not find the resource. Check the selected account and domain, and that the token covers them.', 'Cloudflareで対象が見つかりませんでした。選んだアカウント・ドメインと、トークンの対象範囲を確認してください。', 'Cloudflare 找不到对应的资源。请检查所选的账户和域名，以及令牌的范围。');
    T('i_cfRate', 'Cloudflare is limiting requests from this token. Wait a minute, then try again.', 'このトークンからの要求がCloudflareに制限されています。1分ほど待ってから、もう一度試してください。', 'Cloudflare 正在限制这个令牌的请求。请等待一分钟后重试。');
    T('i_cfServer', 'Cloudflare reported a temporary problem. Try again in a few minutes.', 'Cloudflare側で一時的な問題が起きています。数分待ってから、もう一度試してください。', 'Cloudflare 报告了临时故障。请几分钟后重试。');
    T('i_cfNetwork', 'This PC could not reach Cloudflare. If a create request was in flight, its result may be unknown, and it is not resent automatically. Check the connection and the status here before trying again.', 'このPCからCloudflareに接続できませんでした。作成の要求中だった場合は結果が不明になることがあり、自動では再送しません。接続とこの画面の状態を確認してから、もう一度試してください。', '这台电脑无法连接 Cloudflare。如果当时正在发送创建请求，结果可能未知，且不会自动重发。请先检查网络和此处的状态，再重试。');
    T('i_cfOther', 'Cloudflare returned an unexpected answer. Nothing more was changed. Try again, and check the token permissions if it repeats.', 'Cloudflareから想定外の応答がありました。これ以上の変更はしていません。もう一度試し、繰り返す場合はトークンの権限を確認してください。', 'Cloudflare 返回了意外的响应。没有再做其他更改。请重试，若反复出现，请检查令牌权限。');
    T('i_noZeroTrust', 'This account has no Cloudflare One (Zero Trust) organization yet. Open Zero Trust in the Cloudflare dashboard, finish the first-time setup (it asks for a team name), then reload the account.', 'このアカウントには、Cloudflare One（Zero Trust）の組織がまだありません。CloudflareのダッシュボードでZero Trustを開き、初期設定（チーム名の入力）を終えてから、アカウントを再読み込みしてください。', '这个账户还没有 Cloudflare One（Zero Trust）组织。请在 Cloudflare 控制台打开 Zero Trust，完成首次设置（需要填写团队名称），然后重新读取账户。');
    T('i_noIdp', 'This account has no Access login method. In Zero Trust open Settings > Authentication, add one (for example One-time PIN), then reload the account.', 'このアカウントには、Accessのログイン方法がありません。Zero Trustの設定 > 認証でログイン方法（例: ワンタイムPIN）を追加してから、アカウントを再読み込みしてください。', '这个账户没有 Access 登录方式。请在 Zero Trust 的“设置 > 身份验证”中添加一种（例如一次性 PIN），然后重新读取账户。');
    T('i_mfaRequired', 'Biometrics and security keys are not yet allowed in Access. Add them with the notice in the additional-verification section, then connect.', 'Accessで生体認証とセキュリティキーがまだ許可されていません。追加認証の案内から追加してから、接続してください。', 'Access 尚未允许生物识别和安全密钥。请通过额外验证部分的提示添加后再连接。');
    T('i_mfaSubstitute', 'This organization lets identity-provider MFA replace the separate WebAuthn prompt, so the additional check could be skipped. Turn off “Use identity provider MFA” in the Zero Trust Access settings and reload. This plugin does not change that setting.', 'この組織では、IdPのMFAが独立したWebAuthnの確認の代わりになり、追加認証が省かれるおそれがあります。Zero Trust Accessの設定で「アイデンティティプロバイダーのMFAを使用」をオフにしてから、再読み込みしてください。この設定はプラグインでは変更しません。', '这个组织允许身份提供商的 MFA 代替独立的 WebAuthn 验证，额外验证可能被跳过。请在 Zero Trust Access 设置中关闭“使用身份提供商 MFA”，然后重新读取。插件不会修改这项设置。');
    T('i_mfaUnknown', 'Cloudflare’s answer did not show whether identity-provider MFA can replace WebAuthn. Publishing stays off. Reload the account; nothing was changed.', 'IdPのMFAがWebAuthnの代わりになるかを、Cloudflareの応答から判断できませんでした。公開はしません。アカウントを再読み込みしてください。何も変更していません。', '无法从 Cloudflare 的响应判断身份提供商的 MFA 是否会代替 WebAuthn。不会公开。请重新读取账户；没有做任何更改。');
    T('i_mfaChanged', 'The Access application’s verification mode no longer matches this plugin’s setting. Nothing was overwritten. Review the application in Cloudflare Zero Trust, or delete the public settings and set them up again.', 'Accessアプリの認証方式が、このプラグインの設定と一致しなくなりました。上書きはしていません。Cloudflare Zero Trustでアプリを確認するか、公開設定を削除して作り直してください。', 'Access 应用的验证方式与这个插件的设置不再一致。没有覆盖任何内容。请在 Cloudflare Zero Trust 检查该应用，或删除公开设置后重新设置。');
    T('i_orgChanged', 'The shared Access settings changed while you were reviewing them. Reload the account and review the change again.', '確認している間に、共有のAccess設定が変わりました。アカウントを再読み込みして、変更内容をもう一度確認してください。', '在你查看期间，共享的 Access 设置发生了变化。请重新读取账户并再次确认更改。');
    T('i_zone', 'Choose an active domain of this account and a hostname inside it.', 'このアカウントの有効なドメインと、その中のホスト名を選んでください。', '请选择这个账户中可用的域名，以及其下的主机名。');
    T('i_hostname', 'Enter a hostname with a dot, without a URL, port or path.', 'URL・ポート・パスを含まない、ドットのあるホスト名を入力してください。', '请输入带点的主机名，不要包含网址、端口或路径。');
    T('i_hostnameDepth', 'Use exactly one label in front of the domain, such as dsh.example.com. Deeper names are not covered by Cloudflare’s free certificate.', 'ドメインの直下1階層にしてください（例: dsh.example.com）。2階層以上はCloudflareの無料証明書の対象外です。', '请只在域名前加一级，例如 dsh.example.com。更深的名称不在 Cloudflare 免费证书范围内。');
    T('i_owner', 'Enter exactly one email address for the person who may sign in.', 'ログインを許可する本人のメールアドレスを、1つだけ入力してください。', '请输入唯一一个允许登录的邮箱地址。');
    T('i_idp', 'Choose one login method that belongs to this account.', 'このアカウントにあるログイン方法を1つ選んでください。', '请选择这个账户中的一种登录方式。');
    T('i_setup', 'The setup did not finish. Enter the Cloudflare API token and save the connection again from the details section.', '設定が完了していません。Cloudflare APIトークンを入力し、詳細から設定を保存し直して接続してください。', '设置尚未完成。请输入 Cloudflare API 令牌，并在“详情”中重新保存并连接。');
    T('i_setupChanged', 'The account, hostname, email and login method cannot be changed once Cloudflare resources exist. Delete the public settings and set them up again.', 'Cloudflareに専用の資源を作った後は、アカウント・ホスト名・メール・ログイン方法を変更できません。公開設定を削除して作り直してください。', '创建 Cloudflare 专用资源后，不能更改账户、主机名、邮箱和登录方式。请删除公开设置后重新设置。');
    T('i_consent', 'Confirm the change explicitly before continuing.', '続けるには、変更内容を確認して明示的に承認してください。', '继续之前，请明确确认这项更改。');
    T('i_confirmHostname', 'The hostname you typed does not match. Type this instance’s hostname exactly.', '入力したホスト名が一致しません。このインスタンスのホスト名を、そのまま入力してください。', '输入的主机名不一致。请原样输入这个实例的主机名。');
    T('i_accessChanged', 'The Access application in Cloudflare no longer matches this instance. Nothing was overwritten. Review it in Cloudflare Zero Trust before reconnecting.', 'Cloudflare上のAccessアプリが、このインスタンスの設定と一致しなくなりました。上書きはしていません。Cloudflare Zero Trustで確認してから、接続し直してください。', 'Cloudflare 中的 Access 应用与这个实例不再一致。没有覆盖任何内容。请先在 Cloudflare Zero Trust 检查，再重新连接。');
    T('i_accessConflict', 'Another Access application already covers this hostname. Choose a different hostname.', '別のAccessアプリが、このホスト名をすでに対象にしています。別のホスト名を選んでください。', '另一个 Access 应用已经覆盖了这个主机名。请选择其他主机名。');
    T('i_dnsChanged', 'The DNS record of this hostname no longer matches this instance. Nothing was overwritten. Review it in Cloudflare DNS before reconnecting.', 'このホスト名のDNSレコードが、このインスタンスの設定と一致しなくなりました。上書きはしていません。CloudflareのDNSで確認してから、接続し直してください。', '这个主机名的 DNS 记录与这个实例不再一致。没有覆盖任何内容。请先在 Cloudflare DNS 检查，再重新连接。');
    T('i_dnsConflict', 'This hostname already has a DNS record that this plugin did not create. Nothing was changed. Choose another hostname or remove that record yourself.', 'このホスト名には、このプラグインが作っていないDNSレコードがすでにあります。何も変更していません。別のホスト名を選ぶか、そのレコードを自分で削除してください。', '这个主机名已有不是由本插件创建的 DNS 记录。没有做任何更改。请换一个主机名，或自行删除该记录。');
    T('i_tunnelChanged', 'The Tunnel in Cloudflare no longer matches this instance. Nothing was overwritten. Review it in Cloudflare Zero Trust before reconnecting.', 'Cloudflare上のTunnelが、このインスタンスの設定と一致しなくなりました。上書きはしていません。Cloudflare Zero Trustで確認してから、接続し直してください。', 'Cloudflare 中的 Tunnel 与这个实例不再一致。没有覆盖任何内容。请先在 Cloudflare Zero Trust 检查，再重新连接。');
    T('i_policyChanged', 'The Access policy is no longer the expected owner-only policy. Nothing was overwritten. Review it in Cloudflare Zero Trust before reconnecting.', 'Accessポリシーが、想定している本人専用のポリシーではなくなりました。上書きはしていません。Cloudflare Zero Trustで確認してから、接続し直してください。', 'Access 策略不再是预期的“仅限本人”策略。没有覆盖任何内容。请先在 Cloudflare Zero Trust 检查，再重新连接。');
    T('i_idpChanged', 'The login-method restriction of the Access application changed. Nothing was overwritten. Review it in Cloudflare Zero Trust before reconnecting.', 'Accessアプリのログイン方法の制限が変わりました。上書きはしていません。Cloudflare Zero Trustで確認してから、接続し直してください。', 'Access 应用的登录方式限制发生了变化。没有覆盖任何内容。请先在 Cloudflare Zero Trust 检查，再重新连接。');
    T('i_sessionChanged', 'Cloudflare did not apply the one-week session length. Nothing else was changed. Review the session setting of the Access application.', 'Cloudflareが1週間のセッション期間を反映しませんでした。ほかは変更していません。Accessアプリのセッション設定を確認してください。', 'Cloudflare 没有应用一周的会话时长。没有做其他更改。请检查 Access 应用的会话设置。');
    T('i_writeUnknown', 'The result of a Cloudflare write is unknown, so publishing is stopped. Check the result in the recovery section before doing anything else.', 'Cloudflareへの書き込み結果が不明なため、公開を止めています。ほかの操作の前に、復旧の欄で結果を確認してください。', 'Cloudflare 写入结果未知，因此已停止公开。请先在恢复部分查看结果，再做其他操作。');
    T('i_writeMismatch', 'What Cloudflare holds does not match the chosen recovery action. Nothing was deleted or cleared. Check the result again.', 'Cloudflareにある資源が、選んだ復旧操作と合いません。削除も解除もしていません。結果をもう一度確認してください。', 'Cloudflare 中的资源与所选的恢复操作不符。没有删除或清除任何内容。请重新查看结果。');
    T('i_hostReview', 'This profile was last used on a different computer or user. Confirm below that no other DSH uses its Tunnel.', 'このプロファイルは、前回と違うPCまたはユーザーで使われました。このTunnelを使うDSHが他にないことを、下で確認してください。', '这个配置上次是在不同的电脑或用户下使用的。请在下方确认没有其他 DSH 使用它的 Tunnel。');
    T('i_verifyFirst', 'Auto-publish can be turned on only after the external connection check has succeeded.', '自動公開は、外部からの通信の確認が済んでからオンにできます。', '外部连接确认成功后，才能开启自动公开。');
    T('i_lock', 'Another DSH is using this profile, or this one lost it. Publishing is stopped. Restart this DSH.', '別のDSHがこのプロファイルを使っているか、このDSHが使用権を失いました。公開は止まっています。このDSHを再起動してください。', '另一个 DSH 正在使用这个配置，或这个 DSH 失去了使用权。公开已停止。请重新启动这个 DSH。');
    T('i_lockStart', 'This computer could not read a process start time, so the previous cloudflared was left running and another was not started. Publishing stays stopped. Restart this DSH once start times can be read.', 'プロセスの開始時刻を読めなかったため、以前のcloudflaredは止めず、新しいcloudflaredも起動していません。公開は止まったままです。開始時刻を読めるようにしてから、このDSHを再起動してください。', '无法读取进程的开始时间，因此没有停止以前的 cloudflared，也没有启动新的 cloudflared。公开保持停止。请在可以读取开始时间后重新启动这个 DSH。');
    T('i_lockStuck', 'The previous cloudflared was still listed two seconds after it was stopped, so another was not started. Publishing stays stopped. Restart this DSH once that process is gone.', '以前のcloudflaredを止めたあと2秒経ってもプロセスが残っていたため、新しいcloudflaredは起動していません。公開は止まったままです。そのプロセスが居なくなってから、このDSHを再起動してください。', '停止以前的 cloudflared 两秒后该进程仍在，因此没有启动新的 cloudflared。公开保持停止。请在该进程消失后重新启动这个 DSH。');
    T('i_lockSignaled', 'A stop signal was sent to the previous cloudflared, but this computer could not confirm that it had exited, so another was not started. Publishing stays stopped. Restart this DSH once that process is gone.', '以前のcloudflaredへ停止シグナルを送りましたが、終了したことを確認できませんでした。新しいcloudflaredは起動していません。公開は止まったままです。そのプロセスが居なくなってから、このDSHを再起動してください。', '已向以前的 cloudflared 发送停止信号，但无法确认它已经退出，因此没有启动新的 cloudflared。公开保持停止。请在该进程消失后重新启动这个 DSH。');
    T('i_stateCorrupt', 'The saved plugin state could not be read, so nothing was changed. Keep a copy of .dsh-cf/state.json in the profile folder, fix it or move it aside, then reload DSH.', '保存されたプラグインの状態を読めなかったため、何も変更していません。プロファイルの.dsh-cf/state.jsonを控えてから、直すか別の場所へ移し、DSHを読み込み直してください。', '无法读取已保存的插件状态，因此没有做任何更改。请先备份配置文件夹中的 .dsh-cf/state.json，修复或移开后重新加载 DSH。');
    T('i_statePath', 'The plugin’s state folder is not a private, regular folder. Fix .dsh-cf in the profile folder, then reload DSH.', 'プラグインの状態の保存先が、通常の非公開フォルダーではありません。プロファイルの.dsh-cfを直してから、DSHを読み込み直してください。', '插件的状态文件夹不是普通的私有文件夹。请修复配置文件夹中的 .dsh-cf，然后重新加载 DSH。');
    T('i_stateWrite', 'The verification result could not be saved, so publishing was stopped. Check the file permissions of the profile folder, then resume.', '確認結果を保存できなかったため、公開を止めました。プロファイルのフォルダーの権限を確認してから、再開してください。', '无法保存确认结果，因此已停止公开。请检查配置文件夹的权限，然后恢复。');
    T('i_binary', 'cloudflared cannot be used: it is missing, not executable, or not a supported version. Give the absolute path of a current cloudflared under Details, or allow the official download.', 'cloudflaredを使えません。見つからない、実行できない、または対応していない版です。「詳細」で新しいcloudflaredの絶対パスを指定するか、公式版の取得を許可してください。', '无法使用 cloudflared：找不到、无法执行，或版本不受支持。请在“详情”中指定较新的 cloudflared 的绝对路径，或允许下载官方版本。');
    T('i_download', 'cloudflared was not found on this PC. Allow the official download below, or give the path of an installed cloudflared.', 'このPCにcloudflaredが見つかりませんでした。下で公式版の取得を許可するか、インストール済みのcloudflaredのパスを指定してください。', '在这台电脑上没有找到 cloudflared。请在下方允许下载官方版本，或指定已安装的 cloudflared 的路径。');
    T('i_downloadFailed', 'The official cloudflared download failed or did not pass the checksum check. Nothing unverified was run. Check the connection and try again.', '公式のcloudflaredの取得に失敗したか、チェックサムが一致しませんでした。検証できていないものは実行していません。接続を確認して、もう一度試してください。', '官方 cloudflared 下载失败，或校验和不一致。没有运行任何未经验证的文件。请检查网络后重试。');
    T('i_platform', 'Automatic download is not available for this OS or CPU. Install cloudflared yourself and give its path under Advanced settings.', 'このOS・CPUでは自動取得に対応していません。cloudflaredを自分でインストールし、詳細設定でそのパスを指定してください。', '这个操作系统或 CPU 不支持自动下载。请自行安装 cloudflared，并在高级设置中指定其路径。');
    T('i_connectorExit', 'cloudflared stopped or could not start. The plugin reconnects by itself unless you paused it. If this repeats, check the cloudflared executable.', 'cloudflaredが停止した、または起動できませんでした。一時停止していなければ、自動で再接続します。繰り返す場合は、cloudflaredの実行ファイルを確認してください。', 'cloudflared 已停止或无法启动。除非你已暂停，插件会自动重新连接。若反复出现，请检查 cloudflared 可执行文件。');
    T('i_connectorTimeout', 'cloudflared could not connect to Cloudflare in time. Check this PC’s outgoing connection. The plugin keeps trying.', 'cloudflaredが時間内にCloudflareへ接続できませんでした。このPCの外向きの通信を確認してください。自動で再試行を続けます。', 'cloudflared 未能在限定时间内连接到 Cloudflare。请检查这台电脑的对外网络。插件会继续重试。');
    T('i_tunnelDisconnected', 'cloudflared lost its connection to Cloudflare and is reconnecting by itself. Nothing needs to be done unless this stays.', 'cloudflaredがCloudflareとの接続を失い、自動で再接続しています。長く続かなければ、操作は不要です。', 'cloudflared 与 Cloudflare 的连接中断，正在自动重连。若不是长时间持续，无需操作。');
    T('i_edgeCheck', 'This PC could not check the public URL from outside yet (DNS or Access not reachable). The plugin keeps trying. If this stays, check the DNS record and the Access application.', 'このPCから公開URLを外側として確認できませんでした（DNSまたはAccessに届いていません）。自動で再試行を続けます。長く続く場合は、DNSレコードとAccessアプリを確認してください。', '这台电脑暂时无法从外部确认公开网址（DNS 或 Access 不可达）。插件会继续重试。若持续出现，请检查 DNS 记录和 Access 应用。');
    T('i_unprotected', 'The public URL answered a request without sign-in with success instead of the Access login. Publishing was stopped for safety and is not retried. Review the Access application in Cloudflare.', '公開URLが、ログインなしの要求にAccessのログインではなく成功を返しました。安全のため公開を止め、自動では再試行しません。CloudflareでAccessアプリを確認してください。', '公开网址对未登录的请求返回了成功，而不是 Access 登录页。为安全起见已停止公开，也不会自动重试。请在 Cloudflare 检查 Access 应用。');
    T('i_gatePort', 'The local port that the Tunnel forwards to is used by another program. Free the port, or enter the API token and save the connection again to move to a new port.', 'Tunnelの転送先のローカルポートを、別のプログラムが使っています。ポートを空けるか、APIトークンを入力して設定を保存し直し、新しいポートへ移してください。', 'Tunnel 转发到的本地端口被其他程序占用。请释放该端口，或输入 API 令牌并重新保存连接，以换用新端口。');
    T('i_dshReach', 'This plugin cannot reach DSH’s own web server right now. Check that DSH is running. The plugin keeps trying.', 'このプラグインが、DSH本体のWebサーバーに今は接続できません。DSHが動いているか確認してください。自動で再試行を続けます。', '插件目前无法连接 DSH 自己的 Web 服务器。请确认 DSH 正在运行。插件会继续重试。');
    T('i_dshUnsupported', 'This DSH is not set up for remote access: its web server must listen on the loopback address over http or https. Change how DSH is started, then resume.', 'このDSHは外部公開に対応していません。Webサーバーをloopbackアドレスで、httpまたはhttpsで待ち受けさせる必要があります。DSHの起動方法を直してから、再開してください。', '这个 DSH 不支持远程访问：它的 Web 服务器必须在回环地址上以 http 或 https 监听。请调整 DSH 的启动方式后再恢复。');
    T('i_dshConfig', 'DSH could not save or activate the public hostname as a trusted host. If a profile override or --patch controls the Connection settings, add this hostname with --trusted-host or in that patch, then try again.', 'DSHが公開ホスト名を信頼するホストとして保存・反映できませんでした。プロファイルの上書きや--patchがConnectionの設定を管理している場合は、--trusted-hostまたはそのpatchにこのホスト名を追加して、もう一度試してください。', 'DSH 无法把公开主机名保存或启用为受信任主机。若配置覆盖或 --patch 控制着 Connection 设置，请用 --trusted-host 或在该 patch 中加入这个主机名，然后重试。');
    T('i_dshTrust', 'DSH did not start accepting the public hostname. Restart DSH, then resume.', 'DSHが公開ホスト名を受け付けるようになりませんでした。DSHを再起動してから、再開してください。', 'DSH 没有开始接受公开主机名。请重启 DSH 后再恢复。');
    T('i_dshAuth', 'DSH did not accept the session the plugin presented. The plugin asks for a fresh one on the next request, so reloading the page is usually enough. The connection stays up.', 'プラグインが渡したセッションをDSHが受け付けませんでした。次の要求で新しいセッションを取り直すので、通常はページの再読み込みで足ります。接続は維持されています。', 'DSH 没有接受插件提供的会话。插件会在下次请求时获取新会话，通常刷新页面即可。连接保持不变。');
    T('i_dshUpstream', 'DSH did not answer through the tunnel. The connection stays up, and this notice clears after the next successful request.', 'Tunnel経由でDSHが応答しませんでした。接続は維持されており、次に成功した要求でこの表示は消えます。', 'DSH 没有通过 Tunnel 响应。连接保持不变，下一次请求成功后此提示会消失。');
    T('i_accessKeys', 'This PC could not reach Cloudflare to check sign-ins, so requests are refused for now. This notice clears after the next successful request.', 'このPCがログインの確認のためにCloudflareへ接続できないため、今は要求を拒否しています。次に成功した要求でこの表示は消えます。', '这台电脑无法连接 Cloudflare 来确认登录，因此暂时拒绝请求。下一次请求成功后此提示会消失。');
    T('i_audience', 'The identity of the Access application could not be read. Review the Access application in Cloudflare, then resume.', 'Accessアプリの識別情報を読み取れませんでした。CloudflareでAccessアプリを確認してから、再開してください。', '无法读取 Access 应用的标识信息。请在 Cloudflare 检查该应用，然后恢复。');
    T('i_busy', 'Another operation is still running. Wait for it to finish, or cancel it.', '別の処理が進行中です。終わるまで待つか、キャンセルしてください。', '另一个操作仍在进行。请等待其完成，或将其取消。');
    T('i_stopped', 'The plugin is stopping. Reload DSH.', 'プラグインを停止しています。DSHを読み込み直してください。', '插件正在停止。请重新加载 DSH。');
    T('i_stale', 'DSH restarted while this page was open. The status was refreshed. Repeat the action.', 'このページを開いている間にDSHが再起動しました。状態を更新したので、操作をやり直してください。', '页面打开期间 DSH 重新启动了。状态已刷新，请重新执行操作。');
    T('i_management', 'Settings can only be changed from the computer that runs DSH, through its localhost address.', '設定の変更は、DSHを動かしているPCのlocalhostアドレスから開いた画面でのみ行えます。', '只能在运行 DSH 的电脑上通过 localhost 地址打开的页面更改设置。');
    T('i_payload', 'This page and the plugin do not match. Reload the page, and update the plugin if it repeats.', 'このページとプラグインの版が合っていません。ページを再読み込みし、繰り返す場合はプラグインを更新してください。', '这个页面与插件不匹配。请刷新页面，若反复出现请更新插件。');
    T('i_internal', 'The operation failed. Check the connection and file permissions, then try again. No authentication was bypassed or turned off.', '処理に失敗しました。接続とファイルの権限を確認して、もう一度試してください。認証を回避したり無効にしたりはしていません。', '操作失败。请检查网络和文件权限后重试。没有绕过或关闭任何认证。');
    T('i_cancelled', 'The operation was cancelled or timed out. Check the current state before trying again.', '処理が取り消されたか、時間切れになりました。現在の状態を確認してから、もう一度試してください。', '操作已取消或超时。请先确认当前状态，再重试。');
    T('i_generic', 'The operation could not be completed. Check the connection to DSH and try again.', '処理を完了できませんでした。DSHへの接続を確認して、もう一度試してください。', '无法完成操作。请检查与 DSH 的连接后重试。');
    T('actRetryNow', 'Retry now', '今すぐ再試行', '立即重试');
    T('actReview', 'Review', '確認する', '去确认');
    T('actToPending', 'Go to recovery', '復旧の欄へ', '前往恢复部分');
    T('actDetails', 'Open details', '詳細を開く', '打开详情');

    const fill = (text, params) => (params ? String(text).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text);
    function translate(locale, key, params) {
      const dict = COPY[locale] || COPY.en;
      return fill(dict[key] ?? COPY.en[key] ?? key, params);
    }
    // Sequence numbers are scoped to one Host lifetime. Retired lifetimes cannot repaint a newer one.
    class SnapshotCursor {
      constructor() { this.generation = null; this.sequence = -1; this.retired = new Set(); }
      accept(value) {
        if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) return null;
        const generation = typeof value.generation === 'string' ? value.generation : null;
        if (generation && this.retired.has(generation) || !generation && this.generation) return null;
        const replaced = this.generation !== null && generation !== this.generation;
        if (generation !== this.generation) {
          if (this.generation) this.retired.add(this.generation);
          this.generation = generation; this.sequence = -1;
        }
        if (value.sequence < this.sequence) return null;
        this.sequence = value.sequence;
        return replaced ? 'replaced' : 'accepted';
      }
    }

    // ---- Issue codes -> guidance. The host sends stable codes; the wording is localized here. ----
    const GUIDE = {
      AUTHORIZE: 'authorize', API_TOKEN: 'apiToken', AUTH_SUPERSEDED: 'superseded',
      CF_NETWORK: 'cfNetwork', CF_LIST: 'cfOther', CF_CREATE: 'cfOther', RESPONSE: 'cfOther', RESPONSE_SIZE: 'cfOther', TOKEN: 'cfOther',
      NO_ZERO_TRUST: 'noZeroTrust', NO_IDP: 'noIdp',
      MFA_REQUIRED: 'mfaRequired', MFA_IDP_SUBSTITUTE: 'mfaSubstitute', MFA_UNKNOWN: 'mfaUnknown', MFA_CHANGED: 'mfaChanged', ORG_CHANGED: 'orgChanged',
      ZONE: 'zone', HOSTNAME: 'hostname', HOSTNAME_DEPTH: 'hostnameDepth', OWNER: 'owner', IDP: 'idp',
      SETUP: 'setup', SETUP_CHANGED: 'setupChanged', CONSENT: 'consent', CONFIRM_HOSTNAME: 'confirmHostname', CONFIRM_DELETE: 'confirmHostname',
      ACCESS_CHANGED: 'accessChanged', ACCESS_CONFLICT: 'accessConflict', DNS_CHANGED: 'dnsChanged', DNS_CONFLICT: 'dnsConflict', TUNNEL_CHANGED: 'tunnelChanged',
      POLICY_CHANGED: 'policyChanged', IDP_CHANGED: 'idpChanged', SESSION_CHANGED: 'sessionChanged', AUDIENCE: 'audience', ISSUER: 'audience',
      WRITE_UNKNOWN: 'writeUnknown', WRITE_MISMATCH: 'writeMismatch', HOST_REVIEW: 'hostReview', VERIFY_FIRST: 'verifyFirst',
      LOCK: 'lock', STATE_CORRUPT: 'stateCorrupt', STATE_PATH: 'statePath', STATE_WRITE: 'stateWrite',
      BINARY_PATH: 'binary', BINARY_OLD: 'binary', BINARY_EXEC: 'binary', BINARY_VERSION: 'binary', BINARY_INTEGRITY: 'binary', BINARY_PERMISSIONS: 'binary',
      DOWNLOAD_APPROVAL: 'download', DOWNLOAD: 'downloadFailed', DOWNLOAD_METADATA: 'downloadFailed', DOWNLOAD_URL: 'downloadFailed', DOWNLOAD_INTEGRITY: 'downloadFailed', ARCHIVE: 'downloadFailed', PLATFORM: 'platform',
      CONNECTOR_EXIT: 'connectorExit', CONNECTOR_RUNNING: 'connectorExit', CONNECTOR_TIMEOUT: 'connectorTimeout', TUNNEL_DISCONNECTED: 'tunnelDisconnected',
      EDGE_CHECK: 'edgeCheck', UNPROTECTED: 'unprotected', GATE_PORT_BUSY: 'gatePort',
      DSH_PORT: 'dshReach', DSH_CONNECTION: 'dshReach', DSH_TIMEOUT: 'dshReach', DSH_API: 'dshUnsupported', DSH_BIND: 'dshUnsupported', DSH_TLS: 'dshUnsupported',
      DSH_CONFIG: 'dshConfig', DSH_TRUST: 'dshTrust', DSH_AUTH: 'dshAuth', DSH_UPSTREAM: 'dshUpstream', ACCESS_KEYS: 'accessKeys',
      BUSY: 'busy', STOPPED: 'stopped', STALE_HOST: 'stale', MANAGEMENT: 'management', PAYLOAD: 'payload', ENDPOINT: 'payload',
      INTERNAL: 'internal', API_PATH: 'internal', MFA_MODE: 'internal', AbortError: 'cancelled', TimeoutError: 'cancelled',
    };
    function guideKey(code) {
      if (typeof code !== 'string') return null;
      if (Object.prototype.hasOwnProperty.call(GUIDE, code)) return GUIDE[code];
      if (/^CF_40[13]$/.test(code)) return 'cfDenied';
      if (code === 'CF_404') return 'cfMissing';
      if (code === 'CF_429') return 'cfRate';
      if (/^CF_5\d\d$/.test(code)) return 'cfServer';
      if (/^CF_\d{3}$/.test(code)) return 'cfOther';
      return null;
    }
    const SAFE_CODE = /^(?:[A-Z][A-Z0-9_]{0,50}|AbortError|TimeoutError)$/;
    /** Localized guidance for an issue or a failed call. Unknown codes fall back to the host's own English sentence. */
    function issueText(t, issue) {
      if (issue?.reason === 'start-time') return t('i_lockStart');
      if (issue?.reason === 'stuck') return t('i_lockStuck');
      if (issue?.reason === 'unverified-after-signal') return t('i_lockSignaled');
      const key = guideKey(issue?.code);
      if (key) return t('i_' + key);
      const message = issue?.message;
      return typeof message === 'string' && message.length > 0 && message.length <= 400 ? message : t('i_generic');
    }
    /** A failed settings call: guidance for the user, and the code kept apart for the details section. */
    function describeError(t, error) {
      const code = typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? error.code : '';
      const text = code === 'DOWNLOAD_APPROVAL' ? t('i_download') : issueText(t, code ? { code, message: error.hostMessage } : null);
      return { text, code };
    }
    const WARN_CODES = new Set(['ACCESS_KEYS', 'DSH_AUTH', 'DSH_UPSTREAM']);
    function issueTone(issue, status) {
      if (issue?.code === 'TUNNEL_DISCONNECTED') return 'info';
      if (WARN_CODES.has(issue?.code) || status === 'reconnecting') return 'warn';
      return 'error';
    }
    /** The one button an issue offers. The host names the next safe step; the client decides what is possible here. */
    function issueAction(issue, authorized) {
      switch (issue?.action) {
        case 'authorize': return authorized ? null : 'token';
        case 'confirm-host': return 'host';
        case 'resolve-write': return 'pending';
        case 'resume': return 'resume';
        case 'start': return authorized ? 'again' : 'token';
        case 'approve-download': case 'select-binary': return 'again';
        default: return null;
      }
    }

    function hostnameOk(value) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 253 || value !== value.trim()) return false;
      const host = value.toLowerCase();
      return host.includes('.') && host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) && !/^\d+(?:\.\d+){3}$/.test(host);
    }
    /** '' when the hostname is usable for the chosen domain; otherwise the first rule it breaks. */
    function hostnameIssue(value, zoneName) {
      if (!hostnameOk(value)) return 'format';
      const host = value.toLowerCase();
      if (zoneName) {
        if (host === zoneName) return 'apex';
        if (!host.endsWith('.' + zoneName)) return 'zone';
        if (host.slice(0, -(zoneName.length + 1)).includes('.')) return 'depth';
      }
      return '';
    }
    function emailOk(value) {
      return typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
    }
    /** The first reason the connect button cannot run, or null. */
    function connectBlockers(input) {
      if (input.stopping) return 'stopping';
      if (input.hostReview) return 'host';
      if (input.pendingWrite) return 'unknown-write';
      if (!input.authorized) return 'authorize';
      if (!input.accountId || !input.accountReady) return 'account';
      if (input.requireWebAuthn !== false && input.mfa === 'substitute') return 'mfa-substitute';
      if (input.requireWebAuthn !== false && input.mfa === 'unknown') return 'mfa-unknown';
      if (input.requireWebAuthn !== false && input.mfaMissing?.length) return 'mfa-missing';
      if (!input.zoneId) return 'zone';
      if (!input.idpId) return 'idp';
      if (hostnameIssue(input.hostname, input.zoneName)) return 'hostname';
      if (!emailOk(input.ownerEmail)) return 'email';
      if (input.needApproval && !input.allowDownload && !input.cloudflaredPath) return 'download';
      if (input.pending || input.busy) return 'busy';
      return null;
    }
    const BLOCKER_KEY = {
      stopping: 'b_stopping', host: 'b_host', 'unknown-write': 'b_unknownWrite', authorize: 'b_authorize', account: 'b_account',
      'mfa-substitute': 'b_mfaSubstitute', 'mfa-unknown': 'b_mfaUnknown', 'mfa-missing': 'b_mfaMissing',
      zone: 'b_zone', idp: 'b_idp', hostname: 'b_hostname', email: 'b_email', download: 'b_download', busy: 'b_busy',
    };
    /** Which recovery action the inspection allows. Exactly one is valid for a given result. */
    function pendingModes(report) {
      const matches = Array.isArray(report?.matches) ? report.matches : null;
      if (!matches) return [];
      if (matches.length === 0) return ['clear-not-found'];
      return matches.some(match => !match.recorded) ? ['delete-unrecorded'] : ['clear-recorded'];
    }
    function viewOf(snapshot) {
      if (!snapshot) return 'loading';
      if (snapshot.canManage === false) return 'remote';
      if (snapshot.status === 'error' && !snapshot.setup) return 'unavailable';
      return snapshot.setup ? 'configured' : 'setup';
    }
    /** `removing` exists only on the client: the host reports a running delete as an operation, not as a status. */
    function statusOf(snapshot) {
      if (snapshot?.operation?.kind === 'remove') return 'removing';
      return STATUS_WORDS.includes(snapshot?.status) ? snapshot.status : 'offline';
    }
    const STATUS_WORDS = ['online', 'starting', 'reconnecting', 'stopping', 'paused', 'offline', 'error', 'unconfigured'];
    const STATUS_DOT = { online: 'done', starting: 'ongoing', reconnecting: 'warning', stopping: 'ongoing', paused: 'idle', offline: 'idle', error: 'error', unconfigured: 'idle', removing: 'ongoing' };
    /** pause while there is something to stop, resume while it is stopped, nothing while the host is busy stopping or deleting. */
    function primaryAction(status) {
      if (status === 'online' || status === 'reconnecting' || status === 'starting') return 'pause';
      if (status === 'paused' || status === 'offline' || status === 'error') return 'resume';
      return null;
    }
    const STEP_DOT = { idle: 'idle', working: 'ongoing', waiting: 'warning', done: 'done', error: 'error' };
    const EVIDENCE = ['unauthenticatedRejected', 'owner', 'http', 'api', 'websocket'];
    const STEP_IDS = ['environment', 'authorization', 'access', 'tunnel', 'browser', 'dsh'];

    function relative(deltaMs, tag) {
      const seconds = Math.round(Math.abs(deltaMs) / 1000), sign = deltaMs < 0 ? -1 : 1;
      let unit = 'second', value = seconds;
      if (seconds >= 60) { unit = 'minute'; value = Math.round(seconds / 60); }
      if (unit === 'minute' && value >= 60) { unit = 'hour'; value = Math.round(value / 60); }
      if (unit === 'hour' && value >= 24) { unit = 'day'; value = Math.round(value / 24); }
      try { return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(sign * value, unit); }
      catch { return `${sign * value} ${unit}`; }
    }
    function clock(timestamp, tag, options) {
      try { return new Intl.DateTimeFormat(tag, options).format(timestamp); }
      catch { return new Date(timestamp).toISOString(); }
    }
    const SHORT_TIME = { hour: 'numeric', minute: '2-digit' };
    const SHORT_DATE_TIME = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

    // ---- Typed but unsaved input outlives the settings dialog for this page session. Memory only: it holds no token and touches no storage. ----
    const blankForm = () => ({ accountId: '', zoneId: '', idpId: '', hostname: '', ownerEmail: '', cloudflaredPath: '', allowDownload: false, requireWebAuthn: false });
    const DRAFT = { form: blankForm(), suggested: '', needApproval: false, removed: null, deleting: null };
    function resetDraft() { DRAFT.form = blankForm(); DRAFT.suggested = ''; DRAFT.needApproval = false; }

    // Scoped to .dcf. Colors, radii and type come from --dsw-* tokens; the primitives bring their own styling.
    const CSS = `
.dcf{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;min-width:0;max-width:min(720px,100%);overflow-wrap:break-word;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dcf *,.dcf *::before,.dcf *::after{box-sizing:border-box}
.dcf>*{min-width:0;max-width:100%}
.dcf button{white-space:normal;max-width:100%;min-width:0;overflow-wrap:anywhere}
.dcf h2{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dcf h3{margin:0;font-size:14px;line-height:22px;font-weight:500}
.dcf p{margin:0}
.dcf a{color:var(--dsw-alias-link);font-weight:500;text-decoration:none;overflow-wrap:anywhere}
.dcf a:hover{text-decoration:underline dotted;text-underline-offset:3px}
.dcf a:focus-visible,.dcf button:focus-visible,.dcf select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dcf code{font-family:var(--dsw-font-markdown-code-font-family,ui-monospace,monospace);font-size:12px;overflow-wrap:anywhere}
.dcf-intro{margin-top:-4px;color:var(--dsw-alias-label-tertiary)}
.dcf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.dcf-muted{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dcf-card{display:flex;flex-direction:column;padding:4px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill)}
.dcf-card-danger{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-settings-card-stroke))}
.dcf-block{display:flex;flex-direction:column;gap:12px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dcf-block:last-child{border-bottom:0}
.dcf-block-head{display:flex;flex-direction:column;gap:4px}
.dcf-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dcf-row:last-child{border-bottom:0}
.dcf-row-main{flex:1 1 180px;min-width:0}
.dcf-title{font-size:14px;line-height:20px}
.dcf-desc{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dcf-desc a{font-size:12px}
.dcf-value{max-width:100%;text-align:right;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dcf-status{display:flex;align-items:center;gap:10px}
.dcf-status-word{white-space:nowrap;font-size:16px;line-height:24px;font-weight:500}
.dcf-status-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
.dcf-url{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;min-width:0;max-width:100%}
.dcf-url-text{min-width:0;flex:1 1 8em;font-size:14px;line-height:22px;overflow-wrap:anywhere;user-select:text}
.dcf-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;max-width:100%}
.dcf-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.dcf-label{font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dcf-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dcf-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dcf-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.dcf-input-wrap{display:flex;width:100%}
.dcf-input-wrap input{width:100%}
.dcf-input{display:block;width:100%;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px}
.dcf-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dcf-input:disabled{opacity:.6;cursor:default}
.dcf-input[aria-invalid=true],.dcf-input-wrap:has(input[aria-invalid=true]){border-color:var(--dsw-alias-state-error-primary)}
.dcf-select{position:relative;display:flex;max-width:100%}
.dcf-select select{appearance:none;padding-right:32px;cursor:pointer;text-overflow:ellipsis}
.dcf-select-icon{position:absolute;top:0;right:10px;bottom:0;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.dcf-notice{display:flex;gap:10px;padding:10px 12px;border-radius:var(--dsw-radius-md);font-size:12px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.dcf-notice[data-tone=error]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.dcf-notice[data-tone=info]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dcf-notice[data-tone=ok]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.dcf-notice-icon{flex:none;display:flex;height:18px;align-items:center;color:var(--dsw-alias-state-warn-label)}
.dcf-notice[data-tone=error] .dcf-notice-icon{color:var(--dsw-alias-state-error-primary)}
.dcf-notice[data-tone=info] .dcf-notice-icon{color:var(--dsw-alias-state-business-primary)}
.dcf-notice[data-tone=ok] .dcf-notice-icon{color:var(--dsw-alias-state-success-primary)}
.dcf-notice-body{display:flex;flex:1;flex-direction:column;gap:8px;min-width:0;overflow-wrap:anywhere}
.dcf-steps{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.dcf-step{display:flex;align-items:center;gap:10px;font-size:13px;line-height:20px}
.dcf-step-state{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dcf-dot{display:inline-flex;flex:none;align-items:center;justify-content:center;width:14px;height:14px}
.dcf-fb-dot{width:10px;height:10px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-state-idle-primary)}
.dcf-fb-dot[data-state=done]{background:var(--dsw-alias-state-success-primary)}
.dcf-fb-dot[data-state=warning],.dcf-fb-dot[data-state=ongoing]{background:var(--dsw-alias-state-warn-primary)}
.dcf-fb-dot[data-state=error]{background:var(--dsw-alias-state-error-primary)}
.dcf-progress{width:100%;height:6px;accent-color:var(--dsw-alias-state-business-primary)}
.dcf-toggle{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;padding:4px 0;border:0;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dcf-toggle:hover{color:var(--dsw-alias-label-primary)}
.dcf-sub{display:flex;flex-direction:column;gap:12px;padding:12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}
.dcf-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;font-size:12px;line-height:18px}
.dcf-list li{display:flex;align-items:flex-start;gap:8px}
.dcf-kv{display:flex;flex-direction:column;gap:8px;margin:0}
.dcf-kv>div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 16px}
.dcf-kv dt{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dcf-kv dd{margin:0;font-size:13px;line-height:20px;text-align:right;overflow-wrap:anywhere}
.dcf a svg{margin-left:4px;vertical-align:-1px}
.dcf-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:20px}
.dcf .dcf-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dcf .dcf-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.dcf-fb{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dcf-fb-primary{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-1)}
.dcf-fb:disabled{opacity:.4;cursor:not-allowed}
.dcf-fb-switch{position:relative;width:36px;height:20px;padding:0;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-state-idle-primary);cursor:pointer}
.dcf-fb-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}
.dcf-fb-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-bg-layer-1)}
.dcf-fb-switch[aria-checked=true]::after{left:18px}
.dcf-fb-switch:disabled{opacity:.5;cursor:not-allowed}
.dcf-fb-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-mask-2)}
.dcf-fb-modal-card{display:flex;flex-direction:column;gap:12px;width:min(480px,100%);max-height:100%;overflow:auto;padding:20px;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dcf-modal{display:flex;flex-direction:column;gap:12px;max-width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
@media (prefers-reduced-motion:reduce){.dcf,.dcf *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

    // ---- Primitive wrappers: the shared DSH component when the module table has it, a small token-styled stand-in otherwise. ----
    const cls = (...names) => names.filter(Boolean).join(' ');
    function FallbackButton({ variant, size, icon, className, children, ...rest }) {
      return h('button', { type: 'button', className: cls('dcf-fb', variant === 'primary' && 'dcf-fb-primary', className), ...rest }, icon || null, children);
    }
    function FallbackSwitch({ checked, onChange, label, disabled, title }) {
      return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, title, disabled, className: 'dcf-fb-switch', onClick: () => onChange(!checked) });
    }
    function FallbackCheckbox({ checked, onChange, label, disabled, title, className }) {
      return h('label', { className: cls('dcf-check', className), title }, h('input', { type: 'checkbox', checked, disabled, onChange: event => onChange(event.target.checked) }), h('span', null, label));
    }
    function FallbackDot({ state }) { return h('span', { className: 'dcf-fb-dot', 'data-state': state, 'aria-hidden': 'true' }); }
    function FallbackModal({ open, onClose, title, closeLabel, description, children, footer }) {
      if (!open) return null;
      return h('div', { className: 'dcf-fb-modal', role: 'presentation', onClick: onClose },
        h('div', { className: 'dcf-fb-modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onClick: event => event.stopPropagation(), onKeyDown: event => { if (event.key === 'Escape') onClose(); } },
          h('h2', null, title), description ? h('p', { className: 'dcf-hint' }, description) : null, children, footer ? h('div', { className: 'dcf-actions' }, footer) : null,
          h('button', { type: 'button', className: 'dcf-fb', 'aria-label': closeLabel, onClick: onClose }, closeLabel)));
    }
    const Primitive = { Button: has('Button') ? UI.Button : FallbackButton, Switch: has('Switch') ? UI.Switch : FallbackSwitch, Checkbox: has('Checkbox') ? UI.Checkbox : FallbackCheckbox, StateDot: has('StateDot') ? UI.StateDot : FallbackDot, Modal: has('Modal') ? UI.Modal : FallbackModal, Input: has('Input') ? UI.Input : null, Tag: has('Tag') ? UI.Tag : null };
    const glyph = (name, size = 14) => (has(name) ? h(UI[name], { size }) : null);

    function Btn({ variant = 'outline', size = 'sm', danger, className, ...rest }) {
      return h(Primitive.Button, { variant, size, className: cls(danger && 'dcf-danger', className), ...rest });
    }
    function Dot({ state }) { return h('span', { className: 'dcf-dot' }, h(Primitive.StateDot, { state })); }
    function Pill({ tone, children }) {
      return Primitive.Tag ? h(Primitive.Tag, { tone }, children) : h('span', { className: 'dcf-muted' }, children);
    }
    function TextInput({ inputRef, className, ...rest }) {
      return Primitive.Input
        ? h(Primitive.Input, { ref: inputRef, className: cls('dcf-input-wrap', className), ...rest })
        : h('input', { ref: inputRef, className: cls('dcf-input', className), ...rest });
    }

    /** Host calls stay distinct from the button lock: cancel can run while a mutation is in flight, and a late result cannot repaint status. */
    class PanelSession {
      constructor(call) { this.call = call; this.epoch = 0; this.busy = false; this.stopping = false; this.onStatus = null; this.onChange = null; }
      touch() { this.onChange?.(); }
      async mutate(name, payload, after) {
        if (this.busy || this.stopping) return { ignored: true };
        const epoch = ++this.epoch;
        this.busy = true; this.touch();
        try {
          const value = await this.call(name, payload);
          if (epoch !== this.epoch || this.stopping) return { dropped: true };
          after?.(value);
          const status = await this.call('status');
          if (epoch !== this.epoch || this.stopping) return { dropped: true };
          this.onStatus?.(status);
          return { value, status };
        } catch (error) {
          if (epoch !== this.epoch || this.stopping) return { dropped: true };
          throw error;
        } finally { if (epoch === this.epoch) { this.busy = false; this.touch(); } }
      }
      async control(name) {
        if (this.stopping) return { coalesced: true };
        const epoch = ++this.epoch;
        this.stopping = true; this.touch();
        try {
          await this.call(name);
          const status = await this.call('status');
          if (epoch !== this.epoch) return { dropped: true };
          this.onStatus?.(status);
          return { status };
        } catch (error) {
          if (epoch !== this.epoch) return { dropped: true };
          throw error;
        } finally { if (epoch === this.epoch) { this.stopping = false; this.busy = false; this.touch(); } }
      }
    }

    // ---- Building blocks. They are pure: every piece of state lives in Panel. ----
    const URL_TOKEN = 'https://dash.cloudflare.com/profile/api-tokens';
    const URL_PERMS = 'https://github.com/Aero123421/dsh-cf#2-cloudflareへの接続を許可する';
    const URL_RECOVERY = 'https://github.com/Aero123421/dsh-cf/blob/main/docs/reference.md#不明な書き込みの復旧';
    const URL_HELP = 'https://github.com/Aero123421/dsh-cf#開けないとき';
    const NOTICE_ICON = { ok: 'IconCheckCircleOutlineRegular', info: 'IconInfoOutlineRegular' };

    function ExtLink({ href, children }) {
      return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children, glyph('IconLinkOutlineRegular', 12));
    }
    function Notice({ tone = 'warn', role, children, actions }) {
      return h('div', { className: 'dcf-notice', 'data-tone': tone, role },
        h('span', { className: 'dcf-notice-icon', 'aria-hidden': 'true' }, glyph(NOTICE_ICON[tone] || 'IconWarningTriangleOutlineRegular', 16)),
        h('div', { className: 'dcf-notice-body' }, children, actions && actions.length ? h('div', { className: 'dcf-actions' }, ...actions) : null));
    }
    function Row({ title, desc, children }) {
      return h('div', { className: 'dcf-row' }, h('div', { className: 'dcf-row-main' }, h('div', { className: 'dcf-title' }, title), desc ? h('div', { className: 'dcf-desc' }, desc) : null), children || null);
    }
    function SwitchRow({ title, desc, checked, onChange, disabled, reason }) {
      return h(Row, { title, desc: h(React.Fragment, null, desc, disabled && reason ? h('div', null, reason) : null) },
        h(Primitive.Switch, { checked, onChange, label: title, disabled, title: disabled ? reason : undefined }));
    }
    function Field({ id, label, hint, error, children }) {
      return h('div', { className: 'dcf-field' }, h('label', { className: 'dcf-label', htmlFor: id }, label), children,
        error ? h('p', { className: 'dcf-error', id: id + '-d' }, error) : hint ? h('p', { className: 'dcf-hint', id: id + '-d' }, hint) : null);
    }
    function TextField({ id, label, hint, error, inputRef, ...input }) {
      return h(Field, { id, label, hint, error }, h(TextInput, { id, inputRef, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error || hint ? id + '-d' : undefined, autoComplete: 'off', spellCheck: false, ...input }));
    }
    function SelectField({ id, label, value, options, onChange, disabled, placeholder }) {
      return h(Field, { id, label },
        h('div', { className: 'dcf-select' },
          h('select', { id, className: 'dcf-input', value, disabled, onChange: event => onChange(event.target.value) },
            h('option', { value: '' }, placeholder), ...options.map(option => h('option', { key: option.id, value: option.id }, option.name))),
          h('span', { className: 'dcf-select-icon', 'aria-hidden': 'true' }, glyph('IconChevronDownOutlineRegular', 12))));
    }
    function KeyValues({ rows }) {
      return h('dl', { className: 'dcf-kv' }, ...rows.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))));
    }
    function Toggle({ open, onClick, children }) {
      return h('button', { type: 'button', className: 'dcf-toggle', 'aria-expanded': open ? 'true' : 'false', onClick },
        glyph(open ? 'IconChevronUpOutlineRegular' : 'IconChevronDownOutlineRegular', 12) || h('span', { 'aria-hidden': 'true' }, open ? '▴' : '▾'), children);
    }
    function Block({ title, desc, children }) {
      return h('div', { className: 'dcf-block' }, title ? h('div', { className: 'dcf-block-head' }, h('h3', null, title), desc ? h('p', { className: 'dcf-muted' }, desc) : null) : null, children);
    }
    function Card({ danger, children }) { return h('div', { className: cls('dcf-card', danger && 'dcf-card-danger') }, children); }
    /** The result of the action that was just taken, next to that action. */
    function NoteLine({ note }) {
      if (!note) return null;
      return note.tone === 'error' ? h('p', { className: 'dcf-error', role: 'alert' }, note.text) : h('p', { className: 'dcf-ok', role: 'status' }, note.text);
    }
    function Steps({ t, progress }) {
      const byId = new Map((progress || []).map(step => [step.id, step]));
      return h('ol', { className: 'dcf-steps' }, ...STEP_IDS.map(id => {
        const status = byId.get(id)?.status || 'idle';
        return h('li', { key: id, className: 'dcf-step' }, h(Dot, { state: STEP_DOT[status] || 'idle' }), h('span', null, t('step_' + id)), h('span', { className: 'dcf-step-state' }, t('ss_' + (STEP_DOT[status] ? status : 'idle'))));
      }));
    }
    function DownloadBar({ t, download }) {
      if (!download || !download.phase) return null;
      return h('div', { className: 'dcf-field' }, h('p', { className: 'dcf-hint' }, t('dl_' + download.phase)),
        download.total > 0 ? h('progress', { className: 'dcf-progress', max: download.total, value: download.received || 0, 'aria-label': t('dl_downloading') }) : null);
    }
    function publicUrlRow(p) {
      const { t, snap, status } = p, url = snap.publicUrl;
      if (!url) return null;
      const canOpen = status === 'online' && snap.canManage;
      return h('div', { className: 'dcf-field' }, h('div', { className: 'dcf-muted' }, t('publicUrl')),
        h('div', { className: 'dcf-url' },
          canOpen ? h('a', { className: 'dcf-url-text', href: url, target: '_blank', rel: 'noopener noreferrer' }, url) : h('span', { className: 'dcf-url-text' }, url),
          h('div', { className: 'dcf-actions' },
            h(Btn, { icon: glyph('IconCopyOutlineRegular', 14), onClick: p.copyUrl }, p.ui.copied === url ? t('copied') : t('copy')),
            canOpen ? h(Btn, { icon: glyph('IconLinkOutlineRegular', 14), onClick: () => window.open(url, '_blank', 'noopener,noreferrer') }, t('open')) : null)),
        p.notes.copy ? h(NoteLine, { note: p.notes.copy }) : null);
    }

    // ---- Authorization (the in-memory management token) ----
    function tokenForm(p, place, inputRef) {
      const { t } = p, note = p.notes[place];
      return h('form', { className: 'dcf-field', onSubmit: event => { event.preventDefault(); p.submitToken(place); } },
        h(TextField, { id: 'dcf-token-' + place, label: t('tokenLabel'), hint: t('tokenHint'), error: note?.tone === 'error' ? note.text : '', type: 'password', value: p.token, onChange: event => p.setToken(event.target.value), inputRef, disabled: p.locked }),
        h('div', { className: 'dcf-actions' }, h(Btn, { variant: 'primary', type: 'submit', disabled: p.locked || !p.token.trim() }, p.pending ? t('tokenConnecting') : t('tokenConnect'))));
    }
    function tokenActive(p, compact) {
      const { t, snap, tag } = p, until = snap.authorization?.until;
      const names = (snap.accounts || []).map(account => account.name).filter(Boolean);
      const label = names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') : 'Cloudflare';
      return h('div', { className: 'dcf-field' },
        h('div', { className: 'dcf-status' }, h(Dot, { state: 'done' }), h('span', null, t('authOk', { accounts: label }))),
        until ? h('p', { className: 'dcf-hint' }, t('authUntil', { time: clock(until, tag, SHORT_TIME), left: relative(until - p.now, tag) })) : null,
        compact ? null : h('div', { className: 'dcf-actions' }, h(Btn, { disabled: p.locked, onClick: p.forget }, t('authForget'))),
        compact ? null : h('p', { className: 'dcf-hint' }, t('authForgetHint')), h(NoteLine, { note: p.notes.token }));
    }
    /** The token, wherever an action needs it: a form while there is none, the expiry once there is. */
    const tokenBody = (p, place, inputRef, compact) => (p.authorized ? tokenActive(p, compact) : tokenForm(p, place, inputRef));
    function tokenLinks(p) {
      return h('div', { className: 'dcf-actions' }, h(ExtLink, { href: URL_TOKEN }, p.t('tokenCreate')), h(ExtLink, { href: URL_PERMS }, p.t('tokenPerms')));
    }

    // ---- Issue banner: guidance for the code the host reports, with the one button that helps ----
    function issueBanner(p) {
      const { t, snap, status } = p, issue = snap.issue;
      if (!issue) return null;
      if (issue.code === 'HOST_REVIEW' && snap.hostReview || issue.code === 'WRITE_UNKNOWN' && snap.pendingWrite) return null;
      let plan = issueAction(issue, p.authorized);
      if (p.view === 'setup' && plan !== 'token') plan = null;
      const actions = [];
      if (plan === 'token') actions.push(h(Btn, { key: 'token', onClick: p.focusToken }, t('authEnter')));
      if (plan === 'host') actions.push(h(Btn, { key: 'host', onClick: () => p.scrollTo(p.refs.host) }, t('actReview')));
      if (plan === 'pending') actions.push(h(Btn, { key: 'pending', onClick: () => p.scrollTo(p.refs.pending) }, t('actToPending')));
      if (plan === 'resume' && status === 'reconnecting') actions.push(h(Btn, { key: 'resume', disabled: p.locked, onClick: p.resume }, t('actRetryNow')));
      if (plan === 'again') actions.push(h(Btn, { key: 'again', onClick: p.openDetails }, t('actDetails')));
      const retryAt = issue.retryAt ? Date.parse(issue.retryAt) : 0;
      return h(Notice, { tone: issueTone(issue, status), actions },
        h('p', null, issueText(t, issue)), retryAt ? h('p', { className: 'dcf-muted' }, t('retryIn', { time: relative(retryAt - p.now, p.tag) })) : null);
    }

    // ---- Additional verification notices (organization level) ----
    function mfaBlock(p, account, required, place) {
      if (!required || !account) return null;
      const { t } = p;
      const reload = h(Btn, { key: 'reload', disabled: p.locked, onClick: () => p.reloadAccount(account.accountId) }, t('reload'));
      if (account.mfa === 'substitute') return h(Notice, { tone: 'warn', actions: [reload] }, h('p', null, t('mfaSubstitute')));
      if (account.mfa === 'unknown') return h(Notice, { tone: 'warn', actions: [reload] }, h('p', null, t('mfaUnknown')));
      if (account.mfaMissing?.length) {
        return h(Notice, { tone: 'warn', actions: [h(Btn, { key: 'enable', disabled: p.locked || !p.ui.mfaOk, onClick: () => p.enableMfa(account, place) }, t('mfaEnable'))] },
          h('p', null, h('strong', null, t('mfaTitle'))), h('p', null, t('mfaBody')),
          h(Primitive.Checkbox, { checked: p.ui.mfaOk, onChange: value => p.patchUi({ mfaOk: value }), label: t('mfaConsent'), disabled: p.locked }),
          h(NoteLine, { note: p.notes[place] }));
      }
      return h('div', { className: 'dcf-status' }, h(Dot, { state: 'done' }), h('span', { className: 'dcf-hint' }, t('mfaReady')));
    }

    // ---- Setup: three steps ----
    function setupStep1(p) {
      const { t } = p;
      return h(Card, null, h(Block, { title: t('s1Title'), desc: p.authorized ? null : t('s1Intro') },
        p.authorized ? null : tokenLinks(p), tokenBody(p, 'token', p.tokenInput)));
    }
    function setupStep2(p) {
      const { t, form, account, accounts } = p;
      if (!p.authorized) return h(Card, null, h(Block, { title: t('s2Title'), desc: t('s2Locked') }));
      const hostError = form.hostname ? hostnameIssue(form.hostname, p.zoneName) : '';
      const hostText = hostError ? t({ format: 'v_hostFormat', depth: 'v_hostDepth', apex: 'v_hostApex', zone: 'v_hostZone' }[hostError], { zone: p.zoneName }) : '';
      const accountNote = p.notes.account;
      const reload = p.accountId ? h(Btn, { key: 'reload', disabled: p.locked, onClick: () => p.reloadAccount(p.accountId) }, t('reload')) : null;
      const single = [], picks = [];
      const consider = (id, label, list, value, onChange) => (list.length > 1
        ? picks.push(h(SelectField, { key: id, id, label, value, options: list, onChange, disabled: p.locked, placeholder: t('choose') }))
        : list.length === 1 ? single.push([label, list[0].name]) : null);
      consider('dcf-account', t('accountLabel'), accounts, p.accountId, p.chooseAccount);
      if (account && account.zones.length) consider('dcf-zone', t('zoneLabel'), account.zones, form.zoneId, value => p.patchForm({ zoneId: value }));
      if (account && account.idps.length) consider('dcf-idp', t('idpLabel'), account.idps, form.idpId, value => p.patchForm({ idpId: value }));
      return h(Card, null, h(Block, { title: t('s2Title') },
        single.length ? h(KeyValues, { rows: single }) : null, ...picks,
        accountNote?.tone === 'error' ? h(Notice, { tone: 'error', role: 'alert', actions: reload ? [reload] : [] }, h('p', null, accountNote.text)) : null,
        p.accountId && !account && accountNote?.tone !== 'error' ? h('p', { className: 'dcf-muted', role: 'status' }, t('s2Loading')) : null,
        account && !account.zones.length ? h(Notice, { tone: 'warn', actions: [reload] }, h('p', null, t('noZones'))) : null,
        account ? h(TextField, { id: 'dcf-hostname', label: t('hostnameLabel'), hint: t('hostnameHint'), error: hostText, value: form.hostname, placeholder: p.zoneName ? `dsh.${p.zoneName}` : 'dsh.example.com', disabled: p.locked, onChange: event => p.patchForm({ hostname: event.target.value }) }) : null,
        account ? h(TextField, { id: 'dcf-email', label: t('emailLabel'), hint: t('emailHint'), error: p.touched.ownerEmail && !emailOk(form.ownerEmail) ? t('v_email') : '', type: 'email', value: form.ownerEmail, placeholder: 'you@example.com', disabled: p.locked, onChange: event => p.patchForm({ ownerEmail: event.target.value }), onBlur: () => p.markTouched('ownerEmail') }) : null));
    }
    function setupStep3(p) {
      const { t, form, account } = p, starting = p.status === 'starting';
      const needApproval = DRAFT.needApproval || p.snap.issue?.code === 'DOWNLOAD_APPROVAL';
      const blocker = connectBlockers({
        stopping: p.stopping || p.status === 'stopping', hostReview: !!p.snap.hostReview, pendingWrite: !!p.snap.pendingWrite, authorized: p.authorized,
        accountId: p.accountId, accountReady: !!account, requireWebAuthn: form.requireWebAuthn, mfa: account?.mfa, mfaMissing: account?.mfaMissing,
        zoneId: form.zoneId, idpId: form.idpId, hostname: form.hostname, zoneName: p.zoneName, ownerEmail: form.ownerEmail,
        needApproval, allowDownload: form.allowDownload, cloudflaredPath: form.cloudflaredPath.trim(), pending: p.pending, busy: !!p.snap.busy,
      });
      const advancedOpen = p.ui.advanced || p.snap.issue?.action === 'select-binary';
      return h(Card, null, h(Block, { title: t('s3Title'), desc: t('s3Intro') },
        issueBanner(p),
        needApproval ? h(SwitchRow, { title: t('downloadLabel'), desc: t('downloadNeed'), checked: form.allowDownload, onChange: value => p.patchForm({ allowDownload: value }), disabled: p.locked }) : null,
        h(Toggle, { open: advancedOpen, onClick: () => p.patchUi({ advanced: !advancedOpen }) }, t('advanced')),
        advancedOpen ? h('div', { className: 'dcf-sub' },
          h(SwitchRow, { title: t('webauthnTitle'), desc: t('webauthnDesc'), checked: form.requireWebAuthn, onChange: value => p.patchForm({ requireWebAuthn: value }), disabled: p.locked }),
          mfaBlock(p, account, form.requireWebAuthn, 'mfa'),
          h(TextField, { id: 'dcf-cfd-path', label: t('cfdPath'), hint: t('cfdPathHint'), value: form.cloudflaredPath, disabled: p.locked, onChange: event => p.patchForm({ cloudflaredPath: event.target.value }) })) : null,
        starting ? h('div', { className: 'dcf-field' },
          h('div', { className: 'dcf-url' }, h('h3', null, t('progressTitle')), h(Btn, { disabled: p.stopping, onClick: p.cancel }, t('cancel'))),
          h(Steps, { t, progress: p.snap.progress }), h(DownloadBar, { t, download: p.snap.connector?.download }), h('p', { className: 'dcf-hint' }, t('progressHint')), h(NoteLine, { note: p.notes.progress }))
          : h('div', { className: 'dcf-field' },
            h('div', { className: 'dcf-actions' }, h(Btn, { variant: 'primary', size: 'md', disabled: blocker !== null, 'aria-describedby': blocker ? 'dcf-connect-reason' : undefined, onClick: p.startNew }, t('connect'))),
            blocker ? h('p', { className: 'dcf-hint', id: 'dcf-connect-reason' }, t(BLOCKER_KEY[blocker])) : null,
            h(NoteLine, { note: p.notes.connect }))));
    }

    // ---- Configured: status, settings, recovery, details ----
    function statusHead(p, withAction) {
      const { t, status } = p, action = withAction ? primaryAction(status) : null;
      const blocked = !!p.snap.hostReview || !!p.snap.pendingWrite;
      return h('div', { className: 'dcf-status-top' },
        h('div', { className: 'dcf-status' }, h(Dot, { state: STATUS_DOT[status] || 'idle' }), h('span', { className: 'dcf-status-word' }, t('st_' + status))),
        action === 'pause' ? h(Btn, { disabled: p.stopping, onClick: p.pause }, t('pause')) : null,
        action === 'resume' ? h(Btn, { variant: 'primary', disabled: p.locked || blocked, onClick: p.resume }, t('resume')) : null);
    }
    function statusCard(p) {
      const { t, snap, status } = p;
      const running = snap.operation && (snap.operation.kind === 'start' || snap.operation.kind === 'resume');
      const action = primaryAction(status);
      return h(Card, null,
        h(Block, null, statusHead(p, true), h('p', { className: 'dcf-muted' }, t('sd_' + status)),
          action === 'resume' ? h('p', { className: 'dcf-hint' }, snap.hostReview ? t('b_host') : snap.pendingWrite ? t('b_unknownWrite') : t('resumeHint')) : null,
          h(NoteLine, { note: p.notes.status })),
        h(Block, null, publicUrlRow(p),
          status === 'online' && !snap.verified ? h('p', { className: 'dcf-hint' }, t('firstOpen')) : null),
        snap.issue && issueBanner(p) ? h(Block, null, issueBanner(p)) : null,
        running ? h(Block, null,
          h('div', { className: 'dcf-url' }, h('h3', null, t('progressTitle')), h(Btn, { disabled: p.stopping, onClick: p.cancel }, t('cancel'))),
          h(Steps, { t, progress: snap.progress }), h(DownloadBar, { t, download: snap.connector?.download }), h('p', { className: 'dcf-hint' }, t('progressHint')), h(NoteLine, { note: p.notes.progress })) : null,
        p.notes.result ? h(Block, null, h(NoteLine, { note: p.notes.result })) : null);
    }
    function verifiedText(p) {
      const { t, snap, tag, now } = p;
      if (!snap.verified) return t(p.status === 'online' ? 'verifiedNo' : 'verifiedNoOffline');
      const at = snap.lastVerifiedAt ? Date.parse(snap.lastVerifiedAt) : 0;
      return at ? t('verifiedYes', { time: clock(at, tag, SHORT_DATE_TIME), rel: relative(at - now, tag) }) : t('tagVerified');
    }
    function settingsCard(p) {
      const { t, snap } = p, setup = snap.setup, webauthn = setup.requireWebAuthn !== false;
      const autoReason = snap.hostReview ? t('rowAutoHost') : !snap.verified ? t('rowAutoVerify') : p.locked ? t('rowAutoBusy') : '';
      return h(Card, null,
        h(SwitchRow, { title: t('rowAuto'), desc: t('rowAutoDesc'), checked: snap.autoConnect === true, onChange: value => p.toggleAuto(value), disabled: !!autoReason && snap.autoConnect !== true || p.locked, reason: autoReason }),
        h(Row, { title: t('rowVerified'), desc: verifiedText(p) }, h(Pill, { tone: snap.verified ? 'success' : 'neutral' }, t(snap.verified ? 'tagVerified' : 'tagUnverified'))),
        h(SwitchRow, { title: t('webauthnTitle'), desc: h(React.Fragment, null, t('webauthnDesc'), ' ', t('modeNote'), webauthn && snap.enrollmentUrl ? h(React.Fragment, null, ' ', h(ExtLink, { href: snap.enrollmentUrl }, t('webauthnEnroll'))) : null), checked: webauthn, onChange: value => p.openMode(value), disabled: p.locked }),
        p.notes.auto ? h('div', { className: 'dcf-block' }, h(NoteLine, { note: p.notes.auto })) : null);
    }
    const shortId = value => (typeof value === 'string' && value.length > 12 ? value.slice(0, 8) + '…' : value || '');
    function publicCard(p) {
      const { t, snap } = p, setup = snap.setup, account = p.account;
      // Names the host saved at setup time come first, so the card reads the same without a management token.
      const accountName = snap.labels?.account || snap.accounts?.find(item => item.id === setup.accountId)?.name || shortId(setup.accountId);
      const idpName = snap.labels?.idp || account?.idps?.find(item => item.id === setup.idpId)?.name || shortId(setup.idpId);
      const rows = [[t('accountLabel'), accountName], [t('hostnameLabel'), setup.hostname], [t('emailLabel'), setup.ownerEmail], [t('idpLabel'), idpName]];
      return h(Card, null, h(Block, { title: t('cardPublic'), desc: t('lockedNote') },
        h(KeyValues, { rows })));
    }
    function managementCard(p) {
      const { t } = p, open = p.ui.tokenOpen || p.authorized;
      return h('div', { ref: p.refs.token }, h(Card, null, h(Block, { title: t('authCardTitle'), desc: t('authCardIntro') },
        p.authorized ? tokenActive(p) : open ? h(React.Fragment, null, tokenLinks(p), tokenForm(p, 'token', p.tokenInput))
          : h('div', { className: 'dcf-actions' }, h('span', { className: 'dcf-hint' }, t('authCardNone')), h(Btn, { onClick: p.focusToken }, t('authEnter'))))));
    }
    function hostCard(p) {
      const { t, snap } = p;
      if (!snap.hostReview) return null;
      return h('div', { ref: p.refs.host }, h(Card, null, h(Block, { title: t('hostTitle'), desc: t('hostBody') },
        h(Primitive.Checkbox, { checked: p.ui.hostOk, onChange: value => p.patchUi({ hostOk: value }), label: t('hostCheck'), disabled: p.locked }),
        h('div', { className: 'dcf-actions' }, h(Btn, { variant: 'primary', disabled: p.locked || !p.ui.hostOk, onClick: p.confirmHost }, t('hostConfirm'))),
        h(NoteLine, { note: p.notes.host }))));
    }
    function pendingCard(p) {
      const { t, snap } = p;
      if (!snap.pendingWrite) return null;
      const report = p.inspection, modes = pendingModes(report);
      return h('div', { ref: p.refs.pending }, h(Card, null, h(Block, { title: t('pendTitle'), desc: t('pendBody') },
        h('div', { className: 'dcf-actions' }, h(Btn, { disabled: p.locked || !p.authorized, onClick: p.inspect }, t('pendInspect')), h(ExtLink, { href: URL_RECOVERY }, t('pendGuide'))),
        h('p', { className: 'dcf-hint' }, p.authorized ? t('pendInspectHint') : t('pendNeedToken')),
        p.authorized ? null : h('div', { className: 'dcf-actions' }, h(Btn, { onClick: p.focusToken }, t('pendEnterToken'))),
        h(NoteLine, { note: p.notes.pending }),
        report ? h('div', { className: 'dcf-sub', role: 'status' },
          h('p', null, t('pi_' + report.status)),
          report.matches?.length ? h('div', { className: 'dcf-field' }, h('div', { className: 'dcf-label' }, t('pendMatches')),
            h('ul', { className: 'dcf-list' }, ...report.matches.map(match => h('li', { key: match.id }, h('code', null, match.id), ' ', h('span', { className: 'dcf-muted' }, t(match.recorded ? 'pendRecorded' : 'pendUnrecorded')))))) : null,
          ...modes.map(mode => h('div', { key: mode, className: 'dcf-field' }, h('p', { className: 'dcf-hint' }, t('pmd_' + mode)),
            h('div', { className: 'dcf-actions' }, h(Btn, { danger: mode === 'delete-unrecorded', disabled: p.locked, onClick: () => p.openModal({ kind: 'resolve', mode }) }, t('pm_' + mode)))))) : null)));
    }
    function hostLeftNotice(p) {
      const host = p.snap.trustedHostLeft;
      return host ? h(Notice, { tone: 'warn' }, h('p', null, p.t('hostLeft', { host }))) : null;
    }
    function detailsCard(p) {
      const { t, snap, tag } = p, setup = snap.setup, open = p.ui.details;
      const binary = snap.connector?.binary, check = snap.lastConfigurationCheck ? Date.parse(snap.lastConfigurationCheck) : 0;
      const body = !open ? null : h('div', { className: 'dcf-block' },
        h('div', { className: 'dcf-field' }, h('div', { className: 'dcf-label' }, t('progressTitle')), h(Steps, { t, progress: snap.progress })),
        h('div', { className: 'dcf-field' }, h('div', { className: 'dcf-label' }, t('detEvidence')),
          h('ul', { className: 'dcf-list' }, ...EVIDENCE.map(kind => h('li', { key: kind }, h(Dot, { state: snap.evidence?.[kind] ? 'done' : 'idle' }), h('span', null, t('ev_' + kind))))),
          h('p', { className: 'dcf-hint' }, t('detEvidenceNote'))),
        h('div', { className: 'dcf-field' }, h('div', { className: 'dcf-label' }, t('detConnector')),
          binary ? h('p', { className: 'dcf-hint' }, h('code', null, `${binary.path} (${binary.version})`)) : null,
          h('p', { className: 'dcf-hint' }, t('detConnectorState', { status: t('cn_' + (snap.connector?.status || 'stopped')) })),
          snap.gatePort ? h('p', { className: 'dcf-hint' }, t('detPort', { port: snap.gatePort })) : null,
          h('p', { className: 'dcf-hint' }, t('detConfigCheck', { time: check ? clock(check, tag, SHORT_DATE_TIME) : t('detNever') })),
          p.lastError ? h('p', { className: 'dcf-hint' }, t('detLastError', { code: p.lastError })) : null),
        h('div', { className: 'dcf-field' }, h('h3', null, t('detRefreshTitle')), h('p', { className: 'dcf-hint' }, t('detRefreshBody')),
          h('div', { className: 'dcf-actions' }, h(Btn, { disabled: p.locked || !p.authorized || !!snap.hostReview, onClick: p.refreshToken }, t('detRefresh'))),
          p.authorized ? null : h('p', { className: 'dcf-hint' }, t('b_authorize')), h(NoteLine, { note: p.notes.refresh })),
        h('div', { className: 'dcf-field', ref: p.refs.again }, h('h3', null, t('detAgainTitle')), h('p', { className: 'dcf-hint' }, t('detAgainBody')),
          h(SwitchRow, { title: t('downloadLabel'), desc: t('downloadNeed'), checked: p.form.allowDownload, onChange: value => p.patchForm({ allowDownload: value }), disabled: p.locked }),
          h(TextField, { id: 'dcf-again-path', label: t('cfdPath'), hint: t('cfdPathHint'), value: p.form.cloudflaredPath, disabled: p.locked, onChange: event => p.patchForm({ cloudflaredPath: event.target.value }) }),
          h('div', { className: 'dcf-actions' }, h(Btn, { disabled: p.locked || !p.authorized || !!snap.hostReview || !!snap.pendingWrite, onClick: p.again }, t('detAgain'))),
          h(NoteLine, { note: p.notes.again })),
        h('div', { className: 'dcf-actions' }, h(ExtLink, { href: URL_HELP }, t('detDocs'))));
      return h(Card, null, h('div', { className: 'dcf-block' }, h(Toggle, { open, onClick: () => p.patchUi({ details: !open }) }, t('detTitle'))), body);
    }
    function dangerCard(p) {
      const { t } = p;
      return h(Card, { danger: true }, h(Block, { title: t('dzTitle'), desc: t('dzBody') },
        h('div', { className: 'dcf-actions' }, h(Btn, { danger: true, disabled: p.locked, onClick: () => p.openModal({ kind: 'delete' }) }, t('dzButton')))));
    }
    function remoteView(p) {
      const { t, snap, tag, status } = p, at = snap.lastVerifiedAt ? Date.parse(snap.lastVerifiedAt) : 0;
      return h(React.Fragment, null, h(Card, null,
        h(Block, null, statusHead(p, false), h('p', { className: 'dcf-muted' }, t('sd_' + status)), issueBanner(p)),
        h(Block, null, publicUrlRow(p)),
        h(Row, { title: t('rmLast'), desc: at ? t('verifiedYes', { time: clock(at, tag, SHORT_DATE_TIME), rel: relative(at - p.now, tag) }) : t('rmNever') })),
        h('p', { className: 'dcf-muted' }, t('rmNote')));
    }
    function unavailableView(p) {
      const { t, snap } = p;
      return h(Card, null, h(Block, { title: t('unTitle') }, h(Notice, { tone: 'error' }, h('p', null, issueText(t, snap.issue))), snap.issue?.code ? h('p', { className: 'dcf-hint' }, t('detLastError', { code: snap.issue.code })) : null));
    }

    // ---- Dialogs ----
    function Dialog({ p, open, title, description, footer, children, onClose }) {
      return h(Primitive.Modal, { open, onClose, title, closeLabel: p.t('close'), description, footer },
        h('div', { className: 'dcf dcf-modal' }, children));
    }
    function confirmDialog(p) {
      const modal = p.ui.modal, host = p.snap?.setup?.hostname || '';
      if (!modal || (modal.kind !== 'delete' && modal.kind !== 'resolve')) return null;
      const { t } = p, isDelete = modal.kind === 'delete', matches = p.ui.typed === host && !!host;
      const needToken = !p.authorized;
      return h(Dialog, {
        p, open: true, onClose: p.closeModal, title: t(isDelete ? 'delTitle' : 'pm_' + modal.mode), description: t(isDelete ? 'delBody' : 'pmd_' + modal.mode),
        footer: h(React.Fragment, null, h(Btn, { size: 'md', onClick: p.closeModal }, t('cancel')),
          h(Btn, { size: 'md', danger: true, disabled: p.locked || needToken || !matches, onClick: () => (isDelete ? p.remove() : p.resolve(modal.mode)) }, t(isDelete ? 'delConfirm' : 'confirmDo'))),
      }, needToken ? h('div', { className: 'dcf-field' }, h('p', { className: 'dcf-hint' }, t(isDelete ? 'delNeedToken' : 'pendNeedToken')), tokenBody(p, 'modalToken', undefined, true)) : tokenBody(p, 'modalToken', undefined, true),
        h(TextField, { id: 'dcf-confirm-host', label: t('confirmPrompt', { host }), value: p.ui.typed, disabled: p.locked, onChange: event => p.patchUi({ typed: event.target.value }), 'data-modal-autofocus': true }),
        h(NoteLine, { note: p.notes.modal }));
    }
    function modeDialog(p) {
      const modal = p.ui.modal;
      if (!modal || modal.kind !== 'mode') return null;
      const { t, account } = p, next = modal.next;
      const mfaBlocked = next && (!account || account.mfa !== 'independent' || account.mfaMissing?.length > 0);
      return h(Dialog, {
        p, open: true, onClose: p.closeModal, title: t(next ? 'modeOnTitle' : 'modeOffTitle'), description: t('modeIntro'),
        footer: h(React.Fragment, null, h(Btn, { size: 'md', onClick: p.closeModal }, t('cancel')),
          h(Btn, { size: 'md', variant: 'primary', disabled: p.locked || !p.authorized || mfaBlocked, onClick: p.changeMode }, t('modeConfirm'))),
      }, h('ul', { className: 'dcf-list' }, ...['modeEff1', 'modeEff2', 'modeEff3'].map(key => h('li', { key }, h('span', { 'aria-hidden': 'true' }, '・'), h('span', null, t(key))))),
        next ? null : h('p', { className: 'dcf-hint' }, t('modeOffNote')),
        tokenBody(p, 'modalToken', undefined, true),
        p.authorized && next && !account && p.notes.account?.tone !== 'error' ? h('p', { className: 'dcf-muted', role: 'status' }, t('s2Loading')) : null,
        p.notes.account?.tone === 'error' ? h(Notice, { tone: 'error', role: 'alert' }, h('p', null, p.notes.account.text)) : null,
        next ? mfaBlock(p, account, true, 'modalMfa') : null,
        h(NoteLine, { note: p.notes.modal }));
    }

    // ---- The panel: all state, polling and actions ----
    function Panel({ connection, t: rawT }) {
      const t = (key, params) => fill(typeof rawT === 'function' ? rawT(key, params) : translate('en', key, params), params);
      const rawTag = t('localeTag'), tag = /^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$/.test(rawTag) ? rawTag : undefined;
      const [snap, setSnap] = React.useState(null);
      const [connErr, setConnErr] = React.useState(false);
      const [form, setForm] = React.useState(() => ({ ...DRAFT.form }));
      const [touched, setTouched] = React.useState({});
      const [token, setToken] = React.useState('');
      const [notes, setNotes] = React.useState({});
      const [ui, setUi] = React.useState({ details: false, advanced: false, tokenOpen: false, hostOk: false, mfaOk: false, copied: '', modal: null, typed: '' });
      const [inspection, setInspection] = React.useState(null);
      const [lastError, setLastError] = React.useState('');
      const [now, setNow] = React.useState(() => Date.now());
      const [announce, setAnnounce] = React.useState('');
      const [, setRender] = React.useState(0);
      const cursor = React.useRef(new SnapshotCursor()), session = React.useRef(null), mounted = React.useRef(true), lastHost = React.useRef(null);
      const tokenInput = React.useRef(null), attempted = React.useRef(null), previous = React.useRef('');
      const refs = { host: React.useRef(null), pending: React.useRef(null), token: React.useRef(null), again: React.useRef(null) };
      if (!session.current) session.current = new PanelSession(async (name, payload) => {
        const result = await connection.rpc.call('/dsh-cf', name, { ...payload, ...(cursor.current.generation ? { generation: cursor.current.generation } : {}) });
        if (!result?.ok) { const failure = new Error('settings-request'); failure.code = result?.error?.code; failure.hostMessage = result?.error?.message; throw failure; }
        return result.value;
      });
      const patchUi = patch => setUi(current => ({ ...current, ...patch }));
      const patchForm = patch => setForm(current => ({ ...current, ...patch }));
      const setNote = (place, note) => {
        setNotes(current => { if (!note && !(place in current)) return current; const next = { ...current }; if (note) next[place] = note; else delete next[place]; return next; });
        if (note) setAnnounce(note.text);
      };
      const merge = value => {
        if (!mounted.current || !value) return;
        const accepted = cursor.current.accept(value);
        if (!accepted) return;
        if (accepted === 'replaced') {
          ++session.current.epoch; session.current.busy = false; session.current.stopping = false;
          attempted.current = null; setToken(''); setInspection(null); setNotes({}); patchUi({ modal: null, typed: '', hostOk: false, mfaOk: false });
        }
        const host = value.setup?.hostname || null;
        if (lastHost.current && !host && DRAFT.deleting === lastHost.current) { DRAFT.removed = { host: lastHost.current }; DRAFT.deleting = null; resetDraft(); setForm(blankForm()); }
        if (host) { DRAFT.removed = null; if (!lastHost.current) { resetDraft(); setForm(blankForm()); } }
        lastHost.current = host;
        setNow(Date.now()); setSnap(value);
      };
      session.current.onChange = () => { if (mounted.current) setRender(n => n + 1); };
      session.current.onStatus = value => { if (mounted.current) { merge(value); setConnErr(false); } };

      React.useEffect(() => {
        mounted.current = true; let cancelled = false, timer;
        const refresh = async () => {
          try { const result = await connection.rpc.call('/dsh-cf', 'status', {}); if (!cancelled && result?.ok) { merge(result.value); setConnErr(false); } else if (!cancelled) setConnErr(true); }
          catch { if (!cancelled) setConnErr(true); }
          finally { if (!cancelled) timer = setTimeout(refresh, document.hidden ? 10_000 : 2000); }
        };
        void refresh();
        return () => { cancelled = true; mounted.current = false; clearTimeout(timer); };
      }, [connection]);

      const view = viewOf(snap), status = snap ? statusOf(snap) : 'offline';
      const authorized = !!snap?.authorization?.active, accounts = snap?.accounts || [];
      const accountId = view === 'setup' ? (accounts.some(item => item.id === form.accountId) ? form.accountId : accounts.length === 1 ? accounts[0].id : '') : view === 'configured' ? snap.setup.accountId : '';
      const account = snap?.account && accountId && snap.account.accountId === accountId ? snap.account : null;
      const zoneName = account?.zones.find(zone => zone.id === form.zoneId)?.name || '';
      const pending = session.current.busy, stopping = session.current.stopping;
      const locked = pending || stopping || !!snap?.busy;

      async function act(place, name, payload, after) {
        setNote(place, null);
        try { return await session.current.mutate(name, payload, after); }
        catch (error) {
          if (!mounted.current) return undefined;
          const described = describeError(t, error);
          if (error?.code === 'DOWNLOAD_APPROVAL') DRAFT.needApproval = true;
          setLastError(described.code); setNote(place, { tone: 'error', text: described.text, code: described.code });
          return undefined;
        }
      }
      async function control(place, name) {
        setNote(place, null);
        try { return await session.current.control(name); }
        catch (error) {
          if (!mounted.current) return undefined;
          const described = describeError(t, error);
          setLastError(described.code); setNote(place, { tone: 'error', text: described.text, code: described.code });
          return undefined;
        }
      }

      React.useEffect(() => { if (!authorized) attempted.current = null; }, [authorized]);
      React.useEffect(() => {
        if (!authorized || !accountId || locked) return;
        if (snap.account?.accountId === accountId || attempted.current === accountId) return;
        attempted.current = accountId;
        void act('account', 'account', { accountId });
      }, [authorized, accountId, locked, snap?.account?.accountId]);
      React.useEffect(() => {
        if (view !== 'setup' || !account) return;
        setForm(current => {
          const zoneId = account.zones.some(zone => zone.id === current.zoneId) ? current.zoneId : account.zones.length === 1 ? account.zones[0].id : '';
          const idpId = account.idps.some(idp => idp.id === current.idpId) ? current.idpId : account.idps.length === 1 ? account.idps[0].id : '';
          const zone = account.zones.find(item => item.id === zoneId);
          const suggestion = zone ? `dsh.${zone.name}` : '';
          const hostname = !current.hostname || current.hostname === DRAFT.suggested ? suggestion : current.hostname;
          DRAFT.suggested = suggestion;
          return zoneId === current.zoneId && idpId === current.idpId && hostname === current.hostname ? current : { ...current, zoneId, idpId, hostname };
        });
      }, [account, form.zoneId, view]);
      React.useEffect(() => { DRAFT.form = form; }, [form]);
      React.useEffect(() => { if (snap?.issue?.code === 'DOWNLOAD_APPROVAL') DRAFT.needApproval = true; }, [snap?.issue?.code]);
      React.useEffect(() => {
        if (!snap) return;
        if (previous.current && previous.current !== status) setAnnounce(t('st_' + status));
        previous.current = status;
      }, [status, !!snap]);
      const retryAt = snap?.issue?.retryAt ? Date.parse(snap.issue.retryAt) : 0, until = snap?.authorization?.until || 0;
      React.useEffect(() => {
        if (!retryAt && !until) return undefined;
        const timer = setInterval(() => setNow(Date.now()), retryAt ? 1000 : 20_000);
        return () => clearInterval(timer);
      }, [retryAt, until]);

      const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
      const scrollTo = ref => { try { ref.current?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch {} };
      const savedPayload = extra => {
        const s = snap.setup;
        return { accountId: s.accountId, zoneId: s.zoneId, hostname: s.hostname, ownerEmail: s.ownerEmail, idpId: s.idpId, requireWebAuthn: s.requireWebAuthn !== false, ...extra };
      };
      const closeModal = () => { patchUi({ modal: null, typed: '', mfaOk: false }); setNote('modal', null); setNote('modalToken', null); setNote('modalMfa', null); };
      const p = {
        t, tag, snap, status, view, now, form, touched, token, setToken, ui, notes, inspection, lastError, refs, tokenInput,
        authorized, account, accounts, accountId, zoneName, pending, stopping, locked, patchUi, patchForm,
        markTouched: key => setTouched(current => ({ ...current, [key]: true })),
        scrollTo,
        submitToken: place => { const value = token.trim(); if (value) void act(place, 'authorize', { token: value }, () => setToken('')); },
        forget: () => void act('token', 'forget', {}, () => { attempted.current = null; }),
        focusToken: () => { patchUi({ tokenOpen: true }); setTimeout(() => { tokenInput.current?.focus?.(); scrollTo(refs.token.current ? refs.token : tokenInput); }, 0); },
        openDetails: () => { if (view === 'setup') patchUi({ advanced: true }); else { patchUi({ details: true }); setTimeout(() => scrollTo(refs.again), 0); } },
        chooseAccount: id => { patchForm({ accountId: id, zoneId: '', idpId: '' }); DRAFT.suggested = ''; attempted.current = null; },
        reloadAccount: id => { attempted.current = id; void act('account', 'account', { accountId: id }); },
        enableMfa: (item, place) => void act(place, 'mfa/enable', { accountId: item.accountId, revision: item.organizationRevision, approved: true }, () => patchUi({ mfaOk: false })),
        startNew: () => void act('connect', 'start', { accountId, zoneId: form.zoneId, idpId: form.idpId, hostname: form.hostname.trim().toLowerCase(), ownerEmail: form.ownerEmail.trim(), requireWebAuthn: form.requireWebAuthn, cloudflaredPath: form.cloudflaredPath.trim(), allowDownload: form.allowDownload }),
        pause: () => void control('status', 'pause'),
        cancel: () => void control('progress', 'cancel'),
        resume: () => void act('status', 'resume', {}),
        toggleAuto: value => void act('auto', 'autoconnect', { enabled: value }),
        confirmHost: () => void act('host', 'host/confirm', { approved: true }, () => patchUi({ hostOk: false })),
        inspect: () => void act('pending', 'pending/inspect', {}, value => setInspection(value)),
        refreshToken: () => void act('refresh', 'token/refresh', {}),
        again: () => void act('again', 'start', savedPayload({ cloudflaredPath: form.cloudflaredPath.trim(), allowDownload: form.allowDownload })),
        copyUrl: async () => {
          try { await navigator.clipboard.writeText(snap.publicUrl); patchUi({ copied: snap.publicUrl }); setNote('copy', null); setAnnounce(t('copied')); }
          catch { setNote('copy', { tone: 'error', text: t('copyFailed') }); }
        },
        openModal: modal => { patchUi({ modal, typed: '', mfaOk: false }); },
        openMode: next => { patchUi({ modal: { kind: 'mode', next }, mfaOk: false }); },
        closeModal,
        changeMode: () => void act('modal', 'start', savedPayload({ requireWebAuthn: ui.modal.next, cloudflaredPath: '', allowDownload: false }), closeModal),
        remove: () => void act('modal', 'remove', { confirmHostname: ui.typed }, () => { DRAFT.deleting = snap.setup.hostname; closeModal(); }),
        resolve: mode => void act('modal', 'pending/resolve', { mode, confirmHostname: ui.typed }, value => {
          setInspection(null); closeModal();
          setNote('result', { tone: 'ok', text: [t('pendDone'), value?.deleted?.length ? t('pendDeleted', { count: value.deleted.length }) : ''].filter(Boolean).join(' ') });
        }),
      };

      let body;
      if (view === 'loading') body = [h('p', { className: 'dcf-muted' }, t('loading'))];
      else if (view === 'remote') body = [remoteView(p)];
      else if (view === 'unavailable') body = [unavailableView(p)];
      else if (view === 'setup') {
        body = [
          DRAFT.removed ? h(Notice, { key: 'removed', tone: 'ok', role: 'status' }, h('p', null, h('strong', null, t('delDone'))), h('p', null, t('delDoneSub', { host: DRAFT.removed.host }))) : null,
          hostLeftNotice(p), hostCard(p), setupStep1(p), setupStep2(p), setupStep3(p),
        ];
      } else {
        body = [hostLeftNotice(p), statusCard(p), hostCard(p), pendingCard(p), settingsCard(p), publicCard(p), managementCard(p), detailsCard(p), dangerCard(p)];
      }
      return h('section', { className: 'dcf', 'aria-label': t('title') },
        h('style', null, CSS),
        h('div', { className: 'dcf-sr', role: 'status', 'aria-live': 'polite' }, announce),
        h('h2', null, t('title')), h('p', { className: 'dcf-intro' }, t('intro')),
        connErr ? h(Notice, { tone: 'warn', role: 'status' }, h('p', null, t('connLost'))) : null,
        ...body,
        confirmDialog(p), modeDialog(p));
    }
    function duplicateLocale(error) {
      const message = String(error?.message || '');
      return message.includes('already registered') || message.includes('already has locale');
    }
    function apply(ctx) {
      let locale = null;
      try { locale = ctx.get('locale'); } catch { locale = null; }
      if (locale?.register) {
        // The Japanese dictionary is registered on its own so a Japanese language pack picks it up. This plugin defines no language.
        try { ctx.effect(() => locale.register('dsh-cf', { zh: COPY.zh, en: COPY.en }), 'dsh-cf: base dictionaries'); }
        catch (error) { if (!duplicateLocale(error)) throw error; }
        try { ctx.effect(() => locale.register('dsh-cf', 'ja', COPY.ja), 'dsh-cf: Japanese dictionary'); }
        catch (error) { if (!duplicateLocale(error)) throw error; }
      }
      const connection = ctx.get('connection');
      function SettingsPanel(props) {
        const translateProp = typeof props?.t === 'function' ? props.t : (key, params) => translate('en', key, params);
        return h(Panel, { connection, t: translateProp });
      }
      const label = () => { try { return locale.bind('dsh-cf')('title'); } catch { return 'Cloudflare'; } };
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-cf', order: 20, label, locale: 'dsh-cf' }, SettingsPanel));
    }
    return { apply, inject: ['slots', 'connection', 'locale'], PanelSession, SnapshotCursor, connectBlockers, hostnameIssue, emailOk, guideKey, issueText, describeError, issueAction, issueTone, pendingModes, viewOf, statusOf, primaryAction, relative, translate, COPY, DRAFT, resetDraft, GUIDE, EVIDENCE, STEP_IDS };
    addLanguage();
  },
});
