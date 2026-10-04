// The search use case (S03.04, FR-D2-Q, AD-11, AD-3): a resident's question in, `SearchV1` out. It is a function of its
// dependencies, not of HTTP: the route handler (src/app/api/search/route.ts) and the search test-set runner
// (scripts/search-test-set) both call `search()`; the runner takes the whole service as its SearchEngine.
//
//  - Request snapshot: at the start of a request the current release is read once (its number, embedding model, vectors,
//    threshold and emergency categories) and only that is used to the end; a release made current meanwhile is for the
//    next search. The vectors of a release are read from the private store once and kept in memory (the release's files
//    never change), checked against the hash the release recorded.
//  - The direct leg embeds the question as typed with the snapshot's model as a query (`input_type: search_query`).
//  - The translated-question leg (S03.05): for Pashto, Dari, native-script Urdu, romanized or mixed (but not one or two plainly
//    English words), and ambiguous Arabic-script questions, the `translation` module translates the question to English
//    with the model `search_question_route` names and checks that it is English; the translation is then embedded with the
//    snapshot's model. The translation starts with the request, in parallel with the snapshot read and the direct leg (only
//    its embedding waits for the snapshot). When the routed model is past a vendor limit (HTTP 429), the kind of question has a
//    fallback model (`SEARCH_QUESTION_FALLBACK`) and enough of the budget is left, the translation is retried once with it,
//    under the same signal and deadline. The leg covers the translation and its embedding. `search_log.translated_leg`
//    says what it did: `used`, `failed` (the call failed, or the answer was not English or was an answer rather than a
//    translation), `timed_out`, or `not_needed` (no leg was run, or the answer was the question itself, already English).
//    A vendor call that failed while the other leg answered is still told to ops (`answered: true`), once a minute per reason
//    and model.
//  - Ranking (domain/searchRanking.ts) over the legs that completed: threshold first, then RRF (k = 60) when both did,
//    top 5. When the direct leg fails but the translated one completed, the results come from the translated leg alone.
//  - Emergency fail-safe (owner decision 41): `emergency_first` is also set when an emergency-category provider is in the
//    top 3 of either completed leg at the emergency-only threshold, even with no clear match (the results then stay empty).
//    It only ever turns the flag on.
//  - Time: every leg is cancelled and ignored when still running 2.2 s after the request started (its result, should it
//    arrive later, is never used), and the whole request
//    answers within 2.5 s. "Started" is when the route took the request (it passes that time in), so reading the body and
//    the rate limiter count against the budget. A search with no completed leg fails with `search_unavailable`; a release without search data,
//    or a deployment without an embedding key, answers `status: "unavailable"` (an expected outcome) and calls no model (a
//    translation already started for a release found to have no search data is cancelled).
//    Every wait observes the same absolute moments, counted from that start: the snapshot read (the database read of the
//    current release, which also has a statement timeout of the time left, and the release's data, whether this request
//    loads it or joins a load another request started) and both legs end at 2.2 s; the writes are waited for until 2.4 s
//    (ANSWER_MARGIN_MS before the end), so that a ready answer always beats the route's own hard deadline at 2.5 s. A load of
//    a release's data is shared: a request that joins one stops waiting at its own deadline while the load runs on for the
//    searches after it, and a load still running SNAPSHOT_LOAD_TIMEOUT_MS after it started is given up as failed.
//  - No transaction and no spend lock are held across a vendor call: each call's usage is one plain insert in
//    `spend_event` (purpose `search`; `test_set` for the test-set runner, which also writes no `search_log` row) after the call (or, for a call cancelled at the deadline, an estimate), outside the publish allowance (the lock and the allowance are the
//    publish job's).
//  - Privacy (AD-3): the question, and its English translation, are held in this function's variables for the length of
//    the request. Neither is ever stored, cached, logged, audited or put into an error; the translation's usage goes to
//    `spend_event` (kind `translate`) as counts only. `search_log` takes counts and codes, ops events take a reason and a
//    duration, and every failure that leaves this function is a SearchFailure holding a code.
//  - Why a search could not answer: each failure also carries a safe classification (`error` of the note the app turns into an
//    ops event, and one `search.failed` log line): a schema path (`listing_schema:providers.0.name`), a fault of the release's
//    files (`vectors_missing`, `vectors_hash`, `vectors_release`, `listing_missing`, `listing_hash`), a Postgres SQLSTATE,
//    `timed_out`, a vendor failure's class (`translate_failed:quota`, `embed_failed:limited`) or an error's class name. Never an
//    error's message, an address, a hash or the question (src/platform/safeError.ts, src/contracts/safeError.ts).
import { and, eq, sql } from "drizzle-orm";
import { DirectoryListingV1 } from "@/contracts/directory";
import type { LangCode } from "@/contracts/lang";
import { parseSearchRequest } from "@/contracts/search";
import type { SearchV1 } from "@/contracts/searchTestSet";
import { recordSpendEvent, type SpendEventInput, type SpendPurpose } from "@/modules/spend";
import {
  QuestionTranslationError,
  estimateTranslationTokens,
  isLimitFailure,
  questionTranslationSpend,
  sourceLanguage,
  systemPrompt,
  type QuestionSource,
  type QuestionTranslator,
} from "@/modules/translation";
import type { Db, DbExecutor } from "@/platform/db";
import { sha256Hex, sha256HexBytes } from "@/platform/hash";
import { SafeDetailError, classifyError, schemaFailure } from "@/platform/safeError";
import type { PhaseTimings, TimingPhase } from "@/platform/serverTiming";
import { directoryRelease, searchLog } from "../adapters/schema";
import { detect, isClearlyEnglish, type QuestionLanguage } from "../domain/questionLanguage";
import { DEFAULT_EMERGENCY_THRESHOLD, cosine, emergencyFirst, emergencyInTop, rankLegs } from "../domain/searchRanking";
import { ReleaseSearchRecordSchema, VectorsFileSchema, estimateTokens, type ReleaseSearchRecord } from "../domain/searchData";
import { VectorsBinaryError, decodeVectorsBinary } from "../domain/vectorsBinary";
import { QueryEmbedError, type DirectoryStorage, type QueryEmbedder, type ReleaseFileCache } from "./ports";

/** The kind and purpose a question's embedding is counted under in spend_event. */
export const SEARCH_SPEND_KIND = "embed";
export const SEARCH_SPEND_PURPOSE = "search";

/** A release whose search data failed to load is not loaded again (nor alerted again) for this long. */
export const SNAPSHOT_FAILURE_TTL_MS = 60_000;

