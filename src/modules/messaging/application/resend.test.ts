import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AlertStanding } from "../domain/dispatchRules";
import type { ChainText } from "../domain/resend";
import { createResend, type ResendDeps, type ResendStore, type RootText } from "./resend";

// The resend use case on a fake store and fake ports (the database's own rules are proved in test/db/resend.db.test.ts): what it asks of whom, in which order, what it
// writes and audits, and what it tells the Admin.
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const ADMIN = "01900000-0000-7000-8000-0000000000ad";
const tx = { id: "tx" } as unknown as DbTransaction;
const db = { transaction: async (work: (t: DbTransaction) => Promise<unknown>) => work(tx) } as unknown as Db;

const sendable: AlertStanding = { entryStatus: "approved", entryKind: "ack", validUntilPassed: false, threadOpen: true, isClosingEntry: false, isDrill: false };

/** A delivery id the use case accepts (a uuid) for a short name the fake store knows the chains by. */
const U = (name: string) => `01900000-0000-7000-8000-${Buffer.from(name).toString("hex").padStart(12, "0")}`;

const chainText = (name: string, over: Partial<ChainText> = {}): ChainText => ({ id: U(name), state: "failed", resendN: null, providerErrorCode: null, attempts: 1, ...over });
const rootOf = (name: string, over: Partial<RootText> = {}): RootText => ({ id: U(name), kind: "alert", entryId: ENTRY, recipientKind: "subscriber", recipientId: `person-of-${name}`, lang: "en", body: "Power is out.", segments: 1, costEstimateCents: 4, ...over });

function world(chains: Record<string, ChainText[]>, options: { roots?: Record<string, Partial<RootText>>; standing?: AlertStanding | null; receives?: boolean; overrun?: { overCents: number; capCents: number } | null } = {}) {
  const calls: string[] = [];
  const inserted: { id: string; root: RootText; n: number; key: string }[] = [];
  const store: ResendStore = {
    async locate(_tx, id) {
      const found = Object.entries(chains).find(([, chain]) => chain.some((text) => text.id === id));
      return found ? { rootId: found[0], entryId: ENTRY, kind: "alert" } : null;
    },
    async bulkCandidates(_tx, _entry, lang, states, limit) {
      const tails = Object.entries(chains)
        .map(([rootId, chain]) => ({ rootId, tail: chain.reduce((latest, text) => ((text.resendN ?? 0) > (latest.resendN ?? 0) ? text : latest)) }))
        .filter(({ tail, rootId }) => (options.roots?.[rootId]?.lang ?? "en") === lang && (states as readonly string[]).includes(tail.state))
        .sort((a, b) => (a.rootId < b.rootId ? -1 : 1));
      return { texts: tails.slice(0, limit).map(({ rootId, tail }) => ({ id: tail.id, rootId })), more: tails.length > limit };
    },
    async lockChain(_tx, rootId) {
      calls.push(`lock:${rootId}`);
      return chains[rootId] ? { root: rootOf(rootId, options.roots?.[rootId]), chain: chains[rootId] } : null;
    },
    async insertResend(_tx, input) {
      calls.push(`insert:${input.key}`);
      inserted.push(input);
    },
  };
  const audit = { record: vi.fn(async () => undefined), recordRefusal: vi.fn(async () => undefined) };
  const spendCap = vi.fn(async (_tx: DbTransaction, input: { entryId: string; estimateCents: number }) => {
    calls.push(`cap:${input.estimateCents}`);
    return options.overrun ?? null;
  });
  const deps: ResendDeps = {
    db,
    store,
    audit,
    recipients: {
      receives: async (_tx, recipient) => {
        calls.push(`receives:${recipient.id}`);
        return options.receives ?? true;
      },
    },
    standing: { standingOf: async () => (options.standing === undefined ? sendable : options.standing) },
    spendCap,
    newId: (() => {
      let n = 0;
      return () => `new-${(n += 1)}`;
    })(),
    now: () => new Date("2026-10-05T15:00:00Z"),
  };
  return { resend: createResend(deps), calls, inserted, audit, spendCap };
}

const one = (deliveryId: string, seen: string | null = "failed", confirmedUnknown = false) => ({ actorStaffId: ADMIN, entryId: ENTRY, scope: "one" as const, deliveryId: U(deliveryId), seen, confirmedUnknown });
const all = (lang = "en") => ({ actorStaffId: ADMIN, entryId: ENTRY, scope: "language" as const, lang });

