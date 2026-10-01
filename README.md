# orbit-agent-workflow-mock

A clickable mock of a personal AI-workflow workspace (teams, projects, schedules, decisions, load, reports), with a read-only pipeline diagram of how its data is prepared.

組織・工程・予定・判断・負荷・報告を、低い認知負荷で体験できる「個人 AI ワークフロー」の操作モックです。データはすべて架空の固定データで、実 AI・実 CLI には接続しません。公開用に整理したサンプル実装です。

## 概要

AI エージェントを何人も動かす仕事では、「誰が何を担当し、どの工程が詰まり、何を自分が判断するのか」が見えにくくなります。このモックは、その見せ方を実際に触って検討するための試作です。あわせて、モックのデータ準備工程（n8n と Dify の Code ノード）を、ジョブ → 担当 → 結果の図で閲覧専用に公開できる形にしています。

## 主な機能・設計のポイント

- **状態を一箇所で管理**: `public/model.mjs` に状態遷移（プロジェクトの作成、メンバーの配置、タスク追加、再割り当て、シナリオ切替など）をまとめ、画面（`app.mjs`）と分離しています。
- **提案は「プレビュー → 適用」の 2 段階**: 提案はタスクを変えずにプレビューでき、元のスナップショットに対してだけ適用されます。保留・キャンセルでは提案を作りません。自由なチャットは保存するだけで、提案を捏造しません。
- **プロジェクトごとに独立**: メンバーの配置、フェーズ、タスク、チャット、セッションはプロジェクト単位で分離され、同じエージェントを共有しても混ざりません。共有エージェントの同時実行枠は全プロジェクトで数え、空きが出たら待機中の作業が始まります。
- **データ準備工程の検証**: `fixture.json` から `seed.json` を作る工程を Dify の Code ノードで実行し、出力が一致することを `prepare.py` が検証します。LLM 推論は行いません。
- **固定ファイルだけを配信**: `server.py` は許可リストのファイルだけを GET で返します（POST は 405、既定は loopback、CSP 付き）。`verify_public.py` は匿名取得したバイトとローカルのファイルを照合し、未公開の経路が 404 であることも確認します。
- **工程図の生成**: `build_delivery.py` が、`snapshot.json` に結びついた工程図データ（`inspection.json`）と manifest を作ります。

## ディレクトリ構成

```
personal_agent_mock/
  public/            操作モック（index.html, app.mjs, model.mjs, style.css, seed.json）と工程図（pipeline.html, pipeline.mjs, snapshot.json, inspection.json）
  fixture.json       架空の元データ（seed.json の元）
  prepare.py         n8n / Dify の準備工程を登録して seed.json を作る（WSL 上で実行）
  build_delivery.py  工程図データと manifest の生成
  server.py          固定ファイルだけを返す配信サーバー
  verify_public.py   匿名取得での配信バイト照合
  manifest.json      合成の manifest
  tests/             node:test による状態遷移・会話・再利用・画面のテスト
  PLAN.md            計画と範囲
```

## 動かし方

操作モックの確認とテストだけなら、Python 3 と Node.js があれば足ります（外部ライブラリは不要）。

```powershell
python personal_agent_mock/server.py          # 固定ファイルをローカルで配信（loopback、既定ポート 8090。MOCK_PORT で変更）
node --test personal_agent_mock/tests/*.test.mjs
```

データ準備工程の再生成には、`n8n-dify-workflow-viewer` の環境（WSL + Docker で n8n・Dify を起動）が必要です。

```powershell
wsl -e env POC_DIR=<dir> python3 personal_agent_mock/prepare.py
python personal_agent_mock/build_delivery.py
python personal_agent_mock/verify_public.py --record
```

環境変数: `POC_DIR`（WSL 内の実行環境ディレクトリ。`prepare.py` が使用）、`MOCK_PORT`（`server.py` の待受ポート）、`INJECTED_SCRIPT_HOST`（任意。`verify_public.py` が、配信経路が HTML に差し込む解析 script のホストを除いて照合するときに指定）。データ内の日付は合成値（2000-01 始まり）です。

## 制限事項（閉包）

- **同梱していない依存**（3 件）: `bootstrap`、`templates`、`viewer`。いずれも `n8n-dify-workflow-viewer` の `visual_workflow/` にあるモジュールで、`prepare.py` は本ディレクトリの隣に `visual_workflow/` を置く構成を前提にしています。Node.js のテストは標準モジュール（`node:test` など）のみを使います。
- チャット・会議・予定は決められた模擬動作です。ページを閉じている間の予定実行はありません。データは訪問者のブラウザに保存されます。
- 実 CLI への接続、任意文章の回答生成、権限制御は範囲外です。
- 実行証跡（`evidence/`。n8n / Dify の export、実行記録、匿名取得の receipt）は同梱していません。`verify_public.py` の公開元 URL は例示値なので、各自の公開先に置き換えてください。
- 画面の確認には、ブラウザ（モジュールスクリプトに対応したもの）が必要です。

## ライセンス

All rights reserved. 閲覧目的で公開しています。詳細は LICENSE を参照。
