// The end-of-pilot purge against a real database, as the app's own role (S09.08; FR-D-7, NFR-N5, AR-13; E09 definition "Campaign"; AD-9 D-7): the
// `campaign_purge` record and its guard (the real campaign only, after its deadline by the database's clock, not cancelled; a count that never goes down; one
// completion, once none is left, stamped and counted by the database); the job (nothing before the deadline; after it every subscriber still asked deleted
// with the full E07 deletion, each in a transaction of its own, the others kept; one aggregate ops event); a YES racing it at the deadline (both judge the
// deadline by the database's clock and meet at the subscriber's row lock and the number's lock: a YES first keeps the subscriber, one after the deadline is
// refused with S09.07's reply); an interrupted purge resumed with a mix of states; the end of the pilot keeping the staff audit trail and the aggregate
// measures; and the day the terms page states. Every number is fictitious (the 555 exchange); nothing reaches Twilio.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { readWeeklyReview, recordOpsEvent } from "../../src/modules/ops";
import { floorsOfBuilding } from "../../src/modules/places";
import {
  createCampaigns,
  createEndOfPilotPurge,
  createInboundRouter,
  createSubscriberMeasuresJob,
  residentDataDeletedOn,
  residentSms,
  type Campaigns,
  type InboundDeps,
  type InboundOutcome,
  type PurgeDeps,
} from "../../src/modules/subscriptions";
import { campaignStore } from "../../src/modules/subscriptions/adapters/campaignStore";
import { purgeStore } from "../../src/modules/subscriptions/adapters/purgeStore";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, deferred, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

type Row = Record<string, unknown>;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let auditBaseline = 0;
let phoneCounter = 0;
let sid = 0;

const SIGNED_UP = "2026-10-01.1";
const TERMS = "2026-11-02.2";
const KEY = "a-test-key-for-the-reply-limit";

const auditTrail = { record: (tx: Parameters<typeof record>[0], event: Parameters<typeof record>[1]) => record(tx, event), recordRefusal: (db: Db, event: Parameters<typeof recordRefusal>[1]) => recordRefusal(db, event) };

function campaigns(): Campaigns {
  const queue = createDeliveryQueue();
  return createCampaigns({
    db: app,
    enqueue: (tx, input) => queue.enqueueCampaignDelivery(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    termsVersion: () => TERMS,
    pricePerSegmentCents: () => 1.5,
    audit: auditTrail as never,
  });
}

/** The inbound router as src/app/inbound.ts composes it (its deletion is the purge's). */
function router(stores?: InboundDeps["stores"]) {
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
    ...(stores ? { stores } : {}),
  });
}

const errors: Row[] = [];

/** The purge as src/app/purge.ts composes it. */
function purge(over: Partial<PurgeDeps> = {}) {
  const queue = createDeliveryQueue();
  return createEndOfPilotPurge({
    db: app,
    deletion: router(),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    recordCompleted: (tx, counts) => recordOpsEvent(tx, { kind: "campaign.purge_completed", detail: counts }),
    log: { error: (evt, fields) => errors.push({ evt, ...fields }) },
    ...over,
  });
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 6, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from delivery`;
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_reply`;
  await owner`delete from inbound_seen`;
  await owner`delete from rate_limit where scope in ('signup', 'signup_info', 'inbound')`;
  await owner`delete from campaign_purge`;
  await owner`delete from campaign`;
  await owner`delete from subscriber_measure`;
  await owner`delete from subscriber_event_count`;
  await owner`delete from usage_count`;
  await owner`delete from staff_session where staff_account_id in (select id from staff_account where username like 'dl\\_%')`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner`delete from ops_event where kind in ('campaign.purge_completed', 'spend.cap_overrun')`;
  await world.reset();
  errors.length = 0;
}

