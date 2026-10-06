// The one-time web link (S07.06, AD-9, AD-13; E07 definitions "Edit link", "Deletion"): S07.05's `EditLinkPort` (the link made and texted
// when a resident asks for it from a menu's offer), and the three things the page does with it.
//
//  - `port.send`, in the inbound router's transaction under the number's lock: 32 random bytes in base64url become the token; only its
//    sha256 is stored (`subscription_edit_token`, replacing the subscriber's earlier link), valid 30 minutes from the database's now(); the
//    text (`smsTexts.editLink`, purpose `edit_link`) carries `/{lang}/subscription/{token}` on PUBLIC_BASE_URL, and its `send_by` is the
//    purpose's 30 minutes from the same now(), so a text still queued when its link runs out is skipped at the hand-off, never sent late.
//  - `view(token)`: what the page shows, read only (nothing is used, nothing written, nothing locked). Unknown, used or run-out links, and a
//    subscriber who no longer receives texts (E09 "Receiving subscriber", subscriberStore's predicate), all answer `expired`.
//  - `change(...)`: one transaction. The number's lock (the router's and the sign-up's), so a STOP, a menu or a second submission of the
//    link waits; the neighbourhood and every building and floor checked against places (buildings share-locked as the menus read them), and
//    a refusal changes and uses nothing; then the link is used (`used_at` set only while unused and unexpired: of two submissions exactly
//    one gets it, the other answers `expired` having asked and written nothing). When the places change, checkins' `locationChanging` is
//    asked next, before the subscriber's row is locked here, as menu 1 asks it (E08 locks the round threads' `alert` rows before that row).
//    Then the edit's row lock (`lockForEdit`, FOR NO KEY UPDATE: S07.07's approval waits for it, a resend still reads the resident as
//    receiving), the resident's receiving state read again under it (if they no longer receive, all of it is undone, the link's use with
//    it), and the change written in the same transaction: language, neighbourhood, groups (the check-in group kept), places and muted
//    topics. A confirmation (`smsTexts.editSaved`, in the new language) is queued, and the check-in request's withdrawal after it when
//    checkins reports one.
//  - `delete(token)`: the same lock, the link used, then E07's one deletion (`createNumberDeletion`, the one STOP runs) of everything held
//    for the number in the same transaction; the link goes with the subscriber. Nothing is texted: the page alone confirms it.
//
// Nothing here logs, audits or returns the number or the token; the page gets the number's last two digits, cut in the database. The token
// is stored only in the link's own text (`delivery.body`, as the outbox keeps every text), where it works for its 30 minutes and once.
import { randomBytes } from "node:crypto";
import { SIGNUP_GROUPS } from "../../../contracts/signup";
import { EDIT_EXPIRED, isMutableTopic, type EditChange, type EditExpiredBody, type EditViewBody, type SubscriptionEditErrorCode } from "../../../contracts/subscriptionEdit";
import { isLaunchCode, type LaunchCode } from "../../../i18n/languages";
import { residentText, type ResidentTextName } from "../../../i18n/residentTexts";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { sha256Hex } from "../../../platform/hash";
import { uuidv7 } from "../../../platform/ids";
import type { DeliveryResult, Enqueued, RecipientKind, SkippedForRecipient, TransactionalInput } from "../../messaging";
import { editTokenStore, type EditTokenStore } from "../adapters/editTokenStore";
import { inboundStore, type InboundStore } from "../adapters/inboundStore";
import { pendingSignupStore, type PendingSignupStore } from "../adapters/pendingSignupStore";
import { subscriberStore, type SubscriberStore } from "../adapters/subscriberStore";
import { EDIT_LINK_PURPOSE, editLinkUrl, groupsAfterChange, placeRows, placesOfRows, samePlaces } from "../domain/editLink";
import { HUB_NUMBER } from "../domain/menus";
import { createNumberDeletion } from "./deletion";
import { noCheckinRequestsYet, noCheckinsYet, queueReply, type CheckinCleanup, type CheckinRequests } from "./inbound";
import type { EditLinkPort } from "./menus";

/** Port: what a change reads of places: the neighbourhoods, and a building's floors (null: no such building), its row share-locked. */
export interface EditPlaces {
  neighbourhoodIds(executor: DbExecutor): Promise<string[]>;
  floorIdsOf(tx: DbTransaction, rsn: string, options: { lock: "share" }): Promise<string[] | null>;
}