/**
 * A load of a release's search data still running this long after it started is given up and counted as a failed load
 * (SNAPSHOT_FAILURE_TTL_MS then applies). Requests never wait for it this long (each stops at its own deadline); the cap only
 * keeps a load that never settles (a store that never answers) from being joined by every search after it. It is above
 * the store's own worst case (four calls of DEFAULT_STORAGE_TIMEOUT_MS), so a slow store is waited for, not abandoned.
 */
export const SNAPSHOT_LOAD_TIMEOUT_MS = 40_000;

/**
 * The writes of a search are waited for until this long before the end of the budget (2.4 s of 2.5 s): the answer is then
 * ready before the route's hard deadline at 2.5 s, which would otherwise race it and could turn a good answer into a 503.
 */
export const ANSWER_MARGIN_MS = 100;

/**
 * The least time left in the leg's budget that a fallback translation is still tried with (SEARCH_FALLBACK_MIN_BUDGET_MS): a
 * call that cannot finish would only be billed, and it would end the leg as `timed_out` instead of the failure that was
 * already known. A translation takes about 0.5 s, so the default leaves room for one.
 */
export const DEFAULT_FALLBACK_MIN_BUDGET_MS = 800;

/** A leg still running this long after the request started is cancelled (the E03 definitions' search time limit). */
export const DEFAULT_LEG_TIMEOUT_MS = 2200;
/** The whole request answers within this long. */
export const DEFAULT_TOTAL_BUDGET_MS = 2500;

/** The classification of a failure that is a timeout. */
const TIMED_OUT = "timed_out";

/**
 * The safe classification of a failed translation call: its code and, for a vendor failure, how the vendor's call failed
 * (`translate_failed:quota`, `translate_failed:unavailable`); any other error as classifyError does. Never a message.
 */
function classifyTranslation(error: unknown): string {
  if (error instanceof QuestionTranslationError) return error.vendor === undefined ? error.code : `${error.code}:${error.vendor}`;
  return classifyError(error);
}

/**
 * The safe classification of a failed embedding: its code and, for a vendor failure, how the vendor's call failed from its
 * status (`embed_failed:limited`, `embed_failed:auth`); any other error as classifyError does. Never a message.
 */
function classifyEmbedding(error: unknown): string {
  if (error instanceof QueryEmbedError) return error.vendor === undefined ? error.code : `${error.code}:${error.vendor}`;
  return classifyError(error);
}

/** Why a search failed, as a code: what the route answers with and what the test-set runner records as `error:<code>`. */
export type SearchFailureCode = "invalid_request" | "invalid_question" | "invalid_lang" | "search_unavailable";

/** The only error a search throws. It holds a code and nothing from the request. */
export class SearchFailure extends Error {
  override name = "SearchFailure";
  readonly code: SearchFailureCode;
  constructor(code: SearchFailureCode) {
    super(`search failed: ${code}`);
    this.code = code;
  }
}

export type SearchStageReason = "snapshot_failed" | "embed_failed" | "embed_invalid" | "timed_out";

/**
 * A vendor call of a leg failed while the search still answered (the other leg completed). `translate_quota`: the
 * translation model is past the vendor's limit; `translate_fallback_used`: the fallback model made the translation instead.
 */
export type SearchLegFailureReason = "embed_failed" | "translate_failed" | "translate_quota" | "translate_fallback_used";

/**
 * What the app is told when a search could not answer (`answered` absent), or when a vendor call failed but the other leg
 * answered (`answered: true`): a reason, a duration and, where the failure has one, its safe classification (`error`: a schema
 * path, a SQLSTATE, `timed_out`, a class name; see src/platform/safeError.ts), never a message or the question.
 */
export type SearchFailureNote =
  | { reason: SearchStageReason; releaseV: number | null; ms: number; answered?: undefined; error?: string }
  | { reason: SearchLegFailureReason; releaseV: number | null; ms: number; answered: true; /** The translation model concerned (a vendor model id), when the reason is about one. */ model?: string; error?: string };

/** What the translated-question leg did, as `search_log.translated_leg` records it. */
export type TranslatedLeg = "not_needed" | "used" | "failed" | "timed_out";

/**
 * What a search saw before it answered, for the test-set runner's measurement of the no-match threshold (S03.07): the scores
 * below the threshold are never in the answer, so the runner is handed the similarities the ranking was made from. Provider
 * ids and similarities only, never the question or its translation.
 */
export interface SearchObservation {
  releaseV: number;
  /** The release's threshold, and the emergency-only threshold as configured (the fail-safe applies it at most as high as the release's). */
  threshold: number;
  emergencyThreshold: number;
  /** The providers of an emergency category in this release. */
  emergencyProviders: ReadonlySet<string>;
  /** What the translated-question leg did. */
  translatedLeg: TranslatedLeg;
  /** The similarity of every provider of the release in each leg that completed: the direct leg first, then the translated one. */
  legs: { leg: "direct" | "translated"; similarities: ReadonlyMap<string, number> }[];
}

/** One search_log row: counts and codes only. */
export interface SearchLogRow {
  lang: LangCode;
  queryLang: LangCode;
  releaseV: number | null;
  ms: number;
  status: "ok" | "no_clear_match" | "unavailable" | "error";
  resultCount: number;
  topScore: number | null;
  translatedLeg: TranslatedLeg;
}

/** Where a search's rows go: search_log and spend_event in the database (a test may keep them in memory). */
export interface SearchWriter {
  log(row: SearchLogRow): Promise<void>;
  spend(event: SpendEventInput): Promise<void>;
}

/** What a release's search data makes of it in memory. */
export interface SnapshotData {
  releaseV: number;
  model: string;
  dims: number | null;
  threshold: number;
  ids: string[];
  vectors: ArrayLike<number>[];
  known: ReadonlySet<string>;
  emergency: ReadonlySet<string>;
}

/** The request snapshot: the current release (null when there is none) and its search data (null when it has none, or no key is configured). */
export interface SearchSnapshot {
  releaseV: number | null;
  data: SnapshotData | null;
}

