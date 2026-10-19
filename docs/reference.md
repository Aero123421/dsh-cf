# 詳細リファレンス

[使い方とトラブル対処に戻る](../README.md)

API権限、内部構成、停止・復旧、過去バージョンの検証記録です。過去の検証で使った確認用リンクは、現在の日常利用では不要です。

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

### 管理用APIトークンの扱い

OAuthは使いません。配布用の公開OAuthクライアントがなく、クライアントシークレットや永続的な更新トークンも持たないためです。Cloudflareの管理操作には、上の権限のAPIトークンを使います。

トークンは**メモリ内のみ**で、検証してから1時間で失効します。状態にその失効時刻（`authorization.until`）を載せ、失効したトークンは破棄します。「忘れる」・プラグインの停止・DSH終了でも消えます。新しいトークンの検証中に別のトークンを入力した場合は、新しい方が優先され、取消した要求の遅れた結果は反映されません。管理操作（設定の保存と接続、公開設定の削除、書き込み結果の復旧、接続トークンの再取得）には有効なトークンが必要です。通常のTunnel再接続と自動復旧は、保存済みの専用connector tokenで動き、トークンを使いません。「忘れる」はCloudflare側のトークンの取消しや全セッション失効ではありません。

## 接続の仕組み

```text
Browser (HTTPS)
  → Cloudflare Access: owner-only login (+ optional WebAuthn MFA)
  → Named Tunnel
  → cloudflared (dedicated child; no system service changes)
  → local Access JWT gate (127.0.0.1)
  → existing DSH Web listener (loopback; real dynamic port)
```

ゲートは`jose`でRS256署名、issuer、audience、有効期限、token type、所有者メールを検証します。ホストの時計が最大30秒遅れていても発行直後のトークンを受け付けますが、有効期限は延長しません。HostとOriginは公開ホストのままDSHへ渡します。`ctx.connection.authenticatedUrl()`で得たDSH起動トークンは**loopbackへの正規Cookie交換だけ**に使います。DSHのCookieはサーバー内部に保持し、ブラウザへのSet-Cookieや状態APIには返しません。

すべての要求はJWTを検証してから転送するため、DSHとのCookie交換は最初の検証済み要求（API・WebSocket・ページのどれでも）で遅延して行います。確認用リンクや有効化の段階はありません。本人確認の証跡（`evidence.owner`）は、JWTの検証とCookie交換の両方が成功した後にだけ記録します。Cookie交換の失敗はログインの失敗ではなくDSH側の問題として502で返し、ログアウトのリンクを出しません。

Accessのチーム鍵（`/cdn-cgi/access/certs`）に届かないとき（タイムアウト・通信失敗）は、ログインし直しを促さず、このPCが確認できないことと再試行を伝える503のページを返します。直前に取得できた鍵は、最後に鍵を引けた時刻から最大24時間、再取得に失敗している間だけ使い、その鍵集合に無かったkidには使いません。別のアカウントでログインした場合は「許可されていません」とAccessのログアウトリンクを表示します。エラーページはライト/ダークの配色に対応します。HTTP要求の同時処理は256、WebSocketは別枠で64までです。

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