afterAll(async () => {
  await resetAll();
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

// --- fixtures ------------------------------------------------------------------------------------------------------------------------------------------

/** An Admin with an open session at aal2 (S01.10), who rehearses and starts the campaign. */
async function admin() {
  const account = await world.fx.staff("admin", "active");
  const session = randomBytes(32).toString("hex");
  await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at, revoked_at, aal2_at) values (${session}, ${account.id}, now(), now(), null, now())`;
  return { id: account.id, session };
}

async function subscriber(lang = "en", state: "active" | "reconsent_pending" | "retained" = "active", neighbourhood = "TP"): Promise<{ id: string; phone: string }> {
  phoneCounter += 1;
  const id = randomUUID();
  const phone = `+1416555${String(phoneCounter).padStart(4, "0")}`;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
              values (${id}, ${phone}, ${lang}, ${neighbourhood}, ${[]}, ${SIGNED_UP}, 'web', ${state})`;
  return { id, phone };
}

const nextSid = () => `SM${(++sid).toString(16).padStart(32, "0")}`;
const textFrom = (phone: string, body: string, via = router()): Promise<InboundOutcome> => via.handle({ messageSid: nextSid(), from: phone, body, optOutType: null });

const deadlineNow = async (): Promise<string> => (await owner`select ((now() at time zone 'America/Toronto')::date + 30)::text as day`)[0]!.day as string;

/** The real campaign, started after a rehearsal on the drill roster by an Admin at aal2 (S09.07): every active subscriber is asked. */
async function started(): Promise<string> {
  const who = await admin();
  await world.fx.rosterMember();
  const rehearsed = await campaigns().rehearse({ actorStaffId: who.id, sessionId: who.session, idempotencyKey: randomUUID(), deadlineSeen: await deadlineNow() });
  if (rehearsed.kind !== "rehearsed") throw new Error(`rehearsal refused: ${rehearsed.reason}`);
  const outcome = await campaigns().start({ actorStaffId: who.id, sessionId: who.session, idempotencyKey: randomUUID(), deadlineSeen: await deadlineNow(), confirmed: true });
  if (outcome.kind !== "started") throw new Error(`start refused: ${JSON.stringify(outcome)}`);
  return outcome.campaign.id;
}

/** Moves the real campaign's deadline to `seconds` from the database's clock (its guard switched off for the owner's one update), as if the days had gone by. */
async function deadlineIn(campaignId: string, seconds: number) {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table campaign disable trigger campaign_guard");
    await tx`update campaign set deadline = clock_timestamp() + ${`${seconds} seconds`}::interval where id = ${campaignId}`;
    await tx.unsafe("alter table campaign enable trigger campaign_guard");
  });
}
const pastDeadline = (campaignId: string) => deadlineIn(campaignId, -60);

/** Waits until the database's clock has passed the campaign's deadline. */
const untilPastDeadline = (campaignId: string) =>
  world.until(async () => (await owner`select clock_timestamp() >= deadline as past from campaign where id = ${campaignId}`)[0]!.past === true, "the deadline", 10_000);

const statesOf = async () => Object.fromEntries((await owner`select id, retention_state from subscriber`).map((row) => [row.id as string, row.retention_state as string]));
const purgeEvents = () => owner`select severity, subject_type, subject_id, detail from ops_event where kind = 'campaign.purge_completed' order by id`;
const purgeRecord = async () => (await owner`select deleted, retained, completed_at is not null as completed from campaign_purge`)[0];
const deliveriesOf = (recipientId: string) => owner`select purpose, state from delivery where recipient_id = ${recipientId} order by created_at, id`;
const refusal = (run: () => PromiseLike<unknown>) => Promise.resolve(run()).then(() => "", (error: { message: string }) => error.message);

const NOT_DUE = { due: false, deleted: 0, skipped: 0, failed: 0, more: false, completed: false, completedNow: false };

// --- the record -----------------------------------------------------------------------------------------------------------------------------------------

