// The first-text spike against a real database (S01.15): the ledger's duplicate rules are enforced by
// Postgres, so two presses at once send at most one text; the audit trail never holds the phone
// number. The app writes with its own credentials (cvh_app_login). The provider is a fake: no
// network call is ever made.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createTestText } from "../../src/modules/messaging";
import { fakeSms, FAKE_MESSAGE_SID } from "../../src/modules/messaging/adapters/fakeSms";
import { DUPLICATE_WINDOW_MS } from "../../src/modules/messaging/domain/testText";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

// Obviously fake values.
const ALLOWED = "+14165550101";
const OTHER_ALLOWED = "+14165550102";
const NOT_ALLOWED = "+14165550199";
const FROM = "+18885550100";
const STAFF = "01900000-0000-7000-8000-0000000f0150";
const T0 = new Date("2026-10-05T14:00:00Z");

let owner: ReturnType<typeof connect>;
let app: Db;
let auditBaseline = 0;
let clock: Date;
let provider: ReturnType<typeof fakeSms>;

const service = () =>
  createTestText({
    db: app,
    config: { live: true, allowlist: [ALLOWED, OTHER_ALLOWED], fromNumber: FROM },
    twilio: { accountSid: `AC${"0".repeat(32)}`, authToken: "fake-auth-token" },
    provider,
    now: () => clock,
  });
const press = (number = ALLOWED, requestId: string = randomUUID()) => service().sendTestText({ actorStaffId: STAFF, requestId, number });
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  app = createDb(url.href);
  // Open the pool's connections now, so the concurrent presses below really overlap.
  await Promise.all(Array.from({ length: 8 }, () => app.$client`select pg_sleep(0.2)`));
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
});

