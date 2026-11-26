// ツールの中身（純粋関数）。質問データと採点は Next.js 本体の src/lib/diagnosis.ts をそのまま使う。
// このサーバーは回答を保存・外部送信しない（ファイル書き込み・ネットワーク通信をせず、回答をログに出力しない）。
// ただし AIクライアント経由の会話は、クライアント側でAIの提供元に送られる（PRIVACY_NOTE）。
import {
  ANSWER_OPTIONS,
  CATEGORIES,
  LEVELS,
  PRIORITY_THRESHOLD,
  QUESTIONS,
  diagnose,
  type Answer,
} from "../../src/lib/diagnosis";

// 「優先して見る項目」の基準は本体の値をそのまま使う（説明文と結果の文言に載せる）
export { PRIORITY_THRESHOLD };

const AUDIENCE = "engineer";

const labelOf = (answer: Answer) => ANSWER_OPTIONS.find((o) => o.value === answer)!.label;
const categoryOf = (id: string) => {
  const c = CATEGORIES.find((x) => x.id === id)!;
  return { id: c.id, label: c.label };
};

export const ANSWER_LABELS = ANSWER_OPTIONS.map((o) => o.label);

// 説明文やエラーに出す数・範囲・名前は、問いを増やしても食い違わないよう本体のデータから作る
const ids = QUESTIONS.map((q) => q.id);
export const FACTS = {
  total: QUESTIONS.length,
  idRange: `${Math.min(...ids)}〜${Math.max(...ids)}`,
  categoryCount: CATEGORIES.length,
  categoryList: CATEGORIES.map((c) => c.label).join("／"),
  levelList: LEVELS.map((l) => l.label).join("／"),
  answerList: ANSWER_LABELS.join("／"),
  answerCount: ANSWER_LABELS.length,
};
const ANSWER_LIST = FACTS.answerList;

// ---------- get_questions ----------

export type QuestionsPayload = ReturnType<typeof getQuestions>;

export function getQuestions() {
  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      category: categoryOf(q.category),
      reversed: q.reversed,
      text: q.text[AUDIENCE],
    })),
    answerOptions: ANSWER_LABELS,
    instructions:
      "今いる現場で起きていることについて、期間を区切らずに答えてもらう。" +
      `回答は ${ANSWER_LIST} の${FACTS.answerCount}つから選ぶ。` +
      "reversed が true の問いは良い行動を聞く問いで、「よくある」ほど健全。",
  };
}

export function formatQuestions(payload: QuestionsPayload): string {
  const lines = payload.questions.map(
    (q) => `${q.id}. [${q.category.label}${q.reversed ? "・逆転" : ""}] ${q.text}`,
  );
  return [
    `現場の健全性診断（全${payload.questions.length}問）`,
    `回答の選択肢：${ANSWER_LIST}`,
    payload.instructions,
    "",
    ...lines,
  ].join("\n");
}

// ---------- score_answers ----------

export type AnswerInput = { question_id: number | string; answer: string };

// Map にして、"constructor" や "toString" などの継承キーが回答として通らないようにする
const ANSWER_VALUES = new Map<string, Answer>([
  ...ANSWER_OPTIONS.map((o) => [o.label, o.value] as const),
  ...ANSWER_OPTIONS.map((o) => [o.value, o.value] as const),
]);

/** 保存・送信しないのはこのサーバーだけ。AIクライアント経由の会話は別であることを明記する */
export const PRIVACY_NOTE =
  "この MCP サーバーは回答を保存・外部送信しません。ただし、AIクライアント（Claude Code など）を通して使う場合、" +
  "回答は会話やツールの引数としてAIの提供元に送信され、クライアント側の会話記録にも残ることがあります。";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 回答を検証し、問いの ID → 回答 に変換する。問題はすべて集めて返す */
