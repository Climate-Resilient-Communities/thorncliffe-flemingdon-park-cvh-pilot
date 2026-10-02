// The guides and essential numbers seed against a real database (S02.09): idempotent upsert,
// the refusals, and the seed.run audit inside the seed's transaction.
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record } from "@/modules/audit";
import { readContentCatalogue, SeedRefusedError, seedGuidesAndNumbers } from "@/modules/directory";
import { sourceHash, type ContentInput, type TranslationRecord } from "@/modules/directory/domain/guideContent";
import { createDb, type Db } from "@/platform/db";
import { ROOT, connect, serverUrl } from "./helpers";

vi.mock("@/modules/audit", () => ({ record: vi.fn(async () => {}) }));

const WHEN_911 = "Call 911 if someone is in danger.";

function validInput(): ContentInput {
  const attribution = { owner: "Ana Reyes", lastUpdated: "2026-10-02", englishReview: { reviewer: "Ana Reyes", date: "2026-10-03" } };
  const guide = (id: string) => ({
    id,
    ...attribution,
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
      ...attribution,
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

  const rows = async () => ({
    guides: await sql.unsafe("select * from guide order by id"),
    numbers: await sql.unsafe("select * from essential_number order by sort_order"),
  });

  it("creates both tables with row level security and no access for anon or authenticated", async () => {
    const tables = await sql.unsafe(`
      select c.relname, c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('authenticated', c.oid, 'select, insert, update, delete') as authenticated_any
      from pg_class c where c.relname in ('guide', 'essential_number') and c.relkind = 'r' order by 1`);

    expect(tables.map((t) => ({ ...t }))).toEqual([
      { relname: "essential_number", rls: true, anon_select: false, authenticated_any: false },
      { relname: "guide", rls: true, anon_select: false, authenticated_any: false },
    ]);
  });

  it("loads the guides and numbers, and running it twice changes nothing", async () => {
    const input = validInput();
    input.translations = {
      zh: { texts: { "guide.power.title": reviewed("Title of power", "停电"), "number.911.when": reviewed("Call 911 right now.", "现在就拨打911") } },
    };

    const first = await seedGuidesAndNumbers(db, input);
    const afterFirst = await rows();
    const second = await seedGuidesAndNumbers(db, input);
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

  it("audits seed.run in the seed's transaction on every run", async () => {
    const input = validInput();

    await seedGuidesAndNumbers(db, input);
    await seedGuidesAndNumbers(db, input);

    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "seed.run",
        actorStaffId: null,
        subjectType: "guides_and_numbers",
        subjectId: null,
        meta: expect.objectContaining({ guidesLoaded: ["power", "flood"], numbersLoaded: true, rowsChanged: { guides: 0, numbers: 0 } }),
      }),
    );
    expect(audit.mock.calls[0][0]).not.toBe(db); // the transaction, not the pool
  });

  it("rolls the rows back when the audit event cannot be recorded", async () => {
    audit.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(seedGuidesAndNumbers(db, validInput())).rejects.toThrow("audit unavailable");

    expect(await rows()).toEqual({ guides: [], numbers: [] });
  });

  it("updates a row when its English or review changes and leaves the other rows alone", async () => {
    await seedGuidesAndNumbers(db, validInput());
    const before = await rows();
    const changed = validInput();
    changed.guides[0].title = "Power cut";

    const result = await seedGuidesAndNumbers(db, changed);

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

    const result = await seedGuidesAndNumbers(db, input);

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
    await seedGuidesAndNumbers(db, validInput());
    const before = await rows();
    const input = validInput();
    input.guides[0].owner = null;
    input.guides[0].title = "Changed but refused";
    input.guides[1].englishReview = { reviewer: "Ana Reyes", date: null };

    const result = await seedGuidesAndNumbers(db, input);

    expect(result.partial).toBe(true);
    expect(result.report.guides).toEqual([
      { id: "power", loaded: false, reasons: ["no owner is named"] },
      { id: "flood", loaded: false, reasons: ["the English review has no valid date"] },
    ]);
    expect((await rows()).guides).toEqual(before.guides);
  });

  it("refuses the numbers list when a number has no last-checked date", async () => {
    const input = validInput();
    input.numbers.numbers[1].lastChecked = undefined;

    const result = await seedGuidesAndNumbers(db, input);

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
  ])("refuses the whole run and writes nothing when %s", async (_, break911) => {
    const input = validInput();
    break911(input);

    await expect(seedGuidesAndNumbers(db, input)).rejects.toBeInstanceOf(SeedRefusedError);

    expect(await rows()).toEqual({ guides: [], numbers: [] });
    expect(audit).not.toHaveBeenCalled();
  });

  it("loads nothing from the committed catalogue until the owner fills the placeholders", async () => {
    const result = await seedGuidesAndNumbers(db, readContentCatalogue(path.join(ROOT, "data", "catalogue")));

    expect(result.partial).toBe(true);
    expect(result.report.guides.every((g) => !g.loaded && g.reasons.includes("the owner is still a placeholder"))).toBe(true);
    expect(result.report.numbers.loaded).toBe(false);
    expect(result.report.translations.loaded).toBe(0);
    expect(await rows()).toEqual({ guides: [], numbers: [] });
  });
});
