import { palette } from "@/lib/colors";
import { OG_SIZE, renderOg } from "@/lib/og";
import { SITE_NAME } from "@/lib/site";

export const alt = SITE_NAME;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return renderOg({
    headline: "その現場、健全？",
    sub: "エンジニアのための現場セルフチェック",
    color: palette.accent,
  });
}
