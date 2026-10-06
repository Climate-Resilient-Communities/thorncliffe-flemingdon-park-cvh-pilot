// The end-of-pilot re-consent campaign (S09.07; FR-D-7, AR-13, AR-12; E09 definitions "Campaign", "Re-consent prompt", "Receiving subscriber"; spine AD-9 D-7).
//
//  - `rehearse`: the rehearsal on the drill roster (S06.05's drill rule: staff phones only, in production too): a campaign row marked `rehearsal` and one
//    campaign text per roster member, exactly the text subscribers will get, in the member's language (English where the member's language has no text).
//    It changes no subscriber and no sign-up, and the database refuses the real start until one exists.
//  - `start`: one Admin at aal2 (the staff guard's `campaign.run`; the database reads the Admin's own session, and refuses anything else) with the request's
//    idempotency key, in ONE transaction that first takes the sign-up gate exclusively (application/campaignGate.ts): the campaign row (frozen texts, terms
//    version, deadline), every `active` subscriber locked in id order and moved to `reconsent_pending`, a `reconsent` prompt each (open until the deadline),
//    one `campaign` text each in their language (key `campaign:{id}:reconsent:{subscriber}`), every pending sign-up deleted (its waiting confirmation
//    skipped first), sign-ups closed (the campaign row is what closes them), the spend cap judged (it warns, never blocks, S07.08) and `campaign.started`
//    audited with counts. A retried request (the same key) finds its campaign and changes nothing; a second start (another key) finds the campaign and is
//    refused, audited as a conflict.
//  - `reopenSignups`: after the campaign has ended, an Admin reopens sign-ups for the MVP (audited `signup.reopened`).
//  - `endDue`: the end job: every campaign and rehearsal whose deadline has passed becomes `ended`, by the database's clock; the real one is audited
//    `campaign.ended` with how many stayed and how many did not reply. Deleting those who did not reply is S09.08's purge (`lapsedSql` in campaignStore.ts).
//  - `campaignStandingReader`: the sender's check at the hand-off point (E06 "Sendable (campaign)").
//
// Nothing here reads or writes a phone number; the audit trail holds counts and ids of staff and campaigns only.
import { LAUNCH_CODES, type LaunchCode } from "../../../i18n/languages";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { AuditEvent } from "../../audit";
import type { CampaignStandingReader, CampaignTextInput, DeliveryResult, Enqueued, RecipientKind, SkippedForRecipient } from "../../messaging";
import { campaignStore, type CampaignRow, type CampaignStore } from "../adapters/campaignStore";
import { drillRosterStore } from "../adapters/drillRosterStore";
import {
  RECONSENT_DAYS,
  RECONSENT_PURPOSE,
  campaignTexts,
  estimateCampaign,
  textCostCents,
  type CampaignEstimate,
  type CampaignRefusal,
  type CampaignTexts,
} from "../domain/campaign";
import { bodyLangOf } from "../domain/drillRoster";
import { residentSms } from "./inbound";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUBJECT_TYPE = "campaign";

type CampaignAction = "campaign.rehearsed" | "campaign.started" | "campaign.ended" | "signup.reopened" | "spend.cap_overrun";
type RefusalReason = "validation" | "conflict" | "not_available" | "not_found" | "rehearsal_needed";

/** How each refusal is recorded in the audit trail (a code; the words the Admin reads are the Hub's). */
const REASON: Record<CampaignRefusal, RefusalReason> = {
  key_invalid: "validation",
  not_confirmed: "validation",
  deadline_changed: "conflict",
  already_started: "conflict",
  not_ended: "conflict",
  already_reopened: "conflict",
  terms_unavailable: "not_available",
  no_campaign: "not_found",
  rehearsal_needed: "rehearsal_needed",
  roster_empty: "not_available",
};