export interface SearchDeps {
  db: () => Db;
  storage: () => DirectoryStorage;
  /** The question embedder; null where no embedding key is configured (every search then answers `unavailable`). */
  embedder: QueryEmbedder | null;
  /** The translated-question leg's translator (S03.05); absent or null switches the leg off (`translated_leg` is then `not_needed`). */
  translator?: QuestionTranslator | null;
  /** Told when a search fails with `search_unavailable` (the app writes the ops event; directory may not import ops). A failure here changes nothing. */
  onFailure?: (note: SearchFailureNote) => Promise<void>;
  /** What the embedding is counted under in spend_event: `search` (default), or `test_set` for the test-set runner. */
  spendPurpose?: SpendPurpose;
  /** Whether each search writes a `search_log` row (default true); the test-set runner's questions are not residents' searches. */
  log?: boolean;
  /** Handed the writes still pending when the response is ready, so the app can finish them after the response (`after()`). */
  defer?: (work: Promise<unknown>) => void;
  /**
   * Told what each search that answered (`ok` or `no_clear_match`) saw, just before the answer is returned (S03.07's runner
   * measures the threshold from it). It must return at once, holds no question, and a failure in it changes nothing.
   */
  observe?: (seen: SearchObservation) => void;
  /**
   * Told of each spend row once it is written (after the write, which the response waits for only within its budget). It must
   * return at once: what it starts (the app counts a model's month against its limit) runs after the response, never in it.
   */
  onSpendWritten?: (event: SpendEventInput) => void;
  /** The least time (ms) left of the leg's budget for the fallback translation to be tried (SEARCH_FALLBACK_MIN_BUDGET_MS); default 800. */
  fallbackMinBudgetMs?: number;
  /**
   * The emergency-only threshold (SEARCH_EMERGENCY_THRESHOLD, owner decision 41); default 0.25. Never used above the
   * release's own threshold.
   */
  emergencyThreshold?: number;
  /** Test seams. */
  snapshotFailureTtlMs?: number;
  snapshotLoadTimeoutMs?: number;
  /**
   * Where a cold instance reads the release's files from before it asks the store (Vercel Data Cache in the app). Every byte it gives
   * back is checked against the release record's sha256 like a download; a cache that fails or gives wrong bytes is bypassed, so it
   * can slow nothing down and serve nothing stale or wrong. Absent: the store is read directly.
   */
  fileCache?: ReleaseFileCache;
  /** Test seam: how long one cache read (a miss includes its store download) may take before the store is read directly. */
  fileCacheTimeoutMs?: number;
  /** Takes the request snapshot instead of the database and the store (a unit test of the legs and their timing). */
  snapshot?: () => Promise<SearchSnapshot>;
  /** Keeps the rows instead of writing them to the database. */
  writer?: SearchWriter;
  legTimeoutMs?: number;
  totalBudgetMs?: number;
  /** A monotonic clock in milliseconds. */
  clock?: () => number;
}

export interface SearchService {
  /**
   * Answers one question with `SearchV1`; throws SearchFailure (`invalid_*` before any model is called, `search_unavailable` when no leg completed).
   * `startedAt` is when the request started on this service's clock (the route takes it first thing); left out, now.
   */
  search(input: { q: string; lang: LangCode; v?: number }, startedAt?: number, timings?: PhaseTimings): Promise<SearchV1>;
  /**
   * Starts, ahead of `search` and for the same `startedAt`, the read of the current release and (on an instance that has not
   * loaded a release yet) the load of its data, so that the caller's own waits (the rate limiter) run beside it instead of in
   * front of it. It calls no model, never throws, and does nothing on an instance that already holds a release's data.
   * `search` joins what it started; a `search` with another `startedAt` reads for itself.
   */
  warm?(startedAt: number): void;
  /** Whether the current release holds the provider (the test-set runner reports expected providers a release lacks). Throws when the release has no search data. */
  has(providerId: string): Promise<boolean>;
}

/** A stage of the leg failed: carried to the failure note as a code. */
class StageError extends Error {
  /** Safe classification of what failed (see classifyError); `timed_out` for a stage that ran out of time. */
  readonly detail: string | undefined;
  /** `repeat`: the same failure as one already reported a moment ago, so it is not reported again. */
  constructor(
    readonly reason: SearchStageReason,
    readonly repeat = false,
    detail?: string,
  ) {
    super(reason);
    this.detail = detail ?? (reason === "timed_out" ? TIMED_OUT : undefined);
  }
}

/**
 * The translated leg's translation did not give an English text: the vendor failed (`translate_failed`, told to ops), the
 * answer was not usable (`translate_rejected`: not English, an answer instead of a translation), or it was the question
 * itself, already English (`translate_identical`: the leg was not needed).
 */
class TranslateStageError extends Error {
  constructor(
    readonly reason: "translate_failed" | "translate_rejected" | "translate_identical",
    /** Safe classification of the translation call that failed (see classifyTranslation). */
    readonly detail?: string,
  ) {
    super(reason);
  }
}

/** A release's search data failed to load a moment ago. */
class RecentSnapshotFailure extends Error {}

/** What a snapshot read noticed on the way, for the request that waits for it: the release it found, and whether its data was being loaded from the store. */
interface SnapshotProbe {
  release: number | null;
  cold: boolean;
  /** Set once the data is in memory, when every file of a load came from the shared cache and none from the store: `snapshot` is then flagged `cache`, not `cold`. */
  cached: boolean;
  /** When the read settled (on the service's clock), whichever way; null while it runs. A request that comes to wait for it later still reports how long it took. */
  settledAt: number | null;
}

interface CurrentRelease {
  number: number;
  search: ReleaseSearchRecord | null;
  files: Record<string, { path: string; sha256: string }>;
}

/**
 * The current release. With `timeoutMs` (a search: the time left to its deadline) the read is one short transaction whose
 * statement timeout is that time, so a read the database cannot answer (a lock held on the table, a stuck backend) is
 * stopped by the database at the request's deadline and gives its connection back, instead of holding it after the request
 * stopped waiting. (The pooler hands each transaction to any server connection, so the setting is `set local`.)
 */
async function readCurrent(db: Db, timeoutMs?: number): Promise<CurrentRelease | null> {
  const select = (executor: DbExecutor) =>
    executor
      .select({ number: directoryRelease.number, search: directoryRelease.search, files: directoryRelease.files })
      .from(directoryRelease)
      .where(and(eq(directoryRelease.isCurrent, true), eq(directoryRelease.status, "complete")));
  const rows =
    timeoutMs === undefined
      ? await select(db)
      : await db.transaction(async (tx) => {
          // An integer computed here, not input.
          await tx.execute(sql.raw(`set local statement_timeout = ${Math.max(1, Math.ceil(timeoutMs))}`));
          return select(tx);
        });
  const [row] = rows;
  if (!row) return null;
  const record = ReleaseSearchRecordSchema.safeParse(row.search);
  return { number: row.number, search: record.success ? record.data : null, files: row.files as CurrentRelease["files"] };
}

/**
 * The current release's number and the embedding model and threshold its search data recorded, read the way a search reads
 * it; null when there is no current release or it has no search data. The test-set runner reports which release, model and
 * threshold it measured before it asks the first question.
 */
