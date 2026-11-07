// Residents' place suggestions and the Hub's moderation of them (PRD §6.3 "Community contributions and moderation queue", D9/E4; prototype
// R-17 to R-23, O-08 to O-10), built after the signed pilot scope by the product owner's decision of 2026-11-07.
//
//  - submitPlace: what POST /api/places/submissions stores, with a new reference code. Nothing about the person (AD-3).
//  - readSubmissionStatus: what the reference code reads back (R-23): the suggestion's own words and the Hub's decision.
//  - the queue (O-08) and one suggestion (O-09), with the listed provider a correction is about;
//  - acceptSubmission / declineSubmission (O-09, O-10): a Coordinator or an Admin decides once; audited in the same transaction.
//  - listSubmissionsToApply / applySubmission: an accepted suggestion waits on the Providers page until an Admin has put it into the catalogue.
//
// Accepting never writes a provider row. A provider's listing text changes only through the catalogue scripts (AD-11): the app's role has no
// INSERT on `provider`, the seed marks any provider missing from providers.json "not in catalogue", and only a provider in the catalogue can be
// published. So an accepted new place is a task for an Admin ("from a resident, to add"), not a hidden provider the next seed would orphan.
//
// Who may decide (the policy action `moderation.review`) is the caller's guard (src/app/staff/guard.ts); a use case takes the acting staff
// member's id for the audit record. A refusal is audited in its own transaction after the change was rolled back or never started.
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  PLACE_SUBMISSION_CONTRACT_VERSION,
  type CorrectionChanges,
  type CostAnswer,
  type DeclineReason,
  type PlaceSubmissionRequest,
  type PlaceSubmissionStatus,
  type SubmissionKind,
  type SubmissionStatus,
  type WhereRecord,
  type YesNoAnswer,
} from "@/contracts/placeSubmission";
import { record, recordRefusal } from "@/modules/audit";
import type { Db } from "@/platform/db";
import { placeSubmission, provider, providerLocation } from "../adapters/schema";
import { decideApply, decideReview, makeRef, type ApplyError, type ReviewError } from "../domain/placeSubmission";

/** A suggestion as the Hub reads it. */
export interface SubmissionRecord {
  id: string;
  ref: string;
  kind: SubmissionKind;
  lang: string;
  type: "official" | "offer" | null;
  name: string;
  what: string | null;
  location: WhereRecord | null;
  category: string | null;
  phone: string | null;
  web: string | null;
  cost: CostAnswer | null;
  idRequired: YesNoAnswer | null;
  stepFree: YesNoAnswer | null;
  languages: string[] | null;
  providerId: string | null;
  changes: CorrectionChanges | null;
  status: SubmissionStatus;
  declineReason: DeclineReason | null;
  declineNote: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  createdAt: Date;
}

const COLUMNS = {
  id: placeSubmission.id,
  ref: placeSubmission.ref,
  kind: placeSubmission.kind,
  lang: placeSubmission.lang,
  type: placeSubmission.type,
  name: placeSubmission.name,
  what: placeSubmission.what,
  location: placeSubmission.location,
  category: placeSubmission.category,
  phone: placeSubmission.phone,
  web: placeSubmission.web,
  cost: placeSubmission.cost,
  idRequired: placeSubmission.idRequired,
  stepFree: placeSubmission.stepFree,
  languages: placeSubmission.languages,
  providerId: placeSubmission.providerId,
  changes: placeSubmission.changes,
  status: placeSubmission.status,
  declineReason: placeSubmission.declineReason,
  declineNote: placeSubmission.declineNote,
  decidedAt: placeSubmission.decidedAt,
  appliedAt: placeSubmission.appliedAt,
  createdAt: placeSubmission.createdAt,
} as const;

export interface SubmissionOptions {
  /** Test seams: the clock, and the random bytes a reference code is made from. */
  now?: () => Date;
  random?: (size: number) => Uint8Array;
}

const UUID = z.uuid();
/** How many times a new code is drawn when one is already taken (practically never: 30^8 codes). */
const REF_ATTEMPTS = 4;
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  return code === UNIQUE_VIOLATION || cause?.code === UNIQUE_VIOLATION;
}

/** The row a received suggestion is stored as. */
function rowOf(request: PlaceSubmissionRequest, ref: string, now: Date): typeof placeSubmission.$inferInsert {
  const base = { ref, lang: request.lang, createdAt: now };
  if (request.kind === "correct") {
    return { ...base, kind: "correct", name: request.providerName, providerId: request.providerId, changes: request.changes };
  }
  return {
    ...base,
    kind: "add",
    type: request.type,
    name: request.name,
    what: request.what,
    location: request.where.kind === "building" ? { kind: "building", rsn: request.where.rsn, text: request.where.text ?? null } : request.where,
    category: request.category ?? null,
    phone: request.phone ?? null,
    web: request.web ?? null,
    cost: request.cost ?? null,
    idRequired: request.idRequired ?? null,
    stepFree: request.stepFree ?? null,
    languages: request.languages && request.languages.length > 0 ? [...new Set(request.languages)] : null,
  };
}

