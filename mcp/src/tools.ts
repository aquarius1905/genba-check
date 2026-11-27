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

// ---------- プライバシーの説明 ----------

/** 保存・送信しないのはこのサーバーだけ。AIクライアント経由の会話は別であることを明記する */
export const PRIVACY_NOTE =
  "この MCP サーバーは回答を保存・外部送信しません。ただし、AIクライアント（Claude Code など）を通して使う場合、" +
  "回答は会話やツールの引数としてAIの提供元に送信され、クライアント側の会話記録にも残ることがあります。";

const COMPANY_NOTE = "会社名や個人名など、特定につながる情報は書かなくてかまいません。";

/** 確認画面を出す場面。問いを返す前と、採点の前で、確認画面の文と案内の文を書き分ける */
export type ConsentPhase = "questions" | "scoring";

// 確認画面の文は改行を入れない。Claude Code は改行を含む文を折り返さず、行ごとに画面の幅で切り詰めるため

/** クライアントの確認画面（elicitation）で表示する文 */
export function consentMessage(phase: ConsentPhase): string {
  if (phase === "questions") {
    return `${PRIVACY_NOTE}${COMPANY_NOTE}この内容に同意して、診断を始めますか？`;
  }
  // 採点の前の時点で、回答はすでにツールの引数として送られている。断れば送られない、と受け取られないようにする
  return (
    `${PRIVACY_NOTE}${ALREADY_SENT_NOTE}` +
    "この内容に同意して、採点しますか？（同意しない場合も、行わないのは採点だけです）"
  );
}

/** 採点の前の時点では、回答はすでに会話として送られていることを伝える */
const ALREADY_SENT_NOTE = "あなたの回答は、すでに会話として AI の提供元に送られています。";

/** 確認画面を表示できないクライアント */
const UNSUPPORTED_CLIENTS = "VS Code 版の Claude Code や、`claude -p` などの非対話モード";

/** 確認画面を表示できないクライアントで使っているときの案内 */
const useInteractiveTerminal = (phase: ConsentPhase) =>
  `${UNSUPPORTED_CLIENTS}では、この確認画面は表示されません。` + interactiveTerminalSteps(phase);

/** ターミナルの対話モードでやり直す手順 */
const interactiveTerminalSteps = (phase: ConsentPhase) =>
  "ターミナルで `claude` を対話モードで起動して、" +
  (phase === "questions"
    ? "もう一度「genba-check で今の現場を診断して」と頼んでください。"
    : // 新しいセッションには、ここでの回答は引き継がれない
      "回答を貼り付けて採点を頼んでください。新しいセッションには、ここでの回答は引き継がれないので、" +
      "先に回答（問いの番号と、よくある／たまにある／ないのどれか）を控えておいてください。控えておけば、問いに答え直す必要はありません。");

/**
 * 確認画面で同意が得られなかったときに、ツールの結果として返す文。
 * 問いを返す前なら「診断を始めなかった」、採点の前なら「採点しなかった（答え直す必要はない）」と書き分ける。
 */
