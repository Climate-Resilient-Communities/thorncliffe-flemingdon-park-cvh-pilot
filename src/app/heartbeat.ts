// The heartbeat (S09.01, E09 "Heartbeat"): what `GET /api/health/heartbeat` answers. The health job records the time of each run that judged
// every condition; the heartbeat answers 200 only while that time is less than 3 minutes old, else 503, and nothing else: no body, no cookie,
// no detail of what is wrong (the Hub's banner and `ops_event` hold that). An uptime monitor outside Vercel, Supabase and Twilio calls it every
// minute and emails the on-call Admins when it fails twice in a row, so a stopped pg_cron, a database that is down or an app that is down is
// noticed even when the CVH cannot text anyone (docs/config.md, "The outside check"). Server only.
import "server-only";
import { readHeartbeat } from "@/modules/ops";
import { getDb } from "@/platform/db";

/**
 * How long one answer is reused. The route is public and the monitor calls it once a minute, so anyone calling it faster gets the same answer
 * without a database read; the answer is at most this much older than the 3 minutes it judges.
 */
export const HEARTBEAT_CACHE_MS = 10_000;

/** How long the heartbeat waits for the database before answering 503: a database that does not answer is a failure the monitor must see. */
export const HEARTBEAT_READ_TIMEOUT_MS = 5000;

export interface HeartbeatParts {
  /** Whether the health job's last complete run is fresh (ops' `readHeartbeat`). */
  fresh?: () => Promise<boolean>;
  timeoutMs?: number;
  logError?: (fields: Record<string, string>) => void;
}

class HeartbeatTimeout extends Error {
  override name = "HeartbeatTimeout";
}

/** 200 while the health job completed within 3 minutes; 503 when it has not, has never run, or the database cannot say in time. */
export async function heartbeatStatus(parts: HeartbeatParts = {}): Promise<200 | 503> {
  const fresh = parts.fresh ?? (async () => (await readHeartbeat(getDb())).fresh);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new HeartbeatTimeout()), parts.timeoutMs ?? HEARTBEAT_READ_TIMEOUT_MS);
    });
    return (await Promise.race([fresh(), deadline])) ? 200 : 503;
  } catch (error) {
    (parts.logError ?? logHeartbeatFailure)({ error: error instanceof Error ? error.name : "NonError" });
    return 503;
  } finally {
    clearTimeout(timer);
  }
}

function logHeartbeatFailure(fields: Record<string, string>): void {
  console.log(JSON.stringify({ level: "error", evt: "health.heartbeat_unreadable", module: "app", ...fields }));
}

let lastAnswer: { status: 200 | 503; at: number } | undefined;
let reading: Promise<200 | 503> | undefined;

/** `heartbeatStatus`, read at most once per HEARTBEAT_CACHE_MS on this instance; calls that arrive during a read share it. */
export function cachedHeartbeatStatus(now: () => number = Date.now): Promise<200 | 503> {
  const startedAt = now();
  if (lastAnswer !== undefined && startedAt - lastAnswer.at < HEARTBEAT_CACHE_MS) return Promise.resolve(lastAnswer.status);
  reading ??= heartbeatStatus()
    .then((status) => {
      lastAnswer = { status, at: startedAt };
      return status;
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