describe("resending one text", () => {
  it("locks the chain's root, asks after the resident, judges the cap before it adds the copy, and audits what it did with counts", async () => {
    const { resend, calls, inserted, audit } = world({ a: [chainText("a")] });
    const outcome = await resend.resend(one("a"));
    expect(outcome).toEqual({ kind: "resent", resent: 1, notResent: [], more: false, costCents: 4, overrun: null, resendN: 1 });
    expect(calls).toEqual(["lock:a", "receives:person-of-a", "cap:4", `insert:resend:${U("a")}:1`]);
    expect(inserted).toEqual([{ id: "new-1", root: rootOf("a"), n: 1, key: `resend:${U("a")}:1` }]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "delivery.resent", actorStaffId: ADMIN, subjectType: "alert_entry", subjectId: ENTRY, isDrill: false, meta: { scope: "one", resent: 1, not_resent: 0, resend_n: 1 } }));
    expect(audit.recordRefusal).not.toHaveBeenCalled();
  });

  it("numbers the resend of a resend 2", async () => {
    const { resend, inserted } = world({ a: [chainText("a"), chainText("b", { resendN: 1 })] });
    expect(await resend.resend(one("b"))).toMatchObject({ kind: "resent", resendN: 2 });
    expect(inserted[0]).toMatchObject({ n: 2, key: `resend:${U("a")}:2` });
  });

  it("refuses and audits the refusal with its reason, writing nothing", async () => {
    const { resend, inserted, audit } = world({ a: [chainText("a", { state: "delivered" })] });
    expect(await resend.resend(one("a", "delivered"))).toEqual({ kind: "refused", reason: "not_resendable", status: "delivered" });
    expect(inserted).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
    expect(audit.recordRefusal).toHaveBeenCalledWith(db, { action: "delivery.resent", actorStaffId: ADMIN, subjectType: "alert_entry", subjectId: ENTRY, isDrill: false, meta: { reason: "not_resendable" } });
  });

  it("does not ask the cap, or the resident's row, for a refusal that comes first", async () => {
    const { resend, calls, spendCap } = world({ a: [chainText("a", { providerErrorCode: 21211 })] });
    expect(await resend.resend(one("a"))).toMatchObject({ kind: "refused", reason: "cannot_receive", meaning: "invalid_number" });
    expect(calls).toEqual(["lock:a"]);
    expect(spendCap).not.toHaveBeenCalled();
  });

  it("refuses a resident who no longer receives alerts", async () => {
    const { resend, inserted } = world({ a: [chainText("a")] }, { receives: false });
    expect(await resend.resend(one("a"))).toMatchObject({ kind: "refused", reason: "recipient_not_receiving" });
    expect(inserted).toEqual([]);
  });

  it("refuses a text of another entry, one that is not there, and an id that is not an id", async () => {
    const { resend } = world({ a: [chainText("a")] });
    expect(await resend.resend(one("nobody"))).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await resend.resend({ ...one("a"), deliveryId: "not-an-id" })).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await resend.resend({ ...one("a"), entryId: "not-an-id" })).toMatchObject({ kind: "refused", reason: "not_found" });
  });

  it.each([
    [{ ...sendable, entryStatus: "superseded" }, "entry_superseded"],
    [{ ...sendable, threadOpen: false }, "thread_closed"],
    [{ ...sendable, validUntilPassed: true }, "valid_until_passed"],
    [{ ...sendable, isDrill: true }, "drill_recipient_mismatch"],
  ] as const)("refuses, with why, when the alert no longer sends it (%j)", async (standing, cause) => {
    const { resend, calls } = world({ a: [chainText("a")] }, { standing });
    expect(await resend.resend(one("a"))).toEqual({ kind: "refused", reason: "not_sendable", cause });
    expect(calls).toEqual([]);
  });

  it("refuses an entry that is not there", async () => {
    const { resend } = world({ a: [chainText("a")] }, { standing: null });
    expect(await resend.resend(one("a"))).toMatchObject({ kind: "refused", reason: "not_found" });
  });

  it("still sends the closing entry's text of a closed alert", async () => {
    const { resend } = world({ a: [chainText("a")] }, { standing: { ...sendable, entryKind: "final", threadOpen: false, isClosingEntry: true } });
    expect(await resend.resend(one("a"))).toMatchObject({ kind: "resent", resent: 1 });
  });
});

