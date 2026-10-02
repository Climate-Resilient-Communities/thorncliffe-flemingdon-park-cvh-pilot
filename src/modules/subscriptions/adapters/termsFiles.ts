// Reads the terms from a catalogue folder (data/catalogue/ or a test's copy): for scripts and tests that
// must see files changed after the build. The app itself uses bundledTerms.ts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LangCode } from "@/contracts/lang";
import { TRANSLATED_LANGS, type TranslationFile } from "@/contracts/contentReview";
import type { TermsInput, TermsSource } from "../domain/terms";

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** terms.json and translations/content/<lang>.json of a catalogue folder. A language without a file has no translations. */
export function readTermsCatalogue(catalogueDir: string): TermsInput {
  const terms = readJson<TermsSource>(path.join(catalogueDir, "terms.json"));
  const translations: Partial<Record<LangCode, TranslationFile>> = {};
  for (const lang of TRANSLATED_LANGS) {
    const file = path.join(catalogueDir, "translations", "content", `${lang}.json`);
    if (existsSync(file)) translations[lang] = readJson<TranslationFile>(file);
  }
  return { terms, translations };
}
