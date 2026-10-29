# DSH 互換性確認（2026-10-29）

統合担当の独立 executor でも、npm latest `0.2.1-rc.2` で修正後の 11 plugin を併用するローカル smoke が成功しました。Host は宣言した互換範囲内でしたが、分離 prefix 構成の依存解決先の違いによる peer 警告は残っています。実アカウント、有料推論、全 OS、全機能の組合せは未検証です。

dsh-cf `0.1.0-alpha.9`、基準コミット `e4a0194ff57b5ec982cd153f8f32ca1f1db2961c` を確認しました。コードや依存版を変える必要のある最新 DSH API の不一致は、この検証では見つかりませんでした。

公式配布元は [npm の @deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh)、本体は [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) です。確認時の `latest` は `0.2.1-rc.2`、`next` は `0.2.1-rc.4`、`alpha` は `0.2.2-alpha.2` でした。すべて prerelease です。正式安定版は公開 versions にありませんでした。

| 実行した対象 | 公式コミット | 結果 |
| --- | --- | --- |
| 0.2.1-rc.2（npm latest・基本の受入対象） | [687f282e8625c6b8d11ff58211a90524be2e4317](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317) | packed plugin の導入、公式 trustedHosts 保存／Connection 再読込、launch exchange、HTTP/RPC/WS、JWT、公開側管理拒否が成功 |
| 0.2.1-rc.4 | [504a01a9578abc2c6f1fb896b1dc322c9fe24f66](https://github.com/deepseek-ai/deepseek-harness/tree/504a01a9578abc2c6f1fb896b1dc322c9fe24f66) | packed plugin の導入、公式 trustedHosts 保存／Connection 再読込、launch exchange、HTTP/RPC/WS、JWT、公開側管理拒否が成功 |
| 0.2.2-alpha.2 | [f3803c96974ad4a94195fb97e5c637e9c2a3afe3](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3) | 同じ実 DSH smoke が成功 |

`Connection.requestRejection()` / `authenticatedUrl()`、`WebServer.register()`、`configEditor.entries()` / `edit()` の公開契約を対象版の実装で照合しました。WebServer は prefix route と disposer を引き続き提供し、configEditor の変更後も controller を Connection の外で保持します。

## 実行した検査

Linux x64、Node.js 24.19.0。`npm ci && npm run check` 相当の通常検査で 298 件中 297 成功・失敗 0・実 cloudflared 指定が必要な 1 件をスキップ。ローカル RSA の JOSE/JWT 検証、実 loopback HTTP/WS、取消、切断復旧、所有権、書き込み非再送を含みます。`DSH_CF_OFFLINE_TEST` は使っていません。

`npm run check:dsh` は公開 app-boot 0.2.1-alpha.2 / alpha.3 / rc.2 / rc.4 / 0.2.2-alpha.2 の peer 判定に成功しました。従来の next / alpha に加え、npm latest も検査対象へ含めました。これは API 動作を確認する smoke とは別の検査です。

[Issue #28](https://github.com/Aero123421/dsh-cf/issues/28) は [PR #29](https://github.com/Aero123421/dsh-cf/pull/29) で修正済みです。未解決の旧 connector 記録を新 Store/Controller と再起動にまたいで保持する既存回帰テストが通過し、修正を重ねていません。

[進行中の PR #30](https://github.com/Aero123421/dsh-cf/pull/30) が smoke の stdout/stderr 混在を修正しています。重複修正を避け、検証専用コピーだけで成功時の stdout を分離して smoke を実行しました。失敗時には両方を診断に残しています。本リポジトリの smoke 修正ではありません。

隔離 DSH latest rc.2、next rc.4、alpha 0.2.2-alpha.2 で対応修正後の Remora 0.1.7 と同時に有効にし、両 route の再起動後の復帰、gate 経由 Remora 状態取得、gate 経由の全権拡大拒否を確認しました。rc.4 は導入順を逆にしても成功しました。CF 側の HTTP/RPC/WS/JWT 検査も同時有効中に成功しています。3版とも Chromium で両設定画面を描画し、再起動後も開け、console/page error は 0 件でした。

DSH は公式 npm の固定版を隔離導入しました。gate と Access JWT は生成したローカル RSA の fixture、Cloudflare API・connector は mock です。実 Cloudflare 認証・公開 Tunnel、実 Hub、外部配備、macOS/Windows/Desktop は未検証です。新しい公開タグや Release は作っていません。
