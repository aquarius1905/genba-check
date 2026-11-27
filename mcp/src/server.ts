import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ErrorCode,
  McpError,
  type ElicitRequestFormParams,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  FACTS,
  PRIORITY_THRESHOLD,
  PRIVACY_NOTE,
  consentFailureTexts,
  consentMessage,
  formatErrors,
  type ConsentPhase,
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
  // 確認画面を出せないクライアントで、構造化データだけを AI に渡す場合にも説明が届くよう、ここにも入れる
  privacy: z.string(),
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

export type ServerOptions = {
  /**
   * 確認画面への返事（「断る」「閉じる」「同意」のどれでも）がこれより速く返ってきたら、
   * 人ではなくクライアントが自動で返したとみなし、確認画面を表示できなかったものとして扱う。
   * VS Code 版の Claude Code は、表示と同時に 6〜12ms で自動的に断る（実測）。
   * 人の素早い Esc と取り違えないよう、基準はそれより十分長く、人の反応よりは短くする。
   */
  fastDeclineMs?: number;
  /**
   * 確認画面への返事を待つ時間。SDK の既定（60秒）では、説明を読んで考える時間として短すぎる。
   * なお、クライアント側のツールの呼び出しの時間制限は、ここでは延ばせない。進捗通知を送っても、
   * Claude Code は延ばさない（設定の説明に明記）し、SDK の Client も既定では延ばさない（resetTimeoutOnProgress が無効）。
   * Claude Code の既定は約27時間なので問題にならない。短いクライアントについては README に書いている。
   */
  elicitTimeoutMs?: number;
};

export const DEFAULT_FAST_DECLINE_MS = 100;
export const DEFAULT_ELICIT_TIMEOUT_MS = 10 * 60 * 1000;

type ElicitOutcome =
  | { kind: "accepted" }
  | { kind: "declined" } // 人が断った・閉じた（とみられる）
  | { kind: "unavailable" } // 確認画面を表示できなかった（自動で閉じられた、またはクライアントが応じなかった）
  | { kind: "timeout" } // 待ち時間を過ぎても返事がなかった
  | { kind: "aborted" } // ツールの呼び出しが中断された、または接続が切れた
  | { kind: "error" }; // 想定外のエラー

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const supportsForm = (server: McpServer) =>
  Boolean(server.server.getClientCapabilities()?.elicitation?.form);

/**
 * クライアントの確認画面（elicitation）を出す。表示はクライアントが行うので、AI が飛ばすことはできない。
 * 問いを返す前（get_questions）と、採点の前（score_answers）の、プライバシーの説明への同意に使う。
 */
async function elicit(
  server: McpServer,
  params: Omit<ElicitRequestFormParams, "mode">,
  timing: { fastDeclineMs: number; elicitTimeoutMs: number },
  extra: ToolExtra,
): Promise<ElicitOutcome> {
  // 経過時間は単調な時計で測る（Date.now() はシステム時計の調整で戻ったり進んだりする）
  const started = performance.now();
  let action: string;
  try {
    const result = await server.server.elicitInput(
      { mode: "form", ...params },
      {
        timeout: timing.elicitTimeoutMs,
        // 呼び出し元の tools/call と紐づける。中断されたら確認画面の要求も取り消す
        signal: extra.signal,
        relatedRequestId: extra.requestId,
      },
    );
    action = result.action;
  } catch (error) {
    // 例外は英語の生エラーとして AI に渡さず、日本語の案内に置き換える
    if (extra.signal.aborted) return { kind: "aborted" };
    const code = error instanceof McpError ? error.code : undefined;
    if (code === ErrorCode.RequestTimeout) return { kind: "timeout" };
    // -32000 は接続の切断にも、JSON-RPC の汎用のエラーにも使われる値なので、接続が本当に切れているときだけ中断とみなす
    if (code === ErrorCode.ConnectionClosed && !server.server.transport) return { kind: "aborted" };
    // 確認画面に対応していると名乗るのに応じないクライアント
    if (code === ErrorCode.MethodNotFound) return { kind: "unavailable" };
    // 想定外のエラー。原因を調べられるよう、エラーコードだけを stderr に残す（回答は含まれない）
    console.error(`[genba-check] elicitation failed: code=${code ?? "unknown"}`);
    return { kind: "error" };
  }
  // 人には不可能な速さの返事は、確認画面を人に見せずにクライアントが自動で返したとみなす（推測。案内の文でもそう伝える）。
  // 「断る」「閉じる」だけでなく「同意」も同じ。自動で承諾するクライアントで、説明を見ないまま同意扱いにしないため
  if (performance.now() - started < timing.fastDeclineMs) return { kind: "unavailable" };
  return action === "accept" ? { kind: "accepted" } : { kind: "declined" };
}

const errorText = (text: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text }],
});

