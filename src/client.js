/* Classic script: DSH inserts this file with a script tag. Do not add import or export. */
window.__ModuleLoader__.load({
  id: 'dsh-cf',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const COPY = {
      "en": {
        "nav": "Cloudflare",
        "eyebrow": "DSH / CLOUDFLARE",
        "headline": "Your DSH, from anywhere you sign in.",
        "lede": "Published for the owner only. No open ports and no Worker deploy.",
        "loading": "Loading status",
        "phaseIdle": "Not connected",
        "phaseConfiguring": "Configuring",
        "phaseWaitingBrowser": "Waiting for browser verification",
        "phaseReady": "Connection confirmed",
        "phaseReconnecting": "Reconnecting",
        "phaseRechecking": "Tunnel is up; DSH is being rechecked",
        "phaseDegraded": "DSH did not respond",
        "phaseStopped": "Stopped",
        "phaseError": "Connection stopped",
        "stepEnvironment": "Runtime",
        "stepAuthorization": "Cloudflare access",
        "stepAccess": "Access protection",
        "stepTunnel": "Tunnel",
        "stepBrowser": "Owner verification",
        "stepDsh": "DSH traffic",
        "stateIdle": "Waiting",
        "stateWorking": "Working",
        "stateWaiting": "Needs confirmation",
        "stateDone": "Confirmed",
        "stateError": "Needs attention",
        "stepsLabel": "Connection checks",
        "remoteNotice": "This public connection can only show status. Change or stop Cloudflare settings from the original local or SSH DSH connection.",
        "connectionError": "Checking the connection to DSH. It returns automatically while settings reload.",
        "pendingWrite": "The previous API create has an unknown result. Publication is stopped so a duplicate is not created. See “Recovering an unknown write” in the README.",
        "failed": "The request failed.",
        "hostTitle": "Confirm that you want to keep using this computer",
        "hostBody": "This profile was opened with a different hostname or user than last time. That also happens after a macOS network change or a recreated container. Using a copied profile on another computer at the same time would attach two DSH processes to one Tunnel, and traffic could arrive at either of them. Connection and auto-connect stay off until you confirm.",
        "hostConfirm": "This Tunnel is used only by this DSH profile on this computer.",
        "hostContinue": "Keep using this DSH",
        "cardAuthorize": "1. Connect Cloudflare",
        "authorizedHint": "Management authorization is confirmed. It stays in memory only.",
        "unauthorizedHint": "A management authorization is required only for the first setup and for deletion.",
        "oauthStart": "Authorize with Cloudflare",
        "forgetGrant": "Forget the management authorization in this DSH",
        "oauthWaitingTitle": "Allow the request in the browser",
        "oauthWaitingBody": "This authorization creates Cloudflare settings. It is separate from the sign-in used to open DSH.",
        "oauthOpen": "Open the Cloudflare authorization page",
        "oauthCallbackLabel": "Callback",
        "oauthCancel": "Cancel authorization",
        "oauthHeadless": "Setting up DSH on another computer, such as Ubuntu",
        "oauthHeadlessBody": "If the localhost page does not open after authorization, paste the full address-bar URL here. Do this from the original trusted DSH connection, and do not share the URL.",
        "oauthCallbackField": "Callback URL after authorization (single use)",
        "oauthFinish": "Accept the authorization result",
        "oauthComplete": "Cloudflare authorization completed.",
        "oauthDenied": "Cloudflare declined the authorization. Start again when you want to allow it.",
        "oauthExpired": "This authorization attempt expired. Start again.",
        "oauthCancelled": "The authorization attempt was cancelled.",
        "oauthFailed": "Cloudflare authorization did not complete. Start again.",
        "oauthManualSummary": "Use an OAuth Client ID or an API token",
        "oauthManualHint": "A distributed OAuth client has to be registered by the author. Until then, use a limited API token or your own public client.",
        "clientId": "OAuth Client ID (public)",
        "scopes": "Registered scope IDs (separated by spaces)",
        "apiToken": "Cloudflare API token (not saved)",
        "apiTokenButton": "Connect with an API token",
        "apiTokenHint": "See the README for the required permissions. Do not enter a Global API Key or your Cloudflare password.",
        "cardPublish": "2. Choose where this DSH is published",
        "accountLabel": "Cloudflare account",
        "choose": "Choose",
        "loadAccount": "Load this account’s settings",
        "zoneLabel": "DNS zone",
        "idpLabel": "Login method used to verify the owner",
        "mfaTitle": "An organization setting needs an addition",
        "mfaBody": "Add biometrics and a security key to the authenticators Access can use. Existing login methods and other apps’ MFA requirements stay as they are.",
        "mfaConsent": "I understand that the authenticators available to the whole organization will increase.",
        "mfaEnable": "Allow only this addition",
        "mfaReady": "Access can use WebAuthn.",
        "mfaSubstitute": "This organization lets identity-provider MFA replace the independent WebAuthn prompt. Turn off “Use identity provider MFA” in the Zero Trust Access settings, then reload. This plugin does not change that shared setting.",
        "mfaUnknown": "The organization response did not show whether identity-provider MFA can replace independent WebAuthn. Reload the account before publishing. Nothing was changed.",
        "hostname": "Public hostname",
        "ownerEmail": "Email of the owner who is allowed in",
        "sameUrl": "Each DSH gets its own URL. The same DSH uses the same URL from a Mac, iPad, or phone.",
        "cloudflaredDetails": "cloudflared details",
        "cloudflaredPath": "Absolute path of the executable (usually detected)",
        "cloudflaredHint": "An existing binary is reused. Existing services, Tunnels, and configuration files are left as they are.",
        "allowDownload": "Only when nothing is installed, download the verified official cloudflared into this plugin’s folder.",
        "connect": "Create the protection and connect",
        "resume": "Reconnect with the saved settings",
        "refreshToken": "Fetch the connector credentials again and reconnect",
        "downloadLabel": "cloudflared download",
        "cardVerify": "3. Verify the owner and live traffic in a browser",
        "verifyHint": "Sign-in to Access plus an additional WebAuthn check is used. This is not passkey-only login. Registered authenticators are managed in Access.",
        "enroll": "Authenticator enrollment",
        "verifyLink": "Verify the owner and open DSH",
        "evidenceRejected": "Unauthenticated rejection",
        "evidenceOwner": "Owner check",
        "evidenceHttp": "Page",
        "evidenceApi": "API",
        "evidenceWebsocket": "WebSocket",
        "openReady": "Open DSH",
        "openPending": "Open the public URL (still checking)",
        "copied": "Copied",
        "copy": "Copy URL",
        "copyFailed": "Select the link and copy it.",
        "autoConnect": "Reconnect automatically the next time DSH starts (available after the first traffic check).",
        "stop": "Pause the public connection",
        "cancel": "Cancel the operation",
        "stopping": "Stopping",
        "deleteSummary": "Delete this DSH’s public settings",
        "deleteHint": "Only the dedicated DNS record, Tunnel, and Access app are deleted. Auto-connect is turned off first. The shared MFA setting and an existing cloudflared stay.",
        "deleteField": "Type the public hostname again to delete it",
        "deleteButton": "Delete the dedicated public settings",
        "diagnostics": "Diagnostic details",
        "updateTitle": "Plugin update",
        "updateRunning": "Running: {version}",
        "updateInstalled": " · installed: {version}",
        "updateRemote": "Update the plugin from the original management connection. The public Tunnel cannot do it.",
        "updateChannel": "Update channel",
        "updateStable": "Stable",
        "updatePrerelease": "Prerelease (alpha and similar)",
        "s_idle": "Updates have not been checked.",
        "s_checking": "Checking releases…",
        "s_available": "An update is available.",
        "s_current": "The selected channel has no newer version.",
        "s_no-release": "There is no public release.",
        "s_channel-empty": "The selected channel has no release.",
        "s_incompatible": "This release’s DSH compatibility could not be confirmed.",
        "s_unavailable": "Automatic update is not available in this setup.",
        "s_installing": "Installing the plugin…",
        "s_unknown": "The result is unknown. Do not repeat the install; check the result.",
        "s_restart-required": "Restart DSH to use the installed version.",
        "s_applied": "Checking that the install is in effect.",
        "s_confirmed": "The running version matches the install.",
        "s_overridden": "A higher-priority setting kept the update from taking effect.",
        "s_failed": "The update failed.",
        "s_cancelled": "The install was cancelled.",
        "r_UPDATE_MANAGER": "This environment cannot update from the panel. Check the manual update source.",
        "r_UPDATE_READ_ONLY": "This environment cannot write an update.",
        "r_UPDATE_SOURCE": "The current install source has to be updated manually.",
        "r_UPDATE_COMPATIBILITY": "A compatible DSH version could not be confirmed.",
        "r_UPDATE_FETCH": "The release could not be fetched.",
        "r_UPDATE_METADATA": "The release information could not be confirmed.",
        "r_UPDATE_BUSY": "Another operation is in progress.",
        "r_UPDATE_FAILURE": "The update record, network, or install could not be confirmed. Check the manual update source and DSH’s plugin settings.",
        "r_UPDATE_ALREADY_INSTALLED": "HMR refused the install specification that is already present. Reinstall it from DSH’s plugin settings, or install the same release tag manually. This panel does not delete the running plugin.",
        "r_UPDATE_CANDIDATE": "The candidate or the installed version changed. Check for updates again.",
        "updateChecked": "Checked: {time}",
        "updateCandidate": "{from} → {to} · DSH {runtime}",
        "updateKeep": "The current GitHub distribution stays, and the pin changes to the tag of the release you selected.",
        "updateCheck": "Check for updates",
        "updateInstall": "Update the plugin",
        "updateRecheck": "Check the result",
        "updateRestartToken": "After DSH restarts, the in-memory Cloudflare API token has to be entered again. The IDs of the Tunnel, DNS record, and Access app you own stay saved.",
        "updateSeparate": "This is separate from fetching or updating cloudflared, and from changing the Tunnel, DNS, or Access.",
        "updateReleases": "Releases and manual update",
        "reachUpstream": "DSH did not answer through the tunnel. The connector is still running; this is not a new successful check.",
        "reachAuth": "DSH rejected the proxied session. Sign in again from the local settings. The connector was left running.",
        "reachSocket": "The WebSocket ended. Closing the browser or the 15-minute limit is not an upstream failure. The next DSH connection confirms it again.",
        "reachTunnel": "The tunnel reconnected. DSH’s HTTP, API, and WebSocket responses are being checked again.",
        "lastVerified": "Last confirmed: {time}. This is earlier evidence, not a check of the current connection.",
        "blockerRemote": "The public connection cannot create or change these settings.",
        "blockerStopping": "Stopping. Wait until this DSH confirms that the operation has finished.",
        "blockerHost": "Confirm this computer before connecting.",
        "blockerAuthorize": "Authorize Cloudflare before creating the connection.",
        "blockerMfaSubstitute": "Identity-provider MFA can replace independent WebAuthn, so publication stays off.",
        "blockerMfaUnknown": "Whether identity-provider MFA can replace WebAuthn is unknown, so publication stays off.",
        "blockerMfaMissing": "Add biometrics and a security key to Access before connecting.",
        "blockerAccount": "Choose a Cloudflare account and load its settings.",
        "blockerZone": "Choose a DNS zone.",
        "blockerIdp": "Choose the login method used to verify the owner.",
        "blockerHostname": "Enter a bare DNS hostname, with a dot and no URL, port, or path.",
        "blockerEmail": "Enter one owner email address.",
        "blockerBusy": "Another operation is still in progress.",
        "footer": "dsh-cf · Developer preview · A connection for an owner who trusts Cloudflare. Turning MFA off or revoking a session on the Cloudflare side is not guaranteed to be detected immediately."
      },
      "ja": {
        "nav": "Cloudflare",
        "eyebrow": "DSH / CLOUDFLARE",
        "headline": "あなたのDSHを、どこからでも。",
        "lede": "所有者だけに公開。ポート開放・Workerデプロイは不要。",
        "loading": "状態を取得中",
        "phaseIdle": "未接続",
        "phaseConfiguring": "設定中",
        "phaseWaitingBrowser": "ブラウザでの確認待ち",
        "phaseReady": "接続確認済み",
        "phaseReconnecting": "再接続中",
        "phaseRechecking": "Tunnelは接続済み。DSHの応答を再確認中",
        "phaseDegraded": "DSHが応答しません",
        "phaseStopped": "停止中",
        "phaseError": "接続を停止しました",
        "stepEnvironment": "実行環境",
        "stepAuthorization": "Cloudflare 連携",
        "stepAccess": "アクセス保護",
        "stepTunnel": "Tunnel 接続",
        "stepBrowser": "本人認証",
        "stepDsh": "DSH 実通信",
        "stateIdle": "待機",
        "stateWorking": "処理中",
        "stateWaiting": "確認待ち",
        "stateDone": "確認済み",
        "stateError": "要確認",
        "stepsLabel": "接続の確認工程",
        "remoteNotice": "この公開接続では状態確認だけができます。Cloudflare設定の変更・停止は、元のローカルまたはSSH経由のDSH接続で行ってください。",
        "connectionError": "DSHとの接続を確認しています。設定の再読込中は自動で復帰します。",
        "pendingWrite": "前回のAPI作成結果が不明です。重複作成を防ぐため停止しています。READMEの「不明な書き込みの復旧」を確認してください。",
        "failed": "処理に失敗しました。",
        "hostTitle": "このPCで使い続けるか確認してください",
        "hostBody": "この設定は、前回と違うホスト名またはユーザーで開かれました。macOSのネットワーク変更やコンテナの再作成でも起こります。別のPCへコピーした設定を同時に使うと、同じTunnelに2台のDSHがつながり、通信がどちらへ届くか分からなくなります。そのため確認するまで接続と自動接続を止めています。",
        "hostConfirm": "このTunnelを使っているDSHは、このPCのこのプロファイルだけです。",
        "hostContinue": "このDSHで使い続ける",
        "cardAuthorize": "1. Cloudflare と連携",
        "authorizedHint": "管理用の認可を確認済み。この認可はメモリ内だけに保持します。",
        "unauthorizedHint": "初回設定・削除のときだけ管理用の認可が必要です。",
        "oauthStart": "Cloudflare で認可",
        "forgetGrant": "管理認可をこのDSHから忘れる",
        "oauthWaitingTitle": "ブラウザで許可してください",
        "oauthWaitingBody": "この操作はCloudflareの設定を作るための認可です。DSH利用時の本人認証とは別です。",
        "oauthOpen": "Cloudflare の認可画面を開く",
        "oauthCallbackLabel": "コールバック",
        "oauthCancel": "認可をキャンセル",
        "oauthHeadless": "Ubuntuなど別のPCのDSHを設定している場合",
        "oauthHeadlessBody": "認可後にlocalhostの画面が開けなければ、そのアドレス欄のURL全体をここに貼り付けます。元の信頼済みDSH接続から行い、URLを共有しないでください。",
        "oauthCallbackField": "認可後のコールバックURL（使い捨て）",
        "oauthFinish": "認可結果を受け取る",
        "oauthComplete": "Cloudflareの認可が完了しました。",
        "oauthDenied": "Cloudflareが認可を拒否しました。許可するときは最初からやり直してください。",
        "oauthExpired": "この認可の試行は期限切れです。最初からやり直してください。",
        "oauthCancelled": "認可の試行を取り消しました。",
        "oauthFailed": "Cloudflareの認可が完了しませんでした。最初からやり直してください。",
        "oauthManualSummary": "OAuth Client ID / APIトークンで設定",
        "oauthManualHint": "配布用OAuthクライアントは作者側の登録が必要です。未登録なら限定権限のAPIトークン、または自分の公開クライアントを使用できます。",
        "clientId": "OAuth Client ID（公開情報）",
        "scopes": "登録済みScope ID（空白区切り）",
        "apiToken": "Cloudflare APIトークン（保存しません）",
        "apiTokenButton": "APIトークンで連携",
        "apiTokenHint": "必要権限はREADMEを参照。Global API KeyやCloudflareのパスワードは入力しないでください。",
        "cardPublish": "2. このDSHの公開先を決める",
        "accountLabel": "Cloudflare アカウント",
        "choose": "選択してください",
        "loadAccount": "このアカウントの設定を取得",
        "zoneLabel": "DNSゾーン",
        "idpLabel": "本人確認に使うログイン方法",
        "mfaTitle": "組織設定への追加が必要です",
        "mfaBody": "Accessの利用可能な認証器に、生体認証とセキュリティキーを追加します。既存の認証方法や、他アプリのMFA必須設定は変更しません。",
        "mfaConsent": "組織全体で利用できる認証器が増えることを確認しました。",
        "mfaEnable": "この追加だけを許可",
        "mfaReady": "WebAuthnを利用できるAccess設定を確認しました。",
        "mfaSubstitute": "この組織では、アイデンティティプロバイダーのMFAが独立したWebAuthnの確認を代わりに済ませられます。Zero Trust Accessの設定で「アイデンティティプロバイダーのMFAを使用」をオフにしてから、読み込み直してください。このプラグインはその共有設定を変更しません。",
        "mfaUnknown": "組織の応答からは、アイデンティティプロバイダーのMFAが独立したWebAuthnを代わりに済ませられるかが分かりません。公開する前にアカウントを読み込み直してください。何も変更していません。",
        "hostname": "公開ホスト名",
        "ownerEmail": "アクセスを許可する本人のメール",
        "sameUrl": "DSHごとに別のURLを作ります。同じDSHをMac・iPad・スマホから使うときは同じURLです。",
        "cloudflaredDetails": "cloudflared の詳細",
        "cloudflaredPath": "実行ファイルの絶対パス（通常は自動検出）",
        "cloudflaredHint": "既存のバイナリは再利用します。既存サービス・Tunnel・設定ファイルは変更しません。",
        "allowDownload": "未導入の場合だけ、検証済みの公式cloudflaredをプラグイン専用フォルダへ取得する。",
        "connect": "保護設定を作成して接続",
        "resume": "保存済みの設定で再接続",
        "refreshToken": "コネクタの資格情報を再取得して接続",
        "downloadLabel": "cloudflared ダウンロード",
        "cardVerify": "3. ブラウザで本人認証・通信を確認",
        "verifyHint": "Accessへのログイン＋WebAuthnの追加認証を使います。パスキー単独ログインではありません。登録済みの認証器はAccess側で管理されます。",
        "enroll": "認証器の登録画面",
        "verifyLink": "本人認証してDSHを確認",
        "evidenceRejected": "未認証の拒否",
        "evidenceOwner": "本人確認",
        "evidenceHttp": "画面",
        "evidenceApi": "API",
        "evidenceWebsocket": "WebSocket",
        "openReady": "DSHを開く",
        "openPending": "公開URLを開く（確認中）",
        "copied": "コピー済み",
        "copy": "URLをコピー",
        "copyFailed": "リンクを選択してコピーしてください。",
        "autoConnect": "DSHの次回起動時に自動接続する（初回通信確認後に有効化できます）。",
        "stop": "公開接続を一時停止",
        "cancel": "処理をキャンセル",
        "stopping": "停止中",
        "deleteSummary": "このDSHの公開設定を削除",
        "deleteHint": "専用DNS・Tunnel・Accessアプリだけを削除します。先に自動接続を無効にします。共有MFA設定と既存cloudflaredは残ります。",
        "deleteField": "削除する公開ホスト名を再入力",
        "deleteButton": "専用の公開設定を削除",
        "diagnostics": "診断の詳細",
        "updateTitle": "プラグインの更新",
        "updateRunning": "実行版: {version}",
        "updateInstalled": " · 導入版: {version}",
        "updateRemote": "プラグインの更新は元の管理接続から操作してください。公開Tunnelでは実行できません。",
        "updateChannel": "更新先",
        "updateStable": "安定版",
        "updatePrerelease": "プレリリース（alpha等）",
        "s_idle": "更新は未確認です。",
        "s_checking": "リリースを確認中…",
        "s_available": "更新があります。",
        "s_current": "選択した更新先に新しい版はありません。",
        "s_no-release": "公開リリースはありません。",
        "s_channel-empty": "選択した更新先のリリースはありません。",
        "s_incompatible": "このリリースのDSH互換性を確認できません。",
        "s_unavailable": "この構成では自動更新できません。",
        "s_installing": "プラグインをインストール中…",
        "s_unknown": "結果が不明です。導入を繰り返さず、結果を確認してください。",
        "s_restart-required": "導入版を使うにはDSHを再起動してください。",
        "s_applied": "導入結果を確認しています。",
        "s_confirmed": "実行版の反映を確認しました。",
        "s_overridden": "上位の設定により更新が反映されませんでした。",
        "s_failed": "更新に失敗しました。",
        "s_cancelled": "インストールは取り消されました。",
        "r_UPDATE_MANAGER": "この環境では画面から更新できません。手動更新先を確認してください。",
        "r_UPDATE_READ_ONLY": "この環境では更新を書き込めません。",
        "r_UPDATE_SOURCE": "現在の導入経路は手動更新が必要です。",
        "r_UPDATE_COMPATIBILITY": "DSHの対応版を確認できません。",
        "r_UPDATE_FETCH": "リリースを取得できませんでした。",
        "r_UPDATE_METADATA": "リリース情報を確認できません。",
        "r_UPDATE_BUSY": "別の処理が進行中です。",
        "r_UPDATE_FAILURE": "更新記録・通信・導入を確認できません。手動更新先とDSHのプラグイン設定を確認してください。",
        "r_UPDATE_ALREADY_INSTALLED": "導入済みの指定をHMRが拒否しました。DSHのプラグイン設定から入れ直すか、手動で同じリリースタグを導入してください。この画面は動作中のプラグインを削除しません。",
        "r_UPDATE_CANDIDATE": "候補または導入版が変わりました。更新を再確認してください。",
        "updateChecked": "確認日時: {time}",
        "updateCandidate": "{from} → {to} · DSH {runtime}",
        "updateKeep": "現在のGitHub配布経路を維持し、版固定を選択したリリースのタグに変更します。",
        "updateCheck": "更新を確認",
        "updateInstall": "プラグインを更新する",
        "updateRecheck": "結果を確認",
        "updateRestartToken": "DSH再起動後はメモリー内のCloudflare API tokenの再入力が必要です。所有するTunnel・DNS・AccessのIDは保存されたままです。",
        "updateSeparate": "cloudflaredの取得・更新、TunnelやDNS/Accessの変更とは別の操作です。",
        "updateReleases": "リリース・手動更新",
        "reachUpstream": "Tunnel経由でDSHが応答しませんでした。コネクタは動いたままです。これは新しい成功の確認ではありません。",
        "reachAuth": "DSHが中継したセッションを拒否しました。ローカルの設定から入り直してください。コネクタは止めていません。",
        "reachSocket": "WebSocketが終了しました。ブラウザを閉じたことや15分の上限は、上流の障害ではありません。次のDSH接続で改めて確認します。",
        "reachTunnel": "Tunnelが再接続しました。DSHのHTTP・API・WebSocketの応答を再確認しています。",
        "lastVerified": "最終確認: {time}。これは過去の確認であり、今の接続の成功ではありません。",
        "blockerRemote": "この公開接続では、設定の作成や変更はできません。",
        "blockerStopping": "停止中です。このDSHが完了を確認するまで、新しい操作は始めません。",
        "blockerHost": "接続する前に、このPCで使い続けることを確認してください。",
        "blockerAuthorize": "接続を作る前に、Cloudflareを認可してください。",
        "blockerMfaSubstitute": "アイデンティティプロバイダーのMFAが独立したWebAuthnを代わりに済ませられるため、公開しません。",
        "blockerMfaUnknown": "アイデンティティプロバイダーのMFAがWebAuthnを代わりに済ませられるかが不明なため、公開しません。",
        "blockerMfaMissing": "接続する前に、Accessへ生体認証とセキュリティキーを追加してください。",
        "blockerAccount": "Cloudflareアカウントを選び、その設定を読み込んでください。",
        "blockerZone": "DNSゾーンを選択してください。",
        "blockerIdp": "本人確認に使うログイン方法を選択してください。",
        "blockerHostname": "URL・ポート・パスを含まない、ドットのあるDNSホスト名を入力してください。",
        "blockerEmail": "所有者のメールアドレスを1つ入力してください。",
        "blockerBusy": "別の処理がまだ進行中です。",
        "footer": "dsh-cf · Developer preview · Cloudflareを信頼する所有者向けの接続です。Cloudflare側のMFA解除や失効を即座に検出する保証はありません。"
      },
      "zh": {
        "nav": "Cloudflare",
        "eyebrow": "DSH / CLOUDFLARE",
        "headline": "从你登录的任何地方打开你的 DSH。",
        "lede": "只向所有者公开。不需要开放端口，也不需要部署 Worker。",
        "loading": "正在读取状态",
        "phaseIdle": "未连接",
        "phaseConfiguring": "正在配置",
        "phaseWaitingBrowser": "等待浏览器确认",
        "phaseReady": "连接已确认",
        "phaseReconnecting": "正在重新连接",
        "phaseRechecking": "Tunnel 已连接，正在重新确认 DSH",
        "phaseDegraded": "DSH 没有响应",
        "phaseStopped": "已停止",
        "phaseError": "连接已停止",
        "stepEnvironment": "运行环境",
        "stepAuthorization": "Cloudflare 授权",
        "stepAccess": "访问保护",
        "stepTunnel": "Tunnel 连接",
        "stepBrowser": "所有者验证",
        "stepDsh": "DSH 实际通信",
        "stateIdle": "等待",
        "stateWorking": "处理中",
        "stateWaiting": "待确认",
        "stateDone": "已确认",
        "stateError": "需要查看",
        "stepsLabel": "连接确认步骤",
        "remoteNotice": "这条公开连接只能查看状态。请从原来的本地或 SSH DSH 连接更改或停止 Cloudflare 设置。",
        "connectionError": "正在确认与 DSH 的连接。设置重新加载期间会自动恢复。",
        "pendingWrite": "上一次 API 创建的结果不明。为避免重复创建，已停止公开。请查看 README 中的“不明写入的恢复”。",
        "failed": "处理失败。",
        "hostTitle": "请确认是否继续在这台电脑上使用",
        "hostBody": "此配置上次使用的主机名或用户与现在不同。macOS 网络变化或重建容器时也会出现。若同时在另一台电脑上使用复制的配置，两个 DSH 会连到同一个 Tunnel，通信可能到达其中任意一个。确认之前，连接和自动连接保持关闭。",
        "hostConfirm": "使用此 Tunnel 的 DSH 只有这台电脑上的这个配置。",
        "hostContinue": "继续使用这个 DSH",
        "cardAuthorize": "1. 连接 Cloudflare",
        "authorizedHint": "管理授权已确认。该授权只保存在内存中。",
        "unauthorizedHint": "只有初次设置和删除时需要管理授权。",
        "oauthStart": "通过 Cloudflare 授权",
        "forgetGrant": "让这个 DSH 忘记管理授权",
        "oauthWaitingTitle": "请在浏览器中允许",
        "oauthWaitingBody": "这次授权用于创建 Cloudflare 设置，与打开 DSH 时的本人验证不是同一件事。",
        "oauthOpen": "打开 Cloudflare 授权页面",
        "oauthCallbackLabel": "回调",
        "oauthCancel": "取消授权",
        "oauthHeadless": "正在另一台电脑（例如 Ubuntu）上设置 DSH",
        "oauthHeadlessBody": "如果授权后打不开 localhost 页面，请把地址栏中的完整 URL 粘贴到这里。请从原来受信任的 DSH 连接操作，不要分享该 URL。",
        "oauthCallbackField": "授权后的回调 URL（一次性）",
        "oauthFinish": "接受授权结果",
        "oauthComplete": "Cloudflare 授权已完成。",
        "oauthDenied": "Cloudflare 拒绝了授权。需要允许时请重新开始。",
        "oauthExpired": "这次授权已过期。请重新开始。",
        "oauthCancelled": "已取消这次授权。",
        "oauthFailed": "Cloudflare 授权没有完成。请重新开始。",
        "oauthManualSummary": "使用 OAuth Client ID 或 API 令牌",
        "oauthManualHint": "分发用的 OAuth 客户端需要作者注册。尚未注册时，可以使用权限有限的 API 令牌或你自己的公开客户端。",
        "clientId": "OAuth Client ID（公开信息）",
        "scopes": "已注册的 Scope ID（以空格分隔）",
        "apiToken": "Cloudflare API 令牌（不会保存）",
        "apiTokenButton": "使用 API 令牌连接",
        "apiTokenHint": "所需权限见 README。不要输入 Global API Key 或 Cloudflare 密码。",
        "cardPublish": "2. 决定这个 DSH 的公开地址",
        "accountLabel": "Cloudflare 账户",
        "choose": "请选择",
        "loadAccount": "读取此账户的设置",
        "zoneLabel": "DNS 区域",
        "idpLabel": "用于验证所有者的登录方式",
        "mfaTitle": "需要向组织设置追加一项",
        "mfaBody": "把生物识别和安全密钥加入 Access 可用的验证器。现有登录方式以及其他应用的 MFA 要求保持不变。",
        "mfaConsent": "我已确认整个组织可用的验证器会增加。",
        "mfaEnable": "只允许这一项追加",
        "mfaReady": "已确认 Access 可以使用 WebAuthn。",
        "mfaSubstitute": "此组织允许身份提供商的 MFA 代替独立的 WebAuthn 提示。请在 Zero Trust Access 设置中关闭“使用身份提供商 MFA”，然后重新加载。此插件不修改那项共享设置。",
        "mfaUnknown": "组织的响应没有表明身份提供商的 MFA 能否代替独立的 WebAuthn。公开前请重新加载账户。没有做任何更改。",
        "hostname": "公开主机名",
        "ownerEmail": "允许访问的所有者邮箱",
        "sameUrl": "每个 DSH 使用各自的 URL。同一 DSH 从 Mac、iPad 或手机访问时使用同一个 URL。",
        "cloudflaredDetails": "cloudflared 详情",
        "cloudflaredPath": "可执行文件的绝对路径（通常自动检测）",
        "cloudflaredHint": "会复用已有的二进制文件。已有服务、Tunnel 和配置文件不会被修改。",
        "allowDownload": "仅在尚未安装时，把经过校验的官方 cloudflared 下载到此插件的文件夹。",
        "connect": "创建保护设置并连接",
        "resume": "用已保存的设置重新连接",
        "refreshToken": "重新获取连接器凭据并连接",
        "downloadLabel": "cloudflared 下载",
        "cardVerify": "3. 在浏览器中确认所有者与实际通信",
        "verifyHint": "使用 Access 登录加上额外的 WebAuthn 验证。这不是仅用通行密钥登录。已注册的验证器在 Access 中管理。",
        "enroll": "验证器注册页面",
        "verifyLink": "验证所有者并打开 DSH",
        "evidenceRejected": "未认证拒绝",
        "evidenceOwner": "所有者确认",
        "evidenceHttp": "页面",
        "evidenceApi": "API",
        "evidenceWebsocket": "WebSocket",
        "openReady": "打开 DSH",
        "openPending": "打开公开 URL（确认中）",
        "copied": "已复制",
        "copy": "复制 URL",
        "copyFailed": "请选择链接后复制。",
        "autoConnect": "下次启动 DSH 时自动连接（首次通信确认后才能启用）。",
        "stop": "暂停公开连接",
        "cancel": "取消操作",
        "stopping": "正在停止",
        "deleteSummary": "删除这个 DSH 的公开设置",
        "deleteHint": "只删除专用的 DNS、Tunnel 和 Access 应用。会先关闭自动连接。共享 MFA 设置和已有的 cloudflared 会保留。",
        "deleteField": "再次输入要删除的公开主机名",
        "deleteButton": "删除专用的公开设置",
        "diagnostics": "诊断详情",
        "updateTitle": "插件更新",
        "updateRunning": "运行版本: {version}",
        "updateInstalled": " · 已安装: {version}",
        "updateRemote": "请从原来的管理连接更新插件。公开 Tunnel 不能执行更新。",
        "updateChannel": "更新通道",
        "updateStable": "稳定版",
        "updatePrerelease": "预发布（alpha 等）",
        "s_idle": "尚未检查更新。",
        "s_checking": "正在检查发布…",
        "s_available": "有可用更新。",
        "s_current": "所选通道没有更新的版本。",
        "s_no-release": "没有公开发布。",
        "s_channel-empty": "所选通道没有发布。",
        "s_incompatible": "无法确认此发布的 DSH 兼容性。",
        "s_unavailable": "此环境不能自动更新。",
        "s_installing": "正在安装插件…",
        "s_unknown": "结果不明。不要重复安装，请先确认结果。",
        "s_restart-required": "请重启 DSH 以使用已安装的版本。",
        "s_applied": "正在确认安装是否生效。",
        "s_confirmed": "已确认运行版本与安装一致。",
        "s_overridden": "更高优先级的设置使更新没有生效。",
        "s_failed": "更新失败。",
        "s_cancelled": "安装已取消。",
        "r_UPDATE_MANAGER": "此环境不能从面板更新。请查看手动更新来源。",
        "r_UPDATE_READ_ONLY": "此环境不能写入更新。",
        "r_UPDATE_SOURCE": "当前安装来源需要手动更新。",
        "r_UPDATE_COMPATIBILITY": "无法确认兼容的 DSH 版本。",
        "r_UPDATE_FETCH": "无法获取发布。",
        "r_UPDATE_METADATA": "无法确认发布信息。",
        "r_UPDATE_BUSY": "另一个操作正在进行。",
        "r_UPDATE_FAILURE": "无法确认更新记录、网络或安装。请查看手动更新来源和 DSH 的插件设置。",
        "r_UPDATE_ALREADY_INSTALLED": "HMR 拒绝了已经安装的指定。请从 DSH 的插件设置重新安装，或手动安装同一发布标签。此面板不会删除正在运行的插件。",
        "r_UPDATE_CANDIDATE": "候选或已安装版本已变化。请重新检查更新。",
        "updateChecked": "检查时间: {time}",
        "updateCandidate": "{from} → {to} · DSH {runtime}",
        "updateKeep": "保持当前的 GitHub 分发路径，并把版本固定改为所选发布的标签。",
        "updateCheck": "检查更新",
        "updateInstall": "更新插件",
        "updateRecheck": "查看结果",
        "updateRestartToken": "DSH 重启后需要重新输入内存中的 Cloudflare API 令牌。你拥有的 Tunnel、DNS 和 Access ID 仍会保存。",
        "updateSeparate": "这与获取或更新 cloudflared，以及更改 Tunnel、DNS 或 Access 是不同的操作。",
        "updateReleases": "发布与手动更新",
        "reachUpstream": "DSH 没有通过 Tunnel 响应。连接器仍在运行；这不是一次新的成功确认。",
        "reachAuth": "DSH 拒绝了转发的会话。请从本地设置重新登录。连接器没有停止。",
        "reachSocket": "WebSocket 已结束。关闭浏览器或 15 分钟上限不是上游故障。下一次 DSH 连接会再次确认。",
        "reachTunnel": "Tunnel 已重新连接。正在重新确认 DSH 的 HTTP、API 和 WebSocket 响应。",
        "lastVerified": "上次确认: {time}。这是以前的证据，不是当前连接的成功。",
        "blockerRemote": "这条公开连接不能创建或更改这些设置。",
        "blockerStopping": "正在停止。在这个 DSH 确认操作完成之前，不会开始新的操作。",
        "blockerHost": "连接前请确认继续使用这台电脑。",
        "blockerAuthorize": "创建连接前请先授权 Cloudflare。",
        "blockerMfaSubstitute": "身份提供商的 MFA 可以代替独立的 WebAuthn，因此不会公开。",
        "blockerMfaUnknown": "无法确定身份提供商的 MFA 能否代替 WebAuthn，因此不会公开。",
        "blockerMfaMissing": "连接前请把生物识别和安全密钥加入 Access。",
        "blockerAccount": "请选择 Cloudflare 账户并读取其设置。",
        "blockerZone": "请选择 DNS 区域。",
        "blockerIdp": "请选择用于验证所有者的登录方式。",
        "blockerHostname": "请输入带点的 DNS 主机名，不要包含 URL、端口或路径。",
        "blockerEmail": "请输入一个所有者邮箱。",
        "blockerBusy": "另一个操作仍在进行。",
        "footer": "dsh-cf · Developer preview · 面向信任 Cloudflare 的所有者的连接。不保证立即发现 Cloudflare 侧关闭 MFA 或吊销会话。"
      }
    };

    function translate(locale, key, params) {
      const dict = COPY[locale] || COPY.en;
      const template = dict[key] ?? COPY.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }
    function hostnameOk(value) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 253 || value !== value.trim()) return false;
      const host = value.toLowerCase();
      return host.includes('.') && host.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) && !/^\d+(?:\.\d+){3}$/.test(host);
    }
    function emailOk(value) {
      return typeof value === 'string' && value.length <= 254 && /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(value);
    }
    /** One sentence explaining why the primary publish button cannot run. Null means it can. */
    function connectBlockers(input) {
      if (input.remote) return 'remote';
      if (input.stopping) return 'stopping';
      if (input.hostReview) return 'host';
      if (!input.authorized) return 'authorize';
      if (!input.accountId || !input.accountReady) return 'account';
      if (input.mfa === 'substitute') return 'mfa-substitute';
      if (input.mfa === 'unknown') return 'mfa-unknown';
      if (input.mfaMissing?.length) return 'mfa-missing';
      if (!input.zoneId) return 'zone';
      if (!input.idpId) return 'idp';
      if (!hostnameOk(input.hostname)) return 'hostname';
      if (!emailOk(input.ownerEmail)) return 'email';
      if (input.pending || input.busy) return 'busy';
      return null;
    }
    const BLOCKER_KEY = {
      remote: 'blockerRemote', stopping: 'blockerStopping', host: 'blockerHost', authorize: 'blockerAuthorize', account: 'blockerAccount',
      'mfa-substitute': 'blockerMfaSubstitute', 'mfa-unknown': 'blockerMfaUnknown', 'mfa-missing': 'blockerMfaMissing',
      zone: 'blockerZone', idp: 'blockerIdp', hostname: 'blockerHostname', email: 'blockerEmail', busy: 'blockerBusy',
    };
    const CSS = `
.dcf{--cf-line:var(--dsw-alias-border,#d9dfe5);--cf-soft:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));--cf-accent:var(--dsw-alias-accent,#bd4f16);container-type:inline-size;min-width:0;max-width:860px;padding:8px 4px 32px;font:inherit;line-height:1.6;color:inherit}
.dcf *{box-sizing:border-box}.dcf h2{font-size:23px;letter-spacing:-.5px;margin:0}.dcf h3{font-size:15px;margin:0 0 14px}.dcf p{margin:8px 0}.dcf small,.dcf .hint{opacity:.76;font-size:12px}.dcf .head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}.dcf .eyebrow{font-size:10px;font-weight:700;letter-spacing:2px;margin-bottom:4px}.dcf .badge{border:1px solid var(--cf-line);border-radius:30px;padding:5px 12px;font-size:12px;white-space:nowrap}.dcf .card{border:1px solid var(--cf-line);border-radius:14px;padding:20px;margin:14px 0;background:var(--cf-soft)}
.dcf .steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;list-style:none;padding:0;margin:20px 0}.dcf .step{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--cf-line);border-radius:11px;padding:14px;min-width:0}.dcf .step>div{min-width:0;overflow-wrap:anywhere}.dcf .step strong{font-size:12px;display:block}.dcf .step small{display:block}.dcf .icon{width:23px;height:23px;flex:0 0 23px;border:1px solid var(--cf-line);border-radius:50%;display:grid;place-items:center;font-size:12px}.dcf .working .icon{border:2px solid var(--cf-line);border-top-color:var(--cf-accent);animation:dcf-spin .85s linear infinite}.dcf .done .icon{background:var(--cf-accent);color:white;border-color:transparent;animation:dcf-pop .18s ease-out}.dcf .error .icon{border-style:dashed}.dcf .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.dcf label.field{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;min-width:0}.dcf input:not([type=checkbox]),.dcf select,.dcf textarea{font:inherit;font-weight:400;color:inherit;background:transparent;border:1px solid var(--cf-line);border-radius:8px;padding:10px 12px;min-width:0;width:100%}.dcf textarea{min-height:74px;resize:vertical}.dcf input:focus-visible,.dcf select:focus-visible,.dcf textarea:focus-visible,.dcf button:focus-visible,.dcf a:focus-visible{outline:2px solid var(--cf-accent);outline-offset:3px}.dcf .actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-top:14px}.dcf button,.dcf a.button{font:inherit;font-size:12px;line-height:1.4;border:1px solid var(--cf-line);border-radius:8px;padding:10px 15px;background:transparent;color:inherit;cursor:pointer;text-decoration:none}.dcf button.primary,.dcf a.primary{background:var(--cf-accent);color:#fff;border-color:transparent;font-weight:600}.dcf button:disabled{opacity:.45;cursor:not-allowed}.dcf .notice{border-left:3px solid var(--cf-accent);padding:9px 14px;margin:12px 0;background:var(--cf-soft);font-size:12px;overflow-wrap:anywhere}.dcf .reason{margin:8px 0 0;font-size:12px}.dcf .check{display:flex;gap:9px;align-items:flex-start;font-size:12px;margin:12px 0}.dcf .check input{margin-top:5px;flex-shrink:0}.dcf details{margin-top:14px}.dcf summary{font-size:12px;cursor:pointer}.dcf code{font:12px ui-monospace,monospace;overflow-wrap:anywhere}.dcf .url{display:block;font:14px ui-monospace,monospace;overflow-wrap:anywhere;margin:10px 0}.dcf .evidence{display:flex;flex-wrap:wrap;gap:8px;font-size:11px}.dcf .evidence span{border:1px solid var(--cf-line);padding:4px 9px;border-radius:20px}.dcf progress{width:100%;accent-color:var(--cf-accent)}.dcf .footer{font-size:11px;opacity:.65;margin-top:22px;border-top:1px solid var(--cf-line);padding-top:14px}
@keyframes dcf-spin{to{transform:rotate(360deg)}}@keyframes dcf-pop{from{transform:scale(.8)}to{transform:scale(1)}}@media(max-width:580px){.dcf .steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dcf .grid{grid-template-columns:1fr}.dcf .head{display:block}.dcf .badge{display:inline-block;margin-top:10px}.dcf .card{padding:15px}}@container (max-width:580px){.dcf .steps{grid-template-columns:repeat(2,minmax(0,1fr))}.dcf .grid{grid-template-columns:1fr}.dcf .head{display:block}.dcf .badge{display:inline-block;margin-top:10px}.dcf .card{padding:15px}}@container (max-width:360px){.dcf .steps{grid-template-columns:minmax(0,1fr)}.dcf h2{font-size:19px}.dcf .card{padding:12px}.dcf .step{padding:10px;flex-direction:column;gap:6px}.dcf .badge{white-space:normal}.dcf button,.dcf a.button{padding:9px 11px}}@media(prefers-reduced-motion:reduce){.dcf *{animation:none!important;transition:none!important}}
`;
    function field(label, value, onChange, options = {}) {
      return h('label', { className: 'field' }, label, h(options.multiline ? 'textarea' : 'input', { value, onChange: e => onChange(e.target.value), autoComplete: 'off', spellCheck: false, ...options, multiline: undefined }));
    }
    function select(label, value, onChange, options, disabled, placeholder) {
      return h('label', { className: 'field' }, label, h('select', { value, disabled, 'aria-label': label, onChange: e => onChange(e.target.value) }, h('option', { value: '' }, placeholder), options.map(x => h('option', { key: x.id, value: x.id }, x.name))));
    }
    function anchor(label, url, primary = false) {
      if (!url) return null;
      return h('a', { className: `button ${primary ? 'primary' : ''}`, href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
    }
    const UPDATE_STATUSES = ['idle', 'checking', 'available', 'current', 'no-release', 'channel-empty', 'incompatible', 'unavailable', 'installing', 'unknown', 'restart-required', 'applied', 'confirmed', 'overridden', 'failed', 'cancelled'];
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
            if (method === 'install' && ['UPDATE_BUSY', 'UPDATE_PROFILE'].includes(result?.error?.code) && generation === this.generation) { this.remember(null); this.publish({ ...this.view, status: 'failed', reason: result.error.code }); return; }
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
        } finally { if (epoch === this.epoch) { this.stopping = false; this.busy = false; this.touch(); } }
      }
    }
    function UpdatePanel({ updates, remote, cloudBusy, authorized, version, t }) {
      const view = React.useSyncExternalStore(updates.subscribe, updates.getSnapshot);
      React.useEffect(() => {
        if (remote) return;
        void updates.status();
        const timer = setInterval(() => { if (!updates.busy) void updates.status(); }, 2000);
        return () => clearInterval(timer);
      }, [updates, remote]);
      const busy = !view.profileKey || ['checking', 'installing', 'unknown', 'restart-required'].includes(view.status);
      const running = view.running === '—' ? version || '—' : view.running;
      return h('section', { className: 'card dcf-plugin-update' }, h('h3', null, t('updateTitle')),
        h('p', null, t('updateRunning', { version: running }), view.installed && view.installed !== view.running ? t('updateInstalled', { version: view.installed }) : ''),
        remote ? h('p', { className: 'notice' }, t('updateRemote')) : h(React.Fragment, null,
          select(t('updateChannel'), view.channel, channel => updates.select(channel), [{ id: 'stable', name: t('updateStable') }, { id: 'prerelease', name: t('updatePrerelease') }], busy || cloudBusy, t('choose')),
          h('p', { role: 'status' }, t('s_' + view.status) === 's_' + view.status ? view.status : t('s_' + view.status), view.reason ? ` · ${t('r_' + view.reason) === 'r_' + view.reason ? t('r_UPDATE_FAILURE') : t('r_' + view.reason)}` : ''),
          view.checkedAt ? h('p', { className: 'hint' }, t('updateChecked', { time: new Date(view.checkedAt).toLocaleString() })) : null,
          view.candidate && view.status === 'available' ? h('div', null, h('p', null, t('updateCandidate', { from: view.running, to: view.candidate.version, runtime: view.candidate.runtime })), h('p', { style: { whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' } }, view.candidate.notes), h('p', { className: 'hint' }, t('updateKeep'))) : null,
          h('div', { className: 'actions' }, h('button', { type: 'button', disabled: busy || cloudBusy || view.status === 'unavailable', onClick: () => void updates.check() }, t('updateCheck')), view.status === 'available' ? h('button', { type: 'button', className: 'primary', disabled: cloudBusy, onClick: () => void updates.install() }, t('updateInstall')) : null, view.status === 'unknown' ? h('button', { type: 'button', onClick: () => void updates.status() }, t('updateRecheck')) : null),
          view.status === 'restart-required' && authorized ? h('p', { className: 'notice' }, t('updateRestartToken')) : null),
        h('p', { className: 'hint' }, t('updateSeparate')), anchor(t('updateReleases'), 'https://github.com/Aero123421/dsh-cf/releases'));
    }
    const PHASE_KEY = { idle: 'phaseIdle', configuring: 'phaseConfiguring', 'waiting-browser': 'phaseWaitingBrowser', ready: 'phaseReady', reconnecting: 'phaseReconnecting', rechecking: 'phaseRechecking', degraded: 'phaseDegraded', stopped: 'phaseStopped', error: 'phaseError' };
    const STEP_KEY = { environment: 'stepEnvironment', authorization: 'stepAuthorization', access: 'stepAccess', tunnel: 'stepTunnel', browser: 'stepBrowser', dsh: 'stepDsh' };
    const STATE_KEY = { idle: 'stateIdle', working: 'stateWorking', waiting: 'stateWaiting', done: 'stateDone', error: 'stateError' };
    const OAUTH_KEY = { complete: 'oauthComplete', denied: 'oauthDenied', expired: 'oauthExpired', cancelled: 'oauthCancelled', error: 'oauthFailed' };
    function Panel({ connection, updates, t }) {
      const [state, setState] = React.useState(null);
      const [error, setError] = React.useState('');
      const [connectionError, setConnectionError] = React.useState('');
      const [token, setToken] = React.useState('');
      const [clientId, setClientId] = React.useState('');
      const [scopes, setScopes] = React.useState('');
      const [link, setLink] = React.useState(null);
      const [callback, setCallback] = React.useState('');
      const [form, setForm] = React.useState({ accountId: '', zoneId: '', hostname: '', ownerEmail: '', idpId: '', cloudflaredPath: '', allowDownload: false });
      const [consent, setConsent] = React.useState(false);
      const [hostOk, setHostOk] = React.useState(false);
      const [deleteName, setDeleteName] = React.useState('');
      const [copied, setCopied] = React.useState(false);
      const [, setTick] = React.useState(0);
      const mounted = React.useRef(true), seeded = React.useRef(false), seen = React.useRef(0), linkRef = React.useRef(null);
      const session = React.useRef(null);
      if (!session.current) session.current = new PanelSession(async (name, payload) => {
        const result = await connection.rpc.call('/dsh-cf', name, payload);
        if (!result?.ok) { const failure = new Error(result?.error?.message || ''); failure.fallback = !result?.error?.message; throw failure; }
        return result.value;
      });
      const merge = value => {
        if (!mounted.current || !value) return;
        if (typeof value.sequence === 'number' && value.sequence < seen.current) return;
        if (typeof value.sequence === 'number') seen.current = value.sequence;
        if (linkRef.current && value.oauth && value.oauth.attempt < linkRef.current.attempt) value = { ...value, oauth: { ...value.oauth, phase: 'waiting', attempt: linkRef.current.attempt, expiresAt: linkRef.current.expiresAt } };
        setState(value);
        if (!seeded.current) { seeded.current = true; if (value.setup) setForm(f => ({ ...f, ...value.setup })); setClientId(value.oauth.clientId); setScopes(value.oauth.scopes.join(' ')); }
      };
      session.current.onChange = () => { if (mounted.current) setTick(n => n + 1); };
      session.current.onStatus = value => { if (mounted.current) { merge(value); setConnectionError(''); } };
      const pending = session.current.busy, stopping = session.current.stopping;
      React.useEffect(() => {
        mounted.current = true; let cancelled = false, timer;
        const refresh = async () => {
          try { const result = await connection.rpc.call('/dsh-cf', 'status', {}); if (!cancelled && result?.ok) { merge(result.value); setConnectionError(''); } else if (!cancelled) setConnectionError(t('connectionError')); }
          catch { if (!cancelled) setConnectionError(t('connectionError')); }
          finally { if (!cancelled) timer = setTimeout(refresh, document.hidden ? 10_000 : 2000); }
        };
        void refresh();
        return () => { cancelled = true; mounted.current = false; clearTimeout(timer); };
      }, [connection]);
      React.useEffect(() => { linkRef.current = link; }, [link]);
      const remote = state?.setup?.hostname === window.location.hostname;
      const oauthPhase = state?.oauth?.phase || 'idle';
      React.useEffect(() => {
        if (!state || remote || (oauthPhase !== 'waiting' && oauthPhase !== 'exchanging')) { if (remote || (oauthPhase !== 'waiting' && oauthPhase !== 'exchanging')) setLink(current => current ? null : current); return; }
        if (linkRef.current?.attempt === state.oauth.attempt && linkRef.current.authorizationUrl) return;
        let cancelled = false;
        connection.rpc.call('/dsh-cf', 'oauth/attempt', {}).then(result => {
          if (cancelled || !mounted.current || !result?.ok) return;
          const value = result.value;
          if (value?.authorizationUrl && value.attempt === state.oauth.attempt) setLink({ attempt: value.attempt, authorizationUrl: value.authorizationUrl, redirectUri: value.redirectUri, expiresAt: value.expiresAt });
        }).catch(() => {});
        return () => { cancelled = true; };
      }, [connection, remote, oauthPhase, state?.oauth?.attempt]);
      async function run(name, payload, after) {
        setError('');
        try { await session.current.mutate(name, payload, after); }
        catch (e) { if (mounted.current) setError(e.fallback || !e.message ? t('failed') : e.message); }
      }
      async function control(name) {
        setError('');
        try { await session.current.control(name); }
        catch (e) { if (mounted.current) setError(e.fallback || !e.message ? t('failed') : e.message); }
      }
      const change = key => value => setForm(f => ({ ...f, [key]: value }));
      const locked = remote || pending || stopping || state?.busy;
      const account = state?.account?.accountId === form.accountId ? state.account : null;
      const ready = state?.phase === 'ready';
      const blocker = connectBlockers({ remote, pending, busy: state?.busy, stopping, hostReview: !!state?.hostReview, authorized: !!state?.authorized, accountId: form.accountId, accountReady: !!account, mfa: account?.mfa, mfaMissing: account?.mfaMissing, zoneId: form.zoneId, idpId: form.idpId, hostname: form.hostname, ownerEmail: form.ownerEmail });
      const phaseLabel = PHASE_KEY[state?.phase] ? t(PHASE_KEY[state.phase]) : t('loading');
      const reach = state?.reachability?.status === 'upstream-failed' || state?.phase === 'degraded' && state?.error?.code === 'DSH_UPSTREAM' ? t('reachUpstream')
        : state?.reachability?.status === 'auth-rejected' || state?.error?.code === 'DSH_AUTH' ? t('reachAuth')
        : state?.reachability?.status === 'websocket-ended' ? t('reachSocket')
        : state?.reachability?.status === 'rechecking' || state?.phase === 'rechecking' || state?.phase === 'reconnecting' ? t('reachTunnel') : '';
      const oauthLive = (oauthPhase === 'waiting' || oauthPhase === 'exchanging') && link?.authorizationUrl && link.attempt === state?.oauth?.attempt && (!link.expiresAt || Date.now() < link.expiresAt);
      const chooseAccount = accountId => { setForm(f => ({ ...f, accountId, zoneId: '', idpId: '' })); setConsent(false); if (accountId) void run('account', { accountId }); };
      async function copyUrl() { try { await navigator.clipboard.writeText(state.publicUrl); setCopied(true); } catch { setError(t('copyFailed')); } }
      const button = (text, name, payload = {}, options = {}) => h('button', { type: 'button', className: options.className, disabled: locked || options.disabled, onClick: () => void run(name, payload, options.after) }, text);
      return h('section', { className: 'dcf', 'aria-label': t('nav') },
        h('style', null, CSS),
        h('div', { className: 'head' }, h('div', null, h('div', { className: 'eyebrow' }, t('eyebrow')), h('h2', null, t('headline')), h('p', { className: 'hint' }, t('lede'))), h('span', { className: 'badge', role: 'status', 'aria-live': 'polite' }, phaseLabel)),
        h('ol', { className: 'steps', 'aria-label': t('stepsLabel') }, (state?.steps || Object.keys(STEP_KEY).map(id => ({ id, status: 'idle' }))).map((s, i) => h('li', { className: `step ${s.status}`, key: s.id, title: s.message }, h('span', { className: 'icon', 'aria-hidden': true }, s.status === 'done' ? '✓' : s.status === 'working' ? '' : s.status === 'error' ? '!' : i + 1), h('div', null, h('strong', null, t(STEP_KEY[s.id] || 'diagnostics')), h('small', null, t(STATE_KEY[s.status] || 'stateIdle')))))),
        remote ? h('div', { className: 'notice' }, t('remoteNotice')) : null,
        error ? h('div', { className: 'notice', role: 'alert' }, error) : null,
        connectionError ? h('div', { className: 'notice', role: 'status' }, connectionError) : null,
        reach ? h('div', { className: 'notice', role: 'status' }, reach) : null,
        state?.error && !reach ? h('div', { className: 'notice', role: 'alert' }, h('strong', null, state.error.code), h('p', null, state.error.message)) : null,
        state?.pendingWrite ? h('div', { className: 'notice' }, t('pendingWrite')) : null,
        state?.hostReview ? h('div', { className: 'notice', role: 'alert' }, h('strong', null, t('hostTitle')),
          h('p', null, t('hostBody')),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: hostOk, disabled: locked, onChange: e => setHostOk(e.target.checked) }), t('hostConfirm')),
          h('div', { className: 'actions' }, button(t('hostContinue'), 'host/confirm', { approved: true }, { disabled: locked || !hostOk, after: () => setHostOk(false) }))) : null,
        h('div', { className: 'card' }, h('h3', null, t('cardAuthorize')),
          h('p', { className: 'hint' }, state?.authorized ? t('authorizedHint') : t('unauthorizedHint')),
          h('div', { className: 'actions' }, h('button', { className: 'primary', type: 'button', disabled: locked || !clientId || !scopes.trim(), onClick: () => void run('oauth/start', { clientId, scopes: scopes.split(/\s+/).filter(Boolean) }, value => { if (value?.authorizationUrl) setLink({ attempt: value.attempt, authorizationUrl: value.authorizationUrl, redirectUri: value.redirectUri, expiresAt: value.expiresAt }); }) }, t('oauthStart')), state?.authorized ? button(t('forgetGrant'), 'forget') : null),
          oauthLive && !remote ? h('div', { className: 'notice' }, h('strong', null, t('oauthWaitingTitle')), h('p', null, t('oauthWaitingBody')), anchor(t('oauthOpen'), link.authorizationUrl, true), h('p', { className: 'hint' }, t('oauthCallbackLabel'), ': ', h('code', null, link.redirectUri)), h('button', { type: 'button', disabled: remote || stopping, onClick: () => void control('oauth/cancel') }, t('oauthCancel')),
            h('details', null, h('summary', null, t('oauthHeadless')), h('p', null, t('oauthHeadlessBody')), field(t('oauthCallbackField'), callback, setCallback, { type: 'password' }), h('button', { type: 'button', disabled: locked || !callback, onClick: () => { const value = callback; setCallback(''); void run('oauth/finish', { redirectUrl: value }); } }, t('oauthFinish')))) : null,
          !oauthLive && OAUTH_KEY[oauthPhase] ? h('div', { className: 'notice', role: 'status' }, t(OAUTH_KEY[oauthPhase])) : null,
          h('details', { open: !state?.authorized && !clientId }, h('summary', null, t('oauthManualSummary')),
            h('p', { className: 'hint' }, t('oauthManualHint')),
            h('div', { className: 'grid' }, field(t('clientId'), clientId, setClientId), field(t('scopes'), scopes, setScopes)),
            h('div', { style: { marginTop: 14 } }, field(t('apiToken'), token, setToken, { type: 'password' })),
            h('div', { className: 'actions' }, h('button', { type: 'button', disabled: locked || !token.trim(), onClick: () => { const value = token; setToken(''); void run('authorize', { token: value }); } }, t('apiTokenButton'))),
            h('p', { className: 'hint' }, t('apiTokenHint')))),
        h('div', { className: 'card' }, h('h3', null, t('cardPublish')),
          select(t('accountLabel'), form.accountId, chooseAccount, state?.accounts || [], locked || !state?.authorized, t('choose')),
          form.accountId && !account ? h('div', { className: 'actions' }, button(t('loadAccount'), 'account', { accountId: form.accountId }, { disabled: locked || !state?.authorized })) : null,
          account?.mfa === 'substitute' ? h('div', { className: 'notice', role: 'status' }, t('mfaSubstitute')) : null,
          account?.mfa === 'unknown' ? h('div', { className: 'notice', role: 'status' }, t('mfaUnknown')) : null,
          account && account.mfa === 'independent' && account.mfaMissing.length ? h('div', null, h('div', { className: 'notice' }, h('strong', null, t('mfaTitle')), h('p', null, t('mfaBody')), h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: consent, onChange: e => setConsent(e.target.checked) }), t('mfaConsent')), button(t('mfaEnable'), 'mfa/enable', { accountId: form.accountId, revision: account.organizationRevision, approved: true }, { disabled: locked || !consent }))) : null,
          account && account.mfa === 'independent' && !account.mfaMissing.length ? h('p', { className: 'hint' }, t('mfaReady')) : null,
          account ? h('div', { className: 'grid', style: { marginTop: 14 } }, select(t('zoneLabel'), form.zoneId, change('zoneId'), account.zones, locked, t('choose')), select(t('idpLabel'), form.idpId, change('idpId'), account.idps, locked, t('choose'))) : null,
          h('div', { className: 'grid', style: { marginTop: 14 } }, field(t('hostname'), form.hostname, change('hostname'), { placeholder: 'mac.example.com', disabled: locked }), field(t('ownerEmail'), form.ownerEmail, change('ownerEmail'), { type: 'email', placeholder: 'you@example.com', disabled: locked })),
          h('p', { className: 'hint' }, t('sameUrl')),
          h('details', null, h('summary', null, t('cloudflaredDetails')), field(t('cloudflaredPath'), form.cloudflaredPath, change('cloudflaredPath')), h('p', { className: 'hint' }, t('cloudflaredHint'))),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: form.allowDownload, disabled: locked, onChange: e => change('allowDownload')(e.target.checked) }), t('allowDownload')),
          h('div', { className: 'actions' }, h('button', { type: 'button', className: 'primary', disabled: blocker !== null, 'aria-describedby': blocker ? 'dcf-connect-reason' : undefined, onClick: () => void run('start', form) }, t('connect')), state?.setup ? button(t('resume'), 'resume', {}, { disabled: !!state?.hostReview }) : null, state?.setup && state?.authorized ? button(t('refreshToken'), 'token/refresh', {}, { disabled: locked || !!state?.hostReview }) : null),
          blocker ? h('p', { className: 'reason', id: 'dcf-connect-reason', role: 'status' }, t(BLOCKER_KEY[blocker])) : null,
          state?.download ? h('div', { role: 'status' }, h('p', { className: 'hint' }, 'cloudflared: ', state.download.phase), state.download.total > 0 ? h('progress', { max: state.download.total, value: state.download.received || 0, 'aria-label': t('downloadLabel') }) : null) : null),
        state?.publicUrl ? h('div', { className: 'card' }, h('h3', null, t('cardVerify')),
          h('p', { className: 'hint' }, t('verifyHint')),
          h('div', { className: 'actions' }, anchor(t('enroll'), state.enrollmentUrl), anchor(t('verifyLink'), state.verificationUrl, true)),
          h('p', null, h('span', { className: 'url' }, state.publicUrl)),
          h('div', { className: 'evidence' }, [['unauthenticatedRejected', 'evidenceRejected'], ['owner', 'evidenceOwner'], ['http', 'evidenceHttp'], ['api', 'evidenceApi'], ['websocket', 'evidenceWebsocket']].map(([key, label]) => h('span', { key }, `${state.evidence?.[key] ? '✓' : '○'} ${t(label)}`))),
          state?.lastVerifiedAt ? h('p', { className: 'hint' }, t('lastVerified', { time: new Date(state.lastVerifiedAt).toLocaleString() })) : null,
          h('div', { className: 'actions' }, anchor(ready ? t('openReady') : t('openPending'), state.publicUrl, ready), h('button', { type: 'button', onClick: copyUrl }, copied ? t('copied') : t('copy'))),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: !!state.autoConnect, disabled: locked || !!state.hostReview || (!ready && !state.autoConnect), onChange: e => void run('autoconnect', { enabled: e.target.checked }) }), t('autoConnect'))) : null,
        h('div', { className: 'actions' }, h('button', { type: 'button', disabled: remote || stopping, onClick: () => void control(pending || state?.busy ? 'cancel' : 'stop') }, stopping ? t('stopping') : pending || state?.busy ? t('cancel') : t('stop'))),
        state?.setup ? h('details', null, h('summary', null, t('deleteSummary')), h('p', { className: 'hint' }, t('deleteHint')), field(t('deleteField'), deleteName, setDeleteName), h('div', { className: 'actions' }, button(t('deleteButton'), 'remove', { confirmHostname: deleteName }, { disabled: locked || !state.authorized || deleteName !== state.setup.hostname }))) : null,
        h('details', null, h('summary', null, t('diagnostics')), h('p', null, h('code', null, `Instance: ${state?.instanceId || '—'}`)), state?.binary ? h('p', null, h('code', null, `${state.binary.path} (${state.binary.version})`)) : null, state?.steps?.map(s => h('p', { className: 'hint', key: s.id }, `${t(STEP_KEY[s.id] || 'diagnostics')}: ${s.message || t(STATE_KEY[s.status] || 'stateIdle')}`))),
        h(UpdatePanel, { updates, remote: remote || !/^(?:localhost|\[?::1\]?|127\.\d+\.\d+\.\d+)$/.test(window.location.hostname), version: state?.version, cloudBusy: locked, authorized: state?.authorized, t }),
        h('div', { className: 'footer' }, t('footer'))
      );
    }
    function duplicateLocale(error) {
      const message = String(error?.message || '');
      return message.includes('already registered') || message.includes('already has locale');
    }
    function apply(ctx) {
      let locale = null;
      try { locale = ctx.get('locale'); } catch { locale = null; }
      if (locale?.register) {
        try { locale.register('dsh-cf', { zh: COPY.zh, en: COPY.en }); }
        catch (error) { if (!duplicateLocale(error)) throw error; }
        if (typeof locale.addLanguage === 'function') {
          try { locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }); }
          catch (error) { if (!duplicateLocale(error)) throw error; }
        }
        try { locale.register('dsh-cf', 'ja', COPY.ja); }
        catch (error) { if (!duplicateLocale(error)) throw error; }
      }
      const connection = ctx.get('connection');
      const updates = new UpdateController(connection);
      ctx.effect(() => () => updates.dispose(), 'dsh-cf: updater client');
      function SettingsPanel(props) {
        const translateProp = typeof props?.t === 'function' ? props.t : (key, params) => translate('en', key, params);
        return h(Panel, { connection, updates, t: translateProp });
      }
      const label = () => { try { return locale.bind('dsh-cf')('nav'); } catch { return 'Cloudflare'; } };
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dsh-cf', order: 20, label, locale: 'dsh-cf' }, SettingsPanel));
    }
    return { apply, inject: ['slots', 'connection', 'locale'], UpdateController, PanelSession, connectBlockers, translate, COPY };
  },
});
