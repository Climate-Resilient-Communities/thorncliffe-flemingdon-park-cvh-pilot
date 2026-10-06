// The sign-up for text alerts (S07.02; S07.03's staff-assisted sign-up reuses it with `startedBy: "staff"`). AD-9, AD-13, AD-22.
//
// A sign-up that passes the contract's checks (src/contracts/signup.ts) is checked here against what only the server knows: the terms
// version the form showed must be the one published now (S07.01: a sign-up records the version it showed), and the neighbourhood, the
// buildings and the floors must exist. A refusal for any of these takes no slot of the client's limit. Then the client's sign-ups are
// counted (more than 5 in an hour from one salted IP hash, that is one IP address, is refused, and nothing is stored), and in one
// transaction, where the places are checked again (a building removed in between):
//
//   1. the number is locked (an advisory lock on a hash of it), so two sign-ups for one number run one after the other;
//   2. whether it is already subscribed is asked (`SubscriberLookup`: S07.04's `subscriberLookup`, one select on `subscriber`);
//   3. its pending sign-up is deleted if its 48 hours have passed (a new sign-up then starts afresh);
//   4. in a savepoint, a pending sign-up is inserted (none when the number already has one: the unique number) and its confirmation text
//      queued (`transactional`, purpose `confirmation`, `send_by` 48 hours: the row's own `expires_at`, both from the database's clock in
//      this transaction). The savepoint is kept only for a new number; for a number already pending or subscribed it is rolled back.
//
// So the three cases do the same database work before the answer (the same statements in the same order, the savepoint released or rolled
// back at the end) and get the same answer: whether a number is known cannot be read from the reply or its timing (AD-22). Only a new
// number gets a text.
//
// The number is never logged, audited or put in an error: a refusal is a code.
//
// S07.03, the staff-assisted sign-up (`assist`): a Coordinator, an Ambassador or an Admin starts a sign-up for a resident at an event or the Hub
// desk. It is the same sign-up, checked by the same contract and written by the same transaction (`started_by = staff`, the same one
// confirmation text: the resident still replies YES themselves), with two differences. It is counted per staff account, not per client: at most
// 40 in 24 hours (ASSISTED_SIGNUP_RATE_LIMIT), and never against the residents' 5 an hour from one IP address, because a launch event or the Hub
// desk is one shared Wi-Fi from which a staff member signs up many people. And every attempt is audited as `signup.assisted`, with the staff id
// and the outcome, never the number: an accepted one inside the sign-up's transaction (the same record for a new, a pending and a subscribed
// number, so the trail cannot tell them apart either), a refused one in its own transaction afterwards.
//
// S08.05, a check-in request made with the sign-up (E08 "Request during sign-up", "Covered request"): its floor is checked with identity's
// `coversFloor` in the sign-up's transaction, for every number alike (the answer depends on the floor alone). A covered request is kept on
// the new pending sign-up until YES; an uncovered one is not kept, and the answer says so ("No ambassador covers your floor yet. Call the Hub
// at {number}"), while the rest of the sign-up is saved as usual. A request for a number already pending or subscribed is dropped with the
// rest of what the savepoint wrote.
import type { SignupCheck, SignupErrorCode, SignupRequest } from "../../../contracts/signup";
import { residentText } from "../../../i18n/residentTexts";
import type { LaunchCode } from "../../../i18n/languages";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import type { AuditEvent } from "../../audit";
import { countSms, normaliseSms, type DeliveryResult, type DeliveryView, type Enqueued, type SkippedForRecipient, type TransactionalInput } from "../../messaging";
import { pendingSignupStore, type PendingSignupStore } from "../adapters/pendingSignupStore";
import type { RateLimiter, RateLimitRule } from "./rateLimit";

/** Sign-up: more than 5 in an hour from one client is refused (S07.02, AD-22). */
export const SIGNUP_RATE_LIMIT: RateLimitRule = { scope: "signup", limit: 5, windowMs: 60 * 60_000 };

/**
 * Staff-assisted sign-up (S07.03): more than 40 started by one staff account in 24 hours is refused. Counted by the staff account's id (hashed
 * like a client's address, under its own scope), never by IP address, so a Hub event on one shared connection is not held to the residents' 5.
 * 24 hours is the rate_limit table's retention, so the whole window is still there to count.
 */
