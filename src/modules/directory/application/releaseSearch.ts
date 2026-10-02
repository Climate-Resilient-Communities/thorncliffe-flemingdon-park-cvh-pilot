// The search data of a release (S03.02, AD-11, AD-15): embedding each published provider's search text once, in chunks
// that survive a stopped job, writing the vectors file into the same new release, and checking that file against the
// listing files before the release may be made current. The steps of the publish job (publishDirectory.ts) call these.
//
// The design, and why:
//  - the texts are staged with the release at claim time, from the same snapshot as the listing files, so the vectors
//    can never describe providers the listings do not have;
//  - the embedding model is called in chunks of at most `chunkSize` texts. After each call the usage is recorded in
//    spend_event first (money was spent whether or not the rest works), then the chunk is kept in the release row, under
//    the lease token. A job that stops, fails or runs out of its 40 s starts the next pass at the first text not in a kept
//    chunk, and the previous release stays current throughout;
//  - a vector is a pure function of (model, text), so one the previous release already has under the same model for the
//    same text is copied, not embedded again. When the model and catalogue_hash match the previous release, that is every
//    vector. The earlier release and its file are only read, never written (S02.05);
//  - the call is cut off by an abort signal at the shorter of `callTimeoutMs` and what is left of the publish's time, and
//    the allowance (calls and tokens this calendar month, from spend_event) is checked before every call;
//  - the vectors file is private: `releases/{n}/vectors.json` in the same bucket, which no route serves (the routes serve
//    only `<lang>.json` listing files), and the manifest names its path but a phone cannot fetch it.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { monthlyUsage, recordSpendEvent } from "@/modules/spend";
import type { Db } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { directoryRelease } from "../adapters/schema";
import { RELEASE_LANGS, ReleaseSearchSchema, type ReleaseSearch, type SnapshotCategory, type SnapshotProvider } from "../domain/directoryRelease";
import {
  ReleaseSearchRecordSchema,
  SearchPlanSchema,
  VectorChunkSchema,
  VectorsFileSchema,
  estimateTokens,
  listingProviderIds,
  searchItems,
  searchPlan,
  unknownEmergencyCategories,
  vectorsFileBody,
  vectorsProblems,
  type ListingIds,
  type ReleaseSearchRecord,
  type SearchPlan,
  type VectorEntry,
} from "../domain/searchData";
import type { PublishDeps, SearchBuild } from "./ports";
import { LeaseLostError, PublishStepError, type ReleaseClaim } from "./publishSteps";

export const DEFAULT_CHUNK_SIZE = 32;
export const DEFAULT_CALL_TIMEOUT_MS = 15 * 1000;
/** The kind of usage the embedding calls are counted as in spend_event. */
export const EMBED_SPEND_KIND = "embed";

const CHUNK_KEY = "search_chunk_";

export const vectorsPathOf = (release: number) => `releases/${release}/vectors.json`;

/** Where a step runs: the clock, how long a claim lasts, and the time the whole publish may take. */
export interface StepClock {
  clock: () => Date;
  leaseMs: number;
  deadline: number;
}

// ---------------------------------------------------------------- the plan (inside the claim)
/**
 * The search plan of a release, as the text the claim stages with the listing files. Throws a PublishStepError when the
 * settings cannot apply to this snapshot (an emergency category the catalogue does not have).
 */
export function planSearch(build: SearchBuild, providers: SnapshotProvider[], categories: SnapshotCategory[]): string {
  if (unknownEmergencyCategories(build.emergencyCategories, categories).length > 0) {
    throw new PublishStepError("search_config_invalid", false, ["emergency_category_unknown"]);
  }
  const items = searchItems(providers, categories, sha256Hex);
  return JSON.stringify(searchPlan({ embedModel: build.embedder.model, threshold: build.threshold, emergencyCategories: build.emergencyCategories, items }));
}

