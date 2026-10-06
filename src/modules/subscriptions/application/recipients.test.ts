import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Audience } from "../../../contracts/audience";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { DrillMember } from "../adapters/drillRosterStore";
import { captureRecipients, countRecipients, recipientsPort, type RecipientEntry } from "./recipients";

// A drill reads the drill roster; the store is stood in for here (test/db/drills.db.test.ts runs the real one).
const roster = vi.hoisted(() => ({ members: [] as DrillMember[], reads: [] as string[] }));
vi.mock("../adapters/drillRosterStore", () => ({
  drillRosterStore: {
    members: async () => (roster.reads.push("members"), roster.members),
    membersForShare: async () => (roster.reads.push("membersForShare"), roster.members),
  },
}));

// A real entry reads the recipient query and the outbox's record of who earlier entries were texted to; both are stood in for here (test/db/subscriberFanout.db.test.ts
// and test/db/recipientQuery.db.test.ts run the real ones).
const reach = vi.hoisted(() => ({ people: [] as { id: string; lang: string }[], queued: [] as string[], calls: [] as unknown[][] }));
vi.mock("../adapters/recipientStore", () => ({
  recipientStore: {
    reached: async (_executor: unknown, audience: unknown, earlier: readonly string[]) => (reach.calls.push(["reached", audience, earlier]), reach.people),
    reachedForShare: async (_tx: unknown, audience: unknown, earlier: readonly string[], alsoLock?: readonly string[]) => (reach.calls.push(["reachedForShare", audience, earlier, alsoLock]), reach.people),
  },
}));
vi.mock("../../messaging", () => ({
  subscribersQueuedFor: async (_executor: unknown, entryIds: readonly string[]) => (reach.calls.push(["queuedFor", entryIds]), reach.queued),
}));

const audience: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
const entry = (over: Partial<RecipientEntry> = {}): RecipientEntry => ({
  entryId: "01900000-0000-7000-8000-00000000e177",
  alertId: "01900000-0000-7000-8000-00000000a1e7",
  kind: "ack",
  isDrill: false,
  supersedesId: null,
  audience,
  types: ["power"],
  smsBodies: { en: { body: "Hub: Power is out.", encoding: "gsm7", segments: 1 } },
  ...over,
});

/** An executor that fails the test the moment anything touches it: the stood-in stores are the only readers. */
const untouchable = new Proxy({}, { get: () => () => { throw new Error("the recipient port touched the database itself"); } }) as unknown as DbExecutor & DbTransaction;

