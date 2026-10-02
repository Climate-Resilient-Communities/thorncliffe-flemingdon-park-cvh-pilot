// Reads the guides and essential numbers from data/catalogue/ (the only source of truth, AD-11).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LangCode } from "@/contracts/lang";
import { TRANSLATED_LANGS, type ContentInput, type GuideSource, type NumbersFile, type TranslationFile } from "../domain/guideContent";
import { PROVIDER_LANGS, type ProviderCatalogueInput, type ProviderTranslationFile } from "../domain/providerCatalogue";

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * providers.json and translations/<lang>.json of a catalogue folder (the provider catalogue, S02.04). The files are
 * parsed, not checked: domain/providerCatalogue.ts checks them as a whole. A language without a file has no translations.
 */
export function readProviderCatalogue(catalogueDir: string): ProviderCatalogueInput {
  const catalogue = readJson<unknown>(path.join(catalogueDir, "providers.json"));
  const translations: ProviderCatalogueInput["translations"] = {};
  for (const lang of PROVIDER_LANGS) {
    const file = path.join(catalogueDir, "translations", `${lang}.json`);
    if (existsSync(file)) translations[lang] = readJson<ProviderTranslationFile>(file);
  }
  return { catalogue, translations };
}

/** guides.json, numbers.json and translations/content/<lang>.json of a catalogue folder. A language without a file has no translations. */
export function readContentCatalogue(catalogueDir: string): ContentInput {
  const guides = readJson<{ guides: GuideSource[] }>(path.join(catalogueDir, "guides.json")).guides;
  const numbers = readJson<NumbersFile>(path.join(catalogueDir, "numbers.json"));
  const translations: Partial<Record<LangCode, TranslationFile>> = {};
  for (const lang of TRANSLATED_LANGS) {
    const file = path.join(catalogueDir, "translations", "content", `${lang}.json`);
    if (existsSync(file)) translations[lang] = readJson<TranslationFile>(file);
  }
  return { guides, numbers, translations };
}
