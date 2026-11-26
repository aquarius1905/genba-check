// 採点が docs/questions.md の仕様どおりになるか、入力の検証が正しいかを確かめる。
import { describe, expect, it } from "vitest";
import { CATEGORIES, LEVELS, QUESTIONS } from "../../src/lib/diagnosis";
import {
  FACTS,
  PRIORITY_THRESHOLD,
  formatErrors,
  formatScore,
  getQuestions,
  scoreAnswers,
  type AnswerInput,
} from "../src/tools";

type Label = "よくある" | "たまにある" | "ない";

/** 全20問に同じ回答をし、一部だけ上書きする */
const answersWith = (base: Label, overrides: Record<number, Label> = {}): AnswerInput[] =>
  Array.from({ length: 20 }, (_, i) => ({
    question_id: i + 1,
    answer: overrides[i + 1] ?? base,
  }));

/** 通常の問いだけ指定の回答、逆転の問い（18〜20）は満点の「よくある」 */
const normalOnly = (overrides: Record<number, Label>): AnswerInput[] =>
  answersWith("ない", { 18: "よくある", 19: "よくある", 20: "よくある", ...overrides });

const ok = (input: unknown) => {
  const r = scoreAnswers(input);
  if (!r.ok) throw new Error(`期待しないエラー: ${r.errors.join(" / ")}`);
  return r.result;
};

const errorsOf = (input: unknown) => {
  const r = scoreAnswers(input);
  if (r.ok) throw new Error("エラーになるはずが成功した");
  return r.errors;
};

const categoryScore = (result: ReturnType<typeof ok>, id: string) =>
  result.categories.find((c) => c.id === id)?.score;

