// Shared by the alert screens' unit tests: a feed thread to draw, and the catalog of a language as a translator reads it. Not shipped (a test file's
// neighbour, imported by tests only).
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import type { FeedThread } from "@/contracts/feed";
import type { LaunchCode } from "@/i18n/languages";
import en from "@/i18n/messages/en.json";
import fr from "@/i18n/messages/fr.json";
import ur from "@/i18n/messages/ur.json";
import type { Translate } from "./alert-view";

const CATALOGS: Partial<Record<LaunchCode, unknown>> = { en, ur, fr };

/** The catalog of `lang` as the pages read it (translated, or English behind its "[EN]" marker). */
export function translatorFor(lang: LaunchCode): Translate {
  const messages = CATALOGS[lang];
  if (!messages) throw new Error(`no catalog loaded for ${lang}`);
  return createTranslator({ locale: lang, messages: messages as unknown as AbstractIntlMessages }) as unknown as Translate;
}

export const ID = (n: number) => `0198a000-0000-7000-8000-0000000002${String(n).padStart(2, "0")}`;
export const HASH = "a".repeat(64);
export const SERVER_NOW = new Date("2026-10-01T15:00:00.000Z");
export const ENGLISH = "The elevator at 85 Thorncliffe Park Dr is out of service. Please use the stairs and call the Hub if you need help.";
export const URDU = "85 تھورنکلف پارک ڈرائیو کی لفٹ بند ہے۔ براہ کرم سیڑھیاں استعمال کریں اور مدد کی ضرورت ہو تو ہب کو کال کریں۔";

type Entry = FeedThread["entries"][number];

export function entry(over: Partial<Entry> & { n?: number } = {}): Entry {
  const { n = 1, ...rest } = over;
  return {
    id: ID(n),
    kind: "ack",
    phase: "problem",
    verified: true,
    attribution: { role: "hub" },
    published_at: "2026-10-01T14:40:00.000Z",
    text: { lang: "ur", body: URDU, machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: HASH },
    original: { lang: "en", body: ENGLISH },
    ...rest,
  };
}

export function thread(over: Partial<FeedThread> = {}): FeedThread {
  return {
    id: ID(90),
    slug: "kbcdfghj",
    types: ["elevator"],
    audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["elevator"] },
    state: "open",
    valid_until: "2026-10-01T19:00:00.000Z",
    entries: [entry()],
    ...over,
  };
}

/** An entry whose text is the English standing in for a translation that failed. */
export const fallbackEntry = (over: Partial<Entry> & { n?: number } = {}): Entry =>
  entry({ text: { lang: "ur", body: ENGLISH, machine: false, model: null, status: "fallback_en", source_hash: HASH }, ...over });

/** An entry in English, for an English reader. */
export const englishEntry = (over: Partial<Entry> & { n?: number } = {}): Entry =>
  entry({ text: { lang: "en", body: ENGLISH, machine: false, model: null, status: "source", source_hash: HASH }, ...over });
