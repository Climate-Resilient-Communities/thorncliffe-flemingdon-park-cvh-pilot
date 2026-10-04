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
//  - a vector is a pure function of (embedding config, text), where the config is the model, the input type, the kind of
//    numbers and their count. One that an earlier release already has under the same config for the same text is copied,
//    by the hash of the text, not embedded again: from the latest complete release with search data, and from the chunks
//    the latest failed or abandoned release kept (its staged text is cleared on closing, its paid vectors are not). The
//    earlier release and its file are only read, never written (S02.05);
//  - the usage allowance is the publish allowance: only usage with the purpose `publish` counts. Before the first call the
//    calls and tokens that all the remaining texts need are estimated and the build is refused up front if they do not fit;
//    a refusal never closes the build: the lease is let go and the kept chunks wait for the next press. Each call then
//    decides and records its usage in one transaction under the spend lock, so two callers cannot both take the last call;
//  - a call is only started when at least `callTimeoutMs` of the publish's time is left, and is cut off by an abort signal
//    at `callTimeoutMs`. A call that fails or is cut off is recorded too, as an estimate (it may have been billed);
//  - the vectors file is private: `releases/{n}/vectors.json` in the same bucket, which no route serves (the routes serve
//    only `<lang>.json` listing files), and the manifest names its path but a phone cannot fetch it. Writing it and reading
//    it back each have their own time limit.
import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { monthlyUsage, recordSpendEvent, withSpendLock } from "@/modules/spend";
import type { Db } from "@/platform/db";
import { sha256Hex, sha256HexBytes } from "@/platform/hash";
import { directoryRelease } from "../adapters/schema";
import { RELEASE_LANGS, ReleaseSearchSchema, type ReleaseSearch, type SnapshotCategory, type SnapshotProvider } from "../domain/directoryRelease";
import {
  KeptSearchSchema,
  ReleaseSearchRecordSchema,
  SearchPlanSchema,
  VectorChunkSchema,
  VectorsFileSchema,
  embeddingConfigRecord,
  estimateTokens,
  listingProviderIds,
  searchItems,
  searchPlan,
  sortedVectorEntries,
  unknownEmergencyCategories,
  vectorsFileBody,
  vectorsProblems,
  type ListingIds,
  type ReleaseSearchRecord,
  type SearchPlan,
  type VectorEntry,
  type VectorsFile,
} from "../domain/searchData";
import { VectorsBinaryError, decodeVectorsBinary, encodeVectorsBinary } from "../domain/vectorsBinary";
import type { EmbeddedTexts, PublishDeps, SearchBuild } from "./ports";
import { LeaseLostError, PublishStepError, type ReleaseClaim } from "./publishSteps";

export const DEFAULT_CHUNK_SIZE = 32;
export const DEFAULT_CALL_TIMEOUT_MS = 15 * 1000;
export const DEFAULT_VECTORS_PUT_TIMEOUT_MS = 10 * 1000;
export const DEFAULT_VECTORS_GET_TIMEOUT_MS = 10 * 1000;
/** The kind of usage the embedding calls are counted as in spend_event. */
export const EMBED_SPEND_KIND = "embed";
/** The purpose the publish job's calls are counted under: the publish allowance counts nothing else. */
export const EMBED_PUBLISH_PURPOSE = "publish";

const CHUNK_KEY = "search_chunk_";

export const vectorsPathOf = (release: number) => `releases/${release}/vectors.json`;
/** The compact binary form of the same vectors, read first by the search where a release has it. */
export const vectorsBinaryPathOf = (release: number) => `releases/${release}/vectors.bin`;

/** Where a step runs: the clock, how long a claim lasts, and the time the whole publish may take. */
export interface StepClock {
  clock: () => Date;
  leaseMs: number;
  deadline: number;
}

class TimedOut extends Error {}

/** The result of `work`, or a TimedOut rejection when it has not settled after `ms`. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => void (timer = setTimeout(() => reject(new TimedOut()), ms)))]);
  } finally {
    clearTimeout(timer);
  }
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
  return JSON.stringify(searchPlan({ embedConfig: build.embedder.config, threshold: build.threshold, emergencyCategories: build.emergencyCategories, items }));
}

// ---------------------------------------------------------------- what a closed build keeps
/**
 * The value of the `search` column for a build being closed as failed, as SQL over the row's own `staged`: the chunks it
 * had embedded, flattened, under the embedding config key of its plan; null when it had none. The guard allows it because
 * the row is still `building` in the statement that closes it.
 */
