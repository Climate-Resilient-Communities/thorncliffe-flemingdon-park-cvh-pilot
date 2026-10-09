import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "@/i18n/languages";
import { staffLanguageName } from "./languageName";

describe("a resident's language in the staff surface's words (UAT note 9)", () => {
  it("names every launch language in English", () => {
    expect(staffLanguageName("en")).toBe("English");
    expect(staffLanguageName("ur")).toBe("Urdu");
    for (const lang of LAUNCH_CODES) expect(staffLanguageName(lang), lang).toMatch(/^[A-Z][A-Za-z ()]+$/);
  });
});