/** Stores a suggestion that passed the contract and returns its reference code. */
export async function submitPlace(db: Db, request: PlaceSubmissionRequest, options: SubmissionOptions = {}): Promise<{ ref: string }> {
  const now = (options.now ?? (() => new Date()))();
  const random = options.random ?? ((size: number) => new Uint8Array(randomBytes(size)));
  for (let attempt = 1; ; attempt += 1) {
    const ref = makeRef(random(8));
    try {
      await db.insert(placeSubmission).values(rowOf(request, ref, now));
      return { ref };
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= REF_ATTEMPTS) throw error;
    }
  }
}

/** A reference code that is not stored (a honeypot's answer): the same shape as a real one, so a script cannot tell. */
export function unstoredRef(random: (size: number) => Uint8Array = (size) => new Uint8Array(randomBytes(size))): string {
  return makeRef(random(8));
}

/** What a reference code reads (R-23); null for a code no suggestion has. */
export async function readSubmissionStatus(db: Db, ref: string): Promise<PlaceSubmissionStatus | null> {
  const [row] = await db.select(COLUMNS).from(placeSubmission).where(eq(placeSubmission.ref, ref)).limit(1);
  if (!row) return null;
  return {
    v: PLACE_SUBMISSION_CONTRACT_VERSION,
    ref: row.ref,
    kind: row.kind,
    status: row.status,
    name: row.kind === "correct" ? (row.changes?.name ?? row.name) : row.name,
    what: row.what,
    where: row.location,
    where_text: row.changes?.where ?? null,
    sent_at: row.createdAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
    reason: row.declineReason,
  };
}

/** O-08: everything waiting, oldest first (the queue's order: the oldest is closest to the week residents are told), and what was decided lately. */
export async function listSubmissionQueue(db: Db, options: { now?: () => Date; decidedDays?: number } = {}): Promise<{ waiting: SubmissionRecord[]; decided: SubmissionRecord[] }> {
  const now = (options.now ?? (() => new Date()))();
  const since = new Date(now.getTime() - (options.decidedDays ?? 14) * 24 * 60 * 60 * 1000);
  const waiting = await db.select(COLUMNS).from(placeSubmission).where(eq(placeSubmission.status, "pending")).orderBy(asc(placeSubmission.createdAt), asc(placeSubmission.ref));
  const decided = await db
    .select(COLUMNS)
    .from(placeSubmission)
    .where(and(ne(placeSubmission.status, "pending"), gte(placeSubmission.decidedAt, since)))
    .orderBy(desc(placeSubmission.decidedAt))
    .limit(50);
  return { waiting, decided };
}

/** The listed provider a correction is about, as the Hub reads it now (O-09 "On the map now"). */
export interface ListedProvider {
  id: string;
  name: string;
  street: string | null;
  phone: string | null;
  web: string | null;
  published: boolean;
}

/** O-09: one suggestion, the provider a correction names (null when that id is not in the database), and the next one waiting after it. */
export async function readSubmission(
  db: Db,
  id: string,
): Promise<{ submission: SubmissionRecord; provider: ListedProvider | null; waitingCount: number; position: number | null; next: { id: string; name: string } | null } | null> {
  if (!UUID.safeParse(id).success) return null;
  const [submission] = await db.select(COLUMNS).from(placeSubmission).where(eq(placeSubmission.id, id)).limit(1);
  if (!submission) return null;
  let listed: ListedProvider | null = null;
  if (submission.providerId) {
    const [row] = await db
      .select({ id: provider.id, name: provider.name, street: providerLocation.street, contact: provider.contact, published: provider.published })
      .from(provider)
      .leftJoin(providerLocation, sql`${providerLocation.providerId} = ${provider.id} and ${providerLocation.seq} = 0`)
      .where(eq(provider.id, submission.providerId))
      .limit(1);
    if (row) listed = { id: row.id, name: row.name, street: row.street, phone: row.contact.phone?.[0] ?? null, web: row.contact.web?.[0] ?? null, published: row.published };
  }
  const waiting = await db.select({ id: placeSubmission.id, name: placeSubmission.name }).from(placeSubmission).where(eq(placeSubmission.status, "pending")).orderBy(asc(placeSubmission.createdAt), asc(placeSubmission.ref));
  const index = waiting.findIndex((row) => row.id === id);
  const next = waiting.find((row, at) => row.id !== id && (index < 0 || at > index)) ?? waiting.find((row) => row.id !== id) ?? null;
  return { submission, provider: listed, waitingCount: waiting.length, position: index < 0 ? null : index + 1, next };
}

