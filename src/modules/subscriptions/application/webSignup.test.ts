import { describe, expect, it } from "vitest";
import type { SignupRequest } from "../../../contracts/signup";
import { LAUNCH_CODES } from "../../../i18n/languages";
import type { Db, DbTransaction } from "../../../platform/db";
import type { DeliveryView, TransactionalInput } from "../../messaging";
import type { NewPendingSignup, PendingSignupStore } from "../adapters/pendingSignupStore";
import type { RateLimiter } from "./rateLimit";
import type { AuditEvent } from "../../audit";
import {
  ASSISTED_SIGNUP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
  TWILIO_OPTED_OUT_ERROR,
  confirmationText,
  createSignup,
  forgetOptedOutSignup,
  pendingSignupNumberSource,
  type SignupDeps,
} from "./webSignup";

// The sign-up use case with every port faked: an in-memory table with transactions and savepoints that roll back, a recording outbox, a
// limiter and a subscriber lookup. Every number is fictional (555).

const VERSION = "2026-10-02.1";
const FLOOR = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const request = (patch: Partial<SignupRequest> = {}): SignupRequest => ({
  phone: "+14165550123",
  lang: "ur",
  neighbourhood: "TP",
  places: [{ rsn: "100", floors: [FLOOR] }],
  groups: ["seniors"],
  consentVersion: VERSION,
  ...patch,
});

interface World {
  rows: Map<string, NewPendingSignup & { expired?: boolean }>;
  deliveries: TransactionalInput[];
  log: string[];
}

/** The fake database: the state is copied at each (nested) transaction and put back when it throws. */
function fakeWorld(options: { subscribed?: string[]; allowed?: boolean; paused?: "before" | "inside" } = {}) {
  let world: World = { rows: new Map(), deliveries: [], log: [] };
  const copy = (w: World): World => ({ rows: new Map([...w.rows].map(([k, v]) => [k, { ...v }])), deliveries: [...w.deliveries], log: w.log });
  const tx = {
    async transaction<T>(work: (inner: DbTransaction) => Promise<T>): Promise<T> {
      world.log.push("savepoint");
      const saved = copy(world);
      try {
        const result = await work(tx as unknown as DbTransaction);
        world.log.push("release");
        return result;
      } catch (error) {
        world = saved;
        world.log.push("rollback to savepoint");
        throw error;
      }
    },
  };
  const db = {
    async transaction<T>(work: (t: DbTransaction) => Promise<T>): Promise<T> {
      const saved = copy(world);
      try {
        return await work(tx as unknown as DbTransaction);
      } catch (error) {
        world = saved;
        throw error;
      }
    },
  } as unknown as Db;
  const store = {
    async lockNumber() {
      world.log.push("lock number");
    },
    async deleteExpired(_tx: DbTransaction, phone: string) {
      world.log.push("delete expired");
      for (const [id, row] of world.rows) if (row.phone === phone && row.expired) world.rows.delete(id);
    },
    async insert(_tx: DbTransaction, row: NewPendingSignup) {
      world.log.push("insert pending");
      if ([...world.rows.values()].some((r) => r.phone === row.phone)) return null;
      world.rows.set(row.id, { ...row });
      return row.id;
    },
    async exists(_tx: DbTransaction, id: string) {
      return world.rows.has(id);
    },
    async delete(_tx: DbTransaction, id: string) {
      world.log.push("delete pending");
      return world.rows.delete(id);
    },
    async phoneOf(_tx: DbTransaction, id: string) {
      const row = world.rows.get(id);
      return row && !row.expired ? row.phone : null;
    },
  } as unknown as PendingSignupStore;
  const counted: string[] = [];
  const limiter: RateLimiter = {
    async check(rule, address) {
      counted.push(`${rule.scope}:${address}`);
      return options.allowed === false ? { allowed: false, retryAfterSeconds: 1200 } : { allowed: true };
    },
  };
  let ids = 0;
  const deps: SignupDeps = {
    db,
    store,
    newId: () => `0190a1b2-c3d4-7e5f-8a9b-${String(++ids).padStart(12, "0")}`,
    places: {
      async neighbourhoodIds() {
        world.log.push("read neighbourhoods");
        return ["FP", "TP"];
      },
      async floorIdsOf(_executor, rsn) {
        world.log.push(`read floors ${rsn}`);
        return rsn === "100" ? [FLOOR] : rsn === "200" ? [] : null;
      },
    },
    subscribers: {
      async isSubscribed(_tx, phone) {
        world.log.push("is subscribed");
        return (options.subscribed ?? []).includes(phone);
      },
    },
    async enqueue(_tx, input) {
      world.log.push("queue confirmation");
      world.deliveries.push(input);
      return { ok: true, value: { delivery: {} as DeliveryView, created: true } };
    },
    consentVersion: () => VERSION,
    limiter: () => limiter,
    pricePerSegmentCents: () => 1.5,
    // S09.07: the sign-up gate. `before`: paused when the sign-up is checked; `inside`: paused by a campaign that started while it was checked.
    gate: {
      async closed() {
        return options.paused === "before";
      },
      async holdOpen() {
        world.log.push("hold the sign-up gate");
        return options.paused === undefined;
      },
    },
  };
  return {
    deps,
    counted,
    get world() {
      return world;
    },
    store,
  };
}