describe("get_questions", () => {
  const payload = getQuestions();

  it("20問を ID 順に返す", () => {
    expect(payload.questions).toHaveLength(20);
    expect(payload.questions.map((q) => q.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("各問にカテゴリ（ID とラベル）と逆転かどうかが付く", () => {
    expect(payload.questions[0]).toMatchObject({
      id: 1,
      category: { id: "overtime", label: "残業文化" },
      reversed: false,
    });
    expect(payload.questions[0].text).toContain("遅くまで働いた人");
  });

  it("仕様どおりのカテゴリ別の問い数（A4・B3・C3・D3・E4・F3）", () => {
    const count = (id: string) => payload.questions.filter((q) => q.category.id === id).length;
    expect(["overtime", "change", "fairness", "time", "safety", "care"].map(count)).toEqual([
      4, 3, 3, 3, 4, 3,
    ]);
  });

  it("逆転の問いは 18〜20 だけ", () => {
    expect(payload.questions.filter((q) => q.reversed).map((q) => q.id)).toEqual([18, 19, 20]);
  });

  it("回答の選択肢は3つ", () => {
    expect(payload.answerOptions).toEqual(["よくある", "たまにある", "ない"]);
  });
});

describe("score_answers：採点仕様", () => {
  it("理想的な回答は 100点・健全・優先項目なし", () => {
    const r = ok(normalOnly({}));
    expect(r.score).toBe(100);
    expect(r.level).toMatchObject({ id: "healthy", label: "健全" });
    expect(r.categories.every((c) => c.score === 100)).toBe(true);
    expect(r.priority).toBeNull();
  });

  it("全問「ない」：通常の問いは2点、逆転の問いは0点 → 34/40 = 85点", () => {
    const r = ok(answersWith("ない"));
    expect(r.score).toBe(85);
    expect(r.level.label).toBe("健全");
    expect(categoryScore(r, "care")).toBe(0);
    expect(categoryScore(r, "overtime")).toBe(100);
    // 総合が80以上でも、最低カテゴリが80未満なら優先項目を出す
    expect(r.priority?.category.id).toBe("care");
    expect(r.priority?.issues.map((i) => i.question_id)).toEqual([18, 19, 20]);
  });

  it("全問「よくある」：通常の問いは0点、逆転の問いは2点 → 6/40 = 15点・危険", () => {
    const r = ok(answersWith("よくある"));
    expect(r.score).toBe(15);
    expect(r.level).toMatchObject({ id: "danger", label: "危険" });
    expect(categoryScore(r, "care")).toBe(100);
    expect(categoryScore(r, "overtime")).toBe(0);
  });

  it("全問「たまにある」は 50点・要警戒", () => {
    const r = ok(answersWith("たまにある"));
    expect(r.score).toBe(50);
    expect(r.level).toMatchObject({ id: "warning", label: "要警戒" });
    expect(r.categories.every((c) => c.score === 50)).toBe(true);
  });

  it("項目別スコアは四捨五入（3問カテゴリで 1/6 → 17、5/6 → 83）", () => {
    const r = ok(normalOnly({ 5: "よくある", 6: "よくある", 7: "たまにある", 8: "たまにある" }));
    expect(categoryScore(r, "change")).toBe(17); // 1/6 = 16.67
    expect(categoryScore(r, "fairness")).toBe(83); // 5/6 = 83.33
  });

  it("総合スコアも四捨五入（39/40 = 97.5 → 98）", () => {
    expect(ok(normalOnly({ 1: "たまにある" })).score).toBe(98);
  });

  // 総合スコアの境界：通常の問いを「よくある」(-2) と「たまにある」(-1) で減らす
  const withLoss = (loss: number) => {
    const overrides: Record<number, Label> = {};
    let id = 1;
    let rest = loss;
    while (rest >= 2) {
      overrides[id++] = "よくある";
      rest -= 2;
    }
    if (rest === 1) overrides[id] = "たまにある";
    return normalOnly(overrides);
  };

  it.each([
    [8, 80, "健全"], // 32/40
    [9, 78, "注意"], // 31/40 = 77.5 → 78
    [16, 60, "注意"], // 24/40
    [17, 58, "要警戒"], // 23/40 = 57.5 → 58（(23 / 40) * 100 だと 57.4999… になり 57 に誤る）
    [24, 40, "要警戒"], // 16/40
    [25, 38, "危険"], // 15/40 = 37.5 → 38
  ])("失点 %i → %i点・%s", (loss, score, label) => {
    const r = ok(withLoss(loss));
    expect(r.score).toBe(score);
    expect(r.level.label).toBe(label);
  });

  it("総合スコアは全パターンで「得点 ÷ 40 × 100 の四捨五入」と一致する", () => {
    for (let loss = 0; loss <= 34; loss++) {
      const got = 40 - loss;
      // 得点 × 100 は 40 で割り切れるか .5 で終わるので、小数第1位まで整数で求めて切り上げ判定する
      const tenths = (got * 1000) / 40;
      const expected = Math.floor(tenths / 10) + (tenths % 10 >= 5 ? 1 : 0);
      expect(ok(withLoss(loss)).score).toBe(expected);
    }
  });

  it("優先して見る項目は最もスコアが低いカテゴリ", () => {
    const r = ok(normalOnly({ 11: "よくある", 12: "よくある", 1: "たまにある" }));
    expect(r.priority?.category).toEqual({ id: "time", label: "時間への配慮" });
    expect(r.priority?.score).toBe(33); // 2/6
  });

  it("同点なら A→F の順で先のカテゴリ", () => {
    // 変更管理(B)・時間への配慮(D)・人への関心(F) を同じ 0点にする
    const r = ok(
      normalOnly({
        5: "よくある",
        6: "よくある",
        7: "よくある",
        11: "よくある",
        12: "よくある",
        13: "よくある",
        18: "ない",
        19: "ない",
        20: "ない",
      }),
    );
    expect(r.priority?.category.id).toBe("change");
  });

  it("最低カテゴリが80以上なら優先項目は出さない", () => {
    // 4問カテゴリで1問「たまにある」→ 7/8 = 88
    const r = ok(normalOnly({ 1: "たまにある", 14: "たまにある" }));
    expect(Math.min(...r.categories.map((c) => c.score))).toBe(88);
    expect(r.priority).toBeNull();
  });

  it("最低カテゴリがちょうど 80 未満なら優先項目を出す（3問カテゴリで1問「たまにある」→ 83 は出さない、4問で2問 → 75 は出す）", () => {
    expect(ok(normalOnly({ 5: "たまにある" })).priority).toBeNull(); // 83
    expect(ok(normalOnly({ 1: "たまにある", 2: "たまにある" })).priority?.score).toBe(75);
  });

  it("根拠には点数を落とした回答だけを並べる（通常：よくある／たまにある、逆転：ない／たまにある）", () => {
    const normal = ok(normalOnly({ 1: "よくある", 2: "たまにある" }));
    expect(normal.priority?.issues).toEqual([
      expect.objectContaining({ question_id: 1, answer: "よくある", reversed: false }),
      expect.objectContaining({ question_id: 2, answer: "たまにある", reversed: false }),
    ]);

    const reversed = ok(normalOnly({ 18: "ない", 19: "たまにある" }));
    expect(reversed.priority?.category.id).toBe("care");
    expect(reversed.priority?.issues).toEqual([
      expect.objectContaining({ question_id: 18, answer: "ない", reversed: true }),
      expect.objectContaining({ question_id: 19, answer: "たまにある", reversed: true }),
    ]);
  });

  it("優先項目には本人が取れる行動（仕様の表の文言）が付く", () => {
    const r = ok(normalOnly({ 11: "よくある", 12: "よくある" }));
    expect(r.priority?.advice).toBe(
      "集中する時間をカレンダーに入れて見えるようにしましょう。会議は終了時刻の5分前に、次の予定があることを伝えておくと抜けやすくなります。勤務時間外のチャットには、返信できる時間帯をあらかじめ伝えておきましょう。",
    );
  });

  it("カテゴリ別スコアは A→F の6件", () => {
    expect(ok(answersWith("ない")).categories.map((c) => c.label)).toEqual([
      "残業文化",
      "変更管理",
      "扱いの公正さ",
      "時間への配慮",
      "心理的安全性",
      "人への関心",
    ]);
  });

  it("ラベルには説明文が付く", () => {
    expect(ok(answersWith("よくある")).level.description).toContain("深刻な危険信号");
  });
});

describe("score_answers：入力の受け付け", () => {
  it("回答の順番は問わない", () => {
    const shuffled = [...answersWith("たまにある", { 3: "よくある" })].reverse();
    expect(ok(shuffled)).toEqual(ok(answersWith("たまにある", { 3: "よくある" })));
  });

  it("内部値 often / sometimes / never も受け付ける", () => {
    const en = answersWith("ない").map((a) => ({
      ...a,
      answer: a.question_id === 1 ? "often" : a.question_id === 2 ? "sometimes" : "never",
    }));
    expect(ok(en)).toEqual(ok(answersWith("ない", { 1: "よくある", 2: "たまにある" })));
  });

  it("回答の前後の空白は無視する", () => {
    const padded = answersWith("ない").map((a) => ({ ...a, answer: ` ${a.answer} ` }));
    expect(ok(padded).score).toBe(85);
  });

  it("question_id が数字の文字列でも受け付ける", () => {
    const strIds = answersWith("ない").map((a) => ({ ...a, question_id: String(a.question_id) }));
    expect(ok(strIds).score).toBe(85);
  });
});

describe("score_answers：不正な入力", () => {
  it("回答が足りないと、件数と不足している問いを伝える", () => {
    const errors = errorsOf(answersWith("ない").filter((a) => a.question_id !== 7));
    expect(errors.join("\n")).toContain("回答が19件です。20問すべてへの回答（20件）が必要です");
    expect(errors.join("\n")).toContain("回答がない問い：7");
  });

  it("回答が多すぎると、件数と重複を伝える", () => {
    const errors = errorsOf([...answersWith("ない"), { question_id: 5, answer: "ない" }]);
    expect(errors.join("\n")).toContain("回答が21件です");
    expect(errors.join("\n")).toContain("question_id 5 への回答が2件あります");
  });

  it("範囲外の question_id を伝える", () => {
    const input = answersWith("ない").map((a) =>
      a.question_id === 20 ? { ...a, question_id: 21 } : a,
    );
    const msg = errorsOf(input).join("\n");
    expect(msg).toContain("20件目：question_id 21 は存在しません。1〜20 の整数を指定してください");
    expect(msg).toContain("回答がない問い：20");
  });

  it("question_id と answer の両方が不正なら、両方を一度に伝える（ID が使えない項目は位置で示す）", () => {
    const input = answersWith("ない").map((a) =>
      a.question_id === 20 ? { question_id: 21, answer: "はい" } : a,
    );
    const msg = errorsOf(input).join("\n");
    expect(msg).toContain("20件目：question_id 21 は存在しません");
    expect(msg).toContain("20件目 の回答「はい」は使えません");
    expect(msg).toContain("回答がない問い：20");
  });

  it("使えない回答の値を、使える値と一緒に伝える", () => {
    const msg = errorsOf(answersWith("ない", { 3: "時々" as Label })).join("\n");
    expect(msg).toContain("question_id 3 の回答「時々」は使えません");
    expect(msg).toContain("よくある／たまにある／ない");
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])(
    "オブジェクトの継承キー「%s」は回答として受け付けない",
    (key) => {
      for (const id of [1, 18]) {
        const input = answersWith("ない").map((a) =>
          a.question_id === id ? { ...a, answer: key } : a,
        );
        expect(errorsOf(input).join("\n")).toContain(
          `question_id ${id} の回答「${key}」は使えません`,
        );
      }
    },
  );

  it.each([
    ["null", null],
    ["数値", 1],
    ["なし", undefined],
  ])("answer が文字列でない（%s）", (_, value) => {
    const input = answersWith("ない").map((a) =>
      a.question_id === 2 ? { question_id: 2, answer: value } : a,
    );
    expect(errorsOf(input).join("\n")).toContain("question_id 2 の回答");
  });

  it("question_id がない", () => {
    const input = answersWith("ない").map((a) => (a.question_id === 2 ? { answer: "ない" } : a));
    const msg = errorsOf(input).join("\n");
    expect(msg).toContain("question_id （なし） は存在しません");
    expect(msg).toContain("回答がない問い：2");
  });

  it("複数の問題はまとめて返す", () => {
    const input = answersWith("ない", { 3: "はい" as Label, 4: "いいえ" as Label }).slice(0, 18);
    expect(errorsOf(input).length).toBeGreaterThanOrEqual(3);
  });

  // MCP 経由では、配列でない・要素がオブジェクトでない入力は SDK の入力スキーマが先に弾く。
  // ここは scoreAnswers を直接呼ぶ場合の防御を確かめる
  it.each([
    ["配列でない", { 1: "ない" }],
    ["undefined", undefined],
    ["要素がオブジェクトでない", Array(20).fill("ない")],
  ])("answers の形が違う（%s）", (_, input) => {
    expect(errorsOf(input).join("\n")).toContain("answers");
  });

  it("question_id が整数でない", () => {
    const input = answersWith("ない").map((a) =>
      a.question_id === 1 ? { ...a, question_id: 1.5 } : a,
    );
    expect(errorsOf(input).join("\n")).toContain("1〜20 の整数");
  });
});

describe("本体のデータとの整合", () => {
  it("優先して見る項目の基準は仕様どおり 80（docs/questions.md「スコアが80以上ならこの欄は出さない」）", () => {
    // 基準は本体 src/lib/diagnosis.ts の PRIORITY_THRESHOLD を diagnose() と MCP の文言で共有している
    expect(PRIORITY_THRESHOLD).toBe(80);
  });

  it("FACTS は本体のデータから作られている", () => {
    expect(FACTS.total).toBe(QUESTIONS.length);
    expect(FACTS.idRange).toBe(`1〜${QUESTIONS.length}`);
    expect(FACTS.categoryCount).toBe(CATEGORIES.length);
    for (const c of CATEGORIES) expect(FACTS.categoryList).toContain(c.label);
    for (const l of LEVELS) expect(FACTS.levelList).toContain(l.label);
  });

  it("エラーの案内と結果の文言は、固定の数ではなく FACTS / PRIORITY_THRESHOLD を使う", () => {
    const text = formatErrors(["x"]);
    expect(text).toContain(`${FACTS.total}問を確認し`);
    expect(text).toContain(`question_id ${FACTS.idRange} のそれぞれ`);
    expect(
      formatScore(ok(answersWith("ない", { 18: "よくある", 19: "よくある", 20: "よくある" }))),
    ).toContain(`すべての項目が${PRIORITY_THRESHOLD}点以上`);
  });
});
