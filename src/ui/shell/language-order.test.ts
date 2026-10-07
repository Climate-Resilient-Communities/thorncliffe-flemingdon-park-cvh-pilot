import { expect, it } from "vitest";
import { orderedLanguages } from "./language-order";
it("pins English and French without changing the other languages or the shared source list", () => {
  const languages = [{ code: "ur" }, { code: "fr" }, { code: "ta" }, { code: "en" }, { code: "fa" }];
  const before = [...languages];
  expect(orderedLanguages(languages).map(({ code }) => code)).toEqual(["en", "fr", "ur", "ta", "fa"]);
  expect(languages).toEqual(before);
});
