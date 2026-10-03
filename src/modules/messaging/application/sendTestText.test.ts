// The first-text spike's use case (S01.15) with a fake provider and an in-memory ledger: nothing
// here touches the network or a database (test/db/smsTestSend.db.test.ts runs the same rules against
// Postgres, including two presses at once).
import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { FAKE_MESSAGE_SID, fakeSms } from "../adapters/fakeSms";
import { DUPLICATE_WINDOW_MS, TEST_TEXT_BODY } from "../domain/testText";
import type { ClaimResult, PendingAttempt, TestSendClaim, TestSendResult, TestSendStore } from "./ports";
import { createTestText } from "../index";
import {
  createTestTextService,
  listUnknownAttempts,
  numberChoice,
  numberHash,
  numberKeyFromSecret,
  resolveNumberChoice,
  UNKNOWN_AFTER_MS,
  type TestTextConfig,
} from "./sendTestText";

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

/**
 * The ledger's rules in memory: a repeated request id, or a claim on the number inside the window, is refused. The
 * clock is the "database's": the store reads it, the use case never does.
 */
function memoryStore(databaseNow: () => Date) {
  const rows: { id: number; requestId: string; numberHash: string; claimedAt: Date; result?: TestSendResult }[] = [];
  const store: TestSendStore = {
    async claim(_tx, claim: TestSendClaim): Promise<ClaimResult> {
      if (rows.some((row) => row.requestId === claim.requestId)) return { kind: "duplicate_request" };
      const windowStart = databaseNow().getTime() - claim.windowMs;
      if (rows.some((row) => row.numberHash === claim.numberHash && row.claimedAt.getTime() > windowStart)) return { kind: "duplicate_number" };
      const id = rows.length + 1;
      rows.push({ id, requestId: claim.requestId, numberHash: claim.numberHash, claimedAt: databaseNow() });
      return { kind: "claimed", id };
    },
    async complete(_tx, id, result) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) row.result = result;
    },
    async listPending(_executor, olderThanMs, limit): Promise<PendingAttempt[]> {
      return rows
        .filter((row) => row.result === undefined && row.claimedAt.getTime() < databaseNow().getTime() - olderThanMs)
        .map(({ id, claimedAt }) => ({ id, claimedAt }))
        .reverse()
        .slice(0, limit);
    },
  };
  return { store, rows };
}

type Audited = AuditEvent<"sms.test_sent"> | AuditEvent<"sms.test_attempted">;

function setup(options: { config?: TestTextConfig; withProvider?: boolean; paused?: boolean | (() => Promise<boolean>) } = {}) {
  let clock = new Date("2026-10-05T14:00:00Z");
  const { store, rows } = memoryStore(() => clock);
  const provider = fakeSms();
  const records: Audited[] = [];
  const refusals: Audited[] = [];
  const logged: { evt: string; fields: Record<string, unknown> }[] = [];
  // Every call of the fake database's transaction, so a test can tell what ran inside which one.
  const transactions: string[][] = [];
  const events: string[] = [];
  const claims: TestSendClaim[] = [];
  const failures = { record: undefined as Error | undefined, attempt: undefined as Error | undefined, complete: undefined as Error | undefined };
  const db = {
    transaction: async (run: (tx: DbTransaction) => Promise<unknown>) => {
      const log: string[] = [];
      transactions.push(log);
      return run({ log } as unknown as DbTransaction);
    },
  } as unknown as Db;
  const service = createTestTextService({
    db,
    store: {
      ...store,
      claim: async (tx, claim) => {
        claims.push(claim);
        const result = await store.claim(tx, claim);
        (tx as unknown as { log: string[] }).log.push(`claim:${result.kind}`);
        return result;
      },
      complete: async (tx, id, result) => {
        if (failures.complete) throw failures.complete;
        await store.complete(tx, id, result);
      },
    },
    provider: options.withProvider === false ? undefined : provider,
    audit: {
      record: async (tx, event) => {
        if (failures.record && event.action === "sms.test_sent") throw failures.record;
        if (failures.attempt && event.action === "sms.test_attempted") throw failures.attempt;
        (tx as unknown as { log: string[] }).log.push(`audit:${event.action}`);
        events.push(`audit:${event.action}`);
        records.push(event);
      },
      recordRefusal: async (_db, event) => void refusals.push(event),
    },
    config: options.config ?? LIVE,
    numberKey: () => KEY,
    log: { error: (evt, fields) => void logged.push({ evt, fields }) },
    isPaused: typeof options.paused === "function" ? options.paused : async () => options.paused === true,
  });
  const sendWithProviderLog = provider.send.bind(provider);
  provider.send = async (text) => {
    events.push("provider");
    return sendWithProviderLog(text);
  };
  return {
    service,
    store,
    provider,
    records,
    refusals,
    rows,
    logged,
    transactions,
    events,
    claims,
    failures,
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
    // The subject is always the ledger row's id; the Twilio SID is in meta.
    expect(t.records).toEqual([
      { action: "sms.test_attempted", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: "1" },
      { action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: "1", meta: { http_status: 201, provider_status: "queued", twilio_sid: FAKE_MESSAGE_SID } },
    ]);
    expect(t.rows[0].result).toMatchObject({ outcome: "sent", providerStatus: "queued", messageId: FAKE_MESSAGE_SID });
    // The ledger holds the number only as a keyed hash.
    expect(t.rows[0].numberHash).toBe(numberHash(KEY, ALLOWED));
    expect(JSON.stringify([t.records, t.refusals, t.rows])).not.toContain("5550101");
  });
});

