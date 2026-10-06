// The statements of the end-of-pilot re-consent campaign (S09.07). Every one runs in the caller's transaction or executor and reads the database's clock
// (`now()`), never the app's: the deadline, a YES at the deadline and the end job are judged by the same clock S09.08's purge uses. No number is selected.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { RECONSENT_PROMPT_KIND, type CampaignState } from "../domain/campaign";
import { campaign, pendingSignup, smsPrompt, subscriber, type CampaignText } from "./schema";

/** A campaign as the use cases read it. */
export interface CampaignRow {
  id: string;
  rehearsal: boolean;
  state: CampaignState;
  deadlineDate: string;
  deadline: Date;
  termsVersion: string;
  texts: Record<string, CampaignText>;
  startedBy: string;
  startedAt: Date;
  idempotencyKey: string;
  endedAt: Date | null;
  signupsReopenedAt: Date | null;
  signupsReopenedBy: string | null;
}

export interface NewCampaign {
  id: string;
  rehearsal: boolean;
  deadlineDate: string;
  termsVersion: string;
  texts: Record<string, CampaignText>;
  startedBy: string;
  startedSession: string;
  idempotencyKey: string;
}

// A fixed seed for the advisory locks that keep sign-ups and the campaign's start apart (see `lockSignupsShared`) and a request from itself (`lockKey`).
const SIGNUP_GATE_SEED = 7_302_118_450;
const SIGNUP_GATE = sql`hashtextextended('subscriptions:signup_gate', ${SIGNUP_GATE_SEED})`;

const columns = {
  id: campaign.id,
  rehearsal: campaign.rehearsal,
  state: campaign.state,
  deadlineDate: campaign.deadlineDate,
  deadline: campaign.deadline,
  termsVersion: campaign.termsVersion,
  texts: campaign.texts,
  startedBy: campaign.startedBy,
  startedAt: campaign.startedAt,
  idempotencyKey: campaign.idempotencyKey,
  endedAt: campaign.endedAt,
  signupsReopenedAt: campaign.signupsReopenedAt,
  signupsReopenedBy: campaign.signupsReopenedBy,
};

const rowOf = (row: Omit<CampaignRow, "state"> & { state: string }): CampaignRow => ({ ...row, state: row.state as CampaignState });

/**
 * The real campaign's deadline has passed, by the database's clock, and the campaign was not cancelled. A campaign the owner cancelled (docs/config.md)
 * asks nobody any more: the subscribers it had moved to `reconsent_pending` keep receiving, are never lapsed (S09.08's purge does not name them) and their
 * YES is answered as any subscriber's, until the owner decides what to do with them.
 */
const DEADLINE_PASSED = sql`exists (select 1 from campaign c where not c.rehearsal and c.state <> 'cancelled' and c.deadline <= now())`;

/** The real campaign is asking (started or ended, not cancelled): a `reconsent_pending` subscriber's YES is a re-consent until the deadline. */
const ASKING = sql`exists (select 1 from campaign c where not c.rehearsal and c.state <> 'cancelled')`;

/**
 * The one rule of who receives texts (E09 "Receiving subscriber"), for a subscriber whose retention state is `state`: `active` and `retained` always;
 * `reconsent_pending` until the real campaign's deadline has passed (by the database's clock), and never after it, even before S09.08's purge deletes them
 * (unless the owner cancelled the campaign: see `DEADLINE_PASSED`). Every query that selects receiving subscribers (the alert fan-out, the hand-off's number
 * source, a resend's check, the measures) builds its condition here. One uncorrelated read of `campaign`, which Postgres runs once per statement.
 */
export function receivingSql(state: unknown) {
  return sql`(${state} in ('active', 'retained') or (${state} = 'reconsent_pending' and not ${DEADLINE_PASSED}))`;
}

/** A `reconsent_pending` subscriber whose campaign's deadline has passed (a campaign not cancelled): they receive nothing, and S09.08's purge deletes them. */
export function lapsedSql(state: unknown) {
  return sql`(${state} = 'reconsent_pending' and ${DEADLINE_PASSED})`;
}