export function createServer(options: ServerOptions = {}): McpServer {
  const timing = {
    fastDeclineMs: options.fastDeclineMs ?? DEFAULT_FAST_DECLINE_MS,
    elicitTimeoutMs: options.elicitTimeoutMs ?? DEFAULT_ELICIT_TIMEOUT_MS,
  };
  const server = new McpServer({ name: "genba-check", version: "0.1.0" });

  // 接続直後に ping を1回送り、サーバーから送る要求の id 0 を使い切る。
  // SDK は id 0 の要求への取り消し通知を無視する（requestId が 0 だと偽とみなす）ため、
  // 最初の確認画面が id 0 だと、中断や時間切れのときにクライアント側の確認画面が閉じない
  server.server.oninitialized = () => {
    server.server.ping().catch(() => {
      // ping に応じないクライアントでも、確認画面の動きには影響しないので無視する
    });
  };

  /**
   * このセッション（サーバーのプロセスが動いている間）で、プライバシーの説明に同意を得たか。ファイルには残さない。
   * score_answers で使う。get_questions で断ったあとに AI が問いを聞いて score_answers を呼んでも、同意なしでは採点しない。
   * サーバーからは会話の区切り（/clear など）が見えないので、会話ごとではなくプロセスごとに覚える。
   */
  let consentGiven = false;

  /**
   * 問いを返す前・採点する前に、同意を確かめる。
   * - phase：問いを返す前（questions）か、採点の前（scoring）か。確認画面の文と、同意が得られなかったときの案内を書き分ける
   * - askEvenIfGiven：同意済みでも確認画面を出すか。get_questions は診断を始めるたびに説明を見せるため true にする
   * 戻り値：
   * - 同意した、または確認画面を出せないクライアント：そのまま進む（consented で、確認画面で同意したかを返す）
   * - 断った・表示できなかった・中断などのとき：ツールの結果として返す文を返す
   *
   * 同意の前にツールが並行して呼ばれると、確認画面がその数だけ出る。返事待ちの確認を使い回すと、
   * 片方の呼び出しの中断がもう片方を道連れにするなど扱いが複雑になる一方、AI が並行して呼ぶことはふつうなく、
   * それぞれが正しく同意か中止を返すので実害は小さい。そのため使い回さない。
   */
  async function requireConsent(
    extra: ToolExtra,
    phase: ConsentPhase,
    askEvenIfGiven: boolean,
  ): Promise<
    { ok: true; consented: boolean } | { ok: false; response: ReturnType<typeof errorText> }
  > {
    if (consentGiven && !askEvenIfGiven) return { ok: true, consented: true };
    if (!supportsForm(server)) return { ok: true, consented: false };
    const consent = await elicit(
      server,
      { message: consentMessage(phase), requestedSchema: { type: "object", properties: {} } },
      timing,
      extra,
    );
    if (consent.kind !== "accepted") {
      // 直近の確認画面で同意が得られなかったら、以前の同意は取り消す（断ったあとに採点されないように）
      consentGiven = false;
      return { ok: false, response: errorText(consentFailureTexts(phase)[consent.kind]) };
    }
    consentGiven = true;
    return { ok: true, consented: true };
  }

  server.registerTool(
    "get_questions",
    {
      title: "現場の健全性診断：質問一覧",
      description: [
        `エンジニアが今いる開発現場（参画中のプロジェクト・チーム）の健全性を自己診断するための${total}問を返す。`,
        "使い方：ユーザーに現場の診断を頼まれたら、最初にこれを呼ぶ。引数はない。",
        `各問には id（${idRange}）、カテゴリ（${categoryList}）、`,
        "逆転の問いかどうか（reversed：true なら良い行動を聞く問いで「よくある」ほど健全）、問いの文言が付く。",
        `問いの文言を変えずに${total}問すべてをユーザーに聞く。選択肢から選べる質問用の画面（Claude Code の AskUserQuestion など）が使えるなら、それを使って4問ずつ聞く。`,
        `回答は${answerQuoted}の${answerCount}択だけで、ユーザー本人に選んでもらう（AIが推測して埋めない）。`,
        "集めた回答は score_answers に渡して採点する。",
        "このサーバーは回答を保存・外部送信しないが、回答はこの会話の一部としてAIの提供元に送られ、会話記録にも残りうる。",
        "対応しているクライアントでは、呼ばれるたびに、問いを返す前にクライアントの確認画面でこの説明を表示し、ユーザーが同意したときだけ問いを返す。",
        "確認画面を出せないクライアントでは、結果の先頭にある説明を、質問を始める前に省略せずユーザーに伝える。",
        "ユーザーが同意しなかったときや、確認画面を表示できなかったときは isError で問いを返さないので、返ってきた指示に従って、ユーザーに伝える。",
      ].join("\n"),
      outputSchema: questionsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (extra) => {
      const consent = await requireConsent(extra, "questions", true);
      if (!consent.ok) return consent.response;
      const payload = { ...getQuestions(consent.consented), privacy: PRIVACY_NOTE };
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
        "確認画面に対応したクライアントで、このサーバーのプロセスでまだプライバシーの説明に同意を得ていない場合は、採点の前に確認画面で同意を確かめ、同意がなければ採点しない。",
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
    async ({ answers }, extra) => {
      // 先に回答を検証する。不備があれば、同意を求めずに不備を返す（同意したのに採点できない、を避ける）
      const r = scoreAnswers(answers);
      if (!r.ok) return errorText(formatErrors(r.errors));
      // get_questions を経ずに呼ばれた場合や、同意を断ったあとに呼ばれた場合も、同意がなければ採点しない
      const consent = await requireConsent(extra, "scoring", false);
      if (!consent.ok) return consent.response;
      return {
        content: [{ type: "text", text: formatScore(r.result) }],
        structuredContent: r.result,
      };
    },
  );

  return server;
}
