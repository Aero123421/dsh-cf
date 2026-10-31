# Changelog

公開済みの版の詳細は `docs/releases/` にあります。このファイルは最近の変更をまとめます。

## 0.1.0-alpha.10

- 引き継いだ cloudflared を確認できない場合、その記録を再起動後も保持し、二重起動を防ぎます（#29）。
- smoke の JSON 出力と stderr 警告を分離し、設定画面のアカウント名の二重展開と不正な API トークンの案内を修正しました（#30）。
- DSH の互換性検査に npm latest を追加し、npm 12 の dist-tags 出力に対応しました（#31）。

## 0.1.0-alpha.9

- 起動時にプロファイルのリースを取れなくても、DSH の Web 起動は待ちません。設定画面は `LOCK` のまま開き、観測と取り直しはバックグラウンドで行います。最初の取り直しは直ちに観測し、その後は心拍の約2倍から上限1分までの間隔です。成功すると通常のコントローラーに切り替わり、自動接続が有効なら再開します。破棄すると取り直しは止まり、失敗した `Store` は閉じます。
- `owner.lock` に、起動した cloudflared の PID と開始時刻を記録します。Linux は `/proc/<pid>/stat` の starttime、macOS は `ps -o lstart= -p <pid>`、Windows はプロセスの StartTime です。この記録はリースの判定には使いません。新しい持ち主は、cmdline と開始時刻が一致する cloudflared だけを SIGTERM、続いて SIGKILL し、そのプロセスが居なくなってから自分の cloudflared を起動します。PID の再利用は止めません。開始時刻を確認できないときは、そのプロセスを止めず新しい cloudflared も起動せず、理由付きの `LOCK` を表示します。ただし `kill(pid, 0)` の直後に回収され、開始時刻や cmdline が読めなくなった場合は居なくなったものとして扱い、新しい cloudflared を起動します。停止シグナルを送ったあともプロセスが残っているのに確認できない場合は、新しい cloudflared を起動せず、停止を試みたが確認できない旨の `LOCK` を表示します。確認できたプロセスが SIGKILL の約 2 秒後も残っているときは、新しい cloudflared を起動せず、同じ `LOCK` を表示します。
- 再開では保存済みゲートポートを動かさず、cloudflared より先に bind します。bind できないときは cloudflared を起動せず、`GATE_PORT_BUSY` を約1秒ごとに再試行します。
- 動いている古いプロセスは `assertOwnership` で喪失に気づき、state と token を書かず cloudflared を止めます。これは二次的なガードです。
- ロック中の案内は、この DSH を再起動する、という文言にしました。
- 設定画面のボタンは、DSH が渡す幅のなかで折り返し、カードの外にはみ出さないようにしました。
- 更新手順を、画面上の更新ボタンではなく `dsh plugin --profile web add -w 'github:Aero123421/dsh-cf#<tag>'` に合わせました。
