// Alerts translated by route (S04.02) against a scripted fake Translator, an in-memory cache and a recording spend sink. Time is
// vitest's fake clock, so timeouts and deadlines are exact. Nothing here reaches a network or a database; the same use case against
// Postgres is in test/db/translationRoute.db.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { TranslatedSchema } from "@/contracts/translated";
import { toSpendEvent, type SpendEventInput } from "@/modules/spend";
import { sha256Hex } from "@/platform/hash";
import { AYA_FIRE, COMMAND_A, ENGLISH_ALERT, GOOD, NORTH, SEEDED_ROUTES } from "../domain/alertFixtures";
import { fakeTranslator, type Behaviour } from "../adapters/fakeTranslator";
import type { TranslationRoute } from "../domain/alertRoutes";
import { ALERT_MAX_OUTPUT_TOKENS, ALERT_TARGET_LANGS, estimateAlertCallTokens, type CachedTranslation, type TranslationCacheKey } from "../domain/alertTranslation";
import type { TranslationCache, ZhHantConverter } from "./alertPorts";
import type { Translator } from "./ports";
import { AlertTranslationInputError, checkVersion, createAlertTranslator, type AlertTranslatorDeps } from "./alertTranslator";

const SOURCE_HASH = sha256Hex(ENGLISH_ALERT);
const ALL_GOOD = (call: { lang: string }): Behaviour => ({ text: GOOD[call.lang]! });

function fakeCache(options: { failGet?: boolean; failPut?: boolean } = {}) {
  const rows = new Map<string, { key: TranslationCacheKey; value: CachedTranslation }>();
  const puts: { key: TranslationCacheKey; value: CachedTranslation }[] = [];
  const gets: TranslationCacheKey[] = [];
  const id = (key: TranslationCacheKey) => JSON.stringify(key);
  const cache: TranslationCache = {
    async get(key) {
      gets.push(key);
      if (options.failGet) throw new Error("cache down");
      return rows.get(id(key))?.value ?? null;
    },
    async put(key, value) {
      if (options.failPut) throw new Error("cache down");
      puts.push({ key, value });
      rows.set(id(key), { key, value });
    },
  };
  return { cache, rows, puts, gets, id };
}

// Simplified to Traditional for the characters of the fixture's zh text: the real OpenCC is exercised in test/translation-opencc.test.ts.
const TRADITIONAL: Record<string, string> = { 电: "電", 运: "運", 请: "請", 楼: "樓", 帮: "幫" };
function fakeConverter(change: Partial<ZhHantConverter> = {}) {
  const convert = vi.fn((text: string) => [...text].map((char) => TRADITIONAL[char] ?? char).join(""));
  const converter: ZhHantConverter = { convert, openccVersion: "1.4.2", config: "test s2twp", ...change };
  return { converter, convert };
}

function withRoute(lang: string, change: (route: TranslationRoute) => TranslationRoute): TranslationRoute[] {
  return SEEDED_ROUTES.map((route) => (route.lang === lang ? change(route) : route));
}
const positions = (...specs: [string, number][]): TranslationRoute["positions"] =>
  specs.map(([model, seconds], index) => ({ position: index + 1, model, attemptTimeoutMs: seconds * 1000, source: "provisional" as const }));

interface Setup {
  behaviour?: (call: { lang: string; model: string; attempt: number }) => Behaviour;
  routes?: TranslationRoute[];
  deps?: Partial<AlertTranslatorDeps>;
  cache?: ReturnType<typeof fakeCache>;
  wrap?: (inner: Translator) => Translator;
}
function setup(options: Setup = {}) {
  const fake = fakeTranslator((call) => (options.behaviour ?? ALL_GOOD)(call));
  const cache = options.cache ?? fakeCache();
  const spend: SpendEventInput[] = [];
  const { converter, convert } = fakeConverter();
  const deps: AlertTranslatorDeps = {
    translator: options.wrap ? options.wrap(fake.translator) : fake.translator,
    routes: async () => options.routes ?? SEEDED_ROUTES,
    cache: cache.cache,
    recordSpend: async (event) => {
      spend.push(event);
    },
    zhHant: async () => converter,
    promptVersion: "p1",
    clock: () => Date.now(),
    ...options.deps,
  };
  return { ...fake, cache, spend, converter, convert, deps, alerts: createAlertTranslator(deps) };
}
type Harness = ReturnType<typeof setup>;

