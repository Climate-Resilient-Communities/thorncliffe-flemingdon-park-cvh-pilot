// Logging a disruption and submitting what was written, against a real database (S04.05): the thread's slug, the draft's valid-until
// rules, and Submit end to end with the real lifecycle, the real attempt table, the real routes and cache of S04.02 and the real
// renderer and hash of S04.06; only the translation model (a scripted fake), the clock and Twilio's side are fakes. The part the
// story's acceptance criteria call out: a submit whose outcome the browser did not see (the connection dropped after the commit, and
// after a failure) leaves never more than one pending version, the same key returns the first result, and a new key is allowed
// only after a confirmed failure. The use cases run as the app's own role (cvh_app_login).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { Audience } from "../../src/contracts/audience";
import {
  FROZEN_LANGS,
  createAlertSubmitter,
  createAlerting,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type AlertSubmitter,
  type EntryContent,
  type EntryRef,
  type EntryTranslator,
  type SubmitReport,
} from "../../src/modules/alerting";
import { fakeTranslator, type Behaviour } from "../../src/modules/translation/adapters/fakeTranslator";
import { ENGLISH_ALERT, GOOD } from "../../src/modules/translation/domain/alertFixtures";
import {
  AlertRoutesUnavailableError,
  PROMPT_VERSION,
  RouteConfigError,
  createSubmitTranslator,
  drizzleTranslationCache,
  readTranslationRoutes,
  type SubmitTranslatorDeps,
} from "../../src/modules/translation";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const RSN = "4154146";
const OTHER_RSN = "4154147";
const FP_RSN = "4154148";
const floorId = (index: number) => `01900000-0000-7000-8000-0000000b${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];

const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const buildingAudience = (types: string[] = ["power"], rsn = RSN, floors: string[] | null = null, groups: Audience["groups"] = []): Audience => ({
  scope: "buildings",
  buildings: [{ rsn, floors }],
  groups,
  types: [...types].sort(),
});
const neighbourhoodAudience = (ids = ["TP"], types = ["power"]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: [...types].sort() });

const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: ENGLISH_ALERT,
  types: ["power"],
  audience: buildingAudience([...(over.types ?? ["power"])]),
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  ...over,
});

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Account {
  id: string;
  role: Role;
}
const accounts: Account[] = [];
let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let alerting: AlertLifecycle;
let author: Account;
let editor: Account;
let approver: Account;
let director: Account;
let ambassador: Account;

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`as_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}
const actorOf = (who: Account): AlertActor => ({ staffId: who.id, aal: who.role === "ambassador" ? "aal1" : "aal2" });

// --- the fake translation model, the translator that runs it by the real routes, and the submitter --------------------

const KEYS = {
  one: "0190a000-0000-7000-8000-000000000001",
  two: "0190a000-0000-7000-8000-000000000002",
  three: "0190a000-0000-7000-8000-000000000003",
};
const ALL_GOOD = (call: { lang: string }): Behaviour => ({ text: GOOD[call.lang]! });

interface Rig {
  fake: ReturnType<typeof fakeTranslator>;
  submitter: AlertSubmitter;
  /** Changes what the model does from now on. */
  behave(next: (call: { lang: string; model: string; attempt: number }) => Behaviour): void;
  /** Replaces the routes the translation reads (a failure of the table). */
  routes(read: SubmitTranslatorDeps["routes"]): void;
  /** Holds the translation (outside every lock) until `release` is called, and says when it has started. */
  gate(): { started: Promise<void>; release: () => void };
}

function rig(): Rig {
  let behaviour: (call: { lang: string; model: string; attempt: number }) => Behaviour = ALL_GOOD;
  let readRoutes: SubmitTranslatorDeps["routes"] = () => readTranslationRoutes(app);
  let gate: Promise<void> | null = null;
  let started: (() => void) | null = null;
  const fake = fakeTranslator((call) => behaviour(call));
  const translator: EntryTranslator = {
    async translate(input) {
      started?.();
      await gate;
      const submit = createSubmitTranslator({
        translator: fake.translator,
        routes: readRoutes,
        cache: drizzleTranslationCache(app),
        recordSpend: async () => undefined,
        zhHant: async () => ({ convert: (text: string) => text, openccVersion: "1.4.2", config: "test s2twp" }),
        promptVersion: PROMPT_VERSION,
      });
      return submit.translate(input);
    },
  };
  const submitter = createAlertSubmitter({
    alerting,
    db: app,
    translator,
    translationConfigured: true,
    freeze: (input) => freezeContent({ ...input, publicBaseUrl: "https://cvh.example" }),
    now: () => clock,
    settleMs: 200,
  });
  return {
    fake,
    submitter,
    behave: (next) => {
      behaviour = next;
    },
    routes: (read) => {
      readRoutes = read;
    },
    gate: () => {
      let release!: () => void;
      gate = new Promise<void>((resolve) => (release = resolve));
      const begun = new Promise<void>((resolve) => (started = resolve));
      return { started: begun, release };
    },
  };
}

let r: Rig;

// --- rows --------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const attempts = (entryId: string) => owner<{ key: string; state: string; outcome: string | null; kind: string; result_version: number | null; progress: Record<string, string>; budget_ms: number | null }[]>`
  select key, state, outcome, kind, result_version, progress, budget_ms from alert_submit_attempt where entry_id = ${entryId} order by started_at`;
const translationRows = (entryId: string) => owner<{ lang: string; status: string; machine: boolean; model: string | null; conversion: Record<string, string> | null }[]>`
  select lang, status, machine, model, conversion from alert_entry_translation where entry_id = ${entryId} order by lang`;
const auditRows = () =>
  owner<{ action: string; outcome: string; meta: Record<string, unknown> }[]>`select action, outcome, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;
