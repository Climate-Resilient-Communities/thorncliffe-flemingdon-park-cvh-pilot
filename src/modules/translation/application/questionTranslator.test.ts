// The translated-question leg's translator against a fake Translator (S03.05): the route from config, the checks, and
// what the caller is told about a billed call. Nothing here reaches the network.
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { QuestionRoute } from "../domain/questionTranslation";
import { TranslateError, type Translator } from "./ports";
import { QuestionTranslationError, createQuestionTranslator, questionTranslationSpend } from "./questionTranslator";

const ROUTE: QuestionRoute = { ps: "north-small-translate-09-2026", prs: "north-small-translate-09-2026", ur: "north-small-translate-09-2026", romanized_or_mixed: "command-a-translate-08-2025", ambiguous_arabic: null };
const MARKER = "zq7-marker-question";

function fake(answer: string | Error, tokens: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: 12, outputTokens: 5 }) {
  const translate = vi.fn<Translator["translate"]>(async () => {
    if (answer instanceof Error) throw answer;
    return { text: answer, ...tokens };
  });
  return { translator: { translate } satisfies Translator, translate };
}

describe("createQuestionTranslator", () => {
  it("translates with the model the route names for the kind of question, from Pashto or Dari, or from whatever the model reads in romanized text", async () => {
    const { translator, translate } = fake("I want free legal advice");
    const questions = createQuestionTranslator({ translator, route: ROUTE });
    const signal = new AbortController().signal;

    expect(await questions.toEnglish({ text: "زه وړیا حقوقي مشوره غواړم", source: "ps", signal })).toEqual({ english: "I want free legal advice", model: "north-small-translate-09-2026", tokens: 17 });
    expect(translate).toHaveBeenLastCalledWith({ text: "زه وړیا حقوقي مشوره غواړم", from: "ps", to: "en", model: "north-small-translate-09-2026", signal });

    await questions.toEnglish({ text: "mujhe khana chahiye", source: "romanized_or_mixed", signal });
    expect(translate).toHaveBeenLastCalledWith(expect.objectContaining({ from: null, to: "en", model: "command-a-translate-08-2025" }));
  });

  it("says which kinds the route switches off, and never calls a model for them", async () => {
    const { translator, translate } = fake("x");
    const questions = createQuestionTranslator({ translator, route: ROUTE });

    expect(questions.modelFor("ambiguous_arabic")).toBeNull();
    expect(questions.modelFor("prs")).toBe("north-small-translate-09-2026");
    await expect(questions.toEnglish({ text: "مکان", source: "ambiguous_arabic", signal: new AbortController().signal })).rejects.toBeInstanceOf(QuestionTranslationError);
    expect(translate).not.toHaveBeenCalled();
  });

  it.each([
    ["not English", "Necesito asesoría legal gratuita", "not_english"],
    ["an answer instead of a translation", "Here is a list of free legal clinics in Toronto that can help you with work permits and immigration: ...".repeat(2), "too_long"],
    ["empty", "  ", "empty"],
  ])("refuses an answer that is %s, and says the call was billed", async (_, answer, code) => {
    const { translator } = fake(answer, { inputTokens: 9, outputTokens: null });
    const failure = await createQuestionTranslator({ translator, route: ROUTE })
      .toEnglish({ text: "زه وړیا مشوره غواړم", source: "ps", signal: new AbortController().signal })
      .catch((e: unknown) => e);

    expect(failure).toMatchObject({ name: "QuestionTranslationError", code, billedTokens: 9 });
  });

  it("does not use an answer that arrives after the caller cancelled", async () => {
    const controller = new AbortController();
    const translator: Translator = {
      async translate() {
        controller.abort();
        return { text: "I want free legal advice", inputTokens: 3, outputTokens: 4 };
      },
    };

    const failure = await createQuestionTranslator({ translator, route: ROUTE }).toEnglish({ text: "زه مشوره غواړم", source: "ps", signal: controller.signal }).catch((e: unknown) => e);

    expect(failure).toMatchObject({ code: "aborted", billedTokens: 7 });
  });

  it("turns any failure into a code that holds nothing of the question, and tells a cancelled call from a failed one", async () => {
    const echo = Object.assign(new Error(`400 bad request ${MARKER}`), { body: { messages: [{ content: MARKER }] }, cause: MARKER });
    const failed = await createQuestionTranslator({ translator: fake(echo).translator, route: ROUTE })
      .toEnglish({ text: MARKER, source: "romanized_or_mixed", signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(failed).toMatchObject({ code: "translate_failed", billedTokens: undefined });
    expect([String(failed), (failed as Error).stack, JSON.stringify(failed), inspect(failed, { depth: 10, showHidden: true })].join("\n")).not.toContain(MARKER);

    const aborted = await createQuestionTranslator({ translator: fake(new TranslateError("aborted")).translator, route: ROUTE })
      .toEnglish({ text: MARKER, source: "romanized_or_mixed", signal: new AbortController().signal })
      .catch((e: unknown) => e);
    expect(aborted).toMatchObject({ code: "aborted" });
  });
});

describe("questionTranslationSpend", () => {
  it("is a spend event of kind translate, with counts and codes only", () => {
    expect(questionTranslationSpend({ purpose: "search", model: "north-small-translate-09-2026", releaseV: 3, tokens: 17, tokensEstimated: false, ms: 640 })).toEqual({
      kind: "translate",
      purpose: "search",
      model: "north-small-translate-09-2026",
      releaseV: 3,
      tokens: 17,
      tokensEstimated: false,
      ms: 640,
    });
  });
});