describe("the attempt record (a send is never invisible to the audit trail)", () => {
  it("is written in the claim's own transaction, before the provider is called", async () => {
    const t = setup();

    await t.send();

    expect(t.transactions[0]).toEqual(["claim:claimed", "audit:sms.test_attempted"]);
    expect(t.events.slice(0, 2)).toEqual(["audit:sms.test_attempted", "provider"]);
  });

  it("is not written for a press that is refused, and a claim whose record cannot be written sends nothing", async () => {
    const t = setup();
    await t.send(ALLOWED, REQUEST_1);
    await t.send(ALLOWED, REQUEST_2);
    expect(t.records.filter((event) => event.action === "sms.test_attempted")).toHaveLength(1);

    const failing = setup();
    failing.failures.attempt = new Error("audit down");
    await expect(failing.send()).rejects.toThrow("audit down");
    expect(failing.provider.sent).toEqual([]);
  });
});

describe("when recording the answer fails", () => {
  it("still shows Twilio's answer, logs sms_test.settle_failed with the claim id and no number, and leaves the claim pending", async () => {
    const t = setup();
    t.failures.complete = new Error(`insert failed for ${ALLOWED}`);

    await expect(t.send()).resolves.toMatchObject({ kind: "sent", messageId: FAKE_MESSAGE_SID });

    expect(t.logged).toEqual([{ evt: "sms_test.settle_failed", fields: { claimId: 1 } }]);
    expect(JSON.stringify(t.logged)).not.toContain("5550101");
    expect(t.rows[0].result).toBeUndefined();
    // The attempt record was committed with the claim, so the send is in the audit trail even now.
    expect(t.records.map((event) => event.action)).toEqual(["sms.test_attempted"]);
    // And the number stays blocked.
    await expect(t.send(ALLOWED, REQUEST_2)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
  });

  it("lists the claim as outcome unknown after a minute, and not before", async () => {
    const t = setup();
    t.failures.complete = new Error("insert failed");
    await t.send();

    t.advance(UNKNOWN_AFTER_MS - 1_000);
    expect(await listUnknownAttempts({} as Db, t.store)).toEqual([]);
    t.advance(2_000);
    expect(await listUnknownAttempts({} as Db, t.store)).toEqual([{ id: 1, claimedAt: new Date("2026-10-05T14:00:00Z") }]);
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

describe("while all texts are paused (S06.06)", () => {
  it("refuses an approved number as paused: no provider call, no claim, no attempt record, one refused record", async () => {
    const t = setup({ paused: true });

    await expect(t.send()).resolves.toEqual({ kind: "refused", reason: "paused" });

    expect(t.provider.sent).toEqual([]);
    expect(t.rows).toEqual([]);
    expect(t.transactions).toEqual([]);
    expect(t.records).toEqual([]);
    expect(t.refusals).toEqual([{ action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: null, meta: { reason: "paused" } }]);
  });

  it("leaves nothing behind that blocks the same number after the resume: the same press is sent then", async () => {
    let paused = true;
    const t = setup({ paused: async () => paused });

    await expect(t.send(ALLOWED, REQUEST_1)).resolves.toEqual({ kind: "refused", reason: "paused" });
    paused = false;

    await expect(t.send(ALLOWED, REQUEST_1)).resolves.toMatchObject({ kind: "sent" });
    expect(t.provider.sent).toHaveLength(1);
  });

  it("is read after the checks that need no database, so a malformed, unavailable or unapproved press is refused for its own reason", async () => {
    const asked = vi.fn(async () => true);
    const t = setup({ paused: asked });

    await expect(t.send(NOT_ALLOWED)).resolves.toEqual({ kind: "refused", reason: "not_allowlisted" });
    await expect(t.send("not a number")).resolves.toEqual({ kind: "refused", reason: "invalid" });

    expect(asked).not.toHaveBeenCalled();
  });

  it("is not guessed when the switch cannot be read: the error reaches the caller and nothing is sent", async () => {
    const t = setup({
      paused: async () => {
        throw new Error("db down");
      },
    });

    await expect(t.send()).rejects.toThrow("db down");

    expect(t.provider.sent).toEqual([]);
    expect(t.rows).toEqual([]);
  });

  it("is not asked for a text that is not live here: the press is refused as not available first", async () => {
    const asked = vi.fn(async () => true);
    const t = setup({ config: { ...LIVE, live: false }, paused: asked });

    await expect(t.send()).resolves.toEqual({ kind: "refused", reason: "not_available" });

    expect(asked).not.toHaveBeenCalled();
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
    expect(t.records.map((event) => event.action)).toEqual(["sms.test_attempted"]);
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

  it("keeps a rejection apart from no answer: only no answer carries outcome_unknown", async () => {
    const rejected = setup();
    rejected.provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 30032, message: null });
    await rejected.send();
    const unreachable = setup();
    unreachable.provider.answer({ kind: "unreachable" });
    await unreachable.send();

    expect(rejected.refusals[0].meta).not.toHaveProperty("outcome_unknown");
    expect(unreachable.refusals[0].meta).toHaveProperty("outcome_unknown", true);
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
    // Not a plain provider error: the text may have gone, and the audit trail says so.
    expect(t.refusals).toEqual([
      { action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: "1", meta: { reason: "provider_error", outcome_unknown: true } },
    ]);
    await expect(t.send(ALLOWED, REQUEST_2)).resolves.toEqual({ kind: "refused", reason: "duplicate_number" });
    expect(t.provider.sent).toHaveLength(1);
  });
});

describe("the clock", () => {
  it("is the database's: the claim carries a window length, never a time read on the app server", async () => {
    const t = setup();

    await t.send();

    expect(t.claims).toEqual([{ requestId: REQUEST_1, staffId: STAFF, numberHash: numberHash(KEY, ALLOWED), windowMs: DUPLICATE_WINDOW_MS }]);
  });
});

describe("the number key", () => {
  it("has no fallback: without Twilio's credentials a send that gets as far as hashing throws instead of using a made-up key", async () => {
    const provider = fakeSms();
    const db = { transaction: async (run: (tx: DbTransaction) => Promise<unknown>) => run({} as DbTransaction) } as unknown as Db;
    const service = createTestText({ db, config: LIVE, provider, audit: { record: async () => {}, recordRefusal: async () => {} }, log: { error: () => {} }, isPaused: async () => false });

    await expect(service.sendTestText({ actorStaffId: STAFF, requestId: REQUEST_1, number: ALLOWED })).rejects.toThrow(/credentials/);

    expect(provider.sent).toEqual([]);
  });

  it("is not asked for when nothing can be sent anyway (no credentials, no provider): the press is refused as not available", async () => {
    const refusals: unknown[] = [];
    const db = { transaction: async (run: (tx: DbTransaction) => Promise<unknown>) => run({} as DbTransaction) } as unknown as Db;
    const service = createTestText({
      db,
      config: { ...LIVE, live: false },
      audit: { record: async () => {}, recordRefusal: async (_db, event) => void refusals.push(event.meta) },
      log: { error: () => {} },
    });

    await expect(service.sendTestText({ actorStaffId: STAFF, requestId: REQUEST_1, number: ALLOWED })).resolves.toEqual({ kind: "refused", reason: "not_available" });
    expect(refusals).toEqual([{ reason: "not_available" }]);
  });
});

describe("the opaque number choice", () => {
  it("is a short keyed hash that holds no part of the number, differs per number and key, and resolves back on the server only", () => {
    const choices = [ALLOWED, OTHER_ALLOWED].map((number) => numberChoice(KEY, number));

    expect(choices[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(choices[0]).not.toBe(choices[1]);
    expect(numberChoice(numberKeyFromSecret("another-token"), ALLOWED)).not.toBe(choices[0]);
    expect(JSON.stringify(choices)).not.toContain("5550101");
    // It is not the ledger's hash either.
    expect(numberHash(KEY, ALLOWED)).not.toContain(choices[0]);

    expect(resolveNumberChoice(KEY, [ALLOWED, OTHER_ALLOWED], choices[1])).toBe(OTHER_ALLOWED);
  });

  it.each([["an unknown value", "0123456789abcdef"], ["the number itself", ALLOWED], ["a tampered value", "x"], ["nothing", ""]])("does not resolve %s", (_name, value) => {
    expect(resolveNumberChoice(KEY, [ALLOWED, OTHER_ALLOWED], value)).toBeUndefined();
  });

  it("does not resolve the choice of a number that has left the allowlist", () => {
    expect(resolveNumberChoice(KEY, [OTHER_ALLOWED], numberChoice(KEY, ALLOWED))).toBeUndefined();
  });
});

describe("a choice that resolves to no approved number", () => {
  it("is refused as not allowlisted, audited without a number, with no claim and no provider call", async () => {
    const t = setup();

    await expect(t.service.refuseNotAllowlisted(STAFF)).resolves.toEqual({ kind: "refused", reason: "not_allowlisted" });

    expect(t.provider.sent).toEqual([]);
    expect(t.rows).toEqual([]);
    expect(t.refusals).toEqual([{ action: "sms.test_sent", actorStaffId: STAFF, subjectType: "sms_test_send", subjectId: null, meta: { reason: "not_allowlisted" } }]);
  });
});
