# dsh-cf

自分のPCで動くDSHを、Cloudflare経由で外から使うためのプラグインです。

普段の操作は **公開URLを開く → 自分のメールなどでログイン → DSHを使う** だけです。同じURLをMac・スマートフォン・タブレットから使えます。ホストPCの電源とインターネット接続は必要です。

> 開発プレビューです。Cloudflareは通信を中継・復号します。DSHを使える人はPC上のファイルやコマンドも扱えるため、本人だけを許可する構成です。

## 用意するもの

- DSH `0.2.1-alpha.2` 以降の対応する `0.2` 開発版とNode.js `22.18` 以上
- Cloudflareで管理しているドメインと、初期設定済みのCloudflare One（Zero Trust）
- 公開用の未使用サブドメイン。例：`dsh.example.com`
- ログインを許可する、自分のメールアドレス

**DB、Workers、ルーターのポート開放は不要です。** Touch ID・物理セキュリティキーの登録も、追加認証を使わなければ不要です。

## 初回だけ行うこと

### 1. プラグインを入れる

公開タグを指定して導入します。

```sh
dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#v0.1.0-alpha.6'
```

実行中のDSHを再起動し、**設定 → Cloudflare** を開きます。同じプロファイルのDSHを二重起動しないでください。

設定の作成・変更は、DSHホストのlocalhost接続で行います。別のPCから設定する場合は、SSHで転送します。

```sh
ssh -N -o ExitOnForwardFailure=yes -L 3080:127.0.0.1:3080 USER@HOST_PC
```

DSHが3080番ポートで動いている例です。SSHの認証を完了し、ターミナルを開いたまま、ホスト側のDSHが表示するログインURLのホスト部分を `http://127.0.0.1:3080/` に置き換えて開きます。`?token=...` は省略しません。この管理用URLは共有しないでください。

### 2. Cloudflareへの接続を許可する

[CloudflareのAPIトークン画面](https://dash.cloudflare.com/profile/api-tokens)でカスタムトークンを作り、プラグインの **APIトークン → Cloudflareに接続** に入力します。チャットやIssueには貼らないでください。

| 分類 | 権限 | アクセス |
|---|---|---|
| Account | Account Settings | Read |
| Account | Cloudflare Tunnel | Edit |
| Account | Access: Apps and Policies | Edit |
| Account | Access: Organizations, Identity Providers, and Groups | Read |
| Zone | Zone | Read |
| Zone | DNS | Edit |

対象アカウントと対象ドメインに限定します。Editはその権限グループの読み取りも含みます。組織の追加認証設定をプラグインから変更するときだけ、OrganizationsのEditも必要です。

管理用APIトークンはメモリ内だけに保持します。通常の再接続には不要ですが、DSH再起動後に設定を変更する場合は再入力します。配布用OAuthクライアントは未登録のため、自分で用意していない場合はAPIトークンを使ってください。

### 3. 公開先を決めて接続する

- **Cloudflareアカウント・ドメイン**：自分のものを選択
- **ログイン方法**：メールコードなど、Cloudflareに登録済みの方法
- **公開ホスト名**：`dsh.example.com` など
- **本人のメール**：アクセスを許可するメールアドレス1つ

候補が1つだけのアカウント・ドメイン・ログイン方法は自動で選びます。メールアドレスは自分で確認して入力します。

接続ソフトが未導入なら、公式cloudflaredの取得を許可し、**接続する** を押します。プラグインが専用Tunnel、DNS、本人だけを許可するAccessアプリを作ります。

### 4. 公開URLを開く

画面上部の **DSHを開く** を押し、本人のメールコードなどでログインします。そのままDSHが開きます。別の確認リンクや通信チェックの手動操作は不要です。

正常な通信を確認した後、必要なら **DSH起動時に再接続する** をオンにします。次回からは公開URLをブックマークして使えます。日常利用にSSH転送や管理用APIトークンは不要です。

## ログインを覚える期間

DSH用のAccessセッションは **1週間（168時間）** です。通常はブラウザのCookieにログイン状態を保持します。Cookieの削除、シークレットウィンドウ、セッションの失効などでは再ログインが必要です。

既に発行済みのCookieの期限は後から延長されません。期間変更後に新しく発行されるセッションから適用されます。ポリシー側に別の期間が設定されている場合は自動で上書きせず停止します。

## Touch IDなども使いたい場合だけ

**接続設定 → 詳細設定** で追加認証をオンにします。この場合はAccessへのログインに加え、登録したTouch IDやセキュリティキーで確認します。

認証器の登録にはCloudflareのApp Launcherが必要です。未設定なら [公式の有効化手順](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/app-launcher/)で本人のメールだけを許可し、App Launcherの **Account → MFA devices** で登録してください。

既存のWebAuthn必須設定は、更新だけでは解除しません。チェックを変更して **保存して接続** を押すと切り替わります。

## 開けないとき

| 表示・症状 | 確認すること |
|---|---|
| `DNS_PROBE_FINISHED_NXDOMAIN` | 開いている端末のDNSが公開ホスト名を見つけられていません。設定画面のURLに誤字がないか確認し、別回線や別のDNSで試します。ルーターが古い応答を返す場合もあります。 |
| `127.0.0.1` で接続拒否 | 別PCから管理している場合はSSH転送が切れています。SSHの認証完了を確認し、ターミナルを開いたままにします。 |
| `dsh web authentication required` | 管理用URLの `?token=...` が必要です。再起動後は新しいURLで開きます。 |
| Accessでログインできない | 許可したメールとログインに使ったメールが同じか確認します。追加認証をオンにした場合は認証器の登録も確認します。 |
| 接続済みなのにDSHが応答しない | ホストPCでDSHが起動しているか確認します。設定画面の「接続の詳細」に失敗段階を表示します。 |
| 変更結果が不明と表示される | 何度も保存し直さず、[書き込み結果の復旧手順](docs/reference.md#不明な書き込みの復旧)を確認してください。 |

## 詳しい設定と開発

- [API権限、OAuth、内部構成、停止・削除、検証記録](docs/reference.md)
- [セキュリティモデル](SECURITY.md)
- [リリース](https://github.com/Aero123421/dsh-cf/releases)

```sh
npm ci
npm run check
npm run check:dsh
```

DeepSeek・Cloudflareの公式製品ではありません。MITライセンス。
