import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEVELS, findLevel } from "@/lib/diagnosis";
import { levelColor } from "@/lib/colors";
import { SITE_NAME } from "@/lib/site";

// シェアされた結果のランディングページ。スコアの詳細は持たず、ラベルだけを見せる。

export function generateStaticParams() {
  return LEVELS.map((l) => ({ level: l.id }));
}

export async function generateMetadata({ params }: PageProps<"/r/[level]">): Promise<Metadata> {
  const level = findLevel((await params).level);
  if (!level) return {};
  return {
    title: `診断結果：${level.label}`,
    description: `${level.description} あなたの現場も20問でチェックできます。`,
  };
}

export default async function SharedResult({ params }: PageProps<"/r/[level]">) {
  const level = findLevel((await params).level);
  if (!level) notFound();
  const color = levelColor[level.id];

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted">{SITE_NAME}</p>
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="text-sm text-muted">シェアされた診断結果</p>
        <p className="mt-2 text-4xl font-bold" style={{ color }}>
          {level.label}
        </p>
        <p className="mt-4 text-sm leading-relaxed">{level.description}</p>
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-base font-bold">あなたの現場は大丈夫ですか？</p>
        <p className="text-sm leading-relaxed text-muted">
          残業の空気、突然の変更、件数だけの評価など、実際に起きた行動を20問で聞き、現場の健全性を数値化します。
        </p>
        <Link
          href="/"
          className="mt-2 rounded-lg bg-accent px-6 py-4 text-center text-base font-bold text-on-accent transition hover:opacity-90"
        >
          自分の現場を診断する
        </Link>
      </div>
    </div>
  );
}
