"use client";

import { ANSWER_OPTIONS, type Answer, type DiagnosisResult } from "@/lib/diagnosis";
import { JOB_FIT_AGENT_URL, SITE_NAME } from "@/lib/site";
import { levelColor, scoreColor } from "@/lib/colors";

type Props = {
  result: DiagnosisResult;
  onRestart: () => void;
};

const answerLabel = (a: Answer) => ANSWER_OPTIONS.find((o) => o.value === a)!.label;

export function Result({ result, onRestart }: Props) {
  const { score, level, categories, priority } = result;
  const color = levelColor[level.id];

  const share = () => {
    const lines = [`${SITE_NAME}の結果：${score}点（${level.label}）`];
    if (priority) {
      lines.push(`いちばん低い項目：${priority.category.label} ${priority.score}点`);
    }
    lines.push("#現場の健全性診断");
    const url = `${window.location.origin}/r/${level.id}`;
    const intent = new URL("https://x.com/intent/post");
    intent.searchParams.set("text", lines.join("\n"));
    intent.searchParams.set("url", url);
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <section className="flex flex-col gap-8">
      {/* 総合スコア */}
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="text-xs text-muted">総合スコア</p>
        <div className="mt-1 flex items-end justify-between gap-4">
          <p>
            <span className="text-6xl font-bold tabular-nums">{score}</span>
            <span className="ml-1 text-muted">/ 100点</span>
          </p>
          <span
            className="mb-2 rounded-full px-3 py-1 text-sm font-bold"
            style={{ color, backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)` }}
          >
            {level.label}
          </span>
        </div>
        <Bar value={score} color={color} />
        <p className="mt-4 text-sm leading-relaxed">{level.description}</p>
      </div>

      {/* 項目別スコア */}
      <div className="flex flex-col gap-4">
        <h2 className="text-base font-bold">項目別スコア</h2>
        {categories.map((c) => (
          <div key={c.category.id}>
            <div className="flex justify-between text-sm">
              <span>{c.category.label}</span>
              <span className="tabular-nums">{c.score}点</span>
            </div>
            <Bar value={c.score} color={scoreColor(c.score)} thin />
          </div>
        ))}
      </div>

      {/* 優先して見る項目 */}
      {priority && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-base font-bold">
            ⚠ 優先して見る項目：{priority.category.label}（{priority.score}点）
          </h2>
          <p className="mt-3 text-sm leading-relaxed">{priority.category.advice.engineer}</p>
          <h3 className="mt-5 text-xs font-bold text-muted">点数を下げた回答</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {priority.issues.map(({ question, answer }) => (
              <li key={question.id} className="text-sm leading-relaxed">
                <span className="mr-2 inline-block rounded bg-track px-1.5 py-0.5 text-xs whitespace-nowrap">
                  {answerLabel(answer)}
                </span>
                {question.text.engineer}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* シェア・誘導 */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={share}
          className="rounded-lg bg-foreground px-6 py-4 text-base font-bold text-background transition hover:opacity-90"
        >
          結果を X でシェアする
        </button>
        <a
          href={JOB_FIT_AGENT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col gap-1 rounded-lg border border-line px-6 py-4 text-center transition hover:border-accent"
        >
          <span className="text-xs text-muted">フリーランスの方へ</span>
          <span className="text-base">
            応募したい案件が自分の経歴に合うか判定する（job-fit-agent）
          </span>
        </a>
        <p className="text-center text-xs text-muted">面接・商談で使える質問リストは準備中です</p>
        <button
          type="button"
          onClick={onRestart}
          className="mt-2 text-sm text-muted underline-offset-4 hover:underline"
        >
          もう一度診断する
        </button>
      </div>
    </section>
  );
}

function Bar({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  return (
    <div
      className={`mt-2 overflow-hidden rounded-full bg-track ${thin ? "h-2" : "h-3"}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  );
}
