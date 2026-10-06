// The end-of-pilot purge against a real database, as the app's own role (S09.08; FR-D-7, NFR-N5, AR-13; E09 definition "Campaign"; AD-9 D-7): the
// `campaign_purge` record and its guard (the real campaign only, after its deadline by the database's clock and its end, not cancelled; a count that never
// goes down; one completion, once none is left, stamped and counted by the database); the job (nothing before the deadline and the end job; after them every
// subscriber still asked deleted with the full E07 deletion, check-ins' port called in each deletion's transaction, each in a transaction of its own, the
// others kept; one aggregate ops event whose counts are the end's); a YES racing it at the deadline (both judge the deadline by the database's clock and meet
// at the subscriber's row lock and the number's lock: a YES first keeps the subscriber, one after the deadline is refused with S09.07's reply); an
// interrupted purge resumed with a mix of states; the end of the pilot keeping the staff audit trail and the aggregate measures (the correction reach
// included, kept as it stood when the purge began); and the day the terms page states. Every number is fictitious (the 555 exchange); nothing reaches
// Twilio.
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue, readCorrectionReach } from "../../src/modules/messaging";
import { readWeeklyReview, recordOpsEvent } from "../../src/modules/ops";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { roundThreads } from "../../src/modules/alerting";
import { createCheckinRequests } from "../../src/modules/checkins";
import { floorsOfBuilding } from "../../src/modules/places";
import {
  checkinRequestStore,
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
import { createDb, type Db, type DbTransaction } from "../../src/platform/db";
import { BASE_URL, deferred, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl, torontoDayFromToday } from "./helpers";

type Row = Record<string, unknown>;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let auditBaseline = 0;
let phoneCounter = 0;
let sid = 0;
/** Entries moved into another thread (a correction replaces an entry of its own thread): they go first when the fixtures are removed. */
let moved: string[] = [];

const SIGNED_UP = "2026-10-01.1";
// S08.05: a building of Thorncliffe Park (the fixtures' threads are for the whole neighbourhood) with one floor, for a check-in request and its round row.
const RSN_HOME = "9109101";
const FLOOR_HOME = "0190f000-0000-7000-8000-000000910101";
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

/** The inbound router as src/app/inbound.ts composes it (its deletion is the purge's); `checkins` stands for E08's port. */
function router(stores?: InboundDeps["stores"], checkins?: InboundDeps["checkins"]) {
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
    ...(stores ? { stores } : {}),
    ...(checkins ? { checkins } : {}),
  });
}

/**
 * E08's `deleteForSubscriber` port, recording each call with what the transaction it is given sees: the subscriber's texts still waiting, inside it (the
 * deletion skipped them, not yet committed) and outside it (still waiting until it commits), which shows the call is made inside the deletion's transaction.
 */