/** Runs a translation to its end on the fake clock: far enough ahead for every timeout and deadline. */
async function finish<T>(run: Promise<T>, ms = 40_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return run;
}
const translate = (t: Harness, english = ENGLISH_ALERT) => finish(t.alerts.translate({ english }));
const of = <T extends { lang: string }>(list: T[], lang: string) => list.find((item) => item.lang === lang)!;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("translating an alert into every language", () => {
  it("runs every language in parallel: all fourteen first calls are made before any is answered", async () => {
    let started = 0;
    let release!: () => void;
    const everyoneStarted = new Promise<void>((resolve) => (release = resolve));
    const t = setup({
      wrap: (inner) => ({
        async translate(request) {
          started += 1;
          if (started === 14) release();
          await everyoneStarted;
          return inner.translate(request);
        },
      }),
    });

    const result = await translate(t);

    expect(started).toBe(14);
    expect(result.translations.filter((text) => text.status === "ok")).toHaveLength(14);
  });

  it("returns a Translated for every language but English, in the order of the language list, each the route's first model", async () => {
    const t = setup();

    const { translations, outcomes } = await translate(t);

    expect(translations.map((text) => text.lang)).toEqual(LANG_CODES.filter((lang) => lang !== "en"));
    expect(translations.map((text) => text.lang)).toEqual([...ALERT_TARGET_LANGS]);
    expect(outcomes.map((outcome) => outcome.lang)).toEqual(translations.map((text) => text.lang));
    for (const text of translations) {
      expect(() => TranslatedSchema.parse(text), text.lang).not.toThrow();
      expect(text.source_hash).toBe(SOURCE_HASH);
      if (text.lang === "zh-Hant") continue;
      const route = SEEDED_ROUTES.find((r) => r.lang === text.lang)!;
      expect(text).toEqual({ lang: text.lang, body: GOOD[text.lang], machine: true, model: route.positions[0]!.model, status: "ok", source_hash: SOURCE_HASH });
    }
    expect(outcomes.every((outcome) => outcome.fallbackReason === null)).toBe(true);
  });

  it("asks each model for the English text in the language by its LangCode only, with room for a whole alert", async () => {
    const t = setup();

    await translate(t);

    expect(t.calls).toHaveLength(14);
    expect(t.calls.map((call) => call.lang).sort()).toEqual(SEEDED_ROUTES.map((route) => route.lang).sort());
    for (const call of t.calls) {
      expect(call.from).toBe("en");
      expect(call.text).toBe(ENGLISH_ALERT);
      expect(call.maxOutputTokens).toBe(ALERT_MAX_OUTPUT_TOKENS);
      expect(LANG_CODES).toContain(call.lang);
      // zh-Hant is converted, never asked for; and the code eld uses for Dari (fa) is not a language of the app.
      expect(call.lang).not.toBe("zh-Hant");
      expect(call.lang).not.toBe("fa");
    }
  });

  it("never lets a vendor's or detector's language code into a result: lang is always a LangCode", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ta" ? { text: "The elevator is out of service." } : ALL_GOOD(call)) });

    const result = await translate(t);

    for (const text of result.translations) expect(LANG_CODES).toContain(text.lang);
    for (const outcome of result.outcomes) expect(LANG_CODES).toContain(outcome.lang);
    for (const { key } of t.cache.puts) expect(LANG_CODES).toContain(key.lang);
    expect(JSON.stringify(result)).not.toMatch(/"lang":"fa"/);
  });

  it("takes the model's output without the quotation marks or space it wraps it in", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "es" ? { text: `  "${GOOD.es}"\n` } : ALL_GOOD(call)) });

    const { translations } = await translate(t);

    expect(of(translations, "es").body).toBe(GOOD.es);
  });

  it("refuses an empty English text: a bug in the caller, with nothing sent to any model", async () => {
    const t = setup();

    await expect(t.alerts.translate({ english: "  " })).rejects.toBeInstanceOf(AlertTranslationInputError);
    expect(t.calls).toHaveLength(0);
  });

  it("reads the routes for each translation, so a changed route applies to the next one", async () => {
    let routes = SEEDED_ROUTES;
    const t = setup({ deps: { routes: async () => routes } });
    await translate(t);
    expect(t.calls.find((call) => call.lang === "ur")!.model).toBe(NORTH);

    routes = withRoute("ur", (route) => ({ ...route, positions: positions([AYA_FIRE, 10], [NORTH, 10]) }));
    await translate(t, `${ENGLISH_ALERT} Thank you.`);

    expect(t.calls.filter((call) => call.lang === "ur").map((call) => call.model)).toEqual([NORTH, AYA_FIRE]);
  });

  it("tells a screen about each language as it settles, zh-Hant after zh", async () => {
    const seen: string[] = [];
    const t = setup({ deps: { onLanguage: (text) => void seen.push(text.lang) } });

    await translate(t);

    expect([...seen].sort()).toEqual([...ALERT_TARGET_LANGS].sort());
    expect(seen.indexOf("zh-Hant")).toBeGreaterThan(seen.indexOf("zh"));
  });

  it("is not changed by a progress callback that throws", async () => {
    const t = setup({
      deps: {
        onLanguage: () => {
          throw new Error("screen gone");
        },
      },
    });

    const { translations } = await translate(t);

    expect(translations).toHaveLength(15);
    expect(translations.every((text) => text.status !== "fallback_en")).toBe(true);
  });
});

