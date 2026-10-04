import { createTranslator, IntlErrorCode } from "next-intl";
import { describe, expect, it } from "vitest";
import { isTranslationError } from "./setup/intl-errors";

// The guard of test/setup/intl-errors.ts: next-intl's default onError (console.error) throws under test.
describe("translation errors under vitest", () => {
  const t = createTranslator({ locale: "en", messages: { line: "Last confirmed by the Hub {date}" } }) as unknown as (key: string, values?: Record<string, string>) => string;

  it("fail the test: a message written without the value of its placeholder throws a FORMATTING_ERROR", () => {
    expect(() => t("line")).toThrow(/FORMATTING_ERROR: .*"date" was not provided/);
    expect(t("line", { date: "September 30, 2026" })).toBe("Last confirmed by the Hub September 30, 2026");
  });

  it("fail the test: a key the catalog does not have throws a MISSING_MESSAGE", () => {
    expect(() => t("missing")).toThrow(/MISSING_MESSAGE/);
  });

  it("let other errors through to the log, and leave next-intl's time-zone advice a log", () => {
    expect(isTranslationError(new Error("FORMATTING_ERROR: x"))).toBe(false);
    const advice = Object.assign(new Error(`${IntlErrorCode.ENVIRONMENT_FALLBACK}: no timeZone`), { code: IntlErrorCode.ENVIRONMENT_FALLBACK });
    expect(isTranslationError(advice)).toBe(false);
    const missing = Object.assign(new Error(`${IntlErrorCode.MISSING_MESSAGE}: x`), { code: IntlErrorCode.MISSING_MESSAGE });
    expect(isTranslationError(missing)).toBe(true);
  });
});