export const ASSISTED_SIGNUP_RATE_LIMIT: RateLimitRule = { scope: "signup_assisted", limit: 40, windowMs: 24 * 60 * 60_000 };

/** Twilio's error for a number that texted STOP to the sender: the provider refuses every text to it until it texts START. */
export const TWILIO_OPTED_OUT_ERROR = 21_610;

/** How a sign-up started (the `started_by` of the row). */
export type SignupChannel = "web" | "staff";

/**
 * Port: whether a number is already subscribed (S07.04's `subscriberLookup` on the subscriber table, wired by the composition root). It runs
 * inside the sign-up's transaction, after the number's lock, and does the same work whatever the answer.
 */
export interface SubscriberLookup {
  isSubscribed(tx: DbTransaction, phone: string): Promise<boolean>;
}

/** Port: the places the form may name (places' readers, wired by the composition root). */
export interface SignupPlaces {
  /** The neighbourhood ids the pilot covers. */
  neighbourhoodIds(executor: DbExecutor): Promise<string[]>;
  /** The floor ids of a building, or null when there is no building with that rsn. */
  floorIdsOf(executor: DbExecutor, rsn: string): Promise<string[] | null>;
}

/** The audit records of a staff-assisted sign-up (S07.03): `signup.assisted`, the staff id, the outcome and a refusal's code. Never the number. */
export type AssistedSignupAudit = {
  record(tx: DbTransaction, event: AuditEvent<"signup.assisted">): Promise<unknown>;
  recordRefusal(db: Db, event: AuditEvent<"signup.assisted">): Promise<unknown>;
};

/** Port: identity's `coversFloor` (AD-12, the only coverage test), asked in the sign-up's transaction for a check-in request's floor. */
export type SignupCoverage = (rsn: string, floorId: string, executor: DbExecutor) => Promise<boolean>;

export interface SignupDeps {
  db: Db;
  places: SignupPlaces;
  /** S08.05: the coverage of a check-in request's floor; a sign-up with a request is refused as unavailable without it. */
  coversFloor?: SignupCoverage;
  subscribers: SubscriberLookup;
  /** messaging's `createDeliveryQueue().enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  /** The published terms version a sign-up records, or null when nothing may be signed up to (S07.01: then every sign-up is refused). */
  consentVersion: () => string | null;
  /** The per-client limiter (salted IP hash, 24 hours); it also counts a staff account's assisted sign-ups, by a hash of its id. */
  limiter: () => RateLimiter;
  /** The audit trail of staff-assisted sign-ups (S07.03); `assist` refuses to run without it. */
  audit?: AssistedSignupAudit;
  pricePerSegmentCents: () => number;
  store?: PendingSignupStore;
  newId?: () => string;
}

export type SignupOutcome =
  /** `checkin`: what became of a check-in request (S08.05), the same for every number; absent when none was asked for. */
  | { kind: "accepted"; checkin?: "requested" | "uncovered" }
  | { kind: "refused"; code: Exclude<SignupErrorCode, "rate_limited"> }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export interface Signup {
  /** One sign-up from the web form, from the client at `clientAddress` (hashed by the limiter, never stored). */
  request(input: SignupRequest, clientAddress: string): Promise<SignupOutcome>;
  /**
   * One sign-up a staff member starts for a resident (S07.03): the contract's check of what they entered, and their staff id. Counted against
   * the staff account (ASSISTED_SIGNUP_RATE_LIMIT), never the client's address, and audited (`signup.assisted`) whatever the outcome.
   */
  assist(checked: SignupCheck, staffId: string): Promise<SignupOutcome>;
}

/** How an assisted sign-up's refusal is recorded: the audit trail's reason for it (a code; the sign-up's own code is in `meta.code`). */
const ASSISTED_REFUSAL_REASON = {
  invalid_request: "validation",
  phone_not_canadian: "validation",
  neighbourhood_missing: "validation",
  terms_not_agreed: "validation",
  age_not_confirmed: "validation",
  place_unknown: "validation",
  checkin_consent_missing: "validation",
  terms_changed: "conflict",
  rate_limited: "throttled",
  signup_unavailable: "not_available",
} as const satisfies Record<SignupErrorCode, string>;

