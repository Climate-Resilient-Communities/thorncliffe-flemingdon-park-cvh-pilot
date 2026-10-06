// The translation as a submit runs it (S04.05): the budget is known before any model is asked, progress comes language by language, a
// stop ends the translation inside the budget whatever the stores do, and routes that cannot be read refuse the submit instead of
// translating by a guess. Time is vitest's fake clock; nothing reaches a network or a database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Translated } from "@/contracts/translated";
import { fakeTranslator, type Behaviour } from "../adapters/fakeTranslator";
import { ENGLISH_ALERT, GOOD, SEEDED_ROUTES } from "../domain/alertFixtures";
import { RouteConfigError, SUBMIT_MARGIN_MS, longestRouteDeadlineMs, submitBudgetMs, type TranslationRoute } from "../domain/alertRoutes";
import { ALERT_TARGET_LANGS } from "../domain/alertTranslation";
import type { TranslationCache, ZhHantConverter } from "./alertPorts";
import { AlertRoutesUnavailableError, STORE_GRACE_MS } from "./alertTranslator";
import { STOP_AFTER_ROUTES_MS, createSubmitTranslator, noTranslation, type SubmitTranslatorDeps } from "./submitTranslator";

const GOOD_ANSWER = (call: { lang: string }): Behaviour => ({ text: GOOD[call.lang]! });
const converter: ZhHantConverter = { convert: (text) => text, openccVersion: "1.4.2", config: "test" };
const emptyCache: TranslationCache = { get: async () => null, put: async () => undefined };

function setup(options: { behaviour?: (call: { lang: string; model: string; attempt: number }) => Behaviour; deps?: Partial<SubmitTranslatorDeps> } = {}) {
  const fake = fakeTranslator((call) => (options.behaviour ?? GOOD_ANSWER)(call));
  const deps: SubmitTranslatorDeps = {
    translator: fake.translator,
    routes: async () => SEEDED_ROUTES,
    cache: emptyCache,
    recordSpend: async () => undefined,
    zhHant: async () => converter,
    promptVersion: "p1",
    clock: () => Date.now(),
    ...options.deps,
  };
  return { ...fake, submit: createSubmitTranslator(deps) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the submit budget", () => {
  it("is the longest route deadline plus 5 s, and the seeded routes' longest deadline is 20 s", () => {
    expect(SUBMIT_MARGIN_MS).toBe(5000);
    expect(longestRouteDeadlineMs(SEEDED_ROUTES)).toBe(20_000);
    expect(submitBudgetMs(SEEDED_ROUTES)).toBe(25_000);
    expect(submitBudgetMs([])).toBe(5000);
    const slow: TranslationRoute[] = [{ ...SEEDED_ROUTES[0]!, deadlineMs: 30_000 }];
    expect(submitBudgetMs(slow)).toBe(35_000);
  });

  it("is told before any model is asked", async () => {
    const order: string[] = [];
    const t = setup({ behaviour: (call) => (order.push(`ask ${call.lang}`), GOOD_ANSWER(call)) });

    const run = t.submit.translate({ english: ENGLISH_ALERT, onBudget: (ms) => order.push(`budget ${ms}`) });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await run;

    expect(order[0]).toBe("budget 25000");
    expect(result.budgetMs).toBe(25_000);
    expect(order.filter((entry) => entry.startsWith("ask")).length).toBeGreaterThan(0);
  });
});

describe("the entry it translates for", () => {
  it("is carried into every spend event, with whether it is a drill's (S07.10)", async () => {
    const spend: { entryId?: string | null; isDrill?: boolean | null }[] = [];
    const t = setup({ deps: { recordSpend: async (event) => void spend.push(event) } });

    const run = t.submit.translate({ english: ENGLISH_ALERT, entry: { entryId: "01900000-0000-7000-8000-0000000000e1", isDrill: false } });
    await vi.advanceTimersByTimeAsync(5000);
    await run;

    expect(spend.length).toBeGreaterThan(0);
    for (const event of spend) expect(event).toMatchObject({ entryId: "01900000-0000-7000-8000-0000000000e1", isDrill: false });
  });
});

describe("progress", () => {
  it("reports each of the 15 languages as it settles, and returns the whole set", async () => {
    const t = setup();
    const settled: string[] = [];

    const run = t.submit.translate({ english: ENGLISH_ALERT, onLanguage: (translated: Translated) => settled.push(`${translated.lang}:${translated.status}`) });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await run;

    expect(settled).toHaveLength(15);
    expect(new Set(settled.map((entry) => entry.split(":")[0]))).toEqual(new Set(ALERT_TARGET_LANGS));
    expect(settled).toContain("zh-Hant:script_converted");
    expect(result.translations).toHaveLength(15);
    expect(result.stoppedAtBudget).toBe(false);
  });

  it("is never changed by a callback that throws", async () => {
    const t = setup();

    const run = t.submit.translate({
      english: ENGLISH_ALERT,
      onBudget: () => {
        throw new Error("screen gone");
      },
      onLanguage: () => {
        throw new Error("screen gone");
      },
    });
    await vi.advanceTimersByTimeAsync(5000);

    expect((await run).translations.filter((translated) => translated.status === "fallback_en")).toHaveLength(0);
  });
});

