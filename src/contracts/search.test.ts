import { describe, expect, it } from "vitest";
import { SEARCH_ERROR_CODES, SEARCH_ERROR_STATUS, SearchErrorSchema, parseSearchRequest, searchErrorBody } from "./search";

describe("parseSearchRequest", () => {
  it("accepts a question, a language and an optional release number, and trims the question", () => {
    expect(parseSearchRequest({ q: "  a lawyer ", lang: "en", v: 3 })).toEqual({ ok: true, value: { q: "a lawyer", lang: "en", v: 3 } });
    expect(parseSearchRequest({ q: "x", lang: "zh-Hant" })).toEqual({ ok: true, value: { q: "x", lang: "zh-Hant" } });
  });

  it("counts characters, not bytes: 200 are fine, 201 are not", () => {
    expect(parseSearchRequest({ q: "ڈ".repeat(200), lang: "ur" }).ok).toBe(true);
    expect(parseSearchRequest({ q: "ڈ".repeat(201), lang: "ur" })).toEqual({ ok: false, code: "invalid_question" });
    expect(parseSearchRequest({ q: "😀".repeat(200), lang: "en" }).ok).toBe(true);
  });

  it.each([
    [{ q: "", lang: "en" }, "invalid_question"],
    [{ q: " \n ", lang: "en" }, "invalid_question"],
    [{ q: 5, lang: "en" }, "invalid_question"],
    [{ lang: "en" }, "invalid_question"],
    [{ q: "a", lang: "xx" }, "invalid_lang"],
    [{ q: "a", lang: 3 }, "invalid_lang"],
    [{ q: "a" }, "invalid_lang"],
    [{ q: "a", lang: "en", v: -1 }, "invalid_request"],
    [{ q: "a", lang: "en", v: 1.5 }, "invalid_request"],
    [{ q: "a", lang: "en", v: "2" }, "invalid_request"],
    [null, "invalid_request"],
    [[], "invalid_request"],
    ["q", "invalid_request"],
  ])("refuses %j with %s", (body, code) => {
    expect(parseSearchRequest(body)).toEqual({ ok: false, code });
  });

  it("never carries the question in what it refuses with", () => {
    expect(JSON.stringify(parseSearchRequest({ q: "secret".repeat(100), lang: "en" }))).not.toContain("secret");
  });
});

describe("the error body", () => {
  it("is {error: {code, message_key}} for every code, with a status for each", () => {
    for (const code of SEARCH_ERROR_CODES) {
      expect(SearchErrorSchema.parse(searchErrorBody(code))).toEqual({ error: { code, message_key: `search.${code}` } });
      expect([400, 429, 503]).toContain(SEARCH_ERROR_STATUS[code]);
    }
    expect(SEARCH_ERROR_STATUS.rate_limited).toBe(429);
    expect(SEARCH_ERROR_STATUS.search_unavailable).toBe(503);
  });
});
