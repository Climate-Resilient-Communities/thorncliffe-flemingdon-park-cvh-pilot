// The production engine of the search test-set runner (S03.07): the search use case, `createSearch`, built from the settings of
// the run. A script has no Next request and cannot import src/app/search.ts (it is server-only and reads the app's validated
// environment, which wants the app's database role and the production host), so this is the same composition, made of the same
// parts, from the settings the run was given (production.ts lists them). The app's environment check (src/platform/config/env.ts)
// is not touched: nothing here reads COHERE_API_KEY through it, and the SEARCH_* settings are resolved by its own parser.
//
// What matches src/app/search.ts `searchService()`:
//  - the use case (`createSearch`), the Cohere question embedder (`cohereQueryEmbedder`), the translated-question leg's translator
//    (`createQuestionTranslator` over `cohereTranslator`) with the route (`SEARCH_QUESTION_ROUTE`) and the fallback
//    (`SEARCH_QUESTION_FALLBACK`) as production resolves them, `SEARCH_FALLBACK_MIN_BUDGET_MS`, `SEARCH_EMERGENCY_THRESHOLD`, the
//    release's own threshold and emergency categories (they are in the release), the private bucket of the release files;
//  - the spend of each call written by the use case, as purpose `test_set`, and no `search_log` row.
// Nothing here ranks, embeds or translates: it only asks the use case and watches it. The use case's `observe` hands over the
// similarities its ranking was made from (the threshold's suggestion needs the scores below the threshold, which no answer
// holds), and the Cohere clients are wrapped to count every vendor call and tell a 429 from another failure (vendorMeter.ts).
// What differs from the app: no `after()` (the writes still pending when an answer is ready are waited for when the run ends),
// no ops events, and no monthly-limit warning (those are the app's).
import {
  SearchFailure,
  cohereQueryEmbedder,
  createSearch,
  currentSearchFacts,
  supabaseDirectoryStorage,
  warmCohere,
  type CohereEmbedClient,
  type DirectoryStorage,
  type SearchDeps,
  type SearchObservation,
} from "@/modules/directory";
import { cohereTranslator, createQuestionTranslator, type CohereChatClient } from "@/modules/translation";
import { SearchV1Schema } from "@/contracts/searchTestSet";
import type { SearchSettings } from "@/platform/config/env";
import { createDb, type Db } from "@/platform/db";
import { errorCode } from "./lib";
import { planQuestion } from "./callPlan";
import type { ProductionEnv } from "./production";
import { meterVendor } from "./vendorMeter";
import type { Asked, ReleaseFacts, TuningEngine } from "./tuningRun";

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

/** The real engine: the production database, Cohere and the private bucket, from the run's settings. */
export async function makeProductionEngine(env: ProductionEnv, options: { translatedLeg: boolean }): Promise<TuningEngine> {
  const { CohereClient } = await warmCohere();
  const cohere = new CohereClient({ token: env.cohereApiKey });
  return engineFrom(
    {
      db: createDb(env.databaseUrl, { max: 2 }),
      storage: supabaseDirectoryStorage({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey }),
      clients: { embed: cohere as unknown as CohereEmbedClient, chat: cohere as unknown as CohereChatClient },
      settings: env.search,
    },
    options,
  );
}
