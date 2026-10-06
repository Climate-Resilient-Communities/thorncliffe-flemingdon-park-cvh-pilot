// The statements of a resident's access request (S09.03): everything subscriptions holds for one number, found by the number and read back without it, the
// catalog reads that find what holds a number's records and the lookup does not read yet, the database's clock, and the advisory lock of one request. Every
// statement runs in the caller's executor (the lookup's read-only transaction); none writes a row.
import { and, asc, count, eq, max, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { inboundReply, pendingSignup, rateLimit, smsPrompt, subscriber, subscriberPlace, subscriberTopicOptout, type PendingPlace } from "./schema";

// A fixed seed for the advisory lock of one request, so it never meets another lock on a hash of the same text.
const REQUEST_LOCK_SEED = 9_031_303_771;

/** Whose records a table holds: a subscriber's, a pending sign-up's, or a waiting reply's (each found by the number). */
export type HoldingOwner = "subscriber" | "pending_signup" | "inbound_reply";

/**
 * Every column of the tables that hold a number's records, as the lookup accounts for it: shown on screen, or the number itself, a row's id, a link between
 * rows, or a prompt's own place in its steps. A column a later story adds (E08's check-in request on the subscriber, the pending sign-up or a place, for
 * example) is not here until the lookup shows it, and `unreadHoldings` reports it, so a request is never answered as complete while part of it goes unread.
 */
export const LOOKUP_COLUMNS: Readonly<Record<string, { owner: HoldingOwner; columns: readonly string[] }>> = {
  subscriber: { owner: "subscriber", columns: ["id", "phone", "lang", "neighbourhood_id", "groups", "consent_version", "started_by", "retention_state", "created_at"] },
  subscriber_place: { owner: "subscriber", columns: ["id", "subscriber_id", "rsn", "floor_id"] },
  subscriber_topic_optout: { owner: "subscriber", columns: ["subscriber_id", "topic"] },
  sms_prompt: { owner: "subscriber", columns: ["subscriber_id", "kind", "step", "sent_at", "expires_at"] },
  pending_signup: {
    owner: "pending_signup",
    columns: ["id", "phone", "lang", "neighbourhood_id", "places", "groups", "topics", "consent_version", "started_by", "created_at", "expires_at"],
  },
  inbound_reply: { owner: "inbound_reply", columns: ["id", "phone", "created_at", "expires_at"] },
};

/** A table that refers to one of those and is read anyway: E08's check-ins, through the lookup's `CheckinRecords` port (or reported unreadable). */
const READ_THROUGH_PORTS: readonly string[] = ["checkin"];

export interface HeldSubscriberRow {
  id: string;
  since: Date;
  lang: string;
  neighbourhoodId: string;
  groups: string[];
  consentVersion: string;
  startedBy: string;
  retentionState: string;
}

export interface HeldPendingRow {
  id: string;
  since: Date;
  expiresAt: Date;
  expired: boolean;
  lang: string;
  neighbourhoodId: string;
  places: PendingPlace[];
  groups: string[];
  topics: string[];
  consentVersion: string;
  startedBy: string;
}

export const accessRequestStore = {
  /** One change to a request at a time: a close and a deletion of the same request, run at once, are judged one after the other. Nothing is written. */
  async lockRequest(tx: DbTransaction, id: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`access_request:${id}`}, ${REQUEST_LOCK_SEED}))`);
  },

  async subscriberOf(executor: DbExecutor, phone: string): Promise<HeldSubscriberRow | null> {
    const [row] = await executor
      .select({
        id: subscriber.id,
        since: subscriber.createdAt,
        lang: subscriber.lang,
        neighbourhoodId: subscriber.neighbourhoodId,
        groups: subscriber.groups,
        consentVersion: subscriber.consentVersion,
        startedBy: subscriber.startedBy,
        retentionState: subscriber.retentionState,
      })
      .from(subscriber)
      .where(eq(subscriber.phone, phone));
    return row ?? null;
  },

  /** The subscriber's places: one row per building and floor, a null floor for "no floor recorded there". */
  async placesOf(executor: DbExecutor, subscriberId: string): Promise<{ rsn: string; floorId: string | null }[]> {
    return executor
      .select({ rsn: subscriberPlace.rsn, floorId: subscriberPlace.floorId })
      .from(subscriberPlace)
      .where(eq(subscriberPlace.subscriberId, subscriberId))
      .orderBy(asc(subscriberPlace.rsn), asc(subscriberPlace.floorId));
  },

  async mutedTopicsOf(executor: DbExecutor, subscriberId: string): Promise<string[]> {
    const rows = await executor
      .select({ topic: subscriberTopicOptout.topic })
      .from(subscriberTopicOptout)
      .where(eq(subscriberTopicOptout.subscriberId, subscriberId))
      .orderBy(asc(subscriberTopicOptout.topic));
    return rows.map((row) => row.topic);
  },

  /** The subscriber's prompt (kind and until when), or null; one that has run out and waits for the purge is still held, so it is listed. */
  async promptOf(executor: DbExecutor, subscriberId: string): Promise<{ kind: string; until: Date } | null> {
    const [row] = await executor.select({ kind: smsPrompt.kind, until: smsPrompt.expiresAt }).from(smsPrompt).where(eq(smsPrompt.subscriberId, subscriberId));
    return row ?? null;
  },

  /** The number's pending sign-up, expired or not (an expired one is held until the purge). */
  async pendingOf(executor: DbExecutor, phone: string): Promise<HeldPendingRow | null> {
    const [row] = await executor
      .select({
        id: pendingSignup.id,
        since: pendingSignup.createdAt,
        expiresAt: pendingSignup.expiresAt,
        expired: sql<boolean>`${pendingSignup.expiresAt} <= now()`,
        lang: pendingSignup.lang,
        neighbourhoodId: pendingSignup.neighbourhoodId,
        places: pendingSignup.places,
        groups: pendingSignup.groups,
        topics: pendingSignup.topics,
        consentVersion: pendingSignup.consentVersion,
        startedBy: pendingSignup.startedBy,
      })
      .from(pendingSignup)
      .where(eq(pendingSignup.phone, phone));
    return row ?? null;
  },

  async repliesOf(executor: DbExecutor, phone: string): Promise<{ id: string; since: Date; expiresAt: Date }[]> {
    return executor
      .select({ id: inboundReply.id, since: inboundReply.createdAt, expiresAt: inboundReply.expiresAt })
      .from(inboundReply)
      .where(eq(inboundReply.phone, phone))
      .orderBy(asc(inboundReply.createdAt));
  },

  /** The scopes `rate_limit` holds rows under now: a keyed hash of the number is looked for under each, since the scope is part of what is hashed. */
  async hashScopes(executor: DbExecutor): Promise<string[]> {
    const rows = await executor.selectDistinct({ scope: rateLimit.scope }).from(rateLimit).orderBy(asc(rateLimit.scope));
    return rows.map((row) => row.scope);
  },

  /** For each (scope, hash) given, how many rows hold it and the latest; a scope with none is left out. */
  async hashTraces(executor: DbExecutor, hashes: readonly { scope: string; hash: string }[]): Promise<{ scope: string; count: number; latest: Date }[]> {
    const found: { scope: string; count: number; latest: Date }[] = [];
    for (const { scope, hash } of hashes) {
      const [row] = await executor
        .select({ n: count(), latest: max(rateLimit.at) })
        .from(rateLimit)
        .where(and(eq(rateLimit.scope, scope), eq(rateLimit.clientHash, hash)));
      if (row && Number(row.n) > 0 && row.latest) found.push({ scope, count: Number(row.n), latest: row.latest });
    }
    return found;
  },

  /**
   * What holds a number's records and the lookup does not read: a column of one of `LOOKUP_COLUMNS`' tables that is not in its list, and a table that refers
   * to one of them (a foreign key) and is neither one of them nor read through a port. Catalog reads only, which every role may make.
   */
  async unreadHoldings(executor: DbExecutor): Promise<{ owner: HoldingOwner; what: string }[]> {
    const names = sql.join(
      Object.keys(LOOKUP_COLUMNS).map((table) => sql`${table}`),
      sql`, `,
    );
    const columns = await executor.execute<{ table: string; column: string }>(sql`
      select c.relname as "table", a.attname as "column"
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in (${names}) and a.attnum > 0 and not a.attisdropped
       order by c.relname, a.attnum`);
    const referrers = await executor.execute<{ table: string; refers: string }>(sql`
      select distinct child.relname as "table", parent.relname as "refers"
        from pg_constraint co
        join pg_class child on child.oid = co.conrelid
        join pg_class parent on parent.oid = co.confrelid
        join pg_namespace n on n.oid = parent.relnamespace
       where co.contype = 'f' and n.nspname = 'public' and parent.relname in (${names})
       order by 1, 2`);
    return [
      ...[...columns]
        .filter((row) => !LOOKUP_COLUMNS[row.table]!.columns.includes(row.column))
        .map((row) => ({ owner: LOOKUP_COLUMNS[row.table]!.owner, what: `${row.table}.${row.column}` })),
      ...[...referrers]
        .filter((row) => !(row.table in LOOKUP_COLUMNS) && !READ_THROUGH_PORTS.includes(row.table))
        .map((row) => ({ owner: LOOKUP_COLUMNS[row.refers]!.owner, what: `the table ${row.table} (it refers to ${row.refers})` })),
    ];
  },

  /** The database's clock: a request's days open are counted by it, as the weekly review counts them. */
  async now(executor: DbExecutor): Promise<Date> {
    const [row] = await executor.execute<{ now: Date | string }>(sql`select now() as now`);
    return new Date(row!.now);
  },

  /** Whether a table exists in the public schema: a catalog read, not a read of the table. */
  async tableExists(executor: DbExecutor, name: string): Promise<boolean> {
    const rows = await executor.execute<{ found: boolean }>(sql`select to_regclass(${`public.${name}`}) is not null as found`);
    return rows[0]?.found === true;
  },
};

export type AccessRequestStore = typeof accessRequestStore;
