import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import { ContactNumberInvalid, ContactSourceNotWired, createContactResolver } from "./contactResolver";
import type { MessagingLog, RecipientNumberSource, RecipientNumberSources } from "./deliveryPorts";

// Obviously fake numbers (the 555-01xx range).
const NUMBER = "+14165550123";
const DELIVERY = "01900000-0000-7000-8000-0000000b0001";
const RECIPIENT = "01900000-0000-7000-8000-0000000a0001";
const tx = { transaction: "hand-off" } as unknown as DbTransaction;

function recordingLog() {
  const lines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
  const log: MessagingLog = {
    info: (evt, fields) => void lines.push({ level: "info", evt, fields }),
    error: (evt, fields) => void lines.push({ level: "error", evt, fields }),
  };
  return { log, lines };
}

/** A source holding one number, which records how it was asked and, when told to consume, forgets the number. */
function source(initial: string | null = NUMBER) {
  const asked: { tx: unknown; id: string; consume: boolean }[] = [];
  let held = initial;
  const numbers: RecipientNumberSource = {
    async numberOf(transaction, id, { consume }) {
      asked.push({ tx: transaction, id, consume });
      const found = held;
      if (consume) held = null;
      return found;
    },
  };
  return { numbers, asked, held: () => held };
}

describe("the ContactResolver", () => {
  it("resolves the number inside the hand-off transaction it is given, and returns it in memory", async () => {
    const roster = source();
    const { log } = recordingLog();
    const resolver = createContactResolver({ sources: { roster: roster.numbers }, log });
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "roster", id: RECIPIENT })).toEqual({ found: true, number: NUMBER });
    expect(roster.asked).toEqual([{ tx, id: RECIPIENT, consume: false }]);
    // Reading it did not take it: the next hand-off finds it again.
    expect(roster.held()).toBe(NUMBER);
  });

  it("logs the number masked to its last two digits, and nothing else about it", async () => {
    const { log, lines } = recordingLog();
    const resolver = createContactResolver({ sources: { subscriber: source().numbers }, log });
    await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "subscriber", id: RECIPIENT });
    expect(lines).toEqual([
      { level: "info", evt: "contact.resolved", fields: { module: "messaging", delivery_id: DELIVERY, recipient_kind: "subscriber", number: "+*********23", consumed: false } },
    ]);
    expect(JSON.stringify(lines)).not.toContain("4165550123");
    expect(JSON.stringify(lines)).not.toContain("+1416");
  });

  it("takes the number of an inbound_reply recipient: the source is asked to consume it, so the number then exists only in the caller's memory", async () => {
    const reply = source();
    const { log, lines } = recordingLog();
    const resolver = createContactResolver({ sources: { inbound_reply: reply.numbers }, log });
    const first = await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "inbound_reply", id: RECIPIENT });
    expect(first).toEqual({ found: true, number: NUMBER });
    expect(reply.asked).toEqual([{ tx, id: RECIPIENT, consume: true }]);
    expect(reply.held()).toBeNull();
    expect(lines[0].fields.consumed).toBe(true);
    // The row is gone: a second hand-off finds no recipient (so it cannot send twice), and says so without a number.
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "inbound_reply", id: RECIPIENT })).toEqual({ found: false, reason: "recipient_gone" });
    expect(JSON.stringify(lines)).not.toContain("4165550123");
  });

  it("asks only the source of the recipient's kind", async () => {
    const subscriptions = source();
    const staff = source("+14165550199");
    const oncall = source("+14165550188");
    const sources: RecipientNumberSources = { subscriber: subscriptions.numbers, staff: staff.numbers, oncall: oncall.numbers };
    const { log } = recordingLog();
    const resolver = createContactResolver({ sources, log });
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "oncall", id: RECIPIENT })).toEqual({ found: true, number: "+14165550188" });
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "staff", id: RECIPIENT })).toEqual({ found: true, number: "+14165550199" });
    expect([subscriptions.asked.length, staff.asked.length, oncall.asked.length]).toEqual([0, 1, 1]);
  });

  it("reports a recipient that is gone (no id, or a source that finds none) without a number, and says so in the log", async () => {
    const { log, lines } = recordingLog();
    const empty = source(null);
    const resolver = createContactResolver({ sources: { subscriber: empty.numbers }, log });
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "subscriber", id: null })).toEqual({ found: false, reason: "recipient_gone" });
    expect(empty.asked).toEqual([]);
    expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "subscriber", id: RECIPIENT })).toEqual({ found: false, reason: "recipient_gone" });
    expect(lines).toEqual([{ level: "info", evt: "contact.recipient_gone", fields: { module: "messaging", delivery_id: DELIVERY, recipient_kind: "subscriber" } }]);
  });

  it("fails loudly for a kind of recipient no module has been wired to answer for, instead of skipping its texts", async () => {
    const resolver = createContactResolver({ sources: {}, log: recordingLog().log });
    await expect(resolver.resolve(tx, { deliveryId: DELIVERY, kind: "oncall", id: RECIPIENT })).rejects.toBeInstanceOf(ContactSourceNotWired);
    await expect(resolver.resolve(tx, { deliveryId: DELIVERY, kind: "oncall", id: RECIPIENT })).rejects.toThrow("No phone number source is wired for oncall recipients");
  });

  it("refuses a source's answer that is not an E.164 number, without quoting it", async () => {
    const { log, lines } = recordingLog();
    const resolver = createContactResolver({ sources: { staff: source("416 555 0123").numbers }, log });
    const error = await resolver.resolve(tx, { deliveryId: DELIVERY, kind: "staff", id: RECIPIENT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContactNumberInvalid);
    expect((error as Error).message).not.toContain("555");
    expect(lines).toEqual([]);
  });
});
