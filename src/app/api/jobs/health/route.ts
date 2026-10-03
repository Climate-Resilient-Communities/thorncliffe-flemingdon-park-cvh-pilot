// `/api/jobs/health` (S06.07, AD-23): the stuck-queue and failing-sender check, called every minute by pg_cron with the environment's job secret
// (docs/config.md has the cron statement; it is not applied to production by this repository). For each of five conditions it records an
// `ops_event` (no personal data) when it texts the on-call Admins and when the condition clears. The answer is the condition codes, whether each
// holds, what was done and how many numbers were texted: never a number, a name or a body.
import { runHealthJob } from "@/app/health";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    const report = await runHealthJob();
    // A condition whose judgement threw is in the report as failed (and logged by name); the run itself answered, so the job's own status is 200
    // unless every condition failed, which means the database is unreachable and pg_cron should see an error.
    const failed = report.conditions.filter((condition) => condition.status === "failed").length;
    return Response.json(report, { status: report.conditions.length > 0 && failed === report.conditions.length ? 500 : 200, headers: NO_STORE });
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "health.run_failed", module: "ops", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "health_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
