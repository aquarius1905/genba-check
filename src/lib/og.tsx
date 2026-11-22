import { ImageResponse } from "next/og";
import { palette } from "./colors";
import { SITE_NAME } from "./site";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * 画像に使う文字だけを含む Noto Sans JP（Bold）を Google Fonts から取得する。
 * OG 画像はビルド時に生成されるので、取得はビルド時の1回だけ。
 * 取得に失敗した場合はフォントなしで描画する（日本語は表示されない）。
 */
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  "use cache";
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(text)}`,
    ).then((r) => r.text());
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
    if (!src) return null;
    return await fetch(src).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

type OgProps = {
  /** 大きく出す文字（例：要警戒） */
  headline: string;
  /** 補足（例：あなたの現場は大丈夫？） */
  sub: string;
  color: string;
};

export async function renderOg({ headline, sub, color }: OgProps) {
  const footer = "20問で今いる現場を数値化";
  const font = await loadFont(SITE_NAME + headline + sub + footer);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: palette.background,
        color: palette.foreground,
        fontFamily: "NotoSansJP",
      }}
    >
      <div style={{ display: "flex", fontSize: 40, color: palette.muted }}>{SITE_NAME}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 120, color, lineHeight: 1.1 }}>{headline}</div>
        <div style={{ display: "flex", fontSize: 48 }}>{sub}</div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          fontSize: 32,
          color: palette.muted,
        }}
      >
        <div style={{ width: 64, height: 8, background: color, borderRadius: 4 }} />
        {footer}
      </div>
    </div>,
    {
      ...OG_SIZE,
      fonts: font ? [{ name: "NotoSansJP", data: font, weight: 700, style: "normal" }] : [],
    },
  );
}
