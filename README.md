# 現場の健全性診断（genba-check）

エンジニアが、今いる開発現場の健全性を20問で自己診断するWebアプリ。

- 仕様（質問・採点・結果ページ）: [docs/questions.md](docs/questions.md)
- 質問データと採点ロジック: `src/lib/diagnosis.ts`
- バックエンドなし。回答はブラウザ内だけで処理する

## 開発

```bash
npm install
npm run dev   # http://localhost:3000
npm run build
```

## 構成

| パス                  | 内容                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `/`                   | 診断（質問 → 結果）                                                            |
| `/r/[level]`          | シェア用ページ（healthy / caution / warning / danger）                         |
| `opengraph-image.tsx` | OG画像。ビルド時に Google Fonts から Noto Sans JP の必要な文字だけ取得して生成 |

## デプロイ（Cloud Run）

```bash
./scripts/deploy-cloud-run.sh
```

- 対象プロジェクトは `gcloud config` の現在のプロジェクト（`PROJECT_ID` で上書き可）
- 本番URL（OG画像のURLに使う）はスクリプトが組み立てて、ビルド時に `.env.production` として渡す。独自ドメインにしたら `SITE_URL=https://... ./scripts/deploy-cloud-run.sh`
- `next.config.ts` の `output: "standalone"` が前提（Dockerfile がこれを使う）
