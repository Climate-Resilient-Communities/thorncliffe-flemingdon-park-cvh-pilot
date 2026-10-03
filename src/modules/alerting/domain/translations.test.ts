import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LANG_CODES } from "../../../contracts/lang";
import type { Translated } from "../../../contracts/translated";
import { FROZEN_LANGS, TranslationSetError, freezeTranslations, translatedToFrozen } from "./translations";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ENGLISH = "The elevator is out of service.";
const SOURCE = sha(ENGLISH);

const ok = (lang: Translated["lang"], body = `${lang} text`): Translated => ({ lang, body, machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: SOURCE });
const fallback = (lang: Translated["lang"], body = ENGLISH): Translated => ({ lang, body, machine: false, model: null, status: "fallback_en", source_hash: SOURCE });
const converted = (zhBody: string, body = "zh-Hant text"): Translated => ({
  lang: "zh-Hant",
  body,
  machine: true,
  model: "opencc-js 1.4.2",
  status: "script_converted",
  source_hash: SOURCE,
  conversion: { from: "zh", from_text_hash: sha(zhBody), opencc_version: "1.4.2", config: "opencc-js Converter({ from: cn, to: twp })" },
});

/** A whole set: every language translated, zh-Hant converted from zh. */
function wholeSet(over: Record<string, Translated> = {}): Translated[] {
  return FROZEN_LANGS.map((lang) => over[lang] ?? (lang === "zh-Hant" ? converted("zh text") : ok(lang)));
}

describe("translatedToFrozen: the one mapping from translation's Translated to what an entry freezes", () => {
  it("stores `ok` as `translated`, keeping the model and the machine flag", () => {
    expect(translatedToFrozen(ok("ur", "اردو"))).toEqual({ lang: "ur", body: "اردو", machine: true, model: "north-small-translate-09-2026", status: "translated", sourceHash: SOURCE });
  });

  it("keeps `fallback_en` as it is: English, not machine text, no model", () => {
    expect(translatedToFrozen(fallback("ps"))).toEqual({ lang: "ps", body: ENGLISH, machine: false, model: null, status: "fallback_en", sourceHash: SOURCE });
  });

  it("keeps `script_converted` with its conversion record: the zh text's hash, OpenCC's version and configuration", () => {
    const frozen = translatedToFrozen(converted("zh text"));

    expect(frozen).toMatchObject({ lang: "zh-Hant", machine: true, model: "opencc-js 1.4.2", status: "script_converted", sourceHash: SOURCE });
    expect(frozen.conversion).toEqual({ from: "zh", fromTextHash: sha("zh text"), openccVersion: "1.4.2", config: "opencc-js Converter({ from: cn, to: twp })" });
  });

  it("gives only a converted text a conversion", () => {
    expect(translatedToFrozen(ok("hi"))).not.toHaveProperty("conversion");
    expect(translatedToFrozen(fallback("zh-Hant"))).not.toHaveProperty("conversion");
  });

  it("refuses the English source: it is the entry's original text, never a stored translation", () => {
    expect(() => translatedToFrozen({ lang: "en", body: ENGLISH, machine: false, model: null, status: "source", source_hash: SOURCE })).toThrow(TranslationSetError);
  });

  it("refuses a text that breaks the contract's own rules (a translation with no model, a fallback that claims a model, a conversion with no record)", () => {
    expect(() => translatedToFrozen({ ...ok("ur"), model: null })).toThrow(TranslationSetError);
    expect(() => translatedToFrozen({ ...fallback("ur"), model: "m" })).toThrow(TranslationSetError);
    expect(() => translatedToFrozen({ ...converted("zh text"), conversion: undefined })).toThrow(TranslationSetError);
    expect(() => translatedToFrozen({ ...ok("ur"), body: "" })).toThrow(TranslationSetError);
    expect(() => translatedToFrozen({ lang: "ur" } as never)).toThrow(TranslationSetError);
  });

  it("uses the table's vocabulary and nothing else: translated, fallback_en, script_converted", () => {
    const statuses = new Set(wholeSet({ ps: fallback("ps") }).map((text) => translatedToFrozen(text).status));
    expect([...statuses].sort()).toEqual(["fallback_en", "script_converted", "translated"]);
  });
});

describe("freezeTranslations: a whole, consistent set", () => {
  it("is the 15 texts alerts are translated into (the 14 launch languages but English, and zh-Hant), in launch order, whatever order they come in", () => {
    expect(FROZEN_LANGS).toHaveLength(15);
    expect(FROZEN_LANGS).toEqual(LANG_CODES.filter((lang) => lang !== "en"));
    const frozen = freezeTranslations([...wholeSet()].reverse(), ENGLISH);

    expect(frozen.map((text) => text.lang)).toEqual([...FROZEN_LANGS]);
  });

  it("accepts languages that fell back, and a zh-Hant that fell back with zh", () => {
    const frozen = freezeTranslations(wholeSet({ ur: fallback("ur"), zh: fallback("zh"), "zh-Hant": fallback("zh-Hant") }), ENGLISH);

    expect(frozen.filter((text) => text.status === "fallback_en").map((text) => text.lang)).toEqual(["ur", "zh", "zh-Hant"]);
  });

  it("refuses a set with a language missing, repeated, or not one alerts are translated into", () => {
    expect(() => freezeTranslations(wholeSet().filter((text) => text.lang !== "fr"), ENGLISH)).toThrow(/missing translations: fr/);
    expect(() => freezeTranslations([...wholeSet(), ok("ur")], ENGLISH)).toThrow(/ur: translated twice/);
    expect(() => freezeTranslations([...wholeSet(), { lang: "en", body: ENGLISH, machine: false, model: null, status: "source", source_hash: SOURCE }], ENGLISH)).toThrow(TranslationSetError);
    expect(() => freezeTranslations([], ENGLISH)).toThrow(/missing translations/);
  });

  it("refuses an English fallback that is not the draft's English", () => {
    expect(() => freezeTranslations(wholeSet({ tl: fallback("tl", "Some other English.") }), ENGLISH)).toThrow(/tl: the English fallback is not the draft's English text/);
  });

  it("refuses a zh-Hant converted although zh did not pass, or converted from another zh text", () => {
    expect(() => freezeTranslations(wholeSet({ zh: fallback("zh") }), ENGLISH)).toThrow(/zh did not pass/);
    expect(() => freezeTranslations(wholeSet({ "zh-Hant": converted("another zh text") }), ENGLISH)).toThrow(/another zh text/);
  });
});
