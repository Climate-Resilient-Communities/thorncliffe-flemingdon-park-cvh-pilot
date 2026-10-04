// The sign-up for text alerts (S07.02; S07.03's staff-assisted sign-up reuses it with `startedBy: "staff"`). AD-9, AD-13, AD-22.
//
// A sign-up that passes the contract's checks (src/contracts/signup.ts) is checked here against what only the server knows: the terms
// version the form showed must be the one published now (S07.01: a sign-up records the version it showed), and the neighbourhood, the
// buildings and the floors must exist. Then the client's sign-ups are counted (more than 5 in an hour from one salted IP hash is refused,
// and nothing is stored), and in one transaction:
//
//   1. the number is locked (an advisory lock on a hash of it), so two sign-ups for one number run one after the other;
//   2. whether it is already subscribed is asked (`SubscriberLookup`: S07.04 creates the subscriber table and wires the real lookup);
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
import type { SignupErrorCode, SignupRequest } from "../../../contracts/signup";
import { residentText } from "../../../i18n/residentTexts";
import type { LaunchCode } from "../../../i18n/languages";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { countSms, normaliseSms, type DeliveryResult, type DeliveryView, type Enqueued, type SkippedForRecipient, type TransactionalInput } from "../../messaging";
import { pendingSignupStore, type PendingSignupStore } from "../adapters/pendingSignupStore";
import type { RateLimiter, RateLimitRule } from "./rateLimit";

/** Sign-up: more than 5 in an hour from one client is refused (S07.02, AD-22). */
export const SIGNUP_RATE_LIMIT: RateLimitRule = { scope: "signup", limit: 5, windowMs: 60 * 60_000 };

/** Twilio's error for a number that texted STOP to the sender: the provider refuses every text to it until it texts START. */
export const TWILIO_OPTED_OUT_ERROR = 21_610;

/** How a sign-up started (the `started_by` of the row). */
export type SignupChannel = "web" | "staff";

/**
 * Port: whether a number is already subscribed. S07.04 creates `subscriber` and wires a lookup on it; until then nobody can be subscribed,
 * and the lookup answers false (it reads nothing). It runs inside the sign-up's transaction, after the number's lock.
 */
export interface SubscriberLookup {
  isSubscribed(tx: DbTransaction, phone: string): Promise<boolean>;
}

/** Until S07.04: no subscriber table, so no number is subscribed. */
export const noSubscribersYet: SubscriberLookup = { isSubscribed: async () => false };

/** Port: the places the form may name (places' readers, wired by the composition root). */
export interface SignupPlaces {
  /** The neighbourhood ids the pilot covers. */
  neighbourhoodIds(executor: DbExecutor): Promise<string[]>;
  /** The floor ids of a building, or null when there is no building with that rsn. */
  floorIdsOf(executor: DbExecutor, rsn: string): Promise<string[] | null>;
}

export interface SignupDeps {
  db: Db;
  places: SignupPlaces;
  subscribers: SubscriberLookup;
  /** messaging's `createDeliveryQueue().enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  /** The published terms version a sign-up records, or null when nothing may be signed up to (S07.01: then every sign-up is refused). */
  consentVersion: () => string | null;
  /** The per-client limiter (salted IP hash, 24 hours). */
  limiter: () => RateLimiter;
  pricePerSegmentCents: () => number;
  store?: PendingSignupStore;
  newId?: () => string;
}

export type SignupOutcome =
  | { kind: "accepted" }
  | { kind: "refused"; code: Exclude<SignupErrorCode, "rate_limited"> }
  | { kind: "rate_limited"; retryAfterSeconds: number };

export interface Signup {
  /** One sign-up, from the client at `clientAddress` (hashed by the limiter, never stored). */
  request(input: SignupRequest, clientAddress: string, channel?: SignupChannel): Promise<SignupOutcome>;
}

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
  async function checkPlaces(tx: DbTransaction, input: SignupRequest): Promise<"ok" | "invalid_request" | "place_unknown"> {
    const neighbourhoods = await deps.places.neighbourhoodIds(tx);
    if (!neighbourhoods.includes(input.neighbourhood)) return "invalid_request";
    for (const place of input.places) {
      const floors = await deps.places.floorIdsOf(tx, place.rsn);
      if (floors === null || !place.floors.every((floor) => floors.includes(floor))) return "place_unknown";
    }
    return "ok";
  }

  return {
    async request(input, clientAddress, channel = "web") {
      const version = deps.consentVersion();
      if (version === null) return { kind: "refused", code: "signup_unavailable" };
      if (input.consentVersion !== version) return { kind: "refused", code: "terms_changed" };

      const counted = await deps.limiter().check(SIGNUP_RATE_LIMIT, clientAddress);
      if (!counted.allowed) return { kind: "rate_limited", retryAfterSeconds: counted.retryAfterSeconds ?? SIGNUP_RATE_LIMIT.windowMs / 1000 };

      const { body, segments } = confirmationText(input.lang);
      const costEstimateCents = Math.ceil(segments * deps.pricePerSegmentCents());

      return deps.db.transaction(async (tx): Promise<SignupOutcome> => {
        const places = await checkPlaces(tx, input);
        if (places !== "ok") return { kind: "refused", code: places };

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
        return { kind: "accepted" };
      });
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