- 一時停止: 専用コネクタを先に止め、次にゲートを閉じます（cloudflaredが閉じた後のポートへ転送しないため）。Cloudflareの専用リソースは保持し、停止したこと（`paused`）をstateへ保存します。自動接続の設定は変えません。保存した一時停止は、再開・接続を押すまでDSH再起動後も有効です。DSHの終了・プラグインの停止・所有権の喪失は一時停止を保存しません。
- 取消し: 実行中の操作と管理リクエストだけを中断します。アカウントの読み込みなどの副次的なリクエストを取り消しても、動作中の公開は止めません。公開の作り直しに入った操作を取り消した場合は、作りかけの公開を閉じて停止中（`offline`）になります（一時停止は保存しません）。再試行の待機も止めます。
- 自動接続: 初回の実通信確認後にチェックを有効化した場合だけ、DSH起動時に再接続。一時停止中・ホスト確認待ち・設定確認が未完了・書き込み結果の不明がある場合は行いません。
- 自動復旧: 起動時の再接続が一時的な原因で失敗したとき、公開中にcloudflaredが予期せず終了したとき、保存済みの接続トークンで`resume`と同じ経路を再試行します（Cloudflareへの書き込みなし）。待ち時間は5・15・30・60・120秒、その後は300秒ごとで、成功するか操作されるまで続きます。再試行する原因は`CONNECTOR_TIMEOUT`・`CONNECTOR_EXIT`（起動失敗を含む）・`EDGE_CHECK`・`DSH_PORT`/`DSH_API`/`DSH_TIMEOUT`/`DSH_CONNECTION`・`GATE_PORT_BUSY`です。`UNPROTECTED`（未認証URLが成功を返した）、`SETUP`、`HOST_REVIEW`、`WRITE_UNKNOWN`、ロック・状態の異常、バイナリ・ダウンロードの異常、`*_CHANGED`（資源の不一致）は再試行せず停止のままです。タイマーはunrefでコントローラーが所有し、一時停止・接続・再開・削除・取消し・破棄で止まり、世代を照合するため古いタイマーが公開を復活させません。認可が必要な「設定を保存して接続」は自動再試行の対象外です。
- ローカルポート: 保存済みのゲートポートが使用中のとき、再接続は`GATE_PORT_BUSY`で失敗して再試行します。認可した接続では新しいポートを選び、専用Tunnelの転送先を更新します。マーカーで所有を確認したTunnelについて現在の設定と目的の設定を比べ、初回、またはローカルのポートだけが違うときだけPUTし、正確に読み戻します。それ以外の差は`TUNNEL_CHANGED`で拒否します。
- 公開設定の削除: ホスト名の再入力を求め、記録済みのIDと所有マーカーを検証して専用DNS → Tunnel（残っている接続記録を先に消去）→ Accessの順で削除。自動接続を先にオフにし、一時停止の記録も消します。このプラグインが追加した`trustedHosts`のホスト名があれば、公式configEditorでその分だけを元に戻します（下記）。
- アンインストール: 先に設定画面から公開設定を削除してから`dsh plugin --profile web remove -w dsh-cf`。共有MFA設定や既存バイナリは残す。
- ホスト確認: stateには作成したPCの識別値を記録します。以前の版はOS・ホスト名・ホームディレクトリから算出しており、macOSのネットワーク変更で変わります。この版はOSの機械ID（Linuxの`/etc/machine-id`または`/var/lib/dbus/machine-id`、macOSの`ioreg`の`IOPlatformUUID`、Windowsの`reg query`の`MachineGuid`）から導いた値を併用します。旧版の値がこのPCのものと一致する状態は、確認なしで機械IDへ移行します。機械IDを読めないPCは従来のホスト名由来の値で判定します。値が異なると、プラグインは読み込みますが、**接続（起動時の自動接続・開始・再開・自動再試行）を止めて「このPCで使い続ける」の確認を求めます**。このとき自動接続の設定は変えません。確認すると、自動接続がオンで一時停止していなければ自動で再開します。別PCへコピーした設定を同時に動かすと同じTunnelに2台がつながるためです。確認したホストは記憶され、次からは確認不要です。削除操作は確認前でも行えます。仮想マシンのイメージを複製すると機械IDも複製されるため、この確認では見分けられません。
- プロファイルのロック: 同じprofileを2つのDSHで同時に使えないよう`owner.lock`を置き、使用中のDSHは数秒ごとに更新します。DSHが異常終了して残ったロックは、更新が止まっていることを確認してから次回起動時に自動で回収します。別コンテナではPIDの存在・一致・不在だけで所有者の生死は判断できないため、すべての既存ロックを数秒観測します。更新が続いているロックは拒否します。所有権の喪失は、ロックが読めて別のnonceになっている、ロックが消えている、または更新の失敗が連続したときだけ判定し、一時的なI/Oエラー1回では判定しません。喪失を検出したDSHは、自分の公開接続を停止してstate/tokenの書き込みを止めます。クラッシュで残った`reclaim.lock`ディレクトリは約2分で古いと見なして削除します。
- stateを開けない場合（`LOCK`・`STATE_CORRUPT`・`STATE_PATH`）: プラグインの読み込みは失敗させず、設定用の通信だけを登録します。状態は`error`で、原因と対処を表示し、stateへは何も書かず、すべての操作を拒否します。

`trustedHosts`は、プラグインが公式configEditorで実際に追加したときだけ、その内容（配列の1件、または自作の式ラッパー）をstateに記録します。公開設定の削除が成功した後、その分だけを元に戻します。配列ならそのホスト名の1件だけを外し、プラグインが配列ごと作った場合で空になるときはキーも消します。`!!js`式は、記録した形のラッパーと完全に一致するときだけ元の式へ戻します。configEditorが拒否した場合や形が変わっている場合は何も変えず、状態の`trustedHostLeft`にホスト名を載せるので、DSHの設定から手動で外してください。最初から信頼済みだったホストや、ユーザーが追加したものは戻しません。Hostの信頼設定自体は本人認証を解除するものではありません。

