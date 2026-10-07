// The production engine of the search test-set runner (S03.07): the search use case, `createSearch`, built from the settings of
// the run. A script has no Next request and cannot import src/app/search.ts (it is server-only and reads the app's validated
// environment, which wants the app's database role and the production host), so this is the same composition, made of the same
// parts, from the settings the run was given (production.ts lists them). The app's environment check (src/platform/config/env.ts)
// is not touched: nothing here reads COHERE_API_KEY through it, and the SEARCH_* settings are resolved by its own parser.
//
// What matches src/app/search.ts `searchService()`:
//  - the use case (`createSearch`), the Cohere question embedder (`cohereQueryEmbedder`), the translated-question leg's translator
//    (`createQuestionTranslator` over `cohereTranslator`) with the route (`SEARCH_QUESTION_ROUTE`) and the fallback
//    (`SEARCH_QUESTION_FALLBACK`) as production resolves them, `SEARCH_FALLBACK_MIN_BUDGET_MS`, `SEARCH_EMERGENCY_THRESHOLD`,
//    the ranking's search-time settings (`SEARCH_EMERGENCY_TOP_THRESHOLD`, `SEARCH_KEYWORD_WEIGHT`, `SEARCH_DIRECT_FLOOR`,
//    `SEARCH_DIRECT_GAP`), the
//    release's own threshold and emergency categories (they are in the release), the private bucket of the release files;
//  - the spend of each call written by the use case, as purpose `test_set`, and no `search_log` row.
// Nothing here ranks, embeds or translates: it only asks the use case and watches it. The use case's `observe` hands over the
// similarities its ranking was made from (the threshold's suggestion needs the scores below the threshold, which no answer
// holds), and the Cohere clients are wrapped to count every vendor call and tell a 429 from another failure (vendorMeter.ts).
// What differs from the app: no `after()` (the writes still pending when an answer is ready are waited for when the run ends),
// no ops events, and no monthly-limit warning (those are the app's).
import {
  EMBED_SPEND_KIND,
  SearchFailure,
  cohereQueryEmbedder,
  createSearch,
  currentSearchFacts,
  supabaseDirectoryStorage,
  type CohereEmbedClient,
  type DirectoryStorage,
  type SearchDeps,
  type SearchObservation,
} from "@/modules/directory";
import { recordOpsEvent, type SEARCH_CHECKPOINTS } from "@/modules/ops";
import { monthlyUsage } from "@/modules/spend";
import { createCohereRestClient } from "@/platform/cohere/restClient";
import { TRANSLATE_SPEND_KIND, cohereTranslator, createQuestionTranslator, type CohereChatClient } from "@/modules/translation";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import type { SearchSettings } from "@/platform/config/env";
import { createDb, type Db } from "@/platform/db";
import { errorCode } from "./lib";
import { planQuestion } from "./callPlan";
import type { ProductionEnv } from "./production";
import { meterVendor } from "./vendorMeter";
import type { Shortfall } from "./bar";
import type { Asked, ReleaseFacts, TuningEngine } from "./tuningRun";

export type SearchCheckpoint = (typeof SEARCH_CHECKPOINTS)[number];

/** What the engine is made from; every part can be swapped by a test. */
export type EngineParts = {
  db: Db;
  storage: DirectoryStorage;
  /** The vendor's clients (one SDK client in production). Wrapped, so that every call is counted. */
  clients: { embed: CohereEmbedClient; chat: CohereChatClient };
  /** The search settings, resolved from the variables production resolves them from. */
  settings: SearchSettings;
  /** Test seams: where the use case's rows go (a test keeps them in memory), and its clock. */
  writer?: SearchDeps["writer"];
  clock?: () => number;
};