// ---------------------------------------------------------------- what an earlier release has
/** The vectors the latest complete release with search data holds under this model, by provider id; none when they cannot be read. */
async function previousVectors(db: Db, deps: PublishDeps, model: string): Promise<Map<string, VectorEntry>> {
  const [previous] = await db
    .select({ search: directoryRelease.search })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.status, "complete"), isNotNull(directoryRelease.search)))
    .orderBy(desc(directoryRelease.number))
    .limit(1);
  const none = new Map<string, VectorEntry>();
  const record = ReleaseSearchRecordSchema.safeParse(previous?.search);
  if (!record.success || record.data.embed_model !== model) return none;
  try {
    const body = await deps.storage.get(record.data.vectors_path);
    if (body === null || sha256Hex(body) !== record.data.sha256) return none;
    const file = VectorsFileSchema.safeParse(JSON.parse(body));
    if (!file.success || file.data.embed_model !== model) return none;
    return new Map(file.data.providers.map((entry) => [entry.id, entry] as const));
  } catch {
    // An unreadable earlier file only means the vectors are embedded again.
    return none;
  }
}

// ---------------------------------------------------------------- embedding
interface KeptChunks {
  entries: Map<string, VectorEntry>;
  nextIndex: number;
}

async function keptChunks(db: Db, release: number, plan: SearchPlan): Promise<KeptChunks> {
  const rows = (await db.execute(
    sql`select key, value from directory_release, jsonb_each_text(staged) as kept(key, value) where number = ${release} and key like 'search\\_chunk\\_%'`,
  )) as unknown as { key: string; value: string }[];
  const wanted = new Map(plan.items.map((item) => [item.id, item.text_hash] as const));
  const entries = new Map<string, VectorEntry>();
  let nextIndex = 0;
  for (const row of rows) {
    nextIndex = Math.max(nextIndex, Number(row.key.slice(CHUNK_KEY.length)) + 1);
    const chunk = VectorChunkSchema.safeParse(JSON.parse(row.value));
    if (!chunk.success) continue;
    for (const entry of chunk.data) if (wanted.get(entry.id) === entry.text_hash) entries.set(entry.id, entry);
  }
  return { entries, nextIndex };
}

const embeddingUnavailable = (...detail: string[]) => new PublishStepError("embedding_unavailable", true, detail);

/**
 * Embeds what the release's plan still lacks and writes the vectors file into the release, ready to be checked. A no-op for a
 * release planned without search data, and for one whose file is already stored. Throws a PublishStepError (retryable when
 * another pass can fix it) or LeaseLostError.
 */