async function reset() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx`delete from sms_test_send`;
    await tx`delete from staff_account where id = ${STAFF}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
}

beforeEach(async () => {
  await reset();
  await owner`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${STAFF}, ${randomUUID()}, 'smsadmin', 'Ann', 'Okafor', 'someone@example.org', 'admin', false, ${T0})`;
  clock = new Date(T0);
  provider = fakeSms();
});

afterAll(async () => {
  await reset();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

const ledger = () => owner<{ outcome: string; http_status: number | null; provider_status: string | null; provider_message_id: string | null; provider_error_code: number | null }[]>`
  select outcome, http_status, provider_status, provider_message_id, provider_error_code from sms_test_send order by id`;
const auditRows = () => owner<{ actor_staff_id: string | null; outcome: string; subject_type: string; subject_id: string | null; meta: Record<string, unknown> }[]>`
  select actor_staff_id, outcome, subject_type, subject_id, meta from audit_event where id > ${auditBaseline} and action = 'sms.test_sent' order by id`;

describe("a test text to an approved number", () => {
  it("is sent once, recorded in the ledger by a keyed hash, and audited as sms.test_sent with the status and message id, never the number", async () => {
    await expect(press()).resolves.toEqual({ kind: "sent", httpStatus: 201, status: "queued", messageId: FAKE_MESSAGE_SID });

    expect(provider.sent).toHaveLength(1);
    expect(await ledger()).toEqual([{ outcome: "sent", http_status: 201, provider_status: "queued", provider_message_id: FAKE_MESSAGE_SID, provider_error_code: null }]);
    expect(await auditRows()).toEqual([
      { actor_staff_id: STAFF, outcome: "ok", subject_type: "sms_test_send", subject_id: FAKE_MESSAGE_SID, meta: { http_status: 201, provider_status: "queued" } },
    ]);
    const everything = JSON.stringify([await owner`select * from sms_test_send`, await auditRows()]);
    expect(everything).not.toContain("5550101");
    expect(everything).not.toContain(ALLOWED);
    expect((await owner`select number_hash from sms_test_send`)[0].number_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("a number that is not on the allowlist", () => {
  it("is refused: no provider call, no ledger row, one refused audit record without the number", async () => {
    await expect(press(NOT_ALLOWED)).resolves.toEqual({ kind: "refused", reason: "not_allowlisted" });

    expect(provider.sent).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(await auditRows()).toEqual([{ actor_staff_id: STAFF, outcome: "refused", subject_type: "sms_test_send", subject_id: null, meta: { reason: "not_allowlisted" } }]);
    expect(JSON.stringify(await auditRows())).not.toContain("5550199");
  });
});

describe("duplicates", () => {
  it("refuses a second press for the same number within 5 minutes, and allows it after", async () => {
    await press(ALLOWED);

    advance(DUPLICATE_WINDOW_MS - 1_000);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    await expect(press(OTHER_ALLOWED)).resolves.toMatchObject({ kind: "sent" });

    advance(2_000);
    await expect(press(ALLOWED)).resolves.toMatchObject({ kind: "sent" });

    expect(provider.sent.map((text) => text.to)).toEqual([ALLOWED, OTHER_ALLOWED, ALLOWED]);
    expect((await auditRows()).map((row) => [row.outcome, row.meta.reason])).toEqual([
      ["ok", undefined],
      ["refused", "duplicate"],
      ["ok", undefined],
      ["ok", undefined],
    ]);
  });

  it("refuses a repeated request id, however much later and for any number", async () => {
    const requestId = randomUUID();
    await press(ALLOWED, requestId);

    advance(DUPLICATE_WINDOW_MS * 3);
    await expect(press(ALLOWED, requestId)).resolves.toEqual({ kind: "refused", reason: "duplicate_request" });
    await expect(press(OTHER_ALLOWED, requestId)).resolves.toEqual({ kind: "refused", reason: "duplicate_request" });

    expect(provider.sent).toHaveLength(1);
    expect(await ledger()).toHaveLength(1);
  });
});

describe("a concurrent double press", () => {
  it("sends at most one text when several presses with different request ids arrive for the same number at once", async () => {
    // A slow provider keeps the first send in flight while the others arrive.
    provider.answer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: FAKE_MESSAGE_SID };
    });

    const results = await Promise.all(Array.from({ length: 6 }, () => press(ALLOWED)));

    expect(results.filter((result) => result.kind === "sent")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "refused" && result.reason === "duplicate_number")).toHaveLength(5);
    expect(provider.sent).toHaveLength(1);
    expect(await ledger()).toHaveLength(1);
    expect((await auditRows()).filter((row) => row.outcome === "ok")).toHaveLength(1);
  });

  it("sends at most one text when the same request id arrives twice at once, for the same number or two different ones", async () => {
    for (const numbers of [[ALLOWED, ALLOWED], [ALLOWED, OTHER_ALLOWED]]) {
      await reset();
      await owner`
        insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
        values (${STAFF}, ${randomUUID()}, 'smsadmin', 'Ann', 'Okafor', 'someone@example.org', 'admin', false, ${T0})`;
      provider = fakeSms();
      const requestId = randomUUID();

      const results = await Promise.all(numbers.map((number) => press(number, requestId)));

      expect(results.filter((result) => result.kind === "sent"), numbers.join()).toHaveLength(1);
      expect(results.filter((result) => result.kind === "refused" && result.reason === "duplicate_request")).toHaveLength(1);
      expect(provider.sent).toHaveLength(1);
      expect(await ledger()).toHaveLength(1);
    }
  });

  it("lets presses for different numbers at once both go", async () => {
    const results = await Promise.all([press(ALLOWED), press(OTHER_ALLOWED)]);

    expect(results.map((result) => result.kind)).toEqual(["sent", "sent"]);
    expect(provider.sent.map((text) => text.to).sort()).toEqual([ALLOWED, OTHER_ALLOWED]);
  });
});

describe("when Twilio returns an error", () => {
  it("records the failure, audits a refusal with the status and Twilio's error code (no number, no message), never retries, and keeps the number blocked for 5 minutes", async () => {
    provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 30032, message: `Number ${ALLOWED} is not verified` });

    await expect(press()).resolves.toMatchObject({ kind: "provider_error", httpStatus: 400, errorCode: 30032 });

    expect(provider.sent).toHaveLength(1);
    const [{ id }] = await owner`select id from sms_test_send`;
    expect(await ledger()).toEqual([{ outcome: "failed", http_status: 400, provider_status: null, provider_message_id: null, provider_error_code: 30032 }]);
    expect(await auditRows()).toEqual([
      { actor_staff_id: STAFF, outcome: "refused", subject_type: "sms_test_send", subject_id: String(id), meta: { reason: "provider_error", http_status: 400, provider_error_code: 30032 } },
    ]);
    const everything = JSON.stringify([await owner`select * from sms_test_send`, await auditRows()]);
    expect(everything).not.toContain("5550101");
    expect(everything).not.toContain("not verified");

    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    expect(provider.sent).toHaveLength(1);
  });

  it("records a request that got no answer as unknown, and blocks the number too", async () => {
    provider.answer({ kind: "unreachable" });

    await expect(press()).resolves.toEqual({ kind: "no_answer" });

    expect(await ledger()).toEqual([{ outcome: "unknown", http_status: null, provider_status: null, provider_message_id: null, provider_error_code: null }]);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
  });
});

describe("the ledger's access", () => {
  it("is reachable by the app (read, add, update) but not deleted from, and by no client role", async () => {
    await press();

    await expect(app.$client`delete from sms_test_send`).rejects.toThrow(/permission denied/);
    const [client] = await owner`
      select has_table_privilege('anon', 'sms_test_send', 'select') as anon,
             has_table_privilege('authenticated', 'sms_test_send', 'select') as authenticated,
             has_table_privilege('cvh_app', 'sms_test_send', 'select, insert, update') as app,
             has_table_privilege('cvh_app', 'sms_test_send', 'delete') as app_delete`;
    expect(client).toEqual({ anon: false, authenticated: false, app: true, app_delete: false });
    expect((await owner`select relrowsecurity from pg_class where relname = 'sms_test_send'`)[0].relrowsecurity).toBe(true);
  });
});
