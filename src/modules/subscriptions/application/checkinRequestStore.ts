// checkins' RequestStore port on the subscriber table (S08.05, AD-2, AD-12): the check-in request is on subscriptions' row (`checkin_method`,
// the "where I live" place, `checkin_consent_version`), and checkins, which may not import subscriptions, reads, locks and writes it through
// this port (wired by src/app/checkins.ts). No phone number is read. Also the coverage view's counts of requests per building and floor.
import type { DbExecutor } from "../../../platform/db";
import type { RequestStore } from "../../checkins";
import { subscriberStore, type SubscriberStore } from "../adapters/subscriberStore";

export function checkinRequestStore(store: SubscriberStore = subscriberStore): RequestStore {
  return {
    requestOf: (executor, subscriberId) => store.checkinOf(executor, subscriberId),
    lockForEdit: (tx, subscriberId) => store.lockForEditWithCheckin(tx, subscriberId),
    lockRequesters: (tx, subscriberIds) => store.lockRequesters(tx, subscriberIds),
    setRequest: (tx, subscriberId, request) => store.setCheckin(tx, subscriberId, request),
  };
}

/**
 * How many receiving subscribers ask for a check-in on each building and floor (S08.05: the coverage view counts those on floors nobody covers,
 * so the Hub can assign someone or contact them). Counts only.
 */
export function checkinRequestCounts(executor: DbExecutor, store: SubscriberStore = subscriberStore): Promise<{ rsn: string; floorId: string; requests: number }[]> {
  return store.checkinCountsByFloor(executor);
}
