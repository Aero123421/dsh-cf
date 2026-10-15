# dsh-cf

**Owner-only remote access for DeepSeek Harness through Cloudflare Tunnel and Access.**

DSHの設定画面から、専用のCloudflare Tunnel・DNS・Accessアプリを作成するプラグインです。既存の`cloudflared`を再利用し、所有者のAccessログイン＋WebAuthn追加認証を通してDSHを開きます。Workerのデプロイ、ポート開放、常設の管理サーバーは不要です。

> **0.1.0-alpha.3 / developer preview.** 停止・認証・接続管理と設定の読み戻しを修正したプレビュー版です。旧版`0.1.0-alpha.2`では、実DSH（`0.2.1-alpha.2`、Linux）へのインストールと、DSH側の連携（設定画面・設定用通信・`trustedHosts`編集・セッション交換・HTTP/API/WebSocket中継・自動再接続・異常終了時の停止）を実機で確認しています。**実CloudflareアカウントでのOAuth・API作成・Accessログイン/WebAuthn・Tunnel登録と、macOS/Windows/iPadOSの実機試験はまだです。** セキュリティ監査済み・本番運用可能とは扱わないでください。パスキー単独ログインではありません。確認内容の詳細は「検証」を参照してください。

## 導入

Node.js **22.12以上**。公開APIの基準は DSH `0.2.1-alpha.2`（upstream `d743267388641bc76f17c45ce8b4c231aed1d32c`）です。`@deepseek-ai/dsh` の peer は `>=0.2.1-alpha.2 <0.3.0-0` です。DSH は起動時にこの範囲を `semver.satisfies`（`includePrerelease: true`）で見るため、`0.2.1-alpha.2`、`0.2.1-alpha.3`、それ以降の 0.2 系（プレリリースを含む）では読み込まれ、`0.3.0` とそのプレリリースでは読み込まれません。上限を `<0.3.0` にすると、同じオプションでは `0.3.0` のプレリリースまで含まれます。下限は実機で確認した `0.2.1-alpha.2` です。`0.2.0-rc.2` 以前はこのプラグインの確認対象外です。Linux・Node.js 22.23.3 で、公開 npm の DSH `0.2.1-alpha.2` と `0.2.1-alpha.3` の新しい web profile に tarball を入れて起動し、未認証の `GET /`、起動トークンの Cookie 交換、`POST /dsh-cf/status` を確認しています。手順と結果は「検証」にあります。

```sh
dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#v0.1.0-alpha.3'
# DSHを再起動して Settings → Cloudflare を開く
dsh web
```

レビュー済みコミットを使用する場合:

```sh
dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#<reviewed-commit-sha>'
```

プラグイン自身にビルドやinstallスクリプトはありません。実行時依存は`jose`と`semver`です。Git/npmインストール時に取得します。

**まずWebプロファイルで検証してください。** Desktop版も動的な待受ポートを取得するコードになっていますが、Desktopのプラグイン読み込みとElectronを含む動作保証はまだありません。別のDSHを同じprofile/stateディレクトリで同時に起動しないでください。

## 最初のセットアップ

1. **元の信頼済み接続**（DSHの起動URL、SSH転送、既存の私設ネットワーク経由など）で設定画面を開きます。
2. Cloudflare OAuthで認可します。配布用Client IDはまだ登録・同梱されていないため、当面は自分のOAuthクライアント、または限定権限のAPIトークンを使います。
3. アカウント、DNSゾーン、既存のAccessログイン方法、専用ホスト名、本人のメールを選びます。ワイルドカードや空の所有者指定は受け付けません。
4. 必要な場合だけ、組織の利用可能な認証器にbiometrics/security_keyを追加する変更を、内容確認後に許可します。既存IdP・組織の作成は自動化しません。
5. 「保護設定を作成して接続」。既存バイナリを検出し、なければ明示許可後に専用フォルダへ取得します。DSHの公式configEditorで公開ホストを信頼リストへ追加します。
6. 「認証器の登録画面」（Access の App Launcher、`https://<team>.cloudflareaccess.com/`）で **Account → MFA devices** から生体認証またはセキュリティキーを登録し、「本人認証してDSHを確認」を開きます。DSHを実際に開いてHTTP・API・WebSocketの通信を確認すると、最後のチェックが付きます。

