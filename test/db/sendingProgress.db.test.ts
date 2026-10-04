// The sending progress of an alert entry (S06.09, O-06), against a real database with the app's own credentials (cvh_app_login): the counts per language
// that the SQL makes are the counts the module's definition (`progressOf`) makes of the same rows, in every state a text can be in; a drill's texts and another
// entry's are not counted; the lists of the texts that did not arrive say what each means and hold no number; and, with the real pause, the sentence about
// the texts already handed to the provider is shown while texts are paused and an entry still has texts waiting, and not otherwise. Nothing here reaches Twilio
// or any real provider; every phone number is obviously fake, and a delivery row holds none.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { sendingBlock } from "../../src/app/staff/alerts/sending/load";
import { reviewOf } from "../helpers/approvalReview";
import { createMessagingPause, progressOf, sendingProgress, type MessagingPause } from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { uuidv7 } from "../../src/platform/ids";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";
import { transitionStatement, type SeededEntry, type Tx } from "./deliveryFixtures";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let pause: MessagingPause;
let auditBaseline = 0;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  pause = createMessagingPause({ db: app });
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
});

async function clearAudit() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
}

async function resetAll() {
  await owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
  await clearAudit();
  await world.reset();
}

afterAll(async () => {
  await resetAll();
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

/** The progress block the Hub draws for an approved entry: the real counts and the real pause switch, with the entry's facts from the fixture. */
const sendBlockFor = (db: Db, entry: SeededEntry) =>
  sendingBlock(reviewOf({ entry: { id: entry.entryId, alertId: entry.alertId, status: "approved" } as never, thread: { id: entry.alertId } as never }), {
    progress: { forEntry: (id) => sendingProgress.forEntry(db, id), problemTexts: (id, state) => sendingProgress.problemTexts(db, id, state) },
    paused: async () => (await pause.status(db)).paused,
    logError: (event, fields) => {
      throw new Error(`unexpected log ${event} ${JSON.stringify(fields)}`);
    },
  });

type Lang = "en" | "ur";

/** What a seeded text becomes: the state it is driven to by legal transitions as the app's role, whether it was handed to the provider, and its provider error code. */
interface Spec {
  lang: Lang;
  to: "queued" | "claimed" | "claimed_handed_off" | "submitted" | "delivered" | "undelivered" | "failed" | "failed_handed_off" | "unknown" | "cancelled" | "skipped" | "skipped_env";
  code?: number;
}

/** An approved entry with one text per spec (each to its own recipient), driven to its state. Returns the delivery ids in the order of the specs. */
async function seedEntry(specs: readonly Spec[], options: { isDrill?: boolean } = {}): Promise<{ entry: SeededEntry; ids: string[] }> {
  const entry = await world.fx.entry("pending_approval", { isDrill: options.isDrill });
  const ids: string[] = [];
  const recipients: string[] = [];
  for (const _ of specs) recipients.push(randomUUID());
  if (options.isDrill) for (const recipient of recipients) await world.fx.rosterMember({ id: recipient });
  await appSql.begin(async (tx: Tx) => {
    await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
    for (const [index, spec] of specs.entries()) {
      const id = uuidv7();
      ids.push(id);
      const frozen = entry.bodies[spec.lang];
      await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
               values (${id}, 'alert', ${options.isDrill ? "roster" : "subscriber"}, ${recipients[index]}, ${entry.entryId}, 'alerting', ${spec.lang}, ${frozen.body}, ${frozen.segments}, 4, ${`${entry.entryId}:${recipients[index]}:sms`})`;
    }
    await world.fx.approve(tx, entry);
  });
  for (const [index, spec] of specs.entries()) await drive(ids[index], spec);
  return { entry, ids };
}

async function drive(id: string, spec: Spec) {
  await appSql.begin(async (tx: Tx) => {
    const claim = () => transitionStatement(tx, id, "claimed");
    const handOff = () => tx`update delivery set handed_off_at = now() where id = ${id}`;
    switch (spec.to) {
      case "queued":
        return;
      case "claimed":
        await claim();
        return;
      case "claimed_handed_off":
        await claim();
        await handOff();
        return;
      case "submitted":
      case "delivered":
      case "undelivered":
        await claim();
        await handOff();
        // A final state never changes, so the provider's code goes in the same statement, as the status callback writes it.
        if (spec.code === undefined) await transitionStatement(tx, id, spec.to);
        else await tx`update delivery set state = ${spec.to}, provider_message_id = ${"SM" + "0123456789abcdef".repeat(2)}, provider_error_code = ${spec.code} where id = ${id}`;
        return;
      case "failed":
        await claim();
        await tx`update delivery set state = 'failed', provider_error_code = ${spec.code ?? null} where id = ${id}`;
        return;
      case "failed_handed_off":
        await claim();
        await handOff();
        await tx`update delivery set state = 'failed', provider_error_code = ${spec.code ?? null} where id = ${id}`;
        return;
      case "unknown":
        await claim();
        await handOff();
        await transitionStatement(tx, id, "unknown");
        return;
      case "cancelled":
        await transitionStatement(tx, id, "cancelled");
        return;
      case "skipped":
        await transitionStatement(tx, id, "skipped");
        return;
      case "skipped_env":
        await claim();
        await transitionStatement(tx, id, "skipped_env");
        return;
    }
  });
}

const spec = (lang: Lang, to: Spec["to"], count = 1, code?: number): Spec[] => Array.from({ length: count }, () => ({ lang, to, ...(code === undefined ? {} : { code }) }));

const ALL_STATES: Spec[] = [
  ...spec("en", "queued", 2),
  ...spec("en", "claimed", 1),
  ...spec("en", "claimed_handed_off", 1),
  ...spec("en", "submitted", 2),
  ...spec("en", "delivered", 3),
  ...spec("ur", "delivered", 2),
  ...spec("ur", "undelivered", 1, 30006),
  ...spec("ur", "failed", 2, 30005),
  ...spec("ur", "failed_handed_off", 1),
  ...spec("ur", "unknown", 1),
  ...spec("ur", "cancelled", 2),
  ...spec("ur", "skipped", 1),
  ...spec("en", "skipped_env", 1),
];

describe("the counts per language", () => {
  it("are what the module's definition makes of the same rows, in every state a text can be in", async () => {
    const { entry } = await seedEntry(ALL_STATES);
    const stored = await owner<{ lang: string; state: string; handed_off: boolean }[]>`select lang, state, handed_off_at is not null as handed_off from delivery where entry_id = ${entry.entryId}`;
    expect(stored).toHaveLength(ALL_STATES.length);

    const progress = await sendingProgress.forEntry(app, entry.entryId);

    expect(progress).toEqual(progressOf(stored.map((row) => ({ lang: row.lang, state: row.state as never, handedOff: row.handed_off }))));
    expect(progress.languages.map((language) => language.lang)).toEqual(["en", "ur"]);
    // The definition spelled out: waiting is queued plus claimed and not handed off; in flight is submitted plus claimed and handed off.
    expect(progress.languages[0]).toEqual({ lang: "en", waiting: 3, inFlight: 3, delivered: 3, undelivered: 0, failed: 0, unknown: 0, cancelled: 0, skipped: 1 });
    expect(progress.languages[1]).toEqual({ lang: "ur", waiting: 0, inFlight: 0, delivered: 2, undelivered: 1, failed: 3, unknown: 1, cancelled: 2, skipped: 1 });
    expect(progress.texts).toBe(ALL_STATES.length);
    expect(progress.total.waiting + progress.total.inFlight + progress.total.delivered + progress.total.undelivered + progress.total.failed + progress.total.unknown + progress.total.cancelled + progress.total.skipped).toBe(ALL_STATES.length);
  });

  it("count the rows with a hand-off whatever their state is now: delivered, failed after the hand-off, unknown, in flight, undelivered", async () => {
    const { entry } = await seedEntry(ALL_STATES);
    const [{ n }] = await owner<{ n: number }[]>`select count(*)::int as n from delivery where entry_id = ${entry.entryId} and handed_off_at is not null`;
    const progress = await sendingProgress.forEntry(app, entry.entryId);
    expect(progress.handedOff).toBe(n);
    // en: 1 claimed + 2 submitted + 3 delivered; ur: 2 delivered + 1 undelivered + 1 failed after the hand-off + 1 unknown
    expect(progress.handedOff).toBe(6 + 5);
  });

  it("put the one text a pause let go during an open hand-off (claimed, with a hand-off) in flight", async () => {
    const { entry, ids } = await seedEntry([...spec("en", "queued", 2), ...spec("en", "claimed_handed_off", 1)]);
    const [row] = await owner`select state, handed_off_at is not null as handed_off from delivery where id = ${ids[2]}`;
    expect(row).toMatchObject({ state: "claimed", handed_off: true });
    const progress = await sendingProgress.forEntry(app, entry.entryId);
    expect(progress.languages[0]).toMatchObject({ waiting: 2, inFlight: 1 });
  });

  it("are zero for an entry with no text, and keep another entry's texts out", async () => {
    const empty = await world.fx.entry("approved");
    const other = await seedEntry(spec("en", "delivered", 4));
    const mine = await seedEntry(spec("ur", "queued", 1));
    expect(await sendingProgress.forEntry(app, empty.entryId)).toEqual({ languages: [], total: expect.objectContaining({ waiting: 0 }), texts: 0, handedOff: 0 });
    expect((await sendingProgress.forEntry(app, mine.entry.entryId)).texts).toBe(1);
    expect((await sendingProgress.forEntry(app, other.entry.entryId)).total.delivered).toBe(4);
  });

  it("never count a drill's texts: they have their own view", async () => {
    const drill = await seedEntry([...spec("en", "delivered", 2), ...spec("en", "queued", 1)], { isDrill: true });
    const [{ n }] = await owner<{ n: number }[]>`select count(*)::int as n from delivery where entry_id = ${drill.entry.entryId}`;
    expect(n).toBe(3);
    expect(await sendingProgress.forEntry(app, drill.entry.entryId)).toMatchObject({ languages: [], texts: 0, handedOff: 0 });
    expect((await sendingProgress.problemTexts(app, drill.entry.entryId)).texts).toEqual([]);
  });

  it("are read with the app's credentials alone and write nothing", async () => {
    const { entry } = await seedEntry(spec("en", "queued", 2));
    const before = await owner`select id, state, updated_at from delivery where entry_id = ${entry.entryId} order by id`;
    await sendingProgress.forEntry(app, entry.entryId);
    await sendingProgress.problemTexts(app, entry.entryId);
    expect(await owner`select id, state, updated_at from delivery where entry_id = ${entry.entryId} order by id`).toEqual(before);
  });
});

describe("the texts that did not arrive", () => {
  it("are listed with what each means in plain words, by the provider's code, and hold no phone number", async () => {
    const { entry, ids } = await seedEntry([
      { lang: "ur", to: "failed", code: 30005 },
      { lang: "en", to: "failed", code: 31999 },
      { lang: "en", to: "failed" },
      { lang: "ur", to: "undelivered", code: 30006 },
      { lang: "ur", to: "unknown" },
      { lang: "en", to: "delivered" },
    ]);
    const { texts, more } = await sendingProgress.problemTexts(app, entry.entryId);
    expect(more).toBe(false);
    expect(texts).toHaveLength(5);
    const byId = new Map(texts.map((text) => [text.id, text]));
    expect(byId.get(ids[0])).toMatchObject({ state: "failed", meaning: "not_in_service", code: null, lang: "ur" });
    expect(byId.get(ids[1])).toMatchObject({ state: "failed", meaning: "other_code", code: 31999 });
    expect(byId.get(ids[2])).toMatchObject({ state: "failed", meaning: "no_reason", code: null });
    expect(byId.get(ids[3])).toMatchObject({ state: "undelivered", meaning: "landline" });
    expect(byId.get(ids[4])).toMatchObject({ state: "unknown", meaning: "unclear" });
    expect(byId.has(ids[5])).toBe(false);
    // The delivery's whole stored form, and the list, hold no number: a text is named by a reference to its id.
    expect(JSON.stringify(texts)).not.toMatch(/\+\d{7,}/);
    expect(texts.every((text) => text.reference === text.id.replaceAll("-", "").slice(-6))).toBe(true);
  });

  it("can be asked for one state at a time", async () => {
    const { entry } = await seedEntry([...spec("en", "failed", 2, 30005), ...spec("en", "undelivered", 1, 30003), ...spec("ur", "unknown", 3)]);
    expect((await sendingProgress.problemTexts(app, entry.entryId, "failed")).texts).toHaveLength(2);
    expect((await sendingProgress.problemTexts(app, entry.entryId, "undelivered")).texts.map((text) => text.meaning)).toEqual(["phone_off"]);
    expect((await sendingProgress.problemTexts(app, entry.entryId, "unknown")).texts).toHaveLength(3);
    expect((await sendingProgress.problemTexts(app, entry.entryId)).texts).toHaveLength(6);
  });
});

describe("the sentence about texts already handed to the provider, with the real pause", () => {
  async function pausedWith(entry: SeededEntry) {
    const admin = await world.fx.staff("admin");
    const outcome = await pause.pause({ actorStaffId: admin.id, reason: "Wrong alert" });
    expect(outcome.kind).toBe("paused");
    return entry;
  }

  it("is shown while texts are paused and the entry still has texts waiting, with the entry's own count of texts handed to the provider, and not after the resume", async () => {
    const { entry } = await seedEntry([...spec("en", "queued", 3), ...spec("en", "delivered", 4), ...spec("ur", "failed_handed_off", 1, 30005), ...spec("ur", "failed", 1)]);
    const before = await sendBlockFor(app, entry);
    expect(before).toMatchObject({ kind: "progress", view: { handedOff: null } });

    await pausedWith(entry);
    const during = await sendBlockFor(app, entry);
    expect(during).toMatchObject({ kind: "progress", view: { handedOff: "5 texts were already handed to the provider and cannot be recalled" } });

    const admin = await world.fx.staff("admin");
    await pause.resume({ actorStaffId: admin.id });
    expect(await sendBlockFor(app, entry)).toMatchObject({ kind: "progress", view: { handedOff: null } });
  });

  it("says '1 text was ...' for one, and nothing for none", async () => {
    const one = await seedEntry([...spec("en", "queued", 2), ...spec("en", "delivered", 1)]);
    const none = await seedEntry(spec("en", "queued", 2));
    await pausedWith(one.entry);
    expect(await sendBlockFor(app, one.entry)).toMatchObject({ view: { handedOff: "1 text was already handed to the provider and cannot be recalled" } });
    expect(await sendBlockFor(app, none.entry)).toMatchObject({ view: { handedOff: null } });
  });

  it("is not shown for an entry that has nothing left waiting, although texts are paused", async () => {
    const done = await seedEntry([...spec("en", "delivered", 3), ...spec("ur", "failed", 1)]);
    await pausedWith(done.entry);
    expect(await sendBlockFor(app, done.entry)).toMatchObject({ view: { handedOff: null } });
  });

  it("counts the text a pause let go during an open hand-off as in flight, and in the sentence", async () => {
    const { entry } = await seedEntry([...spec("en", "queued", 2), ...spec("en", "claimed_handed_off", 1)]);
    await pausedWith(entry);
    const block = await sendBlockFor(app, entry);
    if (block?.kind !== "progress") throw new Error("expected a progress block");
    expect(block.view.handedOff).toBe("1 text was already handed to the provider and cannot be recalled");
    expect(block.view.languages[0].counts.find((count) => count.id === "inFlight")?.n).toBe(1);
  });
});