const opsRows = () => owner<{ kind: string; severity: string; subject_id: string | null; detail: Record<string, unknown> }[]>`select kind, severity, subject_id, detail from ops_event where kind like 'alert.%' order by id`;
const pendingCount = async (alertId: string) => Number((await owner`select count(*) as n from alert_entry where alert_id = ${alertId} and status = 'pending_approval'`)[0].n);

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate alert_submit_attempt, alert_entry_translation, alert_entry, alert");
    await tx`delete from ops_event where kind like 'alert.%'`;
    await tx`delete from translation_cache`;
  });
}

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
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nb] of [[RSN, "TP"], [OTHER_RSN, "TP"], [FP_RSN, "FP"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
                values (${rsn}, ${nb}, ${`${rsn} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
  }
  for (const [index, label] of FLOORS.entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(index)}, ${RSN}, ${label}, ${index}, true) on conflict do nothing`;
  }
  author = await account("coordinator");
  editor = await account("coordinator");
  approver = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => clock });
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from staff_account where id = ${id}`;
  });
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn in (${RSN}, ${OTHER_RSN}, ${FP_RSN})`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  clock = NOW;
  await clear();
  r = rig();
});

afterEach(() => {
  clock = NOW;
});

async function newDraft(by: Account = author, over: Partial<EntryContent> = {}, isDrill = false): Promise<EntryRef> {
  const created = await alerting.createAlert(actorOf(by), { kind: "ack", isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  return { alertId: created.value.thread.id, entryId: created.value.entry.id };
}

async function submitted(by: Account = author, over: Partial<EntryContent> = {}, key = KEYS.one): Promise<EntryRef> {
  const ref = await newDraft(by, over);
  const report = await r.submitter.submit(actorOf(by), ref, key);
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return ref;
}

/** Waits until the attempt with this key has ended, polling the entry's authoritative state the way the browser does. */
async function untilEnded(ref: EntryRef, key: string) {
  for (let polls = 0; polls < 200; polls += 1) {
    const state = await r.submitter.state(ref);
    if (state?.attempt?.key === key && state.attempt.state !== "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the attempt never ended");
}

/** The browser's connection drops once the request has reached the server: nobody reads the response, and the server does not stop. */
function dropConnection(request: Promise<SubmitReport>): void {
  void request.catch(() => undefined);
}

// --- logging a disruption ------------------------------------------------------------------------------------------

describe("logging a disruption (O-11)", () => {
  const log = (by: Account, over: Partial<Parameters<AlertLifecycle["logDisruption"]>[1]> = {}) =>
    alerting.logDisruption(actorOf(by), {
      kind: "ack",
      isDrill: false,
      reportedAt: new Date("2026-10-01T14:50:00Z"),
      types: ["power"],
      place: { scope: "buildings", buildings: [{ rsn: RSN, floors: { ids: [floorId(3)], ranges: [{ from: floorId(4), to: floorId(5) }] } }] },
      textFor: (audience) => `Power is out (${audience.scope}).`,
      ...over,
    });

  it("creates the thread with reported_at and a public slug, and the author's draft with the suggested text, the place made into the one audience, and 'until resolved' as its valid-until", async () => {
    const result = await log(author);

    if (!result.ok) throw new Error(`refused: ${result.error}`);
    const { thread, entry } = result.value;
    expect(thread).toMatchObject({ isDrill: false, status: "open", reportedAt: new Date("2026-10-01T14:50:00Z") });
    expect(thread.slug).toMatch(/^[2-9b-df-hj-km-npqrstv-z]{8}$/);
    expect(entry).toMatchObject({ kind: "ack", status: "draft", authorId: author.id, editorIds: [author.id], version: 0, contentHash: null });
    expect(entry.content.text).toBe("Power is out (buildings).");
    expect(entry.content.types).toEqual(["power"]);
    expect(entry.content.phase).toBe("problem");
    // 24 elapsed hours from now (the injected clock).
    expect(entry.content.validUntil).toEqual(new Date(NOW.getTime() + 24 * 3_600_000));
    // Floors ticked and a range, stored as floor ids, sorted and without repeats.
    expect(entry.content.audience).toEqual({ scope: "buildings", buildings: [{ rsn: RSN, floors: [floorId(3), floorId(4), floorId(5)] }], groups: [], types: ["power"] });
    expect((await auditRows()).map((row) => [row.action, row.outcome])).toEqual([["alert.created", "ok"]]);
  });

  it("takes several types, sorted, and a neighbourhood for the neighbourhood-wide ones", async () => {
    const two = await log(author, { types: ["water", "power"] });
    const heat = await log(author, { types: ["heat"], place: { scope: "neighbourhood", neighbourhoodIds: ["TP", "FP"] } });

    if (!two.ok || !heat.ok) throw new Error("refused");
    expect(two.value.entry.content.types).toEqual(["power", "water"]);
    expect(two.value.entry.content.audience.types).toEqual(["power", "water"]);
    expect(heat.value.entry.content.audience).toMatchObject({ scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"] });
  });

  it("gives every thread a slug of its own, and the database refuses a repeat or a change", async () => {
    const a = await log(author);
    const b = await log(author);
    if (!a.ok || !b.ok) throw new Error("refused");

    expect(a.value.thread.slug).not.toBe(b.value.thread.slug);
    await expect(owner`update alert set slug = ${b.value.thread.slug} where id = ${a.value.thread.id}`).rejects.toThrow(/duplicate key|never change/);
    await expect(owner`update alert set slug = 'zzzzzzzz' where id = ${a.value.thread.id}`).rejects.toThrow(/never change/);
    await expect(owner`update alert set slug = null where id = ${a.value.thread.id}`).rejects.toThrow();
  });

  it("refuses a time of first report that is later than now, or not a time", async () => {
    expect(await log(author, { reportedAt: new Date(NOW.getTime() + 1) })).toEqual({ ok: false, error: "REPORTED_AT_INVALID" });
    expect(await log(author, { reportedAt: new Date("not a date") })).toEqual({ ok: false, error: "REPORTED_AT_INVALID" });
    expect((await log(author, { reportedAt: NOW })).ok).toBe(true);
  });

  it("refuses no type, a repeated type, an unknown type, a neighbourhood-only type for buildings, a place that is not there and an empty one, creating nothing", async () => {
    expect(await log(author, { types: [] })).toEqual({ ok: false, error: "TYPES_EMPTY" });
    expect(await log(author, { types: ["power", "power"] })).toEqual({ ok: false, error: "TYPES_REPEATED" });
    expect(await log(author, { types: ["nonsense"] })).toEqual({ ok: false, error: "UNKNOWN_TYPE" });
    expect(await log(author, { types: ["heat"] })).toEqual({ ok: false, error: "NEIGHBOURHOOD_ONLY_TYPE" });
    expect(await log(author, { place: { scope: "buildings", buildings: [{ rsn: "9999999", floors: null }] } })).toEqual({ ok: false, error: "BUILDING_NOT_FOUND" });
    expect(await log(author, { place: { scope: "buildings", buildings: [] } })).toEqual({ ok: false, error: "AUDIENCE_EMPTY" });
    expect(await log(author, { place: { scope: "neighbourhood", neighbourhoodIds: ["XX"] } })).toEqual({ ok: false, error: "NEIGHBOURHOOD_NOT_FOUND" });
    expect(Number((await owner`select count(*) as n from alert`)[0].n)).toBe(0);
  });

  it("refuses a Director, and an Ambassador for a neighbourhood or a building they are not assigned to, each recorded as a refusal", async () => {
    expect(await log(director)).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await log(ambassador, { types: ["heat"], place: { scope: "neighbourhood", neighbourhoodIds: ["TP"] } })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await log(ambassador)).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect((await auditRows()).every((row) => row.action === "alert.created" && row.outcome === "refused")).toBe(true);
  });
});

// --- the draft's valid-until, saved --------------------------------------------------------------------------------

describe("saving the composer's draft", () => {
  it("saves the text, the time and the audience, and adds the person to editor_ids", async () => {
    const ref = await newDraft();

    const saved = await alerting.saveDraft(actorOf(editor), ref, content({ text: "Power is out on floors 3 to 5.", validUntil: new Date("2026-10-03T03:00:00Z") }));

    if (!saved.ok) throw new Error(`refused: ${saved.error}`);
    expect(saved.value.content.text).toBe("Power is out on floors 3 to 5.");
    expect([...saved.value.editorIds].sort()).toEqual([author.id, editor.id].sort());
  });

  it("refuses a valid-until in the past, or more than 7 days ahead, and changes nothing", async () => {
    const ref = await newDraft();

    expect(await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date(NOW.getTime() - 60_000) }))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect(await alerting.saveDraft(actorOf(author), ref, content({ validUntil: NOW }))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect(await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date("2026-10-08T15:00:01Z") }))).toEqual({ ok: false, error: "VALID_UNTIL_TOO_FAR" });
    expect((await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date("2026-10-08T15:00:00Z") }))).ok).toBe(true);
    expect((await entryRow(ref.entryId)).original_text).toBe(ENGLISH_ALERT);
  });

  it("counts the 7 days on the Toronto wall clock: across the clock change of 1 November 2026 the limit is 169 hours away", async () => {
    clock = new Date("2026-10-30T16:00:00Z"); // 12:00 EDT
    const ref = await newDraft(author, { validUntil: new Date("2026-10-31T16:00:00Z") });

    // 12:00 on 6 November is 17:00Z (EST): 169 elapsed hours after now, and still "7 days".
    expect((await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date("2026-11-06T17:00:00Z") }))).ok).toBe(true);
    expect(await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date("2026-11-06T17:00:01Z") }))).toEqual({ ok: false, error: "VALID_UNTIL_TOO_FAR" });
  });

  it("refuses text over the limit, and an empty text", async () => {
    const ref = await newDraft();

    expect(await alerting.saveDraft(actorOf(author), ref, content({ text: "x".repeat(601) }))).toEqual({ ok: false, error: "TEXT_TOO_LONG" });
    expect(await alerting.saveDraft(actorOf(author), ref, content({ text: "   " }))).toEqual({ ok: false, error: "TEXT_EMPTY" });
    expect((await alerting.saveDraft(actorOf(author), ref, content({ text: "x".repeat(600) }))).ok).toBe(true);
  });

  it("does not hold the audience pickers to the valid-until, which they do not change", async () => {
    const ref = await newDraft(author, { validUntil: new Date("2026-10-01T16:00:00Z") });
    clock = new Date("2026-10-01T17:00:00Z");

    expect((await alerting.chooseAudienceGroups(actorOf(author), ref, ["seniors"])).ok).toBe(true);
    // ... but the draft cannot be submitted with a time that has passed, and the composer's save refuses it.
    expect(await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date("2026-10-01T16:00:00Z") }))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
  });
});