describe("the models of a route, in order, each with its own timeout, and the route deadline", () => {
  it("gives each position its own attempt timeout: the first is aborted at its own 3 s, the second at its own 7 s after it", async () => {
    const routes = withRoute("ur", (route) => ({ ...route, positions: positions([NORTH, 3], [AYA_FIRE, 7]), deadlineMs: 30_000 }));
    const t = setup({ routes, behaviour: (call) => (call.lang === "ur" ? { hang: true } : ALL_GOOD(call)) });
    const started = Date.now();

    const { outcomes, translations } = await translate(t);

    expect(t.aborts.filter((abort) => abort.lang === "ur").map((abort) => [abort.model, abort.at - started])).toEqual([
      [NORTH, 3000],
      [AYA_FIRE, 10_000],
    ]);
    expect(of(outcomes, "ur").attempts.map((attempt) => [attempt.model, attempt.result, attempt.ms])).toEqual([
      [NORTH, "timed_out", 3000],
      [AYA_FIRE, "timed_out", 7000],
    ]);
    expect(of(translations, "ur")).toMatchObject({ status: "fallback_en", body: ENGLISH_ALERT });
  });

  it("tries the next model when the first times out, and uses its translation", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ur" && call.model === NORTH ? { hang: true } : ALL_GOOD(call)) });

    const { outcomes, translations } = await translate(t);

    expect(t.calls.filter((call) => call.lang === "ur").map((call) => call.model)).toEqual([NORTH, AYA_FIRE]);
    expect(t.aborts).toEqual([{ lang: "ur", model: NORTH, at: expect.any(Number) }]);
    expect(of(translations, "ur")).toMatchObject({ status: "ok", model: AYA_FIRE, body: GOOD.ur });
    expect(of(outcomes, "ur").attempts.map((attempt) => attempt.result)).toEqual(["timed_out", "passed"]);
  });

  it("cancels the attempt in flight at the route deadline and the language falls back", async () => {
    // Two 10 s attempts with a deadline of 12 s, as when time went to something else before the second began.
    const routes = withRoute("ur", (route) => ({ ...route, positions: positions([NORTH, 10], [AYA_FIRE, 10]), deadlineMs: 12_000 }));
    const t = setup({ routes, behaviour: (call) => (call.lang === "ur" ? { hang: true } : ALL_GOOD(call)) });
    const started = Date.now();

    const { outcomes, translations } = await translate(t);

    expect(t.aborts.map((abort) => [abort.model, abort.at - started])).toEqual([
      [NORTH, 10_000],
      [AYA_FIRE, 12_000],
    ]);
    expect(of(outcomes, "ur").attempts.map((attempt) => attempt.result)).toEqual(["timed_out", "deadline"]);
    expect(of(outcomes, "ur")).toMatchObject({ status: "fallback_en", fallbackReason: "route_exhausted", ms: 12_000 });
    expect(of(translations, "ur")).toMatchObject({ status: "fallback_en", model: null, machine: false });
  });

  it("does not wait for a model that ignores the abort, and never uses its late answer", async () => {
    const routes = withRoute("ur", (route) => ({ ...route, positions: positions([NORTH, 10], [AYA_FIRE, 10]), deadlineMs: 12_000 }));
    const t = setup({
      routes,
      behaviour: (call) =>
        call.lang !== "ur" ? ALL_GOOD(call) : call.model === NORTH ? { text: GOOD.ur, afterMs: 30_000, ignoreAbort: true } : { text: GOOD.ur, afterMs: 15_000, ignoreAbort: true },
    });
    const started = Date.now();
    const run = t.alerts.translate({ english: ENGLISH_ALERT });

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await run;
    expect(Date.now() - started).toBe(12_000);
    expect(of(result.translations, "ur")).toMatchObject({ status: "fallback_en", body: ENGLISH_ALERT });

    await vi.advanceTimersByTimeAsync(30_000);
    // The models did answer, after their calls were aborted, and nothing came of it.
    expect(t.lateAnswers).toEqual([
      { lang: "ur", model: AYA_FIRE },
      { lang: "ur", model: NORTH },
    ]);
    expect(of(result.translations, "ur").status).toBe("fallback_en");
    expect(t.cache.puts.filter((put) => put.key.lang === "ur")).toEqual([]);
    // One estimated event for each of the two aborted calls: the late answers add none.
    expect(t.spend.filter((event) => event.model === NORTH || event.model === AYA_FIRE).filter((event) => event.tokensEstimated)).toHaveLength(2);
  });

  it("does not use the first model's late answer when the second model has answered in time", async () => {
    const t = setup({
      behaviour: (call) => (call.lang !== "ur" ? ALL_GOOD(call) : call.model === NORTH ? { text: `${GOOD.ur} (late)`, afterMs: 15_000, ignoreAbort: true } : { text: GOOD.ur }),
    });
    const run = t.alerts.translate({ english: ENGLISH_ALERT });

    await vi.advanceTimersByTimeAsync(11_000);
    const result = await run;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(of(result.translations, "ur")).toMatchObject({ status: "ok", model: AYA_FIRE, body: GOOD.ur });
    expect(t.lateAnswers).toEqual([{ lang: "ur", model: NORTH }]);
    expect(t.cache.puts.some((put) => put.key.lang === "ur" && put.key.modelId === NORTH)).toBe(false);
  });

  it("does not start another attempt once the deadline has passed", async () => {
    const routes = withRoute("ur", (route) => ({ ...route, positions: positions([NORTH, 10], [AYA_FIRE, 10]), deadlineMs: 5_000 }));
    const t = setup({ routes, behaviour: (call) => (call.lang === "ur" ? { hang: true } : ALL_GOOD(call)) });

    const { outcomes } = await translate(t);

    expect(t.calls.filter((call) => call.lang === "ur").map((call) => call.model)).toEqual([NORTH]);
    expect(of(outcomes, "ur").attempts.map((attempt) => attempt.result)).toEqual(["deadline"]);
  });

  it("lets the caller cancel what is still running: those languages end as the English fallback, at once", async () => {
    const controller = new AbortController();
    const t = setup({ behaviour: (call) => (call.lang === "ps" || call.lang === "ta" ? { hang: true } : ALL_GOOD(call)) });
    const started = Date.now();
    const run = t.alerts.translate({ english: ENGLISH_ALERT, signal: controller.signal });

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await run;

    expect(Date.now() - started).toBe(1_000);
    expect(t.aborts.map((abort) => abort.lang).sort()).toEqual(["ps", "ta"]);
    expect(of(result.outcomes, "ps")).toMatchObject({ status: "fallback_en", fallbackReason: "cancelled" });
    expect(of(result.outcomes, "ta").attempts.map((attempt) => attempt.result)).toEqual(["cancelled"]);
    expect(of(result.translations, "es").status).toBe("ok");
  });
});

