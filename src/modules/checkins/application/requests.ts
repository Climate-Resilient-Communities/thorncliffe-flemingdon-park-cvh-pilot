// A resident's check-in request and the round rows that follow it (S08.05, AD-12, AD-18; E08 definitions "Check-in request", "Request during
// sign-up", "Covered request", "Round", "Changed location", "Request lock order", "Closed stub", "Round tally"). E07's ports, implemented here:
//
//  - `withdrawRequest` (reply 3, and "Withdraw my check-in request" on the edit page): `removeRequester` tallies the request's open rows
//    (`withdrawn` unless already marked: the mark is the outcome) and turns them into closed stubs, then `checkin_method` and its place are
//    cleared, in the caller's transaction. Answers `withdrawn`, or `none` when there was no request.
//  - `locationChanging` (menu 1, and the edit page through `changeRequest`): the saved places are about to be replaced; when the "where I
//    live" building or floor is not among the new ones, the request is withdrawn the same way.
//  - `changeRequest` (the edit page): the places that will replace the saved ones and the request the page sends: kept, withdrawn, its
//    method changed (its open rows too, no new consent), or asked for at a place (the consent confirmed again): a covered floor saves it and
//    joins the matching open rounds at once (`joinActiveRounds`); an uncovered floor saves nothing ("No ambassador covers your floor yet").
//  - `activate` (YES, S07.04's confirm): a request made during sign-up becomes the subscriber's only if its floor is still covered, and joins
//    the matching open rounds in the same transaction.
//  - `lockRounds` and `deleteForSubscriber` (E07's deletion: STOP, a confirmed 0, the edit page's "Delete"): the deletion's first step locks
//    the subscriber's round threads; after the deliveries and the subscriber's row, every row that names the subscriber is tallied (if it was
//    not yet) and closed into a stub, in the deletion's transaction.
//  - `ensureRound` (S08.06 calls it from an approval that holds its thread's lock): the given requesters whose place matches the thread's
//    audience, on covered floors, each get one row in the round (`ON CONFLICT DO NOTHING`); their rows are read again under each requester's
//    FOR SHARE lock, so a withdrawal or a deletion running at the same time either comes first (no row) or comes after (the row is closed).
//
// The request lock order (AD-18): every use case that changes a request first reads the candidate round threads (those of the subscriber's
// open rows, and the open round threads that match the place asked for), locks their `alert` rows in id order, then (a deletion: the
// subscriber's deliveries, the caller's) the subscriber's row, then its `checkin` rows, then `checkin_tally` (the tally's trigger). A thread
// lock is never taken after the subscriber's row: a row an approval added in between is closed under its own row lock instead. A round's
// thread is an open, non-drill thread whose latest approved, non-superseded substantive entry is an acknowledgement, update or correction of
// a round type; it matches a request when its audience matches the "where I live" place (`roundMatches`).
//
// Nothing here reads, logs or stores a phone number: the rows name the subscriber by id, and the request is read through subscriptions' port.
import type { CheckinAnswer } from "../../../contracts/checkin";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { uuidv7 } from "../../../platform/ids";
import { neighbourhoodsOfBuildings, roundTypes } from "../../places";
import { checkinStore, type CheckinStore, type SubscriberCheckinRow } from "../adapters/checkinStore";
import {
  isRoundThread,
  lockOrder,
  placeKept,
  planRequestChange,
  roundMatches,
  type CheckinRequest,
  type RequestPlace,
  type SavedPlace,
  type WantedRequest,
} from "../domain/requests";
import type { CoversFloor, RequestStore, RoundThread, RoundThreads } from "./ports";

/** What a withdrawal did (E07's port's answer): it withdrew a request, or there was none. */
export type CheckinWithdrawal = "withdrawn" | "none";

/** What the edit page's change asks of the request: the places that replace the saved ones, and the request it sends (undefined: none sent). */
export interface RequestEdit {
  places: readonly SavedPlace[];
  request?: WantedRequest;
}

/**
 * What a change did: whether a request was withdrawn (the confirmation text says so), and the answer the page shows (null: nothing about a
 * request to say).
 */
export interface RequestEditDone {
  withdrawn: boolean;
  answer: CheckinAnswer | null;
}

/** places' readers (checkins may import places, AD-2); a test can replace them. */
export interface RequestPlaces {
  neighbourhoodOf(executor: DbExecutor, rsn: string): Promise<string | null>;
  roundTypes(executor: DbExecutor): Promise<string[]>;
}