以後は`https://mac.example.com/`などの公開URLからアクセスします。複数の閲覧端末は同じURLです。別のDSHは別profile・Tunnel・URLで登録してください。

**Tunnelの起動と接続確認済みは別です。** コネクタ登録、未認証アクセスの拒否、所有者の署名付き認証、DSH画面/API/WS応答をそれぞれ表示します。ブラウザを閉じてもホスト側のセットアップ処理は続き、設定画面を開き直すと状態を再取得します。ブラウザを閉じたことやWebSocketの15分上限は、接続を止めたことや上流の障害としては表示しません。ある通信路でDSHが成功を返したあとに一時的な5xxを返しても、その確認、Ready、保存した最終確認時刻は残します。その通信路で一度も成功する前の5xxは成功として記録しません。認証拒否は確認を取り消します。Tunnelが戻ったあとは、過去の成功を残したまま、DSHの応答を再確認します。過去の確認時刻は「最終確認」と表示し、今の接続の成功には使いません。

設定画面の文言はDSHのlocaleに従います。このタブは英語・日本語・中国語を登録します。日本語を追加するため、ブラウザが日本語のときはDSHの言語選択に日本語が現れます。他の画面に日本語の辞書がなければ、その画面は英語へ戻ります。「保護設定を作成して接続」が押せないときは、認可・ホスト名・MFA・処理中など、その理由をボタンのそばに1文で出します。

組織がアイデンティティプロバイダーのMFAで独立したWebAuthnを省略できる場合、または応答からそれが判断できない場合は公開しません。`amr_matching_enabled`、`amr_matching_session_duration`、`amr_session_duration` の3つがすべて無い応答も判断できないものとして公開しません。明示的にその置換が無効で、期間も無い場合だけ、独立したWebAuthnとして扱います。このプラグインはその共有設定をオフにしません。Tunnel tokenをCloudflareが更新したあとは、管理認可がある接続から「コネクタの資格情報を再取得して接続」で、所有するTunnelをAPIで読み、返った値がアカウントID・Tunnel ID・秘密を持つconnector tokenであり、そのIDがこのインスタンスと一致するときだけファイルを置き換えます。保存済みtokenでの再接続に管理認可は不要です。再取得に失敗しても、保存済みのtokenファイルは置き換えず、動いているGateとコネクタも止めません。tokenを読めても、動いているコネクタの再起動も、保存済み設定からの再開もできないときは成功にしません。

OAuthの進行、拒否、期限切れ、交換失敗はHostが保持します。停止しても、拒否・期限切れ・交換失敗とその理由は取り消しへ置き換えません。進行中の認可だけを取り消します。状態APIには認可URL、認可コード、PKCE、管理tokenを含めません。進行中のURLは、元の管理接続からの再取得だけで戻します。処理の途中でも停止を送れます。停止中は、Hostが完了を返すまで次の変更を始めません。

公開されたDSH内のCloudflare設定ページは**状態の閲覧のみ**です。作成、認可、削除、停止などは元の信頼済みDSH接続から行います。

## Cloudflare側で必要なもの

- Cloudflare管理下のアクティブなDNSゾーンと、その中の未使用の専用サブドメイン。
- 初期設定済みのZero Trust/Access組織と、利用するIdP。Email PINも既存IdPとして選べますが、**それだけでなくWebAuthnを要求するアプリ**を作ります。
- 認証器を登録するための App Launcher。Cloudflareの独立MFAでは、利用者は App Launcher の **Account → MFA devices** から認証器を登録します（直接リンク: `https://<team>.cloudflareaccess.com/AddMfaDevice`）。App Launcher にログインできるよう、Access 設定で App Launcher に本人のメールを許可するポリシーがあることを確認してください。プラグインは App Launcher の設定を変更しません。
- 本人のメールアドレス。DSH自体は複数の一般利用者を権限分離する設計ではありません。
- 対象アカウント/ゾーンに必要な権限を持つOAuth grantまたはAPI token。

