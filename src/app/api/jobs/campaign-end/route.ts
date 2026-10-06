// `/api/jobs/campaign-end` (S09.07): the end of the end-of-pilot re-consent campaign, called by pg_cron every 15 minutes with the environment's job secret
// (docs/config.md has the cron statement; it is not applied to production by this repository). Every campaign and rehearsal whose deadline has passed, by the
// database's clock, becomes `ended`; the real one is audited with how many subscribers stayed and how many did not reply. Sign-ups stay closed until an Admin
// reopens them; deleting the subscribers who did not reply is S09.08's purge. The answer is counts only: never a number or an id.
import { runCampaignEndJob } from "@/app/campaign";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;
  try {
    return Response.json(await runCampaignEndJob(), { headers: NO_STORE });
  } catch (error) {
    console.log(JSON.stringify({ level: "error", evt: "campaign.end_failed", module: "subscriptions", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "campaign_end_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
