import { recordUsage } from "@/modules/directory";
import { getDb } from "@/platform/db";
import { metricsResponse } from "./handler";

// The usage counter (S02.15, AR-26): a count per day, language and neighbourhood, never a person. It writes, so it is never cached.
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return metricsResponse(
    {
      count: (event) => recordUsage(getDb(), event),
      // The kind of error only: a database message can carry the statement and its values.
      onFailure: (error) => console.log(JSON.stringify({ level: "error", evt: "resident.usage_count_failed", module: "app", error: error instanceof Error ? error.constructor.name : "unknown" })),
    },
    request,
  );
}