export async function buildSearchData(db: Db, deps: PublishDeps, claim: ReleaseClaim, step: StepClock): Promise<{ vectors: number; reused: number; embedded: number } | null> {
  const [row] = await db
    .select({
      status: directoryRelease.status,
      leaseToken: directoryRelease.leaseToken,
      catalogueHash: directoryRelease.catalogueHash,
      search: directoryRelease.search,
      plan: sql<string | null>`${directoryRelease.staged} ->> 'search'`,
    })
    .from(directoryRelease)
    .where(eq(directoryRelease.number, claim.release));
  if (!row || row.status !== "building" || row.leaseToken !== claim.token) throw new LeaseLostError();
  if (row.plan === null) return null;
  const stored = ReleaseSearchRecordSchema.safeParse(row.search);
  if (stored.success) return { vectors: stored.data.vector_count, reused: stored.data.reused, embedded: stored.data.embedded };

  const build = deps.search;
  if (!build) throw new PublishStepError("search_config_invalid", false, ["search_not_configured"]);
  let plan: SearchPlan;
  try {
    plan = SearchPlanSchema.parse(JSON.parse(row.plan));
  } catch {
    throw new PublishStepError("unexpected", false);
  }
  // The release was planned for one model: its texts are embedded with that one or not at all.
  if (build.embedder.model !== plan.embed_model) throw new PublishStepError("search_config_invalid", false, ["embed_model_changed"]);

  const previous = await previousVectors(db, deps, plan.embed_model);
  const reusable = new Map<string, VectorEntry>();
  for (const item of plan.items) {
    const old = previous.get(item.id);
    if (old && old.text_hash === item.text_hash) reusable.set(item.id, old);
  }
  const kept = await keptChunks(db, claim.release, plan);
  const have = (id: string) => reusable.get(id) ?? kept.entries.get(id);
  const chunkSize = Math.max(1, Math.min(96, build.chunkSize ?? DEFAULT_CHUNK_SIZE));

  for (let remaining = plan.items.filter((item) => have(item.id) === undefined); remaining.length > 0; remaining = remaining.slice(chunkSize)) {
    const batch = remaining.slice(0, chunkSize);
    const texts = batch.map((item) => item.text);
    const now = step.clock();
    const timeLeft = step.deadline - now.getTime();
    // No time for another call: the job lets go of its lease, and the next press resumes after the last kept chunk.
    if (timeLeft <= 0) throw embeddingUnavailable("out_of_time");

    const estimate = estimateTokens(texts);
    const used = await monthlyUsage(db, EMBED_SPEND_KIND, now);
    if (used.calls + 1 > build.allowance.callsPerMonth) throw new PublishStepError("usage_allowance_exceeded", false, ["calls"]);
    if (used.tokens + estimate > build.allowance.tokensPerMonth) throw new PublishStepError("usage_allowance_exceeded", false, ["tokens"]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(build.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, timeLeft));
    const started = Date.now();
    let embedded: Awaited<ReturnType<SearchBuild["embedder"]["embedDocuments"]>>;
    try {
      embedded = await build.embedder.embedDocuments(texts, { signal: controller.signal });
    } catch {
      throw embeddingUnavailable("call_failed");
    } finally {
      clearTimeout(timer);
    }
    const ms = Date.now() - started;
    const dims = embedded.vectors[0]?.length ?? 0;
    const vectors = embedded.vectors;
    const wellFormed =
      vectors.length === batch.length &&
      dims > 0 &&
      vectors.every((vector) => Array.isArray(vector) && vector.length === dims && vector.every((n) => typeof n === "number" && Number.isFinite(n))) &&
      [...reusable.values(), ...kept.entries.values()].every((entry) => entry.vector.length === dims);

    // The vendor billed the call whatever it answered: the usage is recorded before the answer is judged or kept.
    try {
      await recordSpendEvent(db, {
        kind: EMBED_SPEND_KIND,
        purpose: "publish",
        model: plan.embed_model,
        releaseV: claim.release,
        calls: 1,
        tokens: embedded.tokens ?? estimate,
        tokensEstimated: embedded.tokens === null,
        ms,
      });
    } catch {
      throw new PublishStepError("unexpected", true);
    }
    if (!wellFormed) throw embeddingUnavailable("bad_response");

    const chunk = batch.map((item, index) => ({ id: item.id, text_hash: item.text_hash, vector: vectors[index] }));
    const index = kept.nextIndex;
    const marked = await db
      .update(directoryRelease)
      .set({
        staged: sql`jsonb_set(${directoryRelease.staged}, ${`{${CHUNK_KEY}${index}}`}::text[], to_jsonb(${JSON.stringify(chunk)}::text), true)`,
        leaseUntil: new Date(step.clock().getTime() + step.leaseMs),
      })
      .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.leaseToken, claim.token), eq(directoryRelease.status, "building")))
      .returning({ number: directoryRelease.number });
    if (marked.length === 0) throw new LeaseLostError();
    kept.nextIndex = index + 1;
    for (const entry of chunk) kept.entries.set(entry.id, entry);
    await deps.hook?.("chunk_embedded", { release: claim.release });
  }

  // Every text has its vector: the file, in provider id order, from the copied and the embedded alike.
  const entries: VectorEntry[] = plan.items.map((item) => have(item.id) as VectorEntry);
  const reused = plan.items.filter((item) => reusable.has(item.id)).length;
  let file: { body: string; dims: number };
  try {
    file = vectorsFileBody({ releaseV: claim.release, catalogueHash: row.catalogueHash, embedModel: plan.embed_model, entries });
  } catch {
    throw new PublishStepError("search_mismatch", false, ["vectors_invalid"]);
  }
  const path = vectorsPathOf(claim.release);
  try {
    await deps.storage.put(path, file.body);
  } catch {
    throw new PublishStepError("storage_unavailable", true);
  }
  const record: ReleaseSearchRecord = {
    embed_model: plan.embed_model,
    vectors_path: path,
    catalogue_hash: row.catalogueHash,
    release_v: claim.release,
    vector_count: entries.length,
    dims: file.dims,
    threshold: plan.threshold,
    emergency_categories: plan.emergency_categories,
    sha256: sha256Hex(file.body),
    bytes: Buffer.byteLength(file.body, "utf8"),
    reused,
    embedded: entries.length - reused,
    stored_at: step.clock().toISOString(),
  };
  const marked = await db
    .update(directoryRelease)
    .set({ search: record, leaseUntil: new Date(step.clock().getTime() + step.leaseMs) })
    .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.leaseToken, claim.token), eq(directoryRelease.status, "building")))
    .returning({ number: directoryRelease.number });
  if (marked.length === 0) throw new LeaseLostError();
  await deps.hook?.("vectors_stored", { release: claim.release });
  return { vectors: record.vector_count, reused: record.reused, embedded: record.embedded };
}

