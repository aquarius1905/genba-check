import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FACTS,
  PRIORITY_THRESHOLD,
  formatErrors,
  formatQuestions,
  formatScore,
  getQuestions,
  scoreAnswers,
} from "./tools";

// 数・範囲・名前は FACTS（本体のデータから作った値）から埋め込み、問いを増やしても説明が食い違わないようにする
const { total, idRange, categoryCount, categoryList, levelList, answerList, answerCount } = FACTS;
const answerQuoted = answerList
  .split("／")
  .map((a) => `「${a}」`)
  .join("");

const category = z.object({ id: z.string(), label: z.string() });

const questionsOutput = {
  questions: z.array(
    z.object({ id: z.number(), category, reversed: z.boolean(), text: z.string() }),
  ),
  answerOptions: z.array(z.string()),
  instructions: z.string(),
};

const scoreOutput = {
  score: z.number(),
  level: z.object({ id: z.string(), label: z.string(), description: z.string() }),
  categories: z.array(z.object({ id: z.string(), label: z.string(), score: z.number() })),
  priority: z
    .object({
      category,
      score: z.number(),
      issues: z.array(
        z.object({
          question_id: z.number(),
          text: z.string(),
          reversed: z.boolean(),
          answer: z.string(),
        }),
      ),
      advice: z.string(),
    })
    .nullable(),
  privacy: z.string(),
};

export function createServer(): McpServer {
  const server = new McpServer({ name: "genba-check", version: "0.1.0" });

  server.registerTool(
    "get_questions",
    {
      title: "現場の健全性診断：質問一覧",
      description: [
        `エンジニアが今いる開発現場（参画中のプロジェクト・チーム）の健全性を自己診断するための${total}問を返す。`,
        `各問には id（${idRange}）、カテゴリ（${categoryList}）、`,
        "逆転の問いかどうか（reversed：true なら良い行動を聞く問いで「よくある」ほど健全）、問いの文言が付く。",
        `使い方：ユーザーに現場の診断を頼まれたら最初にこれを呼び、問いの文言を変えずに${total}問すべてをユーザーに聞く。`,
        `回答は${answerQuoted}の${answerCount}択だけで、ユーザー本人に選んでもらう（AIが推測して埋めない）。`,
        "集めた回答は score_answers に渡して採点する。",
        "このサーバーは回答を保存・外部送信しないが、回答はこの会話の一部としてAIの提供元に送られ、会話記録にも残りうる。",
        "質問を始める前にこのことをユーザーに伝え、会社名や個人名などの特定につながる情報は書かなくてよいと添える。",
      ].join("\n"),
      outputSchema: questionsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const payload = getQuestions();
      return {
        content: [{ type: "text", text: formatQuestions(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    "score_answers",
    {
      title: "現場の健全性診断：採点",
      description: [
        `get_questions の${total}問へのユーザーの回答を採点し、診断結果を返す。`,
        `返すもの：総合スコア（0〜100、高いほど健全）とラベル（${levelList}）、カテゴリ別スコア（${categoryCount}項目）、`,
        `優先して見る項目（最もスコアが低いカテゴリ。点数を落とした回答の一覧と、本人が取れる行動付き。すべて${PRIORITY_THRESHOLD}点以上なら null）。`,
        `${total}問すべてにちょうど1件ずつ回答が必要。件数の過不足、question_id の重複・欠落・範囲外、answer の値の誤りがあるときは、`,
        "isError で直すべき点をまとめて日本語で返す（answers が配列でない、または要素が {question_id, answer} のオブジェクトでない場合だけは、入力形式のエラーになる）。",
        "このサーバーは回答を保存・外部送信しない（AIクライアント側の会話の送信・記録は別）。",
        "結果をユーザーに伝えるときは、スコアとラベル、優先して見る項目と本人が取れる行動を中心に伝える。",
      ].join("\n"),
      inputSchema: {
        answers: z
          .array(
            // 値の検証は scoreAnswers に任せる。ここで型を絞ると、誤りが SDK の英語エラーになり、
            // 他の問題点や使える値の一覧も返せなくなるため、説明だけ付けて unknown で受ける。
            // zod v4 は unknown でもキーを必須にするので、キーがない場合も optional で通して日本語で返す
            z.object({
              question_id: z
                .unknown()
                .optional()
                .describe(`必須。問いの番号（get_questions の id、${idRange} の整数）`),
              answer: z
                .unknown()
                .optional()
                .describe(`必須。回答。文字列${answerQuoted}のいずれか1つ`),
            }),
          )
          .describe(
            `${total}問すべてへの回答。1問につき1件で、順番は問わない。` +
              `例：[{"question_id": 1, "answer": "よくある"}, {"question_id": 2, "answer": "ない"}, …, {"question_id": ${total}, "answer": "たまにある"}]`,
          ),
      },
      outputSchema: scoreOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ answers }) => {
      const r = scoreAnswers(answers);
      if (!r.ok) {
        return { isError: true, content: [{ type: "text", text: formatErrors(r.errors) }] };
      }
      return {
        content: [{ type: "text", text: formatScore(r.result) }],
        structuredContent: r.result,
      };
    },
  );

  return server;
}