/** Sign-ups are closed from the real campaign's start until an Admin reopens them (a cancelled campaign closes nothing). */
const SIGNUPS_CLOSED = sql`exists (select 1 from campaign c where not c.rehearsal and c.state <> 'cancelled' and c.signups_reopened_at is null)`;

export const campaignStore = {
  /** The deadline a campaign started now would have (`YYYY-MM-DD`): the Toronto day 30 days on, by the database's clock (the guard checks the same). */
  async deadlineDateNow(executor: DbExecutor, days: number): Promise<string> {
    const [row] = await executor.execute<{ day: string }>(sql`select ((now() at time zone 'America/Toronto')::date + ${days}::int)::text as day`);
    return row!.day;
  },

  /**
   * The sign-up gate, shared: a sign-up (web, staff-assisted) and a YES that confirms a pending sign-up take it, so the campaign's start (which takes it
   * exclusively) waits for them and then deletes what they made, or they wait for the start and then find sign-ups closed. Nothing is written.
   */
  async lockSignupsShared(tx: DbTransaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${SIGNUP_GATE})`);
  },

  /** The sign-up gate, exclusive: the campaign's start and the reopening of sign-ups. */
  async lockSignupsExclusive(tx: DbTransaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${SIGNUP_GATE})`);
  },

  /**
   * One request's lock, on its idempotency key: a rehearsal sent twice at once (a double submit before the page's script has loaded) runs one after the
   * other, so the second finds the first's row by its key instead of failing on `campaign_idempotency_key_unique`. (The start holds the sign-up gate.)
   */
  async lockKey(tx: DbTransaction, key: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`subscriptions:campaign_key:${key}`}, ${SIGNUP_GATE_SEED}))`);
  },

  async signupsClosed(executor: DbExecutor): Promise<boolean> {
    const [row] = await executor.execute<{ closed: boolean }>(sql`select ${SIGNUPS_CLOSED} as closed`);
    return row!.closed;
  },

  /** Whether the real campaign's deadline has passed, by the database's clock (false while there is none, and for a cancelled one). */
  async pastDeadline(executor: DbExecutor): Promise<boolean> {
    const [row] = await executor.execute<{ past: boolean }>(sql`select ${DEADLINE_PASSED} as past`);
    return row!.past;
  },

  /** The real campaign (there is at most one), or null. */
  async real(executor: DbExecutor): Promise<CampaignRow | null> {
    const [row] = await executor.select(columns).from(campaign).where(eq(campaign.rehearsal, false));
    return row ? rowOf(row) : null;
  },

  /** The most recent rehearsal, or null. */
  async latestRehearsal(executor: DbExecutor): Promise<CampaignRow | null> {
    const [row] = await executor.select(columns).from(campaign).where(eq(campaign.rehearsal, true)).orderBy(desc(campaign.startedAt), desc(campaign.id)).limit(1);
    return row ? rowOf(row) : null;
  },

  /** The campaign a request with this idempotency key made, or null. */
  async byKey(executor: DbExecutor, key: string): Promise<CampaignRow | null> {
    const [row] = await executor.select(columns).from(campaign).where(eq(campaign.idempotencyKey, key));
    return row ? rowOf(row) : null;
  },

  async byId(executor: DbExecutor, id: string): Promise<CampaignRow | null> {
    const [row] = await executor.select(columns).from(campaign).where(eq(campaign.id, id));
    return row ? rowOf(row) : null;
  },

  /** Inserts a campaign; the database checks who started it, at which level, the deadline, the texts and the rehearsal (`campaign_guard()`). */
  async insert(tx: DbTransaction, row: NewCampaign): Promise<CampaignRow> {
    const [inserted] = await tx
      .insert(campaign)
      .values({ ...row, deadline: sql`campaign_deadline_of(${row.deadlineDate}::date)` as unknown as Date, startedAal: "aal2" })
      .returning(columns);
    return rowOf(inserted!);
  },

  /** How many `active` subscribers there are in each language: those a campaign started now would ask. */
  async activeByLanguage(executor: DbExecutor): Promise<Record<string, number>> {
    const rows = await executor
      .select({ lang: subscriber.lang, n: sql<number>`count(*)::int` })
      .from(subscriber)
      .where(eq(subscriber.retentionState, "active"))
      .groupBy(subscriber.lang);
    return Object.fromEntries(rows.map((row) => [row.lang, row.n]));
  },

  /**
   * The `active` subscribers, their rows locked `FOR NO KEY UPDATE` in id order (AD-18; the approval's capture locks them `FOR SHARE` in the same order, and a
   * deletion that holds one makes this wait and then find it gone). Ids and languages only.
   */
  async lockActive(tx: DbTransaction): Promise<{ id: string; lang: string }[]> {
    return tx.select({ id: subscriber.id, lang: subscriber.lang }).from(subscriber).where(eq(subscriber.retentionState, "active")).orderBy(asc(subscriber.id)).for("no key update");
  },

  /** `active -> reconsent_pending` for these subscribers (their rows are locked); returns those it moved. */
  async askToReconsent(tx: DbTransaction, ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const moved = await tx
      .update(subscriber)
      .set({ retentionState: "reconsent_pending" })
      .where(and(inArray(subscriber.id, [...ids]), eq(subscriber.retentionState, "active")))
      .returning({ id: subscriber.id });
    return moved.map((row) => row.id);
  },

  /**
   * Each subscriber's re-consent prompt, open until the deadline; it replaces any prompt they had open (one per subscriber, latest `sent_at`). The rows are
   * locked (`lockActive`), and the inbound router locks the row before it writes a prompt (`subscriberStore.openNewPrompt`), so a prompt opened meanwhile has
   * committed before the delete reads, and none is inserted until this transaction ends.
   */
  async openReconsentPrompts(tx: DbTransaction, ids: readonly string[], deadline: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx.delete(smsPrompt).where(inArray(smsPrompt.subscriberId, [...ids]));
    for (let at = 0; at < ids.length; at += 500) {
      await tx.insert(smsPrompt).values(ids.slice(at, at + 500).map((subscriberId) => ({ subscriberId, kind: RECONSENT_PROMPT_KIND, expiresAt: deadline })));
    }
  },

  /**
   * Every pending sign-up's id, in id order (the start deletes them all, each after skipping its waiting confirmation: AD-18's delivery rows before the
   * recipient's row, so the row is not locked here). Under the sign-up gate no new one can appear.
   */
  async pendingSignupIds(tx: DbTransaction): Promise<string[]> {
    const rows = await tx.select({ id: pendingSignup.id }).from(pendingSignup).orderBy(asc(pendingSignup.id));
    return rows.map((row) => row.id);
  },

  async deletePendingSignup(tx: DbTransaction, id: string): Promise<boolean> {
    const deleted = await tx.delete(pendingSignup).where(eq(pendingSignup.id, id)).returning({ id: pendingSignup.id });
    return deleted.length > 0;
  },

  /** Subscribers by where the campaign has them now: asked and not yet answered, said YES, and asked but past the deadline. */
  async retentionCounts(executor: DbExecutor): Promise<{ asked: number; kept: number; active: number; lapsed: number }> {
    const [row] = await executor.execute<{ asked: number; kept: number; active: number; lapsed: number }>(sql`
      select count(*) filter (where s.retention_state = 'reconsent_pending' and not ${lapsedSql(sql`s.retention_state`)})::int as asked,
             count(*) filter (where s.retention_state = 'retained')::int as kept,
             count(*) filter (where s.retention_state = 'active')::int as active,
             count(*) filter (where ${lapsedSql(sql`s.retention_state`)})::int as lapsed
      from subscriber s`);
    return row!;
  },

  /**
   * Where a subscriber stands in the campaign, by the database's clock: `open` (asked, before the deadline: a YES keeps them), `lapsed` (asked, the
   * deadline passed: they receive nothing until the purge deletes them), or null (not asked, they said YES, or the owner cancelled the campaign).
   */
  async reconsentOf(tx: DbTransaction, subscriberId: string): Promise<"open" | "lapsed" | null> {
    const [row] = await tx.execute<{ standing: "open" | "lapsed" | null }>(sql`
      select case when s.retention_state <> 'reconsent_pending' then null
                  when ${lapsedSql(sql`s.retention_state`)} then 'lapsed'
                  when ${ASKING} then 'open'
                  else null end as standing
      from subscriber s where s.id = ${subscriberId}`);
    return row?.standing ?? null;
  },

  /**
   * YES before the deadline: `reconsent_pending -> retained` under the real campaign's terms version, in one statement that takes the subscriber's row
   * lock and compares the deadline with the database's clock (S09.08's purge re-checks the same under the same lock, so a YES committed first is
   * kept and one after the deadline changes nothing). The re-consent prompt is closed. True when the subscriber was kept.
   */
  async retain(tx: DbTransaction, subscriberId: string): Promise<boolean> {
    const kept = await tx.execute<{ id: string }>(sql`
      update subscriber s set retention_state = 'retained', consent_version = c.terms_version
      from campaign c
      where s.id = ${subscriberId} and s.retention_state = 'reconsent_pending'
        and not c.rehearsal and c.state = 'started' and now() < c.deadline
      returning s.id`);
    if (kept.length === 0) return false;
    await tx.delete(smsPrompt).where(and(eq(smsPrompt.subscriberId, subscriberId), eq(smsPrompt.kind, RECONSENT_PROMPT_KIND)));
    return true;
  },

  /** Ends every campaign and rehearsal whose deadline has passed (the database refuses an earlier end); returns those it ended. */
  async endDue(tx: DbTransaction): Promise<{ id: string; rehearsal: boolean }[]> {
    return tx
      .update(campaign)
      .set({ state: "ended" })
      .where(and(eq(campaign.state, "started"), sql`${campaign.deadline} <= now()`))
      .returning({ id: campaign.id, rehearsal: campaign.rehearsal });
  },

  /** The real campaign's row locked `FOR UPDATE`, or null. */
  async lockReal(tx: DbTransaction): Promise<CampaignRow | null> {
    const [row] = await tx.select(columns).from(campaign).where(eq(campaign.rehearsal, false)).for("update");
    return row ? rowOf(row) : null;
  },

  /** Reopens sign-ups after the campaign ended; the database stamps the time and checks the Admin and the state. */
  async reopenSignups(tx: DbTransaction, id: string, adminId: string): Promise<Date> {
    const [row] = await tx.update(campaign).set({ signupsReopenedBy: adminId }).where(eq(campaign.id, id)).returning({ at: campaign.signupsReopenedAt });
    return row!.at!;
  },

  /**
   * Whether a campaign text is still sendable at the hand-off point (E06 "Sendable (campaign)", the dispatcher's `CampaignStandingReader`): started by an
   * Admin at aal2 who is still an active Admin and not cancelled (`delivery_campaign_started_by_admin`), running (before its deadline), and, for the real
   * campaign, the subscriber still in the target state (`reconsent_pending`); a rehearsal's recipient is a drill-roster member, whom the number source checks.
   */
  async sendable(tx: DbTransaction, input: { campaignId: string; recipientId: string | null }): Promise<boolean> {
    if (input.recipientId === null) return false;
    const [row] = await tx.execute<{ sendable: boolean }>(sql`
      select coalesce((
        select delivery_campaign_started_by_admin(c.id) and c.state = 'started' and now() < c.deadline
               and (c.rehearsal or exists (select 1 from subscriber s where s.id = ${input.recipientId}::uuid and s.retention_state = 'reconsent_pending'))
        from campaign c where c.id = ${input.campaignId}::uuid
      ), false) as sendable`);
    return row?.sendable ?? false;
  },
};

export type CampaignStore = typeof campaignStore;
