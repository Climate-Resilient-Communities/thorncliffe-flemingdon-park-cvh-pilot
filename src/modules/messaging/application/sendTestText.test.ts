// The first-text spike's use case (S01.15) with a fake provider and an in-memory ledger: nothing
// here touches the network or a database (test/db/smsTestSend.db.test.ts runs the same rules against
// Postgres, including two presses at once).
import { describe, expect, it } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { FAKE_MESSAGE_SID, fakeSms } from "../adapters/fakeSms";
import { DUPLICATE_WINDOW_MS, TEST_TEXT_BODY } from "../domain/testText";
import type { ClaimResult, TestSendClaim, TestSendResult, TestSendStore } from "./ports";
import { createTestTextService, numberHash, numberKeyFromSecret, type TestTextConfig } from "./sendTestText";

// Obviously fake values.
const ALLOWED = "+14165550101";
const OTHER_ALLOWED = "+14165550102";
const NOT_ALLOWED = "+14165550199";
const FROM = "+18885550100";
const STAFF = "01900000-0000-7000-8000-000000000001";
const REQUEST_1 = "01900000-0000-7000-8000-00000000f001";
const REQUEST_2 = "01900000-0000-7000-8000-00000000f002";
const REQUEST_3 = "01900000-0000-7000-8000-00000000f003";
const KEY = numberKeyFromSecret("fake-auth-token");

const LIVE: TestTextConfig = { live: true, allowlist: [ALLOWED, OTHER_ALLOWED], fromNumber: FROM };

/** The ledger's rules in memory: a repeated request id, or a claim on the number inside the window, is refused. */
function memoryStore() {
  const rows: (TestSendClaim & { id: number; result?: TestSendResult })[] = [];
  const store: TestSendStore = {
    async claim(_tx, claim): Promise<ClaimResult> {
      if (rows.some((row) => row.requestId === claim.requestId)) return { kind: "duplicate_request" };
      if (rows.some((row) => row.numberHash === claim.numberHash && row.claimedAt > claim.windowStart)) return { kind: "duplicate_number" };
      const id = rows.length + 1;
      rows.push({ ...claim, id });
      return { kind: "claimed", id };
    },
    async complete(_tx, id, result) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.result = result;
    },
  };
  return { store, rows };
}

function setup(options: { config?: TestTextConfig; withProvider?: boolean } = {}) {
  const { store, rows } = memoryStore();
  const provider = fakeSms();
  const records: AuditEvent<"sms.test_sent">[] = [];
  const refusals: AuditEvent<"sms.test_sent">[] = [];
  let clock = new Date("2026-10-05T14:00:00Z");
  const db = { transaction: async (run: (tx: DbTransaction) => Promise<unknown>) => run({} as DbTransaction) } as unknown as Db;
  const service = createTestTextService({
    db,
    store,
    provider: options.withProvider === false ? undefined : provider,
    audit: {
      record: async (_tx, event) => void records.push(event),
      recordRefusal: async (_db, event) => void refusals.push(event),
    },
    config: options.config ?? LIVE,
    numberKey: KEY,
    now: () => clock,
  });
  return {
    service,
    provider,
    records,
    refusals,
    rows,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    send: (number = ALLOWED, requestId = REQUEST_1) => service.sendTestText({ actorStaffId: STAFF, requestId, number }),
  };
}

describe("an approved number on production", () => {
  it("sends the one fixed text once, shows Twilio's status and message id, and audits sms.test_sent with no phone number", async () => {
    const t = setup();

    await expect(t.send()).resolves.toEqual({ kind: "sent", httpStatus: 201, status: "queued", messageId: FAKE_MESSAGE_SID });

    expect(t.provider.sent).toEqual([{ to: ALLOWED, from: FROM, body: TEST_TEXT_BODY }]);
    expect(t.refusals).toEqual([]);
    expect(t.records).toEqual([
      { action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: FAKE_MESSAGE_SID, meta: { http_status: 201, provider_status: "queued" } },
    ]);
    expect(t.rows[0].result).toMatchObject({ outcome: "sent", providerStatus: "queued", messageId: FAKE_MESSAGE_SID });
    // The ledger holds the number only as a keyed hash.
    expect(t.rows[0].numberHash).toBe(numberHash(KEY, ALLOWED));
    expect(JSON.stringify([t.records, t.refusals, t.rows])).not.toContain("5550101");
  });
});

describe("a number that is not on the allowlist", () => {
  it("is refused with no provider call, no claim, and one refused record", async () => {
    const t = setup();

    await expect(t.send(NOT_ALLOWED)).resolves.toEqual({ kind: "refused", reason: "not_allowlisted" });

    expect(t.provider.sent).toEqual([]);
    expect(t.rows).toEqual([]);
    expect(t.records).toEqual([]);
    expect(t.refusals).toEqual([{ action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: null, meta: { reason: "not_allowlisted" } }]);
    expect(JSON.stringify(t.refusals)).not.toContain("5550199");
  });

  it("is refused when nothing is approved at all, and for a malformed number or request id", async () => {
    const empty = setup({ config: { ...LIVE, allowlist: [] } });
    await expect(empty.send()).resolves.toEqual({ kind: "refused", reason: "not_allowlisted" });

    const t = setup();
    await expect(t.send("4165550101")).resolves.toEqual({ kind: "refused", reason: "invalid" });
    await expect(t.send(ALLOWED, "not-a-uuid")).resolves.toEqual({ kind: "refused", reason: "invalid" });
    expect(t.provider.sent).toEqual([]);
    expect(t.refusals.map((event) => event.meta)).toEqual([{ reason: "validation" }, { reason: "validation" }]);
  });
});

