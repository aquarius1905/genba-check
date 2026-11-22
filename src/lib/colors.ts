import type { LevelId } from "./diagnosis";

// ネイビーの背景の上で読める明るさにしている
export const levelColor: Record<LevelId, string> = {
  healthy: "#6cc79a",
  caution: "#e8c060",
  warning: "#f0935a",
  danger: "#f07070",
};

/** OG 画像など CSS 変数が使えない場所用。globals.css と同じ値 */
export const palette = {
  background: "#1f2236",
  foreground: "#f2ece0",
  muted: "#b8b0a3",
  accent: "#e8a65a",
};

export const scoreColor = (score: number): string =>
  score >= 80
    ? levelColor.healthy
    : score >= 60
      ? levelColor.caution
      : score >= 40
        ? levelColor.warning
        : levelColor.danger;