export interface CampaignAudit {
  record(tx: DbTransaction, event: AuditEvent<CampaignAction>): Promise<unknown>;
  recordRefusal(db: Db, event: { action: CampaignAction; actorStaffId: string | null; subjectType: string; subjectId: string | null; meta: { reason: RefusalReason } }): Promise<unknown>;
}

/** The spend cap's check of the campaign's texts (S07.08, wired to spend's assessment): how far they take the month past the cap, or null. It never refuses. */
export type CampaignSpendCap = (tx: DbTransaction, input: { campaignId: string; estimateCents: number; now: Date }) => Promise<{ overCents: number; capCents: number } | null>;

export interface CampaignDeps {
  db: Db;
  /** messaging's `createDeliveryQueue().enqueueCampaignDelivery`. */
  enqueue: (tx: DbTransaction, input: CampaignTextInput) => Promise<DeliveryResult<Enqueued>>;
  /** messaging's `createDeliveryQueue().skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  /** The terms version the subscribers who stay accept (the one a sign-up records now), or null when none may be recorded. */
  termsVersion: () => string | null;
  pricePerSegmentCents: () => number;
  audit: CampaignAudit;
  spendCap?: CampaignSpendCap;
  store?: CampaignStore;
  newId?: () => string;
  now?: () => Date;
}

/** A campaign as the Hub shows it. */
export interface CampaignSummary {
  id: string;
  deadlineDate: string;
  state: CampaignRow["state"];
  startedBy: string;
  startedAt: Date;
  endedAt: Date | null;
  signupsReopenedAt: Date | null;
  signupsReopenedBy: string | null;
}

/** What the Hub's End of the pilot page shows before and after the start. */
export interface CampaignOverview {
  /** The deadline a campaign started now would have (the Toronto day, `YYYY-MM-DD`). */
  deadlineDate: string;
  /** The texts a campaign started now would freeze. */
  texts: CampaignTexts;
  /** The `active` subscribers by language, and the estimate of their texts: whom starting now would ask. */
  estimate: CampaignEstimate;
  rosterSize: number;
  rehearsal: CampaignSummary | null;
  campaign: CampaignSummary | null;
  signupsClosed: boolean;
  /** Subscribers by where the campaign has them: asked (before the deadline), stayed, active (not asked), asked past the deadline. */
  counts: { asked: number; kept: number; active: number; lapsed: number };
  termsVersion: string | null;
}

export type RehearseOutcome = { kind: "rehearsed"; campaign: CampaignSummary; texts: number; replayed: boolean } | { kind: "refused"; reason: CampaignRefusal; deadlineDate?: string };

export type StartOutcome =
  | {
      kind: "started";
      campaign: CampaignSummary;
      /** Subscribers asked, texts queued (one each) and pending sign-ups deleted. */
      asked: number;
      texts: number;
      pendingDeleted: number;
      costCents: number;
      overrun: { overCents: number; capCents: number } | null;
    }
  /** The same request again (its idempotency key): nothing changed. */
  | { kind: "already_started"; campaign: CampaignSummary }
  | { kind: "refused"; reason: CampaignRefusal; deadlineDate?: string };

export type ReopenOutcome = { kind: "reopened"; at: Date } | { kind: "refused"; reason: CampaignRefusal };

/** What the end job did: campaigns ended (the real one and rehearsals), and for the real one the subscribers who stayed and who did not reply. */
export interface EndReport {
  ended: number;
  real: { kept: number; lapsed: number } | null;
}

export interface StartInput {
  /** The Admin the guard let through, and their session (the database reads its level itself). */
  actorStaffId: string;
  sessionId: string;
  /** The request's idempotency key, made when the page was rendered. */
  idempotencyKey: unknown;
  /** The deadline the Admin was shown. */
  deadlineSeen: unknown;
  /** The Admin ticked that they checked the rehearsal, the deadline, the numbers and the cost. */
  confirmed: boolean;
}

