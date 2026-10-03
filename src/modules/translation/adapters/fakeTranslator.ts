// A scripted Translator for tests (S04.02): no network. For each call it decides, from the language and the model, what the
// model does: answer (after a delay, with usage), fail, or hang until it is cancelled; and it records every call and every abort
// of a call's signal, so a test can say a timed-out attempt was aborted and that a late answer was never used. Like the Cohere
// adapter, a call that is cancelled rejects with TranslateError("aborted"), unless the script says to ignore the cancel and
// answer late anyway.
import type { LangCode } from "@/contracts/lang";
import { TranslateError, type TranslateRequest, type Translator } from "../application/ports";

export interface Behaviour {
  /** What the model answers. */
  text?: string;
  /** The model fails (a vendor error). */
  error?: boolean;
  /** The model never answers; it only ends when cancelled. */
  hang?: boolean;
  /** How long the answer or the failure takes, in (fake or real) milliseconds. */
  afterMs?: number;
  /** The answer still comes, afterMs later, when the call was cancelled: a vendor that does not stop. */
  ignoreAbort?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface RecordedCall {
  lang: LangCode;
  model: string;
  from: LangCode | null;
  text: string;
  maxOutputTokens: number | undefined;
  /** The clock when the call started. */
  at: number;
}

export interface FakeTranslator {
  translator: Translator;
  calls: RecordedCall[];
  /** The calls whose signal was aborted, with the clock at the abort. */
  aborts: { lang: LangCode; model: string; at: number }[];
  /** Answers the fake gave after its call was cancelled: they must never reach a result. */
  lateAnswers: { lang: LangCode; model: string }[];
}

export function fakeTranslator(behaviour: (call: { lang: LangCode; model: string; attempt: number }) => Behaviour, now: () => number = () => Date.now()): FakeTranslator {
  const calls: RecordedCall[] = [];
  const aborts: FakeTranslator["aborts"] = [];
  const lateAnswers: FakeTranslator["lateAnswers"] = [];
  const attempts = new Map<string, number>();

  const translator: Translator = {
    translate(request: TranslateRequest) {
      const { to, model, from, text, signal, maxOutputTokens } = request;
      const attempt = (attempts.get(`${to}:${model}`) ?? 0) + 1;
      attempts.set(`${to}:${model}`, attempt);
      calls.push({ lang: to, model, from, text, maxOutputTokens, at: now() });
      const plan = behaviour({ lang: to, model, attempt });
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
          aborts.push({ lang: to, model, at: now() });
          if (plan.ignoreAbort) return;
          clearTimeout(timer);
          reject(new TranslateError("aborted"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
        if (plan.hang) return;
        const settle = () => {
          if (signal.aborted && plan.ignoreAbort) lateAnswers.push({ lang: to, model });
          if (plan.error) reject(new TranslateError("failed"));
          else resolve({ text: plan.text ?? "", inputTokens: plan.inputTokens === undefined ? 120 : plan.inputTokens, outputTokens: plan.outputTokens === undefined ? 90 : plan.outputTokens });
        };
        // An answer with no delay comes at once, so a test with no delays needs no clock.
        if ((plan.afterMs ?? 0) > 0) timer = setTimeout(settle, plan.afterMs);
        else queueMicrotask(settle);
      });
    },
  };
  return { translator, calls, aborts, lateAnswers };
}