describe("a model's output that fails its check, a timeout and an error", () => {
  // Two models for the language, so "the next model is tried" can be seen: Tamil's seeded route is North then Tiny Aya Fire; Pashto's seed
  // has one model, so a second is added for these cases (the seeded one-model route is tried below).
  const pashtoTwoModels = withRoute("ps", (route) => ({ ...route, positions: positions([NORTH, 10], [COMMAND_A, 10]), deadlineMs: 20_000 }));
  const ENGLISH_BACK = "The elevator is out of service. Please use the stairs and call the hub.";

  const fixtures: [string, string, TranslationRoute[], Behaviour, string][] = [
    ["Dari for Pashto", "ps", pashtoTwoModels, { text: GOOD.prs }, "missing_marker"],
    ["Urdu for Pashto", "ps", pashtoTwoModels, { text: GOOD.ur }, "excluded_letter"],
    ["English for Tamil", "ta", SEEDED_ROUTES, { text: ENGLISH_BACK }, "wrong_script"],
    ["empty text", "ta", SEEDED_ROUTES, { text: "" }, "empty"],
    ["a timeout", "ta", SEEDED_ROUTES, { hang: true }, "timed_out"],
    ["an error", "ta", SEEDED_ROUTES, { error: true }, "failed"],
  ];

  it.each(fixtures)("%s is rejected and the next model is tried", async (_name, lang, routes, bad, result) => {
    const [first, second] = routes.find((route) => route.lang === lang)!.positions.map((position) => position.model);
    expect(second).toBeDefined();
    const t = setup({ routes, behaviour: (call) => (call.lang === lang && call.model === first ? bad : ALL_GOOD(call)) });

    const { translations, outcomes } = await translate(t);

    const models = t.calls.filter((call) => call.lang === lang).map((call) => call.model);
    expect(models).toHaveLength(2);
    expect(of(outcomes, lang).attempts.map((attempt) => attempt.result)).toEqual([result, "passed"]);
    expect(of(translations, lang)).toMatchObject({ status: "ok", model: models[1], body: GOOD[lang] });
  });

  it.each(fixtures)("%s from every model in the route ends in fallback_en: the English text, not a translation", async (_name, lang, routes, bad, result) => {
    const t = setup({ routes, behaviour: (call) => (call.lang === lang ? bad : ALL_GOOD(call)) });

    const { translations, outcomes } = await translate(t);

    expect(of(translations, lang)).toEqual({ lang, body: ENGLISH_ALERT, machine: false, model: null, status: "fallback_en", source_hash: SOURCE_HASH });
    expect(of(outcomes, lang)).toMatchObject({ status: "fallback_en", fallbackReason: "route_exhausted" });
    expect(of(outcomes, lang).attempts.map((attempt) => attempt.result)).toEqual([result, result]);
    expect(t.cache.puts.filter((put) => put.key.lang === lang)).toEqual([]);
    expect(TranslatedSchema.safeParse(of(translations, lang)).success).toBe(true);
  });

  it("ends the seeded Pashto route, which has one model, in fallback_en when that model answers in Dari or Urdu", async () => {
    for (const bad of [GOOD.prs!, GOOD.ur!]) {
      const t = setup({ behaviour: (call) => (call.lang === "ps" ? { text: bad } : ALL_GOOD(call)) });

      const { translations } = await translate(t);

      expect(t.calls.filter((call) => call.lang === "ps")).toHaveLength(1);
      expect(of(translations, "ps")).toMatchObject({ status: "fallback_en", body: ENGLISH_ALERT });
    }
  });

  it("does not let a failing language hold up or change the others", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ps" ? { error: true } : ALL_GOOD(call)) });

    const { translations } = await translate(t);

    expect(translations.filter((text) => text.status === "fallback_en").map((text) => text.lang)).toEqual(["ps"]);
    expect(translations.filter((text) => text.lang !== "ps").every((text) => text.status !== "fallback_en")).toBe(true);
  });

  it("counts an answer with no text as empty, not as an error that stops the run", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "sk" ? ({ text: undefined } as Behaviour) : ALL_GOOD(call)) });

    const { outcomes } = await translate(t);

    expect(of(outcomes, "sk").attempts.map((attempt) => attempt.result)).toEqual(["empty", "empty"]);
  });

  it("fails an attempt whose check throws, and goes on to the next model", async () => {
    const t = setup({
      routes: withRoute("ta", (route) => ({ ...route, check: { ...route.check, script: "nonsense" as never } })),
    });

    const { translations, outcomes } = await translate(t);

    expect(of(outcomes, "ta").attempts.map((attempt) => attempt.result)).toEqual(["failed", "failed"]);
    expect(of(translations, "ta").status).toBe("fallback_en");
  });
});

