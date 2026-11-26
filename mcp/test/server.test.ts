// MCP クライアントから実際にツールを呼び、登録とやりとりが正しいかを確かめる。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES, LEVELS, QUESTIONS } from "../../src/lib/diagnosis";
import { createServer } from "../src/server";
import { FACTS, PRIORITY_THRESHOLD } from "../src/tools";

let client: Client;

beforeEach(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
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
