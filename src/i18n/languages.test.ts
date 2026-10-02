import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { DEFAULT_LANGUAGE, isLaunchCode, LAUNCH_CODES, LAUNCH_LANGUAGES, languageOf } from "./languages";
import { routing } from "./routing";

type PrototypeLanguage = { code: string; bcp47: string; native: string; dir: string; font: string };

function prototypeLanguages(): PrototypeLanguage[] {
  const window: { CVH_DATA?: { languages: PrototypeLanguage[] } } = {};
  const file = path.join(__dirname, "..", "..", "design", "prototype", "cvh", "data.js");
  vm.runInNewContext(readFileSync(file, "utf8"), { window });
  return window.CVH_DATA!.languages;
}

describe("launch languages", () => {
  it("are the languages of design/prototype/cvh/data.js, with the same tag, direction, name and font, in the same order", () => {
    expect(LAUNCH_LANGUAGES.map(({ code, bcp47, dir, native, font }) => ({ code, bcp47, dir, native, font }))).toEqual(
      prototypeLanguages().map(({ code, bcp47, dir, native, font }) => ({ code, bcp47, dir, native, font })),
    );
  });

  it("are right to left for ur, ps and prs only", () => {
    expect(LAUNCH_LANGUAGES.filter(({ dir }) => dir === "rtl").map(({ code }) => code)).toEqual(["ur", "ps", "prs"]);
  });

  it("are all language codes of the contract, and zh-Hant is not a launch language", () => {
    for (const code of LAUNCH_CODES) expect(LANG_CODES).toContain(code);
    expect(LAUNCH_CODES).toHaveLength(15);
    expect(isLaunchCode("zh-Hant")).toBe(false);
    expect(isLaunchCode("xx")).toBe(false);
    expect(isLaunchCode(undefined)).toBe(false);
    expect(languageOf("prs").bcp47).toBe("fa-AF");
  });

  it("route with the language in the URL and no cookie, detection or alternate links (AD-3)", () => {
    expect(routing.locales).toEqual(LAUNCH_CODES);
    expect(routing.defaultLocale).toBe(DEFAULT_LANGUAGE);
    expect(routing.localePrefix).toBe("always");
    expect(routing.localeCookie).toBe(false);
    expect(routing.localeDetection).toBe(false);
    expect(routing.alternateLinks).toBe(false);
  });
});
