import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import { createDeliveryQueueService } from "./deliveryQueue";
import type { DeliveryStore, DeliveryView, Enqueued, NewDelivery } from "./deliveryPorts";

const NOW = new Date("2026-10-03T15:00:00Z");
const ID = "01900000-0000-7000-8000-0000000a0001";
const ENTRY = "01900000-0000-7000-8000-0000000e0001";
const CAMPAIGN = "01900000-0000-7000-8000-0000000c0001";
const tx = {} as DbTransaction;

/** A store that remembers what it was asked and answers as the real one would for a new row. */
function fakeStore() {
  const calls = { inserted: [] as NewDelivery[][], approvals: [] as string[], skips: [] as unknown[], cancels: [] as string[][] };
  const store: DeliveryStore = {
    async insert(_tx, rows) {
      calls.inserted.push([...rows]);
      return rows.map((row): Enqueued => ({ delivery: viewOf(row), created: true }));
    },
    async markApproval(_tx, entryId) {
      calls.approvals.push(entryId);
    },
    async skipForRecipient(_tx, recipient) {
      calls.skips.push(recipient);
      return { skipped: 2, inFlight: 1 };
    },
    async cancelForEntries(_tx, entryIds) {
      calls.cancels.push([...entryIds]);
      return { cancelled: 3, inFlight: 1 };
    },
  };
  return { store, calls };
}

const viewOf = (row: NewDelivery): DeliveryView => ({
  ...row,
  sendBy: null,
  callbackRef: "cb",
  state: "queued",
  attempts: 0,
  dueAt: NOW,
  claimedAt: null,
  claimedBy: null,
  claimToken: null,
  handedOffAt: null,
  submittedAt: null,
  providerMessageId: null,
  providerErrorCode: null,
  completedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  resendOf: null,
  resendN: null,
});

function queueOf() {
  const { store, calls } = fakeStore();
  let n = 0;
  const queue = createDeliveryQueueService({ store, newId: () => `id-${(n += 1)}`, now: () => NOW });
  return { queue, calls };
}

const alertText = (over: Record<string, unknown> = {}) => ({
  recipient: { kind: "subscriber" as const, id: ID },
  lang: "en" as const,
  body: "Power is out. Reply STOP",
  segments: 1,
  costEstimateCents: 2,
  ...over,
});

const welcome = (over: Record<string, unknown> = {}) => ({
  module: "subscriptions" as const,
  purpose: "welcome",
  recipient: { kind: "subscriber" as const, id: ID },
  subject: ID,
  nonce: "n1",
  lang: "en" as const,
  body: "Welcome.",
  segments: 1,
  costEstimateCents: 2,
  ...over,
});

describe("the approval's mark", () => {
  it("passes the entry's id to the store, and refuses an id that is not one", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.markApprovalTransaction(tx, ENTRY)).toEqual({ ok: true, value: undefined });
    expect(calls.approvals).toEqual([ENTRY]);
    expect(await queue.markApprovalTransaction(tx, "not-an-id")).toEqual({ ok: false, error: "ID_INVALID" });
    expect(calls.approvals).toEqual([ENTRY]);
  });

  it("refuses an uppercase id: the database compares ids as lowercase text, so it would fail there as an error, not here as a refusal", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.markApprovalTransaction(tx, ENTRY.toUpperCase())).toEqual({ ok: false, error: "ID_INVALID" });
    expect(await queue.enqueueAlertDeliveries(tx, ENTRY.toUpperCase(), [alertText()])).toEqual({ ok: false, error: "ID_INVALID" });
    expect(await queue.enqueueAlertDeliveries(tx, ENTRY, [alertText({ recipient: { kind: "subscriber", id: ID.toUpperCase() } })])).toEqual({ ok: false, error: "ID_INVALID" });
    expect(calls.approvals).toEqual([]);
    expect(calls.inserted).toEqual([]);
  });
});

