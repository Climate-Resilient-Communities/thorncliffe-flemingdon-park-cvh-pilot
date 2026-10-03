// scripts/search-test-set: how many vendor calls a run will make, before it makes any (S03.07). Production uses a free Cohere
// trial key that live search shares (about 1,000 calls a month in all), so a run prints this plan, needs --yes, and stops at
// --max-calls. The plan uses the use case's own rules: `questionLegSource` is the test `search` applies to decide that a
// question needs the translated-question leg, and the route and the fallback are asked of the same QuestionTranslator that
// the run uses, so the count is the one the run will make (an upper bound where it says so).
import type { SearchSettings } from "@/platform/config/env";
import { questionLegSource } from "@/modules/directory";
import { createQuestionTranslator, type QuestionTranslator } from "@/modules/translation";
import type { TestQuestion } from "@/contracts/searchTestSet";

/** A translator that makes no call: only its route and fallback are read, to plan. */
export function planningTranslator(settings: Pick<SearchSettings, "questionRoute" | "questionFallback">): QuestionTranslator {
  return createQuestionTranslator({
    translator: {
      translate() {
        throw new Error("planning makes no vendor call");
      },
    },
    route: settings.questionRoute,
    fallback: settings.questionFallback,
  });
}

/** The vendor calls one question makes. */
export interface QuestionPlan {
  /** The direct embedding, plus the translation's embedding when the translated-question leg runs (it is skipped when the translation is not used). */
  embeddings: number;
  /** The translation with the routed model (0 or 1). */
  translations: number;
  /** The one retry with the fallback model, made only when the routed model is past a vendor limit (0 or 1). */
  retries: number;
  model: string | null;
  fallbackModel: string | null;
}

/** The question as the use case is asked it: the page language is `page_lang` when the question has one. */
export function planQuestion(question: Pick<TestQuestion, "q" | "lang" | "page_lang">, translator: QuestionTranslator | null): QuestionPlan {
  const source = translator ? questionLegSource({ q: question.q, lang: question.page_lang ?? question.lang }) : null;
  const model = source !== null && translator ? translator.modelFor(source) : null;
  const fallbackModel = source !== null && translator && model !== null ? translator.fallbackFor(source, model) : null;
  return { embeddings: model === null ? 1 : 2, translations: model === null ? 0 : 1, retries: fallbackModel === null ? 0 : 1, model, fallbackModel };
}

/** The most calls a question can make, retry included: what the cap is checked against, so a run never goes past it. */
export const worstCalls = (plan: QuestionPlan) => plan.embeddings + plan.translations + plan.retries;

export interface LegPlan {
  questions: number;
  /** Embedding calls, at most (a translation that is rejected is not embedded). */
  embeddings: number;
  translations: number;
  /** Translation calls by routed model. */
  translationsByModel: Record<string, number>;
  /** Further translation calls, at most, if every routed model were past its limit, by fallback model. */
  retriesByModel: Record<string, number>;
  /** Every call, retries included. */
  worst: number;
}

export function planLeg(questions: readonly Pick<TestQuestion, "q" | "lang" | "page_lang">[], translator: QuestionTranslator | null): LegPlan {
  const plan: LegPlan = { questions: questions.length, embeddings: 0, translations: 0, translationsByModel: {}, retriesByModel: {}, worst: 0 };
  for (const question of questions) {
    const one = planQuestion(question, translator);
    plan.embeddings += one.embeddings;
    plan.translations += one.translations;
    plan.worst += worstCalls(one);
    if (one.model !== null) plan.translationsByModel[one.model] = (plan.translationsByModel[one.model] ?? 0) + 1;
    if (one.fallbackModel !== null) plan.retriesByModel[one.fallbackModel] = (plan.retriesByModel[one.fallbackModel] ?? 0) + 1;
  }
  return plan;
}

const byModel = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, n]) => `${n} with ${model}`)
    .join(", ");

/** The plan as lines to print: per leg, then the cap. */
export function formatPlan(model: string, legs: readonly { leg: "off" | "on"; plan: LegPlan }[], maxCalls: number): string[] {
  const lines = ["Planned vendor calls (the Cohere trial key is shared with live search: about 1,000 calls a month in all):"];
  let worst = 0;
  let expected = 0;
  for (const { leg, plan } of legs) {
    worst += plan.worst;
    expected += plan.embeddings + plan.translations;
    const translations = plan.translations === 0 ? "no translation calls" : `${plan.translations} translation calls (${byModel(plan.translationsByModel)})`;
    lines.push(`  translated-question leg ${leg}: ${plan.questions} questions, at most ${plan.embeddings} embedding calls (${model}), ${translations}`);
    const retries = Object.keys(plan.retriesByModel).length === 0 ? "" : `  plus up to ${Object.values(plan.retriesByModel).reduce((a, b) => a + b, 0)} retries with a fallback model if a model is past its limit (${byModel(plan.retriesByModel)})`;
    if (retries) lines.push(retries);
  }
  lines.push(`  in all: at most ${expected} calls, ${worst} with every retry; --max-calls is ${maxCalls}${worst > maxCalls ? ": the run will stop at it and report partial results" : ""}`);
  return lines;
}
