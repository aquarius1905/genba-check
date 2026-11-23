import { sendGAEvent } from "@next/third-parties/google";
import { GA_ID } from "./site";

/**
 * 回数だけを数えるイベント。回答の中身や点数は送らない
 * （フッターの「回答はブラウザの外に送信されません」を守るため）。
 */
export type TrackEvent = "quiz_start" | "quiz_complete" | "share_x" | "click_job_fit_agent";

export function track(event: TrackEvent) {
  if (!GA_ID) return;
  sendGAEvent("event", event, {});
}
