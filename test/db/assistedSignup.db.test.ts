// The staff-assisted sign-up against a real database (S07.03): a Coordinator, an Ambassador or an Admin starts a resident's sign-up from the
// Text sign-up form, through the form's own control (src/app/staff/text-signup/control.ts) and the sign-up use case with the real outbox,
// limiter, places and audit trail. It writes the same pending sign-up as the web form, with `started_by = staff`, and queues the same one
// confirmation text. It is limited per staff account (40 in 24 hours), never by the residents' 5 an hour from one IP address: a Hub event on one
// shared connection can sign up more than 5 people, while the public form's limit is unchanged. Every attempt is audited as `signup.assisted`
// with the staff id and the outcome, and no number is in the audit trail, the operational events or the limiter's table. Nothing reaches Twilio
// and every number is fictional (555).
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { signupResponse } from "../../src/app/api/signup/handler";
import { signupFromForm, type ControlDeps } from "../../src/app/staff/text-signup/control";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "../../src/modules/places";
import { ASSISTED_SIGNUP_RATE_LIMIT, SIGNUP_RATE_LIMIT, confirmationText, createRateLimiter, createSignup, type Signup, type SubscriberLookup } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let auditBaseline = 0;
let coordinator: string;
let ambassador: string;

const VERSION = "2026-10-02.1";
const RSN_TP = "9100011";
const FLOOR_1 = "0190f000-0000-7000-8000-000000000011";
/** The Hub's shared Wi-Fi: every request of the event comes from it. */
const HUB_WIFI = "203.0.113.50";
const subscribedNumbers = new Set<string>();
const subscribers: SubscriberLookup = { isSubscribed: async (_tx, phone) => subscribedNumbers.has(phone) };

