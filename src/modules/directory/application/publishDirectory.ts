// The directory publish job (S02.05, AD-11, AD-14): an Admin publishes the directory as one numbered release.
//
// The job is built to be stopped and run again, and to be safe against other changes:
//  - claim: one transaction under an advisory lock takes the snapshot of the published providers
//    (a row lock on each, `for share`, so a provider cannot be published, unpublished or re-confirmed
//    between the snapshot and the moment it commits, and the snapshot cannot be taken in the middle of one),
//    plans every file, and stores the release as `building` with the files' text staged in the row. A
//    publish already running (a live lease) is refused; a stopped one (lease expired) is resumed with the
//    same staged files, so a release is always built from one snapshot;
//  - store: each file in turn goes to the private bucket, then is marked stored (under the lease token);
//    a resumed job skips the files already marked;
//  - complete: one transaction, again under the advisory lock, checks every file is stored and any search
//    data matches, clears the previous release's `is_current`, sets this one's, and writes the audit record.
//    Readers see the old release or the new one, never a mix (one unique partial index, two statements, one
//    commit). Until then the previous release stays current;
//  - give up: three passes (this run's retries and earlier runs' count together); the release is closed
//    `failed`, the failure goes to ops_event through a port, the audit trail records the refusal, and the
//    previous release stays current.
// Reads inside a transaction use the transaction (test/transaction-executor.test.ts).
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { record, recordRefusal } from "@/modules/audit";
import type { Db, DbExecutor, DbTransaction } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { directoryRelease, category, provider, providerCategory, providerLocation, type ReleaseFileEntry } from "../adapters/schema";
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
import type { PublishDeps, PublishFailure, PublishFailureCode } from "./ports";

/** Held for the whole of a claim and of a completion: publishes and pointer changes are serialised. */
export const PUBLISH_LOCK_KEY = 4417203115;

export const MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
/** A stopped build older than this is not resumed: its snapshot is too old to publish as "now". */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;
const BACKOFF_MS = [500, 1500];

export type PublishResult =
  | { ok: true; release: number; counts: ReleaseCounts; report: ReleaseReport; attempts: number; resumedFiles: number }
  | { ok: false; reason: PublishFailureCode | "publish_running"; release: number | null; attempts: number; detail: string[] };