### 不明な書き込みの復旧

APIのPOSTがCloudflare側で成功しても応答が失われる場合があります。その際は`pending`を残して停止し、同じPOSTを自動再送しません。Access設定の更新（セッション期間・認証方式）は冪等なPUTなので、`pending`を作らず、失敗後に現在値を読み直して判定します（要求値と一致なら成功、変更前の値なら通常の失敗、それ以外は`ACCESS_CHANGED`）。旧版が残した`session`・`authentication`の`pending`は再開を止めず、次の認可した保存で検証して消えます。

ローカルの設定画面でCloudflareを認可し、**結果を確認** を押すと（読み取り専用）、インスタンスの識別マーカー・対象ホスト（Accessアプリ・DNS）に完全一致する資源を調べ、記録済みIDとの一致を表示します。この操作は書き込み・取り込み・削除・pendingの解除をせず、保存された`pending.path`も使いません。見つからない結果も、書き込み失敗の断定には使えません。

そのうえで、ホスト名を再入力して次のいずれかを実行できます（`pending/resolve`、管理接続と有効なAPIトークンが必要）。いずれもクライアントから渡されたIDは使わず、サーバーが読み取り検査をやり直し、元の書き込みは再送しません。

| 操作 | 実行できる条件と動作 |
|---|---|
| 記録済みと一致したので解除（`clear-recorded`） | 完全一致した資源がすべて、このインスタンスが既に記録したIDのとき、`pending`だけを消す。 |
| 未記録の同一マーカー資源を削除（`delete-unrecorded`） | マーカー（`dsh-cf-<instanceId>`）に完全一致し、記録済みIDではない資源だけを、個別に読み直してマーカーを再確認してから削除し、`pending`を消す。Access: 名前とドメイン、Tunnel: 名前で削除済みでない（先に接続記録を消去）、DNS: 名前・コメント・CNAME。記録済みIDは削除せず、何も取り込まない。 |
| 見つからないので解除（`clear-not-found`） | 検査で一致が0件のときだけ`pending`を消す。ユーザーの確認が安全装置です。**残るリスク:** 検査の後にCloudflareが書き込みを完了すると、記録されない資源が残り得ます。ダッシュボードで同じマーカーの資源が無いか確認してください。 |

判断できない場合は`pending`を残したまま調査してください。無関係のリソースを名前の類似だけで削除/取り込みしないでください。

## 検証

```sh
npm ci
npm run check
# 実デプロイ後の未認証アクセス拒否だけを非破壊確認
npm run test:live -- https://mac.example.com/ your-team.cloudflareaccess.com
```

ロックファイルは公式jose `v6.2.12`（実行時の依存はこれだけ）と、開発用の`semver` `v7.8.5`のimmutable release tarballと公開SHA-256に固定しています。`semver`は`check:dsh`・`check:dsh:smoke`がapp-bootと同じ判定をするためだけに使い、配布物のsrcは読み込みません。npm/DSH側で依存をインストールしてからテストしてください。

```sh
# 実際のcloudflaredが接続用の引数をそのまま受け付けるかも確認する（任意・ネットワーク不要）
DSH_CF_CLOUDFLARED=/path/to/cloudflared npm test

# オフラインの契約/通信テストだけ。リリース判定には使わない。
DSH_CF_OFFLINE_TEST=1 npm run check

# 公開中の DSH alpha が peer 範囲に入るか。npm registry と app-boot の tarball を読む。
npm run check:dsh
```