// --- submit ---------------------------------------------------------------------------------------------------------

describe("Submit", () => {
  it("translates, renders and freezes the draft as version 1 with a hash, in the 15 languages, and moves it to pending_approval; the zh-Hant conversion record is kept", async () => {
    const ref = await newDraft(author, { types: ["fire"], audience: buildingAudience(["fire"]) });

    const report = await r.submitter.submit(actorOf(author), ref, KEYS.one);

    expect(report).toEqual({ state: "committed", key: KEYS.one, outcome: null });
    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "pending_approval", version: 1 });
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const bodies = row.sms_bodies as Record<string, { body: string; encoding: string; segments: number }>;
    expect(Object.keys(bodies)).toHaveLength(15);
    expect(bodies.en.body.split("\n")[0]).toMatch(/911/); // fire: the 911 line first
    const rows = await translationRows(ref.entryId);
    expect(rows.map((row) => row.lang).sort()).toEqual([...FROZEN_LANGS].sort());
    expect(rows.find((row) => row.lang === "ur")).toMatchObject({ status: "translated", machine: true });
    const hant = rows.find((row) => row.lang === "zh-Hant")!;
    expect(hant).toMatchObject({ status: "script_converted", machine: true, model: "opencc-js 1.4.2" });
    expect(hant.conversion).toMatchObject({ from: "zh", opencc_version: "1.4.2", config: "test s2twp", from_text_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await attempts(ref.entryId)).map((a) => [a.state, a.result_version])).toEqual([["committed", 1]]);
    expect((await auditRows()).map((a) => [a.action, a.outcome])).toEqual([["alert.created", "ok"], ["entry.submitted", "ok"]]);
    expect(await opsRows()).toEqual([]);
  });

  it("freezes the content an approval then binds to: a second person approves exactly this version and hash, and the author cannot", async () => {
    const ref = await submitted();
    const row = await entryRow(ref.entryId);
    const shown = { version: row.version as number, contentHash: row.content_hash as string };

    expect(await alerting.approveEntry(actorOf(author), ref, shown)).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.approveEntry(actorOf(approver), ref, { ...shown, contentHash: sha("another") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.approveEntry(actorOf(approver), ref, shown)).toMatchObject({ ok: true, value: { status: "approved", version: 1 } });
  });

  it("records the budget and each language's progress on the attempt while the translation runs outside any lock, and a reader sees it running", async () => {
    // Urdu answers at once and every other language takes a moment, so there is a time when only Urdu has settled.
    r.behave((call) => (call.lang === "ur" ? ALL_GOOD(call) : { ...ALL_GOOD(call), afterMs: 600 }));
    const ref = await newDraft();

    const run = r.submitter.submit(actorOf(author), ref, KEYS.one);
    let mid = await r.submitter.state(ref);
    for (let polls = 0; polls < 100 && mid?.attempt?.progress.ur === undefined; polls += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      mid = await r.submitter.state(ref);
    }

    // Mid-run: the attempt is running, the entry is still a draft, the budget is known, only Urdu has settled, and no lock is held (a writer passes).
    expect(mid).toMatchObject({ entry: { status: "draft", version: 0 }, attempt: { key: KEYS.one, state: "running", budgetMs: 25_000, progress: { ur: "translated" } }, translations: [] });
    expect(Object.keys(mid?.attempt?.progress ?? {})).toEqual(["ur"]);
    expect(await alerting.chooseAudienceGroups(actorOf(author), ref, [])).toMatchObject({ ok: true });

    expect(await run).toMatchObject({ state: "committed" });
    const [attempt] = await attempts(ref.entryId);
    expect(Object.keys(attempt.progress).sort()).toEqual([...FROZEN_LANGS].sort());
    expect(attempt).toMatchObject({ state: "committed", budget_ms: 25_000 });
  });

  it("ends a language that no model could translate as the English text, shows which, and still freezes a whole set", async () => {
    r.behave((call) => (call.lang === "ps" ? { error: true } : ALL_GOOD(call)));
    const ref = await newDraft();

    const report = await r.submitter.submit(actorOf(author), ref, KEYS.one);

    expect(report.state).toBe("committed");
    const rows = await translationRows(ref.entryId);
    expect(rows).toHaveLength(15);
    expect(rows.find((row) => row.lang === "ps")).toMatchObject({ status: "fallback_en", machine: false, model: null });
    expect(rows.filter((row) => row.status === "fallback_en").map((row) => row.lang)).toEqual(["ps"]);
    expect((await r.submitter.state(ref))?.attempt?.progress.ps).toBe("fallback_en");
    expect(await opsRows()).toMatchObject([{ kind: "alert.translation_fallback", severity: "warning", subject_id: ref.entryId, detail: { languages: 1 } }]);
  });

  it("keeps the translations already made: a later press reuses them from the cache instead of asking the models again", async () => {
    const ref = await newDraft();
    // The first press ends refused: the draft is edited while it is being prepared.
    const held = r.gate();
    const first = r.submitter.submit(actorOf(author), ref, KEYS.one);
    await held.started;
    await alerting.saveDraft(actorOf(editor), ref, content({ text: ENGLISH_ALERT, validUntil: new Date("2026-10-02T18:00:00Z") }));
    held.release();
    expect(await first).toMatchObject({ state: "failed", outcome: "DRAFT_CHANGED" });
    const asked = r.fake.calls.length;
    expect(asked).toBeGreaterThan(0);

    // A new key, the same English: the models are not asked again.
    const second = await r.submitter.submit(actorOf(author), ref, KEYS.two);

    expect(second.state).toBe("committed");
    expect(r.fake.calls.length).toBe(asked);
  });
});

