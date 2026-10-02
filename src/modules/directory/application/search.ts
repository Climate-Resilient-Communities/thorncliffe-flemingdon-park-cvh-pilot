// The search use case (S03.04, FR-D2-Q, AD-11, AD-3): a resident's question in, `SearchV1` out. It is a function of its
// dependencies, not of HTTP: the route handler (src/app/api/search/route.ts) and the search test-set runner
// (scripts/search-test-set) both call `search()`; the runner takes the whole service as its SearchEngine.
//
//  - Request snapshot: at the start of a request the current release is read once (its number, embedding model, vectors,
//    threshold and emergency categories) and only that is used to the end; a release made current meanwhile is for the
//    next search. The vectors of a release are read from the private store once and kept in memory (the release's files
//    never change), checked against the hash the release recorded.
//  - The direct leg embeds the question as typed with the snapshot's model as a query (`input_type: search_query`), then
//    ranks (domain/searchRanking.ts: threshold first, top 5). The translated-question leg arrives with S03.05.
//  - Time: the leg is cancelled and ignored when still running 2.2 s after the request started, and the whole request
//    answers within 2.5 s. "Started" is when the route took the request (it passes that time in), so reading the body and
//    the rate limiter count against the budget. A search with no completed leg fails with `search_unavailable`; a release without search data,
//    or a deployment without an embedding key, answers `status: "unavailable"` (an expected outcome) and calls no model.
//  - No transaction and no spend lock are held across the vendor call: the question's usage is one plain insert in
//    `spend_event` (purpose `search`; `test_set` for the test-set runner, which also writes no `search_log` row) after the call, outside the publish allowance (the lock and the allowance are the
//    publish job's).
//  - Privacy (AD-3): the question is held in this function's variables for the length of the request. It is never
//    stored, logged, audited or put into an error: `search_log` takes counts and codes, ops events take a reason and a
//    duration, and every failure that leaves this function is a SearchFailure holding a code.
import { and, eq } from "drizzle-orm";
import { DirectoryListingV1 } from "@/contracts/directory";
import type { LangCode } from "@/contracts/lang";
import { parseSearchRequest } from "@/contracts/search";
import type { SearchV1 } from "@/contracts/searchTestSet";
import { recordSpendEvent, type SpendPurpose } from "@/modules/spend";
import type { Db } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { directoryRelease, searchLog } from "../adapters/schema";
import { detect } from "../domain/questionLanguage";
import { cosine, emergencyFirst, rankLegs } from "../domain/searchRanking";
import { ReleaseSearchRecordSchema, VectorsFileSchema, estimateTokens, type ReleaseSearchRecord } from "../domain/searchData";
import type { DirectoryStorage, QueryEmbedder } from "./ports";

/** The kind and purpose a question's embedding is counted under in spend_event. */
export const SEARCH_SPEND_KIND = "embed";
export const SEARCH_SPEND_PURPOSE = "search";

/** A release whose search data failed to load is not loaded again (nor alerted again) for this long. */
export const SNAPSHOT_FAILURE_TTL_MS = 60_000;

/** A leg still running this long after the request started is cancelled (the E03 definitions' search time limit). */
export const DEFAULT_LEG_TIMEOUT_MS = 2200;
/** The whole request answers within this long. */
export const DEFAULT_TOTAL_BUDGET_MS = 2500;

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

/** What the app is told when a search could not answer: a reason and a duration, never the question. */
export interface SearchFailureNote {
  reason: SearchStageReason;
  releaseV: number | null;
  ms: number;
}