### APIトークンの権限

CloudflareのUI表記でRead/WriteがRead/Edit等になる場合があります。対象アカウント・対象ゾーンに限定してください。

| 対象 | 使用する権限/用途 |
|---|---|
| Account Settings | Read: アカウント一覧 |
| Zone | Read: 対象ゾーンの検証 |
| DNS | Read + Edit: 専用CNAMEの検査・作成・削除 |
| Cloudflare Tunnel | Read + Edit: 専用Tunnel、設定、接続トークン |
| Access: Apps and Policies | Read + Edit: 専用アプリと所有者ポリシー |
| Access: Organizations, Identity Providers, and Groups | Read: 組織・IdPの確認。**MFA有効化操作を使う場合だけEditも必要** |

Global API Keyは使いません。読み取り検証を省略してWriteだけで構築する動作もしません。権限不足は失敗として表示します。

### OAuthクライアントを準備する

Cloudflare公式の公開クライアント（`token_endpoint_auth_method: none`、Authorization Code + S256 PKCE）を登録します。Client IDとScope IDは公開設定であり、Client Secretは埋め込みません。

既定の登録先URI:

```text
http://127.0.0.1:8789/dsh-cf/oauth/callback
```

そのURIをCloudflare側で登録・許可できることを確認してください。登録の実機検証は未完了です。Scope IDはCloudflareの登録画面、または公式`/oauth/scopes` APIの値を使います。プラグインは架空のScope IDを生成しません。

DSHのprofile patchの設定例:

```yaml
- id: dsh-cf
  config:
    oauthClientId: YOUR_REGISTERED_PUBLIC_CLIENT_ID
    oauthScopes:
      - YOUR_REGISTERED_SCOPE_ID
    oauthCallbackPort: 8789
    cloudflaredPath: ''
```

OAuth Client ID / Scope IDは設定画面から今回の認可用に入力することもできます。作者が一般公開クライアントを配布するには、Cloudflare側の公開設定と発行者ドメイン確認が必要です。リポジトリの作成だけではOAuthアプリは作成されません。

**ヘッドレス環境:** Cloudflareは第三者クライアントのDevice Authorization Grantを提供していません。Ubuntu上のDSHをMacのブラウザから設定する場合、既定のloopback callbackはMacへ戻ります。SSHでcallbackポートを転送するか、認可後に開けなかったcallback URL全体を、元の信頼済みDSH設定画面の回収欄へ貼り付けます。state・PKCE・期限・接続先を照合し、一度だけ交換します。認可コード入りのURLをIssueやチャットへ貼らないでください。

管理用アクセストークンは**メモリ内のみ**です。再起動、期限切れ、ローカルで「忘れる」を実行した後の管理操作には再認可が必要です。通常のTunnel再接続は保存済みの専用connector tokenで動きます。「忘れる」はCloudflare側の認可取消しや全セッション失効ではありません。

## 接続の仕組み

```text
Browser (HTTPS)
  → Cloudflare Access: owner-only login + independent WebAuthn MFA
  → Named Tunnel
  → cloudflared (dedicated child; no system service changes)
  → local Access JWT gate (127.0.0.1)
  → existing DSH Web listener (loopback; real dynamic port)
```

ゲートは`jose`でRS256署名、issuer、audience、有効期限、token type、所有者メールを検証します。ホストの時計が最大30秒遅れていても発行直後のトークンを受け付けますが、有効期限は延長しません。HostとOriginは公開ホストのままDSHへ渡します。`ctx.connection.authenticatedUrl()`で得たDSH起動トークンは**loopbackへの正規Cookie交換だけ**に使います。DSHのCookieはサーバー内部に保持し、ブラウザへのSet-Cookieや状態APIには返しません。

WebSocketも認証済みupgradeだけを通します。アップロード/ダウンロード/SSEはストリーミング転送し、JWT期限または15分の接続上限で閉じます（再認証のため。DSHの画面は自動で再接続することを実機で確認済み）。アップロードは100 MB、DSHの応答待ちは100秒まで（どちらもCloudflareのFree/Proプランの上限に合わせた値）。DSHが401を返しても変更系リクエストを勝手に再送しません。

