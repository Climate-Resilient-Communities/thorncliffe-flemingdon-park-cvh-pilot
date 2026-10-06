// The end-of-pilot re-consent campaign against a real database, as the app's own role (S09.07; E09 definitions "Campaign", "Re-consent prompt", "Receiving
// subscriber"; AD-9 D-7): the `campaign` table and its guard (an active Admin from their own session at aal2, read by the database; the deadline 30 days on
// in Toronto; a rehearsal first; one real campaign; nothing frozen changes; ended only after the deadline; sign-ups reopened once, after it); the outbox's
// campaign rule (S06.01's seam: accepted only for a real campaign started by an Admin at aal2 who is still one, not cancelled, and refused for one started at
// aal1, by a Coordinator, a Director or an Ambassador, by a suspended or removed Admin, or cancelled; the frozen text, the key, the recipient; the rehearsal
// only to the drill roster); the rehearsal; the start in one transaction (every active subscriber asked in their language with a prompt and one text, every
// pending sign-up deleted, sign-ups closed, audited with counts; a retried request and a second start change nothing; a sign-up under way finishes first);
// YES before and after the deadline; who receives texts before and after it (the fan-out, the hand-off's number, a resend's check, the measures); the sender
// at the hand-off; and the end job. Every number is fictitious (the 555 exchange); nothing reaches Twilio.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { campaignSpendCap } from "../../src/app/campaign";
import { ownerSources, wireContactResolver } from "../../src/app/messaging";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "../../src/modules/places";
import {
  campaignStandingReader,
  createCampaigns,
  createInboundRouter,
  createRateLimiter,
  createSignup,
  createSubscriberMeasuresJob,
  renderCampaignText,
  residentSms,
  subscriberLookup,
  subscriberNumberSource,
  subscriberReceives,
  type Campaigns,
  type InboundOutcome,
} from "../../src/modules/subscriptions";
import { recipientStore } from "../../src/modules/subscriptions/adapters/recipientStore";
import { campaignTexts } from "../../src/modules/subscriptions/domain/campaign";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

type Row = Record<string, unknown>;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let auditBaseline = 0;
let phoneCounter = 0;
let sid = 0;

/** The terms version subscribers signed up under, and the one they re-consent to. */
const SIGNED_UP = "2026-10-01.1";
const TERMS = "2026-11-02.2";
const KEY = "a-test-key-for-the-reply-limit";
const GATE = "hashtextextended('subscriptions:signup_gate', 7302118450)";

const auditTrail = { record: (tx: Parameters<typeof record>[0], event: Parameters<typeof record>[1]) => record(tx, event), recordRefusal: (db: Db, event: Parameters<typeof recordRefusal>[1]) => recordRefusal(db, event) };

function service(): Campaigns {
  const queue = createDeliveryQueue();
  return createCampaigns({
    db: app,
    enqueue: (tx, input) => queue.enqueueCampaignDelivery(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    termsVersion: () => TERMS,
    pricePerSegmentCents: () => 1.5,
    audit: auditTrail as never,
    spendCap: campaignSpendCap,
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
  await owner`delete from campaign`;
  await owner`delete from subscriber_measure`;
  await owner`delete from staff_session where staff_account_id in (select id from staff_account where username like 'dl\\_%')`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner`delete from ops_event where kind = 'spend.cap_overrun'`;
  await world.reset();
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

/** An open session of a staff account, as the sign-in records it; at aal2 when the account entered its authenticator code (S01.10). */
async function sessionOf(staffId: string, options: { aal2?: boolean; revoked?: boolean } = {}): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at, revoked_at, aal2_at)
              values (${id}, ${staffId}, now(), now(), ${options.revoked ? new Date() : null}, ${options.aal2 === false ? null : new Date()})`;
  return id;
}

/** An Admin (or another role) with an open session at aal2. */
async function staff(role: "admin" | "coordinator" | "director" | "ambassador" = "admin", status = "active") {
  const account = await world.fx.staff(role, status);
  return { id: account.id, session: await sessionOf(account.id) };
}

async function subscriber(lang = "en", state: "active" | "reconsent_pending" | "retained" = "active", neighbourhood = "TP"): Promise<{ id: string; phone: string }> {
  phoneCounter += 1;
  const id = randomUUID();
  const phone = `+1416555${String(phoneCounter).padStart(4, "0")}`;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
              values (${id}, ${phone}, ${lang}, ${neighbourhood}, ${[]}, ${SIGNED_UP}, 'web', ${state})`;
  return { id, phone };
}

/** The web sign-up as the app composes it (the real sign-up gate); every pending sign-up's number is fictitious. */
function signupService() {
  const queue = createDeliveryQueue();
  return createSignup({
    db: app,
    places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    subscribers: subscriberLookup(),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: () => SIGNED_UP,
    limiter: () => createRateLimiter({ db: app, key: KEY }),
    pricePerSegmentCents: () => 1.5,
  });
}

function signUp(phone = "+14165550177") {
  phoneCounter += 1;
  return signupService().request({ phone, lang: "fr", neighbourhood: "TP", places: [], groups: [], consentVersion: SIGNED_UP }, `203.0.113.${(phoneCounter % 200) + 1}`);
}

/** The inbound router as src/app/inbound.ts composes it. */
function router() {
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
  });
}
const nextSid = () => `SM${(++sid).toString(16).padStart(32, "0")}`;
const textFrom = (phone: string, body: string): Promise<InboundOutcome> => router().handle({ messageSid: nextSid(), from: phone, body, optOutType: null });

