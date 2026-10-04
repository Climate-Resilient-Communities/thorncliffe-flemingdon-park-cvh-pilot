// What the health job (ops, S06.07, AD-23) needs to know about the sender, read from the outbox's own tables and nothing else: ops may not
// read `delivery`, `dispatcher_lease` or `messaging_control` (AD-2), so messaging answers with counts and ages. No row, no number, no body.
import type { DbExecutor } from "../../../platform/db";

/** A text queued and due for longer than this, outside a pause, is stuck (AD-23). */
export const STUCK_QUEUE_AFTER_MS = 5 * 60_000;
/** A sender lease not renewed for this long while texts are due means no sender is running (AD-23). */
export const LEASE_STALE_AFTER_MS = 3 * 60_000;
/**
 * A text still handed off with no outcome after this long: the sweep makes such a text `unknown` after 5 minutes, so one that is older is a text
 * the sweep could not settle (its `ops_event` write failed), and no `delivery.unknown` exists to say so.
 */
export const UNSETTLED_HAND_OFF_AFTER_MS = 10 * 60_000;
/** A text that became `unknown` is the health job's business for this long; an older one is for the weekly review (N4). */
export const UNKNOWN_WINDOW_MS = 24 * 60 * 60_000;
/** At most this many unknown deliveries are named in one reading (the job needs the newest, not all). */
export const UNKNOWN_IDS_LIMIT = 500;

export interface SenderHealth {
  /** Whether texts are paused (a missing control row reads as paused, as the sender reads it). */
  paused: boolean;
  /** Texts queued and due for more than STUCK_QUEUE_AFTER_MS that the pause is not holding: while paused, only those to on-call numbers. */
  stuckQueued: number;
  /** Texts queued and due now that the pause is not holding (the same rule). */
  dueNow: number;
  /** Milliseconds since the sender lease was last renewed, by the database's clock; null when there is no lease row. */
  leaseRenewedAgoMs: number | null;
  /** Texts handed off with no outcome for more than UNSETTLED_HAND_OFF_AFTER_MS. */
  unsettledHandOffs: number;
  /** The deliveries that are `unknown` now and became so within UNKNOWN_WINDOW_MS (newest first, at most UNKNOWN_IDS_LIMIT). */
  unknownDeliveryIds: string[];
  /**
   * `transactional` texts created since midnight in Toronto, except those to on-call numbers (S09.01, AD-22: the daily ceiling on non-alert texts,
   * menus and prompts included; the on-call texts are the alarm itself and never count towards it).
   */
  transactionalToday: number;
}

export interface SenderHealthReader {
  read(executor: DbExecutor): Promise<SenderHealth>;
}