設定画面とプラグインの通信（`/dsh-cf/<操作>`）は、DSHのWebServerにルートを登録し、DSHのConnectionと同じHost/Origin/Cookie判定（`connection.requestRejection()`）で受け付けます。DSH `0.2.1-alpha.2`の`connection.rpc.handle()`はプラグインのコンテキストから呼ぶと例外になるため使っていません。通信形式は同じです。

`trustedHosts`の既存値を保って公式configEditorから永続化します。DSHが表示する元の`publicUrl`や既存Tailscale設定は変更しません。公開URLのコピーはこのプラグインから行います。`0.0.0.0`公開、Hostのloopback偽装、Origin削除、DSH認証の無効化はしません。

## cloudflaredと既存環境

互換な明示パス → 信頼できる一般的なインストール先 → プラグイン専用キャッシュの順で探します。プロジェクトが挿入した任意のPATH上の実行ファイルを自動実行しません。見つからない場合だけ取得許可を求めます。

管理バイナリは`2026.10.0`に固定。公式GitHub ReleaseのSHA-256とサイズを取得し、**検証後にのみ**展開・実行します。公式APIと配布基盤への信頼は必要です。自己管理キャッシュは再実行時にもハッシュを検査します。既存バイナリには **2025.6.1以降**が必要です（`--token-file`は2025.4.0、接続状態の検出に使うJSONログ出力`--output json`は2025.6.1から）。

macOS x64/arm64、Linux x64/arm64/arm、Windows x64/ia32の取得分岐があります。対象外のCPUは手動で実行ファイルを指定してください。**各OSの実機で動作確認済みという意味ではありません。**

既存サービスの停止、`cloudflared service install`、`cert.pem`や`~/.cloudflared/config.yml`の変更、同名Tunnelの自動流用は行いません。専用の子プロセスだけを管理し、DSH終了・クラッシュ時はguardianがその子を停止します。通信再試行はcloudflaredの機能を利用し、実行ファイルの致命的終了は隠さずエラーにします。

## 保存場所と運用

`<active-profile-dir>/.dsh-cf/`に非秘密のstate、専用Tunnel token、任意の管理バイナリを保存します。POSIXはディレクトリ0700、state/token0600。**OSキーチェーン暗号化ではありません。** WindowsはユーザーフォルダのACLも管理してください。同じOSユーザーの悪意あるプロセスや管理者からは保護できません。

- 一時停止: ゲートと専用コネクタを閉じ、Cloudflareの専用リソースは保持。
- 自動接続: 初回の実通信確認後にチェックを有効化した場合だけ、DSH起動時に再接続。
- 公開設定の削除: ホスト名の再入力を求め、記録済みのIDと所有マーカーを検証して専用DNS → Tunnel（残っている接続記録を先に消去）→ Accessの順で削除。
- アンインストール: 先に設定画面から公開設定を削除してから`dsh plugin --profile web remove -w dsh-cf`。共有MFA設定や既存バイナリは残す。
- ホスト確認: stateには作成したPCの識別値（OS・ホスト名・ホームディレクトリから算出）を記録します。macOSのネットワーク変更やコンテナの再作成などで値が変わると、プラグインは読み込みますが、**接続と自動接続を止めて「このPCで使い続ける」の確認を求めます**。別PCへコピーした設定を同時に動かすと同じTunnelに2台がつながるためです。確認したホストは記憶され、次からは確認不要です。削除操作は確認前でも行えます。
- プロファイルのロック: 同じprofileを2つのDSHで同時に使えないよう`owner.lock`を置き、使用中のDSHは数秒ごとに更新します。DSHが異常終了して残ったロックは、更新が止まっていることを確認してから次回起動時に自動で回収します。別コンテナではPIDの存在・一致・不在だけで所有者の生死は判断できないため、すべての既存ロックを数秒観測します。更新が続いているロックは拒否します。所有権の喪失を検出したDSHは、自分の公開接続を停止してstate/tokenの書き込みを止めます。

