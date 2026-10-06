// A resident's access request (S09.03, E09 "Access request", PIPEDA; the access-request screen is deferred to the MVP): the use cases behind
// scripts/access-request, which IT runs with production's credentials on an Admin's behalf. A request has no table: it is two audit records with the request
// as the subject (`access_request.received`, `access_request.closed`), whose actor is the Admin who handled it, and which hold no number, no name and nothing
// that was held. The weekly review (S09.04's `weekly_review`) reads them to flag a request open longer than 25 days.
//
//   receive            records a new request (what the resident asked for); a rehearsal's is marked as a drill, so the review reports it apart.
//   open               the requests still open, oldest first, with the days each has been open (by the database's clock, as the weekly review counts).
//   lookUp             everything held for the number, in ONE read-only transaction (Postgres refuses any write in it), for an open request only: the
//                      subscriber, places, groups, muted topics, consent version, retention state (S09.07's re-consent, with where the campaign stands
//                      for them: asked before its deadline, past it, or cancelled by the owner), prompt (with where the resident is in a text menu,
//                      S07.05) and edit link (S07.06, never its hash); a pending sign-up; waiting replies; the texts held for those records (never their
//                      words); the keyed hashes of the number in `rate_limit`; S08.05's check-in request, on the subscriber and on the pending sign-up;
//                      check-in records (through a port: checkins' rows that still name the subscriber, `checkinRowRecords`); and what holds the
//                      number's records that it cannot read yet (a column or a table added since, a prompt's step it does not know). Nothing is
//                      recorded or changed.
//   deleteForResident  after verified control, the one E07 deletion (deletion.ts, the steps STOP, S07.06's edit page and S09.08's purge run) and the
//                      request's `closed` record (`deleted`), in one transaction: both commit or neither does. Refused while a `checkin` table exists and
//                      E08's deletion port is not wired here (scripts/access-request wires checkins' real one, S08.05).
//   close              the request's `closed` record with how it ended (answered, not verified, withdrawn).
//
// Verified control is the Admin's call back to the number (or the resident's one-time phrase texted from it, procedures/access-request.md): the script makes
// IT confirm it before a lookup or a deletion. The number goes into the reads and the deletion only; it is never logged, audited or returned whole.
import { ACCESS_REQUEST_KINDS, readAuditRecords, record as auditRecord, type AuditEvent } from "../../audit";
import { subscriberCheckinRows } from "../../checkins";
import { readStaffByUsername, readStaffName } from "../../identity";
import { createDeliveryQueue, maskNumber, textsToRecipients, type RecipientKind, type SkippedForRecipient } from "../../messaging";
import { addressesOfBuildings, floorsOfBuilding } from "../../places";
import { canadianNumber } from "../../../contracts/signup";
import { englishText } from "../../../i18n/text";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { accessRequestStore, type AccessRequestStore, type HeldCheckinRequestRow } from "../adapters/accessRequestStore";
import { campaignStore } from "../adapters/campaignStore";
import { hashScopeOf } from "../adapters/inboundStore";
import {
  CLOSING_OUTCOMES,
  checkinRowWords,
  menuStepWords,
  openRequests,
  standingOf,
  wholeDays,
  type AccessRequestKind,
  type ClosingOutcome,
  type HeldCheckinRequest,
  type HeldCheckins,
  type HeldPlace,
  type HeldPrompt,
  type HeldReconsent,
  type HeldRecord,
  type OpenRequest,
  type RequestRecord,
} from "../domain/accessRequest";
import { readMenu } from "../domain/menus";
import { createNumberDeletion, type Deleted } from "./deletion";
import { noCheckinsYet, type CheckinCleanup } from "./inbound";
import { clientHash } from "./rateLimit";

/** The subject type of a request's audit records. */
export const ACCESS_REQUEST_SUBJECT = "access_request";
const ACTIONS = ["access_request.received", "access_request.closed"] as const;
type RequestAction = (typeof ACTIONS)[number];

/**
 * Port: `checkins`' reader of a subscriber's check-in records (E08), for the lookup: `checkinRowRecords` (S08.05), which scripts/access-request wires. Where it
 * is not wired, the lookup asks the catalog whether a `checkin` table exists (`checkinTableCheck`): none means none are held; one that exists while this port
 * is not wired is reported as unreadable, so a request is never answered as complete while a table of residents' records goes unread.
 */