describe("zh-Hant", () => {
  it("is converted from the passing zh text with OpenCC, marked script_converted, and records the zh source hash and the conversion", async () => {
    const t = setup();

    const { translations, outcomes } = await translate(t);

    const zh = of(translations, "zh");
    const hant = of(translations, "zh-Hant");
    expect(t.convert).toHaveBeenCalledTimes(1);
    expect(t.convert).toHaveBeenCalledWith(zh.body);
    expect(hant).toEqual({
      lang: "zh-Hant",
      body: "85 Thorncliffe Park Dr 的電梯停止運行。請使用樓梯，如需幫助請致電 Hub。",
      machine: true,
      model: "opencc-js 1.4.2",
      status: "script_converted",
      source_hash: zh.source_hash,
      conversion: { from: "zh", from_text_hash: sha256Hex(zh.body), opencc_version: "1.4.2", config: "test s2twp" },
    });
    expect(hant.source_hash).toBe(SOURCE_HASH);
    expect(TranslatedSchema.safeParse(hant).success).toBe(true);
    expect(of(outcomes, "zh-Hant")).toMatchObject({ status: "script_converted", fallbackReason: null, attempts: [] });
    // It is never sent to a model.
    expect(t.calls.some((call) => (call.lang as string) === "zh-Hant")).toBe(false);
  });

  it("is the English fallback when zh failed every model: nothing is converted", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "zh" ? { error: true } : ALL_GOOD(call)) });

    const { translations, outcomes } = await translate(t);

    expect(of(translations, "zh").status).toBe("fallback_en");
    expect(of(translations, "zh-Hant")).toEqual({ lang: "zh-Hant", body: ENGLISH_ALERT, machine: false, model: null, status: "fallback_en", source_hash: SOURCE_HASH });
    expect(of(outcomes, "zh-Hant").fallbackReason).toBe("zh_unavailable");
    expect(t.convert).not.toHaveBeenCalled();
  });

  it.each([
    ["converts to nothing", () => ""],
    [
      "throws",
      () => {
        throw new Error("dictionary missing");
      },
    ],
  ])("is the English fallback when OpenCC %s, and nothing is cached for it", async (_name, convert) => {
    const broken = setup({ deps: { zhHant: async () => ({ convert, openccVersion: "1.4.2", config: "test s2twp" }) } });

    const { translations, outcomes } = await translate(broken);

    expect(of(translations, "zh-Hant")).toMatchObject({ status: "fallback_en", body: ENGLISH_ALERT });
    expect(of(outcomes, "zh-Hant").fallbackReason).toBe("conversion_failed");
    expect(broken.cache.puts.some((put) => put.key.lang === "zh-Hant")).toBe(false);
  });

  it("is the English fallback when OpenCC cannot be loaded", async () => {
    const t = setup({
      deps: {
        zhHant: async () => {
          throw new Error("cannot load");
        },
      },
    });

    const { translations } = await translate(t);

    expect(of(translations, "zh-Hant").status).toBe("fallback_en");
    expect(of(translations, "zh").status).toBe("ok");
  });
});

