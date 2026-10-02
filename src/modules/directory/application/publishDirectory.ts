// The directory publish job (S02.05, AD-11, AD-14): an Admin publishes the directory as one numbered release.
//
// The job is built to be stopped and run again, and to be safe against other changes:
//  - claim: one transaction under an advisory lock (the provider seed takes the same one) first checks that the
//    latest `catalogue_load` is the hash of the catalogue this deployment carries, so the providers in Postgres
//    are the ones the release will say it was made from; then takes the snapshot of the published providers
//    (a row lock on each, `for share`, so a provider cannot be published, unpublished or re-confirmed
//    between the snapshot and the moment it commits, and the snapshot cannot be taken in the middle of one),
//    plans every file, and stores the release as `building` with the files' text staged in the row. A
//    publish already running (a live lease) is refused; a stopped one (lease expired) is resumed with the
//    same staged files, so a release is always built from one snapshot. A stopped build found with three
//    passes behind it is closed `gave_up` and that failure is the answer of this press; the next one builds;
//  - store: each file in turn goes to the private bucket, then is marked stored (under the lease token);
//    a resumed job skips the files already marked;
//  - complete: one transaction, again under the advisory lock, checks every file is stored and any search
//    data matches, clears the previous release's `is_current`, sets this one's, and writes the audit record.
//    Readers see the old release or the new one, never a mix (one unique partial index, two statements, one
//    commit). Until then the previous release stays current;
//  - give up: three passes (this run's retries and earlier runs' count together); the release is closed
//    `failed` (under the lease token: a run whose claim was taken over closes nothing), the failure goes to
//    ops_event through a port, the audit trail records the refusal, and the previous release stays current;
//  - the clock: the function has `maxDuration` seconds (src/app/staff/directory/page.tsx), so a run stops retrying
//    after PUBLISH_BUDGET_MS, lets go of its lease and answers `storage_unavailable` with an ops_event; the build
//    stays `building` and the next press resumes it from the files already stored.
// Reads inside a transaction use the transaction (test/transaction-executor.test.ts).
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { record, recordRefusal } from "@/modules/audit";
import type { Db, DbExecutor, DbTransaction } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { catalogueLoad, directoryRelease, category, provider, providerCategory, providerLocation, type ReleaseFileEntry } from "../adapters/schema";
import {
  RELEASE_LANGS,
  ReleaseDataError,
  ReleaseSearchSchema,
  checkReleaseSearch,
  planRelease,
  type ReleaseCounts,
  type ReleaseReport,
  type SnapshotCategory,
  type SnapshotProvider,
} from "../domain/directoryRelease";
import type { CatalogueMismatch, PublishDeps, PublishFailure, PublishFailureCode } from "./ports";
import { PUBLISH_LOCK_KEY } from "./publishLock";

export { PUBLISH_LOCK_KEY };

export const MAX_ATTEMPTS = 3;
/**
 * How long a run's claim lasts without a sign of life. It must outlast the function: a lease that ends while the
 * function may still be running would let a second press take the release over (test/publishBudget.test.ts keeps
 * it above the page's `maxDuration` with a margin).
 */
export const DEFAULT_LEASE_MS = 2 * 60 * 1000;
/** A run stops retrying after this long (the function's `maxDuration` is 60 s): it lets go of its lease and the next press resumes. */
export const PUBLISH_BUDGET_MS = 40 * 1000;
/** A stopped build older than this is not resumed: its snapshot is too old to publish as "now". */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;
const BACKOFF_MS = [500, 1500];

export type PublishResult =
  | { ok: true; release: number; counts: ReleaseCounts; report: ReleaseReport; attempts: number; resumedFiles: number }
  | {
      ok: false;
      reason: PublishFailureCode | "publish_running";
      release: number | null;
      attempts: number;
      detail: string[];
      /** For `catalogue_not_loaded`: what the database holds and what this deployment has. */
      catalogue?: CatalogueMismatch;
    };

/** A step that failed for a reason the Admin is told, and whether another pass can fix it. */
class PublishStepError extends Error {
  override name = "PublishStepError";
  constructor(
    readonly code: PublishFailureCode,
    readonly retryable: boolean,
    /** What the Admin is told beyond the code: ids and codes of what is wrong, never text from the catalogue. */
    readonly detail: string[] = [],
    readonly catalogue?: CatalogueMismatch,
  ) {
    super(code);
  }
}

/** The job's claim on the release was taken over (or the release was closed): this run stops without touching anything. */
class LeaseLostError extends Error {
  override name = "LeaseLostError";
}