export interface CheckinRecords {
  recordsOf(executor: DbExecutor, subscriberId: string): Promise<HeldCheckins>;
}

/** Why the Admin named was refused: no such account, not an Admin, or an Admin who is suspended or removed. */
export type AdminRefusal = "no_such_admin" | "not_admin" | "admin_not_active";
/** Why a request was refused: never received, or already closed. */
export type RequestRefusal = "not_found" | "closed";
/** A number that is not Canadian: nothing can be held for it (sign-up accepts only Canadian numbers). */
export type NumberRefusal = "not_canadian";
/** A `checkin` table exists and E08's deletion port is not wired into this use case: the deletion would leave the resident's check-in rows behind. */
export type CheckinRefusal = "checkins_not_wired";

type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export type OpenAccessRequest = OpenRequest & { receivedByName: string | null };

export interface AccessRequests {
  receive(input: { admin: string; request: AccessRequestKind; rehearsal?: boolean }): Promise<Result<{ id: string }, AdminRefusal>>;
  open(): Promise<OpenAccessRequest[]>;
  lookUp(input: { id: string; number: string }): Promise<Result<HeldRecord, RequestRefusal | NumberRefusal>>;
  deleteForResident(input: { id: string; number: string; admin: string }): Promise<Result<Deleted & { daysOpen: number }, AdminRefusal | RequestRefusal | NumberRefusal | CheckinRefusal>>;
  close(input: { id: string; admin: string; outcome: ClosingOutcome }): Promise<Result<{ daysOpen: number }, AdminRefusal | RequestRefusal>>;
}

export interface AccessRequestDeps {
  db: Db;
  /** The key of the number's keyed hashes in `rate_limit`: the rate limiter's, derived from the Supabase secret key (src/app/signup.ts#rateLimitKey). */
  numberKey: () => string;
  /** messaging's `skipRecipientDeliveries` (default: the outbox's own). */
  skipRecipientDeliveries?: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  /**
   * `checkins`' deletion port (E07 handoffs), as the inbound router is given it. Until E08 wires it (left out, or `noCheckinsYet`), a deletion is refused
   * while a `checkin` table exists, as the lookup reports such a table unreadable.
   */
  checkins?: CheckinCleanup;
  /** `checkins`' reader of a subscriber's records (until E08: `checkinTableCheck`). */
  checkinRecords?: CheckinRecords;
  /** Test seams. */
  audit?: { record: <A extends RequestAction>(tx: DbTransaction, event: AuditEvent<A>) => Promise<void> };
  store?: AccessRequestStore;
  newId?: () => string;
}

/** Until E08: a `checkin` table that exists is one this lookup cannot read yet. */
export function checkinTableCheck(store: AccessRequestStore = accessRequestStore): CheckinRecords {
  return { recordsOf: async (executor) => ((await store.tableExists(executor, "checkin")) ? { kind: "unreadable" } : { kind: "not_built" }) };
}

/** Places as they are read out: each building's address and each floor's label (a floor or building no longer in the register says so). */
async function placesOf(executor: DbExecutor, rows: readonly { rsn: string; floorId: string | null }[]): Promise<HeldPlace[]> {
  const addresses = await addressesOfBuildings(executor, [...new Set(rows.map((row) => row.rsn))]);
  const labels = new Map<string, Map<string, string>>();
  for (const rsn of new Set(rows.map((row) => row.rsn))) labels.set(rsn, new Map(((await floorsOfBuilding(executor, rsn)) ?? []).map((floor) => [floor.id, floor.label])));
  return rows.map((row) => ({
    rsn: row.rsn,
    address: addresses.get(row.rsn) ?? null,
    floor: row.floorId === null ? null : (labels.get(row.rsn)?.get(row.floorId) ?? "a floor no longer in the register"),
  }));
}

/** A check-in request (S08.05) as it is read out, its "where I live" place in words. */
async function checkinRequestOf(executor: DbExecutor, request: HeldCheckinRequestRow | null): Promise<HeldCheckinRequest | null> {
  if (request === null) return null;
  const [place] = await placesOf(executor, [{ rsn: request.rsn, floorId: request.floorId }]);
  return { method: request.method, consentVersion: request.consentVersion, place: place! };
}