describe("the web sign-up", () => {
  it("creates a pending sign-up and queues one confirmation in the chosen language, purpose confirmation, to the pending sign-up", async () => {
    const fake = fakeWorld();
    const outcome = await createSignup(fake.deps).request(request(), "203.0.113.7");

    expect(outcome).toEqual({ kind: "accepted" });
    const [row] = [...fake.world.rows.values()];
    expect(row).toEqual({
      id: expect.any(String),
      phone: "+14165550123",
      lang: "ur",
      neighbourhoodId: "TP",
      places: [{ rsn: "100", floors: [FLOOR] }],
      groups: ["seniors"],
      topics: [],
      consentVersion: VERSION,
      startedBy: "web",
    });
    const { body, segments } = confirmationText("ur");
    expect(fake.world.deliveries).toEqual([
      {
        module: "subscriptions",
        purpose: "confirmation",
        recipient: { kind: "pending_signup", id: row!.id },
        subject: row!.id,
        nonce: "web",
        lang: "ur",
        body,
        segments,
        costEstimateCents: Math.ceil(segments * 1.5),
      },
    ]);
    // No `sendBy`: the queue gives the purpose's 48 hours from the database's clock, the same instant as the row's expires_at.
    expect(fake.world.deliveries[0]).not.toHaveProperty("sendBy");
    expect(fake.counted).toEqual(["signup:203.0.113.7"]);
  });

  it("does the same work for a new number, a pending one and a subscribed one, and keeps it only for the new one", async () => {
    const run = async (setup: (fake: ReturnType<typeof fakeWorld>) => Promise<void>, subscribed: string[] = []) => {
      const fake = fakeWorld({ subscribed });
      await setup(fake);
      fake.world.log.length = 0;
      const before = { rows: fake.world.rows.size, deliveries: fake.world.deliveries.length };
      const outcome = await createSignup(fake.deps).request(request(), "203.0.113.7");
      return { outcome, log: [...fake.world.log], added: { rows: fake.world.rows.size - before.rows, deliveries: fake.world.deliveries.length - before.deliveries } };
    };
    const fresh = await run(async () => undefined);
    const pending = await run(async (fake) => void (await createSignup(fake.deps).request(request({ lang: "fr" }), "198.51.100.1")));
    const subscribed = await run(async () => undefined, ["+14165550123"]);

    expect([fresh.outcome, pending.outcome, subscribed.outcome]).toEqual([{ kind: "accepted" }, { kind: "accepted" }, { kind: "accepted" }]);
    // The places are read before the client is counted and again in the transaction.
    const places = ["read neighbourhoods", "read floors 100"];
    const steps = [...places, ...places, "lock number", "hold the sign-up gate", "is subscribed", "delete expired", "savepoint", "insert pending", "queue confirmation"];
    expect(fresh.log).toEqual([...steps, "release"]);
    expect(pending.log).toEqual([...steps, "rollback to savepoint"]);
    expect(subscribed.log).toEqual([...steps, "rollback to savepoint"]);
    // Only the new number gets a pending sign-up and a text.
    expect(fresh.added).toEqual({ rows: 1, deliveries: 1 });
    expect(pending.added).toEqual({ rows: 0, deliveries: 0 });
    expect(subscribed.added).toEqual({ rows: 0, deliveries: 0 });
  });

  it("starts afresh for a number whose pending sign-up expired", async () => {
    const fake = fakeWorld();
    await createSignup(fake.deps).request(request({ lang: "fr" }), "198.51.100.1");
    for (const row of fake.world.rows.values()) row.expired = true;

    expect(await createSignup(fake.deps).request(request(), "198.51.100.1")).toEqual({ kind: "accepted" });
    expect([...fake.world.rows.values()].map((row) => row.lang)).toEqual(["ur"]);
    expect(fake.world.deliveries.map((d) => d.lang)).toEqual(["fr", "ur"]);
  });

  it("refuses unknown places and an unknown neighbourhood, storing nothing", async () => {
    const fake = fakeWorld();
    const signup = createSignup(fake.deps);

    expect(await signup.request(request({ places: [{ rsn: "999", floors: [] }] }), "a")).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await signup.request(request({ places: [{ rsn: "200", floors: [FLOOR] }] }), "a")).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await signup.request(request({ neighbourhood: "NE" }), "a")).toEqual({ kind: "refused", code: "invalid_request" });
    expect(fake.world.rows.size).toBe(0);
    expect(fake.world.deliveries).toEqual([]);
  });

  it("refuses a wrong building, floor or neighbourhood before counting the client: a mistake uses up none of its 5 sign-ups an hour", async () => {
    const fake = fakeWorld();
    const signup = createSignup(fake.deps);

    for (let i = 0; i < 10; i += 1) {
      expect(await signup.request(request({ places: [{ rsn: "999", floors: [] }] }), "203.0.113.9")).toEqual({ kind: "refused", code: "place_unknown" });
    }
    expect(await signup.request(request({ places: [{ rsn: "200", floors: [FLOOR] }] }), "203.0.113.9")).toEqual({ kind: "refused", code: "place_unknown" });
    expect(await signup.request(request({ neighbourhood: "NE" }), "203.0.113.9")).toEqual({ kind: "refused", code: "invalid_request" });
    expect(fake.counted).toEqual([]);
    expect(await signup.request(request(), "203.0.113.9")).toEqual({ kind: "accepted" });
    expect(fake.counted).toEqual(["signup:203.0.113.9"]);
  });

  it("refuses when the client is over its limit (more than 5 an hour), storing nothing", async () => {
    const fake = fakeWorld({ allowed: false });

    expect(await createSignup(fake.deps).request(request(), "203.0.113.7")).toEqual({ kind: "rate_limited", retryAfterSeconds: 1200 });
    expect(fake.world.rows.size).toBe(0);
    // Only the place checks, which come before the count; nothing is locked, read about the number or written.
    expect(fake.world.log.every((line) => line.startsWith("read "))).toBe(true);
    expect(SIGNUP_RATE_LIMIT).toEqual({ scope: "signup", limit: 5, windowMs: 3_600_000 });
  });

  it("refuses when no terms may be signed up to, or the form showed another version, before counting the client", async () => {
    const closed = fakeWorld();
    expect(await createSignup({ ...closed.deps, consentVersion: () => null }).request(request(), "a")).toEqual({ kind: "refused", code: "signup_unavailable" });
    const changed = fakeWorld();
    expect(await createSignup(changed.deps).request(request({ consentVersion: "2026-09-01.1" }), "a")).toEqual({ kind: "refused", code: "terms_changed" });
    expect([...closed.counted, ...changed.counted]).toEqual([]);
  });

  it("refuses every sign-up while sign-ups are paused for the end of the pilot (S09.07), before counting the client, storing and sending nothing", async () => {
    for (const subscribed of [[], ["+14165550123"]]) {
      const fake = fakeWorld({ paused: "before", subscribed });
      expect(await createSignup(fake.deps).request(request(), "a")).toEqual({ kind: "refused", code: "signups_paused" });
      expect(fake.counted).toEqual([]);
      expect(fake.world.rows.size).toBe(0);
      expect(fake.world.deliveries).toEqual([]);
    }
  });

  it("refuses a sign-up that the campaign's start closed while it was checked: the gate is held in its transaction, after the number's lock", async () => {
    const fake = fakeWorld({ paused: "inside" });
    expect(await createSignup(fake.deps).request(request(), "a")).toEqual({ kind: "refused", code: "signups_paused" });
    expect(fake.world.log.filter((line) => !line.startsWith("read "))).toEqual(["lock number", "hold the sign-up gate"]);
    expect(fake.world.rows.size).toBe(0);
    expect(fake.world.deliveries).toEqual([]);
  });

  it("records a web sign-up as started on the web", async () => {
    const fake = fakeWorld();
    await createSignup(fake.deps).request(request(), "a");

    expect([...fake.world.rows.values()][0]!.startedBy).toBe("web");
    expect(fake.world.deliveries[0]!.nonce).toBe("web");
  });

  it("fails loudly, writing nothing, when the outbox refuses the text it was given (a bug, not a resident's mistake)", async () => {
    const fake = fakeWorld();
    const signup = createSignup({ ...fake.deps, enqueue: async () => ({ ok: false, error: "BODY_INVALID" }) });

    await expect(signup.request(request(), "a")).rejects.toThrow("The confirmation text was refused: BODY_INVALID");
    expect(fake.world.rows.size).toBe(0);
  });
});