export function consentFailureTexts(phase: ConsentPhase) {
  const stopped = phase === "questions" ? "診断を始めませんでした" : "採点しませんでした";
  const dont =
    phase === "questions"
      ? "問いを聞いたり、回答を推測したりせず、"
      : "回答を推測したり、別の方法で採点したりせず、";
  const retry =
    phase === "questions"
      ? "もう一度「genba-check で今の現場を診断して」と頼めばやり直せる"
      : "この会話の中で、同じ回答でもう一度採点を頼める（問いに答え直す必要はありません）";
  return {
    /**
     * 人が断ったとき。人が断ったかどうかは返事の速さから推測しているだけで、AI にも見分けられない。
     * そこで環境の手がかりは、確認画面が見えたかどうかをユーザー自身が判断できる条件付きの一文にする。
     */
    declined:
      `ユーザーがプライバシーの説明に同意しなかったため、${stopped}。` +
      `${dont}中止したことをユーザーに伝えてください。` +
      (phase === "scoring"
        ? `${ALREADY_SENT_NOTE.replace("あなたの", "ユーザーの")}断った場合も、行わないのは採点だけです。` +
          "あとで同意する場合は、この会話の中で、同じ回答でもう一度採点を頼めます（問いに答え直す必要はありません）。"
        : "") +
      `そのとき、次の文をそのまま添えてください：「確認画面が表示されなかった場合は、${UNSUPPORTED_CLIENTS}を使っているのかもしれません。` +
      `この確認画面はそこでは表示されません。${interactiveTerminalSteps(phase)}」`,
    /**
     * 確認画面を表示できなかったとき。「断る」「閉じる」が人には不可能な速さで返ってきた場合（VS Code 版の Claude Code や
     * 非対話モードは、表示せずに自動で閉じる）と、対応していると名乗るのに確認画面に応じなかった場合。推測なので、そう伝える。
     */
    unavailable:
      `確認画面を表示できなかったため、${stopped}（ユーザーが断ったのではなく、クライアントが確認画面を出さずに閉じたとみられます）。` +
      `${dont}次のように案内してください：${useInteractiveTerminal(phase)}` +
      "ただし、この判断は推測です。ユーザーが自分で断ったのであれば、何もしなくてかまいません（断ったのであれば、それで大丈夫だと伝えてください）。",
    /** ツールの呼び出しが中断された、または接続が切れたとき（多くの場合、受け取る相手はもういない） */
    aborted: `確認画面の表示中にツールの呼び出しが中断されたため、${stopped}。${dont}${retry}ことを伝えてください。`,
    /** 確認画面で想定外のエラーが起きたとき */
    error:
      `確認画面でエラーが起きたため、${stopped}。${dont}${retry}ことを伝えてください。` +
      "続けて起きる場合は、サーバーのログ（標準エラー出力）を確かめるよう伝えてください。",
    /** 確認画面への返事が、待ち時間を過ぎても来なかったとき */
    timeout: `確認画面への返事がなかったため、${stopped}。${dont}${retry}ことをユーザーに伝えてください。`,
  };
}

// ---------- get_questions ----------

/** 答えやすさのため、AI に聞き方を指示する（AI が従うとは限らないが、従えば選ぶだけで答えられる） */
const ASKING_INSTRUCTION =
  "【聞き方】選択肢から選べる質問用の画面（Claude Code の AskUserQuestion など）が使えるなら、それを使って4問ずつ聞いてください。" +
  `問いの文言を変えずにそのまま見せ、選択肢は ${ANSWER_LIST} の${FACTS.answerCount}つだけにします。文章で全問を並べて、番号と答えを打ち込ませる聞き方はしないでください。` +
  "全問そろったら score_answers に渡して採点してください。";

export type QuestionsPayload = ReturnType<typeof getQuestions>;

/**
 * consented：クライアントの確認画面でユーザーが同意済みなら true。
 * instructions には、本文と同じ指示（説明の扱い・答える前提・聞き方）をすべて入れる。
 * 本文（content）と構造化データ（structuredContent）のどちらを AI に渡すクライアントでも、同じ指示が届くようにするため。
 */
export function getQuestions(consented = false) {
  const privacy = consented
    ? `【説明】クライアントの確認画面で次の説明を出し、同意の返事を受け取っています（ユーザーが読んだかどうかまでは、サーバーからは確かめられません）：${PRIVACY_NOTE}`
    : `【質問を始める前に、次の説明を省略せず、そのままユーザーに伝えてください】${PRIVACY_NOTE}${COMPANY_NOTE}`;
  return {
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      category: categoryOf(q.category),
      reversed: q.reversed,
      text: q.text[AUDIENCE],
    })),
    answerOptions: ANSWER_LABELS,
    instructions: [
      privacy,
      "【答える前提】今いる現場で起きていることについて、期間を区切らずに答えてもらう。" +
        `回答は ${ANSWER_LIST} の${FACTS.answerCount}つから選ぶ。` +
        "reversed が true の問いは良い行動を聞く問いで、「よくある」ほど健全。",
      ASKING_INSTRUCTION,
    ].join("\n"),
  };
}

export function formatQuestions(payload: QuestionsPayload): string {
  const lines = payload.questions.map(
    (q) => `${q.id}. [${q.category.label}${q.reversed ? "・逆転" : ""}] ${q.text}`,
  );
  return [
    payload.instructions,
    "",
    `現場の健全性診断（全${payload.questions.length}問）`,
    `回答の選択肢：${ANSWER_LIST}`,
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
