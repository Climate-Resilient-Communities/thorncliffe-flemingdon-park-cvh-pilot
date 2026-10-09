import { describe, expect, it } from "vitest";
import { rootTarget, savedLanguage, unprefixedTarget } from "./saved-language";

const choices = (value: unknown) => () => JSON.stringify(value);

describe("savedLanguage", () => {
  it("is the language the resident chose on this phone", () => {
    expect(savedLanguage(choices({ v: 1, lang: "ur", welcomed: true }))).toBe("ur");
  });

  it("is null with no choices, unreadable ones, a language we do not have, or storage that throws", () => {
    expect(savedLanguage(() => null)).toBeNull();
    expect(savedLanguage(() => "not json")).toBeNull();
    expect(savedLanguage(choices({ v: 1 }))).toBeNull();
    expect(savedLanguage(choices({ v: 1, lang: "xx" }))).toBeNull();
    expect(
      savedLanguage(() => {
        throw new Error("blocked");
      }),
    ).toBeNull();
  });
});

describe("rootTarget (the bare address /)", () => {
  it("is the saved language's home, or English's, whose home sends a first visit to the language choice", () => {
    expect(rootTarget("ps")).toBe("/ps");
    expect(rootTarget(null)).toBe("/en");
  });
});

describe("unprefixedTarget (a 404 for an address with no language)", () => {
  it("is the same path and query under the saved language", () => {
    expect(unprefixedTarget("/nope", "?x=1", "ur")).toBe("/ur/nope?x=1");
  });

  it("stays when the path has a language, when nothing is saved, or when the saved language is English", () => {
    expect(unprefixedTarget("/en/nope", "", "ur")).toBeNull();
    expect(unprefixedTarget("/ur/nope", "", "ur")).toBeNull();
    expect(unprefixedTarget("/nope", "", null)).toBeNull();
    expect(unprefixedTarget("/nope", "", "en")).toBeNull();
  });
});
