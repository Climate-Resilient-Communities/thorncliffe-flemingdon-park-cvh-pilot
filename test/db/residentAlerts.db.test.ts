// What residents may read of the alerts (S04.08, AD-6, AD-17) against a real database, read as the app's own role
// (cvh_app_login): the three resident views and the feed built from them. A drill's thread is inserted DIRECTLY (as a
// migration owner would, with the lifecycle's triggers off) and must appear nowhere; so must an entry that is not
// web-published, a thread that is closed, and everything a resident has no business seeing.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { ARCHIVE_PAGE_SIZE, ArchiveThreadSchema, ArchiveV1, FeedV1 } from "../../src/contracts/feed";
import { LANG_CODES, type LangCode } from "../../src/contracts/lang";
import { createArchive, createFeed } from "../../src/modules/alerting";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const NOW = new Date("2026-10-01T15:00:00Z");
const RSN = "4154301";

const AUDIENCE = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: ["power"] };
const TEXT = "Power is out in 88 Test Dr. We are on it.";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let author: string;
let approver: string;
const madeNeighbourhoods: string[] = [];

type EntryStatus = "draft" | "pending_approval" | "approved" | "superseded" | "discarded";
interface SeedEntry {
  status?: EntryStatus;
  kind?: string;
  phase?: string;
  text?: string;
  /** Null: not web-published. Default: the approval time of an approved entry, none otherwise. */
  publishedAt?: Date | null;
  validUntil?: Date;
  translations?: Record<string, { body: string; status: "translated" | "fallback_en" | "script_converted"; model?: string | null }>;
}

async function seedThread(opts: { drill?: boolean; closed?: boolean; closedReason?: "resolved" | "expired" | "withdrawn"; closedAt?: Date; slug: string; entries: SeedEntry[] }): Promise<{ alertId: string; entryIds: string[] }> {
  const alertId = randomUUID();
  await owner.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${author}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, ${opts.drill ?? false}, ${new Date(NOW.getTime() - 3_600_000)}, ${author}, ${opts.slug})`;
  });
  const entryIds: string[] = [];
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx.unsafe("alter table alert_entry_translation disable trigger alert_entry_translation_guard");
    for (const [index, entry] of opts.entries.entries()) {
      const id = randomUUID();
      entryIds.push(id);
      const status = entry.status ?? "approved";
      const frozen = status === "pending_approval" || status === "approved" || status === "superseded";
      const approved = status === "approved" || status === "superseded";
      const text = entry.text ?? TEXT;
      const published = entry.publishedAt === undefined ? (approved ? new Date(NOW.getTime() - 60_000 * (10 - index)) : null) : entry.publishedAt;
      const hash = sha(`${id}`);
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until,
                                         version, content_hash, sms_bodies, submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at)
               values (${id}, ${alertId}, ${entry.kind ?? "ack"}, ${status}, ${author}, ${[author]}, ${text}, ${["power"]}, ${tx.json(AUDIENCE)}, ${entry.phase ?? "problem"},
                       ${entry.validUntil ?? new Date("2026-10-02T15:00:00Z")}, ${frozen ? 1 : 0}, ${frozen ? hash : null}, ${frozen ? tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } }) : null},
                       ${frozen ? NOW : null}, ${approved ? approver : null}, ${approved ? NOW : null}, ${approved ? 1 : null}, ${approved ? hash : null}, ${published})`;
      for (const [lang, t] of Object.entries(entry.translations ?? {})) {
        const model = t.model === undefined ? (t.status === "fallback_en" ? null : "north-small-translate-09-2026") : t.model;
        const conversion = t.status === "script_converted" ? tx.json({ from: "zh", from_text_hash: sha("zh text"), opencc_version: "1.4.2", config: "cn2t" }) : null;
        await tx`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash, conversion)
                 values (${id}, ${lang}, ${t.body}, ${t.status !== "fallback_en"}, ${model}, ${t.status}, ${sha(text)}, ${conversion})`;
      }
    }
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    await tx.unsafe("alter table alert_entry_translation enable trigger alert_entry_translation_guard");
  });
  if (opts.closed || opts.closedReason) {
    // The alert's guard sets `closed_at` to the closing time itself; a test that names the time switches it off for the one statement, as a migration owner could.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = ${opts.closedReason ?? "resolved"}, closed_at = ${opts.closedAt ?? new Date()} where id = ${alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });
  }
  return { alertId, entryIds };
}

