// scripts/search-test-set/replay-cached: the whole test set through the real search use case (`createSearch`, its routing, its
// ranking and its emergency flag) with vectors that were embedded before, so that a change to the ranking can be measured with no
// vendor call at all. Run through scripts/search-test-set/replay-cached.mjs:
//
//   node scripts/search-test-set/replay-cached.mjs --cache <vector-cache.json> [--rerank-cache <rerank-cache.json>] [--json <out.json>]
//
// The cache is a JSON file (never committed: it is about 7.6 MB) with
//   providers:    { "<provider id>": [embedding of its search text, input_type search_document] }
//   questions:    { "<question text>": [embedding, input_type search_query] }
//   translations: { "<question text>": { english: "<its English translation>", vector: [embedding of the English] } }
// as the offline experiment of 2026-10-07 wrote them (data/search-test-set/reports/2026-10-07-interim-tuning.md says how). The
// translations stand in for the translated-question leg's model, so the numbers of questions that take that leg are an upper bound.
//
// With --rerank-cache the direct route's reranker runs too (SEARCH_RERANK and SEARCH_RERANK_MIN as production resolves them), its
// answers looked up instead of asked: a JSON file (never committed) of
//   { "<question text>": { candidates: [the 20 provider ids the experiment sent], scores: { "<provider id>": relevance } } }
// as the experiment's `rerank-v3.5` calls answered them. The reranker is handed the providers' search texts by the use case; each
// is mapped back to its provider, and a provider the experiment did not send (the use case chose other candidates) fails the run.
// The monthly limit is not exercised (no calls are counted).
//
// What is real: the use case, the language detection and the routing to the translated leg (`questionSourceOf`), the ranking
// (domain/searchRanking.ts) and the keyword match (domain/searchKeywords.ts), and the settings as production resolves them
// (SEARCH_* from the environment, by the app's own parser; unset means the defaults). What is not: the release (a snapshot built
// here from data/catalogue/providers.json: the English name, categories, subcategories and services the release's English
// listing carries, and the providers of the emergency categories), the embedder (it looks the text up in the cache) and the
// translator (it looks the translation up). A question or translation missing from the cache fails the run.
//
// It prints, for all questions, by author and by language: hit@3 (an expected provider among the first 3 results, answerable
// questions), shown (any result, answerable), no-match ok (a no_match question shows nothing), emergency flag (`emergency_first`
// on an emergency question), emergency false alarm (on any other question) and false positives (results with no expected provider,
// or any result for a no_match question; share of all questions).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildKeywordIndex, createSearch, searchTextsOfListing, type Reranker } from "@/modules/directory";
import type { SearchV1, TestQuestion } from "@/contracts/searchTestSet";
import { QuestionTranslationError, type QuestionTranslator } from "@/modules/translation";
import { EnvError, parseSearchEnv } from "@/platform/config/env";
import { formatLineErrors, parseQuestions, providerIdsOf } from "./lib";

interface VectorCache {
  providers: Record<string, number[]>;
  questions: Record<string, number[]>;
  translations: Record<string, { english: string; vector: number[] }>;
}

interface CatalogueProvider {
  id: string;
  name: string;
  categories: string[];
  subcategories: string[];
  services: { en: string | null } | null;
  emergencyRole?: { en: string | null } | null;
}

type RerankCache = Record<string, { candidates: string[]; scores: Record<string, number> }>;

export interface Answered {
  question: TestQuestion;
  answer: SearchV1;
}

export interface Metrics {
  n: number;
  answerable: number;
  noMatch: number;
  emergency: number;
  hit3: number;
  shown: number;
  noMatchOk: number;
  emergencyFlag: number;
  emergencyFalseAlarm: number;
  falsePositive: number;
}

const pct = (a: number, b: number) => (b === 0 ? NaN : (100 * a) / b);