const placesReaders: RequestPlaces = {
  neighbourhoodOf: async (executor, rsn) => (await neighbourhoodsOfBuildings(executor, [rsn])).get(rsn) ?? null,
  roundTypes: (executor) => roundTypes(executor),
};

export interface CheckinRequestsDeps {
  requests: RequestStore;
  threads: RoundThreads;
  coversFloor: CoversFloor;
  places?: RequestPlaces;
  store?: CheckinStore;
  newId?: () => string;
}

export interface CheckinRequests {
  withdrawRequest(subscriberId: string, tx: DbTransaction): Promise<CheckinWithdrawal>;
  locationChanging(subscriberId: string, places: readonly SavedPlace[], tx: DbTransaction): Promise<CheckinWithdrawal>;
  /** Whether the change can be made: a request at a new place needs the consent confirmed (asked before the edit link is used). */
  checkRequestChange(subscriberId: string, edit: RequestEdit, executor: DbExecutor): Promise<"consent_missing" | null>;
  changeRequest(subscriberId: string, edit: RequestEdit, tx: DbTransaction): Promise<RequestEditDone>;
  activate(subscriberId: string, request: CheckinRequest, tx: DbTransaction): Promise<"requested" | "uncovered">;
  lockRounds(subscriberId: string, tx: DbTransaction): Promise<void>;
  deleteForSubscriber(subscriberId: string, tx: DbTransaction): Promise<void>;
  ensureRound(tx: DbTransaction, thread: RoundThread, requesterIds: readonly string[]): Promise<number>;
}

/** The check-in rows that still name the subscriber (live, or kept for the Hub's follow-up), for a resident's access request (S09.03). */
export function subscriberCheckinRows(executor: DbExecutor, subscriberId: string, store: CheckinStore = checkinStore): Promise<SubscriberCheckinRow[]> {
  return store.subscriberRows(executor, subscriberId);
}

