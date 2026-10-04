// The reads behind an Ambassador's home (S08.01, A-01): the open alerts about their buildings, as residents read them, and their own posts with each one's
// state. The scope is the person's current assignments, given by the caller (identity's `assignmentsOf`, which is empty for anyone who is not an active
// Ambassador), and read again on every request: nothing is cached, and a removed assignment takes its building off the home with the next one.
//
// The alerts come from the resident reader (AD-6: the non-drill views, web-published entries only), so the home shows exactly what residents are seeing, drills
// never. The posts come from the person's own entries.
import { and, desc, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { AudienceSchema, type Audience } from "../../../contracts/audience";
import type { Db } from "../../../platform/db";
import { readOpenThreads } from "../adapters/resident/readThreads";
import { coveringEntry } from "../domain/thread";
import { publishedSummaries } from "./threads";
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
  /** Whether the covering entry is a building ambassador's post (S08.02: as frozen with its texts), not the Hub's. */
  fromAmbassador?: boolean;
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

/** An open drill about the person's buildings (S08.02): kept apart, never among the alerts residents read; the ambassador may post practice updates in it. */
export interface AmbassadorDrill {
  alertId: string;
  types: readonly string[];
  /** The English text of the entry that covers the drill. */
  headline: string;
  buildings: readonly string[];
}

export interface AmbassadorHomeView {
  alerts: AmbassadorAlert[];
  posts: AmbassadorPost[];
  /** S08.02: the open drills about their buildings, apart (AD-6): where a practice post goes. */
  drills: AmbassadorDrill[];
}

const POSTS_SHOWN = 20;
const EMPTY: AmbassadorHomeView = { alerts: [], posts: [], drills: [] };

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
          .where(
            and(
              eq(alertEntry.authorId, scope.staffId),
              eq(alert.isDrill, false),
              // Only what `postState` can show, so unsubmitted drafts and withdrawn-before-submit discards never crowd real posts out of the window.
              or(ne(alertEntry.status, "draft"), eq(alertEntry.returnedFor, "return")),
              // A discarded post is shown only when the Hub declined it or its alert closed first (S08.02): never one its author took back.
              or(ne(alertEntry.status, "discarded"), and(isNotNull(alertEntry.submittedAt), inArray(alertEntry.discardReason, ["declined", "by_close"]))),
            ),
          )
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
          fromAmbassador: covering.attribution.role === "ambassador",
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
          discardReason: entry.discardReason,
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
      // The open drills about their buildings (S08.02): read from the staff tables, apart from what residents read, never among the alerts above.
      const drillThreads = await db.select({ id: alert.id }).from(alert).where(and(eq(alert.isDrill, true), eq(alert.status, "open"))).limit(50);
      const drillRows = drillThreads.length === 0 ? [] : await db.select().from(alertEntry).where(inArray(alertEntry.alertId, drillThreads.map((thread) => thread.id)));
      const drills: AmbassadorDrill[] = [];
      for (const thread of drillThreads) {
        const covering = coveringEntry(publishedSummaries(drillRows.filter((row) => row.alertId === thread.id)));
        if (covering === null) continue;
        const audience = AudienceSchema.safeParse(covering.audience);
        if (!audience.success || !audienceCoversAssigned(audience.data, assigned, scope.neighbourhoodOf)) continue;
        drills.push({ alertId: thread.id, types: covering.types, headline: covering.text, buildings: rsnsOf(audience.data, assigned, scope.neighbourhoodOf) });
      }
      return { alerts, posts, drills };
    },
  };
}

export type AmbassadorHome = ReturnType<typeof createAmbassadorHome>;