const deadlineNow = async (): Promise<string> => (await owner`select ((now() at time zone 'America/Toronto')::date + 30)::text as day`)[0]!.day as string;

async function rehearse(admin: { id: string; session: string }, key = randomUUID()) {
  // A rehearsal needs a phone on the drill roster to reach.
  if ((await owner`select count(*)::int as n from drill_roster`)[0]!.n === 0) await world.fx.rosterMember();
  const outcome = await service().rehearse({ actorStaffId: admin.id, sessionId: admin.session, idempotencyKey: key, deadlineSeen: await deadlineNow() });
  if (outcome.kind !== "rehearsed") throw new Error(`rehearsal refused: ${outcome.reason}`);
  return outcome;
}

async function start(admin: { id: string; session: string }, key = randomUUID()) {
  return service().start({ actorStaffId: admin.id, sessionId: admin.session, idempotencyKey: key, deadlineSeen: await deadlineNow(), confirmed: true });
}

async function started(admin: { id: string; session: string }) {
  await rehearse(admin);
  const outcome = await start(admin);
  if (outcome.kind !== "started") throw new Error(`start refused: ${JSON.stringify(outcome)}`);
  return outcome;
}

/** Moves a campaign's deadline into the past (its guard switched off for the owner's one update), as if 30 days had gone by. */
async function pastDeadline(campaignId: string) {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table campaign disable trigger campaign_guard");
    await tx`update campaign set deadline_date = deadline_date - 31, deadline = campaign_deadline_of(deadline_date - 31) where id = ${campaignId}`;
    await tx.unsafe("alter table campaign enable trigger campaign_guard");
  });
}

const refusal = (run: () => PromiseLike<unknown>) => Promise.resolve(run()).then(() => "", (error: { message: string }) => error.message);

/** A campaign row the app's role inserts directly, with what the use case would write (the database decides the rest). */
async function insertCampaign(over: Row & { startedBy: string; session: string }) {
  const deadline = (over.deadline_date as string | undefined) ?? (await deadlineNow());
  const row: Row = {
    id: randomUUID(),
    rehearsal: true,
    deadline_date: deadline,
    terms_version: TERMS,
    texts: campaignTexts(await deadlineNow(), renderCampaignText),
    started_by: over.startedBy,
    started_session: over.session,
    started_aal: "aal2",
    idempotency_key: randomUUID(),
    ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== "startedBy" && key !== "session")),
  };
  const [inserted] = await appSql`insert into campaign ${appSql({ ...row, texts: appSql.json(row.texts as never), deadline: new Date() } as never)} returning *`;
  return inserted as Row;
}

/** A campaign row the owner writes with the guard off: what the database's own check would never let anyone make (for the outbox's second check). */
async function forgedCampaign(over: Row & { startedBy: string }) {
  const id = randomUUID();
  // Read first: the owner's connection is the transaction's while it is open.
  const deadlineDate = await deadlineNow();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table campaign disable trigger campaign_guard");
    await tx`insert into campaign ${tx({
      id,
      rehearsal: true,
      deadline_date: deadlineDate,
      deadline: new Date(Date.now() + 30 * 86_400_000),
      terms_version: TERMS,
      texts: tx.json(campaignTexts(deadlineDate, renderCampaignText) as never),
      started_by: over.startedBy,
      started_session: randomBytes(32).toString("hex"),
      started_aal: (over.started_aal as string | undefined) ?? "aal2",
      idempotency_key: randomUUID(),
    } as never)}`;
    await tx.unsafe("alter table campaign enable trigger campaign_guard");
  });
  return id;
}

/** A campaign text for a recipient, inserted as the app's role, as the outbox's use case writes it. */
function campaignText(campaignId: string, recipient: { kind: string; id: string }, over: Row = {}) {
  const texts = campaignTextsFor;
  const lang = (over.lang as string | undefined) ?? "en";
  const row: Row = {
    id: randomUUID(),
    kind: "campaign",
    recipient_kind: recipient.kind,
    recipient_id: recipient.id,
    campaign_id: campaignId,
    created_by_module: "subscriptions",
    purpose: "reconsent",
    lang,
    body: texts.current![lang]!.body,
    segments: texts.current![lang]!.segments,
    cost_estimate_cents: 2,
    idempotency_key: `campaign:${campaignId}:reconsent:${recipient.id}`,
    ...over,
  };
  return appSql`insert into delivery ${appSql(row as never)} returning id, state, claim_rank`;
}
const campaignTextsFor: { current: Record<string, { body: string; segments: number }> | null } = { current: null };

const auditOf = (action: string) =>
  owner<{ actor_staff_id: string | null; subject_type: string; subject_id: string | null; outcome: string; meta: Record<string, unknown> }[]>`
    select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = ${action} order by id`;
const statesOf = async () => Object.fromEntries((await owner`select id, retention_state from subscriber`).map((row) => [row.id as string, row.retention_state as string]));
const campaignDeliveries = (campaignId: string) =>
  owner`select recipient_kind, recipient_id, lang, body, segments, purpose, state, idempotency_key, claim_rank from delivery where campaign_id = ${campaignId} order by lang, recipient_id`;

beforeEach(async () => {
  campaignTextsFor.current = campaignTexts(await deadlineNow(), renderCampaignText);
});

// --- the table ------------------------------------------------------------------------------------------------------------------------------------------

