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
  /** S08.04: the alert is about exactly one building, one they are assigned to, so they may write its final message ("Mark resolved"). */
  canResolve?: boolean;
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
    /** One of the person's own posts and where it stands (A-03, S08.04); null for anything that is not theirs to see. */
    status: (scope: AmbassadorScope, entryId: string) => readPostStatus(db, scope, entryId),
    /** The alert "Mark resolved" is for (S08.04): its covering words and whether a final message already waits; null when it is not theirs to resolve. */
    resolvable: (scope: AmbassadorScope, alertId: string) => readResolvable(db, scope, alertId),
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
          canResolve: audience.data.scope === "buildings" && audience.data.buildings.length === 1 && assigned.has(audience.data.buildings[0].rsn),
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
                  // A replacer is approved (or superseded since), or is the system withdrawal that took the place of a web-published post that was discarded (S08.03): "Withdrawn".
                  inArray(alertEntry.status, ["approved", "superseded", "published_system"]),
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
      // The open drills about their buildings (S08.02): read from the staff tables, apart from what residents read, never among the alerts above. Newest first, by
      // when each drill was reported (ties by id), so the list keeps one order from one request to the next.
      const drillThreads = await db
        .select({ id: alert.id })
        .from(alert)
        .where(and(eq(alert.isDrill, true), eq(alert.status, "open")))
        .orderBy(desc(alert.reportedAt), desc(alert.id))
        .limit(50);
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

/** What replaced one of the person's posts, or is waiting to (S08.04). */
export interface PostReplacement {
  entryId: string;
  kind: "correction" | "withdrawal";
  /** The words residents read in its place. */
  text: string;
  at: Date;
}

/** One of the person's own posts as its status screen (A-03) shows it. */
export interface AmbassadorPostStatus {
  entryId: string;
  alertId: string;
  slug: string;
  kind: string;
  types: readonly string[];
  text: string;
  phase: string;
  state: AmbassadorPostState;
  /** The note an approver wrote when sending it back; only for a returned post. */
  note: string | null;
  /** The buildings the post is for, each with the floor ids it names (null: the whole building). */
  buildings: readonly { rsn: string; floors: readonly string[] | null }[];
  postedAt: Date;
  approvedAt: Date | null;
  validUntil: Date;
  /** The approved correction or withdrawal that replaced it: what residents read now instead. */
  replacedWith: PostReplacement | null;
  /** A correction or withdrawal of it that was submitted and waits for the Hub. */
  waitingReplacement: PostReplacement | null;
  /** A final message of the thread that was submitted and waits for the Hub (anyone's). */
  waitingFinal: boolean;
  threadOpen: boolean;
  /**
   * What the person may do with it now (S08.04): correct or withdraw it (E05's rules: their own pending post that residents already read, in an open thread, with
   * nothing already replacing it or waiting to), and mark the alert resolved (an open thread about their one building, with something residents read and no final
   * waiting). The use cases judge both again under the thread's lock.
   */
  can: { replace: boolean; resolve: boolean };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The entry that covers a thread (what residents read as current) when the thread is about exactly one building and the person is assigned to it: the only
 * alert an Ambassador writes the final message of, because the final is attributed to one building ("Building ambassador, {building}"). Null otherwise.
 */
function resolvableCovering(rows: readonly (typeof alertEntry.$inferSelect)[], assigned: ReadonlySet<string>) {
  const covering = coveringEntry(publishedSummaries(rows));
  if (covering === null) return null;
  const audience = AudienceSchema.safeParse(covering.audience);
  return audience.success && audience.data.scope === "buildings" && audience.data.buildings.length === 1 && assigned.has(audience.data.buildings[0].rsn) ? covering : null;
}

/**
 * What "Mark resolved" is for: an open, real (non-drill) thread that covers exactly one building the person is assigned to now, and whether a final message of it
 * already waits for the Hub. Null for anything else, and nothing says which (a thread that is not theirs, a drill, a closed one, a missing one).
 */
export async function readResolvable(db: Db, scope: AmbassadorScope, alertId: string): Promise<{ headline: string; waitingFinal: boolean } | null> {
  const assigned = new Set(scope.assignedRsns);
  if (assigned.size === 0 || !UUID.test(alertId)) return null;
  const [thread] = await db.select().from(alert).where(and(eq(alert.id, alertId), eq(alert.isDrill, false), eq(alert.status, "open")));
  if (!thread) return null;
  const rows = await db.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id));
  const covering = resolvableCovering(rows, assigned);
  return covering === null ? null : { headline: covering.text, waitingFinal: rows.some((row) => row.kind === "final" && row.status === "pending_approval") };
}