export function measureAnswers(rows: readonly Answered[]): Metrics {
  let answerable = 0;
  let noMatch = 0;
  let emergency = 0;
  let hit3 = 0;
  let shown = 0;
  let noMatchOk = 0;
  let emergencyFlag = 0;
  let falseAlarm = 0;
  let falsePositive = 0;
  for (const { question, answer } of rows) {
    const ids = answer.results.map((r) => r.provider_id);
    const any = ids.length > 0;
    const expected = new Set(question.expected);
    if (question.intent === "no_match") {
      noMatch += 1;
      if (!any) noMatchOk += 1;
      else falsePositive += 1;
    } else {
      answerable += 1;
      if (any) shown += 1;
      if (ids.slice(0, 3).some((id) => expected.has(id))) hit3 += 1;
      if (any && !ids.some((id) => expected.has(id))) falsePositive += 1;
    }
    if (question.intent === "emergency") {
      emergency += 1;
      if (answer.emergency_first) emergencyFlag += 1;
    } else if (answer.emergency_first) falseAlarm += 1;
  }
  const n = rows.length;
  return {
    n,
    answerable,
    noMatch,
    emergency,
    hit3: pct(hit3, answerable),
    shown: pct(shown, answerable),
    noMatchOk: pct(noMatchOk, noMatch),
    emergencyFlag: pct(emergencyFlag, emergency),
    emergencyFalseAlarm: pct(falseAlarm, n - emergency),
    falsePositive: pct(falsePositive, n),
  };
}

const f1 = (x: number) => (Number.isNaN(x) ? "—" : x.toFixed(1));
const HEADER = "| set | n | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |\n|---|---|---|---|---|---|---|---|";
const line = (name: string, m: Metrics) =>
  `| ${name} | ${m.n} | ${f1(m.hit3)} | ${f1(m.shown)} | ${f1(m.noMatchOk)} | ${f1(m.emergencyFlag)} | ${f1(m.emergencyFalseAlarm)} | ${f1(m.falsePositive)} |`;

