// The ports of the check-in requests (S08.05, AD-2). checkins owns the round rows; the request itself is on subscriptions' subscriber row, and
// the threads are alerting's: checkins may import neither (the spine's graph points from them to checkins), so each reaches it through a
// port that module implements and the composition root wires (src/app/checkins.ts).
import type { Audience } from "../../../contracts/audience";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { CheckinRequest } from "../domain/requests";

/**
 * Port (subscriptions implements it, `checkinRequestStore`): the request on the subscriber's row. No phone number crosses it.
 *  - `requestOf`: the request as it stands, read without a lock (the threads to lock first are chosen from it); null with none, or no subscriber.
 *  - `lockForEdit`: the subscriber's row locked FOR NO KEY UPDATE (an edit's lock: it waits for an approval holding the row FOR SHARE) and its
 *    request read under the lock; null when the subscriber is gone.
 *  - `lockRequesters`: the rows of these subscribers locked FOR SHARE in the order given (an approval's `ensureRound`: a withdrawal's or a
 *    deletion's lock makes it wait, and the request is read again once they are done), with the request of each that still receives texts
 *    and has one.
 *  - `setRequest`: the request written, or cleared (null); the caller holds the row's lock.
 */
export interface RequestStore {
  requestOf(executor: DbExecutor, subscriberId: string): Promise<CheckinRequest | null>;
  lockForEdit(tx: DbTransaction, subscriberId: string): Promise<{ request: CheckinRequest | null } | null>;
  lockRequesters(tx: DbTransaction, subscriberIds: readonly string[]): Promise<Map<string, CheckinRequest>>;
  setRequest(tx: DbTransaction, subscriberId: string, request: CheckinRequest | null): Promise<void>;
}

/** An open thread as a round reads it: its types and the audience of its latest approved, non-superseded substantive entry. */
export interface RoundThread {
  alertId: string;
  types: readonly string[];
  audience: Audience;
}

/**
 * Port (alerting implements it, `roundThreads`): the open, non-drill threads whose latest approved, non-superseded substantive entry is an
 * acknowledgement, an update or a correction, with that entry's types and audience (an approval of such an entry starts or adds to the
 * thread's round, S08.06; checkins keeps the ones of a round type).
 *  - `open`: all of them, read without a lock;
 *  - `lock`: the `alert` rows of these threads locked FOR UPDATE in the order given (AD-18: a thread's lock comes first), then those of them
 *    that are still such threads, read under the lock.
 */
export interface RoundThreads {
  open(executor: DbExecutor): Promise<RoundThread[]>;
  lock(tx: DbTransaction, alertIds: readonly string[]): Promise<RoundThread[]>;
}

/** Port (identity's `coversFloor`, AD-12: the only coverage test): an active Ambassador covers that floor of that building. */
export type CoversFloor = (rsn: string, floorId: string, executor: DbExecutor) => Promise<boolean>;
