# dsh-cf

**Owner-only remote access for DeepSeek Harness through Cloudflare Tunnel and Access.**

DSHの設定画面から、専用のCloudflare Tunnel・DNS・Accessアプリを作成するプラグインです。既存の`cloudflared`を再利用し、所有者のAccessログイン＋WebAuthn追加認証を通してDSHを開きます。Workerのデプロイ、ポート開放、常設の管理サーバーは不要です。

> **0.1.0-alpha.1 / developer preview.** 初版の実装です。実CloudflareアカウントでのOAuth・MFA・Tunnel、実DSHへのインストール、macOS/Windows/iPadOSの実機試験はまだ完了していません。セキュリティ監査済み・本番運用可能とは扱わないでください。パスキー単独ログインではありません。

## 導入

Node.js **22.12以上**。DSH `0.2.1-alpha.2`（upstream `d743267388641bc76f17c45ce8b4c231aed1d32c`）の公開APIを基準にしています。DSHは開発プレビューのため、互換性は固定版で検証してください。

```sh
dsh plugin --profile web add -w github:Aero123421/dsh-cf
# DSHを再起動して Settings → Cloudflare を開く
dsh web
```

レビュー済みコミットを使用する場合:

```sh
dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#<reviewed-commit-sha>'
```

プラグイン自身にビルドやinstallスクリプトはありません。実行時依存は`jose`のみ。Git/npmインストール時に取得します。

**まずWebプロファイルで検証してください。** Desktop版も動的な待受ポートを取得するコードになっていますが、Desktopのプラグイン読み込みとElectronを含む動作保証はまだありません。別のDSHを同じprofile/stateディレクトリで同時に起動しないでください。

## 最初のセットアップ

1. **元の信頼済み接続**（DSHの起動URL、SSH転送、既存の私設ネットワーク経由など）で設定画面を開きます。
2. Cloudflare OAuthで認可します。配布用Client IDはまだ登録・同梱されていないため、当面は自分のOAuthクライアント、または限定権限のAPIトークンを使います。
3. アカウント、DNSゾーン、既存のAccessログイン方法、専用ホスト名、本人のメールを選びます。ワイルドカードや空の所有者指定は受け付けません。
4. 必要な場合だけ、組織の利用可能な認証器にbiometrics/security_keyを追加する変更を、内容確認後に許可します。既存IdP・組織の作成は自動化しません。
5. 「保護設定を作成して接続」。既存バイナリを検出し、なければ明示許可後に専用フォルダへ取得します。DSHの公式configEditorで公開ホストを信頼リストへ追加します。
6. 「認証器の登録画面」でAccessの認証器を準備し、「本人認証してDSHを確認」を開きます。DSHを実際に開いてHTTP・API・WebSocketの通信を確認すると、最後のチェックが付きます。

以後は`https://mac.example.com/`などの公開URLからアクセスします。複数の閲覧端末は同じURLです。別のDSHは別profile・Tunnel・URLで登録してください。

**Tunnelの起動と接続確認済みは別です。** コネクタ登録、未認証アクセスの拒否、所有者の署名付き認証、DSH画面/API/WS応答をそれぞれ表示します。ブラウザを閉じてもホスト側のセットアップ処理は続き、設定画面を開き直すと状態を再取得します。

公開されたDSH内のCloudflare設定ページは**状態の閲覧のみ**です。作成、認可、削除、停止などは元の信頼済みDSH接続から行います。

## Cloudflare側で必要なもの

- Cloudflare管理下のアクティブなDNSゾーンと、その中の未使用の専用サブドメイン。
- 初期設定済みのZero Trust/Access組織と、利用するIdP。Email PINも既存IdPとして選べますが、**それだけでなくWebAuthnを要求するアプリ**を作ります。
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

ゲートは`jose`でRS256署名、issuer、audience、有効期限、token type、所有者メールを検証します。HostとOriginは公開ホストのままDSHへ渡します。`ctx.connection.authenticatedUrl()`で得たDSH起動トークンは**loopbackへの正規Cookie交換だけ**に使います。DSHのCookieはサーバー内部に保持し、ブラウザへのSet-Cookieや状態APIには返しません。

