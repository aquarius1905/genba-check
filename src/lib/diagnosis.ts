// 質問・採点ロジック。仕様は docs/questions.md を参照。
// 将来の管理者向けに備えて、問いの ID と対象者ごとの文言を分けて持つ。

export type Audience = "engineer";

export type CategoryId = "overtime" | "change" | "fairness" | "time" | "safety" | "care";

export type Category = {
  id: CategoryId;
  label: string;
  /** エンジニア本人が取れる行動 */
  advice: Record<Audience, string>;
};

export type Question = {
  id: number;
  category: CategoryId;
  /** true = 良い行動を聞く問い（「よくある」が高得点） */
  reversed: boolean;
  text: Record<Audience, string>;
};

export type Answer = "often" | "sometimes" | "never";

export const ANSWER_OPTIONS: { value: Answer; label: string }[] = [
  { value: "often", label: "よくある" },
  { value: "sometimes", label: "たまにある" },
  { value: "never", label: "ない" },
];

export const CATEGORIES: Category[] = [
  {
    id: "overtime",
    label: "残業文化",
    advice: {
      engineer:
        "この現場では、遅くまで残ること自体が評価されやすくなっています。個人の頑張りでは変わりにくいので、自分が働く時間の上限を先に決めておきましょう。実際に働いた時間を記録しておくと、負担を説明するときの根拠になります。",
    },
  },
  {
    id: "change",
    label: "変更管理",
    advice: {
      engineer:
        "アカウントや仕様の変更があったら、日時・内容・影響をメモに残しましょう。遅れの理由を説明するときや、負担について相談するときに、自分を守る材料になります。",
    },
  },
  {
    id: "fairness",
    label: "扱いの公正さ",
    advice: {
      engineer:
        "進捗を報告するときは、件数だけでなく、作業の難しさと詰まっている理由も一緒に伝えましょう。比べられる前に、比べ方の前提をそろえておくためです。提案や懸念は、チャットなど記録が残る場所で伝えておきましょう。聞き入れられなくても、自分が指摘していたことを後から示せます。",
    },
  },
  {
    id: "time",
    label: "時間への配慮",
    advice: {
      engineer:
        "集中する時間をカレンダーに入れて見えるようにしましょう。会議は終了時刻の5分前に、次の予定があることを伝えておくと抜けやすくなります。",
    },
  },
  {
    id: "safety",
    label: "心理的安全性",
    advice: {
      engineer:
        "報告や質問は、口頭ではなくチャットやチケットなど記録が残る場所で行いましょう。「いつ伝えたか」が残っていれば、後から責任を押し付けられにくくなります。",
    },
  },
  {
    id: "care",
    label: "人への関心",
    advice: {
      engineer:
        "現場から気にかけてもらうことは期待しにくい状態です。自分の負荷や体調を自分で記録し、限界が来る前に、信頼できる人に相談したり、環境を変えることを考えたりしましょう。",
    },
  },
];

const q = (id: number, category: CategoryId, engineer: string, reversed = false): Question => ({
  id,
  category,
  reversed,
  text: { engineer },
});

export const QUESTIONS: Question[] = [
  q(1, "overtime", "遅くまで働いた人にだけ、リアクションがついたり称賛される傾向がある"),
  q(2, "overtime", "定時で帰るときに、気まずさを感じたり理由を説明しなければならない雰囲気がある"),
  q(3, "overtime", "遅れが出たとき、スコープや期限の見直しより先に「残業で取り戻す」話になる"),
  q(4, "overtime", "見積もりやスケジュールが、残業する前提で組まれている"),
  q(5, "change", "作業に必要なアカウントや環境が、事前の告知なしに変更・削除されることがある"),
  q(6, "change", "仕様や優先度が、理由の説明なく変更されることがある"),
  q(7, "change", "環境や前提が整っていないまま、作業の開始日や期限が決められることがある"),
  q(8, "fairness", "作業の件数やスピードを、中身を見ずに他の人と比べられることがある"),
  q(9, "fairness", "実際の作業を確認せずに「簡単そう」「もう少しできるはず」と言われることがある"),
  q(10, "fairness", "業務委託や派遣などの立場を理由に、提案や懸念を聞いてもらえないことがある"),
  q(11, "time", "作業中に、こちらの都合を確認せずに通話や打ち合わせに呼ばれることがある"),
  q(12, "time", "会議が予定の時間を過ぎても、主催者が止めずに続くことがある"),
  q(13, "time", "勤務時間外のチャットに、すぐ返信することを期待される"),
  q(
    14,
    "safety",
    "問題を報告すると、内容を受け止める前に、質問の仕方やタイミングを指摘されることがある",
  ),
  q(15, "safety", "質問すると、面倒そうな反応や遠回しな非難が返ってくることがある"),
  q(16, "safety", "障害やミスのあと、原因よりも「誰がやったか」が話の中心になる"),
  q(
    17,
    "safety",
    "リーダーや管理者の判断でチームの作業が止まったり遅れたりしても、謝罪の一言もないことがある",
  ),
  q(18, "care", "リーダーや上司から、仕事の負荷や体調について聞かれることがある", true),
  q(19, "care", "チームの会話で、メンバーの働きやすさや成長が話題になることがある", true),
  q(20, "care", "工夫や頑張りが、件数や数字以外の形でも認められることがある", true),
];