const pad = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- the snapshot
/** The published providers, locked against change until the transaction ends, with what a listing needs. */
async function takeSnapshot(tx: DbTransaction): Promise<{ providers: SnapshotProvider[]; categories: SnapshotCategory[] }> {
  const rows = await tx
    .select()
    .from(provider)
    .where(and(eq(provider.published, true), eq(provider.inCatalogue, true), isNotNull(provider.lastConfirmed)))
    .orderBy(asc(provider.id))
    .for("share");
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return { providers: [], categories: [] };
  const locations = await tx.select().from(providerLocation).where(inArray(providerLocation.providerId, ids)).orderBy(asc(providerLocation.providerId), asc(providerLocation.seq));
  const links = await tx.select().from(providerCategory).where(inArray(providerCategory.providerId, ids));
  const categoryRows = await tx.select().from(category).orderBy(asc(category.sortOrder));
  const providers: SnapshotProvider[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    subcategories: row.subcategories,
    contact: row.contact,
    texts: row.texts,
    translations: row.translations,
    withheld: row.withheld,
    lastConfirmed: row.lastConfirmed as string,
    locations: locations.filter((l) => l.providerId === row.id).map((l) => ({ street: l.street, city: l.city, postal: l.postal, lat: l.lat, lng: l.lng })),
    categoryIds: links.filter((l) => l.providerId === row.id).map((l) => l.categoryId),
  }));
  const categories: SnapshotCategory[] = categoryRows.map((row) => ({ id: row.id, sortOrder: row.sortOrder, labels: row.labels, translations: row.translations }));
  return { providers, categories };
}

// ---------------------------------------------------------------- the steps
interface Claim {
  release: number;
  token: string;
  /** The pass number this claim is (1 for a new release). */
  attempts: number;
  resumedFiles: number;
}

/** A stopped build the claim closed after three passes; reported once, with the claim that closed it. */
interface Closed {
  release: number;
  attempts: number;
}

type ClaimResult = { claim: Claim } | { running: true } | { gaveUp: Closed };

const storedCount = (files: Record<string, ReleaseFileEntry>) => Object.values(files).filter((file) => file.stored_at !== null).length;

async function claimRelease(db: Db, deps: PublishDeps, actorStaffId: string, now: Date): Promise<ClaimResult> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const lease = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const token = (deps.newToken ?? randomUUID)();
  // The catalogue's version is read before the transaction: it is files on disk, not rows.
  const version = await deps.catalogue().catch(() => {
    throw new PublishStepError("catalogue_unreadable", false);
  });
  const neighbourhoods = await deps.neighbourhoods().catch(() => {
    throw new PublishStepError("catalogue_unreadable", false);
  });
  const zhHant = await deps.zhHant();
  return db.transaction(async (tx): Promise<ClaimResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_KEY})`);
    const [open] = await tx.select().from(directoryRelease).where(eq(directoryRelease.status, "building")).orderBy(desc(directoryRelease.number)).limit(1).for("update");
    if (open) {
      const live = open.leaseUntil !== null && open.leaseToken !== null && open.leaseUntil > now;
      if (live) return { running: true };
    }
    // The providers in Postgres are what the seed loaded: a release may say it was made from this deployment's catalogue only if the
    // latest load was of the same files. Read with the transaction, under the lock the seed also takes.
    const [load] = await tx.select({ hash: catalogueLoad.hash }).from(catalogueLoad).orderBy(desc(catalogueLoad.id)).limit(1);
    if (!load || load.hash !== version.hash) {
      throw new PublishStepError("catalogue_not_loaded", false, [], { loaded: load?.hash ?? null, deployed: version.hash, commit: version.gitCommit });
    }
    if (open) {
      // A build of another catalogue (the app was deployed in between) is not resumed: it would publish the old files as the new ones.
      const fresh = now.getTime() - open.startedAt.getTime() <= RESUME_WINDOW_MS && open.catalogueHash === version.hash;
      if (fresh && open.attempts < max && open.staged !== null) {
        await tx
          .update(directoryRelease)
          .set({ attempts: open.attempts + 1, leaseToken: token, leaseUntil: new Date(now.getTime() + lease) })
          .where(eq(directoryRelease.number, open.number));
        return { claim: { release: open.number, token, attempts: open.attempts + 1, resumedFiles: storedCount(open.files) } };
      }
      // Stopped too often, or too long ago to publish as "now": close it and build a new one from the providers as they are.
      const gaveUp = open.attempts >= max;
      await tx
        .update(directoryRelease)
        .set({ status: "failed", failure: gaveUp ? "gave_up" : "abandoned", staged: null, leaseToken: null, leaseUntil: null })
        .where(eq(directoryRelease.number, open.number));
      // The Admin is told about the build that stopped three times; the next press builds a new release.
      if (gaveUp) return { gaveUp: { release: open.number, attempts: open.attempts } };
    }

    const { providers, categories } = await takeSnapshot(tx);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${directoryRelease.number}), 0) + 1` }).from(directoryRelease);
    let plan;
    try {
      plan = planRelease({ number: next, catalogueHash: version.hash, providers, categories, neighbourhoods: neighbourhoods.byProvider, hash: sha256Hex, zhHant });
    } catch (error) {
      if (error instanceof ReleaseDataError) throw new PublishStepError("invalid_catalogue", false, error.problems);
      throw error;
    }
    await deps.hook?.("snapshot_locked", { release: next });
    const files: Record<string, ReleaseFileEntry> = {};
    const staged: Record<string, string> = {};
    for (const file of plan.files) {
      files[file.lang] = { path: `releases/${next}/${file.lang}.json`, sha256: file.sha256, bytes: file.bytes, stored_at: null };
      staged[file.lang] = file.body;
    }
    await tx.insert(directoryRelease).values({
      number: next,
      status: "building",
      catalogueHash: version.hash,
      gitCommit: version.gitCommit,
      startedBy: actorStaffId,
      startedAt: now,
      counts: plan.counts as unknown as Record<string, number>,
      report: plan.report as unknown as Record<string, unknown>,
      files,
      staged,
      attempts: 1,
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + lease),
    });
    return { claim: { release: next, token, attempts: 1, resumedFiles: 0 } };
  });
}