export async function currentSearchFacts(db: Db, timeoutMs = 5_000): Promise<{ release: number; model: string; threshold: number } | null> {
  const current = await readCurrent(db, timeoutMs);
  return current?.search ? { release: current.number, model: current.search.embed_model, threshold: current.search.threshold } : null;
}

interface LoadedVectors {
  ids: string[];
  vectors: ArrayLike<number>[];
}

async function readVectors(storage: DirectoryStorage, release: CurrentRelease, record: ReleaseSearchRecord): Promise<LoadedVectors> {
  const binary = record.binary;
  if (binary && storage.getBytes) {
    const bytesRead = storage.getBytes(binary.path);
    bytesRead.catch(() => undefined);
    // The JSON file is only downloaded when the binary turns out to be missing: start nothing else for it here.
    const bytes = await bytesRead;
    if (bytes !== null) {
      if (sha256HexBytes(bytes) !== binary.sha256) throw new SafeDetailError("vectors_hash");
      let decoded: ReturnType<typeof decodeVectorsBinary>;
      try {
        decoded = decodeVectorsBinary(bytes, sha256HexBytes);
      } catch (error) {
        throw new SafeDetailError(error instanceof VectorsBinaryError ? `vectors_schema:binary_${error.message}` : "vectors_schema:binary");
      }
      const { header } = decoded;
      if (header.release_v !== release.number || header.embed_model !== record.embed_model || header.dims !== record.dims) throw new SafeDetailError("vectors_release");
      return { ids: header.ids, vectors: decoded.vectors };
    }
  }
  const vectorsBody = await storage.get(record.vectors_path);
  if (vectorsBody === null) throw new SafeDetailError("vectors_missing");
  if (sha256Hex(vectorsBody) !== record.sha256) throw new SafeDetailError("vectors_hash");
  const vectorsParsed = VectorsFileSchema.safeParse(JSON.parse(vectorsBody));
  if (!vectorsParsed.success) throw new SafeDetailError(schemaFailure("vectors_schema", vectorsParsed.error.issues));
  const vectors = vectorsParsed.data;
  if (vectors.release_v !== release.number || vectors.embed_model !== record.embed_model || vectors.dims !== record.dims) throw new SafeDetailError("vectors_release");
  return { ids: vectors.providers.map((p) => p.id), vectors: vectors.providers.map((p) => p.vector) };
}

/** How many of a load's file reads went to the store (a miss, a bypass or no cache) and how many were served by the shared cache. */
interface LoadReads {
  store: number;
  cache: number;
}

/** A cache read slower than this is given up on and the store is read directly. */
const FILE_CACHE_TIMEOUT_MS = 2_000;

/**
 * The store as one release's load reads it, through the shared cache for the files the release record names (each with the sha256
 * it must have). The cache only ever supplies bytes that hash to that sha256: a miss loads from the store and refuses to keep
 * anything else, a hit is checked again here, and a cache that fails or answers wrongly is bypassed with a direct read, so the
 * checks of the load (and their error codes) see the store's own bytes in every fault.
 */
function throughCache(storage: DirectoryStorage, cache: ReleaseFileCache, release: CurrentRelease, record: ReleaseSearchRecord, reads: LoadReads, cacheReadTimeoutMs: number): DirectoryStorage {
  const hashes = new Map<string, string>();
  for (const entry of Object.values(release.files)) hashes.set(entry.path, entry.sha256);
  hashes.set(record.vectors_path, record.sha256);
  if (record.binary) hashes.set(record.binary.path, record.binary.sha256);
  const encoder = new TextEncoder();

  async function viaCache(file: string, direct: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const sha256 = hashes.get(file);
    if (sha256 === undefined) {
      reads.store += 1;
      return direct();
    }
    let loaded = false;
    let fetched: { body: Uint8Array | null } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = cache.read({ release: release.number, path: file, sha256 }, async () => {
        loaded = true;
        const body = await direct();
        fetched = { body };
        if (body === null || sha256HexBytes(body) !== sha256) throw new SafeDetailError("not_cacheable");
        return body;
      });
      read.catch(() => undefined);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cache_timeout")), cacheReadTimeoutMs);
      });
      const bytes = await Promise.race([read, timeout]);
      if (sha256HexBytes(bytes) === sha256) {
        if (loaded) reads.store += 1;
        else reads.cache += 1;
        return bytes;
      }
    } catch {
      // The cache failed, was too slow, or the store had nothing good: use the store's bytes, below.
    } finally {
      clearTimeout(timer);
    }
    reads.store += 1;
    // The store was already read for the cache's miss: use those bytes (the load checks them and gives its own error code) rather than download again.
    if (fetched) return (fetched as { body: Uint8Array | null }).body;
    return direct();
  }

  return {
    put: storage.put.bind(storage),
    // A text file is cached as its UTF-8 bytes, which are the bytes its sha256 was taken over.
    async get(file) {
      const bytes = await viaCache(file, async () => {
        const body = await storage.get(file);
        return body === null ? null : encoder.encode(body);
      });
      return bytes === null ? null : new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    },
    ...(storage.getBytes ? { getBytes: (file: string) => viaCache(file, () => storage.getBytes!(file)) } : {}),
  };
}

async function loadReleaseData(storage: DirectoryStorage, release: CurrentRelease, record: ReleaseSearchRecord): Promise<SnapshotData> {
  // The English listing is downloaded beside the vectors (and while they are hashed and parsed); what is checked, and the order
  // the faults are told in, are as if it were read after them.
  // The compact binary file is read where the release has one and the store can read bytes; a release published before it (or whose
  // binary is not there) uses the JSON file, with the same checks and the same error codes.
  const vectorsRead = readVectors(storage, release, record);
  vectorsRead.catch(() => undefined);
  const entry = release.files.en;
  const listingRead = entry ? storage.get(entry.path) : Promise.resolve(null);
  listingRead.catch(() => undefined);
  const vectors = await vectorsRead;

  // Which providers are emergency results: the English listing of the same release names each provider's categories.
  const listingBody = await listingRead;
  if (!entry || listingBody === null) throw new SafeDetailError("listing_missing");
  if (sha256Hex(listingBody) !== entry.sha256) throw new SafeDetailError("listing_hash");
  const listingParsed = DirectoryListingV1.safeParse(JSON.parse(listingBody));
  if (!listingParsed.success) throw new SafeDetailError(schemaFailure("listing_schema", listingParsed.error.issues));
  const listing = listingParsed.data;
  const emergencyNames = new Set(record.emergency_categories);
  const emergencyCategoryIds = new Set(listing.categories.filter((c) => emergencyNames.has(c.name.body)).map((c) => c.id));
  const emergency = new Set(listing.providers.filter((p) => p.category_ids.some((id) => emergencyCategoryIds.has(id))).map((p) => p.id));

  return {
    releaseV: release.number,
    model: record.embed_model,
    dims: record.embed_config.dims,
    threshold: record.threshold,
    ids: vectors.ids,
    vectors: vectors.vectors,
    known: new Set(vectors.ids),
    emergency,
  };
}