describe("a real entry's recipients (S07.07, AD-7, AR-11)", () => {
  const smsBodies = { en: { body: "e", encoding: "gsm7" as const, segments: 1 }, ur: { body: "u", encoding: "ucs2" as const, segments: 2 } };
  const S1 = "01900000-0000-7000-8000-0000000000b1";
  const S2 = "01900000-0000-7000-8000-0000000000b2";
  const S3 = "01900000-0000-7000-8000-0000000000b3";

  beforeEach(() => {
    reach.people = [];
    reach.queued = [];
    reach.calls.length = 0;
    roster.reads.length = 0;
  });

  it("counts the matching subscribers under the language of the text each gets, with texting open: their own where the entry has a text in it, else English", async () => {
    reach.people = [{ id: S1, lang: "en" }, { id: S2, lang: "ur" }, { id: S3, lang: "ps" }];
    expect(await countRecipients(entry({ smsBodies }), untouchable)).toEqual({ open: true, total: 3, byLanguage: { en: 2, ur: 1 } });
    expect(reach.calls[1]).toEqual(["reached", audience, []]);
  });

  it("counts nobody as open with a count of 0", async () => {
    expect(await countRecipients(entry({ smsBodies }), untouchable)).toEqual({ open: true, total: 0, byLanguage: {} });
    expect(await captureRecipients(entry({ smsBodies }), untouchable)).toEqual([]);
  });

  it("captures them as subscriber recipients with the language they have, locked, and never reads the roster", async () => {
    reach.people = [{ id: S1, lang: "ur" }, { id: S2, lang: "zh" }];
    expect(await captureRecipients(entry({ smsBodies }), untouchable)).toEqual([
      { kind: "subscriber", id: S1, lang: "ur" },
      { kind: "subscriber", id: S2, lang: "zh" },
    ]);
    expect(reach.calls.map((call) => call[0])).toEqual(["queuedFor", "reachedForShare"]);
    expect(roster.reads).toEqual([]);
  });

  it("hands a round's requesters (S08.06) to the store's one locking call, beside the recipients, who are the store's answer alone", async () => {
    reach.people = [{ id: S2, lang: "en" }];
    expect(await captureRecipients(entry({ alsoLock: [S1, S3] }), untouchable)).toEqual([{ kind: "subscriber", id: S2, lang: "en" }]);
    expect(reach.calls.filter((call) => call[0] === "reachedForShare")).toEqual([["reachedForShare", audience, [], [S1, S3]]]);
  });

  it("adds the recipients of the entry a correction or a withdrawal replaces, and only theirs", async () => {
    const target = "01900000-0000-7000-8000-00000000e100";
    reach.queued = [S3];
    await captureRecipients(entry({ kind: "correction", supersedesId: target }), untouchable);
    await captureRecipients(entry({ kind: "withdrawal", supersedesId: target }), untouchable);
    expect(reach.calls.filter((call) => call[0] === "queuedFor")).toEqual([["queuedFor", [target]], ["queuedFor", [target]]]);
    expect(reach.calls.filter((call) => call[0] === "reachedForShare").map((call) => call[2])).toEqual([[S3], [S3]]);
    // An ack and an update add nobody's.
    reach.calls.length = 0;
    await countRecipients(entry({ kind: "update", supersedesId: null }), untouchable);
    expect(reach.calls[0]).toEqual(["queuedFor", []]);
  });

  it("adds the recipients of every other entry of the thread to a final's own, never the final's own entry", async () => {
    const [first, second] = ["01900000-0000-7000-8000-00000000e101", "01900000-0000-7000-8000-00000000e102"];
    await countRecipients(entry({ kind: "final", priorEntryIds: [first, entry().entryId, second] }), untouchable);
    expect(reach.calls[0]).toEqual(["queuedFor", [first, second]]);
  });

  it("is offered as one port with both calls, which is what the approval is wired to", async () => {
    expect(recipientsPort.count).toBe(countRecipients);
    expect(recipientsPort.capture).toBe(captureRecipients);
  });
});

describe("a drill's recipients (S06.05, AD-6)", () => {
  const A = "01900000-0000-7000-8000-0000000000a1";
  const B = "01900000-0000-7000-8000-0000000000a2";
  const C = "01900000-0000-7000-8000-0000000000a3";
  const D = "01900000-0000-7000-8000-0000000000a4";

  beforeEach(() => {
    roster.reads.length = 0;
    roster.members = [
      { id: A, lang: "en" },
      { id: B, lang: "ur" },
      { id: C, lang: "zh-Hant" },
      { id: D, lang: "ps" },
    ];
  });

  it("captures every roster member, as roster recipients with their own language, locked for share, and nobody else", async () => {
    expect(await captureRecipients(entry({ isDrill: true }), untouchable)).toEqual([
      { kind: "roster", id: A, lang: "en" },
      { kind: "roster", id: B, lang: "ur" },
      { kind: "roster", id: C, lang: "zh-Hant" },
      { kind: "roster", id: D, lang: "ps" },
    ]);
    expect(roster.reads).toEqual(["membersForShare"]);
  });

  it("counts the roster under the language of the text each member gets: their own where the entry has a text message in it, else English; and says texting is open", async () => {
    const smsBodies = { en: { body: "e", encoding: "gsm7" as const, segments: 1 }, ur: { body: "u", encoding: "ucs2" as const, segments: 2 } };
    // Pashto and zh-Hant have no text message in this entry: they are counted under English, as the approval gives them the English text.
    expect(await countRecipients(entry({ isDrill: true, smsBodies }), untouchable)).toEqual({ open: true, total: 4, byLanguage: { en: 3, ur: 1 } });
    expect(roster.reads).toEqual(["members"]);
  });

  it("counts an empty roster as nobody, with texting open", async () => {
    roster.members = [];
    expect(await countRecipients(entry({ isDrill: true }), untouchable)).toEqual({ open: true, total: 0, byLanguage: {} });
    expect(await captureRecipients(entry({ isDrill: true }), untouchable)).toEqual([]);
  });

  it("does not read the roster for a real entry, and does not read subscribers for a drill", async () => {
    await captureRecipients(entry({ isDrill: false }), untouchable);
    expect(roster.reads).toEqual([]);
    reach.calls.length = 0;
    await captureRecipients(entry({ isDrill: true }), untouchable);
    await countRecipients(entry({ isDrill: true }), untouchable);
    expect(reach.calls).toEqual([]);
  });
});