export interface EditLinkDeps {
  db: Db;
  /** messaging's `enqueueTransactional`. */
  enqueue: (tx: DbTransaction, input: TransactionalInput) => Promise<DeliveryResult<Enqueued>>;
  /** messaging's `skipRecipientDeliveries`, for the deletion. */
  skipRecipientDeliveries: (tx: DbTransaction, recipient: { kind: RecipientKind; id: string }) => Promise<SkippedForRecipient>;
  places: EditPlaces;
  /** checkins' ports (E08): the request's "Changed location" on a change of places, and the check-in rows at a deletion. */
  checkins?: CheckinRequests & CheckinCleanup;
  /** PUBLIC_BASE_URL, for the link. */
  publicBaseUrl: () => string;
  pricePerSegmentCents: () => number;
  stores?: { tokens?: EditTokenStore; subscribers?: SubscriberStore; pending?: PendingSignupStore; inbound?: InboundStore };
  newId?: () => string;
  /** Test seam: the token (32 random bytes in base64url by default). */
  newToken?: () => string;
}

export type EditChangeOutcome = { kind: "changed" } | { kind: "expired" } | { kind: "refused"; code: SubscriptionEditErrorCode };
export type EditDeleteOutcome = { kind: "deleted" } | { kind: "expired" };

export interface EditLink {
  /** S07.05's port: the link exists (`available`), and `send` makes one and queues its text. */
  port: EditLinkPort;
  view(token: string): Promise<EditViewBody | EditExpiredBody>;
  change(change: EditChange): Promise<EditChangeOutcome>;
  delete(token: string): Promise<EditDeleteOutcome>;
}

/** A token: 32 random bytes in base64url, 43 characters. */
export const newEditToken = (): string => randomBytes(32).toString("base64url");

/** The token as stored: its sha256, hex. */
export const editTokenHash = (token: string): string => sha256Hex(token);

/** Thrown inside a change's transaction to undo all of it (the link's use and checkins' call too) when the resident no longer receives. */
class NoLongerReceiving extends Error {}