export interface SearchDeps {
  db: () => Db;
  storage: () => DirectoryStorage;
  /** The question embedder; null where no embedding key is configured (every search then answers `unavailable`). */
  embedder: QueryEmbedder | null;
  /** Told when a search fails with `search_unavailable` (the app writes the ops event; directory may not import ops). A failure here changes nothing. */
  onFailure?: (note: SearchFailureNote) => Promise<void>;
  /** What the embedding is counted under in spend_event: `search` (default), or `test_set` for the test-set runner. */
  spendPurpose?: SpendPurpose;
  /** Whether each search writes a `search_log` row (default true); the test-set runner's questions are not residents' searches. */
  log?: boolean;
  /** Handed the writes still pending when the response is ready, so the app can finish them after the response (`after()`). */
  defer?: (work: Promise<unknown>) => void;
  /** Test seams. */
  snapshotFailureTtlMs?: number;
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
  search(input: { q: string; lang: LangCode; v?: number }, startedAt?: number): Promise<SearchV1>;
  /** Whether the current release holds the provider (the test-set runner reports expected providers a release lacks). Throws when the release has no search data. */
  has(providerId: string): Promise<boolean>;
}

/** What a release's search data makes of it in memory. */
interface ReleaseData {
  releaseV: number;
  model: string;
  dims: number | null;
  threshold: number;
  ids: string[];
  vectors: number[][];
  known: ReadonlySet<string>;
  emergency: ReadonlySet<string>;
}

/** A stage of the leg failed: carried to the failure note as a code. */
class StageError extends Error {
  /** `repeat`: the same failure as one already reported a moment ago, so it is not reported again. */
  constructor(
    readonly reason: SearchStageReason,
    readonly repeat = false,
  ) {
    super(reason);
  }
}

/** A release's search data failed to load a moment ago. */
class RecentSnapshotFailure extends Error {}

interface CurrentRelease {
  number: number;
  search: ReleaseSearchRecord | null;
  files: Record<string, { path: string; sha256: string }>;
}

async function readCurrent(db: Db): Promise<CurrentRelease | null> {
  const [row] = await db
    .select({ number: directoryRelease.number, search: directoryRelease.search, files: directoryRelease.files })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.isCurrent, true), eq(directoryRelease.status, "complete")));
  if (!row) return null;
  const record = ReleaseSearchRecordSchema.safeParse(row.search);
  return { number: row.number, search: record.success ? record.data : null, files: row.files as CurrentRelease["files"] };
}

