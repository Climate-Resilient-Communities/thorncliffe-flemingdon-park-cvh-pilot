// The ports of the directory release (S02.05): where the files are kept, what the catalogue's source
// version is, and who is told when a publish fails. Implementations are in adapters/ and in the app's
// composition root; tests use the fakes beside them.
import type { ZhHantConverter } from "../domain/directoryRelease";
import type { EmbeddingConfig } from "../domain/searchData";

/** The private place the release files are kept (Supabase Storage; a folder in local runs; memory in tests). */
export interface DirectoryStorage {
  /** Stores the text at the path, replacing what is there (the same bytes, when a stopped publish resumes). Throws when it cannot. */
  put(path: string, body: string): Promise<void>;
  /** The text at the path, or null when there is nothing there. Throws when the store cannot be reached. */
  get(path: string): Promise<string | null>;
}

/** The catalogue's source version a release records. */
export interface CatalogueVersion {
  /** sha256 of the committed data/catalogue/ files. */
  hash: string;
  /** The commit the running build was made from, or null for a local build. */
  gitCommit: string | null;
}

/** Why a publish failed: the Admin's "Publish failed" and the ops_event name it (src/modules/ops/domain/events.ts keeps the same list). */
export const PUBLISH_FAILURE_CODES = [
  "storage_unavailable",
  "invalid_catalogue",
  /** The committed catalogue files are not in the deployed function (data/catalogue/ cannot be read). */
  "catalogue_unreadable",
  /** The database holds another catalogue than this deployment carries: the seed has to run (or run again) before a publish. */
  "catalogue_not_loaded",
  "search_mismatch",
  /** The embedding model could not be reached, or answered wrongly, or the publish ran out of time while embedding: the build stays, and the next press resumes it. */
  "embedding_unavailable",
  /** Embedding this release would take the month's usage allowance (calls or tokens) over its limit. */
  "usage_allowance_exceeded",
  /** The search settings do not fit this release (an emergency category the catalogue does not have, or another model than the staged one). */
  "search_config_invalid",
  /** The deployment has no (valid) embedding key but the current release has search data: publishing without it would switch search off for residents, so nothing is published. */
  "search_not_configured",
  "gave_up",
  "unexpected",
] as const;
export type PublishFailureCode = (typeof PUBLISH_FAILURE_CODES)[number];

/** For `catalogue_not_loaded`: the hash of the last catalogue the seed loaded (null: it never ran), the hash this deployment carries, and its commit. */
export interface CatalogueMismatch {
  loaded: string | null;
  deployed: string;
  commit: string | null;
}

/** A publish that gave up: what ops_event records, from a port so directory never imports ops (AD-2). */
export interface PublishFailure {
  /** The release that was being built, when one was started. */
  release: number | null;
  reason: PublishFailureCode;
  attempts: number;
  filesStored: number;
}

export interface PublishDeps {
  storage: DirectoryStorage;
  catalogue: () => Promise<CatalogueVersion>;
  /** OpenCC for zh-Hant; loaded when a release is planned, not when the module is imported. */
  zhHant: () => Promise<ZhHantConverter>;
  /** Told once when a publish gives up. A failure here never changes the outcome. */
  onFailure: (failure: PublishFailure) => Promise<void>;
  /** S03.02: with this, the release carries the search data of its own listings; without it the release has none (search then says "unavailable"). */
  search?: SearchBuild;
  /** Test seams. */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  newToken?: () => string;
  /** How many passes a publish makes before it gives up (the story says three). */
  maxAttempts?: number;
  /** How long a job's claim lasts without a sign of life. */
  leaseMs?: number;
  /** How long a run keeps retrying before it lets go of its lease and answers `storage_unavailable` (the function has 60 s). */
  budgetMs?: number;
  /**
   * Called at named points of the job; a test throws or waits here to stop it part way or to interleave another change.
   * `snapshot_locked` is inside the claim's transaction, with the providers' rows locked and the release not yet stored.
   */
  hook?: (point: "snapshot_locked" | "snapshot_taken" | "file_stored" | "chunk_embedded" | "vectors_stored" | "before_current" | "search_verified", detail: { release: number; lang?: string }) => Promise<void> | void;
}

export type { EmbeddingConfig };

/** What one call of an embedding model gives back. */
export interface EmbeddedTexts {
  /** One vector per text, in the order of the texts. */
  vectors: number[][];
  /** The input tokens the vendor billed, or null when it did not say. */
  tokens: number | null;
}

/**
 * The embedding model (Cohere in production; a fake in every test): the only way the directory reaches it. Documents are
 * embedded as documents (`input_type: search_document`); the question side, in S03.04, embeds as queries.
 */
export interface Embedder {
  /** The model's id: the release records it, and every question is embedded with the same one. */
  readonly model: string;
  /**
   * Everything besides the text that decides what a vector is: a vector is reused from an earlier release only when this
   * whole configuration matches, not just the model id.
   */
  readonly config: EmbeddingConfig;
  /** Throws when the call fails or `signal` aborts it. */
  embedDocuments(texts: string[], options: { signal: AbortSignal }): Promise<EmbeddedTexts>;
}

/** How a release gets its search data (S03.02). */
export interface SearchBuild {
  embedder: Embedder;
  /** The similarity below which a question has no clear match; recorded on the release (S03.04 reads it from there). */
  threshold: number;
  /** The English names of the categories whose results put the 911 block first; recorded on the release. */
  emergencyCategories: string[];
  /**
   * What the month may use for publishing before the publish refuses to embed, in calls and tokens (money is not known
   * yet). Only usage with the purpose `publish` counts against it: questions and test-set runs have their own.
   */
  allowance: { callsPerMonth: number; tokensPerMonth: number };
  /** Texts per call (default 32; the models take up to 96). A stopped job resumes after the last chunk it kept. */
  chunkSize?: number;
  /** The longest one call may take (default 15 s). A call is only started when at least this much of the publish's time is left. */
  callTimeoutMs?: number;
  /** The longest the store may take to write the vectors file (default 10 s). */
  vectorsPutTimeoutMs?: number;
  /** The longest the store may take to read a vectors file back (default 10 s). */
  vectorsGetTimeoutMs?: number;
}

/**
 * The question side of the embedding model (S03.04): a question is embedded as a query (`input_type: search_query`) with the
 * model and vector size the release recorded, which the caller passes, so a question never meets vectors made by another
 * model. Throws QueryEmbedError, never an error that holds the request: adapters wrap the vendor's failures and drop their
 * bodies (AD-3).
 */
export interface QueryEmbedder {
  embedQuery(input: { text: string; model: string; dims: number | null; signal: AbortSignal }): Promise<{ vector: number[]; tokens: number | null }>;
}

/** Why one question's embedding failed: a code only. The vendor's error, which may echo the request, is dropped. */
export class QueryEmbedError extends Error {
  override name = "QueryEmbedError";
  readonly code: "embed_failed" | "aborted";
  constructor(code: "embed_failed" | "aborted") {
    super(code === "aborted" ? "The question's embedding was cancelled" : "The question's embedding failed");
    this.code = code;
  }
}
