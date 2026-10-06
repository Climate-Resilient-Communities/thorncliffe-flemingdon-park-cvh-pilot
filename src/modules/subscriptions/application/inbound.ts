// The inbound router (S07.04, AD-9, AD-13; E07 definitions "Inbound order", "Decision table", "Deletion"): `handleInbound` for one signed
// inbound text (the signature is checked first, by `inboundWebhook.ts`). In ONE transaction:
//
//   1. de-duplication: the MessageSid's sha256 goes into `inbound_seen`; a message seen before (a Twilio retry) changes nothing at all;
//   2. the number's lock (the same advisory lock the web sign-up takes), so a YES, a STOP and a sign-up for one number run one at a time;
//   3. the number's state: a subscriber (`active`, with its open prompt), an unexpired pending sign-up (`pending`), or nothing (`none`; a
//      pending sign-up past its `expires_at` counts as nothing even before the purge job has deleted it: S07.02's handoff);
//   4. the keyword, from the body normalised (digits in any script read as 0-9, `toAsciiDigits`) and Twilio's `OptOutType`; the body is then
//      dropped, and only the day's count of the keyword is kept (once per MessageSid, because step 1 stops a retry first);
//   5. the decision table (domain/inbound.ts) and its action. Opt-out events and deletion requests are decided before anything else, and
//      before any rate limit (S07.09 adds the inbound limits after them). Replies 1, 2 and 3, and every reply inside an open menu, go to
//      the menus (S07.05, `MenuPort`, application/menus.ts), which keep their page in the subscriber's `sms_prompt`.
//
// Deletion (`deleteNumber`): STOP, or a second 0 within 10 minutes, hard-deletes everything held for the number in this transaction, with
// nothing kept: the subscriber (its places, muted topics and prompt go with it), any pending sign-up and any `inbound_reply` rows; each
// recipient's `queued` and claimed-but-not-handed-off texts are set `skipped` first (`skipRecipientDeliveries`), and the delete's trigger
// makes the texts already handed off forget the recipient (AD-8). Lock order (E07): delivery rows, then the subscriber row, then check-ins
// (`checkins.deleteForSubscriber`, E08's port; a no-op until then). Nothing is sent afterwards: no record could resolve the number.
//
// The number is never logged, audited, put in an `ops_event` or a `delivery` row, or put in an error: log lines carry the keyword, the
// state and the action only.
import { createHash } from "node:crypto";
import { canadianNumber } from "../../../contracts/signup";
import type { LaunchCode } from "../../../i18n/languages";
import { residentText, type ResidentTextName } from "../../../i18n/residentTexts";
import type { Db, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { countSms, normaliseSms, type DeliveryResult, type Enqueued, type RecipientKind, type SkippedForRecipient, type TransactionalInput } from "../../messaging";
import { inboundStore, type InboundStore } from "../adapters/inboundStore";
import { pendingSignupStore, type PendingSignupRow, type PendingSignupStore } from "../adapters/pendingSignupStore";
import { subscriberStore, type NewSubscriberPlace, type SubscriberRow, type SubscriberStore } from "../adapters/subscriberStore";
import { DELETE_CONFIRM_MS, INBOUND_LIMIT, INBOUND_SCOPE, decide, exemptFromInboundLimit, readKeyword, yesWordsOf, type InboundAction, type InboundKeyword, type NumberState } from "../domain/inbound";
import { MENU_IDLE_MS, MENU_SCOPE, menuDigit, openPromptOf } from "../domain/menus";
import { clientHash } from "./rateLimit";
import type { SignupPlaces, SubscriberLookup } from "./webSignup";

/** The once-a-day limit of the sign-up link to one number (E07 "Reply to an unknown number"), kept as a keyed hash in `rate_limit`. */
export const SIGNUP_INFO_SCOPE = "signup_info";

/** The scope of the inbound limit's keyed hash (more than 20 messages an hour from one number, S07.09). */

/**
 * Port: `checkins`' `deleteForSubscriber(subscriberId, tx)` (E07 handoffs). Deleting a subscriber calls it in the deletion's transaction,
 * after the subscriber's row is locked and before it is deleted; E08 implements it (tally the subscriber's check-in rows into closed stubs).
 */
export interface CheckinCleanup {
  deleteForSubscriber(subscriberId: string, tx: DbTransaction): Promise<void>;
}

/** Until E08: there are no check-in rows to remove. */
export const noCheckinsYet: CheckinCleanup = { deleteForSubscriber: async () => undefined };

/** What a withdrawal of a check-in request did: it withdrew one, or there was none. */
export type CheckinWithdrawal = "withdrawn" | "none";

/**
 * Port: `checkins`' check-in request (E07 handoffs; E08 definitions "Check-in request", "Changed location"), beside `deleteForSubscriber`
 * and implemented with it by E08 (S08.05), in the router's transaction under the number's lock:
 *  - `withdrawRequest(subscriberId, tx)`: reply 3 (S07.05). E08 withdraws the subscriber's request (`removeRequester`: its open rows tallied
 *    and closed, `checkin_method` cleared, in the request lock order it owns) and says whether there was one; the reply is "You have no
 *    check-in request" or the withdrawal's confirmation;
 *  - `locationChanging(subscriberId, place, tx)`: menu 1 is about to replace every saved place with `place` (called after the subscriber's
 *    row is locked and before its places are deleted, so the "where I live" place can still be read). E08 withdraws the request when that
 *    place's building or floor changes ("Changed location") and says so; the confirmation is then followed by the withdrawal's text.
 */
export interface CheckinRequests {
  withdrawRequest(subscriberId: string, tx: DbTransaction): Promise<CheckinWithdrawal>;
  locationChanging(subscriberId: string, place: { rsn: string; floorId: string | null }, tx: DbTransaction): Promise<CheckinWithdrawal>;
}

/** Until E08: nobody has a check-in request, so reply 3 is answered "You have no check-in request" and a move withdraws nothing. */
export const noCheckinRequestsYet: CheckinRequests = { withdrawRequest: async () => "none", locationChanging: async () => "none" };

/** The subscriber a menu acts for: its id and language, and the keyed hash of its number (the daily menu limit is per number). */
export interface MenuSubscriber {
  id: string;
  lang: LaunchCode;
  numberHash: string;
}

/**
 * Port: the numbered menus (S07.05, `createMenus`), in the router's transaction under the number's lock: reply 1 (building or floor), 2
 * (language) or 3 (withdraw a check-in request) from a subscriber with no menu open (`start`); a reply inside an open menu (`answer`, with
 * the prompt row and the reply's digit 0-9, or null when it is not one digit: the body itself is not passed on); the notice that an idle
 * menu has reset (`reset`, before the reply is read as a new keyword); and 1 to the edit link's offer (`sendEditLink`, S07.06). Each says
 * whether it queued a reply.
 */
export interface MenuPort {
  start(tx: DbTransaction, subscriber: MenuSubscriber, choice: "1" | "2" | "3"): Promise<boolean>;
  answer(tx: DbTransaction, subscriber: MenuSubscriber, prompt: { kind: string; step: unknown }, digit: number | null): Promise<boolean>;
  reset(tx: DbTransaction, subscriber: MenuSubscriber): Promise<boolean>;
  sendEditLink(tx: DbTransaction, subscriber: MenuSubscriber): Promise<boolean>;
}

/** No menus: replies 1, 2 and 3 change nothing and are not answered (for tests of the router that are not about menus). */
export const noMenus: MenuPort = { start: async () => false, answer: async () => false, reset: async () => false, sendEditLink: async () => false };

/** Where the router reports what it did: the keyword, the state and the action, never a number, a body or an id. */
export interface InboundLog {
  info(evt: string, fields: Record<string, string | number | boolean | null>): void;
}

export interface InboundDeps {
  db: Db;
  /** places' floors of a building (null: no such building), to turn the pending sign-up's places into subscriber places. */
  places: Pick<SignupPlaces, "floorIdsOf">;
  /**
   * messaging's `enqueueTransactional`. `now` is the database's clock when the row that sets the text's `send_by` was made (`signup_info`:
   * its `inbound_reply` row), for the queue to check that `send_by` against; the composition root gives it to the queue.
   */
  enqueue: (tx: DbTransaction, input: TransactionalInput, now?: Date) => Promise<DeliveryResult<Enqueued>>;
  /** messaging's `skipRecipientDeliveries`. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  checkins?: CheckinCleanup;
  menus?: MenuPort;
  /** The server-only key of the keyed hash the once-a-day limit keeps (the rate limiter's key). */
  numberKey: () => string;
  /** PUBLIC_BASE_URL, for the sign-up link. */
  publicBaseUrl: () => string;
  pricePerSegmentCents: () => number;
  log?: InboundLog;
  stores?: { pending?: PendingSignupStore; subscribers?: SubscriberStore; inbound?: InboundStore };
  newId?: () => string;
}

/** One inbound text as the webhook read it, after its signature was checked. */
export interface InboundMessage {
  messageSid: string;
  /** The sender's number as Twilio gives it (E.164). */
  from: string;
  body: string;
  /** Twilio Advanced Opt-Out's `OptOutType` (`STOP`, `START`, `HELP`), or null. */
  optOutType: string | null;
}

export type InboundOutcome =
  | { kind: "duplicate" }
  | { kind: "handled"; keyword: InboundKeyword; state: NumberState["kind"]; action: InboundAction["kind"] | "rate_limited"; replied: boolean };

export interface InboundRouter {
  handle(message: InboundMessage): Promise<InboundOutcome>;
}

/** What a deletion removed: counts only. */
export interface Deleted {
  subscriber: boolean;
  pendingSignup: boolean;
  inboundReplies: number;
  skippedTexts: number;
}

/** A reply could not be queued: the delivery table refused what this file built, which is a bug, never a resident's mistake. */
export class ReplyNotQueued extends Error {
  override name = "ReplyNotQueued";
  constructor(readonly refusal: string) {
    super(`An inbound reply was refused: ${refusal}`);
  }
}

/** A resident text from the catalog in a language, with `{name}` values filled in, normalised and counted as every outbound text is (AD-21). */
export function residentSms(lang: LaunchCode, name: ResidentTextName, values: Record<string, string> = {}): { body: string; segments: number } {
  const text = residentText(lang, name).replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
  const body = normaliseSms(text);
  return { body, segments: countSms(body).segments };
}

/** The words that mean yes in a language: the catalog's `smsKeywords.yes` (English YES and Y are always accepted besides). */
export function yesWordsFor(lang: LaunchCode): string[] {
  return yesWordsOf(residentText(lang, "yesWords"));
}

/** The sign-up page's address in a language. */
export function signupLink(publicBaseUrl: string, lang: LaunchCode): string {
  return `${publicBaseUrl.replace(/\/+$/, "")}/${lang}/text-alerts`;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function createInboundRouter(deps: InboundDeps): InboundRouter {
  const pending = deps.stores?.pending ?? pendingSignupStore;
  const subscribers = deps.stores?.subscribers ?? subscriberStore;
  const inbound = deps.stores?.inbound ?? inboundStore;
  const checkins = deps.checkins ?? noCheckinsYet;
  const menus = deps.menus ?? noMenus;
  const newId = deps.newId ?? (() => uuidv7());

  async function queue(
    tx: DbTransaction,
    text: { purpose: "welcome" | "prompt_reply" | "signup_info"; recipient: { kind: RecipientKind; id: string }; nonce: string; lang: LaunchCode; name: ResidentTextName; values?: Record<string, string> },
    sendBy?: { at: Date; now: Date },
  ): Promise<void> {
    const { body, segments } = residentSms(text.lang, text.name, text.values);
    const queued = await deps.enqueue(
      tx,
      {
        module: "subscriptions",
        purpose: text.purpose,
        recipient: text.recipient,
        subject: text.recipient.id,
        nonce: text.nonce,
        lang: text.lang,
        body,
        segments,
        costEstimateCents: Math.ceil(segments * deps.pricePerSegmentCents()),
        ...(sendBy ? { sendBy: sendBy.at } : {}),
      },
      sendBy?.now,
    );
    if (!queued.ok) throw new ReplyNotQueued(queued.error);
  }

  /** Skips the recipient's waiting texts; returns how many. */
  const skip = async (tx: DbTransaction, kind: RecipientKind, id: string) => (await deps.skipRecipientDeliveries(tx, { kind, id })).skipped;

  async function deleteNumber(tx: DbTransaction, phone: string, found: { subscriber: SubscriberRow | null; pending: PendingSignupRow | null }): Promise<Deleted> {
    let skippedTexts = 0;
    let deletedSubscriber = false;
    if (found.subscriber) {
      const id = found.subscriber.id;
      skippedTexts += await skip(tx, "subscriber", id);
      if (await subscribers.lock(tx, id)) {
        // Again under the row's lock: a text an approval committed while this waited for the lock is stopped too.
        skippedTexts += await skip(tx, "subscriber", id);
        await checkins.deleteForSubscriber(id, tx);
        deletedSubscriber = await subscribers.delete(tx, id);
      }
    }
    let deletedPending = false;
    if (found.pending) {
      skippedTexts += await skip(tx, "pending_signup", found.pending.id);
      deletedPending = await pending.delete(tx, found.pending.id);
    }
    const replies = await inbound.replyIdsOf(tx, phone);
    for (const id of replies) {
      skippedTexts += await skip(tx, "inbound_reply", id);
      await inbound.deleteReply(tx, id);
    }
    return { subscriber: deletedSubscriber, pendingSignup: deletedPending, inboundReplies: replies.length, skippedTexts };
  }

  /** YES to an unexpired pending sign-up: the subscriber is made from it, the pending row is deleted, and the welcome is queued. */
  async function confirm(tx: DbTransaction, phone: string, row: PendingSignupRow): Promise<void> {
    const id = newId();
    const lang = row.lang as LaunchCode;
    await subscribers.insert(tx, { id, phone, lang, neighbourhoodId: row.neighbourhoodId, groups: [...row.groups], consentVersion: row.consentVersion, startedBy: row.startedBy });
    // A building or floor removed since the sign-up is dropped now (S07.02); a building whose floors were all removed is kept with no floor.
    const places: NewSubscriberPlace[] = [];
    for (const place of row.places) {
      const floors = await deps.places.floorIdsOf(tx, place.rsn);
      if (floors === null) continue;
      const kept = [...new Set(place.floors.filter((floor) => floors.includes(floor)))];
      if (kept.length === 0) places.push({ id: newId(), rsn: place.rsn, floorId: null });
      else for (const floorId of kept) places.push({ id: newId(), rsn: place.rsn, floorId });
    }
    await subscribers.insertPlaces(tx, id, places);
    for (const topic of row.topics) await subscribers.insertTopic(tx, id, topic);
    await skip(tx, "pending_signup", row.id);
    await pending.delete(tx, row.id);
    await queue(tx, { purpose: "welcome", recipient: { kind: "subscriber", id }, nonce: "yes", lang, name: "welcome" });
  }

  /** The sign-up link, through a new `inbound_reply` row, unless the number already got one in the last 24 hours. */
  async function signupInfo(tx: DbTransaction, phone: string, lang: LaunchCode): Promise<boolean> {
    if (!(await inbound.allowOncePerDay(tx, SIGNUP_INFO_SCOPE, clientHash(deps.numberKey(), SIGNUP_INFO_SCOPE, phone)))) return false;
    const reply = await inbound.insertReply(tx, newId(), phone);
    await queue(
      tx,
      { purpose: "signup_info", recipient: { kind: "inbound_reply", id: reply.id }, nonce: "info", lang, name: "signupInfo", values: { link: signupLink(deps.publicBaseUrl(), lang) } },
      { at: reply.expiresAt, now: reply.now },
    );
    return true;
  }

  return {
    async handle(message) {
      const sidHash = sha256(message.messageSid);
      const phone = canadianNumber(message.from);
      const outcome = await deps.db.transaction(async (tx): Promise<InboundOutcome> => {
        if (!(await inbound.markSeen(tx, sidHash))) return { kind: "duplicate" };

        let subscriber: SubscriberRow | null = null;
        let pendingRow: PendingSignupRow | null = null;
        if (phone !== null) {
          await pending.lockNumber(tx, phone);
          subscriber = await subscribers.ofNumber(tx, phone);
          pendingRow = subscriber ? null : await pending.ofNumber(tx, phone);
        }
        const lang = (subscriber?.lang ?? pendingRow?.lang ?? null) as LaunchCode | null;
        const keyword = readKeyword({ body: message.body, optOutType: message.optOutType, yesWords: lang ? yesWordsFor(lang) : [] });
        await inbound.countKeyword(tx, keyword);

        // A number that is not Canadian: nothing is held for it and nothing can be sent to it.
        if (phone === null) return { kind: "handled", keyword, state: "none", action: "none", replied: false };

        // S07.05: the prompt row with its step (a menu's page) and whether it is idle (a menu 10 minutes old has reset).
        const promptRow = subscriber ? await subscribers.promptOf(tx, subscriber.id, MENU_IDLE_MS) : null;
        const state: NumberState = subscriber
          ? { kind: "active", prompt: openPromptOf(promptRow) }
          : pendingRow && !pendingRow.expired
            ? { kind: "pending" }
            : { kind: "none" };
        const { action, cancelPrompt, menuReset } = decide(keyword, state);
        // The inbound limit (step 4), after deletions and opt-out events and before anything else is done: a number that sent more than 20 an
        // hour gets no reply, changes nothing (not even a YES) and is only counted for the rest of the day (S07.09). The number is hashed, never kept.
        if (!exemptFromInboundLimit(keyword, action)) {
          const limited = await inbound.limitInbound(tx, clientHash(deps.numberKey(), INBOUND_SCOPE, phone), INBOUND_LIMIT);
          if (limited !== "allowed") return { kind: "handled", keyword, state: state.kind, action: "rate_limited", replied: false };
        }
        if (cancelPrompt && subscriber) await subscribers.clearPrompt(tx, subscriber.id);

        let replied = false;
        // S07.05: the menus act for the subscriber with its number's keyed hash (the daily menu limit is per number); an idle menu's reset
        // is said before the reply is handled as a new keyword.
        const menuSubscriber = (): MenuSubscriber => ({ id: subscriber!.id, lang: subscriber!.lang as LaunchCode, numberHash: clientHash(deps.numberKey(), MENU_SCOPE, phone) });
        if (menuReset && subscriber) replied = await menus.reset(tx, menuSubscriber());
        switch (action.kind) {
          case "delete":
            await deleteNumber(tx, phone, { subscriber, pending: pendingRow });
            break;
          case "confirm":
            await confirm(tx, phone, pendingRow!);
            replied = true;
            break;
          case "already_signed_up":
            await queue(tx, { purpose: "prompt_reply", recipient: { kind: "subscriber", id: subscriber!.id }, nonce: newId(), lang: subscriber!.lang as LaunchCode, name: "alreadySignedUp" });
            replied = true;
            break;
          case "ask_delete":
            await subscribers.openNewPrompt(tx, subscriber!.id, "delete_confirm", DELETE_CONFIRM_MS);
            await queue(tx, { purpose: "prompt_reply", recipient: { kind: "subscriber", id: subscriber!.id }, nonce: newId(), lang: subscriber!.lang as LaunchCode, name: "deletePrompt" });
            replied = true;
            break;
          case "menu":
            replied = (await menus.start(tx, menuSubscriber(), action.choice)) || replied;
            break;
          case "menu_reply":
            // The reply's digit is all a menu reads of the body.
            replied = await menus.answer(tx, menuSubscriber(), promptRow!, menuDigit(message.body));
            break;
          case "edit_link":
            replied = await menus.sendEditLink(tx, menuSubscriber());
            break;
          case "signup_info":
            // An expired pending sign-up is gone now (the purge would delete it); its language is the reply's.
            if (pendingRow?.expired) {
              await skip(tx, "pending_signup", pendingRow.id);
              await pending.delete(tx, pendingRow.id);
            }
            replied = await signupInfo(tx, phone, lang ?? "en");
            break;
          case "none":
            break;
        }
        return { kind: "handled", keyword, state: state.kind, action: action.kind, replied };
      });
      if (outcome.kind === "duplicate") deps.log?.info("inbound.duplicate", {});
      else deps.log?.info("inbound.handled", { keyword: outcome.keyword, state: outcome.state, action: outcome.action, replied: outcome.replied });
      return outcome;
    },
  };
}

/**
 * The ContactResolver's source for `subscriber` recipients: the number of a subscriber that still exists and receives texts (E06 "Sendable":
 * subscriber texts only to a receiving subscriber); null otherwise, so the text is skipped. The number goes to the provider call only.
 */
export function subscriberNumberSource(store: SubscriberStore = subscriberStore) {
  return {
    numberOf: (tx: DbTransaction, recipientId: string) => store.phoneOf(tx, recipientId),
  };
}

/**
 * Whether the subscriber still exists and receives alerts (E09 "Receiving subscriber"), with their row locked `FOR SHARE` in the caller's transaction: a resend
 * (S09.02) asks it before it adds a text, so a STOP or a deletion that comes next waits for that transaction and then skips the text. A subscriber who is being
 * deleted right now (their row locked by the deletion) does not receive. Reads no number.
 */
export function subscriberReceives(tx: DbTransaction, id: string, store: SubscriberStore = subscriberStore): Promise<boolean> {
  return store.receivesShared(tx, id);
}

/**
 * The ContactResolver's source for `inbound_reply` recipients: the number is taken (`consume`), the row locked, read and deleted in the
 * hand-off transaction; a row past its 30 minutes gives no number. Only a `signup_info` text has such a recipient.
 */
export function inboundReplyNumberSource(store: InboundStore = inboundStore) {
  return {
    async numberOf(tx: DbTransaction, recipientId: string, options: { consume: boolean; purpose?: string | null }): Promise<string | null> {
      if (!options.consume || options.purpose !== "signup_info") return null;
      return store.takeReply(tx, recipientId);
    },
  };
}

/** The web sign-up's "already subscribed" lookup on the subscriber table (S07.02's `SubscriberLookup`, wired by the composition root). */
export function subscriberLookup(store: SubscriberStore = subscriberStore): SubscriberLookup {
  return { isSubscribed: (tx: DbTransaction, phone: string) => store.isSubscribed(tx, phone) };
}
