// Local development only (the environment check refuses CVH_FAKE_FEED_FILE on Vercel): the feed's threads read from a JSON
// file instead of the database, for the resident page tests and their screenshots, which run with no database. The file holds
// threads the way the database holds them (an entry has its English text and, per language, its frozen translation), and
// the SAME `assembleThreads` that serves the database's rows turns them into the feed's threads, so what a test sees is what
// a resident would. It is read again on every call, so a test can change the file between two requests.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FeedAlerts } from "../application/feed";
import { assembleThreads, type ResidentEntryRow } from "../domain/residentThreads";

const TranslationSchema = z.strictObject({
  body: z.string().min(1),
  machine: z.boolean(),
  model: z.string().nullable(),
  status: z.enum(["translated", "fallback_en", "script_converted"]),
  source_hash: z.string(),
});

const EntrySchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["ack", "update", "correction", "withdrawal", "final"]),
  phase: z.enum(["problem", "in_progress"]),
  types: z.array(z.string()).min(1),
  audience: z.unknown(),
  valid_until: z.iso.datetime(),
  original_text: z.string().min(1),
  published_at: z.iso.datetime(),
  verified: z.boolean(),
  superseded: z.boolean().default(false),
  translations: z.record(z.string(), TranslationSchema).default({}),
});

const FixtureSchema = z.strictObject({
  feed_version: z.int().min(0),
  /** When the feed says it was built, so a screenshot's "Posted 20 minutes ago" is the same every day. Not given: the real time. */
  server_now: z.iso.datetime().optional(),
  threads: z.array(z.strictObject({ id: z.uuid(), slug: z.string().min(1), entries: z.array(EntrySchema).min(1) })),
});

export interface FeedFixture {
  /** The feed version the file says: the feed carries it, so a test that changes the file raises it too. */
  version(): number;
  /** The file's `server_now`, or undefined for the real clock. */
  now(): Date | undefined;
  alerts: FeedAlerts;
}

/** The threads of a fixture file, as the database's resident rows would be for `lang`. */
export function fixtureRows(text: string, lang: string): { version: number; now: Date | undefined; rows: ResidentEntryRow[] } {
  const fixture = FixtureSchema.parse(JSON.parse(text));
  const rows = fixture.threads.flatMap((thread) =>
    thread.entries.map((entry): ResidentEntryRow => {
      const translation = entry.translations[lang];
      return {
        threadId: thread.id,
        slug: thread.slug,
        entryId: entry.id,
        kind: entry.kind,
        phase: entry.phase,
        types: entry.types,
        audience: entry.audience,
        validUntil: new Date(entry.valid_until),
        originalText: entry.original_text,
        publishedAt: new Date(entry.published_at),
        verified: entry.verified,
        superseded: entry.superseded,
        translation: translation ? { body: translation.body, machine: translation.machine, model: translation.model, status: translation.status, sourceHash: translation.source_hash } : null,
      };
    }),
  );
  return { version: fixture.feed_version, now: fixture.server_now === undefined ? undefined : new Date(fixture.server_now), rows };
}

export function readFeedFixtureFile(file: string): FeedFixture {
  return {
    version: () => fixtureRows(readFileSync(file, "utf8"), "en").version,
    now: () => fixtureRows(readFileSync(file, "utf8"), "en").now,
    alerts: {
      read: async (lang) => ({
        threads: assembleThreads(fixtureRows(readFileSync(file, "utf8"), lang).rows, lang),
        statuses: { buildings: new Map(), neighbourhoods: new Map() },
      }),
    },
  };
}
