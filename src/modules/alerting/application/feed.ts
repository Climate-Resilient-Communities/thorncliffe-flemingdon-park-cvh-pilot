// Reads the public feed (AD-17): the feed version from the database, the places the feed lists, and the alerts that
// reach residents. The first two are real now. The alerts are a port with an empty default, because approved alerts
// reach residents only when S04.08 (the web publish) is built: it supplies `FeedAlerts`, and nothing else here changes.
import { eq } from "drizzle-orm";
import type { FeedThread, FeedV1 } from "../../../contracts/feed";
import type { LangCode } from "../../../contracts/lang";
import type { Db } from "../../../platform/db";
import { feedVersion } from "../adapters/schema";
import { buildFeed, type PlaceState } from "../domain/feed";

/** The buildings (register numbers) and neighbourhoods (ids) the feed lists. Wired to the places module by `createFeedReader`. */
export interface FeedPlaces {
  buildings: readonly string[];
  neighbourhoods: readonly string[];
}

/**
 * Port: what residents are told. S04.08 reads the open threads that have a web-published entry (never a drill: the
 * `nondrill_alert` view) with their text in `lang`, and S05.06 derives each place's status from them (AD-19).
 */
export interface FeedAlerts {
  read(lang: LangCode): Promise<{
    threads: readonly FeedThread[];
    statuses: { buildings: ReadonlyMap<string, PlaceState>; neighbourhoods: ReadonlyMap<string, PlaceState> };
  }>;
  /**
   * The closed thread with this slug (S05.03): R-07 shows a thread that closed (its close reason, the final message, every earlier entry) when a resident opens its
   * address. It is not in `read`: the feed lists open threads only. Null when no closed thread has the slug. A source that has no closed threads leaves it out.
   */
  readClosed?(lang: LangCode, slug: string): Promise<FeedThread | null>;
}

/** Before S04.08: no threads, so every place is `none`. */
export const NO_ALERTS_YET: FeedAlerts = {
  read: async () => ({ threads: [], statuses: { buildings: new Map(), neighbourhoods: new Map() } }),
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
      const [places, current] = await Promise.all([deps.places(), alerts.read(lang)]);
      return buildFeed({ feedVersion: version, now: now(), threads: current.threads, places, statuses: current.statuses });
    },
  };
}

export type FeedReader = ReturnType<typeof createFeedReader>;