export interface Campaigns {
  overview(executor?: DbExecutor): Promise<CampaignOverview>;
  rehearse(input: Omit<StartInput, "confirmed">): Promise<RehearseOutcome>;
  start(input: StartInput): Promise<StartOutcome>;
  reopenSignups(input: { actorStaffId: string }): Promise<ReopenOutcome>;
  endDue(): Promise<EndReport>;
}

const summaryOf = (row: CampaignRow): CampaignSummary => ({
  id: row.id,
  deadlineDate: row.deadlineDate,
  state: row.state,
  startedBy: row.startedBy,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  signupsReopenedAt: row.signupsReopenedAt,
  signupsReopenedBy: row.signupsReopenedBy,
});

/** The campaign text in a language with the deadline filled in, normalised and counted as every outbound text is (AD-21). */
export const renderCampaignText = (lang: LaunchCode, date: string) => residentSms(lang, "reconsent", { date });

/** A refusal found inside a transaction, carried out of it (nothing it wrote is kept). */
class Refused extends Error {
  override name = "Refused";
  constructor(
    readonly reason: CampaignRefusal,
    readonly deadlineDate?: string,
  ) {
    super(reason);
  }
}

export function createCampaigns(deps: CampaignDeps): Campaigns {
  const { db, audit } = deps;
  const store = deps.store ?? campaignStore;
  const newId = deps.newId ?? (() => uuidv7());
  const now = deps.now ?? (() => new Date());

  const refusal = async (action: CampaignAction, actorStaffId: string, reason: CampaignRefusal, subjectId: string | null = null) => {
    await audit.recordRefusal(db, { action, actorStaffId, subjectType: SUBJECT_TYPE, subjectId, meta: { reason: REASON[reason] } });
  };

  /** The checks every start and rehearsal makes in its transaction, by the database's clock: the deadline the Admin saw, and the terms version. */
  async function frozenParts(tx: DbTransaction, deadlineSeen: string): Promise<{ deadlineDate: string; termsVersion: string; texts: CampaignTexts }> {
    const deadlineDate = await store.deadlineDateNow(tx, RECONSENT_DAYS);
    if (deadlineDate !== deadlineSeen) throw new Refused("deadline_changed", deadlineDate);
    const termsVersion = deps.termsVersion();
    if (termsVersion === null) throw new Refused("terms_unavailable");
    return { deadlineDate, termsVersion, texts: campaignTexts(deadlineDate, renderCampaignText) };
  }

  async function queueText(tx: DbTransaction, campaign: CampaignRow, recipient: { kind: "subscriber" | "roster"; id: string }, lang: LaunchCode): Promise<number> {
    const text = campaign.texts[lang]!;
    const costEstimateCents = textCostCents(text.segments, deps.pricePerSegmentCents());
    const queued = await deps.enqueue(tx, { campaignId: campaign.id, purpose: RECONSENT_PURPOSE, recipient, lang, body: text.body, segments: text.segments, costEstimateCents });
    // A refusal of what this file built is a bug: the transaction rolls back, campaign and all.
    if (!queued.ok) throw new Error(`subscriptions: the outbox refused a campaign text: ${queued.error}`);
    return costEstimateCents;
  }

  const textLang = (lang: string): LaunchCode => bodyLangOf(lang as LaunchCode, LAUNCH_CODES) as LaunchCode;

  return {
    async overview(executor = db) {
      const deadlineDate = await store.deadlineDateNow(executor, RECONSENT_DAYS);
      const texts = campaignTexts(deadlineDate, renderCampaignText);
      const [active, rosterSize, rehearsal, campaign, signupsClosed, counts] = await Promise.all([
        store.activeByLanguage(executor),
        drillRosterStore.size(executor),
        store.latestRehearsal(executor),
        store.real(executor),
        store.signupsClosed(executor),
        store.retentionCounts(executor),
      ]);
      return {
        deadlineDate,
        texts,
        estimate: estimateCampaign(active as Partial<Record<LaunchCode, number>>, texts, deps.pricePerSegmentCents()),
        rosterSize,
        rehearsal: rehearsal ? summaryOf(rehearsal) : null,
        campaign: campaign ? summaryOf(campaign) : null,
        signupsClosed,
        counts,
        termsVersion: deps.termsVersion(),
      };
    },

    async rehearse({ actorStaffId, sessionId, idempotencyKey, deadlineSeen }) {
      if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey) || typeof deadlineSeen !== "string") {
        await refusal("campaign.rehearsed", actorStaffId, "key_invalid");
        return { kind: "refused", reason: "key_invalid" };
      }
      try {
        return await db.transaction(async (tx): Promise<RehearseOutcome> => {
          const replay = await store.byKey(tx, idempotencyKey);
          if (replay) {
            if (!replay.rehearsal) throw new Refused("key_invalid");
            return { kind: "rehearsed", campaign: summaryOf(replay), texts: 0, replayed: true };
          }
          // The roster's rows locked FOR SHARE (as a drill's approval does): a member removed meanwhile waits, then skips the text it finds. A rehearsal that
          // reaches nobody rehearses nothing, so it is not made (the start needs one).
          const members = await drillRosterStore.membersForShare(tx);
          if (members.length === 0) throw new Refused("roster_empty");
          const parts = await frozenParts(tx, deadlineSeen);
          const campaign = await store.insert(tx, { id: newId(), rehearsal: true, ...parts, startedBy: actorStaffId, startedSession: sessionId, idempotencyKey });
          for (const member of members) await queueText(tx, campaign, { kind: "roster", id: member.id }, textLang(member.lang));
          await audit.record(tx, { action: "campaign.rehearsed", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: campaign.id, meta: { queued: members.length } });
          return { kind: "rehearsed", campaign: summaryOf(campaign), texts: members.length, replayed: false };
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await refusal("campaign.rehearsed", actorStaffId, error.reason);
        return { kind: "refused", reason: error.reason, ...(error.deadlineDate ? { deadlineDate: error.deadlineDate } : {}) };
      }
    },

    async start({ actorStaffId, sessionId, idempotencyKey, deadlineSeen, confirmed }) {
      if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey) || typeof deadlineSeen !== "string") {
        await refusal("campaign.started", actorStaffId, "key_invalid");
        return { kind: "refused", reason: "key_invalid" };
      }
      try {
        return await db.transaction(async (tx): Promise<StartOutcome> => {
          // 1. The sign-up gate: a sign-up or a YES to a pending sign-up that is under way finishes first (and is then deleted or asked below); one that
          //    comes later waits for this transaction and then finds sign-ups closed.
          await store.lockSignupsExclusive(tx);
          // 2. A retried request finds its campaign; a second start finds the campaign. Neither changes anything.
          const replay = await store.byKey(tx, idempotencyKey);
          if (replay) {
            if (replay.rehearsal) throw new Refused("key_invalid");
            return { kind: "already_started", campaign: summaryOf(replay) };
          }
          if (await store.real(tx)) throw new Refused("already_started");
          if (!(await store.latestRehearsal(tx))) throw new Refused("rehearsal_needed");
          if (!confirmed) throw new Refused("not_confirmed");
          // 3. The campaign row: the database checks the Admin, the session's level, the deadline, the texts and the rehearsal again.
          const parts = await frozenParts(tx, deadlineSeen);
          const campaign = await store.insert(tx, { id: newId(), rehearsal: false, ...parts, startedBy: actorStaffId, startedSession: sessionId, idempotencyKey });
          // 4. Every active subscriber, locked in id order, asked: the state, the prompt (open until the deadline) and the text in their language.
          const active = await store.lockActive(tx);
          const asked = new Set(await store.askToReconsent(tx, active.map((row) => row.id)));
          const subscribers = active.filter((row) => asked.has(row.id));
          await store.openReconsentPrompts(tx, [...asked], campaign.deadline);
          let costCents = 0;
          for (const row of subscribers) costCents += await queueText(tx, campaign, { kind: "subscriber", id: row.id }, textLang(row.lang));
          // 5. Every pending sign-up deleted, its waiting confirmation skipped first (AD-18: the delivery rows, then the recipient's row).
          let pendingDeleted = 0;
          for (const id of await store.pendingSignupIds(tx)) {
            await deps.skipRecipientDeliveries(tx, { kind: "pending_signup", id });
            if (await store.deletePendingSignup(tx, id)) pendingDeleted += 1;
          }
          // 6. The spend cap, last in the lock order (AD-18): it warns, never refuses.
          const overrun = deps.spendCap ? await deps.spendCap(tx, { campaignId: campaign.id, estimateCents: costCents, now: now() }) : null;
          await audit.record(tx, {
            action: "campaign.started",
            actorStaffId,
            subjectType: SUBJECT_TYPE,
            subjectId: campaign.id,
            meta: { asked: subscribers.length, queued: subscribers.length, pending_deleted: pendingDeleted },
          });
          if (overrun) {
            await audit.record(tx, {
              action: "spend.cap_overrun",
              actorStaffId,
              subjectType: SUBJECT_TYPE,
              subjectId: campaign.id,
              meta: { over_cents: overrun.overCents, cap_cents: overrun.capCents, entry_cents: costCents },
            });
          }
          return { kind: "started", campaign: summaryOf(campaign), asked: subscribers.length, texts: subscribers.length, pendingDeleted, costCents, overrun };
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await refusal("campaign.started", actorStaffId, error.reason);
        return { kind: "refused", reason: error.reason, ...(error.deadlineDate ? { deadlineDate: error.deadlineDate } : {}) };
      }
    },

    async reopenSignups({ actorStaffId }) {
      try {
        return await db.transaction(async (tx): Promise<ReopenOutcome> => {
          await store.lockSignupsExclusive(tx);
          const campaign = await store.lockReal(tx);
          if (campaign === null) throw new Refused("no_campaign");
          if (campaign.signupsReopenedAt !== null) throw new Refused("already_reopened");
          if (campaign.state !== "ended") throw new Refused("not_ended");
          const at = await store.reopenSignups(tx, campaign.id, actorStaffId);
          await audit.record(tx, { action: "signup.reopened", actorStaffId, subjectType: SUBJECT_TYPE, subjectId: campaign.id, meta: {} });
          return { kind: "reopened", at };
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await refusal("signup.reopened", actorStaffId, error.reason);
        return { kind: "refused", reason: error.reason };
      }
    },

    async endDue() {
      return db.transaction(async (tx): Promise<EndReport> => {
        const ended = await store.endDue(tx);
        const real = ended.find((row) => !row.rehearsal);
        if (!real) return { ended: ended.length, real: null };
        const counts = await store.retentionCounts(tx);
        await audit.record(tx, { action: "campaign.ended", actorStaffId: null, subjectType: SUBJECT_TYPE, subjectId: real.id, meta: { kept: counts.kept, lapsed: counts.lapsed } });
        return { ended: ended.length, real: { kept: counts.kept, lapsed: counts.lapsed } };
      });
    },
  };
}

/**
 * The sender's check of a campaign text at the hand-off point (messaging's `CampaignStandingReader`, wired by the composition root): the campaign was
 * started by an Admin at aal2 who is still an active Admin, is not cancelled and still runs, and (for the real campaign) the subscriber is still asked.
 */
export function campaignStandingReader(store: Pick<CampaignStore, "sendable"> = campaignStore): CampaignStandingReader {
  return {
    sendable: (tx, input) => (UUID.test(input.campaignId) && (input.recipientId === null || UUID.test(input.recipientId)) ? store.sendable(tx, input) : Promise.resolve(false)),
  };
}