削除時もDSHの既存設定を推測して巻き戻しません。プラグインが追加した`trustedHosts`のホスト名が不要になった場合は、DSH設定でその1件だけを外してください。Hostの信頼設定自体は本人認証を解除するものではありません。

### 不明な書き込みの復旧

APIのPOSTがCloudflare側で成功しても応答が失われる場合があります。その際は`pending`を残して停止し、同じPOSTを自動再送しません。

DSHを停止し、stateとtokenを非公開にバックアップして、state内の`pending.kind/path/marker`を確認してください。Cloudflareでその**インスタンスのUUIDマーカー・対象ホスト・記録されたID**だけを確認します。成功済みリソースが記録IDと一致するか、未記録の同一作成リソースを確認して削除したか、そもそも作成されなかったことを確かめた後で、ローカルstateの`pending`を`null`へ戻して再開します。無関係のリソースを名前の類似だけで削除/取り込みしないでください。判断できない場合は停止したまま調査してください。

## 検証

```sh
npm ci
npm run check
# 実デプロイ後の未認証アクセス拒否だけを非破壊確認
npm run test:live -- https://mac.example.com/ your-team.cloudflareaccess.com
```

ロックファイルは公式jose `v6.2.12`のimmutable release tarballと公開SHA-256に固定しています。npm/DSH側で依存をインストールしてからテストしてください。

```sh
# 実際のcloudflaredが接続用の引数をそのまま受け付けるかも確認する（任意・ネットワーク不要）
DSH_CF_CLOUDFLARED=/path/to/cloudflared npm test

# オフラインの契約/通信テストだけ。リリース判定には使わない。
DSH_CF_OFFLINE_TEST=1 npm run check

# 公開中の DSH alpha が peer 範囲に入るか。npm registry と app-boot の tarball を読む。
npm run check:dsh
```

### 自動テスト（0.1.0-alpha.2、Linux x64・Node 22.22）

`npm ci && npm run check`で**93件中92件成功、1件は上記の任意テスト**（cloudflared 2026.10.0公式バイナリを指定して実行し成功）。JOSEの実RSA署名検証を含みます。HTTP/WSの実loopbackソケット、DSH契約を模した上流、設定用通信の形式と認証、偽装ヘッダー拒否、Cookie非流出、POST非再送、OAuth state/PKCE/キャンセル/取り消し、API競合と不明なPOST、ページング、Tunnel削除前の接続消去、専用子プロセス停止、ファイル権限/ロック/ホスト確認をテストしています。Cloudflare APIはテスト用応答です。

追加の回帰検証（Linux x64、Node **24.19.0**）では、同じチェックで**115件中114件成功、任意の実cloudflaredテスト1件スキップ**。OAuth開始途中の停止、別PID名前空間のheartbeatと所有権喪失、HTTP/WS共通の64接続上限、IPv4/IPv6/localhostのセッション交換と中継、コネクタ異常終了・一時切断からの復帰を確認しています。実Cloudflare連携の検証結果が増えたという意味ではありません。

### 修正版の回帰検証（0.1.0-alpha.3）

Linux x64・Node **24.19.0**で`npm ci && npm run check`を実行し、**138件中137件成功、失敗0、任意の実cloudflaredテスト1件スキップ**。停止・破棄・再開の競合、OAuth/API認証の切り替え、管理リクエストのキャンセル、拒否したWebSocketの後片付け、複数Tunnel接続の状態集計、Accessチーム名と初回Tunnel/DNS設定の読み戻しを回帰テストに追加しました。読み戻しに失敗した設定は再開できず、再認可して設定の検証を完了する必要があります。設定画面の通信回復時に古い再接続警告が消えるよう修正しています。

Cloudflareの応答とconnectorの複数接続ログにはローカルfixtureを使っています。下記の実DSH検証は旧版の記録であり、この修正版について実Cloudflare・実WebAuthnの検証を追加したものではありません。

### 実DSHでの待受（0.1.0-alpha.4、Linux x64・Node.js 22.23.3）

