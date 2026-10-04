// The heartbeat (S09.01, E09 "Heartbeat"): what `GET /api/health/heartbeat` answers. The health job records the time of each run that judged
// every condition; the heartbeat answers 200 while that time is less than 3 minutes old and nothing the outside check must hear about holds, else
// 503 with one short code naming the subsystem that is failing (S09.01 follow-up, the product owner's call: the monitor's email can quote it):
//  - `health_job_stale`: the health job has not completed a run for 3 minutes, or never has;
//  - `provider_auth`: Twilio has refused the CVH's sign-in for 10 minutes with nothing accepted since (ops' domain/health.ts has the debounce);
//  - `database_unreachable`: the database failed or did not answer in 5 seconds.
// Nothing else: no number, no time, no error text, no id, no cookie (the Hub's banner and `ops_event` hold the detail). An uptime monitor outside
// Vercel, Supabase and Twilio calls it every minute and emails the on-call Admins when it fails twice in a row, so a stopped pg_cron, a database
// that is down, an app that is down or a Twilio sign-in that keeps failing is noticed even when the CVH cannot text anyone (docs/config.md, "The
// outside check"). Server only.
import "server-only";
import { readHeartbeat, type HeartbeatCause } from "@/modules/ops";
import { getDb } from "@/platform/db";

/**
 * How long one answer is reused. The route is public and the monitor calls it once a minute, so anyone calling it faster gets the same answer
 * without a database read; the answer is at most this much older than the 3 minutes it judges.
 */
export const HEARTBEAT_CACHE_MS = 10_000;

/** How long the heartbeat waits for the database before answering 503: a database that does not answer is a failure the monitor must see. */
export const HEARTBEAT_READ_TIMEOUT_MS = 5000;

/** What a 503 names: ops' causes, and a database the heartbeat could not read. */
export type HeartbeatFailure = HeartbeatCause | "database_unreachable";

/** 200 with no body, or 503 with the cause's code as its body. */
export type HeartbeatAnswer = { status: 200 } | { status: 503; cause: HeartbeatFailure };

export interface HeartbeatParts {
  /** Why the heartbeat fails now, or null when it does not (ops' `readHeartbeat`). */
  cause?: () => Promise<HeartbeatCause | null>;
  timeoutMs?: number;
  logError?: (fields: Record<string, string>) => void;
}

class HeartbeatTimeout extends Error {
  override name = "HeartbeatTimeout";
}

/** 200 while the health job completed within 3 minutes and Twilio sign-in is not failing for 10; else 503 and why. */
export async function heartbeatStatus(parts: HeartbeatParts = {}): Promise<HeartbeatAnswer> {
  const cause = parts.cause ?? (async () => (await readHeartbeat(getDb())).cause);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HeartbeatTimeout()), parts.timeoutMs ?? HEARTBEAT_READ_TIMEOUT_MS);
    });
    const failing = await Promise.race([cause(), deadline]);
    return failing === null ? { status: 200 } : { status: 503, cause: failing };
  } catch (error) {
    (parts.logError ?? logHeartbeatFailure)({ error: error instanceof Error ? error.name : "NonError" });
    return { status: 503, cause: "database_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function logHeartbeatFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "health.heartbeat_unreadable", module: "app", ...fields }));
}

let lastAnswer: { answer: HeartbeatAnswer; at: number } | undefined;
let reading: Promise<HeartbeatAnswer> | undefined;

/** `heartbeatStatus`, read at most once per HEARTBEAT_CACHE_MS on this instance; calls that arrive during a read share it. */
export function cachedHeartbeatStatus(now: () => number = Date.now): Promise<HeartbeatAnswer> {
  const startedAt = now();
  if (lastAnswer !== undefined && startedAt - lastAnswer.at < HEARTBEAT_CACHE_MS) return Promise.resolve(lastAnswer.answer);
  reading ??= heartbeatStatus()
    .then((answer) => {
      lastAnswer = { answer, at: startedAt };
      return answer;
    })
    .finally(() => {
      reading = undefined;
    });
  return reading;
}

/** Tests only: forget the reused answer. */
export function forgetHeartbeatAnswer(): void {
  lastAnswer = undefined;
}