// --- a submit whose outcome the browser did not see ------------------------------------------------------------------

describe("a submit whose outcome the browser did not see", () => {
  it("after the commit: the entry is pending, the same key returns the first result, and there is never more than one pending version", async () => {
    const ref = await newDraft();
    const held = r.gate();

    dropConnection(r.submitter.submit(actorOf(author), ref, KEYS.one));
    await held.started;
    // Back at the entry while the server is still working: running, for the same key.
    expect(await r.submitter.state(ref)).toMatchObject({ entry: { status: "draft" }, attempt: { key: KEYS.one, state: "running" } });
    held.release();
    const after = await untilEnded(ref, KEYS.one);

    expect(after).toMatchObject({ entry: { status: "pending_approval", version: 1 }, attempt: { key: KEYS.one, state: "committed", resultVersion: 1 } });
    expect(after.translations).toHaveLength(15);
    // The browser retries with the same key: the first attempt's result, nothing frozen twice.
    const asked = r.fake.calls.length;
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.one)).toEqual({ state: "committed", key: KEYS.one, outcome: null });
    expect(r.fake.calls.length).toBe(asked);
    expect(await pendingCount(ref.alertId)).toBe(1);
    expect(await attempts(ref.entryId)).toHaveLength(1);
    expect((await entryRow(ref.entryId)).version).toBe(1);
    // A new press (a new key) on the pending entry is refused: it is not a draft, so no second pending version exists.
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "refused", refusal: "ILLEGAL_TRANSITION" });
    expect(await pendingCount(ref.alertId)).toBe(1);
    expect((await entryRow(ref.entryId)).version).toBe(1);
    expect((await auditRows()).filter((row) => row.action === "entry.submitted" && row.outcome === "ok")).toHaveLength(1);
  });

  it("after a failure: the entry is still a draft with its text and nothing half-frozen, the same key returns the failure, and a new key after a confirmed failure succeeds", async () => {
    r.routes(async () => {
      throw new RouteConfigError("ur", "a position is repeated");
    });
    const ref = await newDraft();

    dropConnection(r.submitter.submit(actorOf(author), ref, KEYS.one));
    const after = await untilEnded(ref, KEYS.one);

    expect(after).toMatchObject({ entry: { status: "draft", version: 0, contentHash: null }, attempt: { key: KEYS.one, state: "failed", outcome: "ROUTES_INVALID" } });
    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "draft", version: 0, content_hash: null, sms_bodies: null, submitted_at: null, original_text: ENGLISH_ALERT });
    expect(await translationRows(ref.entryId)).toEqual([]);
    expect(await pendingCount(ref.alertId)).toBe(0);
    // The same key: the same failure, and the models were never asked.
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.one)).toEqual({ state: "failed", key: KEYS.one, outcome: "ROUTES_INVALID" });
    expect(r.fake.calls).toHaveLength(0);
    expect(await attempts(ref.entryId)).toHaveLength(1);
    // The table is fixed; a new press after the confirmed failure uses a new key and works.
    r.routes(() => readTranslationRoutes(app));
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "committed", key: KEYS.two, outcome: null });
    expect(await pendingCount(ref.alertId)).toBe(1);
    expect((await attempts(ref.entryId)).map((a) => [a.key, a.state])).toEqual([[KEYS.one, "failed"], [KEYS.two, "committed"]]);
    expect((await entryRow(ref.entryId)).version).toBe(1);
  });

  it("refuses a second press with another key while one is running, so two presses never make two pending versions", async () => {
    const ref = await newDraft();
    const held = r.gate();

    dropConnection(r.submitter.submit(actorOf(author), ref, KEYS.one));
    await held.started;
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "refused", refusal: "SUBMIT_IN_PROGRESS" });
    held.release();
    await untilEnded(ref, KEYS.one);

    expect(await pendingCount(ref.alertId)).toBe(1);
    expect((await attempts(ref.entryId)).map((a) => a.key)).toEqual([KEYS.one]);
  });

  it("settles two presses with the same key at the same time as one attempt, one pending version", async () => {
    const ref = await newDraft();

    const [a, b] = await Promise.all([r.submitter.submit(actorOf(author), ref, KEYS.one), r.submitter.submit(actorOf(author), ref, KEYS.one)]);

    // One of them did the work; the other either found the attempt running (and is told so) or came after it ended (and is told the result).
    expect([a.state, b.state].filter((state) => state === "committed").length).toBeGreaterThanOrEqual(1);
    expect([a.state, b.state].every((state) => state === "committed" || state === "running")).toBe(true);
    await untilEnded(ref, KEYS.one);
    expect(await pendingCount(ref.alertId)).toBe(1);
    expect((await entryRow(ref.entryId)).version).toBe(1);
    expect(await attempts(ref.entryId)).toHaveLength(1);
  });

  it("treats an attempt whose function is gone (running past its time limit) as failed, and lets a new press start", async () => {
    const ref = await newDraft();
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
      await tx`insert into alert_submit_attempt (entry_id, key, actor_id) values (${ref.entryId}, ${KEYS.one}, ${author.id})`;
    });
    // Not yet stale: a second press waits for it.
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "refused", refusal: "SUBMIT_IN_PROGRESS" });

    // The attempt's time is the database's; two minutes later by the app's clock its function is gone. The draft's own time moves with the clock.
    clock = new Date(Date.now() + 120_000);
    expect((await alerting.saveDraft(actorOf(author), ref, content({ validUntil: new Date(clock.getTime() + 3_600_000) }))).ok).toBe(true);
    expect(await r.submitter.state(ref)).toMatchObject({ attempt: { key: KEYS.one, state: "failed", outcome: "SUBMIT_ABANDONED" } });
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.one)).toEqual({ state: "failed", key: KEYS.one, outcome: "SUBMIT_ABANDONED" });
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "committed", key: KEYS.two, outcome: null });
    expect((await attempts(ref.entryId)).map((a) => [a.key, a.state, a.outcome])).toEqual([[KEYS.one, "failed", "SUBMIT_ABANDONED"], [KEYS.two, "committed", null]]);
  });
});