describe("resending all the failed and undelivered texts of an entry in a language", () => {
  it("locks the roots in order, resends each chain once, and audits one record with the counts", async () => {
    const { resend, calls, inserted, audit, spendCap } = world({
      c: [chainText("c")],
      a: [chainText("a")],
      b: [chainText("b", { state: "undelivered", providerErrorCode: 30003 })],
    });
    const outcome = await resend.resend(all());
    expect(outcome).toMatchObject({ kind: "resent", resent: 3, notResent: [], costCents: 12 });
    expect(calls.filter((call) => call.startsWith("lock:"))).toEqual(["lock:a", "lock:b", "lock:c"]);
    // The cap is judged once for the whole batch, before any copy is added.
    expect(spendCap).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("cap:12")).toBeLessThan(calls.indexOf(`insert:resend:${U("a")}:1`));
    expect(inserted.map((row) => row.key)).toEqual([`resend:${U("a")}:1`, `resend:${U("b")}:1`, `resend:${U("c")}:1`]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ meta: { scope: "language", lang: "en", resent: 3, not_resent: 0 } }));
  });

  it("leaves out, and counts by reason, a chain whose number cannot receive texts, one with two resends, and one whose resident is gone", async () => {
    const { resend, inserted, audit } = world(
      {
        a: [chainText("a")],
        b: [chainText("b", { providerErrorCode: 21610 })],
        c: [chainText("c"), chainText("c1", { resendN: 1 }), chainText("c2", { resendN: 2 })],
        d: [chainText("d")],
      },
      { roots: { d: { recipientId: null } } },
    );
    const outcome = await resend.resend(all());
    expect(outcome).toMatchObject({ kind: "resent", resent: 1, notResent: [{ reason: "cannot_receive", n: 1 }, { reason: "recipient_gone", n: 1 }, { reason: "resend_limit", n: 1 }] });
    expect(inserted.map((row) => row.key)).toEqual([`resend:${U("a")}:1`]);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ meta: { scope: "language", lang: "en", resent: 1, not_resent: 3 } }));
  });

  it("never takes an unknown text", async () => {
    const { resend, inserted } = world({ a: [chainText("a", { state: "unknown" })], b: [chainText("b")] });
    expect(await resend.resend(all())).toMatchObject({ kind: "resent", resent: 1 });
    expect(inserted.map((row) => row.key)).toEqual([`resend:${U("b")}:1`]);
  });

  it("changes and audits nothing when there is nothing to resend", async () => {
    const { resend, inserted, audit, spendCap } = world({ a: [chainText("a", { state: "delivered" })] });
    expect(await resend.resend(all())).toEqual({ kind: "resent", resent: 0, notResent: [], more: false, costCents: 0, overrun: null, resendN: null });
    expect(inserted).toEqual([]);
    expect(audit.record).not.toHaveBeenCalled();
    expect(spendCap).not.toHaveBeenCalled();
  });

  it("refuses the whole press when the alert no longer sends it", async () => {
    const { resend, inserted } = world({ a: [chainText("a")] }, { standing: { ...sendable, entryStatus: "discarded" } });
    expect(await resend.resend(all())).toEqual({ kind: "refused", reason: "not_sendable", cause: "entry_discarded" });
    expect(inserted).toEqual([]);
  });
});

describe("the spend cap", () => {
  it("is told how much the resends cost, warns without refusing, and the overrun is audited on the entry", async () => {
    const { resend, inserted, audit } = world({ a: [chainText("a")], b: [chainText("b")] }, { overrun: { overCents: 5, capCents: 100 } });
    const outcome = await resend.resend(all());
    expect(outcome).toMatchObject({ kind: "resent", resent: 2, overrun: { overCents: 5, capCents: 100 } });
    expect(inserted).toHaveLength(2);
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "spend.cap_overrun", subjectType: "alert_entry", subjectId: ENTRY, meta: { over_cents: 5, cap_cents: 100, entry_cents: 8 } }));
  });

  it("is optional: a resend made with no cap check says nothing about one", async () => {
    const { resend } = world({ a: [chainText("a")] });
    expect(await resend.resend(one("a"))).toMatchObject({ overrun: null });
  });
});