describe("the campaign_purge record", () => {
  it("is begun only for the real campaign once its deadline has passed, by the database's clock, and never for a cancelled one", async () => {
    await subscriber("en");
    const campaignId = await started();
    const [rehearsal] = await owner`select id from campaign where rehearsal`;
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${campaignId})`)).toContain("the purge begins once the campaign's deadline has passed");
    await pastDeadline(campaignId);
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${rehearsal!.id as string})`)).toContain("only the real campaign is purged");
    await owner`update campaign set state = 'cancelled' where id = ${campaignId}`;
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${campaignId})`)).toContain("a cancelled campaign is not purged");
  });

  it("counts up only, completes once no asked subscriber is left (the database stamps it and counts who stayed), and never changes after", async () => {
    const asked = await subscriber("en");
    const kept = await subscriber("ur");
    const campaignId = await started();
    await textFrom(kept.phone, "YES");
    await pastDeadline(campaignId);
    await appSql`insert into campaign_purge (campaign_id, deleted, completed_at, retained) values (${campaignId}, 9, now(), 9)`;
    expect(await purgeRecord()).toEqual({ deleted: 0, retained: null, completed: false });
    await appSql`update campaign_purge set deleted = 2`;
    expect(await refusal(() => appSql`update campaign_purge set deleted = 1`)).toContain("never goes down");
    expect(await refusal(() => appSql`update campaign_purge set completed_at = now(), retained = 0`)).toContain("once no subscriber is left to delete");
    await owner`delete from subscriber where id = ${asked.id}`;
    await appSql`update campaign_purge set completed_at = '2020-01-01', retained = 40`;
    expect(await purgeRecord()).toEqual({ deleted: 2, retained: 1, completed: true });
    expect(await owner`select completed_at > now() - interval '1 minute' as recent from campaign_purge`).toEqual([{ recent: true }]);
    expect(await refusal(() => appSql`update campaign_purge set deleted = 3`)).toContain("a completed purge never changes");
    expect(await refusal(() => appSql`delete from campaign_purge`)).toContain("permission denied");
    for (const role of ["anon", "authenticated"]) {
      expect(await refusal(() => owner.begin(async (tx) => (await tx.unsafe(`set local role ${role}`), tx`select * from campaign_purge`)))).toContain("permission denied");
    }
  });
});

// --- the job --------------------------------------------------------------------------------------------------------------------------------------------

describe("the purge job", () => {
  it("does nothing with no campaign, before the deadline, or for a cancelled campaign", async () => {
    const asked = await subscriber("en");
    expect(await purge().run()).toEqual(NOT_DUE);
    const campaignId = await started();
    expect(await purge().run()).toEqual(NOT_DUE);
    await owner`update campaign set state = 'cancelled' where id = ${campaignId}`;
    await pastDeadline(campaignId);
    expect(await purge().run()).toEqual(NOT_DUE);
    expect(await statesOf()).toEqual({ [asked.id]: "reconsent_pending" });
    expect(await owner`select count(*)::int as n from campaign_purge`).toEqual([{ n: 0 }]);
  });

  it("after the deadline deletes everyone who did not say YES with the full E07 deletion, keeps who did, and records the counts once as an aggregate ops event", async () => {
    const asked = await subscriber("en");
    const askedUr = await subscriber("ur", "active", "FP");
    const kept = await subscriber("fr");
    const campaignId = await started();
    expect(await textFrom(kept.phone, "Oui")).toMatchObject({ action: "reconsent" });
    // Joined after the start (sign-ups reopened is S09.07's; here the owner writes the row): never asked, never purged.
    const joined = await subscriber("es", "active");
    // An alert queued for the asked subscriber before the deadline, still waiting.
    const alert = await world.seedAlert({ recipients: [asked.id] });
    await pastDeadline(campaignId);
    // YES after the deadline is answered "the pilot has ended" through an inbound_reply row, which the purge deletes with the number.
    expect(await textFrom(askedUr.phone, "YES")).toMatchObject({ state: "lapsed", action: "pilot_ended", replied: true });
    expect(await owner`select count(*)::int as n from inbound_reply`).toEqual([{ n: 1 }]);
    expect(await residentDataDeletedOn(app)).toBeNull();

    expect(await purge().run()).toEqual({ due: true, deleted: 2, skipped: 0, failed: 0, more: false, completed: true, completedNow: true });

    expect(await statesOf()).toEqual({ [kept.id]: "retained", [joined.id]: "active" });
    // E07: their waiting texts were skipped (the campaign text, the alert and the reply), and every text of theirs forgot them.
    expect(await owner`select state from delivery where id = ${alert.ids[0]!}`).toEqual([{ state: "skipped" }]);
    expect(await owner`select count(*)::int as n from delivery where recipient_id in (${asked.id}, ${askedUr.id})`).toEqual([{ n: 0 }]);
    expect(await owner`select state from delivery where purpose = 'signup_info'`).toEqual([{ state: "skipped" }]);
    expect(await owner`select count(*)::int as n from inbound_reply`).toEqual([{ n: 0 }]);
    expect(await deliveriesOf(kept.id)).toEqual([
      { purpose: "reconsent", state: "queued" },
      { purpose: "prompt_reply", state: "queued" },
    ]);
    // One aggregate event: counts, no subject, no id, no number.
    expect(await purgeEvents()).toEqual([{ severity: "info", subject_type: null, subject_id: null, detail: { deleted: 2, retained: 1 } }]);
    expect(await purgeRecord()).toEqual({ deleted: 2, retained: 1, completed: true });
    // The deletions are counted in the subscriber measures (S07.10) like any other.
    expect(await owner`select lang, nbhd, n from subscriber_event_count where event = 'deleted' order by lang`).toEqual([
      { lang: "en", nbhd: "TP", n: 1 },
      { lang: "ur", nbhd: "FP", n: 1 },
    ]);
    // The terms page's day: the Toronto day it completed.
    const [{ today }] = await owner`select to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD') as today`;
    expect(await residentDataDeletedOn(app)).toBe(today);

    // Again: nothing more, no second event.
    expect(await purge().run()).toEqual({ due: true, deleted: 0, skipped: 0, failed: 0, more: false, completed: true, completedNow: false });
    expect(await purgeEvents()).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

