// `/api/jobs/reconcile-spend` (S06.08): the reconciliation of Twilio's actual prices with the estimates counted when texts were accepted.
// pg_cron calls it daily with the environment's job secret, and the owner calls it by hand after a month ends. With no body it reconciles
// what is due (the month before this one, and every month still pending); `{"month":"YYYY-MM"}` reconciles that month. Each run is
// idempotent: a complete month is not listed again, and a pending month (a listing that failed or was cut short, a message with no price
// yet) is tried again. Outside production there is no Twilio account and nothing is read (`not_live`). The answer is counts, cents and
// codes, never a message, a number or a recipient.
import { runReconcileJob } from "@/app/reconcile";
import { SenderNotConfigured } from "@/app/dispatch";
import { getEnv } from "@/platform/config/env";
import { checkJobSecret } from "../jobAuth";

export const dynamic = "force-dynamic";
/** The listing stops after 45 seconds (DEFAULT_LISTING_DEADLINE_MS), and the import that follows it takes the rest. */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function POST(request: Request) {
  const denied = checkJobSecret(request, getEnv());
  if (denied) return denied;

  let months: string[] | undefined;
  const raw = await request.text();
  if (raw.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: { code: "body_invalid" } }, { status: 400, headers: NO_STORE });
    }
    const month = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).month : undefined;
    if (typeof month !== "string" || !MONTH.test(month)) return Response.json({ error: { code: "month_invalid" } }, { status: 400, headers: NO_STORE });
    months = [month];
  }

  try {
    const outcome = await runReconcileJob({ months });
    if (outcome.status === "ok" && outcome.results.some((entry) => entry.result.status === "failed")) {
      return Response.json({ error: { code: "reconcile_failed" }, ...outcome }, { status: 500, headers: NO_STORE });
    }
    return Response.json(outcome, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof SenderNotConfigured) {
      console.log(JSON.stringify({ level: "error", evt: "reconcile.sender_not_configured", module: "spend", rule: error.rule }));
      return Response.json({ error: { code: "sender_not_configured" } }, { status: 503, headers: NO_STORE });
    }
    console.log(JSON.stringify({ level: "error", evt: "reconcile.run_failed", module: "spend", error: error instanceof Error ? error.name : "NonError" }));
    return Response.json({ error: { code: "reconcile_failed" } }, { status: 500, headers: NO_STORE });
  }
}

export function GET() {
  return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers: { ...NO_STORE, Allow: "POST" } });
}