function parseAnswers(
  input: unknown,
): { ok: true; answers: Record<number, Answer> } | { ok: false; errors: string[] } {
  const total = QUESTIONS.length;
  if (!Array.isArray(input) || !input.every(isRecord)) {
    return {
      ok: false,
      errors: [
        `answers は {"question_id": 問いの番号, "answer": 回答} の配列で、${total}問すべてについて渡してください。`,
      ],
    };
  }

  const errors: string[] = [];
  if (input.length !== total) {
    errors.push(`回答が${input.length}件です。${total}問すべてへの回答（${total}件）が必要です。`);
  }

  const answers: Record<number, Answer> = {};
  const seen = new Map<number, number>();
  const validIds = new Set(ids);
  input.forEach((item, index) => {
    const raw = item.question_id;
    const parsed = typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
    const id = typeof parsed === "number" && validIds.has(parsed) ? parsed : undefined;
    if (id === undefined) {
      errors.push(
        `${index + 1}件目：question_id ${JSON.stringify(raw) ?? "（なし）"} は存在しません。${FACTS.idRange} の整数を指定してください。`,
      );
    } else {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }

    // ID が不正でも回答の値は確かめ、問題を一度に返す。ID が使えない項目は位置で示す
    const value =
      typeof item.answer === "string" ? ANSWER_VALUES.get(item.answer.trim()) : undefined;
    if (!value) {
      const shown = typeof item.answer === "string" ? item.answer : JSON.stringify(item.answer);
      const where = id === undefined ? `${index + 1}件目` : `question_id ${id}`;
      errors.push(
        `${where} の回答「${shown ?? "（なし）"}」は使えません。使える値：${ANSWER_LIST}`,
      );
      return;
    }
    if (id !== undefined) answers[id] = value;
  });

  for (const [id, count] of seen) {
    if (count > 1)
      errors.push(`question_id ${id} への回答が${count}件あります。1問につき1件にしてください。`);
  }
  const missing = QUESTIONS.map((q) => q.id).filter((id) => !seen.has(id));
  if (missing.length > 0) errors.push(`回答がない問い：${missing.join(", ")}`);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, answers };
}

export type ScorePayload = ReturnType<typeof toPayload>;

function toPayload(result: ReturnType<typeof diagnose>) {
  const p = result.priority;
  return {
    score: result.score,
    level: {
      id: result.level.id,
      label: result.level.label,
      description: result.level.description,
    },
    categories: result.categories.map((c) => ({
      id: c.category.id,
      label: c.category.label,
      score: c.score,
    })),
    priority: p
      ? {
          category: { id: p.category.id, label: p.category.label },
          score: p.score,
          issues: p.issues.map((i) => ({
            question_id: i.question.id,
            text: i.question.text[AUDIENCE],
            reversed: i.question.reversed,
            answer: labelOf(i.answer),
          })),
          advice: p.category.advice[AUDIENCE],
        }
      : null,
    privacy: PRIVACY_NOTE,
  };
}

export function scoreAnswers(
  input: unknown,
): { ok: true; result: ScorePayload } | { ok: false; errors: string[] } {
  const parsed = parseAnswers(input);
  if (!parsed.ok) return parsed;
  return { ok: true, result: toPayload(diagnose(parsed.answers)) };
}

export function formatScore(r: ScorePayload): string {
  const lines = [
    `総合スコア：${r.score}点（${r.level.label}）`,
    r.level.description,
    "",
    "項目別スコア：",
    ...r.categories.map((c) => `- ${c.label}：${c.score}`),
  ];
  if (r.priority) {
    lines.push(
      "",
      `優先して見る項目：${r.priority.category.label}（${r.priority.score}点）`,
      "根拠（点数を落とした回答）：",
      ...r.priority.issues.map((i) => `- ${i.question_id}. ${i.text} → ${i.answer}`),
      "",
      `本人が取れる行動：${r.priority.advice}`,
    );
  } else {
    lines.push("", `優先して見る項目：なし（すべての項目が${PRIORITY_THRESHOLD}点以上）`);
  }
  lines.push("", r.privacy);
  return lines.join("\n");
}

export function formatErrors(errors: string[]): string {
  return [
    "回答に問題があるため採点できませんでした。",
    ...errors.map((e) => `- ${e}`),
    "",
    `get_questions で${FACTS.total}問を確認し、question_id ${FACTS.idRange} のそれぞれに ${ANSWER_LIST} のいずれかを1件ずつ渡してください。`,
  ].join("\n");
}