// --- refusals --------------------------------------------------------------------------------------------------------

describe("what a submit refuses", () => {
  it("refuses with 'This alert changed while it was being prepared' (DRAFT_CHANGED) when another editor changed the draft while it was prepared, freezing nothing and recording the refusal", async () => {
    const ref = await newDraft();
    const held = r.gate();

    const run = r.submitter.submit(actorOf(author), ref, KEYS.one);
    await held.started;
    await alerting.saveDraft(actorOf(editor), ref, content({ text: "Power is out. Use the stairs." }));
    held.release();

    expect(await run).toEqual({ state: "failed", key: KEYS.one, outcome: "DRAFT_CHANGED" });
    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "draft", version: 0, content_hash: null, sms_bodies: null, original_text: "Power is out. Use the stairs." });
    expect(await translationRows(ref.entryId)).toEqual([]);
    expect(row.editor_ids).toContain(editor.id);
    expect((await attempts(ref.entryId))[0]).toMatchObject({ state: "failed", outcome: "DRAFT_CHANGED" });
    expect((await auditRows()).filter((a) => a.action === "entry.submitted")).toEqual([{ action: "entry.submitted", outcome: "refused", meta: { reason: "conflict" } }]);
    // Submit again: the new press freezes the text as it is now.
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toMatchObject({ state: "committed" });
  });

  it("refuses with a message and an ops event when translation_route cannot be read in time (AlertRoutesUnavailableError): nothing is translated or frozen", async () => {
    r.routes(() => Promise.reject(new AlertRoutesUnavailableError()));
    const ref = await newDraft();

    const report = await r.submitter.submit(actorOf(author), ref, KEYS.one);

    expect(report).toEqual({ state: "failed", key: KEYS.one, outcome: "ROUTES_UNAVAILABLE" });
    expect(r.fake.calls).toHaveLength(0);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "draft", content_hash: null });
    expect(await translationRows(ref.entryId)).toEqual([]);
    expect(await opsRows()).toMatchObject([{ kind: "alert.submit_failed", severity: "error", subject_id: ref.entryId, detail: { reason: "routes_unavailable" } }]);
    expect((await auditRows()).filter((a) => a.action === "entry.submitted")).toEqual([{ action: "entry.submitted", outcome: "refused", meta: { reason: "provider_error" } }]);
  });

  it("refuses when the routes do not answer at all (the real wait of the store grace) and does not hang", async () => {
    r.routes(() => new Promise<never>(() => {}));
    const ref = await newDraft();

    const report = await r.submitter.submit(actorOf(author), ref, KEYS.one);

    expect(report).toEqual({ state: "failed", key: KEYS.one, outcome: "ROUTES_UNAVAILABLE" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "draft" });
  });

  it("refuses with SMS_BODY_TOO_LONG, naming a refusal and not the text, when a translation makes a text message body too long", async () => {
    r.behave((call) => (call.lang === "fr" ? { text: GOOD.fr.repeat(14) } : ALL_GOOD(call)));
    const ref = await newDraft();

    const report = await r.submitter.submit(actorOf(author), ref, KEYS.one);

    expect(report).toEqual({ state: "failed", key: KEYS.one, outcome: "SMS_BODY_TOO_LONG" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "draft", content_hash: null });
    expect(await translationRows(ref.entryId)).toEqual([]);
    expect(await opsRows()).toMatchObject([{ kind: "alert.submit_failed", detail: { reason: "sms_body_too_long" } }]);
  });

  it("refuses a draft that cannot be submitted before any translation is paid for: a time that has passed, a closed thread, a key that is not a key", async () => {
    const ref = await newDraft(author, { validUntil: new Date("2026-10-01T16:00:00Z") });
    clock = new Date("2026-10-01T17:00:00Z");

    expect(await r.submitter.submit(actorOf(author), ref, KEYS.one)).toEqual({ state: "refused", refusal: "VALID_UNTIL_PAST" });
    expect(await r.submitter.submit(actorOf(author), ref, "short")).toEqual({ state: "refused", refusal: "SUBMIT_KEY_INVALID" });
    clock = NOW;
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
    expect(await r.submitter.submit(actorOf(author), ref, KEYS.two)).toEqual({ state: "refused", refusal: "ALERT_CLOSED" });
    expect(r.fake.calls).toHaveLength(0);
    expect(await attempts(ref.entryId)).toEqual([]);
  });

  it("is for the entry's editors: someone who never changed it, a Director and an Ambassador are refused", async () => {
    const ref = await newDraft();

    expect(await r.submitter.submit(actorOf(approver), ref, KEYS.one)).toEqual({ state: "refused", refusal: "OUT_OF_SCOPE" });
    expect(await r.submitter.submit(actorOf(director), ref, KEYS.one)).toEqual({ state: "refused", refusal: "OUT_OF_SCOPE" });
    // An Ambassador's post is attributed to their building and not yet verified (E08): not through these texts, which say "from the Hub".
    expect(await r.submitter.submit(actorOf(ambassador), ref, KEYS.one)).toEqual({ state: "refused", refusal: "NOT_ALLOWED" });
    expect(await attempts(ref.entryId)).toEqual([]);
  });

  it("returns an attempt only to the person who pressed it", async () => {
    const ref = await submitted();

    expect(await r.submitter.submit(actorOf(editor), ref, KEYS.one)).toEqual({ state: "refused", refusal: "OUT_OF_SCOPE" });
  });
});