以下の0.1.0-alpha.2〜alpha.7の記録は、その版に対するものです。OAuthとプラグイン内更新は後の版で削除したため、現在の機能の検証記録ではありません。現在の版の検証は末尾の「現在の版の検証」にあります。

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
- [Access Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/)
- [Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [cloudflared実行パラメーター](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
- [jose v6.2.12](https://github.com/panva/jose/releases/tag/v6.2.12)

MIT。DeepSeek/Cloudflareの公式製品ではありません。

## プラグインの更新

このプラグインには更新機能がありません。DSHの **設定 → プラグイン** か、次のコマンドで新しい公開タグを入れ替えます。更新確認・導入・再起動待ちはDSHのplugin managerが扱います。

```sh
dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#<tag>'
```

入れ替えは`.dsh-cf/`のstate・接続トークン・Cloudflareの専用資源を削除しません。state形式は`version: 1`のまま、任意の項目（`paused`・`machineV2`・`trustedHostAdded`・`labels`）を読み書きします。`labels`は設定時に選んだアカウントとログイン方法の表示名で、管理用トークンがなくても設定画面に名前を出すためだけに使います。資源の選択には使いません。DSHを再起動し、ブラウザも再読み込みして新しい設定画面を読み込んでください。DSHのpeer範囲（`>=0.2.1-alpha.2 <0.3.0-0`）はDSH起動時のapp-bootが`semver.satisfies(runtime, range, { includePrerelease: true })`で判定します。`package.json`の`exports`・`dsh.bundle.patch`・`dsh.client`は、旧版が更新時に検証するため変えていません。

## 0.1.0-alpha.7 の検証と運用

Linux x64・Node.js 24.19.0で検証しました。`check:dsh`は最低対応版のalpha.2、従来のalpha.3に加え、その時点のnpm `alpha` / `next`を検出して公開app-bootと照合します。対応範囲外へ進んだ場合も黙って省略せず、対象版の再レビューを求めて失敗します。

`npm run check:dsh:smoke`はプラグインをpackし、実際の公開DSHを一時ディレクトリへ導入します。隔離web profileでプラグインの導入、公式configEditorによるtrustedHosts保存とConnection再生成、launch-token交換、HTTP・設定RPC・WebSocket中継、未認証・別所有者・公開管理操作の拒否を確認します。JWTはローカルRSA鍵で署名し、Cloudflareアカウントやクラウド資源は使いません。`DSH_CF_DSH_VERSION=alpha` / `next` / `0.2.1-alpha.2`で対象を選べます。既存CIはこの3経路を実行します。

DSH 0.2.1-alpha.2 / 0.2.1-alpha.5 / 0.2.1-rc.2で上記smokeを確認しました。実DSH rc.2のChromiumでは、ページを開いたままのHost再起動後の状態同期、日本語・英語、明暗テーマ、1440px・390px、拡大表示のEscape・フォーカス復帰・入力保持を確認しています。Windows/macOSホスト、Electron、Safari/iPadOS、実Cloudflare・実IdPは今回の追加検証範囲に含みません。

設定変更は入力・既存構成との一致・DSH・実行ファイルを先に検証します。この段階の拒否では、動作中の接続と前回の構成確認記録を保持します。実際の設定反映に入ってからの失敗は、従来どおり公開を停止して確認を求めます。

## 現在の版の検証（未リリース）

Linux x64・Node.js 22.22で`npm ci`後の`npm run check`を実行し、**242件中240件成功、失敗0、スキップ2**でした。スキップは、任意の実cloudflaredテスト（`DSH_CF_CLOUDFLARED`未指定）と、IPv6のないこのホストで`::1`を待ち受けられないために飛ばしたloopbackテストです。JOSEの実RSA署名検証、HTTP/WebSocketの実loopbackソケット、上流を模したDSH、取消し・所有権・保存・POST非再送の各経路を含みます。Cloudflare APIと外部エッジはテスト用の応答です。追加分は、公開用の簡易状態と`canManage`、ブラウザなしで`online`になること、一時停止の保存、取消しと一時停止の違い、自動復旧の待ち時間と取消し、書き込み結果の復旧3操作、冪等なPUTが`pending`を作らないこと、ポート移動、機械ID、リース、`reclaim.lock`、チーム鍵の障害とフォールバック、`trustedHosts`の巻き戻しです。

`npm run check:dsh`は公開app-bootの`0.2.1-alpha.2`・`alpha.3`・`alpha.5`・`rc.2`で対応範囲の判定を確認し、`npm run check:dsh:smoke`は`DSH_CF_DSH_ROOT`で既存の`0.2.1-rc.2`を指定して通りました。

実DSH `0.2.1-rc.2`（Linux、webプロファイル）と、Cloudflare APIとエッジを模したモック、cloudflaredの代役を使い、手動で次を確認しました。公開設定の作成直後（ブラウザ未接続）に`online`、最初のオーナー訪問でHTTP/API/WebSocketが記録されて確認済み、cloudflaredのクラッシュからの自動復旧（5秒・15秒の待機の後に復帰）、自動接続オンでの一時停止がDSH再起動後も維持されること、再開後の再起動で自動接続が復帰すること、公開設定の削除で`!!js`の`trustedHosts`をconfigEditorが元に戻し、再接続で再び追加できること。実Cloudflareアカウント・実IdP・macOS/Windows・Safari/iPadOSでの検証は含みません。