describe("the campaign table", () => {
  it("is the app's role's alone: it reads, inserts, and changes only the state and who reopened sign-ups; no client role reaches it", async () => {
    const [rls] = await owner`select relrowsecurity from pg_class where relname = 'campaign'`;
    expect(rls!.relrowsecurity).toBe(true);
    const [rights] = await owner`select has_table_privilege('cvh_app', 'campaign', 'select') as s, has_table_privilege('cvh_app', 'campaign', 'insert') as i,
      has_table_privilege('cvh_app', 'campaign', 'delete') as d, has_table_privilege('cvh_app', 'campaign', 'update') as u,
      has_column_privilege('cvh_app', 'campaign', 'state', 'update') as state, has_column_privilege('cvh_app', 'campaign', 'signups_reopened_by', 'update') as reopened,
      has_column_privilege('cvh_app', 'campaign', 'texts', 'update') as texts, has_column_privilege('cvh_app', 'campaign', 'deadline', 'update') as deadline`;
    expect(rights).toEqual({ s: true, i: true, d: false, u: false, state: true, reopened: true, texts: false, deadline: false });
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [any] = await owner`select has_table_privilege(${role}, 'campaign', 'select') or has_table_privilege(${role}, 'campaign', 'insert') as any`;
      expect(any!.any, role).toBe(false);
    }
    // YES makes a subscriber `retained` under the campaign's terms version: that column, and still not the number or the language.
    const [columns] = await owner`select has_column_privilege('cvh_app', 'subscriber', 'consent_version', 'update') as consent,
      has_column_privilege('cvh_app', 'subscriber', 'phone', 'update') as phone`;
    expect(columns).toEqual({ consent: true, phone: false });
  });

  it("is started only by an active Admin from their own open session that reached aal2: the database reads the session, whatever the caller says", async () => {
    const admin = await staff("admin");
    const aal1 = await sessionOf(admin.id, { aal2: false });
    const revoked = await sessionOf(admin.id, { revoked: true });
    const other = await staff("admin");
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: aal1 }))).toMatch(/started by an Admin at aal2/);
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: revoked }))).toMatch(/own open session/);
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: other.session }))).toMatch(/own open session/);
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: randomBytes(32).toString("hex") }))).toMatch(/own open session/);
    for (const role of ["coordinator", "director", "ambassador"] as const) {
      const person = await staff(role);
      expect(await refusal(() => insertCampaign({ startedBy: person.id, session: person.session })), role).toMatch(/active Admin/);
    }
    for (const status of ["suspended", "removed"]) {
      const person = await staff("admin", status);
      expect(await refusal(() => insertCampaign({ startedBy: person.id, session: person.session })), status).toMatch(/active Admin/);
    }
    // The deadline is the database's: 30 days on in Toronto.
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: admin.session, deadline_date: "2030-01-01" }))).toMatch(/30 days after the start/);
    const texts = campaignTexts(await deadlineNow(), renderCampaignText) as Record<string, unknown>;
    delete texts.ur;
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: admin.session, texts }))).toMatch(/frozen text of language ur/);
    // A real campaign needs a rehearsal first; then there is one real campaign at most.
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false }))).toMatch(/rehearsed on the drill roster/);
    const rehearsal = await insertCampaign({ startedBy: admin.id, session: admin.session, started_aal: "aal1" });
    expect(rehearsal).toMatchObject({ rehearsal: true, state: "started", started_aal: "aal2", ended_at: null });
    const [deadline] = await owner`select deadline = campaign_deadline_of(deadline_date) as ok, deadline > now() + interval '29 days' as later from campaign where id = ${rehearsal.id as string}`;
    expect(deadline).toEqual({ ok: true, later: true });
    await insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false });
    expect(await refusal(() => insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false }))).toMatch(/campaign_one_real_idx/);
    // Nor the owner: the guard is a trigger, not a grant.
    expect(await refusal(() => owner`insert into campaign ${owner({ id: randomUUID(), rehearsal: true, deadline_date: "2026-01-01", deadline: new Date(), terms_version: TERMS, texts: owner.json({}), started_by: admin.id, started_session: aal1, started_aal: "aal2", idempotency_key: randomUUID() } as never)}`)).toMatch(/aal2/);
  });

  it("never changes what was frozen, ends only once its deadline has passed, and reopens sign-ups once, after the real campaign ended, by an active Admin", async () => {
    const admin = await staff("admin");
    const rehearsal = await insertCampaign({ startedBy: admin.id, session: admin.session });
    const real = await insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false });
    const id = real.id as string;
    expect(await refusal(() => owner`update campaign set texts = '{}'::jsonb where id = ${id}`)).toMatch(/frozen at the start never changes/);
    expect(await refusal(() => owner`update campaign set terms_version = '2027-01-01.1' where id = ${id}`)).toMatch(/frozen at the start never changes/);
    expect(await refusal(() => appSql`update campaign set state = 'ended' where id = ${id}`)).toMatch(/ends once its deadline has passed/);
    expect(await refusal(() => appSql`update campaign set signups_reopened_by = ${admin.id} where id = ${id}`)).toMatch(/after the campaign ended/);
    expect(await refusal(() => appSql`update campaign set texts = '{}'::jsonb where id = ${id}`)).toMatch(/permission denied/);
    await pastDeadline(id);
    await appSql`update campaign set state = 'ended' where id = ${id}`;
    const [ended] = await owner`select state, ended_at is not null as stamped from campaign where id = ${id}`;
    expect(ended).toEqual({ state: "ended", stamped: true });
    expect(await refusal(() => appSql`update campaign set state = 'started' where id = ${id}`)).toMatch(/ended to started is not an allowed change/);
    const coordinator = await staff("coordinator");
    expect(await refusal(() => appSql`update campaign set signups_reopened_by = ${coordinator.id} where id = ${id}`)).toMatch(/reopened by an active Admin/);
    await appSql`update campaign set signups_reopened_by = ${admin.id} where id = ${id}`;
    expect((await owner`select signups_reopened_at is not null as stamped from campaign where id = ${id}`)[0]).toEqual({ stamped: true });
    expect(await refusal(() => appSql`update campaign set signups_reopened_by = ${coordinator.id} where id = ${id}`)).toMatch(/reopened once/);
    // A rehearsal never reopens anything, and nobody deletes a campaign.
    await pastDeadline(rehearsal.id as string);
    await appSql`update campaign set state = 'ended' where id = ${rehearsal.id as string}`;
    expect(await refusal(() => appSql`update campaign set signups_reopened_by = ${admin.id} where id = ${rehearsal.id as string}`)).toMatch(/after the campaign ended/);
    expect(await refusal(() => appSql`delete from campaign where id = ${id}`)).toMatch(/permission denied/);
  });
});