// --- the possible duplicate ------------------------------------------------------------------------------------------

describe("a possible duplicate", () => {
  /** An approved or pending entry of another thread, written by the use cases. */
  async function otherThread(over: Partial<EntryContent>, options: { drill?: boolean } = {}): Promise<EntryRef> {
    const ref = await newDraft(editor, over, options.drill === true);
    const report = await r.submitter.submit(actorOf(editor), ref, `0190b000-0000-7000-8000-${randomBytes(6).toString("hex")}`);
    if (report.state !== "committed") throw new Error(`other thread did not submit: ${JSON.stringify(report)}`);
    return ref;
  }

  it("is the open thread that overlaps in audience and type, frozen with the submit, so the approver is shown a link to it", async () => {
    const other = await otherThread(content());
    const mine = await submitted(author);

    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBe(other.alertId);
    expect((await r.submitter.state(mine))?.entry.possibleDuplicateOf).toBe(other.alertId);
    expect((await entryRow(other.entryId)).possible_duplicate_of).toBeNull();
  });

  it("sees a neighbourhood alert over a building in it, and not a thread of another type, another place, a drill or a closed thread", async () => {
    await otherThread(content({ types: ["water"], audience: buildingAudience(["water"]) }));
    await otherThread(content({ audience: buildingAudience(["power"], FP_RSN) }));
    await otherThread(content(), { drill: true });
    const closed = await otherThread(content({ audience: buildingAudience(["power"], OTHER_RSN) }));
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${closed.alertId}`;
    const wide = await otherThread(content({ audience: neighbourhoodAudience(["TP"]) }));

    const mine = await submitted(author);

    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBe(wide.alertId);
  });

  it("is none when nothing overlaps, and is not set on a drill", async () => {
    await otherThread(content({ audience: buildingAudience(["power"], FP_RSN) }));
    const mine = await submitted(author);
    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBeNull();

    await otherThread(content());
    const drill = await newDraft(author, {}, true);
    expect((await r.submitter.submit(actorOf(author), drill, KEYS.three)).state).toBe("committed");
    expect((await entryRow(drill.entryId)).possible_duplicate_of).toBeNull();
  });

  it("is cleared when the entry returns to draft, worked out again at the next submit, and cannot be set on a draft or changed while pending", async () => {
    const other = await otherThread(content());
    const mine = await submitted(author);
    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBe(other.alertId);

    await expect(owner`update alert_entry set possible_duplicate_of = null where id = ${mine.entryId}`).rejects.toThrow(/cannot be changed|changes only when/);
    expect((await alerting.returnEntry(actorOf(author), mine, "edit")).ok).toBe(true);
    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBeNull();
    await expect(owner`update alert_entry set possible_duplicate_of = ${other.alertId} where id = ${mine.entryId}`).rejects.toThrow();
    expect(await r.submitter.submit(actorOf(author), mine, KEYS.two)).toMatchObject({ state: "committed" });
    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBe(other.alertId);
    await expect(owner`update alert_entry set possible_duplicate_of = ${mine.alertId} where id = ${mine.entryId}`).rejects.toThrow();
  });

  it("is held by the entry's guard through every transition: a return to draft must clear it, and a discard must keep it", async () => {
    const other = await otherThread(content());
    const mine = await submitted(author);
    expect((await entryRow(mine.entryId)).possible_duplicate_of).toBe(other.alertId);

    // A return to draft that leaves the link behind is refused.
    await expect(
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
        await tx`update alert_entry set status = 'draft', returned_for = 'edit', content_hash = null, sms_bodies = null, submitted_at = null where id = ${mine.entryId}`;
      }),
    ).rejects.toThrow(/possible-duplicate link/);
    // A discard that changes the link is refused; one that keeps it goes through.
    await expect(
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
        await tx`update alert_entry set status = 'discarded', possible_duplicate_of = null where id = ${mine.entryId}`;
      }),
    ).rejects.toThrow(/discarding changes nothing else/);
    expect(await entryRow(mine.entryId)).toMatchObject({ status: "pending_approval", possible_duplicate_of: other.alertId });
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
      await tx`update alert_entry set status = 'discarded' where id = ${mine.entryId}`;
    });
    expect(await entryRow(mine.entryId)).toMatchObject({ status: "discarded", possible_duplicate_of: other.alertId });
  });
});

// --- Try translation again ---------------------------------------------------------------------------------------------

describe("Try translation again", () => {
  it("returns the pending entry to draft, adds the person as an editor, translates again and re-submits as version 2 with a new hash; they can no longer approve it", async () => {
    r.behave((call) => (call.lang === "ta" ? { error: true } : ALL_GOOD(call)));
    const ref = await submitted(author);
    const before = await entryRow(ref.entryId);
    expect((await translationRows(ref.entryId)).filter((row) => row.status === "fallback_en").map((row) => row.lang)).toEqual(["ta"]);
    r.behave(ALL_GOOD);

    const report = await r.submitter.retranslate(actorOf(approver), ref, KEYS.two, { version: 1, contentHash: before.content_hash });

    expect(report).toEqual({ state: "committed", key: KEYS.two, outcome: null });
    const after = await entryRow(ref.entryId);
    expect(after).toMatchObject({ status: "pending_approval", version: 2 });
    expect(after.content_hash).not.toBe(before.content_hash);
    expect(after.editor_ids).toContain(approver.id);
    expect((await translationRows(ref.entryId)).filter((row) => row.status === "fallback_en")).toEqual([]);
    expect(await alerting.approveEntry(actorOf(approver), ref, { version: 2, contentHash: after.content_hash })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect((await attempts(ref.entryId)).map((a) => [a.kind, a.state])).toEqual([["submit", "committed"], ["retranslate", "committed"]]);
    expect(await pendingCount(ref.alertId)).toBe(1);
  });

  it("refuses an entry that is not the version the person saw, or not pending, and changes nothing", async () => {
    const ref = await submitted(author);
    const row = await entryRow(ref.entryId);

    expect(await r.submitter.retranslate(actorOf(approver), ref, KEYS.two, { version: 1, contentHash: sha("old") })).toEqual({ state: "refused", refusal: "ENTRY_CHANGED" });
    expect(await r.submitter.retranslate(actorOf(director), ref, KEYS.two, { version: 1, contentHash: row.content_hash })).toEqual({ state: "refused", refusal: "NOT_ALLOWED" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval", version: 1, content_hash: row.content_hash });
    const draft = await newDraft(author);
    expect(await r.submitter.retranslate(actorOf(author), draft, KEYS.three, { version: 0, contentHash: sha("x") })).toEqual({ state: "refused", refusal: "ENTRY_NOT_PENDING" });
  });

  it("leaves a draft the person is an editor of, with Submit still there, when the translation cannot be made", async () => {
    const ref = await submitted(author);
    const row = await entryRow(ref.entryId);
    r.routes(() => Promise.reject(new AlertRoutesUnavailableError()));

    const report = await r.submitter.retranslate(actorOf(approver), ref, KEYS.two, { version: 1, contentHash: row.content_hash });

    expect(report).toEqual({ state: "failed", key: KEYS.two, outcome: "ROUTES_UNAVAILABLE" });
    const after = await entryRow(ref.entryId);
    expect(after).toMatchObject({ status: "draft", content_hash: null, returned_for: "retranslate" });
    expect(after.editor_ids).toContain(approver.id);
    r.routes(() => readTranslationRoutes(app));
    expect(await r.submitter.submit(actorOf(approver), ref, KEYS.three)).toMatchObject({ state: "committed" });
    expect((await entryRow(ref.entryId)).version).toBe(2);
  });
});

// --- the attempt table's own rules, against direct SQL -----------------------------------------------------------------

describe("the attempt table, against direct SQL with the app's credentials", () => {
  /** Direct SQL with the app's credentials: one transaction, the acting account set the way a use case sets it. */
  const asApp = async <T>(actor: string | null, run: (tx: postgres.TransactionSql) => PromiseLike<T>): Promise<T> =>
    appSql.begin(async (tx) => {
      if (actor !== null) await tx`select set_config('cvh.actor_id', ${actor}, true)`;
      return await run(tx);
    }) as Promise<T>;

  it("has row level security on, nothing for anon, authenticated or service_role, and only cvh_app's column-level update", async () => {
    const [info] = await owner`select relrowsecurity as rls from pg_class where oid = 'public.alert_submit_attempt'::regclass`;
    expect(info.rls).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [grants] = await owner`select count(*) as n from information_schema.role_table_grants where table_name = 'alert_submit_attempt' and grantee = ${role}`;
      expect(Number(grants.n), role).toBe(0);
    }
    const updatable = await owner`select column_name from information_schema.column_privileges where table_name = 'alert_submit_attempt' and grantee = 'cvh_app' and privilege_type = 'UPDATE' order by column_name`;
    expect(updatable.map((row) => row.column_name)).toEqual(["budget_ms", "finished_at", "outcome", "progress", "result_hash", "result_version", "state"]);
  });

  it("starts an attempt running, as the acting account only, and lets one run per entry", async () => {
    const ref = await newDraft();
    const insert = (actor: string | null, who: string, key: string) => asApp(actor, (tx) => tx`insert into alert_submit_attempt (entry_id, key, actor_id) values (${ref.entryId}, ${key}, ${who})`);

    await expect(insert(null, author.id, KEYS.one)).rejects.toThrow(/acting account/);
    await expect(insert(editor.id, author.id, KEYS.one)).rejects.toThrow(/acting account/);
    await expect(insert(author.id, author.id, "short")).rejects.toThrow(/alert_submit_attempt_key_format/);
    await insert(author.id, author.id, KEYS.one);
    await expect(insert(author.id, author.id, KEYS.two)).rejects.toThrow(/alert_submit_attempt_one_running/);
    await expect(insert(author.id, author.id, KEYS.one)).rejects.toThrow(/duplicate key/);
    const states = await owner`select state, finished_at from alert_submit_attempt where entry_id = ${ref.entryId}`;
    expect(states).toHaveLength(1);
    expect(states[0].finished_at).toBeNull();
  });

  it("ends an attempt once, with the database's clock, keeps what identifies it, and then never changes it", async () => {
    const ref = await newDraft();
    await asApp(author.id, (tx) => tx`insert into alert_submit_attempt (entry_id, key, actor_id) values (${ref.entryId}, ${KEYS.one}, ${author.id})`);

    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set key = ${KEYS.two} where entry_id = ${ref.entryId}`)).rejects.toThrow(/what identifies an attempt|permission denied/);
    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set actor_id = ${editor.id} where entry_id = ${ref.entryId}`)).rejects.toThrow(/permission denied/);
    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set state = 'failed' where entry_id = ${ref.entryId}`)).rejects.toThrow(/alert_submit_attempt_outcome_consistent/);
    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set state = 'committed', result_version = 1 where entry_id = ${ref.entryId}`)).rejects.toThrow(/alert_submit_attempt_result_consistent/);
    await asApp(author.id, (tx) => tx`update alert_submit_attempt set progress = progress || '{"ur": "translated"}'::jsonb where entry_id = ${ref.entryId}`);
    await asApp(author.id, (tx) => tx`update alert_submit_attempt set state = 'failed', outcome = 'DRAFT_CHANGED', finished_at = '2000-01-01' where entry_id = ${ref.entryId}`);
    const [ended] = await owner`select finished_at, state from alert_submit_attempt where entry_id = ${ref.entryId}`;
    expect(ended.state).toBe("failed");
    expect(new Date(ended.finished_at).getFullYear()).toBeGreaterThanOrEqual(2026);
    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set progress = '{}'::jsonb where entry_id = ${ref.entryId}`)).rejects.toThrow(/is a record and never changes/);
    await expect(asApp(author.id, (tx) => tx`update alert_submit_attempt set state = 'running', outcome = null where entry_id = ${ref.entryId}`)).rejects.toThrow();
  });
});

