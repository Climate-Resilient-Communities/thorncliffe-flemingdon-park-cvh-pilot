import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FeedThreadSchema } from "../../../contracts/feed";
import type { LangCode } from "../../../contracts/lang";
import { HUB_ATTRIBUTION, assembleArchive, assembleClosedThread, assembleThreads, textOf, type ResidentEntryRow } from "./residentThreads";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const T1 = "0198a000-0000-7000-8000-0000000000a1";
const T2 = "0198a000-0000-7000-8000-0000000000a2";
const E = (n: number) => `0198a000-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

const AUDIENCE = { scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], groups: [], types: ["power"] };
const NEIGHBOURHOOD = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power", "elevator"] };

const row = (over: Partial<ResidentEntryRow> = {}): ResidentEntryRow => ({
  threadId: T1,
  slug: "kbcdfghj",
  entryId: E(1),
  kind: "ack",
  phase: "problem",
  types: ["power"],
  audience: AUDIENCE,
  validUntil: new Date("2026-10-02T15:00:00Z"),
  originalText: "Power is out in 88 Test Dr. We are on it.",
  publishedAt: new Date("2026-10-01T14:00:00Z"),
  verified: true,
  superseded: false,
  translation: null,
  ...over,
});

const urdu = { body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "translated", sourceHash: sha("Power is out in 88 Test Dr. We are on it.") };

describe("an entry's text for a reader (AD-20 Translated)", () => {
  it("is the entry's own English for English: source, not machine, no model, the hash of that text", () => {
    expect(textOf(row(), "en")).toEqual({ lang: "en", body: "Power is out in 88 Test Dr. We are on it.", machine: false, model: null, status: "source", source_hash: sha("Power is out in 88 Test Dr. We are on it.") });
  });

  it("is the frozen translation for another language: ok, machine, with the model that wrote it and the hash it carries", () => {
    expect(textOf(row({ translation: urdu }), "ur")).toEqual({ lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: urdu.sourceHash });
  });

  it("is script_converted for zh-Hant, naming the conversion as its model", () => {
    const hant = { body: "停電了。", machine: true, model: "opencc-js 1.4.2", status: "script_converted", sourceHash: sha("x") };
    expect(textOf(row({ translation: hant }), "zh-Hant")).toEqual({ lang: "zh-Hant", body: "停電了。", machine: true, model: "opencc-js 1.4.2", status: "script_converted", source_hash: sha("x") });
  });

  it("is the English with fallback_en when every model failed: the language asked for, not machine, no model", () => {
    const failed = { body: "Power is out in 88 Test Dr. We are on it.", machine: false, model: null, status: "fallback_en", sourceHash: sha("Power is out in 88 Test Dr. We are on it.") };

    expect(textOf(row({ translation: failed }), "ps")).toEqual({
      lang: "ps",
      body: "Power is out in 88 Test Dr. We are on it.",
      machine: false,
      model: null,
      status: "fallback_en",
      source_hash: sha("Power is out in 88 Test Dr. We are on it."),
    });
  });

  it("is the English with fallback_en when the language has no frozen text at all: never a text in a language it was not translated into", () => {
    expect(textOf(row({ translation: null }), "ta")).toMatchObject({ lang: "ta", body: "Power is out in 88 Test Dr. We are on it.", status: "fallback_en", machine: false, model: null });
  });

  it("is the English with fallback_en when a row says something that is not a passing translation, whatever its body", () => {
    expect(textOf(row({ translation: { ...urdu, status: "unknown" } }), "ur")).toMatchObject({ status: "fallback_en", body: "Power is out in 88 Test Dr. We are on it." });
    expect(textOf(row({ translation: { ...urdu, machine: false } }), "ur")).toMatchObject({ status: "fallback_en" });
    expect(textOf(row({ translation: { ...urdu, model: null } }), "ur")).toMatchObject({ status: "fallback_en" });
  });

  it("never offers an English reader a translation row", () => {
    expect(textOf(row({ translation: urdu }), "en")).toMatchObject({ status: "source", body: "Power is out in 88 Test Dr. We are on it." });
  });
});

describe("the threads of the feed", () => {
  it("makes a thread with its entry, original, attribution (the Hub, no person), verification and publication time", () => {
    const [thread] = assembleThreads([row({ translation: urdu })], "ur");

    expect(thread).toEqual({
      id: T1,
      slug: "kbcdfghj",
      types: ["power"],
      audience: AUDIENCE,
      state: "open",
      valid_until: "2026-10-02T15:00:00.000Z",
      entries: [
        {
          id: E(1),
          kind: "ack",
          phase: "problem",
          verified: true,
          attribution: { role: "hub" },
          published_at: "2026-10-01T14:00:00.000Z",
          text: { lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "ok", source_hash: urdu.sourceHash },
          original: { lang: "en", body: "Power is out in 88 Test Dr. We are on it." },
        },
      ],
    });
    expect(FeedThreadSchema.parse(thread)).toEqual(thread);
  });

  it("names the Hub and never a person: the attribution has a role and nothing else", () => {
    expect(HUB_ATTRIBUTION).toEqual({ role: "hub" });
    for (const entry of assembleThreads([row()], "en")[0].entries) expect(Object.keys(entry.attribution)).toEqual(["role"]);
  });

  it("is a thread the contract (and so a client in the field) accepts in every language, and adds no field the contract does not name", () => {
    for (const lang of ["en", "ur", "zh-Hant"] as LangCode[]) {
      const [thread] = assembleThreads([row({ translation: lang === "en" ? null : urdu })], lang);
      expect(FeedThreadSchema.safeParse(thread).success, lang).toBe(true);
      expect(Object.keys(thread).sort()).toEqual(["audience", "entries", "id", "slug", "state", "types", "valid_until"]);
      expect(Object.keys(thread.entries[0]).sort()).toEqual(["attribution", "id", "kind", "original", "phase", "published_at", "text", "verified"]);
    }
  });

  it("names the entry a correction or a withdrawal replaces (S05.02), and no other entry names one; the withdrawal's reason is its own text, not a field the phones in the field would refuse", () => {
    const rows = [
      row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z"), superseded: true }),
      row({ entryId: E(2), kind: "correction", supersedesId: E(1), publishedAt: new Date("2026-10-01T15:00:00Z") }),
      row({ entryId: E(3), kind: "withdrawal", supersedesId: E(2), publishedAt: new Date("2026-10-01T16:00:00Z"), originalText: "This alert had wrong information. It has been withdrawn." }),
    ];
    const [thread] = assembleThreads(rows, "en");

    expect(thread.entries.map((entry) => [entry.id, entry.supersedes_id])).toEqual([[E(1), undefined], [E(2), E(1)], [E(3), E(2)]]);
    expect(thread.entries[2].text.body).toBe("This alert had wrong information. It has been withdrawn.");
    expect(Object.keys(thread.entries[2]).sort()).toEqual(["attribution", "id", "kind", "original", "published_at", "supersedes_id", "text", "verified"]);
    expect(FeedThreadSchema.safeParse(thread).success).toBe(true);
  });

  it("marks an entry that is not verified as such", () => {
    expect(assembleThreads([row({ verified: false })], "en")[0].entries[0].verified).toBe(false);
  });

  it("gives a phase only to the entries that have one (ack, update, correction), not to a final or a withdrawal", () => {
    const rows = [
      row({ entryId: E(1), kind: "ack", publishedAt: new Date("2026-10-01T14:00:00Z") }),
      row({ entryId: E(2), kind: "update", phase: "in_progress", publishedAt: new Date("2026-10-01T15:00:00Z") }),
      row({ entryId: E(3), kind: "final", publishedAt: new Date("2026-10-01T16:00:00Z") }),
      row({ entryId: E(4), kind: "withdrawal", publishedAt: new Date("2026-10-01T17:00:00Z") }),
    ];

    expect(assembleThreads(rows, "en")[0].entries.map((entry) => [entry.kind, entry.phase])).toEqual([
      ["ack", "problem"],
      ["update", "in_progress"],
      ["final", undefined],
      ["withdrawal", undefined],
    ]);
  });

  it("keeps a thread's entries in the order they were published, oldest first, whatever order the rows came in", () => {
    const rows = [
      row({ entryId: E(3), publishedAt: new Date("2026-10-01T16:00:00Z") }),
      row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z") }),
      row({ entryId: E(2), publishedAt: new Date("2026-10-01T15:00:00Z") }),
    ];

    expect(assembleThreads(rows, "en")[0].entries.map((entry) => entry.id)).toEqual([E(1), E(2), E(3)]);
  });

  it("orders entries published at the same moment by id, so the order never changes between two reads", () => {
    const at = new Date("2026-10-01T14:00:00Z");
    expect(assembleThreads([row({ entryId: E(2), publishedAt: at }), row({ entryId: E(1), publishedAt: at })], "en")[0].entries.map((entry) => entry.id)).toEqual([E(1), E(2)]);
    expect(assembleThreads([row({ entryId: E(1), publishedAt: at }), row({ entryId: E(2), publishedAt: at })], "en")[0].entries.map((entry) => entry.id)).toEqual([E(1), E(2)]);
  });

  it("takes the thread's types, audience and valid-until from its covering entry: the latest published one that is not superseded", () => {
    const rows = [
      row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z"), types: ["power"], audience: AUDIENCE, validUntil: new Date("2026-10-02T15:00:00Z") }),
      row({ entryId: E(2), kind: "update", publishedAt: new Date("2026-10-01T16:00:00Z"), types: ["power", "elevator"], audience: NEIGHBOURHOOD, validUntil: new Date("2026-10-03T15:00:00Z") }),
    ];

    const [thread] = assembleThreads(rows, "en");

    expect(thread.types).toEqual(["power", "elevator"]);
    expect(thread.audience).toEqual(NEIGHBOURHOOD);
    expect(thread.valid_until).toBe("2026-10-03T15:00:00.000Z");
    expect(thread.entries).toHaveLength(2);
  });

  it("does not let a superseded or a withdrawal entry cover a thread when a live substantive one is there", () => {
    const rows = [
      row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z"), validUntil: new Date("2026-10-02T15:00:00Z") }),
      row({ entryId: E(2), kind: "update", publishedAt: new Date("2026-10-01T15:00:00Z"), validUntil: new Date("2026-10-04T15:00:00Z"), superseded: true }),
      row({ entryId: E(3), kind: "withdrawal", publishedAt: new Date("2026-10-01T16:00:00Z"), validUntil: new Date("2026-10-09T15:00:00Z") }),
    ];

    expect(assembleThreads(rows, "en")[0].valid_until).toBe("2026-10-02T15:00:00.000Z");
  });

  it("falls back to the latest entry when no live substantive one is left", () => {
    const rows = [
      row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z"), superseded: true }),
      row({ entryId: E(2), kind: "withdrawal", publishedAt: new Date("2026-10-01T16:00:00Z"), validUntil: new Date("2026-10-09T15:00:00Z") }),
    ];

    expect(assembleThreads(rows, "en")[0].valid_until).toBe("2026-10-09T15:00:00.000Z");
  });

  it("makes one thread per thread, newest activity first, ties by id", () => {
    const rows = [
      row({ threadId: T1, slug: "aaaaaaaa", entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z") }),
      row({ threadId: T2, slug: "bbbbbbbb", entryId: E(2), publishedAt: new Date("2026-10-01T15:00:00Z") }),
      row({ threadId: T1, slug: "aaaaaaaa", entryId: E(3), kind: "update", publishedAt: new Date("2026-10-01T16:00:00Z") }),
    ];

    expect(assembleThreads(rows, "en").map((thread) => [thread.slug, thread.entries.length])).toEqual([
      ["aaaaaaaa", 2],
      ["bbbbbbbb", 1],
    ]);
    const tied = [row({ threadId: T2, slug: "bbbbbbbb", entryId: E(2) }), row({ threadId: T1, slug: "aaaaaaaa", entryId: E(1) })];
    expect(assembleThreads(tied, "en").map((thread) => thread.id)).toEqual([T1, T2]);
  });

  it("is empty when there is nothing published", () => {
    expect(assembleThreads([], "en")).toEqual([]);
  });

  it("gives each language its own text in the same thread, and the same thread for everyone who reads that language", () => {
    const rows = [row({ translation: urdu })];

    expect(assembleThreads(rows, "ur")).toEqual(assembleThreads(rows, "ur"));
    expect(assembleThreads(rows, "ur")[0].entries[0].text.body).toBe("بجلی بند ہے۔");
    expect(assembleThreads(rows, "en")[0].entries[0].text.body).toBe("Power is out in 88 Test Dr. We are on it.");
  });
});

describe("a closed thread (S05.03, R-07)", () => {
  const ack = row({ entryId: E(1), publishedAt: new Date("2026-10-01T14:00:00Z") });
  const update = row({ entryId: E(2), kind: "update", phase: "in_progress", publishedAt: new Date("2026-10-01T15:00:00Z"), originalText: "Work is under way." });
  const final = row({ entryId: E(3), kind: "final", phase: "in_progress", publishedAt: new Date("2026-10-01T16:00:00Z"), originalText: "Power is back on all floors.", validUntil: new Date("2026-10-02T16:00:00Z") });

  it("is a thread of state closed with its close reason, every entry in order and the final last, which has no phase of its own", () => {
    const thread = assembleClosedThread([update, final, ack], "en", "resolved")!;

    expect(FeedThreadSchema.safeParse(thread).success).toBe(true);
    expect(thread).toMatchObject({ id: T1, slug: "kbcdfghj", state: "closed", close_reason: "resolved" });
    expect(thread.entries.map((entry) => [entry.kind, entry.phase])).toEqual([["ack", "problem"], ["update", "in_progress"], ["final", undefined]]);
    expect(thread.entries.at(-1)!.text.body).toBe("Power is back on all floors.");
    // The thread's own fields follow the covering entry, which is the final.
    expect(thread.valid_until).toBe("2026-10-02T16:00:00.000Z");
  });

  it("reads the expire job's final with the origin of the entry it closed: verified by the Hub for an alert the Hub approved (UAT F-2)", () => {
    // The system final is the only final nobody approves: verified false, no attribution of its own.
    const expiry = row({ entryId: E(5), kind: "final", phase: "in_progress", verified: false, publishedAt: new Date("2026-10-02T15:01:00Z"), originalText: "This alert has expired without a further update." });
    const thread = assembleClosedThread([ack, update, expiry], "en", "expired")!;
    expect(thread.entries.at(-1)).toMatchObject({ kind: "final", verified: true, attribution: HUB_ATTRIBUTION });
    // The entries before it keep their own.
    expect(thread.entries.map((entry) => entry.verified)).toEqual([true, true, true]);
    // An ambassador's post residents read as "Not yet verified" (D-1) that ran out before anyone approved it stays the post's: its building, not yet verified.
    const post = row({ entryId: E(6), kind: "update", verified: false, attributedRsn: "4154146", publishedAt: new Date("2026-10-01T14:00:00Z") });
    const ranOut = assembleClosedThread([post, expiry], "en", "expired")!;
    expect(ranOut.entries.at(-1)).toMatchObject({ kind: "final", verified: false, attribution: { role: "ambassador", rsn: "4154146" } });
    // A corrected entry is not what the final closed: the correction that replaced it is.
    const corrected = row({ entryId: E(7), verified: false, superseded: true, attributedRsn: "4154146", publishedAt: new Date("2026-10-01T14:00:00Z") });
    const correction = row({ entryId: E(8), kind: "correction", supersedesId: E(7), publishedAt: new Date("2026-10-01T14:30:00Z") });
    expect(assembleClosedThread([corrected, correction, expiry], "en", "expired")!.entries.at(-1)).toMatchObject({ verified: true, attribution: HUB_ATTRIBUTION });
    // An approved final is its own.
    expect(assembleClosedThread([post, final], "en", "resolved")!.entries.at(-1)).toMatchObject({ verified: true, attribution: HUB_ATTRIBUTION });
  });

  it("takes each of the three reasons, and none that is not one of them, and nothing for no rows", () => {
    for (const reason of ["resolved", "expired", "withdrawn"]) expect(assembleClosedThread([ack], "en", reason)?.close_reason, reason).toBe(reason);
    expect(assembleClosedThread([ack], "en", "archived")).toBeNull();
    expect(assembleClosedThread([ack], "en", null)).toBeNull();
    expect(assembleClosedThread([], "en", "resolved")).toBeNull();
  });

  it("is not made by the feed: assembleThreads makes open threads only", () => {
    expect(assembleThreads([ack, final], "en")[0]).toMatchObject({ state: "open" });
    expect(assembleThreads([ack, final], "en")[0]).not.toHaveProperty("close_reason");
  });

  it("keeps a thread withdrawn whole: the withdrawal notice is among its entries and names the entry it replaced", () => {
    const withdrawal = row({ entryId: E(4), kind: "withdrawal", supersedesId: E(1), publishedAt: new Date("2026-10-01T14:30:00Z"), originalText: "This alert has been withdrawn." });
    const thread = assembleClosedThread([row({ entryId: E(1), superseded: true }), withdrawal], "en", "withdrawn")!;
    expect(thread).toMatchObject({ state: "closed", close_reason: "withdrawn" });
    expect(thread.entries.map((entry) => [entry.kind, entry.supersedes_id])).toEqual([["ack", undefined], ["withdrawal", E(1)]]);
  });
});

describe("assembleArchive (S05.07)", () => {
  const final = (threadId: string, slug: string) => row({ threadId, slug, kind: "final", phase: "resolved", entryId: E(threadId === T1 ? 1 : 2) });

  it("keeps the order of the heads (newest closed first) and serialises closed_at", () => {
    const heads = [
      { threadId: T2, reason: "expired", closedAt: new Date("2026-10-03T10:00:00Z") },
      { threadId: T1, reason: "resolved", closedAt: new Date("2026-10-02T10:00:00Z") },
    ];
    const threads = assembleArchive([final(T1, "kbcdfghj"), final(T2, "mnpqrstv")], "en", heads);

    expect(threads.map((thread) => thread.slug)).toEqual(["mnpqrstv", "kbcdfghj"]);
    expect(threads.map((thread) => thread.close_reason)).toEqual(["expired", "resolved"]);
    expect(threads.map((thread) => thread.closed_at)).toEqual(["2026-10-03T10:00:00.000Z", "2026-10-02T10:00:00.000Z"]);
    expect(threads.every((thread) => thread.state === "closed")).toBe(true);
  });

  it("leaves out a head with no published entry or an unknown reason, so a page can hold fewer threads than its size", () => {
    const heads = [
      { threadId: T2, reason: "resolved", closedAt: new Date("2026-10-03T10:00:00Z") },
      { threadId: T1, reason: "archived", closedAt: new Date("2026-10-02T10:00:00Z") },
    ];

    expect(assembleArchive([final(T1, "kbcdfghj")], "en", heads)).toEqual([]);
  });
});