export function createEditLink(deps: EditLinkDeps): EditLink {
  const tokens = deps.stores?.tokens ?? editTokenStore;
  const subscribers = deps.stores?.subscribers ?? subscriberStore;
  const pending = deps.stores?.pending ?? pendingSignupStore;
  const inbound = deps.stores?.inbound ?? inboundStore;
  const checkins = deps.checkins ?? { ...noCheckinRequestsYet, ...noCheckinsYet };
  const newId = deps.newId ?? (() => uuidv7());
  const newToken = deps.newToken ?? newEditToken;
  const deletion = createNumberDeletion({ skipRecipientDeliveries: deps.skipRecipientDeliveries, checkins, stores: { pending, subscribers, inbound } });

  /** Queues a catalog text of the link's purpose to the subscriber, as the router and the menus queue theirs (`queueReply`). */
  async function text(tx: DbTransaction, subscriberId: string, lang: LaunchCode, nonce: string, name: ResidentTextName, values: Record<string, string> = {}): Promise<void> {
    await queueReply(deps, tx, { purpose: EDIT_LINK_PURPOSE, recipient: { kind: "subscriber", id: subscriberId }, nonce, lang, text: residentText(lang, name, values) });
  }

  /**
   * The usable link of a token, with its subscriber's number, and the number's lock taken; null when the link is unknown, used or run out,
   * or its subscriber is gone or no longer receives texts (the number source's own predicate). The number stays in this function's caller.
   */
  async function open(tx: DbTransaction, token: string): Promise<{ id: string; subscriberId: string; phone: string } | null> {
    const link = await tokens.find(tx, editTokenHash(token));
    if (!link?.usable) return null;
    const phone = await subscribers.phoneOf(tx, link.subscriberId);
    if (phone === null) return null;
    await pending.lockNumber(tx, phone);
    return { id: link.id, subscriberId: link.subscriberId, phone };
  }

  /** Every building and floor of the change exists (each building share-locked until the transaction ends), and the neighbourhood does. */
  async function checkPlaces(tx: DbTransaction, change: EditChange): Promise<SubscriptionEditErrorCode | null> {
    if (!(await deps.places.neighbourhoodIds(tx)).includes(change.neighbourhood)) return "invalid_request";
    for (const place of change.places) {
      const floors = await deps.places.floorIdsOf(tx, place.rsn, { lock: "share" });
      if (floors === null || !place.floors.every((floor) => floors.includes(floor))) return "place_unknown";
    }
    return null;
  }

  return {
    port: {
      available: true,
      async send(tx, subscriber) {
        const token = newToken();
        const id = newId();
        await tokens.replace(tx, { id, subscriberId: subscriber.id, tokenHash: editTokenHash(token) });
        await text(tx, subscriber.id, subscriber.lang, id, "editLink", { link: editLinkUrl(deps.publicBaseUrl(), subscriber.lang, token) });
      },
    },

    async view(token) {
      return deps.db.transaction(async (tx): Promise<EditViewBody | EditExpiredBody> => {
        const link = await tokens.find(tx, editTokenHash(token));
        // A plain read: a subscriber row held for a menu's save or another tab's change is read as it was, never as "expired".
        if (!link?.usable || !(await subscribers.receives(tx, link.subscriberId))) return EDIT_EXPIRED;
        const row = await subscribers.editView(tx, link.subscriberId);
        if (row === null || !isLaunchCode(row.lang)) return EDIT_EXPIRED;
        return {
          v: 1,
          status: "ok",
          subscription: {
            lang: row.lang,
            neighbourhood: row.neighbourhoodId,
            places: placesOfRows(row.places),
            groups: SIGNUP_GROUPS.filter((group) => row.groups.includes(group)),
            muted_topics: row.mutedTopics.filter(isMutableTopic),
            phone_last2: row.phoneLast2,
          },
        };
      });
    },

    async change(change) {
      try {
        return await deps.db.transaction(async (tx): Promise<EditChangeOutcome> => {
          const link = await open(tx, change.token);
          if (link === null) return { kind: "expired" };
          // A refusal comes before anything is written or used: the link still works for the corrected change.
          const refusal = await checkPlaces(tx, change);
          if (refusal !== null) return { kind: "refused", code: refusal };
          // Used first: a second submission, lined up behind this one by the number's lock, finds it used and asks or writes nothing.
          if (!(await tokens.consume(tx, link.id))) return { kind: "expired" };
          const id = link.subscriberId;
          // Read under the number's lock, with the link used: the subscriber is there (a deletion waits for that lock, and takes the link).
          const before = (await subscribers.editView(tx, id))!;
          const rows = placeRows(change.places);
          // E08 first, before the subscriber's row is locked here (as menu 1): it locks the round threads' `alert` rows before that row.
          const withdrawal = samePlaces(before.places, rows) ? "none" : await checkins.locationChanging(id, rows, tx);
          if (!(await subscribers.lockForEdit(tx, id)) || !(await subscribers.receivesShared(tx, id))) throw new NoLongerReceiving();
          await subscribers.replacePlaces(tx, id, rows.map((row) => ({ id: newId(), ...row })));
          await subscribers.setNeighbourhood(tx, id, change.neighbourhood);
          await subscribers.setLang(tx, id, change.lang);
          await subscribers.setGroups(tx, id, groupsAfterChange(before.groups, change.groups));
          await subscribers.replaceTopics(tx, id, change.mutedTopics);
          // The confirmation in the language the texts now come in (as menu 2's), then the request's withdrawal (as menu 1's).
          await text(tx, id, change.lang, `${link.id}.saved`, "editSaved", { hub: HUB_NUMBER });
          if (withdrawal === "withdrawn") await text(tx, id, change.lang, `${link.id}.checkin`, "checkinWithdrawn");
          return { kind: "changed" };
        });
      } catch (error) {
        if (error instanceof NoLongerReceiving) return { kind: "expired" };
        throw error;
      }
    },

    async delete(token) {
      return deps.db.transaction(async (tx): Promise<EditDeleteOutcome> => {
        const link = await open(tx, token);
        if (link === null || !(await tokens.consume(tx, link.id))) return { kind: "expired" };
        // E07's one deletion, as STOP runs it: everything held for the number, this link with it; nothing is sent afterwards.
        await deletion.deleteNumber(tx, link.phone);
        return { kind: "deleted" };
      });
    },
  };
}