describe("what the translation table now holds", () => {
  it("refuses a status that disagrees with its machine flag or model, and a conversion on any text but a converted one", async () => {
    const ref = await newDraft();
    const source = sha(ENGLISH_ALERT);
    const insert = (lang: string, status: string, machine: boolean, model: string | null, conversion: Record<string, string> | null) =>
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
        await tx`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash, conversion)
                 values (${ref.entryId}, ${lang}, 'b', ${machine}, ${model}, ${status}, ${source}, ${conversion === null ? null : tx.json(conversion)})`;
      });
    // Refused by the named check: the failure says which one refused when it is another.
    const refusedBy = async (attempt: Promise<unknown>, name: string) => {
      const message = await attempt.then(
        () => "accepted",
        (error: Error) => error.message,
      );
      expect(message).toContain(name);
    };
    const consistent = "alert_entry_translation_status_consistent";
    const shaped = "alert_entry_translation_conversion_shape";
    const record = { from: "zh", from_text_hash: sha("zh"), opencc_version: "1.4.2", config: "c" };

    await refusedBy(insert("ur", "fallback_en", true, null, null), consistent);
    await refusedBy(insert("ur", "fallback_en", false, "m", null), consistent);
    await refusedBy(insert("ur", "translated", false, "m", null), consistent);
    await refusedBy(insert("ur", "translated", true, null, null), consistent);
    await refusedBy(insert("ur", "translated", true, "m", record), shaped);
    await refusedBy(insert("zh-Hant", "script_converted", true, "opencc-js 1.4.2", null), shaped);
    await refusedBy(insert("zh-Hant", "script_converted", true, "opencc-js 1.4.2", { ...record, from: "en" }), shaped);
    await refusedBy(insert("zh-Hant", "script_converted", true, "opencc-js 1.4.2", { ...record, from_text_hash: "nothash" }), shaped);
    await refusedBy(insert("zh-Hant", "script_converted", true, "opencc-js 1.4.2", { ...record, opencc_version: "" }), shaped);
    // The three kinds the mapper makes are what the table accepts.
    const accepted: [string, string, boolean, string | null, Record<string, string> | null][] = [
      ["ur", "translated", true, "m", null],
      ["ps", "fallback_en", false, null, null],
      ["zh-Hant", "script_converted", true, "opencc-js 1.4.2", record],
    ];
    for (const [lang, status, machine, model, conversion] of accepted) await insert(lang, status, machine, model, conversion);
    expect((await translationRows(ref.entryId)).map((row) => row.status).sort()).toEqual(["fallback_en", "script_converted", "translated"]);
  });
});