const URDU = { ur: { body: "بجلی بند ہے۔", status: "translated" as const } };

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
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
  for (const role of ["author", "approver"]) {
    const id = randomUUID();
    await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
                values (${id}, ${randomUUID()}, ${`ra_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', 'coordinator', false)`;
    if (role === "author") author = id;
    else approver = id;
  }
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', '88 Test Dr', 43.7, -79.34, now())`;
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const id of [author, approver]) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const id of [author, approver]) await tx`delete from staff_account where id = ${id}`;
  });
  await owner`delete from building where rsn = ${RSN}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(clear);

const feed = (lang: LangCode = "en", alertsEnabled = true) => createFeed({ db: app, alertsEnabled, now: () => NOW }).read(lang);
const archive = (lang: LangCode = "en", page = 1, alertsEnabled = true) => createArchive({ db: app, alertsEnabled, now: () => NOW }).read(lang, page);
const asApp = <T,>(run: (sql: postgres.Sql) => PromiseLike<T>) => run(appSql);

describe("the feed's threads, read as the app's role from the resident views", () => {
  it("lists an open thread with a web-published, approved entry: its text in the language asked for, the English original, the Hub as attribution, verification and the publication time", async () => {
    const { alertId, entryIds } = await seedThread({ slug: "kbcdfghj", entries: [{ translations: URDU, publishedAt: new Date("2026-10-01T14:30:00Z") }] });

    const answer = await feed("ur");

    expect(FeedV1.parse(answer)).toEqual(answer);
    expect(answer.threads).toEqual([
      {
        id: alertId,
        slug: "kbcdfghj",
        types: ["power"],
        audience: AUDIENCE,
        state: "open",
        valid_until: "2026-10-02T15:00:00.000Z",
        entries: [
          {
            id: entryIds[0],
            kind: "ack",
            phase: "problem",
            verified: true,
            attribution: { role: "hub" },
            published_at: "2026-10-01T14:30:00.000Z",
            text: { lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: sha(TEXT) },
            original: { lang: "en", body: TEXT },
          },
        ],
      },
    ]);
  });

  it("gives English its own text as the source, and a language whose translation failed the English with fallback_en in the language asked for", async () => {
    await seedThread({ slug: "kbcdfghj", entries: [{ translations: { ps: { body: TEXT, status: "fallback_en" }, ur: URDU.ur } }] });

    expect((await feed("en")).threads[0].entries[0].text).toMatchObject({ lang: "en", body: TEXT, status: "source", machine: false, model: null });
    expect((await feed("ps")).threads[0].entries[0].text).toEqual({ lang: "ps", body: TEXT, machine: false, model: null, status: "fallback_en", source_hash: sha(TEXT) });
    // A language the entry has no frozen text for (a set that was never whole) reads as English too, never as another language's text.
    expect((await feed("ta")).threads[0].entries[0].text).toMatchObject({ lang: "ta", body: TEXT, status: "fallback_en" });
  });

  it("serves zh-Hant as the converted text, naming the conversion as its model", async () => {
    await seedThread({ slug: "kbcdfghj", entries: [{ translations: { "zh-Hant": { body: "停電了。", status: "script_converted", model: "opencc-js 1.4.2" } } }] });

    expect((await feed("zh-Hant")).threads[0].entries[0].text).toMatchObject({ lang: "zh-Hant", body: "停電了。", status: "script_converted", model: "opencc-js 1.4.2", machine: true });
  });

  it("answers every language with a valid feed", async () => {
    await seedThread({ slug: "kbcdfghj", entries: [{ translations: URDU }] });

    for (const lang of LANG_CODES) {
      const answer = await feed(lang);
      expect(FeedV1.safeParse(answer).success, lang).toBe(true);
      expect(answer.threads).toHaveLength(1);
    }
  });

  it("tells no one about a drill thread inserted directly with an approved, web-published entry and its translations", async () => {
    await seedThread({ slug: "drillslug", drill: true, entries: [{ text: "EXERCISE: Power is out in 88 Test Dr.", translations: URDU }] });
    const real = await seedThread({ slug: "realslug1", entries: [{ translations: URDU }] });

    for (const lang of ["en", "ur"] as const) {
      const answer = await feed(lang);
      expect(answer.threads.map((thread) => thread.id), lang).toEqual([real.alertId]);
      expect(JSON.stringify(answer), lang).not.toMatch(/drillslug|EXERCISE/);
    }
  });

  it("tells no one about a thread that has no web-published entry: a draft, a pending entry, a returned or discarded one", async () => {
    await seedThread({ slug: "draftslug", entries: [{ status: "draft" }] });
    await seedThread({ slug: "pendslug1", entries: [{ status: "pending_approval", publishedAt: null }] });
    await seedThread({ slug: "discslug1", entries: [{ status: "discarded" }] });
    await seedThread({ slug: "mixedslug", entries: [{ status: "draft" }, { status: "pending_approval", publishedAt: null }] });

    expect((await feed("en")).threads).toEqual([]);
  });

  it("lists only the published entries of a thread that also has a draft update in the works", async () => {
    const { entryIds } = await seedThread({ slug: "kbcdfghj", entries: [{}, { status: "draft", kind: "update", text: "DRAFT update, not approved" }] });

    const [thread] = (await feed("en")).threads;

    expect(thread.entries.map((entry) => entry.id)).toEqual([entryIds[0]]);
    expect(JSON.stringify(await feed("en"))).not.toContain("DRAFT update");
  });

  it("lists a web-published entry still waiting for approval as not verified (the D-1 case E08 adds), and an approved one as verified", async () => {
    await seedThread({ slug: "d1slug001", entries: [{ status: "pending_approval", publishedAt: new Date("2026-10-01T14:00:00Z") }] });
    await seedThread({ slug: "hubslug01", entries: [{}] });

    const bySlug = Object.fromEntries((await feed("en")).threads.map((thread) => [thread.slug, thread.entries[0].verified]));

    expect(bySlug).toEqual({ d1slug001: false, hubslug01: true });
  });

  it("lists open threads only: a closed thread is not in the live feed", async () => {
    await seedThread({ slug: "closedslug", closed: true, entries: [{}] });
    const open = await seedThread({ slug: "openslug01", entries: [{}] });

    expect((await feed("en")).threads.map((thread) => thread.id)).toEqual([open.alertId]);
  });

  it("orders entries by publication and threads by their newest activity", async () => {
    const older = await seedThread({ slug: "olderslug", entries: [{ publishedAt: new Date("2026-10-01T13:00:00Z") }] });
    const newer = await seedThread({
      slug: "newerslug",
      entries: [
        { publishedAt: new Date("2026-10-01T12:00:00Z"), text: "first" },
        { kind: "update", phase: "in_progress", publishedAt: new Date("2026-10-01T14:00:00Z"), text: "second" },
      ],
    });

    const answer = await feed("en");

    expect(answer.threads.map((thread) => thread.id)).toEqual([newer.alertId, older.alertId]);
    expect(answer.threads[0].entries.map((entry) => [entry.kind, entry.phase, entry.text.body])).toEqual([
      ["ack", "problem", "first"],
      ["update", "in_progress", "second"],
    ]);
  });

  it("tells no one about any alert while RESIDENT_ALERTS_ENABLED is off, though one is approved and published (production until E05)", async () => {
    await seedThread({ slug: "kbcdfghj", entries: [{ translations: URDU }] });

    const off = await feed("ur", false);

    expect(off.threads).toEqual([]);
    expect(FeedV1.parse(off)).toEqual(off);
    expect((await feed("ur", true)).threads).toHaveLength(1);
  });

  it("carries the feed's version and every place whether or not there are threads", async () => {
    await seedThread({ slug: "kbcdfghj", entries: [{}] });

    const answer = await feed("en");

    expect(answer.feed_version).toBe(Number((await owner`select version from feed_version where id = 1`)[0].version));
    expect(answer.places.buildings.map((place) => place.rsn)).toContain(RSN);
  });
});

describe("the resident views", () => {
  it("show a thread, its published entries and their texts to the app's role, and no drill's", async () => {
    const real = await seedThread({ slug: "realslug1", entries: [{ translations: URDU }, { status: "draft", kind: "update" }] });
    const drill = await seedThread({ slug: "drillslug", drill: true, entries: [{ translations: URDU }] });

    expect(await asApp((sql) => sql`select id from nondrill_alert`)).toEqual([{ id: real.alertId }]);
    expect(await asApp((sql) => sql`select id, slug from nondrill_alert_entry`)).toEqual([{ id: real.entryIds[0], slug: "realslug1" }]);
    expect(await asApp((sql) => sql`select id, slug from nondrill_alert_entry_v2`)).toEqual([{ id: real.entryIds[0], slug: "realslug1" }]);
    expect(await asApp((sql) => sql`select entry_id, lang from nondrill_alert_entry_translation`)).toEqual([{ entry_id: real.entryIds[0], lang: "ur" }]);
    for (const view of ["nondrill_alert", "nondrill_alert_entry", "nondrill_alert_entry_v2", "nondrill_alert_entry_translation"]) {
      const column = view === "nondrill_alert" ? "id" : view.startsWith("nondrill_alert_entry") && view !== "nondrill_alert_entry_translation" ? "alert_id" : "entry_id";
      const hidden = view === "nondrill_alert" ? [drill.alertId] : view.startsWith("nondrill_alert_entry") && view !== "nondrill_alert_entry_translation" ? [drill.alertId] : drill.entryIds;
      const rows = await asApp((sql) => sql.unsafe(`select ${column} as k from ${view}`));
      for (const id of hidden) expect(rows.map((row) => row.k), view).not.toContain(id);
    }
    // The drill is really there: only the views leave it out.
    expect((await owner`select count(*)::int as n from alert where is_drill`)[0].n).toBe(1);
  });

  it("show nothing of a thread whose is_drill is set, however its entries are published: an entry is read only through its thread", async () => {
    await seedThread({ slug: "drillslug", drill: true, entries: [{ translations: URDU }, { kind: "update", translations: URDU }] });

    expect(await asApp((sql) => sql`select count(*)::int as n from nondrill_alert_entry`)).toEqual([{ n: 0 }]);
    expect(await asApp((sql) => sql`select count(*)::int as n from nondrill_alert_entry_v2`)).toEqual([{ n: 0 }]);
    expect(await asApp((sql) => sql`select count(*)::int as n from nondrill_alert_entry_translation`)).toEqual([{ n: 0 }]);
  });

  it("run with the caller's rights, and only the app's role may read them", async () => {
    for (const view of ["nondrill_alert", "nondrill_alert_entry", "nondrill_alert_entry_v2", "nondrill_alert_entry_translation"]) {
      const [info] = await owner`select reloptions from pg_class where oid = ${`public.${view}`}::regclass`;
      expect(info.reloptions, view).toContain("security_invoker=true");
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        const [privilege] = await owner.unsafe(`select has_table_privilege('${role}', 'public.${view}', 'select') as ok`);
        expect(privilege.ok, `${role} on ${view}`).toBe(false);
      }
      const [app_] = await owner.unsafe(`select has_table_privilege('cvh_app', 'public.${view}', 'select') as sel, has_table_privilege('cvh_app', 'public.${view}', 'insert, update, delete') as write`);
      expect(app_, view).toEqual({ sel: true, write: false });
    }
  });

  it("show a resident nothing that is not meant for one: no author, editor, approver, hash, SMS text, version or draft state", async () => {
    const columns = async (view: string) => (await owner`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${view} order by ordinal_position`).map((row) => row.column_name);

    // The thread's view is S04.03's, as it was: changing a view the previous release may read is a contract change.
    expect(await columns("nondrill_alert")).toEqual(["id", "status", "closed_reason", "reported_at", "closed_at", "created_at"]);
    // S04.08's entry view is left as it was for the previous release; S05.02's v2 appends the entry a correction or a withdrawal replaces (the reason of a withdrawal is its own text, so no reason code is shown).
    expect(await columns("nondrill_alert_entry")).toEqual(["id", "alert_id", "slug", "kind", "phase", "types", "audience", "valid_until", "original_text", "web_published_at", "verified", "superseded"]);
    expect(await columns("nondrill_alert_entry_v2")).toEqual(["id", "alert_id", "slug", "kind", "phase", "types", "audience", "valid_until", "original_text", "web_published_at", "verified", "superseded", "supersedes_id"]);
    expect(await columns("nondrill_alert_entry_translation")).toEqual(["entry_id", "lang", "body", "machine", "model", "status", "source_hash"]);
  });

  it("leave out an entry that is not web-published whatever its status, and a discarded one", async () => {
    await seedThread({
      slug: "kbcdfghj",
      entries: [
        { status: "approved" },
        { status: "pending_approval", publishedAt: null },
        { status: "draft" },
        { status: "discarded", publishedAt: new Date("2026-10-01T14:00:00Z") },
        { status: "superseded", kind: "update" },
      ],
    });

    const rows = await asApp((sql) => sql`select superseded from nondrill_alert_entry order by web_published_at, id`);

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.superseded)).toHaveLength(1);
  });

  it("do not let the app write through them", async () => {
    await expect(asApp((sql) => sql`update nondrill_alert set status = 'closed'`)).rejects.toThrow(/permission denied/);
    await expect(asApp((sql) => sql`delete from nondrill_alert_entry`)).rejects.toThrow(/permission denied|cannot delete from view/);
    await expect(asApp((sql) => sql`insert into nondrill_alert_entry_translation (entry_id, lang, body, status, source_hash) values (gen_random_uuid(), 'ur', 'x', 'translated', 'x')`)).rejects.toThrow(/permission denied|cannot insert into view/);
  });
});

describe("the archive (S05.07), read as the app's role from the resident views", () => {
  // Distinct, explicit closing times: a page is ordered by them (then by id), never by when the rows happened to be made.
  const closedAt = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);
  const slugOf = (n: number) => `arch${String(n).padStart(4, "0")}`;

  it("lists the closed threads newest closed first, each as the live feed shows a thread, with how and when it closed", async () => {
    const older = await seedThread({ slug: "closedold", closedReason: "expired", closedAt: closedAt(300), entries: [{ translations: URDU }] });
    const newer = await seedThread({ slug: "closednew", closedReason: "resolved", closedAt: closedAt(30), entries: [{ translations: URDU }, { kind: "final", translations: URDU }] });
    const withdrawn = await seedThread({ slug: "closedwdr", closedReason: "withdrawn", closedAt: closedAt(100), entries: [{ translations: URDU }] });

    const answer = await archive("ur");

    expect(ArchiveV1.parse(answer)).toEqual(answer);
    expect(answer).toMatchObject({ v: 1, page: 1, has_more: false, server_now: NOW.toISOString() });
    expect(answer.threads.map((thread) => [thread.slug, thread.close_reason, thread.closed_at])).toEqual([
      ["closednew", "resolved", closedAt(30).toISOString()],
      ["closedwdr", "withdrawn", closedAt(100).toISOString()],
      ["closedold", "expired", closedAt(300).toISOString()],
    ]);
    // Every entry, in the language asked for, with the same fields the live feed gives.
    const [first] = answer.threads;
    expect(first.id).toBe(newer.alertId);
    expect(first.entries.map((entry) => entry.kind)).toEqual(["ack", "final"]);
    expect(first.entries[0].text).toMatchObject({ lang: "ur", body: "بجلی بند ہے۔", status: "ok" });
    expect(older.alertId).not.toBe(withdrawn.alertId);
    for (const thread of answer.threads) expect(ArchiveThreadSchema.safeParse(thread).success).toBe(true);
  });

  it("gives a closed thread exactly the entries it had when live", async () => {
    const live = await seedThread({ slug: "closedlive", entries: [{ translations: URDU }, { kind: "update", phase: "in_progress", translations: URDU }] });
    const before = (await feed("ur")).threads.find((thread) => thread.id === live.alertId)!;
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = ${closedAt(5)} where id = ${live.alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });

    const after = (await archive("ur")).threads[0];

    expect([after.id, after.slug, after.types, after.audience, after.valid_until]).toEqual([before.id, before.slug, before.types, before.audience, before.valid_until]);
    expect(after.entries).toEqual(before.entries);
    expect((await feed("ur")).threads).toEqual([]);
  });

  it(`pages ${ARCHIVE_PAGE_SIZE} to a page with no thread repeated or skipped, and says whether there is a next page`, async () => {
    // 25 threads, two of them closed at the very same time: the order is still total.
    for (let n = 0; n < 25; n += 1) await seedThread({ slug: slugOf(n), closedReason: "resolved", closedAt: closedAt(n === 24 ? 23 : n), entries: [{}] });

    const one = await archive("en", 1);
    const two = await archive("en", 2);
    const three = await archive("en", 3);

    expect(one.threads).toHaveLength(ARCHIVE_PAGE_SIZE);
    expect(one.has_more).toBe(true);
    expect(two.threads).toHaveLength(5);
    expect(two).toMatchObject({ page: 2, has_more: false });
    expect(three).toMatchObject({ page: 3, has_more: false, threads: [] });
    const slugs = [...one.threads, ...two.threads].map((thread) => thread.slug);
    expect(new Set(slugs).size).toBe(25);
    const times = [...one.threads, ...two.threads].map((thread) => Date.parse(thread.closed_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("never lists a drill, an open thread, or a closed thread none of whose entries was published", async () => {
    await seedThread({ slug: "drillslug", drill: true, closedReason: "resolved", closedAt: closedAt(10), entries: [{ text: "EXERCISE: Power is out in 88 Test Dr.", translations: URDU }] });
    await seedThread({ slug: "openslug1", entries: [{ translations: URDU }] });
    await seedThread({ slug: "unpublish", closedReason: "expired", closedAt: closedAt(20), entries: [{ status: "pending_approval", publishedAt: null }] });
    const real = await seedThread({ slug: "realslug1", closedReason: "resolved", closedAt: closedAt(30), entries: [{ translations: URDU }] });

    for (const lang of LANG_CODES) {
      const answer = await archive(lang);
      expect(answer.threads.map((thread) => thread.id), lang).toEqual([real.alertId]);
      expect(JSON.stringify(answer), lang).not.toMatch(/drillslug|EXERCISE|openslug1|unpublish/);
    }
    // The drill is really there and really closed: only the views leave it out.
    expect((await owner`select count(*)::int as n from alert where is_drill and status = 'closed'`)[0].n).toBe(1);
  });

  it("lists nothing while the launch gate is off, and nothing for a page past the last", async () => {
    await seedThread({ slug: "realslug1", closedReason: "resolved", closedAt: closedAt(30), entries: [{}] });

    expect((await archive("en", 1, false)).threads).toEqual([]);
    expect((await archive("en", 2)).threads).toEqual([]);
  });
});