公開 npm の `@deepseek-ai/dsh@0.2.1-alpha.2` と `@deepseek-ai/dsh@0.2.1-alpha.3` に、レビュー対象コミットの tarball と、この修正を含んだ tarball を、それぞれ新しい web profile へ `dsh plugin --profile web add` で入れ、`dsh web --no-open --host 127.0.0.1` で起動した。4通りとも HTTP は応答した。未認証の `GET /` は 401、起動トークンの交換は 303 と Cookie、Cookie 付きの `GET /` は HTML 200、`POST /dsh-cf/status` は `type: server-response`、`ok: true`、`phase: idle`、`version: 0.1.0-alpha.4` だった。応答本文に起動トークンは含まれない。ここまでが確認範囲で、実 Cloudflare、Access、cloudflared、`trustedHosts` の再確認は含まない。

公開されている `dsh` の `lib/bin.js` は `import.meta.main` が真のときだけ CLI を実行する。Node.js 22.14.0 ではその値が未定義で、`0.2.1-alpha.2` と `0.2.1-alpha.3` の `dsh --version` は終了コード 0、標準出力も標準エラーも空だった。その状態では待受が始まらない。この確認に使った Node.js 22.23.3 ではその値が真で、上記の待受が始まった。

### 実DSHでの確認（0.1.0-alpha.2）

npm公開版のDSH `@deepseek-ai/dsh@0.2.1-alpha.2`（Linux、webプロファイル）に、READMEの`dsh plugin --profile web add`でインストールして確認しました。

| 項目 | 結果 |
|---|---|
| `github:Aero123421/dsh-cf`からのインストール | ✓ |
| 設定画面にCloudflareの項目が出て、状態を取得できる（Chromium、1280/768/390px幅） | ✓ |
| 設定用通信：DSHのCookieなしは401、別ホストは403 | ✓ |
| 公式configEditorでの`trustedHosts`追記（既存の`!!js`式を保持）と、その後のConnection再読込 | ✓ |
| DSHの起動トークン→Cookie交換（loopback） | ✓ |
| ゲート経由でDSHの画面・API・WebSocketが動く（TLS終端とAccess JWT付与を模した前段＋ローカルRSA鍵で署名したJWT） | ✓ |
| JWTなし／別のメール／期限切れは401、公開URLからの設定変更・起動トークン・異なるOriginは403、Set-Cookieは出ない | ✓ |
| 15分上限で切れたWebSocketをDSHの画面が自動で再接続する（上限を12秒にして確認） | ✓ |
| DSH起動時の自動接続 → cloudflared 2026.10.0を正しい引数で起動 → 登録できない場合はエラー表示して子プロセスを停止 | ✓ |
| DSHを`kill -9`した後、cloudflaredと監視プロセスが自動で終了し、次回起動時に残ったロックを回収 | ✓ |
| ホスト識別値が変わったときの確認カードと、確認後の再接続 | ✓ |

**未確認:** 実CloudflareアカウントでのOAuth（loopbackコールバックの登録可否を含む）、APIによる作成と読み戻し（Accessアプリの`mfa_config`の返し方など）、Accessログインと実WebAuthn、Tunnelの実登録、`npm run test:live`、macOS/Windows/iPadOS/Safari、DSH Desktop。この検証環境からCloudflare APIへは接続できないため、これらは自分のテスト用アカウントとホスト名で確認してください。

公開前に最低限、`npm ci && npm run check`、上記の未確認項目、WebAuthn登録と紛失復旧、Accessポリシー/失効を確認してください。`SECURITY.md`も参照してください。

## 課金とスコープ

このコードはWorker、D1、R2、Durable Objects、有料プランへの変更を作成・実行しません。ただし、**Cloudflareアカウント全体の請求上限を保証するものではありません**。ドメイン、Accessの契約や座席、既存の有料機能は別です。実行前に自分のアカウントの現行料金・契約を確認してください。

Quick Tunnel、ドメイン不要のworkers.dev中継、統合デバイス一覧、多人数RBAC、独自パスキーDB、OSサービスの自動登録は実装範囲外です。

## 参照した一次資料

