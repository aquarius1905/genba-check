"use client";

import { useState } from "react";
import { ANSWER_OPTIONS, CATEGORIES, QUESTIONS, diagnose, type Answer } from "@/lib/diagnosis";
import { Result } from "./Result";

type Phase = "intro" | "quiz" | "result";

export function Quiz() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});

  const restart = () => {
    setAnswers({});
    setIndex(0);
    setPhase("intro");
    window.scrollTo({ top: 0 });
  };

  if (phase === "intro") {
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted">
          <p>今いる現場で、起きていることを回答してください。</p>
          <p>全20問・3択（約3分）</p>
        </div>
        <button
          type="button"
          onClick={() => setPhase("quiz")}
          className="rounded-lg bg-accent px-6 py-4 text-base font-bold text-on-accent transition hover:opacity-90"
        >
          診断をはじめる
        </button>
      </section>
    );
  }

  if (phase === "result") {
    return <Result result={diagnose(answers)} onRestart={restart} />;
  }

  const question = QUESTIONS[index];
  const category = CATEGORIES.find((c) => c.id === question.category)!;
  const selected = answers[question.id];

  const choose = (answer: Answer) => {
    setAnswers((prev) => ({ ...prev, [question.id]: answer }));
    if (index < QUESTIONS.length - 1) {
      setIndex(index + 1);
    } else {
      setPhase("result");
      window.scrollTo({ top: 0 });
    }
  };

  return (
    <section className="flex flex-col gap-6" aria-live="polite">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-xs text-muted">
          <span>{category.label}</span>
          <span>
            {index + 1} / {QUESTIONS.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${(index / QUESTIONS.length) * 100}%` }}
          />
        </div>
      </div>

      <h2 className="min-h-[5.5rem] text-lg leading-relaxed font-bold">{question.text.engineer}</h2>

      <div className="flex flex-col gap-3">
        {ANSWER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => choose(opt.value)}
            className={`rounded-lg border px-5 py-4 text-left text-base transition hover:border-accent ${
              selected === opt.value
                ? "border-accent bg-accent/10 font-bold"
                : "border-line bg-surface"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setIndex(index - 1)}
        disabled={index === 0}
        className="self-start text-sm text-muted underline-offset-4 hover:underline disabled:invisible"
      >
        ← 前の質問に戻る
      </button>
    </section>
  );
}
