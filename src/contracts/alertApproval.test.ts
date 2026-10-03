import { describe, expect, it } from "vitest";
import { NO_RECIPIENTS, RETURN_NOTE_MAX, decodeCounts, encodeCounts, sameRecipientCounts, type RecipientCounts } from "./alertApproval";
import { FEED_TAG } from "./feedTag";

describe("the count an approver reviews", () => {
  const counts: RecipientCounts = { total: 5, byLanguage: { en: 3, ur: 2 } };

  it("travels in a form as versioned JSON and comes back as it went", () => {
    expect(JSON.parse(encodeCounts(counts))).toEqual({ v: 1, total: 5, by_lang: { en: 3, ur: 2 } });
    expect(decodeCounts(encodeCounts(counts))).toEqual(counts);
    expect(decodeCounts(encodeCounts(NO_RECIPIENTS))).toEqual(NO_RECIPIENTS);
  });

  it("leaves out a language nobody is in", () => {
    expect(JSON.parse(encodeCounts({ total: 3, byLanguage: { en: 3, ur: 0 } }))).toEqual({ v: 1, total: 3, by_lang: { en: 3 } });
    expect(decodeCounts('{"v":1,"total":3,"by_lang":{"en":3,"ur":0}}')).toEqual({ total: 3, byLanguage: { en: 3 } });
  });

  it.each([
    ["nothing", undefined],
    ["a number", 5],
    ["text that is not JSON", "{oops"],
    ["a version that is not 1", '{"v":2,"total":0,"by_lang":{}}'],
    ["a language that is not one", '{"v":1,"total":1,"by_lang":{"xx":1}}'],
    ["parts that do not add up to the total", '{"v":1,"total":9,"by_lang":{"en":3}}'],
    ["a negative count", '{"v":1,"total":-1,"by_lang":{"en":-1}}'],
    ["a count that is not whole", '{"v":1,"total":1.5,"by_lang":{"en":1.5}}'],
    ["a field outside the contract", '{"v":1,"total":0,"by_lang":{},"extra":true}'],
    ["a count over a million", '{"v":1,"total":1000001,"by_lang":{"en":1000001}}'],
    ["a body far too long", `{"v":1,"total":0,"by_lang":{},"pad":"${"x".repeat(3000)}"}`],
  ])("refuses %s", (_name, value) => {
    expect(decodeCounts(value)).toBeNull();
  });

  it("is the same count only when the total and every language agree, a language not listed having none", () => {
    expect(sameRecipientCounts(counts, { total: 5, byLanguage: { ur: 2, en: 3 } })).toBe(true);
    expect(sameRecipientCounts(counts, { total: 5, byLanguage: { en: 4, ur: 1 } })).toBe(false);
    expect(sameRecipientCounts(counts, { total: 6, byLanguage: { en: 3, ur: 3 } })).toBe(false);
    expect(sameRecipientCounts(counts, { total: 5, byLanguage: { en: 3, ur: 1, fr: 1 } })).toBe(false);
    expect(sameRecipientCounts(NO_RECIPIENTS, { total: 0, byLanguage: { en: 0 } })).toBe(true);
    expect(sameRecipientCounts(NO_RECIPIENTS, counts)).toBe(false);
  });

  it("has no one in it before E07, and the note of a return is at most 500 characters", () => {
    expect(NO_RECIPIENTS).toEqual({ total: 0, byLanguage: {} });
    expect(RETURN_NOTE_MAX).toBe(500);
  });
});

describe("the feed's cache tag", () => {
  it("is 'feed' (AD-17): the tag the feed route caches under and an approval expires", () => {
    expect(FEED_TAG).toBe("feed");
  });
});