describe("alert deliveries", () => {
  it("are written as one batch, keyed entry:recipient:channel, in the entry's frozen body, by the alerting module", async () => {
    const { queue, calls } = queueOf();
    const other = "01900000-0000-7000-8000-0000000a0002";
    const result = await queue.enqueueAlertDeliveries(tx, ENTRY, [alertText(), alertText({ recipient: { kind: "roster", id: other }, lang: "ur", body: "متن", segments: 2 })]);
    expect(result.ok).toBe(true);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.inserted[0]).toEqual([
      {
        id: "id-1", kind: "alert", recipientKind: "subscriber", recipientId: ID, entryId: ENTRY, campaignId: null, createdByModule: "alerting", purpose: null,
        lang: "en", body: "Power is out. Reply STOP", segments: 1, costEstimateCents: 2, idempotencyKey: `${ENTRY}:${ID}:sms`, sendBy: null,
      },
      {
        id: "id-2", kind: "alert", recipientKind: "roster", recipientId: other, entryId: ENTRY, campaignId: null, createdByModule: "alerting", purpose: null,
        lang: "ur", body: "متن", segments: 2, costEstimateCents: 2, idempotencyKey: `${ENTRY}:${other}:sms`, sendBy: null,
      },
    ]);
  });

  it("refuse the whole batch when one text is refused, and write nothing", async () => {
    const { queue, calls } = queueOf();
    for (const [over, error] of [
      [{ recipient: { kind: "staff", id: ID } }, "RECIPIENT_NOT_ALLOWED"],
      [{ recipient: { kind: "subscriber", id: "x" } }, "ID_INVALID"],
      [{ lang: "xx" }, "LANG_INVALID"],
      [{ body: "" }, "BODY_INVALID"],
      [{ segments: 0 }, "SEGMENTS_INVALID"],
      [{ costEstimateCents: -1 }, "COST_INVALID"],
    ] as const) {
      expect(await queue.enqueueAlertDeliveries(tx, ENTRY, [alertText(), alertText(over as never)]), JSON.stringify(over)).toEqual({ ok: false, error });
    }
    expect(await queue.enqueueAlertDeliveries(tx, "x", [alertText()])).toEqual({ ok: false, error: "ID_INVALID" });
    expect(calls.inserted).toEqual([]);
  });

  it("write nothing for an entry with no recipients (the port returns none until E07)", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.enqueueAlertDeliveries(tx, ENTRY, [])).toEqual({ ok: true, value: [] });
    expect(calls.inserted).toEqual([]);
  });
});

describe("transactional deliveries", () => {
  it("are keyed kind:subject:purpose:nonce and due by the purpose's window from the database's clock", async () => {
    const { queue, calls } = queueOf();
    const result = await queue.enqueueTransactional(tx, welcome());
    expect(result.ok).toBe(true);
    expect(calls.inserted[0]).toEqual([
      {
        id: "id-1", kind: "transactional", recipientKind: "subscriber", recipientId: ID, entryId: null, campaignId: null, createdByModule: "subscriptions", purpose: "welcome",
        lang: "en", body: "Welcome.", segments: 1, costEstimateCents: 2, idempotencyKey: `transactional:${ID}:welcome:n1`, sendBy: { withinMs: 24 * 60 * 60_000 },
      },
    ]);
  });

  it("take a given send_by as an instant (signup_info: its inbound_reply row's expiry)", async () => {
    const { queue, calls } = queueOf();
    const expiresAt = new Date(NOW.getTime() + 20 * 60_000);
    const result = await queue.enqueueTransactional(tx, welcome({ purpose: "signup_info", recipient: { kind: "inbound_reply", id: ID }, sendBy: expiresAt }));
    expect(result.ok).toBe(true);
    expect(calls.inserted[0][0].sendBy).toEqual({ at: expiresAt });
  });

  it("refuse, without writing, what the database would refuse", async () => {
    const { queue, calls } = queueOf();
    const refused = async (over: Record<string, unknown>) => queue.enqueueTransactional(tx, welcome(over));
    expect(await refused({ module: "ops" })).toEqual({ ok: false, error: "PURPOSE_NOT_ALLOWED" });
    expect(await refused({ purpose: "confirmation" })).toEqual({ ok: false, error: "RECIPIENT_NOT_ALLOWED" });
    expect(await refused({ purpose: "signup_info", recipient: { kind: "inbound_reply", id: ID } })).toEqual({ ok: false, error: "SEND_BY_INVALID" });
    expect(await refused({ sendBy: new Date(NOW.getTime() + 25 * 60 * 60_000) })).toEqual({ ok: false, error: "SEND_BY_INVALID" });
    expect(await refused({ subject: "+14165550101" })).toEqual({ ok: false, error: "KEY_PART_INVALID" });
    expect(await refused({ nonce: "a:b" })).toEqual({ ok: false, error: "KEY_PART_INVALID" });
    expect(await refused({ body: "   " })).toEqual({ ok: false, error: "BODY_INVALID" });
    expect(calls.inserted).toEqual([]);
  });
});

