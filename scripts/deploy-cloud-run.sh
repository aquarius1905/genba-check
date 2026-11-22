#!/usr/bin/env bash
# genba-check を Cloud Run にデプロイする。
#
# 本番URLは OG 画像の URL（metadataBase）に使い、ビルド時に埋め込まれる。
# Cloud Run のサービスURLは https://<サービス名>-<プロジェクト番号>.<リージョン>.run.app で
# 事前に決まるので、ここで組み立てて .env.production に書き出してからビルドする。
# 独自ドメインを使う場合は SITE_URL を指定する。
set -euo pipefail

SERVICE=genba-check
# プロジェクトIDはコードに残さない（gcloud config から取得）
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
if [ -z "${PROJECT_ID}" ]; then
  echo "PROJECT_ID が未設定です。環境変数 PROJECT_ID を指定するか、gcloud config set project で設定してください。" >&2
  exit 1
fi
REGION="${REGION:-asia-northeast1}"

if [ -z "${SITE_URL:-}" ]; then
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
  SITE_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
fi

cd "$(dirname "$0")/.."
echo "NEXT_PUBLIC_SITE_URL=${SITE_URL}" > .env.production
trap 'rm -f .env.production' EXIT

# 全ページが静的なので、1インスタンスで十分。費用の上限を抑えるため max を小さくする
gcloud run deploy "${SERVICE}" \
  --source . \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --memory=512Mi

echo "公開URL: ${SITE_URL}"
