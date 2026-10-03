import { alertSubmitter } from "@/app/staff/alerts";
import { staffError, staffJson, staffRoute } from "@/app/staff/guard";
import { entryStateBody } from "@/app/staff/alerts/submitBody";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /api/staff/alerts/entries/state?alert=<id>&entry=<id>` (S04.05): the entry's authoritative state, read in one snapshot: what is
 * stored (a draft, pending or approved), the latest submit attempt (running with each language's progress, committed, or failed and why)
 * and the frozen translations. It is what a browser that lost the outcome of a submit fetches, and what the composer polls while a
 * submit runs. Policy action `alert.author_wide`, like the composer.
 */
export const GET = staffRoute({ route: "/api/staff/alerts/entries/state", access: "hub", action: "alert.author_wide" }, async (request) => {
  const url = new URL(request.url);
  const alertId = url.searchParams.get("alert") ?? "";
  const entryId = url.searchParams.get("entry") ?? "";
  if (!UUID.test(alertId) || !UUID.test(entryId)) return staffError(400, "bad_request");
  const state = entryStateBody(await alertSubmitter().state({ alertId, entryId }), new Date());
  // No such entry is a bad request like a malformed id: the route says nothing of what exists.
  return state === null ? staffError(400, "bad_request") : staffJson(state);
});
