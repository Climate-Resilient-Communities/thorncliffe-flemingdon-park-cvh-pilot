import { afterEach, describe, expect, it } from "vitest";
import { RECIPIENT_KINDS, RECIPIENT_OWNER, ContactSourceNotWired, type MessagingLog, type RecipientKind, type RecipientNumberSource } from "@/modules/messaging";
import type { DbTransaction } from "@/platform/db";
import { oncallNumberSource } from "@/modules/ops";
import { drillNumberSource, pendingSignupNumberSource } from "@/modules/subscriptions";
import { contactResolver, resetMessagingComposition, wireContactResolver, wireContactSources, type OwnerNumberSources } from "./messaging";

const tx = {} as DbTransaction;
const DELIVERY = "01900000-0000-7000-8000-0000000b0001";
const RECIPIENT = "01900000-0000-7000-8000-0000000a0001";

/** A source that answers with its own marker, so a test can tell which module's source was asked. */
const sourceOf = (marker: string): RecipientNumberSource & { asked: number } => {
  const source = {
    asked: 0,
    async numberOf() {
      source.asked += 1;
      return marker;
    },
  };
  return source;
};

const silentLog: MessagingLog = { info: () => undefined, error: () => undefined };

describe("the messaging composition root", () => {
  afterEach(() => resetMessagingComposition());

  it("wires each kind of recipient to the module that owns it: subscriptions, identity or ops", async () => {
    const subscriptions = {
      subscriber: sourceOf("+14165550101"),
      pending_signup: sourceOf("+14165550102"),
      roster: sourceOf("+14165550103"),
      inbound_reply: sourceOf("+14165550104"),
    };
    const identity = sourceOf("+14165550105");
    const ops = sourceOf("+14165550106");
    const owners: OwnerNumberSources = { subscriptions, identity, ops };
    const resolver = wireContactResolver(owners, silentLog);

    const expected: Record<RecipientKind, string> = {
      subscriber: "+14165550101",
      pending_signup: "+14165550102",
      roster: "+14165550103",
      inbound_reply: "+14165550104",
      staff: "+14165550105",
      oncall: "+14165550106",
    };
    for (const kind of RECIPIENT_KINDS) {
      expect(await resolver.resolve(tx, { deliveryId: DELIVERY, kind, id: RECIPIENT }), kind).toEqual({ found: true, number: expected[kind] });
    }
    // Each module's source was asked for its own kinds only.
    expect([subscriptions.subscriber.asked, subscriptions.pending_signup.asked, subscriptions.roster.asked, subscriptions.inbound_reply.asked, identity.asked, ops.asked]).toEqual([1, 1, 1, 1, 1, 1]);
    expect(RECIPIENT_OWNER.staff).toBe("identity");
    expect(RECIPIENT_OWNER.oncall).toBe("ops");
    expect(new Set(RECIPIENT_KINDS.filter((kind) => RECIPIENT_OWNER[kind] === "subscriptions"))).toEqual(new Set(["subscriber", "pending_signup", "roster", "inbound_reply"]));
  });

  it("leaves a kind with no source unwired, and an unwired kind fails loudly", async () => {
    const subscriber = sourceOf("+14165550101");
    expect(Object.keys(wireContactSources({ subscriptions: { subscriber } }))).toEqual(["subscriber"]);
    expect(Object.keys(wireContactSources({}))).toEqual([]);
    const resolver = wireContactResolver({ subscriptions: { subscriber } }, silentLog);
    await expect(resolver.resolve(tx, { deliveryId: DELIVERY, kind: "oncall", id: RECIPIENT })).rejects.toBeInstanceOf(ContactSourceNotWired);
  });

  it("gives the dispatcher one resolver, with ops' on-call source and subscriptions' drill roster and pending sign-up sources wired and the others not yet", async () => {
    expect(contactResolver()).toBe(contactResolver());
    expect(Object.keys(wireContactSources({ ops: oncallNumberSource }))).toEqual(["oncall"]);
    expect(Object.keys(wireContactSources({ subscriptions: { roster: drillNumberSource, pending_signup: pendingSignupNumberSource() } })).sort()).toEqual(["pending_signup", "roster"]);
    await expect(contactResolver().resolve(tx, { deliveryId: DELIVERY, kind: "subscriber", id: RECIPIENT })).rejects.toBeInstanceOf(ContactSourceNotWired);
    await expect(contactResolver().resolve(tx, { deliveryId: DELIVERY, kind: "inbound_reply", id: RECIPIENT })).rejects.toBeInstanceOf(ContactSourceNotWired);
  });
});
