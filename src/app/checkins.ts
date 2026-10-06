// Composition root of the check-in requests (S08.05, AD-2, AD-12): checkins' use cases with the request on subscriptions' subscriber row
// (`checkinRequestStore`), alerting's open round threads (`roundThreads`) and identity's `coversFloor` (the only coverage test, through
// src/app/staff/assignments.ts, which gives identity places' floors). The inbound router, the menus, the edit link and the deletion they share
// use it in place of E07's no-op ports; S08.06's approval will call its `ensureRound`. Server only.
import "server-only";
import { roundThreads } from "@/modules/alerting";
import { createCheckinRequests, type CheckinRequests } from "@/modules/checkins";
import { checkinRequestStore } from "@/modules/subscriptions";
import { assignments } from "./staff/assignments";

let service: CheckinRequests | undefined;

/** checkins' requests on the app's database (made once). */
export function checkinRequests(): CheckinRequests {
  return (service ??= createCheckinRequests({
    requests: checkinRequestStore(),
    threads: roundThreads,
    coversFloor: (rsn, floorId, executor) => assignments().coversFloor(rsn, floorId, executor),
  }));
}