/**
 * One of the person's own posts and where it stands, for A-03. Only their own entry, in a real (non-drill) thread, for buildings they are all still assigned to:
 * anyone else's entry, a drill's, a missing one and one outside their assignments all read as null, and nothing says which.
 */
export async function readPostStatus(db: Db, scope: AmbassadorScope, entryId: string): Promise<AmbassadorPostStatus | null> {
  const assigned = new Set(scope.assignedRsns);
  if (assigned.size === 0 || !UUID.test(entryId)) return null;
  const [found] = await db
    .select({ entry: alertEntry, thread: alert })
    .from(alertEntry)
    .innerJoin(alert, eq(alert.id, alertEntry.alertId))
    .where(and(eq(alertEntry.id, entryId), eq(alertEntry.authorId, scope.staffId), eq(alert.isDrill, false)));
  if (!found) return null;
  const { entry, thread } = found;
  const audience = AudienceSchema.safeParse(entry.audience);
  if (!audience.success || audience.data.scope !== "buildings" || !postIsInScope(audience.data, assigned)) return null;
  const rows = await db.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id));
  type Row = (typeof rows)[number];
  const replacers = rows.filter((row) => row.supersedesId === entry.id && (row.kind === "correction" || row.kind === "withdrawal"));
  const newest = (list: Row[]): Row | null => [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))[0] ?? null;
  const settled = replacers.filter((row) => ["approved", "superseded", "published_system"].includes(row.status));
  // A withdrawal outranks a correction of the same entry (the entry is gone), as on the home.
  const replacer = newest(settled.filter((row) => row.kind === "withdrawal")) ?? newest(settled);
  const waiting = newest(replacers.filter((row) => row.status === "pending_approval"));
  const state = postState({
    status: entry.status,
    submittedAt: entry.submittedAt,
    approvedAt: entry.approvedAt,
    webPublishedAt: entry.webPublishedAt,
    returnedFor: entry.returnedFor,
    discardReason: entry.discardReason,
    replacedBy: replacer === null ? null : (replacer.kind as "correction" | "withdrawal"),
  });
  if (state === null) return null;
  const replacement = (row: Row, withText = true): PostReplacement => ({ entryId: row.id, kind: row.kind as "correction" | "withdrawal", text: withText ? row.originalText : "", at: row.webPublishedAt ?? row.approvedAt ?? row.createdAt });
  const threadOpen = thread.status === "open";
  const waitingFinal = rows.some((row) => row.kind === "final" && row.status === "pending_approval");
  const resolvable = threadOpen && resolvableCovering(rows, assigned) !== null;
  return {
    entryId: entry.id,
    alertId: thread.id,
    slug: thread.slug ?? "",
    kind: entry.kind,
    types: entry.types,
    text: entry.originalText,
    phase: entry.phase,
    state,
    note: state === "returned" ? entry.returnedNote : null,
    buildings: audience.data.buildings.map((building) => ({ rsn: building.rsn, floors: building.floors })),
    postedAt: entry.submittedAt ?? entry.createdAt,
    approvedAt: entry.approvedAt,
    validUntil: entry.validUntil,
    replacedWith: replacer === null ? null : replacement(replacer),
    // What waits is not approved yet: the ambassador learns that it waits, never its words.
    waitingReplacement: waiting === null ? null : replacement(waiting, false),
    waitingFinal,
    threadOpen,
    can: {
      replace:
        threadOpen &&
        entry.status === "pending_approval" &&
        entry.webPublishedAt !== null &&
        (entry.kind === "ack" || entry.kind === "update" || entry.kind === "correction") &&
        waiting === null &&
        replacer === null,
      resolve: resolvable && !waitingFinal,
    },
  };
}

export type AmbassadorHome = ReturnType<typeof createAmbassadorHome>;