export async function main(argv: string[], env: Record<string, string | undefined>, root: string): Promise<number> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cacheFile = arg("--cache");
  if (!cacheFile) {
    console.error("usage: replay-cached --cache <vector-cache.json> [--rerank-cache <rerank-cache.json>] [--json <out.json>]");
    return 2;
  }
  let settings;
  try {
    settings = parseSearchEnv({ ...env });
  } catch (error) {
    console.error(error instanceof EnvError ? error.message : String(error));
    return 2;
  }
  const cache = JSON.parse(readFileSync(path.resolve(cacheFile), "utf8")) as VectorCache;
  const providersJson = readFileSync(path.join(root, "data/catalogue/providers.json"), "utf8");
  const parsed = parseQuestions(readFileSync(path.join(root, "data/search-test-set/questions.jsonl"), "utf8"), providerIdsOf(providersJson));
  if (parsed.errors.length > 0) {
    for (const message of formatLineErrors(parsed.errors)) console.error(message);
    return 1;
  }
  const questions: TestQuestion[] = parsed.questions;

  // The release, as its English listing and vectors file would make it.
  const catalogue = (JSON.parse(providersJson) as { providers: CatalogueProvider[] }).providers;
  const ids = catalogue.map((p) => p.id).filter((id) => cache.providers[id] !== undefined);
  if (ids.length !== catalogue.length) {
    console.error(`the cache has vectors for ${ids.length} of the catalogue's ${catalogue.length} providers`);
    return 1;
  }
  const emergencyNames = new Set(settings.emergencyCategories);
  // The providers' search texts as the release's English listing rebuilds them (categories in the catalogue's order).
  const categoryOrder = Object.keys((JSON.parse(providersJson) as { labels: { categories: Record<string, unknown> } }).labels.categories);
  const searchTexts = searchTextsOfListing({
    categories: categoryOrder.map((name, sortOrder) => ({ id: name, sort_order: sortOrder, name: { body: name } })),
    providers: catalogue.map((p) => ({
      id: p.id,
      name: p.name,
      category_ids: p.categories,
      subcategories: p.subcategories.map((body) => ({ body })),
      services: { body: p.services?.en ?? "" },
      emergency_role: p.emergencyRole?.en ? { body: p.emergencyRole.en } : null,
    })),
  });
  const data = {
    releaseV: 1,
    model: settings.embedModel,
    dims: null,
    threshold: settings.threshold,
    ids,
    vectors: ids.map((id) => cache.providers[id]!),
    known: new Set(ids),
    emergency: new Set(catalogue.filter((p) => p.categories.some((c) => emergencyNames.has(c))).map((p) => p.id)),
    keywords: buildKeywordIndex(catalogue.map((p) => ({ id: p.id, text: [p.name, ...p.categories, ...p.subcategories, p.services?.en ?? ""].join(" ") }))),
    searchTexts,
  };

  const rerankFile = arg("--rerank-cache");
  const rerankCache = rerankFile ? (JSON.parse(readFileSync(path.resolve(rerankFile), "utf8")) as RerankCache) : null;
  const idOfText = new Map([...searchTexts].map(([id, text]) => [text, id] as const));
  const rerankProblems: string[] = [];
  let reranks = 0;
  const reranker: Reranker | null =
    rerankCache && settings.rerank
      ? {
          model: "cached-rerank",
          async rerank({ query, documents }) {
            const found = rerankCache[query];
            if (!found) {
              rerankProblems.push("a question is not in the rerank cache");
              throw new Error("not in the rerank cache");
            }
            reranks += 1;
            const ids = documents.map((text) => idOfText.get(text) ?? "?");
            const sent = new Set(found.candidates);
            if (ids.some((id) => !sent.has(id)) || ids.length !== found.candidates.length) rerankProblems.push("the use case chose other candidates than the experiment sent");
            return { results: ids.map((id, index) => ({ index, relevance: found.scores[id] ?? 0 })) };
          },
        }
      : null;

  const english = new Map(Object.values(cache.translations).map((t) => [t.english, t.vector] as const));
  const translator: QuestionTranslator = {
    modelFor: () => "cached-translation",
    fallbackFor: () => null,
    async toEnglish({ text }) {
      const found = cache.translations[text];
      if (!found) throw new QuestionTranslationError("translate_failed");
      return { english: found.english, model: "cached-translation", tokens: 1 };
    },
  };
  const missing: string[] = [];
  const service = createSearch({
    db: () => {
      throw new Error("no database in a cached replay");
    },
    storage: () => {
      throw new Error("no store in a cached replay");
    },
    snapshot: async () => ({ releaseV: 1, data }),
    embedder: {
      async embedQuery({ text }) {
        const vector = cache.questions[text] ?? english.get(text);
        if (!vector) {
          missing.push(text);
          throw new Error("not in the cache");
        }
        return { vector, tokens: 1 };
      },
    },
    translator,
    writer: { log: async () => undefined, spend: async () => undefined },
    log: false,
    emergencyThreshold: settings.emergencyThreshold,
    emergencyTopThreshold: settings.emergencyTopThreshold,
    keywordWeight: settings.keywordWeight,
    directFloor: settings.directFloor,
    directGap: settings.directGap,
    crisisPhrases: settings.crisisPhrases,
    reranker,
    rerankMin: settings.rerankMin,
    rerankMonthlyCalls: Number.MAX_SAFE_INTEGER,
    rerankCalls: async () => 0,
    translateCalls: async () => 0,
    // No vendor, no deadline: a slow machine must not cut a leg.
    legTimeoutMs: 60_000,
    totalBudgetMs: 60_500,
  });

  const rows: Answered[] = [];
  for (const question of questions) {
    try {
      rows.push({ question, answer: await service.search({ q: question.q, lang: question.page_lang ?? question.lang }) });
    } catch {
      console.error(`${question.id}: the search failed`);
    }
  }
  if (rerankProblems.length > 0) {
    console.error(`rerank replay: ${[...new Set(rerankProblems)].join("; ")} (${rerankProblems.length} times)`);
    return 1;
  }
  if (missing.length > 0 || rows.length !== questions.length) {
    console.error(`${questions.length - rows.length} questions could not be replayed (${missing.length} texts missing from the cache)`);
    return 1;
  }

  console.log(
    `settings: threshold ${settings.threshold}, keyword weight ${settings.keywordWeight}, direct floor ${settings.directFloor}, direct gap ${settings.directGap}, emergency top ${settings.emergencyTopThreshold}, emergency top-3 ${settings.emergencyThreshold}, crisis phrases ${settings.crisisPhrases ? "on" : "off"}, rerank ${reranker ? `on (min ${settings.rerankMin}; ${reranks} questions reranked from the cache)` : "off"}`,
  );
  const out = [HEADER, line("all", measureAnswers(rows))];
  for (const author of [...new Set(rows.map((r) => r.question.author))].sort()) {
    out.push(line(`author ${author}`, measureAnswers(rows.filter((r) => r.question.author === author))));
  }
  out.push(line("added 2026-10-07 (experiment set)", measureAnswers(rows.filter((r) => r.question.added === "2026-10-07"))));
  for (const lang of [...new Set(rows.map((r) => r.question.lang))]) out.push(line(lang, measureAnswers(rows.filter((r) => r.question.lang === lang))));
  console.log(out.join("\n"));

  const json = arg("--json");
  if (json) {
    writeFileSync(
      path.resolve(json),
      `${JSON.stringify(
        rows.map((r) => ({ id: r.question.id, status: r.answer.status, emergency_first: r.answer.emergency_first, results: r.answer.results })),
        null,
        1,
      )}\n`,
    );
  }
  return 0;
}