// --- a YES at the deadline ------------------------------------------------------------------------------------------------------------------------------

describe("a YES racing the purge at the deadline", () => {
  it("committed by a YES that began before the deadline keeps the subscriber, even while it still holds the number when the purge reaches them", async () => {
    const yes = await subscriber("ur");
    const silent = await subscriber("en");
    const campaignId = await started();
    await deadlineIn(campaignId, 3);
    // The YES's transaction is held right after its conditional update, holding the number's lock and the subscriber's row.
    const inside = deferred();
    const release = deferred();
    const held = router({
      campaigns: {
        ...campaignStore,
        retain: async (tx, id) => {
          const kept = await campaignStore.retain(tx, id);
          inside.resolve();
          await release.promise;
          return kept;
        },
      },
    });
    const replying = textFrom(yes.phone, "YES", held);
    await inside.promise;
    await untilPastDeadline(campaignId);

    const running = purge().run();
    await world.untilSomeoneWaitsForALock();
    release.resolve();
    expect(await replying).toMatchObject({ state: "active", action: "reconsent", replied: true });
    expect(await running).toEqual({ due: true, deleted: 1, skipped: 1, failed: 0, more: false, completed: true, completedNow: true });

    expect(await statesOf()).toEqual({ [yes.id]: "retained" });
    // Nothing the purge began for them was kept: their campaign text and the confirmation of their YES are still waiting.
    expect(await deliveriesOf(yes.id)).toEqual([
      { purpose: "reconsent", state: "queued" },
      { purpose: "prompt_reply", state: "queued" },
    ]);
    expect(await purgeEvents()).toEqual([expect.objectContaining({ detail: { deleted: 1, retained: 1 } })]);
    expect(await deliveriesOf(silent.id)).toEqual([]);
  });

  it("meets the YES at the subscriber's row lock and re-checks under it: a YES that updated the row first, before the deadline, keeps them", async () => {
    const yes = await subscriber("en");
    const campaignId = await started();
    await deadlineIn(campaignId, 3);
    // campaignStore.retain alone, as the router runs it, without the number's lock: only the row's lock and the clock stand between it and the purge.
    const updated = deferred<boolean>();
    const release = deferred();
    const yesTx = app.transaction(async (tx) => {
      updated.resolve(await campaignStore.retain(tx, yes.id));
      await release.promise;
    });
    expect(await updated.promise).toBe(true);
    await untilPastDeadline(campaignId);

    const running = purge().run();
    await world.untilSomeoneWaitsForALock();
    // Waiting on the row: the purge had already skipped their waiting text when it reached the lock.
    release.resolve();
    await yesTx;
    expect(await running).toMatchObject({ deleted: 0, skipped: 1, completed: true });
    expect(await statesOf()).toEqual({ [yes.id]: "retained" });
    // The skip was rolled back with the rest of that subscriber's transaction.
    expect(await deliveriesOf(yes.id)).toEqual([{ purpose: "reconsent", state: "queued" }]);
  });

  it("is refused after the deadline (S09.07's reply), before the purge and while the purge holds the subscriber; a retained subscriber is never deleted", async () => {
    const before = await subscriber("fr");
    const during = await subscriber("en");
    const kept = await subscriber("ur");
    const campaignId = await started();
    await textFrom(kept.phone, "YES");
    await pastDeadline(campaignId);
    expect(await textFrom(before.phone, "Oui")).toMatchObject({ state: "lapsed", action: "pilot_ended", replied: true });
    expect(await statesOf()).toMatchObject({ [before.id]: "reconsent_pending" });

    // The purge holds `during` (its number's lock and its row) while their YES arrives: the YES waits, then finds a number the CVH does not know.
    const locked = deferred();
    const release = deferred();
    const running = purge({
      stores: {
        purge: {
          ...purgeStore,
          lockPurgeable: async (tx, id) => {
            const row = await purgeStore.lockPurgeable(tx, id);
            if (id === during.id) {
              locked.resolve();
              await release.promise;
            }
            return row;
          },
        },
      },
    }).run();
    await locked.promise;
    const replying = textFrom(during.phone, "YES");
    await world.untilSomeoneWaitsForALock();
    release.resolve();
    expect(await running).toMatchObject({ deleted: 2, skipped: 0, completed: true });
    expect(await replying).toMatchObject({ state: "none", action: "signup_info", replied: true });

    expect(await statesOf()).toEqual({ [kept.id]: "retained" });
    const replies = await owner`select body, state from delivery where purpose = 'signup_info' order by created_at`;
    expect(replies).toEqual([
      // The reply to the YES before the purge was skipped with the number's other rows; the one after it is the pilot's end, to a number it no longer has.
      { body: residentSms("fr", "pilotEnded").body, state: "skipped" },
      { body: residentSms("en", "pilotEnded").body, state: "queued" },
    ]);
  });
});

