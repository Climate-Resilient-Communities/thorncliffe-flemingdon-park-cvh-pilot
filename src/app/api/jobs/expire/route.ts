// `/api/jobs/expire` (S05.04, FR-A7): closes the alerts that ran past their valid-until, called every minute by pg_cron with the environment's job secret
// (docs/config.md has the cron statement; it is not applied to production by this repository). Each overdue thread is closed `expired` in its own transaction,
// with a system final; one that could not be closed is an `ops_event` and the next run tries it again. The answer is counts only: never a thread, a slug or a text.
import { runExpireJob } from "@/app/expire";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    const report = await runExpireJob();
    // Threads that failed were recorded and are the next run's; the run itself answered. Only a run that closed nothing and failed everything it tried (the
    // database is unreachable or the close is broken) is an error, so that pg_cron's run shows it.
    const everythingFailed = report.failed > 0 && report.closed === 0 && report.skipped === 0;
    return Response.json(report, { status: everythingFailed ? 500 : 200, headers: NO_STORE });
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "expire.run_failed", module: "alerting", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "expire_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
