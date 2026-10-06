// Composition root of the check-in requests (S08.05, AD-2, AD-12): checkins' use cases with the request on subscriptions' subscriber row
// (`checkinRequestStore`), alerting's open round threads (`roundThreads`) and identity's `coversFloor` (the only coverage test; composed here
// rather than through src/app/staff/assignments.ts, which itself calls these requests when an assignment is saved). The inbound router, the menus, the edit link and the deletion they share
// use it in place of E07's no-op ports; the approval (src/app/staff/alerts.ts, S08.06) calls its `ensureRound`. Server only.
import "server-only";
import { roundThreads } from "@/modules/alerting";
import { createCheckinRequests, type CheckinRequests } from "@/modules/checkins";
import { createAssignments } from "@/modules/identity";
import { floorsOfBuilding } from "@/modules/places";
import { checkinRequestStore } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";

let service: CheckinRequests | undefined;

/** checkins' requests on the app's database (made once). */
export function checkinRequests(): CheckinRequests {
  if (service) return service;
  const coverage = createAssignments({ db: getDb(), floors: { floorsOf: floorsOfBuilding } });
  return (service = createCheckinRequests({
    requests: checkinRequestStore(),
    threads: roundThreads,
    coversFloor: (rsn, floorId, executor) => coverage.coversFloor(rsn, floorId, executor),
  }));
}
