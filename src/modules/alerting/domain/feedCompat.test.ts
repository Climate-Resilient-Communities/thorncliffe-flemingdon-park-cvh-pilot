// FeedV1 stays readable by the clients already in the field (S04.08, AD-20): phones that loaded the app when S02.11 shipped parse the feed with the
// schema below, which is the one that shipped COPIED HERE VERBATIM and never edited, strict objects included. A phone cannot be updated by
// us, so what the server answers must keep parsing with it: no field it does not know, no value it does not accept. A change to FeedV1 that adds
// a REQUIRED field, or that the old schema would refuse, fails here; a change that must break old phones bumps `v` (and the route answers both).
// Old phones also keep the highest `feed_version` they have seen and discard a lower one, so the version only ever goes up (feed-state.ts).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assembleThreads, type ResidentEntryRow } from "./residentThreads";
import { AudienceSchema, NEIGHBOURHOOD_ID } from "../../../contracts/audience";
import { FeedV1, FeedThreadSchema } from "../../../contracts/feed";
import { LANG_CODES, LangCodeSchema } from "../../../contracts/lang";
import { RsnSchema } from "../../../contracts/places";

// --- the schema as S02.11 shipped it (src/contracts/feed.ts at e04-s07-approval) ------------------------------------------------------------------
const ShippedTranslated = z.strictObject({
  lang: LangCodeSchema,
  body: z.string(),
  machine: z.boolean(),
  model: z.string().nullable(),
  status: z.enum(["source", "ok", "fallback_en", "script_converted"]),
  source_hash: z.string(),
});
const ShippedEntry = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["ack", "update", "correction", "withdrawal", "final"]),
  supersedes_id: z.uuid().optional(),
  phase: z.enum(["problem", "in_progress"]).optional(),
  verified: z.boolean(),
  attribution: z.strictObject({ role: z.string(), rsn: RsnSchema.optional() }),
  published_at: z.iso.datetime(),
  text: ShippedTranslated,
  original: z.strictObject({ lang: z.literal("en"), body: z.string() }),
});
const ShippedThread = z.strictObject({
  id: z.uuid(),
  slug: z.string().min(1),
  types: z.array(z.string()).min(1),
  audience: AudienceSchema,
  state: z.enum(["open", "closed"]),
  close_reason: z.string().optional(),
  valid_until: z.iso.datetime(),
  entries: z.array(ShippedEntry).min(1),
});
const ShippedPlace = { status: z.enum(["none", "active", "in_progress", "resolved"]), verified: z.boolean() };
const ShippedFeedV1 = z.strictObject({
  v: z.literal(1),
  feed_version: z.int().min(0),
  server_now: z.iso.datetime(),
  threads: z.array(ShippedThread),
  places: z.strictObject({
    buildings: z.array(z.strictObject({ rsn: RsnSchema, ...ShippedPlace })),
    neighbourhoods: z.array(z.strictObject({ id: z.string().regex(NEIGHBOURHOOD_ID), ...ShippedPlace })),
  }),
});
// ---------------------------------------------------------------------------------------------------------------------------------------------

const E = (n: number) => `0198a000-0000-7000-8000-0000000003${String(n).padStart(2, "0")}`;
const AUDIENCE = { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };
const HASH = "c".repeat(64);

const rows = (translated: boolean): ResidentEntryRow[] => [
  {
    threadId: E(1),
    slug: "kbcdfghj",
    entryId: E(11),
    kind: "ack",
    phase: "problem",
    types: ["power"],
    audience: AUDIENCE,
    validUntil: new Date("2026-10-02T15:00:00Z"),
    originalText: "Power is out.",
    publishedAt: new Date("2026-10-01T14:00:00Z"),
    verified: true,
    superseded: false,
    translation: translated ? { body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "translated", sourceHash: HASH } : null,
  },
  {
    threadId: E(1),
    slug: "kbcdfghj",
    entryId: E(12),
    kind: "update",
    phase: "in_progress",
    types: ["power", "elevator"],
    audience: AUDIENCE,
    validUntil: new Date("2026-10-03T15:00:00Z"),
    originalText: "Power is back on floors 1 to 4.",
    publishedAt: new Date("2026-10-01T16:00:00Z"),
    verified: false,
    superseded: false,
    translation: null,
  },
];

const feedWith = (threads: unknown[]) => ({
  v: 1,
  feed_version: 9,
  server_now: "2026-10-01T17:00:00.000Z",
  threads,
  places: { buildings: [{ rsn: "4154146", status: "active", verified: true }], neighbourhoods: [{ id: "TP", status: "none", verified: true }] },
});

describe("FeedV1 as the clients in the field read it", () => {
  it("accepts what the server now answers for every language, with and without a translation, English and fallback included", () => {
    for (const lang of LANG_CODES) {
      for (const translated of [true, false]) {
        const feed = feedWith(assembleThreads(rows(translated), lang));

        const shipped = ShippedFeedV1.safeParse(feed);
        expect(shipped.success, `${lang} translated=${translated}: ${shipped.success ? "" : JSON.stringify(shipped.error.issues)}`).toBe(true);
        expect(FeedV1.safeParse(feed).success, lang).toBe(true);
      }
    }
  });

  it("is the same schema in what it requires: no field a shipped client does not know, none it requires that this one does not", () => {
    const keysOf = (schema: z.ZodObject<z.ZodRawShape>) => Object.keys(schema.shape).sort();

    expect(keysOf(FeedV1)).toEqual(keysOf(ShippedFeedV1));
    expect(keysOf(FeedThreadSchema)).toEqual(keysOf(ShippedThread));
    const entryOf = (schema: z.ZodObject<z.ZodRawShape>) => (schema.shape.entries as z.ZodArray<z.ZodObject<z.ZodRawShape>>).element;
    expect(keysOf(entryOf(FeedThreadSchema))).toEqual(keysOf(entryOf(ShippedThread)));
    const requiredKeys = (schema: z.ZodObject<z.ZodRawShape>) => Object.entries(schema.shape).filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success).map(([key]) => key).sort();
    expect(requiredKeys(entryOf(FeedThreadSchema))).toEqual(requiredKeys(entryOf(ShippedThread)));
    expect(requiredKeys(FeedThreadSchema)).toEqual(requiredKeys(ShippedThread));
  });

  it("accepts every sample the current schema's own tests use, so neither side moved", () => {
    const thread = assembleThreads(rows(true), "ur")[0];
    expect(FeedV1.safeParse(feedWith([thread])).success).toBe(true);
    expect(ShippedFeedV1.safeParse(feedWith([thread])).success).toBe(true);
  });

  it("is refused by the shipped schema when a field is added: the very check an old phone makes, so a new field would blank every old phone's alerts", () => {
    const thread = assembleThreads(rows(true), "ur")[0];

    expect(ShippedFeedV1.safeParse(feedWith([{ ...thread, banner: "x" }])).success).toBe(false);
    expect(ShippedFeedV1.safeParse(feedWith([{ ...thread, entries: [{ ...thread.entries[0], conversion: { from: "zh" } }] }])).success).toBe(false);
    expect(ShippedFeedV1.safeParse({ ...feedWith([thread]), resident: "x" }).success).toBe(false);
  });
});
