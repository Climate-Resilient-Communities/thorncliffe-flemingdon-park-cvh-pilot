// `/api/jobs/subscriber-measures` (S07.10, FR-M1 subscribers): the daily measures job, called once a day by pg_cron with the environment's job secret
// (docs/config.md has the cron statement; it is not applied to production by this repository). It stores, for the Toronto day that has just ended, receiving
// subscribers by state, pending sign-ups, confirmations and deletions by language and neighbourhood, as counts only; a second run on the same day replaces that
// day's figures. The answer is the day and the number of cells written: never a count, a number or an id.
import { runSubscriberMeasuresJob } from "@/app/subscriberMeasures";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    return Response.json(await runSubscriberMeasuresJob(), { headers: NO_STORE });
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "subscriber_measures.run_failed", module: "subscriptions", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "measures_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