WebSocketも認証済みupgradeだけを通します。アップロード/ダウンロード/SSEはストリーミング転送し、JWT期限または15分の接続上限で閉じます。DSHが401を返しても変更系リクエストを勝手に再送しません。

`trustedHosts`の既存値を保って公式configEditorから永続化します。DSHが表示する元の`publicUrl`や既存Tailscale設定は変更しません。公開URLのコピーはこのプラグインから行います。`0.0.0.0`公開、Hostのloopback偽装、Origin削除、DSH認証の無効化はしません。

## cloudflaredと既存環境

互換な明示パス → 信頼できる一般的なインストール先 → プラグイン専用キャッシュの順で探します。プロジェクトが挿入した任意のPATH上の実行ファイルを自動実行しません。見つからない場合だけ取得許可を求めます。

管理バイナリは`2026.10.0`に固定。公式GitHub ReleaseのSHA-256とサイズを取得し、**検証後にのみ**展開・実行します。公式APIと配布基盤への信頼は必要です。自己管理キャッシュは再実行時にもハッシュを検査します。既存バイナリには`--token-file`を利用できる2025.4.0以降が必要です。

macOS x64/arm64、Linux x64/arm64/arm、Windows x64/ia32の取得分岐があります。対象外のCPUは手動で実行ファイルを指定してください。**各OSの実機で動作確認済みという意味ではありません。**

既存サービスの停止、`cloudflared service install`、`cert.pem`や`~/.cloudflared/config.yml`の変更、同名Tunnelの自動流用は行いません。専用の子プロセスだけを管理し、DSH終了・クラッシュ時はguardianがその子を停止します。通信再試行はcloudflaredの機能を利用し、実行ファイルの致命的終了は隠さずエラーにします。

## 保存場所と運用

`<active-profile-dir>/.dsh-cf/`に非秘密のstate、専用Tunnel token、任意の管理バイナリを保存します。POSIXはディレクトリ0700、state/token0600。**OSキーチェーン暗号化ではありません。** WindowsはユーザーフォルダのACLも管理してください。同じOSユーザーの悪意あるプロセスや管理者からは保護できません。

- 一時停止: ゲートと専用コネクタを閉じ、Cloudflareの専用リソースは保持。
- 自動接続: 初回の実通信確認後にチェックを有効化した場合だけ、DSH起動時に再接続。
- 公開設定の削除: ホスト名の再入力を求め、記録済みのIDと所有マーカーを検証して専用DNS → Tunnel → Accessの順で削除。
- アンインストール: 先に設定画面から公開設定を削除してから`dsh plugin --profile web remove -w dsh-cf`。共有MFA設定や既存バイナリは残す。

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

初版作成環境では、依存を取得できないオフライン環境向けの明示モードで**62件成功、JWT実暗号テスト1件スキップ**。これはJOSEの実検証まで成功したという意味ではありません。

```sh
# オフラインの契約/通信テストだけ。リリース判定には使わない。
DSH_CF_OFFLINE_TEST=1 npm run check
```

HTTP/WSの実loopbackソケット、DSH契約を模した上流、偽装ヘッダー拒否、Cookie非流出、POST非再送、OAuth state/PKCE/キャンセル、API競合と不明なPOST、専用子プロセス停止、ファイル権限/ロックをテストしています。Cloudflare APIはテスト用応答です。

設定UIはChromiumのテスト用Hook/RPCハーネスで1100px/390px幅、アカウント選択、トークン入力の消去、状態更新、停止ボタン、横はみ出しを確認しています。**実DSHのReact、Safari/Touch ID、実Cloudflareの認証フローは別の検証**です。

公開前に最低限、`npm ci && npm run check`、実DSHインストールと再起動、OAuthの同一PC/SSH構成、WebAuthn登録と紛失復旧、Accessポリシー/失効、Mac/Windows/Linux、iPadOSの実操作を確認してください。`SECURITY.md`も参照してください。

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