describe("the confirmation text", () => {
  it("is the catalog's text in every launch language, keeping YES, STOP and CVH in English, normalised and counted", () => {
    expect(confirmationText("en")).toEqual({ body: "Reply YES to get CVH alerts. Reply STOP to stop.", segments: 1 });
    for (const lang of LAUNCH_CODES) {
      const { body, segments } = confirmationText(lang);
      expect(body, lang).toMatch(/YES/);
      expect(body, lang).toMatch(/STOP/);
      expect(body, lang).toMatch(/CVH/);
      expect(body.startsWith("[EN]"), lang).toBe(false);
      expect(segments, lang).toBeGreaterThanOrEqual(1);
      expect(segments, lang).toBeLessThanOrEqual(2);
    }
  });
});

describe("the pending sign-up's number source", () => {
  it("gives the number only for its confirmation, and nothing once it is gone or expired", async () => {
    const fake = fakeWorld();
    await createSignup(fake.deps).request(request(), "a");
    const [row] = [...fake.world.rows.values()];
    const source = pendingSignupNumberSource(fake.store);
    const tx = {} as DbTransaction;

    expect(await source.numberOf(tx, row!.id, { consume: false, purpose: "confirmation" })).toBe("+14165550123");
    expect(await source.numberOf(tx, row!.id, { consume: false, purpose: "welcome" })).toBeNull();
    expect(await source.numberOf(tx, row!.id, { consume: false })).toBeNull();
    row!.expired = true;
    expect(await source.numberOf(tx, row!.id, { consume: false, purpose: "confirmation" })).toBeNull();
  });
});