/**
 * Writes every file not yet stored, in order, marking each as it lands; the lease token is checked at every step.
 * Only the file about to be written is read from the staged text, never all sixteen at once. Stops with a retryable
 * `storage_unavailable` when `deadline` has passed: the run has no time for the rest, and the caller lets go of the lease.
 */
async function storeFiles(db: Db, deps: PublishDeps, claim: Claim, clock: () => Date, deadline: number): Promise<void> {
  const lease = deps.leaseMs ?? DEFAULT_LEASE_MS;
  for (;;) {
    const [row] = await db
      .select({ files: directoryRelease.files, status: directoryRelease.status, leaseToken: directoryRelease.leaseToken })
      .from(directoryRelease)
      .where(eq(directoryRelease.number, claim.release));
    if (!row || row.status !== "building" || row.leaseToken !== claim.token) throw new LeaseLostError();
    const lang = RELEASE_LANGS.find((code) => row.files[code]?.stored_at === null);
    if (lang === undefined) return;
    if (clock().getTime() >= deadline) throw new PublishStepError("storage_unavailable", true);
    const entry = row.files[lang];
    const [staged] = await db
      .select({ body: sql<string | null>`${directoryRelease.staged} ->> ${lang}` })
      .from(directoryRelease)
      .where(eq(directoryRelease.number, claim.release));
    const body = staged?.body ?? undefined;
    if (body === undefined || sha256Hex(body) !== entry.sha256) throw new PublishStepError("unexpected", false);
    try {
      await deps.storage.put(entry.path, body);
    } catch {
      throw new PublishStepError("storage_unavailable", true);
    }
    const now = clock();
    const marked = await db
      .update(directoryRelease)
      .set({ files: { ...row.files, [lang]: { ...entry, stored_at: now.toISOString() } }, leaseUntil: new Date(now.getTime() + lease) })
      .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.leaseToken, claim.token), eq(directoryRelease.status, "building")))
      .returning({ number: directoryRelease.number });
    if (marked.length === 0) throw new LeaseLostError();
    await deps.hook?.("file_stored", { release: claim.release, lang });
  }
}