export function createCheckinRequests(deps: CheckinRequestsDeps): CheckinRequests {
  const store = deps.store ?? checkinStore;
  const places = deps.places ?? placesReaders;
  const newId = deps.newId ?? (() => uuidv7());

  /** The open round threads (read without a lock) that match a place, with (S08.06) those an approval waiting would make one that matches. */
  async function matchingRounds(executor: DbExecutor, place: RequestPlace): Promise<string[]> {
    const [types, neighbourhoodId, open] = [await places.roundTypes(executor), await places.neighbourhoodOf(executor, place.rsn), await deps.threads.open(executor)];
    if (neighbourhoodId === null) return [];
    return open.filter((thread) => isRoundThread(thread.types, types) && roundMatches(thread.audience, { ...place, neighbourhoodId })).map((thread) => thread.alertId);
  }

  /**
   * The request lock order's first steps: the candidate threads' `alert` rows in id order, then the subscriber's row (an edit's lock), with the
   * request read again under it. The threads come back as they are under their locks (a thread closed meanwhile is not among them). Null when
   * the subscriber is gone.
   */
  async function lockInOrder(tx: DbTransaction, subscriberId: string, candidates: readonly string[]) {
    const threads = candidates.length > 0 ? await deps.threads.lock(tx, lockOrder(candidates)) : [];
    const locked = await deps.requests.lockForEdit(tx, subscriberId);
    return locked === null ? null : { threads, request: locked.request };
  }

  /** `removeRequester`: the subscriber's open rows tallied and closed into stubs, then the request cleared. */
  async function removeRequester(tx: DbTransaction, subscriberId: string): Promise<void> {
    await store.leaveRounds(tx, subscriberId, { withKept: false });
    await deps.requests.setRequest(tx, subscriberId, null);
  }

  /** `joinActiveRounds`: the requester gets a row in each locked thread that is a round matching the request's place. */
  async function joinActiveRounds(tx: DbTransaction, subscriberId: string, request: CheckinRequest, threads: readonly RoundThread[]): Promise<number> {
    if (threads.length === 0) return 0;
    const [types, neighbourhoodId] = [await places.roundTypes(tx), await places.neighbourhoodOf(tx, request.rsn)];
    if (neighbourhoodId === null) return 0;
    const rows = threads
      .filter((thread) => isRoundThread(thread.types, types) && roundMatches(thread.audience, { rsn: request.rsn, floorId: request.floorId, neighbourhoodId }))
      .map((thread) => ({ id: newId(), alertId: thread.alertId, subscriberId, rsn: request.rsn, floorId: request.floorId, method: request.method }));
    return store.insertRows(tx, rows);
  }

  /** A withdrawal when `still` holds for the request read under the lock (reply 3: always; a move: its place is not kept). */
  async function withdrawWhen(tx: DbTransaction, subscriberId: string, still: (request: CheckinRequest) => boolean): Promise<CheckinWithdrawal> {
    const held = await deps.requests.requestOf(tx, subscriberId);
    if (held === null || !still(held)) return "none";
    const locked = await lockInOrder(tx, subscriberId, await store.threadsOf(tx, subscriberId, { withKept: false }));
    if (locked === null || locked.request === null || !still(locked.request)) return "none";
    await removeRequester(tx, subscriberId);
    return "withdrawn";
  }

  return {
    withdrawRequest: (subscriberId, tx) => withdrawWhen(tx, subscriberId, () => true),

    locationChanging: (subscriberId, saved, tx) => withdrawWhen(tx, subscriberId, (request) => !placeKept(request, saved)),

    async checkRequestChange(subscriberId, edit, executor) {
      const plan = planRequestChange(await deps.requests.requestOf(executor, subscriberId), edit.places, edit.request);
      return plan === "consent_missing" ? plan : null;
    },

    async changeRequest(subscriberId, edit, tx) {
      const first = planRequestChange(await deps.requests.requestOf(tx, subscriberId), edit.places, edit.request);
      if (first === "consent_missing" || (!first.withdraw && first.ask === null && first.method === null)) return { withdrawn: false, answer: null };
      const candidates = [
        ...(first.withdraw || first.method !== null ? await store.threadsOf(tx, subscriberId, { withKept: false }) : []),
        ...(first.ask !== null ? await matchingRounds(tx, first.ask) : []),
      ];
      const locked = await lockInOrder(tx, subscriberId, candidates);
      if (locked === null) return { withdrawn: false, answer: null };
      // Planned again on the request read under the lock (the number's lock already keeps another change of this subscriber out).
      const plan = planRequestChange(locked.request, edit.places, edit.request);
      if (plan === "consent_missing") return { withdrawn: false, answer: null };
      if (plan.withdraw) await removeRequester(tx, subscriberId);
      if (plan.method !== null && locked.request !== null) {
        await deps.requests.setRequest(tx, subscriberId, { ...locked.request, method: plan.method });
        await store.setMethod(tx, subscriberId, plan.method);
        return { withdrawn: false, answer: "method_changed" };
      }
      if (plan.ask !== null) {
        if (!(await deps.coversFloor(plan.ask.rsn, plan.ask.floorId, tx))) return { withdrawn: plan.withdraw, answer: "uncovered" };
        await deps.requests.setRequest(tx, subscriberId, plan.ask);
        await joinActiveRounds(tx, subscriberId, plan.ask, locked.threads);
        return { withdrawn: false, answer: "requested" };
      }
      return { withdrawn: plan.withdraw, answer: plan.withdraw ? "withdrawn" : null };
    },

    async activate(subscriberId, request, tx) {
      if (!(await deps.coversFloor(request.rsn, request.floorId, tx))) return "uncovered";
      const locked = await lockInOrder(tx, subscriberId, await matchingRounds(tx, request));
      if (locked === null) return "uncovered";
      await deps.requests.setRequest(tx, subscriberId, request);
      await joinActiveRounds(tx, subscriberId, request, locked.threads);
      return "requested";
    },

    async lockRounds(subscriberId, tx) {
      const threads = await store.threadsOf(tx, subscriberId, { withKept: true });
      if (threads.length > 0) await deps.threads.lock(tx, lockOrder(threads));
    },

    async deleteForSubscriber(subscriberId, tx) {
      await store.leaveRounds(tx, subscriberId, { withKept: true });
    },

    async ensureRound(tx, thread, requesterIds) {
      if (!isRoundThread(thread.types, await places.roundTypes(tx))) return 0;
      const requests = await deps.requests.lockRequesters(tx, lockOrder(requesterIds));
      const rows = [];
      for (const [subscriberId, request] of requests) {
        const neighbourhoodId = await places.neighbourhoodOf(tx, request.rsn);
        if (neighbourhoodId === null || !roundMatches(thread.audience, { rsn: request.rsn, floorId: request.floorId, neighbourhoodId })) continue;
        if (!(await deps.coversFloor(request.rsn, request.floorId, tx))) continue;
        rows.push({ id: newId(), alertId: thread.alertId, subscriberId, rsn: request.rsn, floorId: request.floorId, method: request.method });
      }
      return store.insertRows(tx, rows);
    },
  };
}