describe("a confirmation refused because the number texted STOP (Twilio 21610)", () => {
  const delivery = (patch: Partial<DeliveryView>): DeliveryView => ({ recipientKind: "pending_signup", purpose: "confirmation", recipientId: "r1", ...patch }) as DeliveryView;

  it("deletes the pending sign-up after skipping its waiting texts; any other refusal or text is left alone", async () => {
    const fake = fakeWorld();
    await createSignup(fake.deps).request(request(), "a");
    const [row] = [...fake.world.rows.values()];
    const skipped: string[] = [];
    const hook = forgetOptedOutSignup({ store: fake.store, skipRecipientDeliveries: async (_tx, r) => (skipped.push(`${r.kind}:${r.id}`), { skipped: 0, inFlight: 0 }) });
    const tx = {} as DbTransaction;

    await hook(tx, delivery({ recipientId: row!.id }), 21_614);
    await hook(tx, delivery({ recipientId: row!.id }), null);
    await hook(tx, delivery({ recipientId: row!.id, purpose: "welcome" }), TWILIO_OPTED_OUT_ERROR);
    await hook(tx, delivery({ recipientId: row!.id, recipientKind: "subscriber" }), TWILIO_OPTED_OUT_ERROR);
    await hook(tx, delivery({ recipientId: null }), TWILIO_OPTED_OUT_ERROR);
    expect(fake.world.rows.size).toBe(1);

    await hook(tx, delivery({ recipientId: row!.id }), TWILIO_OPTED_OUT_ERROR);
    expect(fake.world.rows.size).toBe(0);
    expect(skipped).toEqual([`pending_signup:${row!.id}`]);
  });
});

