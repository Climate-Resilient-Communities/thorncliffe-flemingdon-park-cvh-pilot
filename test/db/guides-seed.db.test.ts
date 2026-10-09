// The guides and essential numbers seed against a real database (S02.09): idempotent upsert,
// the refusals, and the seed.run audit inside the seed's transaction.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record } from "@/modules/audit";
import { readContentCatalogue, SeedRefusedError, seedGuidesAndNumbers } from "@/modules/directory";
import { sourceHash } from "@/modules/directory/adapters/hash";
import {
  englishReviewHash,
  guideKey,
  guideTexts,
  numberKey,
  numberTexts,
  type ContentInput,
  type TranslationRecord,
} from "@/modules/directory/domain/guideContent";
import { createDb, type Db } from "@/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

// The real audit module (S01.04) writes audit_event; the spy only lets one test make it fail.
vi.mock("@/modules/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/audit")>();
  return { ...actual, record: vi.fn(actual.record) };
});

const WHEN_911 = "Call 911 if someone is in danger.";
const TODAY = "2026-12-01";

/** Records the owner's English review hash on every guide and the numbers list that has none yet (the owner's sign-off). */
function stamp(input: ContentInput): ContentInput {
  for (const g of input.guides) {
    if (g.englishReview && g.englishReview.sourceHash === undefined) {
      const texts = Object.fromEntries(Object.entries(guideTexts(g)).map(([k, v]) => [guideKey(g.id, k), v]));
      g.englishReview.sourceHash = englishReviewHash(texts, sourceHash);
    }
  }
  const review = input.numbers.englishReview;
  if (review && review.sourceHash === undefined) {
    const texts = Object.fromEntries(
      input.numbers.numbers.flatMap((n) => Object.entries(numberTexts(n)).map(([k, v]) => [numberKey(n.id, k), v])),
    );
    review.sourceHash = englishReviewHash(texts, sourceHash);
  }
  return input;
}

