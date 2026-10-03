// The wire contracts of Submit (S04.05, AD-20): what the composer's browser sends to submit an entry or to try its translation
// again, and the entry's authoritative state it fetches when it did not see the outcome (the connection dropped, the tab was closed,
// the server errored). Every body has a `v`. Pure and browser-safe: it imports only zod and the language list.
//
// An expected outcome is a success body with a `state` (spine: Errors): a submit that was refused before anything started
// (`refused`), one that ended without freezing anything (`failed`), one still running (`running`) and one that froze the entry
// (`committed`) are all 200. Each carries the outcome code, never text: the composer has the messages in its English catalog.
import { z } from "zod";
import { LangCodeSchema } from "./lang";

/** The key a browser makes for one press of Submit (`crypto.randomUUID()`): 16 to 64 letters, digits, hyphens and underscores. */
export const SUBMIT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * How long a `running` attempt may be taken to be alive: the submit function's own time limit (`maxDuration` of the submit route, 60 s) and a
 * margin. After that its function is gone, whatever the row says, and the server reads the attempt as failed (SUBMIT_ABANDONED). The
 * browser waits this long, from the moment it lost an answer, for a sign of its key before it says the request could not be confirmed.
 * test/submitBudget.test.ts keeps this above the function's limit.
 */
export const ATTEMPT_STALE_MS = 90_000;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const SubmitKey = z.string().regex(SUBMIT_KEY_PATTERN);
/** A refusal or failure code of the alerting module (`DRAFT_CHANGED`, `ROUTES_UNAVAILABLE`, ...). */
const OutcomeCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/);

const RequestBase = z.strictObject({
  v: z.literal(1),
  alert_id: z.uuid(),
  entry_id: z.uuid(),
  key: SubmitKey,
});

/**
 * Submit. `draft` is the fingerprint of the draft as the browser saved it just before pressing (the answer of the save): a draft that is
 * not that when the submit begins (someone else saved in between) is refused with DRAFT_CHANGED, so nobody freezes text they never saw.
 * Left out, the draft as it is when the submit begins is taken.
 */
export const SubmitRequestSchema = RequestBase.extend({ draft: Sha256.optional() });
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

/** "Try translation again": the version and hash of the pending entry the person was looking at, so a changed entry is refused. */
export const RetranslateRequestSchema = RequestBase.extend({
  seen_version: z.number().int().min(1),
  seen_hash: Sha256,
});
export type RetranslateRequest = z.infer<typeof RetranslateRequestSchema>;

/** How a language's text came to be, as the composer lists it. */
export const LANGUAGE_RESULTS = ["translated", "script_converted", "fallback_en"] as const;
export const LanguageResultSchema = z.enum(LANGUAGE_RESULTS);
export type LanguageResult = z.infer<typeof LanguageResultSchema>;

export const ATTEMPT_STATES = ["running", "committed", "failed"] as const;

export const AttemptSchema = z.strictObject({
  key: SubmitKey,
  kind: z.enum(["submit", "retranslate"]),
  state: z.enum(ATTEMPT_STATES),
  /** Why a failed attempt failed. */
  outcome: OutcomeCode.nullable(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  /** The longest route deadline plus 5 s, in milliseconds, once known. */
  budget_ms: z.number().int().positive().nullable(),
  /** Each language's result as it settled while the attempt ran. */
  progress: z.partialRecord(LangCodeSchema, LanguageResultSchema),
  result_version: z.number().int().positive().nullable(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const EntryStateSchema = z.strictObject({
  v: z.literal(1),
  /** The server's clock, so the screen counts progress from it, not from a phone's. */
  server_now: z.iso.datetime(),
  entry: z.strictObject({
    id: z.uuid(),
    alert_id: z.uuid(),
    kind: z.enum(["ack", "update", "correction", "withdrawal", "final"]),
    status: z.enum(["draft", "pending_approval", "approved", "discarded", "superseded", "published_system"]),
    version: z.number().int().min(0),
    content_hash: Sha256.nullable(),
    possible_duplicate_of: z.uuid().nullable(),
  }),
  /** The latest attempt, if there is one. */
  attempt: AttemptSchema.nullable(),
  /** The frozen translations of an entry that has been submitted. */
  translations: z.array(z.strictObject({ lang: LangCodeSchema, status: LanguageResultSchema, machine: z.boolean() })),
});
export type EntryState = z.infer<typeof EntryStateSchema>;

export const SUBMIT_STATES = ["committed", "running", "failed", "refused"] as const;

export const SubmitResultSchema = z.strictObject({
  v: z.literal(1),
  state: z.enum(SUBMIT_STATES),
  /** Why a `failed` or `refused` submit did not freeze anything. */
  outcome: OutcomeCode.nullable(),
  /** The entry as stored after the press; null when there is no such entry. */
  entry_state: EntryStateSchema.nullable(),
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;