/** A step that failed for a reason the Admin is told, and whether another pass can fix it. */
class PublishStepError extends Error {
  override name = "PublishStepError";
  constructor(
    readonly code: PublishFailureCode,
    readonly retryable: boolean,
    /** What the Admin is told beyond the code: ids and codes of what is wrong, never text from the catalogue. */
    readonly detail: string[] = [],
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

type ClaimResult = { claim: Claim } | { running: true };

interface Closed {
  release: number;
  attempts: number;
  filesStored: number;
}

const storedCount = (files: Record<string, ReleaseFileEntry>) => Object.values(files).filter((file) => file.stored_at !== null).length;

async function claimRelease(db: Db, deps: PublishDeps, actorStaffId: string, now: Date, closed: Closed[]): Promise<ClaimResult> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const lease = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const token = (deps.newToken ?? randomUUID)();
  // The catalogue's version is read before the transaction: it is files on disk, not rows.
  const version = await deps.catalogue().catch(() => {
    throw new PublishStepError("invalid_catalogue", false);
  });
  const zhHant = await deps.zhHant();
  return db.transaction(async (tx): Promise<ClaimResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_KEY})`);
    const [open] = await tx.select().from(directoryRelease).where(eq(directoryRelease.status, "building")).orderBy(desc(directoryRelease.number)).limit(1).for("update");
    if (open) {
      const live = open.leaseUntil !== null && open.leaseToken !== null && open.leaseUntil > now;
      if (live) return { running: true };
      const fresh = now.getTime() - open.startedAt.getTime() <= RESUME_WINDOW_MS;
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
      if (gaveUp) closed.push({ release: open.number, attempts: open.attempts, filesStored: storedCount(open.files) });
    }

    const { providers, categories } = await takeSnapshot(tx);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${directoryRelease.number}), 0) + 1` }).from(directoryRelease);
    let plan;
    try {
      plan = planRelease({ number: next, catalogueHash: version.hash, providers, categories, hash: sha256Hex, zhHant });
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

/** Writes every file not yet stored, in order, marking each as it lands; the lease token is checked at every step. */
async function storeFiles(db: Db, deps: PublishDeps, claim: Claim, clock: () => Date): Promise<void> {
  const lease = deps.leaseMs ?? DEFAULT_LEASE_MS;
  for (;;) {
    const [row] = await db
      .select({ files: directoryRelease.files, staged: directoryRelease.staged, status: directoryRelease.status, leaseToken: directoryRelease.leaseToken })
      .from(directoryRelease)
      .where(eq(directoryRelease.number, claim.release));
    if (!row || row.status !== "building" || row.leaseToken !== claim.token) throw new LeaseLostError();
    const lang = RELEASE_LANGS.find((code) => row.files[code]?.stored_at === null);
    if (lang === undefined) return;
    const entry = row.files[lang];
    const body = row.staged?.[lang];
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
  const closed: Closed[] = [];
  let localAttempts = 0;
  let claim: Claim | null = null;

  const fail = async (code: PublishFailureCode | "publish_running", attempts: number, detail: string[] = []): Promise<PublishResult> => {
    const release = claim?.release ?? null;
    if (code === "publish_running") {
      await recordRefusal(db, { action: "directory.published", actorStaffId, subjectType: "directory_release", subjectId: release === null ? null : String(release), meta: { reason: "conflict" } });
      return { ok: false, reason: code, release, attempts, detail };
    }
    let filesStored = 0;
    if (claim) {
      const [row] = await db.select({ files: directoryRelease.files }).from(directoryRelease).where(eq(directoryRelease.number, claim.release)).catch(() => []);
      filesStored = row ? storedCount(row.files) : 0;
      await db
        .update(directoryRelease)
        .set({ status: "failed", failure: code, staged: null, leaseToken: null, leaseUntil: null })
        .where(and(eq(directoryRelease.number, claim.release), eq(directoryRelease.status, "building")))
        .catch(() => undefined);
    }
    await tell(deps, { release, reason: code, attempts, filesStored });
    await recordRefusal(db, { action: "directory.published", actorStaffId, subjectType: "directory_release", subjectId: release === null ? null : String(release), meta: { reason: "publish_failed" } });
    return { ok: false, reason: code, release, attempts, detail };
  };

  for (;;) {
    localAttempts += 1;
    try {
      const claimed = await claimRelease(db, deps, actorStaffId, clock(), closed);
      // A stalled build this call closed after three passes is a failed publish too (ops_event), whatever happens next.
      for (const item of closed.splice(0)) await tell(deps, { release: item.release, reason: "gave_up", attempts: item.attempts, filesStored: item.filesStored });
      if ("running" in claimed) return await fail("publish_running", localAttempts);
      claim = claimed.claim;
      await deps.hook?.("snapshot_taken", { release: claim.release });
      await storeFiles(db, deps, claim, clock);
      const done = await completeRelease(db, deps, claim, actorStaffId, clock);
      return { ok: true, release: claim.release, counts: done.counts, report: done.report, attempts: claim.attempts, resumedFiles: claim.resumedFiles };
    } catch (error) {
      if (error instanceof LeaseLostError) return await fail("publish_running", claim?.attempts ?? localAttempts);
      const step = classify(error);
      const attempts = claim?.attempts ?? localAttempts;
      if (claim) await releaseLease(db, claim);
      const exhausted = attempts >= max || localAttempts >= max;
      if (!step.retryable || exhausted) return await fail(step.code, attempts, step.detail);
      await sleep(BACKOFF_MS[Math.min(localAttempts - 1, BACKOFF_MS.length - 1)]);
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
