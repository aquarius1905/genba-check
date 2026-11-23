export const SITE_NAME = "現場の健全性診断";
export const SITE_DESCRIPTION =
  "エンジニアが、今いる開発現場の健全性を20問で自己診断できるツールです。回答は外部に送信されません。";

/** 本番URL。Vercel では自動で入る。手元では localhost */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000";

/** 結果ページからの誘導先 */
export const JOB_FIT_AGENT_URL = "https://job-fit-agent-zz6qo3c5kq-an.a.run.app";

/**
 * Google Analytics 4 の測定ID（G-XXXXXXX）。HTML に出る公開値なのでコードに置く。
 * 開発中（npm run dev）は計測しない。
 */
export const GA_ID =
  process.env.NODE_ENV === "production" ? (process.env.NEXT_PUBLIC_GA_ID ?? "G-VSDHLECSX2") : "";