/** The n-th fictional number, typed as a staff member would: 416-555-01nn. */
const typed = (n: number) => `416-555-01${String(n).padStart(2, "0")}`;
const e164 = (n: number) => `+141655501${String(n).padStart(2, "0")}`;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
              values (${RSN_TP}, 'TP', '11 Sample Road', 43.7, -79.34, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN_TP}, '1', 1, true) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from pending_signup`;
  await owner`delete from rate_limit where scope in (${SIGNUP_RATE_LIMIT.scope}, ${ASSISTED_SIGNUP_RATE_LIMIT.scope})`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await world.reset();
  subscribedNumbers.clear();
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn = ${RSN_TP}`;
  await owner`delete from building where rsn = ${RSN_TP}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetAll();
  coordinator = (await world.fx.staff("coordinator")).id;
  ambassador = (await world.fx.staff("ambassador")).id;
});

/** The sign-up as the app composes it (src/app/signup.ts): one service for the web form and the staff form. */
function signupOn(db: Db): Signup {
  const queue = createDeliveryQueue();
  return createSignup({
    db,
    places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    subscribers,
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: () => VERSION,
    limiter: () => createRateLimiter({ db, key: "a-test-key-for-the-rate-limiter" }),
    pricePerSegmentCents: () => 1.5,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (executor, event) => recordRefusal(executor, event) },
  });
}

const staffForm = (n: number, patch: Record<string, string> = {}) => {
  const form = new FormData();
  const fields: Record<string, string> = {
    phone: typed(n),
    lang: "ur",
    consent_version: VERSION,
    neighbourhood: "TP",
    building: RSN_TP,
    floor: FLOOR_1,
    terms_agreed: "yes",
    age_confirmed: "yes",
    ...patch,
  };
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  form.append("groups", "seniors");
  return form;
};

let kicks = 0;
const deps = (signup: Signup): ControlDeps => ({ signup: () => signup, afterAccepted: () => void kicks++, logError: () => {} });

/** The staff member presses "Send the confirmation text" for resident n. */
const assist = (signup: Signup, staffId: string, n: number, patch: Record<string, string> = {}) => signupFromForm(deps(signup), { staffId }, staffForm(n, patch));

/** The resident's own web form from the Hub's Wi-Fi. */
const web = (signup: Signup, n: number) =>
  signupResponse(
    { signup: () => signup, client: (headers) => headers.get("x-real-ip") ?? "unknown" },
    new Request("https://cvh.example/api/signup", {
      method: "POST",
      headers: { "x-real-ip": HUB_WIFI },
      body: JSON.stringify({ v: 1, phone: typed(n), lang: "es", neighbourhood: "FP", places: [], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true }),
    }),
  );

const pendingRows = () => owner`select phone, lang, neighbourhood_id, places, groups, consent_version, started_by from pending_signup order by phone`;
const assistedAudits = () => owner`select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = 'signup.assisted' order by id`;

describe("a staff-assisted sign-up", () => {
  it("writes the pending sign-up with started_by = staff and queues the same one confirmation text as the web form; the resident still replies YES", async () => {
    const signup = signupOn(app);
    kicks = 0;
    expect(await assist(signup, coordinator, 1)).toEqual({ status: "done" });

    expect(await pendingRows()).toEqual([
      { phone: e164(1), lang: "ur", neighbourhood_id: "TP", places: [{ rsn: RSN_TP, floors: [FLOOR_1] }], groups: ["seniors"], consent_version: VERSION, started_by: "staff" },
    ]);
    const texts = await owner`select kind, recipient_kind, created_by_module, purpose, lang, body, state from delivery where purpose = 'confirmation'`;
    expect(texts).toEqual([{ kind: "transactional", recipient_kind: "pending_signup", created_by_module: "subscriptions", purpose: "confirmation", lang: "ur", body: confirmationText("ur").body, state: "queued" }]);
    expect(kicks).toBe(1);
  });

  it("lets one staff member sign up more than 5 people in an hour at the Hub, while the residents' own form from the same Wi-Fi keeps its 5 an hour", async () => {
    const signup = signupOn(app);
    // Five residents sign up on their own phones on the Hub's Wi-Fi: the fifth is the last the public form takes from it.
    for (let n = 1; n <= 5; n += 1) expect((await web(signup, n)).status, `web ${n}`).toBe(202);
    expect((await web(signup, 6)).status).toBe(429);

    // A Coordinator then signs up eight more people there, and an Ambassador two: none of them is held to the IP's limit.
    for (let n = 10; n < 18; n += 1) expect(await assist(signup, coordinator, n), `staff ${n}`).toEqual({ status: "done" });
    for (let n = 20; n < 22; n += 1) expect(await assist(signup, ambassador, n), `staff ${n}`).toEqual({ status: "done" });

    // The public form is still refused from that Wi-Fi: the staff sign-ups neither used nor freed any of its places.
    expect((await web(signup, 7)).status).toBe(429);
    const rows = await pendingRows();
    expect(rows.filter((r) => r.started_by === "web")).toHaveLength(5);
    expect(rows.filter((r) => r.started_by === "staff")).toHaveLength(10);
    const counted = await owner`select scope, count(*)::int as n from rate_limit where scope in (${SIGNUP_RATE_LIMIT.scope}, ${ASSISTED_SIGNUP_RATE_LIMIT.scope}) group by scope order by scope`;
    expect(counted).toEqual([
      { scope: SIGNUP_RATE_LIMIT.scope, n: 5 },
      { scope: ASSISTED_SIGNUP_RATE_LIMIT.scope, n: 10 },
    ]);
  });

  it("refuses the 41st sign-up a staff account starts in 24 hours, storing nothing and auditing it, while another staff account is not affected", async () => {
    const signup = signupOn(app);
    for (let n = 0; n < 40; n += 1) expect(await assist(signup, coordinator, n), `sign-up ${n + 1}`).toEqual({ status: "done" });

    const refused = await assist(signup, coordinator, 40);
    expect(refused).toMatchObject({ status: "refused", message: expect.stringMatching(/^You have started 40 sign-ups in the last 24 hours/) });
    expect((await owner`select count(*)::int as n from pending_signup`)[0]!.n).toBe(40);
    expect((await owner`select count(*)::int as n from pending_signup where phone = ${e164(40)}`)[0]!.n).toBe(0);
    expect((await assistedAudits()).at(-1)).toEqual({ actor_staff_id: coordinator, subject_type: "pending_signup", subject_id: null, outcome: "refused", meta: { reason: "throttled", code: "rate_limited" } });

    expect(await assist(signup, ambassador, 41)).toEqual({ status: "done" });

    // The window is 24 hours: once the first sign-ups are older than that, the account can start more.
    await owner`update rate_limit set at = at - interval '25 hours' where scope = ${ASSISTED_SIGNUP_RATE_LIMIT.scope}`;
    expect(await assist(signup, coordinator, 40)).toEqual({ status: "done" });
  });

  it("answers a new, a pending and a subscribed number alike, and audits each the same way, with the staff id and no number", async () => {
    const signup = signupOn(app);
    subscribedNumbers.add(e164(3));
    expect(await assist(signup, coordinator, 1)).toEqual({ status: "done" });
    expect(await assist(signup, coordinator, 1)).toEqual({ status: "done" });
    expect(await assist(signup, coordinator, 3)).toEqual({ status: "done" });

    expect(await pendingRows()).toHaveLength(1);
    expect((await owner`select count(*)::int as n from delivery where purpose = 'confirmation'`)[0]!.n).toBe(1);
    const ok = { actor_staff_id: coordinator, subject_type: "pending_signup", subject_id: null, outcome: "ok", meta: {} };
    expect(await assistedAudits()).toEqual([ok, ok, ok]);
  });

  it("refuses what the form got wrong, with the reason, storing and counting nothing, and audits the refusal", async () => {
    const signup = signupOn(app);
    expect(await assist(signup, ambassador, 1, { phone: "020 7946 0123" })).toMatchObject({ status: "refused", message: expect.stringMatching(/^That is not a Canadian mobile number/) });
    expect(await assist(signup, ambassador, 1, { age_confirmed: "" })).toMatchObject({ status: "refused", message: expect.stringMatching(/^Confirm the age statement/) });
    expect(await assist(signup, ambassador, 1, { consent_version: "2026-09-01.1" })).toMatchObject({ status: "refused", message: expect.stringMatching(/^The terms changed/) });

    expect(await pendingRows()).toEqual([]);
    expect(await owner`select * from rate_limit where scope = ${ASSISTED_SIGNUP_RATE_LIMIT.scope}`).toEqual([]);
    expect((await assistedAudits()).map((a) => [a.outcome, a.meta])).toEqual([
      ["refused", { reason: "validation", code: "phone_not_canadian" }],
      ["refused", { reason: "validation", code: "age_not_confirmed" }],
      ["refused", { reason: "conflict", code: "terms_changed" }],
    ]);
  });

  it("keeps the number out of the audit trail, the operational events and the limiter's table", async () => {
    const signup = signupOn(app);
    await assist(signup, coordinator, 1);
    await assist(signup, coordinator, 2, { terms_agreed: "" });
    await web(signup, 3);

    const digits = ["4165550101", "5550101", "4165550102", "5550102", "4165550103"];
    for (const [table, rows] of [
      ["audit_event", await owner`select t::text as row from audit_event t where id > ${auditBaseline}`],
      ["ops_event", await owner`select t::text as row from ops_event t`],
      ["rate_limit", await owner`select t::text as row from rate_limit t`],
    ] as const) {
      for (const { row } of rows) for (const d of digits) expect(row, table).not.toContain(d);
    }
  });
});