describe("finishing inside the budget", () => {
  it("ends every language by its route deadline when every model hangs, well inside the budget, as the English fallback", async () => {
    const t = setup({ behaviour: () => ({ hang: true }) });
    let done = false;

    const run = t.submit.translate({ english: ENGLISH_ALERT }).then((result) => {
      done = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(20_000 + 100);

    expect(done).toBe(true);
    const result = await run;
    expect(result.translations.every((translated) => translated.status === "fallback_en")).toBe(true);
    expect(result.budgetMs).toBe(25_000);
  });

  it("stops at the longest route deadline plus 3 s when a store hangs past it, so the whole is inside the budget", async () => {
    // zh-Hant waits for OpenCC, here a converter that never loads, and a grace period far longer than any budget: only the stop can end it.
    const t = setup({ deps: { storeGraceMs: 120_000, zhHant: () => new Promise<ZhHantConverter>(() => {}) } });
    let done = false;

    const run = t.submit.translate({ english: ENGLISH_ALERT }).then((result) => {
      done = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(20_000 + STOP_AFTER_ROUTES_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(done).toBe(true);
    const result = await run;
    expect(result.stoppedAtBudget).toBe(true);
    expect(result.translations.find((translated) => translated.lang === "zh-Hant")).toMatchObject({ status: "fallback_en" });
    // Every other language passed: the stop cut only what was still running.
    expect(result.translations.filter((translated) => translated.status === "fallback_en").map((translated) => translated.lang)).toEqual(["zh-Hant"]);
    expect(20_000 + STOP_AFTER_ROUTES_MS).toBeLessThanOrEqual(result.budgetMs - 2000);
  });

  it("counts the stop from the press: what the press used before the models were asked (spentMs) and the route read come off the time they get", async () => {
    // The routes take 700 ms to read and the transaction that began the attempt took 1.3 s: the stop is 2 s sooner, at the longest route deadline plus 1 s.
    const t = setup({
      deps: {
        storeGraceMs: 120_000,
        routes: async () => {
          await new Promise((resolve) => setTimeout(resolve, 700));
          return SEEDED_ROUTES;
        },
        zhHant: () => new Promise<ZhHantConverter>(() => {}),
      },
    });
    let done = false;

    const run = t.submit.translate({ english: ENGLISH_ALERT, spentMs: 1_300 }).then((result) => {
      done = true;
      return result;
    });
    // 700 ms of the route read, then the stop 20 s + 3 s - 2 s after it.
    await vi.advanceTimersByTimeAsync(700 + 20_000 + STOP_AFTER_ROUTES_MS - 2_000 - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(done).toBe(true);
    expect((await run).stoppedAtBudget).toBe(true);
  });

  it("stops at once when the press has already used more than the models could be given", async () => {
    const t = setup({ behaviour: () => ({ hang: true }) });

    const run = t.submit.translate({ english: ENGLISH_ALERT, spentMs: 60_000 });
    await vi.advanceTimersByTimeAsync(1);
    const result = await run;

    expect(result.stoppedAtBudget).toBe(true);
    expect(result.translations.every((translated) => translated.status === "fallback_en")).toBe(true);
  });

  it("is cancelled by its caller: what is still running ends as the English fallback, and that is not the budget's stop", async () => {
    const t = setup({ behaviour: () => ({ hang: true }) });
    const caller = new AbortController();

    const run = t.submit.translate({ english: ENGLISH_ALERT, signal: caller.signal });
    await vi.advanceTimersByTimeAsync(1000);
    caller.abort();
    const result = await run;

    expect(result.translations.every((translated) => translated.status === "fallback_en")).toBe(true);
    expect(result.stoppedAtBudget).toBe(false);
  });
});

describe("routes that cannot be read", () => {
  it("refuse with AlertRoutesUnavailableError when they do not answer within the store grace, and ask no model", async () => {
    const t = setup({ deps: { routes: () => new Promise<never>(() => {}) } });

    const run = t.submit.translate({ english: ENGLISH_ALERT });
    const outcome = run.then(
      () => "resolved",
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(STORE_GRACE_MS + 1);

    expect(await outcome).toBeInstanceOf(AlertRoutesUnavailableError);
    expect(t.calls).toHaveLength(0);
  });

  it("refuse with the RouteConfigError of a row that is not a route, and ask no model", async () => {
    const t = setup({
      deps: {
        routes: async () => {
          throw new RouteConfigError("ur", "a position is repeated");
        },
      },
    });

    await expect(t.submit.translate({ english: ENGLISH_ALERT })).rejects.toBeInstanceOf(RouteConfigError);
    expect(t.calls).toHaveLength(0);
  });

  it("refuse with whatever the routes' read threw (the database down)", async () => {
    const t = setup({
      deps: {
        routes: async () => {
          throw new Error("connection refused");
        },
      },
    });

    await expect(t.submit.translate({ english: ENGLISH_ALERT })).rejects.toThrow("connection refused");
  });
});

describe("noTranslation (an environment with no translation model)", () => {
  it("is the English text as the fallback in every language, with progress for each and nothing asked", async () => {
    const settled: string[] = [];

    const result = await noTranslation().translate({ english: ENGLISH_ALERT, onLanguage: (translated) => settled.push(translated.lang) });

    expect(result.translations.map((translated) => translated.lang)).toEqual([...ALERT_TARGET_LANGS]);
    expect(result.translations.every((translated) => translated.status === "fallback_en" && translated.body === ENGLISH_ALERT && !translated.machine && translated.model === null)).toBe(true);
    expect(settled).toHaveLength(15);
  });
});