// --- interrupted ----------------------------------------------------------------------------------------------------------------------------------------

describe("an interrupted purge", () => {
  it("resumes from what is left, counts each deletion once, and never deletes a retained or active subscriber (a mix of states)", async () => {
    const asked = [await subscriber("en"), await subscriber("ur"), await subscriber("fr", "active", "FP"), await subscriber("zh"), await subscriber("es"), await subscriber("ta")];
    const kept = [await subscriber("en"), await subscriber("bn")];
    const campaignId = await started();
    for (const one of kept) await textFrom(one.phone, "YES");
    const joined = await subscriber("en", "active");
    await pastDeadline(campaignId);
    const askedIds = new Set(asked.map((one) => one.id));
    const remaining = async () => Object.entries(await statesOf()).filter(([id]) => askedIds.has(id)).length;

    // 1. The time limit: the run stops after two, says there is more, and has recorded no completion.
    let tick = 0;
    expect(await purge({ budgetMs: 3, clock: () => tick++ }).run()).toEqual({ due: true, deleted: 2, skipped: 0, failed: 0, more: true, completed: false, completedNow: false });
    expect(await remaining()).toBe(4);
    expect(await purgeRecord()).toEqual({ deleted: 2, retained: null, completed: false });

    // 2. A failure inside one subscriber's transaction (after its waiting texts were skipped): that transaction is rolled back, the others go on, and the purge
    //    does not complete while one is left. The log has the error's class only.
    const failing = Object.keys(await statesOf()).filter((id) => askedIds.has(id)).sort()[1]!;
    const report = await purge({
      stores: {
        purge: {
          ...purgeStore,
          lockPurgeable: async (tx, id) => {
            if (id === failing) throw new RangeError(`no such thing as ${id}`);
            return purgeStore.lockPurgeable(tx, id);
          },
        },
      },
    }).run();
    expect(report).toEqual({ due: true, deleted: 3, skipped: 0, failed: 1, more: false, completed: false, completedNow: false });
    expect(Object.keys(await statesOf())).toContain(failing);
    expect(await deliveriesOf(failing)).toEqual([{ purpose: "reconsent", state: "queued" }]);
    expect(errors).toEqual([{ evt: "purge.subscriber_failed", error: "RangeError" }]);
    expect(await purgeEvents()).toEqual([]);

    // 3. A run that dies part-way (the database went away while reading the next ids): what it committed is kept and counted.
    await expect(
      purge({
        stores: {
          purge: {
            ...purgeStore,
            purgeableIds: async () => {
              throw new Error("connection lost");
            },
          },
        },
      }).run(),
    ).rejects.toThrow("connection lost");

    // 4. Resumed: the last one goes, the completion is recorded once with every deletion counted once, and who said YES or never was asked stays.
    expect(await purge().run()).toEqual({ due: true, deleted: 1, skipped: 0, failed: 0, more: false, completed: true, completedNow: true });
    expect(await statesOf()).toEqual({ [kept[0]!.id]: "retained", [kept[1]!.id]: "retained", [joined.id]: "active" });
    expect(await purgeRecord()).toEqual({ deleted: 6, retained: 2, completed: true });
    expect(await purgeEvents()).toEqual([expect.objectContaining({ detail: { deleted: 6, retained: 2 } })]);
    expect(await purge().run()).toMatchObject({ deleted: 0, completed: true, completedNow: false });
  });
});