describe("campaign deliveries", () => {
  const campaignText = (over: Record<string, unknown> = {}) => ({
    campaignId: CAMPAIGN,
    purpose: "reconsent",
    recipient: { kind: "subscriber" as const, id: ID },
    lang: "en" as const,
    body: "Reply YES to keep your alerts.",
    segments: 1,
    costEstimateCents: 2,
    ...over,
  });

  it("are keyed by campaign, purpose and recipient, so starting a campaign again adds nothing", async () => {
    const { queue, calls } = queueOf();
    expect((await queue.enqueueCampaignDelivery(tx, campaignText())).ok).toBe(true);
    expect(calls.inserted[0]).toEqual([
      {
        id: "id-1", kind: "campaign", recipientKind: "subscriber", recipientId: ID, entryId: null, campaignId: CAMPAIGN, createdByModule: "subscriptions", purpose: "reconsent",
        lang: "en", body: "Reply YES to keep your alerts.", segments: 1, costEstimateCents: 2, idempotencyKey: `campaign:${CAMPAIGN}:reconsent:${ID}`, sendBy: null,
      },
    ]);
  });

  it("are refused for a bad purpose, an id that is not a lowercase UUID, or a recipient who is not a subscriber", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.enqueueCampaignDelivery(tx, campaignText({ purpose: "Re Consent" }))).toEqual({ ok: false, error: "CAMPAIGN_PURPOSE_INVALID" });
    expect(await queue.enqueueCampaignDelivery(tx, campaignText({ campaignId: "x" }))).toEqual({ ok: false, error: "ID_INVALID" });
    expect(await queue.enqueueCampaignDelivery(tx, campaignText({ campaignId: CAMPAIGN.toUpperCase() }))).toEqual({ ok: false, error: "ID_INVALID" });
    for (const kind of ["pending_signup", "roster", "staff", "oncall", "inbound_reply"] as const) {
      expect(await queue.enqueueCampaignDelivery(tx, campaignText({ recipient: { kind, id: ID } })), kind).toEqual({ ok: false, error: "RECIPIENT_NOT_ALLOWED" });
    }
    expect(calls.inserted).toEqual([]);
  });
});

describe("a recipient's deletion", () => {
  it("asks the store to skip the recipient's rows and returns what it did", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.skipRecipientDeliveries(tx, { kind: "subscriber", id: ID })).toEqual({ skipped: 2, inFlight: 1 });
    expect(calls.skips).toEqual([{ kind: "subscriber", id: ID }]);
  });
});

describe("cancelQueued (S05.02)", () => {
  it("asks the store to cancel the rows of the entries, each once, and returns what it did", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.cancelQueued([ENTRY, ENTRY, ID], tx)).toEqual({ cancelled: 3, inFlight: 1 });
    expect(calls.cancels).toEqual([[ENTRY, ID]]);
  });

  it("does nothing, and does not ask the store, for no entry or an id that is not one", async () => {
    const { queue, calls } = queueOf();
    expect(await queue.cancelQueued([], tx)).toEqual({ cancelled: 0, inFlight: 0 });
    expect(await queue.cancelQueued(["not-an-id"], tx)).toEqual({ cancelled: 0, inFlight: 0 });
    expect(calls.cancels).toEqual([]);
  });
});