/** The confirmation text in a language: the catalog string, normalised and counted as every outbound text is (AD-21). */
export function confirmationText(lang: LaunchCode): { body: string; segments: number } {
  const body = normaliseSms(residentText(lang, "confirmation"));
  return { body, segments: countSms(body).segments };
}

/** The confirmation could not be queued: the delivery table refused what this file built, which is a bug, never a resident's mistake. */
export class ConfirmationNotQueued extends Error {
  override name = "ConfirmationNotQueued";
  constructor(readonly refusal: string) {
    super(`The confirmation text was refused: ${refusal}`);
  }
}

/** Ends the savepoint of a number that is already pending or subscribed: what it wrote is rolled back. */
class Discard extends Error {
  override name = "Discard";
}

export function createSignup(deps: SignupDeps): Signup {
  const store = deps.store ?? pendingSignupStore;
  const newId = deps.newId ?? (() => uuidv7());

  /** Whether the neighbourhood, the buildings and the floors are on the lists the server keeps. */
  async function checkPlaces(tx: DbExecutor, input: SignupRequest): Promise<"ok" | "invalid_request" | "place_unknown"> {
    const neighbourhoods = await deps.places.neighbourhoodIds(tx);
    if (!neighbourhoods.includes(input.neighbourhood)) return "invalid_request";
    for (const place of input.places) {
      const floors = await deps.places.floorIdsOf(tx, place.rsn);
      if (floors === null || !place.floors.every((floor) => floors.includes(floor))) return "place_unknown";
    }
    return "ok";
  }

  /** The checks only the server can make (the terms version, the places), before anything is counted: a refusal's code, or null. */
  async function refusalBeforeCounting(input: SignupRequest): Promise<Exclude<SignupErrorCode, "rate_limited"> | null> {
    const version = deps.consentVersion();
    if (version === null) return "signup_unavailable";
    if (input.checkin && deps.coversFloor === undefined) return "signup_unavailable";
    if (input.consentVersion !== version) return "terms_changed";
    // A wrong building or floor is refused before the client is counted, so a mistake does not use up one of its sign-ups.
    const known = await checkPlaces(deps.db, input);
    return known === "ok" ? null : known;
  }

  /** The sign-up's one transaction (see the header); `inside` runs in it last, for every number alike (the assisted sign-up's audit record). */
  async function write(input: SignupRequest, channel: SignupChannel, inside?: (tx: DbTransaction) => Promise<void>): Promise<SignupOutcome> {
    const version = input.consentVersion;
    const { body, segments } = confirmationText(input.lang);
    const costEstimateCents = Math.ceil(segments * deps.pricePerSegmentCents());

    return deps.db.transaction(async (tx): Promise<SignupOutcome> => {
      const places = await checkPlaces(tx, input);
      if (places !== "ok") return { kind: "refused", code: places };

      // S08.05: the request's floor, for every number alike: kept only when covered.
      const request = input.checkin ?? null;
      const covered = request === null ? null : await deps.coversFloor!(request.rsn, request.floorId, tx);

      await store.lockNumber(tx, input.phone);
      const subscribed = await deps.subscribers.isSubscribed(tx, input.phone);
      await store.deleteExpired(tx, input.phone);

      // The same statements for every number; only a new one keeps them (see the header).
      const id = newId();
      try {
        await tx.transaction(async (savepoint) => {
          const inserted = await store.insert(savepoint, {
            id,
            phone: input.phone,
            lang: input.lang,
            neighbourhoodId: input.neighbourhood,
            places: input.places,
            groups: [...input.groups],
            topics: [],
            consentVersion: version,
            startedBy: channel,
            ...(request !== null && covered ? { checkin: { method: request.method, rsn: request.rsn, floorId: request.floorId, consentVersion: request.consentVersion } } : {}),
          });
          const queued = await deps.enqueue(savepoint, {
            module: "subscriptions",
            purpose: "confirmation",
            recipient: { kind: "pending_signup", id },
            subject: id,
            nonce: channel,
            lang: input.lang,
            body,
            segments,
            costEstimateCents,
          });
          if (!queued.ok) throw new ConfirmationNotQueued(queued.error);
          if (inserted === null || subscribed) throw new Discard();
        });
      } catch (error) {
        if (!(error instanceof Discard)) throw error;
      }
      await inside?.(tx);
      return covered === null ? { kind: "accepted" } : { kind: "accepted", checkin: covered ? "requested" : "uncovered" };
    });
  }

  return {
    async request(input, clientAddress) {
      const refusal = await refusalBeforeCounting(input);
      if (refusal !== null) return { kind: "refused", code: refusal };

      const counted = await deps.limiter().check(SIGNUP_RATE_LIMIT, clientAddress);
      if (!counted.allowed) return { kind: "rate_limited", retryAfterSeconds: counted.retryAfterSeconds ?? SIGNUP_RATE_LIMIT.windowMs / 1000 };

      return write(input, "web");
    },

    async assist(checked, staffId) {
      const audit = deps.audit;
      if (audit === undefined) throw new Error("The staff-assisted sign-up needs the audit trail");
      const event = (code?: SignupErrorCode): AuditEvent<"signup.assisted"> => ({
        action: "signup.assisted",
        actorStaffId: staffId,
        subjectType: "pending_signup",
        // No subject id: a pending sign-up's id would tie this record to a number (and tell a new number from a known one).
        subjectId: null,
        meta: code === undefined ? {} : { reason: ASSISTED_REFUSAL_REASON[code], code },
      });
      const refuse = async (outcome: Exclude<SignupOutcome, { kind: "accepted" }>): Promise<SignupOutcome> => {
        await audit.recordRefusal(deps.db, event(outcome.kind === "rate_limited" ? "rate_limited" : outcome.code));
        return outcome;
      };

      if (!checked.ok) {
        const code = checked.code;
        return refuse(code === "rate_limited" ? { kind: "rate_limited", retryAfterSeconds: ASSISTED_SIGNUP_RATE_LIMIT.windowMs / 1000 } : { kind: "refused", code });
      }
      const input = checked.value;
      const refusal = await refusalBeforeCounting(input);
      if (refusal !== null) return refuse({ kind: "refused", code: refusal });

      // Per staff account, never per IP address (see the header).
      const counted = await deps.limiter().check(ASSISTED_SIGNUP_RATE_LIMIT, `staff:${staffId}`);
      if (!counted.allowed) return refuse({ kind: "rate_limited", retryAfterSeconds: counted.retryAfterSeconds ?? ASSISTED_SIGNUP_RATE_LIMIT.windowMs / 1000 });

      const outcome = await write(input, "staff", async (tx) => {
        await audit.record(tx, event());
      });
      return outcome.kind === "accepted" ? outcome : refuse(outcome);
    },
  };
}