// --- the end of the pilot -------------------------------------------------------------------------------------------------------------------------------

describe("the end of the pilot", () => {
  it("keeps the staff audit trail and the aggregate measures: the subscriber measures, the usage counts, the weekly review and the texts already sent", async () => {
    const asked = [await subscriber("en"), await subscriber("ur", "active", "FP")];
    const kept = await subscriber("fr");
    const campaignId = await started();
    await textFrom(kept.phone, "YES");
    // Texts to the asked subscribers that went out during the pilot: one delivered, one the carrier could not deliver.
    const alert = await world.seedAlert({ recipients: asked.map((one) => one.id) });
    await owner.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      await tx`update delivery set state = 'delivered', claimed_at = now(), claimed_by = 'worker-1', handed_off_at = now(), submitted_at = now(), completed_at = now(),
                   provider_message_id = ${`SM${randomBytes(16).toString("hex")}`} where id = ${alert.ids[0]!}`;
      await tx`update delivery set state = 'undelivered', claimed_at = now(), claimed_by = 'worker-1', handed_off_at = now(), submitted_at = now(), completed_at = now(),
                   provider_message_id = ${`SM${randomBytes(16).toString("hex")}`}, provider_error_code = 30003 where id = ${alert.ids[1]!}`;
    });
    await createSubscriberMeasuresJob({ db: app }).run({ day: "today" });
    await owner`insert into usage_count (day, evt, lang, nbhd, n) values ((now() at time zone 'America/Toronto')::date, 'install', 'ur', 'FP', 3)`;
    await pastDeadline(campaignId);
    const [{ week }] = await owner`select to_char(date_trunc('week', now() at time zone 'America/Toronto'), 'YYYY-MM-DD') as week`;

    const snapshot = async () => ({
      audit: await owner`select id, action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} order by id`,
      measures: await owner`select day, measure, lang, nbhd, n from subscriber_measure order by 1, 2, 3, 4`,
      usage: await owner`select day, evt, lang, nbhd, n from usage_count order by 1, 2, 3, 4`,
      sent: await owner`select id, kind, lang, state, provider_error_code from delivery where handed_off_at is not null order by id`,
      review: await readWeeklyReview(app, week as string),
      confirmed: await owner`select day, lang, nbhd, n from subscriber_event_count where event = 'confirmed' order by 1, 2, 3`,
    });
    const before = await snapshot();
    expect(before.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["campaign.rehearsed", "campaign.started"]));
    expect(before.review.some((row) => row.section === "delivery_problem")).toBe(true);
    expect(before.measures.length).toBeGreaterThan(0);

    expect(await purge().run()).toMatchObject({ deleted: 2, completed: true });

    // Everything aggregate is as it was; the texts already sent stay, only no longer naming anyone; the purge audits nothing of its own.
    expect(await snapshot()).toEqual(before);
    expect(await owner`select count(*)::int as n from delivery where id = any(${alert.ids}) and recipient_id is null`).toEqual([{ n: 2 }]);
    expect(await statesOf()).toEqual({ [kept.id]: "retained" });
  });
});