// --- the outbox -----------------------------------------------------------------------------------------------------------------------------------------

describe("a campaign text in the outbox (S06.01's seam)", () => {
  it("is accepted only for a campaign started by an Admin at aal2 who is still an active Admin, and not cancelled", async () => {
    const admin = await staff("admin");
    await insertCampaign({ startedBy: admin.id, session: admin.session });
    const real = (await insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false })).id as string;
    const asked = await subscriber("en", "reconsent_pending");
    const answer = async (id: string) => (await appSql`select delivery_campaign_started_by_admin(${id}::uuid) as ok`)[0]!.ok;
    expect(await answer(real)).toBe(true);
    const [accepted] = await campaignText(real, { kind: "subscriber", id: asked.id });
    // The last in the claim order (S06.02).
    expect(accepted).toMatchObject({ state: "queued", claim_rank: 5 });

    // A campaign row the database's guard would never make (written by the owner with the guard off): started at aal1, or by another role.
    expect(await answer(await forgedCampaign({ startedBy: admin.id, started_aal: "aal1" }))).toBe(false);
    for (const role of ["coordinator", "director", "ambassador"] as const) {
      const person = await staff(role);
      const forged = await forgedCampaign({ startedBy: person.id });
      expect(await answer(forged), role).toBe(false);
      const target = await subscriber("en", "reconsent_pending");
      expect(await refusal(() => campaignText(forged, { kind: "subscriber", id: target.id })), role).toMatch(/started by an Admin at aal2/);
    }
    const second = await subscriber("en", "reconsent_pending");
    // The Admin who started it is suspended, then removed: no text is made for it any more.
    for (const status of ["suspended", "removed"]) {
      await owner`update staff_account set status = ${status}::staff_status where id = ${admin.id}`;
      expect(await answer(real), status).toBe(false);
      expect(await refusal(() => campaignText(real, { kind: "subscriber", id: second.id })), status).toMatch(/started by an Admin at aal2/);
    }
    await owner`update staff_account set status = 'active' where id = ${admin.id}`;
    // Cancelled (the owner's to do): no text either.
    await owner`update campaign set state = 'cancelled' where id = ${real}`;
    expect(await answer(real)).toBe(false);
    expect(await refusal(() => campaignText(real, { kind: "subscriber", id: second.id }))).toMatch(/started by an Admin at aal2/);
    expect(await answer(randomUUID())).toBe(false);
  });

  it("carries the campaign's frozen text, the purpose reconsent and the key campaign:{campaign}:reconsent:{recipient}, and is made only while the campaign runs", async () => {
    const admin = await staff("admin");
    await insertCampaign({ startedBy: admin.id, session: admin.session });
    const real = (await insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false })).id as string;
    const asked = await subscriber("ur", "reconsent_pending");
    const refused = (over: Row) => refusal(() => campaignText(real, { kind: "subscriber", id: asked.id }, { lang: "ur", ...over }));
    expect(await refused({ body: "Reply YES to stay." })).toMatch(/frozen text and segments/);
    expect(await refused({ body: campaignTextsFor.current!.en!.body })).toMatch(/frozen text and segments/);
    expect(await refused({ purpose: "welcome", idempotency_key: `campaign:${real}:welcome:${asked.id}` })).toMatch(/purpose is reconsent/);
    expect(await refused({ idempotency_key: `campaign:${real}:reconsent:${randomUUID()}` })).toMatch(/key is campaign:campaign_id:reconsent:recipient_id/);
    expect(await refused({ idempotency_key: `campaign:${randomUUID()}:reconsent:${asked.id}` })).toMatch(/key is campaign:campaign_id:reconsent:recipient_id/);
    // The shape of its kind: a campaign, a purpose, the subscriptions module, no entry; and no phone number in its key.
    expect(await refused({ campaign_id: null })).toMatch(/started by an Admin at aal2/);
    expect(await refused({ created_by_module: "ops" })).toMatch(/delivery_kind_shape/);
    expect(await refused({ entry_id: (await world.fx.entry("pending_approval")).entryId })).toMatch(/delivery_kind_shape/);
    expect(await refused({ idempotency_key: `campaign:${real}:reconsent:4165550123` })).toMatch(/no part of a key is a phone number/);
    expect(await refused({ idempotency_key: `${real}:${asked.id}:sms` })).toMatch(/kind:subject:purpose:nonce/);
    await campaignText(real, { kind: "subscriber", id: asked.id }, { lang: "ur" });
    // One text per campaign and recipient: the key is unique.
    expect(await refused({})).toMatch(/delivery_idempotency_key_unique/);
    await pastDeadline(real);
    const late = await subscriber("en", "reconsent_pending");
    expect(await refusal(() => campaignText(real, { kind: "subscriber", id: late.id }))).toMatch(/only while its campaign runs/);
  });

  it("goes to the drill roster only for a rehearsal, and to a subscriber the real campaign asks only for the real one", async () => {
    const admin = await staff("admin");
    const rehearsal = (await insertCampaign({ startedBy: admin.id, session: admin.session })).id as string;
    const real = (await insertCampaign({ startedBy: admin.id, session: admin.session, rehearsal: false })).id as string;
    const member = await world.fx.rosterMember();
    const asked = await subscriber("en", "reconsent_pending");
    const active = await subscriber("en", "active");
    expect(await refusal(() => campaignText(rehearsal, { kind: "subscriber", id: asked.id }))).toMatch(/rehearsal is texted only to a member of the drill roster/);
    expect(await refusal(() => campaignText(rehearsal, { kind: "roster", id: randomUUID() }))).toMatch(/rehearsal is texted only to a member of the drill roster/);
    await campaignText(rehearsal, { kind: "roster", id: member });
    expect(await refusal(() => campaignText(real, { kind: "roster", id: member }))).toMatch(/only to a subscriber it asks to re-consent/);
    expect(await refusal(() => campaignText(real, { kind: "subscriber", id: active.id }))).toMatch(/only to a subscriber it asks to re-consent/);
    // Any other kind of recipient: the guard (it runs first) or the table's shape check refuses it, for a rehearsal and for the real campaign.
    for (const kind of ["pending_signup", "staff", "oncall", "inbound_reply"]) {
      expect(await refusal(() => campaignText(rehearsal, { kind, id: member })), kind).toMatch(/only to a member of the drill roster|delivery_kind_shape/);
      expect(await refusal(() => campaignText(real, { kind, id: asked.id })), kind).toMatch(/only to a subscriber it asks|delivery_kind_shape/);
    }
    await campaignText(real, { kind: "subscriber", id: asked.id });
  });
});

