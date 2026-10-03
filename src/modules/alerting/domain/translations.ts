// The one mapping from translation's `Translated` (S04.02, src/contracts/translated.ts) to what an entry freezes in
// `alert_entry_translation` (S04.03), and the check that a set of them is a whole, consistent set. Pure.
//
// Decisions (spine AD-10, "As built (S04.05)"):
//  - Vocabulary. `Translated.status` is `source | ok | fallback_en | script_converted`; the table's check
//    (`alert_entry_translation_status_valid`) is `translated | fallback_en | script_converted`. `ok` is stored as
//    `translated`; `fallback_en` and `script_converted` keep their names. `source` is the English text itself, which the
//    entry already holds as `original_text`: it is never stored as a translation, and a `source` here is refused.
//  - Machine and model are kept as translation gave them: `ok` is machine text with the model that wrote it; the zh-Hant
//    conversion is machine text whose model names OpenCC and its version ("opencc-js 1.4.2"); the English fallback is not
//    machine text and has no model. The table's own checks do not repeat these rules: `TranslatedSchema` does, and this
//    mapper runs it.
//  - The zh-Hant conversion record (`conversion`: the zh text's hash, OpenCC's version and configuration) IS kept, in
//    `alert_entry_translation.conversion`, so an approved text can be traced to the exact zh text and converter that made it.
//    It is not part of the content hash: the hash's `web_texts` is the spine's six members per language, which already
//    hold the converted body, the model naming OpenCC's version and the English source hash, and the hash's fixture is pinned.
//  - A set is whole: exactly the 15 texts alerts are translated into (the 14 launch languages but English, and zh-Hant), each once, in launch order. A `script_converted`
//    zh-Hant must come from a passing zh whose text hashes to the conversion's `from_text_hash`; a `fallback_en` carries
//    the draft's English text unchanged.
import { createHash } from "node:crypto";
import { TRANSLATED_LANGS } from "../../../contracts/alertContent";
import { TranslatedSchema, type Translated } from "../../../contracts/translated";

/** The languages an entry has a frozen translation row for: every launch language but English, and zh-Hant. */
export const FROZEN_LANGS = TRANSLATED_LANGS;

/** The zh-Hant conversion kept beside its text (`alert_entry_translation.conversion`). */
export interface FrozenConversion {
  from: "zh";
  /** SHA-256 of the zh text that was converted. */
  fromTextHash: string;
  openccVersion: string;
  config: string;
}

/** One language's web text, frozen with the entry (`alert_entry_translation`). */
export interface FrozenTranslation {
  lang: string;
  body: string;
  /** True for a machine translation; its label is shown with it. */
  machine: boolean;
  /** The model that wrote it, or OpenCC and its version for zh-Hant; null for the English fallback. */
  model: string | null;
  /** `fallback_en`: every model in the route failed, so the text is English with `translation.unavailable`. */
  status: "translated" | "fallback_en" | "script_converted";
  /** SHA-256 of the English source text it was made from. */
  sourceHash: string;
  /** zh-Hant only. */
  conversion?: FrozenConversion;
}

/** What is wrong with a set of translations: a bug in the translator or its caller, never an input. Names languages, never text. */
export class TranslationSetError extends Error {
  override name = "TranslationSetError";
}

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** One `Translated` as a frozen translation. Throws TranslationSetError for a `source` or a text that breaks the contract's own rules. */
export function translatedToFrozen(translated: Translated): FrozenTranslation {
  const parsed = TranslatedSchema.safeParse(translated);
  if (!parsed.success) throw new TranslationSetError(`${String((translated as { lang?: unknown }).lang)}: not a valid translated text`);
  const text = parsed.data;
  switch (text.status) {
    case "source":
      throw new TranslationSetError(`${text.lang}: the English source is not a translation`);
    case "ok":
      return { lang: text.lang, body: text.body, machine: text.machine, model: text.model, status: "translated", sourceHash: text.source_hash };
    case "fallback_en":
      return { lang: text.lang, body: text.body, machine: false, model: null, status: "fallback_en", sourceHash: text.source_hash };
    case "script_converted": {
      const { conversion } = text;
      return {
        lang: text.lang,
        body: text.body,
        machine: text.machine,
        model: text.model,
        status: "script_converted",
        sourceHash: text.source_hash,
        conversion: { from: "zh", fromTextHash: conversion!.from_text_hash, openccVersion: conversion!.opencc_version, config: conversion!.config },
      };
    }
  }
}

/**
 * The frozen translations of a whole set, in launch order. `english` is the draft's text: a fallback must carry it unchanged
 * and zh-Hant's conversion must be of the zh in the same set. Throws TranslationSetError for a language missing, repeated or
 * not one alerts are translated into, and for the inconsistencies above.
 */
export function freezeTranslations(set: readonly Translated[], english: string): FrozenTranslation[] {
  const frozen = set.map(translatedToFrozen);
  const seen = new Set<string>();
  for (const { lang } of frozen) {
    if (!(FROZEN_LANGS as readonly string[]).includes(lang)) throw new TranslationSetError(`${lang}: not a language alerts are translated into`);
    if (seen.has(lang)) throw new TranslationSetError(`${lang}: translated twice`);
    seen.add(lang);
  }
  const missing = FROZEN_LANGS.filter((lang) => !seen.has(lang));
  if (missing.length > 0) throw new TranslationSetError(`missing translations: ${missing.join(", ")}`);
  const byLang = new Map(frozen.map((text) => [text.lang, text]));
  for (const text of frozen) {
    if (text.status === "fallback_en" && text.body !== english) throw new TranslationSetError(`${text.lang}: the English fallback is not the draft's English text`);
  }
  const hant = byLang.get("zh-Hant")!;
  if (hant.status === "script_converted") {
    const zh = byLang.get("zh")!;
    if (zh.status !== "translated") throw new TranslationSetError("zh-Hant is converted, but zh did not pass");
    if (hant.conversion!.fromTextHash !== sha256Hex(zh.body)) throw new TranslationSetError("zh-Hant was converted from another zh text");
  }
  return FROZEN_LANGS.map((lang) => byLang.get(lang)!);
}
