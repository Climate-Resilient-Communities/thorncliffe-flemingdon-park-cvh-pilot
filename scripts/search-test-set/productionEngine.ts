// The production engine of the search test-set runner (S03.07 infrastructure): the search use case, `createSearch`, built
// from the environment of the run. A script has no Next request and cannot import src/app/search.ts (it is server-only and
// reads the app's validated environment, which wants the app's database role and the production host), so this is the
// same composition from the settings the run was given (production.ts lists them). The app's environment check
// (src/platform/config/env.ts) is not touched or called: nothing here reads COHERE_API_KEY through it.
//
// What matches src/app/search.ts `searchTestSetEngine`: the same use case, the Cohere question embedder, the private
// bucket, spend purpose `test_set` and no `search_log` row. Nothing is deferred: each question's usage is written before
// its answer returns, so the timing a run reports is the use case's own.
//
// Besides answering, it keeps the question's embedding vector to rank every provider before the threshold (the use case
// returns only providers at or above it), so the run can show the scores a threshold would cut.
import { sql } from "drizzle-orm";
import {
  ReleaseSearchRecordSchema,
  VectorsFileSchema,
  cohereQueryEmbedder,
  cosine,
  createSearch,
  supabaseDirectoryStorage,
  type DirectoryStorage,
  type QueryEmbedder,
  type SearchService,
} from "@/modules/directory";
import { createDb, type Db } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { meterEmbedder, type MakeEngine, type Probe, type ProductionEngine, type ReleaseFacts } from "./production";

/** What the engine is made from; every part can be swapped by a test. */
export type EngineParts = {
  db: Db;
  storage: DirectoryStorage;
  embedder: QueryEmbedder;
  /** Whether the translated-question leg's translator is wired (S03.05 has not landed here, so a run with the leg on is refused). */
  translatorAvailable?: boolean;
};

const TOP = 5;

async function currentRelease(db: Db): Promise<{ number: number; search: unknown } | null> {
  const rows = (await db.execute(sql`select number, search from directory_release where is_current and status = 'complete'`)) as unknown as { number: number; search: unknown }[];
  return rows[0] ?? null;
}

export async function engineFrom(parts: EngineParts, options: { translatedLeg: boolean }): Promise<ProductionEngine> {
  if (options.translatedLeg && !parts.translatorAvailable) {
    throw new Error("the translated-question leg is not in this build yet (S03.05): run with --translated-leg off");
  }
  const current = await currentRelease(parts.db);
  if (!current) throw new Error("there is no current release");
  const record = ReleaseSearchRecordSchema.safeParse(current.search);
  if (!record.success) throw new Error(`release ${current.number} has no search data`);
  const facts: ReleaseFacts = { release: current.number, model: record.data.embed_model, threshold: record.data.threshold };

  const body = await parts.storage.get(record.data.vectors_path);
  if (body === null || sha256Hex(body) !== record.data.sha256) throw new Error("the release's vectors file is missing or changed");
  const vectors = VectorsFileSchema.parse(JSON.parse(body));

  let captured: number[][] = [];
  const metered = meterEmbedder(parts.embedder, (vector) => captured.push(vector));
  const service: SearchService = createSearch({ db: () => parts.db, storage: () => parts.storage, embedder: metered.embedder, spendPurpose: "test_set", log: false });
  const probes: (Probe | null)[] = [];

  return {
    async search(input) {
      captured = [];
      let answer;
      try {
        answer = await service.search(input);
      } catch (error) {
        probes.push(null);
        throw error;
      }
      if (answer.release_v !== facts.release) {
        probes.push(null);
        throw new Error(`the current release changed during the run (${facts.release} to ${answer.release_v})`);
      }
      // The best similarity of each provider over the vectors this question was embedded as (one per leg).
      const best = new Map<string, number>();
      for (const vector of captured) {
        for (const provider of vectors.providers) best.set(provider.id, Math.max(best.get(provider.id) ?? -Infinity, cosine(vector, provider.vector)));
      }
      const top = [...best]
        .map(([provider_id, score]) => ({ provider_id, score }))
        .sort((a, b) => b.score - a.score || a.provider_id.localeCompare(b.provider_id))
        .slice(0, TOP);
      probes.push({ top });
      return answer;
    },
    has: (id) => service.has(id),
    describe: () => facts,
    probes,
    usage: metered.usage,
    close: async () => {
      await parts.db.$client.end({ timeout: 5 });
    },
  };
}

/** The real engine: the production database, Cohere and the private bucket, from the run's settings. */
export const makeProductionEngine: MakeEngine = async (env, options) =>
  engineFrom(
    {
      db: createDb(env.databaseUrl, { max: 2 }),
      storage: supabaseDirectoryStorage({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey }),
      embedder: cohereQueryEmbedder({ apiKey: env.cohereApiKey }),
    },
    options,
  );
