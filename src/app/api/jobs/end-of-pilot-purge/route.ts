// `/api/jobs/end-of-pilot-purge` (S09.08, FR-D-7): the end-of-pilot purge, called by pg_cron every 15 minutes with the environment's job secret (docs/config.md
// has the cron statement; it is not applied to production by this repository). Before the re-consent campaign's deadline, by the database's clock, it does
// nothing. After it, every subscriber still `reconsent_pending` is deleted with the E07 deletion, each in a transaction of its own, for at most 40 seconds a
// run (the next run goes on); once none is left the completion is recorded with the aggregate ops event `campaign.purge_completed`, and the terms page's
// reading of it is expired so it states the day at once. A run with a subscriber whose deletion failed answers 500 (the health job's `job_failed` then
// tells the on-call Admins), after deleting the others. The answer is counts only: never a number or an id.
import { revalidateTag } from "next/cache";
import { PILOT_END_TAG } from "@/app/pilotEnd";
import { runEndOfPilotPurge } from "@/app/purge";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    const report = await runEndOfPilotPurge();
    if (report.completedNow) {
      try {
        revalidateTag(PILOT_END_TAG, { expire: 0 });
      } catch {
        // The terms page's cached reading still runs out within the hour.
      }
    }
    return Response.json(report, { status: report.failed > 0 ? 500 : 200, headers: NO_STORE });
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "purge.run_failed", module: "subscriptions", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "purge_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
