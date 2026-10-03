// The reads behind an Ambassador's home (S08.01, A-01): the open alerts about their buildings, as residents read them, and their own posts with each one's
// state. The scope is the person's current assignments, given by the caller (identity's `assignmentsOf`, which is empty for anyone who is not an active
// Ambassador), and read again on every request: nothing is cached, and a removed assignment takes its building off the home with the next one.
//
// The alerts come from the resident reader (AD-6: the non-drill views, web-published entries only), so the home shows exactly what residents are seeing, drills
// never. The posts come from the person's own entries.
import { and, desc, eq, inArray } from "drizzle-orm";
import { AudienceSchema, type Audience } from "../../../contracts/audience";
import type { Db } from "../../../platform/db";
import { readOpenThreads } from "../adapters/resident/readThreads";
import { alert, alertEntry } from "../adapters/schema";
import { audienceCoversAssigned, coveringFeedEntry, postIsInScope, postState, type AmbassadorPostState } from "../domain/ambassadorHome";

/** The scope of one request: the buildings the person is assigned to now and the neighbourhood of each (places', read by the caller). */
export interface AmbassadorScope {
  staffId: string;
  assignedRsns: readonly string[];
  neighbourhoodOf: ReadonlyMap<string, string>;
}

/** An open alert about the person's buildings, as residents read it now. */
export interface AmbassadorAlert {
  alertId: string;
  slug: string;
  types: readonly string[];
  /** The English text of the entry that covers the thread. */
  headline: string;
  /** Whether the Hub has verified the covering entry ("Verified"), or it is still "Not yet verified". */
  verified: boolean;
  publishedAt: Date;
  validUntil: Date;
  /** The assigned buildings (rsn) this alert is about. */
  buildings: readonly string[];
}

/** One of the person's own posts and where it stands. */
export interface AmbassadorPost {
  entryId: string;
  alertId: string;
  types: readonly string[];
  text: string;
  state: AmbassadorPostState;
  /** The note an approver wrote when sending it back; only for a returned post. */
  note: string | null;
  postedAt: Date;
  buildings: readonly string[];
}

export interface AmbassadorHomeView {
  alerts: AmbassadorAlert[];
  posts: AmbassadorPost[];
}

const POSTS_SHOWN = 20;
const EMPTY: AmbassadorHomeView = { alerts: [], posts: [] };

/** The assigned buildings an audience is about, for the line under an item. */
const rsnsOf = (audience: Audience, assigned: ReadonlySet<string>, neighbourhoodOf: ReadonlyMap<string, string>): string[] =>
  audience.scope === "buildings"
    ? audience.buildings.map((building) => building.rsn).filter((rsn) => assigned.has(rsn))
    : [...assigned].filter((rsn) => audience.neighbourhood_ids.includes(neighbourhoodOf.get(rsn) ?? ""));

export function createAmbassadorHome(db: Db) {
  return {
    /** The home of a person with this scope. Nobody assigned: nothing is read (fail closed). */
    async read(scope: AmbassadorScope): Promise<AmbassadorHomeView> {
      const assigned = new Set(scope.assignedRsns);
      if (assigned.size === 0) return EMPTY;
      const [threads, rows] = await Promise.all([
        readOpenThreads(db, "en"),
        db
          .select({ entry: alertEntry })
          .from(alertEntry)
          .innerJoin(alert, eq(alert.id, alertEntry.alertId))
          .where(and(eq(alertEntry.authorId, scope.staffId), eq(alert.isDrill, false)))
          .orderBy(desc(alertEntry.createdAt), desc(alertEntry.id))
          .limit(200),
      ]);

      const alerts: AmbassadorAlert[] = [];
      for (const thread of threads) {
        const audience = AudienceSchema.safeParse(thread.audience);
        if (!audience.success || !audienceCoversAssigned(audience.data, assigned, scope.neighbourhoodOf)) continue;
        const covering = coveringFeedEntry(thread.entries);
        alerts.push({
          alertId: thread.id,
          slug: thread.slug,
          types: thread.types,
          headline: covering.original.body,
          verified: covering.verified,
          publishedAt: new Date(covering.published_at),
          validUntil: new Date(thread.valid_until),
          buildings: rsnsOf(audience.data, assigned, scope.neighbourhoodOf),
        });
      }

      const own = rows.map((row) => row.entry);
      const replacers =
        own.length === 0
          ? []
          : await db
              .select({ supersedesId: alertEntry.supersedesId, kind: alertEntry.kind })
              .from(alertEntry)
              .where(
                and(
                  inArray(
                    alertEntry.supersedesId,
                    own.map((entry) => entry.id),
                  ),
                  inArray(alertEntry.status, ["approved", "superseded"]),
                ),
              );
      const replacedBy = new Map<string, "correction" | "withdrawal">();
      for (const replacer of replacers) {
        if (replacer.supersedesId === null) continue;
        // A withdrawal outranks a correction of the same entry (the entry is gone).
        if (replacer.kind === "withdrawal") replacedBy.set(replacer.supersedesId, "withdrawal");
        else if (replacer.kind === "correction" && !replacedBy.has(replacer.supersedesId)) replacedBy.set(replacer.supersedesId, "correction");
      }
      const posts: AmbassadorPost[] = [];
      for (const entry of own) {
        const audience = AudienceSchema.safeParse(entry.audience);
        if (!audience.success || !postIsInScope(audience.data, assigned)) continue;
        const state = postState({
          status: entry.status,
          submittedAt: entry.submittedAt,
          approvedAt: entry.approvedAt,
          webPublishedAt: entry.webPublishedAt,
          returnedFor: entry.returnedFor,
          replacedBy: replacedBy.get(entry.id) ?? null,
        });
        if (state === null) continue;
        posts.push({
          entryId: entry.id,
          alertId: entry.alertId,
          types: entry.types,
          text: entry.originalText,
          state,
          note: state === "returned" ? entry.returnedNote : null,
          postedAt: entry.submittedAt ?? entry.createdAt,
          buildings: rsnsOf(audience.data, assigned, scope.neighbourhoodOf),
        });
        if (posts.length === POSTS_SHOWN) break;
      }
      return { alerts, posts };
    },
  };
}

export type AmbassadorHome = ReturnType<typeof createAmbassadorHome>;
