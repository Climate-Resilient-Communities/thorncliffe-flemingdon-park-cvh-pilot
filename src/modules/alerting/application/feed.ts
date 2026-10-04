// Reads the public feed (AD-17): the feed version from the database, the places the feed lists, and the alerts that
// reach residents. The first two are real now. The alerts are a port with an empty default, because approved alerts
// reach residents only when S04.08 (the web publish) is built: it supplies `FeedAlerts`, and nothing else here changes.
import { eq } from "drizzle-orm";
import type { ArchiveThread, ArchiveV1, FeedThread, FeedV1 } from "../../../contracts/feed";
import type { LangCode } from "../../../contracts/lang";
import type { Db } from "../../../platform/db";
import { ARCHIVE_PAGE_SIZE } from "../../../contracts/feed";
import { feedVersion } from "../adapters/schema";
import { buildFeed, type PlaceState } from "../domain/feed";
import { statusesOf, type StatusThread } from "../domain/status";

/** The buildings (register numbers) and neighbourhoods (ids) the feed lists. Wired to the places module by `createFeedReader`. */
export interface FeedPlaces {
  buildings: readonly string[];
  neighbourhoods: readonly string[];
  /** Each building's neighbourhood (rsn to id), so a neighbourhood audience covers the buildings in it when status is derived (AD-19). Left out: buildings audiences only. */
  neighbourhoodOf?: Readonly<Record<string, string>>;
}

/**
 * Port: what residents are told. S04.08 reads the open threads that have a web-published entry (never a drill: the
 * `nondrill_alert` view) with their text in `lang`, and S05.06 derives each place's status from them (AD-19).
 */
export interface FeedAlerts {
  read(lang: LangCode): Promise<{
    threads: readonly FeedThread[];
    /** Fixed statuses, for a source that has no status threads; ignored when `readStatusThreads` is given (the feed derives them, S05.06). */
    statuses?: { buildings: ReadonlyMap<string, PlaceState>; neighbourhoods: ReadonlyMap<string, PlaceState> };
  }>;
  /**
   * The status threads (S05.06, AD-19): the non-drill threads that are open, and those closed `resolved` in the 12 hours before `now`, with their published entries.
   * Read apart from `read`, whose list holds open threads only. The feed derives every place's status from them with `statusOf`, at request time.
   */
  readStatusThreads?(now: Date): Promise<readonly StatusThread[]>;
  /**
   * The closed thread with this slug (S05.03): R-07 shows a thread that closed (its close reason, the final message, every earlier entry) when a resident opens its
   * address. It is not in `read`: the feed lists open threads only. Null when no closed thread has the slug. A source that has no closed threads leaves it out.
   */
  readClosed?(lang: LangCode, slug: string): Promise<FeedThread | null>;
  /**
   * One page of the archive (S05.07): the closed threads, newest closed first, `size` to a page, each as the feed shows a thread when live with how and when it closed.
   * `page` is 1-based. A source that has no closed threads leaves it out.
   */
  readArchive?(lang: LangCode, page: number, size: number): Promise<{ threads: readonly ArchiveThread[]; hasMore: boolean }>;
  /** The slugs of the closed threads: the app asks this (cached) before `readClosed`, so a slug that is no closed thread's costs the database nothing more. */
  readClosedSlugs?(): Promise<string[]>;
}

/** Before S04.08: no threads, so every place is `none`. */
export const NO_ALERTS_YET: FeedAlerts = {
  read: async () => ({ threads: [] }),
};

export interface FeedReaderDeps {
  /** The database, unless both `version` and `places` are given (local development without one). */
  db?: Db;
  places: () => Promise<FeedPlaces>;
  /** Test and local-development seam: the feed version, instead of the database's. */
  version?: () => Promise<number>;
  alerts?: FeedAlerts;
  now?: () => Date;
}

/** `alerting.feed_version`, the one row every web-visible change increments. A table with no row reads as 0. */
export async function readFeedVersion(db: Db): Promise<number> {
  const [row] = await db.select({ version: feedVersion.version }).from(feedVersion).where(eq(feedVersion.id, 1));
  return row?.version ?? 0;
}

export function requireDb(db: Db | undefined): Db {
  if (!db) throw new Error("the feed needs the database, or both the feed version and the places");
  return db;
}

export function createFeedReader(deps: FeedReaderDeps) {
  const alerts = deps.alerts ?? NO_ALERTS_YET;
  const now = deps.now ?? (() => new Date());
  return {
    /** The feed for one language: the same for every resident, whoever asks (AD-3). */
    async read(lang: LangCode): Promise<FeedV1> {
      // The version is read first: a change committed while the rest is read makes the answer look older than it is,
      // never newer, and a phone discards only an answer older than one it has seen.
      const version = await (deps.version ?? (() => readFeedVersion(requireDb(deps.db))))();
      const at = now();
      const [places, current, statusThreads] = await Promise.all([deps.places(), alerts.read(lang), alerts.readStatusThreads?.(at)]);
      // The threads and the status threads are separate reads, not one snapshot: a thread closing between them can show once as open and as resolved. Every part is
      // at least as new as `version`, and the next poll corrects it.
      // Derived here, at request time, from the status threads (AD-19); never stored.
      const statuses = statusThreads ? statusesOf(places, statusThreads, at) : (current.statuses ?? { buildings: new Map(), neighbourhoods: new Map() });
      return buildFeed({ feedVersion: version, now: at, threads: current.threads, places, statuses });
    },
  };
}

export type FeedReader = ReturnType<typeof createFeedReader>;

export interface ArchiveReaderDeps {
  alerts?: FeedAlerts;
  now?: () => Date;
}

/** `GET /api/feed/archive` (S05.07): one page of the closed threads, the same for every resident, whoever asks (AD-3). With no alerts source it is empty. */
export function createArchiveReader(deps: ArchiveReaderDeps) {
  const alerts = deps.alerts ?? NO_ALERTS_YET;
  const now = deps.now ?? (() => new Date());
  return {
    async read(lang: LangCode, page: number): Promise<ArchiveV1> {
      const at = now();
      const found = (await alerts.readArchive?.(lang, page, ARCHIVE_PAGE_SIZE)) ?? { threads: [], hasMore: false };
      return { v: 1, page, has_more: found.hasMore, server_now: at.toISOString(), threads: [...found.threads] };
    },
  };
}

export type ArchiveReader = ReturnType<typeof createArchiveReader>;