/**
 * checkins' rows that still name the subscriber (S08.05: live, or kept after a close for the Hub's follow-up; a closed stub names no one), read out in words
 * with their place. The reader scripts/access-request wires as `checkinRecords`.
 */
export const checkinRowRecords: CheckinRecords = {
  async recordsOf(executor, subscriberId) {
    const rows = await subscriberCheckinRows(executor, subscriberId);
    const places = await placesOf(executor, rows);
    return { kind: "rows", rows: rows.map((row, n) => ({ at: row.createdAt, description: checkinRowWords(row, places[n]!) })) };
  },
};

function neighbourhoodName(id: string): string {
  try {
    return `${englishText(`neighbourhoods.${id}`)} (${id})`;
  } catch {
    return id;
  }
}

export function createAccessRequests(deps: AccessRequestDeps): AccessRequests {
  const store = deps.store ?? accessRequestStore;
  const audit = deps.audit ?? { record: auditRecord };
  const newId = deps.newId ?? (() => uuidv7());
  const checkinRecords = deps.checkinRecords ?? checkinTableCheck(store);
  const checkinsWired = deps.checkins !== undefined && deps.checkins !== noCheckinsYet;
  const deletion = createNumberDeletion({
    skipRecipientDeliveries: deps.skipRecipientDeliveries ?? ((tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient)),
    checkins: deps.checkins ?? noCheckinsYet,
  });

  /** The Admin who handled the request: an active Admin's account, found by username. */
  async function adminOf(executor: DbExecutor, username: string): Promise<Result<{ id: string }, AdminRefusal>> {
    const staff = await readStaffByUsername(executor, username);
    if (!staff) return { ok: false, error: "no_such_admin" };
    if (staff.role !== "admin") return { ok: false, error: "not_admin" };
    if (staff.status !== "active") return { ok: false, error: "admin_not_active" };
    return { ok: true, value: { id: staff.id } };
  }

  /** The requests' own records (only `ok` ones: a request is never refused into the trail). */
  async function recordsOf(executor: DbExecutor, id?: string): Promise<RequestRecord[]> {
    const rows = await readAuditRecords(executor, { subjectType: ACCESS_REQUEST_SUBJECT, actions: ACTIONS, ...(id === undefined ? {} : { subjectId: id }) });
    return rows.flatMap((row) =>
      row.outcome === "ok" && row.subjectId !== null && (row.action === "access_request.received" || row.action === "access_request.closed")
        ? [{ action: row.action, at: row.at, subjectId: row.subjectId, actorStaffId: row.actorStaffId, isDrill: row.isDrill, meta: row.meta }]
        : [],
    );
  }

  /** Locks the request and reads where it stands: open, or why not. */
  async function lockOpen(tx: DbTransaction, id: string): Promise<Result<{ receivedAt: Date; isDrill: boolean }, RequestRefusal>> {
    await store.lockRequest(tx, id);
    const standing = standingOf(await recordsOf(tx, id), id);
    if (standing.kind === "unknown") return { ok: false, error: "not_found" };
    if (standing.kind === "closed") return { ok: false, error: "closed" };
    return { ok: true, value: { receivedAt: standing.receivedAt, isDrill: standing.isDrill } };
  }

  /**
   * The subscriber's open prompt, with where the resident is in a text menu in words. A step it cannot read (a prompt that is not a menu and holds one, or a
   * menu's step that is not one) is reported as not read, so the request is not answered as complete.
   */
  async function promptOf(tx: DbTransaction, subscriberId: string): Promise<{ prompt: HeldPrompt | null; unreadStep: boolean }> {
    const row = await store.promptOf(tx, subscriberId);
    if (!row) return { prompt: null, unreadStep: false };
    const menu = readMenu(row.kind, row.step);
    if (menu === null) {
      const empty = typeof row.step === "object" && row.step !== null && !Array.isArray(row.step) && Object.keys(row.step).length === 0;
      return { prompt: { kind: row.kind, since: row.since, until: row.until, step: null }, unreadStep: !empty };
    }
    const rsn = menu.kind === "menu_building" && menu.step.stage === "floor" ? menu.step.rsn : null;
    const addresses = rsn === null ? new Map<string, string>() : await addressesOfBuildings(tx, [rsn]);
    return { prompt: { kind: row.kind, since: row.since, until: row.until, step: menuStepWords(menu, (id) => addresses.get(id) ?? null) }, unreadStep: false };
  }

  /**
   * Where a `reconsent_pending` subscriber stands in the end-of-pilot campaign (S09.07), by the database's clock and in the lookup's own read-only
   * transaction: asked before the deadline, past it, or asked by a campaign the owner cancelled; with the deadline's Toronto day. Null for any other state.
   */
  async function reconsentOf(tx: DbTransaction, subscriber: { id: string; retentionState: string }): Promise<HeldReconsent | null> {
    if (subscriber.retentionState !== "reconsent_pending") return null;
    const standing = await campaignStore.reconsentOf(tx, subscriber.id);
    if (standing === "cancelled") return { kind: "cancelled" };
    if (standing === null) return null;
    const campaign = await campaignStore.real(tx);
    return campaign === null ? null : { kind: standing, deadlineDate: campaign.deadlineDate };
  }

  async function read(tx: DbTransaction, phone: string): Promise<HeldRecord> {
    const sub = await store.subscriberOf(tx, phone);
    const pending = await store.pendingOf(tx, phone);
    const replies = await store.repliesOf(tx, phone);
    const recipients: { kind: RecipientKind; id: string }[] = [
      ...(sub ? [{ kind: "subscriber" as const, id: sub.id }] : []),
      ...(pending ? [{ kind: "pending_signup" as const, id: pending.id }] : []),
      ...replies.map((reply) => ({ kind: "inbound_reply" as const, id: reply.id })),
    ];
    const key = deps.numberKey();
    const scopes = await store.hashScopes(tx);
    // A column or a table added since this lookup was written holds part of a record only where that record exists for the number.
    const owners = { subscriber: sub !== null, pending_signup: pending !== null, inbound_reply: replies.length > 0 };
    const unread = (await store.unreadHoldings(tx)).filter((holding) => owners[holding.owner]).map((holding) => holding.what);
    const prompt = sub ? await promptOf(tx, sub.id) : { prompt: null, unreadStep: false };
    if (prompt.unreadStep) unread.push("sms_prompt.step (a step this script cannot read)");
    return {
      maskedNumber: maskNumber(phone),
      subscriber: sub
        ? {
            since: sub.since,
            lang: sub.lang,
            neighbourhood: neighbourhoodName(sub.neighbourhoodId),
            groups: sub.groups,
            consentVersion: sub.consentVersion,
            startedBy: sub.startedBy,
            retentionState: sub.retentionState,
            reconsent: await reconsentOf(tx, sub),
            places: await placesOf(tx, await store.placesOf(tx, sub.id)),
            mutedTopics: await store.mutedTopicsOf(tx, sub.id),
            prompt: prompt.prompt,
            editLink: await store.editLinkOf(tx, sub.id),
            checkinRequest: await checkinRequestOf(tx, sub.checkinRequest),
          }
        : null,
      pending: pending
        ? {
            since: pending.since,
            expiresAt: pending.expiresAt,
            expired: pending.expired,
            lang: pending.lang,
            neighbourhood: neighbourhoodName(pending.neighbourhoodId),
            groups: pending.groups,
            topics: pending.topics,
            consentVersion: pending.consentVersion,
            startedBy: pending.startedBy,
            // A building with no floors chosen is one place with no floor.
            places: await placesOf(
              tx,
              pending.places.flatMap((place): { rsn: string; floorId: string | null }[] =>
                place.floors.length === 0 ? [{ rsn: place.rsn, floorId: null }] : place.floors.map((floorId) => ({ rsn: place.rsn, floorId })),
              ),
            ),
            checkinRequest: await checkinRequestOf(tx, pending.checkinRequest),
          }
        : null,
      replies: replies.map((reply) => ({ since: reply.since, expiresAt: reply.expiresAt })),
      texts: await textsToRecipients(tx, recipients),
      // Each hash as its writer made it: the inbound limit's mute row holds the hash made under `inbound` (hashScopeOf).
      hashes: await store.hashTraces(tx, scopes.map((scope) => ({ scope, hash: clientHash(key, hashScopeOf(scope), phone) }))),
      // Check-in records belong to a subscriber (E08 keeps no number on them), so a number with no subscriber has none.
      checkins: sub ? await checkinRecords.recordsOf(tx, sub.id) : { kind: "rows", rows: [] },
      unread,
    };
  }

  return {
    async receive({ admin, request, rehearsal = false }) {
      if (!(ACCESS_REQUEST_KINDS as readonly string[]).includes(request)) throw new Error("access request: not a kind of request");
      return deps.db.transaction(async (tx) => {
        const actor = await adminOf(tx, admin);
        if (!actor.ok) return actor;
        const id = newId();
        await audit.record(tx, { action: "access_request.received", actorStaffId: actor.value.id, subjectType: ACCESS_REQUEST_SUBJECT, subjectId: id, isDrill: rehearsal, meta: { request } });
        return { ok: true as const, value: { id } };
      });
    },

    async open() {
      const open = openRequests(await recordsOf(deps.db), await store.now(deps.db));
      const names = new Map<string, string | null>();
      for (const request of open) {
        if (request.receivedBy !== null && !names.has(request.receivedBy)) names.set(request.receivedBy, await readStaffName(deps.db, request.receivedBy));
      }
      return open.map((request) => ({ ...request, receivedByName: request.receivedBy === null ? null : (names.get(request.receivedBy) ?? null) }));
    },

    async lookUp({ id, number }) {
      const phone = canadianNumber(number);
      if (phone === null) return { ok: false, error: "not_canadian" };
      return deps.db.transaction(
        async (tx): Promise<Result<HeldRecord, RequestRefusal>> => {
          const standing = standingOf(await recordsOf(tx, id), id);
          if (standing.kind === "unknown") return { ok: false, error: "not_found" };
          if (standing.kind === "closed") return { ok: false, error: "closed" };
          return { ok: true, value: await read(tx, phone) };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async deleteForResident({ id, number, admin }) {
      const phone = canadianNumber(number);
      if (phone === null) return { ok: false, error: "not_canadian" };
      return deps.db.transaction(async (tx): Promise<Result<Deleted & { daysOpen: number }, AdminRefusal | RequestRefusal | CheckinRefusal>> => {
        const actor = await adminOf(tx, admin);
        if (!actor.ok) return actor;
        const open = await lockOpen(tx, id);
        if (!open.ok) return open;
        // As the lookup reports a `checkin` table it cannot read: a deletion that cannot reach the resident's check-in rows is not done at all.
        if (!checkinsWired && (await store.tableExists(tx, "checkin"))) return { ok: false, error: "checkins_not_wired" };
        const deleted = await deletion.deleteNumber(tx, phone);
        await audit.record(tx, { action: "access_request.closed", actorStaffId: actor.value.id, subjectType: ACCESS_REQUEST_SUBJECT, subjectId: id, isDrill: open.value.isDrill, meta: { outcome: "deleted" } });
        return { ok: true, value: { ...deleted, daysOpen: wholeDays(open.value.receivedAt, await store.now(tx)) } };
      });
    },

    async close({ id, admin, outcome }) {
      // `deleted` is written only by the deletion itself, in its own transaction.
      if (!CLOSING_OUTCOMES.includes(outcome)) throw new Error("access request: not an outcome a request can be closed with");
      return deps.db.transaction(async (tx): Promise<Result<{ daysOpen: number }, AdminRefusal | RequestRefusal>> => {
        const actor = await adminOf(tx, admin);
        if (!actor.ok) return actor;
        const open = await lockOpen(tx, id);
        if (!open.ok) return open;
        await audit.record(tx, { action: "access_request.closed", actorStaffId: actor.value.id, subjectType: ACCESS_REQUEST_SUBJECT, subjectId: id, isDrill: open.value.isDrill, meta: { outcome } });
        return { ok: true, value: { daysOpen: wholeDays(open.value.receivedAt, await store.now(tx)) } };
      });
    },
  };
}
