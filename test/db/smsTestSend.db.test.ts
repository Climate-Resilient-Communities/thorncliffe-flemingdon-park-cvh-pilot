// The first-text spike against a real database (S01.15): the ledger's duplicate rules are enforced by
// Postgres, so two presses at once send at most one text; the audit trail never holds the phone
// number. The app writes with its own credentials (cvh_app_login). The provider is a fake: no
// network call is ever made.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createTestText, listUnknownAttempts } from "../../src/modules/messaging";
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
let provider: ReturnType<typeof fakeSms>;
let logged: { evt: string; fields: Record<string, unknown> }[] = [];

const service = () =>
  createTestText({
    db: app,
    config: { live: true, allowlist: [ALLOWED, OTHER_ALLOWED], fromNumber: FROM },
    twilio: { accountSid: `AC${"0".repeat(32)}`, authToken: "fake-auth-token" },
    provider,
    log: { error: (evt, fields) => void logged.push({ evt, fields }) },
  });
const press = (number = ALLOWED, requestId: string = randomUUID()) => service().sendTestText({ actorStaffId: STAFF, requestId, number });
// The window is the database's clock, so a test moves time by moving the ledger's claims into the past.
const advance = (ms: number) => owner`update sms_test_send set claimed_at = claimed_at - ${ms} * interval '1 millisecond'`;

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
  provider = fakeSms();
  logged = [];
});