export async function engineFrom(parts: EngineParts, options: { translatedLeg: boolean }): Promise<TuningEngine> {
  const found = await currentSearchFacts(parts.db);
  if (!found) throw new Error("there is no current release with search data");
  const facts: ReleaseFacts = found;

  const meter = meterVendor(parts.clients);
  // The adapters take the client they are given and need no key of their own.
  const embedder = cohereQueryEmbedder({ apiKey: "", client: meter.embed });
  const translator = options.translatedLeg
    ? createQuestionTranslator({
        translator: cohereTranslator({ apiKey: "", client: meter.chat }),
        route: parts.settings.questionRoute,
        fallback: parts.settings.questionFallback,
      })
    : null;

  let seen: SearchObservation | null = null;
  const pending: Promise<unknown>[] = [];
  const service = createSearch({
    db: () => parts.db,
    storage: () => parts.storage,
    embedder,
    translator,
    fallbackMinBudgetMs: parts.settings.fallbackMinBudgetMs,
    emergencyThreshold: parts.settings.emergencyThreshold,
    emergencyTopThreshold: parts.settings.emergencyTopThreshold,
    keywordWeight: parts.settings.keywordWeight,
    directFloor: parts.settings.directFloor,
    directGap: parts.settings.directGap,
    spendPurpose: "test_set",
    log: false,
    defer: (work) => void pending.push(work),
    observe: (observation) => {
      seen = observation;
    },
    ...(parts.writer ? { writer: parts.writer } : {}),
    ...(parts.clock ? { clock: parts.clock } : {}),
  });
  const now = parts.clock ?? (() => performance.now());

  return {
    facts,
    has: (id) => service.has(id),
    plan: (question) => planQuestion(question, translator),
    async ask(question): Promise<Asked> {
      meter.take();
      seen = null;
      const started = now();
      let raw: unknown = null;
      let failure: string | null = null;
      try {
        raw = await service.search({ q: question.q, lang: question.page_lang ?? question.lang, v: facts.release });
      } catch (error) {
        failure = error instanceof SearchFailure ? error.code : errorCode(error);
      }
      const ms = now() - started;
      const trace = meter.take();
      let answer = null;
      if (failure === null) {
        const parsed = SearchV1Schema.safeParse(raw);
        if (!parsed.success) throw new Error(`question ${question.id}: the use case's answer is not a SearchV1 body`);
        answer = parsed.data;
        if (answer.release_v !== facts.release) throw new Error(`question ${question.id}: the current release changed during the run (${facts.release} to ${answer.release_v})`);
      }
      return { answer, failure, observation: seen, trace, ms };
    },
    usage: meter.usage,
    async close() {
      // The use case finishes some writes (the spend of a call that settled late) after its answer: wait for them before the connection goes.
      await Promise.allSettled(pending);
      await parts.db.$client.end({ timeout: 5 });
    },
  };
}

/**
 * The Cohere usage recorded in spend_event in the calendar month (America/Toronto) that `now` falls in, in calls and tokens: embedding
 * and translation, whoever made them (live search, a publish, an alert's translation, an earlier test-set run), because the key's limit
 * is the key's and not a purpose's. The same count the translation quota watch uses (`monthlyUsage`, without a purpose). The count is
 * the app's own record, so it can miss a call that never reached it; the vendor's own count is the one that decides.
 */
export async function cohereUsageThisMonth(db: Db, now: Date = new Date()): Promise<{ calls: number; tokens: number }> {
  const embedding = await monthlyUsage(db, EMBED_SPEND_KIND, now);
  const translation = await monthlyUsage(db, TRANSLATE_SPEND_KIND, now);
  return { calls: embedding.calls + translation.calls, tokens: embedding.tokens + translation.tokens };
}

/** The month's Cohere calls alone (S03.07's allowance). */
export async function cohereCallsThisMonth(db: Db, now: Date = new Date()): Promise<number> {
  return (await cohereUsageThisMonth(db, now)).calls;
}

/** Connects with the run's database login, reads the month's Cohere usage and closes the connection. */
export async function readCohereUsageThisMonth(env: ProductionEnv): Promise<{ calls: number; tokens: number }> {
  const db = createDb(env.databaseUrl, { max: 1 });
  try {
    return await cohereUsageThisMonth(db);
  } finally {
    await db.$client.end({ timeout: 5 }).catch(() => undefined);
  }
}

/** Connects with the run's database login, counts the month's Cohere calls and closes the connection. */
export async function readCohereCallsThisMonth(env: ProductionEnv): Promise<number> {
  return (await readCohereUsageThisMonth(env)).calls;
}

/**
 * Records a manual run's measures below the launch bar as `search.below_bar` ops events (S03.09), one per measure, in one transaction,
 * for the weekly review. The app's own login may insert ops events (and nothing in them is a question).
 */
export async function belowBarEvents(db: Db, release: number, checkpoint: SearchCheckpoint, shortfalls: readonly Shortfall[]): Promise<void> {
  if (shortfalls.length === 0) return;
  await db.transaction(async (tx) => {
    for (const s of shortfalls) {
      await recordOpsEvent(tx, {
        kind: "search.below_bar",
        subjectType: "directory_release",
        subjectId: String(release),
        detail: {
          measure: s.measure,
          ...(s.lang === null ? {} : { lang: s.lang }),
          ...(s.observed === null ? {} : { observed_permille: Math.round(s.observed * 1000) }),
          minimum_permille: Math.round(s.minimum * 1000),
          checkpoint,
        },
      });
    }
  });
}

/** Connects with the run's database login, records the events and closes the connection. */
export async function recordBelowBar(env: ProductionEnv, release: number, checkpoint: SearchCheckpoint, shortfalls: readonly Shortfall[]): Promise<void> {
  const db = createDb(env.databaseUrl, { max: 1 });
  try {
    await belowBarEvents(db, release, checkpoint, shortfalls);
  } finally {
    await db.$client.end({ timeout: 5 }).catch(() => undefined);
  }
}

/** The real engine: the production database, Cohere and the private bucket, from the run's settings. */
export async function makeProductionEngine(env: ProductionEnv, options: { translatedLeg: boolean }): Promise<TuningEngine> {
  const cohere = createCohereRestClient({ apiKey: env.cohereApiKey });
  return engineFrom(
    {
      db: createDb(env.databaseUrl, { max: 2 }),
      storage: supabaseDirectoryStorage({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey }),
      clients: { embed: cohere, chat: cohere },
      settings: env.search,
    },
    options,
  );
}