// --- the rehearsal --------------------------------------------------------------------------------------------------------------------------------------

describe("the rehearsal on the drill roster", () => {
  it("texts the campaign's exact text to every phone on the roster in its language (English where it has none), changes no subscriber or sign-up, and is audited", async () => {
    const admin = await staff("admin");
    const en = await world.fx.rosterMember({ lang: "en" });
    const ur = await world.fx.rosterMember({ lang: "ur" });
    const hant = await world.fx.rosterMember({ lang: "zh-Hant" });
    const active = await subscriber("fr", "active");
    expect(await signUp()).toEqual({ kind: "accepted" });
    const key = randomUUID();
    const outcome = await rehearse(admin, key);
    expect(outcome).toMatchObject({ kind: "rehearsed", texts: 3, replayed: false });
    const texts = await campaignDeliveries(outcome.campaign.id);
    expect(texts.map((row) => [row.recipient_id, row.lang])).toEqual(
      [
        [en, "en"],
        [hant, "en"],
        [ur, "ur"],
      ].sort((a, b) => `${a[1]}${a[0]}`.localeCompare(`${b[1]}${b[0]}`)),
    );
    for (const row of texts) {
      expect(row).toMatchObject({ recipient_kind: "roster", purpose: "reconsent", state: "queued", body: campaignTextsFor.current![row.lang as string]!.body });
      expect(row.idempotency_key).toBe(`campaign:${outcome.campaign.id}:reconsent:${row.recipient_id}`);
    }
    expect(await statesOf()).toEqual({ [active.id]: "active" });
    expect(await owner`select count(*)::int as n from pending_signup`).toEqual([{ n: 1 }]);
    expect(await auditOf("campaign.rehearsed")).toEqual([{ actor_staff_id: admin.id, subject_type: "campaign", subject_id: outcome.campaign.id, outcome: "ok", meta: { queued: 3 } }]);
    // A retried request finds the rehearsal: nothing new.
    expect(await service().rehearse({ actorStaffId: admin.id, sessionId: admin.session, idempotencyKey: key, deadlineSeen: await deadlineNow() })).toMatchObject({ kind: "rehearsed", replayed: true });
    expect(await campaignDeliveries(outcome.campaign.id)).toHaveLength(3);
    // Sign-ups stay open.
    expect(await signUp("+14165550178")).toEqual({ kind: "accepted" });
  });

  it("is not made while the roster is empty: it would reach nobody", async () => {
    const admin = await staff("admin");
    expect(await service().rehearse({ actorStaffId: admin.id, sessionId: admin.session, idempotencyKey: randomUUID(), deadlineSeen: await deadlineNow() })).toEqual({ kind: "refused", reason: "roster_empty" });
    expect(await owner`select count(*)::int as n from campaign`).toEqual([{ n: 0 }]);
    expect((await auditOf("campaign.rehearsed")).map((row) => [row.outcome, row.meta])).toEqual([["refused", { reason: "not_available" }]]);
  });

  it("is what the start needs: without one the start is refused, audited, and nothing changes", async () => {
    const admin = await staff("admin");
    const active = await subscriber("en");
    expect(await start(admin)).toEqual({ kind: "refused", reason: "rehearsal_needed" });
    expect(await statesOf()).toEqual({ [active.id]: "active" });
    expect(await owner`select count(*)::int as n from campaign`).toEqual([{ n: 0 }]);
    expect(await auditOf("campaign.started")).toEqual([{ actor_staff_id: admin.id, subject_type: "campaign", subject_id: null, outcome: "refused", meta: { reason: "rehearsal_needed" } }]);
  });
});