export function keptOnClose(): SQL {
  return sql`(
    select case when count(e.entry) = 0 then null else jsonb_build_object('kept', jsonb_build_object('embed_config_key', (${directoryRelease.staged} ->> 'search')::jsonb ->> 'embed_config_key', 'entries', jsonb_agg(e.entry))) end
    from jsonb_each_text(${directoryRelease.staged}) as c(key, value)
    cross join lateral jsonb_array_elements(c.value::jsonb) as e(entry)
    where c.key like 'search\\_chunk\\_%'
  )`;
}

/** The same, from a staged object already in hand (the claim closes a stopped build inside its own transaction). */
export function keptOfStaged(staged: Record<string, string> | null): ReturnType<typeof KeptSearchSchema.parse> | null {
  if (staged === null || staged.search === undefined) return null;
  try {
    const key = (JSON.parse(staged.search) as { embed_config_key?: unknown }).embed_config_key;
    if (typeof key !== "string") return null;
    const entries = Object.entries(staged)
      .filter(([name]) => name.startsWith(CHUNK_KEY))
      .flatMap(([, value]) => VectorChunkSchema.parse(JSON.parse(value)));
    return entries.length === 0 ? null : { kept: { embed_config_key: key, entries } };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- what an earlier release has
/**
 * The vectors that earlier releases hold under this embedding config, by the hash of their text: the latest complete
 * release with search data (its file is read from the store), and the chunks the latest failed or abandoned release kept.
 * Whatever cannot be read is left out, and its texts are embedded again.
 */
async function previousVectors(db: Db, deps: PublishDeps, build: SearchBuild, configKey: string): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  const [failed] = await db
    .select({ search: directoryRelease.search })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.status, "failed"), sql`${directoryRelease.search} -> 'kept' ->> 'embed_config_key' = ${configKey}`))
    .orderBy(desc(directoryRelease.number))
    .limit(1);
  const kept = KeptSearchSchema.safeParse(failed?.search);
  if (kept.success) for (const entry of kept.data.kept.entries) found.set(entry.text_hash, entry.vector);

  const [previous] = await db
    .select({ search: directoryRelease.search })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.status, "complete"), isNotNull(directoryRelease.search)))
    .orderBy(desc(directoryRelease.number))
    .limit(1);
  const record = ReleaseSearchRecordSchema.safeParse(previous?.search);
  if (!record.success || record.data.embed_config_key !== configKey) return found;
  try {
    const body = await within(deps.storage.get(record.data.vectors_path), build.vectorsGetTimeoutMs ?? DEFAULT_VECTORS_GET_TIMEOUT_MS);
    if (body === null || sha256Hex(body) !== record.data.sha256) return found;
    const file = VectorsFileSchema.safeParse(JSON.parse(body));
    if (!file.success || file.data.embed_model !== build.embedder.model) return found;
    for (const entry of file.data.providers) found.set(entry.text_hash, entry.vector);
  } catch {
    // An unreadable earlier file only means the vectors are embedded again.
  }
  return found;
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
/** Over the allowance: told to the Admin and ops, but the build and its kept chunks stay for the next press. */
const overAllowance = (what: "calls" | "tokens") => new PublishStepError("usage_allowance_exceeded", false, [what], undefined, true);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

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

  const build = deps.search;
  if (!build) throw new PublishStepError("search_config_invalid", false, ["search_not_configured"]);
  let plan: SearchPlan;
  try {
    plan = SearchPlanSchema.parse(JSON.parse(row.plan));
  } catch {
    throw new PublishStepError("unexpected", false);
  }
  // The release was planned for one embedding config, one threshold and one list of emergency categories, and it is built and
  // recorded with those or not at all: a resumed build does not take up settings changed since it was planned.
  if (build.embedder.model !== plan.embed_model) throw new PublishStepError("search_config_invalid", false, ["embed_model_changed"]);
  if (JSON.stringify(embeddingConfigRecord(build.embedder.config)) !== JSON.stringify(plan.embed_config)) throw new PublishStepError("search_config_invalid", false, ["embed_config_changed"]);
  if (build.threshold !== plan.threshold) throw new PublishStepError("search_config_invalid", false, ["threshold_changed"]);
  if (!sameSet(build.emergencyCategories, plan.emergency_categories)) throw new PublishStepError("search_config_invalid", false, ["emergency_categories_changed"]);

  const stored = ReleaseSearchRecordSchema.safeParse(row.search);
  if (stored.success) return { vectors: stored.data.vector_count, reused: stored.data.reused, embedded: stored.data.embedded };

  const previous = await previousVectors(db, deps, build, plan.embed_config_key);
  const reusable = new Map<string, VectorEntry>();
  for (const item of plan.items) {
    const old = previous.get(item.text_hash);
    if (old) reusable.set(item.id, { id: item.id, text_hash: item.text_hash, vector: old });
  }
  const kept = await keptChunks(db, claim.release, plan);
  const have = (id: string) => reusable.get(id) ?? kept.entries.get(id);
  const chunkSize = Math.max(1, Math.min(96, build.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const callTimeoutMs = build.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  // Before the first call: would all the calls the rest of this build needs fit in what the month has left for publishing?
  // A build that needs none (everything copied or kept) is never refused for the allowance.
  const todo = plan.items.filter((item) => have(item.id) === undefined);
  if (todo.length > 0) {
    const used = await monthlyUsage(db, EMBED_SPEND_KIND, step.clock(), EMBED_PUBLISH_PURPOSE);
    if (used.calls + Math.ceil(todo.length / chunkSize) > build.allowance.callsPerMonth) throw overAllowance("calls");
    if (used.tokens + estimateTokens(todo.map((item) => item.text)) > build.allowance.tokensPerMonth) throw overAllowance("tokens");
  }

  for (let remaining = todo; remaining.length > 0; remaining = remaining.slice(chunkSize)) {
    const batch = remaining.slice(0, chunkSize);
    const texts = batch.map((item) => item.text);
    const now = step.clock();
    // Not enough time for a whole call: the job lets go of its lease, and the next press resumes after the last kept chunk.
    if (step.deadline - now.getTime() < callTimeoutMs) throw embeddingUnavailable("out_of_time");

    const estimate = estimateTokens(texts);
    let outcome: { refused: "calls" | "tokens" } | { refused: null; embedded: EmbeddedTexts | null };
    try {
      // Decide and record under the spend lock: the allowance is read, the call made and its usage inserted in one
      // transaction, so a second caller sees this call's usage when it reads, not before.
      outcome = await withSpendLock(db, async (tx) => {
        const used = await monthlyUsage(tx, EMBED_SPEND_KIND, now, EMBED_PUBLISH_PURPOSE);
        if (used.calls + 1 > build.allowance.callsPerMonth) return { refused: "calls" } as const;
        if (used.tokens + estimate > build.allowance.tokensPerMonth) return { refused: "tokens" } as const;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), callTimeoutMs);
        const started = Date.now();
        let embedded: EmbeddedTexts | null = null;
        try {
          embedded = await build.embedder.embedDocuments(texts, { signal: controller.signal });
        } catch {
          embedded = null;
        } finally {
          clearTimeout(timer);
        }
        // The vendor bills what it did whatever it answered, and may have billed a call that failed or was cut off: the
        // usage is recorded before the answer is judged or kept, as an estimate when the vendor did not say.
        await recordSpendEvent(tx, {
          kind: EMBED_SPEND_KIND,
          purpose: EMBED_PUBLISH_PURPOSE,
          model: plan.embed_model,
          releaseV: claim.release,
          calls: 1,
          tokens: embedded?.tokens ?? estimate,
          tokensEstimated: embedded === null || embedded.tokens === null,
          ms: Date.now() - started,
        });
        return { refused: null, embedded };
      });
    } catch {
      throw new PublishStepError("unexpected", true);
    }
    if (outcome.refused !== null) throw overAllowance(outcome.refused);
    const embedded = outcome.embedded;
    if (embedded === null) throw embeddingUnavailable("call_failed");

    const dims = embedded.vectors[0]?.length ?? 0;
    const vectors = embedded.vectors;
    const wellFormed =
      vectors.length === batch.length &&
      dims > 0 &&
      vectors.every((vector) => Array.isArray(vector) && vector.length === dims && vector.every((n) => typeof n === "number" && Number.isFinite(n))) &&
      [...reusable.values(), ...kept.entries.values()].every((entry) => entry.vector.length === dims);
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
    await within(deps.storage.put(path, file.body), build.vectorsPutTimeoutMs ?? DEFAULT_VECTORS_PUT_TIMEOUT_MS);
  } catch {
    throw new PublishStepError("storage_unavailable", true);
  }
  // The compact copy, for a fast cold start of the search. It is an addition, never a requirement: a store that keeps only text, or a
  // write that fails, leaves the release with its JSON vectors alone (which every reader falls back to).
  let binary: ReleaseSearchRecord["binary"];
  if (deps.storage.putBytes) {
    try {
      const bytes = encodeVectorsBinary({ releaseV: claim.release, catalogueHash: row.catalogueHash, embedModel: plan.embed_model, entries: sortedVectorEntries(entries) }, sha256HexBytes);
      const binaryPath = vectorsBinaryPathOf(claim.release);
      await within(deps.storage.putBytes(binaryPath, bytes), build.vectorsPutTimeoutMs ?? DEFAULT_VECTORS_PUT_TIMEOUT_MS);
      binary = { path: binaryPath, sha256: sha256HexBytes(bytes), bytes: bytes.length };
    } catch {
      binary = undefined;
    }
  }
  const record: ReleaseSearchRecord = {
    embed_model: plan.embed_model,
    embed_config: plan.embed_config,
    embed_config_key: plan.embed_config_key,
    vectors_path: path,
    catalogue_hash: row.catalogueHash,
    release_v: claim.release,
    vector_count: entries.length,
    dims: file.dims,
    threshold: plan.threshold,
    emergency_categories: plan.emergency_categories,
    sha256: sha256Hex(file.body),
    bytes: Buffer.byteLength(file.body, "utf8"),
    ...(binary ? { binary } : {}),
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

/** The compact vectors, read back: the recorded hash, a valid file, the same release, catalogue, model and providers as the JSON file, and its numbers (as Float32). */
async function verifyBinary(deps: PublishDeps, binary: NonNullable<ReleaseSearchRecord["binary"]>, file: VectorsFile, catalogueHash: string): Promise<void> {
  if (!deps.storage.getBytes) throw new PublishStepError("storage_unavailable", true);
  let bytes: Uint8Array | null;
  try {
    bytes = await within(deps.storage.getBytes(binary.path), deps.search?.vectorsGetTimeoutMs ?? DEFAULT_VECTORS_GET_TIMEOUT_MS);
  } catch {
    throw new PublishStepError("storage_unavailable", true);
  }
  if (bytes === null) throw mismatch("binary_missing");
  if (sha256HexBytes(bytes) !== binary.sha256) throw mismatch("binary_changed");
  let decoded: ReturnType<typeof decodeVectorsBinary>;
  try {
    decoded = decodeVectorsBinary(bytes, sha256HexBytes);
  } catch (error) {
    throw mismatch(error instanceof VectorsBinaryError ? "binary_invalid" : "binary_unreadable");
  }
  const { header, vectors } = decoded;
  if (header.release_v !== file.release_v || header.catalogue_hash !== catalogueHash || header.embed_model !== file.embed_model || header.dims !== file.dims) throw mismatch("binary_differs");
  if (header.ids.length !== file.providers.length || file.providers.some((p, i) => p.id !== header.ids[i])) throw mismatch("binary_differs");
  const same = file.providers.every((p, i) => p.vector.every((n, j) => vectors[i]![j] === Math.fround(n)));
  if (!same) throw mismatch("binary_differs");
}

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
    body = await within(deps.storage.get(record.data.vectors_path), deps.search?.vectorsGetTimeoutMs ?? DEFAULT_VECTORS_GET_TIMEOUT_MS);
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
  if (record.data.binary) await verifyBinary(deps, record.data.binary, file.data, row.catalogueHash);

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