export type LevelId = "healthy" | "caution" | "warning" | "danger";

export type Level = {
  id: LevelId;
  label: string;
  min: number;
  description: string;
};

/** min の高い順 */
export const LEVELS: Level[] = [
  {
    id: "healthy",
    label: "健全",
    min: 80,
    description:
      "大きな危険信号はほとんどありません。当たり前のことが当たり前に守られている現場です。",
  },
  {
    id: "caution",
    label: "注意",
    min: 60,
    description:
      "いくつかの項目で危険信号が出ています。今のうちに、自分を守る行動を始めておきましょう。",
  },
  {
    id: "warning",
    label: "要警戒",
    min: 40,
    description:
      "複数の項目で危険信号が出ています。消耗する前に、記録と次の選択肢の準備を始めましょう。",
  },
  {
    id: "danger",
    label: "危険",
    min: 0,
    description:
      "多くの項目で深刻な危険信号が出ています。個人の努力でどうにかできる範囲を超えている可能性があります。",
  },
];

export const levelOf = (score: number): Level =>
  LEVELS.find((l) => score >= l.min) ?? LEVELS[LEVELS.length - 1];

export const findLevel = (id: string): Level | undefined => LEVELS.find((l) => l.id === id);

/** 1問あたり 0〜2 点。高いほど健全 */
export const pointsFor = (question: Question, answer: Answer): number => {
  const base = answer === "often" ? 0 : answer === "sometimes" ? 1 : 2;
  return question.reversed ? 2 - base : base;
};

export type CategoryResult = {
  category: Category;
  score: number;
  /** 点数を落とした問いと回答 */
  issues: { question: Question; answer: Answer }[];
};

export type DiagnosisResult = {
  score: number;
  level: Level;
  categories: CategoryResult[];
  /** 最もスコアが低いカテゴリ。PRIORITY_THRESHOLD 以上なら null */
  priority: CategoryResult | null;
};

/** 「優先して見る項目」を出すカテゴリスコアの基準（これ未満なら出す） */
export const PRIORITY_THRESHOLD = 80;

// 先に割ると 23/40 が 57.4999… になり四捨五入を誤るので、掛けてから割る
const percent = (got: number, max: number) => Math.round((got * 100) / max);

export function diagnose(answers: Record<number, Answer>): DiagnosisResult {
  let total = 0;
  const categories = CATEGORIES.map((category) => {
    const qs = QUESTIONS.filter((x) => x.category === category.id);
    let got = 0;
    const issues: CategoryResult["issues"] = [];
    for (const question of qs) {
      const answer = answers[question.id];
      const p = pointsFor(question, answer);
      got += p;
      if (p < 2) issues.push({ question, answer });
    }
    total += got;
    return { category, score: percent(got, qs.length * 2), issues };
  });

  const score = percent(total, QUESTIONS.length * 2);
  // 同点なら CATEGORIES の並び順で先のもの
  const worst = categories.reduce((a, b) => (b.score < a.score ? b : a));
  return {
    score,
    level: levelOf(score),
    categories,
    priority: worst.score < PRIORITY_THRESHOLD ? worst : null,
  };
}