// ---------------------------------------------------------------- the check before the release goes live
export interface VerifiedSearch {
  search: ReleaseSearch;
  record: ReleaseSearchRecord;
}

const mismatch = (...detail: string[]) => new PublishStepError("search_mismatch", false, detail);

/**
 * Reads the release's vectors file back from the store and checks it against the release and against the listing files
 * (the bytes the release recorded, in every language): the same release number and catalogue_hash, the model recorded, and
 * exactly the providers of every listing. Null for a release without search data. Throws a PublishStepError to refuse.
 */
export async function verifySearchData(db: Db, deps: PublishDeps, claim: ReleaseClaim): Promise<VerifiedSearch | null> {
  const [row] = await db
    .select({ catalogueHash: directoryRelease.catalogueHash, search: directoryRelease.search, files: directoryRelease.files })
    .from(directoryRelease)
    .where(eq(directoryRelease.number, claim.release));
  if (!row) throw new LeaseLostError();
  if (row.search === null) return null;
  const record = ReleaseSearchRecordSchema.safeParse(row.search);
  if (!record.success) throw mismatch("record_invalid");

  let body: string | null;
  try {
    body = await deps.storage.get(record.data.vectors_path);
  } catch {
    throw new PublishStepError("storage_unavailable", true);
  }
  if (body === null) throw mismatch("vectors_missing");
  if (sha256Hex(body) !== record.data.sha256) throw mismatch("vectors_changed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw mismatch("vectors_invalid");
  }
  const file = VectorsFileSchema.safeParse(parsed);
  if (!file.success) throw mismatch("vectors_invalid");

  const listings: ListingIds[] = [];
  for (const lang of RELEASE_LANGS) {
    const [staged] = await db
      .select({ body: sql<string | null>`${directoryRelease.staged} ->> ${lang}` })
      .from(directoryRelease)
      .where(eq(directoryRelease.number, claim.release));
    const text = staged?.body ?? undefined;
    const entry = row.files[lang];
    // The listing the vectors are checked against must be the one the release stored.
    if (text === undefined || entry === undefined || sha256Hex(text) !== entry.sha256) throw new PublishStepError("unexpected", false);
    const ids = listingProviderIds(text);
    if (ids === null) throw new PublishStepError("unexpected", false);
    listings.push({ lang, ids });
  }

  const problems = vectorsProblems(file.data, { number: claim.release, catalogueHash: row.catalogueHash, embedModel: record.data.embed_model }, listings);
  if (record.data.release_v !== claim.release) problems.push("record:release");
  if (record.data.catalogue_hash !== row.catalogueHash) problems.push("record:catalogue");
  if (record.data.vector_count !== file.data.providers.length || record.data.dims !== file.data.dims) problems.push("record:size");
  if (problems.length > 0) throw mismatch(...problems.slice(0, 20));

  return {
    search: ReleaseSearchSchema.parse({
      embedModel: file.data.embed_model,
      vectorsPath: record.data.vectors_path,
      catalogueHash: file.data.catalogue_hash,
      releaseV: file.data.release_v,
    }),
    record: record.data,
  };
}