describe("where it cannot send", () => {
  it.each([
    ["not live (a preview or local development)", { config: { ...LIVE, live: false } }],
    ["no from-number", { config: { ...LIVE, fromNumber: undefined } }],
    ["no Twilio credentials", { withProvider: false }],
  ])("refuses as not available, calling no provider, when %s", async (_name, options) => {
    const t = setup(options);

    await expect(t.send()).resolves.toEqual({ kind: "refused", reason: "not_available" });

    expect(t.provider.sent).toEqual([]);
    expect(t.rows).toEqual([]);
    expect(t.refusals.map((event) => event.meta)).toEqual([{ reason: "not_available" }]);
  });
});

describe("duplicates", () => {
  it("refuses a second press for the same number within 5 minutes, with no second text", async () => {
    const t = setup();
    await t.send(ALLOWED, REQUEST_1);

    t.advance(DUPLICATE_WINDOW_MS - 1_000);
    await expect(t.send(ALLOWED, REQUEST_2)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });

    expect(t.provider.sent).toHaveLength(1);
    expect(t.refusals).toEqual([{ action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: null, meta: { reason: "duplicate" } }]);
  });

  it("allows the same number again after 5 minutes, and another approved number at once", async () => {
    const t = setup();
    await t.send(ALLOWED, REQUEST_1);

    await expect(t.send(OTHER_ALLOWED, REQUEST_2)).resolves.toMatchObject({ kind: "sent" });
    t.advance(DUPLICATE_WINDOW_MS + 1_000);
    await expect(t.send(ALLOWED, REQUEST_3)).resolves.toMatchObject({ kind: "sent" });

    expect(t.provider.sent.map((text) => text.to)).toEqual([ALLOWED, OTHER_ALLOWED, ALLOWED]);
  });

  it("refuses a repeated request id as a duplicate, even for another number or after 5 minutes", async () => {
    const t = setup();
    await t.send(ALLOWED, REQUEST_1);

    await expect(t.send(ALLOWED, REQUEST_1)).resolves.toEqual({ kind: "refused", reason: "duplicate_request" });
    await expect(t.send(OTHER_ALLOWED, REQUEST_1)).resolves.toEqual({ kind: "refused", reason: "duplicate_request" });
    t.advance(DUPLICATE_WINDOW_MS + 1_000);
    await expect(t.send(ALLOWED, REQUEST_1)).resolves.toEqual({ kind: "refused", reason: "duplicate_request" });

    expect(t.provider.sent).toHaveLength(1);
  });
});

describe("when Twilio returns an error", () => {
  it("shows the provider's code and message, never retries, audits a refusal with the code only, and still blocks a second text", async () => {
    const t = setup();
    t.provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 30032, message: `The number ${ALLOWED} is not verified` });

    await expect(t.send()).resolves.toEqual({ kind: "provider_error", httpStatus: 400, errorCode: 30032, message: `The number ${ALLOWED} is not verified` });

    expect(t.provider.sent).toHaveLength(1);
    expect(t.records).toEqual([]);
    expect(t.refusals).toEqual([
      { action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: "1", meta: { reason: "provider_error", http_status: 400, provider_error_code: 30032 } },
    ]);
    // Neither the number nor Twilio's message is kept anywhere.
    expect(JSON.stringify([t.refusals, t.rows])).not.toContain("5550101");
    expect(JSON.stringify([t.refusals, t.rows])).not.toContain("not verified");
    expect(t.rows[0].result).toMatchObject({ outcome: "failed", httpStatus: 400, errorCode: 30032, messageId: null });

    // Nothing is retried, and a second press is a duplicate until the window passes.
    await expect(t.send(ALLOWED, REQUEST_2)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    expect(t.provider.sent).toHaveLength(1);
  });

  it("copes with an error that has no code or message", async () => {
    const t = setup();
    t.provider.answer({ kind: "rejected", httpStatus: 503, errorCode: null, message: null });

    await expect(t.send()).resolves.toEqual({ kind: "provider_error", httpStatus: 503, errorCode: null, message: null });

    expect(t.refusals[0].meta).toEqual({ reason: "provider_error", http_status: 503 });
  });

  it("reports no answer when the provider fails or throws: the text may have gone, so it is not retried and the number stays blocked", async () => {
    const t = setup();
    t.provider.answer(async () => {
      throw new Error("socket hang up");
    });

    await expect(t.send()).resolves.toEqual({ kind: "no_answer" });

    expect(t.rows[0].result).toMatchObject({ outcome: "unknown", httpStatus: null, errorCode: null });
    expect(t.refusals[0].meta).toEqual({ reason: "provider_error" });
    await expect(t.send(ALLOWED, REQUEST_2)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    expect(t.provider.sent).toHaveLength(1);
  });
});