describe("the staff-assisted sign-up (S07.03)", () => {
  const STAFF = "01900000-0000-7000-8000-0000000000aa";

  /** The fake world with an audit trail that records what it is given, and where (in the sign-up's transaction, or after it). */
  function assisted(options: Parameters<typeof fakeWorld>[0] = {}) {
    const fake = fakeWorld(options);
    const audited: { outcome: "ok" | "refused"; event: AuditEvent<"signup.assisted"> }[] = [];
    const deps: SignupDeps = {
      ...fake.deps,
      audit: {
        async record(_tx, event) {
          fake.world.log.push("audit");
          audited.push({ outcome: "ok", event });
        },
        async recordRefusal(_db, event) {
          audited.push({ outcome: "refused", event });
        },
      },
    };
    return { ...fake, deps, audited };
  }
  const ok = (patch: Partial<SignupRequest> = {}) => ({ ok: true as const, value: request(patch) });

  it("writes the same pending sign-up, started by staff, and queues the same one confirmation as the web form", async () => {
    const fake = assisted();
    expect(await createSignup(fake.deps).assist(ok(), STAFF)).toEqual({ kind: "accepted" });

    const [row] = [...fake.world.rows.values()];
    expect(row).toMatchObject({ phone: "+14165550123", lang: "ur", neighbourhoodId: "TP", consentVersion: VERSION, startedBy: "staff" });
    expect(fake.world.deliveries).toHaveLength(1);
    expect(fake.world.deliveries[0]).toMatchObject({ purpose: "confirmation", recipient: { kind: "pending_signup", id: row!.id }, nonce: "staff", lang: "ur", body: confirmationText("ur").body });
  });

  it("is counted per staff account under its own limit, never against a client's address", async () => {
    const fake = assisted();
    await createSignup(fake.deps).assist(ok(), STAFF);

    expect(fake.counted).toEqual([`${ASSISTED_SIGNUP_RATE_LIMIT.scope}:staff:${STAFF}`]);
    expect(ASSISTED_SIGNUP_RATE_LIMIT).toEqual({ scope: "signup_assisted", limit: 40, windowMs: 24 * 60 * 60_000 });
    expect(ASSISTED_SIGNUP_RATE_LIMIT.scope).not.toBe(SIGNUP_RATE_LIMIT.scope);
  });

  it("audits an accepted sign-up inside its transaction, after the writes, with the staff id and no number, the same for a new, a pending and a subscribed number", async () => {
    const records = [];
    for (const subscribed of [[], ["+14165550123"]]) {
      const fake = assisted({ subscribed });
      await createSignup(fake.deps).assist(ok(), STAFF);
      await createSignup(fake.deps).assist(ok(), STAFF);
      expect(fake.world.log.at(-1)).toBe("audit");
      records.push(...fake.audited);
    }
    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record).toEqual({ outcome: "ok", event: { action: "signup.assisted", actorStaffId: STAFF, subjectType: "pending_signup", subjectId: null, meta: {} } });
      expect(JSON.stringify(record)).not.toContain("5550123");
    }
  });

  it("refuses what the contract refused, audited with the reason and the code, counting nothing and storing nothing", async () => {
    const fake = assisted();
    const outcome = await createSignup(fake.deps).assist({ ok: false, code: "age_not_confirmed" }, STAFF);

    expect(outcome).toEqual({ kind: "refused", code: "age_not_confirmed" });
    expect(fake.audited).toEqual([
      { outcome: "refused", event: { action: "signup.assisted", actorStaffId: STAFF, subjectType: "pending_signup", subjectId: null, meta: { reason: "validation", code: "age_not_confirmed" } } },
    ]);
    expect(fake.counted).toEqual([]);
    expect(fake.world.rows.size).toBe(0);
  });

  it("refuses terms that changed and an unknown building before counting, each audited", async () => {
    const fake = assisted();
    const signup = createSignup(fake.deps);
    expect(await signup.assist(ok({ consentVersion: "2026-09-01.1" }), STAFF)).toEqual({ kind: "refused", code: "terms_changed" });
    expect(await signup.assist(ok({ places: [{ rsn: "999", floors: [] }] }), STAFF)).toEqual({ kind: "refused", code: "place_unknown" });

    expect(fake.audited.map((a) => a.event.meta)).toEqual([
      { reason: "conflict", code: "terms_changed" },
      { reason: "validation", code: "place_unknown" },
    ]);
    expect(fake.counted).toEqual([]);
  });

  it("refuses the staff account's sign-up past its limit, audited as throttled, storing nothing", async () => {
    const fake = assisted({ allowed: false });
    expect(await createSignup(fake.deps).assist(ok(), STAFF)).toEqual({ kind: "rate_limited", retryAfterSeconds: 1200 });

    expect(fake.audited).toEqual([
      { outcome: "refused", event: { action: "signup.assisted", actorStaffId: STAFF, subjectType: "pending_signup", subjectId: null, meta: { reason: "throttled", code: "rate_limited" } } },
    ]);
    expect(fake.world.rows.size).toBe(0);
    expect(fake.world.deliveries).toEqual([]);
  });

  it("refuses while sign-ups are paused (S09.07), audited as not available with the code, counting and storing nothing", async () => {
    for (const paused of ["before", "inside"] as const) {
      const fake = assisted({ paused });
      expect(await createSignup(fake.deps).assist(ok(), STAFF)).toEqual({ kind: "refused", code: "signups_paused" });
      expect(fake.audited).toEqual([
        { outcome: "refused", event: { action: "signup.assisted", actorStaffId: STAFF, subjectType: "pending_signup", subjectId: null, meta: { reason: "not_available", code: "signups_paused" } } },
      ]);
      expect(fake.world.rows.size).toBe(0);
    }
  });

  it("will not run without the audit trail", async () => {
    const fake = fakeWorld();
    await expect(createSignup(fake.deps).assist(ok(), STAFF)).rejects.toThrow(/audit/);
    expect(fake.world.rows.size).toBe(0);
  });
});