describe("the cache", () => {
  const callsFor = (t: Harness, lang: string) => t.calls.filter((call) => call.lang === lang).length;

  it("keys a result by every part of AD-10's key: the source hash, the language, the model, the prompt and check versions, and for zh-Hant OpenCC's version and configuration", async () => {
    const t = setup();

    await translate(t);

    const ur = t.cache.puts.find((put) => put.key.lang === "ur")!;
    expect(ur.key).toEqual({
      sourceHash: SOURCE_HASH,
      lang: "ur",
      modelId: NORTH,
      promptVersion: "p1",
      checkVersion: checkVersion(SEEDED_ROUTES.find((route) => route.lang === "ur")!.check),
      openccVersion: "",
      openccConfig: "",
    });
    expect(ur.value).toEqual({ body: GOOD.ur, status: "ok", fromTextHash: null });
    const hant = t.cache.puts.find((put) => put.key.lang === "zh-Hant")!;
    expect(hant.key).toMatchObject({ sourceHash: SOURCE_HASH, modelId: COMMAND_A, promptVersion: "p1", openccVersion: "1.4.2", openccConfig: "test s2twp" });
    expect(hant.value).toMatchObject({ status: "script_converted", fromTextHash: sha256Hex(GOOD.zh!) });
  });

  it("reuses the results when the same English text is translated again with every part of the key the same: no model is called, nothing is spent", async () => {
    const t = setup();
    const first = await translate(t);
    const callsBefore = t.calls.length;
    const spendBefore = t.spend.length;

    const second = await translate(t);

    expect(t.calls).toHaveLength(callsBefore);
    expect(t.spend).toHaveLength(spendBefore);
    expect(t.convert).toHaveBeenCalledTimes(1);
    expect(second.translations).toEqual(first.translations);
    expect(second.outcomes.filter((outcome) => outcome.lang !== "zh-Hant").every((outcome) => outcome.attempts.map((a) => a.result).join() === "cached")).toBe(true);
  });

  it("does not reuse another English text's translation", async () => {
    const t = setup();
    await translate(t);

    await translate(t, `${ENGLISH_ALERT} It will be fixed by 6 pm.`);

    expect(t.calls).toHaveLength(28);
  });

  it("makes a fresh translation when the check version changes", async () => {
    const t = setup();
    await translate(t);
    expect(t.calls).toHaveLength(14);

    const changed = createAlertTranslator({ ...t.deps, checkVersion: "check-2" });
    const result = await finish(changed.translate({ english: ENGLISH_ALERT }));

    expect(t.calls).toHaveLength(28);
    expect(result.outcomes.filter((outcome) => outcome.lang !== "zh-Hant").every((outcome) => outcome.attempts[0]!.result === "passed")).toBe(true);
    expect(t.cache.puts.filter((put) => put.key.checkVersion === "check-2")).toHaveLength(15);
  });

  it("makes a fresh translation when the prompt version changes", async () => {
    const t = setup();
    await translate(t);

    const changed = createAlertTranslator({ ...t.deps, promptVersion: "p2" });
    await finish(changed.translate({ english: ENGLISH_ALERT }));

    expect(t.calls).toHaveLength(28);
    expect(t.cache.puts.filter((put) => put.key.promptVersion === "p2")).toHaveLength(15);
  });

  it("makes a fresh translation of one language when that language's own check changes, and of no other", async () => {
    const t = setup();
    await translate(t);
    const stricter = withRoute("hi", (route) => ({ ...route, check: { ...route.check, markerLetters: "ह" } }));

    const changed = createAlertTranslator({ ...t.deps, routes: async () => stricter });
    await finish(changed.translate({ english: ENGLISH_ALERT }));

    expect(t.calls).toHaveLength(15);
    expect(callsFor(t, "hi")).toBe(2);
  });

  it("converts zh-Hant again when OpenCC's version changes, with zh and every other language reused", async () => {
    const t = setup();
    await translate(t);

    const next = fakeConverter({ openccVersion: "1.5.0" });
    const changed = createAlertTranslator({ ...t.deps, zhHant: async () => next.converter });
    const result = await finish(changed.translate({ english: ENGLISH_ALERT }));

    expect(t.calls).toHaveLength(14);
    expect(next.convert).toHaveBeenCalledTimes(1);
    expect(of(result.translations, "zh-Hant")).toMatchObject({ status: "script_converted", conversion: { opencc_version: "1.5.0" }, model: "opencc-js 1.5.0" });
    expect(t.cache.puts.filter((put) => put.key.lang === "zh-Hant").map((put) => put.key.openccVersion)).toEqual(["1.4.2", "1.5.0"]);
  });

  it("converts zh-Hant again when OpenCC's configuration changes", async () => {
    const t = setup();
    await translate(t);

    const next = fakeConverter({ config: "test s2t" });
    const changed = createAlertTranslator({ ...t.deps, zhHant: async () => next.converter });
    await finish(changed.translate({ english: ENGLISH_ALERT }));

    expect(t.calls).toHaveLength(14);
    expect(next.convert).toHaveBeenCalledTimes(1);
    expect(t.cache.puts.filter((put) => put.key.lang === "zh-Hant").map((put) => put.key.openccConfig)).toEqual(["test s2twp", "test s2t"]);
  });

  it("converts zh-Hant again when the cached conversion was made from a different zh text", async () => {
    const t = setup();
    await translate(t);
    const entry = [...t.cache.rows.values()].find((row) => row.key.lang === "zh-Hant")!;
    entry.value = { ...entry.value, fromTextHash: sha256Hex("some other zh text") };

    const result = await translate(t);

    expect(t.convert).toHaveBeenCalledTimes(2);
    expect(of(result.translations, "zh-Hant").conversion?.from_text_hash).toBe(sha256Hex(GOOD.zh!));
  });

  it("caches only passing results: a failed model's output, a timeout and an error leave nothing behind, and a fallback is never cached", async () => {
    const t = setup({
      behaviour: (call) => {
        if (call.lang === "ur" && call.model === NORTH) return { text: "The elevator is out of service." };
        if (call.lang === "ta") return { error: true };
        return ALL_GOOD(call);
      },
    });

    const { translations } = await translate(t);

    expect(of(translations, "ta").status).toBe("fallback_en");
    expect(t.cache.puts.filter((put) => put.key.lang === "ta")).toEqual([]);
    expect(t.cache.puts.filter((put) => put.key.lang === "ur").map((put) => put.key.modelId)).toEqual([AYA_FIRE]);
    for (const { value } of t.cache.puts) {
      expect(["ok", "script_converted"]).toContain(value.status);
      expect(value.body).not.toBe(ENGLISH_ALERT);
      expect(value.body).not.toBe("The elevator is out of service.");
    }
  });

  it("tries a failed model again next time, because a failure is never cached, while what passed is reused", async () => {
    // Tamil: North fails the first time and Tiny Aya Fire passes; the second time North answers.
    const t = setup({ behaviour: (call) => (call.lang === "ta" && call.model === NORTH && call.attempt === 1 ? { error: true } : ALL_GOOD(call)) });
    const first = await translate(t);
    expect(of(first.translations, "ta")).toMatchObject({ status: "ok", model: AYA_FIRE });
    expect(callsFor(t, "ta")).toBe(2);

    const again = await translate(t);

    expect(callsFor(t, "ta")).toBe(3);
    expect(of(again.outcomes, "ta").attempts.map((attempt) => [attempt.model, attempt.result])).toEqual([[NORTH, "passed"]]);
    expect(t.calls).toHaveLength(14 + 1 + 1);
    // Every other language came from the cache.
    expect(again.outcomes.filter((outcome) => outcome.lang !== "ta" && outcome.lang !== "zh-Hant").every((outcome) => outcome.attempts[0]!.result === "cached")).toBe(true);
  });

  it("goes on as if the cache missed when it cannot be read or written, and says so", async () => {
    const t = setup({ cache: fakeCache({ failGet: true, failPut: true }) });

    const result = await translate(t);

    expect(result.translations.every((text) => text.status !== "fallback_en")).toBe(true);
    expect(result.cacheFailures).toBeGreaterThan(0);
    expect(t.calls).toHaveLength(14);
  });
});