function validInput(): ContentInput {
  const attribution = () => ({ owner: "Ana Reyes", lastUpdated: "2026-10-02", englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" } });
  const guide = (id: string) => ({
    id,
    ...attribution(),
    readMins: 3,
    title: `Title of ${id}`,
    when911: WHEN_911,
    before: ["Keep a flashlight."],
    during: ["Use a flashlight."],
    after: ["Plug things back in."],
  });
  return {
    guides: [guide("power"), guide("flood")],
    numbers: {
      ...attribution(),
      numbers: [
        { id: "911", number: "911", emergency: true, label: "Emergency", when: "Call 911 right now.", lastChecked: "2026-10-03" },
        { id: "hub", number: "(416) 421-8997", label: "Talk to someone at the Hub", lastChecked: "2026-10-03" },
      ],
    },
    translations: {},
  };
}

const reviewed = (english: string, text: string, change: Partial<TranslationRecord> = {}): TranslationRecord => ({
  source: english,
  sourceHash: sourceHash(english),
  text,
  model: "command-a-translate-08-2025",
  status: "reviewed",
  reviewer: "Wei Chen",
  reviewedOn: "2026-11-02",
  ...change,
});

describe("guide and essential_number seed", () => {
  // The migrations enable pg_cron, which Supabase allows only in the `postgres` database, so (like
  // the drift test) this migrates the test server's `postgres` database and empties the tables after.
  let sql: ReturnType<typeof connect>;
  let db: Db;
  const audit = vi.mocked(record);
  const seed = (input: ContentInput) => seedGuidesAndNumbers(db, stamp(input), { today: TODAY });

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    db = createDb(serverUrl());
  });

  afterAll(async () => {
    await sql.unsafe("truncate guide, essential_number");
    await db.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    audit.mockClear();
    await sql.unsafe("truncate guide, essential_number");
  });

  const auditCount = async () =>
    (await sql.unsafe("select count(*)::int as n from audit_event where subject_type = 'guides_and_numbers'"))[0].n as number;
  const expectedMeta = (guides: number, numbers: number) => ({
    seed: "guides_and_numbers",
    counts: {
      guides_loaded: 2,
      guides_refused: 0,
      numbers_loaded: 2,
      rows_changed_guide: guides,
      rows_changed_number: numbers,
      guides_removed: 0,
      numbers_removed: 0,
      translations_loaded: 0,
      translations_not_yet: 15 * 13 - 1,
    },
    warnings: 1,
    failures: 0,
  });

  const auditEvents = async () =>
    (
      await sql.unsafe(
        "select action, outcome, meta from audit_event where subject_type = 'guides_and_numbers' and action = 'seed.run' order by id",
      )
    ).map((e) => ({ ...e }));
  const rows = async () => ({
    guides: await sql.unsafe("select * from guide order by id"),
    numbers: await sql.unsafe("select * from essential_number order by sort_order"),
  });

  it("creates both tables with row level security", async () => {
    const tables = await sql.unsafe(
      "select relname, relrowsecurity as rls from pg_class where relname in ('guide', 'essential_number') and relkind = 'r' order by 1",
    );

    expect(tables.map((t) => ({ ...t }))).toEqual([
      { relname: "essential_number", rls: true },
      { relname: "guide", rls: true },
    ]);
  });

  it("loads the guides and numbers, and running it twice changes nothing", async () => {
    const input = validInput();
    input.translations = {
      zh: { texts: { "guide.power.title": reviewed("Title of power", "停电"), "number.911.when": reviewed("Call 911 right now.", "现在就拨打911") } },
    };

    const first = await seed(input);
    const afterFirst = await rows();
    const second = await seed(input);
    const afterSecond = await rows();

    expect(first.changed).toEqual({ guides: 2, numbers: 2 });
    expect(second.changed).toEqual({ guides: 0, numbers: 0 });
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.guides).toHaveLength(2);
    expect(afterFirst.guides[1]).toMatchObject({
      id: "power",
      read_mins: 3,
      owner: "Ana Reyes",
      english_reviewer: "Ana Reyes",
      texts: { title: { en: "Title of power", zh: "停电" }, when911: { en: WHEN_911 }, "before.0": { en: "Keep a flashlight." } },
      translations: { title: { zh: { status: "reviewed", reviewer: "Wei Chen", reviewedOn: "2026-11-02" } } },
    });
    expect(afterFirst.guides[1].last_updated.toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(afterFirst.numbers[0]).toMatchObject({ id: "911", number: "911", emergency: true, sort_order: 0 });
    expect(afterFirst.numbers[0].texts.when).toEqual({ en: "Call 911 right now.", zh: "现在就拨打911" });
    expect(afterFirst.numbers[1]).toMatchObject({ id: "hub", number: "(416) 421-8997", emergency: false });
  });

  it("audits seed.run in the seed's transaction on every run, with only the allowed meta", async () => {
    const input = validInput();
    input.translations = { ur: { texts: { "guide.power.title": reviewed("Old title", "پرانا") } } };
    const before = await auditCount();

    await seed(input);
    await seed(input);

    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[0][0]).not.toBe(db); // the transaction, not the pool
    const events = await sql.unsafe(
      "select actor_staff_id, action, subject_type, subject_id, outcome, meta from audit_event where subject_type = 'guides_and_numbers' order by id",
    );
    expect(events.slice(before).map((e) => ({ ...e }))).toEqual([
      { actor_staff_id: null, action: "seed.run", subject_type: "guides_and_numbers", subject_id: null, outcome: "ok", meta: expectedMeta(2, 2) },
      { actor_staff_id: null, action: "seed.run", subject_type: "guides_and_numbers", subject_id: null, outcome: "ok", meta: expectedMeta(0, 0) },
    ]);
  });

  it("rolls the rows back when the audit event cannot be recorded", async () => {
    audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const before = await auditCount();

    await expect(seed(validInput())).rejects.toThrow("audit unavailable");

    expect(await rows()).toEqual({ guides: [], numbers: [] });
    expect(await auditCount()).toBe(before);
  });

  it("lets the app's role read the tables and nobody else", async () => {
    await seed(validInput());

    // As the app signs in (S01.04): the login role has no password until the owner sets one;
    // here a throwaway one, on a disposable server.
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    const app = connect(url.href);
    let readable;
    let writeError: unknown;
    try {
      readable = await app.unsafe("select (select count(*)::int from guide) as guides, (select count(*)::int from essential_number) as numbers");
      try {
        await app.unsafe("delete from guide");
      } catch (error) {
        writeError = error;
      }
    } finally {
      await app.end({ timeout: 5 });
      await sql.unsafe("alter role cvh_app_login password null");
    }
    const privileges = await sql.unsafe(`
      select r.rolname, bool_or(has_table_privilege(r.oid, c.oid, 'select, insert, update, delete')) as any_access
      from pg_roles r, pg_class c
      where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname in ('guide', 'essential_number') and c.relkind = 'r'
      group by 1 order by 1`);
    expect({ ...readable[0] }).toEqual({ guides: 2, numbers: 2 });
    expect(privileges.map((p) => ({ ...p }))).toEqual([
      { rolname: "anon", any_access: false },
      { rolname: "authenticated", any_access: false },
      { rolname: "service_role", any_access: false },
    ]);
    expect(String(writeError)).toMatch(/permission denied/);
  });

  it("updates a row when its English or review changes and leaves the other rows alone", async () => {
    await seed(validInput());
    const before = await rows();
    const changed = validInput();
    changed.guides[0].title = "Power cut";

    const result = await seed(changed);

    expect(result.changed).toEqual({ guides: 1, numbers: 0 });
    const after = await rows();
    expect(after.guides[1].texts.title).toEqual({ en: "Power cut" });
    expect(after.guides[0]).toEqual(before.guides[0]);
    expect(after.numbers).toEqual(before.numbers);
  });

  it("does not load a stale or unreviewed translation, and reports it", async () => {
    const input = validInput();
    input.translations = {
      ur: {
        texts: {
          "guide.power.title": reviewed("Old title of power", "پرانا"),
          "guide.power.during.0": reviewed("Use a flashlight.", "ٹارچ", { status: "machine", reviewer: null, reviewedOn: null }),
          "guide.flood.title": reviewed("Title of flood", "سیلاب"),
        },
      },
    };

    const result = await seed(input);

    const { guides } = await rows();
    expect(guides.find((g) => g.id === "power")!.texts.title).toEqual({ en: "Title of power" });
    expect(guides.find((g) => g.id === "power")!.texts["during.0"]).toEqual({ en: "Use a flashlight." });
    expect(guides.find((g) => g.id === "flood")!.texts.title).toEqual({ en: "Title of flood", ur: "سیلاب" });
    expect(result.report.translations.unavailable).toEqual(
      expect.arrayContaining([
        { key: "guide.power.title", lang: "ur", reason: "stale" },
        { key: "guide.power.during.0", lang: "ur", reason: "machine" },
      ]),
    );
  });

  it("refuses a guide without an owner and leaves its existing row as it was", async () => {
    await seed(validInput());
    const before = await rows();
    const input = validInput();
    input.guides[0].owner = null;
    input.guides[0].title = "Changed but refused";
    input.guides[1].englishReview = { reviewer: "Ana Reyes", date: null };

    const result = await seed(input);

    expect(result.partial).toBe(true);
    expect(result.report.guides).toEqual([
      { id: "power", loaded: false, reasons: ["no owner is named"] },
      { id: "flood", loaded: false, reasons: ["the English review has no valid date"] },
    ]);
    expect((await rows()).guides).toEqual(before.guides);
    // the numbers were loaded, so this is an ok run that counts the two refused guides
    const last = (await auditEvents()).at(-1);
    expect(last).toMatchObject({ outcome: "ok", meta: { failures: 2, counts: { guides_refused: 2, numbers_loaded: 2 } } });
  });

  it("deletes the guides and numbers that left the files, in one run, and keeps sort_order consistent", async () => {
    const withExtras = () => {
      const input = validInput();
      input.guides.push({ ...input.guides[0], id: "hydro", title: "Title of hydro", englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" } });
      input.numbers.numbers.splice(1, 0, { id: "smoke", number: "416-555-0100", label: "Smoke alarm help", lastChecked: "2026-10-03" });
      return input;
    };
    await seed(withExtras());
    expect((await rows()).numbers.map((n) => [n.id, n.sort_order])).toEqual([["911", 0], ["smoke", 1], ["hub", 2]]);
    expect((await rows()).guides.map((g) => g.id)).toEqual(["flood", "hydro", "power"]);

    const input = withExtras();
    input.guides = input.guides.filter((g) => g.id !== "hydro");
    input.numbers.numbers = input.numbers.numbers.filter((n) => n.id !== "smoke");
    const result = await seed(input);

    const after = await rows();
    expect(after.guides.map((g) => g.id)).toEqual(["flood", "power"]);
    expect(after.numbers.map((n) => [n.id, n.sort_order])).toEqual([["911", 0], ["hub", 1]]);
    expect(result.removed).toEqual({ guides: 1, numbers: 1 });
    expect(result.changed).toEqual({ guides: 0, numbers: 1 }); // hub moved up
    expect((await auditEvents()).at(-1)).toMatchObject({ meta: { counts: { guides_removed: 1, numbers_removed: 1 } } });
    expect((await seed(input)).removed).toEqual({ guides: 0, numbers: 0 });
  });

  it("never deletes a guide that is in the file but refused, nor any number while the list is refused", async () => {
    await seed(validInput());
    const before = await rows();
    const input = validInput();
    input.guides[0].owner = null; // power is in the file but refused
    input.guides.splice(1, 1, { ...input.guides[1], id: "hydro", englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" } }); // flood left the file, hydro is new
    input.numbers.numbers = [input.numbers.numbers[0]]; // hub left the file ...
    input.numbers.numbers[0].lastChecked = null; // ... but the list is refused

    const result = await seed(input);

    expect(result.removed).toEqual({ guides: 1, numbers: 0 });
    const after = await rows();
    expect(after.guides.map((g) => g.id)).toEqual(["hydro", "power"]);
    expect(after.guides.find((g) => g.id === "power")).toEqual(before.guides.find((g) => g.id === "power"));
    expect(after.numbers).toEqual(before.numbers);
  });

  it("refuses the numbers list when a number has no last-checked date", async () => {
    const input = validInput();
    input.numbers.numbers[1].lastChecked = undefined;

    const result = await seed(input);

    expect(result.report.numbers).toEqual({ loaded: false, reasons: ["number hub has no valid last-checked date"] });
    const loaded = await rows();
    expect(loaded.numbers).toEqual([]);
    expect(loaded.guides).toHaveLength(2);
  });

  it.each([
    ["the 911 number is missing", (i: ContentInput) => void (i.numbers.numbers = i.numbers.numbers.slice(1))],
    ["a guide has no 'when to call 911' text", (i: ContentInput) => void (i.guides[1].when911 = "")],
    [
      "a translation of a 911 text is blank",
      (i: ContentInput) => void (i.translations = { fr: { texts: { "number.911.when": { ...reviewed("Call 911 right now.", "x"), text: "" } } } }),
    ],
  ])("refuses the whole run, writes nothing and audits the refusal when %s", async (_, break911) => {
    const input = validInput();
    break911(input);
    const before = await auditEvents();

    await expect(seed(input)).rejects.toBeInstanceOf(SeedRefusedError);

    expect(await rows()).toEqual({ guides: [], numbers: [] });
    expect(audit).not.toHaveBeenCalled(); // no ok record: the refusal has its own
    expect((await auditEvents()).slice(before.length)).toEqual([
      { action: "seed.run", outcome: "refused", meta: { seed: "guides_and_numbers", failures: 1 } },
    ]);
  });

  it("loads every guide and the numbers from the committed catalogue, now that the owner signed them off (2026-10-08)", async () => {
    const before = await auditEvents();

    const result = await seedGuidesAndNumbers(db, readContentCatalogue(path.join(ROOT, "data", "catalogue")));

    expect(result.report.guides.map((g) => [g.id, g.loaded, g.reasons])).toEqual(result.report.guides.map((g) => [g.id, true, []]));
    expect(result.report.guides).toHaveLength(6);
    expect(result.report.numbers.loaded).toBe(true);
    const loaded = await rows();
    expect(loaded.guides).toHaveLength(6);
    expect(loaded.numbers).toHaveLength(5);
    // a complete run is audited as ok, never as refused
    expect((await auditEvents()).slice(before.length)).toMatchObject([{ action: "seed.run", outcome: "ok" }]);
  });
});
