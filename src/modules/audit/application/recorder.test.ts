import { describe, expect, it, vi } from "vitest";
import type { Db, DbExecutor } from "../../../platform/db";
import type { AuditRecord } from "../domain/actions";
import { createAuditRecorder, type AuditStore } from "./recorder";

const STAFF = "3f0b8f9e-6a51-4c1e-9d2a-0b6f1c2d3e4f";
const TX = { tx: true } as unknown as DbExecutor;
const DB = { transaction: async (fn: (tx: DbExecutor) => Promise<void>) => fn(TX) } as unknown as Db;

function setup(insert: AuditStore["insert"] = async () => {}) {
  const stored: AuditRecord[] = [];
  const store: AuditStore = {
    insert: vi.fn(async (executor, record) => {
      await insert(executor, record);
      stored.push(record);
    }),
  };
  const log = { error: vi.fn() };
  return { stored, store, log, recorder: createAuditRecorder({ store, log }) };
}

describe("record", () => {
  it("stores an ok record with the caller's transaction", async () => {
    const { recorder, store, stored } = setup();

    await recorder.record(TX, { action: "factor.enrolled", actorStaffId: STAFF, subjectType: "staff_account", subjectId: STAFF });

    expect(store.insert).toHaveBeenCalledWith(TX, expect.objectContaining({ outcome: "ok" }));
    expect(stored).toHaveLength(1);
  });

  it("throws, so the caller's change fails, when the insert fails", async () => {
    const { recorder } = setup(async () => {
      throw new Error("connection lost");
    });

    await expect(
      recorder.record(TX, { action: "factor.enrolled", actorStaffId: STAFF, subjectType: "staff_account", subjectId: STAFF }),
    ).rejects.toThrow("connection lost");
  });

  it("throws before storing anything when meta is not allowed", async () => {
    const { recorder, store } = setup();

    await expect(
      recorder.record(TX, {
        action: "account.created",
        actorStaffId: null,
        subjectType: "staff_account",
        subjectId: STAFF,
        meta: { role: "admin", email: "jane@example.com" } as never,
      }),
    ).rejects.toThrow(/fields outside the schema: email/);
    expect(store.insert).not.toHaveBeenCalled();
  });
});

describe("recordRefusal", () => {
  it("stores a refused record in its own transaction", async () => {
    const { recorder, store } = setup();

    await recorder.recordRefusal(DB, {
      action: "permission.denied",
      actorStaffId: STAFF,
      subjectType: "staff_account",
      subjectId: null,
      meta: { status: 403, reason: "forbidden" },
    });

    expect(store.insert).toHaveBeenCalledWith(TX, expect.objectContaining({ outcome: "refused", action: "permission.denied" }));
  });

  it("never throws when the record cannot be written, and logs an operational error without values", async () => {
    class DrizzleQueryError extends Error {
      override cause = { code: "42501" };
    }
    const failure = new DrizzleQueryError('Failed query: insert ... params: {"reason":"two_admin_rule"}');
    const { recorder, log } = setup(async () => {
      throw failure;
    });

    await expect(
      recorder.recordRefusal(DB, { action: "account.suspended", actorStaffId: STAFF, subjectType: "staff_account", subjectId: STAFF, meta: { reason: "two_admin_rule" } }),
    ).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith("audit.refusal_not_recorded", {
      action: "account.suspended",
      error: "DrizzleQueryError",
      error_code: "42501",
      message: null,
    });
  });

  it("logs an invalid refusal event instead of throwing", async () => {
    const { recorder, log, store } = setup();

    await recorder.recordRefusal(DB, { action: "auth.failed", actorStaffId: null, subjectType: "staff_account", subjectId: null, meta: { username: "jdoe" } as never });

    expect(store.insert).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      "audit.refusal_not_recorded",
      expect.objectContaining({ action: "auth.failed", error: "AuditRecordError", message: expect.stringMatching(/fields outside the schema: username/) }),
    );
  });
});