/** The result of `work`, or "timeout" when it has not settled after `ms`. */
async function raceTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          onTimeout();
          resolve("timeout");
        }, Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** `work`, or a rejection when it has not settled after `ms` (what it does after that is ignored). */
function capped<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SafeDetailError(TIMED_OUT)), Math.max(0, ms));
  });
  work.catch(() => undefined);
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** Which questions also search through English (the E03 definitions): Pashto, Dari, native-script Urdu, romanized or mixed (unless plainly English), ambiguous Arabic script. */
export function questionSourceOf(detected: QuestionLanguage, q?: string): QuestionSource | null {
  // A short English word eld cannot tell from a Latin launch language ("lawyer", "rent") needs no translation to English.
  if (detected.confidence === "romanized_or_mixed") return q !== undefined && isClearlyEnglish(q) ? null : detected.confidence;
  if (detected.confidence === "ambiguous_arabic") return detected.confidence;
  if (detected.confidence === "confident" && (detected.lang === "ps" || detected.lang === "prs" || detected.lang === "ur")) return detected.lang;
  return null;
}

/**
 * The kind of translation a question would need, or null when it needs none: the rule `search` applies, on the request as
 * `search` reads it. The test-set runner uses it to count the vendor calls a run will make before it makes any.
 */
export function questionLegSource(input: { q: string; lang: LangCode }): QuestionSource | null {
  const parsed = parseSearchRequest(input);
  return parsed.ok ? questionSourceOf(detect(parsed.value.q, parsed.value.lang), parsed.value.q) : null;
}

/** How a leg ended: its similarities, or why it has none. */
type LegOutcome = { ok: true; similarities: Map<string, number> } | { ok: false; reason: SearchStageReason | "translate_failed" | "translate_rejected" | "translate_identical"; /** Safe classification of what failed. */ detail?: string };

/** One paid call of a leg, until its usage is known (reported, estimated, or nothing when it failed before the vendor answered). */
interface PaidCall {
  kind: "embed" | "translate";
  model: string;
  /** Only for estimating tokens; never written anywhere. */
  text: string;
  /** The instructions sent with `text` (a translation's system prompt; no question in it), for the same estimate. */
  system: string;
  started: number;
  settled: boolean;
}

