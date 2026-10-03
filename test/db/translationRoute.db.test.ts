// translation_route and translation_cache against a real database (S04.02): the seed from the addendum's routing table, what the app's
// role may do with the two tables, the rules the database holds itself (a route deadline of at most 30 s, one check per language,
// only passing results cached), and the translation use case running on the real stores.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { openccZhHant } from "@/modules/directory";
import { recordSpendEvent } from "@/modules/spend";
import { PROMPT_VERSION, createAlertTranslator, drizzleTranslationCache, readTranslationRoutes } from "@/modules/translation";
import { createDb, type Db } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { ENGLISH_ALERT, GOOD, SEEDED_ROUTES, SEEDED_ROUTE_ROWS } from "../../src/modules/translation/domain/alertFixtures";
import { fakeTranslator } from "../../src/modules/translation/adapters/fakeTranslator";
import { connect, serverUrl } from "./helpers";

const NORTH = "north-small-translate-09-2026";
const COMMAND_A = "command-a-translate-08-2025";
const AYA_FIRE = "tiny-aya-fire";
const AYA_WATER = "tiny-aya-water";

describe("translation_route and translation_cache (S04.02)", () => {
  let sql: ReturnType<typeof connect>;
  let appSql: ReturnType<typeof connect>;
  let app: Db;

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    app = createDb(url.href);
    appSql = connect(url.href);
  });

  afterAll(async () => {
    await sql.unsafe("delete from translation_cache");
    await sql.unsafe("delete from spend_event where purpose = 'alert'");
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  describe("translation_route as seeded", () => {
    it("holds the addendum's routing table: the models of each language in order", async () => {
      const rows = await sql`select lang, string_agg(model, ',' order by position) as models from translation_route group by lang`;

      expect(Object.fromEntries(rows.map((r) => [r.lang, r.models]))).toEqual({
        ps: NORTH,
        prs: `${NORTH},${COMMAND_A}`,
        fr: `${COMMAND_A},${NORTH}`,
        es: `${COMMAND_A},${NORTH}`,
        zh: `${COMMAND_A},${NORTH}`,
        el: `${COMMAND_A},${NORTH}`,
        hi: `${COMMAND_A},${NORTH}`,
        ur: `${NORTH},${AYA_FIRE}`,
        bn: `${NORTH},${AYA_FIRE}`,
        ta: `${NORTH},${AYA_FIRE}`,
        pa: `${NORTH},${AYA_FIRE}`,
        tl: `${NORTH},${AYA_WATER}`,
        sk: `${NORTH},${AYA_WATER}`,
        gu: `${AYA_FIRE},${NORTH}`,
      });
    });

    it("has no route for English, the source, or for zh-Hant, which OpenCC converts from zh", async () => {
      expect(await sql`select 1 from translation_route where lang in ('en', 'zh-Hant')`).toHaveLength(0);
    });

    it("marks every seeded value provisional, with whole-second attempt timeouts of at most 20 s and a route deadline of at most 30 s", async () => {
      expect((await sql`select distinct source from translation_route`).map((r) => r.source)).toEqual(["provisional"]);
      const deadlines = await sql`select lang, sum(attempt_timeout_ms)::int as deadline, max(attempt_timeout_ms)::int as longest from translation_route group by lang`;
      expect(deadlines).toHaveLength(14);
      for (const row of deadlines) {
        expect(row.deadline, row.lang).toBeLessThanOrEqual(30_000);
        expect(row.longest, row.lang).toBeLessThanOrEqual(20_000);
      }
      expect(await sql`select 1 from translation_route where attempt_timeout_ms % 1000 <> 0`).toHaveLength(0);
    });

    it("holds the check of each language: eld's code (fa for Dari, none for Pashto), the script, Pashto's marker letters and the Urdu-only letters", async () => {
      const [ps] = await sql`select eld_code, script, marker_letters, excluded_letters from translation_route where lang = 'ps' and position = 1`;
      expect({ ...ps }).toEqual({ eld_code: null, script: "arabic", marker_letters: "ټډړږښګڼېۍ", excluded_letters: "ٹڈڑںےھہ" });
      const [prs] = await sql`select eld_code, script, excluded_letters from translation_route where lang = 'prs' and position = 1`;
      expect(prs!.eld_code).toBe("fa");
      expect(prs!.excluded_letters).toContain("ٹڈڑںےھہ");
      const [ta] = await sql`select eld_code, script from translation_route where lang = 'ta' and position = 2`;
      expect({ ...ta }).toEqual({ eld_code: "ta", script: "tamil" });
    });

    it("is read by the app as the routes the tests use: the fixture equals the seed", async () => {
      expect(await readTranslationRoutes(app)).toEqual(SEEDED_ROUTES);
      const rows = await sql`select lang, position, model, attempt_timeout_ms, eld_code, script, marker_letters, excluded_letters, source from translation_route order by lang, position`;
      expect(rows.map((r) => ({ ...r, position: Number(r.position) }))).toEqual(
        [...SEEDED_ROUTE_ROWS]
          .sort((a, b) => a.lang.localeCompare(b.lang) || a.position - b.position)
          .map((r) => ({ lang: r.lang, position: r.position, model: r.model, attempt_timeout_ms: r.attemptTimeoutMs, eld_code: r.eldCode, script: r.script, marker_letters: r.markerLetters, excluded_letters: r.excludedLetters, source: r.source })),
      );
    });
  });

  describe("what the app's role may do", () => {
    it("reads the routes and cannot change them: a route changes by migration", async () => {
      expect(await appSql`select count(*)::int as n from translation_route`).toEqual([{ n: 27 }]);
      await expect(appSql.unsafe("update translation_route set attempt_timeout_ms = 1000")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("delete from translation_route")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("insert into translation_route (lang, position, model, attempt_timeout_ms, script) values ('ur', 3, 'm', 1000, 'arabic')")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("truncate translation_route")).rejects.toThrow(/permission denied/);
    });

    it("reads and inserts cache rows, replaces only a zh-Hant conversion's text and source hash, and deletes nothing", async () => {
      const hash = sha256Hex("rights test");
      await appSql.unsafe(`insert into translation_cache (source_hash, lang, model_id, prompt_version, check_version, body, status) values ('${hash}', 'ur', 'm', '1', 'c', 'متن', 'ok')`);
      await appSql.unsafe(
        `insert into translation_cache (source_hash, lang, model_id, prompt_version, check_version, opencc_version, opencc_config, body, status, from_text_hash)
         values ('${hash}', 'zh-Hant', 'm', '1', 'c', '1.4.2', 'cfg', '電梯', 'script_converted', '${"a".repeat(64)}')`,
      );

      expect(await appSql`select count(*)::int as n from translation_cache where source_hash = ${hash}`).toEqual([{ n: 2 }]);
      // A model's text is written once: the app's update sees no such row, whatever it sets (nothing is changed and no error is raised).
      expect((await appSql.unsafe(`update translation_cache set body = 'x' where source_hash = '${hash}' and lang = 'ur'`)).count).toBe(0);
      expect((await appSql.unsafe(`update translation_cache set body = 'x', from_text_hash = '${"b".repeat(64)}' where source_hash = '${hash}' and status = 'ok'`)).count).toBe(0);
      expect(await sql`select body from translation_cache where source_hash = ${hash} and lang = 'ur'`).toEqual([{ body: "متن" }]);
      // A conversion's text and source hash may be replaced.
      expect((await appSql.unsafe(`update translation_cache set body = '電梯停止', from_text_hash = '${"b".repeat(64)}' where source_hash = '${hash}' and lang = 'zh-Hant'`)).count).toBe(1);
      expect(await sql`select body, from_text_hash from translation_cache where source_hash = ${hash} and lang = 'zh-Hant'`).toEqual([{ body: "電梯停止", from_text_hash: "b".repeat(64) }]);
      // Nothing else of a row can be changed, and a row cannot be deleted.
      await expect(appSql.unsafe(`update translation_cache set status = 'script_converted' where source_hash = '${hash}'`)).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe(`update translation_cache set lang = 'fr' where source_hash = '${hash}'`)).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe(`delete from translation_cache where source_hash = '${hash}'`)).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("truncate translation_cache")).rejects.toThrow(/permission denied/);
      await sql.unsafe(`delete from translation_cache where source_hash = '${hash}'`);
    });

    it("has an update policy that sees only a zh-Hant conversion, before and after the change", async () => {
      const [policy] = await sql`select qual, with_check from pg_policies where tablename = 'translation_cache' and policyname = 'translation_cache_app_update'`;

      expect(policy!.qual).toContain("zh-Hant");
      expect(policy!.qual).toContain("script_converted");
      expect(policy!.with_check).toContain("zh-Hant");
      expect(policy!.with_check).toContain("script_converted");
    });

    it.each(["translation_route", "translation_cache"])("has row level security on %s and nothing for the client roles", async (table) => {
      expect((await sql`select relrowsecurity as rls from pg_class where relname = ${table}`)[0]!.rls).toBe(true);
      const clients = await sql.unsafe(
        `select r.rolname from pg_roles r, pg_class c
         where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname = '${table}'
           and has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger')`,
      );
      expect(clients).toEqual([]);
    });
  });

  describe("the cache refuses what is not a passing result", () => {
    const hash = sha256Hex("cache rules");
    const insert = (columns: string, values: string) => sql.unsafe(`insert into translation_cache (source_hash, ${columns}) values ('${hash}', ${values})`);
    const ok = "'ur', 'm', '1', 'c', 'متن', 'ok'";
    const okColumns = "lang, model_id, prompt_version, check_version, body, status";

    it("stores a model's passing text and a converted zh-Hant text", async () => {
      await insert(okColumns, ok);
      await insert(
        "lang, model_id, prompt_version, check_version, opencc_version, opencc_config, body, status, from_text_hash",
        `'zh-Hant', 'm', '1', 'c', '1.4.2', 'cn to twp', '電梯', 'script_converted', '${sha256Hex("电梯")}'`,
      );

      expect(await sql`select count(*)::int as n from translation_cache where source_hash = ${hash}`).toEqual([{ n: 2 }]);
      await sql.unsafe(`delete from translation_cache where source_hash = '${hash}'`);
    });

    it.each([
      ["the English fallback", `${okColumns}`, "'ur', 'm', '1', 'c', 'English text', 'fallback_en'"],
      ["a failure", `${okColumns}`, "'ur', 'm', '1', 'c', 'x', 'failed'"],
      ["the English source", `${okColumns}`, "'en', 'm', '1', 'c', 'x', 'ok'"],
      ["an empty text", `${okColumns}`, "'ur', 'm', '1', 'c', '  ', 'ok'"],
      ["a model's text under zh-Hant", "lang, model_id, prompt_version, check_version, opencc_version, opencc_config, body, status, from_text_hash", `'zh-Hant', 'm', '1', 'c', '1.4.2', 'cfg', 'x', 'ok', '${"a".repeat(64)}'`],
      ["a conversion with no OpenCC version", "lang, model_id, prompt_version, check_version, body, status, from_text_hash", `'zh-Hant', 'm', '1', 'c', 'x', 'script_converted', '${"a".repeat(64)}'`],
      ["a conversion with no source hash", "lang, model_id, prompt_version, check_version, opencc_version, opencc_config, body, status", "'zh-Hant', 'm', '1', 'c', '1.4.2', 'cfg', 'x', 'script_converted'"],
      ["a model's text with an OpenCC version", "lang, model_id, prompt_version, check_version, opencc_version, body, status", "'ur', 'm', '1', 'c', '1.4.2', 'x', 'ok'"],
      ["a model's text with a source hash", "lang, model_id, prompt_version, check_version, body, status, from_text_hash", `'ur', 'm', '1', 'c', 'x', 'ok', '${"a".repeat(64)}'`],
      ["no prompt version", "lang, model_id, prompt_version, check_version, body, status", "'ur', 'm', '', 'c', 'x', 'ok'"],
      ["no check version", "lang, model_id, prompt_version, check_version, body, status", "'ur', 'm', '1', '', 'x', 'ok'"],
      ["a model name with spaces", "lang, model_id, prompt_version, check_version, body, status", "'ur', 'a model', '1', 'c', 'x', 'ok'"],
    ])("refuses %s", async (_name, columns, values) => {
      await expect(insert(columns, values)).rejects.toThrow(/violates check constraint/);
    });

    it("refuses a source hash that is not a sha256", async () => {
      await expect(sql.unsafe(`insert into translation_cache (source_hash, ${okColumns}) values ('abc', ${ok})`)).rejects.toThrow(/violates check constraint/);
    });

    it("keeps one row per full key: the same key twice is a conflict, a different prompt or check version is another row", async () => {
      await insert(okColumns, ok);
      await expect(insert(okColumns, ok)).rejects.toThrow(/duplicate key/);
      await insert(okColumns, "'ur', 'm', '2', 'c', 'متن', 'ok'");
      await insert(okColumns, "'ur', 'm', '1', 'd', 'متن', 'ok'");
      expect(await sql`select count(*)::int as n from translation_cache where source_hash = ${hash}`).toEqual([{ n: 3 }]);
      await sql.unsafe(`delete from translation_cache where source_hash = '${hash}'`);
    });
  });

  describe("the rules the route table holds itself", () => {
    // The migrations cannot be applied to a database other than `postgres` (pg_cron), so these run on the migrated one: a change that is
    // refused leaves nothing behind, and one that is allowed is put back.
    const change = (statements: string[]) =>
      sql.begin(async (tx) => {
        for (const statement of statements) await tx.unsafe(statement);
      });

    it("refuses a language whose attempt timeouts add up to over 30 s, when the transaction ends", async () => {
      await expect(change(["update translation_route set attempt_timeout_ms = 20000 where lang = 'ur' and position = 1", "update translation_route set attempt_timeout_ms = 11000 where lang = 'ur' and position = 2"])).rejects.toThrow(
        /route deadline of ur is 31000 ms, over 30000 ms/,
      );
      await expect(change(["insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script) values ('ps', 2, 'command-a-translate-08-2025', 11000, null, 'arabic')"])).rejects.toThrow(/route deadline of ps is 31000 ms/);
    });

    it("lets one migration change several positions of a language together, up to 30 s", async () => {
      try {
        await change(["update translation_route set attempt_timeout_ms = 20000 where lang = 'ur' and position = 1", "update translation_route set attempt_timeout_ms = 10000 where lang = 'ur' and position = 2"]);
        expect(await sql`select sum(attempt_timeout_ms)::int as deadline from translation_route where lang = 'ur'`).toEqual([{ deadline: 30_000 }]);
      } finally {
        await change(["update translation_route set attempt_timeout_ms = 10000 where lang = 'ur'"]);
      }
    });

    it("replaces a provisional value by a measured one, which is how S04.01 sets timeouts", async () => {
      try {
        await change(["update translation_route set attempt_timeout_ms = 8000, source = 'measured' where lang = 'fr' and position = 1"]);
        expect(await sql`select attempt_timeout_ms, source from translation_route where lang = 'fr' order by position`).toEqual([
          { attempt_timeout_ms: 8000, source: "measured" },
          { attempt_timeout_ms: 10_000, source: "provisional" },
        ]);
      } finally {
        await change(["update translation_route set attempt_timeout_ms = 10000, source = 'provisional' where lang = 'fr' and position = 1"]);
      }
    });

    it("refuses rows of one language that disagree about its check", async () => {
      await expect(change(["update translation_route set eld_code = 'fa' where lang = 'ur' and position = 2"])).rejects.toThrow(/rows of ur disagree about the check/);
      await expect(change(["update translation_route set excluded_letters = 'ٹ' where lang = 'ps' and position = 1", "insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script, marker_letters, excluded_letters) values ('ps', 2, 'm2', 5000, null, 'arabic', 'ټ', 'ٹ')"])).rejects.toThrow(/rows of ps disagree/);
    });

    it.each([
      ["a language that is not translated into (English)", "'en', 1, 'm', 5000, 'en', 'latin'"],
      ["zh-Hant, which is converted", "'zh-Hant', 1, 'm', 5000, 'zh', 'han'"],
      ["a position of zero", "'ur', 0, 'm', 5000, 'ur', 'arabic'"],
      ["a model name with spaces", "'ur', 3, 'a model', 5000, 'ur', 'arabic'"],
      ["an attempt timeout that is not whole seconds", "'ur', 3, 'm', 2500, 'ur', 'arabic'"],
      ["an attempt timeout over 20 s", "'ur', 3, 'm', 21000, 'ur', 'arabic'"],
      ["an attempt timeout under a second", "'ur', 3, 'm', 500, 'ur', 'arabic'"],
      ["an eld code that is not a code", "'ur', 3, 'm', 5000, 'Urdu', 'arabic'"],
      ["a script it does not know", "'ur', 3, 'm', 5000, 'ur', 'klingon'"],
    ])("refuses %s", async (_name, values) => {
      await expect(sql.unsafe(`insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script) values (${values})`)).rejects.toThrow(/violates check constraint/);
    });

    it("refuses a source that is neither provisional nor measured, a position or a model repeated in a language", async () => {
      await expect(sql.unsafe("update translation_route set source = 'guessed' where lang = 'ur'")).rejects.toThrow(/violates check constraint/);
      await expect(sql.unsafe("insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script) values ('ur', 1, 'other', 1000, 'ur', 'arabic')")).rejects.toThrow(/duplicate key/);
      await expect(sql.unsafe("insert into translation_route (lang, position, model, attempt_timeout_ms, eld_code, script) values ('ur', 3, 'north-small-translate-09-2026', 1000, 'ur', 'arabic')")).rejects.toThrow(/duplicate key/);
    });
  });

  describe("translating an alert on the real stores", () => {
    const answers = (fail: string[] = []) => fakeTranslator((call) => (fail.includes(call.lang) ? { text: "The elevator is out of service." } : { text: GOOD[call.lang]!, inputTokens: 100, outputTokens: 50 }));
    const build = (fake: ReturnType<typeof answers>, promptVersion = PROMPT_VERSION) =>
      createAlertTranslator({
        translator: fake.translator,
        routes: () => readTranslationRoutes(app),
        cache: drizzleTranslationCache(app),
        recordSpend: (event) => recordSpendEvent(app, event),
        zhHant: openccZhHant,
        promptVersion,
      });
    const clear = async () => {
      await sql.unsafe("delete from translation_cache");
      await sql.unsafe("delete from spend_event where purpose = 'alert'");
    };

    it("translates by the seeded routes, caches only what passed, records spend without text, and reuses the cache on a full key match", async () => {
      await clear();
      const fake = answers(["ta"]);
      const alerts = build(fake);

      const first = await alerts.translate({ english: ENGLISH_ALERT });

      expect(first.translations.filter((text) => text.status === "fallback_en").map((text) => text.lang)).toEqual(["ta"]);
      expect(first.translations.find((text) => text.lang === "zh-Hant")).toMatchObject({ status: "script_converted", machine: true, conversion: { from: "zh", opencc_version: "1.4.2" } });
      const cached = await sql`select lang, status from translation_cache order by lang`;
      expect(cached.map((r) => r.lang)).toEqual(["bn", "el", "es", "fr", "gu", "hi", "pa", "prs", "ps", "sk", "tl", "ur", "zh", "zh-Hant"]);
      expect(new Set(cached.map((r) => r.status))).toEqual(new Set(["ok", "script_converted"]));
      expect(await sql`select 1 from translation_cache where body = ${ENGLISH_ALERT}`).toHaveLength(0);

      const events = await sql`select kind, purpose, model, release_v, calls, tokens, tokens_estimated, ms from spend_event where purpose = 'alert'`;
      expect(events).toHaveLength(14 + 1);
      expect(new Set(events.map((e) => `${e.kind}/${e.purpose}`))).toEqual(new Set(["translate/alert"]));
      expect(events.filter((e) => Number(e.tokens) === 150).length).toBe(13);
      const everything = JSON.stringify(await sql`select to_jsonb(spend_event) as e from spend_event where purpose = 'alert'`);
      expect(everything).not.toContain("elevator");
      expect(everything).not.toContain(ENGLISH_ALERT.slice(0, 20));
      for (const text of Object.values(GOOD)) expect(everything).not.toContain(text.slice(0, 10));

      const callsBefore = fake.calls.length;
      const again = await alerts.translate({ english: ENGLISH_ALERT });
      // Only Tamil, which failed and was not cached, goes to the models again.
      expect(fake.calls.length - callsBefore).toBe(2);
      expect(fake.calls.slice(callsBefore).map((call) => call.lang)).toEqual(["ta", "ta"]);
      expect(again.translations.filter((text) => text.status === "fallback_en").map((text) => text.lang)).toEqual(["ta"]);
    });

    it("makes a fresh translation when the prompt version changes", async () => {
      await clear();
      const fake = answers();
      await build(fake, "p-old").translate({ english: ENGLISH_ALERT });
      expect(fake.calls).toHaveLength(14);

      await build(fake, "p-new").translate({ english: ENGLISH_ALERT });

      expect(fake.calls).toHaveLength(28);
      expect(await sql`select prompt_version, count(*)::int as n from translation_cache group by 1 order by 1`).toEqual([
        { prompt_version: "p-new", n: 15 },
        { prompt_version: "p-old", n: 15 },
      ]);
    });

    it("replaces a conversion that was made from another zh text, through the app's update right", async () => {
      await clear();
      const fake = answers();
      const alerts = build(fake);
      await alerts.translate({ english: ENGLISH_ALERT });
      await sql.unsafe(`update translation_cache set body = 'stale', from_text_hash = '${"b".repeat(64)}' where lang = 'zh-Hant'`);

      const result = await alerts.translate({ english: ENGLISH_ALERT });

      expect(result.translations.find((text) => text.lang === "zh-Hant")!.body).not.toBe("stale");
      const [hant] = await sql`select body, from_text_hash from translation_cache where lang = 'zh-Hant'`;
      expect(hant!.body).toBe(result.translations.find((text) => text.lang === "zh-Hant")!.body);
      expect(hant!.from_text_hash).toBe(sha256Hex(GOOD.zh!));
    });

    it("does not use a model's text that was changed behind the app's back and no longer passes its check: the model is asked again, and the row stands as it was left", async () => {
      await clear();
      const fake = answers();
      const alerts = build(fake);
      await alerts.translate({ english: ENGLISH_ALERT });
      await sql.unsafe("update translation_cache set body = 'edited by hand' where lang = 'fr'");
      const callsBefore = fake.calls.length;

      const result = await alerts.translate({ english: ENGLISH_ALERT });

      expect(fake.calls.slice(callsBefore).map((call) => call.lang)).toEqual(["fr"]);
      expect(result.translations.find((text) => text.lang === "fr")).toMatchObject({ status: "ok", body: GOOD.fr });
      expect(result.cacheFailures).toBe(1);
      // A model's text is written once, and the app cannot change it, so the new text was not stored over the old one.
      expect(await sql`select body from translation_cache where lang = 'fr'`).toEqual([{ body: "edited by hand" }]);
    });

    it("stores the digits of a model's text as 0-9", async () => {
      await clear();
      const eastern = fakeTranslator((call) => ({ text: call.lang === "ur" ? GOOD.ur!.replace("85", "۸۵") : GOOD[call.lang]! }));

      const result = await build(eastern).translate({ english: ENGLISH_ALERT });

      expect(result.translations.find((text) => text.lang === "ur")!.body).toBe(GOOD.ur);
      expect(await sql`select body from translation_cache where lang = 'ur'`).toEqual([{ body: GOOD.ur }]);
    });

    it("keeps one row when two submits translate the same text at the same time", async () => {
      await clear();
      const alerts = build(answers());

      await Promise.all([alerts.translate({ english: ENGLISH_ALERT }), alerts.translate({ english: ENGLISH_ALERT })]);

      expect(await sql`select count(*)::int as n from translation_cache`).toEqual([{ n: 15 }]);
    });
  });
});
