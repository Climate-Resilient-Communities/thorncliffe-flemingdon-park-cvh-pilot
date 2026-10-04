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

/** An executor that fails the test the moment anything touches it: before E07 the port reads and writes nothing. */
const untouchable = new Proxy({}, { get: () => () => { throw new Error("the recipient port touched the database before E07"); } }) as unknown as DbExecutor & DbTransaction;

describe("the recipient-count and snapshot port before E07 (S04.07)", () => {
  it("says that texting is not open, with nobody in any language: what the approval view shows as 'Text sign-up is not open yet' and a count of 0", async () => {
    expect(await countRecipients(entry(), untouchable)).toEqual({ open: false, total: 0, byLanguage: {} });
  });

  it("captures no recipients inside the approval's transaction and writes nothing: no recipient, so no delivery and a count of 0", async () => {
    expect(await captureRecipients(entry(), untouchable)).toEqual([]);
  });

  it("answers nobody for a correction of a real alert too", async () => {
    expect(await captureRecipients(entry({ kind: "correction", supersedesId: "01900000-0000-7000-8000-00000000e100" }), untouchable)).toEqual([]);
    expect(await countRecipients(entry({ kind: "withdrawal", supersedesId: "01900000-0000-7000-8000-00000000e100" }), untouchable)).toEqual({ open: false, total: 0, byLanguage: {} });
    expect(roster.reads).toEqual([]);
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

  it("gives a real entry nobody, whatever is on the roster, and does not read the roster for it", async () => {
    expect(await captureRecipients(entry({ isDrill: false }), untouchable)).toEqual([]);
    expect(await countRecipients(entry({ isDrill: false }), untouchable)).toEqual({ open: false, total: 0, byLanguage: {} });
    expect(roster.reads).toEqual([]);
  });
});