afterAll(async () => {
  await reset();
  await app?.$client.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

const ledger = () => owner<{ outcome: string; http_status: number | null; provider_status: string | null; provider_message_id: string | null; provider_error_code: number | null }[]>`
  select outcome, http_status, provider_status, provider_message_id, provider_error_code from sms_test_send order by id`;
const attemptRows = () => owner<{ subject_id: string | null; outcome: string; meta: Record<string, unknown> }[]>`
  select subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = 'sms.test_attempted' order by id`;
const auditRows = () => owner<{ actor_staff_id: string | null; outcome: string; subject_type: string; subject_id: string | null; meta: Record<string, unknown> }[]>`
  select actor_staff_id, outcome, subject_type, subject_id, meta from audit_event where id > ${auditBaseline} and action = 'sms.test_sent' order by id`;

describe("a test text to an approved number", () => {
  it("is sent once, recorded in the ledger by a keyed hash, and audited as sms.test_sent with the status and message id, never the number", async () => {
    await expect(press()).resolves.toEqual({ kind: "sent", httpStatus: 201, status: "queued", messageId: FAKE_MESSAGE_SID });

    expect(provider.sent).toHaveLength(1);
    expect(await ledger()).toEqual([{ outcome: "sent", http_status: 201, provider_status: "queued", provider_message_id: FAKE_MESSAGE_SID, provider_error_code: null }]);
    // The subject is the ledger row's id; the Twilio SID is in meta. An attempt record was written with the claim.
    const [{ id }] = await owner`select id from sms_test_send`;
    expect(await auditRows()).toEqual([
      { actor_staff_id: STAFF, outcome: "ok", subject_type: "sms_test_send", subject_id: String(id), meta: { http_status: 201, provider_status: "queued", twilio_sid: FAKE_MESSAGE_SID } },
    ]);
    expect(await attemptRows()).toEqual([{ subject_id: String(id), outcome: "ok", meta: {} }]);
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

describe("while all texts are paused (S06.06)", () => {
  const pauseTexts = () => owner`update messaging_control set paused = true, paused_by = ${STAFF}, paused_at = now(), reason = 'test pause' where id = 1`;
  const resumeTexts = () => owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;

  afterEach(async () => {
    // Leave the switch as every other test expects it: one row, texts going out (and no row names the account the next reset removes).
    await owner`insert into messaging_control (id) values (1) on conflict (id) do nothing`;
    await resumeTexts();
  });

  it("refuses an approved number: no provider call, no ledger row, no attempt record, and one refused audit record without the number", async () => {
    await pauseTexts();

    await expect(press()).resolves.toEqual({ kind: "refused", reason: "paused" });

    expect(provider.sent).toEqual([]);
    expect(await ledger()).toEqual([]);
    expect(await attemptRows()).toEqual([]);
    expect(await auditRows()).toEqual([{ actor_staff_id: STAFF, outcome: "refused", subject_type: "sms_test_send", subject_id: null, meta: { reason: "paused" } }]);
    expect(JSON.stringify(await auditRows())).not.toContain("5550101");
  });

  it("leaves no claim behind: after the resume the same number, and the same request, goes out at once", async () => {
    const requestId = randomUUID();
    await pauseTexts();
    await expect(press(ALLOWED, requestId)).resolves.toEqual({ kind: "refused", reason: "paused" });

    await resumeTexts();

    await expect(press(ALLOWED, requestId)).resolves.toMatchObject({ kind: "sent" });
    expect(provider.sent).toHaveLength(1);
  });

  it("counts a missing switch as paused, as the sender does", async () => {
    await owner`delete from messaging_control`;

    await expect(press()).resolves.toEqual({ kind: "refused", reason: "paused" });

    expect(provider.sent).toEqual([]);
    expect(await ledger()).toEqual([]);
  });
});

describe("duplicates", () => {
  it("refuses a second press for the same number within 5 minutes, and allows it after", async () => {
    await press(ALLOWED);

    await advance(DUPLICATE_WINDOW_MS - 1_000);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    await expect(press(OTHER_ALLOWED)).resolves.toMatchObject({ kind: "sent" });

    await advance(2_000);
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

    await advance(DUPLICATE_WINDOW_MS * 3);
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
    // Not a plain provider error: the audit record says the outcome is unknown, and carries no status or code.
    const [{ id }] = await owner`select id from sms_test_send`;
    expect(await auditRows()).toEqual([
      { actor_staff_id: STAFF, outcome: "refused", subject_type: "sms_test_send", subject_id: String(id), meta: { reason: "provider_error", outcome_unknown: true } },
    ]);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
  });
});

describe("the clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the database's: claimed_at is set by the database, and an app server whose clock is a day ahead cannot lift the duplicate rule", async () => {
    await press();
    const [{ inside }] = await owner`select claimed_at between now() - interval '1 minute' and now() as inside from sms_test_send`;
    expect(inside).toBe(true);

    vi.useFakeTimers({ toFake: ["Date"], now: new Date(Date.now() + 24 * 3_600_000) });
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    expect(provider.sent).toHaveLength(1);
  });

  it("compares the window in SQL against now() minus 5 minutes", async () => {
    await press();

    await advance(DUPLICATE_WINDOW_MS - 5_000);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    await advance(10_000);
    await expect(press(ALLOWED)).resolves.toMatchObject({ kind: "sent" });
  });
});

describe("a send is never invisible to the audit trail", () => {
  it("commits the attempt record with the claim, before Twilio is called", async () => {
    let seenDuringSend: { rows: number; attempts: number } | undefined;
    provider.answer(async () => {
      seenDuringSend = { rows: (await ledger()).length, attempts: (await attemptRows()).length };
      return { kind: "unreachable" };
    });

    await press();

    expect(seenDuringSend).toEqual({ rows: 1, attempts: 1 });
  });

  it("writes no attempt record for a refused press", async () => {
    await press(NOT_ALLOWED);
    await press(ALLOWED, "not-a-uuid");

    expect(await attemptRows()).toEqual([]);
  });
});

describe("when the answer cannot be recorded", () => {
  const BREAK_UPDATES = `
    create function sms_test_send_break_updates() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$;
    create trigger sms_test_send_break_updates before update on sms_test_send for each row execute function sms_test_send_break_updates()`;
  const MEND_UPDATES = `drop trigger if exists sms_test_send_break_updates on sms_test_send; drop function if exists sms_test_send_break_updates()`;

  afterEach(async () => {
    await owner.unsafe(MEND_UPDATES);
  });

  it("shows Twilio's answer, logs sms_test.settle_failed with the claim id and no number, and leaves the claim pending, still blocking the number", async () => {
    await owner.unsafe(BREAK_UPDATES);

    await expect(press()).resolves.toMatchObject({ kind: "sent", messageId: FAKE_MESSAGE_SID });

    const [{ id }] = await owner`select id from sms_test_send`;
    expect(logged).toEqual([{ evt: "sms_test.settle_failed", fields: { claimId: Number(id) } }]);
    expect(JSON.stringify(logged)).not.toContain("5550101");
    expect(await ledger()).toEqual([{ outcome: "pending", http_status: null, provider_status: null, provider_message_id: null, provider_error_code: null }]);
    expect(await attemptRows()).toEqual([{ subject_id: String(id), outcome: "ok", meta: {} }]);
    await expect(press(ALLOWED)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
  });

  it("lists the pending claim as outcome unknown once it is a minute old, with its id and time and no number", async () => {
    await owner.unsafe(BREAK_UPDATES);
    await press();
    const [{ id }] = await owner`select id from sms_test_send`;

    expect(await listUnknownAttempts(app)).toEqual([]);
    await owner.unsafe(MEND_UPDATES);
    await advance(61_000);
    const listed = await listUnknownAttempts(app);

    expect(listed).toEqual([{ id: Number(id), claimedAt: expect.any(Date) }]);
    expect(JSON.stringify(listed)).not.toContain("5550101");
  });

  it("does not list answered claims, however old", async () => {
    await press();
    await advance(10 * 60_000);

    expect(await listUnknownAttempts(app)).toEqual([]);
  });
});

describe("the ledger's access", () => {
  const ANSWER_COLUMNS = ["outcome", "http_status", "provider_status", "provider_message_id", "provider_error_code", "completed_at"];
  const OTHER_COLUMNS = ["id", "request_id", "staff_account_id", "number_hash", "claimed_at"];

  it("is reachable by the app (read, add) but not deleted from, and by no client role", async () => {
    await press();

    await expect(app.$client`delete from sms_test_send`).rejects.toThrow(/permission denied/);
    const [client] = await owner`
      select has_table_privilege('anon', 'sms_test_send', 'select') as anon,
             has_table_privilege('authenticated', 'sms_test_send', 'select') as authenticated,
             has_table_privilege('service_role', 'sms_test_send', 'select') as service_role,
             has_table_privilege('cvh_app', 'sms_test_send', 'select, insert') as app,
             has_table_privilege('cvh_app', 'sms_test_send', 'delete') as app_delete,
             has_table_privilege('cvh_app', 'sms_test_send', 'update') as app_table_update`;
    expect(client).toEqual({ anon: false, authenticated: false, service_role: false, app: true, app_delete: false, app_table_update: false });
    expect((await owner`select relrowsecurity from pg_class where relname = 'sms_test_send'`)[0].relrowsecurity).toBe(true);
  });

  it("lets the app update only the answer's columns", async () => {
    for (const column of ANSWER_COLUMNS) {
      const [{ allowed }] = await owner`select has_column_privilege('cvh_app', 'sms_test_send', ${column}, 'update') as allowed`;
      expect(allowed, column).toBe(true);
    }
    for (const column of OTHER_COLUMNS) {
      const [{ allowed }] = await owner`select has_column_privilege('cvh_app', 'sms_test_send', ${column}, 'update') as allowed`;
      expect(allowed, column).toBe(false);
    }
  });

  it.each([
    ["number_hash", `number_hash = '${"a".repeat(64)}'`],
    ["request_id", `request_id = '${randomUUID()}'`],
    ["staff_account_id", `staff_account_id = '${STAFF}'`],
    ["claimed_at", "claimed_at = now() - interval '1 day'"],
  ])("refuses an update of %s with 42501 (insufficient privilege)", async (_column, assignment) => {
    await press();

    await expect(app.$client.unsafe(`update sms_test_send set ${assignment}`)).rejects.toMatchObject({ code: "42501" });
  });

  it("still lets the app record an answer on a claim", async () => {
    await press();
    await expect(app.$client`update sms_test_send set http_status = 200, completed_at = now()`).resolves.toBeDefined();
  });
});
