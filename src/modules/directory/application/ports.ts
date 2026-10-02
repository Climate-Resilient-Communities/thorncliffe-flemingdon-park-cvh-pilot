// The ports of the directory release (S02.05): where the files are kept, what the catalogue's source
// version is, and who is told when a publish fails. Implementations are in adapters/ and in the app's
// composition root; tests use the fakes beside them.
import type { ReleaseSearch, ZhHantConverter } from "../domain/directoryRelease";

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
  /** E03: the search data built for this release, or null (the default: every release until E03). Asked just before the release is made current. */
  search?: (release: { number: number; catalogueHash: string }) => Promise<ReleaseSearch | null>;
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
  hook?: (point: "snapshot_locked" | "snapshot_taken" | "file_stored" | "before_current", detail: { release: number; lang?: string }) => Promise<void> | void;
}