async function loadReleaseData(storage: DirectoryStorage, release: CurrentRelease, record: ReleaseSearchRecord): Promise<ReleaseData> {
  const vectorsBody = await storage.get(record.vectors_path);
  if (vectorsBody === null || sha256Hex(vectorsBody) !== record.sha256) throw new Error("vectors file is missing or changed");
  const vectors = VectorsFileSchema.parse(JSON.parse(vectorsBody));
  if (vectors.release_v !== release.number || vectors.embed_model !== record.embed_model || vectors.dims !== record.dims) throw new Error("vectors file is not this release's");

  // Which providers are emergency results: the English listing of the same release names each provider's categories.
  const entry = release.files.en;
  const listingBody = entry ? await storage.get(entry.path) : null;
  if (!entry || listingBody === null || sha256Hex(listingBody) !== entry.sha256) throw new Error("listing file is missing or changed");
  const listing = DirectoryListingV1.parse(JSON.parse(listingBody));
  const emergencyNames = new Set(record.emergency_categories);
  const emergencyCategoryIds = new Set(listing.categories.filter((c) => emergencyNames.has(c.name.body)).map((c) => c.id));
  const emergency = new Set(listing.providers.filter((p) => p.category_ids.some((id) => emergencyCategoryIds.has(id))).map((p) => p.id));

  return {
    releaseV: release.number,
    model: record.embed_model,
    dims: record.embed_config.dims,
    threshold: record.threshold,
    ids: vectors.providers.map((p) => p.id),
    vectors: vectors.providers.map((p) => p.vector),
    known: new Set(vectors.providers.map((p) => p.id)),
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

type LegOutcome =
  | { kind: "none"; releaseV: number | null }
  | { kind: "answer"; data: ReleaseData; similarities: Map<string, number>; tokens: number | null; embedMs: number };

export function createSearch(deps: SearchDeps): SearchService {
  const clock = deps.clock ?? (() => performance.now());
  const legMs = deps.legTimeoutMs ?? DEFAULT_LEG_TIMEOUT_MS;
  const totalMs = deps.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
  const spendPurpose = deps.spendPurpose ?? SEARCH_SPEND_PURPOSE;
  const writeLog = deps.log ?? true;
  const failureTtlMs = deps.snapshotFailureTtlMs ?? SNAPSHOT_FAILURE_TTL_MS;
  // Releases whose data failed to load, until when: a bad release is not downloaded again on every search.
  const failedUntil = new Map<number, number>();
  // The vectors of the newest releases, kept in memory: a release's files never change (a trigger refuses it).
  const cache = new Map<number, Promise<ReleaseData>>();

  function dataOf(release: CurrentRelease, record: ReleaseSearchRecord): Promise<ReleaseData> {
    let loaded = cache.get(release.number);
    if (!loaded) {
      const until = failedUntil.get(release.number);
      if (until !== undefined && clock() < until) return Promise.reject(new RecentSnapshotFailure());
      failedUntil.delete(release.number);
      loaded = loadReleaseData(deps.storage(), release, record);
      cache.set(release.number, loaded);
      const number = release.number;
      loaded.catch(() => {
        cache.delete(number);
        failedUntil.set(number, clock() + failureTtlMs);
      });
      for (const number of [...cache.keys()]) if (number < release.number - 1) cache.delete(number);
    }
    return loaded;
  }

  async function search(input: { q: string; lang: LangCode; v?: number }, startedAt?: number): Promise<SearchV1> {
    const started = startedAt ?? clock();
    const elapsed = () => Math.round(clock() - started);
    const parsed = parseSearchRequest(input);
    if (!parsed.ok) throw new SearchFailure(parsed.code);
    const { q, lang } = parsed.value;
    const queryLang = detect(q, lang).query_lang;

    const controller = new AbortController();
    // What a timed-out call may have used, for the spend record (a model call that was cancelled may still be billed).
    const pending: { model: string; releaseV: number; answered: boolean; tokens: number | null } = { model: "", releaseV: 0, answered: false, tokens: null };
    let releaseV: number | null = null;

    const leg = async (): Promise<LegOutcome> => {
      let current: CurrentRelease | null;
      let data: ReleaseData | null = null;
      try {
        current = await readCurrent(deps.db());
        if (current) releaseV = current.number;
        if (current?.search && deps.embedder) data = await dataOf(current, current.search);
      } catch (error) {
        throw new StageError("snapshot_failed", error instanceof RecentSnapshotFailure);
      }
      // No release, a release without search data, or no key: an expected outcome, and no model is called.
      if (!current || !data || !deps.embedder) return { kind: "none", releaseV: current?.number ?? null };

      // The budget is already spent (a slow body or limiter): no call is made, and none is billed. The clock is read here, not
      // only the abort: the timer that aborts may not have run yet when the release read settles first.
      if (controller.signal.aborted || clock() - started >= legMs) throw new StageError("timed_out");
      pending.model = data.model;
      pending.releaseV = data.releaseV;
      const callStarted = clock();
      let embedded;
      try {
        embedded = await deps.embedder.embedQuery({ text: q, model: data.model, dims: data.dims, signal: controller.signal });
      } catch {
        throw new StageError(controller.signal.aborted ? "timed_out" : "embed_failed");
      }
      const embedMs = Math.round(clock() - callStarted);
      pending.answered = true;
      pending.tokens = typeof embedded?.tokens === "number" ? embedded.tokens : null;
      const size = data.vectors[0]?.length;
      const vector: unknown = embedded?.vector;
      // An answer that is not a vector of the release's size was still billed.
      if (!Array.isArray(vector) || vector.length === 0 || (size !== undefined && vector.length !== size)) throw new StageError("embed_invalid");
      const similarities = new Map<string, number>();
      data.ids.forEach((id, index) => similarities.set(id, cosine(embedded.vector, data.vectors[index]!)));
      return { kind: "answer", data, similarities, tokens: embedded.tokens, embedMs };
    };

    let failure: SearchStageReason | null = null;
    let repeat = false;
    let outcome: LegOutcome | null = null;
    const work = leg();
    // The abandoned leg may still reject after the timeout: that is not unhandled.
    work.catch(() => undefined);
    try {
      const raced = await raceTimeout(work, legMs - elapsed(), () => controller.abort());
      if (raced === "timeout") failure = "timed_out";
      else outcome = raced;
    } catch (error) {
      failure = error instanceof StageError ? error.reason : "embed_failed";
      repeat = error instanceof StageError && error.repeat;
    }

    const writes: Promise<unknown>[] = [];
    // Waits for the writes for what is left of the budget; those still pending then are handed to the app to finish after the response.
    const finish = async (pendingWrites: Promise<unknown>[]) => {
      const all = Promise.allSettled(pendingWrites);
      await Promise.race([all, sleep(totalMs - elapsed())]);
      deps.defer?.(all);
    };
    const log = (row: { status: "ok" | "no_clear_match" | "unavailable" | "error"; resultCount: number; topScore: number | null }) => {
      if (!writeLog) return;
      writes.push(
        Promise.resolve()
          .then(() => deps.db().insert(searchLog).values({ lang, queryLang, releaseV, ms: elapsed(), ...row }))
          .catch(() => undefined),
      );
    };

    if (failure !== null || outcome === null) {
      const reason = failure ?? "embed_failed";
      const releaseAtFailure = releaseV;
      if ((reason === "timed_out" || reason === "embed_invalid") && pending.model !== "") {
        // A cancelled call may have been billed, and an answer that was no usable vector was: count what the vendor reported,
        // or an estimate.
        const reported = pending.answered ? pending.tokens : null;
        writes.push(
          Promise.resolve()
            .then(() =>
              recordSpendEvent(deps.db(), {
                kind: SEARCH_SPEND_KIND,
                purpose: spendPurpose,
                model: pending.model,
                releaseV: pending.releaseV,
                tokens: reported ?? estimateTokens([q]),
                tokensEstimated: reported === null,
                ms: elapsed(),
              }),
            )
            .catch(() => undefined),
        );
      }
      log({ status: "error", resultCount: 0, topScore: null });
      if (deps.onFailure && !repeat) writes.push(Promise.resolve().then(() => deps.onFailure!({ reason, releaseV: releaseAtFailure, ms: elapsed() })).catch(() => undefined));
      await finish(writes);
      throw new SearchFailure("search_unavailable");
    }

    if (outcome.kind === "none") {
      log({ status: "unavailable", resultCount: 0, topScore: null });
      await finish(writes);
      return { v: 1, release_v: outcome.releaseV ?? 0, query_lang: queryLang, status: "unavailable", emergency_first: false, results: [] };
    }

    const { data } = outcome;
    const results = rankLegs([outcome.similarities], data.threshold);
    const status = results.length === 0 ? "no_clear_match" : "ok";
    writes.push(
      Promise.resolve()
        .then(() =>
          recordSpendEvent(deps.db(), {
            kind: SEARCH_SPEND_KIND,
            purpose: spendPurpose,
            model: data.model,
            releaseV: data.releaseV,
            tokens: outcome.tokens ?? estimateTokens([q]),
            tokensEstimated: outcome.tokens === null,
            ms: outcome.embedMs,
          }),
        )
        .catch(() => undefined),
    );
    log({ status, resultCount: results.length, topScore: results[0]?.score ?? null });
    await finish(writes);
    return { v: 1, release_v: data.releaseV, query_lang: queryLang, status, emergency_first: emergencyFirst(results, data.emergency), results };
  }

  async function has(providerId: string): Promise<boolean> {
    const current = await readCurrent(deps.db());
    if (!current?.search) throw new Error("The current release has no search data");
    return (await dataOf(current, current.search)).known.has(providerId);
  }

  return { search, has };
}