/** Makes the release current, in one transaction. */
async function completeRelease(db: Db, deps: PublishDeps, claim: Claim, actorStaffId: string, clock: () => Date): Promise<{ counts: ReleaseCounts; report: ReleaseReport }> {
  const [row] = await db.select({ catalogueHash: directoryRelease.catalogueHash }).from(directoryRelease).where(eq(directoryRelease.number, claim.release));
  if (!row) throw new LeaseLostError();
  // E03: the search data of this release, asked outside the transaction (it is a call out). Checked again where it counts, below.
  const search = deps.search ? await deps.search({ number: claim.release, catalogueHash: row.catalogueHash }) : null;
  const checkedSearch = search === null ? null : ReleaseSearchSchema.parse(search);
  await deps.hook?.("before_current", { release: claim.release });
  const now = clock();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_KEY})`);
    const [release] = await tx.select().from(directoryRelease).where(eq(directoryRelease.number, claim.release)).for("update");
    if (!release || release.status !== "building" || release.leaseToken !== claim.token) throw new LeaseLostError();
    const verdict = checkReleaseSearch({ number: release.number, catalogueHash: release.catalogueHash }, checkedSearch);
    if (!verdict.ok) throw new PublishStepError("search_mismatch", false);
    if (RELEASE_LANGS.some((lang) => release.files[lang]?.stored_at == null)) throw new PublishStepError("unexpected", false);

    await tx.update(directoryRelease).set({ isCurrent: false }).where(eq(directoryRelease.isCurrent, true));
    await tx
      .update(directoryRelease)
      .set({
        status: "complete",
        publishedAt: now,
        isCurrent: true,
        currentSince: now,
        staged: null,
        search: checkedSearch === null ? null : { embed_model: checkedSearch.embedModel, vectors_path: checkedSearch.vectorsPath, catalogue_hash: checkedSearch.catalogueHash, release_v: checkedSearch.releaseV },
        leaseToken: null,
        leaseUntil: null,
      })
      .where(eq(directoryRelease.number, release.number));
    const counts = release.counts as unknown as ReleaseCounts;
    const report = release.report as unknown as ReleaseReport;
    await record(tx, {
      action: "directory.published",
      actorStaffId,
      subjectType: "directory_release",
      subjectId: String(release.number),
      meta: {
        release: release.number,
        providers: counts.providers,
        categories: counts.categories,
        files: counts.files,
        translations: counts.translations,
        fallbacks: counts.fallbacks,
        stale: counts.stale,
        attempts: release.attempts,
        resumed_files: claim.resumedFiles,
      },
    });
    return { counts, report };
  });
}

/** Lets go of the claim so the next pass (or run) can resume at once; best effort. */
async function releaseLease(db: Db, claim: Claim): Promise<void> {
  await db
    .update(directoryRelease)
    .set({ leaseToken: null, leaseUntil: null })
    .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.leaseToken, claim.token), eq(directoryRelease.status, "building")))
    .catch(() => undefined);
}

function classify(error: unknown): PublishStepError {
  if (error instanceof PublishStepError) return error;
  // A database or driver error: another pass may well work.
  return new PublishStepError("unexpected", true);
}

/**
 * Publishes the directory as a new numbered release, or resumes the one a stopped run left. Never throws for a
 * failed publish: the result says why. Only an Admin at aal2 may call it (the guard, `guide.publish`).
 */
export async function publishDirectory(db: Db, deps: PublishDeps, actorStaffId: string): Promise<PublishResult> {
  const clock = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? pad;
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const deadline = clock().getTime() + (deps.budgetMs ?? PUBLISH_BUDGET_MS);
  let localAttempts = 0;
  let claim: Claim | null = null;

  /** The audit trail's refusal; like `tell`, a failure to write it never turns the answer into a crash. */
  const refuse = async (reason: "publish_running" | "publish_failed", release: number | null, failure?: PublishFailureCode): Promise<void> => {
    try {
      await recordRefusal(db, {
        action: "directory.published",
        actorStaffId,
        subjectType: "directory_release",
        subjectId: release === null ? null : String(release),
        meta: failure === undefined ? { reason } : { reason, failure },
      });
    } catch {
      // The answer to the Admin stands; the release row and ops_event hold what happened.
    }
  };

  const running = async (release: number | null, attempts: number): Promise<PublishResult> => {
    await refuse("publish_running", release);
    return { ok: false, reason: "publish_running", release, attempts, detail: [] };
  };

  /**
   * A failed publish: the failure is told to ops_event and the audit trail. `close` also closes the release this run
   * claimed, under the run's lease token: if the claim was taken over meanwhile, nothing is closed and the answer is
   * `publish_running`. Without `close` the release is left as it is (already closed by the claim that found it stopped
   * three times, or left `building` with its lease released for the next press to resume).
   */
  const fail = async (
    code: PublishFailureCode,
    attempts: number,
    detail: string[] = [],
    options: { release?: number | null; close?: boolean; catalogue?: CatalogueMismatch } = {},
  ): Promise<PublishResult> => {
    const release = options.release === undefined ? (claim?.release ?? null) : options.release;
    let filesStored = 0;
    if (release !== null) {
      const [row] = await db.select({ files: directoryRelease.files }).from(directoryRelease).where(eq(directoryRelease.number, release)).catch(() => []);
      if (row) filesStored = storedCount(row.files);
    }
    if (options.close && claim) {
      const closed = await db
        .update(directoryRelease)
        .set({ status: "failed", failure: code, staged: null, leaseToken: null, leaseUntil: null })
        .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.leaseToken, claim.token), eq(directoryRelease.status, "building")))
        .returning({ number: directoryRelease.number })
        .catch(() => null);
      // Someone took the release over (or closed it): it is theirs now, and not this run's failure to report.
      if (closed !== null && closed.length === 0) return await running(claim.release, attempts);
    }
    await tell(deps, { release, reason: code, attempts, filesStored });
    await refuse("publish_failed", release, code);
    return { ok: false, reason: code, release, attempts, detail, ...(options.catalogue ? { catalogue: options.catalogue } : {}) };
  };

  for (;;) {
    localAttempts += 1;
    try {
      const claimed = await claimRelease(db, deps, actorStaffId, clock());
      if ("running" in claimed) return await running(null, localAttempts);
      // A stalled build this claim closed after three passes is this press's answer: a failed publish (ops_event, audit),
      // whatever the providers look like now. The next press builds.
      if ("gaveUp" in claimed) {
        const item = claimed.gaveUp;
        return await fail("gave_up", item.attempts, [], { release: item.release });
      }
      claim = claimed.claim;
      await deps.hook?.("snapshot_taken", { release: claim.release });
      await storeFiles(db, deps, claim, clock, deadline);
      const done = await completeRelease(db, deps, claim, actorStaffId, clock);
      return { ok: true, release: claim.release, counts: done.counts, report: done.report, attempts: claim.attempts, resumedFiles: claim.resumedFiles };
    } catch (error) {
      if (error instanceof LeaseLostError) return await running(claim?.release ?? null, claim?.attempts ?? localAttempts);
      const step = classify(error);
      const attempts = claim?.attempts ?? localAttempts;
      const wait = BACKOFF_MS[Math.min(localAttempts - 1, BACKOFF_MS.length - 1)];
      const exhausted = attempts >= max || localAttempts >= max;
      if (!step.retryable || exhausted) return await fail(step.code, attempts, step.detail, { close: true, catalogue: step.catalogue });
      // Another pass is due, but it must fit the function's time: past the budget the run lets go of its lease, tells ops,
      // and leaves the release building for the next press to resume from the files already stored.
      if (claim) await releaseLease(db, claim);
      if (clock().getTime() + wait >= deadline) return await fail(step.code, attempts, step.detail);
      await sleep(wait);
    }
  }
}

async function tell(deps: PublishDeps, failure: PublishFailure): Promise<void> {
  try {
    await deps.onFailure(failure);
  } catch {
    // The failure is already in the audit trail and the release row; a broken sink never turns it into a crash.
  }
}

// ---------------------------------------------------------------- what the screens read
export interface ReleaseSummary {
  number: number;
  status: "building" | "complete" | "failed";
  isCurrent: boolean;
  startedAt: Date;
  publishedAt: Date | null;
  failure: string | null;
  attempts: number;
  /** The claim of the run building it: a live lease means a publish is in progress, none (or an old one) a stalled build. */
  leaseUntil: Date | null;
  counts: ReleaseCounts;
  report: ReleaseReport;
}

const summaryColumns = {
  number: directoryRelease.number,
  status: directoryRelease.status,
  isCurrent: directoryRelease.isCurrent,
  startedAt: directoryRelease.startedAt,
  publishedAt: directoryRelease.publishedAt,
  failure: directoryRelease.failure,
  attempts: directoryRelease.attempts,
  leaseUntil: directoryRelease.leaseUntil,
  counts: directoryRelease.counts,
  report: directoryRelease.report,
};

const summaryOf = (row: { counts: Record<string, number>; report: Record<string, unknown> } & Omit<ReleaseSummary, "counts" | "report">): ReleaseSummary => ({
  ...row,
  counts: row.counts as unknown as ReleaseCounts,
  report: row.report as unknown as ReleaseReport,
});

/** The current release, or null before the first publish. */
export async function currentReleaseSummary(db: DbExecutor): Promise<ReleaseSummary | null> {
  const [row] = await db.select(summaryColumns).from(directoryRelease).where(eq(directoryRelease.isCurrent, true));
  return row ? summaryOf(row) : null;
}

/** The newest release of any status (a failed one included), for "Publish failed" on the Admin's screen. */
export async function latestReleaseSummary(db: DbExecutor): Promise<ReleaseSummary | null> {
  const [row] = await db.select(summaryColumns).from(directoryRelease).orderBy(desc(directoryRelease.number)).limit(1);
  return row ? summaryOf(row) : null;
}