describe("what each call records in spend", () => {
  const FIELDS = ["kind", "purpose", "model", "releaseV", "tokens", "tokensEstimated", "ms"];

  it("records every call as a translate event for the alert purpose, with the model, the billed tokens and the time, and valid for the spend module", async () => {
    const t = setup({ behaviour: (call) => ({ text: GOOD[call.lang]!, inputTokens: 100, outputTokens: 40, afterMs: 250 }) });

    await translate(t);

    expect(t.spend).toHaveLength(14);
    for (const event of t.spend) {
      expect(event).toEqual({ kind: "translate", purpose: "alert", model: expect.any(String), releaseV: null, tokens: 140, tokensEstimated: false, ms: 250 });
      expect(() => toSpendEvent(event)).not.toThrow();
    }
    expect(t.spend.map((event) => event.model).sort()).toEqual(t.calls.map((call) => call.model).sort());
  });

  it("holds no text: only codes and numbers, never the English or a translation", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ta" ? { text: "The elevator is out of service." } : ALL_GOOD(call)) });

    const result = await translate(t);

    const recorded = JSON.stringify(t.spend);
    expect(recorded).not.toContain("elevator");
    expect(recorded).not.toContain("Thorncliffe");
    for (const text of Object.values(GOOD)) expect(recorded).not.toContain(text.slice(0, 12));
    for (const event of t.spend) expect(Object.keys(event).sort()).toEqual([...FIELDS].sort());
    const reported = JSON.stringify(result.outcomes);
    expect(reported).not.toContain("elevator");
  });

  it("records a call that failed check as billed, since the model answered", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ta" ? { text: "The elevator is out of service.", inputTokens: 90, outputTokens: 30 } : ALL_GOOD(call)) });

    await translate(t);

    expect(t.spend.filter((event) => event.model === NORTH || event.model === AYA_FIRE).length).toBeGreaterThan(0);
    const ta = t.spend.filter((event) => event.tokens === 120);
    expect(ta).toHaveLength(2);
    expect(ta.every((event) => event.tokensEstimated === false)).toBe(true);
  });

  it("counts a call cancelled before it answered as an estimate, since it may still have been billed", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ps" ? { hang: true } : ALL_GOOD(call)) });

    await translate(t);

    const aborted = t.spend.filter((event) => event.tokensEstimated);
    expect(aborted).toEqual([{ kind: "translate", purpose: "alert", model: NORTH, releaseV: null, tokens: estimateAlertCallTokens(ENGLISH_ALERT), tokensEstimated: true, ms: 20_000 }]);
  });

  it("records a vendor error as a call that billed nothing, with its time", async () => {
    const t = setup({ behaviour: (call) => (call.lang === "ps" ? { error: true, afterMs: 700 } : ALL_GOOD(call)) });

    await translate(t);

    expect(t.spend.filter((event) => event.tokens === 0)).toEqual([{ kind: "translate", purpose: "alert", model: NORTH, releaseV: null, tokens: 0, tokensEstimated: false, ms: 700 }]);
  });

  it("estimates when the vendor reports no usage", async () => {
    const t = setup({ behaviour: (call) => ({ text: GOOD[call.lang]!, inputTokens: null, outputTokens: null }) });

    await translate(t);

    expect(t.spend).toHaveLength(14);
    expect(t.spend.every((event) => event.tokensEstimated && event.tokens === estimateAlertCallTokens(ENGLISH_ALERT))).toBe(true);
  });

  it("records nothing for a result taken from the cache", async () => {
    const t = setup();
    await translate(t);
    const before = t.spend.length;

    await translate(t);

    expect(t.spend).toHaveLength(before);
  });

  it("goes on when a spend event cannot be written, and counts it", async () => {
    const t = setup({
      deps: {
        recordSpend: async () => {
          throw new Error("database down");
        },
      },
    });

    const result = await translate(t);

    expect(result.translations.every((text) => text.status !== "fallback_en")).toBe(true);
    expect(result.spendFailures).toBe(14);
  });
});

describe("the routes being what they are", () => {
  it("is the English fallback, with no model called, for a language that has no route; zh-Hant too when zh has none", async () => {
    const routes = SEEDED_ROUTES.filter((route) => route.lang !== "tl" && route.lang !== "zh");
    const t = setup({ routes });

    const { translations, outcomes } = await translate(t);

    expect(t.calls.some((call) => call.lang === "tl" || call.lang === "zh")).toBe(false);
    expect(of(outcomes, "tl")).toMatchObject({ status: "fallback_en", fallbackReason: "no_route", attempts: [] });
    expect(of(outcomes, "zh-Hant").fallbackReason).toBe("zh_unavailable");
    expect(of(translations, "tl").body).toBe(ENGLISH_ALERT);
    expect(translations).toHaveLength(15);
  });
});