// --- the start ------------------------------------------------------------------------------------------------------------------------------------------

describe("the start", () => {
  it("in one transaction asks every active subscriber in their language, deletes every pending sign-up, closes sign-ups and is audited with counts", async () => {
    const admin = await staff("admin");
    const en = await subscriber("en");
    const ur = await subscriber("ur", "active", "FP");
    const ta = await subscriber("ta");
    expect(await signUp()).toEqual({ kind: "accepted" });
    const [confirmation] = await owner`select id from delivery where purpose = 'confirmation'`;
    // A subscriber with a menu or a deletion's confirmation open: the re-consent prompt takes its place.
    await owner`insert into sms_prompt (subscriber_id, kind, expires_at) values (${en.id}, 'delete_confirm', now() + interval '10 minutes')`;

    const outcome = await started(admin);
    expect(outcome).toMatchObject({ kind: "started", asked: 3, texts: 3, pendingDeleted: 1, overrun: null });
    const id = outcome.campaign.id;
    expect(await statesOf()).toEqual({ [en.id]: "reconsent_pending", [ur.id]: "reconsent_pending", [ta.id]: "reconsent_pending" });
    const prompts = await owner`select p.subscriber_id, p.kind, p.expires_at = c.deadline as until_deadline from sms_prompt p, campaign c where c.id = ${id} order by p.subscriber_id`;
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) expect(prompt).toMatchObject({ kind: "reconsent", until_deadline: true });
    const texts = await campaignDeliveries(id);
    expect(texts.map((row) => [row.recipient_id, row.lang])).toEqual([
      [en.id, "en"],
      [ta.id, "ta"],
      [ur.id, "ur"],
    ]);
    for (const row of texts) {
      expect(row).toMatchObject({ recipient_kind: "subscriber", purpose: "reconsent", state: "queued", segments: 1 });
      expect(row.idempotency_key).toBe(`campaign:${id}:reconsent:${row.recipient_id}`);
      expect(row.body).toBe(campaignTextsFor.current![row.lang as string]!.body);
      expect(row.body).toContain("YES");
    }
    // The English text names the deadline.
    expect(texts[0]!.body).toMatch(/^The CVH pilot is ending\. Reply YES to keep getting alerts\. If you do not reply by [A-Z][a-z]+ \d{1,2}, your number will be deleted\.$/);
    const [row] = await owner`select rehearsal, state, terms_version, deadline_date::text as day, (select count(*)::int from jsonb_object_keys(texts)) as langs from campaign where id = ${id}`;
    expect(row).toEqual({ rehearsal: false, state: "started", terms_version: TERMS, day: await deadlineNow(), langs: 15 });
    // Every pending sign-up is gone, its waiting confirmation skipped; sign-ups are closed on every path.
    expect(await owner`select count(*)::int as n from pending_signup`).toEqual([{ n: 0 }]);
    expect((await owner`select state from delivery where id = ${confirmation!.id as string}`)[0]).toMatchObject({ state: "skipped" });
    expect(await signUp("+14165550179")).toEqual({ kind: "refused", code: "signups_paused" });
    expect(await auditOf("campaign.started")).toEqual([{ actor_staff_id: admin.id, subject_type: "campaign", subject_id: id, outcome: "ok", meta: { asked: 3, queued: 3, pending_deleted: 1 } }]);
    // No number anywhere in the trail.
    expect(JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`)).not.toMatch(/555\d{4}/);
  });

  it("changes nothing when the request is retried, and nothing when it is started again: no second text", async () => {
    const admin = await staff("admin");
    await subscriber("en");
    await rehearse(admin);
    const key = randomUUID();
    const first = await start(admin, key);
    expect(first.kind).toBe("started");
    const before = await owner`select count(*)::int as n from delivery`;
    expect(await start(admin, key)).toMatchObject({ kind: "already_started" });
    const other = await staff("admin");
    await subscriber("fr");
    expect(await start(other)).toEqual({ kind: "refused", reason: "already_started" });
    expect(await owner`select count(*)::int as n from delivery`).toEqual(before);
    expect(await owner`select count(*)::int as n from campaign where not rehearsal`).toEqual([{ n: 1 }]);
    expect((await auditOf("campaign.started")).map((row) => [row.outcome, row.meta])).toEqual([
      ["ok", { asked: 1, queued: 1, pending_deleted: 0 }],
      ["refused", { reason: "conflict" }],
    ]);
  });

  it("is refused, changing nothing, when the deadline changed since the page was opened, the Admin did not confirm, or the request is not the Hub's", async () => {
    const admin = await staff("admin");
    const active = await subscriber("en");
    await rehearse(admin);
    const base = { actorStaffId: admin.id, sessionId: admin.session, idempotencyKey: randomUUID(), confirmed: true };
    expect(await service().start({ ...base, deadlineSeen: "2026-01-01" })).toEqual({ kind: "refused", reason: "deadline_changed", deadlineDate: await deadlineNow() });
    expect(await service().start({ ...base, deadlineSeen: await deadlineNow(), confirmed: false })).toEqual({ kind: "refused", reason: "not_confirmed" });
    expect(await service().start({ ...base, idempotencyKey: "nope", deadlineSeen: await deadlineNow() })).toEqual({ kind: "refused", reason: "key_invalid" });
    expect(await statesOf()).toEqual({ [active.id]: "active" });
    expect(await owner`select count(*)::int as n from campaign where not rehearsal`).toEqual([{ n: 0 }]);
  });

  it("waits for a sign-up that is under way, then deletes it; a sign-up that comes after is refused", async () => {
    const admin = await staff("admin");
    await rehearse(admin);
    // A sign-up's transaction holding the gate, as webSignup's does, with its pending row written and not yet committed.
    const signup = await appSql.reserve();
    try {
      await signup`begin`;
      await signup.unsafe(`select pg_advisory_xact_lock_shared(${GATE})`);
      await signup`insert into pending_signup (id, phone, lang, neighbourhood_id, consent_version, started_by) values (${randomUUID()}, '+14165550188', 'en', 'TP', ${SIGNED_UP}, 'web')`;
      let settled = false;
      const starting = start(admin).then((outcome) => ((settled = true), outcome));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
      await signup`commit`;
      expect(await starting).toMatchObject({ kind: "started", pendingDeleted: 1 });
    } finally {
      signup.release();
    }
    expect(await owner`select count(*)::int as n from pending_signup`).toEqual([{ n: 0 }]);
    expect(await signUp("+14165550189")).toEqual({ kind: "refused", code: "signups_paused" });
  });
});

// --- YES ------------------------------------------------------------------------------------------------------------------------------------------------

describe("YES from a subscriber asked to re-consent", () => {
  it("before the deadline resolves to the re-consent prompt: the subscriber stays under the campaign's terms version and is told so", async () => {
    const admin = await staff("admin");
    const ur = await subscriber("ur");
    await started(admin);
    expect(await textFrom(ur.phone, "ہاں")).toMatchObject({ state: "active", action: "reconsent", replied: true });
    const [row] = await owner`select retention_state, consent_version from subscriber where id = ${ur.id}`;
    expect(row).toEqual({ retention_state: "retained", consent_version: TERMS });
    expect(await owner`select count(*)::int as n from sms_prompt where subscriber_id = ${ur.id}`).toEqual([{ n: 0 }]);
    const [kept] = await owner`select recipient_kind, recipient_id, purpose, lang, body from delivery where purpose = 'prompt_reply'`;
    expect(kept).toEqual({ recipient_kind: "subscriber", recipient_id: ur.id, purpose: "prompt_reply", lang: "ur", body: residentSms("ur", "reconsentKept").body });
    // Once kept, YES is what it always was.
    expect(await textFrom(ur.phone, "YES")).toMatchObject({ action: "already_signed_up" });
  });

  it("resolves to it even when a later prompt (the deletion's confirmation) took its row: YES cancels that prompt and keeps the subscriber", async () => {
    const admin = await staff("admin");
    const en = await subscriber("en");
    await started(admin);
    expect(await textFrom(en.phone, "0")).toMatchObject({ action: "ask_delete" });
    expect((await owner`select kind from sms_prompt where subscriber_id = ${en.id}`)[0]).toEqual({ kind: "delete_confirm" });
    expect(await textFrom(en.phone, "yes")).toMatchObject({ action: "reconsent" });
    expect(await statesOf()).toEqual({ [en.id]: "retained" });
    expect(await owner`select count(*)::int as n from sms_prompt`).toEqual([{ n: 0 }]);
  });

  it("after the deadline is answered that the pilot has ended through inbound_reply, and changes nothing; STOP still deletes", async () => {
    const admin = await staff("admin");
    const fr = await subscriber("fr");
    const { campaign } = await started(admin);
    await pastDeadline(campaign.id);
    expect(await textFrom(fr.phone, "Oui")).toMatchObject({ state: "lapsed", action: "pilot_ended", replied: true });
    expect(await statesOf()).toEqual({ [fr.id]: "reconsent_pending" });
    const [reply] = await owner`select d.recipient_kind, d.purpose, d.lang, d.body from delivery d where d.purpose = 'signup_info'`;
    expect(reply).toEqual({ recipient_kind: "inbound_reply", purpose: "signup_info", lang: "fr", body: residentSms("fr", "pilotEnded").body });
    expect(await owner`select count(*)::int as n from inbound_reply`).toEqual([{ n: 1 }]);
    // Anything else gets nothing: they receive no texts now.
    expect(await textFrom(fr.phone, "1")).toMatchObject({ state: "lapsed", action: "none", replied: false });
    expect(await textFrom(fr.phone, "STOP")).toMatchObject({ action: "delete" });
    expect(await statesOf()).toEqual({});
  });

  it("from a number the CVH does not know while sign-ups are paused: told so instead of the link; after the deadline YES is told the pilot has ended", async () => {
    const admin = await staff("admin");
    await subscriber("en");
    const { campaign } = await started(admin);
    expect(await textFrom("+14165550190", "hello")).toMatchObject({ state: "none", action: "signup_info", replied: true });
    await pastDeadline(campaign.id);
    expect(await textFrom("+14165550191", "YES")).toMatchObject({ state: "none", action: "signup_info", replied: true });
    const bodies = (await owner`select body from delivery where purpose = 'signup_info' order by created_at`).map((row) => row.body);
    expect(bodies).toEqual([residentSms("en", "signupsPaused").body, residentSms("en", "pilotEnded").body]);
  });
});

// --- receiving subscribers ------------------------------------------------------------------------------------------------------------------------------

describe("receiving subscribers", () => {
  it("are active, retained, and asked until the deadline; after it the asked are not: the fan-out, the hand-off's number, a resend's check and the measures agree", async () => {
    const admin = await staff("admin");
    const asked = await subscriber("en");
    const kept = await subscriber("ur");
    const { campaign } = await started(admin);
    await textFrom(kept.phone, "YES");
    const joined = await subscriber("fr", "active");
    const audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], buildings: [], types: ["power"], groups: [] } as never;
    const reached = async () => (await recipientStore.reached(app, audience)).map((row) => row.id).sort();
    const numberOf = (id: string) => app.transaction((tx) => subscriberNumberSource().numberOf(tx, id));
    const receives = (id: string) => app.transaction((tx) => subscriberReceives(tx, id));

    expect(await reached()).toEqual([asked.id, kept.id, joined.id].sort());
    expect(await numberOf(asked.id)).toBe(asked.phone);
    expect(await receives(asked.id)).toBe(true);

    await pastDeadline(campaign.id);
    expect(await reached()).toEqual([kept.id, joined.id].sort());
    expect(await numberOf(asked.id)).toBeNull();
    expect(await receives(asked.id)).toBe(false);
    expect(await numberOf(kept.id)).toBe(kept.phone);

    await createSubscriberMeasuresJob({ db: app }).run({ day: "today" });
    const measured = Object.fromEntries(
      (await owner`select measure, sum(n)::int as n from subscriber_measure where measure like 'receiving_%' group by measure`).map((row) => [row.measure as string, row.n as number]),
    );
    expect(measured).toEqual({ receiving_active: 1, receiving_reconsent_pending: 0, receiving_retained: 1 });
  });
});

// --- the sender -----------------------------------------------------------------------------------------------------------------------------------------

describe("the sender at the hand-off point", () => {
  it("hands the campaign's texts to the provider, skips one whose subscriber said YES first, and sends a rehearsal to the drill roster", async () => {
    const admin = await staff("admin");
    const member = await world.fx.rosterMember();
    const first = await subscriber("en");
    const second = await subscriber("en");
    await started(admin);
    await textFrom(second.phone, "YES");
    const resolver = wireContactResolver(ownerSources(), { info: () => {}, error: () => {} });
    const report = await world.dispatcher({ resolver, campaigns: campaignStandingReader() }).run();
    expect(report.submitted).toBeGreaterThanOrEqual(3);
    expect(world.provider.calls.map((call) => call.to)).toContain(first.phone);
    const states = await owner`select recipient_kind, recipient_id, state from delivery where kind = 'campaign' order by recipient_kind, recipient_id`;
    expect(states).toContainEqual({ recipient_kind: "subscriber", recipient_id: first.id, state: "submitted" });
    expect(states).toContainEqual({ recipient_kind: "subscriber", recipient_id: second.id, state: "skipped" });
    expect(states).toContainEqual({ recipient_kind: "roster", recipient_id: member, state: "submitted" });
    // The text that went is the frozen one, byte for byte.
    const toFirst = world.provider.calls.find((call) => call.to === first.phone && call.body.startsWith("The CVH pilot"));
    expect(toFirst?.body).toBe(campaignTextsFor.current!.en!.body);
  });

  it("skips a text of a cancelled campaign", async () => {
    const admin = await staff("admin");
    await subscriber("en");
    const { campaign } = await started(admin);
    await owner`update campaign set state = 'cancelled' where id = ${campaign.id}`;
    const resolver = wireContactResolver(ownerSources(), { info: () => {}, error: () => {} });
    await world.dispatcher({ resolver, campaigns: campaignStandingReader() }).run();
    expect(await owner`select state from delivery where campaign_id = ${campaign.id}`).toEqual([{ state: "skipped" }]);
  });
});

// --- the end --------------------------------------------------------------------------------------------------------------------------------------------

describe("the end", () => {
  it("after the deadline the job ends the campaign and its rehearsal, audited with who stayed and who did not; sign-ups stay closed until an Admin reopens them", async () => {
    const admin = await staff("admin");
    await subscriber("en");
    const kept = await subscriber("en");
    const outcome = await started(admin);
    await textFrom(kept.phone, "YES");
    expect(await service().endDue()).toEqual({ ended: 0, real: null });
    expect(await service().reopenSignups({ actorStaffId: admin.id })).toEqual({ kind: "refused", reason: "not_ended" });
    for (const row of await owner`select id from campaign`) await pastDeadline(row.id as string);

    expect(await service().endDue()).toEqual({ ended: 2, real: { kept: 1, lapsed: 1 } });
    expect(await owner`select state from campaign order by rehearsal`).toEqual([{ state: "ended" }, { state: "ended" }]);
    expect(await auditOf("campaign.ended")).toEqual([{ actor_staff_id: null, subject_type: "campaign", subject_id: outcome.campaign.id, outcome: "ok", meta: { kept: 1, lapsed: 1 } }]);
    // Again: nothing more to end, no second record.
    expect(await service().endDue()).toEqual({ ended: 0, real: null });
    expect(await signUp("+14165550192")).toEqual({ kind: "refused", code: "signups_paused" });

    const reopened = await service().reopenSignups({ actorStaffId: admin.id });
    expect(reopened.kind).toBe("reopened");
    expect(await auditOf("signup.reopened")).toEqual([
      { actor_staff_id: admin.id, subject_type: "campaign", subject_id: null, outcome: "refused", meta: { reason: "conflict" } },
      { actor_staff_id: admin.id, subject_type: "campaign", subject_id: outcome.campaign.id, outcome: "ok", meta: {} },
    ]);
    expect(await service().reopenSignups({ actorStaffId: admin.id })).toEqual({ kind: "refused", reason: "already_reopened" });
    expect(await signUp("+14165550193")).toEqual({ kind: "accepted" });
  });
});
