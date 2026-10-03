import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { captureRecipients, countRecipients, recipientsPort, type RecipientEntry } from "./recipients";

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

  it("answers the same for a drill and for a correction: nobody", async () => {
    expect(await captureRecipients(entry({ isDrill: true }), untouchable)).toEqual([]);
    expect(await captureRecipients(entry({ kind: "correction", supersedesId: "01900000-0000-7000-8000-00000000e100" }), untouchable)).toEqual([]);
  });

  it("is offered as one port with both calls, which is what the approval is wired to", async () => {
    expect(recipientsPort.count).toBe(countRecipients);
    expect(recipientsPort.capture).toBe(captureRecipients);
  });
});