function recordingCheckins() {
  const calls: { id: string; waitingInside: number; waitingOutside: number }[] = [];
  const port: NonNullable<InboundDeps["checkins"]> = {
    deleteForSubscriber: async (id: string, tx: DbTransaction) => {
      const [inside] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from delivery where recipient_id = ${id} and state = 'queued'`);
      const [outside] = await owner`select count(*)::int as n from delivery where recipient_id = ${id} and state = 'queued'`;
      calls.push({ id, waitingInside: inside!.n, waitingOutside: outside!.n as number });
    },
  };
  return { port, calls };
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
  await owner`delete from checkin`;
  await owner`delete from checkin_tally`;
  await owner`delete from correction_reach_kept`;
  await owner`delete from delivery`;
  if (moved.length > 0) {
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      for (const id of moved) await tx`delete from alert_entry where id = ${id}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    moved = [];
  }
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
  await owner`delete from building_floor where rsn = ${RSN_HOME}`;
  await owner`delete from building where rsn = ${RSN_HOME}`;
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

/** The deadline a campaign started now would have (the Toronto day 30 days on), never read in the last seconds before midnight in Toronto. */
const deadlineNow = (): Promise<string> => torontoDayFromToday(owner, 30);

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

/** The end job's run (S09.07): the campaign ended and audited `campaign.ended` with who stayed and who did not reply. The purge waits for it. */
async function endJob() {
  const report = await campaigns().endDue();
  if (report.real === null) throw new Error("the end job ended no real campaign");
  return report.real;
}

/** Past the deadline and ended by the end job: the purge is due. */
async function ended(campaignId: string) {
  await pastDeadline(campaignId);
  return endJob();
}

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
  it("is begun only for the real campaign once its deadline has passed, by the database's clock, and the end job has ended it; never for a cancelled one", async () => {
    await subscriber("en");
    const campaignId = await started();
    const [rehearsal] = await owner`select id from campaign where rehearsal`;
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${campaignId})`)).toContain("the purge begins once the campaign's deadline has passed");
    await pastDeadline(campaignId);
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${rehearsal!.id as string})`)).toContain("only the real campaign is purged");
    // Past the deadline, before the end job: its `campaign.ended` counts come before any deletion.
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${campaignId})`)).toContain("the purge begins once the end job has ended the campaign");
    await owner`update campaign set state = 'cancelled' where id = ${campaignId}`;
    expect(await refusal(() => appSql`insert into campaign_purge (campaign_id) values (${campaignId})`)).toContain("a cancelled campaign is not purged");
  });

  it("counts up only, completes once no asked subscriber is left (the database stamps it and counts who stayed), and never changes after", async () => {
    const asked = await subscriber("en");
    const kept = await subscriber("ur");
    const campaignId = await started();
    await textFrom(kept.phone, "YES");
    await ended(campaignId);
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
  it("does nothing with no campaign, before the deadline, before the end job has ended the campaign, or for a cancelled campaign", async () => {
    const asked = await subscriber("en");
    expect(await purge().run()).toEqual(NOT_DUE);
    const campaignId = await started();
    expect(await purge().run()).toEqual(NOT_DUE);
    await pastDeadline(campaignId);
    expect(await purge().run()).toEqual(NOT_DUE);
    await owner`update campaign set state = 'cancelled' where id = ${campaignId}`;
    // The end job ends no cancelled campaign.
    expect(await campaigns().endDue()).toMatchObject({ real: null });
    expect(await purge().run()).toEqual(NOT_DUE);
    expect(await statesOf()).toEqual({ [asked.id]: "reconsent_pending" });
    expect(await owner`select count(*)::int as n from campaign_purge`).toEqual([{ n: 0 }]);
  });

  it("after the deadline and the end deletes everyone who did not say YES with the full E07 deletion, keeps who did, and records the counts once as an aggregate ops event", async () => {
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
    // The end job counts who stayed and who did not reply, before anyone is deleted.
    expect(await endJob()).toEqual({ kept: 1, lapsed: 2 });

    // E08's check-ins port is called for each subscriber deleted, inside their deletion's transaction, and for nobody else.
    const checkins = recordingCheckins();
    expect(await purge({ deletion: router(undefined, checkins.port) }).run()).toEqual({ due: true, deleted: 2, skipped: 0, failed: 0, more: false, completed: true, completedNow: true });
    expect(checkins.calls.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: asked.id, waitingInside: 0, waitingOutside: 2 },
        { id: askedUr.id, waitingInside: 0, waitingOutside: 1 },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );

    expect(await statesOf()).toEqual({ [kept.id]: "retained", [joined.id]: "active" });
    // E07: their waiting texts were skipped (the campaign text, the alert and the reply), and every text of theirs forgot them.
    expect(await owner`select state from delivery where id = ${alert.ids[0]!}`).toEqual([{ state: "skipped" }]);
    expect(await owner`select count(*)::int as n from delivery where recipient_id in (${asked.id}, ${askedUr.id})`).toEqual([{ n: 0 }]);
    expect(await owner`select state from delivery where purpose = 'signup_info'`).toEqual([{ state: "skipped" }]);
    expect(await owner`select count(*)::int as n from inbound_reply`).toEqual([{ n: 0 }]);
    expect(await deliveriesOf(kept.id)).toEqual([
      { purpose: "reconsent", state: "queued" },
      { purpose: "reconsent_kept", state: "queued" },
    ]);
    // One aggregate event: counts, no subject, no id, no number; the same counts as the end's audit.
    expect(await purgeEvents()).toEqual([{ severity: "info", subject_type: null, subject_id: null, detail: { deleted: 2, retained: 1 } }]);
    expect(await owner`select meta from audit_event where action = 'campaign.ended' and id > ${auditBaseline}`).toEqual([{ meta: { kept: 1, lapsed: 2 } }]);
    expect(await purgeRecord()).toEqual({ deleted: 2, retained: 1, completed: true });
    // The deletions are counted in the subscriber measures (S07.10) like any other.
    expect(await owner`select lang, nbhd, n from subscriber_event_count where event = 'deleted' order by lang`).toEqual([
      { lang: "en", nbhd: "TP", n: 1 },
      { lang: "ur", nbhd: "FP", n: 1 },
    ]);
    // The terms page's day: the Toronto day it completed (read from the completion itself, so a run across midnight in Toronto still agrees).
    const [{ completedOn }] = await owner`select to_char(completed_at at time zone 'America/Toronto', 'YYYY-MM-DD') as "completedOn" from campaign_purge`;
    expect(completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await residentDataDeletedOn(app)).toBe(completedOn);

    // Again: nothing more, no second event.
    expect(await purge().run()).toEqual({ due: true, deleted: 0, skipped: 0, failed: 0, more: false, completed: true, completedNow: false });
    expect(await purgeEvents()).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

// --- check-ins (S08.05) ---------------------------------------------------------------------------------------------------------------------------------

describe("a deleted subscriber's check-in rows (S08.05)", () => {
  it("are closed into stubs by checkins' real port, tallied once, the subscriber's round threads locked first: before their texts and their row", async () => {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN_HOME}, 'TP', '1 Purge Place', 43.7, -79.34, now()) on conflict do nothing`;
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_HOME}, ${RSN_HOME}, '1', 1, true) on conflict do nothing`;
    const asked = await subscriber("en");
    await owner`update subscriber set checkin_method = 'call', checkin_consent_version = ${CHECKIN_CONSENT_VERSION}, where_i_live_rsn = ${RSN_HOME}, where_i_live_floor_id = ${FLOOR_HOME}
                where id = ${asked.id}`;
    const campaignId = await started();
    // An open heat round for the whole neighbourhood with the subscriber's row in it (as S08.06's approval makes it).
    const round = (await world.fx.entry("approved", { types: ["heat"], kind: "update" })).alertId;
    await owner`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${round}, ${asked.id}, ${RSN_HOME}, ${FLOOR_HOME}, 'call')`;
    await ended(campaignId);

    // The real port, as src/app/checkins.ts composes it, recording the order of the steps the purge's transaction takes.
    const checkins = createCheckinRequests({ requests: checkinRequestStore(), threads: roundThreads, coversFloor: async () => true });
    const steps: string[] = [];
    const queue = createDeliveryQueue();
    const report = await purge({
      deletion: router(undefined, {
        lockRounds: async (id, tx) => (steps.push("deletion.lockRounds"), checkins.lockRounds(id, tx)),
        deleteForSubscriber: async (id, tx) => (steps.push("deleteForSubscriber"), checkins.deleteForSubscriber(id, tx)),
      }),
      checkins: { lockRounds: async (id, tx) => (steps.push("lockRounds"), checkins.lockRounds(id, tx)) },
      skipRecipientDeliveries: async (tx, recipient) => (steps.push("skip"), queue.skipRecipientDeliveries(tx, recipient)),
    }).run();
    expect(report).toMatchObject({ due: true, deleted: 1, failed: 0, completed: true });
    // The threads first, then the texts, then (under the row lock) the rows; the deletion does not lock the threads again after the row.
    expect(steps).toEqual(["lockRounds", "skip", "deleteForSubscriber"]);
    expect(await owner`select subscriber_id, method, outcome, tallied_at is not null as tallied, closed_at is not null as closed from checkin where alert_id = ${round}`).toEqual([
      { subscriber_id: null, method: null, outcome: "withdrawn", tallied: true, closed: true },
    ]);
    expect(await owner`select status, n from checkin_tally where alert_id = ${round} order by status`).toEqual([
      { status: "requested", n: 1 },
      { status: "withdrawn", n: 1 },
    ]);
    expect(await owner`select count(*)::int as n from subscriber where id = ${asked.id}`).toEqual([{ n: 0 }]);
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
    // The end job does not wait for the YES (it counts them as not yet replied: the YES has not committed).
    await endJob();

    const checkins = recordingCheckins();
    const running = purge({ deletion: router(undefined, checkins.port) }).run();
    await world.untilSomeoneWaitsForALock();
    release.resolve();
    expect(await replying).toMatchObject({ state: "active", action: "reconsent", replied: true });
    expect(await running).toEqual({ due: true, deleted: 1, skipped: 1, failed: 0, more: false, completed: true, completedNow: true });
    // Check-ins were deleted for the one deleted, never for the one kept under the lock.
    expect(checkins.calls.map((call) => call.id)).toEqual([silent.id]);

    expect(await statesOf()).toEqual({ [yes.id]: "retained" });
    // Nothing the purge began for them was kept: their campaign text and the confirmation of their YES are still waiting.
    expect(await deliveriesOf(yes.id)).toEqual([
      { purpose: "reconsent", state: "queued" },
      { purpose: "reconsent_kept", state: "queued" },
    ]);
    expect(await purgeEvents()).toEqual([expect.objectContaining({ detail: { deleted: 1, retained: 1 } })]);
    expect(await deliveriesOf(silent.id)).toEqual([]);
  });

  it("leaves no words of a purged subscriber's own texts: their replies lose their body, while the campaign text and the alert, which everyone got, keep theirs", async () => {
    const asked = await subscriber("en");
    const campaignId = await started();
    // A text of their own, before the deadline: reply 0 asks them to confirm the deletion.
    expect(await textFrom(asked.phone, "0")).toMatchObject({ action: "ask_delete", replied: true });
    const alert = await world.seedAlert({ recipients: [asked.id] });
    const before = await owner`select id, kind, purpose, body from delivery where recipient_id = ${asked.id} order by kind`;
    expect(before.map((row) => row.kind)).toEqual(["alert", "campaign", "transactional"]);
    await pastDeadline(campaignId);
    await endJob();
    expect(await purge().run()).toMatchObject({ due: true, deleted: 1, failed: 0, completed: true });

    const after = await owner`select id, kind, purpose, body, recipient_id from delivery where id in ${owner(before.map((row) => row.id as string))} order by kind`;
    expect(after).toEqual([
      { id: alert.ids[0], kind: "alert", purpose: null, body: before[0]!.body, recipient_id: null },
      { id: before[1]!.id, kind: "campaign", purpose: "reconsent", body: before[1]!.body, recipient_id: null },
      { id: before[2]!.id, kind: "transactional", purpose: "prompt_reply", body: "[deleted]", recipient_id: null },
    ]);
    expect(before[2]!.body).toContain("10 minutes");
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
    await endJob();

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
    await endJob();

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
    expect(await ended(campaignId)).toEqual({ kept: 2, lapsed: 6 });
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
  /** Marks texts as sent during the pilot (handed off, then `state`), as the sender and the status callbacks would. */
  async function sentAs(ids: string[], state: "delivered" | "undelivered") {
    await owner.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      for (const id of ids) {
        await tx`update delivery set state = ${state}, claimed_at = now(), claimed_by = 'worker-1', handed_off_at = now(), submitted_at = now(), completed_at = now(),
                     provider_message_id = ${`SM${randomBytes(16).toString("hex")}`}, provider_error_code = ${state === "undelivered" ? 30003 : null} where id = ${id}`;
      }
    });
  }

  /** Moves `entryId` into `thread` and makes it replace `thread`'s entry (a correction), as deliveryMeasureViews.db.test.ts does. */
  async function correcting(entryId: string, thread: { alertId: string; entryId: string }) {
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`update alert_entry set alert_id = ${thread.alertId}, supersedes_id = ${thread.entryId} where id = ${entryId}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    moved.push(entryId);
  }

  it("keeps the staff audit trail and the aggregate measures: the subscriber measures, the usage counts, the weekly review, the correction reach and the texts already sent", async () => {
    const asked = [
      await subscriber("en"),
      await subscriber("ur", "active", "FP"),
      await subscriber("fr"),
      await subscriber("zh"),
      await subscriber("es"),
      await subscriber("ta", "active", "FP"),
      await subscriber("bn"),
      await subscriber("el"),
    ];
    const kept = [await subscriber("fr"), await subscriber("en", "active", "FP")];
    const campaignId = await started();
    for (const one of kept) await textFrom(one.phone, "YES");
    // During the pilot: an alert to all ten (one text the carrier could not deliver), then its correction, delivered to all ten.
    const everyone = [...asked, ...kept].map((one) => one.id);
    const original = await world.seedAlert({ recipients: everyone });
    await sentAs(original.ids.slice(0, 9), "delivered");
    await sentAs([original.ids[9]!], "undelivered");
    const correction = await world.seedAlert({ recipients: everyone, kind: "correction" });
    await correcting(correction.entry.entryId, original.entry);
    await sentAs(correction.ids, "delivered");
    await createSubscriberMeasuresJob({ db: app }).run({ day: "today" });
    await owner`insert into usage_count (day, evt, lang, nbhd, n) values ((now() at time zone 'America/Toronto')::date, 'install', 'ur', 'FP', 3)`;
    await ended(campaignId);
    const [{ week }] = await owner`select to_char(date_trunc('week', now() at time zone 'America/Toronto'), 'YYYY-MM-DD') as week`;

    const snapshot = async () => ({
      audit: await owner`select id, action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} order by id`,
      measures: await owner`select day, measure, lang, nbhd, n from subscriber_measure order by 1, 2, 3, 4`,
      usage: await owner`select day, evt, lang, nbhd, n from usage_count order by 1, 2, 3, 4`,
      sent: await owner`select id, kind, lang, state, provider_error_code from delivery where handed_off_at is not null order by id`,
      review: await readWeeklyReview(app, week as string),
      confirmed: await owner`select day, lang, nbhd, n from subscriber_event_count where event = 'confirmed' order by 1, 2, 3`,
      reach: await readCorrectionReach(app, 50),
    });
    const before = await snapshot();
    expect(before.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["campaign.rehearsed", "campaign.started", "campaign.ended"]));
    expect(before.review.some((row) => row.section === "delivery_problem")).toBe(true);
    expect(before.measures.length).toBeGreaterThan(0);
    expect(before.reach.real).toEqual([
      expect.objectContaining({
        entryId: correction.entry.entryId,
        originalRecipients: { n: 10, shown: "10" },
        attemptedReach: { n: 10, shown: "10" },
        confirmedReach: { n: 10, shown: "10" },
        attemptedPercent: 100,
        confirmedPercent: 100,
      }),
    ]);

    expect(await purge().run()).toMatchObject({ deleted: 8, completed: true });

    // Everything aggregate is as it was; the texts already sent stay, only no longer naming anyone; the purge audits nothing of its own.
    expect(await snapshot()).toEqual(before);
    expect(await owner`select count(*)::int as n from delivery where id = any(${[...original.ids, ...correction.ids]}) and recipient_id is null`).toEqual([{ n: 16 }]);
    expect(await statesOf()).toEqual({ [kept[0]!.id]: "retained", [kept[1]!.id]: "retained" });
    // Why the correction reach is kept: the view, counted from the recipient ids the deletions cleared, now sees only the two who stayed.
    expect(await appSql`select original_recipients_shown, confirmed_percent from correction_reach where entry_id = ${correction.entry.entryId}`).toEqual([
      { original_recipients_shown: "fewer than 5", confirmed_percent: null },
    ]);
    expect(await appSql`select entry_id, original_recipients, confirmed_percent from correction_reach_kept`).toEqual([
      { entry_id: correction.entry.entryId, original_recipients: 10, confirmed_percent: 100 },
    ]);
    // The kept rows are the view's, written by the database when the purge began: the app reads them and can neither add, change nor delete one.
    expect(
      await refusal(
        () => appSql`insert into correction_reach_kept (entry_id, alert_id, kind, is_drill, original_recipients_shown, attempted_reach_shown, confirmed_reach_shown)
                     values (${original.entry.entryId}, ${original.entry.alertId}, 'correction', false, '99', '99', '99')`,
      ),
    ).toContain("permission denied");
    expect(await refusal(() => appSql`update correction_reach_kept set confirmed_percent = 1`)).toContain("permission denied");
    expect(await refusal(() => appSql`delete from correction_reach_kept`)).toContain("permission denied");
    for (const role of ["anon", "authenticated"]) {
      expect(await refusal(() => owner.begin(async (tx) => (await tx.unsafe(`set local role ${role}`), tx`select * from correction_reach_kept`)))).toContain("permission denied");
    }
  });

  it("reads the correction reach of an entry measured after the purge began live, from the subscribers who stayed", async () => {
    const asked = [await subscriber("en"), await subscriber("ur"), await subscriber("fr"), await subscriber("es"), await subscriber("zh")];
    const kept = [await subscriber("en"), await subscriber("ta"), await subscriber("bn"), await subscriber("el"), await subscriber("hi")];
    const campaignId = await started();
    for (const one of kept) await textFrom(one.phone, "YES");
    const everyone = [...asked, ...kept].map((one) => one.id);
    const original = await world.seedAlert({ recipients: everyone });
    await sentAs(original.ids, "delivered");
    const correction = await world.seedAlert({ recipients: everyone, kind: "correction" });
    await correcting(correction.entry.entryId, original.entry);
    await sentAs(correction.ids, "delivered");
    await ended(campaignId);

    expect(await purge().run()).toMatchObject({ deleted: 5, completed: true });
    // After the purge, a second correction of the same original goes to the five who stayed: measured live, against the original's recipients still there.
    const later = await world.seedAlert({ recipients: kept.map((one) => one.id), kind: "correction" });
    await correcting(later.entry.entryId, original.entry);
    await sentAs(later.ids, "delivered");

    const reach = await readCorrectionReach(app, 50);
    expect(reach.real.map((row) => [row.entryId, row.originalRecipients.shown, row.confirmedPercent])).toEqual(
      expect.arrayContaining([
        [correction.entry.entryId, "10", 100],
        [later.entry.entryId, "5", 100],
      ]),
    );
    expect(reach.real).toHaveLength(2);
    expect(await owner`select entry_id from correction_reach_kept`).toEqual([{ entry_id: correction.entry.entryId }]);
  });

  it("keeps the correction reach as a copy with no foreign key, so the alert tables are still truncated as the alert tests reset them", async () => {
    const asked = await subscriber("en");
    const kept = await subscriber("fr");
    const campaignId = await started();
    await textFrom(kept.phone, "YES");
    const original = await world.seedAlert({ recipients: [asked.id, kept.id] });
    await sentAs(original.ids, "delivered");
    const correction = await world.seedAlert({ recipients: [asked.id, kept.id], kind: "correction" });
    await correcting(correction.entry.entryId, original.entry);
    await sentAs(correction.ids, "delivered");
    await ended(campaignId);
    expect(await purge().run()).toMatchObject({ deleted: 1, completed: true });
    expect(await owner`select entry_id from correction_reach_kept`).toEqual([{ entry_id: correction.entry.entryId }]);

    // Postgres refuses `truncate alert_entry` while any table holds a foreign key to it and is not truncated with it, empty or not; the database tests'
    // resets truncate the alert tables without naming this one (S08.05's check-in tables, which do reference alert, are named). Rolled back: only that the
    // truncate is not refused is checked.
    expect(await owner`select conname from pg_constraint where conrelid = 'correction_reach_kept'::regclass and contype = 'f'`).toEqual([]);
    const reset = () =>
      owner.begin(async (tx) => {
        await tx.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
        throw new Error("rolled back");
      });
    expect(await refusal(reset)).toBe("rolled back");
    expect(await owner`select entry_id from correction_reach_kept`).toEqual([{ entry_id: correction.entry.entryId }]);
  });
});
