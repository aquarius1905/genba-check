import { LEVELS, findLevel } from "@/lib/diagnosis";
import { levelColor } from "@/lib/colors";
import { OG_SIZE, renderOg } from "@/lib/og";
import { SITE_NAME } from "@/lib/site";

export const alt = `${SITE_NAME}の結果`;
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return LEVELS.map((l) => ({ level: l.id }));
}

export default async function Image({ params }: { params: Promise<{ level: string }> }) {
  const level = findLevel((await params).level) ?? LEVELS[0];
  return renderOg({
    headline: `診断結果：${level.label}`,
    sub: "あなたの現場は大丈夫？",
    color: levelColor[level.id],
  });
}
