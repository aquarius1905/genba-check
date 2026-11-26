# 現場の健全性診断（genba-check）

**🔗 今すぐ試す:** https://genba-check-283196730351.asia-northeast1.run.app/?utm_source=github （登録不要・約3分）

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
| `mcp/`                | Claude Code などから診断を呼べる MCP サーバー（下記）                          |

## MCP サーバー（Claude Code から診断する）

`mcp/` に、同じ20問と採点を MCP ツールとして提供するサーバーがある（stdio）。質問データと採点は `src/lib/diagnosis.ts` をそのまま import しており、Webアプリと結果は同じ。本体とは別パッケージなので、Webアプリのビルドやイメージには影響しない。

MCP サーバー自体は回答を保存・外部送信しない（ファイル書き込み・ネットワーク通信をせず、回答をログに出力しない。標準エラー出力には起動時に1行だけ出す）。ただし Claude Code などのAIクライアントを通して使う場合、回答は会話やツールの引数としてAIの提供元に送信され、クライアント側の会話記録にも残ることがある。ブラウザ内だけで処理するWebアプリとはこの点が違う。

| ツール          | 内容                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `get_questions` | 20問を、カテゴリ・逆転の問いかどうかと一緒に返す                                                                                     |
| `score_answers` | 20問への回答（よくある／たまにある／ない）を受け取り、総合スコア・ラベル・カテゴリ別スコア・優先して見る項目・本人が取れる行動を返す |

### よく使うコマンド（早見表）

どれもリポジトリのルートで実行する。詳しくは下の各節。

| やりたいこと                 | コマンド                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 初めて使う（ビルドして登録） | `npm --prefix mcp install && npm --prefix mcp run build`<br>`claude mcp add genba-check -- node "$(pwd)/mcp/dist/index.js"` |
| pull や編集のあとに反映する  | `npm --prefix mcp install && npm --prefix mcp run build` → Claude Code の `/mcp` で再接続                                   |
| 登録されているか確かめる     | `claude mcp get genba-check`（Claude Code の中なら `/mcp`）                                                                 |
| 登録を外す                   | `claude mcp remove genba-check -s local`（`--scope user` で登録した場合は `-s user`）                                       |
| 診断する                     | Claude Code で「genba-check で今の現場を診断して」と頼む                                                                    |

登録は、登録したあとに開いた Claude Code のセッションから使える。登録より前から開いていたセッションでは呼べないので、開き直す。

### ビルドと登録

Node.js 20.19 以上（20 系）または 22.12 以上が必要（テストで使う Vite の要件）。

```bash
npm --prefix mcp install
npm --prefix mcp run build   # 型チェック（tsc）のあと mcp/dist/index.js を作る。型エラーがあれば止まる
npm --prefix mcp test        # 採点が docs/questions.md の仕様どおりかを確かめる
```

Claude Code への登録は、次の **どちらか一方** を実行する（両方登録すると同じ名前が2つのスコープに残る）。パスは絶対パスで指定するので、リポジトリのルートで実行する。

このプロジェクトでだけ使う場合：

```bash
claude mcp add genba-check -- node "$(pwd)/mcp/dist/index.js"
```

どのプロジェクトからでも使う場合：

```bash
claude mcp add --scope user genba-check -- node "$(pwd)/mcp/dist/index.js"
```

登録できたかは `claude mcp list`、または Claude Code 内の `/mcp` で確認できる。登録を外すときは `claude mcp remove genba-check -s local`（user スコープなら `-s user`）。

### 更新したとき

登録したサーバーはビルド済みの `mcp/dist/index.js` を動かすので、`src/lib/diagnosis.ts`（質問や採点）や `mcp/` を変えても、再ビルドするまで反映されない。Webアプリと結果をそろえるため、pull や編集のあとは依存パッケージを入れ直してから再ビルドし、Claude Code の `/mcp` から genba-check を再接続する（または Claude Code を再起動する）。依存が変わっていなければ install はすぐ終わるので、毎回まとめて実行してよい。

```bash
npm --prefix mcp install && npm --prefix mcp run build
```

### 使い方の例

Claude Code で次のように頼む。

```
genba-check で今の現場を診断して。質問は1問ずつ聞いてください。
```

Claude が `get_questions` で20問を取得してひとつずつ聞き、回答がそろったら `score_answers` で採点して、次のような結果を伝える。

```
総合スコア：65点（注意）
項目別スコア：残業文化 0 / 変更管理 100 / 扱いの公正さ 100 / 時間への配慮 100 / 心理的安全性 100 / 人への関心 0
優先して見る項目：残業文化（0点）
本人が取れる行動：長く働くことが前提になっていたり、評価につながったりする場面があるようです。…
```

回答がすでに手元にある場合は、まとめて渡すこともできる。

```
genba-check で採点して。1〜4 は「よくある」、18〜20 は「たまにある」、それ以外は「ない」。
```

## デプロイ（Cloud Run）

```bash
./scripts/deploy-cloud-run.sh
```

- 対象プロジェクトは `gcloud config` の現在のプロジェクト（`PROJECT_ID` で上書き可）
- 本番URL（OG画像のURLに使う）はスクリプトが組み立てて、ビルド時に `.env.production` として渡す。独自ドメインにしたら `SITE_URL=https://... ./scripts/deploy-cloud-run.sh`
- `next.config.ts` の `output: "standalone"` が前提（Dockerfile がこれを使う）
