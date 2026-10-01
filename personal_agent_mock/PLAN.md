# ORBIT · 個人 AI ワークフロー操作モック

目的: 組織・工程・予定・判断・負荷・報告・記憶を、低い認知負荷で体験できる操作モックを作る。データはすべて架空の固定データで、実 AI・実 CLI には接続しない。

完了条件: 操作デモと閲覧専用の工程図を静的配信で提示できる。n8n / Dify の Code ノードによるデータ準備工程（`prepare.py`）、専用の固定テスト（`tests/*.test.mjs`）、実ブラウザでの確認、独立レビュー。

## 構成
- `public/`: 操作モック本体（`app.mjs` / `model.mjs` / `style.css` / `seed.json`）と工程図（`pipeline.html` / `pipeline.mjs` / `snapshot.json` / `inspection.json`）。
- `fixture.json` → `seed.json`: Dify の Code ノードが同じ内容を出力することを `prepare.py` が検証する。
- `build_delivery.py`: 公開用の工程図（`inspection.json`）と `manifest.json` を作る。
- `server.py`: 固定ファイルだけを GET で配信（POST は 405）。`verify_public.py` が配信バイトを照合する。

## 範囲と制限
- チャット・会議・予定は決められた模擬動作。ページを閉じている間の予定実行はない。データは訪問者のブラウザに保存する。
- 実 CLI への接続、任意文章の回答生成、権限制御は範囲外。
- `evidence/`（n8n / Dify の export、実行証跡、匿名取得の receipt）はこの公開版に含めない。再生成手順: viewer リポジトリの `visual_workflow/`（deploy.py、bootstrap.py）で n8n / Dify を起動 → `prepare.py` → `build_delivery.py` → 公開 → `verify_public.py --record`。