// The health job's decisions (S06.07, S09.01, AD-23): given what a condition remembered and what the job sees now, what happens. Pure: no I/O, no clock
// (the caller gives the database's instant), so every rule below is a table in a test.
//
// Two kinds of condition:
//  - *level* conditions hold for as long as the situation does (texts stuck in the queue, no sender running, signature failures past the limit).
//    While one holds, the on-call Admins are texted when it begins and again every 30 minutes, until it clears.
//  - *event* conditions are raised by something that happened (a delivery became `unknown`, Smart Encoding was found on). Each new event is texted
//    about once; the condition holds until nothing of that kind is left (every unknown delivery has been answered, the daily check found Smart
//    Encoding off), and no further text is sent for the same events.
// In both, a condition is texted at most once per 30 minutes (`ALERT_INTERVAL_MS`), counted from the last text about it, whether it began just now
// or came back. An event that arrives inside the interval waits for it: it is still unreported (its id is past `lastEventId`), so the next run
// after the interval texts it.
import type { HealthCondition } from "./events";

/** The most often the on-call Admins are texted about one condition (AD-23, S06.07). */
export const ALERT_INTERVAL_MS = 30 * 60_000;
/** Webhook signature failures are counted over this long, and alert when they exceed SIGNATURE_FAILURE_LIMIT. */
export const SIGNATURE_WINDOW_MS = 10 * 60_000;
export const SIGNATURE_FAILURE_LIMIT = 5;

/** A scheduled job's failures (a failed pg_cron run, a job call that did not answer 2xx) are counted over this long (S09.01). */
export const JOB_FAILURE_WINDOW_MS = 10 * 60_000;
/** A whole language that fell back to English in an alert is the health job's business for this long (S09.01), like an unknown delivery. */
export const FALLBACK_WINDOW_MS = 24 * 60 * 60_000;
/**
 * The heartbeat (S09.01, E09 "Heartbeat"): the health job records the time of each run that judged every condition; `/api/health/heartbeat` answers
 * 200 only while that time is less than this old, and the outside check emails the on-call Admins when it fails twice in a row.
 */
export const HEARTBEAT_STALE_AFTER_MS = 3 * 60_000;

/** Whether the health job's last complete run is recent enough for the heartbeat to answer 200 (never run: not fresh). */
export function heartbeatFresh(completedAt: Date | null, now: Date): boolean {
  return completedAt !== null && now.getTime() - completedAt.getTime() < HEARTBEAT_STALE_AFTER_MS;
}

/** The conditions that mean the sender itself is not sending: the Hub shows the banner for these, since an on-call text may be stuck behind them. */
export const SENDER_CONDITIONS = ["queue_stuck", "sender_stalled"] as const satisfies readonly HealthCondition[];

export interface ConditionState {
  active: boolean;
  since: Date | null;
  lastAlertedAt: Date | null;
  /** The highest `ops_event` id the last text covered (event conditions); null before the first. */
  lastEventId: number | null;
}

export interface Observation {
  /** Whether the condition holds now. */
  holds: boolean;
  /** How many things it counts (stuck texts, unknown deliveries, failures; 1 for a setting). */
  count: number;
  /**
   * Event conditions only: whether something the last text did not cover has happened since (an `ops_event` newer than `lastEventId`, or a
   * stuck hand-off at the start of the condition). Level conditions leave it out: they text on the interval alone.
   */
  fresh?: boolean;
}

export type Decision =
  /** Nothing holds and nothing was raised. */
  | { kind: "quiet" }
  /** The condition holds and is already known; nothing is texted now (inside the interval, or nothing new). */
  | { kind: "hold"; begins: boolean }
  /** Text the on-call Admins; `begins` when the condition was not active before this run. */
  | { kind: "alert"; begins: boolean }
  /** The condition cleared: record the recovery, send nothing. */
  | { kind: "recover" };

/** Whether the interval since the last text has passed (a condition never texted about may be texted at once). */
export function intervalPassed(lastAlertedAt: Date | null, now: Date): boolean {
  return lastAlertedAt === null || now.getTime() - lastAlertedAt.getTime() >= ALERT_INTERVAL_MS;
}

export function decide(state: ConditionState, observation: Observation, now: Date): Decision {
  if (!observation.holds) return state.active ? { kind: "recover" } : { kind: "quiet" };
  const begins = !state.active;
  // An event condition with nothing new to say is only held; a level condition always has something to say once the interval has passed.
  const hasNews = observation.fresh === undefined ? true : observation.fresh;
  if (hasNews && intervalPassed(state.lastAlertedAt, now)) return { kind: "alert", begins };
  return { kind: "hold", begins };
}