export function createSearch(deps: SearchDeps): SearchService {
  const clock = deps.clock ?? (() => performance.now());
  const legMs = deps.legTimeoutMs ?? DEFAULT_LEG_TIMEOUT_MS;
  const totalMs = deps.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const spendPurpose = deps.spendPurpose ?? SEARCH_SPEND_PURPOSE;
  const writeLog = deps.log ?? true;
  const failureTtlMs = deps.snapshotFailureTtlMs ?? SNAPSHOT_FAILURE_TTL_MS;
  const loadTimeoutMs = deps.snapshotLoadTimeoutMs ?? SNAPSHOT_LOAD_TIMEOUT_MS;
  const fallbackMinBudgetMs = deps.fallbackMinBudgetMs ?? DEFAULT_FALLBACK_MIN_BUDGET_MS;
  const writer: SearchWriter = deps.writer ?? {
    log: async (row) => {
      await deps.db().insert(searchLog).values(row);
    },
    spend: (event) => recordSpendEvent(deps.db(), event),
  };
  // Releases whose data failed to load, until when: a bad release is not downloaded again on every search.
  const failedUntil = new Map<number, number>();
  // Vendor failures already told to ops (by reason and model), until when: the same failure of the same model is not reported
  // again for the same TTL, while another model's failure (the fallback's, say) is its own.
  const reportedUntil = new Map<string, number>();
  // The vectors of the newest releases, kept in memory: a release's files never change (a trigger refuses it). The entry of a
  // release is its load while it runs: the searches that come meanwhile join it rather than download the files again.
  const cache = new Map<number, Promise<SnapshotData>>();
  // The loads from the store that are still running: a request that finds its release's data here (it started the load, or
  // joined it) waited for the store, which the `snapshot` timing says as `cold`.
  const loading = new WeakSet<Promise<SnapshotData>>();
  // Where each running or finished load read its files from (the shared cache or the store).
  const readsOf = new WeakMap<Promise<SnapshotData>, LoadReads>();
  // What `warm` started for a request: that request's `search` takes it (once) instead of reading again.
  let warmed: { startedAt: number; at: number; reading: Promise<SearchSnapshot>; probe: SnapshotProbe } | undefined;

  function dataOf(release: CurrentRelease, record: ReleaseSearchRecord): Promise<SnapshotData> {
    let loaded = cache.get(release.number);
    if (!loaded) {
      const until = failedUntil.get(release.number);
      if (until !== undefined && clock() < until) return Promise.reject(new RecentSnapshotFailure());
      failedUntil.delete(release.number);
      const reads: LoadReads = { store: 0, cache: 0 };
      const source = deps.fileCache ? throughCache(deps.storage(), deps.fileCache, release, record, reads, deps.fileCacheTimeoutMs ?? FILE_CACHE_TIMEOUT_MS) : deps.storage();
      if (!deps.fileCache) reads.store = 1;
      loaded = capped(loadReleaseData(source, release, record), loadTimeoutMs);
      cache.set(release.number, loaded);
      const load = loaded;
      readsOf.set(load, reads);
      loading.add(load);
      const settled = () => loading.delete(load);
      load.then(settled, settled);
      const number = release.number;
      loaded.catch(() => {
        cache.delete(number);
        failedUntil.set(number, clock() + failureTtlMs);
      });
      for (const number of [...cache.keys()]) if (number < release.number - 1) cache.delete(number);
    }
    return loaded;
  }

  /**
   * The request snapshot: the current release, and its search data where it has some and a key is configured. `deadline`
   * is the request's own (absolute, on this service's clock): the database read is stopped by the database then, and the
   * caller stops waiting for the whole read then, whether this request started the load of the release's data or joined
   * one; a joined load runs on for the searches after it.
   */
  async function readSnapshot(deadline: number, probe: SnapshotProbe): Promise<SearchSnapshot> {
    if (deps.snapshot) return deps.snapshot();
    const left = deadline - clock();
    if (left <= 0) throw new StageError("timed_out");
    try {
      const current = await readCurrent(deps.db(), left);
      if (!current) return { releaseV: null, data: null };
      probe.release = current.number;
      if (!current.search || !deps.embedder) return { releaseV: current.number, data: null };
      const data = dataOf(current, current.search);
      const waited = loading.has(data);
      if (waited) probe.cold = true;
      const ready = await data;
      // `cold` is the store's download; a load served whole by the shared cache says `cache`.
      if (waited && deps.fileCache) {
        const reads = readsOf.get(data);
        if (reads && reads.store === 0 && reads.cache > 0) probe.cached = true;
      }
      return { releaseV: current.number, data: ready };
    } catch (error) {
      throw new StageError("snapshot_failed", error instanceof RecentSnapshotFailure, classifyError(error));
    } finally {
      probe.settledAt = clock();
    }
  }

  function warm(startedAt: number): void {
    // A test's snapshot, no key (every search answers `unavailable`), or a release's data already held or loading: nothing to start.
    if (deps.snapshot || !deps.embedder || cache.size > 0) return;
    try {
      const probe: SnapshotProbe = { release: null, cold: false, cached: false, settledAt: null };
      const reading = readSnapshot(startedAt + legMs, probe);
      // Nobody may be waiting for it (the count refused): that is not unhandled.
      reading.catch(() => undefined);
      warmed = { startedAt, at: clock(), reading, probe };
    } catch {
      // The search reads for itself and meets the same failure.
    }
  }

  async function search(input: { q: string; lang: LangCode; v?: number }, startedAt?: number, timings?: PhaseTimings): Promise<SearchV1> {
    const started = startedAt ?? clock();
    const elapsed = () => Math.round(clock() - started);
    const parsed = parseSearchRequest(input);
    if (!parsed.ok) throw new SearchFailure(parsed.code);
    const { q, lang } = parsed.value;
    const detected = detect(q, lang);
    const queryLang = detected.query_lang;
    // The request's deadline, absolute on this service's clock: every leg is cancelled, and its result ignored, at this
    // moment (2.2 s after the request started), and the snapshot read (the database read and the release's data, loaded or
    // joined) is given up then too.
    const deadline = started + legMs;
    // The writes are waited for until this moment at the latest (2.4 s): the answer then still beats the route's hard deadline.
    const answerBy = started + totalMs - ANSWER_MARGIN_MS;
    let releaseV: number | null = null;

    // The writes of this request (spend_event, search_log, the failure note). One that only becomes known after the
    // response was decided (a call that settles late) is handed straight to `defer`.
    const writes: Promise<unknown>[] = [];
    let closed = false;
    const track = (work: () => Promise<unknown>) => {
      const write = Promise.resolve().then(work).catch(() => undefined);
      if (closed) deps.defer?.(write);
      else writes.push(write);
    };
    // Waits for the writes until `answerBy`; those still pending then are handed to the app to finish after the response.
    const finish = async () => {
      closed = true;
      const all = Promise.allSettled(writes);
      await Promise.race([all, sleep(answerBy - clock())]);
      deps.defer?.(all);
    };
    const log = (row: { status: "ok" | "no_clear_match" | "unavailable" | "error"; resultCount: number; topScore: number | null; translatedLeg: TranslatedLeg }) => {
      if (!writeLog) return;
      const at = { lang, queryLang, releaseV, ms: elapsed(), ...row };
      track(() => writer.log(at));
    };

    // ---- which legs the question needs. A question that needs the translated leg starts its translation now, at the
    // start of the request, in parallel with the snapshot read: only the embedding of the translation waits for the snapshot.
    // (Without an embedding key every search answers `unavailable`, so no translation is started either.)
    const translator = deps.embedder ? (deps.translator ?? null) : null;
    const source = translator ? questionSourceOf(detected, q) : null;
    const translateModel = source && translator ? translator.modelFor(source) : null;
    const translating = source !== null && translateModel !== null && translator !== null;

    // ---- the request snapshot (read in parallel with the translation)
    const state: { snapshot: SearchSnapshot | null; failure: SearchStageReason | null; repeat: boolean; detail: string | undefined } = { snapshot: null, failure: null, repeat: false, detail: undefined };
    const early = warmed !== undefined && warmed.startedAt === started ? warmed : undefined;
    if (early) warmed = undefined;
    const probe: SnapshotProbe = early?.probe ?? { release: null, cold: false, cached: false, settledAt: null };
    const snapshotFrom = early?.at ?? clock();
    const reading = early?.reading ?? readSnapshot(deadline, probe);
    // An abandoned read may still reject after the deadline: that is not unhandled.
    reading.catch(() => undefined);
    // Settles (never rejects) when the snapshot is known, failed, or out of time: what a write that needs the release number waits for.
    const snapshotKnown: Promise<void> = (async () => {
      try {
        const raced = await raceTimeout(reading, deadline - clock(), () => undefined);
        if (raced === "timeout") {
          state.failure = "timed_out";
          state.detail = TIMED_OUT;
        } else state.snapshot = raced;
      } catch (error) {
        state.failure = error instanceof StageError ? error.reason : "snapshot_failed";
        state.repeat = error instanceof StageError && error.repeat;
        state.detail = error instanceof StageError ? error.detail : classifyError(error);
      }
      if (probe.release !== null) releaseV = probe.release;
      if (state.snapshot) releaseV = state.snapshot.releaseV;
      timings?.record("snapshot", (probe.settledAt ?? clock()) - snapshotFrom, probe.cold ? (probe.cached ? "cache" : "cold") : undefined);
    })();

    const fail = async (reason: SearchStageReason, translatedLeg: TranslatedLeg, quiet = false, detail?: string): Promise<never> => {
      log({ status: "error", resultCount: 0, topScore: null, translatedLeg });
      const releaseAtFailure = releaseV;
      if (!quiet) {
        const ms = elapsed();
        // One line for the platform's function logs: the safe fields only.
        console.error(`search.failed reason=${reason} code=${detail ?? "none"} ms=${ms}`);
        if (deps.onFailure) track(() => deps.onFailure!({ reason, releaseV: releaseAtFailure, ms, ...(detail === undefined ? {} : { error: detail }) }));
      }
      await finish();
      throw new SearchFailure("search_unavailable");
    };

    /**
     * A vendor failure that did not make the search fail (the other leg answered) is still told to ops, once a minute per
     * kind: a model that is down would otherwise be invisible behind the leg that works.
     */
    const reportVendorFailure = (reason: SearchLegFailureReason, model?: string, error?: string) => {
      const now = clock();
      const key = `${reason}:${model ?? ""}`;
      const until = reportedUntil.get(key);
      if (until !== undefined && now < until) return;
      reportedUntil.set(key, now + failureTtlMs);
      if (!deps.onFailure) return;
      const at = { reason, releaseV, ms: elapsed(), answered: true as const, ...(model === undefined ? {} : { model }), ...(error === undefined ? {} : { error }) };
      track(() => deps.onFailure!(at));
    };

    // ---- the legs: each paid call's usage is recorded once, as the vendor reported it, or estimated when it was cancelled.
    // The release number is read when the row is written (a translation can settle before the snapshot is known).
    const settle = (call: PaidCall, tokens: number | null | "estimate" | "none") => {
      if (call.settled) return;
      call.settled = true;
      if (tokens === "none") return;
      const estimated = tokens === "estimate" || tokens === null;
      const count = estimated ? (call.kind === "embed" ? estimateTokens([call.text]) : estimateTranslationTokens(call.text, call.system)) : tokens;
      const ms = Math.round(clock() - call.started);
      track(async () => {
        await snapshotKnown;
        const event: SpendEventInput =
          call.kind === "embed"
            ? { kind: SEARCH_SPEND_KIND, purpose: spendPurpose, model: call.model, releaseV, tokens: count, tokensEstimated: estimated, ms }
            : questionTranslationSpend({ purpose: spendPurpose, model: call.model, releaseV, tokens: count, tokensEstimated: estimated, ms });
        await writer.spend(event);
        deps.onSpendWritten?.(event);
      });
    };

    interface Leg {
      signal: AbortSignal;
      start(kind: PaidCall["kind"], model: string, text: string, system?: string): PaidCall;
    }

    /**
     * Runs a leg until it completes or the deadline; at the deadline its calls are cancelled (and counted) and its result is
     * never used. `cancel` stops it early (the snapshot failed, or the release has no search data) and counts what it started.
     */
    const startLeg = (phase: TimingPhase, work: (leg: Leg) => Promise<Map<string, number>>): { done: Promise<LegOutcome>; cancel: () => void } => {
      const legStarted = clock();
      const controller = new AbortController();
      const calls: PaidCall[] = [];
      const leg: Leg = {
        signal: controller.signal,
        start(kind, model, text, system = "") {
          const call: PaidCall = { kind, model, text, system, started: clock(), settled: false };
          calls.push(call);
          return call;
        },
      };
      const cancel = () => {
        // A cancelled call may still have been billed: it is counted, as an estimate, before it is aborted.
        for (const call of calls) settle(call, "estimate");
        controller.abort();
      };
      const running = Promise.resolve().then(() => work(leg));
      running.catch(() => undefined);
      const done = (async (): Promise<LegOutcome> => {
        try {
          const raced = await raceTimeout(running, deadline - clock(), cancel);
          return raced === "timeout" ? { ok: false, reason: "timed_out", detail: TIMED_OUT } : { ok: true, similarities: raced };
        } catch (error) {
          if (error instanceof StageError) return { ok: false, reason: error.reason, ...(error.detail === undefined ? {} : { detail: error.detail }) };
          if (error instanceof TranslateStageError) return { ok: false, reason: error.reason, ...(error.detail === undefined ? {} : { detail: error.detail }) };
          return { ok: false, reason: "embed_failed", detail: classifyEmbedding(error) };
        } finally {
          timings?.record(phase, clock() - legStarted);
        }
      })();
      return { done, cancel };
    };

    /** The budget is already spent (a slow body, limiter or snapshot): no call is made, and none is billed. */
    const checkTime = (leg: Leg) => {
      // The clock is read here, not only the abort: the timer that aborts may not have run yet.
      if (leg.signal.aborted || clock() >= deadline) throw new StageError("timed_out");
    };

    const embedAndCompare = async (leg: Leg, data: SnapshotData, embedder: QueryEmbedder, text: string): Promise<Map<string, number>> => {
      checkTime(leg);
      const call = leg.start("embed", data.model, text);
      let embedded;
      try {
        embedded = await embedder.embedQuery({ text, model: data.model, dims: data.dims, signal: leg.signal });
      } catch (error) {
        settle(call, leg.signal.aborted ? "estimate" : "none");
        throw leg.signal.aborted ? new StageError("timed_out") : new StageError("embed_failed", false, classifyEmbedding(error));
      }
      // An answer that is not a vector of the release's size was still billed.
      settle(call, typeof embedded?.tokens === "number" ? embedded.tokens : null);
      const size = data.vectors[0]?.length;
      const vector: unknown = embedded?.vector;
      if (!Array.isArray(vector) || vector.length === 0 || (size !== undefined && vector.length !== size)) throw new StageError("embed_invalid");
      const similarities = new Map<string, number>();
      data.ids.forEach((id, index) => similarities.set(id, cosine(vector as number[], data.vectors[index]!)));
      return similarities;
    };

    // What the translation told ops, with the model it concerned: `translate_quota` for a model past its limit, `translate_failed`
    // for any other vendor failure, `translate_fallback_used` when the fallback made the translation.
    const translateNotes: { reason: SearchLegFailureReason; model: string; error?: string }[] = [];
    const noteFailure = (error: unknown, model: string) => {
      translateNotes.push({ reason: error instanceof QuestionTranslationError && error.vendor === "quota" ? "translate_quota" : "translate_failed", model, error: classifyTranslation(error) });
    };

    const translatedRun = translating
      ? startLeg("translate", async (leg) => {
          checkTime(leg);
          /** One translation call with `model`: its usage is recorded as the vendor reported it (a call that failed at the vendor wrote none). */
          const translateWith = async (model: string): Promise<string> => {
            const call = leg.start("translate", model, q, systemPrompt(sourceLanguage(source), "en"));
            try {
              const translated = await translator.toEnglish({ text: q, source, signal: leg.signal, model });
              settle(call, translated.tokens);
              return translated.english;
            } catch (error) {
              // A model that answered was billed, whether or not its answer is used.
              if (error instanceof QuestionTranslationError && error.billedTokens !== undefined) settle(call, error.billedTokens);
              else settle(call, leg.signal.aborted ? "estimate" : "none");
              throw error;
            }
          };
          /**
           * The stage error of a call that did not give an English text. When that is `translate_failed` (the vendor failed, or
           * something unexpected did: an adapter that says `aborted` while the signal did not, an exception of our own) ops is
           * told, with the model, as it always was.
           */
          const stageError = (error: unknown, model: string): Error => {
            if (leg.signal.aborted) return new StageError("timed_out");
            if (error instanceof QuestionTranslationError && error.code === "identical") return new TranslateStageError("translate_identical");
            // The vendor failed (or answered nothing we can tell apart from that), as opposed to answering with something unusable.
            const rejected = error instanceof QuestionTranslationError && error.code !== "translate_failed" && error.code !== "aborted";
            if (!rejected) noteFailure(error, model);
            return new TranslateStageError(rejected ? "translate_rejected" : "translate_failed", classifyTranslation(error));
          };

          let english: string;
          let rescuedBy: string | null = null;
          try {
            english = await translateWith(translateModel);
          } catch (error) {
            if (leg.signal.aborted) throw new StageError("timed_out");
            const vendor = error instanceof QuestionTranslationError && error.code === "translate_failed" ? error.vendor : undefined;
            const fallback = vendor !== undefined && isLimitFailure(vendor) ? translator.fallbackFor(source, translateModel) : null;
            // Past its limit (or limited for a moment): one retry with the fallback model for this kind of question, with the same
            // signal and deadline, when there is one, it is a different model and there is time for it to answer.
            if (fallback === null || deadline - clock() < fallbackMinBudgetMs) throw stageError(error, translateModel);
            // A quota is told before the retry, not after it: the retry may be cut at the deadline, and the leg is then not waited for
            // (what a rejection chain adds after that comes too late). The routed model needs someone's attention whatever the fallback does.
            if (vendor === "quota") noteFailure(error, translateModel);
            try {
              english = await translateWith(fallback);
              rescuedBy = fallback;
            } catch (second) {
              // A transient limit is told only if the fallback failed too (when it answered, the rescue is all ops hears).
              if (vendor !== "quota") noteFailure(error, translateModel);
              if (leg.signal.aborted) throw new StageError("timed_out");
              throw stageError(second, fallback);
            }
          }
          // Only the embedding of the translation needs the snapshot.
          await snapshotKnown;
          const known = state.snapshot;
          if (!known?.data || !deps.embedder) throw new StageError("snapshot_failed");
          const similarities = await embedAndCompare(leg, known.data, deps.embedder, english);
          // The fallback rescued the question only if the leg completed with its translation: not when the embedding failed or was cut at the deadline.
          if (rescuedBy !== null && !leg.signal.aborted) translateNotes.push({ reason: "translate_fallback_used", model: rescuedBy });
          return similarities;
        })
      : null;

    await snapshotKnown;

    const { snapshot, failure: snapshotFailure, repeat } = state;
    if (snapshotFailure !== null || snapshot === null) {
      // No leg ran. A question that needed the translated leg did not get it.
      translatedRun?.cancel();
      const leg: TranslatedLeg = !translating ? "not_needed" : snapshotFailure === "timed_out" ? "timed_out" : "failed";
      return fail(snapshotFailure ?? "snapshot_failed", leg, repeat, state.detail);
    }
    const ready = snapshot;
    // No release, a release without search data, or no key: an expected outcome, and no model is called.
    const embedder = deps.embedder;
    if (!ready.data || !embedder) {
      translatedRun?.cancel();
      log({ status: "unavailable", resultCount: 0, topScore: null, translatedLeg: "not_needed" });
      await finish();
      return { v: 1, release_v: ready.releaseV ?? 0, query_lang: queryLang, status: "unavailable", emergency_first: false, results: [] };
    }
    const data = ready.data;

    const directRun = startLeg("embed", (leg) => embedAndCompare(leg, data, embedder, q));
    const [direct, translated] = await Promise.all([directRun.done, translatedRun ? translatedRun.done : Promise.resolve(null)]);

    const translatedOutcome: TranslatedLeg =
      translated === null || (!translated.ok && translated.reason === "translate_identical") ? "not_needed" : translated.ok ? "used" : translated.reason === "timed_out" ? "timed_out" : "failed";
    const completed = [direct, translated].flatMap((leg) => (leg?.ok ? [leg.similarities] : []));

    // Vendor failures are told to ops even when the other leg answered (or, when none did, besides the reason below).
    const vendor: { reason: SearchLegFailureReason; model?: string; error?: string }[] = translateNotes.map((n) => ({ ...n }));
    for (const leg of [direct, translated]) if (leg && !leg.ok && leg.reason === "embed_failed") vendor.push({ reason: "embed_failed", ...(leg.detail === undefined ? {} : { error: leg.detail }) });

    if (completed.length === 0) {
      const primary = (direct.ok ? "embed_failed" : direct.reason) as SearchStageReason;
      for (const note of vendor) if (note.reason !== primary) reportVendorFailure(note.reason, note.model, note.error);
      return fail(primary, translatedOutcome, false, direct.ok ? undefined : direct.detail);
    }
    for (const note of vendor) reportVendorFailure(note.reason, note.model, note.error);

    // The ranking sequence over the legs that completed: threshold first, then RRF when there are two.
    const rankStarted = clock();
    const results = rankLegs(completed, data.threshold);
    const status = results.length === 0 ? "no_clear_match" : "ok";
    // The emergency fail-safe (owner decision 41) can only turn the flag on: an emergency provider among the top 3 of either
    // leg at the emergency-only threshold sets it, even with no clear match (the results then stay empty).
    const emergencyThreshold = Math.min(deps.emergencyThreshold ?? DEFAULT_EMERGENCY_THRESHOLD, data.threshold);
    const emergency = emergencyFirst(results, data.emergency) || emergencyInTop(completed, data.emergency, emergencyThreshold);
    timings?.record("rank", clock() - rankStarted);
    log({ status, resultCount: results.length, topScore: results[0]?.score ?? null, translatedLeg: translatedOutcome });
    if (deps.observe) {
      const legs: SearchObservation["legs"] = [];
      if (direct.ok) legs.push({ leg: "direct", similarities: direct.similarities });
      if (translated?.ok) legs.push({ leg: "translated", similarities: translated.similarities });
      try {
        deps.observe({ releaseV: data.releaseV, threshold: data.threshold, emergencyThreshold: deps.emergencyThreshold ?? DEFAULT_EMERGENCY_THRESHOLD, emergencyProviders: data.emergency, translatedLeg: translatedOutcome, legs });
      } catch {
        // A measurement never changes an answer.
      }
    }
    await finish();
    return { v: 1, release_v: data.releaseV, query_lang: queryLang, status, emergency_first: emergency, results };
  }

  async function has(providerId: string): Promise<boolean> {
    const current = await readCurrent(deps.db());
    if (!current?.search) throw new Error("The current release has no search data");
    return (await dataOf(current, current.search)).known.has(providerId);
  }

  return { search, has, warm };
}
