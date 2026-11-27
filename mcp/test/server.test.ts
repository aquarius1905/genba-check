// MCP クライアントから実際にツールを呼び、登録とやりとりが正しいかを確かめる。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES, LEVELS, QUESTIONS } from "../../src/lib/diagnosis";
import { createServer, type ServerOptions } from "../src/server";
import { ANSWER_LABELS, FACTS, PRIORITY_THRESHOLD, PRIVACY_NOTE } from "../src/tools";

let client: Client;
/** テストの中で作った接続。afterEach で必ず閉じる（テストが途中で失敗しても残さない） */
const opened: Client[] = [];

beforeEach(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await client.close();
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

const allNever = Array.from({ length: 20 }, (_, i) => ({ question_id: i + 1, answer: "ない" }));

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

describe("MCP サーバー", () => {
  it("get_questions と score_answers を公開し、日本語の説明が付いている", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_questions", "score_answers"]);
    for (const tool of tools) {
      expect(tool.description).toMatch(/[ぁ-ん]/);
      expect(tool.outputSchema).toBeDefined();
    }
    const score = tools.find((t) => t.name === "score_answers")!;
    const props = score.inputSchema.properties as Record<string, { description?: string }>;
    expect(props.answers.description).toContain("よくある");
    expect(score.inputSchema.required).toEqual(["answers"]);
  });

  it("ツールの説明は問いの数・ID の範囲・カテゴリ名・ラベル名を本体のデータから載せる", async () => {
    const { tools } = await client.listTools();
    const get = tools.find((t) => t.name === "get_questions")!.description!;
    const score = tools.find((t) => t.name === "score_answers")!.description!;
    expect(get).toContain(`${QUESTIONS.length}問を返す`);
    expect(get).toContain(`id（${FACTS.idRange}）`);
    for (const c of CATEGORIES) expect(get).toContain(c.label);
    expect(score).toContain(`${QUESTIONS.length}問すべてに`);
    expect(score).toContain(`カテゴリ別スコア（${CATEGORIES.length}項目）`);
    for (const l of LEVELS) expect(score).toContain(l.label);
    expect(score).toContain(`すべて${PRIORITY_THRESHOLD}点以上なら null`);
  });

  it("get_questions は20問を structuredContent と本文で返す", async () => {
    const result = await client.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { questions: unknown[] };
    expect(data.questions).toHaveLength(20);
    expect(textOf(result)).toContain("1. [残業文化]");
    expect(textOf(result)).toContain("20. [人への関心・逆転]");
  });

  it("score_answers は結果を structuredContent と本文で返す", async () => {
    const result = await client.callTool({
      name: "score_answers",
      arguments: { answers: allNever },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      score: 85,
      level: { label: "健全" },
      priority: { category: { label: "人への関心" } },
    });
    const text = textOf(result);
    expect(text).toContain("総合スコア：85点（健全）");
    expect(text).toContain("優先して見る項目：人への関心");
    // 保存・送信しないのはこのサーバーだけ。AIクライアント側の送信・記録は別であることを伝える
    expect(text).toContain("この MCP サーバーは回答を保存・外部送信しません");
    expect(text).toContain("AIの提供元に送信");
    expect(text).not.toContain("どこにも");
  });

  it("ツールの説明でも、会話がAIの提供元に送られることに触れる", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).not.toContain("どこにも");
    }
    expect(tools.find((t) => t.name === "get_questions")!.description).toContain("AIの提供元");
  });

  it.each([
    ["answer が null", { question_id: 2, answer: null }, "question_id 2 の回答"],
    ["answer が数値", { question_id: 2, answer: 3 }, "question_id 2 の回答"],
    ["question_id がない", { answer: "ない" }, "回答がない問い：2"],
  ])("%s でも日本語のメッセージを返す（SDK の英語エラーにしない）", async (_, item, expected) => {
    const answers = allNever.map((a) => (a.question_id === 2 ? item : a));
    const result = await client.callTool({ name: "score_answers", arguments: { answers } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(expected);
    expect(textOf(result)).toContain("採点できませんでした");
  });

  it("要素がオブジェクトでないときは、説明どおり入力形式のエラーになる", async () => {
    const result = await client.callTool({
      name: "score_answers",
      arguments: { answers: ["ない"] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("answers");
  });

  it("継承キーの回答（constructor / toString）でクラッシュせず日本語のエラーを返す", async () => {
    const answers = allNever.map((a) =>
      a.question_id === 1
        ? { ...a, answer: "constructor" }
        : a.question_id === 18
          ? { ...a, answer: "toString" }
          : a,
    );
    const result = await client.callTool({ name: "score_answers", arguments: { answers } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("question_id 1 の回答「constructor」は使えません");
    expect(textOf(result)).toContain("question_id 18 の回答「toString」は使えません");
  });

  it("score_answers は不正な回答に isError と日本語のメッセージを返す", async () => {
    const result = await client.callTool({
      name: "score_answers",
      arguments: { answers: allNever.slice(0, 19) },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("回答が19件です");
    expect(textOf(result)).toContain("get_questions");
  });

  it("answers がないと isError を返す", async () => {
    const result = await client.callTool({ name: "score_answers", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("answers");
  });
});

// ---------- 確認画面（elicitation） ----------
// 対応クライアントでは、AI を通さずにクライアントの画面で説明と問いを出す。

type ElicitParams = { message: string; requestedSchema: { properties: Record<string, unknown> } };
type Reply = { action: "accept" | "decline" | "cancel"; content?: Record<string, string> };

/**
 * 確認画面に対応したクライアントにつなぐ。reply が画面ごとの返事を決め、表示された画面を shown に記録する。
 * fastDeclineMs：テストの返事は一瞬で返るので、人が断った場合を試すときは 0 にする
 */
async function connectWithElicitation(
  reply: (params: ElicitParams, index: number) => Reply | Promise<Reply>,
  fastDeclineMs?: number,
  options: ServerOptions = {},
) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({
    ...(fastDeclineMs === undefined ? {} : { fastDeclineMs }),
    ...options,
  }).connect(serverTransport);
  const c = new Client(
    { name: "test-elicitation", version: "0.0.0" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const shown: ElicitParams[] = [];
  c.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = request.params as unknown as ElicitParams;
    shown.push(params);
    return reply(params, shown.length - 1);
  });
  await c.connect(clientTransport);
  opened.push(c);
  return { c, shown };
}

describe("get_questions：プライバシーの説明", () => {
  it("対応クライアントでは、問いを返す前にクライアントの画面で説明を出す", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(shown).toHaveLength(1);
    expect(shown[0].message).toContain(PRIVACY_NOTE);
    expect(shown[0].message).not.toContain("\n");
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { questions: unknown[] }).questions).toHaveLength(20);
    expect(textOf(result)).toContain(PRIVACY_NOTE);
  });

  it.each(["decline", "cancel"] as const)(
    "人が同意しなかったとき（%s）は問いを返さない",
    async (action) => {
      const { c } = await connectWithElicitation(() => ({ action }), 0);
      const result = await c.callTool({ name: "get_questions", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(textOf(result)).toContain("同意しなかった");
      expect(textOf(result)).not.toContain("1. [残業文化]");
    },
  );

  it("断る返事が速すぎるときは、問いを返さず、表示できなかったと案内する", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("確認画面を表示できなかった");
    expect(textOf(result)).not.toContain("1. [残業文化]");
  });

  it("非対応クライアントでは、結果の本文の先頭に説明を置き、そのまま伝えるよう指示する", async () => {
    const result = await client.callTool({ name: "get_questions", arguments: {} });
    const text = textOf(result);
    expect(text.indexOf(PRIVACY_NOTE)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(PRIVACY_NOTE)).toBeLessThan(text.indexOf("1. [残業文化]"));
    expect(text).toContain("そのまま");
  });

  it("同意を得たら、質問用の画面で4問ずつ、文言を変えずに聞くよう指示する", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    const text = textOf(result);
    expect(text).toContain("質問用の画面");
    expect(text).toContain("4問ずつ");
    expect(text).toContain("文言を変えず");
    expect(text).toContain("score_answers");
  });

  it("確認画面を表示できなかったときの案内は、ターミナル版に誘導する", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain("ターミナル");
    expect(text).not.toContain("start_diagnosis");
  });

  it("聞き方の指示の選択肢の数は、固定ではなく本体のデータから作る", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain(`${ANSWER_LABELS.join("／")} の${FACTS.answerCount}つだけ`);
  });

  it("人が断ったときの案内にも、表示できなかった場合の手がかりを添える（判定は推測のため）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain("同意しなかった");
    expect(text).toContain("確認画面が表示されなかった場合");
  });

  it("表示できなかったときの案内は、VS Code 版と非対話モードの両方に通じる中立な文で、推測であることも示す", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain("VS Code");
    expect(text).toContain("claude -p");
    expect(text).toContain("対話モード");
    expect(text).toContain("とみられます");
  });
});

describe("get_questions：確認画面の失敗", () => {
  it("確認画面への返事が待ち時間を過ぎても来ないときは、日本語で案内して問いを返さない", async () => {
    const { c } = await connectWithElicitation(
      () => new Promise<Reply>((resolve) => setTimeout(() => resolve({ action: "accept" }), 200)),
      0,
      { elicitTimeoutMs: 50 },
    );
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("返事がなかった");
    expect(text).not.toMatch(/timed out|timeout/i);
    expect(text).not.toContain("1. [残業文化]");
  });

  it("待ち時間の既定は、人が説明を読んで考えられるよう60秒より長い", async () => {
    const { DEFAULT_ELICIT_TIMEOUT_MS } = await import("../src/server");
    expect(DEFAULT_ELICIT_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it("確認画面に対応していると名乗るのに、実際には応じないクライアントでは、日本語で案内して問いを返さない", async () => {
    // elicitation: {} だけを宣言し、elicitation/create に応じない（SDK は {} を { form: {} } とみなす）
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    const c = new Client(
      { name: "test-broken-elicitation", version: "0.0.0" },
      { capabilities: { elicitation: {} } },
    );
    await c.connect(clientTransport);
    opened.push(c);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("確認画面を表示できなかった");
    expect(text).not.toMatch(/Method not found|MCP error/i);
    expect(text).not.toContain("1. [残業文化]");
  });

  it("ツールの呼び出しを中断すると、確認画面の要求も取り消し、クライアント側の確認画面の処理も止まる（サーバー起動後の最初の確認画面でも）", async () => {
    // SDK は id 0 の要求への取り消しを無視する。サーバー起動後の最初の確認画面が id 0 にならないことも、ここで確かめる
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    const c = new Client(
      { name: "test-abort", version: "0.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    let shown!: () => void;
    const elicitShown = new Promise<void>((resolve) => (shown = resolve));
    let handlerAborted = false;
    // 返事をせずに待つ（人が確認画面を開いたまま考えている状態）。取り消されたら気づく
    c.setRequestHandler(ElicitRequestSchema, (_request, extra) => {
      shown();
      return new Promise((resolve) => {
        extra.signal.addEventListener("abort", () => {
          handlerAborted = true;
          resolve({ action: "cancel" });
        });
      });
    });
    await c.connect(clientTransport);
    opened.push(c);

    const controller = new AbortController();
    const call = c
      .callTool({ name: "get_questions", arguments: {} }, undefined, { signal: controller.signal })
      .catch(() => undefined);
    await elicitShown;
    controller.abort();
    await call;
    await vi.waitFor(() => expect(handlerAborted).toBe(true));
  });

  it("想定外のエラーのときは VS Code の話をせず、エラーコードだけを stderr に残す（回答は残さない）", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { c } = await connectWithElicitation(() => {
      throw new Error("boom");
    }, 0);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("エラー");
    expect(text).not.toContain("VS Code");
    expect(text).not.toContain("1. [残業文化]");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0].join(" "))).toMatch(/genba-check.*-?\d+/);
  });

  it("自動で閉じたとみなす速さの基準は、人の素早い操作と取り違えにくい 0.1 秒以下", async () => {
    const { DEFAULT_FAST_DECLINE_MS } = await import("../src/server");
    expect(DEFAULT_FAST_DECLINE_MS).toBeLessThanOrEqual(100);
  });

  it("表示できなかったときの案内にも、断ったのであれば何もしなくてよいと添える（判定は推測のため）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain("断ったのであれば");
  });
});

describe("同意の扱い", () => {
  it("確認画面を出せないクライアントでも、structuredContent に説明を入れる（構造化データだけを AI に渡すクライアントのため）", async () => {
    const result = await client.callTool({ name: "get_questions", arguments: {} });
    expect((result.structuredContent as { privacy?: string }).privacy).toBe(PRIVACY_NOTE);
  });

  it("まだ同意を得ていないときは、score_answers も採点の前に同意の確認画面を出し、同意したら採点する", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({ name: "score_answers", arguments: { answers: allNever } });
    expect(shown).toHaveLength(1);
    expect(shown[0].message).toContain(PRIVACY_NOTE);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ score: 85 });
  });

  it("同意しなかったときは、score_answers は採点しない", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    const result = await c.callTool({ name: "score_answers", arguments: { answers: allNever } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textOf(result)).not.toContain("総合スコア");
  });

  it("get_questions で同意を得たあとは、score_answers で同意の確認画面を出し直さない", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    await c.callTool({ name: "get_questions", arguments: {} });
    const result = await c.callTool({ name: "score_answers", arguments: { answers: allNever } });
    expect(shown).toHaveLength(1);
    expect(result.isError).toBeFalsy();
  });

  it("get_questions で断ったあとに score_answers が呼ばれても、改めて同意を確かめ、断れば採点しない", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    await c.callTool({ name: "get_questions", arguments: {} });
    const result = await c.callTool({ name: "score_answers", arguments: { answers: allNever } });
    expect(shown).toHaveLength(2);
    expect(result.isError).toBe(true);
  });

  it("構造化データの instructions にも、聞き方の指示を入れる（同意済みの場合）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    const instructions = (result.structuredContent as { instructions: string }).instructions;
    expect(instructions).toContain("4問ずつ");
    expect(instructions).toContain("文言を変えず");
    expect(instructions).toContain("打ち込ませる聞き方はしない");
  });

  it("構造化データの instructions にも、質問の前に説明をそのまま伝える指示と、会社名などを書かなくてよい旨を入れる（確認画面を出せない場合）", async () => {
    const result = await client.callTool({ name: "get_questions", arguments: {} });
    const instructions = (result.structuredContent as { instructions: string }).instructions;
    expect(instructions).toContain("そのまま");
    expect(instructions).toContain(PRIVACY_NOTE);
    expect(instructions).toContain("会社名や個人名");
    expect(instructions).toContain("4問ずつ");
  });

  it("get_questions は、同意済みでも呼ばれるたびに確認画面を出す（診断を始めるたびに説明を見せる）", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    await c.callTool({ name: "get_questions", arguments: {} });
    await c.callTool({ name: "get_questions", arguments: {} });
    expect(shown).toHaveLength(2);
  });

  it("採点の前に同意が取れなかったときは、採点向けの案内を返す（問いに答え直させない）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    const text = textOf(
      await c.callTool({ name: "score_answers", arguments: { answers: allNever } }),
    );
    expect(text).toContain("採点しませんでした");
    expect(text).toContain("答え直す必要はありません");
    expect(text).not.toContain("診断を始めませんでした");
  });

  it("採点の前の確認画面が表示できなかったときも、採点向けの案内を返す", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const text = textOf(
      await c.callTool({ name: "score_answers", arguments: { answers: allNever } }),
    );
    expect(text).toContain("採点しませんでした");
    expect(text).toContain("答え直す必要はありません");
    expect(text).not.toContain("診断を始めませんでした");
  });

  it("同意したあとに get_questions で断ったら、以前の同意は取り消し、score_answers で改めて確かめる", async () => {
    const replies: Reply[] = [
      { action: "accept", content: {} },
      { action: "decline" },
      { action: "decline" },
    ];
    const { c, shown } = await connectWithElicitation((_p, i) => replies[i], 0);
    await c.callTool({ name: "get_questions", arguments: {} });
    await c.callTool({ name: "get_questions", arguments: {} });
    const result = await c.callTool({ name: "score_answers", arguments: { answers: allNever } });
    expect(shown).toHaveLength(3);
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain("総合スコア");
  });

  it("回答に不備があるときは、確認画面を出さずに、先に不備を返す", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({
      name: "score_answers",
      arguments: { answers: allNever.slice(0, 19) },
    });
    expect(shown).toHaveLength(0);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("回答が19件です");
  });

  it("採点の前の確認画面と断ったときの案内は、回答がすでに会話として送られていることを伝える", async () => {
    const { c, shown } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    const text = textOf(
      await c.callTool({ name: "score_answers", arguments: { answers: allNever } }),
    );
    expect(shown[0].message).toContain("すでに");
    expect(shown[0].message).toContain("送られています");
    expect(text).toContain("行わないのは採点だけ");
  });

  it("採点の前の確認画面を表示できなかったときは、回答を控えて新しいセッションに貼り付けるよう案内する", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }));
    const text = textOf(
      await c.callTool({ name: "score_answers", arguments: { answers: allNever } }),
    );
    expect(text).toContain("控えて");
    expect(text).toContain("貼り付け");
  });

  it("人には不可能な速さの「同意」も、確認画面を表示できなかったものとして扱う（自動で承諾するクライアントのため）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "accept", content: {} }));
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("確認画面を表示できなかった");
    expect(textOf(result)).not.toContain("1. [残業文化]");
  });

  it("ツールの説明は、isError の内容を「そのまま」ではなく「返ってきた指示に従って」伝えるよう書く", async () => {
    const { tools } = await client.listTools();
    const get = tools.find((t) => t.name === "get_questions")!.description!;
    expect(get).toContain("返ってきた指示に従って");
    expect(get).not.toContain("返ってきた内容をそのままユーザーに伝える");
  });

  it("同意したときの AI への文は、確認画面で同意の返事を受け取った、という事実だけを伝える", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "accept", content: {} }), 0);
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    const instructions = (result.structuredContent as { instructions: string }).instructions;
    expect(instructions).toContain("同意の返事を受け取っています");
    expect(instructions).not.toContain("同意を得ています");
  });

  it("確認画面の表示中にシステム時計が戻っても、人の同意は同意として扱う（経過時間は単調な時計で測る）", async () => {
    // Date.now() を止める（時計が戻った・止まった状態）。経過時間を Date.now() で測っていると 0 になり、自動の返事と誤判定する
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { c } = await connectWithElicitation(
      () =>
        new Promise<Reply>((resolve) =>
          setTimeout(() => resolve({ action: "accept", content: {} }), 150),
        ),
    );
    const result = await c.callTool({ name: "get_questions", arguments: {} });
    expect(result.isError).toBeFalsy();
  });

  it("接続が生きたままクライアントがコード -32000 を返したときは、中断ではなく想定外のエラーとして扱い、コードを記録する", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { c } = await connectWithElicitation(() => {
      throw new McpError(-32000, "client internal error");
    }, 0);
    const text = textOf(await c.callTool({ name: "get_questions", arguments: {} }));
    expect(text).toContain("エラー");
    expect(text).not.toContain("中断");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0].join(" "))).toContain("-32000");
  });

  it("断ったときの案内は、添える文を「次の文をそのまま」と指示する（複数の文でも省かれないように）", async () => {
    const { c } = await connectWithElicitation(() => ({ action: "decline" }), 0);
    const text = textOf(
      await c.callTool({ name: "score_answers", arguments: { answers: allNever } }),
    );
    expect(text).toContain("次の文をそのまま");
    expect(text).not.toContain("次の一文");
    expect(text).toContain("控えて");
  });
});
