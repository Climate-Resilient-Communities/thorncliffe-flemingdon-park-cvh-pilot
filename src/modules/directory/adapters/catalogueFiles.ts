// Reads the guides and essential numbers from data/catalogue/ (the only source of truth, AD-11).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LangCode } from "@/contracts/lang";
import { TRANSLATED_LANGS, type ContentInput, type GuideSource, type NumbersFile, type TranslationFile } from "../domain/guideContent";

function readJson<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