export type ReviewResult = { ok: true; name: string; kind: SubmissionKind } | { ok: false; error: ReviewError };
export type ApplyResult = { ok: true; name: string; kind: SubmissionKind } | { ok: false; error: ApplyError };

const REFUSAL_REASON = { not_found: "not_found", already_decided: "conflict", not_accepted: "conflict", already_applied: "conflict" } as const;

async function lockSubmission(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], id: string) {
  if (!UUID.safeParse(id).success) return null;
  const [row] = await tx
    .select({ status: placeSubmission.status, kind: placeSubmission.kind, name: placeSubmission.name, appliedAt: placeSubmission.appliedAt })
    .from(placeSubmission)
    .where(eq(placeSubmission.id, id))
    .for("update");
  return row ?? null;
}

/** O-09 "Accept": the suggestion is accepted; a new place then waits for an Admin on the Providers page, a correction to be applied there. */
export async function acceptSubmission(db: Db, actorStaffId: string, id: string, options: SubmissionOptions = {}): Promise<ReviewResult> {
  const now = (options.now ?? (() => new Date()))();
  const outcome = await db.transaction(async (tx): Promise<ReviewResult> => {
    const row = await lockSubmission(tx, id);
    const decision = decideReview(row);
    if (!decision.ok) return decision;
    await tx.update(placeSubmission).set({ status: "accepted", decidedBy: actorStaffId, decidedAt: now }).where(eq(placeSubmission.id, id));
    await record(tx, { action: "submission.accepted", actorStaffId, subjectType: "place_submission", subjectId: id, meta: { kind: row!.kind } });
    return { ok: true, name: row!.name, kind: row!.kind };
  });
  if (!outcome.ok) await refuse(db, "submission.accepted", actorStaffId, id, outcome.error);
  return outcome;
}

/** O-10 "Send the reason and decline": one pre-written reason, and the Hub member's optional note for the Hub's own record. */
export async function declineSubmission(
  db: Db,
  actorStaffId: string,
  id: string,
  reason: DeclineReason,
  note: string | null,
  options: SubmissionOptions = {},
): Promise<ReviewResult> {
  const now = (options.now ?? (() => new Date()))();
  const kept = note && note.trim() !== "" ? note.trim() : null;
  const outcome = await db.transaction(async (tx): Promise<ReviewResult> => {
    const row = await lockSubmission(tx, id);
    const decision = decideReview(row);
    if (!decision.ok) return decision;
    await tx
      .update(placeSubmission)
      .set({ status: "declined", declineReason: reason, declineNote: kept, decidedBy: actorStaffId, decidedAt: now })
      .where(eq(placeSubmission.id, id));
    await record(tx, {
      action: "submission.declined",
      actorStaffId,
      subjectType: "place_submission",
      subjectId: id,
      meta: { kind: row!.kind, decline_reason: reason, ...(kept ? { with_note: true as const } : {}) },
    });
    return { ok: true, name: row!.name, kind: row!.kind };
  });
  if (!outcome.ok) await refuse(db, "submission.declined", actorStaffId, id, outcome.error);
  return outcome;
}

/** The Providers page's "From residents": accepted suggestions an Admin has not yet put into the catalogue, the oldest decision first. */
export async function listSubmissionsToApply(db: Db): Promise<SubmissionRecord[]> {
  return db
    .select(COLUMNS)
    .from(placeSubmission)
    .where(and(eq(placeSubmission.status, "accepted"), isNull(placeSubmission.appliedAt)))
    .orderBy(asc(placeSubmission.decidedAt), asc(placeSubmission.ref));
}

/** "Done" on the Providers page: the Admin has added the place to the catalogue, or applied the correction there. */
export async function applySubmission(db: Db, actorStaffId: string, id: string, options: SubmissionOptions = {}): Promise<ApplyResult> {
  const now = (options.now ?? (() => new Date()))();
  const outcome = await db.transaction(async (tx): Promise<ApplyResult> => {
    const row = await lockSubmission(tx, id);
    const decision = decideApply(row);
    if (!decision.ok) return decision;
    await tx.update(placeSubmission).set({ appliedBy: actorStaffId, appliedAt: now }).where(eq(placeSubmission.id, id));
    await record(tx, { action: "submission.applied", actorStaffId, subjectType: "place_submission", subjectId: id, meta: { kind: row!.kind } });
    return { ok: true, name: row!.name, kind: row!.kind };
  });
  if (!outcome.ok) await refuse(db, "submission.applied", actorStaffId, id, outcome.error);
  return outcome;
}

async function refuse(db: Db, action: "submission.accepted" | "submission.declined" | "submission.applied", actorStaffId: string, id: string, error: ReviewError | ApplyError) {
  await recordRefusal(db, {
    action,
    actorStaffId,
    subjectType: "place_submission",
    subjectId: UUID.safeParse(id).success ? id : null,
    meta: { reason: REFUSAL_REASON[error] },
  });
}
