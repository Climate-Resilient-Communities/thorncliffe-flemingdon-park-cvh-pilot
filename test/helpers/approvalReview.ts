// An entry as the approval view reads it (S04.07), for the tests of the view model, the component and the layout: a pending acknowledgement of a
// building with its frozen web texts and text messages, with what a test needs to change given as options. Not a database row: the use case's own
// `EntryReview`, built by hand, so the tests of the screens need no database.
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { LangCode } from "../../src/contracts/lang";
import type { EntryReview, EntryView, ReviewedText, ThreadView } from "../../src/modules/alerting";
import type { StaffRole } from "../../src/contracts/staffRoles";
import type { BuildingFloorPlan } from "../../src/modules/places";

export const ALERT = "01900000-0000-7000-8000-00000000a1e7";
export const ENTRY = "01900000-0000-7000-8000-00000000e177";
export const OTHER_ALERT = "01900000-0000-7000-8000-00000000a1e8";
export const OTHER_ENTRY = "01900000-0000-7000-8000-00000000e178";
export const AUTHOR = "01900000-0000-7000-8000-0000000000c1";
export const APPROVER = "01900000-0000-7000-8000-0000000000c2";
export const HASH = "d".repeat(64);
export const SUBMITTED = new Date("2026-10-04T14:00:00.000Z");

export const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;

export const PLANS: BuildingFloorPlan[] = [
  {
    rsn: "4154146",
    address: "4 Milepost Pl",
    neighbourhoodId: "TP",
    neighbourhoodName: "Thorncliffe Park",
    floors: ["G", "1", "2", "3", "4", "5"].map((label, index) => ({ id: floorId("4154146", index), label, sortOrder: index })),
  },
  { rsn: "4154159", address: "85-95 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [] },
];

/** The fifteen languages an entry is translated into (every launch language but English, and zh-Hant), in the order the screens list them. */
export const TRANSLATED: readonly Exclude<LangCode, "en">[] = ["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr", "zh-Hant"];

export const ENGLISH = "The elevator at 4 Milepost Pl is out of service. We are finding out more. More information to come.";

export interface ReviewOptions {
  entry?: Partial<EntryView>;
  thread?: Partial<ThreadView>;
  authorRole?: StaffRole | null;
  /** The languages whose text fell back to English. */
  fallback?: readonly string[];
  /** Words used for every translated text and text message body (the layout tests give the longest labels). */
  words?: { web?: string; sms?: string };
  /** Texting open (E07): the count and its languages. Left out: texting is not open, nobody is counted. */
  recipients?: { open: boolean } & RecipientCounts;
  duplicate?: EntryReview["duplicate"];
  /** The audience the thread has now, for an update (S05.01): what the view compares the entry's own audience with. */
  threadAudience?: EntryReview["threadAudience"];
}

/** A pending acknowledgement, version 2, with every text frozen. */
export function reviewOf(options: ReviewOptions = {}): EntryReview {
  const types = ["elevator", "power"];
  const fallback = new Set(options.fallback ?? []);
  const texts: ReviewedText[] = TRANSLATED.map((lang) =>
    fallback.has(lang)
      ? { lang, body: ENGLISH, status: "fallback_en", machine: false, model: null }
      : { lang, body: options.words?.web ?? `[${lang}] ${ENGLISH}`, status: lang === "zh-Hant" ? "script_converted" : "translated", machine: true, model: lang === "zh-Hant" ? "opencc-js" : "command-a-translate" },
  );
  const sms: EntryReview["sms"] = Object.fromEntries(
    ["en", ...TRANSLATED.filter((lang) => lang !== "zh-Hant")].map((lang) => [lang, { body: options.words?.sms ?? `Hub: ${lang === "en" ? ENGLISH : `[${lang}] ${ENGLISH}`}\nhttps://cvh.example/a/abcd2345\nReply STOP`, encoding: lang === "en" ? "gsm7" : "ucs2", segments: lang === "en" ? 2 : 4 }]),
  ) as EntryReview["sms"];
  const entry: EntryView = {
    id: ENTRY,
    alertId: ALERT,
    kind: "ack",
    status: "pending_approval",
    authorId: AUTHOR,
    editorIds: [AUTHOR],
    content: {
      text: ENGLISH,
      types,
      audience: {
        scope: "buildings",
        buildings: [
          { rsn: "4154146", floors: [floorId("4154146", 3), floorId("4154146", 4)] },
          { rsn: "4154159", floors: null },
        ],
        groups: ["seniors"],
        types,
      },
      phase: "problem",
      validUntil: new Date("2026-10-05T14:00:00.000Z"),
      validUntilMode: "at",
    },
    version: 2,
    contentHash: HASH,
    submittedAt: SUBMITTED,
    returnedFor: null,
    returnedNote: null,
    approvedBy: null,
    approvedAt: null,
    webPublishedAt: null,
    possibleDuplicateOf: options.duplicate ? options.duplicate.alertId : null,
    ...options.entry,
  };
  return {
    thread: { id: ALERT, slug: "abcd2345", isDrill: false, reportedAt: new Date("2026-10-04T13:30:00.000Z"), status: "open", ...options.thread },
    entry,
    authorRole: options.authorRole === undefined ? "coordinator" : options.authorRole,
    texts: entry.status === "draft" || entry.status === "discarded" ? [] : texts,
    sms: entry.status === "draft" || entry.status === "discarded" ? {} : sms,
    recipients: options.recipients ?? { open: false, total: 0, byLanguage: {} },
    duplicate: options.duplicate ?? null,
    threadAudience: options.threadAudience ?? null,
  };
}
