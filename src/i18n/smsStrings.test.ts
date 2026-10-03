import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "./languages";
import { SMS_STRING_KEYS, fillSms, smsStrings } from "./smsStrings";
import en from "./messages/en.json";

const PLACEHOLDERS: Partial<Record<keyof typeof SMS_STRING_KEYS, string[]>> = {
  verifiedBy: ["org"],
  ambassador: ["building"],
  link: ["url"],
};

describe("smsStrings", () => {
  it.each(LAUNCH_CODES.map((lang) => [lang]))("%s has every string of a text message, translated (never behind the [EN] marker) and with its placeholders", (lang) => {
    const strings = smsStrings(lang as (typeof LAUNCH_CODES)[number]);

    for (const name of Object.keys(SMS_STRING_KEYS) as (keyof typeof SMS_STRING_KEYS)[]) {
      const value = strings[name];
      expect(value.trim(), `${lang} ${name}`).not.toBe("");
      expect(value, `${lang} ${name}`).not.toMatch(/^\[EN\]/);
      expect([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]), `${lang} ${name}`).toEqual(PLACEHOLDERS[name] ?? []);
      // A text message is one text: a line break inside a part would break the "one part, one line" order.
      expect(value, `${lang} ${name}`).not.toContain("\n");
    }
  });

  it("reads English from the English catalog, word for word", () => {
    expect(smsStrings("en")).toEqual({
      exercise: en.x10.sms,
      correction: en.R07.correction,
      call911: en.x01.sms,
      verifiedBy: en.x02.verifiedBy,
      notYetVerified: en.x02.notYetVerified,
      hub: en.x02.hub,
      ambassador: en.x02.ambassador,
      fromHub: en.R04.fromHub,
      machineLabel: en.x04.label,
      unavailable: en.x04.unavailable,
      link: en.R04.link,
      stop: en.R04.stop,
    });
  });

  // The Hub's attribution is the prototype's own text-message wording of every language, whole: the first sentence of
  // R04.levelCommunity without its final stop (a full stop, an Urdu or Persian stop, a danda, an ideographic stop).
  // Building it from "community alert from {author}" and "the Hub" gave "de le Hub", "de el Hub" and "od Hub".
  const firstSentence = (text: string) => text.split(/(?<=[.\u3002\u06D4\u0964])\s*/u)[0].replace(/[.\u3002\u06D4\u0964]$/u, "");
  const catalog = (lang: string) => JSON.parse(readFileSync(`src/i18n/messages/${lang}.json`, "utf8")) as { R04: { levelCommunity: string; fromHub: string } };

  it.each(LAUNCH_CODES.map((lang) => [lang]))("%s: the Hub attribution is the first sentence of R04.levelCommunity, the prototype's own text-message wording", (lang) => {
    const { R04 } = catalog(lang);

    expect(SMS_STRING_KEYS.fromHub).toBe("R04.fromHub");
    expect(smsStrings(lang as (typeof LAUNCH_CODES)[number]).fromHub).toBe(firstSentence(R04.levelCommunity));
    expect(R04.fromHub).toBe(firstSentence(R04.levelCommunity));
  });

  it("uses x04.unavailable as translation.unavailable, and the 911 line the catalog marks for text messages", () => {
    expect(SMS_STRING_KEYS.unavailable).toBe("x04.unavailable");
    expect(SMS_STRING_KEYS.call911).toBe("x01.sms");
  });

  it("throws for a language with no catalog, and does not mistake an inherited property for one", () => {
    for (const lang of ["zh-Hant", "xx", "", "toString", "__proto__", "constructor"]) {
      expect(() => smsStrings(lang as never), lang).toThrow(/No text message catalog/);
    }
  });
});

describe("fillSms", () => {
  it("fills every placeholder, more than once if it appears more than once", () => {
    expect(fillSms("{a} and {b} and {a}", { a: "x", b: "y" })).toBe("x and y and x");
    expect(fillSms("none", {})).toBe("none");
  });

  it("does not interpret the value (no second pass over what was filled in)", () => {
    expect(fillSms("From {a}", { a: "{b}", b: "no" })).toBe("From {b}");
    expect(fillSms("{a}", { a: "$&" })).toBe("$&");
  });

  it("throws for a placeholder with no value: a missing value is a bug, not an empty word", () => {
    expect(() => fillSms("More: {url}", {})).toThrow(/placeholder \{url\}/);
  });
});