/**
 * The ContactResolver's source for `pending_signup` recipients (S06.01's `RecipientNumberSource`), wired by the composition root: the number
 * of a pending sign-up that still exists and has not expired, and only for its confirmation (E06 "Sendable (transactional)": a confirmation
 * only to a still-pending sign-up). Null otherwise, so the text is skipped. The number goes to the provider call and nowhere else.
 */
export function pendingSignupNumberSource(store: PendingSignupStore = pendingSignupStore) {
  return {
    async numberOf(tx: DbTransaction, recipientId: string, options: { consume: boolean; purpose?: string | null }): Promise<string | null> {
      if (options.purpose !== "confirmation") return null;
      return store.phoneOf(tx, recipientId);
    },
  };
}

/**
 * The sender's and the status callbacks' `afterFailure` seam for confirmations (S07.02): a confirmation the provider refused because the
 * number earlier texted STOP (Twilio 21610), whether the sender heard it at once (a permanent error) or a callback reported it later, deletes
 * the pending sign-up in the transaction that records the refusal: the resident was told on the page to text START and sign up again, and a
 * new sign-up must not find the old one. Any other refusal, or a text that is not a confirmation, is left alone.
 */
export function forgetOptedOutSignup(deps: {
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: "pending_signup"; id: string }) => Promise<SkippedForRecipient>;
  store?: PendingSignupStore;
}) {
  const store = deps.store ?? pendingSignupStore;
  return async (tx: DbTransaction, delivery: DeliveryView, errorCode: number | null): Promise<void> => {
    if (errorCode !== TWILIO_OPTED_OUT_ERROR) return;
    if (delivery.recipientKind !== "pending_signup" || delivery.purpose !== "confirmation" || delivery.recipientId === null) return;
    await deps.skipRecipientDeliveries(tx, { kind: "pending_signup", id: delivery.recipientId });
    await store.delete(tx, delivery.recipientId);
  };
}
