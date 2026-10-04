// Local development only (the environment check refuses CVH_FAKE_FEED_FILE on Vercel): the feed's threads read from a JSON
// file instead of the database, for the resident page tests and their screenshots, which run with no database. The file holds
// threads the way the database holds them (an entry has its English text and, per language, its frozen translation), and
// the SAME `assembleThreads` that serves the database's rows turns them into the feed's threads, so what a test sees is what
// a resident would. It is read again on every call, so a test can change the file between two requests.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FeedAlerts } from "../application/feed";
import { AudienceSchema } from "../../../contracts/audience";
import { ARCHIVE_PAGE_SIZE } from "../../../contracts/feed";
import { assembleArchive, assembleClosedThread, assembleThreads, type ArchiveHead, type ResidentEntryRow } from "../domain/residentThreads";
import { RESOLVED_WINDOW_MS, type StatusThread } from "../domain/status";
import type { EntryKind } from "../domain/lifecycle";

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
  supersedes_id: z.uuid().optional(),
  translations: z.record(z.string(), TranslationSchema).default({}),
});

const FixtureSchema = z.strictObject({
  feed_version: z.int().min(0),
  /** When the feed says it was built, so a screenshot's "Posted 20 minutes ago" is the same every day. Not given: the real time. */
  server_now: z.iso.datetime().optional(),
  threads: z.array(
    z.strictObject({
      id: z.uuid(),
      slug: z.string().min(1),
      /** A thread that closed (S05.03): it is not in the feed, and R-07 shows it by its address with how it closed. */
      closed: z.enum(["resolved", "expired", "withdrawn"]).optional(),
      /** When it closed (S05.06: a resolved status lasts 12 hours from it). Not given: the time of its last entry. */
      closed_at: z.iso.datetime().optional(),
      entries: z.array(EntrySchema).min(1),
    }),
  ),
});

export interface FeedFixture {
  /** The feed version the file says: the feed carries it, so a test that changes the file raises it too. */
  version(): number;
  /** The file's `server_now`, or undefined for the real clock. */
  now(): Date | undefined;
  alerts: FeedAlerts;
}

/** The threads of a fixture file, as the database's resident rows would be for `lang`. */
export function fixtureRows(text: string, lang: string, closed = false): { version: number; now: Date | undefined; rows: ResidentEntryRow[]; reasons: Map<string, string> } {
  const fixture = FixtureSchema.parse(JSON.parse(text));
  // The open threads for the feed, or the closed ones (`closed`) for the address of a thread that closed.
  const wanted = fixture.threads.filter((thread) => (thread.closed !== undefined) === closed);
  const reasons = new Map(wanted.flatMap((thread) => (thread.closed === undefined ? [] : [[thread.id, thread.closed] as const])));
  const rows = wanted.flatMap((thread) =>
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
        supersedesId: entry.supersedes_id ?? null,
        translation: translation ? { body: translation.body, machine: translation.machine, model: translation.model, status: translation.status, sourceHash: translation.source_hash } : null,
      };
    }),
  );
  return { version: fixture.feed_version, now: fixture.server_now === undefined ? undefined : new Date(fixture.server_now), rows, reasons };
}

/** The status threads of a fixture file (S05.06): its open threads, and those closed `resolved` within 12 hours of `now`. */
export function fixtureStatusThreads(text: string, now: Date): StatusThread[] {
  const fixture = FixtureSchema.parse(JSON.parse(text));
  return fixture.threads.flatMap((thread): StatusThread[] => {
    const lastEntry = Math.max(...thread.entries.map((entry) => Date.parse(entry.published_at)));
    const closedAt = thread.closed === undefined ? null : new Date(thread.closed_at ?? lastEntry);
    if (thread.closed !== undefined && !(thread.closed === "resolved" && closedAt !== null && now.getTime() - closedAt.getTime() < RESOLVED_WINDOW_MS)) return [];
    return [
      {
        id: thread.id,
        slug: thread.slug,
        state: thread.closed === undefined ? "open" : "closed",
        closeReason: thread.closed ?? null,
        closedAt,
        entries: thread.entries.flatMap((entry) => {
          const audience = AudienceSchema.safeParse(entry.audience);
          return [{ id: entry.id, kind: entry.kind as EntryKind, phase: entry.phase, verified: entry.verified, superseded: entry.superseded, publishedAt: new Date(entry.published_at), audience: audience.success ? audience.data : null }];
        }),
      },
    ];
  });
}

/** The closed threads of a fixture file as the archive's heads: newest closed first, ties by id (the database's order). */
export function fixtureArchiveHeads(text: string): ArchiveHead[] {
  const fixture = FixtureSchema.parse(JSON.parse(text));
  return fixture.threads
    .flatMap((thread) => {
      if (thread.closed === undefined) return [];
      const lastEntry = Math.max(...thread.entries.map((entry) => Date.parse(entry.published_at)));
      return [{ threadId: thread.id, reason: thread.closed as string | null, closedAt: new Date(thread.closed_at ?? lastEntry) }];
    })
    .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime() || (a.threadId < b.threadId ? 1 : a.threadId > b.threadId ? -1 : 0));
}

export function readFeedFixtureFile(file: string): FeedFixture {
  return {
    version: () => fixtureRows(readFileSync(file, "utf8"), "en").version,
    now: () => fixtureRows(readFileSync(file, "utf8"), "en").now,
    alerts: {
      read: async (lang) => ({
        threads: assembleThreads(fixtureRows(readFileSync(file, "utf8"), lang).rows, lang),
      }),
      readStatusThreads: async (now) => fixtureStatusThreads(readFileSync(file, "utf8"), now),
      readArchive: async (lang, page, size = ARCHIVE_PAGE_SIZE) => {
        const text = readFileSync(file, "utf8");
        const heads = fixtureArchiveHeads(text);
        const shown = heads.slice((page - 1) * size, page * size);
        return { threads: assembleArchive(fixtureRows(text, lang, true).rows, lang, shown), hasMore: heads.length > page * size };
      },
      readClosedSlugs: async () => [...new Set(fixtureRows(readFileSync(file, "utf8"), "en", true).rows.map((row) => row.slug))],
      readClosed: async (lang, slug) => {
        const { rows, reasons } = fixtureRows(readFileSync(file, "utf8"), lang, true);
        const own = rows.filter((row) => row.slug === slug);
        return assembleClosedThread(own, lang, own.length === 0 ? null : (reasons.get(own[0].threadId) ?? null));
      },
    },
  };
}