- [DSH公開プロキシ仕様](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/docs/user/guide/public-deployments.md)
- [DSH configEditor実装](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/boot/config-editor/src/index.ts)
- [Cloudflare OAuthクライアント](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
- [Access Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/)
- [Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [cloudflared実行パラメーター](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [jose v6.2.12](https://github.com/panva/jose/releases/tag/v6.2.12)

MIT。DeepSeek/Cloudflareの公式製品ではありません。

## プラグインの更新

「設定 → Cloudflare」の「プラグインの更新」で、実行版・導入版と更新先を確認できます。alpha版では最初にプレリリースを選びます。安定版とプレリリースを混ぜず、選択した更新先のGitHubリリース一覧を確認します。確認しただけでは導入しません。

「プラグインを更新する」は、確認したリリースの明示タグをDSHのプラグイン管理へ渡します。現在のGitHub配布経路と版固定、bundleのON/OFFを維持します。ソースのJSから導入するため、Release assetやインストール時のビルドは不要です。ローカルの開発ディレクトリ・tgz・npm等から導入した場合や、画面から変更できない環境では、元の配布元から手動更新してください。

更新候補のpackage名・版・JS entry・bundle宣言とDSH対応範囲を確認し、導入済みの版を下げません。DSHの起動時は、公開されている app-boot の `evaluatePluginCompatibility` が `semver.satisfies(runtime, range, { includePrerelease: true })` でこのプラグインの peer を見ます。そのため `>=0.2.1-alpha.2 <0.3.0-0` は `0.2.1-alpha.2` と `0.2.1-alpha.3` で読み込まれます。更新画面の判定はそれより狭く、上限のない範囲（`*`、`x`、`>=0` など）と `workspace:` 指定は導入しません。上限のある `^0.2.1-alpha.2`、`~0.2.1-alpha.2`、`0.2.x`、ハイフン範囲、完全一致は、実行中の版がその範囲に入るときだけ導入します。`~0.2.1` は `0.2.1-alpha.3` を含みません。空白や解釈できない範囲も導入しません。

導入は確認したタグの `github:Aero123421/dsh-cf#<tag>` を DSH の `installBundle` に渡します。DSH `0.2.1-alpha.3` で HMR が有効なとき、保存済みの依存指定と文字列が一致する spec は `already-installed` で拒否され、profile は変更されません。そのときは同じタグの `git+https://github.com/Aero123421/dsh-cf.git#<tag>` で同じ導入をやり直します。保存済みの文字列と違うため、pnpm は実行されます。`0.2.1-alpha.2` では最初の `installBundle` が、入っているパッケージの上から導入します。

DSH のプラグイン設定にある公式の更新は、プラグイン管理画面が `removeBundle` のあと `installBundle` します。管理画面は削除する対象とは別のプラグインなので、削除のあとも処理を続けられます。この画面から自分自身を `removeBundle` すると、HMR の再読込でこのプラグインが止まり、続く導入が実行されません。そのためここでは削除しません。両方の指定が `already-installed` のまま導入版が候補より古いときは失敗を表示し、DSH のプラグイン設定か手動の同じタグでの導入を案内します。

`0.1.0-alpha.4` の更新確認は、peer を完全一致の版番号として読みます。範囲を書いたリリースは、その版の画面からは導入できません。DSH のプラグイン設定か `dsh plugin` で一度入れてください。

更新はcloudflaredの取得・更新やTunnel/DNS/Accessの変更とは別の操作です。保存済みの所有IDや接続設定を作り直しません。公開Tunnelから更新操作はできず、元のローカル管理接続を使用します。再起動が必要でCloudflare API tokenを入力済みの場合は、メモリー内のtokenの再入力が必要になることを表示します。

接続が切れても同じ導入を再送せず、操作ID・導入版・実行版を照合します。取得できない結果は「結果が不明」と表示し、新しい候補の導入より先に元の操作を確認します。機密情報を含まない操作ID・候補版・結果だけをprofileの`.dsh-cf-updates`へ保存します。ブラウザ側の操作IDと更新先は、Hostが返したprofile固有の識別子で分けて保存します。
