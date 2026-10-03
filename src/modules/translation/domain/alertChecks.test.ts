// The checks an alert's translation must pass (S04.02): language by `eld` where it knows the language, script, Pashto's marker
// letters, and the Urdu-only letters absent from Pashto and Dari. Real `eld`; no model, no network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENGLISH_ALERT, GOOD, SEEDED_ROUTES } from "./alertFixtures";
import { CHECK_LOGIC_VERSION, ELD_VERSION, MIN_SCRIPT_SHARE, canonicalCheck, checkAlertTranslation, scriptShare, type LanguageCheck } from "./alertChecks";

const check = (lang: string): LanguageCheck => SEEDED_ROUTES.find((route) => route.lang === lang)!.check;
const verdict = (lang: string, output: string, english = ENGLISH_ALERT) => checkAlertTranslation(check(lang), english, output);

describe("a translation that passes", () => {
  it.each(Object.keys(GOOD))("is accepted in %s: its script, its letters and, where eld knows the language, eld's reading", (lang) => {
    expect(verdict(lang, GOOD[lang]!)).toBeNull();
  });

  it("keeps names and the Hub's name as they are written in the English: words copied from it do not count against the script", () => {
    // Greek and Chinese carry "Thorncliffe Park Dr" and "Hub" in Latin letters.
    expect(scriptShare("greek", ENGLISH_ALERT, GOOD.el!)).toBeGreaterThanOrEqual(MIN_SCRIPT_SHARE);
    expect(scriptShare("han", ENGLISH_ALERT, GOOD.zh!)).toBe(1);
  });
});

describe("a translation that is refused", () => {
  it("refuses Dari for Pashto: Arabic script, but no Pashto marker letter", () => {
    expect(verdict("ps", GOOD.prs!)).toBe("missing_marker");
  });

  it("refuses Urdu for Pashto: it has letters only Urdu uses", () => {
    expect(verdict("ps", GOOD.ur!)).toBe("excluded_letter");
  });

  it("refuses Urdu for Dari, and Pashto for Dari, which eld reads as Persian too", () => {
    expect(verdict("prs", GOOD.ur!)).toBe("excluded_letter");
    expect(verdict("prs", GOOD.ps!)).toBe("excluded_letter");
  });

  it("refuses English for Tamil: the letters are not Tamil", () => {
    expect(verdict("ta", "The elevator is out of service. Please use the stairs and call the hub.")).toBe("wrong_script");
  });

  it("refuses an empty answer, and one that is only space", () => {
    expect(verdict("ur", "")).toBe("empty");
    expect(verdict("ur", "  \n ")).toBe("empty");
  });

  it("refuses the English handed back, in a Latin-script language too", () => {
    expect(verdict("es", ENGLISH_ALERT)).toBe("unchanged");
    expect(verdict("es", `${ENGLISH_ALERT.toUpperCase()}`)).toBe("unchanged");
  });

  it("refuses a Latin-script text in the wrong language by eld: English words for Spanish, French for Spanish", () => {
    expect(verdict("es", "The lift at 85 Thorncliffe Park Dr is not working. Use the stairs and phone the Hub for any help.")).toBe("wrong_language");
    expect(verdict("es", GOOD.fr!)).toBe("wrong_language");
  });

  it("refuses Persian for Urdu by eld, which reads the two apart, though both are Arabic script", () => {
    expect(verdict("ur", GOOD.prs!)).toBe("wrong_language");
  });

  it("refuses another Indic script: Hindi for Gujarati", () => {
    expect(verdict("gu", GOOD.hi!)).toBe("wrong_script");
  });

  it("refuses text that is mostly English words even with a few words of the script in it", () => {
    expect(verdict("hi", "The lift is broken. Please use the stairs, कृपया")).toBe("wrong_script");
  });

  it("refuses an output with no letters at all in a language that needs a script", () => {
    expect(verdict("bn", "85 / 911")).toBe("wrong_script");
  });
});

describe("how the checks are made", () => {
  it("checks Pashto by script and letters alone: eld has no Pashto and reads it as Persian", () => {
    expect(check("ps").eldCode).toBeNull();
    expect(check("ps").markerLetters).toBe("ټډړږښګڼېۍ");
    expect(check("ps").excludedLetters).toBe("ٹڈڑںےھہ");
  });

  it("accepts Dari as eld's fa", () => {
    expect(check("prs").eldCode).toBe("fa");
  });

  it("is the same check whatever order the letters are listed in, so a reordered row is not a new version", () => {
    const a = canonicalCheck({ eldCode: null, script: "arabic", markerLetters: "ټډ", excludedLetters: "ٹڈ" });
    const b = canonicalCheck({ eldCode: null, script: "arabic", markerLetters: "ډټ", excludedLetters: "ڈٹ" });
    expect(a).toBe(b);
    expect(canonicalCheck({ eldCode: null, script: "arabic", markerLetters: "ټډ", excludedLetters: "ٹ" })).not.toBe(a);
  });

  it("records the eld version it was written against and keeps it equal to the package the app pins", () => {
    const root = path.join(__dirname, "..", "..", "..", "..");
    const installed = JSON.parse(readFileSync(path.join(root, "node_modules", "eld", "package.json"), "utf8")).version;
    const pinned = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).dependencies.eld;

    expect(ELD_VERSION).toBe(installed);
    expect(pinned).toBe(installed);
    expect(CHECK_LOGIC_VERSION).toMatch(/^[0-9]+$/);
  });
});
